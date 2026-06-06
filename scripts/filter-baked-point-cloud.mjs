import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function usage() {
  console.error("Usage: node scripts/filter-baked-point-cloud.mjs <inputBase> <outputBase> <axis> <min> <max>");
  process.exit(1);
}

const [inputBase, outputBase, axisArg, minArg, maxArg] = process.argv.slice(2);
if (!inputBase || !outputBase || !axisArg || minArg === undefined || maxArg === undefined) usage();

const axisIndex = { x: 0, y: 1, z: 2 }[axisArg];
const minValue = Number(minArg);
const maxValue = Number(maxArg);
if (axisIndex === undefined || !Number.isFinite(minValue) || !Number.isFinite(maxValue)) usage();

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
  const value = positions[pointIndex * 3 + axisIndex];
  if (value < minValue || value > maxValue) continue;

  keptIndices.push(pointIndex);
  for (let component = 0; component < 3; component += 1) {
    const componentValue = positions[pointIndex * 3 + component];
    boundsMin[component] = Math.min(boundsMin[component], componentValue);
    boundsMax[component] = Math.max(boundsMax[component], componentValue);
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
    axis: axisArg,
    min: minValue,
    max: maxValue,
    sourcePointCount: pointCount
  }
}, null, 2));

console.log(`Kept ${keptIndices.length.toLocaleString()} / ${pointCount.toLocaleString()} points`);
