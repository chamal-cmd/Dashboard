-- Pod leader becomes admin-editable instead of the hardcoded
-- POD_LEADER_ASSIGNEE_ID map in src/lib/data/asana-pod.ts (leadership rarely
-- changes, but when it does today that requires a code change + redeploy).
alter table public.pods add column if not exists leader_member_id text references public.asana_members(id) on delete set null;

-- Client projects (e.g. "04. Kim Ching- Northeast General Practice Services
-- Pty Ltd") are real per-client Asana projects, separate from the Fathom/BAS/
-- EOFY compliance trackers (asana_trackers table) — this is where the actual
-- bookkeeping task volume lives. getClientProjectBreakdown() (asana.ts)
-- auto-detects most of them via a numbered-prefix regex on
-- asana_tasks.project_name, but that misses real clients whose project isn't
-- numbered (e.g. "Dubbo Health Hub", checked live 2026-08-10). This table
-- lets an admin register those by hand instead of editing code, and can also
-- override which bookkeeper a numbered project's tasks roll up to.
create table if not exists public.client_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Must match asana_tasks.project_name exactly — that's the join key used
  -- to count this project's tasks, the same column the regex filters on.
  asana_project_name text not null unique,
  bookkeeper_member_id text references public.asana_members(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists client_projects_bookkeeper_idx on public.client_projects(bookkeeper_member_id);
