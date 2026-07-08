import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith("--")) args.set(process.argv[i], process.argv[i + 1]);
}

const debugBase = args.get("--debug") || "http://127.0.0.1:9222";
const pageUrl = args.get("--page-url");
const outDir = path.resolve(args.get("--out-dir") || "worker_out");
const tsDir = path.resolve(args.get("--ts-dir") || "ts_temp");
const driverPath = args.get("--driver") || "vhs_drm2.driver.js";
const mediaTagID = args.get("--media-tag-id") || "_video_player";
const resetEvery = Number(args.get("--reset-every") || 50);
const segmentStart = Number(args.get("--start") || 0);
const port = Number(args.get("--port") || 17892);

if (!pageUrl) throw new Error("Missing --page-url <CCTV page URL>");

const tsFiles = (await fsp.readdir(tsDir))
  .filter((name) => /^\d+\.ts$/i.test(name))
  .map((name) => Number(path.basename(name, ".ts")))
  .sort((a, b) => a - b);
const segmentCount = Number(args.get("--count") || (tsFiles.at(-1) - segmentStart + 1));

await fsp.rm(outDir, { recursive: true, force: true });
await fsp.mkdir(outDir, { recursive: true });

const outStreams = new Map();
const stats = {};
function outputStream(type) {
  const name = type || "unknown";
  if (!outStreams.has(name)) {
    outStreams.set(name, fs.createWriteStream(path.join(outDir, `${name}.mp4frag`)));
    stats[name] = { chunks: 0, bytes: 0 };
  }
  return outStreams.get(name);
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return void (res.writeHead(204), res.end());
  const u = new URL(req.url, `http://127.0.0.1:${port}`);
  if (req.method === "GET" && u.pathname.startsWith("/ts/")) {
    fs.createReadStream(path.join(tsDir, path.basename(u.pathname)))
      .on("error", () => {
        res.writeHead(404);
        res.end();
      })
      .pipe(res);
    return;
  }
  if (req.method === "POST" && u.pathname === "/out") {
    const type = u.searchParams.get("type") || "unknown";
    const ws = outputStream(type);
    req.on("data", (buf) => {
      stats[type].chunks++;
      stats[type].bytes += buf.length;
      ws.write(buf);
    });
    req.on("end", () => {
      res.writeHead(204);
      res.end();
    });
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const target = await (await fetch(`${debugBase}/json/new?${encodeURIComponent(pageUrl)}`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
function cdp(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

await cdp("Page.enable");
await cdp("Runtime.enable");
await new Promise((resolve) => setTimeout(resolve, 12000));

const patch = await fsp.readFile(driverPath, "utf8");
const injected = await cdp("Runtime.evaluate", {
  expression: `${patch}\n//# sourceURL=vhs_drm2.driver.injected.js\ntrue`,
  returnByValue: true,
  awaitPromise: true,
});
if (injected.exceptionDetails) throw new Error(JSON.stringify(injected.exceptionDetails, null, 2));

const driver = `
(async () => {
  if (typeof window.__CCTVWorkerFactory !== "function") throw new Error("worker factory missing");
  if (!window.__CCTVCodec) throw new Error("CCTV codec missing");
  let worker;
  async function startWorker() {
    worker = window.__CCTVWorkerFactory();
    const ready = new Promise((resolve) => {
      const prev = worker.onmessage;
      worker.onmessage = (event) => {
        if (event.data && event.data.action === "setModuleInitialized") resolve(event.data);
        if (prev) prev.call(worker, event);
      };
    });
    worker.postMessage({ action: "init", options: {
      remux: false,
      alignGopsAtEnd: false,
      keepOriginalTimestamps: true,
      loaderType: "main",
      moduleURI: "https://player.cntv.cn/h5vod/cctv.worker.js",
      mediaTagID: ${JSON.stringify(mediaTagID)}
    }});
    await ready;
  }
  await startWorker();

  function bytesFrom(value, byteOffset, byteLength) {
    if (!value) return new Uint8Array(0);
    if (value instanceof ArrayBuffer) return new Uint8Array(value, byteOffset || 0, byteLength || value.byteLength);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value.data) return bytesFrom(value.data, value.byteOffset, value.byteLength);
    return new Uint8Array(0);
  }
  function maybeDecryptVideo(type, bytes) {
    if (type !== "video" || !bytes || !bytes.byteLength) return bytes;
    return new Uint8Array(window.__CCTVCodec.getInstance().dct(bytes.slice().buffer));
  }
  async function postBytes(type, bytes) {
    if (!bytes || !bytes.byteLength) return;
    await fetch("http://127.0.0.1:${port}/out?type=" + encodeURIComponent(type || "unknown"), {
      method: "POST",
      mode: "cors",
      headers: { "content-type": "application/octet-stream" },
      body: bytes.slice().buffer
    });
  }
  async function transmuxOne(index) {
    const input = await (await fetch("http://127.0.0.1:${port}/ts/" + index + ".ts")).arrayBuffer();
    const outputs = [];
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout segment " + index)), 30000);
      worker.onmessage = (event) => {
        const d = event.data || {};
        if (d.action === "data") {
          outputs.push({ segment: d.segment, byteOffset: d.byteOffset || 0, byteLength: d.byteLength || 0 });
        } else if (d.action === "done" && d.type === "transmuxed") {
          clearTimeout(timer);
          resolve();
        }
      };
    });
    worker.postMessage({ action: "push", data: input, byteOffset: 0, byteLength: input.byteLength }, [input]);
    worker.postMessage({ action: "flush" });
    await done;
    for (const output of outputs) {
      const seg = output.segment;
      const type = seg.type || "unknown";
      const media = bytesFrom(seg.data, output.byteOffset, output.byteLength);
      const decrypted = maybeDecryptVideo(type, media);
      await postBytes(type, bytesFrom(seg.initSegment));
      await postBytes(type, decrypted);
    }
    return outputs.map((output) => {
      const seg = output.segment;
      const media = bytesFrom(seg.data, output.byteOffset, output.byteLength);
      return {
        type: seg.type,
        init: bytesFrom(seg.initSegment).byteLength,
        data: media.byteLength,
        decryptedData: maybeDecryptVideo(seg.type, media).byteLength,
        byteOffset: output.byteOffset,
        byteLength: output.byteLength
      };
    });
  }

  const result = [];
  for (let i = ${segmentStart}; i < ${segmentStart + segmentCount}; i++) {
    if (i > ${segmentStart} && ${resetEvery} > 0 && (i - ${segmentStart}) % ${resetEvery} === 0) {
      worker.terminate();
      await startWorker();
    }
    const item = await transmuxOne(i);
    result.push({ index: i, item });
    if ((i - ${segmentStart}) % 20 === 0) console.log("processed", i, item);
  }
  worker.terminate();
  return result;
})()
`;

const result = await cdp("Runtime.evaluate", {
  expression: driver,
  returnByValue: true,
  awaitPromise: true,
  userGesture: true,
});
if (result.exceptionDetails) {
  throw new Error(JSON.stringify(result.exceptionDetails, null, 2));
}

await fsp.writeFile(path.join(outDir, "segments.json"), JSON.stringify(result.result.value, null, 2));
for (const stream of outStreams.values()) {
  await new Promise((resolve) => stream.end(resolve));
}
await fsp.writeFile(path.join(outDir, "stats.json"), JSON.stringify(stats, null, 2));
server.close();
ws.close();
console.log(`processed ${result.result.value.length} segments`);
console.log(stats);
