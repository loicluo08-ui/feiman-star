"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { filterFlashItems } from "@/lib/flash-filter";

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

// 金十channel含义
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
  const [filter, setFilter] = useState<"all" | "important">("all");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [source, setSource] = useState<string>("");
  const [lastUpdate, setLastUpdate] = useState<string>("");
  const [refreshing, setRefreshing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevIdsRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // AI分析面板状态
  const [selectedItem, setSelectedItem] = useState<FlashItem | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);

  // 浏览器通知：重要快讯弹窗
  const [notifEnabled, setNotifEnabled] = useState(false);
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "granted") {
      setNotifEnabled(true);
    }
  }, []);

  const toggleNotif = useCallback(async () => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      setNotifEnabled((v) => !v);
    } else if (Notification.permission !== "denied") {
      const perm = await Notification.requestPermission();
      if (perm === "granted") setNotifEnabled(true);
    }
  }, []);

  // 新的重要快讯触发通知
  useEffect(() => {
    if (!notifEnabled) return;
    const newImportant = items.filter(
      (i) => i.is_important && !notifiedRef.current.has(i.id)
    );
    for (const item of newImportant) {
      notifiedRef.current.add(item.id);
      try {
        new Notification("重要快讯", {
          body: item.content.slice(0, 100),
          tag: item.id,
          icon: "/favicon.ico",
        });
      } catch {}
    }
  }, [items, notifEnabled]);

  // 客户端直连金十（绕过Vercel网络限制，cache-buster绕CDN缓存）
  const fetchJin10Client = useCallback(async (): Promise<FlashItem[]> => {
    try {
      const cb = Date.now();
      const res = await fetch(`https://www.jin10.com/flash_newest.js?_=${cb}`, {
        cache: "no-store",
      });
      if (!res.ok) return [];
      const text = await res.text();
      const match = text.match(/var newest = (.+);/);
      if (!match) return [];

      const raw = JSON.parse(match[1]) as Array<{
        id: string;
        time: string;
        type: number;
        data: { content: string; title: string; source: string };
        important: number;
        channel: number[];
      }>;

      return raw.map((item) => {
        const content = item.data.content || "";
        const cleanContent = content
          .replace(/<br\s*\/?>/g, "\n")
          .replace(/<\/?b>/g, "")
          .replace(/<\/?strong>/g, "")
          .replace(/<[^>]+>/g, "")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .trim();
        const cleanTitle = (item.data.title || "").replace(/<[^>]+>/g, "").trim();
        const ts = Math.floor(new Date(item.time + " UTC+8").getTime() / 1000);
        const now = Math.floor(Date.now() / 1000);
        const diff = now - ts;
        let timeStr: string;
        if (diff < 10) timeStr = "刚刚";
        else if (diff < 60) timeStr = `${diff}秒前`;
        else if (diff < 3600) timeStr = `${Math.floor(diff / 60)}分钟前`;
        else if (diff < 86400) timeStr = `${Math.floor(diff / 3600)}小时前`;
        else timeStr = item.time;

        return {
          id: `jin10_${item.id}`,
          title: cleanTitle,
          content: cleanContent,
          content_text: cleanTitle ? `${cleanTitle}\n${cleanContent}` : cleanContent,
          time_str: timeStr,
          timestamp: ts,
          is_important: item.important === 1 || /<b>|<strong/.test(content),
          channels: item.channel || [],
          source: "金十数据",
        };
      });
    } catch {
      return [];
    }
  }, []);

  // 服务端API（华尔街见闻+财联社补充+金十兜底）
  const fetchServerFlash = useCallback(async (): Promise<{
    data: FlashItem[];
    source: string;
    stats?: Record<string, number>;
  }> => {
    try {
      const res = await fetch("/api/invest/flash", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return {
        data: json.data || [],
        source: json.source || "",
        stats: json.stats,
      };
    } catch {
      return { data: [], source: "" };
    }
  }, []);

  const fetchFlash = useCallback(async () => {
    setRefreshing(true);
    try {
      // 并行：客户端直连金十 + 服务端API
      const [jin10Items, serverData] = await Promise.all([
        fetchJin10Client(),
        fetchServerFlash(),
      ]);

      // 金十客户端数据为主源，服务端数据全量合并（华尔街见闻无CDN缓存，实时性好）
      let allItems: FlashItem[] = filterFlashItems([...jin10Items, ...serverData.data]);

      // 去重（content前30字符指纹）
      const seen = new Map<string, number>();
      const deduped: FlashItem[] = [];
      for (const item of allItems.sort((a, b) => b.timestamp - a.timestamp)) {
        const fp = item.content.replace(/[\s\W]/g, "").slice(0, 20);
        if (seen.has(fp)) continue;
        seen.set(fp, item.timestamp);
        deduped.push(item);
      }

      const newItems = deduped.slice(0, 30);

      // 更新source显示
      const sources: string[] = [];
      if (jin10Items.length > 0) sources.push("金十数据");
      if (serverData.data.some((i) => i.source === "华尔街见闻")) sources.push("华尔街见闻");
      if (sources.length === 0 && serverData.source) sources.push(serverData.source);

      setSource(sources.join("+") || "金十数据");
      // 显示最新快讯的时间，而非前端拉取时间
      const latestTs = newItems[0]?.timestamp;
      if (latestTs) {
        setLastUpdate(new Date(latestTs * 1000).toLocaleTimeString("zh-CN", { hour12: false }));
      } else {
        setLastUpdate(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
      }

      if (prevIdsRef.current.size > 0) {
        const newSet = new Set<string>();
        for (const item of newItems) {
          if (!prevIdsRef.current.has(item.id)) newSet.add(item.id);
        }
        if (newSet.size > 0 && newSet.size < 10) {
          setNewIds(newSet);
          if (scrollRef.current) scrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
          setTimeout(() => setNewIds(new Set()), 5000);
        }
      }

      prevIdsRef.current = new Set(newItems.map((i) => i.id));
      setItems(newItems);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "获取失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchJin10Client, fetchServerFlash]);

  useEffect(() => {
    fetchFlash();
    if (autoRefresh) {
      timerRef.current = setInterval(fetchFlash, 5_000);
    }
    // 页面不可见时暂停轮询，节省资源
    const handleVisibility = () => {
      if (document.hidden && timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      } else if (!document.hidden && autoRefresh && !timerRef.current) {
        fetchFlash();
        timerRef.current = setInterval(fetchFlash, 5_000);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchFlash, autoRefresh]);

  // AI分析
  const analyzeItem = useCallback(async (item: FlashItem) => {
    // 取消上一次请求
    if (aiAbortRef.current) aiAbortRef.current.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;

    setSelectedItem(item);
    setAiAnalysis("");
    setAiError(null);
    setAiLoading(true);

    try {
      const res = await fetch("/api/invest/flash-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: item.content_text, title: item.title, source: item.source }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error("无响应流");
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setAiAnalysis(text);
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        setAiError(e instanceof Error ? e.message : "分析失败");
      }
    } finally {
      setAiLoading(false);
    }
  }, []);

  // 关闭分析面板
  const closeAnalysis = useCallback(() => {
    if (aiAbortRef.current) aiAbortRef.current.abort();
    setSelectedItem(null);
    setAiAnalysis("");
    setAiError(null);
  }, []);

  const filtered = filter === "important" ? items.filter((i) => i.is_important) : items;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex gap-6">
        {/* 左侧：快讯列表 */}
        <div className={`flex-1 ${selectedItem ? "hidden lg:block" : "block"}`}>
          {/* Header */}
          <header className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-[var(--text)]">实时快讯</h1>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                来源：{source || "金十数据"} · 更新于 {lastUpdate || "—"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* 手动刷新 */}
              <button
                onClick={fetchFlash}
                disabled={refreshing}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-muted)] disabled:opacity-50"
              >
                {refreshing ? "⟳ 刷新中…" : "↻ 刷新"}
              </button>
              {/* 自动刷新开关 */}
              <button
                onClick={() => setAutoRefresh((v) => !v)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  autoRefresh
                    ? "bg-[var(--positive)] text-white"
                    : "bg-[var(--surface-muted)] text-[var(--text-muted)]"
                }`}
              >
                {autoRefresh ? "● 自动" : "○ 已暂停"}
              </button>
              {/* 重要快讯通知开关 */}
              <button
                onClick={toggleNotif}
                title={notifEnabled ? "关闭重要快讯提醒" : "开启重要快讯提醒"}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  notifEnabled
                    ? "bg-orange-500 text-white"
                    : "bg-[var(--surface-muted)] text-[var(--text-muted)]"
                }`}
              >
                {notifEnabled ? "🔔 提醒开" : "🔔 提醒关"}
              </button>
            </div>
          </header>

          {/* Filter */}
          <div className="mb-4 flex gap-2">
            {([
              { key: "all", label: "全部" },
              { key: "important", label: "重要" },
            ] as const).map((tab) => (
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
              <button onClick={fetchFlash} className="mt-2 block w-full text-xs underline">点击重试</button>
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
                    onClick={() => analyzeItem(item)}
                    className={`cursor-pointer rounded-xl border p-4 transition-all hover:border-[var(--accent)] hover:shadow-md ${
                      newIds.has(item.id)
                        ? "border-[var(--accent)] bg-[var(--accent-surface)] shadow-lg"
                        : "border-[var(--border)] bg-[var(--surface)]"
                    } ${item.is_important ? "border-l-4 border-l-[var(--warning)]" : ""} ${
                      selectedItem?.id === item.id ? "ring-1 ring-[var(--accent)]" : ""
                    }`}
                  >
                    <div className="mb-1.5 flex items-center gap-2 text-[10px]">
                      <span className="font-mono text-[var(--text-muted)]">{item.time_str}</span>
                      {item.is_important && (
                        <span className="rounded bg-[var(--warning)] px-1.5 py-0.5 font-medium text-white">重要</span>
                      )}
                      {item.source === "金十数据" && (
                        <span className="rounded bg-orange-100 px-1.5 py-0.5 font-medium text-orange-700 dark:bg-orange-900 dark:text-orange-300">金十</span>
                      )}
                      {item.channels.map((ch) => (
                        <span key={ch} className="rounded bg-[var(--surface-muted)] px-1 py-0.5 text-[var(--text-muted)]">
                          {CHANNEL_NAMES[ch] || ch}
                        </span>
                      ))}
                      {newIds.has(item.id) && (
                        <span className="ml-auto rounded bg-[var(--positive)] px-1.5 py-0.5 font-medium text-white">NEW</span>
                      )}
                      {selectedItem?.id === item.id && (
                        <span className="ml-auto rounded bg-[var(--accent)] px-1.5 py-0.5 font-medium text-white">分析中</span>
                      )}
                    </div>
                    {item.title && <h3 className="mb-1 text-sm font-bold text-[var(--text)]">{item.title}</h3>}
                    <p className="text-sm leading-6 text-[var(--text-secondary)] whitespace-pre-line">{item.content_text}</p>
                  </article>
                ))
              )}
            </div>
          )}
        </div>

        {/* 右侧：AI分析面板 */}
        {selectedItem && (
          <aside className="fixed inset-0 z-50 flex justify-end bg-black/30 lg:static lg:inset-auto lg:z-auto lg:w-[420px] lg:flex-shrink-0" onClick={closeAnalysis}>
            <div
              className="flex h-full w-full flex-col bg-[var(--surface)] shadow-2xl lg:h-auto lg:max-h-[80vh] lg:rounded-xl lg:border lg:border-[var(--border)]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 分析面板Header */}
              <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                <h2 className="text-sm font-bold text-[var(--text)]">AI 分析</h2>
                <button
                  onClick={closeAnalysis}
                  className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                >
                  ✕
                </button>
              </div>

              {/* 原文（默认折叠，点开查看） */}
              <details className="border-b border-[var(--border)] px-4 py-3">
                <summary className="cursor-pointer select-none text-xs font-bold text-[var(--text-muted)]">
                  查看快讯原文
                </summary>
                <div className="mt-2">
                  <div className="mb-2 flex items-center gap-2 text-[10px]">
                    <span className="font-mono text-[var(--text-muted)]">{selectedItem.time_str}</span>
                    {selectedItem.is_important && (
                      <span className="rounded bg-[var(--warning)] px-1.5 py-0.5 font-medium text-white">重要</span>
                    )}
                    <span className="rounded bg-orange-100 px-1.5 py-0.5 font-medium text-orange-700 dark:bg-orange-900 dark:text-orange-300">
                      {selectedItem.source}
                    </span>
                  </div>
                  {selectedItem.title && (
                    <h3 className="mb-1 text-sm font-bold text-[var(--text)]">{selectedItem.title}</h3>
                  )}
                  <p className="text-xs leading-5 text-[var(--text-secondary)] whitespace-pre-line">
                    {selectedItem.content_text}
                  </p>
                </div>
              </details>

              {/* AI分析内容 */}
              <div className="flex-1 overflow-y-auto px-4 py-3">
                <div className="mb-1 text-xs font-bold text-[var(--accent)]">AI 分析结果</div>
                {aiLoading && !aiAnalysis && (
                  <div className="flex items-center gap-2 py-4">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
                    <span className="text-xs text-[var(--text-muted)]">AI正在分析…</span>
                  </div>
                )}
                {aiError && (
                  <div className="rounded-lg border border-[var(--negative)] bg-[var(--negative-surface)] p-3 text-xs text-[var(--negative)]">
                    分析失败：{aiError}
                    <button onClick={() => analyzeItem(selectedItem)} className="mt-2 block text-xs underline">重试</button>
                  </div>
                )}
                {aiAnalysis && (
                  <div className="text-sm leading-7 text-[var(--text-secondary)] whitespace-pre-line">
                    {aiAnalysis}
                  </div>
                )}
              </div>

              {/* 底部 */}
              <div className="border-t border-[var(--border)] px-4 py-2">
                <p className="text-[10px] text-[var(--text-muted)]">
                  AI分析由DeepSeek生成，仅供研究参考，不构成投资建议
                </p>
                <p className="mt-0.5 text-[10px] text-[var(--text-muted)] opacity-60">
                  已通过交叉验证：过滤绝对化用语 · 标注风险边界 · 仅基于公开信息
                </p>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Footer */}
      <footer className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
        <p className="text-xs leading-5 text-[var(--text-muted)]">
          快讯来源：金十数据（主）/华尔街见闻（备）。5秒自动刷新，点击快讯可查看AI分析。数据可能有数秒延迟，仅供研究参考，不构成投资建议。
        </p>
      </footer>
    </div>
  );
}
