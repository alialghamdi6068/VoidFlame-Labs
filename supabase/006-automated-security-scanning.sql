-- VoidFlame Labs automated malware scan metadata.
-- Run after supabase/005-specialist-permissions.sql.
-- The scanner uses the server-only Supabase service-role key; never put it in frontend code.

alter table public.project_versions
  add column if not exists security_scanned_at timestamptz,
  add column if not exists security_scan_engine text not null default '',
  add column if not exists security_scan_report jsonb not null default '{}'::jsonb,
  add column if not exists security_scan_sha256 text;

create index if not exists project_versions_scan_queue_idx
  on public.project_versions(security_status, created_at)
  where security_status = 'pending_scan';

-- Only trusted server-side scanner deployments should use service-role credentials.
-- Do not create a browser-accessible RPC for setting scan verdicts.
