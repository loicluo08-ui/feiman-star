create table if not exists public.codes (
  id bigserial primary key,
  code varchar(32) unique not null,
  plan varchar(16) not null check (plan in ('lite', 'pro', 'vip')),
  is_used boolean not null default false,
  used_by varchar(64),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.user_plans (
  user_id varchar(64) primary key,
  plan varchar(16) not null default 'free' check (plan in ('free', 'lite', 'pro', 'vip')),
  remaining_calls integer not null default 15,
  daily_limit integer not null default 15,
  expires_at timestamptz,
  last_reset_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.codes enable row level security;
alter table public.user_plans enable row level security;

revoke all on public.codes from anon, authenticated;
revoke all on public.user_plans from anon, authenticated;
grant all on public.codes to service_role;
grant all on public.user_plans to service_role;
grant usage, select on sequence public.codes_id_seq to service_role;

create or replace function public.plan_daily_limit(p_plan text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case lower(p_plan)
    when 'free' then 15
    when 'lite' then 50
    when 'pro' then 200
    when 'vip' then -1
    else 15
  end;
$$;

create or replace function public.normalize_user_plan(p_user_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.user_plans%rowtype;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if p_user_id is null or length(trim(p_user_id)) = 0 then
    raise exception 'unauthorized';
  end if;

  insert into public.user_plans (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select * into v_plan
  from public.user_plans
  where user_id = p_user_id
  for update;

  if v_plan.plan <> 'free' and v_plan.expires_at is not null and v_plan.expires_at <= now() then
    update public.user_plans
    set plan = 'free',
        daily_limit = public.plan_daily_limit('free'),
        remaining_calls = public.plan_daily_limit('free'),
        expires_at = null,
        last_reset_at = now(),
        updated_at = now()
    where user_id = p_user_id;
    return;
  end if;

  if (v_plan.last_reset_at at time zone 'Asia/Shanghai')::date < v_today then
    update public.user_plans
    set remaining_calls = public.plan_daily_limit(v_plan.plan),
        daily_limit = public.plan_daily_limit(v_plan.plan),
        last_reset_at = now(),
        updated_at = now()
    where user_id = p_user_id;
  end if;
end;
$$;

create or replace function public.get_my_plan()
returns table (
  plan text,
  remaining_calls integer,
  daily_limit integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id text := auth.uid()::text;
begin
  if v_user_id is null then raise exception 'unauthorized'; end if;
  perform public.normalize_user_plan(v_user_id);
  return query
    select p.plan::text, p.remaining_calls, p.daily_limit, p.expires_at
    from public.user_plans p
    where p.user_id = v_user_id;
end;
$$;

create or replace function public.redeem_code(p_code text)
returns table (
  plan text,
  remaining_calls integer,
  daily_limit integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id text := auth.uid()::text;
  v_code public.codes%rowtype;
  v_limit integer;
begin
  if v_user_id is null then raise exception 'unauthorized'; end if;

  select * into v_code
  from public.codes c
  where c.code = upper(trim(p_code))
  for update;

  if not found then raise exception 'invalid_code'; end if;
  if v_code.is_used then raise exception 'code_already_used'; end if;

  v_limit := public.plan_daily_limit(v_code.plan);

  update public.codes
  set is_used = true, used_by = v_user_id, used_at = now()
  where id = v_code.id;

  insert into public.user_plans (
    user_id, plan, remaining_calls, daily_limit, expires_at, last_reset_at, updated_at
  ) values (
    v_user_id, v_code.plan, v_limit, v_limit, now() + interval '30 days', now(), now()
  )
  on conflict (user_id) do update
  set plan = excluded.plan,
      remaining_calls = excluded.remaining_calls,
      daily_limit = excluded.daily_limit,
      expires_at = excluded.expires_at,
      last_reset_at = excluded.last_reset_at,
      updated_at = excluded.updated_at;

  return query
    select p.plan::text, p.remaining_calls, p.daily_limit, p.expires_at
    from public.user_plans p
    where p.user_id = v_user_id;
end;
$$;

create or replace function public.reserve_ai_call(p_user_id text)
returns table (
  plan text,
  remaining_calls integer,
  daily_limit integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.user_plans%rowtype;
begin
  perform public.normalize_user_plan(p_user_id);
  select * into v_plan from public.user_plans where user_id = p_user_id for update;

  if v_plan.plan = 'vip' then
    return query select v_plan.plan::text, -1, -1, v_plan.expires_at;
    return;
  end if;

  if v_plan.remaining_calls <= 0 then raise exception 'quota_exhausted'; end if;

  update public.user_plans
  set remaining_calls = remaining_calls - 1, updated_at = now()
  where user_id = p_user_id
  returning user_plans.plan::text, user_plans.remaining_calls,
            user_plans.daily_limit, user_plans.expires_at
  into plan, remaining_calls, daily_limit, expires_at;
  return next;
end;
$$;

create or replace function public.refund_ai_call(p_user_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.user_plans
  set remaining_calls = least(daily_limit, remaining_calls + 1), updated_at = now()
  where user_id = p_user_id and plan <> 'vip' and remaining_calls < daily_limit;
end;
$$;

revoke all on function public.plan_daily_limit(text) from public, anon, authenticated;
revoke all on function public.normalize_user_plan(text) from public, anon, authenticated;
revoke all on function public.get_my_plan() from public, anon;
revoke all on function public.redeem_code(text) from public, anon;
revoke all on function public.reserve_ai_call(text) from public, anon, authenticated;
revoke all on function public.refund_ai_call(text) from public, anon, authenticated;

grant execute on function public.get_my_plan() to authenticated;
grant execute on function public.redeem_code(text) to authenticated;
grant execute on function public.reserve_ai_call(text) to service_role;
grant execute on function public.refund_ai_call(text) to service_role;
