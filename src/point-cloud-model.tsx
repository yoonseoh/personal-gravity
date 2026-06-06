import { useFrame, useLoader } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ViewerSettings } from "./main";

type PointCloudModelProps = {
  modelUrl: string;
  pointDataUrl?: string;
  settings: ViewerSettings;
  maxDensity: number;
  displayPosition?: [number, number, number];
};

type SampledCloud = {
  geometry: THREE.BufferGeometry;
  originalPositions: Float32Array;
  introPositions: Float32Array;
  bounds: THREE.Box3;
  scale: number;
  pointCount: number;
};

type WeightedMesh = {
  mesh: THREE.Mesh;
  weight: number;
  bounds: THREE.Box3;
  sampleCount: number;
};

type TextureSampler = {
  sample: (uv: THREE.Vector2, target: THREE.Color) => boolean;
};

function collectMeshes(scene: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];

  scene.updateMatrixWorld(true);
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh && object.geometry?.attributes.position) {
      meshes.push(object);
    }
  });

  return meshes;
}

function estimateMeshSurfaceArea(mesh: THREE.Mesh) {
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  const index = geometry.index;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const triangle = new THREE.Triangle();
  let area = 0;

  if (index) {
    for (let itemIndex = 0; itemIndex < index.count; itemIndex += 3) {
      a.fromBufferAttribute(position, index.getX(itemIndex));
      b.fromBufferAttribute(position, index.getX(itemIndex + 1));
      c.fromBufferAttribute(position, index.getX(itemIndex + 2));
      triangle.set(a, b, c);
      area += triangle.getArea();
    }
  } else {
    for (let itemIndex = 0; itemIndex < position.count; itemIndex += 3) {
      a.fromBufferAttribute(position, itemIndex);
      b.fromBufferAttribute(position, itemIndex + 1);
      c.fromBufferAttribute(position, itemIndex + 2);
      triangle.set(a, b, c);
      area += triangle.getArea();
    }
  }

  const worldScale = mesh.getWorldScale(new THREE.Vector3());
  const averageScaleArea = Math.max(0.0001, (worldScale.x * worldScale.y + worldScale.y * worldScale.z + worldScale.x * worldScale.z) / 3);
  return Math.max(0.0001, area * averageScaleArea);
}

function estimateWorldBounds(mesh: THREE.Mesh) {
  const bounds = new THREE.Box3().setFromObject(mesh);
  if (bounds.isEmpty()) {
    const fallback = mesh.geometry.boundingBox?.clone() ?? new THREE.Box3();
    fallback.applyMatrix4(mesh.matrixWorld);
    return fallback;
  }

  return bounds;
}

