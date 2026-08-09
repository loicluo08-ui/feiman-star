import "server-only";

import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { AUTH_ACCESS_COOKIE } from "@/lib/auth-cookies";
import {
  createSupabaseUserClient,
  isSupabaseConfigured,
} from "@/lib/supabase";

export type AuthenticatedUser = {
  user: User;
  accessToken: string;
};

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  if (!isSupabaseConfigured()) return null;

  const accessToken = cookies().get(AUTH_ACCESS_COOKIE)?.value;
  if (!accessToken) return null;

  const supabase = createSupabaseUserClient(accessToken);
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) return null;

  return { user: data.user, accessToken };
}
