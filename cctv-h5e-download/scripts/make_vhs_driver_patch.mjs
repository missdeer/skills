import fsp from "node:fs/promises";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const input = args.get("--input") || "vhs_drm2.min.js";
const output = args.get("--output") || "vhs_drm2.driver.js";

let code = await fsp.readFile(input, "utf8");

const workerNeedle = "bi=gi(_i),Ti=function";
if (!code.includes(workerNeedle)) {
  throw new Error(`Cannot find worker factory needle: ${workerNeedle}`);
}
code = code.replace(workerNeedle, "bi=(self.__CCTVWorkerFactory=gi(_i)),Ti=function");

let exposedCodec = false;
for (const needle of ["Object.freeze(a),a}(),_i=function", "Object.freeze(a),a}(),en=function"]) {
  if (code.includes(needle)) {
    code = code.replace(needle, "Object.freeze(a),self.__CCTVCodec=a,a}()," + needle.split("}(),")[1]);
    exposedCodec = true;
    break;
  }
}
if (!exposedCodec) {
  throw new Error("Cannot expose CCTV codec object; inspect vhs_drm2.min.js structure.");
}

await fsp.writeFile(output, code);
console.log(`wrote ${output}`);
