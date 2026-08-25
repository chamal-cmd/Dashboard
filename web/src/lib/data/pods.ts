import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Real pod rosters live in Supabase (asana_members.pod_id -> pods), not in
// Hubstaff — Hubstaff's own `team_id` filter on /members is silently
// ignored (verified: identical results regardless of team_id), so this is
// the only reliable source. Keyed by lowercased email so it can be matched
// against whatever identifier each integration (Hubstaff, Asana) uses.
export async function getPodByEmail(): Promise<Map<string, string>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("asana_members")
    .select("email, pods!asana_members_pod_id_fkey(name)")
    .not("pod_id", "is", null);

  const map = new Map<string, string>();
  for (const row of data ?? []) {
    const podName = (row as unknown as { pods: { name: string } | null }).pods?.name;
    if (row.email && podName) map.set(row.email.toLowerCase(), podName);
  }
  return map;
}

// Every pod regardless of activity — for a fixed pod switcher, unlike
// filtering to pods that currently have tracked hours/tasks/calls.
export async function getAllPods(): Promise<{ id: string; name: string }[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("pods").select("id, name");
  return (data ?? [])
    .map((p) => ({ id: p.id as string, name: p.name as string }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
