import { randomBytes, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient, SupabaseConfigError } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  count: z.number().int().min(1).max(100),
  plan: z.enum(["lite", "pro", "vip"]),
});

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function secureTokenMatches(candidate: string, expected: string) {
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function codePart() {
  const bytes = randomBytes(5);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function generateCodes(count: number) {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(`FS-${codePart()}-${codePart()}`);
  return Array.from(codes);
}

export async function POST(request: NextRequest) {
  const adminToken = process.env.ADMIN_TOKEN;
  const suppliedToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!adminToken) {
    return NextResponse.json({ error: "管理员服务尚未配置" }, { status: 503 });
  }
  if (!secureTokenMatches(suppliedToken, adminToken)) {
    return NextResponse.json({ error: "无管理员权限" }, { status: 401 });
  }

  const input = requestSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: "参数不正确" }, { status: 400 });

  try {
    const codes = generateCodes(input.data.count);
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("codes").insert(
      codes.map((code) => ({ code, plan: input.data.plan })),
    );
    if (error) {
      console.error(`[admin-codes] insert_failed code=${error.code ?? "unknown"}`);
      return NextResponse.json({ error: "兑换码生成失败" }, { status: 503 });
    }
    return NextResponse.json(
      { success: true, plan: input.data.plan, codes },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const status = error instanceof SupabaseConfigError ? 503 : 500;
    return NextResponse.json({ error: "管理员服务尚未配置" }, { status });
  }
}
