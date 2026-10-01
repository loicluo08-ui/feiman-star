/**
 * FRED（美联储圣路易斯分行经济数据库）官方接口——免费免key（公开CSV端点）
 * https://fred.stlouisfed.org/graph/fredgraph.csv?id={seriesId}
 * 用途：宏观锚的官方数据源（G-003缺口根治——此前Yahoo非官方源不稳定）
 * 纪律：所有数字标注FRED+日期；失败返回null由调用方降级
 */

const FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv";

export interface FredPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

/** 拉取单一序列最近N条有效观测（value="."为缺失值，剔除） */
export async function fetchFredSeries(seriesId: string, maxPoints = 30): Promise<FredPoint[] | null> {
  try {
    const res = await fetch(`${FRED_CSV}?id=${encodeURIComponent(seriesId)}`, {
      headers: { "User-Agent": "FeimanStar loicluo08-ui" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const csv = await res.text();
    const lines = csv.trim().split("\n");
    if (lines.length < 2) return null;
    // 表头：DATE（或observation_date）,VALUE（或seriesId）——取前两列
    const out: FredPoint[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const date = (cols[0] ?? "").trim();
      const raw = (cols[1] ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) continue; // "."缺失值剔除
      out.push({ date, value });
    }
    return out.length > 0 ? out.slice(-maxPoints) : null;
  } catch {
    return null;
  }
}

/** 月度指数序列→最新同比%（CPI用）：需≥13个月观测 */
export function yoyFromMonthly(points: FredPoint[]): { yoy: number; date: string } | null {
  if (points.length < 13) return null;
  const last = points[points.length - 1];
  const yearAgo = points.find((p) => p.date === lastNearYearAgo(points, last.date));
  if (!yearAgo || yearAgo.value === 0) return null;
  return { yoy: (last.value / yearAgo.value - 1) * 100, date: last.date };
}

function lastNearYearAgo(points: FredPoint[], lastDate: string): string | null {
  const d = new Date(`${lastDate}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  const target = d.toISOString().slice(0, 7); // YYYY-MM
  const hit = points.filter((p) => p.date.startsWith(target));
  return hit.length > 0 ? hit[hit.length - 1].date : null;
}

/** FRED宏观锚块：10Y/联邦基金/CPI同比——官方序列，与Yahoo宏观互为交叉验证 */
export async function buildFredBlock(): Promise<string> {
  const [dgs10, dff, cpi] = await Promise.all([
    fetchFredSeries("DGS10", 10),
    fetchFredSeries("DFF", 10),
    fetchFredSeries("CPIAUCSL", 24),
  ]);
  const rows: string[] = [];
  if (dgs10) {
    const last = dgs10[dgs10.length - 1];
    rows.push(`10Y美债 ${last.value.toFixed(2)}%（FRED ${last.date}）`);
  }
  if (dff) {
    const last = dff[dff.length - 1];
    rows.push(`联邦基金利率 ${last.value.toFixed(2)}%（FRED ${last.date}）`);
  }
  if (cpi) {
    const y = yoyFromMonthly(cpi);
    if (y) rows.push(`CPI同比 ${y.yoy.toFixed(1)}%（FRED ${y.date}）`);
  }
  if (rows.length === 0) return "";
  return rows.join(" | ");
}
