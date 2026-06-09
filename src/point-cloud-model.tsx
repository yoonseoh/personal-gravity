import { useFrame, useLoader } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { DetailInteractionPoint, ViewerSettings } from "./main";

type PointCloudModelProps = {
  modelUrl: string;
  pointDataUrl?: string;
  floatingPointDataUrl?: string;
  floatingPointDataUrls?: string[];
  settings: ViewerSettings;
  maxDensity: number;
  displayPosition?: [number, number, number];
  initialRotation?: [number, number, number];
  viewRotationX?: number;
  viewRotationY?: number;
  viewZoom?: number;
  interactionPoint?: DetailInteractionPoint;
  introPaused?: boolean;
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
const INTERACTION_ALIGNMENT_POINTS = 96_000;
const INTERACTION_CONNECTION_LINES = 50;
const ENABLE_TOUCH_PARTICLE_ALIGNMENT = false;

function GeneratedPointCloudModel({
  modelUrl,
  settings,
  maxDensity,
  displayPosition = [0.72, -0.08, 0],
  initialRotation = [0, 0, 0],
  viewRotationX = 0,
  viewRotationY = 0,
  viewZoom = 1,
  interactionPoint,
  floatingLayer = false,
  floatingLayerIndex = 0,
  showConnectionLines = true,
  introPaused = false
}: Omit<PointCloudModelProps, "pointDataUrl" | "floatingPointDataUrl"> & {
  floatingLayer?: boolean;
  floatingLayerIndex?: number;
  showConnectionLines?: boolean;
}) {
  const gltf = useLoader(GLTFLoader, modelUrl);
  const cloud = useMemo(() => makePointCloud(gltf, maxDensity), [gltf, maxDensity]);

  return (
    <PointCloudPoints
      cloud={cloud}
      settings={settings}
      displayPosition={displayPosition}
      initialRotation={initialRotation}
      viewRotationX={viewRotationX}
      viewRotationY={viewRotationY}
      viewZoom={viewZoom}
      interactionPoint={interactionPoint}
      floatingLayer={floatingLayer}
      floatingLayerIndex={floatingLayerIndex}
      showConnectionLines={showConnectionLines}
      introPaused={introPaused}
    />
  );
}

function BakedPointCloudModel({
  pointDataUrl,
  settings,
  displayPosition,
  initialRotation,
  viewRotationX = 0,
  viewRotationY = 0,
  viewZoom = 1,
  interactionPoint,
  floatingLayer = false,
  floatingLayerIndex = 0,
  showConnectionLines = true,
  introPaused = false
}: {
  pointDataUrl: string;
  settings: ViewerSettings;
  displayPosition: [number, number, number];
  initialRotation: [number, number, number];
  viewRotationX?: number;
  viewRotationY?: number;
  viewZoom?: number;
  interactionPoint?: DetailInteractionPoint;
  floatingLayer?: boolean;
  floatingLayerIndex?: number;
  showConnectionLines?: boolean;
  introPaused?: boolean;
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

  return (
    <PointCloudPoints
      cloud={cloud}
      settings={settings}
      displayPosition={displayPosition}
      initialRotation={initialRotation}
      viewRotationX={viewRotationX}
      viewRotationY={viewRotationY}
      viewZoom={viewZoom}
      interactionPoint={interactionPoint}
      floatingLayer={floatingLayer}
      floatingLayerIndex={floatingLayerIndex}
      showConnectionLines={showConnectionLines}
      introPaused={introPaused}
    />
  );
}

function PointCloudPoints({
  cloud,
  settings,
  displayPosition,
  initialRotation,
  viewRotationX = 0,
  viewRotationY = 0,
  viewZoom = 1,
  interactionPoint,
  floatingLayer = false,
  floatingLayerIndex = 0,
  showConnectionLines = true,
  introPaused = false
}: {
  cloud: SampledCloud;
  settings: ViewerSettings;
  displayPosition: [number, number, number];
  initialRotation: [number, number, number];
  viewRotationX?: number;
  viewRotationY?: number;
  viewZoom?: number;
  interactionPoint?: DetailInteractionPoint;
  floatingLayer?: boolean;
  floatingLayerIndex?: number;
  showConnectionLines?: boolean;
  introPaused?: boolean;
}) {
  const rotationRef = useRef<THREE.Group>(null);
  const innerRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.PointsMaterial>(null);
  const connectionLineRef = useRef<THREE.LineSegments>(null);
  const connectionLineMaterialRef = useRef<THREE.LineBasicMaterial>(null);
  const introTimeRef = useRef(0);
  const autoRotationRef = useRef(0);
  const interactionRef = useRef<DetailInteractionPoint>({ active: false, x: 0, y: 0, clientX: 0, clientY: 0, velocityX: 0, velocityY: 0, speed: 0 });
  const alignmentStrengthRef = useRef(0);
  const connectionFieldAgeRef = useRef(0);
  const interactionTargetRef = useRef(new THREE.Vector3());
  const floatingPositionRef = useRef(new THREE.Vector3(...displayPosition));
  const floatingRotationOffsetRef = useRef(new THREE.Vector3());
  const floatingRotationTargetRef = useRef(new THREE.Vector3());
  const floatingOrbitOffsetRef = useRef(new THREE.Vector3());
  const floatingOrbitTargetRef = useRef(new THREE.Vector3());
  const floatingOrbitPhaseRef = useRef(0);
  const viewTransformRef = useRef({ rotationX: viewRotationX, rotationY: viewRotationY, zoom: viewZoom });
  const center = useMemo(() => cloud.bounds.getCenter(new THREE.Vector3()), [cloud]);
  const boundsSize = useMemo(() => cloud.bounds.getSize(new THREE.Vector3()), [cloud]);
  const connectionGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(INTERACTION_CONNECTION_LINES * 2 * 3), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(INTERACTION_CONNECTION_LINES * 2 * 3), 3));
    geometry.setDrawRange(0, 0);
    return geometry;
  }, []);
  const connectionLineIndices = useMemo(() => {
    const maxIndex = Math.max(cloud.pointCount - 1, 0);

    return Array.from({ length: INTERACTION_CONNECTION_LINES }, (_, index) => {
      const t = INTERACTION_CONNECTION_LINES <= 1 ? 0 : index / (INTERACTION_CONNECTION_LINES - 1);
      const stagger = ((index * 37) % 97) / 97;
      return Math.min(maxIndex, Math.floor((t * 0.82 + stagger * 0.18) * maxIndex));
    });
  }, [cloud.pointCount]);
  const projectionTools = useMemo(() => ({
    cameraNormal: new THREE.Vector3(),
    modelCenter: new THREE.Vector3(),
    ndc: new THREE.Vector2(),
    plane: new THREE.Plane(),
    raycaster: new THREE.Raycaster(),
    worldTarget: new THREE.Vector3()
  }), []);

  useEffect(() => {
    interactionRef.current = interactionPoint ?? { active: false, x: 0, y: 0, clientX: 0, clientY: 0, velocityX: 0, velocityY: 0, speed: 0 };
  }, [interactionPoint]);

  useEffect(() => {
    viewTransformRef.current = { rotationX: viewRotationX, rotationY: viewRotationY, zoom: viewZoom };
  }, [viewRotationX, viewRotationY, viewZoom]);

  useEffect(() => {
    introTimeRef.current = 0;
    autoRotationRef.current = 0;
    rotationRef.current?.rotation.set(initialRotation[0], initialRotation[1], initialRotation[2]);
    rotationRef.current?.position.set(displayPosition[0], displayPosition[1], displayPosition[2]);
    floatingPositionRef.current.set(displayPosition[0], displayPosition[1], displayPosition[2]);
    floatingRotationOffsetRef.current.set(0, 0, 0);
    floatingRotationTargetRef.current.set(0, 0, 0);
    floatingOrbitOffsetRef.current.set(0, 0, 0);
    floatingOrbitTargetRef.current.set(0, 0, 0);
    floatingOrbitPhaseRef.current = floatingLayerIndex * 2.15;
    const positionAttribute = cloud.geometry.getAttribute("position") as THREE.BufferAttribute;
    positionAttribute.array.set(cloud.introPositions);
    positionAttribute.needsUpdate = true;
    cloud.geometry.setDrawRange(0, Math.min(settings.density, cloud.pointCount, 14_000));
  }, [cloud.geometry, cloud.introPositions, displayPosition, floatingLayerIndex, initialRotation]);

  useEffect(() => {
    return () => {
      cloud.geometry.dispose();
      connectionGeometry.dispose();
    };
  }, [cloud.geometry, connectionGeometry]);

  useFrame((state, delta) => {
    if (introPaused) return;

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

    const interaction = interactionRef.current;
    alignmentStrengthRef.current = THREE.MathUtils.lerp(alignmentStrengthRef.current, interaction.active ? 1 : 0, interaction.active ? 0.08 : 0.12);
    connectionFieldAgeRef.current = interaction.active
      ? Math.min(1, connectionFieldAgeRef.current + delta / 1.9)
      : Math.max(0, connectionFieldAgeRef.current - delta / 1.35);

    if ((showConnectionLines || floatingLayer || ENABLE_TOUCH_PARTICLE_ALIGNMENT) && interaction.active && rotationRef.current && innerRef.current) {
      projectionTools.ndc.set(interaction.x, interaction.y);
      state.camera.getWorldDirection(projectionTools.cameraNormal);
      rotationRef.current.getWorldPosition(projectionTools.modelCenter);
      projectionTools.plane.setFromNormalAndCoplanarPoint(projectionTools.cameraNormal, projectionTools.modelCenter);
      projectionTools.raycaster.setFromCamera(projectionTools.ndc, state.camera);

      if (projectionTools.raycaster.ray.intersectPlane(projectionTools.plane, projectionTools.worldTarget)) {
        interactionTargetRef.current.copy(projectionTools.worldTarget);
        innerRef.current.worldToLocal(interactionTargetRef.current);
      }
    }

    if (ENABLE_TOUCH_PARTICLE_ALIGNMENT && alignmentStrengthRef.current > 0.01) {
      const current = positionAttribute.array as Float32Array;
      const activePointCount = Math.min(settings.density, cloud.pointCount, INTERACTION_ALIGNMENT_POINTS);
      const activeArrayLength = activePointCount * 3;
      const anchorX = interactionTargetRef.current.x;
      const anchorY = interactionTargetRef.current.y;
      const anchorZ = interactionTargetRef.current.z;
      const strength = alignmentStrengthRef.current;
      const time = state.clock.elapsedTime;
      const boundsMax = Math.max(boundsSize.x, boundsSize.y, boundsSize.z);
      const pullLimit = boundsMax * (0.0045 + interaction.speed * 0.002);
      const rotationLimit = boundsMax * (0.003 + interaction.speed * 0.002);
      const floatProgress = THREE.MathUtils.smoothstep(connectionFieldAgeRef.current, 0.04, 1);

      for (let index = 0; index < activeArrayLength; index += 3) {
        const pointIndex = index / 3;
        const baseX = cloud.originalPositions[index];
        const baseY = cloud.originalPositions[index + 1];
        const baseZ = cloud.originalPositions[index + 2];
        const toAnchorX = anchorX - baseX;
        const toAnchorY = anchorY - baseY;
        const toAnchorZ = anchorZ - baseZ;
        const toAnchorLength = Math.hypot(toAnchorX, toAnchorY, toAnchorZ) || 1;
        const dirX = toAnchorX / toAnchorLength;
        const dirY = toAnchorY / toAnchorLength;
        const dirZ = toAnchorZ / toAnchorLength;
        const radialX = baseX - center.x;
        const radialY = baseY - center.y;
        const radialZ = baseZ - center.z;
        const tangentX = dirY * radialZ - dirZ * radialY;
        const tangentY = dirZ * radialX - dirX * radialZ;
        const tangentZ = dirX * radialY - dirY * radialX;
        const tangentLength = Math.hypot(tangentX, tangentY, tangentZ) || 1;
        const lane = 0.62 + ((pointIndex * 17) % 37) / 37 * 0.58;
        const directionWave = 0.42 + Math.sin(time * 1.15 - toAnchorLength * 2.1 + pointIndex * 0.004) * 0.28;
        const tangentWave = Math.sin(time * 0.72 + pointIndex * 0.013);
        const distanceFalloff = Math.min(1, Math.max(0.28, toAnchorLength / Math.max(boundsMax * 0.9, 0.001)));
        const alignPull = Math.min(toAnchorLength * 0.012, pullLimit) * lane * distanceFalloff * directionWave;
        const rotatePull = rotationLimit * tangentWave * lane * (0.35 + interaction.speed * 0.35);
        const normalizedY = (baseY - cloud.bounds.min.y) / Math.max(boundsSize.y, 0.001);
        const applianceWeight = THREE.MathUtils.smoothstep(normalizedY, 0.5, 0.78);
        const groupX = Math.max(0, Math.min(3, Math.floor(((baseX - cloud.bounds.min.x) / Math.max(boundsSize.x, 0.001)) * 4)));
        const groupZ = Math.max(0, Math.min(3, Math.floor(((baseZ - cloud.bounds.min.z) / Math.max(boundsSize.z, 0.001)) * 4)));
        const groupSeed = ((groupX * 13 + groupZ * 17) % 29) / 29;
        const groupFloat = THREE.MathUtils.smoothstep(floatProgress, groupSeed * 0.34, 1);
        const hoverPhase = time * (0.7 + groupSeed * 0.22) + groupSeed * 9.7;
        const hoverLift = boundsMax * (0.045 + groupSeed * 0.018) * applianceWeight * groupFloat;
        const hoverDrift = boundsMax * 0.006 * applianceWeight * groupFloat;
        const fieldActive = connectionFieldAgeRef.current > 0.01;
        const targetX = fieldActive ? baseX + dirX * alignPull + (tangentX / tangentLength) * rotatePull + Math.sin(hoverPhase) * hoverDrift : baseX;
        const targetY = fieldActive ? baseY + dirY * alignPull + (tangentY / tangentLength) * rotatePull + hoverLift + Math.cos(hoverPhase * 0.83) * hoverDrift * 0.85 : baseY;
        const targetZ = fieldActive ? baseZ + dirZ * alignPull + (tangentZ / tangentLength) * rotatePull + Math.sin(hoverPhase * 0.61) * hoverDrift : baseZ;
        const nextX = fieldActive ? targetX : baseX;
        const nextY = fieldActive ? targetY : baseY;
        const nextZ = fieldActive ? targetZ : baseZ;
        const response = interaction.active ? Math.max(0.07, strength * 0.28) : Math.max(0.08, strength);

        current[index] = THREE.MathUtils.lerp(current[index], nextX, response);
        current[index + 1] = THREE.MathUtils.lerp(current[index + 1], nextY, response);
        current[index + 2] = THREE.MathUtils.lerp(current[index + 2], nextZ, response);
      }

      positionAttribute.needsUpdate = true;
    }

    const connectionPositionAttribute = connectionGeometry.getAttribute("position") as THREE.BufferAttribute;
    const connectionColorAttribute = connectionGeometry.getAttribute("color") as THREE.BufferAttribute;
    if (showConnectionLines && alignmentStrengthRef.current > 0.02 && connectionFieldAgeRef.current > 0.02) {
      const current = positionAttribute.array as Float32Array;
      const sourceColorAttribute = cloud.geometry.getAttribute("color") as THREE.BufferAttribute;
      const linePositions = connectionPositionAttribute.array as Float32Array;
      const lineColors = connectionColorAttribute.array as Float32Array;
      const fieldStrength = THREE.MathUtils.smoothstep(alignmentStrengthRef.current, 0.02, 0.95)
        * THREE.MathUtils.smoothstep(connectionFieldAgeRef.current, 0, 1);
      let activeLineCount = 0;

      for (let lineIndex = 0; lineIndex < INTERACTION_CONNECTION_LINES; lineIndex += 1) {
        const pointIndex = connectionLineIndices[lineIndex];
        const sourceIndex = pointIndex * 3;
        const targetIndex = activeLineCount * 6;
        const sourceX = current[sourceIndex];
        const sourceY = current[sourceIndex + 1];
        const sourceZ = current[sourceIndex + 2];
        const colorIndex = pointIndex * 3;
        const anchorX = interactionTargetRef.current.x;
        const anchorY = interactionTargetRef.current.y;
        const anchorZ = interactionTargetRef.current.z;
        const pulse = (Math.sin(state.clock.elapsedTime * 1.7 + lineIndex * 0.47) + 1) * 0.5;
        const shimmer = (Math.sin(state.clock.elapsedTime * 3.4 + lineIndex * 1.91) + 1) * 0.5;
        const lineLife = THREE.MathUtils.smoothstep(pulse, 0.32, 0.9) * (0.68 + shimmer * 0.24);
        const emergenceDelay = (lineIndex % 37) / 37;
        const emergence = THREE.MathUtils.smoothstep(connectionFieldAgeRef.current, emergenceDelay * 0.42, 1);
        const lineLengthRatio = fieldStrength * lineLife * emergence;

        if (lineLengthRatio < 0.12) continue;

        const endX = anchorX;
        const endY = anchorY;
        const endZ = anchorZ;

        linePositions[targetIndex] = sourceX;
        linePositions[targetIndex + 1] = sourceY;
        linePositions[targetIndex + 2] = sourceZ;
        linePositions[targetIndex + 3] = endX;
        linePositions[targetIndex + 4] = endY;
        linePositions[targetIndex + 5] = endZ;
        const colorBoost = 0.2 + shimmer * 0.16;
        const sourceR = sourceColorAttribute.normalized ? sourceColorAttribute.array[colorIndex] / 255 : sourceColorAttribute.array[colorIndex];
        const sourceG = sourceColorAttribute.normalized ? sourceColorAttribute.array[colorIndex + 1] / 255 : sourceColorAttribute.array[colorIndex + 1];
        const sourceB = sourceColorAttribute.normalized ? sourceColorAttribute.array[colorIndex + 2] / 255 : sourceColorAttribute.array[colorIndex + 2];
        const lineR = THREE.MathUtils.lerp(sourceR, 1, colorBoost);
        const lineG = THREE.MathUtils.lerp(sourceG, 1, colorBoost);
        const lineB = THREE.MathUtils.lerp(sourceB, 1, colorBoost);

        lineColors[targetIndex] = lineR;
        lineColors[targetIndex + 1] = lineG;
        lineColors[targetIndex + 2] = lineB;
        lineColors[targetIndex + 3] = lineR;
        lineColors[targetIndex + 4] = lineG;
        lineColors[targetIndex + 5] = lineB;
        activeLineCount += 1;
      }

      connectionGeometry.setDrawRange(0, activeLineCount * 2);
      connectionPositionAttribute.needsUpdate = true;
      connectionColorAttribute.needsUpdate = true;
    } else {
      connectionGeometry.setDrawRange(0, 0);
    }

    if (floatingLayer && rotationRef.current) {
      const layerDelay = Math.min(0.32, floatingLayerIndex * 0.14);
      const layerAge = Math.max(0, connectionFieldAgeRef.current - layerDelay);
      const floatProgress = THREE.MathUtils.smoothstep(layerAge, 0.04, 1);
      const time = state.clock.elapsedTime;
      const lift = 0.42 * floatProgress;
      const drift = 0.035 * floatProgress;
      const directionX = THREE.MathUtils.clamp(interaction.velocityX * 42, -1, 1);
      const directionY = THREE.MathUtils.clamp(interaction.velocityY * 42, -1, 1);
      const anchorDirectionX = interaction.active
        ? THREE.MathUtils.clamp((interactionTargetRef.current.x - center.x) / Math.max(boundsSize.x * 0.38, 0.001), -1, 1)
        : 0;
      const anchorDirectionY = interaction.active
        ? THREE.MathUtils.clamp((interactionTargetRef.current.y - center.y) / Math.max(boundsSize.y * 0.34, 0.001), -1, 1)
        : 0;
      const orientationResponse = floatProgress * (interaction.active ? 1 : 0);
      const anchorDirectionZ = interaction.active
        ? THREE.MathUtils.clamp((interactionTargetRef.current.z - center.z) / Math.max(boundsSize.z * 0.38, 0.001), -1, 1)
        : 0;
      const orbitPlaneLength = Math.hypot(anchorDirectionX, anchorDirectionZ) || 1;
      const orbitTangentX = -anchorDirectionZ / orbitPlaneLength;
      const orbitTangentZ = anchorDirectionX / orbitPlaneLength;
      const orbitStrength = floatProgress * (interaction.active ? 1 : 0);
      const orbitRadius = 0.125 * orbitStrength;

      if (interaction.active) {
        floatingOrbitPhaseRef.current += delta * (0.74 + interaction.speed * 0.1) * (0.4 + floatProgress * 0.6);
      }

      floatingOrbitTargetRef.current.set(
        (orbitTangentX * Math.sin(floatingOrbitPhaseRef.current) + anchorDirectionX * Math.cos(floatingOrbitPhaseRef.current) * 0.62) * orbitRadius,
        Math.sin(floatingOrbitPhaseRef.current * 0.82) * 0.032 * orbitStrength,
        (orbitTangentZ * Math.sin(floatingOrbitPhaseRef.current) + anchorDirectionZ * Math.cos(floatingOrbitPhaseRef.current) * 0.62) * orbitRadius
      );
      floatingOrbitOffsetRef.current.lerp(floatingOrbitTargetRef.current, Math.min(1, delta * (interaction.active ? 2.4 : 2.8)));

      const orbitYaw = Math.sin(floatingOrbitPhaseRef.current) * 0.26 * orbitStrength;
      const orbitRoll = Math.cos(floatingOrbitPhaseRef.current * 0.82) * 0.08 * orbitStrength;
      floatingRotationTargetRef.current.set(
        THREE.MathUtils.clamp(-anchorDirectionY * 0.16 * orientationResponse, -0.18, 0.18),
        THREE.MathUtils.clamp(anchorDirectionX * 0.62 * orientationResponse + orbitYaw, -0.72, 0.72),
        orbitRoll
      );

      floatingPositionRef.current.set(
        displayPosition[0] + Math.sin(time * 0.72) * drift + directionX * 0.018 * floatProgress + floatingOrbitOffsetRef.current.x,
        displayPosition[1] + lift + Math.sin(time * 1.24) * 0.035 * floatProgress + floatingOrbitOffsetRef.current.y,
        displayPosition[2] + Math.cos(time * 0.64) * drift * 0.75 + directionY * 0.01 * floatProgress + floatingOrbitOffsetRef.current.z
      );
      rotationRef.current.position.lerp(floatingPositionRef.current, Math.min(1, delta * 2.25));
      floatingRotationOffsetRef.current.lerp(floatingRotationTargetRef.current, Math.min(1, delta * (interaction.active ? 3.4 : 2.6)));
    }

    if (rotationRef.current) {
      autoRotationRef.current += delta * settings.rotationSpeed;
      rotationRef.current.rotation.x = initialRotation[0] + viewTransformRef.current.rotationX + (floatingLayer ? floatingRotationOffsetRef.current.x : 0);
      rotationRef.current.rotation.y = initialRotation[1] + autoRotationRef.current + viewTransformRef.current.rotationY + (floatingLayer ? floatingRotationOffsetRef.current.y : 0);
      rotationRef.current.rotation.z = initialRotation[2] + (floatingLayer ? floatingRotationOffsetRef.current.z : 0);
    }
    if (materialRef.current) {
      const introSizeBoost = introProgress < 1 ? 1.8 - introProgress * 0.8 : 1;
      materialRef.current.size = settings.particleSize * introSizeBoost;
      materialRef.current.opacity = settings.colorIntensity * (0.35 + introProgress * 0.65);
    }
    if (connectionLineMaterialRef.current) {
      connectionLineMaterialRef.current.opacity = Math.min(0.07, alignmentStrengthRef.current * connectionFieldAgeRef.current * 0.06);
    }
  });

  return (
    <group
      ref={rotationRef}
      position={displayPosition}
      rotation={initialRotation}
      scale={[cloud.scale * settings.spread * viewZoom, cloud.scale * viewZoom, cloud.scale * settings.spread * viewZoom]}
    >
      <group ref={innerRef} position={[-center.x, -center.y, -center.z]}>
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
        <lineSegments ref={connectionLineRef} geometry={connectionGeometry} frustumCulled={false}>
          <lineBasicMaterial
            ref={connectionLineMaterialRef}
            transparent
            opacity={0}
            vertexColors
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </lineSegments>
      </group>
    </group>
  );
}

