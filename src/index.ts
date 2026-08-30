import { normalizeRoomName } from "./room-name";
import { renderChatPage, renderLandingPage, renderPostsPage } from "./pages";
import { resolveLocale } from "./i18n";
import { readBodyCapped } from "./body-utils";
import { createRateLimiter } from "./rate-limit";
import { ChatRoom, computeHashId, MAX_SECRET_LENGTH } from "./chat-room";
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
const VOTE_MAX_BYTES = 256;
const VOTE_PATH_RE = /^\/posts\/([^/]+)\/vote$/;

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

/**
 * 帖子投票——好/坏都行,允许改主意(castVote 是 upsert),不做撤回。走普通
 * POST 而不是 WS:帖子页本来就没有 WS 连接,为了这一个低频动作专门起一条
 * WS 连接不划算。身份复用聊天室那套 secret→hashId 机制,不是另起一套。
 */
async function handleVote(
  request: Request,
  env: Env,
  host: string,
  room: string,
  postId: string,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // 跟 /ws 一样只做同源软防护
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== `https://${host}`) {
    return new Response("Forbidden", { status: 403 });
  }

  const body = await readBodyCapped(request, VOTE_MAX_BYTES);
  if (body === null) {
    return new Response("Payload too large", { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const obj = parsed as Record<string, unknown>;
  const secret = typeof obj.secret === "string" ? obj.secret.slice(0, MAX_SECRET_LENGTH) : "";
  const vote = obj.vote;
  if (!secret || (vote !== "good" && vote !== "bad")) {
    return new Response("Invalid vote", { status: 400 });
  }

  const hashId = await computeHashId(secret);
  const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(room));
  const result = await stub.castVote(postId, hashId, vote);

  if (!result) {
    return new Response("Post not found", { status: 404 });
  }

  return new Response(JSON.stringify(result), {
    headers: { "content-type": "application/json" },
  });
}

/**
 * 每周固定 GC 的分发入口:从 RoomRegistry 拿"值得唤醒去检查"的房间名(已经按
 * 创建时间过滤掉了不可能有帖子出观察期的太新房间,见 RoomRegistry.listRoomsForGc),
 * 逐个房间发 RPC 触发各自的 runWeeklyGc()。这里只做分发,真正的清算在各房间
 * 自己的 DO 里跑,避免重蹈 RoomRegistry 曾经当过全站唯一瓶颈的覆辙。单个房间
 * 失败不中断整体扫描。
 */
async function runWeeklyGcSweep(env: Env): Promise<void> {
  const registry = env.ROOM_REGISTRY.get(env.ROOM_REGISTRY.idFromName("global"));
  const rooms = await registry.listRoomsForGc(Date.now());
  console.log(`[gc] weekly sweep starting for ${rooms.length} rooms`);

  let totalDeleted = 0;
  for (const room of rooms) {
    try {
      const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(room));
      const { deletedCount } = await stub.runWeeklyGc();
      totalDeleted += deletedCount;
    } catch (err) {
      console.error(`[gc] room "${room}" failed`, err);
    }
  }

  console.log(`[gc] weekly sweep done: ${rooms.length} rooms, ${totalDeleted} posts deleted`);
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

    const voteMatch = VOTE_PATH_RE.exec(url.pathname);
    if (voteMatch) {
      return handleVote(request, env, host, room, voteMatch[1]);
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

    const chatRoomId = env.CHAT_ROOM.idFromName(room);
    const chatRoomStub = env.CHAT_ROOM.get(chatRoomId);
    const postsCount = await chatRoomStub.countPosts();
    return new Response(renderChatPage(room, locale, rootDomain, postsCount), { headers: HTML_HEADERS });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runWeeklyGcSweep(env));
  },
} satisfies ExportedHandler<Env>;
