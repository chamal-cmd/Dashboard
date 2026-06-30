# Operations Hub — Joint Observation Dashboard

Internal monitoring dashboards for GP Bookkeeper, unifying **Hubstaff**, **Aircall**, **Hiver**, and **Asana** behind one login-protected hub.

A Node/Express server proxies each third-party API (keeping keys server-side, adding retry + rate-limit handling) and serves four dashboards plus an admin panel.

## Getting started on a new machine

```bash
# 1. Install dependencies
npm install

# 2. Create your .env from the template and fill in the keys
cp .env.example .env        # then edit .env with the real values

# 3. Start the server
node server.js
```

Then open <http://localhost:3000>.

> **Note:** `.env` is gitignored and is **not** in this repo. Copy it across manually
> (it lives in the OneDrive project folder) or re-enter the keys from `.env.example`.
> The app will not pull any data without it.

## Project layout

| Path | Purpose |
|------|---------|
| `server.js` | Express server: API proxies, auth, admin API |
| `index.html` | Landing hub with the four dashboard tiles |
| `hubstaff/`, `aircall/`, `hiver/`, `asana/` | The four dashboards |
| `login/`, `admin/` | Auth pages and admin panel |
| `auth/` | User store (`db.js`) + invite email (`email.js`) |

## Authentication

Login protection is currently **disabled** for local use (the auth guard in `server.js`
is commented out). To re-enable it, uncomment the auth-guard `app.use(...)` block and
visit `/login` to create the first admin account. Supports email/password, Google
Sign-In (set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`), and email invite links.

## Notes

- Hubstaff/Hiver/Aircall data is served via the built-in proxies (`/hubstaff-proxy`, etc.).
- Hiver loads can take ~30–60s on first open — it pages through thousands of
  conversations and the server paces requests to avoid the API's rate limit.
- Data reflects activity up to ~15 minutes ago (Hubstaff API delay).
