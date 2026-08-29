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
  header { padding: 0.8rem 1rem; border-bottom: 1px solid #eee; font-weight: 600; }
  #log { flex: 1; overflow-y: auto; padding: 1rem; display: flex; flex-direction: column; gap: 0.4rem; }
  .msg { padding: 0.5em 0.8em; background: #f2f2f2; border-radius: 8px; max-width: 70%; align-self: flex-start; word-break: break-word; }
  form { display: flex; gap: 0.5rem; padding: 0.8rem; border-top: 1px solid #eee; }
  input { flex: 1; padding: 0.6em 0.8em; font-size: 1rem; border: 1px solid #ccc; border-radius: 6px; }
  button { padding: 0.6em 1.2em; font-size: 1rem; border: none; border-radius: 6px; background: #1a1a1a; color: #fff; cursor: pointer; }
  #status { font-size: 0.8rem; color: #999; padding: 0 1rem; }
</style>
</head>
<body>
  <header>#${room}</header>
  <div id="status">连接中…</div>
  <div id="log"></div>
  <form id="send">
    <input id="text" maxlength="2000" autocomplete="off" placeholder="说点什么…">
    <button type="submit">发送</button>
  </form>
  <script>
    const log = document.getElementById('log');
    const status = document.getElementById('status');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(proto + '//' + location.host + '/ws');

    ws.onopen = () => { status.textContent = '已连接'; };
    ws.onclose = () => { status.textContent = '连接已断开'; };
    ws.onerror = () => { status.textContent = '连接出错'; };

    function appendMessage(text) {
      const el = document.createElement('div');
      el.className = 'msg';
      el.textContent = text;
      log.appendChild(el);
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'history') {
        for (const m of data.messages) appendMessage(m.text);
      } else if (data.type === 'message') {
        appendMessage(data.text);
      }
      log.scrollTop = log.scrollHeight;
    };

    document.getElementById('send').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('text');
      const text = input.value.trim();
      if (!text || ws.readyState !== WebSocket.OPEN) return;
      ws.send(text);
      input.value = '';
    });
  </script>
</body>
</html>`;
}
