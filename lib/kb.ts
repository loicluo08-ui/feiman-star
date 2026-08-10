import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase";

type KnowledgeRow = {
  id: number | string;
  content: string | null;
  industry: string | null;
  filename: string | null;
};

export type KnowledgeMatch = {
  id: string;
  content: string;
  industry: string;
  filename: string;
  relevance: number;
};

export type KnowledgeIndustryStat = {
  industry: string;
  chunks: number;
  files: number;
};

export type SystemKnowledgeStats = {
  chunks: number;
  files: number;
  industries: KnowledgeIndustryStat[];
};

const INDUSTRY_RULES: Array<{ industry: string; pattern: RegExp }> = [
  { industry: "宠物医院", pattern: /宠物医院|宠物诊疗|宠物|猫|狗|疫苗|驱虫|绝育/ },
  { industry: "健身", pattern: /健身|健身卡|健身房|私教|瑜伽|普拉提|训练|增肌|减脂/ },
  { industry: "教培", pattern: /教培|培训班|校外培训|一对一|课时|课程|家长|学生|老师/ },
  { industry: "美发", pattern: /美发|理发|发型|染发|烫发|洗剪吹|造型师/ },
];

const SEARCH_RULES: Array<{ pattern: RegExp; terms: string[] }> = [
  { pattern: /退费|退款|退卡|退钱|解除合同/, terms: ["退费", "退卡", "退款", "消费者权益保护法"] },
  { pattern: /多少钱|价格|价钱|收费|费用|指导价/, terms: ["政府指导价", "收费", "价格"] },
  { pattern: /一对一|一对1|1对1/, terms: ["一对一"] },
  { pattern: /投诉|维权|消法|消费者/, terms: ["消费者权益保护法", "投诉", "维权"] },
  { pattern: /合同|协议|条款/, terms: ["合同", "格式条款"] },
  { pattern: /谈判|协商|沟通/, terms: ["谈判", "协商", "沟通"] },
  { pattern: /情绪|生气|愤怒|焦虑/, terms: ["情绪", "愤怒", "焦虑"] },
  { pattern: /逻辑|推理|谬误/, terms: ["逻辑", "推理", "谬误"] },
  { pattern: /博弈|策略/, terms: ["博弈", "策略"] },
];

const TRIVIAL_QUERY = /^(你好|您好|嗨|哈喽|hello|hi|在吗|谢谢|谢谢你|你是谁|早上好|下午好|晚上好)[！!。.？?～~ ]*$/i;
const CROSS_INDUSTRY_TERMS = new Set(["消费者权益保护法", "合同", "格式条款", "谈判", "协商", "沟通", "情绪", "逻辑", "推理", "谬误", "博弈", "策略"]);

function normalizeQuery(query: string) {
  return query.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 200);
}

function detectKnowledgeIndustry(query: string) {
  return INDUSTRY_RULES.find((item) => item.pattern.test(query))?.industry ?? null;
}

function safeTerm(value: string) {
  return value.replace(/[^A-Za-z0-9\u4e00-\u9fff]/g, "").slice(0, 24);
}

export function extractKnowledgeTerms(query: string) {
  const normalized = normalizeQuery(query);
  if (!normalized || TRIVIAL_QUERY.test(normalized)) return [];

  const terms: string[] = [];
  for (const rule of SEARCH_RULES) {
    if (rule.pattern.test(normalized)) terms.push(...rule.terms);
  }

  const core = safeTerm(
    normalized.replace(/请问|麻烦|帮我|你们|一下|如何|怎么处理|怎么办|怎么|多少钱|是什么|可以吗|能不能|是否|吗|呢|啊/g, ""),
  );
  if (core.length >= 2) terms.push(core);

  return Array.from(new Set(terms.map(safeTerm).filter((term) => term.length >= 2))).slice(0, 8);
}

function countOccurrences(content: string, term: string) {
  if (!term) return 0;
  let count = 0;
  let position = 0;
  while (count < 5) {
    const found = content.indexOf(term, position);
    if (found === -1) break;
    count += 1;
    position = found + term.length;
  }
  return count;
}