function allocateSamples(meshes: THREE.Mesh[], maxDensity: number): WeightedMesh[] {
  const sceneBounds = new THREE.Box3();
  const weightedMeshes = meshes.map((mesh) => ({
    mesh,
    weight: estimateMeshSurfaceArea(mesh),
    bounds: estimateWorldBounds(mesh),
    sampleCount: 0
  }));
  weightedMeshes.forEach((item) => sceneBounds.union(item.bounds));
  const sceneSize = sceneBounds.getSize(new THREE.Vector3());
  const sceneMinY = sceneBounds.min.y;
  const adjustedWeights = weightedMeshes.map((item) => {
    const itemCenter = item.bounds.getCenter(new THREE.Vector3());
    const itemSize = item.bounds.getSize(new THREE.Vector3());
    const normalizedY = sceneSize.y > 0 ? (itemCenter.y - sceneMinY) / sceneSize.y : 0.5;
    const footprint = itemSize.x * itemSize.z;
    const sceneFootprint = Math.max(sceneSize.x * sceneSize.z, 1);
    const broadRatio = footprint / sceneFootprint;
    const isHemisphereLikeBase = normalizedY < 0.3 && broadRatio > 0.08;
    const lowerModelBoost = isHemisphereLikeBase ? 0.18 : normalizedY < 0.46 ? 1.25 : 1;
    const broadSurfaceBoost = isHemisphereLikeBase ? 0.22 : broadRatio > 0.08 ? 1.35 : 1;
    const tinyObjectBoost = Math.max(item.weight, 0.01) < 0.04 ? 1.6 : 1;

    return Math.sqrt(item.weight) * lowerModelBoost * broadSurfaceBoost * tinyObjectBoost;
  });
  const totalAdjustedWeight = adjustedWeights.reduce((sum, weight) => sum + weight, 0);
  const basePool = Math.floor(maxDensity * 0.52);
  const detailPool = maxDensity - basePool;
  const basePerMesh = Math.max(2400, Math.floor(basePool / Math.max(weightedMeshes.length, 1)));
  const isBaseMesh = (item: WeightedMesh) => {
    const itemCenter = item.bounds.getCenter(new THREE.Vector3());
    const itemSize = item.bounds.getSize(new THREE.Vector3());
    const normalizedY = sceneSize.y > 0 ? (itemCenter.y - sceneMinY) / sceneSize.y : 0.5;
    const broadRatio = (itemSize.x * itemSize.z) / Math.max(sceneSize.x * sceneSize.z, 1);

    return normalizedY < 0.3 && broadRatio > 0.08;
  };

  weightedMeshes.forEach((item, index) => {
    const proportional = Math.round((adjustedWeights[index] / totalAdjustedWeight) * detailPool);
    const itemMinimum = isBaseMesh(item) ? 420 : basePerMesh;
    item.sampleCount = Math.max(itemMinimum, proportional);
  });

  let allocated = weightedMeshes.reduce((sum, item) => sum + item.sampleCount, 0);
  while (allocated > maxDensity) {
    const adjustable = weightedMeshes
      .filter((item) => item.sampleCount > (isBaseMesh(item) ? 420 : basePerMesh))
      .sort((a, b) => b.sampleCount - a.sampleCount)[0];
    if (!adjustable) break;

    const adjustableMinimum = isBaseMesh(adjustable) ? 420 : basePerMesh;
    const reduction = Math.min(adjustable.sampleCount - adjustableMinimum, allocated - maxDensity);
    adjustable.sampleCount -= reduction;
    allocated -= reduction;
  }

  weightedMeshes.sort((a, b) => {
    const aCenter = a.bounds.getCenter(new THREE.Vector3());
    const bCenter = b.bounds.getCenter(new THREE.Vector3());
    return aCenter.y - bCenter.y;
  });

  return weightedMeshes;
}

function getMeshColor(mesh: THREE.Mesh) {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const color = new THREE.Color("#f4f8ff");

  if (material && "color" in material && material.color instanceof THREE.Color) {
    color.copy(material.color);
  }

  if (color.r + color.g + color.b < 0.45) {
    color.lerp(new THREE.Color("#8cc9ff"), 0.45);
  }

  return color;
}

function createTextureSampler(texture?: THREE.Texture | null): TextureSampler | null {
  const image = texture?.image as (CanvasImageSource & { width?: number; height?: number }) | undefined;
  if (!image || typeof document === "undefined") return null;

  const width = Number(image.width ?? 0);
  const height = Number(image.height ?? 0);
  if (!width || !height) return null;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;

    context.drawImage(image as CanvasImageSource, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;

    return {
      sample: (uv, target) => {
        const wrappedU = THREE.MathUtils.euclideanModulo(uv.x, 1);
        const wrappedV = THREE.MathUtils.euclideanModulo(uv.y, 1);
        const x = Math.min(width - 1, Math.max(0, Math.floor(wrappedU * width)));
        const y = Math.min(height - 1, Math.max(0, Math.floor((1 - wrappedV) * height)));
        const index = (y * width + x) * 4;
        const alpha = pixels[index + 3] / 255;

        if (alpha <= 0.02) return false;

        target.setRGB(pixels[index] / 255, pixels[index + 1] / 255, pixels[index + 2] / 255);
        return true;
      }
    };
  } catch {
    return null;
  }
}

function getPrimaryMaterial(mesh: THREE.Mesh) {
  return Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
}

