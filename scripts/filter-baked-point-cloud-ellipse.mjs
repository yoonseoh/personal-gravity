import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function usage() {
  console.error("Usage: node scripts/filter-baked-point-cloud-ellipse.mjs <inputBase> <outputBase> <centerX> <centerZ> <radiusX> <radiusZ> [feather]");
  process.exit(1);
}

const [inputBase, outputBase, centerXArg, centerZArg, radiusXArg, radiusZArg, featherArg = "1"] = process.argv.slice(2);
if (!inputBase || !outputBase || !centerXArg || !centerZArg || !radiusXArg || !radiusZArg) usage();

const centerX = Number(centerXArg);
const centerZ = Number(centerZArg);
const radiusX = Number(radiusXArg);
const radiusZ = Number(radiusZArg);
const feather = Number(featherArg);
if (![centerX, centerZ, radiusX, radiusZ, feather].every(Number.isFinite)) usage();

const metadata = JSON.parse(await readFile(`${inputBase}.json`, "utf8"));
const data = await readFile(`${inputBase}.bin`);
const pointCount = metadata.pointCount;
const positionByteLength = pointCount * 3 * Float32Array.BYTES_PER_ELEMENT;
const positions = new Float32Array(data.buffer, data.byteOffset, pointCount * 3);
const colors = new Uint8Array(data.buffer, data.byteOffset + positionByteLength, pointCount * 3);
const keptIndices = [];
const boundsMin = [Infinity, Infinity, Infinity];
const boundsMax = [-Infinity, -Infinity, -Infinity];

for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
  const baseIndex = pointIndex * 3;
  const x = positions[baseIndex];
  const z = positions[baseIndex + 2];
  const normalized =
    ((x - centerX) * (x - centerX)) / (radiusX * radiusX) +
    ((z - centerZ) * (z - centerZ)) / (radiusZ * radiusZ);

  if (normalized > feather) continue;

  keptIndices.push(pointIndex);
  for (let component = 0; component < 3; component += 1) {
    const value = positions[baseIndex + component];
    boundsMin[component] = Math.min(boundsMin[component], value);
    boundsMax[component] = Math.max(boundsMax[component], value);
  }
}

const nextPositions = new Float32Array(keptIndices.length * 3);
const nextColors = new Uint8Array(keptIndices.length * 3);

keptIndices.forEach((sourceIndex, targetIndex) => {
  for (let component = 0; component < 3; component += 1) {
    nextPositions[targetIndex * 3 + component] = positions[sourceIndex * 3 + component];
    nextColors[targetIndex * 3 + component] = colors[sourceIndex * 3 + component];
  }
});

const nextPositionByteLength = nextPositions.length * Float32Array.BYTES_PER_ELEMENT;
const output = Buffer.allocUnsafe(nextPositionByteLength + nextColors.length);
Buffer.from(nextPositions.buffer).copy(output, 0);
Buffer.from(nextColors.buffer).copy(output, nextPositionByteLength);

await mkdir(dirname(outputBase), { recursive: true });
await writeFile(`${outputBase}.bin`, output);
await writeFile(`${outputBase}.json`, JSON.stringify({
  ...metadata,
  pointCount: keptIndices.length,
  bounds: {
    min: boundsMin,
    max: boundsMax
  },
  filter: {
    type: "xz-ellipse",
    centerX,
    centerZ,
    radiusX,
    radiusZ,
    feather,
    sourcePointCount: pointCount
  }
}, null, 2));

console.log(`Kept ${keptIndices.length.toLocaleString()} / ${pointCount.toLocaleString()} points`);
