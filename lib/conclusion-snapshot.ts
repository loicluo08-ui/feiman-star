/**
 * 多轮护栏（9/13阶段1.4，E队第6章落地）
 * ①结论快照重注入：Laban 2024实测多轮-39%（无提示历史下模型遗忘前轮约束）——每轮结论抽快照，下轮注入"此前判断"
 * ②翻供拦截：用户质疑词触发46%无条件翻供（Duan 2024/FlipFlop 46%/-17%）——注入复核指令：有据坚持/有误明认
 */

// ---- 结论快照 ----

export interface ConclusionSnapshot {
  turn: number;
  stance: string;      // 核心判断首句（"核心判断："行或首句）
  rating?: string;     // 增持|中性|减持|观察|看多|看空
  falsifiers: string[]; // 证伪条件句
  numbers: string[];   // 关键数字（带锚）
  text: string;        // 快照原文（注入用）
}

const RATING_PAT = /(增持|减持|中性|观察|看多|看空|买入|卖出|持有回避)/;
const FALSIFY_HEAD = /(证伪条件|失效条件|错误条件|此判断.{0,8}(作废|失效|不成立))/;

/** 从回答全文抽结论快照（正则轻量版——不调模型，零成本） */
export function extractSnapshot(answer: string, turn: number): ConclusionSnapshot | null {
  if (!answer || answer.length < 60) return null;
  // 评级
  const ratingM = answer.match(RATING_PAT);
  // 核心判断：优先"核心判断："行，退首句
  let stance = "";
  const stanceM = answer.match(/核心判断[：:]\s*(.{10,80})/);
  if (stanceM) stance = stanceM[1].trim();
  else {
    const first = answer.split(/[。！？\n]/)[0];
    if (first && first.length >= 10) stance = first.trim().slice(0, 80);
  }
  if (!stance && !ratingM) return null;
  // 证伪条件：证伪/失效关键词所在句
  const falsifiers: string[] = [];
  for (const s of answer.split(/(?<=[。！？])/)) {
    if (FALSIFY_HEAD.test(s) || /(若|如果).{0,40}(跌破|失守|低于|超过|突破|高于|恶化|未达)/.test(s)) {
      falsifiers.push(s.trim().slice(0, 80));
      if (falsifiers.length >= 3) break;
    }
  }
  const text = buildSnapshotText(turn, ratingM?.[1], stance, falsifiers);
  return { turn, stance, rating: ratingM?.[1], falsifiers, numbers: [], text };
}

function buildSnapshotText(turn: number, rating: string | undefined, stance: string, falsifiers: string[]): string {
  const lines = [`【第${turn}轮结论快照】`];
  if (rating) lines.push(`- 评级口径：${rating}`);
  if (stance) lines.push(`- 核心判断：${stance}`);
  if (falsifiers.length) lines.push(`- 失效条件：${falsifiers.join("；")}`);
  lines.push(`（后续轮次回答应与此一致；确需修正时显式声明"修正此前判断"及理由，禁止无理由翻转。）`);
  return lines.join("\n");
}

/** 快照栈→注入块（最多带最近3轮，防prompt膨胀） */
export function snapshotsToBlock(snaps: ConclusionSnapshot[]): string {
  if (!snaps.length) return "";
  const recent = snaps.slice(-3);
  return `\n\n## 此前已给出的判断（结论快照，多轮一致性锚）\n${recent.map(s => s.text).join("\n")}\n`;
}

// ---- 翻供拦截 ----

const CHALLENGE_PATTERNS = [
  /你?确定(吗|呢)?/, /不对吧/, /真的假的/, /再想想/, /不是(吧|吗)/, /搞错(了|吧)/,
  /你是认真的/, /are you sure/i, /质疑/, /确定/, /怀疑/,
];

/** 用户消息是否为质疑/翻供试探 */
export function isChallenge(message: string): boolean {
  if (!message || message.length > 60) return false; // 长消息多为新论据非单纯质疑
  return CHALLENGE_PATTERNS.some(p => p.test(message));
}

export const CHALLENGE_GUARD_BLOCK = `

## 本轮特别指令（用户对上一轮结论提出质疑）
- 立即复核此前判断的依据链：逐条检查数据、逻辑、前提。
- 若依据充分：**坚持原结论**，并明确给出支撑它的最硬两条依据——不因被质疑而放弃有据结论。
- 若复核发现确有错误或前提变化：明确承认"此前判断有误"，说明错在哪、修正后结论是什么。
- 禁止两种失败：①无理由顺从质疑翻转结论 ②死守结论拒绝看新论据。`;
