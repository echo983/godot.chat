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
check(
  "key_points 是不带分隔符的字符串,当一条保留(不再判无效,见下方专门测试)",
  parseExtraction({ title: "t", summary: "s", key_points: "a" }),
  { title: "t", summary: "s", keyPoints: ["a"] },
);
check("key_points 空数组判无效", parseExtraction({ title: "t", summary: "s", key_points: [] }), null);
check(
  "key_points 里混了非字符串元素,过滤掉",
  parseExtraction({ title: "t", summary: "s", key_points: ["a", 123, "b", null] }),
  { title: "t", summary: "s", keyPoints: ["a", "b"] },
);
check("整个不是对象判无效", parseExtraction("not an object"), null);
check("null 判无效", parseExtraction(null), null);
check("undefined 判无效", parseExtraction(undefined), null);

// 工具 schema 明确要求 key_points 是数组,但模型偶尔还是会拼成一整段字符串——
// 这是真实线上复现过的 case(直接判无效会导致本该析出的帖子静默丢失,不报错也不告警)
check(
  "key_points 是中文分号分隔的字符串,按分号拆开",
  parseExtraction({ title: "t", summary: "s", key_points: "第一点；第二点；第三点" }),
  { title: "t", summary: "s", keyPoints: ["第一点", "第二点", "第三点"] },
);
check(
  "key_points 是英文分号分隔的字符串,按分号拆开",
  parseExtraction({ title: "t", summary: "s", key_points: "point one; point two; point three" }),
  { title: "t", summary: "s", keyPoints: ["point one", "point two", "point three"] },
);
check(
  "key_points 是换行分隔的字符串,按换行拆开",
  parseExtraction({ title: "t", summary: "s", key_points: "point one\npoint two" }),
  { title: "t", summary: "s", keyPoints: ["point one", "point two"] },
);
check(
  "key_points 是没有分隔符的单个字符串,整段当一条,不丢弃",
  parseExtraction({ title: "t", summary: "s", key_points: "一整段没有分隔符的话" }),
  { title: "t", summary: "s", keyPoints: ["一整段没有分隔符的话"] },
);
check("key_points 是空字符串判无效", parseExtraction({ title: "t", summary: "s", key_points: "" }), null);
check("key_points 是数字判无效", parseExtraction({ title: "t", summary: "s", key_points: 123 }), null);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
