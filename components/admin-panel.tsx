"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Overview = {
  stats: { total_users: number; active_users_today: number; api_calls_today: number };
  users: Array<{ user_id: string; email: string; plan: string; remaining_calls: number; daily_limit: number; expires_at: string | null; created_at: string }>;
  codes: Array<{ id: number; code: string; plan: string; is_used: boolean; used_by: string | null; used_at: string | null; created_at: string }>;
};

type Insight = { id: string; platform: string; industry: string; insight_text: string; source_url: string | null; sentiment: string };
type InsightResponse = { data: Insight[]; count: number; page: number; pageSize: number; options: { platforms: string[]; industries: string[]; sentiments: string[] } };
type Tab = "overview" | "users" | "codes" | "insights";

const sentimentLabel: Record<string, string> = { positive: "正面", neutral: "中性", negative: "负面", mixed: "混合" };

async function getMessage(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error ?? "请求失败";
}

export function AdminPanel() {
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState("pro");
  const [count, setCount] = useState(10);
  const [generated, setGenerated] = useState<string[]>([]);
  const [insights, setInsights] = useState<InsightResponse | null>(null);
  const [filters, setFilters] = useState({ platform: "", industry: "", sentiment: "", page: 1 });

  const adminFetch = useCallback((path: string, init?: RequestInit, suppliedToken = token) => fetch(path, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${suppliedToken}` },
    cache: "no-store",
  }), [token]);

  const loadOverview = useCallback(async (adminToken = token) => {
    setLoading(true);
    setError("");
    try {
      const response = await adminFetch("/api/admin/overview", undefined, adminToken);
      if (!response.ok) throw new Error(await getMessage(response));
      const payload = (await response.json()) as { data: Overview };
      setOverview(payload.data);
      setToken(adminToken);
      sessionStorage.setItem("feiman_admin_token", adminToken);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "管理数据加载失败");
      setToken("");
      sessionStorage.removeItem("feiman_admin_token");
    } finally {
      setLoading(false);
    }
  }, [adminFetch, token]);

  useEffect(() => {
    const saved = sessionStorage.getItem("feiman_admin_token");
    if (saved) { setTokenInput(saved); void loadOverview(saved); }
  }, [loadOverview]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadOverview(tokenInput.trim());
  }

  async function generateCodes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const response = await adminFetch("/api/admin/generate-codes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, count }),
    });
    if (!response.ok) return setError(await getMessage(response));
    const payload = (await response.json()) as { codes: string[] };
    setGenerated(payload.codes);
    await loadOverview();
  }

  const loadInsights = useCallback(async (next = filters) => {
    const params = new URLSearchParams();
    if (next.platform) params.set("platform", next.platform);
    if (next.industry) params.set("industry", next.industry);
    if (next.sentiment) params.set("sentiment", next.sentiment);
    params.set("page", String(next.page));
    const response = await adminFetch(`/api/admin/market-insights?${params}`);
    if (!response.ok) return setError(await getMessage(response));
    setInsights((await response.json()) as InsightResponse);
  }, [adminFetch, filters]);

  useEffect(() => { if (token && tab === "insights") void loadInsights(); }, [loadInsights, tab, token]);

  if (!token || !overview) {
    return (
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-md place-items-center px-5 py-12">
        <form onSubmit={unlock} className="w-full rounded-2xl border border-[#e5e5e7] bg-white p-7 shadow-sm">
          <p className="text-sm font-medium text-[#8e8e93]">安全区域</p>
          <h1 className="mt-2 text-2xl font-semibold">管理后台</h1>
          <label className="mt-7 block"><span className="mb-2 block text-sm font-medium">ADMIN_TOKEN</span><input type="password" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} required autoComplete="off" className="focus-ring h-12 w-full rounded-xl border border-[#d1d1d6] px-4 outline-none focus:border-[#1a1a1a]" /></label>
          {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
          <button type="submit" disabled={loading} className="focus-ring mt-5 h-12 w-full rounded-xl bg-[#1a1a1a] text-sm font-medium text-white disabled:opacity-50">{loading ? "验证中…" : "验证并进入"}</button>
        </form>
      </div>
    );
  }

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "overview", label: "概览" }, { key: "users", label: "用户" }, { key: "codes", label: "兑换码" }, { key: "insights", label: "市场情报" },
  ];

  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-medium text-[#8e8e93]">费曼星运营</p><h1 className="mt-2 text-3xl font-semibold">管理后台</h1></div><button type="button" onClick={() => { setToken(""); setOverview(null); sessionStorage.removeItem("feiman_admin_token"); }} className="focus-ring w-fit rounded-xl border border-[#d1d1d6] px-4 py-2 text-sm">锁定后台</button></header>
      <nav className="mt-8 flex gap-1 overflow-x-auto border-b border-[#e5e5e7]" aria-label="管理后台栏目">{tabs.map((item) => <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`focus-ring whitespace-nowrap border-b-2 px-4 py-3 text-sm ${tab === item.key ? "border-[#1a1a1a] font-medium" : "border-transparent text-[#8e8e93]"}`}>{item.label}</button>)}</nav>
      {error ? <p role="alert" className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {tab === "overview" ? <div className="mt-8"><section className="grid gap-4 sm:grid-cols-3">{[["总用户", overview.stats.total_users], ["今日活跃", overview.stats.active_users_today], ["今日API调用", overview.stats.api_calls_today]].map(([label, value]) => <div key={label} className="rounded-2xl border border-[#e5e5e7] bg-[#f7f7f8] p-6"><p className="text-xs text-[#8e8e93]">{label}</p><p className="mt-3 text-3xl font-semibold">{value}</p></div>)}</section></div> : null}

      {tab === "users" ? <section className="mt-8 overflow-hidden rounded-2xl border border-[#e5e5e7]"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-[#f7f7f8] text-xs text-[#6e6e73]"><tr><th className="p-4">邮箱 / 用户ID</th><th className="p-4">套餐</th><th className="p-4">剩余次数</th><th className="p-4">到期时间</th><th className="p-4">注册时间</th></tr></thead><tbody className="divide-y divide-[#e5e5e7]">{overview.users.map((user) => <tr key={user.user_id}><td className="p-4"><p>{user.email}</p><p className="mt-1 font-mono text-[10px] text-[#8e8e93]">{user.user_id}</p></td><td className="p-4 uppercase">{user.plan}</td><td className="p-4">{user.daily_limit === -1 ? "不限" : user.remaining_calls}</td><td className="p-4">{user.expires_at ? new Date(user.expires_at).toLocaleDateString("zh-CN") : "长期"}</td><td className="p-4">{new Date(user.created_at).toLocaleDateString("zh-CN")}</td></tr>)}</tbody></table></div></section> : null}

      {tab === "codes" ? <section className="mt-8 grid gap-6 lg:grid-cols-[0.7fr_1.3fr]"><form onSubmit={generateCodes} className="h-fit rounded-2xl border border-[#e5e5e7] p-6"><h2 className="text-lg font-semibold">批量生成兑换码</h2><label className="mt-5 block text-sm"><span className="mb-2 block font-medium">套餐</span><select value={plan} onChange={(event) => setPlan(event.target.value)} className="focus-ring h-11 w-full rounded-lg border border-[#d1d1d6] px-3"><option value="lite">Lite</option><option value="pro">Pro</option><option value="vip">VIP</option></select></label><label className="mt-4 block text-sm"><span className="mb-2 block font-medium">数量（1-100）</span><input type="number" min={1} max={100} value={count} onChange={(event) => setCount(Number(event.target.value))} className="focus-ring h-11 w-full rounded-lg border border-[#d1d1d6] px-3" /></label><button type="submit" className="focus-ring mt-5 h-11 w-full rounded-xl bg-[#1a1a1a] text-sm font-medium text-white">生成兑换码</button>{generated.length ? <div className="mt-5 rounded-xl bg-[#f7f7f8] p-4"><p className="text-xs font-medium">本次生成 {generated.length} 个</p><pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap text-xs">{generated.join("\n")}</pre></div> : null}</form><div className="overflow-hidden rounded-2xl border border-[#e5e5e7]"><div className="max-h-[680px] overflow-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="sticky top-0 bg-[#f7f7f8] text-xs"><tr><th className="p-4">兑换码</th><th className="p-4">套餐</th><th className="p-4">状态</th><th className="p-4">使用时间</th></tr></thead><tbody className="divide-y divide-[#e5e5e7]">{overview.codes.map((code) => <tr key={code.id}><td className="p-4 font-mono text-xs">{code.code}</td><td className="p-4 uppercase">{code.plan}</td><td className="p-4">{code.is_used ? "已使用" : "未使用"}</td><td className="p-4 text-xs text-[#6e6e73]">{code.used_at ? new Date(code.used_at).toLocaleString("zh-CN") : "—"}</td></tr>)}</tbody></table></div></div></section> : null}

      {tab === "insights" ? <section className="mt-8"><div className="grid gap-3 rounded-2xl bg-[#f7f7f8] p-4 sm:grid-cols-3">{[["platform", "全部平台", insights?.options.platforms ?? []], ["industry", "全部行业", insights?.options.industries ?? []], ["sentiment", "全部情感", insights?.options.sentiments ?? []]] .map(([key, empty, options]) => <select key={String(key)} value={filters[key as keyof typeof filters]} onChange={(event) => { const next = { ...filters, [key as string]: event.target.value, page: 1 }; setFilters(next); void loadInsights(next); }} className="focus-ring h-11 rounded-lg border border-[#d1d1d6] bg-white px-3 text-sm"><option value="">{String(empty)}</option>{(options as string[]).map((value) => <option key={value} value={value}>{key === "sentiment" ? sentimentLabel[value] ?? value : value}</option>)}</select>)}</div><div className="mt-5 space-y-3">{insights?.data.map((item) => <article key={item.id} className="rounded-2xl border border-[#e5e5e7] p-5"><div className="flex flex-wrap items-center gap-2 text-xs"><span className="rounded-lg bg-[#f2f2f3] px-2 py-1">{item.platform}</span><span className="rounded-lg bg-[#f2f2f3] px-2 py-1">{item.industry}</span><span className="text-[#8e8e93]">{sentimentLabel[item.sentiment] ?? item.sentiment}</span></div><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[#454547]">{item.insight_text}</p>{item.source_url ? <a href={item.source_url} target="_blank" rel="noreferrer" className="focus-ring mt-3 inline-block rounded text-xs underline underline-offset-4">查看来源</a> : null}</article>)}</div>{insights ? <div className="mt-6 flex items-center justify-between text-sm"><span>共 {insights.count} 条</span><div className="flex gap-2"><button type="button" disabled={filters.page <= 1} onClick={() => { const next = { ...filters, page: filters.page - 1 }; setFilters(next); void loadInsights(next); }} className="focus-ring rounded-lg border border-[#d1d1d6] px-3 py-2 disabled:opacity-40">上一页</button><button type="button" disabled={filters.page * insights.pageSize >= insights.count} onClick={() => { const next = { ...filters, page: filters.page + 1 }; setFilters(next); void loadInsights(next); }} className="focus-ring rounded-lg border border-[#d1d1d6] px-3 py-2 disabled:opacity-40">下一页</button></div></div> : null}</section> : null}
    </div>
  );
}
