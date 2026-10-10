// KB检索金丝雀（10/11 B4，GBrain .gbrain-evals映射：qrels+canary+可复现）
// 用法：node scripts/kb_canary.js（tsc编译kb-router同源逻辑，不手工复刻）
// qrels维护：新增/修改题目必须跑一遍更新基线并在commit message注明变化
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const outDir = "/tmp/kb_canary_build";
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execSync(
  `npx tsc lib/kb-router.ts lib/feimanstar-kb.ts --outDir ${outDir} --module commonjs --target es5 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: "pipe" },
);
const kbRouter = require(path.join(outDir, "kb-router.js"));

// 核心集恒注入不参与金丝雀判定（测了必过=无信息）
const CORE = new Set([0, 3, 4, 5, 7, 12, 99, 100]);

// ── qrels：20题（17正样本+3负样本），每题=question + 期望命中的非核心模块 ──
const QRELS = [
  { q: "石油板块现在的估值逻辑是什么", expect: [1] },
  { q: "银行股和科技股的PE差距合理吗", expect: [1, 2] },
  { q: "TSLA财报前怎么布局", expect: [1, 2, 11] },
  { q: "上次恐慌割肉的行为偏差怎么克服", expect: [6] },
  { q: "期权的Delta中性怎么构建", expect: [8, 9, 10] },
  { q: "芒格和巴菲特对安全边际的理解差异", expect: [11] },
  { q: "英伟达现在能不能抄底", expect: [1, 2, 11] },
  { q: "帮我看看AAPL的估值", expect: [1, 2, 11] },
  { q: "追涨杀跌之后如何修复心态", expect: [6] },
  { q: "备兑开仓和covered call的区别", expect: [8, 10] },
  { q: "成本伦怎么分析", expect: [] },
  { q: "最近有什么消息", expect: [] },
  { q: "NVDA期权怎么展期", expect: [1, 2, 8, 9, 10, 11] },
  { q: "自由现金流折现怎么算", expect: [2] },
  { q: "索罗斯的反身性在A股怎么用", expect: [11] },
  { q: "半导体行业现在处于周期什么位置", expect: [1] },
  { q: "下跌时该止损还是摊平", expect: [1, 2, 6, 11] },
  { q: "IV高点适合卖期权吗", expect: [8, 9, 10] },
  { q: "腾讯控股怎么样", expect: [] },
  { q: "账面亏损50%舍不得卖", expect: [6] },
];

let hit = 0, miss = 0;
const details = [];
for (const { q, expect } of QRELS) {
  const sel = kbRouter.selectKBForQuestion(q, [], null);
  const got = sel.includedModules.filter((m) => !CORE.has(m)).sort((a, b) => a - b);
  const exp = [...expect].sort((a, b) => a - b);
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (ok) hit++;
  else miss++;
  details.push({ q, expect: exp, got, ok, fullFallback: sel.fullFallback });
  console.log(`${ok ? "✓" : "✗"} [${q}] 期望[${exp.join(",")}] 实得[${got.join(",")}]${sel.fullFallback ? " ⚠️保险丝回退" : ""}`);
}

// 指标：精确匹配率 + P/R（以expect为真值集）
let pSum = 0, rSum = 0, pN = 0, rN = 0;
for (const d of details) {
  if (d.expect.length > 0) {
    const inter = d.got.filter((m) => d.expect.includes(m)).length;
    pSum += d.got.length > 0 ? inter / d.got.length : 0;
    rSum += inter / d.expect.length;
    pN++; rN++;
  }
}
const precision = pN > 0 ? (pSum / pN) : 1;
const recall = rN > 0 ? (rSum / rN) : 1;

console.log(`\n━━ 金丝雀结果：精确匹配 ${hit}/${QRELS.length} | 检索P@模块=${precision.toFixed(3)} R@模块=${recall.toFixed(3)}`);
const fullFallbackCount = details.filter((d) => d.fullFallback).length;
if (fullFallbackCount > 0) console.log(`⚠️ 保险丝回退${fullFallbackCount}次（异常回退=路由失效，必须查）`);

// 基线文件：commit锚定可复现（GBrain eval-results模式）
const baseline = {
  // date字段已去除（10/11交叉验证修：运行时时间戳=每次跑都产生git diff噪声；commit时间即运行时间）
  exact_match: `${hit}/${QRELS.length}`,
  precision_at_module: precision,
  recall_at_module: recall,
  full_fallback_count: fullFallbackCount,
  results: details,
};
fs.writeFileSync("data/kb_canary_baseline.json", JSON.stringify(baseline, null, 1));
console.log("基线已写 data/kb_canary_baseline.json（commit锚定）");

if (miss > 0) process.exitCode = 1; // CI语义：有miss非零退出（人工裁决是否接受新路由行为）
