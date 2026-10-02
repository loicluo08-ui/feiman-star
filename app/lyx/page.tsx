"use client";

import { useEffect, useState } from "react";

/**
 * 使用监控后台（10/1逸翔令）——sufve.com/admin
 * token输入存sessionStorage（关标签即失效），数据从/api/admin/usage拉取
 */

type UsageData = {
  overview: { uniqueIPs: number; totalRequests: number; requests24h: number; requests7d: number; aiCalls: number; chatCount: number };
  ipRows: Array<{ ip: string; count: number; first: string; last: string; paths: string[]; country: string | null; city: string | null; geo?: string; username?: string | null }>;
  intentStats: { human: number; searchbot: number; aicrawler: number; badbot: number; scan: number; unknown: number };
  humanIPs: Array<{ ip: string; count: number; first: string; last: string; paths: string[]; geo?: string; username?: string | null }>;
  recent: Array<{ ts: string; ip: string; path: string; method: string; ua: string | null; country: string | null; city: string | null; username?: string | null }>;
  chats: Array<{ id: number; question: string; style: string; ip: string | null; created_at: string; username?: string | null }>;
};

// 10/1逸翔令：监控内容用中文自然语言——路径与动作全部翻译成人话
const PAGE_NAMES: Record<string, string> = {
  "/": "主页",
  "/invest": "投资工作台",
  "/invest/chat": "AI对话",
  "/invest/flash": "实时快讯",
  "/invest/market": "市场快报",
  "/invest/calendar": "财报日历",
  "/invest/pick": "AI选股",
  "/invest/review": "交易复盘",
  "/invest/ledger": "判断账本",
  "/invest/admin": "监控后台",
};

const API_NAMES: Record<string, string> = {
  "/api/invest/chat": "AI对话分析",
  "/api/invest/pick": "AI选股分析",
  "/api/invest/review-summary": "复盘摘要生成",
  "/api/invest/flash-analyze": "快讯AI解读",
  "/api/invest/flash": "快讯数据刷新",
  "/api/invest/market-pulse": "行情数据刷新",
  "/api/invest/stock": "个股行情查询",
  "/api/invest/search": "股票搜索",
  "/api/invest/calendar": "财报数据查询",
  "/api/invest/judgment-cloud": "判断云端存档",
  "/api/invest/judgment-sync": "判断云端同步",
  "/api/admin/usage": "监控后台读取",
  "/api/admin/cleanup": "数据清理",
};

function cnPath(path: string | null | undefined): string {
  if (!path) return "未知页面";
  if (PAGE_NAMES[path]) return PAGE_NAMES[path];
  if (API_NAMES[path]) return API_NAMES[path];
  // 前缀匹配（带参数的API）
  const base = Object.keys(API_NAMES).find((k) => path.startsWith(k));
  if (base) return API_NAMES[base];
  const page = Object.keys(PAGE_NAMES).find((k) => path.startsWith(k) && k !== "/");
  return page ? PAGE_NAMES[page] : path;
}

