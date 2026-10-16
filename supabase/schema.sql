-- VoidFlame Labs platform schema for Supabase
-- Run in Supabase SQL Editor after creating the project.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  display_name text,
  avatar_url text,
  role text not null default 'member' check (role in ('owner','manager','member')),
  can_publish boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null check (char_length(name) between 2 and 80),
  summary text not null check (char_length(summary) between 10 and 240),
  description text not null default '',
  category text not null check (category in ('Mods','Plugins','Modpacks','Shaders','Resource Packs','Tools','Other')),
  game text not null default 'Minecraft',
  loader text,
  supported_versions text[] not null default '{}',
  icon_path text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','hidden')),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  downloads bigint not null default 0 check (downloads >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version text not null,
  game_versions text[] not null default '{}',
  loaders text[] not null default '{}',
  file_path text not null,
  file_name text not null,
  file_size bigint not null check (file_size > 0),
  sha256 text,
  changelog text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(project_id, version)
);

create table if not exists public.moderation_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  target_user_id uuid references public.profiles(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists projects_status_created_idx on public.projects(status, created_at desc);
create index if not exists projects_owner_idx on public.projects(owner_id);
create index if not exists versions_project_idx on public.project_versions(project_id, created_at desc);
create index if not exists moderation_logs_created_idx on public.moderation_logs(created_at desc);

create or replace function public.is_manager_or_owner()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','manager')); $$;

create or replace function public.can_publish()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role in ('owner','manager') or p.can_publish)); $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_email text := lower(coalesce(new.email, ''));
begin
  insert into public.profiles (id, email, display_name, avatar_url, role, can_publish)
  values (
    new.id,
    v_email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(v_email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture'),
    case when v_email = 'alialghamdi6068@gmail.com' then 'owner' else 'member' end,
    v_email = 'alialghamdi6068@gmail.com'
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_voidflame on auth.users;
create trigger on_auth_user_created_voidflame after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_versions enable row level security;
alter table public.moderation_logs enable row level security;

drop policy if exists "profiles read own or staff" on public.profiles;
create policy "profiles read own or staff" on public.profiles for select to authenticated
using (id = auth.uid() or public.is_manager_or_owner());

drop policy if exists "profiles update own public fields" on public.profiles;
create policy "profiles update own public fields" on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "approved projects are public" on public.projects;
create policy "approved projects are public" on public.projects for select
using (status = 'approved' or owner_id = auth.uid() or public.is_manager_or_owner());

drop policy if exists "authorized creators submit projects" on public.projects;
create policy "authorized creators submit projects" on public.projects for insert to authenticated
with check (owner_id = auth.uid() and public.can_publish() and status = 'pending');

drop policy if exists "creators update pending projects" on public.projects;
create policy "creators update pending projects" on public.projects for update to authenticated
using ((owner_id = auth.uid() and status in ('pending','rejected')) or public.is_manager_or_owner())
with check ((owner_id = auth.uid() and status in ('pending','rejected')) or public.is_manager_or_owner());

drop policy if exists "versions visible with approved project or to owner staff" on public.project_versions;
create policy "versions visible with approved project or to owner staff" on public.project_versions for select
using (
  status = 'approved' and exists (select 1 from public.projects p where p.id = project_id and p.status = 'approved')
  or created_by = auth.uid() or public.is_manager_or_owner()
);

drop policy if exists "authorized creators submit versions" on public.project_versions;
create policy "authorized creators submit versions" on public.project_versions for insert to authenticated
with check (created_by = auth.uid() and public.can_publish() and status = 'pending'
  and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));

drop policy if exists "staff moderate versions" on public.project_versions;
create policy "staff moderate versions" on public.project_versions for update to authenticated
using (public.is_manager_or_owner()) with check (public.is_manager_or_owner());

drop policy if exists "staff read moderation logs" on public.moderation_logs;
create policy "staff read moderation logs" on public.moderation_logs for select to authenticated
using (public.is_manager_or_owner());

create or replace function public.grant_publish_access(target_email text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_manager_or_owner() then raise exception 'Manager permission required'; end if;
  update public.profiles set can_publish = true, updated_at = now() where lower(email) = lower(trim(target_email));
  if not found then raise exception 'User not found. Ask them to sign in once first.'; end if;
  insert into public.moderation_logs(actor_id, target_user_id, action, details)
  select auth.uid(), id, 'grant_publish', jsonb_build_object('email', lower(trim(target_email)))
  from public.profiles where lower(email) = lower(trim(target_email));
end;
$$;

create or replace function public.revoke_publish_access(target_email text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_manager_or_owner() then raise exception 'Manager permission required'; end if;
  update public.profiles set can_publish = false, updated_at = now()
  where lower(email) = lower(trim(target_email)) and role = 'member';
  if not found then raise exception 'User not found or account is staff'; end if;
  insert into public.moderation_logs(actor_id, target_user_id, action, details)
  select auth.uid(), id, 'revoke_publish', jsonb_build_object('email', lower(trim(target_email)))
  from public.profiles where lower(email) = lower(trim(target_email));
end;
$$;

create or replace function public.set_manager_role(target_email text, make_manager boolean)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'owner') then
    raise exception 'Owner permission required';
  end if;
  update public.profiles set role = case when make_manager then 'manager' else 'member' end,
    can_publish = case when make_manager then true else can_publish end, updated_at = now()
  where lower(email) = lower(trim(target_email)) and role <> 'owner';
  if not found then raise exception 'User not found or target is owner'; end if;
  insert into public.moderation_logs(actor_id, target_user_id, action, details)
  select auth.uid(), id, case when make_manager then 'promote_manager' else 'demote_manager' end,
    jsonb_build_object('email', lower(trim(target_email)))
  from public.profiles where lower(email) = lower(trim(target_email));
end;
$$;

create or replace function public.moderate_project(target_project uuid, next_status text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_manager_or_owner() then raise exception 'Manager permission required'; end if;
  if next_status not in ('approved','rejected','hidden') then raise exception 'Invalid moderation status'; end if;
  update public.projects set status = next_status, updated_at = now() where id = target_project;
  if not found then raise exception 'Project not found'; end if;
  insert into public.moderation_logs(actor_id, project_id, action, details)
  values (auth.uid(), target_project, 'project_' || next_status, '{}'::jsonb);
end;
$$;

grant execute on function public.is_manager_or_owner() to anon, authenticated;
grant execute on function public.can_publish() to authenticated;
grant execute on function public.grant_publish_access(text) to authenticated;
grant execute on function public.revoke_publish_access(text) to authenticated;
grant execute on function public.set_manager_role(text, boolean) to authenticated;
grant execute on function public.moderate_project(uuid, text) to authenticated;

-- Private project binaries: only authorized publishers may upload; public downloads are
-- served only after the matching project version has been approved.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-files', 'project-files', false, 104857600,
  array['application/java-archive','application/zip','application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = 104857600,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "authorized creators upload project files" on storage.objects;
create policy "authorized creators upload project files" on storage.objects for insert to authenticated
with check (bucket_id = 'project-files' and public.can_publish() and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "staff or uploader reads project files" on storage.objects;
create policy "staff or uploader reads project files" on storage.objects for select to authenticated
using (bucket_id = 'project-files' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_manager_or_owner()));

drop policy if exists "uploader removes own project files" on storage.objects;
create policy "uploader removes own project files" on storage.objects for delete to authenticated
using (bucket_id = 'project-files' and (storage.foldername(name))[1] = auth.uid()::text);

-- Never expose the Supabase service-role key in frontend code.
