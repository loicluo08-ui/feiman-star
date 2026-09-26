/**
 * C档并行会诊（9/13阶段3启动，E队方案三：N视角并行→单次融合仲裁）
 * 架构：3个独立调用各持一个视角（互不可见=视角真实独立，否决B档persona合议的162×2410实证）
 * → 融合调用以3份结论为输入做ACH淘汰式合成（decision-mechanism参照）
 * → 分歧超阈值追加GLM异构裁判（跨模型自我偏好免疫）
 * 触发：POST body.parallel=1 且 blend/深度档——实验态，不动默认路径（E队OpenQ：分歧阈值需实验定标）
 * 视角选取执行规则26对抗纪律：强制≥1质疑者
 */
import { callAIStream } from "./ai";
import { callAI } from "./ai";

export interface DeliberationResult {
  perspectives: { name: string; stance: string; key_args: string }[];
  synthesis: string;
  dissent_level: "低" | "中" | "高";
  arbitrator_used: boolean;
}

const PERSPECTIVE_PROMPTS = [
  {
    name: "基本面主引擎（巴菲特1977四标准+段永平商业本质）",
    prompt: "你是基本面视角。用巴菲特1977四标准（业务可理解/持久竞争优势/管理层可信/价格合理）+段永平商业本质检验（十年后这家公司卖什么）分析。输出格式：立场（看多/看空/观望）+三条最硬论据+一个本视角的失效条件。300字内，直接给结论不铺垫。",
  },
  {
    name: "质疑者（芒格逆向+塔勒布尾部存活）",
    prompt: "你是质疑者视角，职责是攻击多头前提。用芒格逆向思维（怎样会亏光：inversion）+塔勒布尾部检验（-40%黑天鹅下这个判断/仓位是否存活？凸性在哪边？）+费雪15要点质检（找出最可能不达标的要点）。输出格式：立场+三条攻击论据（针对多头最常见的三个前提）+一个验证方法。300字内。",
  },
  {
    name: "周期与情绪定位（马克斯钟摆+达里奥周期+利弗莫尔趋势）",
    prompt: "你是周期/情绪/趋势视角。用马克斯钟摆定位（市场在贪婪恐惧的哪一段）+达里奥周期位置（债务/产业周期何处）+利弗莫尔趋势确认（关键位与最小阻力线）。输出格式：立场+三条论据+本视角失效条件。300字内。",
  },
];

const SYNTHESIS_PROMPT = (persp: string[], question: string) => `你是费曼星投资委员会的首席裁决人。三位分析师独立完成分析（互不知道彼此结论），现在给出你的融合裁决。

用户问题：${question}

三位分析师结论：
${persp.map((p, i) => `【视角${i + 1}】${p}`).join("\n\n")}

裁决规则（按可信度加权，陈述权重理由）：
1. 逐视角检查：其结论被哪条证据支持/削弱（ACH淘汰式——用证据筛，不用投票数）。
2. 分歧处理：观点对立时说明分歧轴是什么、本场景下哪方适用条件更成立；可信度相当时给双场景，不强行平均。
3. 输出结构：①【裁决】一句话结论（含方向+信心度N%）②各视角一句话立场标注（采纳/降权/否决+一句理由）③融合后的核心论据（≤3条）④失效条件（三性：可观察/可量化/可定时）⑤若三位分析师分歧重大（方向相反且各有硬证据），显式标注"分歧度高：给出双场景结论"。
600字内，直接输出裁决不铺垫。`;

const ARBITRATOR_PROMPT = (persp: string[], question: string) => `你是跨模型仲裁裁判（与前述分析师来自不同AI厂商）。三位分析师对"${question}"的结论如下：
${persp.map((p, i) => `【${i + 1}】${p.slice(0, 300)}`).join("\n")}

任务：指出三方结论中：(1)事实层面的矛盾（谁与谁的数字/事实冲突）(2)逻辑层面最脆弱的一方论证。200字内，只列问题不重做分析。`;

