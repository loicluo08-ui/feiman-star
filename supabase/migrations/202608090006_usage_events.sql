create table if not exists public.ai_usage_events (
  id bigserial primary key,
  user_id varchar(64) not null,
  endpoint varchar(64) not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_events_user_created_idx
  on public.ai_usage_events (user_id, created_at desc);
create index if not exists ai_usage_events_created_idx
  on public.ai_usage_events (created_at desc);

alter table public.ai_usage_events enable row level security;
revoke all on table public.ai_usage_events from public, anon, authenticated;
revoke all on sequence public.ai_usage_events_id_seq from public, anon, authenticated;
grant select, insert, delete on table public.ai_usage_events to service_role;
grant usage, select on sequence public.ai_usage_events_id_seq to service_role;

notify pgrst, 'reload schema';
