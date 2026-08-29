// 复刻 room-registry.ts 的 checkRoomAccess 逻辑,用内存 Map 模拟 SQLite 表。
// room-registry.ts 是个 Durable Object,依赖 Workers 运行时,没法直接 import。

const CREATE_WINDOW_MS = 10 * 60 * 1000;
const CREATE_THRESHOLD = 10;
const CREATE_BAN_DURATION_MS = 24 * 60 * 60 * 1000;

function makeRegistry() {
  const knownRooms = new Set();
  const events = new Map(); // `${ip}|${room}` -> ts
  const bans = new Map(); // ip -> bannedUntil

  function checkRoomAccess(room, ip, now) {
    if (knownRooms.has(room)) return { allowed: true };

    const bannedUntil = bans.get(ip);
    if (bannedUntil !== undefined && bannedUntil > now) {
      return { allowed: false };
    }

    const windowStart = now - CREATE_WINDOW_MS;
    for (const [k, ts] of events) {
      if (ts < windowStart) events.delete(k);
    }

    let count = 0;
    for (const k of events.keys()) {
      if (k.startsWith(ip + "|")) count++;
    }

    if (count >= CREATE_THRESHOLD) {
      bans.set(ip, now + CREATE_BAN_DURATION_MS);
      return { allowed: false };
    }

    knownRooms.add(room);
    events.set(ip + "|" + room, now);
    return { allowed: true };
  }

  return { checkRoomAccess, knownRooms, events, bans };
}

let fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) fail++;
  console.log(ok ? "ok  " : "FAIL", name, "->", actual, ok ? "" : `(expected ${expected})`);
}

// 场景一:全新房间允许创建
{
  const reg = makeRegistry();
  const r = reg.checkRoomAccess("newroom", "1.1.1.1", 1000);
  check("全新房间允许创建", r.allowed, true);
}

// 场景二:已存在的房间,换一个已经用满配额的 IP 来访问,依然放行
{
  const reg = makeRegistry();
  let t = 1000;
  reg.checkRoomAccess("popular", "1.1.1.1", t);

  // 另一个 IP 把自己的配额刷满(10个新房间)
  for (let i = 0; i < 10; i++) {
    reg.checkRoomAccess("other-" + i, "2.2.2.2", t);
    t += 1000;
  }
  // 这个刷满配额的 IP 访问已经存在的 "popular" 房间,应该照样放行
  const r = reg.checkRoomAccess("popular", "2.2.2.2", t);
  check("已存在房间不受创建配额影响", r.allowed, true);
}

// 场景三:同一 IP 连续开 10 个新房间都允许,第 11 个被拒并封禁
{
  const reg = makeRegistry();
  const ip = "3.3.3.3";
  let t = 1000;
  let allAllowed = true;
  for (let i = 0; i < 10; i++) {
    const r = reg.checkRoomAccess("room-" + i, ip, t);
    if (!r.allowed) allAllowed = false;
    t += 1000;
  }
  check("前10个新房间全部放行", allAllowed, true);

  const r11 = reg.checkRoomAccess("room-11", ip, t);
  check("第11个新房间被拒", r11.allowed, false);
  check("第11个房间没有被标记为已存在", reg.knownRooms.has("room-11"), false);

  // 封禁期间,哪怕是另一个全新房间名也不行
  const r12 = reg.checkRoomAccess("room-12", ip, t + 1000);
  check("封禁期间新房间继续被拒", r12.allowed, false);
}

// 场景四:封禁期满后恢复正常
{
  const reg = makeRegistry();
  const ip = "4.4.4.4";
  let t = 1000;
  for (let i = 0; i < 11; i++) {
    reg.checkRoomAccess("x-" + i, ip, t);
    t += 1000;
  }
  check("确认已被封禁", reg.checkRoomAccess("y-1", ip, t).allowed, false);

  const after24h = t + CREATE_BAN_DURATION_MS + 1;
  check("24小时后解封,可以再开新房间", reg.checkRoomAccess("y-2", ip, after24h).allowed, true);
}

// 场景五:不同 IP 互不影响
{
  const reg = makeRegistry();
  let t = 1000;
  for (let i = 0; i < 11; i++) {
    reg.checkRoomAccess("z-" + i, "5.5.5.5", t);
    t += 1000;
  }
  check("被封的IP确实被封", reg.checkRoomAccess("z-new", "5.5.5.5", t).allowed, false);
  check("另一个IP不受影响", reg.checkRoomAccess("fresh-room", "6.6.6.6", t).allowed, true);
}

// 场景六:窗口期外的旧建房记录不计入配额
{
  const reg = makeRegistry();
  const ip = "7.7.7.7";
  let t = 1000;
  for (let i = 0; i < 10; i++) {
    reg.checkRoomAccess("old-" + i, ip, t);
  }
  t += CREATE_WINDOW_MS + 1000;
  const r = reg.checkRoomAccess("new-after-window", ip, t);
  check("窗口期外的旧记录不计入配额,不误封", r.allowed, true);
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
