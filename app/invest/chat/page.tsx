"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { getTask, startTask, type BackgroundTask } from "@/lib/background-task";

type AnalysisStyle = "balanced" | "value" | "growth" | "quant";

type ChatItem = {
  role: "user" | "assistant";
  text: string;
  imagePreview?: string;
};

type ChatHistoryRecord = {
  id: string;
  date: string;
  title: string;
  style: AnalysisStyle;
  messages: ChatItem[];
};

type ChatTaskResult = {
  messages: ChatItem[];
  history: ChatHistoryRecord[];
  historyId: string;
  style: AnalysisStyle;
};

class ChatTaskError extends Error {
  result: ChatTaskResult;

  constructor(message: string, result: ChatTaskResult) {
    super(message);
    this.name = "ChatTaskError";
    this.result = result;
  }
}

const CHAT_HISTORY_KEY = "feimanstar_chat_history";
const CHAT_TASK_KEY = "chat-response";

function readChatHistory(): ChatHistoryRecord[] {
  try {
    const saved = localStorage.getItem(CHAT_HISTORY_KEY);
    return saved ? (JSON.parse(saved) as ChatHistoryRecord[]).slice(0, 20) : [];
  } catch {
    return [];
  }
}

function storeConversation(
  messages: ChatItem[],
  style: AnalysisStyle,
  historyId: string,
): ChatHistoryRecord[] {
  const textOnlyMessages = messages.map((message) => ({
    role: message.role,
    text: message.text,
  }));
  const firstQuestion = textOnlyMessages.find((message) => message.role === "user")?.text ?? "投资对话";
  const record: ChatHistoryRecord = {
    id: historyId,
    date: new Date().toISOString(),
    title: firstQuestion.replace(/\s+/g, " ").slice(0, 48),
    style,
    messages: textOnlyMessages,
  };
  const next = [record, ...readChatHistory().filter((item) => item.id !== historyId)].slice(0, 20);
  try {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // 存储不可用时仍返回结果，不影响AI回复。
  }
  return next;
}

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
  const [style, setStyle] = useState<AnalysisStyle>("balanced");
  const [history, setHistory] = useState<ChatHistoryRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeHistoryId = useRef("");
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    setHistory(readChatHistory());

    const task = getTask<ChatTaskResult>(CHAT_TASK_KEY);
    const applyResult = (result: ChatTaskResult) => {
      if (!mountedRef.current) return;
      activeHistoryId.current = result.historyId;
      setMessages(result.messages);
      setHistory(result.history);
      setStyle(result.style);
      setLoading(false);
      setError("");
      scrollToBottom();
    };
    const applyError = (taskError: unknown) => {
      if (!mountedRef.current) return;
      if (taskError instanceof ChatTaskError) {
        activeHistoryId.current = taskError.result.historyId;
        setMessages(taskError.result.messages);
        setHistory(taskError.result.history);
        setStyle(taskError.result.style);
      }
      setLoading(false);
      setError(taskError instanceof Error ? taskError.message : "AI暂时不可用");
      scrollToBottom();
    };

    if (task?.status === "success" && task.result) {
      applyResult(task.result);
    } else if (task?.status === "error") {
      applyError(task.error);
    } else if (task?.status === "running") {
      setLoading(true);
      void task.promise.then(applyResult).catch(applyError);
    }

    return () => {
      mountedRef.current = false;
    };
  }, []);

  function loadConversation(record: ChatHistoryRecord) {
    activeHistoryId.current = record.id;
    setMessages(record.messages);
    setStyle(record.style);
    setShowHistory(false);
    setError("");
    scrollToBottom();
  }

  function deleteConversation(id: string) {
    setHistory((previous) => {
      const next = previous.filter((item) => item.id !== id);
      try {
        localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    if (activeHistoryId.current === id) activeHistoryId.current = "";
  }

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

  function submit(e: FormEvent) {
    e.preventDefault();
    const text = question.trim();
    if ((!text && !image) || loading) return;

    const userItem: ChatItem = {
      role: "user",
      text: text || "（图片）",
      imagePreview: image ?? undefined,
    };
    const currentMessages = messages;
    const currentStyle = style;
    const historyId = activeHistoryId.current || `${Date.now()}`;
    activeHistoryId.current = historyId;

    // 历史消息：只保留最近2轮的图片，更早的图片转为文字描述（避免payload过大）
    const recentImageCount = 2;
    let imageCount = 0;
    const apiMessages = [
      ...currentMessages.map((m) => {
        const hasImage = !!m.imagePreview;
        const includeImage = hasImage && imageCount < recentImageCount;
        if (hasImage) imageCount++;
        return {
          role: m.role,
          content: includeImage && m.imagePreview
            ? { type: "image" as const, dataUrl: m.imagePreview, text: m.text !== "（图片）" ? m.text : undefined }
            : { type: "text" as const, text: m.imagePreview ? `${m.text}（之前上传的图片省略）` : m.text }
        };
      }),
      {
        role: "user" as const,
        content: image
          ? { type: "image" as const, dataUrl: image, text: text || undefined }
          : { type: "text" as const, text },
      },
    ];

    setQuestion("");
    setImage(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setMessages([...currentMessages, userItem, { role: "assistant", text: "" }]);
    setLoading(true);
    setError("");
    scrollToBottom();

    const task: BackgroundTask<ChatTaskResult> = startTask(CHAT_TASK_KEY, async () => {
      try {
        const res = await fetch("/api/invest/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: apiMessages, style: currentStyle }),
        });

        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || "请求失败");
        }

        const json = await res.json();
        const answer = json.data?.answer ?? "";
        const completedMessages = [
          ...currentMessages,
          userItem,
          { role: "assistant" as const, text: answer },
        ];
        const nextHistory = storeConversation(completedMessages, currentStyle, historyId);
        return {
          messages: completedMessages,
          history: nextHistory,
          historyId,
          style: currentStyle,
        };
      } catch (taskError) {
        const message = taskError instanceof Error ? taskError.message : "AI暂时不可用";
        const failedMessages = [
          ...currentMessages,
          userItem,
          { role: "assistant" as const, text: `⚠️ ${message}` },
        ];
        const nextHistory = storeConversation(failedMessages, currentStyle, historyId);
        throw new ChatTaskError(message, {
          messages: failedMessages,
          history: nextHistory,
          historyId,
          style: currentStyle,
        });
      }
    });

    void task.promise.then((result) => {
      if (!mountedRef.current) return;
      setMessages(result.messages);
      setHistory(result.history);
      setLoading(false);
      setError("");
      scrollToBottom();
    }).catch((taskError: unknown) => {
      if (!mountedRef.current) return;
      if (taskError instanceof ChatTaskError) {
        setMessages(taskError.result.messages);
        setHistory(taskError.result.history);
      }
      setLoading(false);
      setError(taskError instanceof Error ? taskError.message : "AI暂时不可用");
      scrollToBottom();
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(e as unknown as FormEvent);
    }
  }

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col md:h-screen">
      {/* Header */}
      <header className="border-b border-[#e5e5e7] px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold">投资对话 · 支持截图分析</h1>
            <p className="mt-0.5 text-xs text-[#8e8e93]">发文字或截图，AI帮你分析。截图走智谱GLM-4V，文字走DeepSeek。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowHistory((visible) => !visible)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                showHistory
                  ? "border-[#1a1a1a] bg-[#1a1a1a] text-white"
                  : "border-[#d1d1d6] text-[#6e6e73] hover:border-[#1a1a1a]"
              }`}
            >
              历史记录{history.length > 0 ? ` ${history.length}` : ""}
            </button>
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
        </div>

        {showHistory ? (
          <div className="mx-auto mt-4 max-h-64 max-w-3xl overflow-y-auto rounded-xl border border-[#e5e5e7] bg-white">
            {history.length === 0 ? (
              <p className="px-4 py-5 text-center text-sm text-[#8e8e93]">还没有历史对话</p>
            ) : (
              history.map((record) => (
                <div key={record.id} className="flex items-center gap-3 border-b border-[#f2f2f3] px-4 py-3 last:border-0">
                  <button onClick={() => loadConversation(record)} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm font-medium text-[#1a1a1a]">{record.title}</p>
                    <p className="mt-0.5 text-xs text-[#8e8e93]">
                      {new Date(record.date).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" })}
                      {` · ${Math.ceil(record.messages.length / 2)}轮`}
                    </p>
                  </button>
                  <button
                    onClick={() => deleteConversation(record.id)}
                    className="shrink-0 text-xs text-[#8e8e93] transition-colors hover:text-red-600"
                    aria-label={`删除历史对话：${record.title}`}
                  >
                    删除
                  </button>
                </div>
              ))
            )}
          </div>
        ) : null}
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-6">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-2xl">
            {loading ? (
              <div className="mb-6 flex items-center justify-center gap-2 rounded-xl border border-[#e5e5e7] bg-white px-4 py-3 text-sm text-[#8e8e93]">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#e5e5e7] border-t-[#1a1a1a]" />
                AI回复中…
              </div>
            ) : null}
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
                  {m.text || (loading && i === messages.length - 1) ? (
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
