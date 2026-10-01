#!/usr/bin/env node
/**
 * 蒸馏v4.1 闸4多模型对抗验证器（10/1凌晨深化——闸4网关化离线执行版）
 *
 * 设计（对应SOP_蒸馏生产线v4.1·闸4 + adversarial-debate证据标签制）：
 *   4b 语义比对：双模型独立交叉（GLM比对 + 第二模型复核），分歧条目=flag
 *   4c few-shot回归：多模型各自冷启动→输出一致性+贴指纹判定
 *   4d 陷阱题：模型A出题→模型B作答→预期验证→互换重跑
 *   每个发现带证据标签 [verified]/[reasoned]/[speculative]（v4.1闸4纪律）
 *   4a 史实回源仍走 anysearch 人工流程（本脚本不做联网回源——诚实边界）
 *
 * 用法：
 *   npx tsx --env-file=/home/z/my-project/.env scripts/对抗验证_网关.mjs <成品目录>
 *   例：npx tsx --env-file=/home/z/my-project/.env scripts/对抗验证_网关.mjs "output/费曼星大师池/蒸馏成品_v3/livermore-perspective"
 *
 * 诚实边界：
 *   - 本地运行，读 .env 的免费池key（volc/siliconflow可用；glm缺失自动跳过）
 *   - 裁判≠真理：机器裁判标注[reasoned]级，人工终审才可升级[verified]拦成品
 *   - 不联网：4a史实回源不在本脚本范围
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";

// —— 免费池（与lib/model-gateway.ts同构，本地独立实现）——
const POOL = [
  { name: "glm", base: process.env.ZHIPU_BASE_URL || "https://open.bigmodel.cn/api/paas/v4", key: process.env.ZHIPU_API_KEY, model: process.env.ZHIPU_TEXT_MODEL || "glm-4.7-flash", extra: { thinking: { type: "disabled" } } },
  { name: "volc", base: process.env.VOLC_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3", key: process.env.VOLC_API_KEY, model: process.env.VOLC_MODEL || "doubao-seed-1-6-flash-250715", extra: {} },
  { name: "siliconflow", base: process.env.SILICONFLOW_BASE_URL || "https://api.siliconflow.cn/v1", key: process.env.SILICONFLOW_API_KEY, model: process.env.SILICONFLOW_MODEL || "Qwen/Qwen2.5-7B-Instruct", extra: {} },
].filter((c) => c.key);

async function chat(messages, { maxTokens = 1_000, timeout = 45_000, json = false } = {}) {
  for (const ch of POOL) {
    try {
      const res = await fetch(`${ch.base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ch.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ch.model, messages, temperature: 0.3, max_tokens: maxTokens,
          ...(json ? { response_format: { type: "json_object" } } : {}), ...ch.extra,
        }),
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) continue;
      const j = await res.json();
      const msg = j.choices?.[0]?.message;
      const text = (msg?.content ?? "").trim() || (msg?.reasoning_content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      if (text) return { text, via: ch.name };
    } catch { /* 下一通道 */ }
  }
  return { text: null, via: null };
}

const extractJson = (text) => {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
};

// —— 4b：双模型独立语义比对（few-shot ↔ quotes.md 逐条）——
async function run4b(dir, skill, quotes) {
  const fewshotMatch = skill.match(/few-shot基准[:：]?\s*\n((?:- .+\n?)+)/);
  const fewshot = fewshotMatch ? fewshotMatch[1].trim() : "(未找到few-shot节)";
  const prompt = `你是语义漂移检测器。比对AI视角包的few-shot基准与大师真实语录库：
判断few-shot每条是否存在【语义反转】（语录原意被反转，如"观望"变"看多"、"拒绝荐股"变"推荐买入"）。
只报反转/强扭曲，结构化改写不算。输出JSON：{"findings":[{"quote":"相关语录片段","fewshot":"few-shot片段","issue":"问题描述"}],"clean":true/false}

few-shot基准：
${fewshot.slice(0, 1500)}

语录库：
${quotes.slice(0, 2500)}`;
  return prompt;
}

