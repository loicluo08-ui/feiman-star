/**
 * server酱推送（10/1 settle微信推送绕行方案——平台投递层断点的产品侧替代）
 * https://sct.ftqq.com/ 微信扫码登录→复制SendKey→配Vercel env SERVERCHAN_SENDKEY即生效
 *
 * 设计宪法3对齐：自动化吃掉记忆负担——结算事件（失效触发/时间盒到期）推到手机，
 * 用户不主动查账本也能看到错账数据点。
 * 事件驱动纪律：只推低频高价值（invalidated/expired），alive/无结算不推（防噪音退化成每日骚扰）。
 * key缺失/网络失败：静默返回false——推送是增强不是依赖，结算主流程绝不因此中断。
 */

const SERVERCHAN_ENDPOINT = "https://sct.ftqq.com";

export interface SettleNotifyItem {
  symbol: string;
  judged_date: string;
  stance: string;
  result: "invalidated" | "expired";
  settle_price: number;
  level: number;
  invalidation: string;
  env_tags?: string | null;
  time_box?: number | null;
}

export function serverChanConfigured(): boolean {
  return !!(process.env.SERVERCHAN_SENDKEY || "").trim();
}

export async function sendServerChan(title: string, desp: string): Promise<boolean> {
  const key = (process.env.SERVERCHAN_SENDKEY || "").trim();
  if (!key) return false;
  try {
    const res = await fetch(`${SERVERCHAN_ENDPOINT}/${key}.send`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ title: title.slice(0, 32), desp }).toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { code?: number };
    return json.code === 0;
  } catch {
    return false;
  }
}

/** 结算事件汇总推送：只收invalidated/expired，空集合不推。返回是否实际推送 */
export async function notifySettleEvents(items: SettleNotifyItem[]): Promise<boolean> {
  if (!serverChanConfigured() || items.length === 0) return false;
  const lines = items.map((it) => {
    const label = it.result === "invalidated" ? "✗ 失效触发" : "⏱ 时间盒到期";
    const env = it.env_tags ? `｜环境：${it.env_tags}` : "";
    const tb = it.time_box ? `｜时间盒${it.time_box}日` : "";
    return `**${label}** ${it.symbol}（${it.judged_date}判断，${it.stance}）\n失效条件：${it.invalidation}\n结算价 ${it.settle_price} vs 失效位 ${it.level}${env}${tb}`;
  });
  const title = items.length === 1 ? `1条判断结算需复盘：${items[0].symbol}` : `${items.length}条判断结算需复盘`;
  const desp = `${lines.join("\n\n---\n\n")}\n\n> 错账是数据点不是惩罚——纪律核验，方向归市场。\n> 详情：https://sufve.com/invest/ledger`;
  return sendServerChan(title, desp);
}
