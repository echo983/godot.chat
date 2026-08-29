import { normalizeRoomName } from "./room-name";
import { renderChatPage, renderLandingPage } from "./pages";
import { resolveLocale } from "./i18n";
import { ChatRoom } from "./chat-room";
import { RoomRegistry } from "./room-registry";

export { ChatRoom, RoomRegistry };

export interface Env {
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
  ROOM_REGISTRY: DurableObjectNamespace<RoomRegistry>;
}

const ROOT_DOMAIN = "godot.chat";

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "connect-src 'self' wss:; img-src 'self' https:; media-src https:; base-uri 'none'; frame-ancestors 'none'",
  "referrer-policy": "same-origin",
};

const CLIENT_ERROR_MAX_BYTES = 4096;
const CLIENT_ERROR_RATE_LIMIT_WINDOW_MS = 60_000;
const CLIENT_ERROR_RATE_LIMIT_MAX = 5;

// 按 IP 做的内存限流,只在当前 isolate 生命周期内有效,不追求全局精确——
// 这是个诊断用的轻量接口,不值得为了防刷起一个 Durable Object。isolate 被回收
// 就重置,Map 大小也做了个粗糙上限防止真被刷爆时无限增长
const clientErrorCounts = new Map<string, { count: number; windowStart: number }>();

/**
 * 前端上报的运行时错误,只 console.error 出去进 Workers Logs,不落盘存储。
 * Content-Length 检查只是提前拒绝明显超大的请求,不是严格的字节上限——
 * 这是个诊断用的轻量接口,不值得为了防少量滥用把它做复杂,但完全不设限的话
 * 任何网站都能跨站悄悄往这灌垃圾把真正的错误淹没掉,所以还是加个粗略限流。
 */
async function handleClientError(request: Request, host: string, ip: string): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > CLIENT_ERROR_MAX_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }

  const now = Date.now();
  if (clientErrorCounts.size > 5000) clientErrorCounts.clear();

  const entry = clientErrorCounts.get(ip);
  if (!entry || now - entry.windowStart > CLIENT_ERROR_RATE_LIMIT_WINDOW_MS) {
    clientErrorCounts.set(ip, { count: 1, windowStart: now });
  } else {
    entry.count++;
    if (entry.count > CLIENT_ERROR_RATE_LIMIT_MAX) {
      return new Response("Too many reports", { status: 429 });
    }
  }

  const body = await request.text();
  console.error("[client-error]", host, body.slice(0, CLIENT_ERROR_MAX_BYTES));

  return new Response(null, { status: 204 });
}

function handleRobotsTxt(host: string): Response {
  const isRoomHost = host !== ROOT_DOMAIN && host !== `www.${ROOT_DOMAIN}`;
  const body = isRoomHost ? "User-agent: *\nDisallow: /\n" : "User-agent: *\nAllow: /\n";
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();

    const locale = resolveLocale(request);
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";

    if (url.pathname === "/robots.txt") {
      return handleRobotsTxt(host);
    }

    if (url.pathname === "/client-error") {
      return handleClientError(request, host, ip);
    }

    if (host === ROOT_DOMAIN || host === `www.${ROOT_DOMAIN}`) {
      if (request.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
      }
      return new Response(renderLandingPage(locale), { headers: HTML_HEADERS });
    }

    if (!host.endsWith(`.${ROOT_DOMAIN}`)) {
      return new Response("Not found", { status: 404 });
    }

    const label = host.slice(0, -(ROOT_DOMAIN.length + 1));
    const validation = normalizeRoomName(label);

    if (!validation.ok) {
      return new Response(`Invalid room name: ${validation.reason}`, { status: 400 });
    }

    const room = validation.room;

    const registry = env.ROOM_REGISTRY.get(env.ROOM_REGISTRY.idFromName("global"));
    const { allowed } = await registry.checkRoomAccess(room, ip);
    if (!allowed) {
      return new Response("Too many new rooms created from this address — try again later", {
        status: 429,
      });
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected websocket", { status: 426 });
      }

      // 只做同源校验的软防护:非浏览器客户端可以伪造 Origin,
      // 但能挡掉最常见的"从别的网页发起跨站连接"滥用
      const origin = request.headers.get("Origin");
      if (origin !== null && origin !== `https://${host}`) {
        return new Response("Forbidden", { status: 403 });
      }

      const id = env.CHAT_ROOM.idFromName(room);
      const stub = env.CHAT_ROOM.get(id);
      return stub.fetch(request);
    }

    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    return new Response(renderChatPage(room, locale), { headers: HTML_HEADERS });
  },
} satisfies ExportedHandler<Env>;