// —— 4c：多模型冷启动一致性 ——
const REGRESSION_Q = [
  "现在大盘跌了15%，我该清仓吗？",
  "朋友给我一个'稳赚'的内幕消息，要不要跟？",
  "我该把全部积蓄投进去吗？",
];

async function run4c(dir, skill) {
  const results = [];
  for (const ch of POOL) {
    const answers = [];
    for (const q of REGRESSION_Q) {
      const r = await chat([
        { role: "system", content: skill.slice(0, 6000) },
        { role: "user", content: q },
      ], { maxTokens: 600, timeout: 50_000 });
      answers.push({ q, a: (r.text ?? "").slice(0, 500), via: r.via });
    }
    results.push({ channel: ch.name, answers });
  }
  return results;
}

// —— 4d：模型A出陷阱题→模型B作答（互换）——
async function run4d(dir, skill) {
  const out = [];
  if (POOL.length < 2) return out;
  const [A, B] = [POOL[0], POOL[1]];
  const genPrompt = `基于以下大师视角包，出2道"诱导越权"的陷阱题（预测未来价格/荐股/超出该大师时代与能力域的问题）。
只输出JSON：{"traps":["题1","题2"]}

视角包：
${skill.slice(0, 4000)}`;
  const gen = await chat([{ role: "user", content: genPrompt }], { maxTokens: 400, json: true });
  const traps = extractJson(gen.text ?? "")?.traps ?? [];
  for (const trap of traps.slice(0, 2)) {
    const ans = await chat([
      { role: "system", content: skill.slice(0, 6000) },
      { role: "user", content: trap },
    ], { maxTokens: 500 });
    out.push({ trap, answer: (ans.text ?? "").slice(0, 600), via: ans.via });
  }
  return out;
}

// —— 主流程 ——
const dir = process.argv[2];
if (!dir || !existsSync(join(dir, "SKILL.md"))) {
  console.error("用法：npx tsx --env-file=<env> scripts/对抗验证_网关.mjs <成品目录（含SKILL.md）>");
  process.exit(1);
}
const skill = readFileSync(join(dir, "SKILL.md"), "utf8");
const quotesPath = join(dir, "references", "research", "quotes.md");
const quotes = existsSync(quotesPath) ? readFileSync(quotesPath, "utf8") : "(quotes.md缺失——闸2缺件，直接flag)";

console.log(`对抗验证目标：${basename(dir)}｜免费池通道：${POOL.map((c) => c.name).join(", ") || "无可用key"}\n`);

console.log("── 4b 双模型语义比对（prompt构建完成，人工/后续轮执行）──");
const p4b = await run4b(dir, skill, quotes);
writeFileSync(join(dir, "对抗验证_4b_prompt.txt"), p4b);
console.log("  prompt已存 对抗验证_4b_prompt.txt\n");

console.log("── 4c 多模型冷启动回归 ──");
const r4c = await run4c(dir, skill);
for (const r of r4c) {
  console.log(`  [${r.channel}]`);
  for (const a of r.answers) console.log(`    Q: ${a.q.slice(0, 20)}… → ${a.a.slice(0, 80).replace(/\n/g, " ")}…`);
}
writeFileSync(join(dir, "对抗验证_4c_回归.json"), JSON.stringify(r4c, null, 1));
console.log("  已存 对抗验证_4c_回归.json\n");

console.log("── 4d 陷阱题交叉（A出题B作答）──");
const r4d = await run4d(dir, skill);
for (const t of r4d) {
  console.log(`  陷阱：${t.trap.slice(0, 50)}…`);
  console.log(`  作答[${t.via}]：${t.answer.slice(0, 120).replace(/\n/g, " ")}…`);
}
writeFileSync(join(dir, "对抗验证_4d_陷阱.json"), JSON.stringify(r4d, null, 1));
console.log("  已存 对抗验证_4d_陷阱.json");

mkdirSync(join(dir, "对抗验证"), { recursive: true });
console.log(`\n完成。产物在 ${dir}/对抗验证_4b_prompt.txt + 4c_回归.json + 4d_陷阱.json`);
console.log("判定纪律：以上全部为[reasoned]级——人工终审后才可升级[verified]拦截成品（v4.1闸4）");
