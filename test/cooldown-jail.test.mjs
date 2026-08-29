// 复刻 chat-room.ts 里 registerIdentitySwitch / 冷却检查的逻辑,用内存 Map 模拟
// SQLite 表。理由见 identity-hash.test.mjs 顶部注释——chat-room.ts 是 Durable Object,
// 依赖 Workers 运行时,没法直接 import 到普通 Node 里跑。

const IDENTITY_SWITCH_WINDOW_MS = 10 * 60 * 1000;
const IDENTITY_SWITCH_THRESHOLD = 10;
const JAIL_DURATION_MS = 4 * 60 * 60 * 1000;
const MESSAGE_COOLDOWN_MS = 5_000;

function makeRoom() {
  const identities = new Map(); // hashId -> lastMessageTs
  const sightings = new Map(); // `${ip}|${hashId}` -> firstSeenTs
  const jail = new Map(); // ip -> jailedUntil

  function isJailed(ip, now) {
    const until = jail.get(ip);
    return until !== undefined && until > now;
  }

  function registerIdentitySwitch(ip, hashId, now) {
    if (isJailed(ip, now)) return true;

    const key = ip + "|" + hashId;
    if (!sightings.has(key)) sightings.set(key, now);

    const windowStart = now - IDENTITY_SWITCH_WINDOW_MS;
    for (const [k, ts] of sightings) {
      if (ts < windowStart) sightings.delete(k);
    }

    let count = 0;
    for (const [k, ts] of sightings) {
      if (k.startsWith(ip + "|")) count++;
    }

    if (count <= IDENTITY_SWITCH_THRESHOLD) return false;

    jail.set(ip, now + JAIL_DURATION_MS);
    return true;
  }

  function checkCooldown(hashId, now) {
    const lastTs = identities.get(hashId);
    if (lastTs !== undefined && now - lastTs < MESSAGE_COOLDOWN_MS) return false; // blocked
    identities.set(hashId, now);
    return true; // allowed
  }

  return { isJailed, registerIdentitySwitch, checkCooldown };
}

let fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) fail++;
  console.log(ok ? "ok  " : "FAIL", name, "->", actual, ok ? "" : `(expected ${expected})`);
}

// --- 冷却测试 ---
{
  const room = makeRoom();
  let t = 1_000_000;
  check("首次发言允许", room.checkCooldown("aaa", t), true);
  t += 2000; // 2 秒后
  check("2秒内再发被拒", room.checkCooldown("aaa", t), false);
  t += 3001; // 累计过了 5.001 秒
  check("满5秒后允许", room.checkCooldown("aaa", t), true);

  // 不同身份互不影响
  check("不同身份不受冷却影响", room.checkCooldown("bbb", t), true);
}

// --- 同一身份反复重连,单独一个房间测,不跟下面的换身份计数混在一起 ---
{
  const room = makeRoom();
  const ip = "1.2.3.4";
  let t = 1_000_000;

  for (let i = 0; i < 5; i++) {
    room.registerIdentitySwitch(ip, "same-hash", t);
    t += 1000;
  }
  check("同一身份反复 hello 不触发封禁", room.isJailed(ip, t), false);
}

// --- 换身份封禁测试(全新的房间/IP,从 0 开始计数)---
{
  const room = makeRoom();
  const ip = "1.2.3.4";
  let t = 1_000_000;

  // 换 10 个不同身份,还不该封(阈值是 >10 才封)
  for (let i = 0; i < 10; i++) {
    room.registerIdentitySwitch(ip, "hash-" + i, t);
    t += 1000;
  }
  check("恰好10个不同身份,还不封", room.isJailed(ip, t), false);

  // 第 11 个不同身份,应该触发封禁
  const jailedNow = room.registerIdentitySwitch(ip, "hash-11", t);
  check("第11个不同身份触发封禁(返回值)", jailedNow, true);
  check("第11个不同身份触发封禁(状态)", room.isJailed(ip, t), true);

  // 封禁期间,哪怕用老身份也直接判定为 jailed
  check("封禁期间任何请求都判定为 jailed", room.registerIdentitySwitch(ip, "same-hash", t), true);

  // 4小时后解封
  const after4h = t + JAIL_DURATION_MS + 1;
  check("4小时后解封", room.isJailed(ip, after4h), false);

  // 不同 IP 不受影响
  check("不同IP不受影响", room.isJailed("9.9.9.9", t), false);
}

// --- 时间窗口外的旧记录不计入 ---
{
  const room = makeRoom();
  const ip = "5.6.7.8";
  let t = 1_000_000;

  for (let i = 0; i < 10; i++) {
    room.registerIdentitySwitch(ip, "old-" + i, t);
  }
  // 过了窗口期之后再来一个新身份,老的10个应该已经被清掉,不该触发封禁
  t += IDENTITY_SWITCH_WINDOW_MS + 1000;
  const jailed = room.registerIdentitySwitch(ip, "new-1", t);
  check("窗口期外的旧身份不计入,不误封", jailed, false);
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
