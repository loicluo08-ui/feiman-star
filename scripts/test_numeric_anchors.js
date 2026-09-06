#!/usr/bin/env node
// 数字锚定验证回归测试——与test_flash_dedup.js同模式：编译真实源码再require（测试与生产同源）
// server-only导入在纯Node环境抛错：编译产物中移除该行（仅测试侧处理，源文件不动）
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const outDir = "/tmp/cv-test";
execSync(
  `npx tsc ${path.join(__dirname, "../lib/cross-validate.ts")} --outDir ${outDir} --module commonjs --target es2019 --skipLibCheck`,
  { stdio: "pipe" },
);
const outFile = path.join(outDir, "cross-validate.js");
let src = fs.readFileSync(outFile, "utf8");
src = src.replace(/require\(["']server-only["']\)/g, "undefined");
fs.writeFileSync(outFile, src);
const { verifyNumericAnchors } = require(outFile);

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} ${detail}`); }
}

const nvda = {
  code: "NVDA", name: "英伟达", price: 230.36, previousClose: 228.45, open: 229.0,
  high: 231.5, low: 229.63, changePct: 0.84,
  history: { oneMonthAgo: 218.99, threeMonthsAgo: 205.1, monthHigh: 228.45, monthLow: 208.48 },
};

// 1. 干净答案（所有数字来自注入白名单）→ 零警告
let r = verifyNumericAnchors(
  "NVDA现价$230.36，昨收$228.45，涨+0.84%。近1月低点$208.48未破。",
  [nvda],
);
check("干净答案零警告", !r.verified && r.flags.length === 0, JSON.stringify(r.flags));

// 2. 价格漂移（编造$225.50在±15%内但不在白名单）→ 报警
r = verifyNumericAnchors("NVDA当前价格$225.50，处于高位。", [nvda]);
check("价格漂移报警", r.verified && r.flags[0].includes("价格数字疑似漂移"), JSON.stringify(r.flags));
check("警告含正确注入价", r.text.includes("$230.36"));

// 3. 用户成本价豁免（"成本$180.50"不报警）
r = verifyNumericAnchors("你的成本$180.50，NVDA现价$230.36，盈利。", [nvda]);
check("用户成本豁免", !r.verified, JSON.stringify(r.flags));

// 4. 历史锚点合法（1月前$218.99命中白名单）
r = verifyNumericAnchors("较1月前$218.99上涨，3月前$205.10。", [nvda]);
check("历史锚点合法", !r.verified, JSON.stringify(r.flags));

// 5. 未提及标的（答AAPL但注入NVDA）→ 跳过
r = verifyNumericAnchors("AAPL现价$150.00，PE 30。", [nvda]);
check("未提及标的不报警", !r.verified);

// 6. 中文提及（"英伟达"）
r = verifyNumericAnchors("英伟达现价$225.00偏高。", [nvda]);
check("中文名称触发检测", r.verified);

// 7. 涨跌幅口径存疑（写+3.2%但注入+0.84%）
r = verifyNumericAnchors("NVDA今日涨3.2%，现价$230.36。", [nvda]);
check("涨跌幅口径报警", r.flags.some((f) => f.includes("口径存疑")), JSON.stringify(r.flags));

// 8. 区间涨跌（+28.8%与当日差>5 → 不报）
r = verifyNumericAnchors("NVDA近1月涨28.8%，现价$230.36。", [nvda]);
check("区间涨跌不误报", !r.flags.some((f) => f.includes("口径存疑")), JSON.stringify(r.flags));

// 9. 空注入 → 不验证
r = verifyNumericAnchors("随便什么$999。", []);
check("空注入跳过", !r.verified);

// 10. 量级外数字（市值$5342B不在±15%价格区间）→ 不报
r = verifyNumericAnchors("NVDA市值$5342B，现价$230.36。", [nvda]);
check("量级外数字不误报", !r.verified, JSON.stringify(r.flags));

console.log(`\n${pass}/${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
