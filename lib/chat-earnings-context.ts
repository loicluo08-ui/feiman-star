// chat财报日历注入（9/6消息源接入）：calendar route已存在但chat没吃——
// 持仓/备兑/加仓类问题里"本周有没有财报"是决策级信息（事件风险/IV），AI此前不知道
import "server-only";

type NasdaqRow = {
  symbol?: string;
  name?: string;
  marketCap?: string;
  epsForecast?: string;
  time?: string;
};

type EarningsEntry = {
  date: string;
  symbol: string;
  name: string;
  marketCap: number | null;
  epsEstimate: number | null;
  hour: string;
};

// 未来导向周计算（区别于calendar route的显示对齐语义）：周日/周六指向下一交易周——
// 即将发生的财报才是决策信息（事件风险未落地），已发生财报价值归零
function getUpcomingWeekdays(): string[] {
  const now = new Date();
  const day = now.getUTCDay();
  // 周日(0)→下周一(+1)；周一~五(1-5)→本周；周六(6)→下周一(+2)
  const mondayOffset = day === 0 ? 1 : day === 6 ? 2 : 1 - day;
  const monday = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + mondayOffset,
  ));
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function mapTime(t: string | undefined): string {
  if (t === "time-pre-market") return "bmo";
  if (t === "time-after-hours") return "amc";
  if (t === "time-market-hours") return "dmh";
  return "";
}

function parseMoney(raw: string | undefined): number | null {
  if (!raw || raw === "N/A") return null;
  const neg = raw.startsWith("(");
  const cleaned = raw.replace(/[$,()\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

async function fetchNasdaqDay(date: string): Promise<EarningsEntry[]> {
  try {
    const res = await fetch(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.nasdaq.com/",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { rows?: NasdaqRow[] } };
    return (json.data?.rows ?? [])
      .filter((r) => r.symbol && /^[A-Z][A-Z0-9.-]{0,9}$/.test(r.symbol))
      .map((r) => ({
        date,
        symbol: r.symbol as string,
        name: (r.name || "").trim() || (r.symbol as string),
        marketCap: parseMoney(r.marketCap),
        epsEstimate: parseMoney(r.epsForecast),
        hour: mapTime(r.time),
      }));
  } catch {
    return [];
  }
}

// 本周日历模块级缓存（30min TTL，与calendar route口径一致）——Nasdaq单次全链路约3s
let weekCache: { entries: EarningsEntry[]; expiresAt: number } | null = null;

async function getThisWeekEarnings(): Promise<EarningsEntry[]> {
  if (weekCache && weekCache.expiresAt > Date.now()) return weekCache.entries;
  const weekdays = getUpcomingWeekdays();
  const dayResults = await Promise.all(weekdays.map((d) => fetchNasdaqDay(d)));
  const entries = dayResults.flat();
  weekCache = { entries, expiresAt: Date.now() + 30 * 60 * 1000 };
  return entries;
}

function formatEntry(entry: EarningsEntry, todayIso: string): string {
  const hourLabel =
    entry.hour === "bmo" ? "盘前" : entry.hour === "amc" ? "盘后" : "盘中";
  const dayOffset = Math.round(
    (Date.parse(entry.date) - Date.parse(todayIso)) / 86_400_000,
  );
  const dayLabel = dayOffset === 0 ? "今天" : dayOffset === 1 ? "明天" : entry.date;
  const epsLabel = entry.epsEstimate != null ? `，EPS预期${entry.epsEstimate}` : "";
  return `- ${entry.symbol}（${entry.name}）：${dayLabel}${hourLabel}发布财报${epsLabel}`;
}

/**
 * 财报日历注入块。
 * - symbols命中本周财报：只给命中的（用户标的的事件风险是决策级信息）
 * - 无命中：给本周重磅财报前5条（市值排序）——大盘环境/加仓类问题的背景拼图
 * - 数据源挂了返回""（软增强，静默跳过）
 */
export async function buildEarningsContext(symbols: string[]): Promise<string> {
  try {
    const entries = await getThisWeekEarnings();
    if (entries.length === 0) return "";

    const symbolSet = new Set(symbols.map((s) => s.toUpperCase()));
    const matched = entries.filter((e) => symbolSet.has(e.symbol));

    const todayIso = new Date().toISOString().slice(0, 10);
    const today = new Date(`${todayIso}T00:00:00Z`);

    let selected: EarningsEntry[];
    let headline: string;
    if (matched.length > 0) {
      selected = matched;
      headline = `【本周财报提醒（与问题标的直接相关）】用户提到的标的本周有财报发布——财报是事件风险（IV飙升/跳空），任何持仓/期权建议必须把财报日纳入考量：`;
    } else {
      const marketCapRank = (e: EarningsEntry) => e.marketCap ?? 0;
      selected = [...entries]
        .filter((e) => Date.parse(`${e.date}T00:00:00Z`) >= today.getTime() - 86_400_000)
        .sort((a, b) => marketCapRank(b) - marketCapRank(a))
        .slice(0, 5);
      if (selected.length === 0) return "";
      headline = "【本周重磅财报（系统自动注入，大盘事件背景）】";
    }

    return [headline, ...selected.map((e) => formatEntry(e, todayIso))].join("\n");
  } catch {
    return "";
  }
}
