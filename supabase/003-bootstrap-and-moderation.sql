-- Run after schema.sql and 002-security-hardening.sql.
-- Backfill accounts that already existed before the profile trigger was installed.
insert into public.profiles (id, email, display_name, avatar_url, role, can_publish)
select
  u.id,
  lower(coalesce(u.email, '')),
  coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(lower(coalesce(u.email,'')), '@', 1)),
  coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture'),
  case when lower(coalesce(u.email,'')) = 'alialghamdi6068@gmail.com' then 'owner' else 'member' end,
  lower(coalesce(u.email,'')) = 'alialghamdi6068@gmail.com'
from auth.users u
on conflict (id) do update set
  email = excluded.email,
  role = case when excluded.email = 'alialghamdi6068@gmail.com' then 'owner' else public.profiles.role end,
  can_publish = case when excluded.email = 'alialghamdi6068@gmail.com' then true else public.profiles.can_publish end;

-- Approving a project also approves its currently pending release versions.
create or replace function public.moderate_project(target_project uuid, next_status text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_manager_or_owner() then raise exception 'Manager permission required'; end if;
  if next_status not in ('approved','rejected','hidden') then raise exception 'Invalid moderation status'; end if;
  update public.projects set status = next_status, updated_at = now() where id = target_project;
  if not found then raise exception 'Project not found'; end if;
  if next_status in ('approved','rejected') then
    update public.project_versions set status = next_status
    where project_id = target_project and status = 'pending';
  end if;
  insert into public.moderation_logs(actor_id, project_id, action, details)
  values (auth.uid(), target_project, 'project_' || next_status, '{}'::jsonb);
end;
$$;
grant execute on function public.moderate_project(uuid, text) to authenticated;

-- Let a creator clean up an unapproved project they own.
drop policy if exists "creators delete own unapproved projects" on public.projects;
create policy "creators delete own unapproved projects" on public.projects for delete to authenticated
using (owner_id = auth.uid() and status in ('pending','rejected'));
