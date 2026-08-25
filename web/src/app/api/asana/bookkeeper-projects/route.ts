import { NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClientProjectBreakdown } from "@/lib/data/asana";
import { displayName } from "@/lib/asana-client-map";

export const dynamic = "force-dynamic";

interface BookkeeperProjectsRow {
  id: string;
  name: string;
  pod: string | null;
  projects: { project: string; due: number; upcoming: number; due0to2: number; due3to7: number; due8to14: number; due15plus: number }[];
}

export async function GET() {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const admin = createAdminClient();
    const [{ data: members }, clientProjects] = await Promise.all([
      admin.from("asana_members").select("id, name, pods!asana_members_pod_id_fkey(name)"),
      // personalOnly: this tab shows each bookkeeper's own Finance board, not
      // every numbered client project the majority-assignee heuristic happens
      // to attribute to them (request 2026-08-17). getBookkeeperStats calls
      // getClientProjectBreakdown separately with no options and keeps the
      // full per-client breakdown it explicitly asked for.
      getClientProjectBreakdown({ personalOnly: true }),
    ]);

    // Exact id match — asana_tasks.assignee_id and asana_members.id are both
    // the Asana user gid, so unlike the bookkeeper name (which is sometimes a
    // raw email — see displayName below) this join needs no normalization.
    const projectsById = new Map(clientProjects.rows.map((r) => [r.assigneeId, r.projects]));

    const rows: BookkeeperProjectsRow[] = (members ?? []).map((m) => {
      const id = m.id as string;
      // asana_members.name is a mix of real display names and raw emails
      // (verified live 2026-08-10 — 4 of 21 rows are "name@domain" as-is);
      // this only affects what's displayed here since the project join above
      // is by id, not name.
      const name = displayName(m.name as string);
      const pod = (m as unknown as { pods: { name: string } | null }).pods?.name ?? null;
      return { id, name, pod, projects: projectsById.get(id) ?? [] };
    });

    rows.sort((a, b) => (a.pod ?? "￿").localeCompare(b.pod ?? "￿") || a.name.localeCompare(b.name));

    return NextResponse.json({ rows, error: clientProjects.error });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("bookkeeper-projects failed:", message);
    return NextResponse.json({ rows: [], error: message }, { status: 500 });
  }
}
