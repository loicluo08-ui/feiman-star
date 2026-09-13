// Agent工具层 Phase 1（9/13）：AI按需拉数据的工具定义+执行器+数据收集循环
// 设计：两段式——①工具决策轮（非流式，模型只发起tool_calls或答NO_TOOLS）
// ②工具结果文本化并入system（与现有行情/快讯注入同构）→正文流式生成
// 成本护栏：仅深度/分析类问题触发；工具决策轮max_tokens=600；单工具结果≤2600字符

import { fetchOptionContext, buildOptionBlock } from "@/lib/option-context";
import { fetchMacroContext } from "@/lib/macro-context";
import { getFlashFeed } from "@/lib/flash-source";

// ——— 腾讯行情（latin1解码足够：价格字段纯ASCII，中文乱码不影响解析）——
const NAME_TO_TENCENT: Record<string, string> = {
  英伟达: "usNVDA", 英伟得: "usNVDA", 特斯拉: "usTSLA", 苹果: "usAAPL", 微软: "usMSFT",
  谷歌: "usGOOGL", 亚马逊: "usAMZN", 台积电: "usTSM", 博通: "usAVGO", 超微: "usAMD",
  美光: "usMU", 英特尔: "usINTC", 高通: "usQCOM", 奈飞: "usNFLX", 甲骨文: "usORCL",
  标普: "usINX", 纳斯达克: "usNDX", 道琼斯: "usDJI",
};

function toTencentSymbol(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  if (NAME_TO_TENCENT[s]) return NAME_TO_TENCENT[s];
  const upper = s.toUpperCase();
  if (/^[A-Z.]{1,6}$/.test(upper)) return "us" + upper;
  const m = upper.match(/([A-Z.]{1,6})$/); // "usNVDA"/"NVDA.US"尾部提取
  return m ? "us" + m[1] : null;
}

async function toolQuote(rawSymbol: string): Promise<string> {
  const sym = toTencentSymbol(rawSymbol);
  if (!sym) return `工具结果：无法识别标的「${rawSymbol}」，请用美股代码（如NVDA）或常见中文名。`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://qt.gtimg.cn/q=${sym}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return `工具结果：行情源返回${res.status}。`;
    const buf = await res.arrayBuffer();
    const text = Buffer.from(buf).toString("latin1");
    const f = text.split("~");
    if (f.length < 50 || !parseFloat(f[3])) return `工具结果：${sym} 无有效行情数据（可能代码错误或停牌）。`;
    // 9/13实测字段：f[3]现价 f[31]涨跌 f[32]涨跌% f[39]PE(TTM) f[45]总市值(亿USD) f[48]52周高 f[49]52周低
    const price = parseFloat(f[3]);
    const chgPct = parseFloat(f[32]);
    const pe = parseFloat(f[39]);
    const high52 = parseFloat(f[48]);
    const low52 = parseFloat(f[49]);
    const mcap = parseFloat(f[45]);
    const quoteTime = f[30] || "";
    let pos52 = "n/a";
    if (high52 > low52 && high52 > 0) {
      pos52 = (((price - low52) / (high52 - low52)) * 100).toFixed(1) + "%";
    }
    const drawdown = high52 > 0 ? (((price - high52) / high52) * 100).toFixed(1) + "%" : "n/a";
    return [
      `工具结果：${sym} 实时行情（数据时间 ${quoteTime}）：`,
      `现价 $${price.toFixed(2)}，涨跌 ${isNaN(chgPct) ? "n/a" : chgPct.toFixed(2) + "%"}，${isNaN(pe) || pe <= 0 ? "PE n/a（亏损或无数据）" : "PE(TTM) " + pe.toFixed(1)}`,
      `52周高 $${high52.toFixed(2)} / 52周低 $${low52.toFixed(2)}，处52周区间 ${pos52} 位置，距高点回撤 ${drawdown}`,
      `总市值 ${isNaN(mcap) ? "n/a" : "$" + (mcap / 10000).toFixed(0) + "B"}`,
    ].join("；");
  } catch {
    return "工具结果：行情查询超时/失败。";
  }
}

async function toolOptionChain(rawSymbol: string): Promise<string> {
  const sym = toTencentSymbol(rawSymbol);
  if (!sym) return `工具结果：无法识别标的「${rawSymbol}」。`;
  const code = sym.replace(/^us/, "");
  const ctx = await fetchOptionContext(code);
  if (!ctx) return `工具结果：${code} 期权链数据不可用（CBOE无数据或非期权标的）。`;
  return "工具结果：期权链实时数据如下（CBOE官方，15分钟延迟）。\n" + buildOptionBlock(ctx);
}

async function toolNews(keyword: string): Promise<string> {
  const kw = (keyword || "").trim();
  if (!kw) return "工具结果：缺少关键词。";
  const feed = await getFlashFeed();
  const items = feed.items || [];
  const hit = items.filter((it) => {
    const t = (it.content_text || it.content || "") + (it.title || "");
    return t.indexOf(kw) >= 0 || (kw.length >= 2 && t.toUpperCase().indexOf(kw.toUpperCase()) >= 0);
  }).slice(0, 8);
  if (hit.length === 0) return `工具结果：最近快讯中无「${kw}」相关条目（快讯池${items.length}条，覆盖金十+华尔街见闻最近数小时）。`;
  const lines = hit.map((it) => {
    const t = it.title ? `[${it.title}] ` : "";
    const c = (it.content_text || it.content || "").slice(0, 120);
    return `- ${t}${c}`;
  });
  return `工具结果：与「${kw}」相关的最新快讯 ${hit.length} 条：\n` + lines.join("\n");
}

