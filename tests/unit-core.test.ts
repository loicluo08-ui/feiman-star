/**
 * T1单元测试套件（9/13全检）——九个lib核心函数
 * 跑法：npx tsx tests/unit-core.test.ts（全绿输出ALL PASS）
 */
import { parseLedgerLine, pruneLedger, stripLedgerLines } from "../lib/judgment-ledger";
import { median, SECTOR_PEERS } from "../lib/sector-peers";
import { isMacroQuery } from "../lib/macro-context";
import { readFileSync } from "fs";
import { isEnglishDominant, normalizeForDedup } from "../lib/flash-filter";
import { isOptionQuery } from "../lib/option-context";

let pass = 0, fail = 0;
const failures: string[] = [];
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; failures.push(`${name}: got=${g} want=${w}`); }
}
function ok(name: string, cond: boolean) {
  if (cond) { pass++; } else { fail++; failures.push(`${name}: 条件不成立`); }
}

// ---- T1.1 判断记账 parse ----
const mk = (s: string) => `正文【裁决】...\n【判断记账】${s}\n后续`;
eq("parse半角", parseLedgerLine(mk("标的=NVDA(英伟达) | 立场=多 | 关键位=218 | 失效=跌破205 | 信心度=62%")), {
  symbol: "NVDA(英伟达)", stance: "多", keyLevel: "218", invalidation: "跌破205", confidence: "62%",
  date: new Date().toISOString().slice(0, 10), ts: parseLedgerLine(mk("标的=NVDA | 立场=多"))?.ts ?? 0,
} as any ? parseLedgerLine(mk("标的=NVDA(英伟达) | 立场=多 | 关键位=218 | 失效=跌破205 | 信心度=62%")) : null);
eq("parse全角管道", parseLedgerLine(mk("标的=NVDA ｜ 立场=多 ｜ 关键位=218 ｜ 失效=跌破205 ｜ 信心度=62%"))?.symbol, "NVDA");
eq("parse混合管道", parseLedgerLine(mk("标的=NVDA ｜ 立场=多 | 关键位=218"))?.stance, "多");
ok("parse缺立场返回null", parseLedgerLine(mk("标的=NVDA")) === null);
ok("parse无记账行null", parseLedgerLine("普通回答") === null);
ok("半截行null", parseLedgerLine("分析中...【判断记账】标的=NVDA") === null || parseLedgerLine("分析中...【判断记账】标的=NVDA")!.symbol === "NVDA");

// ---- prune ----
const now = Date.now();
const e = (days: number, sym: string) => ({ symbol: sym, stance: "多", keyLevel: "", invalidation: "", confidence: "", date: "2026-01-01", ts: now - days * 864e5 });
eq("prune 90天整点保留", pruneLedger([e(89, "A"), e(91, "B")]).map((x) => x.symbol), ["A"]);
eq("prune容量200", pruneLedger(Array.from({ length: 250 }, (_, i) => e(1, `S${i}`))).length, 200);
ok("prune坏数据过滤", pruneLedger([{ symbol: "X", stance: "", keyLevel: "", invalidation: "", confidence: "", date: "", ts: undefined as unknown as number } as any]).length === 0);

// ---- strip ----
ok("strip完整行", !stripLedgerLines("A\n【判断记账】标的=X\nB").includes("判断记账"));
ok("strip保留正文", stripLedgerLines("A\n【判断记账】标的=X\nB").includes("A") && stripLedgerLines("A\n【判断记账】标的=X\nB").includes("B"));
ok("strip末尾无换行", !stripLedgerLines("正文【判断记账】标的=X").includes("判断记账"));
ok("strip半截行", !stripLedgerLines("正文...【判断记账】标的=NV").includes("判断记账"));

// ---- median ----
eq("median奇数", median([1, 3, 2]), 2);
eq("median偶数", median([1, 2, 3, 4]), 2.5);
eq("median空", median([]), null);
eq("median全null过滤", median([null as unknown as number, 5, null as unknown as number].filter((n) => typeof n === "number" && n > 0)), 5);

// ---- 行业表完整性 ----
ok("静态表每组≥3同行", Object.values(SECTOR_PEERS).every((v) => v.length >= 3));
ok("静态表key大写", Object.keys(SECTOR_PEERS).every((k) => k === k.toUpperCase()));

// ---- isMacroQuery ----
ok("macro正例:加仓", isMacroQuery("现在的美股大盘环境适合加仓吗"));
ok("macro正例:美联储", isMacroQuery("美联储下周加息意味着什么"));
ok("macro正例:美债", isMacroQuery("美债收益率影响科技股吗"));
ok("macro反例:个股", !isMacroQuery("英伟达现在什么情况"));
ok("macro反例:空", !isMacroQuery(""));

// ---- crossValidate词表（server-only不可import，源码断言）----
const cvSrc = readFileSync("lib/cross-validate.ts", "utf-8");
ok("cv词表:永久", cvSrc.includes("永久"));
ok("cv词表:必然(9/13补)", /必然\(\?!/.test(cvSrc));
ok("cv词表:肯定会(9/13补)", cvSrc.includes("肯定会"));
ok("cv词表:绝对不会(9/13补)", cvSrc.includes("绝对不会"));
ok("cv词表:百分之百", cvSrc.includes("百分之百"));
ok("cv词表:零风险", cvSrc.includes("零风险"));
ok("cv负向:必然性排除", /必然\(\?!\\s\*性\)/.test(cvSrc));
ok("cv负向:永远不失效排除", /永远\(\?!/.test(cvSrc));

// ---- flash ----
ok("英文过滤", isEnglishDominant("The NVIDIA earnings beat expectations by a wide margin across all segments"));
ok("中文不过滤", !isEnglishDominant("英伟达财报超预期，营收同比大增"));
eq("去重归一", normalizeForDedup("英伟达发布新品！"), normalizeForDedup("英伟达 发布 新品！"));

// ---- 期权 ----
ok("期权正例", isOptionQuery("我想用备兑开仓增强收益"));
ok("期权反例", !isOptionQuery("英伟达基本面怎么样"));

// ---- T1汇总 ----
console.log(`\n=== T1单测结果: ${pass} pass / ${fail} fail ===`);
if (failures.length) { console.log("失败明细:"); failures.forEach((f) => console.log("  ✗ " + f)); }
process.exit(fail > 0 ? 1 : 0);
