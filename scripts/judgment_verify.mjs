/**
 * 判断回验→案例库自动写入管道（9/13夜完整实现）
 *
 * 链路：data/judgments.json（前端sync端点写入）→ 到期回验（腾讯行情）→ 候选池 → 质量闸门 → 升正案例
 * 运行：node scripts/judgment_verify.mjs（AgentMore cron每日08:30）
 *
 * 质量闸门：回验结果进候选池（data/judgment_candidates.json）不直接进KB；
 * 同模式≥2次独立验证才升正。对错都写：对=可迁移模式，错=失效边界。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const JUDGMENTS = `${ROOT}data/judgments.json`;
const CANDIDATES = `${ROOT}data/judgment_candidates.json`;
const CASE_LIB = `${ROOT}lib/case-library.ts`;

function loadJSON(p, fallback) {
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : fallback;
}
function saveJSON(p, obj) {
  writeFileSync(p, JSON.stringify(obj, null, 2));
}

async function currentPrice(ticker) {
  const code = ticker.replace(/\(.*\)/, "").trim().toUpperCase();
  const res = await fetch(`https://qt.gtimg.cn/q=us${code}`);
  const raw = Buffer.from(await res.arrayBuffer()).toString("latin1");
  const price = parseFloat(raw.split("~")[3]);
  return isNaN(price) ? null : price;
}

function outcomeOf(stance, chgPct) {
  const dir = stance === "多" || stance === "看多" ? 1 : stance === "空" || stance === "看空" ? -1 : 0;
  if (dir === 0) return "中性";
  return chgPct * dir > 5 ? "对" : chgPct * dir < -5 ? "错" : "中性";
}

async function main() {
  // 0. 同步最新判断数据
  try { execSync("git pull origin main --quiet", { cwd: ROOT, stdio: "pipe" }); } catch {}
  const db = loadJSON(JUDGMENTS, { entries: [] });
  const entries = db.entries ?? [];
  if (entries.length === 0) {
    console.log("[judgment-verify] 无判断数据（管道前端→sync尚未产生数据），空跑退出");
    return;
  }

  const pool = loadJSON(CANDIDATES, { verified: [], promoted: [] });
  const verifiedTs = new Set(pool.verified.map((v) => v.ts));
  const today = new Date().toISOString().slice(0, 10);
  let checked = 0;

  for (const e of entries) {
    if (verifiedTs.has(e.ts)) continue; // 已回验跳过
    if (e.date >= today) continue; // 未到期（判断当日不验）
    // 到期≥1天即回验（MVP：单点验证；多窗口回验下次迭代）
    const price = await currentPrice(e.symbol);
    if (!price) { console.log(`  ${e.symbol}: 行情获取失败跳过`); continue; }
    const chgPct = e.keyLevel && parseFloat(e.keyLevel.replace(/[^\d.]/g, ""))
      ? +(((price - parseFloat(e.keyLevel.replace(/[^\d.]/g, ""))) / parseFloat(e.keyLevel.replace(/[^\d.]/g, ""))) * 100).toFixed(2)
      : null;
    // 回验基准=关键位（若可解析）否则跳过价格对比改用失效条件文字复核标记
    const outcome = chgPct != null ? outcomeOf(e.stance, chgPct) : "待复核";
    pool.verified.push({
      ...e, verifiedAt: today, priceNow: price, chgFromKeyLevel: chgPct, outcome,
      pattern: `${e.stance}|${(e.invalidation || "无失效条件").slice(0, 30)}`,
    });
    verifiedTs.add(e.ts);
    checked++;
    console.log(`  ${e.symbol} ${e.stance} @${e.date} → ${outcome} (现价${price})`);
    await new Promise((r) => setTimeout(r, 300)); // 行情限速
  }

  if (checked === 0) { console.log("[judgment-verify] 无新到期判断"); saveJSON(CANDIDATES, pool); return; }

  // 质量闸门：同pattern≥2次验证→升正
  const byPattern = {};
  for (const v of pool.verified) (byPattern[v.pattern] ??= []).push(v);
  const toPromote = Object.entries(byPattern).filter(([_, vs]) => vs.length >= 2 && vs.some((v) => v.outcome !== "待复核"));
  for (const [pattern, vs] of toPromote) {
    if (pool.promoted.some((p) => p.pattern === pattern)) continue;
    const wins = vs.filter((v) => v.outcome === "对").length;
    const losses = vs.filter((v) => v.outcome === "错").length;
    const lib = readFileSync(CASE_LIB, "utf-8");
    const caseEntry = `  "案例N｜系统自产·${pattern.split("|")[0]}判断模式（${today}自动回验）：样本=${vs.length}次回验，对${wins}/错${losses}/中性${vs.length - wins - losses}；最新判断「${vs[vs.length - 1].invalidation || vs[vs.length - 1].keyLevel}」。可迁移模式：${wins > losses ? "该模式下判断方向胜率过半——继续按框架执行，注意失效条件" : "该模式胜率不足——触发失效边界复核，对照模块5仓位纪律降级"}。",\n`;
    const anchor = "];";
    const sNew = lib.replace(anchor, caseEntry + anchor);
    writeFileSync(CASE_LIB, sNew);
    pool.promoted.push({ pattern, at: today, wins, losses });
    console.log(`  ↑ 升正案例: ${pattern} (对${wins}/错${losses})`);
  }

  saveJSON(CANDIDATES, pool);
  console.log(`[judgment-verify] 完成: 回验${checked}条, 候选池${pool.verified.length}, 升正${pool.promoted.length}`);
}

main().catch((e) => { console.error("[judgment-verify] 异常:", e.message); process.exit(1); });
