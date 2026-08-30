import {
  GC_CYCLE_MS,
  isGoodPost,
  isInGracePeriod,
  graceDaysRemaining,
  currentGcWindow,
  gcProgress,
} from "../src/gc-time.ts";

let fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(ok ? "ok  " : "FAIL", name, "->", JSON.stringify(actual), ok ? "" : `(expected ${JSON.stringify(expected)})`);
}

// --- isGoodPost ---
check("0票/0票 不是 Good", isGoodPost(0, 0), false);
check("平票(3,3) 不是 Good", isGoodPost(3, 3), false);
check("净负 不是 Good", isGoodPost(2, 5), false);
check("净正 是 Good", isGoodPost(5, 2), true);
check("只有1个好票 是 Good", isGoodPost(1, 0), true);

// --- isInGracePeriod ---
check("刚创建,在观察期", isInGracePeriod(1000, 1000), true);
check("差1毫秒满一个周期,仍在观察期", isInGracePeriod(1000, 1000 + GC_CYCLE_MS - 1), true);
check("恰好满一个周期,不再是观察期", isInGracePeriod(1000, 1000 + GC_CYCLE_MS), false);
check("超过一个周期,不在观察期", isInGracePeriod(1000, 1000 + GC_CYCLE_MS + 1), false);

// --- graceDaysRemaining ---
check("刚创建,还剩7天", graceDaysRemaining(0, 0), 7);
check("差1毫秒满一个周期,还剩1天(向上取整)", graceDaysRemaining(0, GC_CYCLE_MS - 1), 1);

// --- currentGcWindow ---
{
  // 2026-08-30 是周日(用它来推一个确定在周三的时间点做测试基准)
  const wednesday = Date.UTC(2026, 7, 26, 15, 30, 0); // 2026-08-26 周三
  const win = currentGcWindow(wednesday);
  check("周三时,窗口起点是本周日 00:00 UTC", win.start, Date.UTC(2026, 7, 23, 0, 0, 0));
  check("窗口终点 = 起点 + 一个周期", win.end, win.start + GC_CYCLE_MS);
}
{
  // 恰好周日 00:00:00.000 UTC 本身:起点应该就是 now 自己
  const sunday = Date.UTC(2026, 7, 23, 0, 0, 0);
  const win = currentGcWindow(sunday);
  check("恰好周日零点,窗口起点就是当前时刻", win.start, sunday);
}

// --- gcProgress ---
{
  const sunday = Date.UTC(2026, 7, 23, 0, 0, 0);
  const atStart = gcProgress(sunday);
  check("窗口起点,填充比例为0", atStart.fraction, 0);
  check("窗口起点,还剩7天", atStart.daysRemaining, 7);

  const almostEnd = gcProgress(sunday + GC_CYCLE_MS - 1);
  check("窗口终点前1毫秒,填充比例接近1", Math.round(almostEnd.fraction * 1000) / 1000, 1);
  check("窗口终点前1毫秒,还剩1天(取整钳制)", almostEnd.daysRemaining, 1);
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
