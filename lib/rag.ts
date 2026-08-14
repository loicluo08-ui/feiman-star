import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase";

export type FewshotCase = {
  case_id: string;
  industry: string;
  scenario: string;
  input: string;
  output: string;
  key_lesson: string;
};

export async function retrieveFewshotCases(industry: string | null, limit = 3) {
  if (!industry) return [];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("fewshot_cases")
    .select("case_id,industry,scenario,input,output,key_lesson")
    .eq("industry", industry)
    .order("case_id", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 3)));
  if (error) throw error;
  return (data ?? []) as FewshotCase[];
}
