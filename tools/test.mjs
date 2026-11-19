// 各スイートを別プロセスで実行し、失敗した時点で止める。
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const suites = {
  unit: [
    "api-unit",
    "backend-services",
    "google-docs-unit",
    "subtitles-unit",
    "subtitle-timeline",
    "image-unit",
    "image-layout",
  ],
  browser: [
    "providers",
    "explanation-cancel",
    "youtube-extraction",
    "e2e",
    "google-docs",
    "explanation",
    "youtube",
    "image",
    "ad-exclusion",
  ],
};

const group = process.argv[2];
if (group && !Object.hasOwn(suites, group)) {
  console.error("使い方: node tools/test.mjs [unit|browser]");
  process.exit(2);
}

const cwd = fileURLToPath(new URL("../", import.meta.url));
for (const suite of group ? suites[group] : Object.values(suites).flat()) {
  const file = `tests/${suite}.mjs`;
  console.log(`\n${file}`);
  const result = spawnSync(process.execPath, [file], { cwd, stdio: "inherit" });
  if (result.status === 0) continue;
  if (result.error || result.signal) console.error(result.error || `終了シグナル: ${result.signal}`);
  process.exit(result.status ?? 1);
}
