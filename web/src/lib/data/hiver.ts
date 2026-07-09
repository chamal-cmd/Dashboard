import "server-only";

export interface HiverOverview {
  openUnresolved: number | null;
  error?: string;
}

export async function getHiverOverview(): Promise<HiverOverview> {
  const key = process.env.HIVER_API_KEY;
  if (!key) return { openUnresolved: null, error: "not configured" };

  try {
    const res = await fetch("https://api2.hiverhq.com/conversations?status=open&per_page=1", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return { openUnresolved: null, error: `Hiver returned ${res.status} (temporarily unavailable)` };
    const data = await res.json();
    return { openUnresolved: data.total_count ?? data.meta?.total ?? null };
  } catch {
    return { openUnresolved: null, error: "Hiver unreachable" };
  }
}
