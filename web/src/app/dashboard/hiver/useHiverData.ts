"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  type Inbox,
  type HiverUser as User,
  type HiverTag as Tag,
  type HiverConversation as Conversation,
} from "./hiver-shared";

export interface PodRef { id: string; name: string }

// Shared by HiverDashboard (org overview), HiverPodDashboard (per-pod
// drilldown), and the Bookkeeper Stats page's Hiver column — all three need
// the exact same "fetch every inbox sequentially, then every conversation in
// each" sweep. Duplicating it risked the views silently drifting apart on
// retry behavior and rate-limit pacing; each consumer just filters/aggregates
// the same raw conversations+users differently on top.
//
// No date-range parameter here on purpose: Hiver's API doesn't support
// filtering conversations by date (see HIVER_DATE_FILTER_NOTE in
// hiver-shared.ts for what was tried), so every fetch is simply "everything
// this inbox has."
export function useHiverData() {
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [users, setUsers] = useState<Record<number, User>>({});
  const [tags, setTags] = useState<Record<number, Tag>>({});
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [pct, setPct] = useState(0);
  const [statusMsg, setStatusMsg] = useState("Fetching inboxes...");
  const [error, setError] = useState<string | null>(null);
  const [failedInboxes, setFailedInboxes] = useState<string[]>([]);
  const [podByEmail, setPodByEmail] = useState<Record<string, string>>({});
  const [allPods, setAllPods] = useState<PodRef[]>([]);
  const loadRef = useRef(0);

  // Pod membership is independent of anything Hiver returns, so this loads
  // once rather than re-fetching every time loadAll runs.
  useEffect(() => {
    fetch("/api/pod-by-email")
      .then((r) => (r.ok ? (r.json() as Promise<{ byEmail: Record<string, string>; allPods: PodRef[] }>) : null))
      .then((d) => { if (d) { setPodByEmail(d.byEmail); setAllPods(d.allPods); } })
      .catch(() => { /* By Pod just falls back to "Unmapped" for everyone */ });
  }, []);

  const loadAll = useCallback(async () => {
    const token = ++loadRef.current;
    setLoading(true);
    setError(null);
    setPct(0);
    setStatusMsg("Fetching inboxes...");
    setInboxes([]);
    setUsers({});
    setTags({});
    setConversations([]);
    setFailedInboxes([]);

    try {
      // Step 1: get inbox list via the lightweight proxy (1 subrequest)
      const inboxRes = await fetch("/api/hiver/v1/inboxes?limit=100");
      if (!inboxRes.ok) throw new Error(`Inboxes failed: ${inboxRes.status}`);
      const inboxData = await inboxRes.json() as { data?: { results?: Inbox[] } };
      const rawInboxes: Inbox[] = inboxData.data?.results ?? [];

      if (token !== loadRef.current) return;
      setInboxes(rawInboxes);
      setPct(5);

      // Step 2: load each inbox's users+tags+conversations one at a time.
      // Tried batching 3 at once here — Hiver's rate limit doesn't tolerate
      // concurrent requests well. Also tried a pre-emptive pacing gate
      // between every request (both here and inside /api/inbox-data) to cut
      // down on rate-limit failures — measured against the full realistic
      // load, it cost more overall than it saved (see that route for the
      // numbers) and got reverted. Hiver's limit is just aggressive enough
      // that individual inboxes fail their retry budget some of the time
      // regardless; a fetchOneInbox helper below is reused for a second
      // pass after the main loop, giving any inbox that failed once a real
      // chance to succeed once the other 7 inboxes' worth of real elapsed
      // time has let the rate limit cool back down — cheaper than retrying
      // immediately, and doesn't add delay to the common case where nothing
      // fails at all.
      const allUsers: Record<number, User> = {};
      const allTags: Record<number, Tag> = {};
      const allConvs: Conversation[] = [];

      async function fetchOneInbox(inbox: Inbox): Promise<boolean> {
        try {
          const r = await fetch(`/api/inbox-data/${inbox.id}`);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const d = await r.json() as {
            userIds: number[];
            users: Record<number, User>;
            tags: Record<number, Tag>;
            conversations: Conversation[];
          };
          inbox._userIds = d.userIds;
          Object.assign(allUsers, d.users);
          Object.assign(allTags, d.tags);
          allConvs.push(...d.conversations);
          return true;
        } catch (err) {
          console.error(`Inbox ${inbox.id} failed:`, err);
          return false;
        }
      }

      let failed: Inbox[] = [];
      for (let i = 0; i < rawInboxes.length; i++) {
        if (token !== loadRef.current) return;
        const inbox = rawInboxes[i];
        setStatusMsg(`Loading inbox ${i + 1}/${rawInboxes.length}: ${inbox.display_name}`);
        if (!(await fetchOneInbox(inbox))) failed.push(inbox);
        setPct(Math.round(((i + 1) / rawInboxes.length) * 90) + 5);
      }

      if (failed.length > 0 && token === loadRef.current) {
        setStatusMsg(`Retrying ${failed.length} inbox${failed.length !== 1 ? "es" : ""} that didn't load...`);
        const stillFailed: Inbox[] = [];
        for (const inbox of failed) {
          if (token !== loadRef.current) return;
          if (!(await fetchOneInbox(inbox))) stillFailed.push(inbox);
        }
        failed = stillFailed;
      }

      if (token !== loadRef.current) return;
      setUsers(allUsers);
      setTags(allTags);
      setConversations(allConvs);
      setFailedInboxes(failed.map((i) => i.display_name));
      setStatusMsg("Done");
      setPct(100);
    } catch (e) {
      if (token !== loadRef.current) return;
      setError((e as Error).message);
    } finally {
      if (token === loadRef.current) setLoading(false);
    }
  }, []);

  // Initial load on mount. The synchronous setStates inside loadAll are
  // no-ops here (they match the initial state values), so the cascading
  // render the rule guards against can't happen.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadAll(); }, [loadAll]);

  return {
    inboxes, users, tags, conversations,
    podByEmail, allPods,
    loading, pct, statusMsg, error, failedInboxes,
    reload: () => loadAll(),
  };
}
