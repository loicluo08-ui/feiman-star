import { createHash } from "crypto";
import { getQtStocks } from "@/lib/qt";
import { fetchSADaily } from "@/lib/stockanalysis";
import { supabaseConfigured } from "@/lib/supabase";
import { getFlashSourceStats } from "@/lib/flash-source";

/** 快讯六源运行时统计聚合（10/4架构优化：guarded埋点→此处汇总，死源不再静默） */
function flashSourcesEntry(): SourceHealth {
  const { since, sources } = getFlashSourceStats();
  const names = Object.keys(sources);
  if (names.length === 0) {
    return { name: "flash_sources", ok: true, latencyMs: null, detail: `no_data_yet(冷启动,自${since.slice(11, 19)})` };
  }
  const parts = names.map((n) => {
    const s = sources[n];
    return `${n}:${s.ok}ok/${s.fail}fail${s.lastError ? `(最后错:${s.lastError})` : ""}`;
  });
  // ok判定：至少一个源10分钟内成功过=feed还能产出（全灭才false）
  const anyAlive = names.some((n) => Date.now() - sources[n].lastOkAt < 10 * 60_000);
  return {
    name: "flash_sources",
    ok: anyAlive,
    latencyMs: null,
    detail: parts.join(" ") || "empty",
  };
}

/**
 * 数据源健康检查（10/1外部评审v1.2采纳 P0-3）
 * 报告实证：免费数据源挂掉时产品静默降级（数据缺失/空态），无任何降级警告——
 * 本模块=单一检查端点，四源真探+三配置态并行探测+数据时效核查，前端/巡检可定期调用。
 *
 * 设计约束：
 * - 每源独立超时（6s），互不拖死
 * - 结果内存缓存60s（防health轮询打爆上游免费源）
 * - 只暴露状态/延迟/时效，不暴露内部URL/key
 */

export type SourceHealth = {
  name: string;
  ok: boolean;
  latencyMs: number | null;
  detail: string;
  /** optional=true的源不参与总体status判定（如github_sync备份通道未配置是已知态，非故障） */
  optional?: boolean;
};

export type HealthReport = {
  status: "ok" | "degraded";
  checkedAt: string;
  sources: SourceHealth[];
};

const PROBE_TIMEOUT = 6_000;

async function withTimeout(label: string, probe: () => Promise<SourceHealth>): Promise<SourceHealth> {
  const start = Date.now();
  try {
    return await Promise.race([
      probe(),
      new Promise<SourceHealth>((resolve) =>
        setTimeout(() => resolve({ name: label, ok: false, latencyMs: null, detail: "timeout_6s" }), PROBE_TIMEOUT),
      ),
    ]);
  } catch {
    return { name: label, ok: false, latencyMs: Date.now() - start, detail: "probe_exception" };
  }
}

/** 金十快讯：对齐lib/flash-source三链fallback逐条探测（10/1线上实测www带参数404而cdn链通——单URL探测会误报） */
const JIN10_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function probeJin10(): Promise<SourceHealth> {
  const start = Date.now();
  const urls = [
    `https://www.jin10.com/flash_newest.js?_=${Date.now()}`,
    `https://cdn.jin10.com/flash_newest.js?_=${Date.now()}`,
    "https://www.jin10.com/flash_newest.js",
  ];
  const fails: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": JIN10_UA, Referer: "https://www.jin10.com/", Accept: "*/*" },
        signal: AbortSignal.timeout(PROBE_TIMEOUT),
        cache: "no-store",
      });
      if (res.ok) {
        return { name: "jin10_flash", ok: true, latencyMs: Date.now() - start, detail: `ok(${new URL(url).host})` };
      }
      fails.push(`${new URL(url).host}:${res.status}`);
    } catch {
      fails.push(`${new URL(url).host}:err`);
    }
  }
  return { name: "jin10_flash", ok: false, latencyMs: Date.now() - start, detail: fails.join("|") };
}

/** 新浪财经7x24：直播室feed可达性+内容校验（10/4第四源） */
async function probeSina724(): Promise<SourceHealth> {
  const start = Date.now();
  try {
    const res = await fetch("https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=5&zhibo_id=152", {
      headers: { "User-Agent": JIN10_UA, Referer: "https://finance.sina.com.cn/7x24/" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT),
      cache: "no-store",
    });
    if (!res.ok) return { name: "sina_724", ok: false, latencyMs: Date.now() - start, detail: `http_${res.status}` };
    const payload = (await res.json()) as { result?: { data?: { feed?: { list?: unknown[] } } } };
    const n = payload.result?.data?.feed?.list?.length ?? 0;
    return {
      name: "sina_724",
      ok: n > 0,
      latencyMs: Date.now() - start,
      detail: n > 0 ? `ok(${n}条)` : "empty_list",
    };
  } catch {
    return { name: "sina_724", ok: false, latencyMs: Date.now() - start, detail: "probe_exception" };
  }
}

/** 财联社电报：签名接口可达性（sign算法=md5(sha1(参数串))，与lib/flash-source.fetchCls同源逻辑） */
async function probeCls(): Promise<SourceHealth> {
  const start = Date.now();
  try {
    const params = "app=CailianpressWeb&category=&last_time=&os=web&refresh_type=1&rn=5&sv=7.7.5";
    const sign = createHash("md5").update(createHash("sha1").update(params).digest("hex")).digest("hex");
    const res = await fetch(`https://www.cls.cn/v1/roll/get_roll_list?${params}&sign=${sign}`, {
      headers: { "User-Agent": JIN10_UA, Referer: "https://www.cls.cn/telegraph" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT),
      cache: "no-store",
    });
    if (!res.ok) return { name: "cls_telegraph", ok: false, latencyMs: Date.now() - start, detail: `http_${res.status}` };
    const payload = (await res.json()) as { errno?: number; data?: { roll_data?: unknown[] } };
    const n = payload.errno === 0 ? payload.data?.roll_data?.length ?? 0 : 0;
    return {
      name: "cls_telegraph",
      ok: n > 0,
      latencyMs: Date.now() - start,
      detail: n > 0 ? `ok(${n}条)` : `errno_${payload.errno ?? "unknown"}`,
    };
  } catch {
    return { name: "cls_telegraph", ok: false, latencyMs: Date.now() - start, detail: "probe_exception" };
  }
}

