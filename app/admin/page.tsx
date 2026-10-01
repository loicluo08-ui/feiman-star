"use client";

import { useState } from "react";

/**
 * 使用监控后台（10/1逸翔令）——sufve.com/admin
 * token输入存sessionStorage（关标签即失效），数据从/api/admin/usage拉取
 */

type UsageData = {
  overview: { uniqueIPs: number; totalRequests: number; requests24h: number; requests7d: number; aiCalls: number; chatCount: number };
  ipRows: Array<{ ip: string; count: number; first: string; last: string; paths: string[]; country: string | null; city: string | null }>;
  recent: Array<{ ts: string; ip: string; path: string; method: string; ua: string | null; country: string | null; city: string | null }>;
  chats: Array<{ id: number; question: string; style: string; ip: string | null; created_at: string }>;
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

  async function load(t: string) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/usage?token=${encodeURIComponent(t)}`, { cache: "no-store" });
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
      const res = await fetch("/api/admin/usage?token=" + encodeURIComponent(t), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        <button onClick={() => void load(sessionStorage.getItem("fx_admin_token") || token)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">
          ↻ 刷新
        </button>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <div className="text-2xl font-semibold tabular-nums">{c.value}</div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">{c.label}</div>
          </div>
        ))}
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">IP明细（按请求数排序）</h2>
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
              {data.ipRows.map((r) => (
                <tr key={r.ip} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-3 py-2 font-mono">{r.ip}</td>
                  <td className="px-3 py-2 tabular-nums">{r.count}</td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">{[r.country, safeDecode(r.city)].filter(Boolean).join(" ") || "—"}</td>
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
              {data.ipRows.length === 0 ? (
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
                <th className="px-3 py-2">IP</th>
                <th className="px-3 py-2">风格</th>
                <th className="px-3 py-2">提问</th>
              </tr>
            </thead>
            <tbody>
              {data.chats.map((c) => (
                <tr key={c.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-3 py-2 text-[var(--text-muted)]">{fmtTime(c.created_at)}</td>
                  <td className="px-3 py-2 font-mono">{c.ip || "—"}</td>
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
        <h2 className="mb-3 text-sm font-semibold">最近活动流（{data.recent.length}）</h2>
        <div className="max-h-96 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-[11px] leading-5 text-[var(--text-muted)]">
          {data.recent.map((r, i) => (
            <div key={i} className="border-b border-[var(--border)] py-1 last:border-0">
              {fmtTime(r.ts)} · {r.ip} · {cnAction(r.method, r.path)}{cnPath(r.path)}
              {r.city ? ` · ${r.country || ""} ${safeDecode(r.city)}` : ""}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
