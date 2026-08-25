import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
// Chunked syncs make many upstream calls; give the route room on Node.
export const maxDuration = 300;

// "GP Bookkeeper" workspace — where all client projects and trackers live
// (the other workspace on the account has zero projects).
const WORKSPACE_ID = "1199377459726222";
const ASANA_BASE = "https://app.asana.com/api/1.0";

// custom_fields is included for the compliance trackers' "Progress" field —
// their real completion signal, which the task checkbox does NOT reflect (see
// migration 0004). Projects without that field simply return no match and the
// column stays null, leaving the checkbox as the signal for everything else.
const TASK_FIELDS =
  "name,completed,completed_at,created_at,modified_at,due_on,assignee.name,custom_fields.name,custom_fields.display_value";

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
  // gid -> consecutive failure count, this cycle only (reset when a new
  // cycle starts). Lets a project fail a few times and get retried later in
  // the queue without blocking everything behind it forever.
  failedGids: Record<string, number>;
};

async function asanaGet(path: string, token: string, attempt = 0): Promise<{ data?: unknown[]; next_page?: { uri?: string } }> {
  let res: Response;
  try {
    res = await fetch(path.startsWith("http") ? path : `${ASANA_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
  } catch (e) {
    // Transient network failure mid-pagination — retry with backoff. Capped
    // at 1 retry (not the original 5): this Worker is on Cloudflare's Free
    // plan, hard-limited to 50 subrequests per invocation (confirmed live
    // 2026-08-12 — every retry attempt is itself a subrequest, so a single
    // struggling call retrying 5x could burn 10% of the ENTIRE budget on its
    // own; with several Asana calls per project each capable of doing that,
    // one bad project could exhaust the whole invocation before it ever
    // reaches the next one).
    if (attempt < 1) {
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
  // Transient upstream/edge failures (Cloudflare 520-527 "unknown error" class,
  // plus ordinary 500/502/503/504) — NOT Asana rejecting the request, just a
  // flaky hop in between. Without this the whole sync died outright on one
  // bad response: confirmed live 2026-08-12 that the sync had been stuck for
  // 15 days (last progress 2026-07-28) because every attempt since kept
  // hitting a 520 on the very first call of a new cycle (refetching the
  // project list) with no retry, so it never got any further. Capped at 1
  // retry for the same subrequest-budget reason as the network-exception
  // branch above.
  if ([500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527].includes(res.status) && attempt < 1) {
    await new Promise((r) => setTimeout(r, (attempt + 1) * 3000));
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

// assignee gid -> pod_id, resolved via each workspace user's email against
// asana_members. Shared by the ordinary cycle and the targeted re-sync below.
async function buildPodByGid(
  admin: ReturnType<typeof createAdminClient>,
  token: string
): Promise<Map<string, string>> {
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
  return podByGid;
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret")?.trim();
  const expected = process.env.SYNC_SECRET?.trim();
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = process.env.ASANA_ACCESS_TOKEN?.trim();
  if (!token) return NextResponse.json({ error: "ASANA_ACCESS_TOKEN not configured" }, { status: 500 });

  // Default lowered from 8 to 3 (confirmed live 2026-08-12: this Worker is on
  // Cloudflare's Free plan, hard-capped at 50 subrequests per invocation —
  // pre-loop setup (project list + workspace users) plus each project's
  // several Asana + Supabase calls can add up fast, especially once retries
  // are involved).
  const chunkRaw = Number(req.nextUrl.searchParams.get("chunk") ?? "3");
  const chunk = isNaN(chunkRaw) || chunkRaw < 1 ? 3 : Math.min(chunkRaw, 200);
  // ?reconcile=0 skips the deleted-task check below (see "Tombstone
  // reconciliation") — it re-fetches each project's full task list a SECOND
  // time just to catch deletions, roughly doubling Asana-side subrequest cost
  // per project. Defaults to on (unchanged behaviour); pass 0 to prioritise
  // getting fresh content flowing again over catching deletions, e.g. while
  // draining a large backlog under a tight subrequest budget.
  const reconcile = req.nextUrl.searchParams.get("reconcile") !== "0";

  // ?project=<gid> re-syncs one project immediately, ignoring the rolling
  // queue and the modified_since watermark. Needed when a schema change adds a
  // column that existing rows don't have yet — waiting for the ~hourly full
  // cycle would leave the new column null on the boards that depend on it.
  // Deliberately does NOT touch sync_state, so the ordinary cycle is unaffected.
  const onlyProject = req.nextUrl.searchParams.get("project")?.trim() || null;

  const admin = createAdminClient();

  // ── Targeted single-project re-sync ──────────────────────────────────────
  // Self-contained on purpose: it returns before touching sync_state, so a
  // targeted run can never disturb the rolling queue, watermark or cycle
  // counters that the cron-driven sync depends on.
  if (onlyProject) {
    try {
      const podByGid = await buildPodByGid(admin, token);
      const meta = (await asanaGet(`/projects/${onlyProject}?opt_fields=name`, token)) as unknown as {
        data?: { gid: string; name: string };
      };
      const projectName = meta.data?.name;
      if (!projectName) return NextResponse.json({ error: `project ${onlyProject} not found` }, { status: 404 });

      // No modified_since — a targeted run must rewrite every row so a newly
      // added column gets populated on tasks that haven't changed recently.
      const tasks = (await asanaGetAll(
        `/projects/${onlyProject}/tasks?limit=100&opt_fields=${TASK_FIELDS}`, token
      )) as {
        gid: string; name: string; completed: boolean; completed_at: string | null;
        created_at: string; modified_at: string; due_on: string | null;
        assignee: { gid: string; name: string } | null;
        custom_fields?: { name: string; display_value: string | null }[];
      }[];

      const now = new Date().toISOString();
      const existingPodById = await fetchExistingPodIds(admin, tasks.map((t) => t.gid));
      const rows = tasks.map((t) => {
        const mappedPod = t.assignee ? podByGid.get(t.assignee.gid) ?? null : null;
        return {
          id: t.gid,
          name: t.name,
          project_id: onlyProject,
          project_name: projectName,
          assignee_id: t.assignee?.gid ?? null,
          assignee_name: t.assignee?.name ?? null,
          pod_id: t.assignee ? mappedPod ?? existingPodById.get(t.gid) ?? null : null,
          completed: t.completed,
          completed_at: t.completed_at,
          due_on: t.due_on,
          created_at: t.created_at,
          modified_at: t.modified_at,
          progress: t.custom_fields?.find((f) => f.name === "Progress")?.display_value || null,
          synced_at: now,
        };
      });
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await admin.from("asana_tasks").upsert(rows.slice(i, i + 500), { onConflict: "id" });
        if (error) throw new Error(`upsert failed for ${projectName}: ${error.message}`);
      }

      const withProgress = rows.filter((r) => r.progress).length;
      return NextResponse.json({
        ok: true, mode: "targeted", project: projectName,
        tasksUpserted: rows.length, rowsWithProgress: withProgress,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  try {
    // ── Load or start a cycle ────────────────────────────────────────────
    const { data: stateRow } = await admin
      .from("sync_state").select("value").eq("key", "asana").maybeSingle();
    let state: SyncState = (stateRow?.value as SyncState) ?? {
      queue: [], watermark: null, cycleStart: null, cycleSynced: 0, cycleDeleted: 0, failedGids: {},
    };
    // Older persisted state (pre-reconciliation / pre-retry-isolation) won't
    // have these fields yet.
    if (typeof state.cycleDeleted !== "number") state.cycleDeleted = 0;
    if (!state.failedGids || typeof state.failedGids !== "object") state.failedGids = {};

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
        failedGids: {},
      };
    }

    // ── Pod mapping: assignee gid -> pod_id via workspace user emails ────
    const podByGid = await buildPodByGid(admin, token);

    // ── Process this invocation's chunk of projects ──────────────────────
    // sync_state is persisted after EVERY project below, not once at the end
    // of the whole batch. Previously one project throwing lost every other
    // project's progress in the same batch and left that exact batch stuck
    // at the front of the queue forever — this is what happened 2026-07-22:
    // the queue sat at the same 76 projects for six days because one of them
    // kept failing and the failure discarded the batch's progress each time.
    const toProcess = state.queue.slice(0, chunk);
    state.queue = state.queue.slice(chunk);
    const now = new Date().toISOString();
    const modifiedSince = state.watermark ? `&modified_since=${encodeURIComponent(state.watermark)}` : "";
    const MAX_PROJECT_ATTEMPTS = 3;

    const results: {
      project: string; ok: boolean; synced?: number; deleted?: number;
      error?: string; requeued?: boolean;
    }[] = [];

    for (const project of toProcess) {
      try {
        const tasks = (await asanaGetAll(
          `/projects/${project.gid}/tasks?limit=100&opt_fields=${TASK_FIELDS}${modifiedSince}`, token
        )) as {
          gid: string; name: string; completed: boolean; completed_at: string | null;
          created_at: string; modified_at: string; due_on: string | null;
          assignee: { gid: string; name: string } | null;
          custom_fields?: { name: string; display_value: string | null }[];
        }[];

        let synced = 0;
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
              // Null for the vast majority of the workspace — only the
              // compliance tracker boards define a "Progress" field. Empty
              // string is normalised to null so "field exists but unset" and
              // "no such field" don't read as two different states.
              progress: t.custom_fields?.find((f) => f.name === "Progress")?.display_value || null,
              synced_at: now,
            };
          });
          for (let i = 0; i < rows.length; i += 500) {
            const { error } = await admin.from("asana_tasks").upsert(rows.slice(i, i + 500), { onConflict: "id" });
            if (error) throw new Error(`upsert failed for ${project.name}: ${error.message}`);
          }
          synced = rows.length;
        }

        // ── Tombstone reconciliation ──────────────────────────────────────
        // modified_since only surfaces tasks that were changed — a task that
        // was deleted in Asana never shows up there, so it would otherwise
        // linger in asana_tasks forever (counted as open/overdue) even though
        // it no longer exists upstream. Fetch this project's full current gid
        // list (cheap: gid only, no other fields) and drop any locally-stored
        // row for this project that isn't in it. Skippable via ?reconcile=0 —
        // this doubles Asana-side subrequest cost per project (a second full
        // paginated fetch of the same project), which matters a lot on
        // Cloudflare's Free-plan 50-subrequest-per-invocation cap.
        let staleCount = 0;
        if (reconcile) {
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
          staleCount = staleIds.length;
        }

        delete state.failedGids[project.gid];
        state.cycleSynced += synced;
        state.cycleDeleted += staleCount;
        results.push({ project: project.name, ok: true, synced, deleted: staleCount });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const attempts = (state.failedGids[project.gid] ?? 0) + 1;
        if (attempts >= MAX_PROJECT_ATTEMPTS) {
          // Give up on this project for the rest of the cycle so it can't
          // block the other ~80 forever — it's picked up again next cycle.
          delete state.failedGids[project.gid];
          results.push({ project: project.name, ok: false, error: msg, requeued: false });
          await admin.from("sync_log").insert({
            source: "asana", status: "error", records_synced: 0,
            error_message: `giving up on "${project.name}" after ${attempts} attempts: ${msg}`,
          }).then(() => {}, () => {});
        } else {
          state.failedGids[project.gid] = attempts;
          state.queue.push(project);
          results.push({ project: project.name, ok: false, error: msg, requeued: true });
          await admin.from("sync_log").insert({
            source: "asana", status: "error", records_synced: 0,
            error_message: `"${project.name}" attempt ${attempts}/${MAX_PROJECT_ATTEMPTS}, requeued: ${msg}`,
          }).then(() => {}, () => {});
        }
      }

      // Persisted after every project (not once at the end of the whole
      // batch) so one project's failure can never discard another's progress.
      // The write result was previously discarded unchecked — supabase-js
      // resolves with {error} on a DB-level failure instead of rejecting, so
      // a failure here was silently swallowed: the route kept returning
      // {ok:true} while sync_state never actually advanced. Confirmed live
      // 2026-08-12 that this is exactly what had been happening — the queue
      // was rebuilding from scratch on every single invocation because the
      // requeue-on-failure state never persisted. Throwing surfaces the real
      // cause via sync_log instead of masquerading as success.
      const { error: stateError } = await admin.from("sync_state").upsert(
        { key: "asana", value: state, updated_at: now },
        { onConflict: "key" }
      );
      if (stateError) throw new Error(`sync_state persist failed: ${stateError.message}`);
    }

    cycleCompleted = state.queue.length === 0;
    if (cycleCompleted) {
      await admin.from("sync_log").insert({
        source: "asana", status: "success", records_synced: state.cycleSynced,
      });
    }

    return NextResponse.json({
      ok: true,
      projectsProcessed: toProcess.length,
      projectsFailed: results.filter((r) => !r.ok).length,
      tasksUpserted: results.reduce((n, r) => n + (r.synced ?? 0), 0),
      tasksDeleted: results.reduce((n, r) => n + (r.deleted ?? 0), 0),
      projectsRemaining: state.queue.length,
      cycleCompleted,
      watermark: state.watermark,
      failures: results.filter((r) => !r.ok),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("sync_log").insert({ source: "asana", status: "error", records_synced: 0, error_message: msg }).then(() => {}, () => {});
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
