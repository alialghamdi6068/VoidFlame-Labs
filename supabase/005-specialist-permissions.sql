-- VoidFlame Labs: separate publishing, security review, and content moderation permissions.
-- Run after 004-manager-demotion.sql.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner','manager','security_reviewer','content_moderator','developer','member','suspended'));

alter table public.projects
  add column if not exists content_review_status text not null default 'pending'
    check (content_review_status in ('pending','approved','rejected'));

alter table public.project_versions
  add column if not exists security_status text not null default 'pending_scan'
    check (security_status in ('pending_scan','clean','flagged','rejected')),
  add column if not exists security_review_notes text not null default '',
  add column if not exists security_reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists security_reviewed_at timestamptz;

create or replace function public.can_review_security()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.role in ('owner','manager','security_reviewer')
); $$;

create or replace function public.can_moderate_content()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.role in ('owner','manager','content_moderator')
); $$;

-- Managers can assign specialist roles, but only the owner can appoint/remove managers.
create or replace function public.set_staff_role(target_email text, target_role text)
returns void language plpgsql security definer set search_path = public
as $$
declare target public.profiles%rowtype;
begin
  if not public.is_manager_or_owner() then raise exception 'Manager permission required'; end if;
  if target_role not in ('security_reviewer','content_moderator','developer','member','suspended') then
    raise exception 'Invalid staff role';
  end if;
  select * into target from public.profiles where lower(email) = lower(trim(target_email)) for update;
  if not found then raise exception 'User not found. Ask them to sign in once first.'; end if;
  if target.role in ('owner','manager') then raise exception 'Only the owner may change manager roles, and owner role cannot be changed here'; end if;
  update public.profiles
  set role = target_role,
      can_publish = case when target_role = 'developer' then true
                         when target_role in ('member','suspended') then false
                         else can_publish end,
      updated_at = now()
  where id = target.id;
  insert into public.moderation_logs(actor_id,target_user_id,action,details)
  values (auth.uid(),target.id,'set_staff_role',jsonb_build_object('role',target_role,'email',target.email));
end;
$$;

create or replace function public.security_review_version(target_version uuid, next_security_status text, review_notes text default '')
returns void language plpgsql security definer set search_path = public
as $$
declare v public.project_versions%rowtype;
begin
  if not public.can_review_security() then raise exception 'Security reviewer permission required'; end if;
  if next_security_status not in ('clean','flagged','rejected') then raise exception 'Invalid security status'; end if;
  select * into v from public.project_versions where id = target_version for update;
  if not found then raise exception 'Version not found'; end if;
  update public.project_versions
  set security_status = next_security_status,
      security_review_notes = left(coalesce(review_notes,''),4000),
      security_reviewed_by = auth.uid(),
      security_reviewed_at = now(),
      status = case when next_security_status in ('flagged','rejected') then 'rejected' else status end
  where id = target_version;
  if next_security_status in ('flagged','rejected') then
    update public.projects set status = 'rejected', content_review_status = 'rejected', updated_at = now()
    where id = v.project_id and status <> 'approved';
  end if;
  insert into public.moderation_logs(actor_id,project_id,action,details)
  values (auth.uid(),v.project_id,'security_'||next_security_status,
    jsonb_build_object('version_id',target_version,'notes',left(coalesce(review_notes,''),4000)));
end;
$$;

-- A content decision cannot publish a project unless every release has passed security review.
create or replace function public.moderate_project(target_project uuid, next_status text)
returns void language plpgsql security definer set search_path = public
as $$
declare project_row public.projects%rowtype;
begin
  if not public.can_moderate_content() then raise exception 'Content moderator permission required'; end if;
  if next_status not in ('approved','rejected','hidden') then raise exception 'Invalid moderation status'; end if;
  select * into project_row from public.projects where id = target_project for update;
  if not found then raise exception 'Project not found'; end if;
  if next_status = 'approved' and not exists (
    select 1 from public.project_versions v
    where v.project_id = target_project
  ) then raise exception 'Cannot approve a project without a release version'; end if;
  if next_status = 'approved' and exists (
    select 1 from public.project_versions v
    where v.project_id = target_project and v.security_status <> 'clean'
  ) then raise exception 'Security review is incomplete or failed for one or more releases'; end if;
  update public.projects set
    status = case when next_status = 'approved' then 'approved' else next_status end,
    content_review_status = case when next_status = 'approved' then 'approved'
                                 when next_status = 'rejected' then 'rejected'
                                 else content_review_status end,
    updated_at = now()
  where id = target_project;
  if next_status in ('approved','rejected') then
    update public.project_versions set status = next_status
    where project_id = target_project and security_status = 'clean' and status = 'pending';
  end if;
  insert into public.moderation_logs(actor_id,project_id,action,details)
  values (auth.uid(),target_project,'project_'||next_status,'{}'::jsonb);
end;
$$;

-- Specialist staff can inspect submissions; only security reviewers can change security verdicts,
-- and only content moderators/managers can make content decisions.
drop policy if exists "profiles read own or staff" on public.profiles;
create policy "profiles read own or staff" on public.profiles for select to authenticated
using (id = auth.uid() or public.is_manager_or_owner());

drop policy if exists "approved projects are public" on public.projects;
create policy "approved projects are public" on public.projects for select
using (status = 'approved' or owner_id = auth.uid() or public.is_manager_or_owner()
  or public.can_review_security() or public.can_moderate_content());

drop policy if exists "versions visible with approved project or to owner staff" on public.project_versions;
create policy "versions visible with approved project or to owner staff" on public.project_versions for select
using (
  (status = 'approved' and exists (select 1 from public.projects p where p.id = project_id and p.status = 'approved'))
  or created_by = auth.uid() or public.is_manager_or_owner()
  or public.can_review_security() or public.can_moderate_content()
);

drop policy if exists "staff moderate versions" on public.project_versions;
create policy "staff moderate versions" on public.project_versions for update to authenticated
using (public.is_manager_or_owner()) with check (public.is_manager_or_owner());

drop policy if exists "staff or uploader reads project files" on storage.objects;
create policy "staff or uploader reads project files" on storage.objects for select to authenticated
using (bucket_id = 'project-files' and (
  (storage.foldername(name))[1] = auth.uid()::text or public.is_manager_or_owner()
  or public.can_review_security() or public.can_moderate_content()
));

grant execute on function public.can_review_security() to authenticated;
grant execute on function public.can_moderate_content() to authenticated;
grant execute on function public.set_staff_role(text,text) to authenticated;
grant execute on function public.security_review_version(uuid,text,text) to authenticated;
grant execute on function public.moderate_project(uuid,text) to authenticated;
