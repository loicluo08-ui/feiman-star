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

  select *
  into v_plan
  from public.user_plans
  where user_id = p_user_id
  for update;

  if v_plan.plan = 'vip' then
    return query
      select v_plan.plan::text, -1, -1, v_plan.expires_at;
    return;
  end if;

  if v_plan.remaining_calls <= 0 then
    raise exception 'quota_exhausted';
  end if;

  update public.user_plans as p
  set remaining_calls = p.remaining_calls - 1,
      updated_at = now()
  where p.user_id = p_user_id
  returning p.plan::text,
            p.remaining_calls,
            p.daily_limit,
            p.expires_at
  into plan, remaining_calls, daily_limit, expires_at;

  return next;
end;
$$;
