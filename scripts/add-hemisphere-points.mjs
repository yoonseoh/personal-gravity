import { readFile, writeFile } from "node:fs/promises";

function usage() {
  console.error("Usage: node scripts/add-hemisphere-points.mjs <pointDataBase> [count]");
  process.exit(1);
}

const [pointDataBase, countArg = "65000"] = process.argv.slice(2);
if (!pointDataBase) usage();

const injectCount = Math.max(1_000, Number(countArg));
if (!Number.isFinite(injectCount)) usage();
const brightness = Number(process.env.HEMISPHERE_BRIGHTNESS ?? "132");
const resolvedBrightness = Number.isFinite(brightness) ? brightness : 132;

function makeRandom(seed = 246813579) {
  let state = seed;

  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const metadata = JSON.parse(await readFile(`${pointDataBase}.json`, "utf8"));
const data = Buffer.from(await readFile(`${pointDataBase}.bin`));
const pointCount = Math.min(metadata.pointCount, injectCount);
const positionByteLength = metadata.pointCount * 3 * Float32Array.BYTES_PER_ELEMENT;
const colorOffset = positionByteLength;
const [minX, minY, minZ] = metadata.bounds.min;
const [maxX, maxY, maxZ] = metadata.bounds.max;
const centerX = (minX + maxX) / 2;
const centerZ = (minZ + maxZ) / 2;
const radiusX = (maxX - minX) * 0.49;
const radiusZ = (maxZ - minZ) * 0.49;
const height = maxY - minY;
const rimY = minY + height * 0.53;
const depth = height * 0.56;
const random = makeRandom();

for (let index = 0; index < pointCount; index += 1) {
  const targetPoint = Math.min(metadata.pointCount - 1, Math.floor((index + 0.5) * metadata.pointCount / pointCount));
  const theta = random() * Math.PI * 2;
  const radius = Math.sqrt(random());
  const x = Math.cos(theta) * radius;
  const z = Math.sin(theta) * radius;
  const lowerCurve = Math.sqrt(Math.max(0, 1 - radius * radius));
  const positionIndex = targetPoint * 12;
  const colorIndex = colorOffset + targetPoint * 3;
  const shimmer = 0.86 + random() * 0.2;
  const rimGlow = radius > 0.86 ? 1.16 : 1;
  const luma = Math.round(resolvedBrightness * shimmer * rimGlow);

  data.writeFloatLE(centerX + x * radiusX + (random() - 0.5) * 0.025, positionIndex);
  data.writeFloatLE(rimY - lowerCurve * depth + (random() - 0.5) * 0.035, positionIndex + 4);
  data.writeFloatLE(centerZ + z * radiusZ + (random() - 0.5) * 0.025, positionIndex + 8);
  data[colorIndex] = Math.min(220, Math.max(78, luma));
  data[colorIndex + 1] = Math.min(226, Math.max(82, luma + 4));
  data[colorIndex + 2] = Math.min(235, Math.max(90, luma + 12));
}

await writeFile(`${pointDataBase}.bin`, data);
console.log(`Injected ${pointCount.toLocaleString()} hemisphere points into ${pointDataBase}.bin`);
