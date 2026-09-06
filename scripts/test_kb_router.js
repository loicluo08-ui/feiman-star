// KB选择性注入路由回归测试
// 照test_flash_dedup.js模式：直接编译lib再require同源测试（不手工复刻逻辑）

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// 编译单文件到临时目录（es5 target与next build一致）
const outDir = "/tmp/kb_router_build";
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execSync(
  `npx tsc lib/kb-router.ts lib/feimanstar-kb.ts --outDir ${outDir} --module commonjs --target es5 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: "pipe" },
);
const kbRouter = require(path.join(outDir, "kb-router.js"));

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${detail}`);
  }
}

console.log("== 1. 切分完整性 ==");
const { FEIMANSTAR_KB } = require(path.join(outDir, "feimanstar-kb.js"));
const full = kbRouter.selectKBForQuestion("", []);
check("空输入→全量兜底", full.fullFallback === true);
check("全量=原文", full.kb === FEIMANSTAR_KB, `len ${full.kb.length} vs ${FEIMANSTAR_KB.length}`);
const r = kbRouter.selectKBForQuestion("英伟达现在什么情况", []);
check("非空正常路由", r.fullFallback === false);

console.log("== 2. 路由命中 ==");
const cases = [
  ["英伟达现在什么情况", 1, "股票→行业估值(1)"],
  ["英伟达现在什么情况", 2, "股票→财务指标(2)"],
  ["苹果的PE高吗", 2, "指标词→模块2"],
  ["帮我看看这个跨式组合", 8, "跨式→期权框架(8)"],
  ["帮我看看这个跨式组合", 10, "期权→仓位实战(10)"],
  ["我总是追涨杀跌怎么办", 6, "行为词→偏差(6)"],
  ["用芒格的框架分析一下", 11, "大师词→思维框架(11)"],
  ["半导体行业估值现在贵吗", 1, "行业词→模块1"],
];
cases.forEach(function (c) {
  const sel = kbRouter.selectKBForQuestion(c[0], []);
  check(`${c[2]}`, sel.includedModules.indexOf(c[1]) >= 0, `实际:${sel.includedModules.join(",")}`);
});

console.log("== 3. 追问场景（历史参与路由） ==");
const followUp = kbRouter.selectKBForQuestion("那期权呢", ["帮我看看特斯拉的持仓", "现价多少"]);
check("追问'那期权呢'→期权模块", followUp.includedModules.indexOf(8) >= 0, `实际:${followUp.includedModules.join(",")}`);

console.log("== 4. 核心集恒定 ==");
const plain = kbRouter.selectKBForQuestion("今天天气不错", []);
[3, 4, 5, 7].forEach(function (m) {
  check(`核心模块${m}恒注入`, plain.includedModules.indexOf(m) >= 0);
});
check("闲聊不带期权模块", plain.includedModules.indexOf(8) === -1);
check("版本记录剔除", plain.kb.indexOf("## 版本记录") === -1);

console.log("== 5. 保险丝 ==");
const weird = kbRouter.selectKBForQuestion({ toString: 1 }, []);
check("非字符串输入→兜底全量", weird.fullFallback === true);
const nullCase = kbRouter.selectKBForQuestion(null, null);
check("null输入→兜底", nullCase.fullFallback === true);

console.log("== 6. 压缩率 ==");
const stock = kbRouter.selectKBForQuestion("英伟达现在什么情况", []);
const chat = kbRouter.selectKBForQuestion("今天大盘怎么样", []);
const option = kbRouter.selectKBForQuestion("这个跨式组合怎么对冲Delta", []);
const pct = function (r) { return Math.round((r.selectedChars / r.totalChars) * 100); };
console.log(`  股票问题:${pct(stock)}%  大盘闲聊:${pct(chat)}%  期权:${pct(option)}%`);
check("股票问题砍≥50%", pct(stock) <= 50, `实际${pct(stock)}%`);
check("闲聊砍≥70%", pct(chat) <= 30, `实际${pct(chat)}%`);
check("期权≥40%（期权干货不硬砍）", pct(option) >= 40, `实际${pct(option)}%`);

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
