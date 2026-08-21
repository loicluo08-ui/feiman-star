"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

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
  changePct5d: number | null;
  changePct20d: number | null;
};

type SectorPeriod = "1d" | "5d" | "20d";

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
  // D1数据时点：腾讯f[30]最新行情时间
  const [dataTime, setDataTime] = useState<string | null>(null);
  const [sectorPeriod, setSectorPeriod] = useState<SectorPeriod>("1d");
  const lastManualRefreshRef = useRef(0);

  useEffect(() => {
    setWatchlist(readWatchlist());
    setHydrated(true);
  }, []);

  // 前端直连腾讯行情（qt.gtimg.cn允许跨域）：实时刷新自选股报价，不依赖服务端出口
  const fetchQtDirect = useCallback(async (symbols: string[]) => {
    if (symbols.length === 0) return;
    try {
      const q = symbols.slice(0, 20).map((s) => `us${s}`).join(",");
      const res = await fetch(`https://qt.gtimg.cn/q=${q}`, { cache: "no-store" });
      if (!res.ok) throw new Error("network_error");
      const text = new TextDecoder("gbk").decode(await res.arrayBuffer());
      // 纯解析：提取行情+最新数据时刻（f[30]美东时间），setState副作用移出updater
      let latestDataTime = "";
      const parsed: Array<{ symbol: string; price: number; change: number | null; changePct: number | null }> = [];
      for (const line of text.split(";")) {
        const m = line.trim().match(/v_us([\w.]+)="([^"]*)"/);
        if (!m) continue;
        const f = m[2].split("~");
        if (f.length < 35) continue;
        const price = parseFloat(f[3]);
        const change = parseFloat(f[31]);
        const changePct = parseFloat(f[32]);
        if (!Number.isFinite(price) || price <= 0) continue;
        parsed.push({
          symbol: m[1],
          price,
          change: Number.isFinite(change) ? change : null,
          changePct: Number.isFinite(changePct) ? changePct : null,
        });
        const t30 = f[30] || "";
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(t30) && t30 > latestDataTime) {
          latestDataTime = t30;
        }
      }
      if (latestDataTime) setDataTime(latestDataTime);
      setQuotes((prev) => {
        const next = { ...prev };
        for (const p of parsed) {
          next[p.symbol] = p;
        }
        return next;
      });
      setLastUpdate(new Date());
    } catch {
      // 直连失败静默，服务端数据兜底
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const symbols = watchlist.map((item) => item.symbol);
    fetchQtDirect(symbols);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") fetchQtDirect(symbols);
    }, 10000);
    return () => clearInterval(timer);
  }, [hydrated, watchlist, fetchQtDirect]);

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
    const timer = window.setInterval(() => void fetchMarket(), 60_000);
    return () => window.clearInterval(timer);
  }, [fetchMarket, hydrated]);

  function handleManualRefresh() {
    const now = Date.now();
    if (now - lastManualRefreshRef.current < 3_000) {
      setError("请稍候3秒再试");
      return;
    }
    lastManualRefreshRef.current = now;
    void fetchMarket(true);
  }

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
          <div className="h-8 w-48 rounded-lg bg-[var(--surface-muted)]" />
          <div className="h-12 rounded-xl bg-[var(--surface-muted)]" />
          <div className="h-72 rounded-2xl bg-[var(--surface-muted)]" />
        </div>
      </div>
    );
  }

  const sentimentColor = {
    "偏乐观": "text-[var(--positive)] bg-[var(--positive-bg)]",
    "中性": "text-[var(--text-muted)] bg-[var(--surface-subtle)]",
    "偏悲观": "text-[var(--warning)] bg-[var(--warning-bg)]",
    "恐慌": "text-[var(--negative)] bg-[var(--negative-bg)]",
  }[pulse?.sentiment ?? ""] || "text-[var(--text-muted)] bg-[var(--surface-subtle)]";
  const getSectorChange = (sector: SectorData, period: SectorPeriod) => (
    period === "1d" ? sector.changePct : period === "5d" ? sector.changePct5d : sector.changePct20d
  );

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">市场快报</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">自选行情+板块轮动+市场情绪</p>
        </div>
        {dataTime && (
          <span className="text-xs text-[var(--text-muted)]">
            行情截至 {dataTime.slice(5, 16)} 美东
          </span>
        )}
        <button
          onClick={handleManualRefresh}
          disabled={refreshing}
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--text)] disabled:opacity-40"
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
          className="min-w-0 flex-1 rounded-xl border border-[var(--border-strong)] px-4 py-3 text-sm uppercase outline-none transition-colors focus:border-[var(--text)]"
        />
        <button
          type="submit"
          disabled={adding || !query.trim()}
          className="shrink-0 rounded-xl bg-[var(--primary)] px-5 py-3 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {adding ? "添加中…" : "添加"}
        </button>
      </form>

      {error ? <p className="mb-5 rounded-lg bg-[var(--negative-bg)] px-4 py-2.5 text-sm text-[var(--negative)]">{error}</p> : null}

      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--text-muted)]">我的自选 ({watchlist.length})</h2>
          <span className="text-xs text-[var(--text-muted)]">涨跌超过3%标记为异动</span>
        </div>
        {watchlist.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-5 py-10 text-center text-sm text-[var(--text-muted)]">
            自选列表为空，在上方输入代码添加
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_40px] border-b border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-muted)] sm:grid-cols-[100px_minmax(0,1fr)_130px_110px_56px]">
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
                  className={`grid grid-cols-[minmax(0,1fr)_auto_auto_40px] items-center border-b border-[var(--border)] px-4 py-3 last:border-0 sm:grid-cols-[100px_minmax(0,1fr)_130px_110px_56px] ${
                    unusual ? "bg-[var(--warning-bg)]" : "bg-[var(--surface)]"
                  }`}
                >
                  <div>
                    <span className="font-semibold text-[var(--text)]">{item.symbol}</span>
                    {unusual ? <span className="ml-1.5 rounded bg-[var(--warning-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--warning)]">异动</span> : null}
                    <p className="mt-0.5 truncate text-xs text-[var(--text-muted)] sm:hidden">{item.name}</p>
                  </div>
                  <span className="hidden truncate pr-3 text-sm text-[var(--text-secondary)] sm:block">{item.name}</span>
                  <span className="text-right font-medium tabular-nums text-[var(--text)]">
                    {quote?.price != null ? `$${quote.price.toFixed(2)}` : "—"}
                  </span>
                  <span className={`text-right text-sm font-medium tabular-nums ${
                    changePct == null ? "text-[var(--text-muted)]" : changePct >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"
                  }`}>
                    {changePct == null ? "—" : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`}
                  </span>
                  <button
                    onClick={() => removeSymbol(item.symbol)}
                    className="text-right text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--negative)]"
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
          <div className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-[var(--text-muted)]">市场情绪</p>
                <p className={`mt-1 inline-block rounded-lg px-3 py-1 text-base font-semibold ${sentimentColor}`}>
                  {pulse.sentiment}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-[var(--text-muted)]">最强板块</p>
                <p className="mt-1 text-sm font-medium text-[var(--positive)]">{pulse.strongestSector || "—"}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-[var(--text-muted)]">最弱板块</p>
                <p className="mt-1 text-sm font-medium text-[var(--negative)]">{pulse.weakestSector || "—"}</p>
              </div>
            </div>
          </div>

          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-[var(--text-muted)]">板块涨跌</h2>
            <div className="flex rounded-lg bg-[var(--surface-muted)] p-1">
              {(["1d", "5d", "20d"] as const).map((period) => (
                <button
                  key={period}
                  onClick={() => setSectorPeriod(period)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    sectorPeriod === period
                      ? "bg-[var(--surface)] text-[var(--text)] shadow-sm"
                      : "text-[var(--text-muted)] hover:text-[var(--text)]"
                  }`}
                >
                  {{ "1d": "1日", "5d": "5日", "20d": "20日" }[period]}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <table className="min-w-[560px] w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-subtle)]">
                  <th className="px-4 py-2 text-left text-xs font-medium text-[var(--text-muted)]">板块</th>
                  <th className={`px-4 py-2 text-right text-xs font-medium ${sectorPeriod === "1d" ? "text-[var(--text)]" : "text-[var(--text-muted)]"}`}>1日涨跌</th>
                  <th className={`px-4 py-2 text-right text-xs font-medium ${sectorPeriod === "5d" ? "text-[var(--text)]" : "text-[var(--text-muted)]"}`}>5日涨跌</th>
                  <th className={`px-4 py-2 text-right text-xs font-medium ${sectorPeriod === "20d" ? "text-[var(--text)]" : "text-[var(--text-muted)]"}`}>20日涨跌</th>
                </tr>
              </thead>
              <tbody>
                {[...pulse.sectors]
                  .sort((a, b) => (getSectorChange(b, sectorPeriod) ?? -999) - (getSectorChange(a, sectorPeriod) ?? -999))
                  .map((sector) => {
                    const periods = [sector.changePct, sector.changePct5d, sector.changePct20d];
                    return (
                      <tr key={sector.symbol} className="border-b border-[var(--border)] last:border-0">
                        <td className="px-4 py-2.5 text-[var(--text)]">{sector.name}</td>
                        {periods.map((pct, index) => (
                          <td
                            key={index}
                            className={`px-4 py-2.5 text-right font-medium tabular-nums ${
                              pct == null ? "text-[var(--text-muted)]" : pct >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"
                            }`}
                          >
                            {pct == null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <p className="mt-6 text-xs text-[var(--text-muted)]">
        自选股报价由浏览器直连腾讯行情实时刷新（10秒），指数与板块数据来自服务端聚合。仅供研究参考，不构成投资建议。
        {lastUpdate ? <span className="ml-2">最后更新：{lastUpdate.toLocaleTimeString("zh-CN")}</span> : null}
      </p>
    </div>
  );
}
