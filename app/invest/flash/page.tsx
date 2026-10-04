"use client";
import { gateFetch } from "@/lib/gate-client";

// 10/2监控漏记修复：数据页强制动态——静态预渲染命中CDN缓存时middleware不执行=页面浏览漏记
export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState } from "react";
import { filterFlashItems, dedupFlashItems } from "@/lib/flash-filter";

interface FlashItem {
  id: string;
  title: string;
  content: string;
  content_text: string;
  time_str: string;
  timestamp: number;
  is_important: boolean;
  importance?: "major" | "minor";
  channels: number[];
  source: string;
}

// 来源徽标配色（10/4扩源：合流板每条标来源，金十保持品牌橙）
const SOURCE_BADGES: Record<string, { label: string; cls: string }> = {
  金十数据: { label: "金十", cls: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300" },
  华尔街见闻: { label: "见闻", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  东方财富: { label: "东财", cls: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300" },
  新浪财经: { label: "新浪", cls: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" },
  同花顺: { label: "同花顺", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" },
};

// 金十channel含义
const CHANNEL_NAMES: Record<number, string> = {
  1: "中文",
  2: "A股",
  3: "期货",
  5: "英文",
  9: "深度",
};


// 10/2 S2：标题重复渲染修复v2——来源站标题常带【】/书名号/截断差异，严格startsWith匹配漏网
// 规范化（去括号引号空格+全半角统一）后前缀比较；命中则跳过正文首行
function stripDupTitle(title: string, content: string): string {
  if (!title) return content;
  const norm = (s: string) => s.replace(/[\s【】\[\]《》""''""'·:：，,。.\-—|]/g, "").toLowerCase();
  const nt = norm(title);
  if (!nt) return content;
  const firstLine = content.split("\n")[0];
  const flNorm = norm(firstLine);
  if (flNorm.startsWith(nt.slice(0, Math.max(12, nt.length - 4))) || flNorm.includes(nt)) {
    return content.slice(firstLine.length).replace(/^\s*[\n:：\-—|·]\s*/, "");
  }
  return content;
}

export default function FlashPage() {
  // 双板块（10/4逸翔令）：金十专板（原能力不变）+ 全市场合流板（见闻+东财+新浪）
  const [jin10Items, setJin10Items] = useState<FlashItem[]>([]);
  const [otherItems, setOtherItems] = useState<FlashItem[]>([]);
  const [board, setBoard] = useState<"jin10" | "others">("jin10");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "major" | "minor">("all");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [source, setSource] = useState<string>("");
  const [lastUpdate, setLastUpdate] = useState<string>("");
  const [refreshing, setRefreshing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevIdsRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // AI分析面板状态
  const [selectedItem, setSelectedItem] = useState<FlashItem | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);

  // 影响标注（10/4逸翔令：每条快讯自动评价利好/利空各≤5只——候选池硬约束防幻觉，后端5分钟缓存）
  interface ImpactStock { symbol: string; name: string; reason: string; }
  interface ImpactData { bull: ImpactStock[]; bear: ImpactStock[]; weak?: boolean; failed?: boolean; }
  const [impacts, setImpacts] = useState<Record<string, ImpactData>>({});
  const impactInFlightRef = useRef(false);

  // 浏览器通知：重要快讯弹窗
  const [notifEnabled, setNotifEnabled] = useState(false);
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "granted") {
      setNotifEnabled(true);
    }
  }, []);

  // 10/1 P3-11：权限被拒/不支持时点击给明确反馈（原实现静默返回=用户点了没反应）
  const [notifHint, setNotifHint] = useState("");
  const toggleNotif = useCallback(async () => {
    if (!("Notification" in window)) {
      setNotifHint("此浏览器不支持通知");
      setTimeout(() => setNotifHint(""), 2500);
      return;
    }
    if (Notification.permission === "granted") {
      setNotifEnabled((v) => !v);
      return;
    }
    if (Notification.permission === "denied") {
      setNotifHint("浏览器已禁止本站通知，请在地址栏权限设置中允许");
      setTimeout(() => setNotifHint(""), 2500);
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === "granted") setNotifEnabled(true);
    else if (perm === "denied") {
      setNotifHint("通知权限被拒绝，如需提醒请在浏览器设置中允许");
      setTimeout(() => setNotifHint(""), 2500);
    }
  }, []);

  // 新的主要快讯触发通知（两板块都监控，主次标记10/4：importance==="major"）
  useEffect(() => {
    if (!notifEnabled) return;
    const all = [...jin10Items, ...otherItems];
    const newImportant = all.filter(
      (i) => i.importance === "major" && !notifiedRef.current.has(i.id)
    );
    for (const item of newImportant) {
      notifiedRef.current.add(item.id);
      try {
        new Notification("主要快讯", {
          body: item.content.slice(0, 100),
          tag: item.id,
          icon: "/favicon.ico",
        });
      } catch {}
    }
  }, [jin10Items, otherItems, notifEnabled]);

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
        // Safari(JSC)兼容："UTC+8"非IANA时区名，非ISO格式解析有NaN风险——转标准ISO偏移写法（2026-09-26快讯审计P2-3）
        const parsed = new Date(item.time.replace(" ", "T") + "+08:00").getTime();
        const ts = Math.floor((isNaN(parsed) ? 0 : parsed) / 1000);
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
          // 10/1 P2-6强化：来源站title常为正文首行的截断版——正文以title开头时不再拼title（截断前缀严格匹配失效根因）
          content_text: cleanTitle
            ? (cleanContent.startsWith(cleanTitle) ? cleanContent : `${cleanTitle}\n${cleanContent}`)
            : cleanContent,
          time_str: timeStr,
          timestamp: ts,
          is_important: item.important === 1 || /<b[\s>]|<strong[\s>]/.test(content),
          importance: (item.important === 1 || /<b[\s>]|<strong[\s>]/.test(content)) ? "major" : "minor",
          channels: item.channel || [],
          source: "金十数据",
        };
      });
    } catch {
      return [];
    }
  }, []);

  // 服务端API（10/4双板块：data=金十专板兜底，others=见闻+东财+新浪合流板）——透传HTTP状态，503/0=源不可用（2026-09-26审计P1-1）
  const fetchServerFlash = useCallback(async (): Promise<{
    data: FlashItem[];
    others: FlashItem[];
    source: string;
    status: number;
  }> => {
    try {
      const res = await fetch("/api/invest/flash", { cache: "no-store" });
      if (!res.ok) return { data: [], others: [], source: "", status: res.status };
      const json = await res.json();
      return {
        data: json.data || [],
        others: json.others || [],
        source: json.source || "",
        status: 200,
      };
    } catch {
      return { data: [], others: [], source: "", status: 0 };
    }
  }, []);

  const fetchFlash = useCallback(async () => {
    // 并发锁：慢网络下5秒interval叠加会导致prevIds覆盖/漏弹NEW/双倍请求（2026-09-26审计P1-2）
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setRefreshing(true);
    try {
      // 并行：客户端直连金十 + 服务端API（双板块一次带回）
      const [jin10Client, serverData] = await Promise.all([
        fetchJin10Client(),
        fetchServerFlash(),
      ]);

      // 金十专板：客户端直连为主源，服务端金十兜底（原有能力不变，9/6红队收紧：同一套filter+dedup）
      const jin10Merged = filterFlashItems([...jin10Client, ...serverData.data]);
      const jin10Board = dedupFlashItems(jin10Merged).slice(0, 30);
      // 全市场板：见闻+东财+新浪合流（纯服务端）
      const othersBoard = dedupFlashItems(filterFlashItems(serverData.others)).slice(0, 30);

      // 更新source显示（10/4顺手修：原实现漏东方财富/新浪）
      const sources: string[] = [];
      if (jin10Board.length > 0 || serverData.data.some((i) => i.source === "金十数据")) sources.push("金十数据");
      if (othersBoard.some((i) => i.source === "华尔街见闻")) sources.push("华尔街见闻");
      if (othersBoard.some((i) => i.source === "东方财富")) sources.push("东方财富");
      if (othersBoard.some((i) => i.source === "新浪财经")) sources.push("新浪财经");
      if (othersBoard.some((i) => i.source === "同花顺")) sources.push("同花顺");
      if (sources.length === 0 && serverData.source) sources.push(serverData.source);

      setSource(sources.join("+") || "金十数据");
      // 显示最新快讯的时间，而非前端拉取时间（两板块取最大）
      const latestTs = Math.max(jin10Board[0]?.timestamp ?? 0, othersBoard[0]?.timestamp ?? 0);
      if (latestTs > 0) {
        setLastUpdate(new Date(latestTs * 1000).toLocaleTimeString("zh-CN", { hour12: false }));
      } else {
        setLastUpdate(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
      }

      const newAll = [...jin10Board, ...othersBoard];
      if (prevIdsRef.current.size > 0) {
        const newSet = new Set<string>();
        for (const item of newAll) {
          if (!prevIdsRef.current.has(item.id)) newSet.add(item.id);
        }
        if (newSet.size > 0 && newSet.size < 10) {
          setNewIds(newSet);
          if (scrollRef.current) scrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
          setTimeout(() => setNewIds(new Set()), 5000);
        }
      }

      // 双源全挂：保留旧列表+错误横幅（还原服务端503语义，此前被catch吞掉用户误以为真没快讯——2026-09-26审计P1-1）
      if (newAll.length === 0 && jin10Client.length === 0 && (serverData.status >= 500 || serverData.status === 0)) {
        setError(serverData.status === 0 ? "快讯数据源网络异常，当前显示最后成功拉取的数据" : "快讯数据源暂时不可用，当前显示最后成功拉取的数据");
      } else {
        setError(null);
        prevIdsRef.current = new Set(newAll.map((i) => i.id));
        setJin10Items(jin10Board);
        setOtherItems(othersBoard);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "获取失败");
    } finally {
      inFlightRef.current = false;
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
      const res = await gateFetch("/api/invest/flash-analyze", {
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

  // 当前板块的列表（10/4双板：派生值，切换板块即切换列表与影响标注作用域）
  const items = board === "jin10" ? jin10Items : otherItems;

  // 批量拉影响标注（10/4逸翔令"每条消息"）：全部未标注条目分批拉取——每批10条拆2并发×5条/请求
  // （服务端批量上限5：免费池单请求≈1600输出token是吞吐甜点，10条/3000token必截断）。
  // 服务端内容hash缓存5分钟，实际新调用量=新增快讯数；失败条目不入state，items轮询自动重试
  // 10/4双板合并：items为当前板块派生值，两板各自触发标注拉取
  useEffect(() => {
    if (impactInFlightRef.current || items.length === 0) return;
    const targets = items.filter((i) => !impacts[i.id]);
    if (targets.length === 0) return;
    impactInFlightRef.current = true;
    const post = (chunk: typeof targets) =>
      fetch("/api/invest/flash-impact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: chunk.map((it) => ({ id: it.id, title: it.title, content: (it.content_text || it.content).slice(0, 500) })),
        }),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j) => {
          const data = j?.data || {};
          setImpacts((prev) => ({ ...prev, ...data }));
        })
        .catch(() => {});
    (async () => {
      for (let i = 0; i < targets.length; i += 10) {
        const batch = targets.slice(i, i + 10);
        const half = Math.ceil(batch.length / 2);
        await Promise.all(
          [batch.slice(0, half), batch.slice(half)]
            .filter((g) => g.length > 0)
            .map((g) => post(g))
        );
      }
    })().finally(() => {
      impactInFlightRef.current = false;
    });
  }, [items, impacts]);

  const filtered = filter === "all" ? items : items.filter((i) => i.importance === filter);
  const majorCount = items.filter((i) => i.importance === "major").length;
  const minorCount = items.length - majorCount;

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-12">
      <div className="flex gap-6">
        {/* 左侧：快讯列表 */}
        <div className={`flex-1 ${selectedItem ? "hidden lg:block" : "block"}`}>
          {/* Header */}
          <header className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">实时快讯</h1>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                来源：{source || "金十数据"} · 更新于 {lastUpdate || "—"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* 手动刷新 */}
              <button
                onClick={fetchFlash}
                disabled={refreshing}
                className="whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-muted)] disabled:opacity-50"
              >
                {refreshing ? "⟳ 刷新中…" : "↻ 刷新"}
              </button>
              {/* 自动刷新开关 */}
              <button
                onClick={() => setAutoRefresh((v) => !v)}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
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
                title={notifHint || (notifEnabled ? "关闭重要快讯提醒" : "开启重要快讯提醒")}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  notifEnabled
                    ? "bg-[var(--warning)] text-white"
                    : "bg-[var(--surface-muted)] text-[var(--text-muted)]"
                }`}
              >
                {notifHint || (notifEnabled ? "🔔 提醒开" : "🔔 提醒关")}
              </button>
            </div>
          </header>

          {/* 板块切换（10/4逸翔令：金十单独一个板块，其他源合流） */}
          <div className="mb-3 flex rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-1 text-xs">
            {([
              { key: "jin10", label: "金十专板", count: jin10Items.length },
              { key: "others", label: "全市场", count: otherItems.length },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setBoard(tab.key)}
                className={`flex-1 rounded-md px-3 py-1.5 transition-colors ${
                  board === tab.key
                    ? "bg-[var(--surface)] font-medium text-[var(--text)] shadow-sm"
                    : "text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
              >
                {tab.label}
                <span className="ml-1.5 opacity-50">{tab.count}</span>
              </button>
            ))}
          </div>

          {/* Filter（主次标记10/4：全部/主要/次要） */}
          <div className="mb-4 flex gap-2">
            {([
              { key: "all", label: "全部" },
              { key: "major", label: `主要 ${majorCount}` },
              { key: "minor", label: `次要 ${minorCount}` },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  filter === tab.key
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--surface-muted)] text-[var(--text-secondary)] hover:text-[var(--text)]"
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
            <div className="rounded-xl border border-[var(--negative)] bg-[var(--negative-bg)] p-4 text-center text-sm text-[var(--negative)]">
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
                    } ${item.importance === "major" || (item.importance === undefined && item.is_important) ? "border-l-4 border-l-[var(--warning)]" : ""} ${
                      selectedItem?.id === item.id ? "ring-1 ring-[var(--accent)]" : ""
                    }`}
                  >
                    <div className="mb-1.5 flex items-center gap-2 text-[10px]">
                      <span className="font-mono text-[var(--text-muted)]">{item.time_str}</span>
                      {/* 主次类型标记（10/4逸翔令）：major=红「主」+左侧竖条，minor=灰「次」 */}
                      {item.importance === "major" ? (
                        <span className="rounded bg-[var(--warning)] px-1.5 py-0.5 font-medium text-white">主</span>
                      ) : (
                        <span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[var(--text-muted)]">次</span>
                      )}
                      {(() => {
                        const badge = SOURCE_BADGES[item.source];
                        return badge && (
                          <span className={`rounded px-1.5 py-0.5 font-medium ${badge.cls}`}>{badge.label}</span>
                        );
                      })()}
                      {item.channels.map((ch) => (
                        <span key={ch} className="rounded bg-[var(--surface-muted)] px-1 py-0.5 text-[var(--text-muted)]">
                          {CHANNEL_NAMES[ch] || ch}
                        </span>
                      ))}
                      {/* 10/1虚实审计：AI分析入口提示（功能实但藏——点击条目即出AI分析面板，角标提示可发现性） */}
                      {selectedItem?.id !== item.id && !newIds.has(item.id) && (
                        <span className="rounded border border-[var(--accent)] px-1 py-0.5 text-[10px] font-medium text-[var(--accent)]">AI</span>
                      )}
                      {newIds.has(item.id) && (
                        <span className="ml-auto rounded bg-[var(--positive)] px-1.5 py-0.5 font-medium text-white">NEW</span>
                      )}
                      {selectedItem?.id === item.id && (
                        <span className="ml-auto rounded bg-[var(--accent)] px-1.5 py-0.5 font-medium text-white">分析中</span>
                      )}
                    </div>
                    {item.title && <h3 className="mb-1 text-sm font-bold text-[var(--text)]">{item.title}</h3>}
                    {/* 10/1 P2-6：content_text="标题\n正文"格式且首行=标题时跳过首行（标题重复渲染实锤——一屏3-4处逐条自重复） */}
                    <p className="text-sm leading-6 text-[var(--text-secondary)] whitespace-pre-line">{stripDupTitle(item.title, item.content_text)}</p>
                    {/* 影响标注行（10/4）：利好/利空各≤5只——failed或全空不渲染（宁缺毋编） */}
                    {(() => {
                      const imp = impacts[item.id];
                      if (!imp || imp.failed || (imp.bull.length === 0 && imp.bear.length === 0)) return null;
                      return (
                        <div className="mt-2 rounded-lg bg-[var(--surface-muted)] px-2.5 py-1.5 text-[11px] leading-5">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            {imp.weak && (
                              <span className="rounded bg-[var(--surface)] px-1 py-0.5 text-[10px] text-[var(--text-muted)]">与股市关联弱</span>
                            )}
                            {imp.bull.length > 0 && (
                              <span className="font-medium text-[var(--positive)]">
                                🟢利好：{imp.bull.map((s) => `${s.symbol}·${s.reason.length > 22 ? s.reason.slice(0, 22) + "…" : s.reason}`).join("　")}
                              </span>
                            )}
                            {imp.bear.length > 0 && (
                              <span className="font-medium text-[var(--negative)]">
                                🔴利空：{imp.bear.map((s) => `${s.symbol}·${s.reason.length > 22 ? s.reason.slice(0, 22) + "…" : s.reason}`).join("　")}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
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
                <h2 className="text-sm font-semibold text-[var(--text)]">AI 分析</h2>
                <button
                  onClick={closeAnalysis}
                  className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                >
                  ✕
                </button>
              </div>

              {/* 原文（默认折叠，点开查看） */}
              <details className="border-b border-[var(--border)] px-4 py-3">
                <summary className="cursor-pointer select-none text-xs font-semibold text-[var(--text-muted)]">
                  查看快讯原文
                </summary>
                <div className="mt-2">
                  <div className="mb-2 flex items-center gap-2 text-[10px]">
                    <span className="font-mono text-[var(--text-muted)]">{selectedItem.time_str}</span>
                    {selectedItem.importance === "major" ? (
                      <span className="rounded bg-[var(--warning)] px-1.5 py-0.5 font-medium text-white">主要</span>
                    ) : (
                      <span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[var(--text-muted)]">次要</span>
                    )}
                    <span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 font-medium text-[var(--text-secondary)]">
                      {selectedItem.source}
                    </span>
                  </div>
                  {selectedItem.title && (
                    <h3 className="mb-1 text-sm font-bold text-[var(--text)]">{selectedItem.title}</h3>
                  )}
                  <p className="text-xs leading-5 text-[var(--text-secondary)] whitespace-pre-line">
                    {stripDupTitle(selectedItem.title, selectedItem.content_text)}
                  </p>
                </div>
              </details>

              {/* AI分析内容 */}
              <div className="flex-1 overflow-y-auto px-4 py-3">
                <div className="mb-1 text-xs font-semibold text-[var(--accent)]">AI 分析结果</div>
                {aiLoading && !aiAnalysis && (
                  <div className="flex items-center gap-2 py-4">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
                    <span className="text-xs text-[var(--text-muted)]">AI正在分析…</span>
                  </div>
                )}
                {aiError && (
                  <div className="rounded-lg border border-[var(--negative)] bg-[var(--negative-bg)] p-3 text-xs text-[var(--negative)]">
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
                  AI分析，仅供研究参考，不构成投资建议
                </p>
                <p className="mt-0.5 text-[10px] text-[var(--text-muted)] opacity-60">
                  内容仅基于公开信息
                </p>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Footer */}
      <footer className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
        <p className="text-xs leading-5 text-[var(--text-muted)]">
          快讯来源：金十数据（专板）｜华尔街见闻 + 东方财富 + 新浪财经 + 同花顺（全市场板）。快讯按「主要/次要」分级标记，5秒自动刷新，点击快讯可查看AI分析。数据可能有数秒延迟，仅供研究参考，不构成投资建议。
        </p>
      </footer>
    </div>
  );
}
