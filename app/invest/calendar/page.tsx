"use client";

import { useEffect, useMemo, useState } from "react";

type EarningItem = {
  date: string;
  symbol: string;
  name: string;
  epsEstimate: number | null;
  hour: string;
};

type CalendarData = {
  from: string;
  to: string;
  earnings: EarningItem[];
};

const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function formatAnnouncementTime(hour: string) {
  return {
    bmo: "盘前",
    amc: "盘后",
    dmh: "盘中",
  }[hour] || "待定";
}

function formatGroupTitle(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  return `${WEEKDAY_NAMES[value.getUTCDay()]} · ${value.getUTCMonth() + 1}月${value.getUTCDate()}日`;
}

export default function CalendarPage() {
  const [data, setData] = useState<CalendarData | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadCalendar() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/invest/calendar", { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || "财报日历加载失败");
      setData(json.data as CalendarData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "财报日历加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCalendar();
  }, []);

  const grouped = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = (data?.earnings ?? []).filter((item) => (
      !normalizedQuery
      || item.symbol.toLowerCase().includes(normalizedQuery)
      || item.name.toLowerCase().includes(normalizedQuery)
    ));
    return filtered.reduce<Record<string, EarningItem[]>>((groups, item) => {
      (groups[item.date] ??= []).push(item);
      return groups;
    }, {});
  }, [data, query]);

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-[var(--text-muted)]">本周事件</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">财报日历</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {data ? `${data.from} 至 ${data.to}` : "查看本周美股盈利发布安排"}
          </p>
        </div>
        <button
          onClick={() => void loadCalendar()}
          disabled={loading}
          className="self-start rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--text)] disabled:opacity-40 sm:self-auto"
        >
          {loading ? "刷新中…" : "刷新日历"}
        </button>
      </header>

      <div className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索股票代码或公司名"
          className="w-full rounded-xl border border-[var(--border-strong)] px-4 py-3 text-sm outline-none transition-colors focus:border-[var(--text)]"
        />
      </div>

      {error ? (
        <div className="rounded-xl bg-[var(--negative-bg)] px-4 py-3 text-sm text-[var(--negative)]">{error}</div>
      ) : null}

      {loading && !data ? (
        <div className="animate-pulse space-y-4">
          {[0, 1, 2].map((item) => <div key={item} className="h-36 rounded-2xl bg-[var(--surface-muted)]" />)}
        </div>
      ) : null}

      {!loading && !error && Object.keys(grouped).length === 0 ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center">
          <p className="text-sm font-medium">没有匹配的财报安排</p>
          <p className="mt-2 text-xs text-[var(--text-muted)]">换个代码或公司名试试</p>
        </div>
      ) : null}

      <div className="space-y-5">
        {Object.entries(grouped).map(([date, items]) => (
          <section key={date} className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="border-b border-[var(--border)] bg-[var(--surface-subtle)] px-5 py-3">
              <h2 className="text-sm font-semibold">{formatGroupTitle(date)}</h2>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">{items.length} 家公司</p>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {items.map((item) => (
                <div key={`${item.date}-${item.symbol}`} className="grid gap-3 px-5 py-4 sm:grid-cols-[100px_1fr_120px_80px] sm:items-center">
                  <span className="w-fit rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold">{item.symbol}</span>
                  <span className="min-w-0 truncate text-sm font-medium">{item.name}</span>
                  <span className="text-sm text-[var(--text-secondary)]">
                    EPS预期 {item.epsEstimate == null ? "—" : item.epsEstimate.toFixed(2)}
                  </span>
                  <span className="text-xs font-medium text-[var(--text-muted)]">{formatAnnouncementTime(item.hour)}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-6 text-xs leading-6 text-[var(--text-muted)]">
        数据来自 Finnhub，发布时间和预期值可能调整。仅供研究参考，请以公司公告为准。
      </p>
    </div>
  );
}
