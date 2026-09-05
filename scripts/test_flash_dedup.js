#!/usr/bin/env node
// 验证flash去重新逻辑：复刻route.ts的normalizeForDedup+判重，跑真实漏判案例+边界case
function normalizeForDedup(content) {
  let t = content.replace(/【[^】]*】/g, "");
  t = t.replace(/金十数据\d{1,2}月\d{1,2}日讯[，,]?/g, "");
  t = t.replace(/[A-Za-z]+/g, "");
  t = t.replace(/[^0-9\u4e00-\u9fff]/g, "");
  return t;
}
function oldDedup(t, prev) {
  if (prev === t) return true;
  if (prev.startsWith(t) || t.startsWith(prev)) return Math.min(prev.length, t.length) >= 12;
  return prev.slice(0, 30) === t.slice(0, 30);
}
function newDedup(t, prev) {
  if (prev === t) return true;
  if (prev.startsWith(t) || t.startsWith(prev)) return Math.min(prev.length, t.length) >= 12;
  if (t.length >= 14 && prev.includes(t.slice(0, 14))) return true;
  return prev.slice(0, 30) === t.slice(0, 30);
}
// 模拟完整去重循环（时间降序）
function runDedup(items, judge) {
  const normTexts = [];
  const kept = [];
  for (const item of items.sort((a, b) => b.timestamp - a.timestamp)) {
    const t = normalizeForDedup(item.content_text);
    const isDup = t.length >= 6 && normTexts.some((prev) => judge(t, prev));
    if (isDup) continue;
    normTexts.push(t);
    kept.push(item);
  }
  return kept;
}

// ── 案例1：今天真实漏判（9/5台风蓝色预警，华尔街#5 vs 金十#11）──
const wscnTyphoon = {
  title: "中央气象台9月5日18时继续发布台风蓝色预警",
  content: "中央气象台：今年第24号台风“科罗旺”（热带风暴级）的中心今天（05日）下午5点钟位于海南文昌东偏南方向约620公里的南海东北部海面上，中心附近最大风力有8级（18米/秒）。",
  content_text: "中央气象台9月5日18时继续发布台风蓝色预警\n中央气象台：今年第24号台风“科罗旺”（热带风暴级）的中心今天（05日）下午5点钟位于海南文昌东偏南方向约620公里的南海东北部海面上，中心附近最大风力有8级（18米/秒）。",
  timestamp: 1788585000,
};
const jin10Typhoon = {
  title: "",
  content: "【中央气象台9月5日18时继续发布台风蓝色预警】金十数据9月5日讯，中央气象台9月5日18时继续发布台风蓝色预警：今年第24号台风“科罗旺”（热带风暴级）的中心今天（05日）下午5点钟位于海南文昌东偏南方向约620公里的南海东北部海面上。",
  content_text: "【中央气象台9月5日18时继续发布台风蓝色预警】金十数据9月5日讯，中央气象台9月5日18时继续发布台风蓝色预警：今年第24号台风“科罗旺”（热带风暴级）的中心今天（05日）下午5点钟位于海南文昌东偏南方向约620公里的南海东北部海面上。",
  timestamp: 1788584400,
};

