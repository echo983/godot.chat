import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_CONNECTIONS_PER_ROOM = 200;
const MAX_CONNECTIONS_PER_IP = 8;
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX_MESSAGES = 20;
const MAX_VIOLATIONS = 5;

// 每个房间只保留最近这么多条——先兜住存储量,不是最终的结晶/结石分类机制
const MAX_STORED_MESSAGES = 200;
// 新连接进来时回放的历史条数
const HISTORY_LIMIT = 50;

// C0 控制字符,保留 \t \n \r,其余(含 DEL)一律剔除
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", "g");

interface ChatMessage {
  type: "message";
  id: string;
  text: string;
  ts: number;
}

interface HistoryPayload {
  type: "history";
  messages: Array<{ id: string; text: string; ts: number }>;
}

interface ConnState {
  ip: string;
  violations: number;
  windowStart: number;
  windowCount: number;
}

function readState(ws: WebSocket): ConnState | null {
  return ws.deserializeAttachment() as ConnState | null;
}

function writeState(ws: WebSocket, state: ConnState): void {
  ws.serializeAttachment(state);
}

/**
 * 每个房间名对应一个 ChatRoom 实例(idFromName)。
 * 消息落在 DO 自带的 SQLite storage 里,只保留最近 MAX_STORED_MESSAGES 条。
 * "结晶/结石/矿渣/化石"的分类与生命周期是后续阶段,这里先做一个简单的滚动上限。
 *
 * 防滥用边界:
 * - 只接受文本帧,二进制帧直接断开连接
 * - 单条消息长度上限,超限计入违规
 * - 滑动窗口频率限制(单连接),超限计入违规
 * - 违规次数达到上限则断开连接
 * - 单房间并发连接数上限,单 IP 并发连接数上限
 */
export class ChatRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL,
        text TEXT NOT NULL,
        ts INTEGER NOT NULL
      )`,
    );
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const sockets = this.ctx.getWebSockets();
    if (sockets.length >= MAX_CONNECTIONS_PER_ROOM) {
      return new Response("Room is full", { status: 503 });
    }

    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const sameIpCount = sockets.filter((s) => readState(s)?.ip === ip).length;
    if (sameIpCount >= MAX_CONNECTIONS_PER_IP) {
      return new Response("Too many connections from this address", { status: 429 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    writeState(server, { ip, violations: 0, windowStart: Date.now(), windowCount: 0 });

    const rows = [
      ...this.ctx.storage.sql.exec<{ id: string; text: string; ts: number }>(
        "SELECT id, text, ts FROM messages ORDER BY seq DESC LIMIT ?",
        HISTORY_LIMIT,
      ),
    ].reverse();

    const history: HistoryPayload = { type: "history", messages: rows };
    server.send(JSON.stringify(history));

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") {
      // 合法前端只会发文本帧;二进制帧视为非法客户端,直接断开
      ws.close(1003, "binary frames are not allowed");
      return;
    }

    const state = readState(ws);
    if (!state) {
      ws.close(1011, "missing connection state");
      return;
    }

    const now = Date.now();

    if (now - state.windowStart > RATE_LIMIT_WINDOW_MS) {
      state.windowStart = now;
      state.windowCount = 0;
    }
    state.windowCount++;

    if (state.windowCount > RATE_LIMIT_MAX_MESSAGES) {
      this.flagViolation(ws, state, "rate limit exceeded");
      return;
    }

    const cleaned = message.replace(CONTROL_CHARS, "");

    if (cleaned.length > MAX_MESSAGE_LENGTH) {
      this.flagViolation(ws, state, "message too long");
      return;
    }

    writeState(ws, state);

    const text = cleaned.trim();
    if (!text) return;

    const payload: ChatMessage = {
      type: "message",
      id: crypto.randomUUID(),
      text,
      ts: now,
    };

    this.ctx.storage.sql.exec(
      "INSERT INTO messages (id, text, ts) VALUES (?, ?, ?)",
      payload.id,
      payload.text,
      payload.ts,
    );
    this.ctx.storage.sql.exec(
      `DELETE FROM messages WHERE seq NOT IN (
         SELECT seq FROM messages ORDER BY seq DESC LIMIT ?
       )`,
      MAX_STORED_MESSAGES,
    );

    const encoded = JSON.stringify(payload);
    for (const socket of this.ctx.getWebSockets()) {
      socket.send(encoded);
    }
  }

  private flagViolation(ws: WebSocket, state: ConnState, reason: string): void {
    state.violations++;
    if (state.violations >= MAX_VIOLATIONS) {
      ws.close(1008, `policy violation: ${reason}`);
      return;
    }
    writeState(ws, state);
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
