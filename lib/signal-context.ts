/**
 * 深度信号交叉引擎（9/12深度优化——材料层质变）
 *
 * 问题背景（罗竹9/12判"输出不怎么样"三宗因之二）：深度档回答"框架厚材料薄"——
 * 注入的是原始数据（价格/MA/量能），AI要自己现场计算衍生结论，生成倾向是略过计算
 * 直接给通用推理 → 具体性失分、无非共识结论。
 *
 * 本层解法：注入前把原始数据预计算为**交叉信号**（位置分位/量价背离/动量斜率/
 * 象限定位），AI直接引用计算好的信号而非现场心算。每个信号带完整算式[推导]标注
 * （对接R4来源标签体系），数据缺口显式声明（对接D5"缺输入明说"纪律）。
 *
 * 象限定位是本层核心增量：位置分位×量能状态×动量方向的组合判定
 * （如"高位+缩量+动量衰减=顶背离风险象限"）——单源数据看不到，交叉后才存在。
 *
 * 挂载：route.ts注入块组装处，仅深度档（wantsLong）追加。
 */

export type SignalInputStock = {
  code: string;
  name?: string;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  history: {
    oneMonthAgo: number | null;
    threeMonthsAgo: number | null;
    monthHigh: number | null;
    monthLow: number | null;
    fiftyTwoWeekHigh: number | null;
    fiftyTwoWeekLow: number | null;
    ytdStart: number | null;
    avgVolume20: number | null;
    ma20: number | null;
    ma50: number | null;
    ma200: number | null;
  } | null;
};

export type Signal = {
  key: string;
  text: string;
};

const fmt = (v: number): string => (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2));

/** 位置分位：现价在52周区间的百分位（0-100） */
export function positionPercentile(price: number, w52h: number, w52l: number): number | null {
  if (!(w52h > w52l)) return null;
  return Math.round(((price - w52l) / (w52h - w52l)) * 100);
}

/** 位置分位解读（拥挤度含义） */
function positionLabel(pct: number): string {
  if (pct >= 80) return "高位区（80分位以上，拥挤度敏感，利好出尽/获利盘抛压风险区）";
  if (pct <= 20) return "低位区（20分位以下，折价区，需区分错杀与基本面恶化）";
  return `中位区（${pct}分位）`;
}

/** 量能倍数：当日量/20日均量 */
export function volumeRatio(volume: number | null, avg20: number | null): number | null {
  if (volume == null || avg20 == null || avg20 <= 0) return null;
  return Math.round((volume / avg20) * 100) / 100;
}

/**
 * 象限定位：位置分位 × 量能 × 动量方向 的组合判定（核心交叉信号）
 * 返回null=输入不足以定位（不强判）
 */
export function quadrant(pct: number | null, volRatio: number | null, momentumUp: boolean | null): string | null {
  if (pct == null || momentumUp == null) return null;
  const vol = volRatio == null ? "mid" : volRatio >= 1.3 ? "high" : volRatio <= 0.75 ? "low" : "mid";
  if (pct >= 80 && momentumUp && vol === "high") return "高位放量加速——趋势健康但拥挤度最高，事件窗口的波动放大器，追高需分批";
  if (pct >= 80 && momentumUp && vol === "low") return "高位缩量上行——买盘衰竭嫌疑（顶背离前兆），上行惯性存疑，观察是否放量滞涨";
  if (pct >= 80 && !momentumUp) return "高位动量衰减——获利盘了结窗口，回撤目标看MA20/MA50，反弹不放量则弱势确认";
  if (pct <= 20 && momentumUp && vol === "high") return "低位放量反转——吸筹迹象象限，确认信号需站稳MA50+回踩不破前低";
  if (pct <= 20 && !momentumUp && vol === "low") return "低位缩量阴跌——磨底象限，左侧介入需事件催化或极值信号，接飞刀风险自估";
  if (pct <= 20 && !momentumUp && vol === "high") return "低位放量下跌——恐慌抛售尾段或基本面恶化，先验利空来源再谈错杀";
  return null; // 中位区组合不产生强信号——宁可不给，不硬编故事
}

