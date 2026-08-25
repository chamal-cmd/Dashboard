-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- Creates the table that stores Aircall message webhook events.

create table if not exists public.aircall_messages (
  id           text        primary key,  -- Aircall message ids are UUIDs
  number_id    bigint,
  number_name  text,
  contact_id   text,
  direction    text        not null default 'unknown',
  channel      text,                        -- 'sms' | 'whatsapp'
  content      text,
  status       text,                        -- 'sent' | 'delivered' | 'failed' | 'read'
  external_id  text,
  event_type   text,                        -- 'message.sent' | 'message.received' | 'message.status_updated'
  message_at   timestamptz,
  raw          jsonb,
  inserted_at  timestamptz default now()
);

-- Index for the date-range queries the dashboard runs
create index if not exists aircall_messages_message_at_idx
  on public.aircall_messages (message_at desc);

-- Row-level security (service-role key bypasses this automatically)
alter table public.aircall_messages enable row level security;

-- Migration (2026-07-16): the table was originally created with bigint ids,
-- but Aircall message ids are UUID strings, so every webhook insert failed.
-- If the table already exists with bigint columns, run this instead:
--
-- alter table public.aircall_messages
--   alter column id type text using id::text,
--   alter column contact_id type text using contact_id::text;
