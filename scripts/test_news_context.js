#!/usr/bin/env node
// news-context 匹配逻辑回归测试（9/6）
// 跑法：npx tsc -p scripts/nc-test.tsconfig.json && node scripts/test_news_context.js
// 与生产代码同源：lib闭包整体编译到/tmp/nc-test/out（rootDir=lib/，产物平铺）
// 验收：①有快讯数据时输出非空 ②"英伟达"命中NVDA相关快讯 ③无匹配时回退头条 ④格式含时间戳
// ⑤零关键词命中不误标"相关"（9/6 bug回归：相关性分与新鲜度boost曾混在同一分数）

const outDir = "/tmp/nc-test/out";
// require hook：把@/alias重定向到编译产物（tsc不重写输出import路径；rootDir=lib/产物平铺）
const Module = require("module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request.startsWith("@/")) {
    const rel = request.slice(2).replace(/^lib\//, "");
    request = `${outDir}/${rel}.js`;
  }
  return origResolve.call(this, request, ...args);
};
const { buildNewsContext, collectKeywords } = require(`${outDir}/news-context.js`);
const { getFlashFeed } = require(`${outDir}/flash-source.js`);

async function main() {
  let pass = 0;
  let fail = 0;
  const check = (name, cond, detail = "") => {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
  };

  console.log("== 1. flash源可用性 ==");
  const feed = await getFlashFeed();
  console.log(`  快讯条数: ${feed.items.length}, source: ${feed.source || "(空)"}`);
  check("快讯源返回数据（云端网络正常时应>0）", feed.items.length > 0);

  console.log("== 2. 相关性匹配：显式标的 ==");
  const nvdaCtx = await buildNewsContext("帮我分析下英伟达现在的仓位");
  console.log(nvdaCtx ? nvdaCtx.slice(0, 600) : "(空)");
  if (feed.items.length > 0) {
    const hasNvdaNews = feed.items.some((it) => /英伟达|nvidia/i.test(it.content_text));
    check("英伟达提问返回非空注入", nvdaCtx.length > 0);
    check("注入含【实时市场快讯】标记", nvdaCtx.includes("【实时市场快讯】"));
    check("注入含时间戳格式 [时:分]", /\[\d{2}:\d{2}/.test(nvdaCtx));
    check("注入含来源标注", /金十数据|华尔街见闻/.test(nvdaCtx));
    if (hasNvdaNews) {
      check("NVDA相关快讯被命中（首条含英伟达）", /英伟达/.test(nvdaCtx));
    }
  }

  console.log("== 3. 相关性匹配：宏观词（零命中回退） ==");
  const macroCtx = await buildNewsContext("现在美联储的利率政策对美股影响大吗");
  console.log(macroCtx ? macroCtx.slice(0, 400) : "(空)");
  check("宏观提问返回非空注入", macroCtx.length > 0);
  // 回归9/6 bug：零关键词命中时不允许被新鲜度加成顶进"与问题相关"
  const macroKws = collectKeywords("现在美联储的利率政策对美股影响大吗");
  const feedNow = (await getFlashFeed()).items;
  const anyHit = feedNow.some((it) =>
    macroKws.some((k) => it.content_text.toLocaleLowerCase().includes(k.trim().toLocaleLowerCase())));
  if (macroKws.length > 0 && !anyHit) {
    check("零关键词命中→回退头条（不误标'相关'）", macroCtx.includes("市场头条"), macroCtx.slice(0, 80));
  } else {
    check("美联储相关快讯存在时→命中注入", macroCtx.includes("与问题相关") || macroCtx.includes("市场头条"));
  }

  console.log("== 4. 无匹配回退头条 ==");
  const fallbackCtx = await buildNewsContext("什么是护城河");
  console.log(fallbackCtx ? fallbackCtx.slice(0, 400) : "(空)");
  if (feed.items.length > 0) {
    check("无关问题回退到头条（非空）", fallbackCtx.length > 0);
    check("回退时含'市场头条'标注", fallbackCtx.includes("市场头条"));
  }

  console.log("== 5. 关键词收集 ==");
  const kws1 = collectKeywords("英伟达和苹果哪个好");
  check("中文公司名→含NVDA与AAPL相关词", kws1.some(k => k.toLowerCase() === "nvda" || k.includes("英伟达")) && kws1.some(k => k.toLowerCase() === "aapl" || k.includes("苹果")), JSON.stringify(kws1));
  const kws2 = collectKeywords("NVDA财报后怎么看");
  check("代码提问→含NVDA", kws2.some(k => k.toLowerCase() === "nvda"), JSON.stringify(kws2));
  const kws3 = collectKeywords("降息周期怎么配置");
  check("宏观提问→含降息", kws3.includes("降息"), JSON.stringify(kws3));

  console.log(`\n结果: ${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error("测试崩溃:", e); process.exit(1); });
