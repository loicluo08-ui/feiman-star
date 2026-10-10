// 快讯数据源公共模块（9/6从flash route抽出）
// 供 flash route 和 chat 实时讯息注入共用——同一serverless实例共享节流缓存
import { createHash } from "crypto";
import { isLowQuality, isEnglishDominant, dedupFlashItems } from "@/lib/flash-filter";
import { bump } from "@/lib/health-counters";

export type FlashImportance = "major" | "minor";

export interface FlashItem {
  id: string;
  title: string;
  content: string;
  content_text: string;
  time_str: string;
  timestamp: number;
  is_important: boolean;
  /** 主次标记（10/4逸翔令）：各源重要性信号统一映射，major=主要 minor=次要 */
  importance: FlashImportance;
  channels: number[];
  source: string;
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ━━━ 源级观测层（10/4架构优化：guarded统一计数，进程窗口期指标）━━━

interface SourceStat {
  ok: number;
  fail: number;
  lastOkAt: number;
  lastItems: number;
  lastError: string;
}
const sourceStats = new Map<string, SourceStat>();
const moduleLoadedAt = Date.now();

async function guarded(name: string, fn: () => Promise<FlashItem[]>, key?: string): Promise<FlashItem[]> {
  const stat = (): SourceStat => sourceStats.get(name) ?? { ok: 0, fail: 0, lastOkAt: 0, lastItems: 0, lastError: "" };
  // 运维开关（10/4故障演练+长期杠杆）：FLASH_SOURCE_OFF=逗号分隔源名或ASCII键，命中的源跳过外呼（某源抽风时免代码热关）
  // ASCII键理由：中文值经Vercel env存储疑似编码不稳（首轮演练开关未触发实锤）
  const offList = (process.env.FLASH_SOURCE_OFF || "").split(/[,\s]+/).filter(Boolean);
  if (offList.includes(name) || (key && offList.includes(key))) {
    bump(`flash_off_${name}`);
    const s = stat();
    s.lastError = "disabled_by_env";
    sourceStats.set(name, s);
    return [];
  }
  try {
    const items = await fn();
    bump(`flash_ok_${name}`);
    bump(`flash_items_${name}`, items.length);
    const s = stat();
    s.ok += 1;
    s.lastOkAt = Date.now();
    s.lastItems = items.length;
    s.lastError = "";
    sourceStats.set(name, s);
    return items;
  } catch (e) {
    bump(`flash_fail_${name}`);
    const s = stat();
    s.fail += 1;
    s.lastError = e instanceof Error ? e.message.slice(0, 80) : "unknown";
    sourceStats.set(name, s);
    return []; // 单源死→缺该源内容，其余源照常出feed（health可见降级）
  }
}

/** 源级运行时统计（health端点聚合用；进程冷启动后为空=尚未拉取，非故障） */
export function getFlashSourceStats(): { since: string; sources: Record<string, SourceStat> } {
  const sources: Record<string, SourceStat> = {};
  sourceStats.forEach((v, k) => {
    sources[k] = { ...v };
  });
  return { since: new Date(moduleLoadedAt).toISOString(), sources };
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<\/?b>/g, "")
    .replace(/<\/?strong>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function hasBoldTag(html: string): boolean {
  // <b[\s>]兼容带属性的加粗标签（<b class="hot">此前漏判——2026-09-26快讯审计P3-5）
  return /<b[\s>]|<strong[\s>]/.test(html);
}

export function formatRelativeTime(ts: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - ts;
  if (diff < 10) return "刚刚";
  if (diff < 60) return `${diff}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return new Date(ts * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源1: 金十（服务端兜底，主源在客户端直连）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface Jin10Raw {
  id: string;
  time: string;
  data: { content: string; title: string; source: string };
  important: number;
  channel: number[];
}

async function fetchJin10(): Promise<FlashItem[]> {
  const cacheBuster = Date.now();
  const urls = [
    `https://www.jin10.com/flash_newest.js?_=${cacheBuster}`,
    `https://cdn.jin10.com/flash_newest.js?_=${cacheBuster}`,
    `https://www.jin10.com/flash_newest.js`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Referer: "https://www.jin10.com/",
          "Cache-Control": "no-cache, no-store, max-age=0",
          Pragma: "no-cache",
        },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;

      const text = await res.text();
      if (!text || text.length < 10) continue;

      const match = text.match(/var newest = (.+);/);
      if (!match) continue;

      const raw = JSON.parse(match[1]) as Jin10Raw[];
      return raw.map((item) => {
        const rawContent = item.data.content || "";
        const cleanContent = stripHtml(rawContent);
        const cleanTitle = stripHtml(item.data.title || "");
        const ts = Math.floor(new Date(item.time + " UTC+8").getTime() / 1000);
        const major = item.important === 1 || hasBoldTag(rawContent);
        return {
          id: `jin10_${item.id}`,
          title: cleanTitle,
          content: cleanContent,
          content_text: cleanTitle
            ? (cleanContent.startsWith(cleanTitle) ? cleanContent : `${cleanTitle}\n${cleanContent}`)
            : cleanContent,
          time_str: formatRelativeTime(ts),
          timestamp: ts,
          is_important: major,
          importance: major ? "major" : "minor",
          channels: item.channel || [],
          source: "金十数据",
        } satisfies FlashItem;
      });
    } catch {
      continue;
    }
  }

  return [];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源2: 华尔街见闻
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface WscnItem {
  id: string;
  title: string;
  content: string;
  display_time: number;
  is_important: boolean;
}

