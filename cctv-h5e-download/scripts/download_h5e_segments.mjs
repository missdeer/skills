import fsp from "node:fs/promises";
import path from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const playlistUrl = args.get("--playlist");
const outDir = path.resolve(args.get("--out-dir") || "ts_temp");
const concurrency = Number(args.get("--concurrency") || 8);

if (!playlistUrl) {
  throw new Error("Usage: node download_h5e_segments.mjs --playlist <m3u8-url> [--out-dir ts_temp]");
}

await fsp.mkdir(outDir, { recursive: true });

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return await res.text();
}

function absolutize(base, value) {
  return new URL(value.trim(), base).toString();
}

function parseVariant(master, base) {
  const lines = master.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
    const bandwidth = Number(lines[i].match(/BANDWIDTH=(\d+)/)?.[1] || 0);
    const next = lines.slice(i + 1).find((line) => !line.startsWith("#"));
    if (next) variants.push({ bandwidth, url: absolutize(base, next) });
  }
  variants.sort((a, b) => b.bandwidth - a.bandwidth);
  return variants[0]?.url;
}

let mediaUrl = playlistUrl;
let text = await fetchText(mediaUrl);
const variant = parseVariant(text, mediaUrl);
if (variant) {
  mediaUrl = variant;
  text = await fetchText(mediaUrl);
}

const tsUrls = text
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => absolutize(mediaUrl, line))
  .filter((url) => /\.ts(?:$|\?)/i.test(url));

if (!tsUrls.length) throw new Error(`No TS segments found in ${mediaUrl}`);

await fsp.writeFile(path.join(outDir, "media.m3u8"), text);
await fsp.writeFile(path.join(outDir, "segments.json"), JSON.stringify({ mediaUrl, tsUrls }, null, 2));

let cursor = 0;
async function worker() {
  for (;;) {
    const index = cursor++;
    if (index >= tsUrls.length) return;
    const url = tsUrls[index];
    const name = path.basename(new URL(url).pathname) || `${index}.ts`;
    const file = path.join(outDir, name);
    try {
      await fsp.access(file);
      console.log(`skip ${index}/${tsUrls.length}: ${name}`);
      continue;
    } catch {}
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    await fsp.writeFile(file, Buffer.from(await res.arrayBuffer()));
    console.log(`downloaded ${index + 1}/${tsUrls.length}: ${name}`);
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
console.log(`downloaded ${tsUrls.length} segments to ${outDir}`);
