"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { getTask, startTask, type BackgroundTask } from "@/lib/background-task";
import { MarkdownRenderer } from "@/components/markdown-renderer";

type AnalysisStyle = "balanced" | "value" | "growth" | "quant";

type ChatItem = {
  role: "user" | "assistant";
  text: string;
  imagePreviews?: string[];
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

type HistoryRange = "7" | "30" | "all";

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

function getMatchedSnippet(record: ChatHistoryRecord, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return "";
  const matched = record.messages.find((message) => message.text.toLocaleLowerCase().includes(normalizedQuery));
  if (!matched) return "";
  const text = matched.text.replace(/\s+/g, " ");
  const index = text.toLocaleLowerCase().indexOf(normalizedQuery);
  const start = Math.max(0, index - 32);
  const end = Math.min(text.length, index + query.trim().length + 56);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const keyword = query.trim();
  if (!keyword) return <>{text}</>;
  const lowerText = text.toLocaleLowerCase();
  const lowerKeyword = keyword.toLocaleLowerCase();
  const parts: Array<{ text: string; matched: boolean }> = [];
  let cursor = 0;

  while (cursor < text.length) {
    const index = lowerText.indexOf(lowerKeyword, cursor);
    if (index === -1) {
      parts.push({ text: text.slice(cursor), matched: false });
      break;
    }
    if (index > cursor) parts.push({ text: text.slice(cursor, index), matched: false });
    parts.push({ text: text.slice(index, index + keyword.length), matched: true });
    cursor = index + keyword.length;
  }

  return (
    <>
      {parts.map((part, index) => part.matched ? (
        <mark key={index} className="rounded-sm bg-[var(--warning-bg)] px-0.5 text-[var(--warning)]">{part.text}</mark>
      ) : <span key={index}>{part.text}</span>)}
    </>
  );
}

const suggestions = [
  { title: "帮我分析这张K线图", desc: "上传截图，AI解读走势" },
  { title: "这份财报的关键数据", desc: "上传财报截图，提取核心指标" },
  { title: "我的持仓合理吗", desc: "上传持仓截图，AI评估" },
  { title: "美股分红政策对比", desc: "纯文字问答" },
];

const sceneTemplates = [
  { label: "财报前仓位调整", text: "我持有XXX，下周出财报，应该怎么调整仓位？" },
  { label: "突破/跌破判断", text: "帮我分析这张K线图，是否突破/跌破关键位" },
  { label: "止损策略", text: "我持有XXX成本价$YY，现在价格$ZZ，应该怎么止损？" },
  { label: "组合评估", text: "帮我看下这张持仓截图，仓位配置合理吗？" },
];

export default function ChatPage() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [style, setStyle] = useState<AnalysisStyle>("balanced");
  const [history, setHistory] = useState<ChatHistoryRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyRange, setHistoryRange] = useState<HistoryRange>("all");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeHistoryId = useRef("");
  const mountedRef = useRef(false);

  const filteredHistory = useMemo(() => {
    const keyword = historyQuery.trim().toLocaleLowerCase();
    const cutoff = historyRange === "all"
      ? 0
      : Date.now() - Number(historyRange) * 24 * 60 * 60 * 1000;

    return history.filter((record) => {
      const recordTime = new Date(record.date).getTime();
      if (cutoff > 0 && (!Number.isFinite(recordTime) || recordTime < cutoff)) return false;
      if (!keyword) return true;
      return record.title.toLocaleLowerCase().includes(keyword)
        || record.messages.some((message) => message.text.toLocaleLowerCase().includes(keyword));
    });
  }, [history, historyQuery, historyRange]);

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stock = params.get("stock")?.trim().toUpperCase() ?? "";
    const name = params.get("name")?.trim() ?? "";
    if (!/^[A-Z]{1,6}$/.test(stock)) return;
    setQuestion((current) => current || `请分析${name ? `${name}（${stock}）` : stock}当前的投资机会、主要风险和仓位建议。`);
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

  async function handleImageChange(e: FormEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;

    if (images.length + files.length > 3) {
      setError("一次最多上传3张图片");
      input.value = "";
      return;
    }
    if (files.some((file) => file.size > 4 * 1024 * 1024)) {
      setError("单张图片不能超过4MB");
      input.value = "";
      return;
    }
    if (files.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
      setError("仅支持 JPG / PNG / WebP 格式");
      input.value = "";
      return;
    }

    try {
      const previews = await Promise.all(files.map((file) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("图片读取失败"));
        reader.readAsDataURL(file);
      })));
      setImages((previous) => [...previous, ...previews].slice(0, 3));
      setError("");
    } catch {
      setError("图片读取失败，请重新选择");
    } finally {
      input.value = "";
    }
  }

  function removeImage(index: number) {
    setImages((previous) => previous.filter((_, imageIndex) => imageIndex !== index));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const text = question.trim();
    if ((!text && images.length === 0) || loading) return;

    const currentImages = images;

    const userItem: ChatItem = {
      role: "user",
      text: text || `（${currentImages.length}张图片）`,
      imagePreviews: currentImages.length > 0 ? currentImages : undefined,
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
        const previews = m.imagePreviews ?? [];
        const hasImage = previews.length > 0;
        const includeImage = hasImage && imageCount < recentImageCount;
        if (hasImage) imageCount++;
        return {
          role: m.role,
          content: includeImage
            ? { type: "image" as const, dataUrls: previews, text: !m.text.startsWith("（") ? m.text : undefined }
            : { type: "text" as const, text: hasImage ? `${m.text}（之前上传的图片省略）` : m.text }
        };
      }),
      {
        role: "user" as const,
        content: currentImages.length > 0
          ? { type: "image" as const, dataUrls: currentImages, text: text || undefined }
          : { type: "text" as const, text },
      },
    ];

    setQuestion("");
    setImages([]);
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

        const contentType = res.headers.get("content-type") || "";
        let answer = "";

        if (contentType.includes("text/event-stream")) {
          if (!res.body) throw new Error("AI服务不可用");

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.trim()) continue;
              let data: { type: string; text?: string; message?: string };
              try {
                data = JSON.parse(line);
              } catch {
                continue;
              }

              if (data.type === "chunk") {
                answer += data.text ?? "";
              } else if (data.type === "patch") {
                answer = data.text ?? answer;
              } else if (data.type === "error") {
                throw new Error(data.message ?? "AI服务不可用");
              } else {
                continue;
              }

              if (mountedRef.current) {
                setMessages([
                  ...currentMessages,
                  userItem,
                  { role: "assistant", text: answer },
                ]);
                scrollToBottom();
              }
            }
          }
        } else {
          const json = await res.json();
          answer = json.data?.answer ?? "";
        }

        if (!answer.trim()) throw new Error("AI服务暂时不可用");

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
      <header className="border-b border-[var(--border)] px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold">投资对话 · 支持截图分析</h1>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">发文字或截图，AI帮你分析。截图走智谱GLM-4V，文字走DeepSeek。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowHistory((visible) => !visible)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                showHistory
                  ? "border-[var(--text)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "border-[var(--border-strong)] text-[var(--text-secondary)] hover:border-[var(--text)]"
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
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "bg-[var(--surface-muted)] text-[var(--text-secondary)] hover:bg-[var(--border)]"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {showHistory ? (
          <div className="mx-auto mt-4 max-h-64 max-w-3xl overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-[var(--border)] bg-[var(--surface)] p-3 sm:flex-row">
              <input
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
                placeholder="搜索历史对话…"
                aria-label="搜索历史对话"
                className="min-w-0 flex-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs outline-none transition-colors focus:border-[var(--text)]"
              />
              <select
                value={historyRange}
                onChange={(event) => setHistoryRange(event.target.value as HistoryRange)}
                aria-label="按日期筛选历史对话"
                className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-secondary)] outline-none focus:border-[var(--text)]"
              >
                <option value="7">最近7天</option>
                <option value="30">最近30天</option>
                <option value="all">全部</option>
              </select>
            </div>
            {history.length === 0 ? (
              <p className="px-4 py-5 text-center text-sm text-[var(--text-muted)]">还没有历史对话</p>
            ) : filteredHistory.length === 0 ? (
              <p className="px-4 py-5 text-center text-sm text-[var(--text-muted)]">没有匹配的历史对话</p>
            ) : (
              filteredHistory.map((record) => {
                const snippet = getMatchedSnippet(record, historyQuery);
                return (
                <div key={record.id} className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
                  <button onClick={() => loadConversation(record)} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm font-medium text-[var(--text)]">
                      <HighlightedText text={record.title} query={historyQuery} />
                    </p>
                    {snippet && snippet !== record.title ? (
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--text-secondary)]">
                        <HighlightedText text={snippet} query={historyQuery} />
                      </p>
                    ) : null}
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                      {new Date(record.date).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" })}
                      {` · ${Math.ceil(record.messages.length / 2)}轮`}
                    </p>
                  </button>
                  <button
                    onClick={() => deleteConversation(record.id)}
                    className="shrink-0 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--negative)]"
                    aria-label={`删除历史对话：${record.title}`}
                  >
                    删除
                  </button>
                </div>
                );
              })
            )}
          </div>
        ) : null}
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-6">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-2xl">
            {loading ? (
              <div className="mb-6 flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-muted)]">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--text)]" />
                AI回复中…
              </div>
            ) : null}
            <div className="mb-6 text-center">
              <h2 className="text-xl font-semibold text-[var(--text)]">投资分析对话</h2>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">支持K线图、财报、持仓截图分析，也支持纯文字问答</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {suggestions.map((s) => (
                <button
                  key={s.title}
                  onClick={() => setQuestion(s.title)}
                  className="rounded-xl border border-[var(--border)] p-4 text-left transition-colors hover:border-[var(--text)] hover:bg-[var(--surface-subtle)]"
                >
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{s.desc}</p>
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
                      ? "max-w-[85%] rounded-2xl bg-[var(--primary)] px-4 py-2.5 text-sm text-[var(--primary-foreground)]"
                      : "max-w-[85%] rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--text)]"
                  }
                >
                  {m.imagePreviews?.length ? (
                    <div className="mb-2 grid grid-cols-3 gap-2">
                      {m.imagePreviews.map((preview, imageIndex) => (
                        <img key={imageIndex} src={preview} alt={`用户上传 ${imageIndex + 1}`} className="max-h-48 rounded-lg object-cover" />
                      ))}
                    </div>
                  ) : null}
                  {m.text ? (
                    m.role === "assistant" ? (
                      <>
                        <MarkdownRenderer content={m.text} />
                        {loading && i === messages.length - 1 ? (
                          <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-[var(--text)] align-text-bottom" />
                        ) : null}
                      </>
                    ) : (
                      <div className="whitespace-pre-wrap leading-6">{m.text}</div>
                    )
                  ) : loading && i === messages.length - 1 ? (
                    <div className="flex items-center gap-1 text-sm text-[var(--text-muted)]">
                      <span className="inline-block h-4 w-0.5 animate-pulse bg-[var(--text)]" />
                      思考中…
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-[var(--border)] bg-[var(--surface)] px-5 py-4">
        {error ? <p className="mb-2 text-xs text-[var(--negative)]">{error}</p> : null}
        <div className="mx-auto max-w-3xl">
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
            {sceneTemplates.map((template) => (
              <button
                key={template.label}
                type="button"
                onClick={() => setQuestion(template.text)}
                className="shrink-0 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--text)] hover:text-[var(--text)]"
              >
                {template.label}
              </button>
            ))}
          </div>
          {/* 图片预览 */}
          {images.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-2">
              {images.map((preview, imageIndex) => (
                <div key={imageIndex} className="relative">
                  <img src={preview} alt={`待发送 ${imageIndex + 1}`} className="h-14 w-14 rounded object-cover" />
                  <button
                    onClick={() => removeImage(imageIndex)}
                    className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-[var(--primary)] text-xs text-[var(--primary-foreground)]"
                    aria-label={`移除第${imageIndex + 1}张图片`}
                  >
                    ×
                  </button>
                </div>
              ))}
              <span className="self-center px-1 text-xs text-[var(--text-muted)]">{images.length}/3</span>
            </div>
          ) : null}
          <div className="flex gap-2.5">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={images.length >= 3}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[var(--border-strong)] transition-colors hover:border-[var(--text)]"
              title={images.length >= 3 ? "最多上传3张图片" : "上传截图（最多3张）"}
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
              multiple
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
              className="min-h-12 flex-1 resize-none rounded-xl border border-[var(--border-strong)] px-4 py-3 text-sm outline-none transition-colors focus:border-[var(--text)]"
            />
            <button
              onClick={submit}
              disabled={loading || (!question.trim() && images.length === 0)}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-40"
              title="发送"
            >
              {loading ? (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--primary-foreground)]" />
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
