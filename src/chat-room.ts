import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";

const MAX_MESSAGE_LENGTH = 2000;

interface ChatMessage {
  type: "message";
  id: string;
  text: string;
  ts: number;
}

/**
 * 每个房间名对应一个 ChatRoom 实例(idFromName)。
 * 当前只做实时中继,不落盘存储——历史消息的持久化和"析出帖子"是后续阶段的工作。
 */
export class ChatRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;

    const text = message.slice(0, MAX_MESSAGE_LENGTH).trim();
    if (!text) return;

    const payload: ChatMessage = {
      type: "message",
      id: crypto.randomUUID(),
      text,
      ts: Date.now(),
    };

    const encoded = JSON.stringify(payload);
    for (const socket of this.ctx.getWebSockets()) {
      socket.send(encoded);
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): Promise<void> {
    ws.close(wasClean ? code : 1011, reason);
  }
}
