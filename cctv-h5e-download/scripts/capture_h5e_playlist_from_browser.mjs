import fsp from "node:fs/promises";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const pageUrl = args.get("--url");
const out = args.get("--out") || "playlist_capture.json";
const debugBase = args.get("--debug") || "http://127.0.0.1:9222";
const waitMs = Number(args.get("--wait-ms") || 25000);

if (!pageUrl) {
  throw new Error("Usage: node capture_h5e_playlist_from_browser.mjs --url <CCTV page URL> [--out playlist_capture.json]");
}

const target = await (await fetch(`${debugBase}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const urls = new Set();
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  const url = msg.params?.request?.url || msg.params?.response?.url;
  if (url && /\/asp\/h5e\/hls\/.*\.m3u8(?:$|\?)/.test(url)) urls.add(url);
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
await cdp("Network.enable");
await cdp("Page.navigate", { url: pageUrl });
await new Promise((resolve) => setTimeout(resolve, 8000));
await cdp("Runtime.evaluate", {
  expression: `(() => { const v = document.querySelector("video"); if (v) { v.muted = true; return v.play().catch(e => e.message); } return "no video"; })()`,
  awaitPromise: true,
  returnByValue: true,
  userGesture: true,
}).catch(() => {});
await new Promise((resolve) => setTimeout(resolve, Math.max(0, waitMs - 8000)));

const captured = [...urls];
const media = captured
  .filter((url) => /\/hls\/\d+\//.test(url))
  .sort((a, b) => {
    const an = Number(a.match(/\/hls\/(\d+)\//)?.[1] || 0);
    const bn = Number(b.match(/\/hls\/(\d+)\//)?.[1] || 0);
    return bn - an;
  });
const main = captured.filter((url) => /\/hls\/main\//.test(url));
const selectedMediaPlaylist = media[0] || main[0] || captured[0] || null;

const result = { pageUrl, selectedMediaPlaylist, captured };
await fsp.writeFile(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
ws.close();
