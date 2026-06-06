import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";
import * as THREE from "three";

const COMPONENT_BYTE_SIZE = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4
};

const TYPE_COMPONENTS = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16
};

function usage() {
  console.error("Usage: node scripts/bake-point-cloud.mjs <input.glb> <outputBase> [pointCount]");
  process.exit(1);
}

const [inputPath, outputBase, pointCountArg = "500000"] = process.argv.slice(2);
if (!inputPath || !outputBase) usage();

const requestedPointCount = Math.max(1_000, Number(pointCountArg));
if (!Number.isFinite(requestedPointCount)) usage();
const colorMode = process.env.COLOR_MODE ?? "natural";

function parseGlb(buffer) {
  if (buffer.toString("utf8", 0, 4) !== "glTF") {
    throw new Error("Input is not a binary GLB file.");
  }

  let offset = 12;
  let json = null;
  let binary = null;

  while (offset < buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.toString("utf8", offset + 4, offset + 8);
    const chunkStart = offset + 8;
    const chunk = buffer.subarray(chunkStart, chunkStart + chunkLength);

    if (chunkType === "JSON") json = JSON.parse(chunk.toString("utf8"));
    if (chunkType === "BIN\u0000") binary = chunk;

    offset = chunkStart + chunkLength;
  }

  if (!json || !binary) {
    throw new Error("GLB must contain JSON and BIN chunks.");
  }

  return { json, binary };
}

function readComponent(view, componentType, offset) {
  switch (componentType) {
    case 5120:
      return view.getInt8(offset);
    case 5121:
      return view.getUint8(offset);
    case 5122:
      return view.getInt16(offset, true);
    case 5123:
      return view.getUint16(offset, true);
    case 5125:
      return view.getUint32(offset, true);
    case 5126:
      return view.getFloat32(offset, true);
    default:
      throw new Error(`Unsupported component type: ${componentType}`);
  }
}

function normalizeComponent(value, componentType) {
  switch (componentType) {
    case 5120:
      return Math.max(value / 127, -1);
    case 5121:
      return value / 255;
    case 5122:
      return Math.max(value / 32767, -1);
    case 5123:
      return value / 65535;
    case 5125:
      return value / 4294967295;
    default:
      return value;
  }
}

function createAccessorReader(gltf, binary, accessorIndex) {
  const accessor = gltf.accessors[accessorIndex];
  const bufferView = gltf.bufferViews[accessor.bufferView];
  const componentCount = TYPE_COMPONENTS[accessor.type];
  const componentSize = COMPONENT_BYTE_SIZE[accessor.componentType];
  const stride = bufferView.byteStride ?? componentCount * componentSize;
  const byteOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const dataView = new DataView(binary.buffer, binary.byteOffset + byteOffset, bufferView.byteLength - (accessor.byteOffset ?? 0));

  return {
    count: accessor.count,
    componentCount,
    getScalar(index) {
      return readComponent(dataView, accessor.componentType, index * stride);
    },
    getVector(index, target) {
      const start = index * stride;
      for (let component = 0; component < componentCount; component += 1) {
        let value = readComponent(dataView, accessor.componentType, start + component * componentSize);
        if (accessor.normalized) value = normalizeComponent(value, accessor.componentType);
        target[component] = value;
      }
      return target;
    }
  };
}

function getMaterialColor(gltf, materialIndex) {
  const material = gltf.materials?.[materialIndex];
  const factor = material?.pbrMetallicRoughness?.baseColorFactor ?? [0.92, 0.96, 1, 1];
  const color = new THREE.Color(factor[0], factor[1], factor[2]);

  if (color.r + color.g + color.b < 0.26) {
    color.lerp(new THREE.Color("#8cc9ff"), 0.34);
  }

  return color;
}

