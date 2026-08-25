import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAdmin, bearerFrom } from "@/lib/auth/verify-admin";
import { CLIENT_PROJECT_REGEX } from "@/lib/data/asana";

// "GP Bookkeeper" workspace — where all client projects and trackers live
// (same constant as api/sync/asana/route.ts; not shared from there since
// that file doesn't export it and this is a single hardcoded id, not logic).
const WORKSPACE_ID = "1199377459726222";
const ASANA_BASE = "https://app.asana.com/api/1.0";
// Numbered ("04. Kim Ching...") and "Finance - (Name)" projects are already
// picked up automatically by getClientProjectBreakdown — no need to clutter
// this picker with those. Shared with it via the same exported regex so the
// two lists can't drift apart.
const AUTO_DETECTED_REGEX = new RegExp(CLIENT_PROJECT_REGEX);

async function fetchAllProjects(token: string): Promise<{ name: string; archived: boolean }[]> {
  const out: { name: string; archived: boolean }[] = [];
  let offset: string | undefined;
  for (let page = 0; page < 20; page++) {
    const url = new URL(`${ASANA_BASE}/workspaces/${WORKSPACE_ID}/projects`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("opt_fields", "name,archived");
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Asana returned ${res.status}`);
    const json = await res.json();
    out.push(...((json.data ?? []) as { name: string; archived: boolean }[]));
    offset = json.next_page?.offset;
    if (!offset) break;
  }
  return out;
}

// Active Asana projects not already auto-detected (numbered) or already
// registered in client_projects — candidates for the "add client project"
// picker, so an admin picks a real project name instead of typing one from
// memory (a typo here would silently never match any task).
export async function GET(req: Request) {
  const auth = await verifyAdmin(bearerFrom(req));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const token = process.env.ASANA_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ candidates: [], error: "Asana not configured" }, { status: 500 });

  try {
    const admin = createAdminClient();
    const { data: registered } = await admin.from("client_projects").select("asana_project_name");
    const registeredNames = new Set((registered ?? []).map((r) => r.asana_project_name as string));

    const projects = await fetchAllProjects(token);
    const candidates = projects
      .filter((p) => !p.archived)
      .filter((p) => !AUTO_DETECTED_REGEX.test(p.name))
      .filter((p) => !registeredNames.has(p.name))
      .map((p) => p.name)
      .sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ candidates });
  } catch (e) {
    return NextResponse.json({ candidates: [], error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
