/**
 * A队智力资产注入（9/13阶段2第二批）
 * ①buildQuoteGuardBlock：引用闸门（时间线misuse警示6条压缩+P1-P9假语录一句话版+典型辟谣）——全档位
 * ②buildDivergenceBlock：互评分歧检索（问题触及6大分歧主题时注入对应A/B对照）——会诊/风格对话对抗燃料
 * 来源：A队任务14时间线+任务15互评矩阵+任务16假语录模式库（HTML层，data/master_intel_v2.json）
 */
import intel from "../data/master_intel_v2.json";

interface Intel {
  divergences: { theme: string; a: { side: string; who: string; view: string }; b: { side: string; who: string; view: string }; axis: string }[];
}

// 引用闸门块——全档位，~500字
const QUOTE_GUARD_LINES = [
  "",
  "【大师引用防错闸】（A队时间线+假语录体系——违反=虚假引用链）",
  "1. 时空错位闸：大师观点随时间演变——引用必须带年份/场合，禁止用旧周期观点答新周期问题。高危例：巴菲特'不碰科技'（1999）≠2024苹果第一大持仓；马克斯'从不预测'（1993学派）≠2022《Sea Change》最大宏观判断；费雪'永不卖出'（1958）前提=15要点持续满分，80岁晚年持大量国库券+对冲；段永平对谷歌三段变（搞不懂→有点懂→担心被AI取代）；芒格2021挺中国监管≠2023阿里认错后立场。",
  "2. 假语录防线（P1-P9九模式）：中文互联网大师语录九成带毒——完全杜撰（巴菲特'睡觉时挣钱'系全网级杜撰）/主人错配（'没有人愿意慢慢变富'是巴菲特的，误植给段永平，段真语录='投资做得好的人都很慢'）/出处错标（索罗斯'假象和谎言连续剧'不出自《炼金术》出自1994演讲）/主语漂移/数字漂移（杠铃90/10被改成80/20；欧奈尔8%被改成5%/10%）。**拿不准出处的语录：不引用，或用'大意是'转述并声明'流传版本出处存疑'。禁止编造页码/书名/年份。**",
  "3. 防神化锚：大师公开言论与实际操作存在时差与背离——引'不投科技'须查其后续真实持仓（巴菲特2016当场重定义苹果为消费公司后才建仓）；引用观点时优先对照其公开认错记录。",
  "",
].join("\n");

export function buildQuoteGuardBlock(): string {
  return QUOTE_GUARD_LINES;
}

// 6大分歧主题的触发词
const DIVERGENCE_TRIGGERS: { theme: string; kws: RegExp }[] = [
  { theme: "止损是否必要", kws: /止损|割肉|卖出点|stop loss/ },
  { theme: "预测的可能性", kws: /预测|预判|宏观判断| foresee|大方向/ },
  { theme: "集中vs分散", kws: /集中|分散|仓位配置|杠铃|组合构建/ },
  { theme: "技术分析有效性", kws: /技术分析|图表|均线|K线|形态/ },
  { theme: "换手率哲学", kws: /换手|轮动|长期持有|拿多久|卖飞/ },
  { theme: "决策频率", kws: /决策频率|勤奋调研|操作次数|交易频率/ },
];

/** 分歧对照检索——问题触及分歧主题时注入A/B对照（供对抗性输出/会诊） */
export function buildDivergenceBlock(queryText: string): string {
  const intelData = intel as Intel;
  const q = queryText || "";
  const hits = DIVERGENCE_TRIGGERS.filter(t => t.kws.test(q)).map(t => t.theme);
  if (!hits.length) return "";
  const rows = intelData.divergences.filter(d => hits.includes(d.theme));
  if (!rows.length) return "";
  const lines = [
    "",
    "【大师真实分歧对照】（A队互评矩阵——这些是大师间的真实方法论冲突，用于对抗性分析，不是和稀泥素材）",
    ...rows.map(d => `分歧｜${d.theme}：${d.a.who}（${d.a.side}）主张「${d.a.view}」 ⇄ ${d.b.who}（${d.b.side}）主张「${d.b.view}」。分歧轴=${d.axis}。使用纪律：正反都必须呈现其最强形态，裁决时说明本问题场景下哪方的适用条件更成立、以及各自失效的前提。`),
    "",
  ];
  return lines.join("\n");
}