function sampleMesh(mesh: THREE.Mesh, sampleCount: number, target: Float32Array, colorTarget: Float32Array, offset: number) {
  const sourceGeometry = mesh.geometry.clone();
  sourceGeometry.applyMatrix4(mesh.matrixWorld);

  const sourceMesh = new THREE.Mesh(sourceGeometry);
  const sampler = new MeshSurfaceSampler(sourceMesh).build();
  const point = new THREE.Vector3();
  const uv = new THREE.Vector2();
  const material = getPrimaryMaterial(mesh);
  const baseColor = getMeshColor(mesh);
  const materialMap = material && "map" in material ? material.map : null;
  const textureSampler = materialMap instanceof THREE.Texture ? createTextureSampler(materialMap) : null;
  const color = new THREE.Color();
  const textureColor = new THREE.Color();

  for (let index = 0; index < sampleCount; index += 1) {
    sampler.sample(point, undefined, undefined, uv);
    const targetIndex = (offset + index) * 3;
    target[targetIndex] = point.x;
    target[targetIndex + 1] = point.y;
    target[targetIndex + 2] = point.z;

    if (textureSampler?.sample(uv, textureColor)) {
      color.copy(textureColor).multiply(baseColor).lerp(new THREE.Color("#ffffff"), 0.08);
    } else {
      color.copy(baseColor);
    }

    if (color.r + color.g + color.b < 0.16) {
      color.lerp(new THREE.Color("#8cc9ff"), 0.28);
    }

    colorTarget[targetIndex] = color.r;
    colorTarget[targetIndex + 1] = color.g;
    colorTarget[targetIndex + 2] = color.b;
  }

  sourceGeometry.dispose();
}

