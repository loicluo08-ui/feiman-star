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
// 10/1裁判免费化：裁判走免费池（GLM→火山→硅基→DeepSeek兜底），DEEPSEEK_API_KEY非必需

async function askChat(question) {
  const res = await fetch(`${base}/api/invest/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://sufve.com", Referer: "https://sufve.com/invest/chat", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({
      messages: [{ role: "user", content: { type: "text", text: question } }],
      style: "balanced",
    }),
    signal: AbortSignal.timeout(115_000),
  });
  if (!res.ok) throw new Error(`chat ${res.status}: ${(await res.text()).slice(0, 120)}`);
  // 10/1修复：chat已改SSE流式（JSON Lines逐行事件）——逐行拼chunk，兼容patch全量替换
  const raw = await res.text();
  let text = "";
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const ev = JSON.parse(t);
      if (ev.type === "chunk") text += ev.text ?? "";
      else if (ev.type === "patch") text = ev.text ?? "";
    } catch { /* 非JSON行跳过 */ }
  }
  return text;
}

// 10/1裁判免费化：免费池优先（GLM-4.7-Flash→火山→硅基→OR→Groq），全挂回DeepSeek
// 运行：npx tsx --env-file=<env路径> scripts/eval-score.mjs --live（env需含各通道KEY）
const FREE_JUDGE_POOL = [
  { name: "glm", base: process.env.ZHIPU_BASE_URL || "https://open.bigmodel.cn/api/paas/v4", key: process.env.ZHIPU_API_KEY, model: process.env.ZHIPU_TEXT_MODEL || "glm-4.7-flash", extra: { thinking: { type: "disabled" } } },
  { name: "volc", base: process.env.VOLC_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3", key: process.env.VOLC_API_KEY, model: process.env.VOLC_MODEL || "doubao-seed-1-6-flash-250715", extra: {} },
  { name: "siliconflow", base: process.env.SILICONFLOW_BASE_URL || "https://api.siliconflow.cn/v1", key: process.env.SILICONFLOW_API_KEY, model: process.env.SILICONFLOW_MODEL || "Qwen/Qwen2.5-7B-Instruct", extra: {} },
  { name: "deepseek", base: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com", key: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL || "deepseek-flash", extra: {} },
];

async function judge(question, answer) {
  const rubric = DIMENSIONS.map((d) => `- ${d}（0-2分）：${gold.meta.dimensions[d]}`).join("\n");
  const prompt = `你是严格的结构判据裁判。按以下五个维度对AI投资回答逐维打分（0缺/1弱/2合格），只输出JSON：{"scores":{"fail_condition":n,"data_citation":n,"two_sides":n,"position_math":n,"conclusive":n},"notes":"一句话"}\n${rubric}\n\n【用户问题】${question}\n【AI回答】${answer.slice(0, 4000)}`;
  for (const ch of FREE_JUDGE_POOL) {
    if (!ch.key) continue;
    try {
      const res = await fetch(`${ch.base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ch.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: ch.model, messages: [{ role: "user", content: prompt }], temperature: 0, max_tokens: 300, response_format: { type: "json_object" }, ...ch.extra }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) { console.error(`[judge] ${ch.name}_${res.status}`); continue; }
      const data = await res.json();
      const content = (data.choices?.[0]?.message?.content ?? "").trim()
        || (data.choices?.[0]?.message?.reasoning_content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) { console.error(`[judge] ${ch.name}_no_json`); continue; }
      return JSON.parse(m[0]);
    } catch (e) {
      console.error(`[judge] ${ch.name}_${e.message?.slice(0, 60)}`);
    }
  }
  throw new Error("judge_all_channels_failed");
}

const results = [];
const startIdx = Number(args.find((a) => a.startsWith("--start="))?.split("=")[1] || 0);
for (const [ci, c] of gold.cases.entries()) {
  if (ci < startIdx) continue;
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
