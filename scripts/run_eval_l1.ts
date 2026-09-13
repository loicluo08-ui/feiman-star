/**
 * L1数值变体对运行器（9/13阶段1.7）——Yang2025数值变体法落地
 * 用法：DEEPSEEK_API_KEY=xxx npx tsx scripts/run_eval_l1.ts [--only L1-PS]
 * 纪律：谷时跑批（00:30-08:30，Tools.md峰谷纪律）——单轮全量约0.2元
 * 判分：fictional标的+注入数字变体→输出必须引用变体数字；变体B复读变体A答案=表面推理（fail）
 */
import { readFileSync } from "fs";
import path from "path";

interface Case {
  id: string; type: string; metric: string; template: string;
  a: Record<string, string | number>; b: Record<string, string | number>;
  expect: { a_answers: string[]; b_answers: string[]; answer_pattern: string };
}
const file = path.join(__dirname, "..", "tests", "eval_l1_cases.json");
const db = JSON.parse(readFileSync(file, "utf-8")) as { cases: Case[] };

const only = process.argv.find(x => x === "--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const cases = only ? db.cases.filter(c => c.id.includes(only)) : db.cases;

function fill(tpl: string, vars: Record<string, string | number>): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

// 判分：期望答案模式在输出中出现（允许多答案任一命中，数值容差由题库多答案枚举覆盖）
function hit(output: string, pattern: string, answers: string[]): boolean {
  for (const ans of answers) {
    const re = new RegExp(pattern.replace("{ans}", ans.replace(".", "\\.")), "i");
    if (re.test(output)) return true;
  }
  // 宽松兜底：答案数字直接出现
  return answers.some(ans => output.includes(ans));
}

async function callModel(question: string): Promise<string> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY未设置");
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
      messages: [{ role: "user", content: question }],
      max_tokens: 2000,
      temperature: 0.5,
      thinking: { type: "disabled" },
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const j = await res.json();
  return (j.choices?.[0]?.message?.content || "") as string;
}

async function main() {
  let pass = 0, fail = 0;
  const failures: string[] = [];
  const t0 = Date.now();
  for (const c of cases) {
    try {
      const qA = fill(c.template, c.a);
      const qB = fill(c.template, c.b);
      const [outA, outB] = await Promise.all([callModel(qA), callModel(qB)]);
      const hitA = hit(outA, c.expect.answer_pattern, c.expect.a_answers);
      const hitB = hit(outB, c.expect.answer_pattern, c.expect.b_answers);
      // 复读检测：B输出里出现A的答案数字=表面推理（模板复读）
      const parrot = c.expect.a_answers.some(ans => outB.includes(ans)) && !hitB;
      const ok = hitA && hitB && !parrot;
      if (ok) pass++;
      else {
        fail++;
        failures.push(`${c.id}[A:${hitA ? "✓" : "✗"} B:${hitB ? "✓" : "✗"}${parrot ? " 复读A!" : ""}]`);
      }
      console.log(`${ok ? "✅" : "❌"} ${c.id} A(${c.expect.a_answers[0]})=${hitA ? "命中" : "未命中"} B(${c.expect.b_answers[0]})=${hitB ? "命中" : "未命中"}`);
    } catch (e) {
      fail++;
      failures.push(`${c.id} EXC:${(e as Error).message}`);
      console.log(`💥 ${c.id} 异常: ${(e as Error).message}`);
    }
  }
  console.log(`\n=== L1变体对: ${pass} pass / ${fail} fail (${((Date.now() - t0) / 1000).toFixed(0)}s) ===`);
  if (failures.length) console.log("失败:", failures.join(" | "));
  process.exit(fail > 0 ? 1 : 0);
}

main();
