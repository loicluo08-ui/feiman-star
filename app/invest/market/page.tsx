"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type WatchlistItem = {
  symbol: string;
  name: string;
};

type QuoteData = {
  symbol: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
};

type SectorData = QuoteData & {
  name: string;
};

type PulseData = {
  sectors: SectorData[];
  sentiment: string;
  strongestSector: string | null;
  weakestSector: string | null;
  timestamp: string;
};

const WATCHLIST_KEY = "feimanstar_watchlist";
const DEFAULT_WATCHLIST: WatchlistItem[] = [
  { symbol: "SPY", name: "标普500 ETF" },
  { symbol: "QQQ", name: "纳斯达克100 ETF" },
  { symbol: "DIA", name: "道琼斯 ETF" },
  { symbol: "IWM", name: "罗素2000 ETF" },
  { symbol: "UVXY", name: "波动率 ETF" },
];

function readWatchlist(): WatchlistItem[] {
  try {
    const saved = localStorage.getItem(WATCHLIST_KEY);
    if (!saved) return DEFAULT_WATCHLIST;
    const parsed = JSON.parse(saved) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_WATCHLIST;
    const items = parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const value = item as Record<string, unknown>;
      const symbol = typeof value.symbol === "string" ? value.symbol.trim().toUpperCase() : "";
      const name = typeof value.name === "string" ? value.name.trim() : symbol;
      return /^[A-Z]{1,6}$/.test(symbol) ? [{ symbol, name: name || symbol }] : [];
    });
    return items.slice(0, 20);
  } catch {
    return DEFAULT_WATCHLIST;
  }
}

