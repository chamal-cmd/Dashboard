// Custom Worker entry point — wraps OpenNext's generated fetch handler with
// a scheduled() handler for the Asana sync, so the sync runs on a real
// Cloudflare Cron Trigger instead of depending on some external pinger this
// repo has no visibility into (found 2026-08-17: whatever used to call
// /api/sync/asana on a schedule wasn't configured anywhere in this repo, and
// it silently stopped for 5 days with zero errors logged — just nothing).
//
// wrangler.jsonc's `main` points here instead of directly at
// .open-next/worker.js, which OpenNext regenerates from scratch on every
// `npm run cf:build` — a plain root-level file survives that.
//
// scheduled() calls the SAME fetch handler in-process (not a real self-fetch
// over HTTP), so it costs nothing against the Free plan's 50-subrequest cap.
//
// Two schedules, matched via event.cron (see wrangler.jsonc's triggers.crons,
// which must list these EXACT same strings):
//  - */10 * * * *  → chunk=3, reconcile=0 — frequent, cheap, keeps content
//    fresh. Proven safe at this chunk size during backlog recovery earlier.
//  - 7,37 * * * *  → chunk=2, reconcile=1 — twice an hour, smaller chunk
//    since reconcile roughly doubles Asana-side subrequest cost per project.
//    This is the ONLY thing that detects tasks deleted in Asana (found live
//    2026-08-18: a deleted "Niroga - ATO Payment Plan" task was still
//    showing as an open overdue item because nothing in this repo had ever
//    run a reconcile pass). A full sweep of ~97 projects at chunk=2 takes
//    about a day — acceptable for something as rare as a deletion.
import defaultWorker from "./.open-next/worker.js";

const RECONCILE_CRON = "7,37 * * * *";
const SYNC_URL_BASE = "https://gp-bookkeeper-ops-hub.gpbookkeeper.workers.dev/api/sync/asana";

const worker = {
  ...defaultWorker,
  async scheduled(event, env, ctx) {
    if (!env.SYNC_SECRET) return; // not configured on this environment — nothing to do
    const isReconcile = event.cron === RECONCILE_CRON;
    const chunk = isReconcile ? 2 : 3;
    const reconcile = isReconcile ? 1 : 0;
    const url = `${SYNC_URL_BASE}?secret=${encodeURIComponent(env.SYNC_SECRET)}&chunk=${chunk}&reconcile=${reconcile}`;
    ctx.waitUntil(defaultWorker.fetch(new Request(url), env, ctx));
  },
};

export default worker;
