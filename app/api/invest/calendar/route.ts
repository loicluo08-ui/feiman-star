import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "d9ve1m9r01qv408k7rf0d9ve1m9r01qv408k7rfg";
const PROFILE_CACHE_TTL = 12 * 60 * 60 * 1000;
const profileCache = new Map<string, { name: string; expiresAt: number }>();

type FinnhubEarning = {
  date?: string;
  epsEstimate?: number | null;
  hour?: string;
  symbol?: string;
  name?: string;
};

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getCurrentWeek() {
  const now = new Date();
  const day = now.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + mondayOffset));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { from: formatDate(monday), to: formatDate(sunday) };
}

async function getCompanyName(symbol: string): Promise<string> {
  const cached = profileCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) return cached.name;

  try {
    const response = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`,
      { signal: AbortSignal.timeout(3500) },
    );
    if (!response.ok) return symbol;
    const profile = (await response.json()) as { name?: string };
    const name = profile.name?.trim() || symbol;
    profileCache.set(symbol, { name, expiresAt: Date.now() + PROFILE_CACHE_TTL });
    return name;
  } catch {
    return symbol;
  }
}

/** GET /api/invest/calendar - 本周美股盈利日历 */
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "chat", RATE_LIMITS.chat);
  if (limited) {
    return NextResponse.json(
      { error: `请求过于频繁，请${limited.retryAfter}秒后重试` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const { from, to } = getCurrentWeek();
  try {
    const params = new URLSearchParams({ from, to, token: FINNHUB_KEY });
    const response = await fetch(`https://finnhub.io/api/v1/calendar/earnings?${params}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`finnhub_${response.status}`);

    const payload = (await response.json()) as { earningsCalendar?: FinnhubEarning[] };
    const earnings = (payload.earningsCalendar ?? [])
      .filter((item) => (
        typeof item.date === "string"
        && typeof item.symbol === "string"
        && /^[A-Z][A-Z0-9.-]{0,9}$/.test(item.symbol)
      ))
      .sort((a, b) => `${a.date}-${a.symbol}`.localeCompare(`${b.date}-${b.symbol}`))
      .slice(0, 120);

    const symbolsToResolve = Array.from(new Set(
      earnings.filter((item) => !item.name).slice(0, 48).map((item) => item.symbol as string),
    ));
    const resolvedNames = new Map(
      await Promise.all(symbolsToResolve.map(async (symbol) => [symbol, await getCompanyName(symbol)] as const)),
    );

    return NextResponse.json({
      data: {
        from,
        to,
        earnings: earnings.map((item) => ({
          date: item.date,
          symbol: item.symbol,
          name: item.name?.trim() || resolvedNames.get(item.symbol as string) || item.symbol,
          epsEstimate: typeof item.epsEstimate === "number" ? item.epsEstimate : null,
          hour: item.hour || "",
        })),
      },
    });
  } catch (error) {
    console.error("[invest/calendar]", error);
    return NextResponse.json({ error: "财报日历暂时不可用" }, { status: 503 });
  }
}
