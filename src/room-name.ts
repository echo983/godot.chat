import { toUnicode } from "node:punycode";

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

// 中日韩文字:CJK 统一表意文字(含扩展A)、平假名、片假名、谚文音节
const CJK_RANGES = "\\u3400-\\u4dbf\\u4e00-\\u9fff\\u3040-\\u309f\\u30a0-\\u30ff\\uac00-\\ud7a3";
const ALLOWED_CHARS = new RegExp(`^[a-z0-9${CJK_RANGES}-]+$`);

export type RoomNameResult =
  | { ok: true; room: string }
  | { ok: false; reason: string };

/**
 * 房间名规则(取自 DNS label 规范并收紧):
 * - 1-12 个字符(按 Unicode 字符数,不是字节数)
 * - 仅小写字母 a-z、数字 0-9、中日韩文字、连字符 -
 * - 不能以连字符开头或结尾,不能有连续连字符
 * - 不能是保留名(品牌词、基础设施子域名)
 * - 只接受单级子域名(不允许 a.b.godot.chat)
 *
 * 浏览器发非 ASCII 域名时会自动转成 Punycode(xn-- 前缀),这里解码回原始
 * Unicode 再校验字符范围,只放行中日韩文字 + ASCII——解码失败或者是别的文字
 * (比如拿来冒充的西里尔字母)一律拒绝。这里不考虑"同形异义"攻击,因为房间没有
 * 身份验证/官方认证的概念,冒充房间名顶多是让人走错一个空房间,不构成安全问题。
 */
export function normalizeRoomName(label: string): RoomNameResult {
  if (label.length === 0) {
    return { ok: false, reason: "房间名不能为空" };
  }

  if (label.includes(".")) {
    return { ok: false, reason: "只允许一级子域名,不能是 a.b.godot.chat 这种形式" };
  }

  let room = label.toLowerCase();

  if (room.startsWith("xn--")) {
    try {
      room = toUnicode(room).normalize("NFC");
    } catch {
      return { ok: false, reason: "房间名解码失败" };
    }
  }

  const length = [...room].length;
  if (length < MIN_LENGTH || length > MAX_LENGTH) {
    return { ok: false, reason: `长度必须在 ${MIN_LENGTH}-${MAX_LENGTH} 个字符之间` };
  }

  if (!ALLOWED_CHARS.test(room)) {
    return { ok: false, reason: "只能包含小写字母、数字、中日韩文字和连字符(-)" };
  }

  if (room.startsWith("-") || room.endsWith("-")) {
    return { ok: false, reason: "不能以连字符开头或结尾" };
  }

  if (room.includes("--")) {
    return { ok: false, reason: "不能包含连续的连字符" };
  }

  if (RESERVED.has(room)) {
    return { ok: false, reason: "这是保留名称,不能用作房间名" };
  }

  return { ok: true, room };
}
