#!/usr/bin/env node
// 依次跑 test/ 目录下所有 *.test.mjs,汇总结果。--experimental-strip-types 对纯 JS
// 文件是无害的(只在真的有 TS 语法时才生效),所以统一加上,方便直接 import .ts 源码
// 的那几个测试(room-name / i18n)不用单独处理。

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(__dirname)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort();

let failed = 0;

for (const file of files) {
  console.log(`\n--- ${file} ---`);
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-deprecation", path.join(__dirname, file)],
    { stdio: "inherit" },
  );
  if (result.status !== 0) failed++;
}

console.log(failed === 0 ? `\nALL ${files.length} TEST FILES PASSED` : `\n${failed}/${files.length} TEST FILES FAILED`);
process.exit(failed === 0 ? 0 : 1);
