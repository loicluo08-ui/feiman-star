/**
 * 关于页（10/27逸翔授权"你来做出最优决定"：填信息真空+反馈闭环）
 * 内容口径：每句可核验——定位/数据源/能力边界如实描述，零营销话术，零个人信息
 * 反馈表单 → POST /api/feedback → /lyx监控后台"用户反馈"区块
 */
"use client";

import { useState } from "react";
import Link from "next/link";

const KINDS = [
  { id: "suggestion", label: "功能建议" },
  { id: "bug", label: "问题反馈" },
  { id: "other", label: "其他" },
] as const;

export default function AboutPage() {
  const [kind, setKind] = useState<string>("suggestion");
  const [nickname, setNickname] = useState("");
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");
  const textLenOk = text.trim().length > 0 && text.trim().length <= 2000;

  async function submit() {
    if (!textLenOk || state === "sending") return;
    setState("sending");
    setErrMsg("");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, nickname: nickname.trim(), text: text.trim() }),
      });
      const json = await res.json();
      if (json.ok) {
        setState("done");
        setText("");
      } else {
        setState("error");
        setErrMsg(json.error || "提交失败，请稍后再试");
      }
    } catch {
      setState("error");
      setErrMsg("网络异常，请稍后再试");
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold">关于费曼星</h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">AI 驱动的美股分析研究工具</p>

      {/* 定位 */}
      <section className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-base font-semibold">这是什么</h2>
        <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">
          费曼星是一个个人研究性质的美股分析工具站，把实时行情、财报数据与 AI 分析放在同一个工作流里：
          快讯 AI 解读、AI 选股分析、交易复盘、投资对话，以及记录你每一次判断的判断账本。
          所有 AI 输出遵循判断先行：先给结论和依据，标注引用来源，不硬凑、不夸大。
        </p>
        <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">
          本站为免费使用，无付费墙，无广告，不要求注册券商或支付账号。
        </p>
      </section>

      {/* 数据源 */}
      <section className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-base font-semibold">数据来源</h2>
        <ul className="mt-3 space-y-2 text-sm leading-7 text-[var(--text-secondary)]">
          <li>· 行情报价：浏览器直连腾讯行情接口实时刷新（约10秒）</li>
          <li>· 指数与板块：服务端聚合多数据源</li>
          <li>· 财经快讯：公开财经快讯源聚合，AI 解读标注原文出处</li>
          <li>· 财报日历：公开财报数据整理</li>
        </ul>
      </section>

      {/* 能力边界 */}
      <section className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-base font-semibold">能力边界</h2>
        <ul className="mt-3 space-y-2 text-sm leading-7 text-[var(--text-secondary)]">
          <li>· AI 输出可能出错，关键数字请以交易所与公司公告原文为准</li>
          <li>· 本站不提供投资建议，不代客理财，不承诺收益</li>
          <li>· 你的对话与复盘数据保存在本地浏览器，可随时导出备份</li>
        </ul>
      </section>

      {/* 免责 */}
      <section className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-5">
        <p className="text-xs leading-6 text-[var(--text-muted)]">
          本工具仅供研究参考，不构成任何投资建议。市场有风险，投资需谨慎。
        </p>
      </section>

      {/* 反馈表单 */}
      <section className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-base font-semibold">联系与反馈</h2>
        <p className="mt-2 text-sm leading-7 text-[var(--text-secondary)]">
          发现问题或有建议，直接写在这里，开发者会在后台看到。
        </p>

        {state === "done" ? (
          <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm text-[var(--text-secondary)]">
            已收到，感谢反馈。
            <button
              onClick={() => setState("idle")}
              className="ml-2 text-[var(--primary)] underline-offset-2 hover:underline"
            >
              再写一条
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  onClick={() => setKind(k.id)}
                  className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                    kind === k.id
                      ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-muted)]"
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={30}
              placeholder="称呼（可选）"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--primary)]"
            />
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={2000}
              rows={5}
              placeholder="写点什么（必填，2000字以内）。请勿填写密码、券商账号等敏感信息。"
              className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm leading-6 outline-none focus:border-[var(--primary)]"
            />
            {state === "error" && <p className="text-xs text-red-500">{errMsg}</p>}
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-muted)]">{text.trim().length}/2000</span>
              <button
                onClick={submit}
                disabled={!textLenOk || state === "sending"}
                className="rounded-xl bg-[var(--primary)] px-5 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-opacity disabled:opacity-40"
              >
                {state === "sending" ? "提交中…" : "提交"}
              </button>
            </div>
          </div>
        )}
      </section>

      <p className="mt-8 text-center text-xs text-[var(--text-muted)]">
        <Link href="/" className="underline-offset-2 hover:underline">返回首页</Link>
      </p>
    </div>
  );
}
