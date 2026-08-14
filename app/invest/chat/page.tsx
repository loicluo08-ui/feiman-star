"use client";

import { FormEvent, KeyboardEvent, useRef, useState } from "react";

type ChatItem = {
  role: "user" | "assistant";
  text: string;
  imagePreview?: string;
};

const suggestions = [
  { title: "帮我分析这张K线图", desc: "上传截图，AI解读走势" },
  { title: "这份财报的关键数据", desc: "上传财报截图，提取核心指标" },
  { title: "我的持仓合理吗", desc: "上传持仓截图，AI评估" },
  { title: "美股分红政策对比", desc: "纯文字问答" },
];

export default function ChatPage() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [style, setStyle] = useState<"balanced" | "value" | "growth" | "quant">("balanced");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }

  function handleImageChange(e: FormEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    if (!file) return;

    if (file.size > 4 * 1024 * 1024) {
      setError("图片不能超过4MB");
      return;
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("仅支持 JPG / PNG / WebP 格式");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setImage(result);
      setImagePreview(result);
      setError("");
    };
    reader.readAsDataURL(file);
  }

  function removeImage() {
    setImage(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = question.trim();
    if ((!text && !image) || loading) return;

    const userItem: ChatItem = {
      role: "user",
      text: text || "（图片）",
      imagePreview: image ?? undefined,
    };

    const apiMessages = [
      ...messages.map((m) => ({
        role: m.role,
        content: m.role === "user"
          ? { type: "text" as const, text: m.text }
          : { type: "text" as const, text: m.text }
      })),
      {
        role: "user" as const,
        content: image
          ? { type: "image" as const, dataUrl: image }
          : { type: "text" as const, text },
      },
    ];

    setQuestion("");
    setImage(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setMessages((prev) => [...prev, userItem, { role: "assistant", text: "" }]);
    setLoading(true);
    setError("");
    scrollToBottom();

    try {
      const res = await fetch("/api/invest/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, style }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "请求失败");
      }

      const json = await res.json();
      const answer = json.data?.answer ?? "";

      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "assistant", text: answer };
        return updated;
      });
    } catch (err) {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          text: `⚠️ ${err instanceof Error ? err.message : "AI暂时不可用"}`,
        };
        return updated;
      });
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(e as unknown as FormEvent);
    }
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="border-b border-[#e5e5e7] px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">投资对话 · 支持截图分析</h1>
            <p className="mt-0.5 text-xs text-[#8e8e93]">发文字或截图，AI帮你分析。截图走智谱GLM-4V，文字走DeepSeek。</p>
          </div>
          <div className="flex gap-1">
            {[
              { key: "balanced", label: "均衡" },
              { key: "value", label: "价值" },
              { key: "growth", label: "成长" },
              { key: "quant", label: "量化" },
            ].map((s) => (
              <button
                key={s.key}
                onClick={() => setStyle(s.key as typeof style)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  style === s.key
                    ? "bg-[#1a1a1a] text-white"
                    : "bg-[#f2f2f3] text-[#6e6e73] hover:bg-[#e5e5e7]"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-6">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-2xl">
            <div className="mb-6 text-center">
              <h2 className="text-xl font-semibold text-[#1a1a1a]">投资分析对话</h2>
              <p className="mt-2 text-sm text-[#6e6e73]">支持K线图、财报、持仓截图分析，也支持纯文字问答</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {suggestions.map((s) => (
                <button
                  key={s.title}
                  onClick={() => setQuestion(s.title)}
                  className="rounded-xl border border-[#e5e5e7] p-4 text-left transition-colors hover:border-[#1a1a1a] hover:bg-[#f7f7f8]"
                >
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="mt-1 text-xs text-[#8e8e93]">{s.desc}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] rounded-2xl bg-[#1a1a1a] px-4 py-2.5 text-sm text-white"
                      : "max-w-[85%] rounded-2xl border border-[#e5e5e7] bg-white px-4 py-2.5 text-sm text-[#1a1a1a]"
                  }
                >
                  {m.imagePreview ? (
                    <img src={m.imagePreview} alt="用户上传" className="mb-2 max-h-48 rounded-lg object-cover" />
                  ) : null}
                  {m.text ? (
                    <div className="whitespace-pre-wrap leading-6">{m.text || (loading && i === messages.length - 1 ? "思考中…" : "")}</div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-[#e5e5e7] bg-white px-5 py-4">
        {error ? <p className="mb-2 text-xs text-red-600">{error}</p> : null}
        <div className="mx-auto max-w-3xl">
          {/* 图片预览 */}
          {imagePreview ? (
            <div className="mb-2 inline-flex items-center gap-2 rounded-lg border border-[#e5e5e7] bg-[#f7f7f8] p-2">
              <img src={imagePreview} alt="待发送" className="h-12 w-12 rounded object-cover" />
              <button onClick={removeImage} className="text-xs text-[#8e8e93] hover:text-red-600">移除</button>
            </div>
          ) : null}
          <div className="flex gap-2.5">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#d1d1d6] transition-colors hover:border-[#1a1a1a]"
              title="上传截图"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleImageChange}
              className="hidden"
            />
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              maxLength={4000}
              placeholder="输入问题，或上传截图让AI分析…（Enter发送，Shift+Enter换行）"
              className="min-h-12 flex-1 resize-none rounded-xl border border-[#d1d1d6] px-4 py-3 text-sm outline-none transition-colors focus:border-[#1a1a1a]"
            />
            <button
              onClick={submit}
              disabled={loading || (!question.trim() && !image)}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#1a1a1a] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              title="发送"
            >
              {loading ? (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
