import { NextRequest, NextResponse } from "next/server";

/**
 * 判断账本自动结算（9/18能力工程P0——"每周结算"从人肉变心跳）
 *
 * 逻辑：读judgment_ledger未结算行 → 腾讯源取现价 → 失效条件机械核验
 *   （invalidation文本提方向词+数字：跌破类向下触发/突破类向上触发）
 *   → 结算结果写kb_dynamic（type=insight, content.kind=judgment_settle）
 *
 * 结算语义（判断能力工程的科学性所在）：
 *   invalidated = 失效条件触发，判断被证伪（公开记录，不藏错——错的可见性=可信度）
 *   confirmed   = 立场方向上的关键位未破（判断存活中，未到失效条件）
 *
 * 零DDL：结算结果复用kb_dynamic现有表（9/13四表），ledger原生结算字段迁移SQL
 * 见 sql/003_ledger_settle_columns.sql（可选升级，未执行时本路由照常工作）
 *
 * 鉴权：Authorization: Bearer ${CRON_SECRET} 或 ?token=${CRON_SECRET}（同cron-kb-grow）
 */
export const maxDuration = 60;

import { readAllLedger, readKbEntries, upsertKbEntries, type KbDynamicRow } from "@/lib/supabase";
import { notifySettleEvents, type SettleNotifyItem } from "@/lib/notify-serverchan";
import { getQtStocks } from "@/lib/qt";
import { callAI } from "@/lib/ai";

/**
 * 错账归因（10/1，宪法2复盘层）：被证伪的判断机械结算只给"错了"，归因给出"错在哪"。
 * 四分类：数据前提变化（data_shift）/关键位设计问题（level_design）/逻辑错误（logic_error）/外部冲击（external_shock）
 */
async function attributeInvalidation(ctx: {
  symbol: string;
  stance: string;
  level: number;
  settle_price: number;
  invalidation: string;
  judged_date: string;
  direction: string;
}): Promise<{ text: string; kind: string } | null> {
  const prompt = [
    `以下是一个投资判断的机械结算结果——它被证伪了（失效条件触发）。`,
    `判断：${ctx.judged_date} 立场=${ctx.stance} 失效位=${ctx.level}（${ctx.direction === "down" ? "跌破类" : "突破类"}）`,
    `失效条件：${ctx.invalidation}`,
    `结算时价：${ctx.settle_price}`,
    ``,
    `任务：一句话归因（35字内），从以下四类选一，格式「【类名】说明」：`,
    `【数据前提变化】判断依据的数据在判断后发生了当时不可知的变化`,
    `【关键位设计问题】失效位设得过近/过远，正常波动即触发或该触发未设防`,
    `【逻辑错误】判断逻辑本身站不住（因果关系有漏洞）`,
    `【外部冲击】不可预期的外部事件（政策/突发）直接触发`,
    `只输出归因本身。`,
  ].join("\n");
  try {
    const text = await callAI([{ role: "user", content: prompt }], {
      temperature: 0.3,
      max_tokens: 80,
      timeout: 20_000,
      retry: 0,
    });
    if (!text || !text.trim()) return null;
    const clean = text.trim().slice(0, 80);
    const kind = clean.includes("数据前提变化")
      ? "data_shift"
      : clean.includes("关键位设计")
        ? "level_design"
        : clean.includes("逻辑错误")
          ? "logic_error"
          : clean.includes("外部冲击")
            ? "external_shock"
            : "other";
    return { text: clean, kind };
  } catch {
    return null;
  }
}

type SettleContentObj = {
  kind: "judgment_settle";
  symbol: string;
  judged_date: string;
  stance: string;
  direction: string;
  level: number;
  settle_price: number;
  result: string;
  invalidation: string;
  time_box: number | null;
  env_tags: string | null;
  exec_plan: string | null;
  failure_strictness: string;
  settled_at: string;
  attribution: string | null;
  attribution_kind: string | null;
};

function authOk(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("token") === secret;
}

// 方向词分类（与chat路由记账核验同源口径）
const TRIG_DOWN_RE = /跌破|失守|下破|低于|收于.*之下/;
const TRIG_UP_RE = /突破|站上|上破|高于|收于.*之上/;

/** 非价格维度词：失效条件里的数字是估值/比率/事件而非股价，机械按价格判定=口径错位错杀（10/1六轮检测P2-12，KO"PE破28"被当股价28实锤） */
const NON_PRICE_RE = /\b(PE|PB|PS|ROE|ROA|EPS)\b|市盈率|市净率|股息|增速|增长率|涨跌幅|回报率|利润率|毛利率|净利率|增长率|仓位|比例|概率|信心度|倍\b/;

