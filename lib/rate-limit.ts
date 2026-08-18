/** RATE_LIMITS 配置 */

export const RATE_LIMITS = {
  chat: { maxRequests: 10, windowMs: 60_000 },   // 10次/分
  pick: { maxRequests: 3, windowMs: 60_000 },     // 3次/分
  review: { maxRequests: 5, windowMs: 60_000 },   // 5次/分
  flash: { maxRequests: 30, windowMs: 60_000 },   // 30次/分
  stock: { maxRequests: 20, windowMs: 60_000 },   // 20次/分
  search: { maxRequests: 20, windowMs: 60_000 },  // 20次/分
} as const;

/** KV限流（如果配置了KV环境变量则启用全局限流，否则降级为内存限流）
 *  部署步骤：
 *  1. Vercel Dashboard → Storage → Create KV (免费)
 *  2. Connect to project → feiman-star
 *  3. 自动注入环境变量 KV_REST_API_URL / KV_REST_API_TOKEN
 *  4. 限流自动切换为全局模式
 */

export async function globalRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  // 有KV → 全局限流
  if (kvUrl && kvToken) {
    try {
      const now = Date.now();
      const windowKey = `rl:${key}:${Math.floor(now / windowMs)}`;
      const countRes = await fetch(`${kvUrl}/incr/${windowKey}`, {
        headers: { Authorization: `Bearer ${kvToken}` },
        signal: AbortSignal.timeout(2000),
      });
      if (countRes.ok) {
        const count = parseInt(await countRes.text(), 10);
        if (count === 1) {
          // 第一个请求，设置过期
          await fetch(`${kvUrl}/expire/${windowKey}/${Math.ceil(windowMs / 1000)}`, {
            headers: { Authorization: `Bearer ${kvToken}` },
            signal: AbortSignal.timeout(1000),
          }).catch(() => null);
        }
        const allowed = count <= maxRequests;
        return {
          allowed,
          remaining: Math.max(0, maxRequests - count),
          resetAt: now + windowMs,
        };
      }
    } catch {
      // KV挂了→降级内存
    }
  }

  // 无KV → 内存限流（单实例有效）
  return memRateLimit(key, maxRequests, windowMs);
}

// 内存限流（降级用）
type RateBucket = { timestamps: number[] };
const buckets = new Map<string, RateBucket>();

function memRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetAt: number } {
  const bucket = buckets.get(key) ?? { timestamps: [] };
  const now = Date.now();
  bucket.timestamps = bucket.timestamps.filter((t) => t > now - windowMs);

  if (bucket.timestamps.length >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: (bucket.timestamps[0] ?? now) + windowMs };
  }

  bucket.timestamps.push(now);
  buckets.set(key, bucket);

  return { allowed: true, remaining: maxRequests - bucket.timestamps.length, resetAt: now + windowMs };
}

export function getClientIP(request: Request): string {
  const headers = request.headers;
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip")?.trim() ??
    "unknown"
  );
}

export function buildRateLimitKey(ip: string, route: string): string {
  return `${ip}:${route}`;
}

/** 同步限流（兼容旧接口，内存模式） */
export function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetAt: number } {
  return memRateLimit(key, maxRequests, windowMs);
}

/** 异步限流（推荐，支持KV全局模式） */
export async function enforceRateLimitAsync(
  request: Request,
  route: string,
  config: { maxRequests: number; windowMs: number },
): Promise<null | { allowed: false; remaining: 0; resetAt: number; retryAfter: number }> {
  const ip = getClientIP(request);
  const key = buildRateLimitKey(ip, route);
  const result = await globalRateLimit(key, config.maxRequests, config.windowMs);

  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
    return { allowed: false, remaining: 0, resetAt: result.resetAt, retryAfter: Math.max(1, retryAfter) };
  }

  return null;
}

/** 同步限流（兼容旧接口） */
export function enforceRateLimit(
  request: Request,
  route: string,
  config: { maxRequests: number; windowMs: number },
): null | { allowed: false; remaining: 0; resetAt: number; retryAfter: number } {
  const ip = getClientIP(request);
  const key = buildRateLimitKey(ip, route);
  const result = memRateLimit(key, config.maxRequests, config.windowMs);

  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
    return { allowed: false, remaining: 0, resetAt: result.resetAt, retryAfter: Math.max(1, retryAfter) };
  }

  return null;
}
