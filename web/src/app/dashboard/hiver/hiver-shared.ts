// Shared by HiverDashboard.tsx (org-wide overview) and the per-inbox
// drilldown page — kept in one place so date-range math and the 429-retry
// fetch wrapper can't drift between the two.

export interface Inbox {
  id: number;
  display_name: string;
  email: string;
  _userIds?: number[];
}
export interface HiverUser {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
}
export interface HiverTag {
  id: number;
  name: string;
  color_code: string;
}
export interface HiverConversation {
  id: number;
  status: string;
  assignee?: { assignee_id?: number };
  tag_ids?: number[];
  _inbox_id: number;
  created_at?: number;
  private_permalink?: string | null;
}

export const HIVER_COLORS = [
  "#f97316","#4f8ef7","#22c55e","#a78bfa","#f06292",
  "#fbbf24","#60a5fa","#34d399","#e879f9","#94a3b8",
];

export function initials(name: string) {
  return (name || "").split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase() || "?";
}

// ── Date filtering: investigated and confirmed non-functional ──────────────
// This dashboard used to offer Today/Week/Month/30d/90d/All presets (plus a
// permanent 2026-01-01 cutoff, mirroring Asana's ASANA_CUTOFF_ISO) on top of
// them. Live testing against the real Hiver API (2026-07-22) established
// that none of it ever actually worked:
//   - v1/inboxes/{id}/conversations's created_after param is silently
//     ignored — 30-days-ago, 1-year-in-the-future, omitted entirely, and 9
//     other plausible param names (start_date, from, after, since,
//     date_after, created_since, updated_after, start, end) all returned
//     byte-identical results.
//   - The conversation objects this endpoint returns carry no created_at,
//     updated_at, or any other timestamp field at all — so there's nothing
//     to filter on client-side either. (Inbox objects have created_at;
//     conversation objects don't.)
//   - The global v1/conversations endpoint and a v1/conversations/{id}
//     detail endpoint both 503 consistently (5 retries, spaced out) — same
//     flaky surface noted elsewhere in this codebase, not a usable
//     alternative.
//   - developer.hiverhq.com (official docs) has an expired TLS cert and is
//     unreachable over http or https; third-party docs (apihiver.com) don't
//     document endpoint parameters; help.hiverhq.com's API page is a
//     client-rendered SPA with no fetchable content; the Wayback Machine has
//     no snapshots of the relevant doc pages.
// Conclusion: Hiver's API gives us no real way to scope conversations to a
// date range, so the preset picker was pure UI theater — every preset
// button fetched and displayed the exact same underlying data. Rather than
// keep faking a control with nothing real behind it, every Hiver view now
// just shows everything the API returns, and says so.
//
// The 2026-01-01 cutoff intent itself isn't forgotten, just unenforceable
// today — see HIVER_DATE_FILTER_NOTE below, which is what surfaces this to
// users in place of the old picker.
export const HIVER_DATE_FILTER_NOTE =
  "Showing every conversation Hiver returns for this view — Hiver's API has no working date filter (every created_after/start_date/since-style " +
  "parameter we tried is silently ignored, and conversations carry no timestamp field to filter on client-side either), so no date range can be " +
  "applied. The original intent was to scope this to conversations from 2026-01-01 onward, matching Asana's cutoff; that can't be enforced until " +
  "Hiver's API supports real date filtering.";

// Retries on Hiver's 429s with exponential backoff — used for the
// lightweight, single-page proxy calls (e.g. the inbox list).
export async function hiverFetch(path: string, attempt = 0): Promise<unknown> {
  const r = await fetch(`/api/hiver${path}`);
  if (r.status === 429) {
    if (attempt < 6) {
      const delay = Math.min(Math.pow(2, attempt) * 500, 16000);
      await new Promise((res) => setTimeout(res, delay));
      return hiverFetch(path, attempt + 1);
    }
    throw new Error(`Rate limited: ${path}`);
  }
  if (!r.ok) throw new Error(`Hiver ${r.status}: ${path}`);
  return r.json();
}
