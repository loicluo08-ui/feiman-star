"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { formatFileSize } from "@/lib/file-upload";

type PlanState = {
  plan: string;
  remaining_calls: number;
  daily_limit: number;
  expires_at: string | null;
};

type KnowledgeFile = {
  id: string;
  filename: string;
  size_bytes: number;
  chunk_count: number;
  created_at: string;
};

type DashboardState = {
  email?: string;
  plan: PlanState | null;
  files: KnowledgeFile[];
};

function planLabel(plan?: string) {
  return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : "Free";
}

async function apiMessage(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as { error?: string | { message?: string } };
  return typeof payload.error === "string" ? payload.error : payload.error?.message ?? "请求失败";
}

export function DashboardPanel() {
  const [state, setState] = useState<DashboardState>({ plan: null, files: [] });
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async () => {
    setError("");
    try {
      const [sessionResponse, planResponse, filesResponse] = await Promise.all([
        fetch("/api/auth/session", { cache: "no-store" }),
        fetch("/api/plan", { cache: "no-store" }),
        fetch("/api/documents", { cache: "no-store" }),
      ]);
      if (!sessionResponse.ok || !planResponse.ok || !filesResponse.ok) {
        throw new Error("用户中心数据加载失败，请刷新重试");
      }
      const sessionPayload = (await sessionResponse.json()) as { user?: { email?: string } };
      const planPayload = (await planResponse.json()) as { data: PlanState | null };
      const filesPayload = (await filesResponse.json()) as { data: KnowledgeFile[] };
      setState({ email: sessionPayload.user?.email, plan: planPayload.data, files: filesPayload.data ?? [] });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "用户中心数据加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRedeeming(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      });
      if (!response.ok) throw new Error(await apiMessage(response));
      setCode("");
      setMessage("兑换成功，套餐与今日额度已更新。");
      await loadDashboard();
    } catch (redeemError) {
      setError(redeemError instanceof Error ? redeemError.message : "兑换失败");
    } finally {
      setRedeeming(false);
    }
  }

  async function removeDocument(id: string) {
    setError("");
    setMessage("");
    const response = await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (!response.ok) return setError(await apiMessage(response));
    setState((current) => ({ ...current, files: current.files.filter((file) => file.id !== id) }));
    setMessage("文档已从知识库删除。");
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  const plan = state.plan;

  return (
    <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-[#8e8e93]">用户中心</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em]">你好，{state.email?.split("@")[0] ?? "费曼星用户"}</h1>
          <p className="mt-2 text-sm text-[#6e6e73]">管理套餐额度、兑换码和专属知识库。</p>
        </div>
        <button type="button" onClick={logout} className="focus-ring w-fit rounded-xl border border-[#d1d1d6] px-4 py-2.5 text-sm font-medium hover:border-[#1a1a1a]">退出登录</button>
      </header>

      {loading ? <div className="mt-8 h-32 animate-pulse rounded-2xl bg-[#f7f7f8]" /> : null}
      {error ? <p role="alert" className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
      {message ? <p className="mt-6 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p> : null}

      {!loading ? (
        <>
          <section className="mt-8 grid gap-4 sm:grid-cols-3" aria-label="套餐信息">
            <div className="rounded-2xl border border-[#e5e5e7] bg-[#1a1a1a] p-6 text-white">
              <p className="text-xs text-white/60">当前套餐</p>
              <p className="mt-3 text-3xl font-semibold">{planLabel(plan?.plan)}</p>
            </div>
            <div className="rounded-2xl border border-[#e5e5e7] bg-[#f7f7f8] p-6">
              <p className="text-xs text-[#8e8e93]">今日剩余次数</p>
              <p className="mt-3 text-3xl font-semibold">{plan?.daily_limit === -1 ? "不限" : `${plan?.remaining_calls ?? 0} 次`}</p>
            </div>
            <div className="rounded-2xl border border-[#e5e5e7] bg-[#f7f7f8] p-6">
              <p className="text-xs text-[#8e8e93]">套餐到期时间</p>
              <p className="mt-3 text-lg font-semibold">{plan?.expires_at ? new Date(plan.expires_at).toLocaleDateString("zh-CN") : "长期有效"}</p>
            </div>
          </section>

          <section className="mt-8 grid gap-6 lg:grid-cols-[0.9fr_1.5fr]">
            <div className="rounded-2xl border border-[#e5e5e7] p-6">
              <h2 className="text-lg font-semibold">兑换套餐</h2>
              <p className="mt-2 text-sm leading-6 text-[#8e8e93]">输入购买后收到的兑换码，立即更新套餐。</p>
              <form onSubmit={redeem} className="mt-5">
                <label htmlFor="dashboard-code" className="sr-only">兑换码</label>
                <input id="dashboard-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="FS-XXXXX-XXXXX" required autoComplete="off" className="focus-ring h-12 w-full rounded-xl border border-[#d1d1d6] px-4 font-mono text-sm uppercase tracking-wider outline-none focus:border-[#1a1a1a]" />
                <button type="submit" disabled={redeeming} className="focus-ring mt-3 h-11 w-full rounded-xl bg-[#1a1a1a] text-sm font-medium text-white disabled:opacity-50">{redeeming ? "兑换中…" : "立即兑换"}</button>
              </form>
              <Link href="/pricing" className="focus-ring mt-4 inline-block rounded text-xs text-[#6e6e73] underline underline-offset-4">查看套餐说明</Link>
            </div>

            <div className="rounded-2xl border border-[#e5e5e7]">
              <div className="flex items-center justify-between border-b border-[#e5e5e7] p-6">
                <div>
                  <h2 className="text-lg font-semibold">已上传文档</h2>
                  <p className="mt-1 text-xs text-[#8e8e93]">{state.files.length} / 10 个文档</p>
                </div>
                <Link href="/knowledge" className="focus-ring rounded-lg bg-[#f2f2f3] px-3 py-2 text-xs font-medium">管理知识库</Link>
              </div>
              <div className="divide-y divide-[#e5e5e7]">
                {state.files.length === 0 ? <p className="p-6 text-sm text-[#8e8e93]">尚未上传文档。上传后，AI 对话会自动检索其中的内容。</p> : null}
                {state.files.map((file) => (
                  <article key={file.id} className="flex items-center justify-between gap-4 px-6 py-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{file.filename}</p>
                      <p className="mt-1 text-xs text-[#8e8e93]">{formatFileSize(file.size_bytes)} · {new Date(file.created_at).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" })}</p>
                    </div>
                    <button type="button" onClick={() => void removeDocument(file.id)} className="focus-ring shrink-0 rounded-lg border border-[#e5e5e7] px-3 py-2 text-xs font-medium hover:border-[#1a1a1a]">删除</button>
                  </article>
                ))}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
