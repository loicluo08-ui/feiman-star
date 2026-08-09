"use client";

import { FormEvent, useEffect, useState } from "react";

type PlanState = {
  plan: string;
  remaining_calls: number;
  daily_limit: number;
  expires_at: string | null;
};

function planLabel(plan?: string) {
  return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : "Free";
}

export function RedeemForm() {
  const [code, setCode] = useState("");
  const [plan, setPlan] = useState<PlanState | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadPlan() {
    const response = await fetch("/api/plan", { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as { data?: PlanState };
    if (response.ok && payload.data) setPlan(payload.data);
  }

  useEffect(() => { void loadPlan(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        plan?: string;
        calls?: number;
      };
      if (!response.ok) throw new Error(payload.error ?? "兑换失败，请稍后重试");
      setMessage(`兑换成功，当前套餐为 ${planLabel(payload.plan)}。`);
      setCode("");
      await loadPlan();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "兑换失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
      <header className="mb-8">
        <p className="text-sm font-medium text-[#8e8e93]">账户与套餐</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">兑换套餐</h1>
        <p className="mt-3 text-sm leading-6 text-[#6e6e73]">输入购买后收到的兑换码，即刻更新每日 AI 使用额度。</p>
      </header>

      <section className="mb-6 rounded-2xl border border-[#e5e5e7] bg-[#f7f7f8] p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs text-[#8e8e93]">当前套餐</p>
            <p className="mt-1 text-2xl font-semibold">{planLabel(plan?.plan)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-[#8e8e93]">今日剩余</p>
            <p className="mt-1 text-lg font-medium">{plan?.daily_limit === -1 ? "不限" : plan ? `${plan.remaining_calls} 次` : "—"}</p>
          </div>
        </div>
        {plan?.expires_at ? <p className="mt-4 text-xs text-[#8e8e93]">有效期至 {new Date(plan.expires_at).toLocaleDateString("zh-CN")}</p> : null}
      </section>

      <form onSubmit={submit} className="rounded-2xl border border-[#e5e5e7] bg-white p-6 shadow-sm">
        <label className="block">
          <span className="mb-2 block text-sm font-medium">兑换码</span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="FS-XXXXX-XXXXX"
            autoComplete="off"
            required
            className="focus-ring h-12 w-full rounded-xl border border-[#d1d1d6] px-4 font-mono uppercase tracking-wider outline-none focus:border-[#1a1a1a]"
          />
        </label>
        {message ? <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p> : null}
        {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
        <button type="submit" disabled={loading} className="focus-ring mt-5 h-12 w-full rounded-xl bg-[#1a1a1a] text-sm font-medium text-white disabled:opacity-50">
          {loading ? "兑换中…" : "立即兑换"}
        </button>
      </form>

      <p className="mt-6 text-xs leading-5 text-[#8e8e93]">兑换码仅可使用一次。付费套餐有效期30天，每日额度于北京时间00:00重置。</p>
    </div>
  );
}
