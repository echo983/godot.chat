import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_NICKNAME_LENGTH = 20;
const MAX_SECRET_LENGTH = 128;
const HASH_ID_LENGTH = 16; // hex chars kept server-side; UI only shows the last 4
const MAX_CONNECTIONS_PER_ROOM = 200;
const MAX_CONNECTIONS_PER_IP = 8;
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX_MESSAGES = 20;
const MAX_VIOLATIONS = 5;

// 每个房间只保留最近这么多条——先兜住存储量,不是最终的结晶/结石分类机制
const MAX_STORED_MESSAGES = 1000;
// 每批历史消息的条数,初次连接和向上翻页懒加载都用这个
const PAGE_SIZE = 50;

// C0 控制字符,保留 \t \n \r,其余(含 DEL)一律剔除
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", "g");

interface StoredMessage {
  id: string;
  text: string;
  ts: number;
  nickname: string;
  hashId: string;
}

interface HistoryRow {
  seq: number;
  id: string;
  text: string;
  ts: number;
  nickname: string;
  hashId: string;
  [key: string]: SqlStorageValue;
}

interface ConnState {
  ip: string;
  hashId: string | null;
  nickname: string | null;
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

function normalizeNickname(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input.replace(CONTROL_CHARS, "").trim();
  if (cleaned.length === 0 || cleaned.length > MAX_NICKNAME_LENGTH) return null;
  return cleaned;
}

/**
 * hashid 必须由服务端根据客户端提交的 secret 计算,不能信任客户端自称的 hashid——
 * 否则任何人复制别人消息里公开的 hash 字符串就能冒充。secret 只在这条已加密的
 * WebSocket 连接上传一次,从不出现在广播消息里,别人拿不到也就算不出同样的 hash。
 */
async function computeHashId(secret: string): Promise<string> {
  const bytes = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, HASH_ID_LENGTH);
}

/**
 * 每个房间名对应一个 ChatRoom 实例(idFromName)。
 * 消息落在 DO 自带的 SQLite storage 里,只保留最近 MAX_STORED_MESSAGES 条。
 * "结晶/结石/矿渣/化石"的分类与生命周期是后续阶段,这里先做一个简单的滚动上限。
 *
 * 防滥用边界:
 * - 只接受文本帧,二进制帧直接断开连接
 * - 单条消息/昵称长度上限,超限计入违规
 * - 滑动窗口频率限制(单连接,覆盖 hello/rename/chat 全部消息类型),超限计入违规
 * - 违规次数达到上限则断开连接
 * - 单房间并发连接数上限,单 IP 并发连接数上限
 * - 未设置合法昵称前不能发言(chat 类型会被拒绝)
 */
