// 复刻 chat-room.ts 里 getPresenceUsers 的去重逻辑,理由见 identity-hash.test.mjs 顶部注释。

function getPresenceUsers(connections) {
  const seen = new Map();
  for (const c of connections) {
    if (c.hashId && c.nickname) seen.set(c.hashId, c.nickname);
  }
  return [...seen].map(([hashId, nickname]) => ({ hashId, nickname }));
}

let fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(ok ? "ok  " : "FAIL", name, "->", JSON.stringify(actual), ok ? "" : `(expected ${JSON.stringify(expected)})`);
}

// 同一个人开两个标签页(同一个 hashId,两条连接),只应该出现一次
check(
  "同一身份多连接去重",
  getPresenceUsers([
    { hashId: "aaa", nickname: "Alice" },
    { hashId: "aaa", nickname: "Alice" },
    { hashId: "bbb", nickname: "Bob" },
  ]),
  [{ hashId: "aaa", nickname: "Alice" }, { hashId: "bbb", nickname: "Bob" }],
);

// 还没设置昵称的连接(刚连上,还没 hello 完成)不该出现在在线列表里
check(
  "未设置昵称的连接不计入在线列表",
  getPresenceUsers([
    { hashId: null, nickname: null },
    { hashId: "ccc", nickname: null },
    { hashId: "ddd", nickname: "Dave" },
  ]),
  [{ hashId: "ddd", nickname: "Dave" }],
);

// 同一身份改了昵称(重新 hello/rename 之后),取最新的那个
check(
  "同一身份取最新昵称",
  getPresenceUsers([
    { hashId: "eee", nickname: "OldName" },
    { hashId: "eee", nickname: "NewName" },
  ]),
  [{ hashId: "eee", nickname: "NewName" }],
);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
