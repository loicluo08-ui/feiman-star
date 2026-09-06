#!/usr/bin/env node
// 数字锚定验证回归测试——编译真实源码再require（测试与生产同源）
// server-only导入在纯Node环境抛错：编译产物中移除该行（仅测试侧处理）
// 9/6二轮：+4技术位语境豁免案例（live验证$210-215误报后修复）
// 9/6三轮：+股息率/裸百分比语境过滤案例（live验证0.03%股息率被误抓后修复）
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

let r = verifyNumericAnchors(
  "NVDA现价$230.36，昨收$228.45，涨+0.84%。近1月低点$208.48未破。",
  [nvda],
);
check("干净答案零警告", !r.verified && r.flags.length === 0);

r = verifyNumericAnchors("NVDA当前价格$225.50，处于高位。", [nvda]);
check("价格漂移报警", r.verified && r.flags[0].includes("价格数字疑似漂移"), JSON.stringify(r.flags));
check("警告含正确注入价", r.text.includes("$230.36"));

r = verifyNumericAnchors("你的成本价$180.50，现价$230.36，盈利中。", [nvda]);
check("用户成本豁免", !r.verified, JSON.stringify(r.flags));

r = verifyNumericAnchors("较1月前$218.99上涨，3月前$205.10。", [nvda]);
check("历史锚点合法", !r.verified);

r = verifyNumericAnchors("AAPL现价$150.00，PE 30。", [nvda]);
check("未提及标的不报警", !r.verified);

r = verifyNumericAnchors("英伟达现价$225.00偏高。", [nvda]);
check("中文名称触发检测", r.verified);

r = verifyNumericAnchors("NVDA今日涨3.2%，现价$230.36。", [nvda]);
check("涨跌幅口径报警", r.flags.some((f) => f.includes("口径存疑")), JSON.stringify(r.flags));

r = verifyNumericAnchors("NVDA近1月涨28.8%，现价$230.36。", [nvda]);
check("区间涨跌不误报", !r.flags.some((f) => f.includes("口径存疑")), JSON.stringify(r.flags));

r = verifyNumericAnchors("随便什么$999。", []);
check("空注入跳过", !r.verified);

r = verifyNumericAnchors("NVDA市值$5342B，现价$230.36。", [nvda]);
check("量级外数字不误报", !r.verified, JSON.stringify(r.flags));

r = verifyNumericAnchors("建议等待回调至20日均线附近（约$210-215区间）再分批建仓。现价$230.36。", [nvda]);
check("live案例:技术位$210不误报", !r.verified, JSON.stringify(r.flags));

r = verifyNumericAnchors("若跌破$205支撑位则止损离场，当前$230.36。", [nvda]);
check("支撑位$205不误报", !r.verified);

r = verifyNumericAnchors("止盈目标$245，止损$218，现价$230.36。", [nvda]);
check("止盈止损位豁免", !r.verified);

r = verifyNumericAnchors("NVDA当前价格$225.50，处于高位。", [nvda]);
check("无语境漂移仍报警", r.verified, JSON.stringify(r.flags));

// 9/6 live三轮：股息率0.03%被误抓为涨跌幅——语境限定修复
r = verifyNumericAnchors("股息率~0.03%（基于公开信息），成长型公司。现价$230.36。", [nvda]);
check("纯股息率零误报", !r.verified, JSON.stringify(r.flags));

r = verifyNumericAnchors("维度|评分：基本面评分高。NVDA现价$230.36，评分6%。", [nvda]);
check("无涨跌语境裸百分比不比对", !r.flags.some((f) => f.includes("口径存疑")), JSON.stringify(r.flags));

r = verifyNumericAnchors("NVDA今日涨0.03%，现价$230.36。", [nvda]);
check("真涨跌幅漂移仍抓（今日涨语境）", r.flags.some((f) => f.includes("口径存疑")), JSON.stringify(r.flags));

// 9/6四轮：mock电池发现"美元"后缀式价格绕过检测——提取范围扩展修复
r = verifyNumericAnchors("英伟达现价200.00美元，处于高位。", [nvda]);
check("美元后缀式漂移仍抓（mock电池发现的缺口）", r.verified && r.flags[0].includes("价格数字疑似漂移"), JSON.stringify(r.flags));

r = verifyNumericAnchors("英伟达现价230.36美元，PE 29美元口径下偏高。", [nvda]);
check("美元后缀式白名单价不误报", !r.verified, JSON.stringify(r.flags));

r = verifyNumericAnchors("我准备投200美元买入英伟达，目标价250美元附近。", [nvda]);
check("预算/目标价美元式豁免（对称修复防误报）", !r.verified, JSON.stringify(r.flags));

r = verifyNumericAnchors("若跌破205美元支撑位则止损，现价230.36美元。", [nvda]);
check("美元式技术位+现价共存不误报", !r.verified, JSON.stringify(r.flags));

r = verifyNumericAnchors("NVDA市值5342亿美元，现价230.36美元。", [nvda]);
check("亿美元量级不进候选（亿字阻断提取）", !r.verified, JSON.stringify(r.flags));

console.log(`\n${pass}/${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
