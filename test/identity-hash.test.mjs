// chat-room.ts 是个 Durable Object,依赖 Workers 运行时 API(this.ctx.storage.sql 等),
// 没法在普通 Node 里直接 import 跑单测。这里复刻了 computeHashId / normalizeNickname
// 两段纯逻辑来测——改了 chat-room.ts 里对应的实现要记得同步改这里,不然测试会跟真实
// 代码脱节测不出问题。

const HASH_ID_LENGTH = 16;

async function computeHashId(secret) {
  const bytes = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, HASH_ID_LENGTH);
}

const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", "g");
const MAX_NICKNAME_LENGTH = 20;

function normalizeNickname(input) {
  if (typeof input !== "string") return null;
  const cleaned = input.replace(CONTROL_CHARS, "").trim();
  if (cleaned.length === 0 || cleaned.length > MAX_NICKNAME_LENGTH) return null;
  return cleaned;
}

let fail = 0;

// 同一个 secret 必须每次得到相同 hashId(身份可复现)
const h1 = await computeHashId("abc123");
const h2 = await computeHashId("abc123");
if (h1 !== h2) {
  fail++;
  console.log("FAIL: same secret gave different hashId", h1, h2);
} else {
  console.log("ok   same secret -> stable hashId:", h1);
}

// 不同 secret 必须得到不同 hashId(基本不会碰撞)
const h3 = await computeHashId("different-secret");
if (h3 === h1) {
  fail++;
  console.log("FAIL: different secrets collided");
} else {
  console.log("ok   different secret -> different hashId:", h3);
}

if (h1.length !== HASH_ID_LENGTH) {
  fail++;
  console.log("FAIL: hashId length wrong", h1.length);
} else {
  console.log("ok   hashId length =", h1.length);
}

// 昵称校验
const nickCases = [
  ["Alice", "Alice"],
  ["  Bob  ", "Bob"],
  ["", null],
  ["   ", null],
  ["a".repeat(20), "a".repeat(20)],
  ["a".repeat(21), null],
  [123, null],
  [null, null],
];
for (const [input, expected] of nickCases) {
  const out = normalizeNickname(input);
  const ok = out === expected;
  if (!ok) fail++;
  console.log(ok ? "ok  " : "FAIL", JSON.stringify(input), "->", JSON.stringify(out));
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
