import { createRateLimiter } from "../src/rate-limit.ts";

let fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) fail++;
  console.log(ok ? "ok  " : "FAIL", name, "->", actual, ok ? "" : `(expected ${expected})`);
}

// --- 基本窗口内计数 ---
{
  const isLimited = createRateLimiter({ windowMs: 10_000, max: 3 });
  let t = 1_000_000;
  check("第1次不限流", isLimited("1.1.1.1", t), false);
  check("第2次不限流", isLimited("1.1.1.1", t), false);
  check("第3次不限流(恰好等于上限)", isLimited("1.1.1.1", t), false);
  check("第4次触发限流", isLimited("1.1.1.1", t), true);
  check("第5次继续限流", isLimited("1.1.1.1", t), true);
}

// --- 不同 key 互不影响 ---
{
  const isLimited = createRateLimiter({ windowMs: 10_000, max: 1 });
  let t = 1_000_000;
  check("key A 第1次不限流", isLimited("a", t), false);
  check("key A 第2次限流", isLimited("a", t), true);
  check("key B 不受 key A 影响", isLimited("b", t), false);
}

// --- 窗口过期后重置 ---
{
  const isLimited = createRateLimiter({ windowMs: 10_000, max: 1 });
  let t = 1_000_000;
  check("窗口内第1次不限流", isLimited("c", t), false);
  check("窗口内第2次限流", isLimited("c", t), true);
  t += 10_001; // 过了窗口期
  check("窗口过期后重新计数,不限流", isLimited("c", t), false);
}

// --- maxTrackedKeys 上限保护(粗糙清空,不追求精确)---
{
  const isLimited = createRateLimiter({ windowMs: 10_000, max: 100, maxTrackedKeys: 3 });
  let t = 1_000_000;
  isLimited("k1", t);
  isLimited("k2", t);
  isLimited("k3", t);
  // 触发清空后,新 key 应该还是能正常判定(不会因为内部状态错乱而误判)
  const result = isLimited("k4", t);
  check("超过 maxTrackedKeys 后仍能正常工作", result, false);
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
