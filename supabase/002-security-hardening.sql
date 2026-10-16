-- Apply after schema.sql.
-- Prevent users from editing their own role or upload permission.
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

-- Allow signed URLs only for releases approved by staff.
drop policy if exists "approved releases can be downloaded" on storage.objects;
create policy "approved releases can be downloaded" on storage.objects for select to anon, authenticated
using (
  bucket_id = 'project-files'
  and exists (
    select 1 from public.project_versions v
    join public.projects p on p.id = v.project_id
    where v.file_path = storage.objects.name
      and v.status = 'approved'
      and p.status = 'approved'
  )
);

create or replace function public.increment_downloads(target_project uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.projects set downloads = downloads + 1
  where id = target_project and status = 'approved';
end;
$$;
grant execute on function public.increment_downloads(uuid) to anon, authenticated;