async function toolMacro(): Promise<string> {
  const block = await fetchMacroContext();
  return "工具结果：宏观锚数据。\n" + (block || "宏观数据暂不可用（10Y/美元指数源超时）。");
}

// ——— 工具Schema（OpenAI function calling格式，DeepSeek兼容）———
const TOOLS = [
  {
    type: "function",
    function: {
      name: "query_quote",
      description: "查询美股实时行情：现价/涨跌幅/PE/52周区间位置/回撤/市值。分析任何标的的价格位置与估值前必查。",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "美股代码（如NVDA）或常见中文名（如英伟达）" },
        },
        required: ["symbol"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_option_chain",
      description: "查询美股期权链：ATM附近执行价的bid/ask/IV/delta/持仓量。期权策略类问题（备兑/保护/滚动）必查。",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "美股代码（如NVDA）" },
        },
        required: ["symbol"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_news",
      description: "在最新快讯池（金十+华尔街见闻，最近数小时~1天）中按关键词搜相关新闻。",
      parameters: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "关键词，如：英伟达、降息、财报" },
        },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_macro",
      description: "查询宏观锚数据：10Y美债收益率、美元指数及近5日变化。涉及利率/流动性/大盘环境时查。",
      parameters: { type: "object", properties: {} },
    },
  },
] as const;

// ——— 数据收集循环 ———
interface ToolCallMsg {
  role: "assistant";
  content: null;
  tool_calls: { id: string; type: "function"; function: { name: string; arguments: string } }[];
}

async function callAITools(
  messages: unknown[],
  hasTools: boolean
): Promise<{ content: string | null; toolCalls: { id: string; name: string; args: string }[] | null }> {
  const apiKey = process.env.DEEPSEEK_API_KEY || "";
  if (!apiKey) return { content: null, toolCalls: null };
  const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
        messages,
        temperature: 0.3,
        max_tokens: 600,
        ...(hasTools ? { tools: TOOLS } : {}),
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { content: null, toolCalls: null };
    const json = (await res.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: ToolCallMsg["tool_calls"] } }[];
    };
    const msg = json.choices?.[0]?.message;
    const tc = msg?.tool_calls;
    return {
      content: msg?.content ?? null,
      toolCalls: tc && tc.length > 0
        ? tc.map((t) => ({ id: t.id, name: t.function.name, args: t.function.arguments }))
        : null,
    };
  } catch {
    clearTimeout(timer);
    return { content: null, toolCalls: null };
  }
}

const AGENT_DECIDE_PROMPT = `你处于数据获取阶段（不输出最终回答）。分析用户最近的问题：如需实时数据（行情/期权链/快讯/宏观）才能高质量回答，调用对应工具（可并行多个；每个标的只查一次）；如问题纯概念解释/纯框架认知/不需要实时数据，只回复NO_TOOLS三个词。`;

export interface AgentCollectResult {
  blocks: string[]; // 文本化的工具结果，并入system
  toolsUsed: string[];
}

export async function runAgentDataCollection(
  baseMessages: { role: string; content: string }[],
  emitStatus: (text: string) => void
): Promise<AgentCollectResult> {
  const out: AgentCollectResult = { blocks: [], toolsUsed: [] };
  const decideMessages = [
    ...baseMessages,
    { role: "user", content: AGENT_DECIDE_PROMPT },
  ];
  const first = await callAITools(decideMessages, true);
  if (!first.toolCalls) return out; // NO_TOOLS 或失败 → 零工具直出

  const execLimit = Math.min(first.toolCalls.length, 5);
  const toolMsgs: unknown[] = [];
  const assistantToolCalls: ToolCallMsg = {
    role: "assistant",
    content: null,
    tool_calls: first.toolCalls.slice(0, execLimit).map((t) => ({
      id: t.id,
      type: "function" as const,
      function: { name: t.name, arguments: t.args },
    })),
  };
  toolMsgs.push(assistantToolCalls);

  for (let i = 0; i < execLimit; i++) {
    const tc = first.toolCalls[i];
    let arg: Record<string, string> = {};
    try {
      arg = JSON.parse(tc.args || "{}") as Record<string, string>;
    } catch {
      arg = {};
    }
    let result = "";
    if (tc.name === "query_quote") {
      emitStatus(`正在获取 ${arg.symbol || ""} 实时行情…`);
      result = await toolQuote(arg.symbol || "");
    } else if (tc.name === "query_option_chain") {
      emitStatus(`正在获取 ${arg.symbol || ""} 期权链…`);
      result = await toolOptionChain(arg.symbol || "");
    } else if (tc.name === "search_news") {
      emitStatus(`正在搜索「${arg.keyword || ""}」相关快讯…`);
      result = await toolNews(arg.keyword || "");
    } else if (tc.name === "query_macro") {
      emitStatus("正在获取宏观锚数据…");
      result = await toolMacro();
    } else {
      result = `工具结果：未知工具 ${tc.name}`;
    }
    out.blocks.push(result.slice(0, 2600));
    out.toolsUsed.push(tc.name);
    toolMsgs.push({ role: "tool", tool_call_id: tc.id, content: result.slice(0, 2600) });
  }

  // Phase 1简化：单轮工具决策。二次补充轮留Phase 2（成本护栏）
  return out;
}
