#!/usr/bin/env node
// KB自动生长执行器——每日cron跑（AgentMore create_cron_job），也可手动node触发
// 采集→生成快照条目→去重替换→写data/kb_dynamic.json→git commit
// 扩展位：后续加web_search采集（财报日历/行业事件）与对话缺口回流

import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "data", "kb_dynamic.json");
const NOCOMMIT = process.argv.includes("--nocommit");

// 腾讯行情（latin1解码足够，价格字段纯ASCII；中文乱码不影响）
const SYMBOLS = [
  { tencent: "usNVDA", name: "英伟达", kw: ["英伟达", "nvda"] },
  { tencent: "usTSLA", name: "特斯拉", kw: ["特斯拉", "tsla"] },
  { tencent: "usAAPL", name: "苹果", kw: ["苹果", "aapl"] },
  { tencent: "usMSFT", name: "微软", kw: ["微软", "msft"] },
  { tencent: "usAMD", name: "AMD", kw: ["amd", "超微"] },
  { tencent: "usMU", name: "美光", kw: ["美光", "mu"] },
];

// 9/13实测字段（cat -n行号=f[N-1]）：f[3]=现价 f[39]=PE(TTM) f[48]=52周高 f[49]=52周低
function fetchQuote(sym) {
  const res = execSync(
    `curl -s --max-time 10 "https://qt.gtimg.cn/q=${sym}"`,
    { encoding: "latin1" }
  );
  const f = res.split("~");
  if (f.length < 50 || !parseFloat(f[3])) return null;
  return {
    price: parseFloat(f[3]),
    high52: parseFloat(f[48]),
    low52: parseFloat(f[49]),
    pe: parseFloat(f[39]),
  };
}

function pct(a, b) {
  return b ? ((a - b) / b * 100).toFixed(1) : "n/a";
}

async function main() {
  const db = JSON.parse(readFileSync(DATA, "utf8"));
  const today = new Date().toISOString().slice(0, 10);
  const expire = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const kept = (db.entries || []).filter((e) => !e.expires || e.expires >= today);

  // 采集快照（同标的旧快照先移除，新的顶上）
  const fresh = [];
  for (const s of SYMBOLS) {
    try {
      const q = fetchQuote(s.tencent);
      if (!q) continue;
      const drawdown = pct(q.price, q.high52);
      const pos52 = q.high52 > q.low52 ? ((q.price - q.low52) / (q.high52 - q.low52) * 100).toFixed(1) : "n/a";
      const peStr = q.pe && q.pe > 0 ? `PE(TTM) ${q.pe.toFixed(1)}，` : "";
      fresh.push({
        id: `snapshot_${s.tencent}_${today}`,
        type: "data_snapshot",
        keywords: s.kw,
        content: `${s.name}行情快照（${today}）：现价$${q.price.toFixed(2)}，${peStr}52周高$${q.high52.toFixed(2)}/低$${q.low52.toFixed(2)}，处52周区间${pos52}%位置，距高点回撤${drawdown}%。数据来源：腾讯行情${today}。`,
        source: "kb_grow_cron",
        created: today,
        expires: expire,
      });
      console.log(`[kb_grow] ${s.name} $${q.price.toFixed(2)} pos52=${pos52}%`);
    } catch (e) {
      console.log(`[kb_grow] ${s.name} 采集失败: ${e.message}`);
    }
  }

  const freshKeys = new Set(fresh.map((f) => f.keywords.join("|")));
  const merged = kept.filter((e) => e.type !== "data_snapshot" || !freshKeys.has(e.keywords.join("|"))).concat(fresh);

  if (JSON.stringify(merged) === JSON.stringify(db.entries || [])) {
    console.log("[kb_grow] 无变化，跳过commit");
    return;
  }
  writeFileSync(DATA, JSON.stringify({ entries: merged }, null, 1));
  console.log(`[kb_grow] 写入${merged.length}条（新增${fresh.length}）`);

  if (!NOCOMMIT) {
    try {
      execSync("git add data/kb_dynamic.json && git commit -m 'chore: KB动态层每日自动采集' --quiet && git push origin main --quiet", { cwd: path.join(__dirname, ".."), stdio: "pipe" });
      console.log("[kb_grow] commit+push完成（Vercel自动重部署加载新知识）");
    } catch (e) {
      console.log("[kb_grow] commit跳过（无变更或git异常）");
    }
  }
}

main().catch((e) => { console.error("[kb_grow] FATAL", e); process.exit(1); });
