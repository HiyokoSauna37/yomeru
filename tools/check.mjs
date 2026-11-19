// 全 JS の構文チェック（content scripts は classic script として、他は module として）
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const classic = new Set(manifest.content_scripts.flatMap(({ js = [] }) => js.map((path) => join(root, path))));
const skip = new Set(["node_modules", "tmp", "scratch"]);

function* scripts(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name) || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* scripts(path);
    else if (entry.isFile() && /\.m?js$/.test(entry.name)) yield path;
  }
}

console.log("✓ manifest.json");
for (const file of new Set([...classic, ...scripts(root)])) {
  const name = relative(root, file);
  try {
    if (classic.has(file)) {
      // 拡張がページに注入する順序と対象は manifest が決める。
      new Script(readFileSync(file, "utf8"), { filename: name });
    } else {
      const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
      if (result.status !== 0) throw result.error || new Error(result.stderr.trim() || result.signal);
    }
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}\n${error.message}`);
    process.exitCode = 1;
  }
}
