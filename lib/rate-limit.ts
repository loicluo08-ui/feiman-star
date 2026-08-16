/**
 * 轻量级内存限流
 * - 滑动窗口算法，单实例有效
 * - Vercel serverless多实例间不共享，但能挡住单实例高频刷
 * - 如需全局限流，后续接入 @upstash/ratelimit + Upstash Redis
 */

type RateBucket = {
  timestamps: number[];
};

const buckets = new Map<string, RateBucket>();

/** 清理过期时间戳 */
function cleanup(bucket: RateBucket, windowMs: number) {
  const now = Date.now();
  const cutoff = now - windowMs;
  bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);
}

/**
 * 检查是否允许请求
 * @param key 限流key（如 IP + 路由名）
 * @param maxRequests 窗口内最大请求数
 * @param windowMs 窗口大小（毫秒）
 * @returns { allowed: boolean; remaining: number; resetAt: number }
 */
export function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetAt: number } {
  const bucket = buckets.get(key) ?? { timestamps: [] };
  cleanup(bucket, windowMs);

  if (bucket.timestamps.length >= maxRequests) {
    const oldest = bucket.timestamps[0] ?? Date.now();
    return {
      allowed: false,
      remaining: 0,
      resetAt: oldest + windowMs,
    };
  }

  bucket.timestamps.push(Date.now());
  buckets.set(key, bucket);

  return {
    allowed: true,
    remaining: maxRequests - bucket.timestamps.length,
    resetAt: Date.now() + windowMs,
  };
}

/**
 * 从请求中提取客户端IP
 */
export function getClientIP(request: Request): string {
  const headers = request.headers;
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip")?.trim() ??
    "unknown"
  );
}

/**
 * 限流配置预设
 */
export const RATE_LIMITS = {
  // chat: 每IP每分钟10次
  chat: { maxRequests: 10, windowMs: 60_000 },
  // pick: 每IP每分钟3次（AI分析最耗资源）
  pick: { maxRequests: 3, windowMs: 60_000 },
  // review: 每IP每分钟5次
  review: { maxRequests: 5, windowMs: 60_000 },
  // 工具：每IP每分钟5次
  tools: { maxRequests: 5, windowMs: 60_000 },
  // 登录/注册：每IP每分钟5次
  auth: { maxRequests: 5, windowMs: 60_000 },
  // 上传：每IP每分钟3次
  upload: { maxRequests: 3, windowMs: 60_000 },
  // 兑换码：每IP每分钟5次
  redeem: { maxRequests: 5, windowMs: 60_000 },
  // admin：每IP每分钟20次
  admin: { maxRequests: 20, windowMs: 60_000 },
  // 搜索：每IP每分钟20次
  search: { maxRequests: 20, windowMs: 60_000 },
  // 行情：每IP每分钟30次
  market: { maxRequests: 30, windowMs: 60_000 },
} as const;

/**
 * 构建限流key
 */
export function buildRateLimitKey(ip: string, route: string): string {
  return `${ip}:${route}`;
}

/**
 * 执行限流检查，返回null表示通过，返回Response表示被拒绝
 */
export function enforceRateLimit(
  request: Request,
  route: string,
  config: { maxRequests: number; windowMs: number },
): null | { allowed: false; remaining: 0; resetAt: number; retryAfter: number } {
  const ip = getClientIP(request);
  const key = buildRateLimitKey(ip, route);
  const result = rateLimit(key, config.maxRequests, config.windowMs);

  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
    return {
      allowed: false,
      remaining: 0,
      resetAt: result.resetAt,
      retryAfter: Math.max(1, retryAfter),
    };
  }

  return null;
}
