import { LOCALE_LABELS, SUPPORTED_LOCALES, t, type Locale } from "./i18n";
import type { PostSummary, PostSourceMessage } from "./chat-room";
import { isGoodPost, isInGracePeriod, graceDaysRemaining, gcProgress } from "./gc-time";

// posts 的标题/摘要/要点来自 LLM 输出,不可信——渲染进服务端拼出来的 HTML 之前
// 必须转义,跟聊天消息文本经 textContent/DOM API 渲染(天然转义)不一样
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderLangSwitcher(locale: Locale): string {
  const options = SUPPORTED_LOCALES.map(
    (code) =>
      `<option value="${code}"${code === locale ? " selected" : ""}>${LOCALE_LABELS[code]}</option>`,
  ).join("");
  return `<select id="langSelect" aria-label="Language">${options}</select>`;
}

// 防止翻译文案里万一出现 "</script>" 之类的片段把内联脚本标签截断
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

// 独立的一小段脚本,必须放在主脚本之前:这样哪怕主脚本本身有语法错误导致整个
// <script> 解析失败,这个监听器也已经提前注册好了,还是能把错误报回来——
// 上次那次 SyntaxError 就是主脚本自己挂了,写在同一个 <script> 里的错误上报
// 会跟着一起失效,起不到作用。
const ERROR_REPORTER_SCRIPT = `
<script>
window.addEventListener('error', function (e) {
  try {
    navigator.sendBeacon('/client-error', JSON.stringify({
      message: e.message,
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      stack: e.error && e.error.stack,
      url: location.href
    }));
  } catch (ignored) {}
});
window.addEventListener('unhandledrejection', function (e) {
  try {
    var reason = e.reason;
    navigator.sendBeacon('/client-error', JSON.stringify({
      message: 'unhandledrejection: ' + (reason && reason.message ? reason.message : String(reason)),
      stack: reason && reason.stack,
      url: location.href
    }));
  } catch (ignored) {}
});
</script>
`;

// 聊天气泡 emoji 的内联 SVG favicon,base64 编码避免 emoji 直接写进 data URI 需要
// 处理的 URL 转义问题,不用额外起一个静态资源路由
const FAVICON_LINK =
  '<link rel="icon" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48dGV4dCB5PSIuOWVtIiBmb250LXNpemU9IjkwIj7wn5KsPC90ZXh0Pjwvc3ZnPg==">';

// staging 环境用 rootDomain 区分(比如 staging.godot.chat),cookie 的作用域必须
// 跟着环境走——不然 staging 写的语言 cookie 会因为 domain=.godot.chat 覆盖到生产,
// 反过来也一样
function langSwitchScript(rootDomain: string): string {
  return `
document.getElementById('langSelect').addEventListener('change', (e) => {
  document.cookie = 'lang=' + e.target.value + '; domain=.${rootDomain}; path=/; max-age=31536000; samesite=lax';
  location.reload();
});
`;
}

