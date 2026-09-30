/**
 * AI预算熔断（9/30诊断P1第二道闸——无KV时的服务降级保护）
 *
 * 原理：AI端点调用前查DeepSeek余额（10分钟缓存），低于熔断线则全站AI功能停服503
 * 防护目标：公开无鉴权端点被脚本刷时，损失封顶（余额降到熔断线即停，不再烧穿）
 * 定位：KV限流挡"量"，本层兜底"穿"——KV接入后本层保留为最后防线
 * 失败开放：余额查询故障时放行（不因查余额阻塞正常使用——可用性优先）
 */
const BALANCE_CACHE: { value: number | null; ts: number } = { value: null, ts: 0 };
const TTL = 10 * 60 * 1000; // 10分钟
const FLOOR = 5; // 元

export async function aiBudgetGuard(): Promise<{ allowed: boolean; reason?: string }> {
  const now = Date.now();
  if (BALANCE_CACHE.value !== null && now - BALANCE_CACHE.ts < TTL) {
    if (BALANCE_CACHE.value < FLOOR) {
      return {
        allowed: false,
        reason: `AI服务预算保护中（余额${BALANCE_CACHE.value.toFixed(2)}元低于熔断线${FLOOR}元），充值后自动恢复`,
      };
    }
    return { allowed: true };
  }
  try {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) return { allowed: true };
    const res = await fetch("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const d = await res.json();
      const raw = d?.balance_infos?.[0]?.total_balance;
      const v = typeof raw === "string" ? parseFloat(raw) : null;
      BALANCE_CACHE.value = v;
      BALANCE_CACHE.ts = now;
      if (v !== null && v < FLOOR) {
        return {
          allowed: false,
          reason: `AI服务预算保护中（余额${v.toFixed(2)}元低于熔断线${FLOOR}元），充值后自动恢复`,
        };
      }
    }
  } catch {
    // 查询失败放行——可用性优先
  }
  return { allowed: true };
}
