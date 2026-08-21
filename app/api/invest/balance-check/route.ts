import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DeepSeek余额巡检：GET /api/invest/balance-check?token=ADMIN_TOKEN
// 返回余额+阈值判定，供外部定时任务拉取后决定是否推送告警
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const ADMIN = process.env.ADMIN_TOKEN;
  // 无ADMIN_TOKEN配置时退化为仅返回余额（公开但不含key）；有则强制鉴权
  if (ADMIN && token !== ADMIN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const KEY = process.env.DEEPSEEK_API_KEY;
  if (!KEY) {
    return NextResponse.json({ error: "DEEPSEEK_API_KEY未配置" }, { status: 500 });
  }

  try {
    const res = await fetch("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${KEY}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      // 402/401类：key失效或欠费——本身就是告警级事件
      return NextResponse.json({
        ok: false,
        alert: true,
        level: "critical",
        reason: `DeepSeek余额API返回HTTP ${res.status}（key失效或账户异常）`,
      });
    }
    const data = (await res.json()) as {
      balance_infos?: Array<{ currency: string; total_balance: string; granted_balance: string; topped_up_balance: string }>;
      is_available?: boolean;
    };
    const cny = data.balance_infos?.find((b) => b.currency === "CNY");
    const total = cny ? parseFloat(cny.total_balance) : null;
    const granted = cny ? parseFloat(cny.granted_balance) : 0;
    const topped = cny ? parseFloat(cny.topped_up_balance) : 0;

    if (total == null) {
      return NextResponse.json({ ok: false, alert: true, level: "warn", reason: "余额响应格式异常", raw: data });
    }

    // 阈值：≤20元告警（按当前月耗¥2.14=9天缓冲）；≤10元紧急
    const level = total <= 10 ? "critical" : total <= 20 ? "warn" : "ok";
    return NextResponse.json({
      ok: true,
      alert: level !== "ok",
      level,
      balance: total,
      breakdown: { granted, topped },
      is_available: data.is_available ?? null,
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, alert: true, level: "warn", reason: `巡检请求失败：${e instanceof Error ? e.message : "unknown"}` });
  }
}
