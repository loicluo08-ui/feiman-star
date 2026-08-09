import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase";
import { createEmbeddings } from "@/lib/zhipu";

export type RetrievedChunk = {
  id: number;
  file_id: string;
  filename: string;
  content: string;
  similarity: number;
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
