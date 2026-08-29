// 复刻 chat-room.ts 里的 CONTROL_CHARS 正则,理由见 identity-hash.test.mjs 顶部注释。

const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", "g");

const bell = String.fromCharCode(7); // 0x07, should be stripped
const esc = String.fromCharCode(27); // 0x1B, should be stripped
const del = String.fromCharCode(127); // 0x7F, should be stripped
const tab = String.fromCharCode(9); // kept
const nl = String.fromCharCode(10); // kept
const cr = String.fromCharCode(13); // kept

const tests = [
  ["hello world", "hello world"],
  [`a${tab}b${nl}c${cr}d`, `a${tab}b${nl}c${cr}d`],
  [`x${bell}y`, "xy"],
  [`x${esc}y`, "xy"],
  [`x${del}y`, "xy"],
  ["plain", "plain"],
];

let fail = 0;
for (const [input, expected] of tests) {
  const out = input.replace(CONTROL_CHARS, "");
  const ok = out === expected;
  if (!ok) fail++;
  console.log(ok ? "ok  " : "FAIL", JSON.stringify(input), "->", JSON.stringify(out));
}
console.log(fail === 0 ? "ALL PASS" : `${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
