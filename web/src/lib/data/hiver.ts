import "server-only";

export interface HiverOverview {
  openUnresolved: number | null;
  error?: string;
}

// This specific global cross-inbox search endpoint has a history of
// intermittent 503s (predates this codebase — see README) even while every
// inbox-scoped /v1/ endpoint (used elsewhere in this file and in the Hiver
// dashboard) responds fine. A couple of short retries papers over the
// transient case without adding real latency; a persistent outage still
// surfaces as an honest error rather than retrying forever.
async function fetchWithRetry(url: string, key: string, attempts = 3): Promise<Response> {
  let lastRes: Response | null = null;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (res.ok) return res;
    lastRes = res;
    if (res.status !== 503 && res.status !== 429) break;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return lastRes!;
}

export async function getHiverOverview(): Promise<HiverOverview> {
  const key = process.env.HIVER_API_KEY;
  if (!key) return { openUnresolved: null, error: "not configured" };

  try {
    const res = await fetchWithRetry("https://api2.hiverhq.com/conversations?status=open&per_page=1", key);
    if (!res.ok) return { openUnresolved: null, error: `Hiver returned ${res.status} (temporarily unavailable)` };
    const data = await res.json();
    return { openUnresolved: data.total_count ?? data.meta?.total ?? null };
  } catch {
    return { openUnresolved: null, error: "Hiver unreachable" };
  }
}

export interface HiverInboxSummary {
  id: number;
  name: string;
}

// Just the inbox list (~8 items, one page) — safe to call on every global
// search-index load, unlike the full conversation sweep in /api/hiver/bundle
// (60-90s sequentially across all inboxes; see HiverDashboard.tsx for why
// that one can't be parallelized).
export async function getHiverInboxList(): Promise<HiverInboxSummary[]> {
  const key = process.env.HIVER_API_KEY;
  if (!key) return [];

  try {
    const res = await fetch("https://api2.hiverhq.com/v1/inboxes?limit=100", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: { results?: { id: number; display_name?: string; email?: string }[] } };
    return (data.data?.results ?? []).map((r) => ({ id: r.id, name: r.display_name || r.email || `Inbox ${r.id}` }));
  } catch {
    return [];
  }
}
