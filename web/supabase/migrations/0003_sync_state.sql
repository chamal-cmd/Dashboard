-- Cursor/watermark storage for chunked incremental syncs (Asana first).
--
-- The Cloudflare Worker can't sync all ~100 Asana projects in one request
-- (free-plan subrequest limits), so a cron hits /api/sync/asana every few
-- minutes and each invocation processes a chunk of the project queue kept
-- here. When the queue empties, the completed cycle's start time becomes
-- the modified_since watermark for the next cycle, so only changed tasks
-- are re-fetched.
--
-- RLS enabled with NO policies on purpose: server-side service-role only.

create table if not exists public.sync_state (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.sync_state enable row level security;
