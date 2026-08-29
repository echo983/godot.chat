/**
 * 按 key(通常是 IP)做的内存级滑动窗口限流,只在当前 isolate 生命周期内有效,
 * 不追求全局/跨边缘节点精确一致——诊断接口、一般请求限流这类场景不值得为了
 * 精确性起一个 Durable Object。isolate 被回收就重置,Map 大小也有个粗糙上限
 * 防止真被刷爆时无限增长。
 *
 * 不依赖任何 Workers 专属 API,可以在普通 Node 里直接 import 测试。
 */
export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  maxTrackedKeys?: number;
}

export function createRateLimiter(options: RateLimiterOptions): (key: string, now: number) => boolean {
  const counts = new Map<string, { count: number; windowStart: number }>();
  const maxTrackedKeys = options.maxTrackedKeys ?? 20000;

  return function isRateLimited(key: string, now: number): boolean {
    if (counts.size > maxTrackedKeys) counts.clear();

    const entry = counts.get(key);
    if (!entry || now - entry.windowStart > options.windowMs) {
      counts.set(key, { count: 1, windowStart: now });
      return false;
    }
    entry.count++;
    return entry.count > options.max;
  };
}
