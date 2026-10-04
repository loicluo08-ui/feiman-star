// 快讯数据源公共模块（9/6从flash route抽出）
// 供 flash route 和 chat 实时讯息注入共用——同一serverless实例共享节流缓存
import { isLowQuality, isEnglishDominant, dedupFlashItems } from "@/lib/flash-filter";

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
  try {
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
  } catch {
    return [];
  }
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
  try {
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
  } catch {
    return [];
  }
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
  try {
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
  } catch {
    return [];
  }
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
  try {
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
  } catch {
    return [];
  }
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

/** 金十专板+合流板（10/4逸翔令：金十单独一个板块，原有能力不变） */
export interface FlashBoards {
  /** 金十专板：金十数据全量（质量过滤后），不与其他源混流 */
  jin10: FlashItem[];
  /** 合流板：华尔街见闻+东方财富+新浪财经，跨源去重 */
  others: FlashItem[];
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
    const [jin10Items, wscnItems, emItems, sinaItems, thsItems] = await Promise.all([
      fetchJin10(),
      fetchWallstreetCN(),
      fetchEastmoney(),
      fetchSina724(),
      fetch10jqka(),
    ]);

    const qualityOk = (i: FlashItem) => !isLowQuality(i.content) && !isEnglishDominant(i.content_text);

    // 金十专板：单源全量（原有能力不变），板内也过一遍去重防同条重推
    const jin10 = dedupFlashItems(jin10Items.filter(qualityOk)).slice(0, 30);

    // 合流板：见闻+东财+新浪+同花顺跨源去重（金十CDN缓存4小时延迟的教训——跨源重叠靠dedup处理）
    const otherRaw = [...wscnItems, ...emItems, ...sinaItems, ...thsItems].filter(qualityOk);
    const others = dedupFlashItems(otherRaw).slice(0, 30);

    if (jin10.length === 0 && others.length === 0) {
      // 5分钟兜底（source带缓存标注，口径与原flash route一致）
      if (Date.now() - lastSuccessTime < CACHE_TTL && lastSuccessCache) {
        return { ...lastSuccessCache, source: "缓存数据（数据源暂时不可用）" };
      }
      return { jin10: [], others: [], source: "" };
    }

    const boards: FlashBoards = { jin10, others, source: "" };

    // 写节流缓存+兜底缓存
    throttleCache = boards;
    throttleTime = Date.now();
    lastSuccessCache = boards;
    lastSuccessTime = Date.now();

    // source标注口径：该源贡献了全网最新一条（列表顺序不可靠，用各源最大timestamp比）
    const maxTs = (arr: FlashItem[]) => arr.reduce((m, i) => Math.max(m, i.timestamp), 0);
    const sources: string[] = [];
    const jin10Max = maxTs(jin10Items);
    const wscnMax = maxTs(wscnItems);
    const emMax = maxTs(emItems);
    const sinaMax = maxTs(sinaItems);
    const thsMax = maxTs(thsItems);
    const freshest = Math.max(jin10Max, wscnMax, emMax, sinaMax, thsMax);
    if (jin10Items.length > 0) sources.push("金十数据");
    if (wscnItems.length > 0 && wscnMax === freshest && freshest > 0) sources.push("华尔街见闻");
    if (emItems.length > 0 && emMax === freshest && freshest > 0) sources.push("东方财富");
    if (sinaItems.length > 0 && sinaMax === freshest && freshest > 0) sources.push("新浪财经");
    if (thsItems.length > 0 && thsMax === freshest && freshest > 0) sources.push("同花顺");
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
  const items = dedupFlashItems([...boards.jin10, ...boards.others]).slice(0, 30);
  return { ...boards, items };
}
