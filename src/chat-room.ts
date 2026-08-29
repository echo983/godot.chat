import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";

const MAX_MESSAGE_LENGTH = 2000;
// Cloudflare Workers 平台本身允许单条 WebSocket 消息最大到 32 MiB——远超任何
// 合法消息(最大的合法消息是 chat/whisper,JSON 编码后也就几千字节)。在
// JSON.parse/正则处理之前就按原始字节数拒绝,不然攻击者能让我们白白吃下
// 几十 MB 的字符串处理成本才轮到后面的长度校验
const MAX_RAW_MESSAGE_BYTES = 8192;
const MAX_NICKNAME_LENGTH = 20;
const MAX_SECRET_LENGTH = 128;
const HASH_ID_LENGTH = 16; // hex chars kept server-side; UI only shows the last 4
const MAX_CONNECTIONS_PER_ROOM = 200;
const MAX_CONNECTIONS_PER_IP = 8;
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX_MESSAGES = 20;
const MAX_VIOLATIONS = 5;

// 同一身份(hashId)两条消息之间的硬冷却,按身份记在存储里,换个连接也躲不掉
const MESSAGE_COOLDOWN_MS = 5_000;

// 同一 IP 在这个窗口内出现超过这么多个不同身份,就封禁这个 IP(仅本房间)
const IDENTITY_SWITCH_WINDOW_MS = 10 * 60 * 1000;
const IDENTITY_SWITCH_THRESHOLD = 10;
const JAIL_DURATION_MS = 4 * 60 * 60 * 1000;

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

