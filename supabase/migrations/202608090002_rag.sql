create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create table if not exists public.knowledge_files (
  id uuid primary key default gen_random_uuid(),
  user_id varchar(64) not null,
  filename varchar(256) not null,
  mime_type varchar(128) not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  chunk_count integer not null default 0 check (chunk_count >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.documents (
  id bigserial primary key,
  file_id uuid not null references public.knowledge_files(id) on delete cascade,
  user_id varchar(64) not null,
  filename varchar(256) not null,
  content text not null check (length(trim(content)) > 0),
  embedding extensions.vector(1024) not null,
  created_at timestamptz not null default now()
);

create index if not exists knowledge_files_user_created_idx
  on public.knowledge_files (user_id, created_at desc);
create index if not exists documents_user_file_idx
  on public.documents (user_id, file_id);
create index if not exists documents_embedding_hnsw_idx
  on public.documents using hnsw (embedding extensions.vector_cosine_ops);

alter table public.knowledge_files enable row level security;
alter table public.documents enable row level security;

revoke all on table public.knowledge_files from public, anon, authenticated;
revoke all on table public.documents from public, anon, authenticated;
revoke all on sequence public.documents_id_seq from public, anon, authenticated;
grant select, insert, update, delete on table public.knowledge_files to service_role;
grant select, insert, update, delete on table public.documents to service_role;
grant usage, select on sequence public.documents_id_seq to service_role;

create or replace function public.create_knowledge_file(
  p_user_id text,
  p_filename text,
  p_mime_type text,
  p_size_bytes integer
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_file_count integer;
  v_file_id uuid;
begin
  if p_user_id is null or length(trim(p_user_id)) = 0 then
    raise exception 'user_id不能为空';
  end if;
  if length(p_user_id) > 64 then
    raise exception 'user_id长度不能超过64个字符';
  end if;
  if p_filename is null or length(trim(p_filename)) = 0 then
    raise exception '文件名不能为空';
  end if;
  if p_mime_type is null or length(trim(p_mime_type)) = 0 then
    raise exception '文件类型不能为空';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 5242880 then
    raise exception '文件大小必须在1字节到5MB之间';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_user_id));

  select count(*)
  into v_file_count
  from public.knowledge_files as kf
  where kf.user_id = p_user_id;

  if v_file_count >= 10 then
    raise exception '每个用户最多上传10个文档';
  end if;

  insert into public.knowledge_files (user_id, filename, mime_type, size_bytes)
  values (
    p_user_id,
    left(trim(p_filename), 256),
    left(trim(p_mime_type), 128),
    p_size_bytes
  )
  returning id into v_file_id;

  return v_file_id;
end;
$$;

create or replace function public.match_documents(
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
  similarity double precision
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
    1.0::double precision - (
      d.embedding operator(extensions.<=>) query_embedding
    ) as similarity
  from public.documents as d
  where filter_user_id is not null
    and length(trim(filter_user_id)) > 0
    and d.user_id = filter_user_id
    and 1.0::double precision - (
      d.embedding operator(extensions.<=>) query_embedding
    ) >= greatest(
      0.0::double precision,
      least(coalesce(match_threshold, 0.7), 1.0::double precision)
    )
  order by d.embedding operator(extensions.<=>) query_embedding asc
  limit greatest(1, least(coalesce(match_count, 5), 20));
$$;

revoke all on function public.create_knowledge_file(text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.match_documents(extensions.vector, double precision, integer, text)
  from public, anon, authenticated;
grant execute on function public.create_knowledge_file(text, text, text, integer)
  to service_role;
grant execute on function public.match_documents(extensions.vector, double precision, integer, text)
  to service_role;

notify pgrst, 'reload schema';
