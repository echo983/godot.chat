import { normalizeRoomName } from "./room-name";
import { renderChatPage, renderLandingPage } from "./pages";
import { ChatRoom } from "./chat-room";

export { ChatRoom };

export interface Env {
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
}

const ROOT_DOMAIN = "godot.chat";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();

    if (host === ROOT_DOMAIN || host === `www.${ROOT_DOMAIN}`) {
      return new Response(renderLandingPage(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
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
      const id = env.CHAT_ROOM.idFromName(room);
      const stub = env.CHAT_ROOM.get(id);
      return stub.fetch(request);
    }

    return new Response(renderChatPage(room), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
} satisfies ExportedHandler<Env>;
