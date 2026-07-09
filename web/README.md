# Operations Hub — web (Next.js + Supabase + Cloudflare)

Next.js 16 + Supabase + Cloudflare Workers rewrite of the Operations Hub. This app lives alongside the original Express app (`Dashboard/server.js` and friends, one level up) — that app is untouched and still runs for reference.

**Live deploy:** https://gp-bookkeeper-ops-hub.gpbookkeeper.workers.dev

## What's here

- Email/password + Google sign-in via Supabase Auth
- `profiles` table with `role` (`admin`/`pod_leader`/`viewer`) and `is_active` boolean — this schema is real pre-existing infrastructure (see below), not something invented for this app. "Pending" invite state is derived from `auth.users.last_sign_in_at`, not stored.
- Admin panel: invite users, change role/active state, resend invites, delete users
- Invite emails via Resend (falls back to logging the invite link to the console if `RESEND_API_KEY` isn't set)
- Dedicated detail pages for Asana, Aircall, Hubstaff, and Hiver under `/dashboard/*`, each pulling real live data (see "Data sources" below)

## Data sources

- **Asana**: read directly from Supabase's `asana_tasks`/`asana_members`/`pods` tables — a pre-existing sync pipeline (not part of this app) keeps them updated. No live Asana API calls happen from this app.
- **Aircall**: live API calls (calls, contacts) using `AIRCALL_API_ID`/`AIRCALL_API_TOKEN`.
- **Hubstaff**: live API calls (activities, projects) using `HUBSTAFF_REFRESH_TOKEN`. No Hubstaff-user-to-pod mapping exists yet, so the per-pod breakdown from the original spec isn't possible — breakdown shown is per-project instead.
- **Hiver**: live API calls using `HIVER_API_KEY`, but Hiver's backend has been returning `503` for every authenticated endpoint on this account since testing began — confirmed via multiple keys and endpoints, not a credential issue. Needs Hiver support to resolve on their end.

## Known limitations

- **`src/proxy.ts` is disabled** (renamed `proxy.ts.disabled-for-cloudflare`). Next.js 16 always runs Proxy/Middleware on the Node.js runtime with no Edge option, but `@opennextjs/cloudflare@1.20.1` (latest as of writing) only supports Edge middleware and fails the build otherwise. This only cost us proactive session-cookie refresh on navigation — core auth gating (`getUser()` in layouts) is unaffected since Supabase refreshes tokens as needed when read.
- **Production builds use webpack, not Turbopack** (`"build": "next build --webpack"` in `package.json`). Turbopack-built output currently crashes at runtime on Cloudflare Workers with `TypeError: components.ComponentMod.handler is not a function` — an OpenNext/Turbopack compatibility gap, not an issue with this app's code. Revisit both of these once the adapter catches up with Next.js 16.

## Setup

### 1. Install and do a blank build first

```bash
npm install
npm run typecheck
npm run build
```

These should all succeed even with no `.env.local` — every Supabase/Resend client is built lazily so a missing key only breaks the feature that needs it, not the build.

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → New project. Pick a name, a database password (save it), and a region.
2. Wait for provisioning (~2 min). Then **Project Settings → Data API** and copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** (click "Reveal") → `SUPABASE_SERVICE_ROLE_KEY` — never expose this to the browser, never prefix it with `NEXT_PUBLIC_`.
3. **SQL Editor** → paste the full contents of `supabase/migrations/0001_init_profiles_and_auth.sql` → Run.
4. Create the first admin manually (there's no `/setup` flow in this app — Supabase project creation *is* the setup step):
   - **Authentication → Users → Add user** → enter your email + password → check "Auto Confirm User."
   - Then in **SQL Editor**, run:
     ```sql
     update public.profiles set role = 'admin', is_active = true where email = 'you@yourdomain.com';
     ```
5. **Authentication → URL Configuration**: set **Site URL** to `http://localhost:3000` and add `http://localhost:3000/auth/callback` to **Redirect URLs**.
6. *(Optional, can be done later — email/password sign-in works without it)* **Authentication → Providers → Google**: you'll need a Google Cloud OAuth client (Google Cloud Console → APIs & Services → Credentials → OAuth client ID → Web application). The **Authorized redirect URI** is the one Supabase shows on this same provider screen — `https://<project-ref>.supabase.co/auth/v1/callback` — **not** this app's own `/auth/callback`. Paste the resulting Client ID/Secret into the Supabase provider screen and save; no Google env vars are needed in this app itself.

### 3. Create a Resend account (for invite emails)

1. Sign up at [resend.com](https://resend.com).
2. For local testing, use the shared `onboarding@resend.dev` sender — no DNS setup required, works immediately (once you add and verify your own domain later, switch `RESEND_FROM` to an address on it).
3. **API Keys → Create API Key** → copy → `RESEND_API_KEY`.

### 4. Fill in `.env.local`

```bash
cp .env.example .env.local
# then edit .env.local with the values from steps 2 and 3
```

### 5. Run it

```bash
npm run dev
```

Sign in at `/login` with the admin account created in step 2.4. From `/admin`, invite a user — either check your inbox (if Resend is configured) or copy the invite URL that prints to the terminal.

## Cloudflare deploy

Live at **https://gp-bookkeeper-ops-hub.gpbookkeeper.workers.dev**, on Cloudflare account `6dc61160e2401e7202a2260f7f8b40ad` ("Chamal@gpbookkeeper.com.au's Account"). That account also hosts unrelated projects (`trainhub`, `trainhub-cron`, `trainhub-production`, `aircall-proxy`) — this app is the `gp-bookkeeper-ops-hub` Worker only; don't touch the others.

To redeploy after code changes:

```bash
npm run build          # runs `next build --webpack` — see Known limitations above
npx opennextjs-cloudflare build
CLOUDFLARE_API_TOKEN=<token> npx wrangler deploy
```

Secrets already pushed to the Worker (via `wrangler secret put`): `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `HUBSTAFF_REFRESH_TOKEN`, `HIVER_API_KEY`, `AIRCALL_API_ID`, `AIRCALL_API_TOKEN`, `RESEND_FROM`. `RESEND_API_KEY` was never set (still pending a Resend account) — invite emails log their link to `wrangler tail` instead of sending. Re-run `wrangler secret put <NAME>` (reads the value from stdin) to update any of these.

Supabase's Auth → URL Configuration `uri_allow_list` already includes this Worker's URL alongside localhost, so OAuth/invite redirects work in both environments.
