/**
 * 期权链上下文（CBOE官方延迟报价API）
 *
 * 背景（9/6质量专项，QUALITY_RUBRIC Q2失分主因）："IV是猜的"——基线实测备兑分析
 * 输出"IV Rank大概率<30"式编造。期权问题没有真实期权链数据，模型只能猜IV。
 *
 * 数据源：cdn.cboe.com/api/global/delayed_quotes/options/{SYMBOL}.json
 * - 官方公开接口，无需认证，返回全期权链（bid/ask/iv/delta/gamma/OI/volume）
 * - 延迟15分钟——期权策略分析用不到秒级行情，够用
 * - 失败静默跳过（期权数据是增强不是依赖，与VIX同模式）
 *
 * 触发条件：用户消息含期权关键词才拉取——普通股票问题零延迟代价。
 */

interface CboeOption {
  option: string; // NVDA260909C00110000
  bid: number;
  ask: number;
  iv: number;
  open_interest: number;
  volume: number;
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
}

interface ExpirySlice {
  expiry: string; // YYMMDD
  daysOut: number; // 距今天数
  atmStrike: number;
  calls: Array<{ strike: number; mid: number; iv: number; delta: number; oi: number }>;
  puts: Array<{ strike: number; mid: number; iv: number; delta: number; oi: number }>;
  totalOI: number;
}

export interface OptionContext {
  code: string;
  spot: number; // CBOE close（正股口径，与行情注入对齐用）
  asOf: string; // 数据时间戳
  near: ExpirySlice;
  far: ExpirySlice | null;
  atmIvNear: number;
  atmIvFar: number | null;
  termSlope: number | null; // 次月-近月ATM IV差（正=contango，负=backwardation）
  iv30d: number | null; // 30天恒定到期插值IV
}

// 期权场景触发词（中英）——命中才拉链，普通问题零代价
const OPTION_KEYWORDS = /期权|备兑|covered\s*call|buywrite|卖出?call|买入?put|看涨期权|看跌期权|认购|认沽|行权价|到期日|隐含波动|IV\s*Rank|iv\s*rank|implied\s*vol|期权链|option\s*chain|options?\b|straddle|strangle|跨式|宽跨|铁鹰|iron\s*condor|价差策略|vertical|calendar\s*spread|日历价差|双卖|权利金|roll.*期权|展期|GEX|gamma\s*exposure|pin\s*risk/i;

export function isOptionQuery(text: string): boolean {
  return OPTION_KEYWORDS.test(text);
}

// 60秒内存缓存：单实例防抖（与行情缓存同模式）
const optCache = new Map<string, { data: OptionContext | null; expiresAt: number }>();
const OPT_CACHE_TTL = 60_000;

function parseExpiryDate(yyMMdd: string): number {
  // yyMMdd → 距今天的自然日数
  const yy = parseInt(yyMMdd.slice(0, 2), 10);
  const mm = parseInt(yyMMdd.slice(2, 4), 10);
  const dd = parseInt(yyMMdd.slice(4, 6), 10);
  const expMs = Date.UTC(2000 + yy, mm - 1, dd);
  return Math.max(0, Math.round((expMs - Date.now()) / 86_400_000));
}

function pickMid(o: CboeOption): number {
  if (o.bid > 0 && o.ask > 0) return (o.bid + o.ask) / 2;
  return o.ask > 0 ? o.ask : o.bid;
}

