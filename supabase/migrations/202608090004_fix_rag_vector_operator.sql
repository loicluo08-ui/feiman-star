drop function if exists public.match_documents(
  extensions.vector,
  double precision,
  integer,
  text
);

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
