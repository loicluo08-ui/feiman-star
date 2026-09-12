/**
 * T4规则栈快照（9/13全检）——38条规则编号+措辞hash，防session互顶
 * 用法：node scripts/rule_snapshot.js          → 生成/覆盖快照
 *       node scripts/rule_snapshot.js --check  → 对比快照报差异
 */
const fs = require("fs"), crypto = require("crypto");
const route = fs.readFileSync("app/api/invest/chat/route.ts", "utf-8");
const rules = [...route.matchAll(/^\s*"(\d+\w?)\. (.+?)",?\s*$/gm)].map((m) => ({
  id: m[1], hash: crypto.createHash("sha256").update(m[2]).digest("hex").slice(0, 12),
}));
const snap = { generatedAt: new Date().toISOString(), count: rules.length, rules };
if (process.argv.includes("--check")) {
  const old = JSON.parse(fs.readFileSync("tests/rule-stack.snapshot.json", "utf-8"));
  // 9/13实锤：图片规则1-7与主栈规则1-7编号撞号，Map去重会顶掉先出现者→假变更
  // 改数组逐位对比：位次+id+hash三元对齐
  const diffs = [];
  const maxLen = Math.max(rules.length, old.rules.length);
  for (let i = 0; i < maxLen; i++) {
    const n = rules[i], o = old.rules[i];
    if (!n) diffs.push(`位${i}: 快照有[${o.id}]现无(被顶掉!)`);
    else if (!o) diffs.push(`位${i}: 新增[${n.id}]`);
    else if (n.id !== o.id) diffs.push(`位${i}: 规则错位 快照[${o.id}]→现[${n.id}]`);
    else if (n.hash !== o.hash) diffs.push(`位${i}: [${n.id}]措辞变更`);
  }
  console.log(`规则数: ${old.count} → ${rules.length}`);
  if (diffs.length) diffs.forEach((d) => console.log("  " + d));
  else console.log("快照一致✓");
} else {
  fs.writeFileSync("tests/rule-stack.snapshot.json", JSON.stringify(snap, null, 2));
  console.log(`快照已存: ${rules.length}条规则`);
}
