/**
 * T2契约测试（9/13全检）——前后端事件/schema/数据形状
 * 方法：源码断言（防前后端漂移，字段改名静默失败的场景）
 */
import { readFileSync } from "fs";
let pass = 0, fail = 0;
const failures: string[] = [];
function ok(name: string, cond: boolean) {
  if (cond) { pass++; } else { fail++; failures.push(name); }
}
const route = readFileSync("app/api/invest/chat/route.ts", "utf-8");
// 前端chat页面文件定位
const glob = require("fs").readdirSync("app/invest/chat");
const pageSrc = readFileSync("app/invest/chat/page.tsx", "utf-8");

// ---- 事件契约：后端发出的事件类型 ----
const backendEvents = ["status", "chunk", "patch", "ping", "done", "error"];
for (const ev of backendEvents) {
  ok(`后端事件[${ev}]存在`, route.includes(`"${ev}"`) || route.includes(`'${ev}'`) || route.includes(`type: "${ev}"`));
}
// 前端对未知类型continue跳过（前向兼容）
ok("前端unknown事件continue", /case default|default:\s*\n?\s*continue|default:\s*\/\/\s*未知/.test(pageSrc) || pageSrc.includes("continue"));

// ---- schema契约：前端body字段 ----
// 9/13实抓主body：{messages, style, historyLedger}（图片走GLM-4V转述链不传主接口、无服务端会话ID）
const bodyFields = ["messages", "style", "historyLedger"];
for (const f of bodyFields) {
  ok(`body字段[${f}]前端存在`, pageSrc.includes(f));
}
// historyLedger链路（前端传→后端收）
ok("前端historyLedger", pageSrc.includes("historyLedger"));
ok("后端historyLedger", route.includes("historyLedger"));

// ---- 记账行剥离契约：剥离在前端（582行流式flush时strip，账本saveEntry在全量answer上做） ----
ok("前端stripLedgerLines", pageSrc.includes("stripLedgerLines"));

// ---- 档位回指契约（规则23/24前端显示） ----
ok("深度档位标记", route.includes("深度档") || route.includes("深度分析"));

console.log(`\n=== T2契约: ${pass} pass / ${fail} fail ===`);
if (failures.length) console.log("失败:", failures.join(" | "));
process.exit(fail > 0 ? 1 : 0);
