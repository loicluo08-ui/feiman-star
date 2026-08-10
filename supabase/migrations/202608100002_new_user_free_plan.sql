begin;

create or replace function public.create_free_plan_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.user_plans (
    user_id, plan, remaining_calls, daily_limit, expires_at, last_reset_at, updated_at
  ) values (
    new.id::text, 'free', 15, 15, null, now(), now()
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_free_plan_after_user_signup on auth.users;
create trigger create_free_plan_after_user_signup
  after insert on auth.users
  for each row execute function public.create_free_plan_for_new_user();

-- 为历史上通过其他入口创建、但尚未产生套餐行的用户补齐体验套餐。
insert into public.user_plans (
  user_id, plan, remaining_calls, daily_limit, expires_at, last_reset_at, updated_at
)
select id::text, 'free', 15, 15, null, now(), now()
from auth.users
on conflict (user_id) do nothing;

revoke all on function public.create_free_plan_for_new_user() from public, anon, authenticated;

commit;
