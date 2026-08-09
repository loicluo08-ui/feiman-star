import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const SYSTEM_OWNER = "system";
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 100;
const CONFIRMED = process.argv.includes("--confirm");
const knowledgePath = resolve(process.cwd(), "data/knowledge_base_12_industries.md");
const fewshotPath = resolve(process.cwd(), "data/fewshot_cases.json");
const insightsPath = resolve(process.cwd(), "data/market_insights.json");

const industrySections = [
  { industry: "教培", start: "## 一、教培客服知识库", end: "## 二、电商知识库" },
  { industry: "电商", start: "## 二、电商知识库", end: "## 三、医美咨询知识库" },
  { industry: "医美", start: "## 三、医美咨询知识库", end: "## 四、餐饮营销知识库" },
  { industry: "餐饮", start: "## 四、餐饮营销知识库", end: "## 五、律所/法律咨询知识库" },
  { industry: "律所", start: "## 五、律所/法律咨询知识库", end: "## 六、自媒体内容知识库" },
  { industry: "自媒体", start: "## 六、自媒体内容知识库", end: "# 第二部分：固定提示词模板包" },
  { industry: "健身", start: "# 任务2：费曼星知识库扩展 — 健身行业", end: "# 任务2续：知识库扩展" },
  { industry: "美容", start: "# 行业1：美容", end: "# 行业2：宠物" },
  { industry: "宠物", start: "# 行业2：宠物", end: "# 行业3：维修" },
  { industry: "维修", start: "# 行业3：维修", end: "# 行业4：房产" },
  { industry: "房产", start: "# 行业4：房产", end: "# 行业5：心理咨询" },
  { industry: "心理咨询", start: "# 行业5：心理咨询", end: "## 五行业汇总对比" },
];

function slidingChunks(input) {
  const text = input.replace(/\r\n?/g, "\n").trim();
  const output = [];
  const step = CHUNK_SIZE - CHUNK_OVERLAP;
  for (let start = 0; start < text.length; start += step) {
    const content = text.slice(start, start + CHUNK_SIZE).trim();
    if (content) output.push(content);
    if (start + CHUNK_SIZE >= text.length) break;
  }
  return output;
}

function extractIndustrySections(markdown) {
  return industrySections.map((definition) => {
    const start = markdown.indexOf(definition.start);
    if (start < 0) throw new Error(`找不到行业起点：${definition.industry}`);
    const end = markdown.indexOf(definition.end, start + definition.start.length);
    if (end < 0) throw new Error(`找不到行业终点：${definition.industry}`);
    const content = markdown.slice(start, end).trim();
    return { ...definition, content, chunks: slidingChunks(content) };
  });
}

async function createEmbeddings(input) {
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) throw new Error("缺少 ZHIPU_API_KEY");
  const response = await fetch("https://open.bigmodel.cn/api/paas/v4/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "embedding-2", input }),
  });
  if (!response.ok) throw new Error(`智谱向量化失败：HTTP ${response.status}`);
  const payload = await response.json();
  const items = Array.isArray(payload.data) ? payload.data.sort((a, b) => a.index - b.index) : [];
  if (items.length !== input.length || items.some((item) => item.embedding?.length !== 1024)) {
    throw new Error("智谱返回了无效的1024维向量");
  }
  return items.map((item) => item.embedding);
}

async function embedInBatches(chunks, batchSize = 8) {
  const output = [];
  for (let index = 0; index < chunks.length; index += batchSize) {
    output.push(...(await createEmbeddings(chunks.slice(index, index + batchSize))));
  }
  return output;
}

function mapFewshotCase(item) {
  return {
    case_id: item.case_id,
    industry: item.industry,
    scenario: item.requirement,
    input: JSON.stringify({ client_background: item.client_background, requirement: item.requirement }, null, 2),
    output: JSON.stringify({
      ai_solution: item.ai_solution,
      implementation: item.implementation,
      results: item.results,
      client_feedback: item.client_feedback,
    }, null, 2),
    key_lesson: item.key_lesson,
  };
}

