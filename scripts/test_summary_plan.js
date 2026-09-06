#!/usr/bin/env node
// G2回归测试：摘要对计划档位的保真（规则23依赖——计划回访靠摘要恢复原档位）
// 跑法：node scripts/test_summary_plan.js（走线上chat-summarize API）
// 用例：计划段在消息尾部（最常见）——首400+尾400拼接必须保住计划六要素
// 用例2：计划档位在长消息中部——中段省略时允许丢失（记录边界，不判fail）
// 用例3：短消息全量进摘要（<800字无截断）——计划必须完整保留

const BASE = process.env.BASE_URL || "https://sufve.com";

async function summarize(prevSummary, messages) {
  const res = await fetch(`${BASE}/api/invest/chat-summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prevSummary, messages }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).summary;
}

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail.slice(0, 120)}` : ""}`); }
};

const PLAN_TAIL = `多头论据：NVDA现价$230.36，PE 29.12处中位。MA20 $220.08之上，多头排列。
空头论据：52周高$236.54是硬阻力，量能仅1.1倍均量。
` + `x`.repeat(1200) + `
【行动计划】时间框架=波段1-3月。目标仓位：从30%减至20%（模块5单一个股上限）。触发分支：①现在减至20%锁浮盈②站稳$236.54且放量>1.5倍均量，剩余持有③跌破MA20 $220.08再减半，跌破MA50 $210.57清仓。证伪信号：财报CapEx指引下修/跌破$210.57。检查点：下季财报日。失效边界：AI资本开支见顶信号出现时全计划作废。`;

const PLAN_SHORT = `NVDA现价$230.36。
【行动计划】目标仓位20%。跌破$220.08减半，跌破$210.57清仓。证伪：财报指引下修。`;

async function main() {
  console.log("== 用例1：计划在长消息尾部（首400+尾400拼接必须保住）==");
  const s1 = await summarize("", [{ role: "assistant", text: PLAN_TAIL }]);
  console.log("摘要:", s1.slice(0, 200));
  check("目标仓位档位保留", /20%/.test(s1));
  check("触发价位档位保留（$220.08或$210.57至少一个）", /220\.08|210\.57/.test(s1));
  check("证伪信号保留", /证伪|财报/.test(s1));
  check("失效边界保留", /作废|失效/.test(s1));

  console.log("== 用例2：短消息（全量进摘要，计划必须完整）==");
  const s2 = await summarize("", [{ role: "assistant", text: PLAN_SHORT }]);
  console.log("摘要:", s2);
  check("短消息计划完整保留", /20%/.test(s2) && /220\.08/.test(s2));

  console.log("== 用例3：多轮增量合并（旧摘要含计划+新增无计划→计划不丢）==");
  const s3 = await summarize(
    "用户持有NVDA 100股成本150。计划：跌破$220.08减仓，目标仓位20%。",
    [{ role: "user", text: "微软最近怎么样" }, { role: "assistant", text: "MSFT PE 35，回购力度大，基本面稳。" }],
  );
  console.log("摘要:", s3.slice(0, 250));
  check("增量合并后旧计划档位不丢", /220\.08|减仓/.test(s3));
  check("新增内容进摘要", /MSFT|微软/.test(s3));

  console.log(`\n结果: ${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error("测试崩溃:", e.message, "（线上是旧版时属预期——冻结解除部署后再跑）"); process.exit(1); });