interface PresenceUser {
  hashId: string;
  nickname: string;
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
 * - 只接受文本帧,二进制帧直接断开连接;单条原始消息超过 MAX_RAW_MESSAGE_BYTES 也
 *   直接断开(在 JSON.parse 之前拒绝)——Workers 平台本身允许单条 WebSocket 消息
 *   最大 32 MiB,不能等它解析/处理完才发现该拒绝
 * - chat/whisper 的文本超过 MAX_MESSAGE_LENGTH 零容忍直接断开,不计入违规重试
 * - 昵称长度上限,超限计入违规
 * - 滑动窗口频率限制(单连接,覆盖 hello/rename/chat 全部消息类型),超限计入违规
 * - 违规次数达到上限则断开连接
 * - 单房间并发连接数上限,单 IP 并发连接数上限
 * - 未设置合法昵称前不能发言(chat 类型会被拒绝)
 * - 同一身份(hashId)发言硬冷却 MESSAGE_COOLDOWN_MS,按身份存储,换连接躲不掉
 * - 同一 IP 在 IDENTITY_SWITCH_WINDOW_MS 内切换身份超过 IDENTITY_SWITCH_THRESHOLD 次,
 *   封禁这个 IP(仅本房间)JAIL_DURATION_MS
 *
 * 在线列表按 hashId 广播(hello/rename/断线时更新)。私聊(whisper)按目标 hashId
 * 直接路由给对应连接,不落盘、不做离线补发——纯实时中继,跟公开消息共用同一套
 * 冷却/频率限制。
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

    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS identities (
        hash_id TEXT PRIMARY KEY,
        last_message_ts INTEGER NOT NULL DEFAULT 0
      )`,
    );

    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS identity_sightings (
        ip TEXT NOT NULL,
        hash_id TEXT NOT NULL,
        first_seen_ts INTEGER NOT NULL,
        PRIMARY KEY (ip, hash_id)
      )`,
    );

    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS ip_jail (
        ip TEXT PRIMARY KEY,
        jailed_until INTEGER NOT NULL
      )`,
    );
  }

  private isJailed(ip: string, now: number): boolean {
    const row = [
      ...this.ctx.storage.sql.exec<{ jailedUntil: number }>(
        "SELECT jailed_until AS jailedUntil FROM ip_jail WHERE ip = ?",
        ip,
      ),
    ][0];
    return !!row && row.jailedUntil > now;
  }

  /**
   * 记录一次"这个 IP 用了这个 hashId"。同一 (ip, hashId) 组合只算一次,
   * 重连/重复 hello 不算换身份。超过窗口期内的换身份次数阈值就封禁这个 IP,
   * 并立刻踢掉它在本房间里所有还开着的连接。返回 true 表示这个 IP 现在被封了。
   */
  private registerIdentitySwitch(ip: string, hashId: string, now: number): boolean {
    if (this.isJailed(ip, now)) return true;

    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO identity_sightings (ip, hash_id, first_seen_ts) VALUES (?, ?, ?)",
      ip,
      hashId,
      now,
    );

    const windowStart = now - IDENTITY_SWITCH_WINDOW_MS;
    this.ctx.storage.sql.exec("DELETE FROM identity_sightings WHERE first_seen_ts < ?", windowStart);

    const countRow = [
      ...this.ctx.storage.sql.exec<{ n: number }>(
        "SELECT COUNT(*) AS n FROM identity_sightings WHERE ip = ?",
        ip,
      ),
    ][0];

    if (!countRow || countRow.n <= IDENTITY_SWITCH_THRESHOLD) {
      return false;
    }

    const jailedUntil = now + JAIL_DURATION_MS;
    this.ctx.storage.sql.exec(
      `INSERT INTO ip_jail (ip, jailed_until) VALUES (?, ?)
       ON CONFLICT(ip) DO UPDATE SET jailed_until = excluded.jailed_until`,
      ip,
      jailedUntil,
    );

    for (const socket of this.ctx.getWebSockets()) {
      if (readState(socket)?.ip !== ip) continue;
      socket.send(JSON.stringify({ type: "error", code: "jailed" }));
      socket.close(1008, "too many identity switches");
    }

    return true;
  }

  /** 未过冷却返回 true(可以发言)。只读,不更新——发送成功后要单独调用 touchCooldown。 */
  private checkCooldown(hashId: string, now: number): boolean {
    const row = [
      ...this.ctx.storage.sql.exec<{ lastTs: number }>(
        "SELECT last_message_ts AS lastTs FROM identities WHERE hash_id = ?",
        hashId,
      ),
    ][0];
    return !row || now - row.lastTs >= MESSAGE_COOLDOWN_MS;
  }

  private touchCooldown(hashId: string, now: number): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO identities (hash_id, last_message_ts) VALUES (?, ?)
       ON CONFLICT(hash_id) DO UPDATE SET last_message_ts = excluded.last_message_ts`,
      hashId,
      now,
    );
  }

  /** 按 hashId 去重(同一个人开多个标签页只算一次在线) */
  private getPresenceUsers(): PresenceUser[] {
    const seen = new Map<string, string>();
    for (const socket of this.ctx.getWebSockets()) {
      const s = readState(socket);
      if (s?.hashId && s.nickname) seen.set(s.hashId, s.nickname);
    }
    return [...seen].map(([hashId, nickname]) => ({ hashId, nickname }));
  }

  private broadcastPresence(): void {
    const encoded = JSON.stringify({ type: "presence", users: this.getPresenceUsers() });
    for (const socket of this.ctx.getWebSockets()) {
      socket.send(encoded);
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

    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (this.isJailed(ip, Date.now())) {
      return new Response("Too many identity switches from this address — try again later", {
        status: 429,
      });
    }

    const sockets = this.ctx.getWebSockets();
    if (sockets.length >= MAX_CONNECTIONS_PER_ROOM) {
      return new Response("Room is full", { status: 503 });
    }

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
    server.send(JSON.stringify({ type: "presence", users: this.getPresenceUsers() }));

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") {
      // 合法前端只会发文本帧;二进制帧视为非法客户端,直接断开
      ws.close(1003, "binary frames are not allowed");
      return;
    }

    if (raw.length > MAX_RAW_MESSAGE_BYTES) {
      // 在 JSON.parse 之前就拒绝,不给超大消息任何被解析/处理的机会
      ws.close(1009, "message too large");
      return;
    }

    const state = readState(ws);
    if (!state) {
      ws.close(1011, "missing connection state");
      return;
    }

    const now = Date.now();

    if (this.isJailed(state.ip, now)) {
      ws.send(JSON.stringify({ type: "error", code: "jailed" }));
      ws.close(1008, "too many identity switches");
      return;
    }

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
        const hashId = await computeHashId(secret);
        if (this.registerIdentitySwitch(state.ip, hashId, now)) {
          // 已经在 registerIdentitySwitch 里把这个 IP 的连接都关了,这里不用再处理
          return;
        }
        state.hashId = hashId;
        const nickname = normalizeNickname(msg.nickname);
        if (nickname) state.nickname = nickname;
        writeState(ws, state);
        ws.send(JSON.stringify({ type: "identity", hashId: state.hashId, nickname: state.nickname }));
        this.broadcastPresence();
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
        this.broadcastPresence();
        return;
      }

      case "chat": {
        if (!state.hashId || !state.nickname) {
          writeState(ws, state);
          ws.send(JSON.stringify({ type: "error", code: "nickname_required" }));
          return;
        }

        const text = typeof msg.text === "string" ? msg.text : "";

        // 先查原始长度再清洗——没必要先在超长字符串上跑一遍正则才发现要拒绝。
        // 超长消息没有正常客户端会触发,零容忍直接断开,不走 5 次违规才断的宽容策略
        if (text.length > MAX_MESSAGE_LENGTH) {
          ws.close(1009, "message too long");
          return;
        }

        const cleaned = text.replace(CONTROL_CHARS, "");
        writeState(ws, state);

        const trimmed = cleaned.trim();
        if (!trimmed) return;

        if (!this.checkCooldown(state.hashId, now)) {
          ws.send(JSON.stringify({ type: "error", code: "cooldown" }));
          return;
        }

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
        this.touchCooldown(payload.hashId, payload.ts);

        const encoded = JSON.stringify({ type: "message", ...payload });
        for (const socket of this.ctx.getWebSockets()) {
          socket.send(encoded);
        }
        return;
      }

      case "whisper": {
        if (!state.hashId || !state.nickname) {
          writeState(ws, state);
          ws.send(JSON.stringify({ type: "error", code: "nickname_required" }));
          return;
        }

        const targetHashId = typeof msg.to === "string" ? msg.to : "";
        const text = typeof msg.text === "string" ? msg.text : "";

        // 先查原始长度再清洗,理由同 chat 分支
        if (text.length > MAX_MESSAGE_LENGTH) {
          ws.close(1009, "message too long");
          return;
        }

        const cleaned = text.replace(CONTROL_CHARS, "");
        writeState(ws, state);

        const trimmed = cleaned.trim();
        if (!trimmed || !targetHashId) return;

        if (targetHashId === state.hashId) {
          ws.send(JSON.stringify({ type: "error", code: "whisper_self" }));
          return;
        }

        if (!this.checkCooldown(state.hashId, now)) {
          ws.send(JSON.stringify({ type: "error", code: "cooldown" }));
          return;
        }

        const targets = this.ctx.getWebSockets().filter((s) => readState(s)?.hashId === targetHashId);
        if (targets.length === 0) {
          ws.send(JSON.stringify({ type: "error", code: "whisper_offline" }));
          return;
        }

        this.touchCooldown(state.hashId, now);

        // 私聊不落盘,纯实时中继——离线就是收不到,不做补发
        const encoded = JSON.stringify({
          type: "whisper",
          id: crypto.randomUUID(),
          text: trimmed,
          ts: now,
          fromHashId: state.hashId,
          fromNickname: state.nickname,
          toHashId: targetHashId,
        });

        for (const socket of targets) socket.send(encoded);
        // 回显给发送者自己的所有连接(多标签页也能看到自己发的私聊)
        for (const socket of this.ctx.getWebSockets()) {
          if (readState(socket)?.hashId === state.hashId) socket.send(encoded);
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
    this.broadcastPresence();
  }
}
