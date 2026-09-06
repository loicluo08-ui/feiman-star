// 期权链上下文回归测试
// 照test_numeric_anchors.js模式：直接编译lib再require同源测试（不手工复刻逻辑）
// 注意：fetchOptionContext打真实CBOE（网络依赖），buildOptionBlock纯函数部分必须全离线过

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const outDir = "/tmp/option_ctx_build";
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execSync(
  `npx tsc lib/option-context.ts --outDir ${outDir} --module commonjs --target es5 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2018,dom`,
  { stdio: "pipe" },
);
const optCtx = require(path.join(outDir, "option-context.js"));

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

console.log("== 1. 触发词路由 ==");
check("中文'期权'命中", optCtx.isOptionQuery("帮我看看期权怎么选") === true);
check("'备兑'命中", optCtx.isOptionQuery("备兑开仓增强收益") === true);
check("英文covered call命中", optCtx.isOptionQuery("covered call strategy") === true);
check("英文options命中", optCtx.isOptionQuery("what about NVDA options") === true);
check("纯股票问题不命中", optCtx.isOptionQuery("英伟达的基本面怎么样") === false);
check("短问不命中", optCtx.isOptionQuery("苹果现在什么情况") === false);
check("行权价命中", optCtx.isOptionQuery("行权价怎么选") === true);
check("IV Rank命中", optCtx.isOptionQuery("现在IV Rank多少") === true);

console.log("== 2. 纯函数注入块（mock数据，离线） ==");
const mockCtx = {
  code: "NVDA", spot: 230.36, asOf: "2026-09-06T00:28:57",
  near: {
    expiry: "261218", daysOut: 103, atmStrike: 230,
    calls: [
      { strike: 225, mid: 6.33, iv: 0.269, delta: 0.77, oi: 3809 },
      { strike: 230, mid: 2.97, iv: 0.257, delta: 0.52, oi: 20341 },
      { strike: 235, mid: 1.06, iv: 0.254, delta: 0.26, oi: 9213 },
    ],
    puts: [
      { strike: 225, mid: 3.1, iv: 0.271, delta: -0.23, oi: 4100 },
      { strike: 230, mid: 5.2, iv: 0.258, delta: -0.48, oi: 18000 },
    ],
    totalOI: 50000,
  },
  far: {
    expiry: "270116", daysOut: 132, atmStrike: 230,
    calls: [{ strike: 230, mid: 12.5, iv: 0.28, delta: 0.5, oi: 9000 }],
    puts: [{ strike: 230, mid: 13.1, iv: 0.282, delta: -0.5, oi: 8500 }],
    totalOI: 20000,
  },
  atmIvNear: 0.2575, atmIvFar: 0.281, termSlope: 0.0235, iv30d: null,
};
const block = optCtx.buildOptionBlock(mockCtx);
check("块含代码", block.includes("NVDA"));
check("块含ATM IV", block.includes("近月ATM IV"));
check("块含备兑候选", block.includes("备兑候选"));
check("块含边界声明", block.includes("IV Rank") && block.includes("禁止编造"));
check("备兑收益数字进了块", /\d+\.\d+%\/期/.test(block));
check("无中文乱码", !block.includes("undefined"));
check("期限斜率contango标注", block.includes("contango"));
// 白名单可解析性：块中所有$数字可被source-integrity式正则提取
const dollarNums = block.match(/\$\d+(\.\d+)?/g) || [];
check("块内$数字≥8个（锚定池够用）", dollarNums.length >= 8, `实际${dollarNums.length}`);

console.log("== 3. 真实CBOE拉取（网络依赖，失败不阻断） ==");
(async () => {
  try {
    const ctx = await optCtx.fetchOptionContext("NVDA");
    if (ctx) {
      check("拉取成功", true);
      check("spot>0", ctx.spot > 0, `spot=${ctx.spot}`);
      check("ATM IV在合理区间(5%-200%)", ctx.atmIvNear > 0.05 && ctx.atmIvNear < 2.0, `iv=${ctx.atmIvNear}`);
      check("近月链有call+put", ctx.near.calls.length > 0 && ctx.near.puts.length > 0);
      check("daysOut≥1", ctx.near.daysOut >= 1);
      const realBlock = optCtx.buildOptionBlock(ctx);
      check("真实块含备兑候选或call表", realBlock.includes("看涨期权"));
      console.log("  [info] 近月:", ctx.near.expiry, "days:", ctx.near.daysOut, "ATM IV:", (ctx.atmIvNear * 100).toFixed(1) + "%", ctx.iv30d != null ? "IV30d: " + (ctx.iv30d * 100).toFixed(1) + "%" : "");
    } else {
      console.log("  [warn] CBOE网络拉取返回null（跳过网络断言）");
      check("拉取失败时静默null", true);
    }
  } catch (e) {
    console.log("  [warn] 网络异常，跳过:", e.message);
  }

  // 缓存验证：第二次调用应命中缓存（速度差异或直接验证同对象）
  const ctx2 = await optCtx.fetchOptionContext("NVDA");
  check("缓存命中（同对象引用）", ctx2 === (await optCtx.fetchOptionContext("NVDA")));

  // 不存在的symbol
  const bad = await optCtx.fetchOptionContext("ZZZZZZ");
  check("不存在symbol静默null", bad === null);

  console.log(pass + "/" + (pass + fail));
  process.exit(fail > 0 ? 1 : 0);
})();
