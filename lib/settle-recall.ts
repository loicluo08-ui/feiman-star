import { readKbEntries } from "@/lib/supabase";

/**
 * 结算结果回灌（10/1外部评审v1.2采纳——效用复利在账本侧）
 * cron-judgment-settle每日把机械结算结果写kb_dynamic（kind=judgment_settle），
 * 但chat/pick请求时无人召回——AI说"NVDA看多"时不知道自己上月同向判断已被证伪。
 * 本模块=按symbol读结算记录→构造注入块，chat（对话对账）与pick（选股入账）共用。
 *
 * 失败静默：Supabase挂→返回空map，不影响主链路（结算召回是增强不是依赖）。
 */

export interface SettleRecord {
  symbol: string;
  judged_date: string;
  stance: string;
  level: number;
  settle_price: number | null;
  result: string; // confirmed / invalidated / signal_done / expired
  invalidation: string;
  settled_at: string;
  // 10/1错账归因（settle cron的AI归因，宪法2复盘层）——invalidated行可能有
  attribution?: string | null;
  attribution_kind?: string | null;
}

export async function readSettleRecords(): Promise<Map<string, SettleRecord[]>> {
  const map = new Map<string, SettleRecord[]>();
  try {
    const rows = await readKbEntries(200);
    for (const row of rows ?? []) {
      if (!row.content.includes('"kind":"judgment_settle"')) continue;
      try {
        const o = JSON.parse(row.content) as SettleRecord & { kind: string };
        if (o.kind === "judgment_settle" && o.symbol && o.result) {
          const arr = map.get(o.symbol.toUpperCase()) ?? [];
          arr.push(o);
          map.set(o.symbol.toUpperCase(), arr);
        }
      } catch {
        // 单行解析失败跳过
      }
    }
  } catch {
    // Supabase不可达→空map，主链路无感
  }
  return map;
}

const RESULT_LABEL: Record<string, string> = {
  confirmed: "存活（失效未触发）",
  invalidated: "已证伪",
  signal_done: "信号完成（非证伪）",
  expired: "时间盒到期未触发（数据点）",
};

/** 标的code归一：localStorage旧数据可能有"NVDA(英伟达)"后缀——取括号前部分大写化 */
export function normalizeSymbol(raw: string): string {
  return (raw.split(/[（(]/)[0] ?? raw).trim().toUpperCase();
}

export function buildSettleRecallBlock(records: SettleRecord[], symbol: string): string | null {
  if (records.length === 0) return null;
  const recent = records.slice(-2).reverse();
  const lines = recent.map((r) =>
    `- ${r.judged_date} 立场=${r.stance} 失效位=${r.level} → 结算=${RESULT_LABEL[r.result] ?? r.result}`
    + (r.settle_price != null ? `（结算时价${r.settle_price}）` : "")
    + (r.result === "invalidated" && r.invalidation ? ` 失效条件：${r.invalidation}` : "")
    + (r.attribution ? `\n  归因：${r.attribution}` : ""),
  );
  const hasInvalid = recent.some((r) => r.result === "invalidated");
  const discipline = hasInvalid
    ? "\n使用纪律：该标的存在被证伪的历史判断——先读归因：若归因=关键位设计问题，本轮的失效位必须与上次错位设计不同并说明依据；若归因=逻辑错误，禁止复用同一逻辑链；若归因=数据前提变化/外部冲击，说明当前数据与当时的差异。说不出与上次的实质差异就降信心度并在判断中标注风险。"
    : "\n使用纪律：结算记录作为背景，本轮维持同向判断需引用当前数据佐证，不因历史正确而放松核验。";
  return `【历史判断结算记录】（cron每日机械结算，result为客观结果非观点）\n标的：${symbol}\n${lines.join("\n")}${discipline}`;
}