function inferInsightIndustry(item) {
  if (item.industry) return item.industry;
  if (item.source_platform === "教培CRM") return "教培";
  if (item.source_platform === "闲鱼淘宝") return "电商";
  return "通用AI客服";
}

function mapMarketInsight(item) {
  const details = [
    item.original_quote,
    item.user_cares_about?.length ? `用户关注：${item.user_cares_about.join("、")}` : "",
    item.price_info ? `价格信息：${item.price_info}` : "",
  ].filter(Boolean);
  return {
    id: item.eval_id,
    platform: item.source_platform,
    industry: inferInsightIndustry(item),
    insight_text: details.join("\n"),
    source_url: item.source_url || null,
    sentiment: item.sentiment,
  };
}

const [knowledgeMarkdown, fewshotRaw, insightsRaw] = await Promise.all([
  readFile(knowledgePath, "utf8"),
  readFile(fewshotPath, "utf8"),
  readFile(insightsPath, "utf8"),
]);
const industries = extractIndustrySections(knowledgeMarkdown);
const fewshotCases = JSON.parse(fewshotRaw).map(mapFewshotCase);
const marketInsights = JSON.parse(insightsRaw).map(mapMarketInsight);

console.table(industries.map((item) => ({ industry: item.industry, characters: item.content.length, chunks: item.chunks.length })));
console.log(`预检：12个行业，${industries.reduce((sum, item) => sum + item.chunks.length, 0)}个知识片段，${fewshotCases.length}条少样本，${marketInsights.length}条市场情报。`);

if (!CONFIRMED) {
  console.log("当前为预检模式；数据库迁移执行后加 --confirm 正式导入。");
  process.exit(0);
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("缺少Supabase服务端环境变量");
}
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { error: cleanupError } = await admin.from("knowledge_files").delete().eq("user_id", SYSTEM_OWNER);
if (cleanupError) throw cleanupError;
const { error: fewshotCleanupError } = await admin.from("fewshot_cases").delete().neq("case_id", "");
if (fewshotCleanupError) throw fewshotCleanupError;
const { error: insightCleanupError } = await admin.from("market_insights").delete().neq("id", "");
if (insightCleanupError) throw insightCleanupError;

for (const item of industries) {
  const embeddings = await embedInBatches(item.chunks);
  const { data: file, error: fileError } = await admin
    .from("knowledge_files")
    .insert({
      user_id: SYSTEM_OWNER,
      filename: `系统预置知识库-${item.industry}.md`,
      mime_type: "text/markdown",
      size_bytes: Math.max(Buffer.byteLength(item.content, "utf8"), 1),
      chunk_count: item.chunks.length,
    })
    .select("id")
    .single();
  if (fileError || !file) throw fileError ?? new Error("系统知识文件创建失败");

  const rows = item.chunks.map((content, index) => ({
    file_id: file.id,
    user_id: SYSTEM_OWNER,
    filename: `系统知识库/${item.industry}.md`,
    content,
    embedding: embeddings[index],
    is_system: true,
    industry: item.industry,
  }));
  const { error: documentError } = await admin.from("documents").insert(rows);
  if (documentError) throw documentError;
  console.log(`已导入${item.industry}：${rows.length}个片段`);
}

const { error: fewshotError } = await admin.from("fewshot_cases").insert(fewshotCases);
if (fewshotError) throw fewshotError;
for (let index = 0; index < marketInsights.length; index += 100) {
  const { error } = await admin.from("market_insights").insert(marketInsights.slice(index, index + 100));
  if (error) throw error;
}

const [{ count: documentCount }, { count: fewshotCount }, { count: insightCount }] = await Promise.all([
  admin.from("documents").select("id", { count: "exact", head: true }).eq("is_system", true),
  admin.from("fewshot_cases").select("case_id", { count: "exact", head: true }),
  admin.from("market_insights").select("id", { count: "exact", head: true }),
]);
console.log(`导入完成：系统知识${documentCount}片、少样本${fewshotCount}条、市场情报${insightCount}条。`);
