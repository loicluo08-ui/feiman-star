begin;

create table if not exists public.tool_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tool varchar(32) not null check (tool in ('script-generator', 'product-copy')),
  rating smallint not null check (rating in (-1, 1)),
  created_at timestamptz not null default now()
);

create index if not exists tool_feedback_tool_created_idx
  on public.tool_feedback (tool, created_at desc);
create index if not exists tool_feedback_user_created_idx
  on public.tool_feedback (user_id, created_at desc);

alter table public.tool_feedback enable row level security;
revoke all on table public.tool_feedback from public, anon, authenticated;
grant select, insert, update, delete on table public.tool_feedback to service_role;

commit;