function relevanceScore(row: KnowledgeRow, terms: string[], industry: string | null) {
  const content = row.content ?? "";
  let score = industry && row.industry === industry ? 20 : row.industry === "通用" ? 3 : 0;
  for (const term of terms) {
    const occurrences = countOccurrences(content, term);
    if (occurrences > 0) score += term.length + 3 + Math.min(occurrences, 3);
  }
  return score;
}

function relevantExcerpt(content: string, terms: string[]) {
  const matchingTerms = terms
    .filter((term) => content.includes(term))
    .sort((left, right) => right.length - left.length);
  const index = matchingTerms.length ? content.indexOf(matchingTerms[0]) : 0;
  const start = Math.max(0, index - 220);
  const end = Math.min(content.length, index + 680);
  return content.slice(start, end).trim();
}

async function queryByTerm(term: string, industry: string | null) {
  const admin = createSupabaseAdminClient();
  let request = admin
    .from("documents")
    .select("id,content,industry,filename")
    .eq("user_id", "system")
    .eq("is_system", true)
    .ilike("content", `%${term}%`)
    .limit(10);

  if (industry) request = request.eq("industry", industry);
  const { data, error } = await request;
  if (error) throw error;
  return (data ?? []) as KnowledgeRow[];
}

/**
 * 使用 Supabase ilike 对系统预置知识库做全文关键词检索。
 * 当前云端 embedding 是零向量，因此这里不会调用向量检索。
 */
export async function searchKnowledgeWithMetadata(query: string, limit = 5): Promise<KnowledgeMatch[]> {
  const normalized = normalizeQuery(query);
  const terms = extractKnowledgeTerms(normalized);
  if (!terms.length) return [];

  const industry = detectKnowledgeIndustry(normalized);
  const searches = terms.map((term) => queryByTerm(term, industry));
  if (industry) {
    for (const term of terms.filter((item) => CROSS_INDUSTRY_TERMS.has(item))) {
      searches.push(queryByTerm(term, "通用"));
    }
  }

  const rows = (await Promise.all(searches)).flat();
  const uniqueRows = new Map<string, KnowledgeRow>();
  for (const row of rows) uniqueRows.set(String(row.id), row);

  return Array.from(uniqueRows.values())
    .map((row) => ({ row, relevance: relevanceScore(row, terms, industry) }))
    .sort((left, right) => right.relevance - left.relevance)
    .slice(0, Math.max(1, Math.min(limit, 10)))
    .map(({ row, relevance }) => ({
      id: String(row.id),
      content: relevantExcerpt(row.content ?? "", terms),
      industry: row.industry || "通用",
      filename: row.filename || "系统知识库",
      relevance,
    }));
}

export async function searchKnowledge(query: string, limit = 5): Promise<string[]> {
  const matches = await searchKnowledgeWithMetadata(query, limit);
  return matches.map((match) => `[${match.industry}｜${match.filename}]\n${match.content}`);
}

export async function getSystemKnowledgeStats(): Promise<SystemKnowledgeStats> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("documents")
    .select("industry,filename")
    .eq("user_id", "system")
    .eq("is_system", true)
    .range(0, 4_999);
  if (error) throw error;

  const industryMap = new Map<string, { chunks: number; files: Set<string> }>();
  const allFiles = new Set<string>();
  for (const row of data ?? []) {
    const industry = row.industry || "通用";
    const current = industryMap.get(industry) ?? { chunks: 0, files: new Set<string>() };
    current.chunks += 1;
    if (row.filename) {
      current.files.add(row.filename);
      allFiles.add(row.filename);
    }
    industryMap.set(industry, current);
  }

  const preferredOrder = ["通用", "健身", "教培", "宠物医院", "美发"];
  const industries = Array.from(industryMap.entries())
    .map(([industry, value]) => ({ industry, chunks: value.chunks, files: value.files.size }))
    .sort((left, right) => {
      const leftIndex = preferredOrder.indexOf(left.industry);
      const rightIndex = preferredOrder.indexOf(right.industry);
      return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
    });

  return { chunks: data?.length ?? 0, files: allFiles.size, industries };
}
