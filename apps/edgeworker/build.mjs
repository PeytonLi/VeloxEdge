import { build } from "esbuild";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(rootDir, "dist");
const bundlePath = path.join(distDir, "bundle.tgz");
const NULL_CHAR = String.fromCharCode(0);

function writeString(buffer, offset, length, value) {
  buffer.write(String(value).slice(0, length), offset, length, "ascii");
}

function octal(value, length) {
  const text = Math.floor(value).toString(8);
  return text.padStart(length - 1, "0").slice(-(length - 1)) + NULL_CHAR;
}

function tarHeader(name, contentLength) {
  const header = Buffer.alloc(512, 0);
  writeString(header, 0, 100, name);
  writeString(header, 100, 8, octal(0o644, 8));
  writeString(header, 108, 8, octal(0, 8));
  writeString(header, 116, 8, octal(0, 8));
  writeString(header, 124, 12, octal(contentLength, 12));
  writeString(header, 136, 12, octal(Date.now() / 1000, 12));
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeString(header, 257, 6, "ustar");
  writeString(header, 263, 2, "00");

  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeString(header, 148, 6, checksum.toString(8).padStart(6, "0"));
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

async function createTarGz(entries, outputPath) {
  const chunks = [];

  for (const entry of entries) {
    const content = await readFile(entry.source);
    chunks.push(tarHeader(entry.name, content.length));
    chunks.push(content);

    const padding = (512 - (content.length % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding, 0));
  }

  chunks.push(Buffer.alloc(1024, 0));
  await writeFile(outputPath, gzipSync(Buffer.concat(chunks)));
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await build({
  entryPoints: [path.join(rootDir, "src/main.js")],
  outfile: path.join(distDir, "main.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  external: [
    "create-response",
    "./edgekv.js",
    "./edgekv_tokens.js",
    "../edgekv.js",
    "../edgekv_tokens.js",
  ],
});

await copyFile(path.join(rootDir, "bundle.json"), path.join(distDir, "bundle.json"));
await copyFile(path.join(rootDir, "edgekv.js"), path.join(distDir, "edgekv.js"));
await writeFile(
  path.join(distDir, "edgekv_tokens.js"),
  "// Build-time placeholder. Replace with the Akamai-generated edgekv_tokens.js for deployment.\nexport default {};\n",
);

await createTarGz(
  [
    { name: "bundle.json", source: path.join(distDir, "bundle.json") },
    { name: "main.js", source: path.join(distDir, "main.js") },
    { name: "edgekv.js", source: path.join(distDir, "edgekv.js") },
    { name: "edgekv_tokens.js", source: path.join(distDir, "edgekv_tokens.js") },
  ],
  bundlePath,
);

console.log(`Wrote ${path.relative(rootDir, bundlePath)}`);
