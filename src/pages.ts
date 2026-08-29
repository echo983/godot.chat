import { LOCALE_LABELS, SUPPORTED_LOCALES, t, type Locale } from "./i18n";

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

const LANG_SWITCH_SCRIPT = `
document.getElementById('langSelect').addEventListener('change', (e) => {
  document.cookie = 'lang=' + e.target.value + '; domain=.godot.chat; path=/; max-age=31536000; samesite=lax';
  location.reload();
});
`;

export function renderLandingPage(locale: Locale): string {
  const m = t(locale).landing;
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>godot.chat</title>
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
  <h1>godot.chat</h1>
  <p>${m.intro}</p>
  <form id="go">
    <input id="room" placeholder="${m.roomPlaceholder}" maxlength="12" autocomplete="off">
    <button type="submit">${m.enterButton}</button>
  </form>
  <script>
    document.getElementById('go').addEventListener('submit', (e) => {
      e.preventDefault();
      const room = document.getElementById('room').value.trim().toLowerCase();
      if (!room) return;
      window.location.href = 'https://' + room + '.godot.chat/';
    });
    ${LANG_SWITCH_SCRIPT}
  </script>
</body>
</html>`;
}

export function renderChatPage(room: string, locale: Locale): string {
  const messages = t(locale);
  const m = messages.chat;
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${room}.godot.chat</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; display: flex; flex-direction: column; height: 100vh; color: #1a1a1a; }
  header { padding: 0.8rem 1rem; border-bottom: 1px solid #eee; font-weight: 600; display: flex; align-items: center; gap: 0.6rem; }
  header .room { flex: 1; }
  #me { display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; font-weight: 400; color: #555; cursor: pointer; }
  #me img { width: 20px; height: 20px; border-radius: 50%; background: #eee; }
  select { padding: 0.3em 0.5em; border-radius: 6px; border: 1px solid #ccc; font-size: 0.8rem; }
  #log { flex: 1; overflow-y: auto; padding: 1rem; display: flex; flex-direction: column; gap: 0.6rem; }
  .day-sep { align-self: center; font-size: 0.75rem; color: #888; background: #f2f2f2; padding: 0.2em 0.9em; border-radius: 999px; margin: 0.3rem 0; }
  .row { display: flex; gap: 0.5rem; align-items: flex-end; }
  .row.mine { flex-direction: row-reverse; }
  .row img { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; background: #eee; }
  .bubble { max-width: 70%; }
  .who { font-size: 0.75rem; color: #999; margin-bottom: 0.15rem; }
  .row.mine .who { text-align: right; }
  .msg { padding: 0.5em 0.8em; background: #f2f2f2; border-radius: 8px; word-break: break-word; white-space: pre-wrap; }
  .row.mine .msg { background: #dbeafe; }
  form { display: flex; gap: 0.5rem; padding: 0.8rem; border-top: 1px solid #eee; }
  input { flex: 1; padding: 0.6em 0.8em; font-size: 1rem; border: 1px solid #ccc; border-radius: 6px; }
  #text { flex: 1; padding: 0.6em 0.8em; font-size: 1rem; font-family: inherit; line-height: 1.4; border: 1px solid #ccc; border-radius: 6px; resize: none; max-height: 7.5rem; overflow-y: auto; }
  button { padding: 0.6em 1.2em; font-size: 1rem; border: none; border-radius: 6px; background: #1a1a1a; color: #fff; cursor: pointer; align-self: flex-end; }
  button:disabled { background: #ccc; cursor: not-allowed; }
  #status {
    position: fixed; left: 50%; bottom: 4.5rem; transform: translateX(-50%);
    background: rgba(20,20,20,0.85); color: #fff; padding: 0.4em 1em; border-radius: 999px;
    font-size: 0.8rem; max-width: 85vw; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    opacity: 0; pointer-events: none; transition: opacity 0.25s ease; z-index: 10;
  }
  #status.show { opacity: 1; }
  dialog { border: none; border-radius: 12px; padding: 1.5rem; max-width: 20rem; width: 90%; }
  dialog::backdrop { background: rgba(0,0,0,0.4); }
  dialog h2 { margin: 0 0 0.5rem; font-size: 1.1rem; }
  dialog p { margin: 0 0 1rem; font-size: 0.85rem; color: #666; }
  dialog form { display: block; padding: 0; border-top: none; }
  dialog input { width: 100%; box-sizing: border-box; margin-bottom: 1rem; }
  dialog button { width: 100%; }
</style>
</head>
<body>
  <header>
    <span class="room">#${room}</span>
    <span id="me" title="${m.changeNicknameTitle}"></span>
    ${renderLangSwitcher(locale)}
  </header>
  <div id="status"></div>
  <div id="log"></div>
  <form id="send">
    <textarea id="text" rows="1" maxlength="2000" autocomplete="off" autofocus placeholder="${m.textPlaceholder}"></textarea>
    <button id="sendBtn" type="submit" disabled>${m.sendButton}</button>
  </form>

  <dialog id="nickDialog">
    <h2>${m.nickDialogTitle}</h2>
    <p>${m.nickDialogBody}</p>
    <form id="nickForm">
      <input id="nickInput" maxlength="20" autocomplete="off" autofocus placeholder="${m.nickInputPlaceholder}" required>
      <button type="submit">${m.nickConfirmButton}</button>
    </form>
  </dialog>

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

    function avatarUrl(hashId) {
      return 'https://api.dicebear.com/9.x/identicon/svg?seed=' + encodeURIComponent(hashId) + '&size=64';
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

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(proto + '//' + location.host + '/ws');
    showStatus(I18N.chat.connecting);

    function sendJSON(obj) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    }

    ws.onopen = () => {
      showStatus(I18N.chat.connected);
      sendJSON({ type: 'hello', secret, nickname });
      if (!nickname) openNickDialog();
      else textInput.focus();
    };
    ws.onclose = () => { showStatus(I18N.chat.disconnected); sendBtn.disabled = true; };
    ws.onerror = () => { showStatus(I18N.chat.connectionError); };

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
      msg.textContent = m.text;

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

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'identity') {
        myHashId = data.hashId;
        if (typeof data.nickname === 'string' && data.nickname) {
          nickname = data.nickname;
          localStorage.setItem(NICK_KEY, nickname);
        }
        renderMe();
        sendBtn.disabled = !nickname;
        return;
      }

      if (data.type === 'error') {
        showStatus(I18N.chat.errors[data.code] || data.code);
        return;
      }

      if (data.type === 'history') {
        appendMessages(data.messages);
        if (data.messages.length) oldestSeq = data.messages[0].seq;
        hasMoreHistory = data.hasMore;
        log.scrollTop = log.scrollHeight;
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
    };

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

    // 回车发送,Shift+回车换行(textarea 默认不会自动提交表单,换行是原生行为不用特殊处理)
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
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

    ${LANG_SWITCH_SCRIPT}
  </script>
</body>
</html>`;
}
