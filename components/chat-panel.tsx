"use client";

import { FormEvent, useState } from "react";

type ChatItem = { role: "user" | "assistant"; content: string; sources?: string[] };

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

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-5 py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">AI 对话</h1>
        <p className="mt-2 text-sm text-[#8e8e93]">自动检索12行业系统知识库与您上传的专属文档。</p>
      </header>

      <section className="flex-1 space-y-4 rounded-2xl border border-[#e5e5e7] bg-[#f7f7f8] p-5 sm:p-6">
        {messages.length === 0 ? (
          <div className="grid min-h-[340px] place-items-center text-center">
            <div>
              <p className="font-medium">从一个问题开始</p>
              <p className="mt-2 text-sm text-[#8e8e93]">例如：根据我上传的产品手册，总结三个核心卖点。</p>
            </div>
          </div>
        ) : null}
        {messages.map((message, index) => (
          <article key={`${message.role}-${index}`} className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-7 ${message.role === "user" ? "ml-auto bg-[#1a1a1a] text-white" : "border border-[#e5e5e7] bg-white"}`}>
            <p className="whitespace-pre-wrap">{message.content}</p>
            {message.sources?.length ? <p className="mt-3 border-t border-[#e5e5e7] pt-2 text-xs text-[#8e8e93]">参考来源：{message.sources.join("、")}</p> : null}
          </article>
        ))}
        {loading ? <p className="text-sm text-[#8e8e93]">正在检索知识库并生成回答…</p> : null}
      </section>

      {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
      <form onSubmit={submit} className="mt-4 flex gap-3">
        <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={2} maxLength={4000} placeholder="输入您的问题…" className="focus-ring min-h-14 flex-1 resize-none rounded-xl border border-[#d1d1d6] px-4 py-3 text-sm outline-none focus:border-[#1a1a1a]" />
        <button type="submit" disabled={loading || !question.trim()} className="focus-ring self-stretch rounded-xl bg-[#1a1a1a] px-5 text-sm font-medium text-white disabled:opacity-40">发送</button>
      </form>
    </div>
  );
}