function cnAction(method: string | null | undefined, path: string | null | undefined): string {
  const isAPI = (path || "").startsWith("/api/");
  if (method === "POST") return isAPI ? "调用" : "提交";
  return "浏览";
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function displayName(username: string | null | undefined, ip: string): string {
  return username || ip;
}

function safeDecode(v: string | null): string {
  if (!v) return "";
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [data, setData] = useState<UsageData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState("");

  async function load(t: string, silent = false) {
    if (!silent) setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/usage", { headers: { "x-admin-token": t }, cache: "no-store" });
      if (res.status === 401 || res.status === 503) {
        setError(res.status === 503 ? "后台未启用（服务器未配置ADMIN_TOKEN）" : "token错误");
        setData(null);
        return;
      }
      const json = (await res.json()) as UsageData & { ok?: boolean; error?: string };
      // 10/1修复：500等错误响应（如access_logs表未建supabase_404）直接渲染会崩（data.overview undefined→逸翔真机实锤）——转为友好提示
      if (json.ok === false || !json.overview) {
        const e = json.error || "";
        setError(
          e.includes("404") || e.includes("PGRST205")
            ? "数据库表未创建：请先在Supabase SQL Editor执行 sql/005_access_logs.sql，然后刷新重进"
            : `加载失败：${e || "未知错误"}`,
        );
        setData(null);
        return;
      }
      setData(json);
      sessionStorage.setItem("fx_admin_token", t);
    } catch {
      setError("加载失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  // 10/1：拉黑/解封（合规反爬——监控联动处置）
  const [blockMsg, setBlockMsg] = useState("");
  async function toggleBlock(ip: string) {
    const t = token || sessionStorage.getItem("fx_admin_token") || "";
    const blockedNow = blockedSet.has(ip);
    setBlockMsg(`${ip} 处理中…`);
    try {
      const res = await fetch("/api/admin/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": t },
        body: JSON.stringify({ action: blockedNow ? "unblock" : "block", ip }),
      });
      const json = await res.json();
      if (json.ok) {
        setBlockMsg(`${ip} 已${blockedNow ? "解封" : "拉黑"}（约2分钟内全站生效）`);
        setBlockedSet((prev) => {
          const next = new Set(prev);
          if (blockedNow) next.delete(ip);
          else next.add(ip);
          return next;
        });
      } else {
        setBlockMsg(`${ip} 操作失败`);
      }
    } catch {
      setBlockMsg(`${ip} 网络错误`);
    }
  }
  const [blockedSet, setBlockedSet] = useState<Set<string>>(new Set());

  // 10/1：自动刷新（快讯同款30秒轮询）——静默模式不闪加载态，保证刷新有效
  const [autoRefresh, setAutoRefresh] = useState(true);
  // 10/1逸翔令：顺序可筛选选择——最新在前/最早在前
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  // IP明细排序方式：按访问次数 / 按最近时间
  const [ipSort, setIpSort] = useState<"count" | "time">("count");
  useEffect(() => {
    if (!autoRefresh || !data) return;
    const timer = setInterval(() => {
      const t = token || sessionStorage.getItem("fx_admin_token") || "";
      if (t) void load(t, true);
    }, 30_000);
    return () => clearInterval(timer);
  }, [autoRefresh, data, token]);

  const saved = typeof window !== "undefined" ? sessionStorage.getItem("fx_admin_token") : null;

  if (!data) {
    return (
      <div className="mx-auto max-w-md px-5 py-16">
        <h1 className="mb-1 text-xl font-semibold">使用监控后台</h1>
        <p className="mb-6 text-xs text-[var(--text-muted)]">输入ADMIN_TOKEN查看全站访问与对话记录</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load(token);
          }}
          className="flex gap-2"
        >
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ADMIN_TOKEN"
            className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--text)]"
          />
          <button type="submit" disabled={loading} className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-40">
            {loading ? "加载中…" : "进入"}
          </button>
        </form>
        {error ? <p className="mt-3 text-sm text-[var(--negative)]">{error}</p> : null}
        {saved && !error ? <p className="mt-3 text-xs text-[var(--text-muted)]">检测到本会话已存token，刷新页面自动恢复</p> : null}
      </div>
    );
  }

  const o = data.overview;
  const sortedRecent = [...data.recent].sort((a, b) => {
    const ta = String(a.ts || "");
    const tb = String(b.ts || "");
    return sortOrder === "newest" ? tb.localeCompare(ta) : ta.localeCompare(tb);
  });
  const sortedChats = [...data.chats].sort((a, b) => {
    const ia = Number(a.id) || 0;
    const ib = Number(b.id) || 0;
    return sortOrder === "newest" ? ib - ia : ia - ib;
  });
  const sortedIpRows = [...data.ipRows].sort((a, b) => {
    if (ipSort === "time") return String(b.last || "").localeCompare(String(a.last || ""));
    return b.count - a.count;
  });
  const cards = [
    { label: "独立IP", value: o.uniqueIPs },
    { label: "24h请求", value: o.requests24h },
    { label: "7天请求", value: o.requests7d },
    { label: "AI调用", value: o.aiCalls },
    { label: "对话记录", value: o.chatCount },
  ];

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">使用监控后台</h1>
        <button
          onClick={() => {
            setLoading(true);
            void load(sessionStorage.getItem("fx_admin_token") || token).then(() => {
              setLastRefresh(new Date().toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit" }));
            });
          }}
          disabled={loading}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-40"
        >
          {loading ? "刷新中…" : "↻ 刷新"}
        </button>
        <button
          onClick={() => setAutoRefresh((v) => !v)}
          className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium ${autoRefresh ? "bg-[var(--positive)] text-white" : "bg-[var(--surface-muted)] text-[var(--text-muted)]"}`}
        >
          {autoRefresh ? "● 自动刷新" : "○ 已暂停"}
        </button>
        <div className="flex overflow-hidden rounded-lg border border-[var(--border)] text-xs">
          <button
            onClick={() => setSortOrder("newest")}
            className={`px-2.5 py-1.5 font-medium ${sortOrder === "newest" ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--text-muted)]"}`}
          >
            最新在前
          </button>
          <button
            onClick={() => setSortOrder("oldest")}
            className={`px-2.5 py-1.5 font-medium ${sortOrder === "oldest" ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--text-muted)]"}`}
          >
            最早在前
          </button>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <div className="text-2xl font-semibold tabular-nums">{c.value}</div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">{c.label}</div>
          </div>
        ))}
      </div>
        {lastRefresh ? <p className="mb-4 text-xs text-[var(--text-muted)]">数据更新于 {lastRefresh}</p> : null}

      <section className="mb-8">
        {/* 10/1真实访问用户模块（逸翔令）：意图分类统计+真实访客专区 */}
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold">访问意图分析</h2>
          <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {[
              { label: "真实访客", v: data.intentStats.human, cls: "text-[var(--positive)] bg-[var(--positive-bg)]" },
              { label: "搜索引擎", v: data.intentStats.searchbot, cls: "text-[var(--accent)] bg-[var(--accent-surface)]" },
              { label: "AI爬虫", v: data.intentStats.aicrawler, cls: "text-[var(--text-muted)] bg-[var(--surface-muted)]" },
              { label: "恶意爬虫", v: data.intentStats.badbot, cls: "text-[var(--warning)] bg-[var(--warning-bg)]" },
              { label: "漏洞扫描", v: data.intentStats.scan, cls: "text-[var(--negative)] bg-[var(--negative-bg)]" },
              { label: "无法识别", v: data.intentStats.unknown, cls: "text-[var(--text-muted)] bg-[var(--surface-muted)]" },
            ].map((s) => (
              <div key={s.label} className={`rounded-xl px-3 py-2.5 ${s.cls}`}>
                <div className="text-xl font-semibold tabular-nums">{s.v}</div>
                <div className="mt-0.5 text-[11px]">{s.label}</div>
              </div>
            ))}
          </div>

          <h3 className="mb-2 text-sm font-semibold">真实访客（人类浏览）{data.humanIPs.length > 0 ? `——${data.humanIPs.length} 个来源` : ""}</h3>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-subtle)] text-left text-[var(--text-muted)]">
                  <th className="px-3 py-2">来源地址</th>
                  <th className="px-3 py-2">次数</th>
                  <th className="px-3 py-2">归属地</th>
                  <th className="px-3 py-2">首次</th>
                  <th className="px-3 py-2">最近</th>
                  <th className="px-3 py-2">浏览过</th>
                </tr>
              </thead>
              <tbody>
                {data.humanIPs.map((r) => (
                  <tr key={r.ip} className={`border-b border-[var(--border)] last:border-0 ${r.username ? "bg-[var(--accent-surface)]" : ""}`}>
                    <td className="px-3 py-2 font-mono">
                      {r.username ? (
                        <span className="font-sans font-semibold text-[var(--accent)]">{r.username}</span>
                      ) : (
                        r.ip
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{r.count}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{r.geo || "—"}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{fmtTime(r.first)}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{fmtTime(r.last)}</td>
                    <td className="px-3 py-2 text-[10px] text-[var(--text-muted)]">{r.paths.map(cnPath).join("、")}</td>
                  </tr>
                ))}
                {data.humanIPs.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-[var(--text-muted)]">暂无真实访客记录</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">访客明细（含爬虫与机器流量）</h2>
          <div className="flex overflow-hidden rounded-lg border border-[var(--border)] text-xs">
            <button
              onClick={() => setIpSort("count")}
              className={`px-2.5 py-1.5 font-medium ${ipSort === "count" ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--text-muted)]"}`}
            >
              按次数
            </button>
            <button
              onClick={() => setIpSort("time")}
              className={`px-2.5 py-1.5 font-medium ${ipSort === "time" ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--text-muted)]"}`}
            >
              按最近时间
            </button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface-subtle)] text-left text-[var(--text-muted)]">
                <th className="px-3 py-2">IP</th>
                <th className="px-3 py-2">请求数</th>
                <th className="px-3 py-2">位置</th>
                <th className="px-3 py-2">首次</th>
                <th className="px-3 py-2">最近</th>
                <th className="px-3 py-2">访问路径</th>
              </tr>
            </thead>
            <tbody>
              {sortedIpRows.map((r) => (
                <tr key={r.ip} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-3 py-2 font-mono">
                    {r.username ? <span className="mr-1 rounded bg-[var(--accent-surface)] px-1.5 py-0.5 text-xs font-sans font-semibold text-[var(--accent)]">{r.username}</span> : null}
                    {r.ip}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{r.count}</td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">{r.geo || [r.country, safeDecode(r.city)].filter(Boolean).join(" ") || "—"}</td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">{fmtTime(r.first)}</td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">{fmtTime(r.last)}</td>
                  <td className="px-3 py-2 text-[10px] text-[var(--text-muted)]">{r.paths.map(cnPath).join("、")}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => void toggleBlock(r.ip)}
                      className={`rounded px-2 py-1 text-[10px] font-medium ${blockedSet.has(r.ip) ? "bg-[var(--positive-bg)] text-[var(--positive)]" : "bg-[var(--negative-bg)] text-[var(--negative)]"}`}
                    >
                      {blockedSet.has(r.ip) ? "已拉黑·解封" : "拉黑"}
                    </button>
                  </td>
                </tr>
              ))}
              {sortedIpRows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-[var(--text-muted)]">暂无数据——确认已在Supabase执行sql/005_access_logs.sql建表</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">对话记录（最近{data.chats.length}条）</h2>
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface-subtle)] text-left text-[var(--text-muted)]">
                <th className="px-3 py-2">时间</th>
                <th className="px-3 py-2">用户</th>
                <th className="px-3 py-2">风格</th>
                <th className="px-3 py-2">提问</th>
              </tr>
            </thead>
            <tbody>
              {sortedChats.map((c) => (
                <tr key={c.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-3 py-2 text-[var(--text-muted)]">{fmtTime(c.created_at)}</td>
                  <td className="px-3 py-2 font-mono">{displayName(c.username, c.ip || "—")}</td>
                  <td className="px-3 py-2">{c.style}</td>
                  <td className="max-w-[420px] truncate px-3 py-2">{c.question}</td>
                </tr>
              ))}
              {data.chats.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-[var(--text-muted)]">暂无对话记录</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">活动流（按先后顺序：{sortOrder === 'newest' ? '最新在前' : '最早在前'}）</h2>
        <div className="max-h-96 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-[11px] leading-5 text-[var(--text-muted)]">
          {sortedRecent.map((r, i) => (
            <div key={i} className="border-b border-[var(--border)] py-1 last:border-0">
              {fmtTime(r.ts)} · {r.ip} · {cnAction(r.method, r.path)}{cnPath(r.path)}
              {r.username ? ` · ${r.username}` : r.city ? ` · ${r.country || ""} ${safeDecode(r.city)}` : ""}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