let pass = 0, fail = 0;
function check(name, actual, expect) {
  const ok = actual === expect;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${name}（期望${expect ? "判重" : "保留"}，实际${actual ? "判重" : "保留"}）`);
}

console.log("[案例1] 台风预警跨源（华尔街先入/更新，金十后到/更早）");
const r1old = runDedup([wscnTyphoon, jin10Typhoon], oldDedup);
const r1new = runDedup([wscnTyphoon, jin10Typhoon], newDedup);
check("旧逻辑bug复现（保留2条=漏判）", r1old.length === 2, true);
check("新逻辑", r1new.length === 1, true);
console.log(`       保留的是: ${r1new[0] ? (r1new[0].timestamp === wscnTyphoon.timestamp ? "华尔街版（时间较新✓）" : "金十版") : "无"}`);

console.log("[案例2] 反向顺序（金十先入，华尔街后到）");
const r2 = runDedup([jin10Typhoon, wscnTyphoon], newDedup);
check("新逻辑反向也判重", r2.length === 1, true);

console.log("[案例3] 不同预警（06时 vs 18时，相似但非同事件）→ 不能误杀");
const wscnMorning = {
  title: "中央气象台9月5日06时继续发布台风蓝色预警",
  content: "中央气象台：今年第23号台风“木兰”（热带风暴级）的中心今天早晨5点钟位于南海西部海面上。",
  content_text: "中央气象台9月5日06时继续发布台风蓝色预警\n中央气象台：今年第23号台风“木兰”（热带风暴级）的中心今天早晨5点钟位于南海西部海面上。",
  timestamp: 1788570000,
};
const r3 = runDedup([wscnTyphoon, wscnMorning], newDedup);
check("两条都保留", r3.length === 2, true);

console.log("[案例4] 同模板同参数不同期限（100亿元7天期 vs 14天期逆回购）→ 不能误杀");
const repo7 = {
  title: "", content: "央行今日进行100亿元7天期逆回购操作，中标利率1.50%。", content_text: "央行今日进行100亿元7天期逆回购操作，中标利率1.50%。", timestamp: 1788580000,
};
const repo14 = {
  title: "", content: "央行今日进行100亿元14天期逆回购操作，中标利率1.65%。", content_text: "央行今日进行100亿元14天期逆回购操作，中标利率1.65%。", timestamp: 1788580100,
};
const r4 = runDedup([repo7, repo14], newDedup);
check("两条都保留", r4.length === 2, true);

console.log("[案例5] 完全相同文本 → 判重");
const dupA = { title: "", content: "黄金上破2550美元/盎司，日内涨0.8%。", content_text: "黄金上破2550美元/盎司，日内涨0.8%。", timestamp: 1788580000 };
const dupB = { title: "", content: "黄金上破2550美元/盎司，日内涨0.8%。", content_text: "黄金上破2550美元/盎司，日内涨0.8%。", timestamp: 1788580050 };
const r5 = runDedup([dupA, dupB], newDedup);
check("判重留1条", r5.length === 1, true);

console.log("[案例6] 超短讯（归一化<14字，新条件不适用，不受影响）");
const shortA = { title: "", content: "美股三大指数期货齐涨。", content_text: "美股三大指数期货齐涨。", timestamp: 1788580000 };
const shortB = { title: "", content: "美股三大指数期货齐跌。", content_text: "美股三大指数期货齐跌。", timestamp: 1788580100 };
const r6 = runDedup([shortA, shortB], newDedup);
check("两条都保留", r6.length === 2, true);

console.log("[案例7] 华尔街title=content首句的自重复结构（跨条目不互相误杀）");
const w1 = {
  title: "比亚迪高管回应外宾问买车打折",
  content: "9月5日，深圳。亚太媒体高端论坛上，外宾打“直球”问“买车能打折吗？”比亚迪高管回答亮了。",
  content_text: "比亚迪高管回应外宾问买车打折\n9月5日，深圳。亚太媒体高端论坛上，外宾打“直球”问“买车能打折吗？”比亚迪高管回答亮了。",
  timestamp: 1788580000,
};
const w2 = {
  title: "另一条不同新闻标题",
  content: "某公司发布公告称三季度业绩预增50%以上，主要受益于海外市场扩张。",
  content_text: "另一条不同新闻标题\n某公司发布公告称三季度业绩预增50%以上，主要受益于海外市场扩张。",
  timestamp: 1788580100,
};
const r7 = runDedup([w1, w2], newDedup);
check("两条都保留", r7.length === 2, true);

console.log(`\n${fail === 0 ? "✅ 全部通过" : "❌ 有失败"}（${pass}/${pass + fail}）`);
process.exit(fail === 0 ? 0 : 1);
