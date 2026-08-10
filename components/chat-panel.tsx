"use client";

import { FormEvent, KeyboardEvent, useState } from "react";

type ChatItem = { role: "user" | "assistant"; content: string; sources?: string[] };

const suggestions = [
  { title: "健身卡退费怎么处理", desc: "消法引用 + 处理建议" },
  { title: "教培一对一多少钱", desc: "深圳政府指导价" },
  { title: "宠物绝育价格", desc: "各城市价格区间" },
  { title: "客户威胁打12315怎么办", desc: "博弈论应对策略" },
];

export function ChatPanel() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (!text || loading) return;
    setQuestion("");
    setMessages((items) => [...items, { role: "user", content: text }]);
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        data?: { answer?: string; sources?: string[] };
        error?: string | { message?: string };
      };
      if (!response.ok || !payload.data?.answer) {
        const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
        throw new Error(message ?? "AI回答失败，请稍后重试");
      }
      setMessages((items) => [...items, { role: "assistant", content: payload.data!.answer!, sources: payload.data!.sources }]);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "AI回答失败");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const form = event.currentTarget.form;
      if (form && !loading && question.trim()) form.requestSubmit();
    }
  }

  function askSuggestion(text: string) {
    setQuestion(text);
    const form = document.querySelector("form") as HTMLFormElement | null;
    if (form) form.requestSubmit();
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-[#e5e5e7] px-8 py-5">
        <h1 className="text-xl font-semibold tracking-tight">AI 对话</h1>
        <p className="mt-0.5 text-sm text-[#8e8e93]">自动检索系统知识库，基于行业数据回答问题</p>
      </header>

      <section className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8">
          {messages.length === 0 ? (
            <div className="flex min-h-[400px] flex-col items-center justify-center text-center">
              <div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-[#f7f7f8]">
                <svg viewBox="0 0 24 24" className="h-7 w-7 text-[#8e8e93]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                </svg>
              </div>
              <h2 className="text-lg font-medium">从一个问题开始</h2>
              <p className="mt-2 text-sm text-[#8e8e93]">AI会自动检索711条行业知识库，给出基于真实数据的回答</p>
              <div className="mt-8 grid w-full max-w-lg gap-2.5 sm:grid-cols-2">
                {suggestions.map((s) => (
                  <button key={s.title} onClick={() => askSuggestion(s.title)} className="group rounded-xl border border-[#e5e5e7] bg-white px-4 py-3 text-left transition-all hover:border-[#1a1a1a]/20 hover:shadow-sm">
                    <p className="text-sm font-medium text-[#1a1a1a]">{s.title}</p>
                    <p className="mt-0.5 text-xs text-[#8e8e93]">{s.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-2xl px-5 py-3.5 text-sm leading-7 ${message.role === "user" ? "bg-[#1a1a1a] text-white" : "border border-[#e5e5e7] bg-white"}`}>
                    <p className="whitespace-pre-wrap">{message.content}</p>
                    {message.sources?.length ? (
                      <div className="mt-3 border-t border-[#e5e5e7] pt-2.5">
                        <p className="text-xs text-[#8e8e93]">参考来源：{message.sources.join("、")}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              {loading ? (
                <div className="flex justify-start">
                  <div className="rounded-2xl border border-[#e5e5e7] bg-white px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-[#8e8e93]"></span>
                      <span className="h-2 w-2 animate-pulse rounded-full bg-[#8e8e93]" style={{ animationDelay: "0.2s" }}></span>
                      <span className="h-2 w-2 animate-pulse rounded-full bg-[#8e8e93]" style={{ animationDelay: "0.4s" }}></span>
                      <span className="ml-1 text-xs text-[#8e8e93]">正在检索知识库…</span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <div className="border-t border-[#e5e5e7] bg-white px-8 py-4">
        {error ? (
          <p role="alert" className="mx-auto mb-3 max-w-3xl rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>
        ) : null}
        <form onSubmit={submit} className="mx-auto max-w-3xl">
          <div className="flex gap-2.5">
            <textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={handleKeyDown} rows={1} maxLength={4000} placeholder="输入您的问题…（Enter发送，Shift+Enter换行）" className="focus-ring min-h-12 flex-1 resize-none rounded-xl border border-[#d1d1d6] px-4 py-3 text-sm outline-none transition-colors focus:border-[#1a1a1a]" />
            <button type="submit" disabled={loading || !question.trim()} className="focus-ring self-stretch rounded-xl bg-[#1a1a1a] px-5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40">发送</button>
          </div>
        </form>
      </div>
    </div>
  );
}
