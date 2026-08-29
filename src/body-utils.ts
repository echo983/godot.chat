/**
 * 按字节数上限流式读取请求体,超限立刻取消底层流并返回 null——不信任
 * Content-Length(客户端可以不带或者谎报成很小),真正边读边数,不会因为
 * 一个精心构造的大 body 就被迫把整个 body 缓冲下来。
 *
 * 单独拆成这个文件(不放 index.ts)是因为这里不依赖任何 Workers 专属 API
 * (只用了标准的 Request/ReadableStream/TextDecoder),这样能在普通 Node
 * 里直接 import 测试,不会像 index.ts 那样因为顶部 import 了 chat-room.ts/
 * room-registry.ts(依赖 cloudflare:workers)而没法在 Node 里加载。
 */
export async function readBodyCapped(request: Request, maxBytes: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buf);
}