async function fetchWallstreetCN(): Promise<FlashItem[]> {
    const res = await fetch(
      "https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=global-channel&limit=20",
      {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) return [];

    const payload = (await res.json()) as { data?: { items?: WscnItem[] } };
    const items = payload.data?.items ?? [];

    return items.map((item) => {
      const cleanContent = stripHtml(item.content || "");
      const cleanTitle = stripHtml(item.title || "");
      const ts = item.display_time;
      const major = item.is_important === true;
      return {
        id: `wscn_${item.id}`,
        title: cleanTitle,
        content: cleanContent,
        content_text: cleanTitle ? `${cleanTitle}\n${cleanContent}` : cleanContent,
        time_str: formatRelativeTime(ts),
        timestamp: ts,
        is_important: major,
        importance: major ? "major" : "minor",
        channels: [],
        source: "华尔街见闻",
      } satisfies FlashItem;
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 缓存（模块级，同实例内flash route与chat route共享）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type EmItem = {
  code: string;
  title?: string;
  summary?: string;
  showTime?: string;
  titleColor?: number;
};

// 东方财富7×24快讯（9/6第三源）：财联社接口已死（HTML盾页），东财JSON直通。
// 价值：A股/宏观时段补充（金十美股时段强，东财国内时段覆盖更好）
async function fetchEastmoney(): Promise<FlashItem[]> {
    const res = await fetch(
      `https://np-listapi.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=20&req_trace=${Date.now()}`,
      {
        headers: {
          "User-Agent": UA,
          Referer: "https://kuaixun.eastmoney.com/",
        },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) return [];
    const payload = (await res.json()) as { code?: number | string; data?: { fastNewsList?: EmItem[] } };
    // 东财参数错时HTTP仍200+code:0+data:null（sortEnd缺失实测）——必须校验code与列表存在
    const items = payload.data?.fastNewsList;
    if (String(payload.code ?? "") !== "1" || !Array.isArray(items)) return [];

    return items.flatMap((item) => {
      if (!item.code || !item.showTime) return [];
      // showTime格式"2026-09-06 12:43:48"（北京时间）→ epoch秒
      const ts = Math.floor(Date.parse(`${item.showTime.replace(" ", "T")}+08:00`) / 1000);
      if (!Number.isFinite(ts)) return [];
      const title = (item.title || "").trim();
      const content = (item.summary || "").trim();
      if (!content && !title) return [];
      const major = (item.titleColor ?? 0) !== 0;
      return [{
        id: `em_${item.code}`,
        title,
        content: content || title,
        content_text: title
          ? (content.startsWith(title) ? content : `${title}\n${content}`)
          : content,
        time_str: formatRelativeTime(ts),
        timestamp: ts,
        is_important: major,
        importance: major ? "major" : "minor",
        channels: [],
        source: "东方财富",
      } satisfies FlashItem];
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源4: 新浪财经7×24（10/4逸翔令扩源）：全球财经直播，tag含"焦点"=主要
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface SinaFeedItem {
  id: number;
  rich_text: string;
  create_time: string;
  /** 字符串化的数组（python风格）："[{'id': '9', 'name': '焦点'}]" */
  tag?: string;
}

async function fetchSina724(): Promise<FlashItem[]> {
    const res = await fetch(
      `https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=20&zhibo_id=152&_=${Date.now()}`,
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return [];
    const payload = (await res.json()) as { result?: { data?: { feed?: { list?: SinaFeedItem[] } } } };
    const items = payload.result?.data?.feed?.list;
    if (!Array.isArray(items)) return [];

    return items.flatMap((item) => {
      const raw = (item.rich_text || "").trim();
      if (!raw) return [];
      // rich_text常见"【标题】正文"格式——【】在开头则首段为标题，无【】则全文即正文
      let title = "";
      let content = raw;
      const m = raw.match(/^【(.+?)】\s*/);
      if (m) {
        title = m[1].trim();
        content = raw.slice(m[0].length).trim();
      }
      const ts = Math.floor(Date.parse(`${item.create_time.replace(" ", "T")}+08:00`) / 1000);
      if (!Number.isFinite(ts)) return [];
      const major = (item.tag || "").includes("焦点");
      return [{
        id: `sina_${item.id}`,
        title,
        content: content || title,
        content_text: title ? (content.startsWith(title) ? content : `${title}\n${content}`) : content,
        time_str: formatRelativeTime(ts),
        timestamp: ts,
        is_important: major,
        importance: major ? "major" : "minor",
        channels: [],
        source: "新浪财经",
      } satisfies FlashItem];
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源5: 同花顺快讯（10/4二轮扩源）：A股圈一线快讯，import=3且color=2=主要（红字）
// ⚠️ 必须带Referer，否则返回400"请求参数错误"
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ThsItem {
  id: string;
  title: string;
  digest: string;
  ctime: string;
  import?: string;
  color?: string;
}

async function fetch10jqka(): Promise<FlashItem[]> {
    const res = await fetch(
      "https://news.10jqka.com.cn/tapp/news/push/stock/?page=1&pagesize=20&track=website&tag=",
      {
        headers: { "User-Agent": UA, Referer: "https://news.10jqka.com.cn/" },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) return [];
    const payload = (await res.json()) as { code?: string; data?: { list?: ThsItem[] } };
    const items = payload.data?.list;
    if (String(payload.code ?? "") !== "200" || !Array.isArray(items)) return [];

    return items.flatMap((item) => {
      const title = (item.title || "").trim();
      const content = (item.digest || "").trim();
      if (!title && !content) return [];
      const ts = Number(item.ctime);
      if (!Number.isFinite(ts) || ts <= 0) return [];
      const major = item.import !== undefined && item.import !== "0" || item.color === "2";
      return [{
        id: `ths_${item.id}`,
        title,
        content: content || title,
        content_text: title ? (content.startsWith(title) ? content : `${title}\n${content}`) : content,
        time_str: formatRelativeTime(ts),
        timestamp: ts,
        is_important: major,
        importance: major ? "major" : "minor",
        channels: [],
        source: "同花顺",
      } satisfies FlashItem];
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源6: 财联社电报（10/4第六源，Alex验证线移植）。9/6曾判死=HTML盾页；
// 10/4实测v1/roll/get_roll_list带签名活着：sign=md5(sha1(参数串))，参数顺序必须与签名串逐字一致
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ClsItem {
  id: number;
  title?: string;
  content?: string;
  brief?: string;
  ctime: number; // epoch秒（实测）
  bold?: number; // 1=加粗重要
  ad?: { id?: number; url?: string }; // 非广告时为全空结构体（id=0且url空）
}

async function fetchCls(): Promise<FlashItem[]> {
  const params = "app=CailianpressWeb&category=&last_time=&os=web&refresh_type=1&rn=20&sv=7.7.5";
  const sign = createHash("md5").update(createHash("sha1").update(params).digest("hex")).digest("hex");
  const res = await fetch(`https://www.cls.cn/v1/roll/get_roll_list?${params}&sign=${sign}`, {
    headers: { "User-Agent": UA, Referer: "https://www.cls.cn/telegraph" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const payload = (await res.json()) as { errno?: number; data?: { roll_data?: ClsItem[] } };
  if (payload.errno !== 0 || !Array.isArray(payload.data?.roll_data)) throw new Error(`cls_errno_${payload.errno ?? "unknown"}`);

  return payload.data.roll_data.flatMap((it): FlashItem[] => {
    if (!it || (it.ad && ((it.ad.id ?? 0) !== 0 || !!it.ad.url))) return []; // 广告位剔除
    // 电报体：标题已含于正文【】壳内——title置空防双显，整条作为content
    const text = stripHtml(it.content || it.title || it.brief || "");
    if (text.length < 8) return [];
    if (!Number.isFinite(it.ctime) || it.ctime <= 0) return [];
    const major = it.bold === 1;
    return [{
      id: `cls_${it.id}`,
      title: "",
      content: text,
      content_text: text,
      time_str: formatRelativeTime(it.ctime),
      timestamp: it.ctime,
      is_important: major,
      importance: major ? "major" : "minor",
      channels: [],
      source: "财联社",
    } satisfies FlashItem];
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源7: AIHOT AI产业动态（10/10逸翔令"开工"）：aihot.news聚合站官方API，匿名免key。
// 定位：AI行业动态独立板（模型发布/AI公司事件/论文），与财经快讯分板不混流——
// 精选制（LLM摘要+打分，75分以下不上），节奏为小时~天级，不参与freshest分钟级竞争。
// score>=80=major（精选线实测62-82，80+为全行业级大事如State of AI Report）。
// 站方Agent接入页承诺匿名只读稳定服务；旧域名aihot.virxact.com 10/31停用，直接用新域。
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface AihotItem {
  id: string;
  title: string;
  originalTitle?: string;
  summary?: string;
  source?: { name?: string };
  publishedAt?: string;
  category?: string;
  score?: number;
}

async function fetchAihot(): Promise<FlashItem[]> {
  // 注意：不可加 _=Date.now() 之类cache-buster——AIHOT API对未知query参数严格校验直接400（10/10实测A/D组对照实锤）；
  // 站方自带边缘缓存设计（feed ttl=30），无需客户端绕缓存
  const res = await fetch(
    "https://aihot.news/api/v1/items?window=24h&limit=30",
    { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(6000) },
  );
  if (!res.ok) throw new Error(`http_${res.status}`);
  const payload = (await res.json()) as { items?: AihotItem[] };
  const items = payload.items;
  if (!Array.isArray(items)) return [];

  return items.flatMap((item): FlashItem[] => {
    const title = (item.title || "").trim();
    const summary = (item.summary || "").trim();
    if (!title || !item.id || !item.publishedAt) return [];
    const ts = Math.floor(Date.parse(item.publishedAt) / 1000);
    if (!Number.isFinite(ts) || ts <= 0) return [];
    const major = (item.score ?? 0) >= 80;
    // 分类中文化前缀放content头：论文/观点类一眼可辨（模型/产品/行业类标题已自明不加）
    const catLabel =
      item.category === "paper" ? "【论文】" :
      item.category === "opinion" ? "【观点】" : "";
    const content = `${catLabel}${summary || title}`;
    return [{
      id: `aihot_${item.id}`,
      title,
      content,
      content_text: `${title}\n${content}`,
      time_str: formatRelativeTime(ts),
      timestamp: ts,
      is_important: major,
      importance: major ? "major" : "minor",
      channels: [],
      source: "AIHOT",
    } satisfies FlashItem];
  });
}

let lastSuccessCache: FlashBoards | null = null;
let lastSuccessTime = 0;
const CACHE_TTL = 5 * 60 * 1000;
// 主路径节流缓存：快讯更新频率分钟级，10秒内的重复请求直接回缓存（防前端5秒轮询打穿金十）
let throttleCache: FlashBoards | null = null;
let throttleTime = 0;
const THROTTLE_TTL = 10 * 1000;
let throttleSource = "";

// 刷新进度去重：并发请求（flash轮询+chat提问同时打进来）只触发一次外呼
let refreshPromise: Promise<FlashBoards> | null = null;

/** 金十专板+合流板+AI产业动态板（10/4金十分板；10/10逸翔令接AIHOT第七源=AI独立板） */
export interface FlashBoards {
  /** 金十专板：金十数据全量（质量过滤后），不与其他源混流 */
  jin10: FlashItem[];
  /** 合流板：华尔街见闻+东方财富+新浪财经，跨源去重 */
  others: FlashItem[];
  /** AI产业动态板（10/10第七源AIHOT）：独立不混流——精选制节奏慢，混进财经板会被分钟级流挤出视野 */
  ai: FlashItem[];
  source: string;
}

export interface FlashFeed extends FlashBoards {
  /** 兼容字段：合并混流（chat/news-context/agent-tools/kb-grow继续消费，行为与9/6版一致） */
  items: FlashItem[];
}

/**
 * 拉取双板块快讯（金十专板 + 见闻/东财/新浪合流板，各≤30条，最新在前）。
 * 10秒节流 + 5分钟兜底缓存，供flash route与chat共用。
 * 失败返回空数组（调用方自行降级，不throw）。
 */
export async function getFlashBoards(): Promise<FlashBoards> {
  // 节流命中
  if (Date.now() - throttleTime < THROTTLE_TTL && throttleCache) {
    return throttleCache;
  }

  // 并发去重：已有刷新在跑就等它
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const [jin10Items, wscnItems, emItems, sinaItems, thsItems, clsItems, aihotItems] = await Promise.all([
      guarded("金十数据", fetchJin10, "jin10"),
      guarded("华尔街见闻", fetchWallstreetCN, "wscn"),
      guarded("东方财富", fetchEastmoney, "em"),
      guarded("新浪财经", fetchSina724, "sina"),
      guarded("同花顺", fetch10jqka, "ths"),
      guarded("财联社", fetchCls, "cls"),
      guarded("AIHOT", fetchAihot, "aihot"),
    ]);

    const qualityOk = (i: FlashItem) => !isLowQuality(i.content) && !isEnglishDominant(i.content_text);

    // 金十专板：单源全量（原有能力不变），板内也过一遍去重防同条重推
    const jin10 = dedupFlashItems(jin10Items.filter(qualityOk)).slice(0, 30);

    // 合流板：见闻+东财+新浪+同花顺+财联社跨源去重（金十CDN缓存4小时延迟的教训——跨源重叠靠dedup处理）
    const otherRaw = [...wscnItems, ...emItems, ...sinaItems, ...thsItems, ...clsItems].filter(qualityOk);
    const others = dedupFlashItems(otherRaw).slice(0, 30);

    // AI产业动态板（10/10第七源）：单源独立不混流，跨源去重防站方重推
    const ai = dedupFlashItems(aihotItems.filter(qualityOk)).slice(0, 30);

    if (jin10.length === 0 && others.length === 0 && ai.length === 0) {
      // 5分钟兜底（source带缓存标注，口径与原flash route一致）
      if (Date.now() - lastSuccessTime < CACHE_TTL && lastSuccessCache) {
        return { ...lastSuccessCache, source: "缓存数据（数据源暂时不可用）" };
      }
      return { jin10: [], others: [], ai: [], source: "" };
    }

    const boards: FlashBoards = { jin10, others, ai, source: "" };

    // 写节流缓存+兜底缓存
    throttleCache = boards;
    throttleTime = Date.now();
    lastSuccessCache = boards;
    lastSuccessTime = Date.now();

    // source标注口径：该源贡献了全网最新一条（列表顺序不可靠，用各源最大timestamp比）。
    // AIHOT不参与freshest比较——精选制publishedAt天然滞后小时级，比必输；有内容即标注
    const maxTs = (arr: FlashItem[]) => arr.reduce((m, i) => Math.max(m, i.timestamp), 0);
    const sources: string[] = [];
    const jin10Max = maxTs(jin10Items);
    const wscnMax = maxTs(wscnItems);
    const emMax = maxTs(emItems);
    const sinaMax = maxTs(sinaItems);
    const thsMax = maxTs(thsItems);
    const clsMax = maxTs(clsItems);
    const freshest = Math.max(jin10Max, wscnMax, emMax, sinaMax, thsMax, clsMax);
    if (jin10Items.length > 0) sources.push("金十数据");
    if (wscnItems.length > 0 && wscnMax === freshest && freshest > 0) sources.push("华尔街见闻");
    if (emItems.length > 0 && emMax === freshest && freshest > 0) sources.push("东方财富");
    if (sinaItems.length > 0 && sinaMax === freshest && freshest > 0) sources.push("新浪财经");
    if (thsItems.length > 0 && thsMax === freshest && freshest > 0) sources.push("同花顺");
    if (clsItems.length > 0 && clsMax === freshest && freshest > 0) sources.push("财联社");
    if (aihotItems.length > 0) sources.push("AIHOT");
    throttleSource = sources.join("+") || "金十数据";
    boards.source = throttleSource;

    return boards;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

/**
 * 兼容包装（原有能力不变）：chat/news-context/agent-tools/kb-grow继续拿合并混流。
 * 金十专板+合流板拼接后全局去重——与9/6三源混流行为等价（多了新浪源）。
 */
export async function getFlashFeed(): Promise<FlashFeed> {
  const boards = await getFlashBoards();
  // AI板进混流（10/10）：chat讯息注入/flash-impact分析可消费AI产业动态；dedup后30条上限内AI条目占比小
  const items = dedupFlashItems([...boards.jin10, ...boards.others, ...boards.ai]).slice(0, 30);
  return { ...boards, items };
}
