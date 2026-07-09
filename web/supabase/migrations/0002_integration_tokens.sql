-- Shared cross-isolate cache for third-party API access tokens.
--
-- On Cloudflare Workers each request can hit a fresh isolate, so an
-- in-memory token cache doesn't survive between requests. Without shared
-- storage every cold isolate refreshes the Hubstaff token, and Hubstaff
-- rate-limits the refresh token ("Too many requests to refresh this
-- token"), taking the integration down intermittently.
--
-- RLS is enabled with NO policies on purpose: only the server-side
-- service-role client may read or write tokens.

create table if not exists public.integration_tokens (
  provider     text primary key,
  access_token text not null,
  expires_at   timestamptz not null,
  updated_at   timestamptz not null default now()
);

alter table public.integration_tokens enable row level security;
