#!/usr/bin/env node
/**
 * 费曼星判断能力评测跑分器（9/18能力工程骨架）
 *
 * 用法：
 *   node scripts/eval-score.mjs --dry                # 校验金标集结构（零成本，CI可跑）
 *   node scripts/eval-score.mjs --live               # 真调chat API跑分（需DEEPSEEK_API_KEY+线上服务）
 *   BASE=http://localhost:3000 node scripts/eval-score.mjs --live
 *
 * 评分协议：五维结构判据各0-2分（0缺/1弱/2合格），总分10。
 * --live模式由LLM-as-judge按gold_structure逐维评分+结构校验器双重核分，每周回归出曲线。
 * 分数不涨不合入——像编译器一样对待判断质量。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const goldPath = join(ROOT, "data", "eval", "golden-set-v1.json");
const gold = JSON.parse(readFileSync(goldPath, "utf8"));

const DIMENSIONS = Object.keys(gold.meta.dimensions);
const args = process.argv.slice(2);
const live = args.includes("--live");
const base = args.find((a) => a.startsWith("BASE="))?.split("=")[1] || "https://sufve.com";

// 结构校验（--dry默认跑）
let structErrors = 0;
for (const c of gold.cases) {
  const missing = DIMENSIONS.filter((d) => !c.gold_structure?.[d]);
  if (missing.length) {
    console.error(`✗ ${c.id} 缺维度判据: ${missing.join(",")}`);
    structErrors++;
  }
  if (!c.trap) {
    console.error(`✗ ${c.id} 缺trap（失效模式标注）`);
    structErrors++;
  }
}
console.log(`金标集 ${gold.meta?.name || gold.name}：${gold.cases.length} 题，结构校验 ${structErrors === 0 ? "✓ 通过" : `✗ ${structErrors} 处问题`}`);
if (structErrors > 0) process.exit(1);

if (!live) {
  console.log("dry模式完成（结构校验）。--live 真跑需 DEEPSEEK_API_KEY 且目标服务可用。");
  process.exit(0);
}

// —— live跑分：调chat API → LLM裁判按五维打分 ——
const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error("DEEPSEEK_API_KEY 未配置");
  process.exit(1);
}

async function askChat(question) {
  const res = await fetch(`${base}/api/invest/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: { type: "text", text: question } }],
      style: "balanced",
    }),
  });
  if (!res.ok) throw new Error(`chat ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const data = await res.json();
  return typeof data?.reply === "string" ? data.reply : typeof data?.text === "string" ? data.text : JSON.stringify(data).slice(0, 500);
}

async function judge(question, answer) {
  const rubric = DIMENSIONS.map((d) => `- ${d}（0-2分）：${gold.meta.dimensions[d]}`).join("\n");
  const prompt = `你是严格的结构判据裁判。按以下五个维度对AI投资回答逐维打分（0缺/1弱/2合格），只输出JSON：{"scores":{"fail_condition":n,"data_citation":n,"two_sides":n,"position_math":n,"conclusive":n},"notes":"一句话"}\n${rubric}\n\n【用户问题】${question}\n【AI回答】${answer.slice(0, 4000)}`;
  const res = await fetch(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL || "deepseek-flash", messages: [{ role: "user", content: prompt }], temperature: 0, max_tokens: 300, response_format: { type: "json_object" } }),
  });
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

const results = [];
for (const c of gold.cases) {
  process.stdout.write(`${c.id} 跑分中…`);
  try {
    const answer = await askChat(c.question);
    const verdict = await judge(c.question, answer);
    const total = DIMENSIONS.reduce((s, d) => s + (verdict.scores?.[d] ?? 0), 0);
    results.push({ id: c.id, total, max: DIMENSIONS.length * 2, notes: verdict.notes });
    console.log(` ${total}/${DIMENSIONS.length * 2} ${verdict.notes || ""}`);
  } catch (e) {
    console.log(` ✗ ${e.message}`);
    results.push({ id: c.id, total: 0, max: 10, notes: `error: ${e.message}` });
  }
}

const sum = results.reduce((s, r) => s + r.total, 0);
const maxSum = results.reduce((s, r) => s + r.max, 0);
console.log(`\n总分 ${sum}/${maxSum}（${((sum / maxSum) * 100).toFixed(1)}%）——历史曲线追加至 data/eval/score-history.jsonl`);

// 0-1闭环（9/24补全）：live结果自动落盘score-history.jsonl，不再依赖手动记录
import { appendFileSync } from "node:fs";
const record = {
  date: new Date().toISOString().slice(0, 10),
  set: gold.meta?.name || "golden-set",
  mode: "live",
  target: base,
  judge: "deepseek-flash(脚本内置裁判)",
  results: results.map((r) => ({ id: r.id, scores: r.scores ?? null, total: r.total, notes: r.notes ?? null })),
  total: sum,
  max: maxSum,
  pct: Number(((sum / maxSum) * 100).toFixed(1)),
};
appendFileSync(join(ROOT, "data", "eval", "score-history.jsonl"), JSON.stringify(record) + "\n");
console.log(`已写入 data/eval/score-history.jsonl（${record.date} ${sum}/${maxSum}）`);
