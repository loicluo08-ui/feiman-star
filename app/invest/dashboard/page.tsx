"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type WatchItem = {
  code: string;
  name?: string;
  price?: number;
  changePct?: number;
  volume?: number;
  marketCap?: number;
  sparkline?: number[];
};

const STORAGE_KEY = "feimanstar_us_watchlist";
const ALERT_THRESHOLD = 3; // 涨跌幅超过3%标为异动

type SortKey = "changePct" | "price" | "marketCap" | "volume";

export default function DashboardPage() {
  const [list, setList] = useState<WatchItem[]>([]);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("changePct");
  const [sortDesc, setSortDesc] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 加载本地存储
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setList(JSON.parse(saved));
      } catch {
        // ignore
      }
    }
  }, []);

  // 保存到本地存储
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }, [list]);

  // 用 ref 持有最新 list，避免定时器引用过期快照
  const listRef = useRef<WatchItem[]>([]);
  listRef.current = list;

  async function refreshPrices() {
    const items = listRef.current;
    if (items.length === 0) return;
    const results = await Promise.allSettled(
      items.map(async (item) => {
        const res = await fetch(`/api/invest/stock?code=${encodeURIComponent(item.code)}`);
        if (!res.ok) return item;
        const json = await res.json();
        const d = json.data;
        const sparkline = d.candles
          ?.filter((c: { close: number | null }) => c.close != null)
          .map((c: { close: number | null }) => c.close as number)
          .slice(-15) ?? [];
        return {
          ...item,
          name: d.name ?? item.name,
          price: d.price ?? undefined,
          changePct: d.changePct ?? undefined,
          volume: d.volume ?? undefined,
          marketCap: d.marketCap ?? undefined,
          sparkline,
        } as WatchItem;
      }),
    );

    setList((prev) => {
      const updated = prev.map((item) => {
        const idx = prev.findIndex((p) => p.code === item.code);
        if (idx === -1) return item;
        const result = results[idx];
        if (result && result.status === "fulfilled") return result.value;
        return item;
      });
      return updated;
    });
    setLastUpdate(new Date());
  }

  // 初始加载+定时刷新
  useEffect(() => {
    if (list.length > 0) {
      refreshPrices();
      timerRef.current = setInterval(refreshPrices, 30000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.length]);

  async function add(e: FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c || list.some((i) => i.code === c)) {
      setError(c ? "已在看板中" : "请输入代码");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/invest/stock?code=${encodeURIComponent(c)}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "添加失败");
      }
      const json = await res.json();
      const d = json.data;
      const sparkline = d.candles
        ?.filter((candle: { close: number | null }) => candle.close != null)
        .map((candle: { close: number | null }) => candle.close as number)
        .slice(-15) ?? [];

      const newItem: WatchItem = {
        code: d.code,
        name: d.name,
        price: d.price ?? undefined,
        changePct: d.changePct ?? undefined,
        volume: d.volume ?? undefined,
        marketCap: d.marketCap ?? undefined,
        sparkline,
      };
      setList((prev) => [...prev, newItem]);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加失败");
    } finally {
      setLoading(false);
    }
  }

  function remove(code: string) {
    setList((prev) => prev.filter((i) => i.code !== code));
  }

  function clearAll() {
    if (confirm("确定清空所有自选股？")) {
      setList([]);
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDesc(!sortDesc);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  const sorted = [...list].sort((a, b) => {
    const av = a[sortKey] ?? -Infinity;
    const bv = b[sortKey] ?? -Infinity;
    return sortDesc ? bv - av : av - bv;
  });

  const alertCount = list.filter((i) => i.changePct != null && Math.abs(i.changePct) >= ALERT_THRESHOLD).length;

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">自选看板</h1>
            <p className="mt-2 text-sm text-[#6e6e73]">
              {list.length > 0
                ? `${list.length} 只自选股 · 30秒自动刷新${lastUpdate ? ` · 最后更新 ${lastUpdate.toLocaleTimeString("zh-CN")}` : ""}`
                : "添加美股代码到自选列表，实时监控行情"}
            </p>
          </div>
          {list.length > 0 ? (
            <div className="flex gap-2">
              <button
                onClick={() => refreshPrices(list)}
                className="rounded-lg border border-[#e5e5e7] px-3 py-2 text-xs font-medium text-[#6e6e73] transition-colors hover:border-[#1a1a1a]"
              >
                手动刷新
              </button>
              <button
                onClick={clearAll}
                className="rounded-lg border border-[#e5e5e7] px-3 py-2 text-xs font-medium text-[#8e8e93] transition-colors hover:border-red-400 hover:text-red-600"
              >
                清空
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {/* 添加股票 */}
      <form onSubmit={add} className="flex gap-2.5">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="美股代码，如 AAPL"
          className="min-w-0 flex-1 rounded-xl border border-[#d1d1d6] px-4 py-3 text-sm uppercase outline-none focus:border-[#1a1a1a]"
          maxLength={6}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={loading || !code.trim()}
          className="shrink-0 rounded-xl bg-[#1a1a1a] px-5 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {loading ? "添加中…" : "添加"}
        </button>
      </form>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      {/* 异动提醒 */}
      {alertCount > 0 ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-[#fffbeb] px-4 py-2.5">
          <span className="text-sm">⚠️</span>
          <p className="text-sm text-[#d97706]">
            {alertCount} 只股票今日涨跌幅超过 {ALERT_THRESHOLD}%，请关注
          </p>
        </div>
      ) : null}

      {/* 空状态 */}
      {list.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-[#e5e5e7] bg-white py-16 text-center">
          <p className="text-sm text-[#8e8e93]">还没有自选股</p>
          <p className="mt-1 text-xs text-[#8e8e93]">试试添加 AAPL / TSLA / NVDA</p>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-[#e5e5e7] bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e5e5e7] text-xs text-[#8e8e93]">
                <th className="px-4 py-3 text-left font-medium">股票</th>
                <th className="cursor-pointer px-4 py-3 text-right font-medium hover:text-[#1a1a1a]" onClick={() => toggleSort("price")}>
                  价格 {sortKey === "price" ? (sortDesc ? "↓" : "↑") : ""}
                </th>
                <th className="cursor-pointer px-4 py-3 text-right font-medium hover:text-[#1a1a1a]" onClick={() => toggleSort("changePct")}>
                  涨跌幅 {sortKey === "changePct" ? (sortDesc ? "↓" : "↑") : ""}
                </th>
                <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">走势</th>
                <th className="cursor-pointer px-4 py-3 text-right font-medium hover:text-[#1a1a1a]" onClick={() => toggleSort("volume")}>
                  成交量 {sortKey === "volume" ? (sortDesc ? "↓" : "↑") : ""}
                </th>
                <th className="cursor-pointer px-4 py-3 text-right font-medium hover:text-[#1a1a1a]" onClick={() => toggleSort("marketCap")}>
                  市值 {sortKey === "marketCap" ? (sortDesc ? "↓" : "↑") : ""}
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f2f2f3]">
              {sorted.map((item) => {
                const isAlert = item.changePct != null && Math.abs(item.changePct) >= ALERT_THRESHOLD;
                const isUp = item.changePct != null && item.changePct >= 0;
                const colorClass = isUp ? "text-[#16a34a]" : "text-[#dc2626]";
                const bgClass = isAlert ? (isUp ? "bg-[#f0fdf4]" : "bg-[#fef2f2]") : "";

                return (
                  <tr key={item.code} className={bgClass}>
                    <td className="px-4 py-3">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold">{item.code}</span>
                        <span className="max-w-[120px] truncate text-xs text-[#8e8e93]">{item.name ?? ""}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium tabular-nums">
                      {item.price != null ? `$${item.price.toFixed(2)}` : "—"}
                    </td>
                    <td className={`px-4 py-3 text-right text-sm font-medium tabular-nums ${colorClass}`}>
                      {item.changePct != null ? `${item.changePct >= 0 ? "+" : ""}${item.changePct.toFixed(2)}%` : "—"}
                      {isAlert ? <span className="ml-1 text-xs">⚠️</span> : null}
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      {item.sparkline && item.sparkline.length >= 2 ? (
                        <Sparkline data={item.sparkline} isUp={isUp} />
                      ) : (
                        <span className="text-xs text-[#8e8e93]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-xs tabular-nums text-[#6e6e73]">
                      {fmtVol(item.volume)}
                    </td>
                    <td className="px-4 py-3 text-right text-xs tabular-nums text-[#6e6e73]">
                      {fmtAmt(item.marketCap)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => remove(item.code)}
                        className="text-xs text-[#8e8e93] transition-colors hover:text-red-600"
                      >
                        移除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-8 text-xs text-[#8e8e93]">
        行情数据来自 Yahoo Finance，30秒自动刷新。仅供研究参考，不构成投资建议。
      </p>
    </div>
  );
}

/* === 组件 === */

function Sparkline({ data, isUp }: { data: number[]; isUp: boolean }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const W = 80;
  const H = 28;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const color = isUp ? "#16a34a" : "#dc2626";
  const pathD = `M ${points.join(" L ")}`;

  return (
    <svg width={W} height={H} className="inline-block">
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* === 格式化 === */

function fmtVol(v?: number): string {
  if (v == null) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(0);
}

function fmtAmt(v?: number): string {
  if (v == null) return "—";
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  return v.toFixed(0);
}
