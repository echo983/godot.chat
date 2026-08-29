import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";

// 10 分钟内最多创建这么多个新房间,超出后这个 IP 被禁止"开新房间"这个动作 24 小时。
// 已经存在的房间不受影响,随时能进——限制的是"从无到有"这个动作本身。
const CREATE_WINDOW_MS = 10 * 60 * 1000;
const CREATE_THRESHOLD = 10;
const CREATE_BAN_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * 全站唯一一个实例(用固定名字 idFromName("global") 寻址),记录"哪些房间名
 * 已经被创建过"和"每个 IP 最近开了多少个新房间"。这两件事天然是跨房间共享的
 * 状态,单个房间自己的 ChatRoom 存储互相不知道对方的存在,所以必须单独拆出
 * 一个 Durable Object,不能塞进 ChatRoom 里。
 *
 * 全站只有这一个实例意味着所有房间的"是否新建"判定会在这里排队处理——
 * 对现在的规模完全够用,真到了需要分片的流量量级再说。
 */
export class RoomRegistry extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS known_rooms (
        room TEXT PRIMARY KEY,
        created_ts INTEGER NOT NULL
      )`,
    );
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS creation_events (
        ip TEXT NOT NULL,
        room TEXT NOT NULL,
        ts INTEGER NOT NULL,
        PRIMARY KEY (ip, room)
      )`,
    );
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS creation_ban (
        ip TEXT PRIMARY KEY,
        banned_until INTEGER NOT NULL
      )`,
    );
  }

  /**
   * 已存在的房间永远放行,不受这套限制影响。房间是新的的话:
   * 先看这个 IP 有没有被 ban;没被 ban 就看窗口期内已经开了几个新房间,
   * 达到阈值就拒绝这次并且开始 ban,没达到阈值就放行并记账。
   */
  async checkRoomAccess(room: string, ip: string): Promise<{ allowed: boolean }> {
    const now = Date.now();

    const known = [
      ...this.ctx.storage.sql.exec<{ room: string }>("SELECT room FROM known_rooms WHERE room = ?", room),
    ][0];
    if (known) return { allowed: true };

    const banRow = [
      ...this.ctx.storage.sql.exec<{ bannedUntil: number }>(
        "SELECT banned_until AS bannedUntil FROM creation_ban WHERE ip = ?",
        ip,
      ),
    ][0];
    if (banRow && banRow.bannedUntil > now) {
      return { allowed: false };
    }

    const windowStart = now - CREATE_WINDOW_MS;
    this.ctx.storage.sql.exec("DELETE FROM creation_events WHERE ts < ?", windowStart);

    const countRow = [
      ...this.ctx.storage.sql.exec<{ n: number }>(
        "SELECT COUNT(*) AS n FROM creation_events WHERE ip = ?",
        ip,
      ),
    ][0];

    if (countRow && countRow.n >= CREATE_THRESHOLD) {
      this.ctx.storage.sql.exec(
        `INSERT INTO creation_ban (ip, banned_until) VALUES (?, ?)
         ON CONFLICT(ip) DO UPDATE SET banned_until = excluded.banned_until`,
        ip,
        now + CREATE_BAN_DURATION_MS,
      );
      return { allowed: false };
    }

    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO known_rooms (room, created_ts) VALUES (?, ?)",
      room,
      now,
    );
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO creation_events (ip, room, ts) VALUES (?, ?, ?)",
      ip,
      room,
      now,
    );

    return { allowed: true };
  }
}
