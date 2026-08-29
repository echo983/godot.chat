import { normalizeRoomName } from "../src/room-name.ts";

const cases = [
  // [输入的原始 label(浏览器发来的是 punycode 编码后的), 期望 ok, 期望的 room]
  ["xn--xhqpn", true, "东京"], // 东京
  ["xn--wcvs22d", true, "教育"], // 教育
  ["xn--p8jau0izg", true, "とうきょう"], // 日语平假名
  ["xn--2i4bq6h", true, "서울"], // 韩语
  ["xn--2026-kd5fx3a", true, "东京2026"], // 中英数字混合
  ["xn--a-7sb", false], // 西里尔字母homograph,不在CJK+ASCII白名单内,应拒绝
  ["xn--4gqaixc61cqke2e304bua337ck4n", false], // 13个汉字,超长
  ["xn--this-is-not-valid-punycode!!!", false], // 解码失败
  // 原有 ASCII 行为不应该被破坏
  ["newyork", true, "newyork"],
  ["Apple", true, "apple"],
  ["www", false],
  ["-abc", false],
  ["ab--cd", false],
  ["bad_name", false],
];

let failed = 0;
for (const [input, expectOk, expectRoom] of cases) {
  const r = normalizeRoomName(input);
  const ok = r.ok === expectOk && (!expectOk || r.room === expectRoom);
  if (!ok) {
    failed++;
    console.log("FAIL", JSON.stringify(input), "->", r);
  } else {
    console.log("ok  ", JSON.stringify(input), "->", r.ok ? r.room : r.reason);
  }
}
console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