export async function fetchOptionContext(code: string): Promise<OptionContext | null> {
  const cached = optCache.get(code);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  let data: OptionContext | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://cdn.cboe.com/api/global/delayed_quotes/options/${code}.json`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = (await res.json()) as { timestamp?: string; data?: { close?: number; current_price?: number; options?: CboeOption[] } };
    const options = json.data?.options;
    const spot = json.data?.close ?? json.data?.current_price;
    if (!options || options.length === 0 || typeof spot !== "number" || !Number.isFinite(spot) || spot <= 0) return null;

    // 按到期日分桶（es5安全：普通for循环+exec解析合约名）
    const byExp = new Map<string, CboeOption[]>();
    const nameRe = /^[A-Z.]+(\d{6})([CP])(\d{8})$/;
    // es5 target下数组for..of也有TS2802风险——索引for替代（TOOLS.md铁律）
    for (let oi = 0; oi < options.length; oi++) {
      const o = options[oi];
      const m = nameRe.exec(o.option);
      if (!m) continue;
      // 过滤死数据：iv=0（深实值/零成交）与bid=ask=0（无报价）不进分析池
      if (!(o.iv > 0.01)) continue;
      if (o.bid <= 0 && o.ask <= 0) continue;
      const list = byExp.get(m[1]);
      if (list) list.push(o);
      else byExp.set(m[1], [o]);
    }
    if (byExp.size === 0) return null;

    // 每个到期切ATM±2档切片，算总OI（月度到期OI显著高，取top2=近月/次月，天然滤掉0DTE噪音）
    // es5 target禁Map for..of迭代（TS2802）——forEach替代
    const slices: ExpirySlice[] = [];
    byExp.forEach(function (list, exp) {
      if (list.length < 8) return; // 链太薄（远月残链）跳过——forEach回调内continue非法，用return
      const daysOut = parseExpiryDate(exp);
      if (daysOut < 1) return; // 已到期/0DTE跳过（IV失真+策略无关）
      let atmStrike = 0;
      let best = Infinity;
      for (let i = 0; i < list.length; i++) {
        const s = /(\d{8})$/.exec(list[i].option);
        if (!s) continue;
        const strike = parseInt(s[1], 10) / 1000;
        const d = Math.abs(strike - spot);
        if (d < best) { best = d; atmStrike = strike; }
      }
      const strikeRe = /^[A-Z.]+\d{6}([CP])(\d{8})$/;
      const calls: ExpirySlice["calls"] = [];
      const puts: ExpirySlice["puts"] = [];
      let totalOI = 0;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        const m = strikeRe.exec(o.option);
        if (!m) continue;
        const s = parseInt(m[2], 10) / 1000;
        if (Math.abs(s - atmStrike) > 7.5) continue; // ATM±7.5元档位窗口（NVDA类高价股；低价股窄自然满足）
        const row = { strike: s, mid: pickMid(o), iv: o.iv, delta: o.delta, oi: o.open_interest };
        if (m[1] === "C") calls.push(row);
        else puts.push(row);
        totalOI += o.open_interest;
      }
      calls.sort((a, b) => a.strike - b.strike);
      puts.sort((a, b) => a.strike - b.strike);
      if (calls.length > 0 && puts.length > 0) slices.push({ expiry: exp, daysOut, atmStrike, calls, puts, totalOI });
    }); // forEach闭包
    if (slices.length === 0) return null;

    // 近月/次月=当月/次月第三个周五（标准月度期权）。（9/6实测两连修：①OI top2把周度选成
    // "次月"且早于near到期→backwardation误报；②daysOut≥7选到周一到期的周度链。周度链
    // IV含事件溢价，做期限结构基准会污染备兑/IV判断。月度链找不到（调整假日等）按daysOut降级）
    const isMonthly = (yyMMdd: string): boolean => {
      const dd = parseInt(yyMMdd.slice(4, 6), 10);
      const mm = parseInt(yyMMdd.slice(2, 4), 10);
      const yy = parseInt(yyMMdd.slice(0, 2), 10);
      const dow = new Date(Date.UTC(2000 + yy, mm - 1, dd)).getUTCDay();
      return dow === 5 && Math.floor((dd - 1) / 7) + 1 === 3; // 周五且当月第3个
    };
    slices.sort((a, b) => a.daysOut - b.daysOut);
    const OI_FLOOR = slices.reduce((s, x) => s + x.totalOI, 0) / slices.length / 4; // 均量1/4=残链门槛
    const monthly = slices.filter((s) => isMonthly(s.expiry) && s.totalOI >= OI_FLOOR);
    const near = monthly.length > 0 ? monthly[0]
      : (slices.find((s) => s.daysOut >= 7 && s.totalOI >= OI_FLOOR) ?? slices[0]);
    const far = monthly.find((s) => s.daysOut > near.daysOut)
      ?? slices.find((s) => s.daysOut >= near.daysOut + 14 && s.totalOI >= OI_FLOOR) ?? null;

    const atmIvOf = (slice: ExpirySlice): number => {
      // ATM IV = 最贴近atmStrike的call与put的iv均值（put-call parity下两者接近，均值抗噪）
      const nc = slice.calls.reduce((p, c) => (Math.abs(c.strike - slice.atmStrike) < Math.abs(p.strike - slice.atmStrike) ? c : p));
      const np = slice.puts.reduce((p, c) => (Math.abs(c.strike - slice.atmStrike) < Math.abs(p.strike - slice.atmStrike) ? c : p));
      return (nc.iv + np.iv) / 2;
    };
    const atmIvNear = atmIvOf(near);
    const atmIvFar = far ? atmIvOf(far) : null;
    const termSlope = far && atmIvFar != null ? atmIvFar - atmIvNear : null;
    // 30天恒定到期IV：近月/次月线性插值（近月<30天<次月时；两侧外推截断）
    let iv30d: number | null = null;
    if (far && atmIvFar != null && far.daysOut > near.daysOut) {
      const t = (30 - near.daysOut) / (far.daysOut - near.daysOut);
      iv30d = Math.round((atmIvNear + Math.max(0, Math.min(1, t)) * (atmIvFar - atmIvNear)) * 1000) / 1000;
    }

    data = {
      code, spot,
      asOf: json.timestamp ?? "",
      near, far, atmIvNear, atmIvFar, termSlope, iv30d,
    };
  } catch {
    data = null;
  }
  optCache.set(code, { data, expiresAt: Date.now() + OPT_CACHE_TTL });
  return data;
}

