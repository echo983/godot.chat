#!/usr/bin/env node
// 校验 pages.ts 里嵌入的 <script> 内容,用真实渲染出来的页面(带真实的多语言文案),
// 而不是拿占位符替换 ${...} 之后再查语法——占位符替换测不出模板字符串自己的转义
// 处理把嵌入 JS 里的正则表达式转义符吃掉这种问题(2026-08-29 就因为这个上过一次线上
// SyntaxError:`\/`、`\s`、`\.`、`\]` 在外层模板字符串解析时被当成未识别转义,
// 反斜杠被丢弃,渲染出来的正则字面量就坏了)。
//
// 用法: node scripts/render-and-check.mjs

import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(__dirname, "..", "src", "pages.ts");

const result = await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});

const code = result.outputFiles[0].text;
const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

const locales = ["en", "es", "zh-Hans", "zh-Hant"];
let failed = 0;

function checkScript(html, label) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (scripts.length === 0) {
    console.log("FAIL", label, "- no <script> blocks found");
    failed++;
    return;
  }
  for (let i = 0; i < scripts.length; i++) {
    try {
      new Function(scripts[i]);
      console.log("ok  ", label, `[script ${i + 1}/${scripts.length}]`);
    } catch (e) {
      console.log("FAIL", label, `[script ${i + 1}/${scripts.length}] -`, e.message);
      failed++;
    }
  }
}

// 第二个域名纯粹是为了验证 rootDomain 参数化没有退化回硬编码
// "godot.chat"——不代表真的部署了别的环境
const rootDomains = ["godot.chat", "example.test"];

for (const locale of locales) {
  for (const rootDomain of rootDomains) {
    checkScript(mod.renderChatPage("newyork", locale, rootDomain), `chat page (${locale}, ${rootDomain})`);
  }
}
for (const locale of locales) {
  for (const rootDomain of rootDomains) {
    checkScript(mod.renderLandingPage(locale, rootDomain), `landing page (${locale}, ${rootDomain})`);
  }
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
