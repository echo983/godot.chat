import { parseExtraction } from "../src/llm.ts";

let fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(ok ? "ok  " : "FAIL", name, "->", JSON.stringify(actual), ok ? "" : `(expected ${JSON.stringify(expected)})`);
}

check(
  "正常结构解析正确",
  parseExtraction({ title: " 标题 ", summary: " 摘要 ", key_points: ["a", "b"] }),
  { title: "标题", summary: "摘要", keyPoints: ["a", "b"] },
);

check("缺 title 判无效", parseExtraction({ summary: "s", key_points: ["a"] }), null);
check("缺 summary 判无效", parseExtraction({ title: "t", key_points: ["a"] }), null);
check("key_points 不是数组判无效", parseExtraction({ title: "t", summary: "s", key_points: "a" }), null);
check("key_points 空数组判无效", parseExtraction({ title: "t", summary: "s", key_points: [] }), null);
check(
  "key_points 里混了非字符串元素,过滤掉",
  parseExtraction({ title: "t", summary: "s", key_points: ["a", 123, "b", null] }),
  { title: "t", summary: "s", keyPoints: ["a", "b"] },
);
check("整个不是对象判无效", parseExtraction("not an object"), null);
check("null 判无效", parseExtraction(null), null);
check("undefined 判无效", parseExtraction(undefined), null);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
