"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { getTask, startTask, clearTask, type BackgroundTask } from "@/lib/background-task";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { TypewriterText } from "@/components/typewriter-text";

// 12风格=4基础+大师融合旗舰+6大师+海龟（模块11思维框架库）。route的zod enum与此保持一致
type AnalysisStyle = "balanced" | "value" | "growth" | "quant" | "blend" | "munger" | "buffett" | "livermore" | "turtle" | "duan" | "soros" | "musk";

// 大师视角按钮组（默认收起，点「大师视角」展开——4+6全铺开挤占移动端）
const GURU_STYLES: Array<{ key: AnalysisStyle; label: string; hint: string }> = [
  { key: "munger", label: "芒格", hint: "多元思维+逆向思考：先问会怎么死" },
  { key: "buffett", label: "巴菲特", hint: "护城河+内在价值+市场先生" },
  { key: "livermore", label: "利弗莫尔", hint: "关键点+最小阻力线+止损铁律" },
  { key: "turtle", label: "海龟", hint: "突破入场+ATR头寸+2N止损+机械纪律" },
  { key: "duan", label: "段永平", hint: "买股票就是买公司+不懂不做" },
  { key: "soros", label: "索罗斯", hint: "反身性+找市场共识的错误" },
  { key: "musk", label: "马斯克", hint: "第一性原理：行业的理论最优解" },
];

type ChatItem = {
  role: "user" | "assistant";
  text: string;
  imagePreviews?: string[];
  /** GLM-4V转述（两段式管线回存）：追问时以文本复用，图片不再重传 */
  imageAnalysis?: string;
};

