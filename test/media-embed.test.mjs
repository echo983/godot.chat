// 复刻 pages.ts 里 classifyMediaUrl / renderMessageContent 的分段逻辑,
// 用简单数组模拟 DOM container,不依赖真实 DOM。这段逻辑活在 pages.ts 的
// <script> 模板字符串里没法直接 import——改了那边记得同步改这里,并且优先
// 跑一遍 `npm run check:pages`,那个工具专门抓这类模板字符串转义被吃掉的问题
// (2026-08-29 的 SyntaxError 事故就是这么发现的)。

const URL_RE = /https?:\/\/[^\s<>"']+/g;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/i;
const VIDEO_EXT = /\.(mp4|webm|ogg|ogv|mov)$/i;

function classifyMediaUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (IMAGE_EXT.test(parsed.pathname)) return "image";
  if (VIDEO_EXT.test(parsed.pathname)) return "video";
  return null;
}

// container 是数组,每项是 {type:'text', value} 或 {type:'img'|'video', src}
function renderMessageContent(container, text) {
  URL_RE.lastIndex = 0;
  let lastIndex = 0;
  let match;
  while ((match = URL_RE.exec(text)) !== null) {
    let url = match[0];
    let end = match.index + url.length;

    const trailing = /[.,;:!?)\]}'"]+$/.exec(url);
    if (trailing) {
      url = url.slice(0, url.length - trailing[0].length);
      end -= trailing[0].length;
    }

    if (match.index > lastIndex) {
      container.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }

    const kind = classifyMediaUrl(url);
    if (kind === "image") {
      container.push({ type: "img", src: url });
    } else if (kind === "video") {
      container.push({ type: "video", src: url });
    } else {
      container.push({ type: "text", value: url });
    }

    lastIndex = end;
  }
  if (lastIndex < text.length) {
    container.push({ type: "text", value: text.slice(lastIndex) });
  }
}

let fail = 0;
function check(name, text, expected) {
  const out = [];
  renderMessageContent(out, text);
  const ok = JSON.stringify(out) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(ok ? "ok  " : "FAIL", name);
  if (!ok) {
    console.log("     got:", JSON.stringify(out));
    console.log("     exp:", JSON.stringify(expected));
  }
}

check(
  "纯文本无链接",
  "hello world",
  [{ type: "text", value: "hello world" }],
);

check(
  "单独一张图片链接",
  "https://example.com/cat.jpg",
  [{ type: "img", src: "https://example.com/cat.jpg" }],
);

check(
  "文字+图片链接混排",
  "look at this https://example.com/cat.png cool right",
  [
    { type: "text", value: "look at this " },
    { type: "img", src: "https://example.com/cat.png" },
    { type: "text", value: " cool right" },
  ],
);

check(
  "句尾标点不应该算进链接里",
  "check this out: https://example.com/cat.jpg.",
  [
    { type: "text", value: "check this out: " },
    { type: "img", src: "https://example.com/cat.jpg" },
    { type: "text", value: "." },
  ],
);

check(
  "视频扩展名识别",
  "https://example.com/clip.mp4",
  [{ type: "video", src: "https://example.com/clip.mp4" }],
);

check(
  "带查询字符串的图片链接",
  "https://example.com/cat.jpg?w=800&h=600",
  [{ type: "img", src: "https://example.com/cat.jpg?w=800&h=600" }],
);

check(
  "没有识别扩展名的链接保持纯文本",
  "https://example.com/some/page",
  [{ type: "text", value: "https://example.com/some/page" }],
);

check(
  "非 http(s) 协议不当媒体处理",
  "javascript:alert(1)//fake.jpg",
  [{ type: "text", value: "javascript:alert(1)//fake.jpg" }],
);

check(
  "大写扩展名也能识别",
  "https://example.com/cat.PNG",
  [{ type: "img", src: "https://example.com/cat.PNG" }],
);

check(
  "同一条消息里多个链接",
  "a https://x.com/1.jpg b https://x.com/2.mp4 c",
  [
    { type: "text", value: "a " },
    { type: "img", src: "https://x.com/1.jpg" },
    { type: "text", value: " b " },
    { type: "video", src: "https://x.com/2.mp4" },
    { type: "text", value: " c" },
  ],
);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
