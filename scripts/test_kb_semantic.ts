/**
 * KB语义检索实测（10/3）——测真实生产行为：selectDynamicKB原函数
 * 运行：npx esbuild bundle 到临时js后 node 执行
 * 用法：node /tmp/kb_semantic_test.mjs
 * 环境变量由 /tmp/vercel-env-prod.txt 注入（入口处解析，避免依赖dotenv）
 */
import { readFileSync } from "fs";

// —— 生产env注入（Vercel pull产物，key=value格式）——
for (const line of readFileSync("/tmp/vercel-env-prod.txt", "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

import { selectDynamicKB } from "@/lib/kb-dynamic";
import { readKbEntries } from "@/lib/supabase";

const RULE = "─".repeat(72);

// ——— 第一部分：库存体检 ———
async function inventoryAudit() {
  console.log("\n========== 一、知识库库存体检 ==========");
  const rows = await readKbEntries(500);
  if (!rows) { console.log("❌ Supabase读取失败"); return null; }
  const today = new Date().toISOString().slice(0, 10);
  const types: Record<string, number> = {};
  let withVec = 0, expired = 0, badVecDim: Record<string, number> = {};
  const seenHead = new Set<string>();
  let dupContent = 0;
  for (const r of rows) {
    types[r.type] = (types[r.type] || 0) + 1;
    if (r.embedding) {
      withVec++;
      try {
        const v = typeof r.embedding === "string" ? JSON.parse(r.embedding) : r.embedding;
        const d = Array.isArray(v) ? v.length : 0;
        badVecDim[d] = (badVecDim[d] || 0) + 1;
      } catch { badVecDim[-1] = (badVecDim[-1] || 0) + 1; }
    }
    if (r.expires && r.expires < today) expired++;
    const head = (r.content || "").slice(0, 30);
    if (seenHead.has(head)) dupContent++;
    seenHead.add(head);
  }
  console.log(`总条数: ${rows.length}`);
  console.log(`类型分布: ${JSON.stringify(types)}`);
  console.log(`有向量: ${withVec}  无向量: ${rows.length - withVec}`);
  console.log(`向量维度分布: ${JSON.stringify(badVecDim)}`);
  console.log(`已过期条目: ${expired}`);
  console.log(`前30字重复内容条数: ${dupContent}`);
  console.log("\n最新12条（id/类型/created/内容前50字）:");
  for (const r of rows.slice(0, 12)) {
    console.log(`  [${r.created}] ${r.type} | ${r.id} | ${(r.content || "").slice(0, 50)}`);
  }
  // 洞察日期分布（看10/1上线后生长是否在跑）
  const insightDays: Record<string, number> = {};
  for (const r of rows) if (r.type === "insight") insightDays[r.created] = (insightDays[r.created] || 0) + 1;
  console.log(`\n洞察按日期分布: ${JSON.stringify(insightDays)}`);
  return rows;
}

// ——— 第二部分：问法矩阵实测 ———
interface QCase { tag: string; q: string; expect: string; }
const CASES: QCase[] = [
  { tag: "N1自然", q: "英伟达现在贵不贵", expect: "NVDA快照/PE类条目" },
  { tag: "N2自然", q: "特斯拉还能不能买", expect: "TSLA快照类条目" },
  { tag: "N3自然", q: "苹果的估值处于什么水平", expect: "AAPL快照类条目" },
  { tag: "N4自然", q: "最近市场有什么值得注意的变化", expect: "洞察类条目" },
  { tag: "N5自然", q: "美联储利率对科技股有什么影响", expect: "宏观/利率类洞察" },
  { tag: "C1代码", q: "NVDA PE", expect: "关键词基线：NVDA快照" },
  { tag: "C2代码", q: "比特币 ETF", expect: "关键词基线：BTC/ETF条目" },
  { tag: "V1语义", q: "估值偏高处于历史高位", expect: "纯语义：无字面关键词，考验相似度" },
];

async function runCases() {
  console.log("\n========== 二、问法矩阵实测（生产函数selectDynamicKB） ==========");
  const stats = { semTotal: 0, semNewTotal: 0, noiseTotal: 0, cases: 0 };
  for (const c of CASES) {
    const t0 = Date.now();
    const { block, count } = await selectDynamicKB(c.q, 4000);
    const ms = Date.now() - t0;
    stats.cases++;
    console.log(`\n${RULE}`);
    console.log(`【${c.tag}】"${c.q}"  (期望:${c.expect})`);
    console.log(`  注入条数:${count}  字符:${block.length}  耗时:${ms}ms`);
    if (block) {
      for (const line of block.split("\n")) {
        const l = line.trim();
        if (l.startsWith("- ") || l.startsWith("【动态")) {
          console.log(`  ${l.startsWith("【") ? l : "  " + l.slice(0, 110)}`);
        }
      }
    }
  }
  return stats;
}

async function main() {
  console.log("费曼星KB语义检索实测 10/3");
  console.log(`env: SUPABASE=${process.env.SUPABASE_URL ? "✓" : "✗"} ZHIPU=${process.env.ZHIPU_API_KEY ? "✓" : "✗"}`);
  await inventoryAudit();
  await runCases();
  console.log("\n========== 实测结束 ==========");
}

main().catch((e) => { console.error("脚本异常:", e); process.exit(1); });
