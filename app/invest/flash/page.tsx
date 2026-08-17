"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface FlashItem {
  id: string;
  title: string;
  content: string;
  content_text: string;
  time_str: string;
  timestamp: number;
  is_important: boolean;
  channels: number[];
  source: string;
}

type Filter = "all" | "important";

// 金十channel含义: 1=中文 2=A股 3=期货 5=英文 9=深度
const CHANNEL_NAMES: Record<number, string> = {
  1: "中文",
  2: "A股",
  3: "期货",
  5: "英文",
  9: "深度",
};

export default function FlashPage() {
  const [items, setItems] = useState<FlashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [source, setSource] = useState<string>("");
  const [lastUpdate, setLastUpdate] = useState<string>("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevIdsRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const fetchFlash = useCallback(async () => {
    try {
      const res = await fetch("/api/invest/flash", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      const newItems: FlashItem[] = json.data || [];

      setSource(json.source || "");
      setLastUpdate(new Date().toLocaleTimeString("zh-CN"));

      // 找出新增的条目
      if (prevIdsRef.current.size > 0) {
        const newSet = new Set<string>();
        for (const item of newItems) {
          if (!prevIdsRef.current.has(item.id)) {
            newSet.add(item.id);
          }
        }
        if (newSet.size > 0 && newSet.size < 10) {
          setNewIds(newSet);
          // 自动滚到顶部
          if (autoScroll && scrollRef.current) {
            scrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
          }
          // 5秒后清除高亮
          setTimeout(() => setNewIds(new Set()), 5000);
        }
      }

      // 更新已有ID集合
      prevIdsRef.current = new Set(newItems.map((i) => i.id));
      setItems(newItems);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "获取失败");
    } finally {
      setLoading(false);
    }
  }, [autoScroll]);

  useEffect(() => {
    fetchFlash();
    if (autoRefresh) {
      timerRef.current = setInterval(fetchFlash, 30_000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchFlash, autoRefresh]);

  const filtered = filter === "important" ? items.filter((i) => i.is_important) : items;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      {/* Header */}
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">实时快讯</h1>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            来源：{source || "金十数据"} · 更新于 {lastUpdate || "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              autoRefresh
                ? "bg-[var(--positive)] text-white"
                : "bg-[var(--surface-muted)] text-[var(--text-muted)]"
            }`}
          >
            {autoRefresh ? "● 自动刷新" : "○ 已暂停"}
          </button>
        </div>
      </header>

      {/* Filter */}
      <div className="mb-4 flex gap-2">
        {(
          [
            { key: "all", label: "全部" },
            { key: "important", label: "重要" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === tab.key
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--surface-muted)] text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="rounded-xl border border-[var(--negative)] bg-[var(--negative-surface)] p-4 text-center text-sm text-[var(--negative)]">
          快讯加载失败：{error}
          <button onClick={fetchFlash} className="mt-2 block w-full text-xs underline">
            点击重试
          </button>
        </div>
      )}

      {/* Flash List */}
      {!loading && !error && (
        <div ref={scrollRef} className="space-y-3" style={{ maxHeight: "75vh", overflowY: "auto" }}>
          {filtered.length === 0 ? (
            <p className="py-20 text-center text-sm text-[var(--text-muted)]">暂无快讯</p>
          ) : (
            filtered.map((item) => (
              <article
                key={item.id}
                className={`rounded-xl border p-4 transition-all ${
                  newIds.has(item.id)
                    ? "border-[var(--accent)] bg-[var(--accent-surface)] shadow-lg shadow-[var(--accent-shadow)]"
                    : "border-[var(--border)] bg-[var(--surface)]"
                } ${item.is_important ? "border-l-4 border-l-[var(--warning)]" : ""}`}
              >
                {/* Time + Source + Channels */}
                <div className="mb-1.5 flex items-center gap-2 text-[10px]">
                  <span className="font-mono text-[var(--text-muted)]">{item.time_str}</span>
                  {item.is_important && (
                    <span className="rounded bg-[var(--warning)] px-1.5 py-0.5 font-medium text-white">
                      重要
                    </span>
                  )}
                  {item.source === "金十数据" && (
                    <span className="rounded bg-orange-100 px-1.5 py-0.5 font-medium text-orange-700 dark:bg-orange-900 dark:text-orange-300">
                      金十
                    </span>
                  )}
                  {item.channels.map((ch) => (
                    <span
                      key={ch}
                      className="rounded bg-[var(--surface-muted)] px-1 py-0.5 text-[var(--text-muted)]"
                    >
                      {CHANNEL_NAMES[ch] || ch}
                    </span>
                  ))}
                  {newIds.has(item.id) && (
                    <span className="ml-auto rounded bg-[var(--positive)] px-1.5 py-0.5 font-medium text-white">
                      NEW
                    </span>
                  )}
                </div>

                {/* Content */}
                {item.title && (
                  <h3 className="mb-1 text-sm font-bold text-[var(--text)]">{item.title}</h3>
                )}
                <p className="text-sm leading-6 text-[var(--text-secondary)] whitespace-pre-line">
                  {item.content}
                </p>
              </article>
            ))
          )}
        </div>
      )}

      {/* Footer */}
      <footer className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
        <p className="text-xs leading-5 text-[var(--text-muted)]">
          快讯来源：金十数据（主）/华尔街见闻（备）。30秒自动刷新，数据可能有数秒延迟，仅供研究参考，不构成投资建议。
        </p>
      </footer>
    </div>
  );
}
