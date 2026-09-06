/** 交易统计共享模块（前端预览 / parse-trades服务端 / review事实底座 三处单源）
 *
 * 9/6红队审计修复（综合报告D + 本地审计）：
 * 1. FIFO卖超不再静默吞量——未配对数量记入 anomalies，UI与AI必须明示"统计不完整"
 * 2. 有日期的交易按日历序处理（原实现完全忽略日期，日期倒挂输入会算错）
 * 3. 卖出先于买入（日期上）时先排序再FIFO，不再产生"凭空出现"的已实现盈亏
 */

export type ParsedTrade = {
  date?: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  raw?: string;
};

export type OversellAnomaly = {
  /** 排序后的条目序号（从1计） */
  tradeNumber: number;
  symbol: string;
  soldQuantity: number;
  availableQuantity: number;
  unmatchedQuantity: number;
};

export type OpenLot = { symbol: string; quantity: number; price: number };

export type TradeStats = {
  totalTrades: number;
  winRate: number | null;
  totalPnl: number;
  profitLossRatio: number | null;
  closedPnls: number[];
  /** FIFO未平仓剩余 */
  openLots?: OpenLot[];
  /** 卖超等数据异常（旧持久化数据可能缺此字段，消费方需 ?? 兜底） */
  anomalies?: OversellAnomaly[];
  /** 本次计算是否因日期重排过条目顺序 */
  sortedByDate?: boolean;
};

export type PositionViolation = {
  tradeNumber: number;
  symbol: string;
  amount: number;
  ratio: number;
  rule: string;
};

export type PositionCheck = {
  totalTrades: number;
  violationCount: number;
  violations: PositionViolation[];
};

export function toPositiveNumber(value: string | undefined): number | null {
  if (!value) return null;
  const number = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : null;
}

// ── 日期解析 ──────────────────────────────────────────────

function dateKey(year: number, month: number, day: number): number | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ms = Date.UTC(year, month - 1, day);
  return Number.isNaN(ms) ? null : ms;
}

/** 解析日期 → 毫秒时间戳。支持 YYYY-M-D / YYYY年M月D日 / M月D日（补当年）。 */
export function parseDateKey(text: string): number | null {
  if (!text) return null;
  const full = text.match(/(20\d{2})[-/.年]\s*(\d{1,2})[-/.月]\s*(\d{1,2})/);
  if (full) return dateKey(Number(full[1]), Number(full[2]), Number(full[3]));
  const cn = text.match(/(\d{1,2})月\s*(\d{1,2})[日号]/);
  if (cn) return dateKey(new Date().getUTCFullYear(), Number(cn[1]), Number(cn[2]));
  return null;
}

function isoFromKey(key: number): string {
  return new Date(key).toISOString().slice(0, 10);
}

/**
 * 日期归一化 + 按日历排序（稳定）。
 * - 可解析日期的条目：date 字段归一化为 ISO（YYYY-MM-DD），按日期升序
 * - 无日期条目：继承相邻条目日期（前向填充，开头无日期用后向第一条；全无日期=输入序）
 * - 同日期保持输入顺序（稳定排序）
 */
export function sortTradesByDate(entries: ParsedTrade[]): { entries: ParsedTrade[]; reordered: boolean } {
  const keys = entries.map((entry) => parseDateKey(entry.date ?? "") ?? parseDateKey(entry.raw ?? ""));
  if (!keys.some((key) => key != null)) return { entries, reordered: false };

  const filled: number[] = new Array(entries.length);
  let carry: number | null = null;
  for (let i = 0; i < entries.length; i++) {
    if (keys[i] != null) {
      filled[i] = keys[i] as number;
      carry = keys[i];
    } else {
      filled[i] = carry ?? Number.NaN;
    }
  }
  let backfill: number | null = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (Number.isNaN(filled[i])) filled[i] = backfill ?? 0;
    else backfill = filled[i];
  }

  const order = entries.map((_, i) => i).sort((a, b) => filled[a] - filled[b]);
  const reordered = order.some((index, i) => index !== i);
  const sorted = order.map((i) => {
    const key = keys[i];
    return key != null ? { ...entries[i], date: isoFromKey(key) } : entries[i];
  });
  return { entries: sorted, reordered };
}

