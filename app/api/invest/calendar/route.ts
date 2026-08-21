import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getWeekdays(weekOffset: number) {
  const now = new Date();
  const day = now.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + mondayOffset + weekOffset * 7,
  ));
  // 周一~周五（财报不会安排在周末）
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    return formatDate(d);
  });
}

// Nasdaq返回的时间标识 → 前端约定的bmo/amc/dmh
function mapTime(t: string | undefined): string {
  if (t === "time-pre-market") return "bmo";
  if (t === "time-after-hours") return "amc";
  if (t === "time-market-hours") return "dmh";
  return "";
}

// "$128,390,360,872" / "($0.07)" → number | null
function parseMoney(raw: string | undefined): number | null {
  if (!raw || raw === "N/A") return null;
  const neg = raw.startsWith("(");
  const cleaned = raw.replace(/[$,()\s]/g, "");
  const n = parseFloat(cleaned);
  if (isNaN(n)) return null;
  return neg ? -n : n;
}

type NasdaqRow = {
  symbol?: string;
  name?: string;
  time?: string;
  marketCap?: string;
  epsForecast?: string;
};

/** 拉取Nasdaq单日财报日历 */
async function fetchNasdaqDay(date: string): Promise<NasdaqRow[]> {
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
    return json.data?.rows ?? [];
  } catch {
    return [];
  }
}

/** GET /api/invest/calendar?weekOffset=0 - 指定周的美股盈利日历（Nasdaq源） */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "search", RATE_LIMITS.search);
  if (limited) {
    return NextResponse.json(
      { error: `请求过于频繁，请${limited.retryAfter}秒后重试` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const rawWeekOffset = Number(new URL(request.url).searchParams.get("weekOffset") ?? "0");
  const weekOffset = Number.isInteger(rawWeekOffset)
    ? Math.max(-52, Math.min(52, rawWeekOffset))
    : 0;
  const weekdays = getWeekdays(weekOffset);
  const from = weekdays[0];
  const to = weekdays[weekdays.length - 1];

  try {
    // 5个工作日并行拉取
    const dayResults = await Promise.all(weekdays.map((d) => fetchNasdaqDay(d)));

    const earnings = dayResults.flatMap((rows, idx) =>
      rows
        .filter((r) => r.symbol && /^[A-Z][A-Z0-9.-]{0,9}$/.test(r.symbol))
        .map((r) => ({
          date: weekdays[idx],
          symbol: r.symbol as string,
          name: (r.name || "").trim() || (r.symbol as string),
          marketCap: parseMoney(r.marketCap),
          epsEstimate: parseMoney(r.epsForecast),
          hour: mapTime(r.time),
        })),
    );

    earnings.sort((a, b) => `${a.date}-${a.symbol}`.localeCompare(`${b.date}-${b.symbol}`));

    return NextResponse.json({
      data: {
        from,
        to,
        weekOffset,
        earnings: earnings.slice(0, 200),
      },
    });
  } catch (error) {
    console.error("[invest/calendar]", error);
    return NextResponse.json({ error: "财报日历暂时不可用" }, { status: 503 });
  }
}