/**
 * 注入文本块。设计原则：
 * - 数字全部来自CBOE真实链（模型引用时过得了source-integrity/数字锚定）
 * - 备兑候选直接给mid/delta/静态收益（Q2场景开箱即用，"行权价怎么选"有真数据可依）
 * - 明示数据边界：延迟15分钟、无IV历史（IV Rank无法算，禁猜——把"猜IV Rank"显式封死）
 */
export function buildOptionBlock(ctx: OptionContext): string {
  const fmtIv = (v: number) => `${Math.round(v * 1000) / 10}%`;
  const near = ctx.near;
  const lines: string[] = [];

  lines.push(`【期权链实时数据（${ctx.code}，CBOE延迟报价，注入时间戳${ctx.asOf}）】`);
  lines.push(`正股参考价：$${ctx.spot}（与行情注入对齐）；近月链到期${near.expiry}（${near.daysOut}天后），ATM行权价$${near.atmStrike}`);
  lines.push(`近月ATM IV：${fmtIv(ctx.atmIvNear)}${ctx.iv30d != null ? `；30天恒定到期IV：${fmtIv(ctx.iv30d)}` : ""}`);
  if (ctx.atmIvFar != null && ctx.far) {
    lines.push(`次月链到期${ctx.far.expiry}（${ctx.far.daysOut}天）ATM IV：${fmtIv(ctx.atmIvFar)}；期限斜率${ctx.termSlope != null ? (ctx.termSlope >= 0 ? "contango（远月IV更高，事件溢价在后）" : "backwardation（近月IV更高，近期事件驱动）") : ""}`);
  }

  // ATM附近call表（含备兑候选）：strike | mid | delta | IV | OI
  lines.push(`近月ATM附近看涨期权（$=权利金mid，delta=方向敏感度，OI=未平仓）：`);
  for (const c of near.calls) {
    lines.push(`  行权$${c.strike} | 权利金$${Math.round(c.mid * 100) / 100} | delta ${Math.round(c.delta * 100) / 100} | IV ${fmtIv(c.iv)} | OI ${Math.round(c.oi)}`);
  }
  // ATM附近put表（保护性put/价差参考）
  lines.push(`近月ATM附近看跌期权：`);
  for (const p of near.puts) {
    lines.push(`  行权$${p.strike} | 权利金$${Math.round(p.mid * 100) / 100} | delta ${Math.round(p.delta * 100) / 100} | IV ${fmtIv(p.iv)} | OI ${Math.round(p.oi)}`);
  }

  // 备兑候选：OTM call（delta 0.15-0.45），静态收益率=权利金/行权价（被行权年化另算）
  const cc = near.calls.filter((c) => c.delta <= 0.45 && c.delta >= 0.1 && c.strike > ctx.spot);
  if (cc.length > 0) {
    lines.push(`备兑候选（OTM call，delta 0.1-0.45）：`);
    for (const c of cc.slice(0, 4)) {
      const staticYield = c.strike > 0 ? Math.round((c.mid / c.strike) * 10000) / 100 : 0;
      const annualized = near.daysOut > 0 ? Math.round((c.mid / c.strike) * (365 / near.daysOut) * 10000) / 100 : 0;
      lines.push(`  行权$${c.strike} | 收$${Math.round(c.mid * 100) / 100} | 被行权锁定价$${Math.round((c.strike + c.mid) * 100) / 100} | 静态收益${staticYield}%/期（年化${annualized}%，未含正股波动） | delta ${Math.round(c.delta * 100) / 100} | OI ${Math.round(c.oi)}`);
    }
  }

  lines.push(`⚠️ 期权数据边界（必须遵守）：IV/期限斜率/备兑收益率为以上真实链数据，可直接引用[数据]。IV历史序列未注入——IV Rank/IV百分位无数据支撑，禁止编造数值，只能按当前IV相对水平定性判断。GEX/dealer持仓未注入（无仓位数据），相关分析只能给[推导]框架。期权链为15分钟延迟报价，做执行级决策前需查实时盘口。`);
  return lines.join("\n");
}
