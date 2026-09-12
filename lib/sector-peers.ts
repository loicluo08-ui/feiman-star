/**
 * 行业对比注入（材料层二期）——9/12长线计划阶段一
 * 目标：个股分析时给出同行PE/价格/涨跌+行业中位数——估值判断从"孤值"变"横向锚"
 * （机器评分Q4失分根因之一：AI手里没有同行数据，"对比行业"只能空话）
 *
 * 数据源：①Finnhub /stock/peers（key在Vercel环境，本地无）②静态SECTOR_PEERS表兜底
 * 指标拉取：复用fetchStockData（腾讯主源+Finnhub备源，已验证链路）
 * 失败语义：静默跳过（软增强，任何环节失败不阻塞主回答）
 */

import { fetchStockData } from "./stock-context";

export type PeerRow = {
  code: string;
  name: string;
  price: number | null;
  pe: number | null;
  changePct: number | null;
};

/** 静态行业同伴表（高频对话标的覆盖；未列出的标的走Finnhub或跳过） */
const SECTOR_PEERS: Record<string, string[]> = {
  NVDA: ["AMD", "INTC", "AVGO", "QCOM", "TXN", "MU"],
  AMD: ["NVDA", "INTC", "AVGO", "QCOM", "TXN"],
  INTC: ["AMD", "NVDA", "QCOM", "TXN", "MU"],
  AVGO: ["NVDA", "AMD", "QCOM", "TXN", "MRVL"],
  AAPL: ["MSFT", "GOOGL", "AMZN", "META"],
  MSFT: ["GOOGL", "AMZN", "META", "AAPL"],
  GOOGL: ["MSFT", "META", "AMZN", "AAPL"],
  AMZN: ["MSFT", "GOOGL", "META", "BABA"],
  META: ["GOOGL", "MSFT", "SNAP", "PINS"],
  TSLA: ["RIVN", "LCID", "NIO", "XPEV", "LI"],
  MU: ["SK Hynix", "WESTERN DIGITAL", "Seagate"],
  ORCL: ["MSFT", "IBM", "SAP"],
  CRM: ["ORCL", "SAP", "NOW"],
  BABA: ["PDD", "JD", "BIDU"],
  PDD: ["BABA", "JD", "BIDU"],
  JD: ["BABA", "PDD", "BIDU"],
  BIDU: ["BABA", "PDD", "TME"],
  COIN: ["HOOD", "MSTR", "SQ"],
  PLTR: ["SNOW", "CRWD", "NET"],
  SNOW: ["PLTR", "CRWD", "NET"],
  FUTU: ["HOOD", "COIN"],
  UBER: ["DASH", "LYFT", "ABNB"],
  JPM: ["BAC", "GS", "WFC", "C"],
  XOM: ["CVX", "COP", "OXY"],
};

/** finnhub peers（key仅在Vercel环境可用；响应结构 {"peers":["AMD",...]}，官方文档口径） */
async function fetchFinnhubPeers(code: string): Promise<string[]> {
  const key = process.env.FINNHUB_API_KEY || "";
  if (!key) return [];
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/peers?symbol=${encodeURIComponent(code)}&token=${key}`,
      { signal: AbortSignal.timeout(3500) },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { peers?: string[] };
    return Array.isArray(json.peers) ? json.peers.slice(0, 8) : [];
  } catch {
    return [];
  }
}

const cache = new Map<string, { text: string; expiresAt: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 同行PE盘中变化慢，1小时缓存防腾讯频控

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 行业对比注入文本（主标的视角）。任何环节失败返回 ""（静默跳过，不阻塞主回答）。
 * 只处理 effectiveStockCodes[0]（多标的对话先覆盖主标的，防止行情拉取数×N触发频控）。
 */
export async function fetchPeerComparison(mainCode: string): Promise<string> {
  if (!mainCode) return "";
  const cached = cache.get(mainCode);
  if (cached && cached.expiresAt > Date.now()) return cached.text;
  try {
    let codes = await fetchFinnhubPeers(mainCode);
    if (codes.length === 0) codes = SECTOR_PEERS[mainCode.toUpperCase()] || [];
    // 过滤自身+仅保留纯字母代码（静态表里"SK Hynix"这类非代码项会被finnhub/腾讯路径自然丢弃）
    const peerCodes = codes
      .map((c) => c.trim().toUpperCase())
      .filter((c) => c && /^[A-Z.\-]{1,6}$/.test(c) && c !== mainCode.toUpperCase())
      .slice(0, 4);
    if (peerCodes.length < 2) return "";

    const rows = await fetchStockData(peerCodes);
    const peers: PeerRow[] = rows
      .filter((r) => r.price != null)
      .map((r) => ({ code: r.code, name: r.name, price: r.price, pe: r.pe, changePct: r.changePct }));
    if (peers.length < 2) return "";

    const peVals = peers.filter((p) => p.pe != null && p.pe > 0).map((p) => p.pe as number);
    const med = median(peVals);
    const rowsText = peers
      .map((p) => {
        const seg = [`${p.code}`];
        if (p.pe != null && p.pe > 0) seg.push(`PE${p.pe.toFixed(1)}`);
        if (p.price != null) seg.push(`$${p.price}`);
        if (p.changePct != null) seg.push(`${p.changePct > 0 ? "+" : ""}${p.changePct.toFixed(2)}%`);
        return seg.join(" ");
      })
      .join(" | ");
    const medText = med != null ? `中位数PE ${med.toFixed(1)}` : "";
    const text = `【行业对比】${mainCode.toUpperCase()}同行：${rowsText}${medText ? `；${medText}` : ""}[同行估值横向锚，对照主标的PE使用]`;

    cache.set(mainCode.toUpperCase(), { text, expiresAt: Date.now() + CACHE_TTL });
    return text;
  } catch {
    return "";
  }
}
