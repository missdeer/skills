import fsp from "node:fs/promises";
import path from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const outDir = path.resolve(args.get("--out-dir") || "worker_out");
const segments = JSON.parse(await fsp.readFile(path.join(outDir, "segments.json"), "utf8"));

async function cleanType(type) {
  const input = await fsp.readFile(path.join(outDir, `${type}.mp4frag`));
  const chunks = [];
  let offset = 0;
  let wroteInit = false;

  for (const segment of segments) {
    for (const item of segment.item) {
      if (item.type !== type) continue;

      if (!wroteInit && item.init) {
        chunks.push(input.subarray(offset, offset + item.init));
        wroteInit = true;
      }
      offset += item.init;

      if (item.decryptedData) {
        chunks.push(input.subarray(offset, offset + item.decryptedData));
      }
      offset += item.decryptedData;
    }
  }

  if (offset !== input.length) {
    throw new Error(`${type}: consumed ${offset} bytes, file has ${input.length}`);
  }

  const output = Buffer.concat(chunks);
  await fsp.writeFile(path.join(outDir, `${type}.clean.mp4frag`), output);
  console.log(`${type}: ${input.length} -> ${output.length}`);
}

await cleanType("video");
await cleanType("audio");