/** 同花顺快讯：推送接口可达性+条目校验（10/4第六源） */
async function probeThs(): Promise<SourceHealth> {
  const start = Date.now();
  try {
    const res = await fetch("https://news.10jqka.com.cn/tapp/news/push/stock/?page=1&pagesize=5&track=website&tag=", {
      headers: { "User-Agent": JIN10_UA, Referer: "https://news.10jqka.com.cn/tw/" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT),
      cache: "no-store",
    });
    if (!res.ok) return { name: "ths_flash", ok: false, latencyMs: Date.now() - start, detail: `http_${res.status}` };
    const payload = (await res.json()) as { data?: { list?: unknown[] } };
    const n = payload.data?.list?.length ?? 0;
    return { name: "ths_flash", ok: n > 0, latencyMs: Date.now() - start, detail: n > 0 ? `ok(${n}条)` : "empty_list" };
  } catch {
    return { name: "ths_flash", ok: false, latencyMs: Date.now() - start, detail: "probe_exception" };
  }
}

/** Nasdaq财报日历：api.nasdaq.com单日探测（防bot指纹变化） */
async function probeNasdaq(): Promise<SourceHealth> {
  const start = Date.now();
  const date = new Date().toISOString().slice(0, 10);
  const res = await fetch(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      Referer: "https://www.nasdaq.com/",
    },
    signal: AbortSignal.timeout(PROBE_TIMEOUT),
    cache: "no-store",
  });
  const ok = res.ok;
  return {
    name: "nasdaq_calendar",
    ok,
    latencyMs: Date.now() - start,
    detail: ok ? "ok" : `http_${res.status}`,
  };
}

/**
 * stockanalysis日线：可达性 + 数据时效核查（TTM时效问题并入——10/1评审9.1节
 * "营收TTM增长83.4%疑似陈旧窗口"，若日线最新date距今>4个自然日则数据源在供旧数据）
 */
async function probeStockAnalysis(): Promise<SourceHealth> {
  const start = Date.now();
  const daily = await fetchSADaily("AAPL", 5);
  const latencyMs = Date.now() - start;
  if (daily.length === 0) {
    return { name: "stockanalysis_daily", ok: false, latencyMs, detail: "empty_response" };
  }
  const latest = daily[daily.length - 1].date;
  const latestMs = new Date(`${latest}T00:00:00Z`).getTime();
  const ageDays = Math.floor((Date.now() - latestMs) / 86_400_000);
  return {
    name: "stockanalysis_daily",
    ok: true,
    latencyMs,
    detail: `freshness=${ageDays > 4 ? `stale_${ageDays}d` : "ok"},latest=${latest}`,
  };
}

/** 腾讯实时行情：AAPL单标的探测 */
async function probeQt(): Promise<SourceHealth> {
  const start = Date.now();
  const stocks = await getQtStocks(["AAPL"]);
  const latencyMs = Date.now() - start;
  const q = stocks.get("AAPL");
  const ok = Boolean(q && q.price != null);
  return {
    name: "tencent_quote",
    ok,
    latencyMs,
    detail: ok ? "ok" : "empty_response",
  };
}

/** 配置态检查（不真调，省Finnhub配额） */
function probeConfigs(): SourceHealth[] {
  return [
    {
      name: "finnhub_key",
      ok: Boolean(process.env.FINNHUB_API_KEY),
      latencyMs: null,
      detail: Boolean(process.env.FINNHUB_API_KEY) ? "configured" : "missing",
    },
    {
      name: "supabase_ledger",
      ok: supabaseConfigured(),
      latencyMs: null,
      detail: supabaseConfigured() ? "configured" : "missing",
    },
    {
      name: "github_sync",
      ok: Boolean(process.env.GITHUB_TOKEN),
      latencyMs: null,
      detail: Boolean(process.env.GITHUB_TOKEN) ? "configured" : "missing(备份通道，主通道=supabase)",
      optional: true,
    },
  ];
}

let healthCache: { data: HealthReport; expiresAt: number } | null = null;
const HEALTH_TTL = 60_000;

export async function runHealthCheck(): Promise<HealthReport> {
  if (healthCache && healthCache.expiresAt > Date.now()) {
    return healthCache.data;
  }

  const [jin10, sina, cls, ths, nasdaq, sa, qt] = await Promise.all([
    withTimeout("jin10_flash", probeJin10),
    withTimeout("sina_724", probeSina724),
    withTimeout("cls_telegraph", probeCls),
    withTimeout("ths_flash", probeThs),
    withTimeout("nasdaq_calendar", probeNasdaq),
    withTimeout("stockanalysis_daily", probeStockAnalysis),
    withTimeout("tencent_quote", probeQt),
  ]);
  const sources = [jin10, sina, cls, ths, flashSourcesEntry(), nasdaq, sa, qt, ...probeConfigs()];
  const status = sources.filter((s) => !s.optional).every((s) => s.ok) ? "ok" : "degraded";
  const result: HealthReport = { status, checkedAt: new Date().toISOString(), sources };
  healthCache = { data: result, expiresAt: Date.now() + HEALTH_TTL };
  return result;
}
