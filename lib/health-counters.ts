/**
 * 进程内健康计数器（10/4稳定性工程环2：可观测汇聚——反静默失效）
 *
 * 语义：Vercel Node runtime进程窗口期指标——进程重启清零，值代表"自上次冷启动以来"。
 * health-summary端点聚合本计数器+余额+管道时间戳，供巡检cron一个请求看全内部健康。
 *
 * 埋点约定（新埋点沿用前缀分层）：
 *   ai_ok_{channel} / ai_fail_{channel}  —— model-gateway各AI通道成败
 *   sync_cloud_req / sync_cloud_ok / sync_cloud_fail / sync_cloud_gate_blocked —— Supabase直写通道
 *   sync_gh_req / sync_gh_ok / sync_gh_fail / sync_gh_gate_blocked —— GitHub供血通道
 */

const counters = new Map<string, number>();
const startedAt = Date.now();

export function bump(key: string, by = 1): void {
  counters.set(key, (counters.get(key) || 0) + by);
}

export function snapshot(): { counters: Record<string, number>; since: string } {
  const out: Record<string, number> = {};
  counters.forEach((v, k) => { out[k] = v; });
  return { counters: out, since: new Date(startedAt).toISOString() };
}