export default function MarketPage() {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(DEFAULT_WATCHLIST);
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({});
  const [pulse, setPulse] = useState<PulseData | null>(null);
  const [query, setQuery] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    setWatchlist(readWatchlist());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
    } catch {
      // localStorage不可用时仍可在当前页面使用。
    }
  }, [hydrated, watchlist]);

  const fetchMarket = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    try {
      const symbols = watchlist.map((item) => item.symbol).join(",");
      const [quotesResult, pulseResult] = await Promise.allSettled([
        symbols
          ? fetch(`/api/invest/market-pulse?symbols=${encodeURIComponent(symbols)}`, { cache: "no-store" })
          : Promise.resolve(null),
        fetch("/api/invest/market-pulse", { cache: "no-store" }),
      ]);

      let updated = false;
      if (quotesResult.status === "fulfilled" && quotesResult.value?.ok) {
        const json = await quotesResult.value.json();
        const nextQuotes = (json.data?.quotes ?? []) as QuoteData[];
        setQuotes(Object.fromEntries(nextQuotes.map((quote) => [quote.symbol, quote])));
        updated = true;
      } else if (watchlist.length === 0) {
        setQuotes({});
      }

      if (pulseResult.status === "fulfilled" && pulseResult.value.ok) {
        const json = await pulseResult.value.json();
        if (json.data) {
          setPulse(json.data as PulseData);
          updated = true;
        }
      }

      if (!updated) throw new Error("market_unavailable");
      setLastUpdate(new Date());
      setError("");
    } catch {
      setError("市场数据暂时不可用，请稍后重试");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [watchlist]);

  useEffect(() => {
    if (!hydrated) return;
    void fetchMarket();
    const timer = window.setInterval(() => void fetchMarket(), 30_000);
    return () => window.clearInterval(timer);
  }, [fetchMarket, hydrated]);

  async function addSymbol(event: FormEvent) {
    event.preventDefault();
    const symbol = query.trim().toUpperCase();
    if (!/^[A-Z]{1,6}$/.test(symbol)) {
      setError("请输入有效的美股或ETF代码，如 AAPL / SPY");
      return;
    }
    if (watchlist.some((item) => item.symbol === symbol)) {
      setError(`${symbol} 已在自选列表中`);
      return;
    }
    if (watchlist.length >= 20) {
      setError("自选列表最多保存20项");
      return;
    }

    setAdding(true);
    setError("");
    try {
      const searchResponse = await fetch(`/api/invest/search?q=${encodeURIComponent(symbol)}`, { cache: "no-store" });
      const searchJson = searchResponse.ok ? await searchResponse.json() : { data: [] };
      const exact = (searchJson.data as Array<{ code: string; name: string }> | undefined)
        ?.find((item) => item.code === symbol);

      if (!exact) {
        const quoteResponse = await fetch(`/api/invest/market-pulse?symbols=${encodeURIComponent(symbol)}`, { cache: "no-store" });
        const quoteJson = quoteResponse.ok ? await quoteResponse.json() : null;
        const quote = quoteJson?.data?.quotes?.[0] as QuoteData | undefined;
        if (!quote || quote.price == null) throw new Error("symbol_not_found");
      }

      setWatchlist((previous) => [...previous, { symbol, name: exact?.name || symbol }]);
      setQuery("");
    } catch {
      setError(`未找到代码 ${symbol}，请检查后重试`);
    } finally {
      setAdding(false);
    }
  }

  function removeSymbol(symbol: string) {
    setWatchlist((previous) => previous.filter((item) => item.symbol !== symbol));
    setQuotes((previous) => {
      const next = { ...previous };
      delete next[symbol];
      return next;
    });
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-12">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded-lg bg-[#f2f2f3]" />
          <div className="h-12 rounded-xl bg-[#f2f2f3]" />
          <div className="h-72 rounded-2xl bg-[#f2f2f3]" />
        </div>
      </div>
    );
  }

  const sentimentColor = {
    "偏乐观": "text-[#16a34a] bg-[#f0fdf4]",
    "中性": "text-[#8e8e93] bg-[#f7f7f8]",
    "偏悲观": "text-[#d97706] bg-[#fffbeb]",
    "恐慌": "text-[#dc2626] bg-[#fef2f2]",
  }[pulse?.sentiment ?? ""] || "text-[#8e8e93] bg-[#f7f7f8]";

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">市场快报</h1>
          <p className="mt-1 text-sm text-[#6e6e73]">自选实时行情+板块轮动+市场情绪</p>
        </div>
        <button
          onClick={() => void fetchMarket(true)}
          disabled={refreshing}
          className="rounded-lg border border-[#e5e5e7] px-3 py-2 text-xs font-medium text-[#6e6e73] transition-colors hover:border-[#1a1a1a] disabled:opacity-40"
        >
          {refreshing ? "刷新中…" : "刷新"}
        </button>
      </header>

      <form onSubmit={addSymbol} className="mb-6 flex gap-2.5">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value.toUpperCase())}
          maxLength={6}
          placeholder="输入股票/ETF代码，如 AAPL / SPY"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-xl border border-[#d1d1d6] px-4 py-3 text-sm uppercase outline-none transition-colors focus:border-[#1a1a1a]"
        />
        <button
          type="submit"
          disabled={adding || !query.trim()}
          className="shrink-0 rounded-xl bg-[#1a1a1a] px-5 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {adding ? "添加中…" : "添加"}
        </button>
      </form>

      {error ? <p className="mb-5 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p> : null}

      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#8e8e93]">我的自选 ({watchlist.length})</h2>
          <span className="text-xs text-[#8e8e93]">涨跌超过3%标记为异动</span>
        </div>
        {watchlist.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#d1d1d6] bg-white px-5 py-10 text-center text-sm text-[#8e8e93]">
            自选列表为空，在上方输入代码添加
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[#e5e5e7] bg-white">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_40px] border-b border-[#e5e5e7] bg-[#f7f7f8] px-4 py-2 text-xs font-medium text-[#8e8e93] sm:grid-cols-[100px_minmax(0,1fr)_130px_110px_56px]">
              <span>代码</span>
              <span className="hidden sm:block">名称</span>
              <span className="text-right">价格</span>
              <span className="text-right">涨跌幅</span>
              <span className="text-right">操作</span>
            </div>
            {watchlist.map((item) => {
              const quote = quotes[item.symbol];
              const changePct = quote?.changePct ?? null;
              const unusual = changePct != null && Math.abs(changePct) > 3;
              return (
                <div
                  key={item.symbol}
                  className={`grid grid-cols-[minmax(0,1fr)_auto_auto_40px] items-center border-b border-[#f2f2f3] px-4 py-3 last:border-0 sm:grid-cols-[100px_minmax(0,1fr)_130px_110px_56px] ${
                    unusual ? "bg-[#fffbeb]" : "bg-white"
                  }`}
                >
                  <div>
                    <span className="font-semibold text-[#1a1a1a]">{item.symbol}</span>
                    {unusual ? <span className="ml-1.5 rounded bg-[#fef3c7] px-1.5 py-0.5 text-[10px] font-medium text-[#b45309]">异动</span> : null}
                    <p className="mt-0.5 truncate text-xs text-[#8e8e93] sm:hidden">{item.name}</p>
                  </div>
                  <span className="hidden truncate pr-3 text-sm text-[#6e6e73] sm:block">{item.name}</span>
                  <span className="text-right font-medium tabular-nums text-[#1a1a1a]">
                    {quote?.price != null ? `$${quote.price.toFixed(2)}` : "—"}
                  </span>
                  <span className={`text-right text-sm font-medium tabular-nums ${
                    changePct == null ? "text-[#8e8e93]" : changePct >= 0 ? "text-[#16a34a]" : "text-[#dc2626]"
                  }`}>
                    {changePct == null ? "—" : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`}
                  </span>
                  <button
                    onClick={() => removeSymbol(item.symbol)}
                    className="text-right text-xs text-[#8e8e93] transition-colors hover:text-[#dc2626]"
                    aria-label={`删除自选 ${item.symbol}`}
                  >
                    删除
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {pulse ? (
        <>
          <div className="mb-6 rounded-2xl border border-[#e5e5e7] bg-white p-5">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-[#8e8e93]">市场情绪</p>
                <p className={`mt-1 inline-block rounded-lg px-3 py-1 text-base font-semibold ${sentimentColor}`}>
                  {pulse.sentiment}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-[#8e8e93]">最强板块</p>
                <p className="mt-1 text-sm font-medium text-[#16a34a]">{pulse.strongestSector || "—"}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-[#8e8e93]">最弱板块</p>
                <p className="mt-1 text-sm font-medium text-[#dc2626]">{pulse.weakestSector || "—"}</p>
              </div>
            </div>
          </div>

          <h2 className="mb-3 text-sm font-semibold text-[#8e8e93]">板块涨跌</h2>
          <div className="overflow-hidden rounded-2xl border border-[#e5e5e7] bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e5e5e7] bg-[#f7f7f8]">
                  <th className="px-4 py-2 text-left text-xs font-medium text-[#8e8e93]">板块</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-[#8e8e93]">价格</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-[#8e8e93]">涨跌幅</th>
                </tr>
              </thead>
              <tbody>
                {[...pulse.sectors]
                  .sort((a, b) => (b.changePct ?? -999) - (a.changePct ?? -999))
                  .map((sector) => {
                    const pct = sector.changePct ?? 0;
                    return (
                      <tr key={sector.symbol} className="border-b border-[#f2f2f3] last:border-0">
                        <td className="px-4 py-2.5 text-[#1a1a1a]">{sector.name}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[#6e6e73]">
                          {sector.price != null ? `$${sector.price.toFixed(2)}` : "—"}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${pct >= 0 ? "text-[#16a34a]" : "text-[#dc2626]"}`}>
                          {sector.changePct == null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <p className="mt-6 text-xs text-[#8e8e93]">
        数据来自Finnhub实时API，30秒自动刷新。仅供研究参考，不构成投资建议。
        {lastUpdate ? <span className="ml-2">最后更新：{lastUpdate.toLocaleTimeString("zh-CN")}</span> : null}
      </p>
    </div>
  );
}
