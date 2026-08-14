"use client";

import { useEffect, useState } from "react";

type IndexData = {
  symbol: string;
  name: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
};

type SectorData = IndexData;

type PulseData = {
  indices: IndexData[];
  sectors: SectorData[];
  sentiment: string;
  strongestSector: string | null;
  weakestSector: string | null;
  timestamp: string;
} | null;

export default function MarketPage() {
  const [data, setData] = useState<PulseData>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  async function fetchPulse() {
    try {
      const res = await fetch("/api/invest/market-pulse");
      if (!res.ok) throw new Error("获取失败");
      const json = await res.json();
      setData(json.data);
      setLastUpdate(new Date());
      setError("");
    } catch {
      setError("市场数据暂时不可用");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPulse();
    const timer = setInterval(fetchPulse, 30000);
    return () => clearInterval(timer);
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-12">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded-lg bg-[#f2f2f3]" />
          <div className="h-32 rounded-2xl bg-[#f2f2f3]" />
          <div className="h-64 rounded-2xl bg-[#f2f2f3]" />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-12">
        <p className="text-red-600">{error}</p>
        <button onClick={fetchPulse} className="mt-4 rounded-lg border border-[#e5e5e7] px-4 py-2 text-sm hover:border-[#1a1a1a]">
          重试
        </button>
      </div>
    );
  }

  if (!data) return null;

  const sentimentColor = {
    "偏乐观": "text-[#16a34a] bg-[#f0fdf4]",
    "中性": "text-[#8e8e93] bg-[#f7f7f8]",
    "偏悲观": "text-[#d97706] bg-[#fffbeb]",
    "恐慌": "text-[#dc2626] bg-[#fef2f2]",
  }[data.sentiment] || "text-[#8e8e93] bg-[#f7f7f8]";

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">市场快报</h1>
          <p className="mt-1 text-sm text-[#6e6e73]">实时大盘指数+板块轮动+市场情绪</p>
        </div>
        <button
          onClick={fetchPulse}
          className="rounded-lg border border-[#e5e5e7] px-3 py-2 text-xs font-medium text-[#6e6e73] transition-colors hover:border-[#1a1a1a]"
        >
          刷新
        </button>
      </header>

      {/* 市场情绪 */}
      <div className="mb-6 rounded-2xl border border-[#e5e5e7] bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[#8e8e93]">市场情绪</p>
            <p className={`mt-1 inline-block rounded-lg px-3 py-1 text-lg font-semibold ${sentimentColor}`}>
              {data.sentiment}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-[#8e8e93]">最强板块</p>
            <p className="mt-1 text-base font-medium text-[#16a34a]">{data.strongestSector || "—"}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-[#8e8e93]">最弱板块</p>
            <p className="mt-1 text-base font-medium text-[#dc2626]">{data.weakestSector || "—"}</p>
          </div>
        </div>
      </div>

      {/* 大盘指数 */}
      <h2 className="mb-3 text-sm font-semibold text-[#8e8e93]">大盘指数</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {data.indices.map((idx) => (
          <div key={idx.symbol} className="rounded-xl border border-[#e5e5e7] bg-white p-4">
            <p className="text-xs text-[#8e8e93]">{idx.name}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {idx.price != null ? `$${idx.price.toFixed(2)}` : "—"}
            </p>
            {idx.changePct != null && (
              <p className={`mt-0.5 text-xs font-medium tabular-nums ${idx.changePct >= 0 ? "text-[#16a34a]" : "text-[#dc2626]"}`}>
                {idx.changePct >= 0 ? "▲" : "▼"} {Math.abs(idx.changePct).toFixed(2)}%
              </p>
            )}
          </div>
        ))}
      </div>

      {/* 板块涨跌 */}
      <h2 className="mb-3 text-sm font-semibold text-[#8e8e93]">板块涨跌</h2>
      <div className="overflow-hidden rounded-2xl border border-[#e5e5e7] bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e5e5e7] bg-[#f7f7f8]">
              <th className="px-4 py-2 text-left text-xs font-medium text-[#8e8e93]">板块</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-[#8e8e93]">价格</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-[#8e8e93]">涨跌幅</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-[#8e8e93]">可视化</th>
            </tr>
          </thead>
          <tbody>
            {[...data.sectors]
              .sort((a, b) => (b.changePct ?? -999) - (a.changePct ?? -999))
              .map((sec) => {
                const pct = sec.changePct ?? 0;
                const barWidth = Math.min(100, Math.abs(pct) * 30);
                return (
                  <tr key={sec.symbol} className="border-b border-[#f2f2f3] last:border-0">
                    <td className="px-4 py-2.5 text-[#1a1a1a]">{sec.name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#6e6e73]">
                      {sec.price != null ? `$${sec.price.toFixed(2)}` : "—"}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${pct >= 0 ? "text-[#16a34a]" : "text-[#dc2626]"}`}>
                      {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`inline-block h-2 rounded-full ${pct >= 0 ? "bg-[#16a34a]" : "bg-[#dc2626]"}`} style={{ width: `${barWidth}px` }} />
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-xs text-[#8e8e93]">
        数据来自Finnhub实时API，30秒自动刷新。仅供研究参考，不构成投资建议。
        {lastUpdate && <span className="ml-2">最后更新：{lastUpdate.toLocaleTimeString("zh-CN")}</span>}
      </p>
    </div>
  );
}
