import "server-only";

import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { createSupabaseAdminClient, SupabaseConfigError } from "@/lib/supabase";

type PlanRow = {
  plan: string;
  remaining_calls: number;
  daily_limit: number;
  expires_at: string | null;
};

export type UsageReservation = {
  ok: true;
  userId: string;
  plan: string;
  remainingCalls: number;
  dailyLimit: number;
  expiresAt: string | null;
};

type UsageDenied = { ok: false; response: NextResponse };

function firstRow(data: unknown): PlanRow | null {
  if (!Array.isArray(data) || !data[0] || typeof data[0] !== "object") return null;
  return data[0] as PlanRow;
}

export async function reserveAiCall(): Promise<UsageReservation | UsageDenied> {
  const auth = await getAuthenticatedUser();
  if (!auth) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "请先登录后再使用 AI 工具。" } },
        { status: 401 },
      ),
    };
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("reserve_ai_call", {
      p_user_id: auth.user.id,
    });

    if (error) {
      if (error.message.includes("quota_exhausted")) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: { code: "QUOTA_EXHAUSTED", message: "额度用完，请兑换套餐后继续使用。" } },
            { status: 403 },
          ),
        };
      }
      console.error(`[usage] reserve_failed code=${error.code ?? "unknown"}`);
      return {
        ok: false,
        response: NextResponse.json(
          { error: { code: "BILLING_UNAVAILABLE", message: "暂时无法读取使用额度，请稍后重试。" } },
          { status: 503 },
        ),
      };
    }

    const plan = firstRow(data);
    if (!plan) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: { code: "BILLING_INVALID_RESPONSE", message: "额度状态异常，请稍后重试。" } },
          { status: 503 },
        ),
      };
    }

    return {
      ok: true,
      userId: auth.user.id,
      plan: plan.plan,
      remainingCalls: plan.remaining_calls,
      dailyLimit: plan.daily_limit,
      expiresAt: plan.expires_at,
    };
  } catch (error) {
    if (!(error instanceof SupabaseConfigError)) console.error("[usage] unexpected_error");
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: "BILLING_NOT_CONFIGURED", message: "额度服务尚未配置。" } },
        { status: 503 },
      ),
    };
  }
}

export async function refundAiCall(reservation: UsageReservation) {
  if (reservation.dailyLimit < 0) return;
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.rpc("refund_ai_call", {
      p_user_id: reservation.userId,
    });
    if (error) console.error(`[usage] refund_failed code=${error.code ?? "unknown"}`);
  } catch {
    console.error("[usage] refund_unavailable");
  }
}

export function usagePayload(reservation: UsageReservation) {
  return {
    plan: reservation.plan,
    remainingCalls: reservation.remainingCalls,
    dailyLimit: reservation.dailyLimit,
    unlimited: reservation.dailyLimit < 0,
    expiresAt: reservation.expiresAt,
  };
}
