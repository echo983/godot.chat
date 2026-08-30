import { normalizeRoomName } from "./room-name";
import { renderChatPage, renderLandingPage, renderPostsPage } from "./pages";
import { resolveLocale } from "./i18n";
import { readBodyCapped } from "./body-utils";
import { createRateLimiter } from "./rate-limit";
import { ChatRoom } from "./chat-room";
import { RoomRegistry } from "./room-registry";

export { ChatRoom, RoomRegistry };

export interface Env {
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
  ROOM_REGISTRY: DurableObjectNamespace<RoomRegistry>;
  ROOT_DOMAIN: string;
  AI: Ai;
}

// 正式上线前不想让裸域名被扫到/探测到——先把 apex/www 一律 404,房间子域名不受影响
// (该怎么用还怎么用,只是没有"入口页")。正式开放的时候把这个改回 false。
const HIDE_LANDING_PAGE = true;

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "connect-src 'self' wss:; img-src 'self' https:; media-src https:; base-uri 'none'; frame-ancestors 'none'",
  "referrer-policy": "same-origin",
};

const CLIENT_ERROR_MAX_BYTES = 4096;

const isClientErrorRateLimited = createRateLimiter({ windowMs: 60_000, max: 5, maxTrackedKeys: 5000 });

// 挡在 RoomRegistry/ChatRoom 之前的第一道门——页面加载(GET)和 WS 握手尝试之前
// 完全没有速率限制:MAX_CONNECTIONS_PER_IP 只管"同时开着几个连接",不管"每秒
// 发起几次连接尝试",脚本可以疯狂开连接立刻断开来绕过它,每次尝试还都会打到
// 全站唯一的 RoomRegistry(拖慢所有房间的注册表查询)和渲染整页 HTML。
// 60/10秒(平均每秒6次)够正常刷新/重连用,挡不住脚本式高频请求。
const isGeneralRateLimited = createRateLimiter({ windowMs: 10_000, max: 60 });

/**
 * 前端上报的运行时错误,只 console.error 出去进 Workers Logs,不落盘存储。
 * 这是个诊断用的轻量接口,不值得为了防少量滥用把它做复杂,但完全不设限的话
 * 任何网站都能跨站悄悄往这灌垃圾把真正的错误淹没掉,所以还是加个粗略限流,
 * 大小限制则靠 readBodyCapped 边读边拦,不信任客户端自报的 Content-Length。
 */
async function handleClientError(request: Request, host: string, ip: string): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (isClientErrorRateLimited(ip, Date.now())) {
    return new Response("Too many reports", { status: 429 });
  }

  const body = await readBodyCapped(request, CLIENT_ERROR_MAX_BYTES);
  if (body === null) {
    return new Response("Payload too large", { status: 413 });
  }

  console.error("[client-error]", host, body);

  return new Response(null, { status: 204 });
}

function handleRobotsTxt(host: string, rootDomain: string): Response {
  // 非生产环境(staging 等)一律禁止收录,不区分 apex 还是房间子域名
  const isProduction = rootDomain === "godot.chat";
  const isRoomHost = host !== rootDomain && host !== `www.${rootDomain}`;
  const disallow = !isProduction || isRoomHost;
  const body = disallow ? "User-agent: *\nDisallow: /\n" : "User-agent: *\nAllow: /\n";
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    const rootDomain = env.ROOT_DOMAIN;
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";

    if (isGeneralRateLimited(ip, Date.now())) {
      return new Response("Too many requests", { status: 429 });
    }

    const isLandingHost = host === rootDomain || host === `www.${rootDomain}`;
    if (HIDE_LANDING_PAGE && isLandingHost) {
      return new Response("Not found", { status: 404 });
    }

    const locale = resolveLocale(request);

    if (url.pathname === "/robots.txt") {
      return handleRobotsTxt(host, rootDomain);
    }

    if (url.pathname === "/client-error") {
      return handleClientError(request, host, ip);
    }

    if (isLandingHost) {
      if (request.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
      }
      return new Response(renderLandingPage(locale, rootDomain), { headers: HTML_HEADERS });
    }

    if (!host.endsWith(`.${rootDomain}`)) {
      return new Response("Not found", { status: 404 });
    }

    const label = host.slice(0, -(rootDomain.length + 1));
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

    if (url.pathname === "/posts") {
      const id = env.CHAT_ROOM.idFromName(room);
      const stub = env.CHAT_ROOM.get(id);
      const posts = await stub.listPosts();
      return new Response(renderPostsPage(room, locale, rootDomain, posts), { headers: HTML_HEADERS });
    }

    return new Response(renderChatPage(room, locale, rootDomain), { headers: HTML_HEADERS });
  },
} satisfies ExportedHandler<Env>;