export class ChatRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL,
        text TEXT NOT NULL,
        ts INTEGER NOT NULL,
        nickname TEXT NOT NULL DEFAULT '',
        hash_id TEXT NOT NULL DEFAULT ''
      )`,
    );

    // 兼容这次改动之前就已经建表的房间(newyork/apple 这些测试房间)
    const cols = [...this.ctx.storage.sql.exec("PRAGMA table_info(messages)")].map(
      (row) => (row as { name: string }).name,
    );
    if (!cols.includes("nickname")) {
      this.ctx.storage.sql.exec("ALTER TABLE messages ADD COLUMN nickname TEXT NOT NULL DEFAULT ''");
    }
    if (!cols.includes("hash_id")) {
      this.ctx.storage.sql.exec("ALTER TABLE messages ADD COLUMN hash_id TEXT NOT NULL DEFAULT ''");
    }
  }

  /**
   * beforeSeq 为 null 时取最新一页(初次连接);否则取该序号之前的一页(向上翻页懒加载)。
   * 多取一条来判断是否还有更早的消息,避免额外一次往返。
   */
  private fetchHistoryPage(beforeSeq: number | null): { messages: HistoryRow[]; hasMore: boolean } {
    const rows =
      beforeSeq === null
        ? [
            ...this.ctx.storage.sql.exec<HistoryRow>(
              "SELECT seq, id, text, ts, nickname, hash_id AS hashId FROM messages ORDER BY seq DESC LIMIT ?",
              PAGE_SIZE + 1,
            ),
          ]
        : [
            ...this.ctx.storage.sql.exec<HistoryRow>(
              "SELECT seq, id, text, ts, nickname, hash_id AS hashId FROM messages WHERE seq < ? ORDER BY seq DESC LIMIT ?",
              beforeSeq,
              PAGE_SIZE + 1,
            ),
          ];

    const hasMore = rows.length > PAGE_SIZE;
    const messages = rows.slice(0, PAGE_SIZE).reverse();
    return { messages, hasMore };
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
    writeState(server, {
      ip,
      hashId: null,
      nickname: null,
      violations: 0,
      windowStart: Date.now(),
      windowCount: 0,
    });

    const { messages, hasMore } = this.fetchHistoryPage(null);
    server.send(JSON.stringify({ type: "history", messages, hasMore }));

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") {
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

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.flagViolation(ws, state, "invalid json");
      return;
    }

    if (typeof parsed !== "object" || parsed === null || typeof (parsed as { type?: unknown }).type !== "string") {
      this.flagViolation(ws, state, "malformed message");
      return;
    }

    const msg = parsed as Record<string, unknown>;

    switch (msg.type) {
      case "hello": {
        const secret = typeof msg.secret === "string" ? msg.secret.slice(0, MAX_SECRET_LENGTH) : "";
        if (!secret) {
          this.flagViolation(ws, state, "missing secret");
          return;
        }
        state.hashId = await computeHashId(secret);
        const nickname = normalizeNickname(msg.nickname);
        if (nickname) state.nickname = nickname;
        writeState(ws, state);
        ws.send(JSON.stringify({ type: "identity", hashId: state.hashId, nickname: state.nickname }));
        return;
      }

      case "rename": {
        if (!state.hashId) {
          this.flagViolation(ws, state, "hello first");
          return;
        }
        const nickname = normalizeNickname(msg.nickname);
        if (!nickname) {
          writeState(ws, state);
          ws.send(JSON.stringify({ type: "error", code: "nickname_invalid" }));
          return;
        }
        state.nickname = nickname;
        writeState(ws, state);
        ws.send(JSON.stringify({ type: "identity", hashId: state.hashId, nickname: state.nickname }));
        return;
      }

      case "chat": {
        if (!state.hashId || !state.nickname) {
          writeState(ws, state);
          ws.send(JSON.stringify({ type: "error", code: "nickname_required" }));
          return;
        }

        const text = typeof msg.text === "string" ? msg.text : "";
        const cleaned = text.replace(CONTROL_CHARS, "");

        if (cleaned.length > MAX_MESSAGE_LENGTH) {
          this.flagViolation(ws, state, "message too long");
          return;
        }

        writeState(ws, state);

        const trimmed = cleaned.trim();
        if (!trimmed) return;

        const payload: StoredMessage = {
          id: crypto.randomUUID(),
          text: trimmed,
          ts: now,
          nickname: state.nickname,
          hashId: state.hashId,
        };

        this.ctx.storage.sql.exec(
          "INSERT INTO messages (id, text, ts, nickname, hash_id) VALUES (?, ?, ?, ?, ?)",
          payload.id,
          payload.text,
          payload.ts,
          payload.nickname,
          payload.hashId,
        );
        this.ctx.storage.sql.exec(
          `DELETE FROM messages WHERE seq NOT IN (
             SELECT seq FROM messages ORDER BY seq DESC LIMIT ?
           )`,
          MAX_STORED_MESSAGES,
        );

        const encoded = JSON.stringify({ type: "message", ...payload });
        for (const socket of this.ctx.getWebSockets()) {
          socket.send(encoded);
        }
        return;
      }

      case "history_before": {
        const before = msg.before;
        if (typeof before !== "number" || !Number.isInteger(before) || before < 0) {
          this.flagViolation(ws, state, "invalid history cursor");
          return;
        }
        writeState(ws, state);
        const { messages, hasMore } = this.fetchHistoryPage(before);
        ws.send(JSON.stringify({ type: "history_before", messages, hasMore }));
        return;
      }

      default:
        this.flagViolation(ws, state, "unknown message type");
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
