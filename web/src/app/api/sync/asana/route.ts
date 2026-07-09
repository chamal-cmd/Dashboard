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
      queue: [], watermark: null, cycleStart: null, cycleSynced: 0,
    };

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

    for (const project of batch) {
      const tasks = (await asanaGetAll(
        `/projects/${project.gid}/tasks?limit=100&opt_fields=${TASK_FIELDS}${modifiedSince}`, token
      )) as {
        gid: string; name: string; completed: boolean; completed_at: string | null;
        created_at: string; modified_at: string; due_on: string | null;
        assignee: { gid: string; name: string } | null;
      }[];
      if (tasks.length === 0) continue;

      const rows = tasks.map((t) => ({
        id: t.gid,
        name: t.name,
        project_id: project.gid,
        project_name: project.name,
        assignee_id: t.assignee?.gid ?? null,
        assignee_name: t.assignee?.name ?? null,
        pod_id: t.assignee ? podByGid.get(t.assignee.gid) ?? null : null,
        completed: t.completed,
        completed_at: t.completed_at,
        due_on: t.due_on,
        created_at: t.created_at,
        modified_at: t.modified_at,
        synced_at: now,
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await admin.from("asana_tasks").upsert(rows.slice(i, i + 500), { onConflict: "id" });
        if (error) throw new Error(`upsert failed for ${project.name}: ${error.message}`);
      }
      synced += rows.length;
    }

    state.queue = rest;
    state.cycleSynced += synced;
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
