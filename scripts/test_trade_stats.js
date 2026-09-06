#!/usr/bin/env node
// 交易统计FIFO回归测试（9/6红队修复验证）
// 编译lib/trade-stats.ts直接require——测试与生产同源
// 覆盖：D报告case2交错笔/卖超/日期乱序/无日期/日历卖先于买/AAPL-PL误匹配回归
const { execSync } = require("child_process");
const path = require("path");

const outDir = "/tmp/ts-test";
execSync(
  `npx tsc ${path.join(__dirname, "../lib/trade-stats.ts")} --outDir ${outDir} --module commonjs --target es2019 --skipLibCheck`,
  { stdio: "pipe" },
);
const { parseTrades, calculateTradeStats, calculateTradeStatsFromEntries } = require(`${outDir}/trade-stats.js`);

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else { fail++; console.log(`  \u2717 ${name}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`); }
}
function round(x) { return Math.round(x * 100) / 100; }

// 注：本地解析器要求"日期 买入 代码"带空格分隔（无空格自由格式走AI解析路径，属原有设计）

console.log("[案例1] D报告case2交错笔：+2500，余50@110");
const s1 = calculateTradeStats("9月1日 买入 NVDA 100股 价格100\n9月2日 买入 NVDA 100股 价格110\n9月3日 卖出 NVDA 150股 价格120");
check("总盈亏", round(s1.totalPnl), 2500);
check("已平仓笔数", s1.totalTrades, 1);
check("剩余持仓", s1.openLots, [{ symbol: "NVDA", quantity: 50, price: 110 }]);

console.log("[案例2] D报告case4卖超：+1000 + 异常告警（不再静默吞50股）");
const s2 = calculateTradeStats("9月1日 买入 NVDA 100股 价格230\n9月3日 卖出 NVDA 150股 价格240");
check("总盈亏(仅匹配部分)", round(s2.totalPnl), 1000);
check("异常数", s2.anomalies.length, 1);
check("异常内容", s2.anomalies[0] && { symbol: s2.anomalies[0].symbol, sold: s2.anomalies[0].soldQuantity, avail: s2.anomalies[0].availableQuantity, unmatched: s2.anomalies[0].unmatchedQuantity }, { symbol: "NVDA", sold: 150, avail: 100, unmatched: 50 });

console.log("[案例3] D报告case6日期倒挂：重排后+2000（旧行为是$0）");
const s3 = calculateTradeStats("9月5日 卖出 NVDA 100股 价格120\n9月1日 买入 NVDA 100股 价格100");
check("总盈亏", round(s3.totalPnl), 2000);
check("已平仓笔数", s3.totalTrades, 1);
check("已重排", s3.sortedByDate, true);

console.log("[案例4] 无日期：输入序处理");
const s4 = calculateTradeStats("买入 NVDA 100股 价格100\n卖出 NVDA 100股 价格110");
check("总盈亏", round(s4.totalPnl), 1000);
check("无重排", s4.sortedByDate, false);

console.log("[案例5] ISO日期卖先于买（日历序已正确）→ 卖超异常");
const s5 = calculateTradeStatsFromEntries([
  { date: "2024-07-01", symbol: "NVDA", side: "sell", quantity: 100, price: 120 },
  { date: "2024-07-15", symbol: "NVDA", side: "buy", quantity: 100, price: 100 },
]);
check("无需重排(输入已日历序)", s5.sortedByDate, false);
check("卖超异常", s5.anomalies.length, 1);
check("买入仍持仓", s5.openLots, [{ symbol: "NVDA", quantity: 100, price: 100 }]);

console.log("[案例6] 混合无日期条目：前向填充继承邻条日期");
const s6 = calculateTradeStatsFromEntries([
  { date: "9月1日", symbol: "NVDA", side: "buy", quantity: 100, price: 100 },
  { date: "9月2日", symbol: "NVDA", side: "buy", quantity: 100, price: 100 },
  { symbol: "NVDA", side: "sell", quantity: 100, price: 110 },
  { date: "9月1日", symbol: "AAPL", side: "buy", quantity: 10, price: 200 },
]);
check("卖单已处理(NVDA平仓)", round(s6.totalPnl), 1000);
check("AAPL持仓在", s6.openLots.some((lot) => lot.symbol === "AAPL"), true);

console.log("[案例7] 跨代码FIFO独立");
const s7 = calculateTradeStats("9月1日 买入 NVDA 100股 价格100\n9月1日 买入 AAPL 10股 价格200\n9月2日 卖出 NVDA 100股 价格110");
check("总盈亏", round(s7.totalPnl), 1000);
check("剩余", s7.openLots, [{ symbol: "AAPL", quantity: 10, price: 200 }]);

console.log("[案例8] 解析器：价格精度保留");
const s8 = calculateTradeStats("买入 NVDA 100股 价格230.5678\n卖出 NVDA 100股 价格240.5678");
check("总盈亏", round(s8.totalPnl), 1000);

console.log("[案例9] AAPL误匹配P/L回归（9/6抓出的原有bug）");
const s9 = calculateTradeStats("买入 AAPL 10股 价格200\n卖出 AAPL 10股 价格210");
check("总盈亏", round(s9.totalPnl), 100);
check("无explicit污染", calculateTradeStats("AAPL 10股 AAPL 20股").totalPnl, 0);

console.log(`\n${fail === 0 ? "\u2705 全部通过" : "\u274c 有失败"}（${pass}/${pass + fail}）`);
process.exit(fail === 0 ? 0 : 1);
