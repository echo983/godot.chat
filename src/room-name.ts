const MIN_LENGTH = 1;
const MAX_LENGTH = 12;

// 品牌/基础设施相关的保留名,不能被用作房间名
const RESERVED = new Set([
  "www", "api", "admin", "root", "mail", "smtp", "ftp",
  "ns1", "ns2", "cdn", "static", "assets", "img", "images",
  "media", "ws", "wss", "socket", "app", "status", "docs", "doc",
  "help", "support", "blog", "dashboard", "login", "signup", "signin",
  "auth", "oauth", "cloud", "cf", "cloudflare", "godot", "chat",
  "test", "dev", "staging", "prod", "internal", "private",
  "secure", "security", "about", "terms", "privacy", "legal",
  "billing", "pay", "payment", "store", "shop", "mx", "autodiscover",
]);

export type RoomNameResult =
  | { ok: true; room: string }
  | { ok: false; reason: string };

/**
 * 房间名规则(取自 DNS label 规范并收紧):
 * - 1-12 个字符
 * - 仅小写字母 a-z、数字 0-9、连字符 -
 * - 不能以连字符开头或结尾,不能有连续连字符
 * - 不能是 xn-- 开头(避免 punycode/同形异义攻击)
 * - 不能是保留名(品牌词、基础设施子域名)
 * - 只接受单级子域名(不允许 a.b.godot.chat)
 */
export function normalizeRoomName(label: string): RoomNameResult {
  if (label.length === 0) {
    return { ok: false, reason: "房间名不能为空" };
  }

  if (label.includes(".")) {
    return { ok: false, reason: "只允许一级子域名,不能是 a.b.godot.chat 这种形式" };
  }

  const room = label.toLowerCase();

  if (room.length < MIN_LENGTH || room.length > MAX_LENGTH) {
    return { ok: false, reason: `长度必须在 ${MIN_LENGTH}-${MAX_LENGTH} 个字符之间` };
  }

  if (!/^[a-z0-9-]+$/.test(room)) {
    return { ok: false, reason: "只能包含小写字母、数字和连字符(-)" };
  }

  if (room.startsWith("-") || room.endsWith("-")) {
    return { ok: false, reason: "不能以连字符开头或结尾" };
  }

  if (room.includes("--")) {
    return { ok: false, reason: "不能包含连续的连字符" };
  }

  if (room.startsWith("xn--")) {
    return { ok: false, reason: "不允许 punycode 前缀" };
  }

  if (RESERVED.has(room)) {
    return { ok: false, reason: "这是保留名称,不能用作房间名" };
  }

  return { ok: true, room };
}