/** 从失效条件文本提取 (方向, 关键数字)；提取失败返回null留待下轮 */
function parseInvalidation(text: string): { direction: "down" | "up"; level: number } | null {
  if (!text) return null;
  // 非价格维度（估值/比率/概率/仓位类）：机械解析必然口径错位——宁缺勿错，跳过结算留人工核验
  if (NON_PRICE_RE.test(text)) return null;
  const nums = text.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return null;
  const level = Number(nums[0]);
  if (!Number.isFinite(level) || level <= 0) return null;
  if (TRIG_DOWN_RE.test(text)) return { direction: "down", level };
  if (TRIG_UP_RE.test(text)) return { direction: "up", level };
  return null;
}

/** 现价相对失效位的判定 */
function judge(price: number, direction: "down" | "up", level: number): "invalidated" | "alive" {
  if (direction === "down") return price <= level ? "invalidated" : "alive";
  return price >= level ? "invalidated" : "alive";
}

/** 腾讯行情批量现价：q=usNVDA,usAAPL → {NVDA: 219.34}（美股前缀us；单请求≤20码） */
async function fetchTencentPrices(symbols: string[]): Promise<Map<string, number>> {
  // 10/1统一走lib/qt.ts（前缀感知：美股us/港股r_hk），与工厂行情同源同解析
  const stocks = await getQtStocks(symbols);
  const out = new Map<string, number>();
  stocks.forEach((v, k) => {
    if (v.price != null && v.price > 0) out.set(k.toUpperCase(), v.price);
  });
  return out;
}

