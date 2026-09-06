#!/usr/bin/env node
// 9/6更新：直接编译lib/flash-filter.ts再require——回归测试与生产代码永远同源（旧版手工复刻会漂移）
// 覆盖：7fa5ba9台风错位案例 + 9/6红队D发现6误杀案例（摘要吞单条/前缀吞增量/非农数字差）
const { execSync } = require("child_process");
const path = require("path");

const outDir = "/tmp/ff-test";
execSync(
  `npx tsc ${path.join(__dirname, "../lib/flash-filter.ts")} --outDir ${outDir} --module commonjs --target es2019 --skipLibCheck`,
  { stdio: "pipe" },
);
const { dedupFlashItems } = require(`${outDir}/flash-filter.js`);

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else { fail++; console.log(`  \u2717 ${name}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`); }
}

console.log("[案例1] 台风错位（7fa5ba9原始漏判案例，收紧后仍必须判重）");
const wscn = {
  content: "中央气象台：今年第24号台风科罗旺……",
  content_text: "中央气象台9月5日18时继续发布台风蓝色预警\n中央气象台：今年第24号台风科罗旺热带风暴级的中心今天05日下午5点钟位于海南文昌东偏南方向约620公里的南海东北部海面上",
  timestamp: 1788585000,
};
const jin10 = {
  content: "【中央气象台9月5日18时继续发布台风蓝色预警】金十数据9月5日讯，中央气象台9月5日18时继续发布台风蓝色预警：今年第24号台风科罗旺热带风暴级的中心今天05日下午5点钟位于海南文昌东偏南方向约620公里的南海东北部海面上",
  content_text: "【中央气象台9月5日18时继续发布台风蓝色预警】金十数据9月5日讯，中央气象台9月5日18时继续发布台风蓝色预警：今年第24号台风科罗旺热带风暴级的中心今天05日下午5点钟位于海南文昌东偏南方向约620公里的南海东北部海面上",
  timestamp: 1788584400,
};
const r1 = dedupFlashItems([wscn, jin10]);
check("去重为1条", r1.length, 1);
check("保留较新版(华尔街)", r1[0].timestamp, 1788585000);

console.log("[案例2] 反向输入顺序，结果一致");
const r2 = dedupFlashItems([jin10, wscn]);
check("去重为1条", r2.length, 1);
check("保留较新版", r2[0].timestamp, 1788585000);

console.log("[案例3] 不同预警时次（06时 vs 18时）不误杀");
const ty06 = {
  content: "中央气象台9月5日06时发布台风蓝色预警：今年第23号台风……位于台湾海峡。",
  content_text: "中央气象台9月5日06时发布台风蓝色预警：今年第23号台风……位于台湾海峡。",
  timestamp: 1788540000,
};
check("两条都保留", dedupFlashItems([ty06, jin10]).length, 2);

console.log("[案例4] 同操作不同期限（7天 vs 14天）不误杀");
const a4 = {
  content: "央行今日进行100亿元7天期逆回购",
  content_text: "央行今日进行100亿元7天期逆回购",
  timestamp: 1788580000,
};
const b4 = {
  content: "央行今日进行100亿元14天期逆回购",
  content_text: "央行今日进行100亿元14天期逆回购",
  timestamp: 1788580100,
};
check("两条都保留", dedupFlashItems([a4, b4]).length, 2);

console.log("[案例5] 完全相同 → 去重");
const a5 = { content: "完全相同的快讯内容测试。", content_text: "完全相同的快讯内容测试。", timestamp: 1788580000 };
const b5 = { content: "完全相同的快讯内容测试。", content_text: "完全相同的快讯内容测试。", timestamp: 1788580100 };
check("去重为1条", dedupFlashItems([a5, b5]).length, 1);

console.log("[案例6] 超短讯（剥壳<6字）不判重");
const shortA = { content: "美股三大指数期货齐涨。", content_text: "美股三大指数期货齐涨。", timestamp: 1788580000 };
const shortB = { content: "美股三大指数期货齐跌。", content_text: "美股三大指数期货齐跌。", timestamp: 1788580100 };
check("两条都保留", dedupFlashItems([shortA, shortB]).length, 2);

