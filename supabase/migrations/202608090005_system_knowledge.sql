begin;

-- 清理上一次未完成试验留下的旧字段与关联表。
drop function if exists public.match_documents(
  extensions.vector,
  double precision,
  integer,
  text
);
drop trigger if exists associate_system_documents_after_user_created on auth.users;
drop trigger if exists associate_users_after_system_document_created on public.documents;
drop function if exists public.on_auth_user_created_associate_system_documents();
drop function if exists public.on_system_document_created_associate_users();
drop function if exists public.associate_system_documents_for_user(uuid);
drop table if exists public.user_system_documents;

delete from public.knowledge_files
where user_id in ('__system__', 'system');

alter table public.documents drop column if exists system;
alter table public.documents drop constraint if exists documents_industry_check;
alter table public.documents add column if not exists is_system boolean not null default false;
alter table public.documents add column if not exists industry varchar(32);
alter table public.documents alter column industry type varchar(32);

create index if not exists documents_system_industry_idx
  on public.documents (is_system, industry)
  where is_system = true;

create table if not exists public.fewshot_cases (
  case_id varchar(64) primary key,
  industry varchar(32) not null,
  scenario text not null,
  input text not null,
  output text not null,
  key_lesson text not null,
  created_at timestamptz not null default now()
);

create index if not exists fewshot_cases_industry_idx
  on public.fewshot_cases (industry, case_id);

create table if not exists public.market_insights (
  id varchar(64) primary key,
  platform varchar(64) not null,
  industry varchar(64) not null,
  insight_text text not null,
  source_url text,
  sentiment varchar(16) not null check (sentiment in ('positive', 'neutral', 'negative', 'mixed')),
  created_at timestamptz not null default now()
);

create index if not exists market_insights_filters_idx
  on public.market_insights (platform, industry, sentiment);

alter table public.fewshot_cases enable row level security;
alter table public.market_insights enable row level security;
revoke all on table public.fewshot_cases from public, anon, authenticated;
revoke all on table public.market_insights from public, anon, authenticated;
grant select, insert, update, delete on table public.fewshot_cases to service_role;
grant select, insert, update, delete on table public.market_insights to service_role;

-- 所有登录用户都能通过服务端检索系统知识；私有文档仍按 user_id 隔离。
create function public.match_documents(
  query_embedding extensions.vector(1024),
  match_threshold double precision default 0.7,
  match_count integer default 5,
  filter_user_id text default null
)
returns table (
  id bigint,
  file_id uuid,
  filename varchar(256),
  content text,
  similarity double precision,
  is_system boolean,
  industry varchar(32)
)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select
    d.id,
    d.file_id,
    d.filename,
    d.content,
    -- pgvector余弦距离范围为[0,2]，归一化成[0,1]后再应用0.7阈值。
    1.0::double precision - (
      (d.embedding operator(extensions.<=>) query_embedding) / 2.0::double precision
    ) as similarity,
    d.is_system,
    d.industry
  from public.documents as d
  where filter_user_id is not null
    and length(trim(filter_user_id)) > 0
    and (d.is_system = true or d.user_id = filter_user_id)
    and 1.0::double precision - (
      (d.embedding operator(extensions.<=>) query_embedding) / 2.0::double precision
    ) >= greatest(
      0.0::double precision,
      least(coalesce(match_threshold, 0.7), 1.0::double precision)
    )
  order by d.embedding operator(extensions.<=>) query_embedding asc
  limit greatest(1, least(coalesce(match_count, 5), 20));
$$;

revoke all on function public.match_documents(
  extensions.vector,
  double precision,
  integer,
  text
) from public, anon, authenticated;
grant execute on function public.match_documents(
  extensions.vector,
  double precision,
  integer,
  text
) to service_role;

notify pgrst, 'reload schema';

commit;