async function loadImageSamplers(gltf, binary) {
  const samplers = [];

  for (const image of gltf.images ?? []) {
    if (image.bufferView === undefined) {
      samplers.push(null);
      continue;
    }

    const bufferView = gltf.bufferViews[image.bufferView];
    const byteOffset = bufferView.byteOffset ?? 0;
    const imageBuffer = binary.subarray(byteOffset, byteOffset + bufferView.byteLength);

    try {
      const { data, info } = await sharp(imageBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      samplers.push({
        width: info.width,
        height: info.height,
        pixels: data,
        sample(u, v, target) {
          const wrappedU = ((u % 1) + 1) % 1;
          const wrappedV = ((v % 1) + 1) % 1;
          const x = Math.min(info.width - 1, Math.max(0, Math.floor(wrappedU * info.width)));
          const y = Math.min(info.height - 1, Math.max(0, Math.floor((1 - wrappedV) * info.height)));
          const index = (y * info.width + x) * 4;
          const alpha = data[index + 3] / 255;

          if (alpha <= 0.02) return false;

          target.setRGB(data[index] / 255, data[index + 1] / 255, data[index + 2] / 255);
          return true;
        }
      });
    } catch {
      samplers.push(null);
    }
  }

  return samplers;
}

function getMaterialTextureSampler(gltf, imageSamplers, materialIndex) {
  const material = gltf.materials?.[materialIndex];
  const textureIndex = material?.pbrMetallicRoughness?.baseColorTexture?.index;
  const sourceIndex = textureIndex !== undefined ? gltf.textures?.[textureIndex]?.source : undefined;

  return sourceIndex !== undefined ? imageSamplers[sourceIndex] ?? null : null;
}

function getNodeLocalMatrix(node) {
  if (node.matrix) {
    return new THREE.Matrix4().fromArray(node.matrix);
  }

  const translation = new THREE.Vector3(...(node.translation ?? [0, 0, 0]));
  const rotation = new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1]));
  const scale = new THREE.Vector3(...(node.scale ?? [1, 1, 1]));
  return new THREE.Matrix4().compose(translation, rotation, scale);
}

function collectMeshInstances(gltf) {
  const instances = [];
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  const roots = scene?.nodes ?? gltf.nodes?.map((_, index) => index) ?? [];

  function visit(nodeIndex, parentMatrix) {
    const node = gltf.nodes[nodeIndex];
    const worldMatrix = parentMatrix.clone().multiply(getNodeLocalMatrix(node));

    if (node.mesh !== undefined) {
      instances.push({ meshIndex: node.mesh, matrix: worldMatrix });
    }

    for (const child of node.children ?? []) {
      visit(child, worldMatrix);
    }
  }

  for (const root of roots) {
    visit(root, new THREE.Matrix4());
  }

  return instances;
}

function getTriangleVertex(positionReader, indexReader, triangleIndex, corner, matrix, target) {
  const vertexIndex = indexReader
    ? indexReader.getScalar(triangleIndex * 3 + corner)
    : triangleIndex * 3 + corner;
  const raw = [0, 0, 0];
  positionReader.getVector(vertexIndex, raw);
  target.set(raw[0], raw[1], raw[2]).applyMatrix4(matrix);
  return vertexIndex;
}

function buildPrimitiveClouds(gltf, binary, imageSamplers) {
  const primitiveClouds = [];
  const sceneBounds = new THREE.Box3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const triangle = new THREE.Triangle();

  for (const instance of collectMeshInstances(gltf)) {
    const mesh = gltf.meshes[instance.meshIndex];

    for (const primitive of mesh.primitives ?? []) {
      if ((primitive.mode ?? 4) !== 4 || primitive.attributes.POSITION === undefined) continue;

      const positionReader = createAccessorReader(gltf, binary, primitive.attributes.POSITION);
      const indexReader = primitive.indices !== undefined ? createAccessorReader(gltf, binary, primitive.indices) : null;
      const colorReader = primitive.attributes.COLOR_0 !== undefined ? createAccessorReader(gltf, binary, primitive.attributes.COLOR_0) : null;
      const uvReader = primitive.attributes.TEXCOORD_0 !== undefined ? createAccessorReader(gltf, binary, primitive.attributes.TEXCOORD_0) : null;
      const triangleCount = Math.floor((indexReader?.count ?? positionReader.count) / 3);
      const cumulative = new Float64Array(triangleCount);
      const bounds = new THREE.Box3();
      let totalArea = 0;

      for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
        getTriangleVertex(positionReader, indexReader, triangleIndex, 0, instance.matrix, a);
        getTriangleVertex(positionReader, indexReader, triangleIndex, 1, instance.matrix, b);
        getTriangleVertex(positionReader, indexReader, triangleIndex, 2, instance.matrix, c);
        triangle.set(a, b, c);
        totalArea += triangle.getArea();
        cumulative[triangleIndex] = totalArea;
        bounds.expandByPoint(a);
        bounds.expandByPoint(b);
        bounds.expandByPoint(c);
      }

      if (totalArea > 0) {
        primitiveClouds.push({
          positionReader,
          indexReader,
          colorReader,
          uvReader,
          matrix: instance.matrix,
          materialColor: getMaterialColor(gltf, primitive.material),
          textureSampler: getMaterialTextureSampler(gltf, imageSamplers, primitive.material),
          cumulative,
          totalArea,
          bounds,
          sampleCount: 0
        });
        sceneBounds.union(bounds);
      }
    }
  }

  return { primitiveClouds, sceneBounds };
}