export function renderLandingPage(locale: Locale, rootDomain: string): string {
  const m = t(locale).landing;
  const indexable = rootDomain === "godot.chat";
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${rootDomain}</title>
${FAVICON_LINK}
${indexable ? "" : '<meta name="robots" content="noindex, nofollow">\n'}<meta property="og:type" content="website">
<meta property="og:title" content="${rootDomain}">
<meta property="og:description" content="${m.intro}">
<meta property="og:url" content="https://${rootDomain}/">
<style>
  body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1.5rem; color: #1a1a1a; }
  nav { display: flex; justify-content: flex-end; }
  code { background: #f2f2f2; padding: 0.15em 0.4em; border-radius: 4px; }
  form { margin-top: 2rem; display: flex; gap: 0.5rem; }
  input { flex: 1; padding: 0.6em 0.8em; font-size: 1rem; border: 1px solid #ccc; border-radius: 6px; }
  button { padding: 0.6em 1.2em; font-size: 1rem; border: none; border-radius: 6px; background: #1a1a1a; color: #fff; cursor: pointer; }
  select { padding: 0.3em 0.5em; border-radius: 6px; border: 1px solid #ccc; }
</style>
</head>
<body>
  <nav>${renderLangSwitcher(locale)}</nav>
  <h1>${rootDomain}</h1>
  <p>${m.intro}</p>
  <form id="go">
    <input id="room" placeholder="${m.roomPlaceholder}" maxlength="12" autocomplete="off">
    <button type="submit">${m.enterButton}</button>
  </form>
  ${ERROR_REPORTER_SCRIPT}
  <script>
    document.getElementById('go').addEventListener('submit', (e) => {
      e.preventDefault();
      const room = document.getElementById('room').value.trim().toLowerCase();
      if (!room) return;
      window.location.href = 'https://' + room + '.${rootDomain}/';
    });
    ${langSwitchScript(rootDomain)}
  </script>
</body>
</html>`;
}

export function renderChatPage(room: string, locale: Locale, rootDomain: string, postsCount: number): string {
  const messages = t(locale);
  const m = messages.chat;
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${room}.${rootDomain}</title>
${FAVICON_LINK}
<meta name="robots" content="noindex, nofollow">
<meta property="og:type" content="website">
<meta property="og:title" content="#${room}">
<meta property="og:description" content="${m.ogDescription.replace('{room}', room)}">
<meta property="og:url" content="https://${room}.${rootDomain}/">
<style>
  body { font-family: system-ui, sans-serif; margin: 0; display: flex; flex-direction: column; height: 100vh; color: #1a1a1a; }
  header { padding: 0.8rem 1rem; border-bottom: 1px solid #eee; font-weight: 600; display: flex; align-items: center; gap: 0.5rem; }
  header .room { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #onlineBtn { font-size: 0.8rem; font-weight: 400; color: #555; cursor: pointer; flex-shrink: 0; }
  #postsLink { font-size: 0.8rem; font-weight: 400; color: #555; text-decoration: none; flex-shrink: 0; }
  #postsLink:hover { text-decoration: underline; }
  #me { display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; font-weight: 400; color: #555; cursor: pointer; flex-shrink: 0; max-width: 8rem; }
  #me img { width: 20px; height: 20px; border-radius: 50%; background: #eee; flex-shrink: 0; }
  #me span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  select { padding: 0.3em 0.5em; border-radius: 6px; border: 1px solid #ccc; font-size: 0.8rem; flex-shrink: 0; }
  .chat-body { position: relative; flex: 1; min-height: 0; }
  #log { position: absolute; inset: 0; overflow-y: auto; padding: 1rem; display: flex; flex-direction: column; gap: 0.6rem; }
  .day-sep { align-self: center; font-size: 0.75rem; color: #888; background: #f2f2f2; padding: 0.2em 0.9em; border-radius: 999px; margin: 0.3rem 0; }
  .row { display: flex; gap: 0.5rem; align-items: flex-end; }
  .row.mine { flex-direction: row-reverse; }
  .row > img { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; background: #eee; }
  .bubble { max-width: 70%; }
  .who { font-size: 0.75rem; color: #999; margin-bottom: 0.15rem; }
  .row.mine .who { text-align: right; }
  .msg { padding: 0.5em 0.8em; background: #f2f2f2; border-radius: 8px; word-break: break-word; white-space: pre-wrap; }
  .row.mine .msg { background: #dbeafe; }
  .msg-media { display: block; max-width: 100%; max-height: 20rem; border-radius: 8px; margin-top: 0.4rem; }
  form { display: flex; gap: 0.5rem; padding: 0.8rem; border-top: 1px solid #eee; }
  input { flex: 1; padding: 0.6em 0.8em; font-size: 1rem; border: 1px solid #ccc; border-radius: 6px; }
  #text { flex: 1; padding: 0.6em 0.8em; font-size: 1rem; font-family: inherit; line-height: 1.4; border: 1px solid #ccc; border-radius: 6px; resize: none; max-height: 7.5rem; overflow-y: auto; }
  button { padding: 0.6em 1.2em; font-size: 1rem; border: none; border-radius: 6px; background: #1a1a1a; color: #fff; cursor: pointer; align-self: flex-end; }
  button:disabled { background: #ccc; cursor: not-allowed; }
  #status {
    position: absolute; left: 50%; bottom: 0.75rem; transform: translateX(-50%);
    background: rgba(20,20,20,0.85); color: #fff; padding: 0.4em 1em; border-radius: 999px;
    font-size: 0.8rem; max-width: 85%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    opacity: 0; pointer-events: none; transition: opacity 0.25s ease; z-index: 10;
  }
  #status.show { opacity: 1; }
  dialog { border: none; border-radius: 12px; padding: 1.5rem; max-width: 20rem; width: 90%; }
  dialog::backdrop { background: rgba(0,0,0,0.4); }
  .dialog-header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.5rem; }
  .dialog-header h2 { margin: 0; font-size: 1.1rem; }
  .dialog-close { background: none; border: none; color: #999; cursor: pointer; font-size: 1.3rem; padding: 0.5rem; margin: -0.5rem; width: auto; line-height: 1; flex-shrink: 0; }
  dialog p { margin: 0 0 1rem; font-size: 0.85rem; color: #666; }
  dialog form { display: block; padding: 0; border-top: none; }
  dialog input { width: 100%; box-sizing: border-box; margin-bottom: 1rem; }
  dialog button { width: 100%; }
  #lightbox { padding: 0; border: none; background: transparent; max-width: 90vw; max-height: 90vh; }
  #lightbox[open] { display: flex; align-items: center; justify-content: center; }
  #lightbox::backdrop { background: rgba(0,0,0,0.85); }
  #lightbox img { display: block; max-width: 90vw; max-height: 90vh; border-radius: 6px; cursor: zoom-out; }
  .lightbox-close {
    position: fixed; top: 0.5rem; right: 0.7rem; z-index: 30; width: auto; height: auto;
    background: none; color: #fff; border: none; text-shadow: 0 1px 4px rgba(0,0,0,0.8);
    font-size: 2rem; line-height: 1; padding: 0.5rem; cursor: pointer;
  }
  #recoverySection { margin-top: 1rem; padding-top: 0.8rem; border-top: 1px solid #eee; font-size: 0.8rem; }
  #recoverySection summary { cursor: pointer; color: #555; }
  #recoverySection .hint { color: #666; margin: 0.6rem 0; font-size: 0.78rem; line-height: 1.4; }
  .recovery-row { display: flex; gap: 0.4rem; margin-bottom: 0.8rem; }
  .recovery-row input { flex: 1; width: auto; font-size: 0.8rem; padding: 0.4em 0.6em; margin-bottom: 0; }
  .recovery-row button { width: auto; padding: 0.4em 0.8em; font-size: 0.8rem; }
  #onlineList { display: flex; flex-direction: column; gap: 0.3rem; max-height: 50vh; overflow-y: auto; }
  .online-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem; border-radius: 6px; cursor: pointer; }
  .online-row:hover { background: #f2f2f2; }
  .online-row.me { cursor: default; opacity: 0.6; }
  .online-row.me:hover { background: none; }
  .online-row img { width: 24px; height: 24px; border-radius: 50%; background: #eee; }
  .online-row span { font-size: 0.85rem; }
  .whisper-panel {
    display: none; position: fixed; right: 1rem; bottom: 5rem; width: 18rem; max-width: 90vw;
    background: #fff; border: 1px solid #ddd; border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.15);
    flex-direction: column; z-index: 20; overflow: hidden;
  }
  .whisper-panel.open { display: flex; }
  .whisper-header { display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 0.8rem; border-bottom: 1px solid #eee; font-size: 0.85rem; font-weight: 600; }
  .whisper-header button { background: none; border: none; color: #999; cursor: pointer; font-size: 1.1rem; padding: 0.4rem; margin: -0.4rem; width: auto; line-height: 1; }
  #whisperLog { max-height: 12rem; overflow-y: auto; padding: 0.6rem 0.8rem; display: flex; flex-direction: column; gap: 0.4rem; font-size: 0.85rem; }
  .whisper-msg { padding: 0.4em 0.7em; background: #f2f2f2; border-radius: 8px; align-self: flex-start; max-width: 85%; word-break: break-word; white-space: pre-wrap; }
  .whisper-msg.mine { align-self: flex-end; background: #dbeafe; }
  #whisperForm { display: flex; gap: 0.4rem; padding: 0.6rem 0.8rem; border-top: 1px solid #eee; }
  #whisperForm input { flex: 1; width: auto; font-size: 0.85rem; padding: 0.4em 0.6em; margin-bottom: 0; }
  #whisperForm button { width: auto; font-size: 0.85rem; padding: 0.4em 0.9em; align-self: auto; }
</style>
</head>
<body>
  <header>
    <span class="room">#${room}</span>
    <a id="postsLink" href="/posts" title="${m.postsLinkTitle}">${m.postsLinkLabel} (${postsCount})</a>
    <span id="onlineBtn" title="${m.onlineBtnTitle}"></span>
    <span id="me" title="${m.changeNicknameTitle}"></span>
    ${renderLangSwitcher(locale)}
  </header>
  <div class="chat-body">
    <div id="log"></div>
    <div id="status"></div>
  </div>
  <form id="send">
    <textarea id="text" rows="1" maxlength="2000" autocomplete="off" autofocus placeholder="${m.textPlaceholder}"></textarea>
    <button id="sendBtn" type="submit" disabled>${m.sendButton}</button>
  </form>

  <dialog id="nickDialog">
    <div class="dialog-header">
      <h2>${m.nickDialogTitle}</h2>
      <button type="button" class="dialog-close" id="nickDialogClose" aria-label="${m.closeLabel}">×</button>
    </div>
    <p>${m.nickDialogBody}</p>
    <form id="nickForm">
      <input id="nickInput" maxlength="20" autocomplete="off" autofocus placeholder="${m.nickInputPlaceholder}" required>
      <button type="submit">${m.nickConfirmButton}</button>
    </form>

    <details id="recoverySection">
      <summary>${m.recoveryToggle}</summary>
      <p class="hint">${m.recoveryExportHint}</p>
      <div class="recovery-row">
        <input id="recoveryCode" readonly>
        <button type="button" id="copyRecoveryBtn">${m.recoveryCopyButton}</button>
      </div>
      <p class="hint">${m.recoveryImportHint}</p>
      <div class="recovery-row">
        <input id="recoveryInput" autocomplete="off" placeholder="${m.recoveryInputPlaceholder}">
        <button type="button" id="restoreRecoveryBtn">${m.recoveryRestoreButton}</button>
      </div>
    </details>
  </dialog>

  <dialog id="onlineDialog">
    <div class="dialog-header">
      <h2>${m.onlineListTitle}</h2>
      <button type="button" class="dialog-close" id="onlineDialogClose" aria-label="${m.closeLabel}">×</button>
    </div>
    <p class="hint">${m.onlineListHint}</p>
    <div id="onlineList"></div>
  </dialog>

  <dialog id="lightbox">
    <button type="button" class="lightbox-close" id="lightboxClose" aria-label="${m.closeLabel}">×</button>
    <img id="lightboxImg" alt="">
  </dialog>

  <div id="whisperPanel" class="whisper-panel">
    <div class="whisper-header">
      <span id="whisperTitle"></span>
      <button type="button" id="whisperClose" aria-label="${m.closeLabel}">×</button>
    </div>
    <div id="whisperLog"></div>
    <form id="whisperForm">
      <input id="whisperInput" maxlength="2000" autocomplete="off" placeholder="${m.whisperPlaceholder}">
      <button type="submit">${m.sendButton}</button>
    </form>
  </div>

  ${ERROR_REPORTER_SCRIPT}
  <script>
    const I18N = ${jsonForScript(messages)};
    const LOCALE = ${jsonForScript(locale)};

    const log = document.getElementById('log');
    const status = document.getElementById('status');
    const meEl = document.getElementById('me');
    const sendForm = document.getElementById('send');
    const sendBtn = document.getElementById('sendBtn');
    const textInput = document.getElementById('text');
    const nickDialog = document.getElementById('nickDialog');
    const nickForm = document.getElementById('nickForm');
    const nickInput = document.getElementById('nickInput');
    const recoveryCode = document.getElementById('recoveryCode');
    const copyRecoveryBtn = document.getElementById('copyRecoveryBtn');
    const recoveryInput = document.getElementById('recoveryInput');
    const restoreRecoveryBtn = document.getElementById('restoreRecoveryBtn');
    const nickDialogClose = document.getElementById('nickDialogClose');
    const onlineBtn = document.getElementById('onlineBtn');
    const onlineDialog = document.getElementById('onlineDialog');
    const onlineDialogClose = document.getElementById('onlineDialogClose');
    const onlineList = document.getElementById('onlineList');
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightboxImg');
    const lightboxClose = document.getElementById('lightboxClose');
    const whisperPanel = document.getElementById('whisperPanel');
    const whisperTitle = document.getElementById('whisperTitle');
    const whisperClose = document.getElementById('whisperClose');
    const whisperLog = document.getElementById('whisperLog');
    const whisperForm = document.getElementById('whisperForm');
    const whisperInput = document.getElementById('whisperInput');

    const SECRET_KEY = 'godot-chat-secret';
    const NICK_KEY = 'godot-chat-nickname';

    function randomSecret() {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    let secret = localStorage.getItem(SECRET_KEY);
    if (!secret) {
      secret = randomSecret();
      localStorage.setItem(SECRET_KEY, secret);
    }
    let nickname = localStorage.getItem(NICK_KEY) || '';
    let myHashId = null;

    recoveryCode.value = secret;

    copyRecoveryBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(secret);
        showStatus(I18N.chat.recoveryCopiedHint);
      } catch {
        recoveryCode.select();
      }
    });

    restoreRecoveryBtn.addEventListener('click', () => {
      const value = recoveryInput.value.trim().toLowerCase();
      if (!/^[0-9a-f]{32}$/.test(value)) {
        showStatus(I18N.chat.errors.invalid_recovery_code);
        return;
      }
      secret = value;
      localStorage.setItem(SECRET_KEY, secret);
      recoveryCode.value = secret;
      recoveryInput.value = '';
      sendJSON({ type: 'hello', secret, nickname });
    });

    function avatarUrl(hashId) {
      return 'https://api.dicebear.com/9.x/identicon/svg?seed=' + encodeURIComponent(hashId) + '&size=64';
    }

    const URL_RE = /https?:\\/\\/[^\\s<>"']+/g;
    const IMAGE_EXT = /\\.(jpe?g|png|gif|webp|avif|bmp|svg)$/i;
    const VIDEO_EXT = /\\.(mp4|webm|ogg|ogv|mov)$/i;

    function classifyMediaUrl(url) {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        return null;
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
      if (IMAGE_EXT.test(parsed.pathname)) return 'image';
      if (VIDEO_EXT.test(parsed.pathname)) return 'video';
      return null;
    }

    // 把消息文本里的图片/视频链接原地换成 <img>/<video>,加载失败就退回纯文本——
    // 用户自己保证链接靠谱,我们只负责"能加载就展示,加载不了就当文字"
    function renderMessageContent(container, text) {
      URL_RE.lastIndex = 0;
      let lastIndex = 0;
      let match;
      while ((match = URL_RE.exec(text)) !== null) {
        let url = match[0];
        let end = match.index + url.length;

        const trailing = /[.,;:!?)\\]}'"]+$/.exec(url);
        if (trailing) {
          url = url.slice(0, url.length - trailing[0].length);
          end -= trailing[0].length;
        }

        if (match.index > lastIndex) {
          container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }

        const kind = classifyMediaUrl(url);
        if (kind === 'image') {
          const img = document.createElement('img');
          img.src = url;
          img.alt = url;
          img.className = 'msg-media';
          img.loading = 'lazy';
          img.referrerPolicy = 'no-referrer';
          img.style.cursor = 'zoom-in';
          img.onerror = () => img.replaceWith(document.createTextNode(url));
          img.addEventListener('click', () => openLightbox(url));
          container.appendChild(img);
        } else if (kind === 'video') {
          const video = document.createElement('video');
          video.src = url;
          video.controls = true;
          video.preload = 'metadata';
          video.className = 'msg-media';
          video.onerror = () => video.replaceWith(document.createTextNode(url));
          container.appendChild(video);
        } else {
          container.appendChild(document.createTextNode(url));
        }

        lastIndex = end;
      }
      if (lastIndex < text.length) {
        container.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
    }

    function renderMe() {
      if (!myHashId) return;
      meEl.innerHTML = '';
      const img = document.createElement('img');
      img.src = avatarUrl(myHashId);
      img.alt = '';
      const label = document.createElement('span');
      label.textContent = (nickname || I18N.chat.unnamed) + ' (' + myHashId.slice(-4) + ')';
      meEl.appendChild(img);
      meEl.appendChild(label);
    }

    let statusTimer = null;
    function showStatus(text, durationMs) {
      status.textContent = text;
      status.classList.add('show');
      clearTimeout(statusTimer);
      const duration = durationMs === undefined ? 2500 : durationMs;
      if (duration > 0) {
        statusTimer = setTimeout(() => status.classList.remove('show'), duration);
      }
    }

    function openNickDialog() {
      nickInput.value = nickname;
      if (typeof nickDialog.showModal === 'function') nickDialog.showModal();
    }

    meEl.addEventListener('click', openNickDialog);

    // 点弹窗自身(遮罩区域,不是里面的内容)也能关闭,不是只能靠 Esc 键
    function closeOnBackdropClick(dialog) {
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.close();
      });
    }
    closeOnBackdropClick(nickDialog);
    closeOnBackdropClick(onlineDialog);
    closeOnBackdropClick(lightbox);

    nickDialogClose.addEventListener('click', () => nickDialog.close());
    onlineDialogClose.addEventListener('click', () => onlineDialog.close());

    function openLightbox(src) {
      lightboxImg.src = src;
      if (typeof lightbox.showModal === 'function') lightbox.showModal();
    }
    lightboxImg.addEventListener('click', () => lightbox.close());
    lightboxClose.addEventListener('click', () => lightbox.close());

    let presenceUsers = [];
    let whisperTarget = null;

    function renderOnlineButton() {
      onlineBtn.textContent = I18N.chat.onlineLabel.replace('{count}', String(presenceUsers.length));
    }

    function renderOnlineList() {
      onlineList.innerHTML = '';
      for (const u of presenceUsers) {
        const row = document.createElement('div');
        row.className = 'online-row' + (u.hashId === myHashId ? ' me' : '');

        const img = document.createElement('img');
        img.src = avatarUrl(u.hashId);
        img.alt = '';

        const label = document.createElement('span');
        label.textContent = u.nickname + ' (' + u.hashId.slice(-4) + ')';

        row.appendChild(img);
        row.appendChild(label);

        if (u.hashId !== myHashId) {
          row.title = I18N.chat.whisperRowTitle;
          row.addEventListener('click', () => {
            onlineDialog.close();
            openWhisper(u.hashId, u.nickname);
          });
        }

        onlineList.appendChild(row);
      }
    }

    onlineBtn.addEventListener('click', () => {
      renderOnlineList();
      if (typeof onlineDialog.showModal === 'function') onlineDialog.showModal();
    });

    function openWhisper(hashId, targetNickname) {
      whisperTarget = { hashId, nickname: targetNickname };
      whisperTitle.textContent = I18N.chat.whisperWith.replace('{nickname}', targetNickname);
      whisperLog.innerHTML = '';
      whisperPanel.classList.add('open');
      whisperInput.focus();
    }

    whisperClose.addEventListener('click', () => {
      whisperPanel.classList.remove('open');
      whisperTarget = null;
    });

    function appendWhisperMessage(text, mine) {
      const el = document.createElement('div');
      el.className = 'whisper-msg' + (mine ? ' mine' : '');
      renderMessageContent(el, text);
      whisperLog.appendChild(el);
      whisperLog.scrollTop = whisperLog.scrollHeight;
    }

    whisperForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = whisperInput.value.trim();
      if (!text || !whisperTarget) return;
      sendJSON({ type: 'whisper', to: whisperTarget.hashId, text });
      whisperInput.value = '';
    });

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const RECONNECT_BASE_DELAY = 1000;
    const RECONNECT_MAX_DELAY = 30000;
    let ws = null;
    let reconnectDelay = RECONNECT_BASE_DELAY;
    let reconnectTimer = null;
    let isJailed = false;

    function renderHistorySnapshot(data) {
      log.innerHTML = '';
      lastDayKey = null;
      firstDayKey = null;
      loadingHistory = false;
      appendMessages(data.messages);
      oldestSeq = data.messages.length ? data.messages[0].seq : null;
      hasMoreHistory = data.hasMore;
      log.scrollTop = log.scrollHeight;
    }

    function sendJSON(obj) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    }

    function connect() {
      ws = new WebSocket(proto + '//' + location.host + '/ws');
      showStatus(I18N.chat.connecting);

      ws.onopen = () => {
        reconnectDelay = RECONNECT_BASE_DELAY;
        showStatus(I18N.chat.connected);
        sendJSON({ type: 'hello', secret, nickname });
        if (!nickname) openNickDialog();
        else textInput.focus();
      };
      ws.onclose = () => {
        sendBtn.disabled = true;
        if (isJailed) return; // 被封禁的等待时间是按小时算的,重连也没用
        showStatus(I18N.chat.disconnected);
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_DELAY);
      };
      ws.onerror = () => { showStatus(I18N.chat.connectionError); };
      ws.onmessage = handleServerMessage;
    }

    const dayFormatter = new Intl.DateTimeFormat(LOCALE, { year: 'numeric', month: 'long', day: 'numeric' });
    const timeFormatter = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });

    function dayKey(ts) {
      const d = new Date(ts);
      return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
    }

    function makeDaySeparator(ts) {
      const el = document.createElement('div');
      el.className = 'day-sep';
      el.textContent = dayFormatter.format(new Date(ts));
      return el;
    }

    function makeMessageRow(m) {
      const row = document.createElement('div');
      row.className = 'row' + (m.hashId === myHashId ? ' mine' : '');
      row.dataset.hashId = m.hashId;

      const img = document.createElement('img');
      img.src = avatarUrl(m.hashId);
      img.alt = '';

      const bubble = document.createElement('div');
      bubble.className = 'bubble';

      const who = document.createElement('div');
      who.className = 'who';
      who.textContent = (m.nickname || I18N.chat.anonymous) + ' (' + m.hashId.slice(-4) + ') · ' + timeFormatter.format(new Date(m.ts));

      const msg = document.createElement('div');
      msg.className = 'msg';
      renderMessageContent(msg, m.text);

      bubble.appendChild(who);
      bubble.appendChild(msg);
      row.appendChild(img);
      row.appendChild(bubble);
      return row;
    }

    // 把一批按时间正序排列的消息切成 [分隔条, 消息行, 分隔条, 消息行...] 的元素列表
    function buildBatch(list) {
      const items = [];
      let prevKey = null;
      for (const m of list) {
        const key = dayKey(m.ts);
        if (key !== prevKey) {
          items.push({ type: 'sep', key, el: makeDaySeparator(m.ts) });
          prevKey = key;
        }
        items.push({ type: 'row', key, el: makeMessageRow(m) });
      }
      return items;
    }

    let lastDayKey = null; // 目前日志最底部(最新)那组消息的日期
    let firstDayKey = null; // 目前日志最顶部(最早)那组消息的日期
    let oldestSeq = null; // 向上翻页用的游标
    let hasMoreHistory = false;
    let loadingHistory = false;

    // 追加更新的消息(初次连接的历史、实时新消息),接在日志底部
    function appendMessages(list) {
      if (!list.length) return;
      const items = buildBatch(list);
      if (items[0].type === 'sep' && items[0].key === lastDayKey) items.shift();
      for (const item of items) log.appendChild(item.el);
      if (items.length) {
        lastDayKey = items[items.length - 1].key;
        if (firstDayKey === null) firstDayKey = items[0].key;
      }
    }

    // 插入向上翻页懒加载出来的更早消息,接在日志顶部,并做滚动位置补偿避免视觉跳动
    function prependMessages(list) {
      if (!list.length) return;
      const items = buildBatch(list);
      const firstEl = log.firstElementChild;
      if (items[items.length - 1].key === firstDayKey && firstEl && firstEl.classList.contains('day-sep')) {
        firstEl.remove();
      }
      const frag = document.createDocumentFragment();
      for (const item of items) frag.appendChild(item.el);
      const prevScrollHeight = log.scrollHeight;
      log.insertBefore(frag, log.firstChild);
      log.scrollTop += log.scrollHeight - prevScrollHeight;
      firstDayKey = items[0].key;
    }

    log.addEventListener('scroll', () => {
      if (log.scrollTop < 80 && !loadingHistory && hasMoreHistory && oldestSeq !== null) {
        loadingHistory = true;
        sendJSON({ type: 'history_before', before: oldestSeq });
      }
    });

    function handleServerMessage(event) {
      const data = JSON.parse(event.data);

      if (data.type === 'identity') {
        myHashId = data.hashId;
        if (typeof data.nickname === 'string' && data.nickname) {
          nickname = data.nickname;
          localStorage.setItem(NICK_KEY, nickname);
        }
        renderMe();
        sendBtn.disabled = !nickname;
        // 身份确认之前收到的历史消息(含自己发过的)当时都判成了"别人的",
        // 这里回头按刚确认的 hashId 重新标一遍
        for (const row of log.querySelectorAll('.row')) {
          row.classList.toggle('mine', row.dataset.hashId === myHashId);
        }
        return;
      }

      if (data.type === 'error') {
        if (data.code === 'jailed') {
          isJailed = true;
          showStatus(I18N.chat.errors.jailed, 0); // 一直显示,不像别的提示那样自动消失
        } else {
          showStatus(I18N.chat.errors[data.code] || data.code);
        }
        return;
      }

      if (data.type === 'presence') {
        presenceUsers = data.users;
        renderOnlineButton();
        if (onlineDialog.open) renderOnlineList();
        return;
      }

      if (data.type === 'post_extracted') {
        showStatus(I18N.chat.postExtractedNotice.replace('{title}', data.title), 4000);
        return;
      }

      if (data.type === 'whisper') {
        const mine = data.fromHashId === myHashId;
        const otherHashId = mine ? data.toHashId : data.fromHashId;
        if (!whisperTarget || whisperTarget.hashId !== otherHashId) {
          let otherNickname = mine ? '' : data.fromNickname;
          if (!otherNickname) {
            const match = presenceUsers.find((u) => u.hashId === otherHashId);
            otherNickname = match ? match.nickname : otherHashId.slice(-4);
          }
          openWhisper(otherHashId, otherNickname);
        }
        appendWhisperMessage(data.text, mine);
        return;
      }

      if (data.type === 'history') {
        // 重连之后服务器会重新推一份历史快照——把上一次连接留下的内容清空再重建,
        // 不然这批消息会跟断线前已经渲染好的重复一遍
        renderHistorySnapshot(data);
        return;
      }

      if (data.type === 'history_before') {
        loadingHistory = false;
        hasMoreHistory = data.hasMore;
        if (data.messages.length) {
          oldestSeq = data.messages[0].seq;
          prependMessages(data.messages);
        }
        return;
      }

      if (data.type === 'message') {
        const wasNearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 100;
        appendMessages([data]);
        if (wasNearBottom) log.scrollTop = log.scrollHeight;
      }
    }

    connect();

    nickForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = nickInput.value.trim();
      if (!value) return;
      nickname = value;
      localStorage.setItem(NICK_KEY, nickname);
      sendJSON({ type: 'rename', nickname });
      nickDialog.close();
      textInput.focus();
    });

    function resizeTextInput() {
      textInput.style.height = 'auto';
      textInput.style.height = textInput.scrollHeight + 'px';
    }
    textInput.addEventListener('input', resizeTextInput);

    // 回车发送,Shift+回车换行(textarea 默认不会自动提交表单,换行是原生行为不用特殊处理)。
    // e.isComposing 排除中日韩输入法组词期间按回车确认候选字的情况,不然打拼音/假名
    // 按回车选字会被当成发送
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendForm.requestSubmit();
      }
    });

    sendForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = textInput.value.trim();
      if (!text || !nickname) return;
      sendJSON({ type: 'chat', text });
      textInput.value = '';
      resizeTextInput();
    });

    ${langSwitchScript(rootDomain)}
  </script>
</body>
</html>`;
}

function renderSourceMessage(msg: PostSourceMessage, timeFormatter: Intl.DateTimeFormat, anonymousLabel: string): string {
  const avatar = `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(msg.hashId)}&size=64`;
  return `
      <div class="orig-row">
        <img src="${avatar}" alt="">
        <div class="orig-bubble">
          <div class="orig-who">${escapeHtml(msg.nickname || anonymousLabel)} (${escapeHtml(msg.hashId.slice(-4))}) · ${timeFormatter.format(new Date(msg.ts))}</div>
          <div class="orig-msg">${escapeHtml(msg.text)}</div>
        </div>
      </div>`;
}

export function renderPostsPage(room: string, locale: Locale, rootDomain: string, posts: PostSummary[]): string {
  const messages = t(locale);
  const m = messages.posts;
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const now = Date.now();
  const { fraction: gcFraction, daysRemaining: gcDaysRemaining } = gcProgress(now);

  const postsHtml = posts.length
    ? posts
        .map((p) => {
          const dialogId = `original-${p.id}`;
          const inGrace = isInGracePeriod(p.createdTs, now);
          const good = isGoodPost(p.goodCount, p.badCount);

          let statusInner: string;
          if (inGrace) {
            statusInner = `<p class="post-status post-status-grace">${m.gracePeriodLabel.replace("{days}", String(graceDaysRemaining(p.createdTs, now)))}</p>`;
          } else if (good) {
            statusInner = `<p class="post-status post-status-kept">${m.keptLabel}</p>`;
          } else {
            const countdownText = m.countdownLabel
              .replace("{days}", String(gcDaysRemaining))
              .replace("{good}", String(p.goodCount))
              .replace("{bad}", String(p.badCount));
            statusInner = `
        <div class="post-gc-progress"><div class="post-gc-progress-fill" style="width:${Math.round(gcFraction * 100)}%"></div></div>
        <p class="post-status post-status-countdown">${countdownText}</p>`;
          }

          return `
    <article class="post">
      <h2>${escapeHtml(p.title)}</h2>
      <p class="post-time">${timeFormatter.format(new Date(p.createdTs))}</p>
      <p class="post-summary">${escapeHtml(p.summary)}</p>
      <p class="post-key-points-label">${m.keyPointsLabel}</p>
      <ul class="post-key-points">
        ${p.keyPoints.map((kp) => `<li>${escapeHtml(kp)}</li>`).join("")}
      </ul>
      <div class="post-status-area" data-status-for="${p.id}">${statusInner}</div>
      <div class="post-votes" data-post-id="${p.id}" data-in-grace="${inGrace ? "1" : "0"}">
        <button type="button" class="vote-btn vote-good" data-vote="good">${m.voteGoodLabel} <span class="vote-count" data-count="good">${p.goodCount}</span></button>
        <button type="button" class="vote-btn vote-bad" data-vote="bad">${m.voteBadLabel} <span class="vote-count" data-count="bad">${p.badCount}</span></button>
      </div>
      <button type="button" class="post-view-original" data-dialog="${dialogId}">${m.viewOriginalLink}</button>
    </article>
    <dialog id="${dialogId}" class="original-dialog">
      <div class="dialog-header">
        <h2>${escapeHtml(p.title)}</h2>
        <button type="button" class="dialog-close" data-close="${dialogId}" aria-label="${messages.chat.closeLabel}">×</button>
      </div>
      <div class="original-log">
        ${p.sourceMessages.map((sm) => renderSourceMessage(sm, timeFormatter, messages.chat.anonymous)).join("")}
      </div>
    </dialog>`;
        })
        .join("")
    : `<p class="empty">${m.empty}</p>`;

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${m.heading.replace("{room}", room)}</title>
${FAVICON_LINK}
<meta name="robots" content="noindex, nofollow">
<style>
  body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 0 auto; padding: 1.5rem; color: #1a1a1a; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; }
  header h1 { font-size: 1.2rem; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  select { padding: 0.3em 0.5em; border-radius: 6px; border: 1px solid #ccc; }
  nav a { color: #555; text-decoration: none; font-size: 0.85rem; flex-shrink: 0; }
  nav a:hover { text-decoration: underline; }
  .empty { color: #888; }
  .post { border: 1px solid #eee; border-radius: 10px; padding: 1rem 1.2rem; margin-bottom: 1rem; }
  .post h2 { font-size: 1.05rem; margin: 0 0 0.2rem; }
  .post-time { font-size: 0.75rem; color: #999; margin: 0 0 0.7rem; }
  .post-summary { margin: 0 0 0.7rem; line-height: 1.5; }
  .post-key-points-label { font-size: 0.8rem; font-weight: 600; color: #666; margin: 0 0 0.3rem; }
  .post-key-points { margin: 0 0 0.7rem; padding-left: 1.2rem; line-height: 1.5; }
  .post-view-original {
    font-size: 0.8rem; color: #555; background: none; border: 1px solid #ccc; border-radius: 6px;
    padding: 0.35em 0.8em; cursor: pointer;
  }
  .post-view-original:hover { background: #f2f2f2; }
  .post-status { font-size: 0.78rem; margin: 0 0 0.6rem; }
  .post-status-grace { color: #888; }
  .post-status-kept { color: #15803d; font-weight: 600; }
  .post-status-countdown { color: #b45309; }
  .post-gc-progress { height: 6px; border-radius: 999px; background: #f2f2f2; overflow: hidden; margin-bottom: 0.3rem; }
  .post-gc-progress-fill { height: 100%; background: #f59e0b; border-radius: 999px; }
  .post-votes { display: flex; gap: 0.5rem; margin-bottom: 0.7rem; }
  .vote-btn {
    font-size: 0.8rem; color: #555; background: none; border: 1px solid #ccc; border-radius: 6px;
    padding: 0.35em 0.8em; cursor: pointer; display: flex; align-items: center; gap: 0.3em;
  }
  .vote-btn:hover { background: #f2f2f2; }
  .vote-btn:disabled { opacity: 0.6; cursor: default; }
  .vote-btn.voted { border-color: #1a1a1a; background: #1a1a1a; color: #fff; }
  .vote-count { font-weight: 600; }
  dialog.original-dialog {
    border: none; border-radius: 12px; padding: 1.2rem; max-width: 32rem; width: 90%;
    max-height: 80vh; display: flex; flex-direction: column;
  }
  dialog.original-dialog::backdrop { background: rgba(0,0,0,0.4); }
  .dialog-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.8rem; flex-shrink: 0; }
  .dialog-header h2 { margin: 0; font-size: 1.05rem; }
  .dialog-close { background: none; border: none; color: #999; cursor: pointer; font-size: 1.3rem; padding: 0.3rem; margin: -0.3rem; line-height: 1; flex-shrink: 0; }
  .original-log { overflow-y: auto; display: flex; flex-direction: column; gap: 0.6rem; }
  .orig-row { display: flex; gap: 0.5rem; align-items: flex-start; }
  .orig-row img { width: 24px; height: 24px; border-radius: 50%; background: #eee; flex-shrink: 0; }
  .orig-who { font-size: 0.72rem; color: #999; margin-bottom: 0.15rem; }
  .orig-msg { padding: 0.4em 0.7em; background: #f2f2f2; border-radius: 8px; font-size: 0.9rem; word-break: break-word; white-space: pre-wrap; }
</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(m.heading.replace("{room}", room))}</h1>
    ${renderLangSwitcher(locale)}
  </header>
  <nav><a href="/">${m.backToChat}</a></nav>
  <div class="posts">${postsHtml}</div>
  ${ERROR_REPORTER_SCRIPT}
  <script>
    // 跟聊天页共用同一个 localStorage key,同源共享——投票身份就是这个人在
    // 本房间的聊天身份,不是另起一套
    const SECRET_KEY = 'godot-chat-secret';
    function randomSecret() {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    let secret = localStorage.getItem(SECRET_KEY);
    if (!secret) {
      secret = randomSecret();
      localStorage.setItem(SECRET_KEY, secret);
    }

    const KEPT_LABEL = ${jsonForScript(m.keptLabel)};
    const COUNTDOWN_TEMPLATE = ${jsonForScript(m.countdownLabel)};
    const GC_DAYS_REMAINING = ${gcDaysRemaining};
    const GC_FRACTION_PERCENT = ${Math.round(gcFraction * 100)};

    document.querySelectorAll('.vote-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const container = btn.closest('.post-votes');
        const postId = container.dataset.postId;
        const inGrace = container.dataset.inGrace === '1';
        btn.disabled = true;
        try {
          const res = await fetch('/posts/' + encodeURIComponent(postId) + '/vote', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ secret, vote: btn.dataset.vote }),
          });
          if (!res.ok) return;
          const data = await res.json();

          container.querySelector('[data-count="good"]').textContent = data.goodCount;
          container.querySelector('[data-count="bad"]').textContent = data.badCount;
          container.querySelectorAll('.vote-btn').forEach((b) => {
            b.classList.toggle('voted', b.dataset.vote === data.myVote);
          });

          // 观察期内的帖子不受投票影响(GC 本来就跳过它),状态区不用跟着变
          if (!inGrace) {
            const statusArea = document.querySelector('[data-status-for="' + postId + '"]');
            if (statusArea) {
              if (data.netScore > 0) {
                statusArea.innerHTML = '<p class="post-status post-status-kept">' + KEPT_LABEL + '</p>';
              } else {
                const text = COUNTDOWN_TEMPLATE
                  .replace('{days}', GC_DAYS_REMAINING)
                  .replace('{good}', data.goodCount)
                  .replace('{bad}', data.badCount);
                statusArea.innerHTML =
                  '<div class="post-gc-progress"><div class="post-gc-progress-fill" style="width:' + GC_FRACTION_PERCENT + '%"></div></div>' +
                  '<p class="post-status post-status-countdown">' + text + '</p>';
              }
            }
          }
        } finally {
          btn.disabled = false;
        }
      });
    });

    document.querySelectorAll('.post-view-original').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dialog = document.getElementById(btn.dataset.dialog);
        if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
      });
    });
    document.querySelectorAll('.dialog-close').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dialog = document.getElementById(btn.dataset.close);
        if (dialog) dialog.close();
      });
    });
    document.querySelectorAll('.original-dialog').forEach((dialog) => {
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.close();
      });
    });

    ${langSwitchScript(rootDomain)}
  </script>
</body>
</html>`;
}
