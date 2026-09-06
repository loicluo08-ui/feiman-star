import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { callAI } from "@/lib/ai";
import { enforceRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";
import { sortTradesByDate } from "@/lib/trade-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const requestSchema = z.object({
  trades: z.string().trim().min(3).max(8000),
});

const parsedTradeSchema = z.object({
  date: z.string().trim().max(40).optional().default(""),
  code: z.string().trim().min(1).max(12).transform((value) => value.toUpperCase()),
  side: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const normalized = value.trim().toLowerCase();
    if (["buy", "买入", "买"].includes(normalized)) return "buy";
    if (["sell", "卖出", "卖"].includes(normalized)) return "sell";
    return normalized;
  }, z.enum(["buy", "sell"])),
  quantity: z.coerce.number().positive(),
  price: z.coerce.number().positive(),
});

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimitAsync(request, "parseTrades", RATE_LIMITS.parseTrades);
  if (limited) {
    return NextResponse.json(
      { error: `请求过于频繁，请${limited.retryAfter}秒后重试` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const body = await request.json().catch(() => null);
  const input = requestSchema.safeParse(body);
  if (!input.success) {
    return NextResponse.json({ error: "交易记录不能为空" }, { status: 400 });
  }

  const answer = await callAI(
    [
      {
        role: "system",
        content: [
          "你是交易记录结构化解析器。只提取用户明确提供的数据，不计算盈亏，不补充或猜测缺失信息。",
          "返回严格JSON对象，格式：",
          '{"trades":[{"date":"原始日期或YYYY-MM-DD","code":"AAPL","side":"buy","quantity":100,"price":185}]}',
          "side只能是buy或sell；quantity和price必须是正数；无法完整识别的交易不要输出。",
        ].join("\n"),
      },
      { role: "user", content: input.data.trades },
    ],
    { responseFormat: "json", temperature: 0, max_tokens: 1600, retry: 1, timeout: 35_000 },
  );

  if (!answer) {
    return NextResponse.json({ error: "AI解析暂时不可用" }, { status: 503 });
  }

  try {
    // LLM输出可能裹```json围栏或带前后杂文，先剥离再parse
    const cleaned = answer.trim().replace(/^[\s\S]*?```(?:json)?\s*\n?/, "").replace(/\n?\s*```[\s\S]*$/, "").trim();
    const parsed = JSON.parse(cleaned.startsWith("[") || cleaned.startsWith("{") ? cleaned : answer) as { trades?: unknown } | unknown[];
    const candidates = Array.isArray(parsed) ? parsed : parsed.trades;
    if (!Array.isArray(candidates)) throw new Error("invalid_shape");

    const trades = candidates.flatMap((candidate) => {
      const result = parsedTradeSchema.safeParse(candidate);
      return result.success ? [result.data] : [];
    });

    // 9/6红队修复（报告D发现2）：schema不过的条目不再静默丢弃——回传给前端明示
    const unparsed = candidates
      .filter((candidate) => {
        try {
          return !parsedTradeSchema.safeParse(candidate).success;
        } catch {
          return true;
        }
      })
      .slice(0, 10)
      .map((candidate) => {
        try {
          return JSON.stringify(candidate).slice(0, 120);
        } catch {
          return String(candidate).slice(0, 120);
        }
      });

    if (trades.length === 0) {
      return NextResponse.json(
        { error: unparsed.length > 0 ? "没有识别到完整交易（存在无法结构化的条目）" : "没有识别到完整交易" },
        { status: 422 },
      );
    }

    // 9/6红队修复（报告D发现6/本地审计）：服务端按日期归一化+排序（单源lib/trade-stats），
    // 日期倒挂的输入不再按原文序算FIFO
    const mapped = trades.map((t) => ({
      date: t.date,
      symbol: t.code,
      side: t.side,
      quantity: t.quantity,
      price: t.price,
    }));
    const sortedTrades = sortTradesByDate(mapped).entries.map((t) => ({
      date: t.date,
      code: t.symbol,
      side: t.side,
      quantity: t.quantity,
      price: t.price,
    }));

    return NextResponse.json(
      { data: { trades: sortedTrades, unparsed } },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "AI解析结果格式错误" }, { status: 502 });
  }
}