export async function GET(request: NextRequest) {
  if (!authOk(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const ledger = await readAllLedger(500);
  if (!ledger || ledger.length === 0) {
    return NextResponse.json({ ok: true, settled: 0, reason: "ledger_empty" });
  }

  // 已结算集合：kb_dynamic里kind=judgment_settle的(symbol+judged_date)
  const kbRows = await readKbEntries(200);
  const settledKeys = new Set<string>();
  for (const row of kbRows ?? []) {
    if (!row.content.includes('"kind":"judgment_settle"')) continue;
    try {
      const obj = JSON.parse(row.content) as { symbol?: string; judged_date?: string };
      if (obj.symbol && obj.judged_date) settledKeys.add(`${obj.symbol}|${obj.judged_date}`);
    } catch {
      // 解析失败跳过
    }
  }

  // 待结算：有失效条件、90天内、(symbol,date)未结算、同键去重取最新ts
  const candidates = new Map<string, (typeof ledger)[number]>();
  const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
  for (const r of ledger) {
    if (!r.invalidation || !r.symbol || !r.date) continue;
    if (!parseInvalidation(r.invalidation)) continue;
    const t = r.ts ? Date.parse(r.ts) : NaN;
    if (Number.isFinite(t) && t < cutoff) continue;
    const key = `${r.symbol}|${r.date}`;
    const prev = candidates.get(key);
    if (!prev || (prev.ts ?? "") < (r.ts ?? "")) candidates.set(key, r);
  }
  const pending = Array.from(candidates.values()).filter((r) => !settledKeys.has(`${r.symbol}|${r.date}`));
  if (pending.length === 0) {
    return NextResponse.json({ ok: true, settled: 0, reason: "nothing_to_settle", ledger_rows: ledger.length });
  }

  const prices = await fetchTencentPrices(Array.from(new Set(pending.map((r) => r.symbol))));

  // Schema V2：narrative行（失效条件不可机械核验）单列透明度统计——不无限静默悬挂
  const narrativeUnsettled = ledger.filter(
    (r) => r.invalidation && r.symbol && r.date && !parseInvalidation(r.invalidation)
  ).length;

  const now = new Date().toISOString();
  const rows: KbDynamicRow[] = [];
  const skipped: string[] = [];
  // server酱事件推送收集：只收invalidated/expired（低频高价值，alive不推防噪音）
  const notifyItems: SettleNotifyItem[] = [];
  // 10/1错账归因任务收集：invalidated行结算后并行AI归因（宪法2复盘层——结果之外要有教训）
  const attributionTasks: { contentObj: SettleContentObj; row: KbDynamicRow }[] = [];

  // 10/1 Phase1：工厂前置内嵌——Vercel Hobby cron必须daily，"0 21 * * 1-5"从未注册过（ledger 0行实锤）
  // 修复=本端点成为每日账本全流程：先工厂扫描入账，再结算，再推送（工厂失败不挡结算主流程）
  let factorySummary = { produced: 0, inserted: 0, items: [] as { symbol: string; master: string }[] };
  let factoryError = "";
  try {
    const { runFactoryAndInsert } = await import("@/lib/judgment-factory");
    factorySummary = await runFactoryAndInsert();
  } catch (e) {
    factoryError = e instanceof Error ? e.message.slice(0, 120) : "unknown";
  }
  for (const r of pending) {
    const price = prices.get(r.symbol);
    if (!price) {
      skipped.push(r.symbol);
      continue;
    }
    const parsed = parseInvalidation(r.invalidation!);
    if (!parsed) continue;
    let result: string = judge(price, parsed.direction, parsed.level);
    // 9/25二轮交叉验证：工厂信号类判断（[信号完成]尾标）失效条件触发=信号完成非证伪——
    // result="signal_done"避免观望警示被计入"判断错误"污染对错率计量（能力工程命门）
    if (r.invalidation!.includes("[信号完成]") && result === "invalidated") result = "signal_done";
    // Schema V2（10/1 Phase1）：时间盒到期强制结算——失效未触发也未走出预期=expired数据点
    // （堵"失效条件永不触发=永不判错"的悬挂漏洞；失效已被触发的不受时间盒影响）
    if (result === "alive" && r.time_box && r.time_box > 0) {
      const judged = Date.parse(r.date);
      const deadline = (Number.isFinite(judged) ? judged : Date.now()) + r.time_box * 24 * 3600 * 1000;
      if (Date.now() > deadline) result = "expired";
    }
    const contentObj: SettleContentObj = {
      kind: "judgment_settle",
      symbol: r.symbol,
      judged_date: r.date,
      stance: r.stance,
      direction: parsed.direction,
      level: parsed.level,
      settle_price: price,
      result,
      invalidation: r.invalidation ?? "",
      // Schema V2：错账呈现三要素随行（数据点+失效条件复盘+环境标签，宪法2）
      time_box: r.time_box ?? null,
      env_tags: r.env_tags ?? null,
      exec_plan: r.exec_plan ?? null,
      failure_strictness: "strict",
      settled_at: now,
      // 10/1错账归因（宪法2复盘层）：invalidated行结算后由callAI补归因（见循环后归因段）
      attribution: null as string | null,
      attribution_kind: null as string | null,
    };
    const row: KbDynamicRow = {
      id: `settle-${r.symbol}-${r.date}`,
      type: "insight",
      keywords: [r.symbol, "settle", r.date],
      content: JSON.stringify(contentObj),
      source: "cron-judgment-settle",
      created: now,
    };
    rows.push(row);
    if (result === "invalidated") {
      attributionTasks.push({ contentObj, row });
    }
    if (result === "invalidated" || result === "expired") {
      notifyItems.push({
        symbol: r.symbol,
        judged_date: r.date,
        stance: r.stance,
        result: result,
        settle_price: price,
        level: parsed.level,
        invalidation: r.invalidation!,
        env_tags: r.env_tags ?? null,
        time_box: r.time_box ?? null,
      });
    }
  }

  let written = 0;

  // 10/1错账归因段（宪法2复盘层）：invalidated行并行AI归因——结果之外要有教训。
  // callAI=DeepSeek-flash，归因频率极低（每日0-5条）×80token，成本可忽略；失败静默（归因是增强不是依赖）
  let attributed = 0;
  if (attributionTasks.length > 0) {
    const results = await Promise.allSettled(attributionTasks.map((t) => attributeInvalidation(t.contentObj)));
    results.forEach((res, i) => {
      if (res.status === "fulfilled" && res.value) {
        const t = attributionTasks[i];
        t.contentObj.attribution = res.value.text;
        t.contentObj.attribution_kind = res.value.kind;
        t.row.content = JSON.stringify(t.contentObj);
        attributed++;
      }
    });
  }

  if (rows.length > 0) written = (await upsertKbEntries(rows)) ? rows.length : 0;

  // 推送在落库成功后执行——key缺失静默跳过（推送是增强不是依赖）
  const pushed = written > 0 ? await notifySettleEvents(notifyItems) : false;

  return NextResponse.json({
    ok: true,
    factory: { produced: factorySummary.produced, inserted: factorySummary.inserted, items: factorySummary.items, error: factoryError || undefined },
    settled: written,
    attributed,
    skipped_no_price: skipped,
    pending_total: pending.length,
    narrative_unsettled: narrativeUnsettled,
    notified: pushed,
    notify_events: notifyItems.length,
    ledger_rows: ledger.length,
    sample_prices: Object.fromEntries(Array.from(prices.entries()).slice(0, 5)),
  });
}
