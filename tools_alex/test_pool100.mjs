// 端到端扩池验证：七源真实拉取→FlashItem映射→qualityOk→dedup→三板100
// 模拟lib/flash-source.ts的聚合逻辑（映射层简化为最小字段）
import { createHash } from "crypto";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const H = { "User-Agent": UA };
const stripHtml = (s) => s.replace(/<[^>]*>/g, "").trim();

// ── 复刻flash-filter核心（isLowQuality/isEnglishDominant/normalizeForDedup/dedup）──
const isLowQuality = (c) => !c || c.length < 8 || /扫码|加微信|进群|限时|优惠|点击链接/.test(c) || /笔者认为|我们认为|小编觉得/.test(c);
const isEnglishDominant = (t) => {
  if (!t || t.length < 10) return false;
  const chinese = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const letters = (t.match(/[a-zA-Z]/g) || []).length;
  return chinese / t.length < 0.15 && letters >= 30;
};
const normalize = (content) => {
  let t = content.replace(/【[^】]*】/g, "");
  t = t.replace(/金十数据\d{1,2}月\d{1,2}日讯[，,]?/g, "");
  t = t.replace(/[A-Za-z]+/g, "");
  return t.replace(/[^0-9\u4e00-\u9fff]/g, "");
};
function dedupFlashItems(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = normalize(it.content_text || it.content).slice(0, 60);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out.sort((a, b) => b.timestamp - a.timestamp); // 按时间降序（与线上行为对齐：最新在前）
}
const qualityOk = (i) => !isLowQuality(i.content) && !isEnglishDominant(i.content_text);

// ── 七源真实拉取（模拟guarded：单源失败不计全局）──
const t0 = Date.now();
const results = {};
const guarded = async (name, fn) => {
  try { results[name] = await fn(); } catch (e) { results[name] = []; console.log(`  [${name}] 拉取失败: ${e.message}`); }
};
await Promise.all([
  guarded("金十", async () => {
    const r = await fetch("https://www.jin10.com/flash_newest.js", { headers: H, signal: AbortSignal.timeout(5000) });
    const m = (await r.text()).match(/var newest = (.+);/);
    return JSON.parse(m[1]).map(it => {
      const c = stripHtml(it.data.content || ""), t = stripHtml(it.data.title || "");
      const ts = Math.floor(new Date(it.time + " UTC+8").getTime() / 1000);
      return { id: `jin10_${it.id}`, title: t, content: c, content_text: t ? (c.startsWith(t) ? c : `${t}\n${c}`) : c, timestamp: ts };
    });
  }),
  guarded("见闻", async () => {
    const r = await fetch("https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=global-channel&limit=100", { headers: H, signal: AbortSignal.timeout(5000) });
    const d = (await r.json()).data?.items || [];
    return d.map(it => {
      const c = stripHtml(it.content || ""), t = it.title || "";
      return { id: `wscn_${it.id}`, title: t, content: c, content_text: t ? `${t}\n${c}` : c, timestamp: it.display_time };
    });
  }),
  guarded("东财", async () => {
    const r = await fetch(`https://np-listapi.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=100&req_trace=${Date.now()}`, { headers: { ...H, Referer: "https://kuaixun.eastmoney.com/" }, signal: AbortSignal.timeout(5000) });
    const d = (await r.json()).data?.fastNewsList || [];
    return d.map(it => {
      const c = stripHtml(it.title || "");
      return { id: `em_${it.code}`, title: "", content: c, content_text: c, timestamp: Number(it.showTime) || Math.floor(Date.parse(it.showDateTime || "1970") / 1000) };
    });
  }),
  guarded("新浪", async () => {
    const r = await fetch(`https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=100&zhibo_id=152&_=${Date.now()}`, { headers: H, signal: AbortSignal.timeout(5000) });
    const d = (await r.json()).result?.data?.feed?.list || [];
    return d.map(it => {
      const c = stripHtml(it.rich_text || "");
      return { id: `sina_${it.id}`, title: "", content: c, content_text: c, timestamp: Math.floor(Number(it.create_time) / 1000) };
    });
  }),
  guarded("同花顺", async () => {
    const r = await fetch("https://news.10jqka.com.cn/tapp/news/push/stock/?page=1&pagesize=100&track=website&tag=", { headers: { ...H, Referer: "https://news.10jqka.com.cn/" }, signal: AbortSignal.timeout(5000) });
    const d = (await r.json()).data?.list || [];
    return d.map(it => {
      const t = (it.title || "").trim(), c = (it.digest || "").trim();
      return { id: `ths_${it.id}`, title: t, content: c || t, content_text: t ? (c.startsWith(t) ? c : `${t}\n${c}`) : c, timestamp: Number(it.ctime) };
    });
  }),
  guarded("财联社", async () => {
    const params = "app=CailianpressWeb&category=&last_time=&os=web&refresh_type=1&rn=50&sv=7.7.5";
    const sign = createHash("md5").update(createHash("sha1").update(params).digest("hex")).digest("hex");
    const r = await fetch(`https://www.cls.cn/v1/roll/get_roll_list?${params}&sign=${sign}`, { headers: { ...H, Referer: "https://www.cls.cn/telegraph" }, signal: AbortSignal.timeout(5000) });
    const d = (await r.json()).data?.roll_data || [];
    return d.flatMap(it => {
      if (it.ad && ((it.ad.id ?? 0) !== 0 || !!it.ad.url)) return [];
      const text = stripHtml(it.content || it.title || it.brief || "");
      if (text.length < 8) return [];
      return [{ id: `cls_${it.id}`, title: "", content: text, content_text: text, timestamp: it.ctime }];
    });
  }),
  guarded("AIHOT", async () => {
    const r = await fetch("https://aihot.news/api/v1/items?window=24h&limit=100", { headers: { ...H, Accept: "application/json" }, signal: AbortSignal.timeout(6000) });
    const d = (await r.json()).items || [];
    return d.flatMap(item => {
      const t = (item.title || "").trim(), s = (item.summary || "").trim();
      if (!t || !item.publishedAt) return [];
      const ts = Math.floor(Date.parse(item.publishedAt) / 1000);
      if (!Number.isFinite(ts) || ts <= 0) return [];
      const cat = item.category === "paper" ? "【论文】" : item.category === "opinion" ? "【观点】" : "";
      return [{ id: `aihot_${item.id}`, title: t, content: `${cat}${s || t}`, content_text: `${t}\n${cat}${s || t}`, timestamp: ts }];
    });
  }),
]);
const elapsed = Date.now() - t0;

