import { normalizeRoomName } from "./room-name";
import { renderChatPage, renderLandingPage } from "./pages";
import { resolveLocale } from "./i18n";
import { ChatRoom } from "./chat-room";

export { ChatRoom };

export interface Env {
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
}

const ROOT_DOMAIN = "godot.chat";

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "connect-src 'self' wss:; img-src 'self' https://api.dicebear.com; base-uri 'none'; frame-ancestors 'none'",
  "referrer-policy": "same-origin",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();

    const locale = resolveLocale(request);

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