console.log("[案例7] 前缀吞增量误杀修复（D发现6样例）：短版先到，长版后到→升级替换保增量");
const short7 = {
  content: "央行今日进行1000亿元7天期逆回购",
  content_text: "央行今日进行1000亿元7天期逆回购",
  timestamp: 1788580200, // 较新（先入库）
};
const long7 = {
  content: "央行今日进行1000亿元7天期逆回购操作中标利率持平",
  content_text: "央行今日进行1000亿元7天期逆回购操作中标利率持平",
  timestamp: 1788580100, // 较旧（后到，信息更全）
};
const r7 = dedupFlashItems([short7, long7]);
check("1条（升级而非丢弃）", r7.length, 1);
check("保留含增量(利率)的长版", r7[0].content_text.includes("利率"), true);
check("时间戳取较新", r7[0].timestamp, 1788580200);

console.log("[案例8] 长版先到，短版后到→丢短版");
const r8 = dedupFlashItems([long7, short7]);
check("1条", r8.length, 1);
check("保留长版", r8[0].content_text.includes("利率"), true);

console.log("[案例9] 数字差在前14字内（非农16万 vs 21万）不误杀");
const a9 = {
  content: "美国8月非农就业人数增加16万人，不及预期，失业率上升",
  content_text: "美国8月非农就业人数增加16万人，不及预期，失业率上升",
  timestamp: 1788580000,
};
const b9 = {
  content: "美国8月非农就业人数增加21万人，超出预期，失业率下降",
  content_text: "美国8月非农就业人数增加21万人，超出预期，失业率下降",
  timestamp: 1788580100,
};
check("两条都保留", dedupFlashItems([a9, b9]).length, 2);

console.log("[案例10] 摘要条目吞单条新闻误杀修复（D发现6线上实测4对）");
const digest = {
  content: "金十数据整理：周六重要消息汇总——央行今日进行1000亿元7天期逆回购；某公司发布业绩预增公告；国际金价收涨。",
  content_text: "金十数据整理：周六重要消息汇总——央行今日进行1000亿元7天期逆回购；某公司发布业绩预增公告；国际金价收涨。",
  timestamp: 1788585000,
};
const single = {
  content: "央行今日进行1000亿元7天期逆回购",
  content_text: "央行今日进行1000亿元7天期逆回购",
  timestamp: 1788580100,
};
check("两条都保留（旧'14字被包含'条件会误杀）", dedupFlashItems([digest, single]).length, 2);

console.log("[案例11] 已知接受的漏杀（记录在案）：同事件加前缀绕过——宁重复不误杀");
const r11 = dedupFlashItems([
  { content: "央行今日进行1000亿元7天期逆回购。", content_text: "央行今日进行1000亿元7天期逆回购。", timestamp: 1788580000 },
  { content: "快讯：央行今日进行1000亿元7天期逆回购。", content_text: "快讯：央行今日进行1000亿元7天期逆回购。", timestamp: 1788580100 },
]);
check("数量(接受重复)", r11.length, 2);

console.log("[案例12] 跨条目不同新闻不互杀（7fa5ba9原案例）");
const w1 = {
  content: `9月5日，深圳。亚太媒体高端论坛上，外宾打"直球"问"买车能打折吗？"比亚迪高管回答亮了。`,
  content_text: `比亚迪高管回应外宾问买车打折\n9月5日，深圳。亚太媒体高端论坛上，外宾打"直球"问"买车能打折吗？"比亚迪高管回答亮了。`,
  timestamp: 1788580000,
};
const w2 = {
  content: "某公司发布公告称三季度业绩预增50%以上，主要受益于海外市场扩张。",
  content_text: "另一条不同新闻标题\n某公司发布公告称三季度业绩预增50%以上，主要受益于海外市场扩张。",
  timestamp: 1788580100,
};
check("两条都保留", dedupFlashItems([w1, w2]).length, 2);

console.log(`\n${fail === 0 ? "\u2705 全部通过" : "\u274c 有失败"}（${pass}/${pass + fail}）`);
process.exit(fail === 0 ? 0 : 1);
