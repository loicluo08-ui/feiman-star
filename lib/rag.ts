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

const INDUSTRY_HINTS: Array<{ industry: string; pattern: RegExp }> = [
  { industry: "医美", pattern: /医美|玻尿酸|肉毒|填充|注射|整形|水光针|光子嫩肤/ },
  { industry: "心理咨询", pattern: /心理|抑郁|焦虑|自杀|轻生|咨询师|情绪危机/ },
  { industry: "律所", pattern: /法律|律师|起诉|仲裁|合同纠纷|劳动争议|离婚|判决/ },
  { industry: "宠物", pattern: /宠物|猫咪|狗狗|猫猫|小狗|疫苗|驱虫|绝育|寄养/ },
  { industry: "健身", pattern: /健身|瑜伽|普拉提|私教|体验课|训练|增肌|减脂/ },
  { industry: "美容", pattern: /美容院|美容师|美甲|美睫|护理|SPA|会员卡/ },
  { industry: "维修", pattern: /维修|故障|上门|家电|空调|洗衣机|工单/ },
  { industry: "房产", pattern: /房产|买房|租房|带看|经纪人|续租|房源/ },
  { industry: "教培", pattern: /教培|课程|家长|孩子|老师|课时|试听|培训班/ },
  { industry: "电商", pattern: /电商|商品|淘宝|拼多多|抖音|详情页|卖点|差评/ },
  { industry: "餐饮", pattern: /餐饮|餐厅|菜品|等位|外卖|过敏原|菜单/ },
  { industry: "自媒体", pattern: /自媒体|小红书|口播|短视频|脚本|标题|完播/ },
];

export function detectIndustry(question: string) {
  return INDUSTRY_HINTS.find((item) => item.pattern.test(question))?.industry ?? null;
}

export async function retrieveDocumentContext(userId: string, question: string) {
  // embedding-2 limits one input to 512 tokens. A 500-character query keeps
  // Chinese questions within the intended P0 request size in normal use.
  const industry = detectIndustry(question);
  const searchQuestion = industry ? `${industry}行业知识：${question}` : question;
  const [embedding] = await createEmbeddings([searchQuestion.slice(0, 500)]);
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
