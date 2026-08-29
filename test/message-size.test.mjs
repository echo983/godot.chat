// 复刻 chat-room.ts 里两道消息大小校验的判定逻辑,理由见 identity-hash.test.mjs
// 顶部注释。这两道关卡是为了防"二进制/超大消息灌注"跑上 Cloudflare 平台允许的
// 32 MiB 单条 WebSocket 消息上限:
//   1. 原始 JSON 字符串长度(JSON.parse 之前就拒绝,不给超大字符串任何处理机会)
//   2. 消息体里 text 字段的长度(JSON.parse 之后,聊天/私聊内容本身的长度)
// 两道关卡命中都应该是零容忍直接断开连接,不走 5 次违规才断的宽容重试策略。

const MAX_RAW_MESSAGE_BYTES = 8192;
const MAX_MESSAGE_LENGTH = 2000;

function shouldRejectRaw(raw) {
  return raw.length > MAX_RAW_MESSAGE_BYTES;
}

function shouldRejectText(text) {
  return text.length > MAX_MESSAGE_LENGTH;
}

let fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) fail++;
  console.log(ok ? "ok  " : "FAIL", name, "->", actual, ok ? "" : `(expected ${expected})`);
}

check("正常大小的消息不拒绝(原始层)", shouldRejectRaw('{"type":"chat","text":"hello"}'), false);
check("恰好等于上限不拒绝(原始层)", shouldRejectRaw("a".repeat(MAX_RAW_MESSAGE_BYTES)), false);
check("超过上限1字节就拒绝(原始层)", shouldRejectRaw("a".repeat(MAX_RAW_MESSAGE_BYTES + 1)), true);
check("模拟32MiB灌注被原始层拒绝", shouldRejectRaw("a".repeat(32 * 1024 * 1024)), true);

check("正常长度文本不拒绝", shouldRejectText("hello"), false);
check("恰好等于上限不拒绝(文本层)", shouldRejectText("a".repeat(MAX_MESSAGE_LENGTH)), false);
check("超过上限1字符就拒绝(文本层)", shouldRejectText("a".repeat(MAX_MESSAGE_LENGTH + 1)), true);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
