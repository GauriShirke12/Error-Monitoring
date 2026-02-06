import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformAsync } from "@babel/core";

const currentFile = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFile), "..");
const srcFile = path.join(rootDir, "src", "index.js");
const distDir = path.join(rootDir, "dist");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

const source = await readFile(srcFile, "utf8");

const baseOptions = {
  filename: "index.js",
  presets: [["@babel/preset-env", { targets: { node: "18" } }]]
};

const esmResult = await transformAsync(source, baseOptions);
if (!esmResult?.code) {
  throw new Error("Failed to compile ESM output");
}

const cjsResult = await transformAsync(source, {
  ...baseOptions,
  plugins: [["@babel/plugin-transform-modules-commonjs", { loose: true }]]
});
if (!cjsResult?.code) {
  throw new Error("Failed to compile CJS output");
}

await writeFile(path.join(distDir, "index.js"), esmResult.code, "utf8");
await writeFile(path.join(distDir, "index.cjs"), cjsResult.code, "utf8");
