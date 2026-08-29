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
  button { padding: 0.6em 1.2em; font-size: 1rem; border: none; border-radius: 6px; background: #1a1a1a; color: #fff; cursor: pointer; }
  button:disabled { background: #ccc; cursor: not-allowed; }
  #status { font-size: 0.8rem; color: #999; padding: 0 1rem; }
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
  <div id="status">${m.connecting}</div>
  <div id="log"></div>
  <form id="send">
    <input id="text" maxlength="2000" autocomplete="off" placeholder="${m.textPlaceholder}">
    <button id="sendBtn" type="submit" disabled>${m.sendButton}</button>
  </form>

  <dialog id="nickDialog">
    <h2>${m.nickDialogTitle}</h2>
    <p>${m.nickDialogBody}</p>
    <form id="nickForm">
      <input id="nickInput" maxlength="20" autocomplete="off" placeholder="${m.nickInputPlaceholder}" required>
      <button type="submit">${m.nickConfirmButton}</button>
    </form>
  </dialog>

  <script>
    const I18N = ${jsonForScript(messages)};

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

    function openNickDialog() {
      nickInput.value = nickname;
      if (typeof nickDialog.showModal === 'function') nickDialog.showModal();
    }

    meEl.addEventListener('click', openNickDialog);

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(proto + '//' + location.host + '/ws');

    function sendJSON(obj) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    }

    ws.onopen = () => {
      status.textContent = I18N.chat.connected;
      sendJSON({ type: 'hello', secret, nickname });
      if (!nickname) openNickDialog();
    };
    ws.onclose = () => { status.textContent = I18N.chat.disconnected; sendBtn.disabled = true; };
    ws.onerror = () => { status.textContent = I18N.chat.connectionError; };

    function appendMessage(m) {
      const row = document.createElement('div');
      row.className = 'row' + (m.hashId === myHashId ? ' mine' : '');

      const img = document.createElement('img');
      img.src = avatarUrl(m.hashId);
      img.alt = '';

      const bubble = document.createElement('div');
      bubble.className = 'bubble';

      const who = document.createElement('div');
      who.className = 'who';
      who.textContent = (m.nickname || I18N.chat.anonymous) + ' (' + m.hashId.slice(-4) + ')';

      const msg = document.createElement('div');
      msg.className = 'msg';
      msg.textContent = m.text;

      bubble.appendChild(who);
      bubble.appendChild(msg);
      row.appendChild(img);
      row.appendChild(bubble);
      log.appendChild(row);
    }

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
        status.textContent = I18N.chat.errors[data.code] || data.code;
        return;
      }

      if (data.type === 'history') {
        for (const m of data.messages) appendMessage(m);
        log.scrollTop = log.scrollHeight;
        return;
      }

      if (data.type === 'message') {
        appendMessage(data);
        log.scrollTop = log.scrollHeight;
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
    });

    sendForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = textInput.value.trim();
      if (!text || !nickname) return;
      sendJSON({ type: 'chat', text });
      textInput.value = '';
    });

    ${LANG_SWITCH_SCRIPT}
  </script>
</body>
</html>`;
}
