// chat-room.ts 是个 Durable Object,依赖 Workers 运行时 API,没法在普通 Node 里直接
// import 跑单测。这里复刻了 safeSend 和 webSocketClose 里计算关闭码的逻辑——
// 改了 chat-room.ts 里对应的实现要记得同步改这里,不然测试会跟真实代码脱节测不出问题。
//
// 这两段逻辑是真实线上复现过的 bug 修复(2026-08-30):
// 1. 客户端 ws.close() 不带参数时,上报的 code 是协议保留值 1005("没收到关闭码"),
//    原样转发给 ws.close(code, ...) 会抛 InvalidAccessError。
// 2. 广播循环(聊天消息/在线状态/私聊)对着已经关闭的连接 send() 会抛
//    "Can't call WebSocket send() after close()",不加保护会打断整个广播,
//    让排在后面的其他在线用户也收不到消息。

function safeSend(socket, data) {
  try {
    socket.send(data);
  } catch {
    // 连接已关闭,忽略
  }
}

function computeCloseCode(code, wasClean) {
  const isReservedCode = code === 1005 || code === 1006;
  return wasClean ? (isReservedCode ? 1000 : code) : 1011;
}

let fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(ok ? "ok  " : "FAIL", name, "->", JSON.stringify(actual), ok ? "" : `(expected ${JSON.stringify(expected)})`);
}

// --- safeSend ---
{
  let sent = null;
  const okSocket = { send: (data) => { sent = data; } };
  safeSend(okSocket, "hello");
  check("正常连接照常发送", sent, "hello");
}

{
  const throwingSocket = {
    send: () => {
      throw new TypeError("Can't call WebSocket send() after close().");
    },
  };
  let threw = false;
  try {
    safeSend(throwingSocket, "hello");
  } catch {
    threw = true;
  }
  check("已关闭连接抛错被吞掉,不往外传播", threw, false);
}

{
  // 广播循环:一个连接已关闭,不该打断给其他连接发送
  const received = [];
  const sockets = [
    { id: "a", send: (data) => received.push(["a", data]) },
    { id: "b", send: () => { throw new TypeError("closed"); } },
    { id: "c", send: (data) => received.push(["c", data]) },
  ];
  for (const s of sockets) safeSend(s, "msg");
  check("中间一个连接已关闭,前后的连接照样收到广播", received, [
    ["a", "msg"],
    ["c", "msg"],
  ]);
}

// --- webSocketClose 的关闭码计算 ---
check("干净关闭 + 正常码,原样透传", computeCloseCode(1000, true), 1000);
check("干净关闭 + 保留码1005(客户端没传码),退回1000", computeCloseCode(1005, true), 1000);
check("干净关闭 + 保留码1006(异常断开),退回1000", computeCloseCode(1006, true), 1000);
check("非干净关闭,一律用1011,不管上报的code是什么", computeCloseCode(1000, false), 1011);
check("非干净关闭 + 保留码,同样是1011", computeCloseCode(1005, false), 1011);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