// ── 本地文本解析（fallback路径 + 实时预览） ─────────────────────────

export function parseTradeEntry(raw: string): ParsedTrade | null {
  const text = raw.trim();
  if (!text) return null;

  const dateKeyMs = parseDateKey(text);
  const date = dateKeyMs != null ? isoFromKey(dateKeyMs) : undefined;

  const csv = text.split(",").map((part) => part.trim());
  if (csv.length >= 5 && /^(BUY|SELL)$/i.test(csv[2])) {
    const quantity = toPositiveNumber(csv[3]);
    const price = toPositiveNumber(csv[4]);
    if (quantity && price && /^[A-Z]{1,6}$/i.test(csv[1])) {
      return {
        date,
        symbol: csv[1].toUpperCase(),
        side: csv[2].toUpperCase() === "BUY" ? "buy" : "sell",
        quantity,
        price,
        raw: text,
      };
    }
  }

  const sideMatch = text.match(/方向\s*[:：]\s*(买入|卖出|BUY|SELL)/i)
    ?? text.match(/(?:^|\s)(买入|卖出|BUY|SELL)(?:\s|$)/i);
  if (!sideMatch) return null;

  const side = /^(买入|BUY)$/i.test(sideMatch[1]) ? "buy" : "sell";
  const symbolMatch = text.match(/代码\s*[:：]\s*([A-Z]{1,6})/i)
    ?? text.match(/(?:买入|卖出|BUY|SELL)\s+([A-Z]{1,6})/i);
  const quantityMatch = text.match(/(?:数量|QTY)\s*[:：]?\s*([\d,.]+)/i)
    ?? text.match(/([\d,.]+)\s*(?:股|SHARES?)/i);
  const priceMatch = text.match(/(?:价格|PRICE)\s*[:：]?\s*\$?\s*([\d,.]+)/i)
    ?? text.match(/@\s*\$?\s*([\d,.]+)/);

  const quantity = toPositiveNumber(quantityMatch?.[1]);
  const price = toPositiveNumber(priceMatch?.[1]);
  if (!symbolMatch || !quantity || !price) return null;

  return {
    date,
    symbol: symbolMatch[1].toUpperCase(),
    side,
    quantity,
    price,
    raw: text,
  };
}

export function parseTrades(text: string): ParsedTrade[] {
  const entries: ParsedTrade[] = [];
  const blocks = text.split(/\n\s*-{3,}\s*\n/);

  for (const block of blocks) {
    const isFieldBlock = /(?:方向|代码|数量|价格)\s*[:：]/.test(block);
    if (isFieldBlock) {
      const entry = parseTradeEntry(block);
      if (entry) entries.push(entry);
      continue;
    }

    for (const line of block.split(/\r?\n/)) {
      const entry = parseTradeEntry(line);
      if (entry) entries.push(entry);
    }
  }

  return entries;
}

// ── FIFO 统计（核心修复） ─────────────────────────────────

