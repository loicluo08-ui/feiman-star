/**
 * 宏观锚注入（材料层三期）——9/12长线计划
 * 靶子：质量电池Q4（大盘环境题）具体引用仅5（vs 个股题37-48）——宏观题吃的是利率/美元/情绪数据，
 * 快讯里有时有有时无，锚定化成独立注入块。
 *
 * 数据源：Yahoo chart指数（^TNX=10Y美债收益率、DX=F=美元指数期货）——getYahooChart现成链路
 * 触发：isMacroQuery语义路由（大盘/环境/加仓/美联储类问题才拉，普通个股问题零延迟）
 * 失败语义：静默跳过（软增强）
 */

import { getYahooChart, type YahooChartResult } from "./yahoo-chart";

export function isMacroQuery(text: string): boolean {
  if (!text) return false;
  return /大盘|市场环境|适合加仓|适合减仓|该不该加仓|仓位管理|美联储|加息|降息|利率|纳斯达克指数|标普500|道琼斯|宏观|系统性风险|市场情绪|风险偏好|美债/.test(text);
}

function latestWith5d(chart: YahooChartResult | null): { last: number | null; d5: number | null } {
  if (!chart) return { last: null, d5: null };
  const closes = (chart.indicators?.quote?.[0]?.close ?? []).filter(
    (c): c is number => typeof c === "number" && c > 0,
  );
  if (closes.length < 6) return { last: null, d5: null };
  return { last: closes[closes.length - 1], d5: closes[closes.length - 6] };
}

export async function fetchMacroContext(): Promise<string> {
  try {
    const [tnx, dxy] = await Promise.all([
      getYahooChart("^TNX", "3mo"),
      getYahooChart("DX=F", "3mo"),
    ]);
    const t = latestWith5d(tnx);
    const d = latestWith5d(dxy);
    const rows: string[] = [];
    if (t.last != null && t.d5 != null) {
      const chg = t.last - t.d5;
      rows.push(`10Y美债收益率 ${t.last.toFixed(2)}%（5日${chg >= 0 ? "+" : ""}${chg.toFixed(2)}）`);
    }
    if (d.last != null && d.d5 != null) {
      const chg = d.last - d.d5;
      rows.push(`美元指数期货 ${d.last.toFixed(2)}（5日${chg >= 0 ? "+" : ""}${chg.toFixed(2)}）`);
    }
    if (rows.length === 0) return "";
    return `【宏观锚】${rows.join(" | ")}[利率敏感度与风险偏好判断直接引用此锚，禁止凭记忆报收益率/美元水平]`;
  } catch {
    return "";
  }
}
