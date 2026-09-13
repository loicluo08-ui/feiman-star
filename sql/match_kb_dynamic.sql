-- P2③语义检索函数（在Supabase SQL Editor执行一次，Run即可）
-- 作用：selectDynamicKB的向量相似查询走这个RPC；未创建时费曼星自动走关键词路由（静默降级）
create or replace function match_kb_dynamic(
  query_embedding vector(1024),
  match_count int default 6,
  max_distance float default 0.75
)
returns table (
  id text,
  type text,
  keywords text[],
  content text,
  source text,
  created date,
  expires date
)
language sql stable
as $$
  select e.id, e.type, e.keywords, e.content, e.source, e.created, e.expires
  from kb_dynamic e
  where e.embedding is not null
    and (e.expires is null or e.expires >= current_date)
    and e.embedding <=> query_embedding < max_distance
  order by e.embedding <=> query_embedding
  limit match_count;
$$;
