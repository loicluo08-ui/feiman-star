import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase";
import { createEmbeddings } from "@/lib/zhipu";

export type RetrievedChunk = {
  id: number;
  file_id: string;
  filename: string;
  content: string;
  similarity: number;
  is_system: boolean;
  industry: string | null;
};

export type FewshotCase = {
  case_id: string;
  industry: string;
  scenario: string;
  input: string;
  output: string;
  key_lesson: string;
};

export async function retrieveDocumentContext(userId: string, question: string) {
  // embedding-2 limits one input to 512 tokens. A 500-character query keeps
  // Chinese questions within the intended P0 request size in normal use.
  const [embedding] = await createEmbeddings([question.slice(0, 500)]);
  if (!embedding) return [];

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("match_documents", {
    query_embedding: embedding,
    match_threshold: 0.7,
    match_count: 5,
    filter_user_id: userId,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as RetrievedChunk[];
}

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
