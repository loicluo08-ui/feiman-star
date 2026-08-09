create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create table if not exists public.knowledge_files (
  id uuid primary key default gen_random_uuid(),
  user_id varchar(64) not null,
  filename varchar(256) not null,
  mime_type varchar(128) not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  chunk_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.documents (
  id bigserial primary key,
  file_id uuid not null references public.knowledge_files(id) on delete cascade,
  user_id varchar(64) not null,
  filename varchar(256) not null,
  content text not null,
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

revoke all on public.knowledge_files from anon, authenticated;
revoke all on public.documents from anon, authenticated;
grant all on public.knowledge_files to service_role;
grant all on public.documents to service_role;
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
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_count integer;
begin
  if p_user_id is null or length(trim(p_user_id)) = 0 then raise exception 'unauthorized'; end if;
  if p_size_bytes <= 0 or p_size_bytes > 5242880 then raise exception 'invalid_file_size'; end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id));
  select count(*) into v_count from public.knowledge_files where user_id = p_user_id;
  if v_count >= 10 then raise exception 'document_limit_reached'; end if;

  insert into public.knowledge_files (user_id, filename, mime_type, size_bytes)
  values (p_user_id, left(p_filename, 256), left(p_mime_type, 128), p_size_bytes)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.match_documents(
  query_embedding extensions.vector(1024),
  match_threshold float,
  match_count integer,
  filter_user_id text
)
returns table (
  id bigint,
  file_id uuid,
  filename text,
  content text,
  similarity float
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    d.id,
    d.file_id,
    d.filename::text,
    d.content,
    1 - (d.embedding <=> query_embedding) as similarity
  from public.documents d
  where d.user_id = filter_user_id
    and 1 - (d.embedding <=> query_embedding) >= match_threshold
  order by d.embedding <=> query_embedding asc
  limit least(greatest(match_count, 1), 20);
$$;

revoke all on function public.create_knowledge_file(text, text, text, integer) from public, anon, authenticated;
revoke all on function public.match_documents(extensions.vector, float, integer, text) from public, anon, authenticated;
grant execute on function public.create_knowledge_file(text, text, text, integer) to service_role;
grant execute on function public.match_documents(extensions.vector, float, integer, text) to service_role;