export function calculateTradeStatsFromEntries(entries: ParsedTrade[], explicitPnlText = ""): TradeStats {
  const { entries: ordered, reordered } = sortTradesByDate(entries);
  const openLots = new Map<string, Array<{ quantity: number; price: number }>>();
  const closedPnls: number[] = [];
  const anomalies: OversellAnomaly[] = [];

  ordered.forEach((entry, index) => {
    if (entry.side === "buy") {
      const lots = openLots.get(entry.symbol) ?? [];
      lots.push({ quantity: entry.quantity, price: entry.price });
      openLots.set(entry.symbol, lots);
      return;
    }

    const lots = openLots.get(entry.symbol) ?? [];
    let remaining = entry.quantity;
    let tradePnl = 0;
    let matchedQuantity = 0;

    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0];
      const matched = Math.min(remaining, lot.quantity);
      tradePnl += (entry.price - lot.price) * matched;
      matchedQuantity += matched;
      remaining -= matched;
      lot.quantity -= matched;
      if (lot.quantity <= 0) lots.shift();
    }

    if (matchedQuantity > 0) closedPnls.push(tradePnl);
    // 修复点：卖超（剩余无买入可配对）不再静默吞量——记入异常，消费方必须明示
    if (remaining > 0) {
      anomalies.push({
        tradeNumber: index + 1,
        symbol: entry.symbol,
        soldQuantity: entry.quantity,
        availableQuantity: entry.quantity - remaining,
        unmatchedQuantity: remaining,
      });
    }
    openLots.set(entry.symbol, lots);
  });

  if (closedPnls.length === 0 && explicitPnlText) {
    // 注意前缀锚：无字母边界时"AAPL"中的"PL"会被当成P/L关键词吞出垃圾数字（9/6回归测试抓出）
    const explicitPnls = Array.from(
      explicitPnlText.matchAll(/(?:^|[^A-Za-z])(?:盈亏|P\/?L|PNL)\s*[:：]?\s*([+-]?\s*\$?\s*[\d,.]+)/gi),
      (match) => Number(match[1].replace(/[$,\s]/g, "")),
    ).filter(Number.isFinite);
    closedPnls.push(...explicitPnls);
  }

  const wins = closedPnls.filter((pnl) => pnl > 0);
  const losses = closedPnls.filter((pnl) => pnl < 0);
  const averageWin = wins.length > 0 ? wins.reduce((sum, pnl) => sum + pnl, 0) / wins.length : null;
  const averageLoss = losses.length > 0
    ? Math.abs(losses.reduce((sum, pnl) => sum + pnl, 0) / losses.length)
    : null;

  const openLotList: OpenLot[] = Array.from(openLots.entries()).flatMap(([symbol, lots]) =>
    lots.filter((lot) => lot.quantity > 0).map((lot) => ({ symbol, quantity: lot.quantity, price: lot.price })),
  );

  return {
    totalTrades: closedPnls.length,
    winRate: closedPnls.length > 0 ? (wins.length / closedPnls.length) * 100 : null,
    totalPnl: closedPnls.reduce((sum, pnl) => sum + pnl, 0),
    profitLossRatio: averageWin != null && averageLoss != null
      ? averageWin / averageLoss
      : averageWin != null
        ? Number.POSITIVE_INFINITY
        : null,
    closedPnls,
    openLots: openLotList,
    anomalies,
    sortedByDate: reordered,
  };
}

export function calculateTradeStats(text: string): TradeStats {
  return calculateTradeStatsFromEntries(parseTrades(text), text);
}

// ── 仓位规则检查 ──────────────────────────────────────────

export function calculatePositionCheck(entries: ParsedTrade[], sourceText: string, totalCapital: number): PositionCheck {
  const normalizedCapital = Number.isFinite(totalCapital) && totalCapital > 0 ? totalCapital : 100_000;
  const sourceLines = sourceText.split(/\r?\n/);
  const violations: PositionViolation[] = [];

  entries.forEach((entry, index) => {
    const context = entry.raw
      || sourceLines.find((line) => line.toUpperCase().includes(entry.symbol))
      || "";
    const isOption = /期权|OPTION|\bCALL\b|\bPUT\b/i.test(context);
    const isDayTrade = isOption && /日内|DAY\s*TRADE|INTRADAY|0DTE/i.test(context);
    const amount = entry.quantity * entry.price * (isOption ? 100 : 1);
    const ratio = amount / normalizedCapital;
    const limit = isDayTrade ? 0.05 * 0.2 : isOption ? 0.05 : 0.15;
    if (ratio <= limit) return;
    violations.push({
      tradeNumber: index + 1,
      symbol: entry.symbol,
      amount,
      ratio,
      rule: isDayTrade ? "日内期权超过可操作资金20%" : isOption ? "期权资金超过总资金5%" : "单笔交易超过总资金15%",
    });
  });

  return { totalTrades: entries.length, violationCount: violations.length, violations };
}

// ── AI结构化输出复核 ──────────────────────────────────────

export function normalizeAITrades(value: unknown): ParsedTrade[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const trade = item as Record<string, unknown>;
    const side = trade.side === "buy" || trade.side === "sell" ? trade.side : null;
    const quantity = Number(trade.quantity);
    const price = Number(trade.price);
    const symbol = typeof trade.code === "string" ? trade.code.trim().toUpperCase() : "";
    if (!side || !symbol || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) {
      return [];
    }
    return [{
      date: typeof trade.date === "string" ? trade.date : "",
      symbol,
      side,
      quantity,
      price,
    }];
  });
}