async function runOnePerspective(
  messages: { role: string; content: string }[],
  persp: { name: string; prompt: string },
  apiKeyPresent: boolean,
  signal?: AbortSignal,
): Promise<{ name: string; stance: string; key_args: string; ok: boolean }> {
  if (!apiKeyPresent) return { name: persp.name, stance: "", key_args: "", ok: false };
  let full = "";
  try {
    const msgs = [
      { role: "system" as const, content: "你是费曼星投资委员会的独立分析师。基于给定的注入数据与你的视角方法论直接分析，不要复述问题。" },
      ...messages,
      { role: "user" as const, content: persp.prompt },
    ];
    // C档视角调用：短输出+thinking关闭（速度优先，深度靠分工）——每视角30s级
    for await (const chunk of callAIStream(msgs as never, { temperature: 0.35, max_tokens: 1500, timeout: 60_000, signal })) {
      if (chunk.kind === "text") {
        full += chunk.text;
      }
    }
  } catch {
    return { name: persp.name, stance: "", key_args: "", ok: false };
  }
  return { name: persp.name, stance: full.slice(0, 900), key_args: full, ok: full.trim().length > 30 };
}

/** C档主入口——返回各视角结论+融合文本；失败降级返回null（调用方回退默认路径） */
export async function runParallelDeliberation(
  streamMessages: unknown[],
  question: string,
  onStatus: (text: string) => void,
  signal?: AbortSignal,
): Promise<DeliberationResult | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY || "";
  if (!apiKey) return null;

  // 视角并行（真实独立：各调用只见自己的视角prompt+注入上下文）
  onStatus("C档并行会诊：3视角独立分析中（基本面/质疑者/周期）…");
  const compact = (streamMessages as { role: string; content: string }[]).filter(
    m => m.role !== "system" || String(m.content).length < 200,
  );
  const results = await Promise.all(PERSPECTIVE_PROMPTS.map(p => runOnePerspective(compact, p, !!apiKey, signal)));
  const ok = results.filter(r => r.ok);
  // 9/26 P2修复：≥1视角即融合（单视角时ACH退化为单审直通，总有产出）；0成功才回退——避免用户白等60s后再等90s
  if (ok.length === 0) return null;
  onStatus(`✓ 3视角完成（${ok.length}/3成功），融合仲裁中…`);

  // 融合调用（DeepSeek，effort低——融合是结构化任务非深度推理）
  let synthesis = "";
  try {
    for await (const chunk of callAIStream(
      [
        { role: "system" as const, content: SYNTHESIS_PROMPT(ok.map(r => r.stance), question) },
        { role: "user" as const, content: "输出裁决。" },
      ] as never,
      { temperature: 0.3, max_tokens: 3000, timeout: 90_000, signal },
    )) {
      synthesis += (chunk as { text?: string }).text ?? "";
    }
  } catch {
    return null;
  }
  if (synthesis.trim().length < 100) return null;

  // 分歧检测（E队OpenQ：阈值需实验定标——首版用方向词对立启发式）
  const bull = /看多|买入|增持|做多/.test(ok.map(r => r.stance).join(""));
  // 9/26修复：词表与视角实际输出格式脱节（实测stance写"不建仓/观望/中性偏空"——旧表全脱靶→高分歧几乎无法触发=GLM裁判事实死代码）
  const bear = /看空|卖出|减持|回避|做空|不建仓|观望|偏空|谨慎/.test(ok.map(r => r.stance).join(""));
  const dissent_level: DeliberationResult["dissent_level"] = bull && bear ? "高" : synthesis.includes("分歧") ? "中" : "低";

  // 异构裁判：分歧度高时GLM复核（跨模型）
  let arbitrator_used = false;
  if (dissent_level === "高") {
    try {
      const arbit = await callAI(
        [
          { role: "system" as const, content: ARBITRATOR_PROMPT(ok.map(r => r.stance), question) },
        ] as never,
        { model: "glm-4-flash", timeout: 30_000 },
      );
      if (arbit) {
        arbitrator_used = true;
        synthesis += `\n\n【异构仲裁注记（GLM）】${arbit.slice(0, 400)}`;
      } else {
        // 9/26：裁判缺席可观测（大概率=ZHIPU_API_KEY未配置，callAI空key静默return null）
        console.error("[parallel-deliberation] arbitrator_absent: ZHIPU_API_KEY missing or callAI returned null");
        onStatus("⚠️ 异构裁判缺席（GLM不可用），仅融合裁决输出");
      }
    } catch (e) {
      console.error("[parallel-deliberation] arbitrator_error", e);
      onStatus("⚠️ 异构裁判调用失败，仅融合裁决输出");
    }
  }

  onStatus(`✓ 融合裁决完成（分歧度=${dissent_level}${arbitrator_used ? "，异构裁判已介入" : ""}）`);
  return {
    perspectives: ok.map(r => ({ name: r.name, stance: r.stance.slice(0, 300), key_args: "" })),
    synthesis,
    dissent_level,
    arbitrator_used,
  };
}
