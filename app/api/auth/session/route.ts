import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getAuthenticatedUser();
  return NextResponse.json(
    auth
      ? { authenticated: true, user: { id: auth.user.id, phone: auth.user.phone } }
      : { authenticated: false },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
