import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
// Chunked syncs make many upstream calls; give the route room on Node.
export const maxDuration = 300;

// "GP Bookkeeper" workspace — where all client projects and trackers live
// (the other workspace on the account has zero projects).
const WORKSPACE_ID = "1199377459726222";
const ASANA_BASE = "https://app.asana.com/api/1.0";

const TASK_FIELDS =
  "name,completed,completed_at,created_at,modified_at,due_on,assignee.name";

type QueueProject = { gid: string; name: string };

type SyncState = {
  queue: QueueProject[];
  // modified_since for the current cycle — null means full sync (bootstrap)
  watermark: string | null;
  // when the in-progress cycle started; becomes the next watermark once the
  // queue drains (anything modified during the cycle gets picked up again)
  cycleStart: string | null;
  cycleSynced: number;
  cycleDeleted: number;
};

async function asanaGet(path: string, token: string, attempt = 0): Promise<{ data?: unknown[]; next_page?: { uri?: string } }> {
  let res: Response;
  try {
    res = await fetch(path.startsWith("http") ? path : `${ASANA_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
  } catch (e) {
    // Transient network failure mid-pagination — retry with backoff.
    if (attempt < 4) {
      await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
      return asanaGet(path, token, attempt + 1);
    }
    const cause = e instanceof Error && e.cause instanceof Error ? ` (${e.cause.message})` : "";
    throw new Error(`Asana fetch failed${cause}: ${path.slice(0, 120)}`);
  }
  if (res.status === 429 && attempt < 5) {
    const wait = Number(res.headers.get("Retry-After") ?? "10");
    await new Promise((r) => setTimeout(r, Math.min(wait, 60) * 1000));
    return asanaGet(path, token, attempt + 1);
  }
  if (!res.ok) throw new Error(`Asana ${res.status}: ${path.slice(0, 120)}`);
  return res.json();
}

async function asanaGetAll(path: string, token: string): Promise<unknown[]> {
  const out: unknown[] = [];
  let url: string | null = path;
  while (url) {
    const d = await asanaGet(url, token);
    out.push(...(d.data ?? []));
    url = d.next_page?.uri ?? null;
  }
  return out;
}

// Looks up the pod_id currently stored on each of these task ids, so the
// upsert below can preserve it when the incoming Asana data has no
// resolvable assignee->pod mapping (e.g. the assignee was removed from
// asana_members) instead of nulling out a previously-known pod_id.
async function fetchExistingPodIds(
  admin: ReturnType<typeof createAdminClient>,
  ids: string[]
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const { data, error } = await admin.from("asana_tasks").select("id, pod_id").in("id", chunk);
    if (error) throw new Error(`fetch existing pod_id failed: ${error.message}`);
    for (const row of data ?? []) out.set(row.id as string, (row.pod_id as string | null) ?? null);
  }
  return out;
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret")?.trim();
  const expected = process.env.SYNC_SECRET?.trim();
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = process.env.ASANA_ACCESS_TOKEN?.trim();
  if (!token) return NextResponse.json({ error: "ASANA_ACCESS_TOKEN not configured" }, { status: 500 });

  const chunkRaw = Number(req.nextUrl.searchParams.get("chunk") ?? "8");
  const chunk = isNaN(chunkRaw) || chunkRaw < 1 ? 8 : Math.min(chunkRaw, 200);

  const admin = createAdminClient();

  try {
    // ── Load or start a cycle ────────────────────────────────────────────
    const { data: stateRow } = await admin
      .from("sync_state").select("value").eq("key", "asana").maybeSingle();
    let state: SyncState = (stateRow?.value as SyncState) ?? {
      queue: [], watermark: null, cycleStart: null, cycleSynced: 0, cycleDeleted: 0,
    };
    // Older persisted state (pre-reconciliation) won't have this field yet.
    if (typeof state.cycleDeleted !== "number") state.cycleDeleted = 0;

    let cycleCompleted = false;

    if (state.queue.length === 0) {
      // Previous cycle (if any) finished — promote its start to watermark.
      if (state.cycleStart) state.watermark = state.cycleStart;
      const projects = (await asanaGetAll(
        `/workspaces/${WORKSPACE_ID}/projects?limit=100&opt_fields=name,archived`, token
      )) as { gid: string; name: string; archived: boolean }[];
      state = {
        queue: projects.filter((p) => !p.archived).map((p) => ({ gid: p.gid, name: p.name })),
        watermark: state.watermark,
        cycleStart: new Date().toISOString(),
        cycleSynced: 0,
        cycleDeleted: 0,
      };
    }

    // ── Pod mapping: assignee gid -> pod_id via workspace user emails ────
    const [workspaceUsers, membersRes] = await Promise.all([
      asanaGetAll(`/workspaces/${WORKSPACE_ID}/users?limit=100&opt_fields=email`, token) as Promise<{ gid: string; email?: string }[]>,
      admin.from("asana_members").select("email, pod_id").not("pod_id", "is", null),
    ]);
    const podByEmail = new Map<string, string>();
    for (const m of membersRes.data ?? []) {
      if (m.email && m.pod_id) podByEmail.set(m.email.toLowerCase(), m.pod_id);
    }
    const podByGid = new Map<string, string>();
    for (const u of workspaceUsers) {
      const pod = u.email ? podByEmail.get(u.email.toLowerCase()) : undefined;
      if (pod) podByGid.set(u.gid, pod);
    }

    // ── Process this invocation's chunk of projects ──────────────────────
    const batch = state.queue.slice(0, chunk);
    const rest = state.queue.slice(chunk);
    const now = new Date().toISOString();
    const modifiedSince = state.watermark ? `&modified_since=${encodeURIComponent(state.watermark)}` : "";
    let synced = 0;
    let deleted = 0;

    // Each project only appears once in `state.queue` per cycle (the queue is
    // only rebuilt once it's fully drained — see above), so doing the full
    // live-gid reconciliation fetch here runs it exactly once per project per
    // full pass through all projects, never repeatedly on the same project
    // within a cycle's incremental ticks.
    for (const project of batch) {
      const tasks = (await asanaGetAll(
        `/projects/${project.gid}/tasks?limit=100&opt_fields=${TASK_FIELDS}${modifiedSince}`, token
      )) as {
        gid: string; name: string; completed: boolean; completed_at: string | null;
        created_at: string; modified_at: string; due_on: string | null;
        assignee: { gid: string; name: string } | null;
      }[];

      if (tasks.length > 0) {
        // Only overwrite pod_id when the current assignee resolves to a pod;
        // otherwise keep whatever pod_id is already stored so an unresolved
        // mapping (e.g. the assignee was deleted from asana_members) doesn't
        // silently null out a task's pod on its next ordinary edit.
        const existingPodById = await fetchExistingPodIds(admin, tasks.map((t) => t.gid));

        const rows = tasks.map((t) => {
          const mappedPod = t.assignee ? podByGid.get(t.assignee.gid) ?? null : null;
          const pod_id = t.assignee ? mappedPod ?? existingPodById.get(t.gid) ?? null : null;
          return {
            id: t.gid,
            name: t.name,
            project_id: project.gid,
            project_name: project.name,
            assignee_id: t.assignee?.gid ?? null,
            assignee_name: t.assignee?.name ?? null,
            pod_id,
            completed: t.completed,
            completed_at: t.completed_at,
            due_on: t.due_on,
            created_at: t.created_at,
            modified_at: t.modified_at,
            synced_at: now,
          };
        });
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await admin.from("asana_tasks").upsert(rows.slice(i, i + 500), { onConflict: "id" });
          if (error) throw new Error(`upsert failed for ${project.name}: ${error.message}`);
        }
        synced += rows.length;
      }

      // ── Tombstone reconciliation ────────────────────────────────────────
      // modified_since only surfaces tasks that were changed — a task that
      // was deleted in Asana never shows up there, so it would otherwise
      // linger in asana_tasks forever (counted as open/overdue) even though
      // it no longer exists upstream. Fetch this project's full current gid
      // list (cheap: gid only, no other fields) and drop any locally-stored
      // row for this project that isn't in it.
      const liveGids = new Set(
        (
          (await asanaGetAll(`/projects/${project.gid}/tasks?limit=100&opt_fields=gid`, token)) as { gid: string }[]
        ).map((t) => t.gid)
      );
      // Paginated: PostgREST caps rows-per-request regardless of an explicit
      // large limit, and some projects have well over a thousand tasks.
      const storedIds: string[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data: storedPage, error: storedErr } = await admin
          .from("asana_tasks").select("id").eq("project_id", project.gid).range(offset, offset + 999);
        if (storedErr) throw new Error(`fetch stored ids failed for ${project.name}: ${storedErr.message}`);
        storedIds.push(...(storedPage ?? []).map((r) => r.id as string));
        if (!storedPage || storedPage.length < 1000) break;
      }
      const staleIds = storedIds.filter((id) => !liveGids.has(id));
      for (let i = 0; i < staleIds.length; i += 500) {
        const { error } = await admin.from("asana_tasks").delete().in("id", staleIds.slice(i, i + 500));
        if (error) throw new Error(`reconcile delete failed for ${project.name}: ${error.message}`);
      }
      deleted += staleIds.length;
    }

    state.queue = rest;
    state.cycleSynced += synced;
    state.cycleDeleted += deleted;
    if (rest.length === 0) cycleCompleted = true;

    await admin.from("sync_state").upsert(
      { key: "asana", value: state, updated_at: now },
      { onConflict: "key" }
    );
    if (cycleCompleted) {
      await admin.from("sync_log").insert({
        source: "asana", status: "success", records_synced: state.cycleSynced,
      });
    }

    return NextResponse.json({
      ok: true,
      projectsProcessed: batch.length,
      tasksUpserted: synced,
      tasksDeleted: deleted,
      projectsRemaining: rest.length,
      cycleCompleted,
      watermark: state.watermark,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("sync_log").insert({ source: "asana", status: "error", records_synced: 0, error_message: msg }).then(() => {}, () => {});
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
