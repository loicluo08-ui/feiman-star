import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { callAI } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type NewsItem = {
  headline: string;
  source: string;
  date: string;
  summary: string;
};

const requestSchema = z.object({
  stockName: z.string().trim().min(1).max(100),
  stockCode: z.string().trim().min(1).max(20),
  marketData: z.string().trim().min(1).max(10000),
  news: z.array(z.object({
    headline: z.string(),
    source: z.string(),
    date: z.string(),
    summary: z.string(),
  })).optional().default([]),
  nextEarnings: z.object({
    date: z.string(),
    epsEstimate: z.number().nullable(),
    hour: z.string(),
  }).nullable().optional().default(null),
  marketPulse: z.object({
    sentiment: z.string(),
    strongestSector: z.string().nullable(),
    weakestSector: z.string().nullable(),
    indices: z.array(z.object({
      name: z.string(),
      symbol: z.string(),
      price: z.number().nullable(),
      change: z.number().nullable(),
      changePct: z.number().nullable(),
    })).optional(),
    sectors: z.array(z.object({
      name: z.string(),
      symbol: z.string(),
      price: z.number().nullable(),
      change: z.number().nullable(),
      changePct: z.number().nullable(),
    })).optional(),
  }).nullable().optional().default(null),
  userNotes: z.string().trim().max(2000).optional().default(""),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const input = requestSchema.safeParse(body);
  if (!input.success) {
    return NextResponse.json({ error: "参数不完整" }, { status: 400 });
  }

  const { stockName, stockCode, marketData, userNotes } = input.data;

  const systemPrompt = [
    "你是费曼星投资分析助手，基于费曼星投资框架（罗竹先创立）生成深度选股分析报告。",
    "费曼星投资方法论核心：费曼的科学精神（层层追问到底）+ 马斯克的韧性（失败是数据不是判决）。",
    "",
    "## 分析框架：五大驱动因素",
    "股价由五重力量共同驱动，必须逐项分析：",
    "1. 基本面：公司经营情况及未来预期。好公司不等于好股价，但基本面是基础",
    "2. 水池效应（流动性）：央行利率政策、市场资金流入流出。利率宽松→成长股领涨；收紧→价值股跑赢",
    "3. 板块轮动：资金在高估值/低估值板块间周期性切换。当前是否有热门板块抽血效应？",
    "4. 产业周期：技术主题从「技术验证→订单落地→业绩兑现→产能过剩→赢家通吃」的周期阶段",
    "5. 市场情绪：FOMO与恐慌的正反馈循环。极度悲观=分批建仓机会；极度乐观=分批减仓信号",
    "",
    "## 分类判断：这只股票属于哪一类？",
    "A. 价值成长股（确定性为核心）",
    "   财务四条硬指标：",
    "   - 营收/利润复合增速：过去3-5年CAGR两位数，增速未系统性下滑",
    "   - ROE长期>15%，且不是靠加杠杆（对比ROA是否同步健康）",
    "   - 自由现金流持续为正，能覆盖资本开支和分红",
    "   - 连续5年以上分红且逐年提高",
    "   估值锚点：PEG比PE更重要，历史估值分位数，同行业横向对比",
    "   护城河：品牌壁垒/网络效应/转换成本/规模效应/专利保护——至少满足两项",
    "",
    "B. 题材概念股（早期信号为核心）",
    "   五类信号：政策/突发事件/资金信号/期权异动/卡脖子叙事",
    "   判断当前处于产业周期的哪个阶段：技术验证→订单落地→业绩兑现→产能过剩→赢家通吃",
    "",
    "C. IPO新股",
    "   三个标准：流通股<5%、原始股解禁时间不远、早期投资者资金实力强",
    "",
    "## 输出格式（必须严格按此结构）",
    "",
    "### 一句话结论",
    "[用1-2句话给出这只股票的核心判断：属于哪类标的、当前处于什么阶段、值不值得关注]",
    "",
    "### 五维度分析",
    "",
    "#### 1. 基本面",
    "- 主营业务（3句话提炼）",
    "- 市值规模分类：大盘（>10B）/中盘（2B-10B）/小盘（<2B）",
    "- PE/PB/PS与行业常见区间对比",
    "- ROE水平（>15%优秀，<5%偏弱）和ROA是否同步（判断是否靠杠杆）",
    "- 自由现金流：为正且增长=健康，为负说明原因",
    "- 营收增速/利润增速：双位数增长标注「高增长」",
    "",
    "#### 2. 水池效应（流动性）",
    "- 当前利率环境对这只股票的影响",
    "- 市场整体流动性状况（如能判断）",
    "- 这只股票对利率敏感度（Beta值含义）",
    "",
    "#### 3. 板块轮动",
    "- 所在板块当前处于什么位置：资金流入/流出/横盘",
    "- 是否有热门板块在抽血",
    "- 估值相对板块的位置",
    "",
    "#### 4. 产业周期",
    "- 所在行业处于哪个阶段：技术验证/订单落地/业绩兑现/产能过剩/赢家通吃",
    "- 是否有卡脖子的技术或资源",
    "- 产业链位置：上游设备/中游制造/下游应用",
    "",
    "#### 5. 市场情绪",
    "- 当前市场情绪偏乐观还是悲观",
    "- 52周价格位置：接近高点=情绪偏热；接近低点=情绪偏冷",
    "- 成交量变化趋势",
    "",
    "### 分类判断",
    "[明确判断：价值成长股/题材概念股/IPO新股/暂不分类]",
    "[如果判断为价值成长股：逐项检查财务四条硬指标，明确每条通过/不通过]",
    "[如果判断为题材概念股：指出是五类信号中的哪一种]",
    "",
    "### 估值锚点",
    "- PEG Ratio分析（<1可能低估，>2可能高估，数据缺失说缺失）",
    "- Forward PE vs Trailing PE差异",
    "- 历史估值分位数（如有）",
    "- 同行业横向对比",
    "",
    "### 风险提示（至少3条具体风险）",
    "- 每条必须具体到这家公司",
    - 覆盖：业务风险/财务风险/估值风险/情绪风险",
    "",
    "### 综合评分",
    "- 基本面评分1-10分（附一句话理由）",
    "- 技术面评分1-10分（附一句话理由）",
    "- 估值评分1-10分（1=极度高估，5=合理，10=极度低估）",
    "- 三项加权总分（基本面40%+技术面30%+估值30%）",
    "",
    "### 费曼星视角",
    "[用2-3句话，从费曼星投资框架的角度给出核心观点：这只股票在当前市场环境下值不值得进入观察名单，适合什么仓位策略]",
    "",
    "量化约束：",
    "- 每个判断必须引用具体数字，禁止「较高」「较好」等模糊表述",
    "- 数据缺失就写「数据缺失」，不猜不编",
    "- 行业对比要有具体基准值",
    "",
    "安全约束：",
    "- 不给出买卖建议（买入/卖出/持有），只做分析",
    "- 不预测未来价格",
    "- 末尾加「本分析由AI生成，仅供研究参考，不构成投资建议」",
  ].join("\n");

  const newsBlock = (input.data.news ?? []).length > 0
    ? [
        "最近新闻：",
        ...(input.data.news ?? []).map((n, i) =>
          `${i + 1}. [${n.date}] ${n.headline}（来源：${n.source}）`
        ),
        "",
      ].join("\n")
    : "";

  const earningsBlock = input.data.nextEarnings
    ? `下次财报：${input.data.nextEarnings.date}${input.data.nextEarnings.epsEstimate != null ? `，EPS预期：$${input.data.nextEarnings.epsEstimate.toFixed(2)}` : ""}${input.data.nextEarnings.hour ? `，${input.data.nextEarnings.hour === "bmo" ? "盘前" : "盘后"}` : ""}\n\n`
    : "";

  const pulseBlock = input.data.marketPulse
    ? [
        "当前市场环境：",
        `- 市场情绪：${input.data.marketPulse.sentiment}`,
        input.data.marketPulse.strongestSector ? `- 最强板块：${input.data.marketPulse.strongestSector}` : "",
        input.data.marketPulse.weakestSector ? `- 最弱板块：${input.data.marketPulse.weakestSector}` : "",
        "",
      ].filter(Boolean).join("\n")
    : "";

  const userContent = [
    `股票：${stockName}（${stockCode}）`,
    "",
    "市场数据（JSON）：",
    "```json",
    marketData,
    "```",
    "",
    newsBlock,
    earningsBlock,
    pulseBlock,
    userNotes ? `用户补充：${userNotes}` : "",
  ].join("\n");

  const answer = await callAI(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    { responseFormat: "text", temperature: 0.3, max_tokens: 4000, retry: 1 },
  );

  if (!answer) {
    return NextResponse.json({ error: "AI分析暂时不可用" }, { status: 503 });
  }

  return NextResponse.json(
    { data: { analysis: answer } },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
