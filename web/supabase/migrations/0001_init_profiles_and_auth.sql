-- ════════════════════════════════════════════════════════════════════
-- Operations Hub — auth trigger update
--
-- The `profiles`/`pods`/`clients`/`asana_tasks`/`asana_members`/
-- `weekly_snapshots`/`sync_log`/`month_end_checklists` tables already
-- exist in this Supabase project — they were built in an earlier effort,
-- independent of this Next.js app, and already hold real synced data
-- (thousands of Asana tasks, real clients). This migration does NOT
-- create or drop any of that; it only improves the existing
-- handle_new_user() trigger.
--
-- Real existing `profiles` schema (for reference, not created here):
--   id uuid PK -> auth.users(id) on delete cascade
--   email text, full_name text
--   role public.user_role enum: 'admin' | 'pod_leader' | 'viewer'
--   pod_id uuid -> pods(id)
--   avatar_url text
--   is_active boolean (default true) — false = suspended
--   created_at, updated_at timestamptz
-- "Pending invite" is NOT a stored column — it's derived as
-- `auth.users.last_sign_in_at IS NULL` (see src/app/api/admin/users/route.ts).
--
-- RLS policies on profiles ("Admins can view/update all profiles",
-- "Users can view own profile", "Service role can insert profiles")
-- already existed and are left untouched.
-- ════════════════════════════════════════════════════════════════════

-- Adds email-based role/is_active inheritance to the pre-existing trigger:
-- if this email already had a profiles row (e.g. pre-created by an invite,
-- or from a prior sign-up), inherit its role and is_active instead of
-- defaulting. Needed for Google re-auth — a user invited for email/password
-- who later signs in with Google gets a NEW auth.users row/UUID from
-- Supabase, so without this lookup they'd fall back to the default
-- 'viewer'/active instead of keeping their assigned role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  inherited_role public.user_role;
  inherited_active boolean;
begin
  select role, is_active into inherited_role, inherited_active
  from public.profiles where email = new.email limit 1;

  insert into public.profiles (id, email, full_name, role, is_active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(inherited_role, (new.raw_user_meta_data->>'role')::public.user_role, 'viewer'),
    coalesce(inherited_active, true)
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;