// ── 聚合三板 ──
const jin10 = dedupFlashItems(results["金十"].filter(qualityOk)).slice(0, 100);
const others = dedupFlashItems([...results["见闻"], ...results["东财"], ...results["新浪"], ...results["同花顺"], ...results["财联社"]].filter(qualityOk)).slice(0, 100);
const ai = dedupFlashItems(results["AIHOT"].filter(qualityOk)).slice(0, 100);
const mixed = dedupFlashItems([...jin10, ...others, ...ai]).slice(0, 100);

console.log("\n━━ 七源原始拉取量（扩池后）━━");
for (const [k, v] of Object.entries(results)) console.log(`  ${k}: ${v.length} 条`);
console.log(`\n━━ 三板聚合 ━━`);
console.log(`金十专板: ${jin10.length}/100`);
console.log(`全市场板: ${others.length}/100（五源合计 ${results["见闻"].length + results["东财"].length + results["新浪"].length + results["同花顺"].length + results["财联社"].length} 原始）`);
console.log(`AI动态板: ${ai.length}/100（24h精选全量）`);
console.log(`兼容混流: ${mixed.length}/100`);
console.log(`\n总耗时: ${elapsed}ms（七路并发，线上Promise.all同构）`);
console.log(`最新一条: ${new Date(Math.max(...mixed.map(i => i.timestamp)) * 1000).toLocaleString("zh-CN")}`);
console.log(`\n抽检-金十[0]: ${jin10[0]?.content_text.slice(0, 50)}`);
console.log(`抽检-全市场[0]: ${others[0]?.content_text.slice(0, 50)}`);
console.log(`抽检-AI[0]: ${ai[0]?.content_text.slice(0, 50)}`);
