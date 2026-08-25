-- Run in Supabase SQL editor

-- Asana tracker projects (replaces hardcoded TRACKER_PROJECTS in asana.ts)
create table if not exists public.asana_trackers (
  id           uuid     primary key default gen_random_uuid(),
  key          text     not null unique,
  label        text     not null,
  project_name text,
  active       boolean  not null default true,
  sort_order   int      not null default 0,
  created_at   timestamptz default now()
);
alter table public.asana_trackers enable row level security;

-- Seed with existing hardcoded trackers
insert into public.asana_trackers (key, label, project_name, sort_order) values
  ('monthly_reporting', 'Monthly reporting tracker', 'GP Bookkeeper- Fathom Reports Tracker', 0),
  ('superannuation',    'Superannuation tracker',    'GP Bookkeeper- Superannuation Tracker', 1),
  ('bas_lodgement',     'BAS lodgement tracker',     'GP Bookkeeper- BAS Lodgement Tracker',  2),
  ('eofy',              'EOFY tracker',              null,                                    3)
on conflict (key) do nothing;

-- Admin settings: generic key-value for thresholds and config
create table if not exists public.admin_settings (
  key        text     primary key,
  value      jsonb    not null,
  updated_at timestamptz default now()
);
alter table public.admin_settings enable row level security;

-- Default alert thresholds
insert into public.admin_settings (key, value) values
  ('asana.overdue_warn',       '10'::jsonb),
  ('asana.overdue_critical',   '25'::jsonb),
  ('hubstaff.activity_warn',   '60'::jsonb),
  ('hubstaff.activity_critical','40'::jsonb),
  ('aircall.missed_warn',      '5'::jsonb),
  ('aircall.missed_critical',  '15'::jsonb),
  ('hiver.open_warn',          '20'::jsonb),
  ('hiver.open_critical',      '50'::jsonb)
on conflict (key) do nothing;
