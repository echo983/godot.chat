/**
 * 析出层 Phase 2 用到的两块日期数学,单独抽出来:chat-room.ts(真实 GC 判定)
 * 和 pages.ts(帖子页进度条渲染)都从这里 import,避免两处各存一份常量、
 * 手动同步。纯逻辑,不依赖 Workers 运行时,可以直接被测试 import。
 */

export const GC_CYCLE_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// 净分数(好票 - 坏票)> 0 才是 Good;0 票/平票/净负都不是 Good——
// 不是主动投出来的负面判定,是默认状态本身
export function isGoodPost(goodCount: number, badCount: number): boolean {
  return goodCount - badCount > 0;
}

// created_ts 距今不满一个完整 GC 周期,处于观察期——纯时长判断,不做日历对齐
export function isInGracePeriod(createdTs: number, now: number): boolean {
  return now - createdTs < GC_CYCLE_MS;
}

// "新帖子,观察期还剩 N 天"用,向上取整,至少显示 1 天
export function graceDaysRemaining(createdTs: number, now: number): number {
  return Math.max(1, Math.ceil((createdTs + GC_CYCLE_MS - now) / DAY_MS));
}

// 全站统一的 GC 窗口:最近一个过去的周日 00:00 UTC 到下一个周日 00:00 UTC,
// 跟 wrangler.jsonc 的 cron "0 0 * * SUN" 对齐。纯日期算术,不需要存储
// "上次 GC 何时跑"这种状态。
export function currentGcWindow(now: number): { start: number; end: number } {
  const d = new Date(now);
  const startOfToday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const start = startOfToday - d.getUTCDay() * DAY_MS;
  return { start, end: start + GC_CYCLE_MS };
}

// 进度条填充比例(0~1)+ 距下次 GC 还剩几天(向上取整,至少 1)
export function gcProgress(now: number): { fraction: number; daysRemaining: number } {
  const { start, end } = currentGcWindow(now);
  const fraction = Math.min(1, Math.max(0, (now - start) / GC_CYCLE_MS));
  const daysRemaining = Math.max(1, Math.ceil((end - now) / DAY_MS));
  return { fraction, daysRemaining };
}
