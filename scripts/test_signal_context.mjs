// 信号交叉引擎单测（9/12深度优化）：编译TS→跑断言。运行：node scripts/test_signal_context.mjs
import { execSync } from "node:child_process"; import { tmpdir } from "node:os"; import { join } from "node:path";
execSync(`npx tsc lib/signal-context.ts --outDir ${join(tmpdir(), "sig_test")} --module esnext --target es2020 --moduleResolution node --skipLibCheck`, { cwd: new URL("..", import.meta.url).pathname, stdio: "pipe" });
let pass = 0, fail = 0;
const check = (name, cond, detail="") => { if (cond) { pass++; console.log(`[PASS] ${name}`); } else { fail++; console.log(`[FAIL] ${name} ${detail}`); } };

// 1. 位置分位
check("位置分位计算", positionPercentile(218.29, 230.36, 86.62) === 92, `got ${positionPercentile(218.29, 230.36, 86.62)}`);
check("位置分位边界0", positionPercentile(86.62, 230.36, 86.62) === 0);
check("位置分位异常区间null", positionPercentile(100, 90, 95) === null);

// 2. 量能倍数
check("量能倍数", volumeRatio(40000000, 35000000) === 1.14, `got ${volumeRatio(40000000, 35000000)}`);
check("量能除零null", volumeRatio(100, 0) === null);
check("量能缺输入null", volumeRatio(null, 35000000) === null);

// 3. 象限定位
check("高位放量加速", quadrant(85, 1.5, true)?.includes("拥挤") === true);
check("高位缩量背离", quadrant(88, 0.6, true)?.includes("背离") === true);
check("低位放量反转", quadrant(15, 1.6, true)?.includes("吸筹") === true);
check("低位缩量阴跌", quadrant(12, 0.6, false)?.includes("磨底") === true);
check("中位不强判null", quadrant(50, 1.0, true) === null);
check("缺动量null", quadrant(85, 1.5, null) === null);
check("高位加速常量不强判（宁缺毋滥设计锁定）", quadrant(85, 1.1, true) === null);

// 4. computeSignals全链路
const full = computeSignals({
  code: "NVDA", name: "英伟达", price: 218.29, changePct: 2.1, volume: 50000000,
  history: { oneMonthAgo: 205, threeMonthsAgo: 180, monthHigh: 225, monthLow: 195, fiftyTwoWeekHigh: 230.36, fiftyTwoWeekLow: 86.62, ytdStart: 110, avgVolume20: 35000000, ma20: 212, ma50: 205, ma200: 180 },
});
const keys = full.map(s => s.key);
check("全链路5信号齐", ["position","trend","volume","momentum","quadrant"].every(k => keys.includes(k)), `got ${keys}`);
check("信号带推导标注", full.every(s => s.text.includes("[推导")));
check("象限信号出现", keys.includes("quadrant"), `keys=${keys}`);
const quad = full.find(s => s.key === "quadrant");
check("该组数据命中高位象限", quad && (quad.text.includes("高位") || quad.text.includes("背离")), quad?.text.slice(0,60));

// 5. null容忍
const gap = computeSignals({ code: "XXX", price: null, changePct: null, volume: null, history: null });
check("全null→data_gap", gap.length === 1 && gap[0].key === "data_gap");
const partial = computeSignals({ code: "YYY", price: 50, changePct: 1, volume: null, history: { oneMonthAgo: null, threeMonthsAgo: null, monthHigh: null, monthLow: null, fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null, ytdStart: null, avgVolume20: null, ma20: null, ma50: null, ma200: null } });
check("空history只产0信号不崩", partial.length === 0, `got ${partial.length}`);

// 6. buildSignalContext
const ctx = buildSignalContext([ { code: "NVDA", price: 218.29, changePct: 2.1, volume: 45000000, history: { oneMonthAgo: 205, threeMonthsAgo: 180, monthHigh: 225, monthLow: 195, fiftyTwoWeekHigh: 230.36, fiftyTwoWeekLow: 86.62, ytdStart: 110, avgVolume20: 35000000, ma20: 212, ma50: 205, ma200: 180 } } ]);
check("context含信号池标题", ctx.includes("交叉信号池"));
check("context含算式", ctx.includes("52周高"));
console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass}/${pass+fail}`);
process.exit(fail === 0 ? 0 : 1);