export function PointCloudModel({
  modelUrl,
  pointDataUrl,
  floatingPointDataUrl,
  floatingPointDataUrls = [],
  settings,
  maxDensity,
  displayPosition = [0.72, -0.08, 0],
  initialRotation = [0, 0, 0],
  viewRotationX = 0,
  viewRotationY = 0,
  viewZoom = 1,
  interactionPoint,
  introPaused = false
}: PointCloudModelProps) {
  const floatingUrls = [floatingPointDataUrl, ...floatingPointDataUrls].filter((url): url is string => Boolean(url));

  if (pointDataUrl && floatingUrls.length > 0) {
    return (
      <>
        <BakedPointCloudModel
          pointDataUrl={pointDataUrl}
          settings={settings}
          displayPosition={displayPosition}
          initialRotation={initialRotation}
          viewRotationX={viewRotationX}
          viewRotationY={viewRotationY}
          viewZoom={viewZoom}
          interactionPoint={interactionPoint}
          showConnectionLines={false}
          introPaused={introPaused}
        />
        {floatingUrls.map((floatingUrl, index) => (
          <BakedPointCloudModel
            key={floatingUrl}
            pointDataUrl={floatingUrl}
            settings={settings}
            displayPosition={displayPosition}
            initialRotation={initialRotation}
            viewRotationX={viewRotationX}
            viewRotationY={viewRotationY}
            viewZoom={viewZoom}
            interactionPoint={interactionPoint}
            floatingLayer
            floatingLayerIndex={index}
            showConnectionLines
            introPaused={introPaused}
          />
        ))}
      </>
    );
  }

  if (pointDataUrl) {
    return (
      <BakedPointCloudModel
        pointDataUrl={pointDataUrl}
        settings={settings}
        displayPosition={displayPosition}
        initialRotation={initialRotation}
        viewRotationX={viewRotationX}
        viewRotationY={viewRotationY}
        viewZoom={viewZoom}
        interactionPoint={interactionPoint}
        showConnectionLines={false}
        introPaused={introPaused}
      />
    );
  }

  return (
    <GeneratedPointCloudModel
      modelUrl={modelUrl}
      settings={settings}
      maxDensity={maxDensity}
      displayPosition={displayPosition}
      initialRotation={initialRotation}
      viewRotationX={viewRotationX}
      viewRotationY={viewRotationY}
      viewZoom={viewZoom}
      interactionPoint={interactionPoint}
      introPaused={introPaused}
    />
  );
}
