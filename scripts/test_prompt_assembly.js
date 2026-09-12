#!/usr/bin/env node
/**
 * prompt装配回归测试（9/6质量优化专项）
 *
 * 防护目标——今天真实发生过的两类事故：
 * 1. 多会话规则编号撞车：f677962的"规则19失效预注册"与chat-synthesis"规则19镜头池扩展"同号
 *    （各session只看见自己的编号空间，合并时无人对总表）→ 本测试对全部规则编号做全局唯一性断言
 * 2. 绝对化用语漏进prompt本体：教模型清除绝对化用语的规则文本，自己先违规
 *
 * 另外覆盖：import链完整性（增量文件完整性教训）、风格库键值对齐、
 * 金样例占位符纪律（防数字污染数字锚定校验）、prompt栈体积监控
 *
 * 运行：node scripts/test_prompt_assembly.js（零依赖，纯文本断言）
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const files = {
  route: "app/api/invest/chat/route.ts",
  skills: "lib/chat-skills.ts",
  styles: "lib/chat-styles.ts",
  deliberation: "lib/chat-deliberation.ts",
  synthesis: "lib/chat-synthesis.ts",
  actionPlan: "lib/chat-action-plan.ts",
  planLifecycle: "lib/chat-plan-lifecycle.ts",
  quality: "lib/chat-quality.ts",
  crossValidate: "lib/cross-validate.ts",
};

let failures = 0;
const check = (name, ok, detail = "") => {
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${detail && !ok ? " — " + detail : ""}`);
  if (!ok) failures++;
};

// ---------- 1. import链完整性（route必须真实使用全部prompt模块） ----------
const routeSrc = read(files.route);
const wiring = [
  ["DELIBERATION_BLOCK", "chat-deliberation"],
  ["DELIBERATION_ENHANCEMENT", "chat-synthesis"],
  ["ACTION_PLAN_BLOCK", "chat-action-plan"],
  ["PLAN_LIFECYCLE_BLOCK", "chat-plan-lifecycle"],
  ["CHAT_QUALITY_BLOCK", "chat-quality"],
  ["BASE_SKILLS", "chat-skills"],
  ["getStylePrompt", "chat-styles"],
  ["verifyNumbers", "number-verify"],
];
for (const [symbol, file] of wiring) {
  const imported = new RegExp(`import\\s*\\{[^}]*${symbol}[^}]*\\}\\s*from\\s*"[^"]*${file}"`).test(routeSrc);
  // import了且在函数体内被引用（出现次数>import行那1次）
  const used = routeSrc.split(symbol).length - 1 > 1;
  check(`import链: ${symbol} (${file})`, imported && used, imported ? "已import但未被使用" : "import缺失");
}

// ---------- 2. 规则编号全局唯一性（防多会话撞号） ----------
// 抽取形如  "7. "  "0a. "  "25. " 的字符串字面量开头编号
const ruleNumRe = /^\s*"(\d{1,2})([a-z]?)\./gm;
const ruleOwners = {};
const ruleFiles = [files.route, files.deliberation, files.synthesis, files.actionPlan, files.planLifecycle];
for (const f of ruleFiles) {
  const src = read(f);
  let m;
  while ((m = ruleNumRe.exec(src)) !== null) {
    const key = m[1] + m[2];
    if (ruleOwners[key] && ruleOwners[key] !== f) {
      check(`规则编号唯一: ${key}`, false, `同时在 ${ruleOwners[key]} 与 ${f}`);
    } else {
      ruleOwners[key] = f;
    }
  }
}
const ruleList = Object.keys(ruleOwners).sort((a, b) => parseInt(a) - parseInt(b));
check(`规则编号唯一性（共${ruleList.length}条: ${ruleList.join(",")}）`, true);
// 编号连续性软检查：数字主序列不应跳号（0a-0i,1-14,15-18,19-21,22,23-24,25）
const mainSeq = ruleList.filter((k) => /^\d+$/.test(k)).map(Number);
const expected = [];
for (let i = 1; i <= Math.max(...mainSeq); i++) expected.push(String(i));
const missing = expected.filter((e) => !mainSeq.includes(Number(e)));
check(
  `规则主序列无跳号（1-${Math.max(...mainSeq)}）`,
  missing.length === 0,
  `缺号: ${missing.join(",")}`,
);

// ---------- 3. S/R/D系列编号唯一性 ----------
const seriesRe = /\b([SDR])(\d{1,2})\./g;
const seriesSeen = {};
for (const f of [files.skills, files.quality]) {
  const src = read(f);
  let m;
  while ((m = seriesRe.exec(src)) !== null) {
    const key = m[1] + m[2];
    if (seriesSeen[key] && seriesSeen[key] !== f) {
      check(`系列编号唯一: ${key}`, false, `同时在 ${seriesSeen[key]} 与 ${f}`);
    } else {
      seriesSeen[key] = f;
    }
  }
}
check(`S/R/D系列编号唯一（${Object.keys(seriesSeen).length}条）`, true);

// ---------- 4. 绝对化用语扫描（prompt本体不能教自己违规） ----------
const banned = ["永久", "全自动", "零风险", "百分之百", "趋近于0", "稳赚", "包赚", "必涨", "必跌", "保证收益", "绝对安全"];
// 放行：禁令定义行（严禁/禁止/清除…）与替换映射行（"永久"→"长期"是字典本身，不是违规）
const allowRe = /严禁|禁止|替代|清除|失败输出|不许出现|"\S+"→"/;
let bannedHits = [];
for (const f of Object.values(files)) {
  if (f === files.crossValidate) continue; // 交叉验证块含禁令定义本身，单独看
  const src = read(f);
  for (const line of src.split("\n")) {
    // 「永久(性)损失」是格雷厄姆/马克斯的风险定义术语（不是绝对化承诺），放行
    const norm = line.replace(/永久性?损失/g, "RISK_TERM");
    if (allowRe.test(line)) continue;
    for (const w of banned) {
      if (norm.includes(w)) bannedHits.push(`${path.basename(f)}: "${w}" in ${line.trim().slice(0, 50)}`);
    }
  }
}
check(`绝对化用语清零（${banned.length}个词扫描）`, bannedHits.length === 0, bannedHits.slice(0, 3).join(" | "));

// ---------- 5. 风格库键值对齐 ----------
const stylesSrc = read(files.styles);
const styleList = (stylesSrc.match(/CHAT_STYLES\s*=\s*\[([^\]]+)\]/)?.[1] ?? "")
  .split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
const recordKeys = [...stylesSrc.matchAll(/^\s{2}(\w+):\s*\[/gm)].map((m) => m[1]);
const missingPrompt = styleList.filter((s) => !recordKeys.includes(s));
check(
  `风格库对齐（${styleList.length}风格全有prompt）`,
  missingPrompt.length === 0,
  `缺prompt: ${missingPrompt.join(",")}`,
);

// ---------- 6. blend旗舰结构完整性（dad验收的形态） ----------
const blendSrc = stylesSrc;
const blendMarkers = ["【分析思路】", "**核心判断**", "【裁决】", "失效预注册", "信心度", "会诊=", "死亡风险前置"];
const blendMissing = blendMarkers.filter((mk) => !blendSrc.includes(mk));
check(`blend旗舰结构标记（${blendMarkers.length}项）`, blendMissing.length === 0, `缺: ${blendMissing.join(",")}`);

// ---------- 7. 金样例占位符纪律（防数字污染数字锚定校验） ----------
// 危险=市场数据特征数字（小数/三位数/货币符号）被模型抄进答案→verifyNumericAnchors假核对。
// 结构性计数（2追问/3档）与占位符内部数字无害：先剔除〈…〉span再查
const sampleLines = [...blendSrc.matchAll(/"(【[^"]*)"/g)].map((m) => m[1]);
const marketNumRe = /\d+\.\d+|\d{3,}|[$¥€]\s*\d/;
const polluted = sampleLines.filter((l) => {
  const cleaned = l
    .replace(/〈[^〉]*〉/g, "") // 占位符span整体剔除（内部数字是形态演示）
    .replace(/规则\d+[a-z]?|模块\d+|[①-⑦]/g, "");
  return marketNumRe.test(cleaned);
});
check(`金样例无市场数字污染`, polluted.length === 0, polluted.slice(0, 2).join(" | "));

// ---------- 7.5 对抗结构（9/12罗竹判空修复：三视角同向=橡皮图章会诊） ----------
check(`blend视角选取含强制对立（质疑者硬约束）`, stylesSrc.includes("强制对立") && stylesSrc.includes("质疑者"));
check(`blend交叉检验含强制交锋+失败回退`, stylesSrc.includes("强制交锋") && stylesSrc.includes("重选"));
check(`规则26会诊对抗纪律已挂载`, routeSrc.includes("26. 会诊对抗纪律"));
check(`对抗含交锋词汇结构（驳倒/幸存）`, stylesSrc.includes("驳倒") || stylesSrc.includes("幸存"));

// ---------- 7.6 信号交叉引擎（9/12深度优化：材料层质变） ----------
const routeSrcAll = routeSrc + read("lib/signal-context.ts");
check(`信号引擎已挂载route（深度档注入）`, routeSrc.includes("buildSignalContext") && routeSrc.includes("stockSignalData"));
check(`深度生成纪律四条（关键变量/信号引用/裁决表态/非对称）`, routeSrc.includes("关键变量识别") && routeSrc.includes("裁决表必须给出明确档位") && routeSrc.includes("不垫对冲基调"));
check(`信号引擎宁缺毋滥设计`, read("lib/signal-context.ts").includes("宁可不给，不硬编故事"));

// ---------- 8. prompt栈体积监控（token预算警报） ----------
const sizes = {};
for (const [k, f] of Object.entries(files)) {
  if (k === "route" || k === "crossValidate") continue;
  const src = read(f);
  // 粗估：只统计字符串字面量内容（数组项+模板串）
  const strs = [...src.matchAll(/"([^"]{20,})"/g)].map((m) => m[1]).join("");
  const tpl = [...src.matchAll(/`([^`]{20,})`/g)].map((m) => m[1]).join("");
  sizes[k] = (strs.length + tpl.length) * (k === "styles" ? 0.35 : 1); // styles只算blend单风格
}
const totalChars = Object.values(sizes).reduce((a, b) => a + b, 0);
const routeRuleChars = (routeSrc.match(/^\s*"(?:\d|[0a-z])[^\n]{30,}/gm) ?? []).join("").length;
const estTokens = Math.ceil((totalChars + routeRuleChars) * 0.75);
console.log(`\n[INFO] prompt栈体积: 常驻块${Math.round(totalChars)}字 + route规则${routeRuleChars}字 ≈ ${estTokens}tokens（含KB与注入前）`);
check(`prompt栈体积<15000tokens（防挤占40K预算）`, estTokens < 15000, `当前${estTokens}`);

console.log(`\n${failures === 0 ? "✅ 全部通过" : `❌ ${failures}项失败`}`);
process.exit(failures === 0 ? 0 : 1);