/** 主计算：单只标的的信号池 */
export function computeSignals(s: SignalInputStock): Signal[] {
  const signals: Signal[] = [];
  if (s.price == null || !s.history) {
    return [{ key: "data_gap", text: `${s.code} 数据缺口：无有效价格或历史锚点，位置/趋势/量能信号全部缺输入——按D5明说，不编造` }];
  }
  const h = s.history;

  // 信号1：52周位置分位
  if (h.fiftyTwoWeekHigh != null && h.fiftyTwoWeekLow != null) {
    const pct = positionPercentile(s.price, h.fiftyTwoWeekHigh, h.fiftyTwoWeekLow);
    if (pct != null) {
      const drawdown = ((h.fiftyTwoWeekHigh - s.price) / h.fiftyTwoWeekHigh) * 100;
      signals.push({
        key: "position",
        text: `52周位置分位=${pct}%——${positionLabel(pct)}；距52周高点回撤=${fmt(drawdown)}% [推导：(现价${fmt(s.price)}-52周低${fmt(h.fiftyTwoWeekLow)})/(52周高${fmt(h.fiftyTwoWeekHigh)}-52周低${fmt(h.fiftyTwoWeekLow)})]`,
      });
    }
  }

  // 信号2：均线趋势结构（多头/空头排列+乖离）
  if (h.ma50 != null && h.ma200 != null) {
    const above50 = s.price > h.ma50;
    const above200 = s.price > h.ma200;
    const bias50 = ((s.price - h.ma50) / h.ma50) * 100;
    const structure = above50 && above200
      ? "多头排列（价>MA50>MA200）"
      : !above50 && !above200
        ? "空头排列（价<MA50<MA200）"
        : above200
          ? "纠缠结构（价<MA50但>MA200——中期回调/长期多头）"
          : "修复结构（价>MA50但<MA200——反弹/长期空头）";
    const biasNote = Math.abs(bias50) > 15 ? `；MA50乖离=${fmt(bias50)}%超±15%阈值——均值回归压力显著` : "";
    signals.push({
      key: "trend",
      text: `趋势结构=${structure}，MA50=${fmt(h.ma50)}/MA200=${fmt(h.ma200)}${biasNote} [推导]`,
    });
  }

  // 信号3：量能状态+量价配合
  const vr = volumeRatio(s.volume, h.avgVolume20);
  if (vr != null && s.changePct != null) {
    const volLabel = vr >= 1.3 ? "放量" : vr <= 0.75 ? "缩量" : "常量";
    const pair = s.changePct > 0
      ? vr >= 1.3 ? "涨+放量=买盘健康" : vr <= 0.75 ? "涨+缩量=买盘衰竭嫌疑（背离警示）" : "涨+常量"
      : s.changePct < 0
        ? vr >= 1.3 ? "跌+放量=抛压真实" : vr <= 0.75 ? "跌+缩量=抛压衰减迹象" : "跌+常量"
        : "平盘+常量";
    signals.push({
      key: "volume",
      text: `量能=${volLabel}（当日/20日均量=${vr}倍），量价配合：${pair} [推导]`,
    });
  }

  // 信号4：动量斜率对比（近1月 vs 此前2月——加速/衰减）
  if (h.oneMonthAgo != null && h.threeMonthsAgo != null && h.oneMonthAgo > 0 && h.threeMonthsAgo > 0) {
    const m1 = ((s.price - h.oneMonthAgo) / h.oneMonthAgo) * 100;
    const m23 = ((h.oneMonthAgo - h.threeMonthsAgo) / h.threeMonthsAgo) * 100;
    const accel = m1 > m23 ? "加速" : m1 < m23 * 0.5 ? "显著衰减" : "衰减";
    signals.push({
      key: "momentum",
      text: `动量斜率：近1月=${fmt(m1)}% vs 此前2月=${fmt(m23)}%——动量${accel} [推导]`,
    });
  }

  // 信号5：象限定位（核心交叉信号）
  const pct = h.fiftyTwoWeekHigh != null && h.fiftyTwoWeekLow != null
    ? positionPercentile(s.price, h.fiftyTwoWeekHigh, h.fiftyTwoWeekLow)
    : null;
  const momentumUp = h.oneMonthAgo != null && h.oneMonthAgo > 0 ? s.price > h.oneMonthAgo : null;
  const q = quadrant(pct, vr, momentumUp);
  if (q) signals.push({ key: "quadrant", text: `象限定位：${q} [推导·交叉信号]` });

  return signals;
}

/** 构建注入文本块（深度档用） */
export function buildSignalContext(stocks: SignalInputStock[]): string {
  if (stocks.length === 0) return "";
  const blocks = stocks.map((s) => {
    const sigs = computeSignals(s);
    const lines = sigs.map((sig) => `- ${sig.text}`);
    return `【${s.code}${s.name ? ` ${s.name}` : ""} 交叉信号池——预计算结论，引用时保留[推导]标注，与本信号矛盾的判断必须先解释矛盾】\n${lines.join("\n")}`;
  });
  return blocks.join("\n\n");
}