function allocateSamples(primitiveClouds, sceneBounds, pointCount) {
  const sceneSize = sceneBounds.getSize(new THREE.Vector3());
  const sceneMinY = sceneBounds.min.y;
  const weights = primitiveClouds.map((item) => {
    const center = item.bounds.getCenter(new THREE.Vector3());
    const size = item.bounds.getSize(new THREE.Vector3());
    const normalizedY = sceneSize.y > 0 ? (center.y - sceneMinY) / sceneSize.y : 0.5;
    const footprint = size.x * size.z;
    const sceneFootprint = Math.max(sceneSize.x * sceneSize.z, 1);
    const broadRatio = footprint / sceneFootprint;
    const isHemisphereLikeBase = normalizedY < 0.3 && broadRatio > 0.08;
    const lowerBoost = isHemisphereLikeBase ? 0.15 : normalizedY < 0.46 ? 1.22 : 1;
    const broadBoost = isHemisphereLikeBase ? 0.18 : broadRatio > 0.08 ? 1.25 : 1;

    return Math.sqrt(item.totalArea) * lowerBoost * broadBoost;
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const basePerPrimitive = Math.max(48, Math.floor(pointCount * 0.18 / Math.max(primitiveClouds.length, 1)));

  primitiveClouds.forEach((item, index) => {
    item.sampleCount = Math.max(basePerPrimitive, Math.round((weights[index] / totalWeight) * pointCount));
  });

  let allocated = primitiveClouds.reduce((sum, item) => sum + item.sampleCount, 0);
  while (allocated > pointCount) {
    const adjustable = primitiveClouds.filter((item) => item.sampleCount > basePerPrimitive).sort((a, b) => b.sampleCount - a.sampleCount)[0];
    if (!adjustable) break;

    const reduction = Math.min(adjustable.sampleCount - basePerPrimitive, allocated - pointCount);
    adjustable.sampleCount -= reduction;
    allocated -= reduction;
  }
}

function makeRandom(seed = 123456789) {
  let state = seed;

  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function findTriangle(cumulative, value) {
  let low = 0;
  let high = cumulative.length - 1;

  while (low < high) {
    const mid = (low + high) >> 1;
    if (cumulative[mid] < value) low = mid + 1;
    else high = mid;
  }

  return low;
}

function sampleCloud(primitiveClouds, pointCount) {
  const positions = new Float32Array(pointCount * 3);
  const colors = new Uint8Array(pointCount * 3);
  const random = makeRandom();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const materialColor = new THREE.Color();
  const textureColor = new THREE.Color();
  const vertexColor = [1, 1, 1, 1];
  const uvA = [0, 0];
  const uvB = [0, 0];
  const uvC = [0, 0];
  let offset = 0;

  for (const primitive of primitiveClouds) {
    for (let sample = 0; sample < primitive.sampleCount && offset < pointCount; sample += 1) {
      const triangleIndex = findTriangle(primitive.cumulative, random() * primitive.totalArea);
      const indexA = getTriangleVertex(primitive.positionReader, primitive.indexReader, triangleIndex, 0, primitive.matrix, a);
      const indexB = getTriangleVertex(primitive.positionReader, primitive.indexReader, triangleIndex, 1, primitive.matrix, b);
      const indexC = getTriangleVertex(primitive.positionReader, primitive.indexReader, triangleIndex, 2, primitive.matrix, c);
      const sqrtR1 = Math.sqrt(random());
      const r2 = random();
      const weightA = 1 - sqrtR1;
      const weightB = sqrtR1 * (1 - r2);
      const weightC = sqrtR1 * r2;
      const targetIndex = offset * 3;

      positions[targetIndex] = a.x * weightA + b.x * weightB + c.x * weightC;
      positions[targetIndex + 1] = a.y * weightA + b.y * weightB + c.y * weightC;
      positions[targetIndex + 2] = a.z * weightA + b.z * weightB + c.z * weightC;

      materialColor.copy(primitive.materialColor);
      if (primitive.textureSampler && primitive.uvReader) {
        primitive.uvReader.getVector(indexA, uvA);
        primitive.uvReader.getVector(indexB, uvB);
        primitive.uvReader.getVector(indexC, uvC);
        const u = uvA[0] * weightA + uvB[0] * weightB + uvC[0] * weightC;
        const v = uvA[1] * weightA + uvB[1] * weightB + uvC[1] * weightC;

        if (primitive.textureSampler.sample(u, v, textureColor)) {
          materialColor.multiply(textureColor);
        }
      }

      if (primitive.colorReader) {
        const colorA = [1, 1, 1, 1];
        const colorB = [1, 1, 1, 1];
        const colorC = [1, 1, 1, 1];
        primitive.colorReader.getVector(indexA, colorA);
        primitive.colorReader.getVector(indexB, colorB);
        primitive.colorReader.getVector(indexC, colorC);
        for (let component = 0; component < 3; component += 1) {
          vertexColor[component] = colorA[component] * weightA + colorB[component] * weightB + colorC[component] * weightC;
        }
        materialColor.multiply(new THREE.Color(vertexColor[0], vertexColor[1], vertexColor[2]));
      }

      if (colorMode === "cinematic") {
        const luma = materialColor.r * 0.2126 + materialColor.g * 0.7152 + materialColor.b * 0.0722;
        const contrast = 1.38;
        materialColor.setRGB(
          THREE.MathUtils.clamp((materialColor.r - 0.5) * contrast + 0.5, 0, 1),
          THREE.MathUtils.clamp((materialColor.g - 0.5) * contrast + 0.5, 0, 1),
          THREE.MathUtils.clamp((materialColor.b - 0.5) * contrast + 0.5, 0, 1)
        );
        materialColor.offsetHSL(0, 0.16, luma < 0.52 ? -0.075 : -0.025);
      }

      const subtleNoise = 0.9 + random() * 0.16;
      colors[targetIndex] = Math.min(255, Math.max(0, Math.round(materialColor.r * subtleNoise * 255)));
      colors[targetIndex + 1] = Math.min(255, Math.max(0, Math.round(materialColor.g * subtleNoise * 255)));
      colors[targetIndex + 2] = Math.min(255, Math.max(0, Math.round(materialColor.b * subtleNoise * 255)));
      offset += 1;
    }
  }

  return { positions, colors, pointCount: offset };
}

function shufflePointData(positions, colors, pointCount) {
  const random = makeRandom(987654321);

  for (let index = pointCount - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const a = index * 3;
    const b = swapIndex * 3;

    for (let component = 0; component < 3; component += 1) {
      const positionTemp = positions[a + component];
      positions[a + component] = positions[b + component];
      positions[b + component] = positionTemp;

      const colorTemp = colors[a + component];
      colors[a + component] = colors[b + component];
      colors[b + component] = colorTemp;
    }
  }
}

function makeOutputBuffer(positions, colors, pointCount) {
  const positionByteLength = pointCount * 3 * Float32Array.BYTES_PER_ELEMENT;
  const colorByteLength = pointCount * 3;
  const output = Buffer.allocUnsafe(positionByteLength + colorByteLength);
  Buffer.from(positions.buffer, positions.byteOffset, positionByteLength).copy(output, 0);
  Buffer.from(colors.buffer, colors.byteOffset, colorByteLength).copy(output, positionByteLength);
  return output;
}

const inputBuffer = await readFile(inputPath);
const { json, binary } = parseGlb(inputBuffer);
const imageSamplers = await loadImageSamplers(json, binary);
const { primitiveClouds, sceneBounds } = buildPrimitiveClouds(json, binary, imageSamplers);

if (primitiveClouds.length === 0) {
  throw new Error("No triangle mesh primitives found.");
}

allocateSamples(primitiveClouds, sceneBounds, requestedPointCount);
const sampled = sampleCloud(primitiveClouds, requestedPointCount);
shufflePointData(sampled.positions, sampled.colors, sampled.pointCount);

await mkdir(dirname(outputBase), { recursive: true });
await writeFile(`${outputBase}.bin`, makeOutputBuffer(sampled.positions, sampled.colors, sampled.pointCount));
await writeFile(`${outputBase}.json`, JSON.stringify({
  pointCount: sampled.pointCount,
  bounds: {
    min: sceneBounds.min.toArray(),
    max: sceneBounds.max.toArray()
  },
  source: inputPath
}, null, 2));

console.log(`Baked ${sampled.pointCount.toLocaleString()} points`);
console.log(`${outputBase}.json`);
console.log(`${outputBase}.bin`);
