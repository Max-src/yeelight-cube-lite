// The JS side of tests/test_segment_length.py: each case's frames (crc32 of
// each render's 300 bytes) as the JS renderers draw them on a shorter
// segment (a Cube Matrix showing fewer columns). Reads the cases (JSON:
// [{ key, settings, renders }]) from the file named first; prints
// { key: [crc, ...] }.
//
//   node tests/segment_length_check.mjs cases.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const tests = path.dirname(fileURLToPath(import.meta.url));
const www = path.join(tests, "..", "custom_components", "yeelight_cube", "www");
const load = (name) => import(new URL(`file:///${path.join(www, name).replaceAll("\\", "/")}`));
const renderers = await load("lamp-renderers.js");

const cases = JSON.parse(fs.readFileSync(process.argv[2], "utf-8"));
const out = {};
for (const { key, settings, renders } of cases) {
  const crcs = [];
  try {
    for (const frame of renderers.exactFrames(settings, 0, renders)) crcs.push(zlib.crc32(frame) >>> 0);
  } catch (error) {
    crcs.push(`error: ${error.message}`);
  }
  out[key] = crcs;
}
process.stdout.write(JSON.stringify(out));
