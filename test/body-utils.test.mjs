import { readBodyCapped } from "../src/body-utils.ts";

function requestWithBody(text) {
  return new Request("https://newyork.godot.chat/client-error", {
    method: "POST",
    body: text,
  });
}

// 一个每次只吐一小块的流,模拟慢速/分块传输——确保是真的边读边数,
// 不是只检查了一次性到手的完整 body
function requestWithChunkedBody(chunks) {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
  return new Request("https://newyork.godot.chat/client-error", {
    method: "POST",
    body: stream,
    duplex: "half",
  });
}

let fail = 0;
async function check(name, actual, expected) {
  const resolved = await actual;
  const ok = resolved === expected;
  if (!ok) fail++;
  console.log(ok ? "ok  " : "FAIL", name, "->", JSON.stringify(resolved), ok ? "" : `(expected ${JSON.stringify(expected)})`);
}

await check("正常大小的 body 原样返回", readBodyCapped(requestWithBody("hello"), 100), "hello");
await check("恰好等于上限不拒绝", readBodyCapped(requestWithBody("a".repeat(100)), 100), "a".repeat(100));
await check("超过上限返回 null", readBodyCapped(requestWithBody("a".repeat(101)), 100), null);
await check("分块传输,总量超限也能拦下来", readBodyCapped(requestWithChunkedBody(["aaaa", "aaaa", "aaaa"]), 10), null);
await check("分块传输,总量不超限正常拼回原文", readBodyCapped(requestWithChunkedBody(["hel", "lo", " world"]), 100), "hello world");
await check("空 body 返回空字符串", readBodyCapped(requestWithBody(""), 100), "");

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
