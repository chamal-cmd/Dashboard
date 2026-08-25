-- Persistent cache for Aircall caller-name resolution.
--
-- resolveContactNames() in src/lib/data/aircall.ts looks up one Aircall
-- contact per unique phone number, which is one Cloudflare subrequest each —
-- on this Worker's Free-plan 50-subrequest-per-invocation cap, a busy week
-- (58 unique callers seen 2026-08-13) can't all be resolved live in a single
-- request, so most callers showed as a bare number instead of a name. This
-- table lets a name resolved once be reused on every later request for free
-- (a single Supabase read), so coverage grows across requests instead of
-- resetting every time; only genuinely new numbers still cost a live lookup,
-- capped the same way as before. Entries are re-checked after 30 days in
-- case the contact was added/renamed in Aircall since the last lookup.
--
-- RLS enabled with NO policies on purpose: server-side service-role only.

create table if not exists public.aircall_contact_cache (
  phone_number text primary key,
  name         text,
  company      text,
  resolved_at  timestamptz not null default now()
);

alter table public.aircall_contact_cache enable row level security;