type ChatHistoryRecord = {
  id: string;
  date: string;
  title: string;
  style: AnalysisStyle;
  messages: ChatItem[];
  /** 滚动摘要（长对话记忆）：窗口外对话的压缩版，随历史存档，重载会话后恢复 */
  summary?: string;
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
  summaryText?: string,
): ChatHistoryRecord[] {
  const textOnlyMessages = messages.map((message) => ({
    role: message.role,
    text: message.text,
    // 转述随历史存档（预览dataURL仍剥离防localStorage爆容）：重载会话后追问依然能复用图片上下文
    ...(message.imageAnalysis ? { imageAnalysis: message.imageAnalysis } : {}),
  }));
  const firstQuestion = textOnlyMessages.find((message) => message.role === "user")?.text ?? "投资对话";
  const record: ChatHistoryRecord = {
    id: historyId,
    date: new Date().toISOString(),
    title: firstQuestion.replace(/\s+/g, " ").slice(0, 48),
    style,
    messages: textOnlyMessages,
    // 滚动摘要随历史存档：重载会话后loadConversation恢复（长对话跨会话不失忆）
    ...(summaryText ? { summary: summaryText } : {}),
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
  { title: "现在美股市场有什么大事？", desc: "AI结合实时快讯作答（自动注入）" },
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
  // 大师视角按钮展开态：切到大师风格后保持展开（防「选中项藏在收起组里」的迷失感），关闭新对话不重置
  const [showGurus, setShowGurus] = useState(false);
  const [history, setHistory] = useState<ChatHistoryRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyRange, setHistoryRange] = useState<HistoryRange>("all");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeHistoryId = useRef("");
  const mountedRef = useRef(false);
  // 会话纪元：新对话/切换历史时+1，旧流的迟到结果不再写UI（防串话）
  const epochRef = useRef(0);
  // 中止当前AI流
  const abortRef = useRef<AbortController | null>(null);
  // 最近一次提交的快照（失败重试用）
  const lastSubmitRef = useRef<{ text: string; images: string[]; baseMessages: ChatItem[] } | null>(null);
  // 智能滚动：仅当用户在底部附近才自动跟滚
  const nearBottomRef = useRef(true);
  const [nearBottom, setNearBottom] = useState(true);
  // 流式状态行（后端status事件：注入进度/生成状态）
  const [statusLine, setStatusLine] = useState("");
  // 步骤化状态栈（agentmore式流动性）：每个status事件一条，最新呼吸高亮、旧步骤打勾——
  // 用户看到的是"过程感"（注入行情→注入快讯→生成中）而不是单行覆盖
  const [statusSteps, setStatusSteps] = useState<string[]>([]);
  const [copiedIndex, setCopiedIndex] = useState(-1);
  // 长对话滚动摘要（窗口外记忆）：会话级状态，随历史持久化
  const summaryRef = useRef("");
  const lastSummarizedCountRef = useRef(0); // 上次摘要时窗口外消息条数（每溢出4条重摘要）
  const [summary] = useState(() => ({ get: () => summaryRef.current, set: (v: string) => { summaryRef.current = v; } }));

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

  /** 作废进行中的流：中止+清任务+纪元+1+复位loading。新对话/切换历史共用（防旧结果串进新会话） */
  function invalidateRunningTask() {
    epochRef.current += 1;
    abortRef.current?.abort();
    clearTask(CHAT_TASK_KEY);
    setStatusLine("");
    setStatusSteps([]);
    setLoading(false);
  }

  function startNewConversation() {
    invalidateRunningTask();
    activeHistoryId.current = "";
    lastSubmitRef.current = null;
    setMessages([]);
    setError("");
    // 摘要状态随会话重置
    summary.set("");
    lastSummarizedCountRef.current = 0;
  }

  function loadConversation(record: ChatHistoryRecord) {
    if (loading) invalidateRunningTask();
    activeHistoryId.current = record.id;
    lastSubmitRef.current = null;
    setMessages(record.messages);
    setStyle(record.style);
    setShowHistory(false);
    setError("");
    // 摘要恢复：历史存档里的summary（无则空，窗口外消息在下次提交时重新触发摘要）
    summary.set(record.summary ?? "");
    lastSummarizedCountRef.current = record.summary ? Math.max(0, record.messages.length - 11) : 0;
    nearBottomRef.current = true;
    setNearBottom(true);
    scrollToBottom(true);
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

  /** 滚动跟随：用户上滑离开底部后暂停自动跟滚，回到底部附近恢复 */
  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom !== nearBottomRef.current) {
      nearBottomRef.current = atBottom;
      setNearBottom(atBottom);
    }
  }

  function scrollToBottom(force = false) {
    if (!force && !nearBottomRef.current) return;
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }

  /** 复制AI回答（https安全上下文下可用，失败静默） */
  async function copyAnswer(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => {
        setCopiedIndex((current) => (current === index ? -1 : current));
      }, 1500);
    } catch {
      // clipboard API不可用（非安全上下文）——静默跳过
    }
  }

  /** 输入框自动增高（1~5行），发送后复位 */
  function autoResizeTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }

  /** 共用图片入口：校验+读DataURL（文件选择与粘贴复用同一套规则） */
  async function addImagesFromFiles(files: File[]): Promise<string> {
    if (files.length === 0) return "";
    if (images.length + files.length > 3) {
      return "一次最多上传3张图片";
    }
    if (files.some((file) => file.size > 4 * 1024 * 1024)) {
      return "单张图片不能超过4MB";
    }
    if (files.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
      return "仅支持 JPG / PNG / WebP 格式";
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
      return "";
    } catch {
      return "图片读取失败，请重新选择";
    }
  }

  async function handleImageChange(e: FormEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const files = Array.from(input.files ?? []);
    const errMsg = await addImagesFromFiles(files);
    if (errMsg) setError(errMsg);
    input.value = "";
  }

  /** 粘贴截图：聊天框内Ctrl+V/长按粘贴直接进预览区（9/6新增，移动端iOS粘贴板图片file.type可能为空，按扩展名兜底） */
  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageFiles = items
      .filter((item) => item.kind === "file" && (item.type.startsWith("image/") || item.type === ""))
      .map((item) => item.getAsFile())
      .filter((file): file is File => {
        if (!file) return false;
        if (file.type) return file.type.startsWith("image/");
        // type为空时按文件名扩展名兜底（部分移动端浏览器截图file.type为空字符串）
        return /\.(jpe?g|png|webp)$/i.test(file.name);
      });
    if (imageFiles.length === 0) return; // 纯文本粘贴走默认行为，不拦截
    e.preventDefault(); // 有图片才拦截默认，避免图片被当URL/文本插入
    const errMsg = await addImagesFromFiles(imageFiles);
    if (errMsg) setError(errMsg);
  }

  function removeImage(index: number) {
    setImages((previous) => previous.filter((_, imageIndex) => imageIndex !== index));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const text = question.trim();
    if ((!text && images.length === 0) || loading) return;
    sendChat(text, images, messages);
    setQuestion("");
    setImages([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (textareaRef.current) {
      textareaRef.current.style.height = "";
      textareaRef.current.focus(); // 连续提问不掉输入焦点
    }
  }

  /** 失败重试：用上次提交的原始输入重发（消息回滚到提交前状态） */
  function retrySubmit() {
    if (loading) return;
    const last = lastSubmitRef.current;
    if (!last) return;
    setError("");
    sendChat(last.text, last.images, last.baseMessages);
  }

  /** 停止生成：中止fetch流，已生成部分保留（后端流被断开后任务自行收尾） */
  function stopGeneration() {
    abortRef.current?.abort();
  }

  async function sendChat(text: string, currentImages: string[], baseMessages: ChatItem[]) {
    const currentStyle = style;
    const historyId = activeHistoryId.current || `${Date.now()}`;
    activeHistoryId.current = historyId;
    const epoch = epochRef.current;
    lastSubmitRef.current = { text, images: currentImages, baseMessages };

    const userItem: ChatItem = {
      role: "user",
      text: text || `（${currentImages.length}张图片）`,
      imagePreviews: currentImages.length > 0 ? currentImages : undefined,
    };
    const currentMessages = baseMessages;

    // 两段式管线：历史图消息一律降级为转述文本（后端image_analysis事件回存的描述），只有本轮带真实图片
    // 修复：发图后的追问曾被静默降级到GLM-4V直答路径（1024顶/无KB/无框架）——现在追问走DeepSeek全上下文
    // 窗口条数动态：有摘要时10条（摘要占1条头位，总数仍=后端slice(-12)满窗口）
    const currentSummary = summary.get();
    const windowSize = currentSummary ? 10 : 11;
    const messagesWindow = currentMessages.slice(-windowSize);
    const apiMessages = [
      ...(currentSummary
        ? [{ role: "user" as const, content: { type: "text" as const, text: `[前情摘要（系统压缩的历史对话记忆，供上下文，数字可信）]\n${currentSummary}` } }]
        : []),
      ...messagesWindow.map((m) => {
        const previews = m.imagePreviews ?? [];
        if (previews.length > 0) {
          // 本会话内的图消息（发图当轮之后）
          return {
            role: m.role,
            content: m.imageAnalysis
              ? { type: "text" as const, text: `（用户发送过${previews.length}张图片，视觉引擎转述：\n${m.imageAnalysis}\n）\n${m.text}` }
              : { type: "text" as const, text: `${m.text}（之前上传的图片省略）` },
          };
        }
        if (m.imageAnalysis) {
          // 历史重载的图消息（预览已剥离，转述是图片的唯一痕迹）
          return {
            role: m.role,
            content: { type: "text" as const, text: `（用户发送过图片，视觉引擎转述：\n${m.imageAnalysis}\n）\n${m.text}` },
          };
        }
        return { role: m.role, content: { type: "text" as const, text: m.text } };
      }),
      {
        role: "user" as const,
        content: currentImages.length > 0
          ? { type: "image" as const, dataUrls: currentImages, text: text || undefined }
          : { type: "text" as const, text },
      },
    ];

    // 滚动摘要维护：窗口外（不含本轮）消息数比上次摘要多≥4条→fire-and-forget更新（本轮用旧摘要，下次生效）
    // 不阻塞发送：摘要调用2-5s，阻塞=每次发送都加延迟；失败静默（下次再试）
    const overflowCount = currentMessages.length - windowSize;
    if (overflowCount > 0 && overflowCount - lastSummarizedCountRef.current >= 4) {
      const prevSummarized = lastSummarizedCountRef.current;
      const newPart = currentMessages.slice(Math.max(0, prevSummarized), currentMessages.length - windowSize)
        .filter((m) => m.text.trim().length > 0)
        .slice(-8)
        .map((m) => ({ role: m.role, text: m.text }));
      lastSummarizedCountRef.current = overflowCount;
      if (newPart.length > 0) {
        void fetch("/api/invest/chat-summarize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prevSummary: currentSummary, messages: newPart }),
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((json: { summary?: string } | null) => {
            if (json?.summary) summary.set(json.summary);
          })
          .catch(() => {
            // 摘要失败回退计数，下次重试
            lastSummarizedCountRef.current = prevSummarized;
          });
      }
    }

    setMessages([...currentMessages, userItem, { role: "assistant", text: "" }]);
    setLoading(true);
    setError("");
    setStatusLine("");
    setStatusSteps([]);
    nearBottomRef.current = true;
    setNearBottom(true);
    scrollToBottom(true);

    const task: BackgroundTask<ChatTaskResult> = startTask(CHAT_TASK_KEY, async () => {
      let answer = "";
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch("/api/invest/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: apiMessages, style: currentStyle }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || "请求失败");
        }

        const contentType = res.headers.get("content-type") || "";

        if (contentType.includes("text/event-stream")) {
          if (!res.body) throw new Error("AI服务不可用");

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let receivedDone = false;

          // 流式渲染节流：chunk只进answer缓冲，~100ms批量刷UI。
          // 长回答600+chunk=600+次全量markdown重解析（移动端卡顿源），节流后≈每秒10刷
          let flushTimer: ReturnType<typeof setTimeout> | null = null;
          const flushNow = () => {
            if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
            if (mountedRef.current && epochRef.current === epoch) {
              setMessages([
                ...currentMessages,
                userItem,
                { role: "assistant", text: answer },
              ]);
              scrollToBottom();
            }
          };
          const scheduleFlush = () => {
            if (flushTimer != null) return;
            flushTimer = setTimeout(() => { flushTimer = null; flushNow(); }, 100);
          };

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                // 连接断开：如果没收到done事件，补上中断提示
                if (answer && !receivedDone) {
                  answer += "\n\n---\n\n⚠️ 连接中断，以上为已生成的部分内容。如需完整分析请重新提问。";
                }
                flushNow();
                break;
              }

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
                } else if (data.type === "image_analysis") {
                  // 两段式管线回存：图片转述挂到本轮用户消息（追问复用+历史存档，见apiMessages降级逻辑）
                  userItem.imageAnalysis = data.text ?? "";
                  continue; // 不落消息体，随下一条chunk的重渲染显示
                } else if (data.type === "status") {
                  if (mountedRef.current && epochRef.current === epoch) {
                    const statusText = data.text ?? "";
                    setStatusLine(statusText);
                    // 步骤栈：同文本去重（重试/续写轮次间不重复堆叠）
                    // 思维链透传（"深度思考中…"+链尾滚动，思考期可达几十次）：
                    // 替换栈顶而非追加——Claude式单行滚动体验，防止思考碎片把
                    // "已注入行情N只"等关键注入步骤淹没（步骤栈变思考轰炸=体验倒退）
                    setStatusSteps((prev) => {
                      const last = prev[prev.length - 1];
                      const isThinkingFeed = statusText.startsWith("深度思考中");
                      const lastIsThinkingFeed = last?.startsWith("深度思考中");
                      if (isThinkingFeed && lastIsThinkingFeed) {
                        const next = [...prev];
                        next[next.length - 1] = statusText;
                        return next;
                      }
                      return last === statusText ? prev : [...prev, statusText];
                    });
                  }
                  continue; // 状态行不落消息体
                } else if (data.type === "done") {
                  receivedDone = true;
                  break;
                } else if (data.type === "error") {
                  throw new Error(data.message ?? "AI服务不可用");
                } else {
                  continue; // ping等心跳事件静默跳过
                }

                scheduleFlush();
              }
            }
            // 最终态同步刷（防最后一次节流未触发）
            flushNow();
          } finally {
            // 清残留定时器：停止/异常路径下晚到的flush会覆盖catch分支已写入的终态消息
            if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
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
        const nextHistory = storeConversation(completedMessages, currentStyle, historyId, summary.get() || undefined);
        return {
          messages: completedMessages,
          history: nextHistory,
          historyId,
          style: currentStyle,
        };
      } catch (taskError) {
        // 手动停止且已有部分输出：按成功收尾（保留已生成内容），不进错误分支
        const isAbort = (taskError as { name?: string } | null)?.name === "AbortError";
        if (isAbort && answer.trim()) {
          const stoppedMessages = [
            ...currentMessages,
            userItem,
            { role: "assistant" as const, text: `${answer}\n\n（已停止生成）` },
          ];
          const nextHistory = storeConversation(stoppedMessages, currentStyle, historyId, summary.get() || undefined);
          return {
            messages: stoppedMessages,
            history: nextHistory,
            historyId,
            style: currentStyle,
          };
        }

        const message = isAbort
          ? "已停止生成"
          : taskError instanceof Error ? taskError.message : "AI暂时不可用";
        // 失败轮不写历史：⚠️死对话进localStorage=会话列表永久留疤+重载会话后作为assistant
        // 上下文发给API（污染模型输入+白烧token）。失败原因走error bar展示（下方catch渲染），
        // UI保留user消息+重试入口；重试成功后完整轮才落历史（storeConversation按historyId覆盖）
        const nextHistory = readChatHistory();
        throw new ChatTaskError(message, {
          messages: [...currentMessages, userItem],
          history: nextHistory,
          historyId,
          style: currentStyle,
        });
      } finally {
        // 只清理自己创建的controller（防并发任务误清新任务的停止句柄）
        if (abortRef.current === controller) abortRef.current = null;
      }
    });

    void task.promise.then((result) => {
      if (!mountedRef.current || epochRef.current !== epoch) return;
      setMessages(result.messages);
      setHistory(result.history);
      setLoading(false);
      setError("");
      setStatusLine("");
      setStatusSteps([]);
      scrollToBottom();
    }).catch((taskError: unknown) => {
      if (!mountedRef.current || epochRef.current !== epoch) return;
      if (taskError instanceof ChatTaskError) {
        setMessages(taskError.result.messages);
        setHistory(taskError.result.history);
      }
      setLoading(false);
      setError(taskError instanceof Error ? taskError.message : "AI暂时不可用");
      setStatusLine("");
      setStatusSteps([]);
      scrollToBottom();
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (loading) {
        stopGeneration();
        return;
      }
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
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">发文字或截图，AI帮你分析。截图走智谱GLM-4V，文字走DeepSeek（自动注入实时行情与最新快讯）。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={startNewConversation}
              className="rounded-md border border-[var(--border-strong)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--text)] hover:text-[var(--text)]"
              title="开始新对话（当前对话自动存入历史）"
            >
              新对话
            </button>
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
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  const data = localStorage.getItem(CHAT_HISTORY_KEY) || "[]";
                  const blob = new Blob([data], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `feimanstar-chat-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="rounded-md px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-muted)]"
                title="导出对话记录"
              >
                导出
              </button>
              <label className="cursor-pointer rounded-md px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-muted)]">
                导入
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const text = await file.text();
                      const imported = JSON.parse(text);
                      if (Array.isArray(imported)) {
                        const existing = readChatHistory();
                        const merged = [...imported, ...existing].slice(0, 50);
                        localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(merged));
                        setHistory(merged.slice(0, 20));
                      }
                    } catch {}
                  }}
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-1">
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
              {/* 大师融合旗舰：多视角审视→交叉检验→融合单一深度输出（v4-pro+thinking）。首字慢（思维链30-60s）但深度最高 */}
              <button
                onClick={() => setStyle("blend")}
                title="大师融合旗舰模式：按标的选3-4位大师视角分别审视+交叉检验，融合为单一深度输出（走v4-pro深度模型，首字约30-60秒）"
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                  style === "blend"
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-sm"
                    : "border border-[var(--primary)]/60 text-[var(--primary)] hover:bg-[var(--primary)]/10"
                }`}
              >
                ⚡大师融合
              </button>
              <button
                onClick={() => setShowGurus((v) => !v)}
                className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                  showGurus || GURU_STYLES.some((g) => g.key === style)
                    ? "border border-[var(--text)] text-[var(--text)]"
                    : "border border-[var(--border-strong)] text-[var(--text-secondary)] hover:border-[var(--text)]"
                }`}
                title="展开6种投资大师视角（基于罗竹先框架的模块11思维框架库）"
              >
                大师视角
              </button>
              {showGurus &&
                GURU_STYLES.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setStyle(s.key as typeof style)}
                    title={s.hint}
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
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={handleScroll} className="h-full overflow-y-auto px-5 py-6">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-2xl">
            {loading ? (
              <div className="mb-6 flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-muted)]">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--text)]" />
                {statusLine || "AI回复中…"}
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
              <div key={i} className={`msg-in ${m.role === "user" ? "flex justify-end" : "flex justify-start"}`}>
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
                  {m.imageAnalysis ? (
                    <details className="mb-1 rounded-md bg-[var(--surface-subtle)] px-2 py-1">
                      <summary className="cursor-pointer text-xs text-[var(--text-muted)]">📎 图片识别摘要（追问时AI会复用）</summary>
                      <div className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[var(--text-muted)]">{m.imageAnalysis}</div>
                    </details>
                  ) : null}
                  {m.text ? (
                    m.role === "assistant" ? (
                      loading && i === messages.length - 1 ? (
                        /* 流式中：字符级打字机轻渲染（完成后父层切markdown全排版）+
                           底部动态状态行——agentmore式流动性 */
                        <>
                          <TypewriterText target={m.text} className="whitespace-pre-wrap break-words leading-6" />
                          <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--primary)]" />
                            {statusLine || "生成中…"}
                          </div>
                        </>
                      ) : (
                        <>
                          <MarkdownRenderer content={m.text} />
                          <div className="mt-2 flex items-center gap-3">
                            <button
                              onClick={() => void copyAnswer(m.text, i)}
                              className="text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
                              aria-label="复制本条AI回答"
                            >
                              {copiedIndex === i ? "已复制 ✓" : "复制"}
                            </button>
                            {/* 截断/停止/中断的一键续写：后端规则12支持"继续"从断点续写，
                                只提示打字门槛高——按钮直接发"继续"，baseMessages带完整上下文 */}
                            {!loading
                              && i === messages.length - 1
                              && (m.text.includes("因长度上限被截断")
                                || m.text.includes("（已停止生成）")
                                || m.text.includes("AI生成中断")) ? (
                              <button
                                onClick={() => void sendChat("继续", [], messages)}
                                className="text-xs text-[var(--primary)] transition-colors hover:opacity-80"
                                aria-label="从断点继续生成"
                              >
                                继续生成 →
                              </button>
                            ) : null}
                          </div>
                        </>
                      )
                    ) : (
                      <div className="whitespace-pre-wrap leading-6">{m.text}</div>
                    )
                  ) : loading && i === messages.length - 1 ? (
                    /* 思考期（首字前）：步骤栈逐条点亮——注入进度可见，不再是黑盒"思考中" */
                    <div className="space-y-1.5 py-0.5 text-sm">
                      {statusSteps.length === 0 ? (
                        <div className="flex items-center gap-1 text-[var(--text-muted)]">
                          <span className="inline-block h-4 w-0.5 animate-pulse bg-[var(--text)]" />
                          思考中…
                        </div>
                      ) : (
                        statusSteps.map((step, idx) => {
                          const isLatest = idx === statusSteps.length - 1;
                          return (
                            <div
                              key={`${idx}-${step}`}
                              className={
                                isLatest
                                  ? "flex items-center gap-1.5 text-[var(--text)]"
                                  : "flex items-center gap-1.5 text-[var(--text-muted)]"
                              }
                            >
                              {isLatest ? (
                                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--primary)]" />
                              ) : (
                                <span className="inline-block text-xs text-[var(--text-muted)]">✓</span>
                              )}
                              {step}
                            </div>
                          );
                        })
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
        {/* 用户上滑离开底部时，流式进行中给一个回底入口 */}
        {loading && !nearBottom && messages.length > 0 ? (
          <button
            onClick={() => {
              nearBottomRef.current = true;
              setNearBottom(true);
              scrollToBottom(true);
            }}
            className="absolute bottom-4 right-6 flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-secondary)] shadow-md transition-colors hover:border-[var(--text)] hover:text-[var(--text)]"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="4" x2="12" y2="20" />
              <polyline points="6 14 12 20 18 14" />
            </svg>
            回到最新
          </button>
        ) : null}
      </div>

      {/* Input */}
      <div className="border-t border-[var(--border)] bg-[var(--surface)] px-5 py-4">
        {error ? (
          <div className="mb-2 flex items-center gap-2 text-xs text-[var(--negative)]">
            <span>{error}</span>
            {lastSubmitRef.current && !loading ? (
              <button
                onClick={retrySubmit}
                className="rounded-md border border-[var(--border)] px-2 py-0.5 text-[var(--text-secondary)] transition-colors hover:border-[var(--text)] hover:text-[var(--text)]"
              >
                重试
              </button>
            ) : null}
          </div>
        ) : null}
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
              ref={textareaRef}
              value={question}
              onChange={(e) => {
                setQuestion(e.target.value);
                autoResizeTextarea();
              }}
              onPaste={handlePaste}
              onKeyDown={handleKeyDown}
              rows={1}
              maxLength={4000}
              placeholder="输入问题，或粘贴/上传截图让AI分析…（Enter发送，Shift+Enter换行）"
              className="min-h-12 flex-1 resize-none self-center overflow-y-auto rounded-xl border border-[var(--border-strong)] px-4 py-3 text-sm outline-none transition-colors focus:border-[var(--text)]"
            />
            <button
              onClick={loading ? stopGeneration : submit}
              disabled={!loading && !question.trim() && images.length === 0}
              className={
                loading
                  ? "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)] transition-opacity hover:opacity-80"
                  : "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-40"
              }
              title={loading ? "停止生成" : "发送"}
            >
              {loading ? (
                <span className="inline-block h-3 w-3 rounded-[2px] bg-current" aria-label="停止生成" />
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