function shufflePointAttributes(positions: Float32Array, colors: Float32Array, pointCount: number) {
  let seed = 123456789;
  const random = () => {
    seed = (1664525 * seed + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  for (let index = pointCount - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const a = index * 3;
    const b = swapIndex * 3;

    for (let component = 0; component < 3; component += 1) {
      const temp = positions[a + component];
      positions[a + component] = positions[b + component];
      positions[b + component] = temp;

      const colorTemp = colors[a + component];
      colors[a + component] = colors[b + component];
      colors[b + component] = colorTemp;
    }
  }
}

function makePointCloud(gltf: GLTF, maxDensity: number): SampledCloud {
  const meshes = collectMeshes(gltf.scene);
  const sourceBounds = new THREE.Box3();
  meshes.forEach((mesh) => sourceBounds.union(estimateWorldBounds(mesh)));
  const weightedMeshes = allocateSamples(meshes, maxDensity);
  const positions = new Float32Array(maxDensity * 3);
  const colors = new Float32Array(maxDensity * 3);

  let offset = 0;
  weightedMeshes.forEach(({ mesh, sampleCount }) => {
    const remaining = maxDensity - offset;
    if (remaining <= 0) return;

    const count = Math.min(remaining, sampleCount);
    sampleMesh(mesh, count, positions, colors, offset);
    offset += count;
  });

  shufflePointAttributes(positions, colors, offset);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setDrawRange(0, offset);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const bounds = sourceBounds.isEmpty() ? geometry.boundingBox?.clone() ?? new THREE.Box3() : sourceBounds.clone();
  const size = bounds.getSize(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 1);
  const center = bounds.getCenter(new THREE.Vector3());
  const originalPositions = new Float32Array(positions);
  const introPositions = makeIntroPositions(originalPositions, center, maxDimension);

  return {
    geometry,
    originalPositions,
    introPositions,
    bounds,
    scale: 2.85 / maxDimension,
    pointCount: offset
  };
}

type BakedPointCloudMetadata = {
  pointCount: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
};

function makeBakedPointCloud(metadata: BakedPointCloudMetadata, data: ArrayBuffer): SampledCloud {
  const pointCount = metadata.pointCount;
  const positionByteLength = pointCount * 3 * Float32Array.BYTES_PER_ELEMENT;
  const positions = new Float32Array(data, 0, pointCount * 3);
  const colors = new Uint8Array(data, positionByteLength, pointCount * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Uint8BufferAttribute(colors, 3, true));
  geometry.setDrawRange(0, pointCount);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const bounds = new THREE.Box3(
    new THREE.Vector3(...metadata.bounds.min),
    new THREE.Vector3(...metadata.bounds.max)
  );
  const size = bounds.getSize(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 1);
  const center = bounds.getCenter(new THREE.Vector3());
  const originalPositions = new Float32Array(positions);
  const introPositions = makeIntroPositions(originalPositions, center, maxDimension);

  return {
    geometry,
    originalPositions,
    introPositions,
    bounds,
    scale: 2.85 / maxDimension,
    pointCount
  };
}

function makeIntroPositions(positions: Float32Array, center: THREE.Vector3, maxDimension: number) {
  const introPositions = new Float32Array(positions.length);
  const radius = maxDimension * 1.18;

  for (let index = 0; index < positions.length; index += 3) {
    const pointIndex = index / 3;
    const angle = pointIndex * 2.399963229728653;
    const band = ((pointIndex % 997) / 997) * 2 - 1;
    const ring = Math.sqrt(Math.max(0, 1 - band * band));
    const noise = 0.74 + ((pointIndex * 37) % 101) / 101 * 0.62;

    introPositions[index] = center.x + Math.cos(angle) * ring * radius * noise;
    introPositions[index + 1] = center.y + band * radius * 0.62 + Math.sin(pointIndex * 0.013) * maxDimension * 0.06;
    introPositions[index + 2] = center.z + Math.sin(angle) * ring * radius * noise;
  }

  return introPositions;
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

const INTRO_ANIMATED_POINTS = 72_000;
const INTRO_DURATION = 1.35;

function GeneratedPointCloudModel({
  modelUrl,
  settings,
  maxDensity,
  displayPosition = [0.72, -0.08, 0]
}: Omit<PointCloudModelProps, "pointDataUrl">) {
  const gltf = useLoader(GLTFLoader, modelUrl);
  const cloud = useMemo(() => makePointCloud(gltf, maxDensity), [gltf, maxDensity]);

  return (
    <PointCloudPoints
      cloud={cloud}
      settings={settings}
      displayPosition={displayPosition}
    />
  );
}

function BakedPointCloudModel({
  pointDataUrl,
  settings,
  displayPosition
}: {
  pointDataUrl: string;
  settings: ViewerSettings;
  displayPosition: [number, number, number];
}) {
  const [cloud, setCloud] = useState<SampledCloud | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    let disposedCloud: SampledCloud | null = null;

    setCloud(null);

    Promise.all([
      fetch(`${pointDataUrl}.json`, { signal: abortController.signal }).then((response) => {
        if (!response.ok) throw new Error(`Failed to load point cloud metadata: ${response.status}`);
        return response.json() as Promise<BakedPointCloudMetadata>;
      }),
      fetch(`${pointDataUrl}.bin`, { signal: abortController.signal }).then((response) => {
        if (!response.ok) throw new Error(`Failed to load point cloud data: ${response.status}`);
        return response.arrayBuffer();
      })
    ]).then(([metadata, data]) => {
      if (abortController.signal.aborted) return;
      const nextCloud = makeBakedPointCloud(metadata, data);
      disposedCloud = nextCloud;
      setCloud(nextCloud);
    }).catch((error) => {
      if (!abortController.signal.aborted) {
        console.error(error);
      }
    });

    return () => {
      abortController.abort();
      disposedCloud?.geometry.dispose();
    };
  }, [pointDataUrl]);

  if (!cloud) return null;

  return <PointCloudPoints cloud={cloud} settings={settings} displayPosition={displayPosition} />;
}

function PointCloudPoints({
  cloud,
  settings,
  displayPosition
}: {
  cloud: SampledCloud;
  settings: ViewerSettings;
  displayPosition: [number, number, number];
}) {
  const rotationRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.PointsMaterial>(null);
  const introTimeRef = useRef(0);
  const center = useMemo(() => cloud.bounds.getCenter(new THREE.Vector3()), [cloud]);

  useEffect(() => {
    introTimeRef.current = 0;
    const positionAttribute = cloud.geometry.getAttribute("position") as THREE.BufferAttribute;
    positionAttribute.array.set(cloud.introPositions);
    positionAttribute.needsUpdate = true;
    cloud.geometry.setDrawRange(0, Math.min(settings.density, cloud.pointCount, 14_000));
  }, [cloud.geometry, cloud.introPositions]);

  useEffect(() => {
    return () => cloud.geometry.dispose();
  }, [cloud.geometry]);

  useFrame((_, delta) => {
    introTimeRef.current = Math.min(INTRO_DURATION, introTimeRef.current + delta);
    const introProgress = easeOutCubic(introTimeRef.current / INTRO_DURATION);
    const positionAttribute = cloud.geometry.getAttribute("position") as THREE.BufferAttribute;

    if (introProgress < 1) {
      const current = positionAttribute.array as Float32Array;
      const drift = Math.sin(introProgress * Math.PI) * 0.035;
      const animatedPointCount = Math.min(settings.density, cloud.pointCount, INTRO_ANIMATED_POINTS);
      const animatedArrayLength = animatedPointCount * 3;

      for (let index = 0; index < animatedArrayLength; index += 3) {
        const pointIndex = index / 3;
        const swirl = Math.sin(pointIndex * 0.018 + introProgress * 7.2) * drift;
        current[index] = THREE.MathUtils.lerp(cloud.introPositions[index], cloud.originalPositions[index], introProgress) + swirl;
        current[index + 1] = THREE.MathUtils.lerp(cloud.introPositions[index + 1], cloud.originalPositions[index + 1], introProgress);
        current[index + 2] = THREE.MathUtils.lerp(cloud.introPositions[index + 2], cloud.originalPositions[index + 2], introProgress) - swirl;
      }

      positionAttribute.needsUpdate = true;
      const introDrawCount = Math.floor(Math.min(settings.density, cloud.pointCount, INTRO_ANIMATED_POINTS) * (0.18 + introProgress * 0.82));
      cloud.geometry.setDrawRange(0, introDrawCount);
    } else if (introTimeRef.current - delta < INTRO_DURATION) {
      positionAttribute.array.set(cloud.originalPositions);
      positionAttribute.needsUpdate = true;
      cloud.geometry.setDrawRange(0, Math.min(settings.density, cloud.pointCount));
    } else {
      cloud.geometry.setDrawRange(0, Math.min(settings.density, cloud.pointCount));
    }

    if (rotationRef.current) {
      rotationRef.current.rotation.y += delta * settings.rotationSpeed;
    }
    if (materialRef.current) {
      const introSizeBoost = introProgress < 1 ? 1.8 - introProgress * 0.8 : 1;
      materialRef.current.size = settings.particleSize * introSizeBoost;
      materialRef.current.opacity = settings.colorIntensity * (0.35 + introProgress * 0.65);
    }
  });

  return (
    <group
      ref={rotationRef}
      position={displayPosition}
      scale={[cloud.scale * settings.spread, cloud.scale, cloud.scale * settings.spread]}
    >
      <group position={[-center.x, -center.y, -center.z]}>
        <points geometry={cloud.geometry}>
          <pointsMaterial
          ref={materialRef}
          color="#ffffff"
          size={settings.particleSize}
          sizeAttenuation
          transparent
          opacity={settings.colorIntensity}
          vertexColors
          depthWrite={false}
          blending={THREE.NormalBlending}
        />
        </points>
      </group>
    </group>
  );
}

export function PointCloudModel({
  modelUrl,
  pointDataUrl,
  settings,
  maxDensity,
  displayPosition = [0.72, -0.08, 0]
}: PointCloudModelProps) {
  if (pointDataUrl) {
    return <BakedPointCloudModel pointDataUrl={pointDataUrl} settings={settings} displayPosition={displayPosition} />;
  }

  return (
    <GeneratedPointCloudModel
      modelUrl={modelUrl}
      settings={settings}
      maxDensity={maxDensity}
      displayPosition={displayPosition}
    />
  );
}
