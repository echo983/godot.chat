export function renderLandingPage(): string {
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>godot.chat</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1.5rem; color: #1a1a1a; }
  code { background: #f2f2f2; padding: 0.15em 0.4em; border-radius: 4px; }
  form { margin-top: 2rem; display: flex; gap: 0.5rem; }
  input { flex: 1; padding: 0.6em 0.8em; font-size: 1rem; border: 1px solid #ccc; border-radius: 6px; }
  button { padding: 0.6em 1.2em; font-size: 1rem; border: none; border-radius: 6px; background: #1a1a1a; color: #fff; cursor: pointer; }
</style>
</head>
<body>
  <h1>godot.chat</h1>
  <p>任意子域名都是一个独立聊天室,进去就自动创建。例如 <code>newyork.godot.chat</code>、<code>apple.godot.chat</code>。</p>
  <form id="go">
    <input id="room" placeholder="房间名 (1-12 位小写字母/数字/-)" maxlength="12" autocomplete="off">
    <button type="submit">进入</button>
  </form>
  <script>
    document.getElementById('go').addEventListener('submit', (e) => {
      e.preventDefault();
      const room = document.getElementById('room').value.trim().toLowerCase();
      if (!room) return;
      window.location.href = 'https://' + room + '.godot.chat/';
    });
  </script>
</body>
</html>`;
}

export function renderChatPage(room: string): string {
  return `<!doctype html>
<html lang="zh">
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
    <span id="me" title="点击更换昵称"></span>
  </header>
  <div id="status">连接中…</div>
  <div id="log"></div>
  <form id="send">
    <input id="text" maxlength="2000" autocomplete="off" placeholder="说点什么…">
    <button id="sendBtn" type="submit" disabled>发送</button>
  </form>

  <dialog id="nickDialog">
    <h2>选一个昵称</h2>
    <p>昵称右边会带一个基于你身份哈希生成的头像和后四位,别人改不出跟你一样的。</p>
    <form id="nickForm">
      <input id="nickInput" maxlength="20" autocomplete="off" placeholder="1-20 个字符" required>
      <button type="submit">确定</button>
    </form>
  </dialog>

  <script>
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
      label.textContent = (nickname || '未命名') + ' (' + myHashId.slice(-4) + ')';
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
      status.textContent = '已连接';
      sendJSON({ type: 'hello', secret, nickname });
      if (!nickname) openNickDialog();
    };
    ws.onclose = () => { status.textContent = '连接已断开'; sendBtn.disabled = true; };
    ws.onerror = () => { status.textContent = '连接出错'; };

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
      who.textContent = (m.nickname || '匿名') + ' (' + m.hashId.slice(-4) + ')';

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
        status.textContent = data.message || '出错了';
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
  </script>
</body>
</html>`;
}
