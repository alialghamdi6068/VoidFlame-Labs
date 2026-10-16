-- Run after 003-bootstrap-and-moderation.sql.
-- Removing a manager also removes the publishing grant they received with that role.
create or replace function public.set_manager_role(target_email text, make_manager boolean)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'owner') then
    raise exception 'Owner permission required';
  end if;
  update public.profiles
  set role = case when make_manager then 'manager' else 'member' end,
      can_publish = case when make_manager then true else false end,
      updated_at = now()
  where lower(email) = lower(trim(target_email)) and role <> 'owner';
  if not found then raise exception 'User not found or target is owner'; end if;
  insert into public.moderation_logs(actor_id, target_user_id, action, details)
  select auth.uid(), id, case when make_manager then 'promote_manager' else 'demote_manager' end,
    jsonb_build_object('email', lower(trim(target_email)))
  from public.profiles where lower(email) = lower(trim(target_email));
end;
$$;
grant execute on function public.set_manager_role(text, boolean) to authenticated;
