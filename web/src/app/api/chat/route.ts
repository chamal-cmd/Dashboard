import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getUser } from "@/lib/supabase/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAsanaOverview, type AsanaOverview, type AsanaTask } from "@/lib/data/asana";
import { getAsanaPodDetail } from "@/lib/data/asana-pod";
import { getAsanaPersonDetail } from "@/lib/data/asana-person";
import { getHubstaffOverview } from "@/lib/data/hubstaff";
import { getAircallOverview } from "@/lib/data/aircall";
import { getHiverOverview } from "@/lib/data/hiver";

// Tool-calling chatbot: every factual/numeric answer is grounded by calling
// the SAME data-layer functions the dashboard pages themselves use — the
// model never invents a figure, it reads one from Supabase/Asana/Hubstaff/
// Aircall/Hiver via these tools. Hiver is deliberately limited to the cheap
// org-wide unresolved count (getHiverOverview) rather than the full 8-inbox
// sweep (/api/hiver/bundle) — that sweep takes 60-90s sequentially (Hiver's
// rate limiter can't tolerate parallelizing it, see HiverDashboard.tsx) and
// would make the chatbot unusably slow or risk the same data-loss bug hit
// there before.
const MODEL = "claude-opus-4-8";
const MAX_TOOL_ITERATIONS = 5;
const MAX_HISTORY = 20;

// Same link surfaced on the Aircall dashboard's Messaging tab — Aircall has
// no messaging list/GET endpoint (webhook-only, see aircall.ts), so their
// own analytics page is the authoritative source until local data builds up.
const AIRCALL_MESSAGING_ANALYTICS_URL =
  "https://dashboard.aircall.io/analytics/overview/messages?date=today&date_breakdown=daily&team_filter_option=users_belong_to_team&timezone=Asia%2FColombo";

type ChatRole = "user" | "assistant";
interface ChatMessage {
  role: ChatRole;
  content: string;
}

function clampDays(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.round(n), 90);
}

function taskBrief(t: AsanaTask) {
  return { name: t.name, assignee: t.assigneeName, project: t.projectName, dueOn: t.dueOn };
}

function asanaDigest(o: AsanaOverview) {
  if (o.error) return { error: o.error };
  return {
    rangeLabel: o.rangeLabel,
    openTotal: o.openTotal,
    overdueCount: o.overdueCount,
    overdueRatePct: o.overdueRatePct,
    dueSoonCount: o.dueSoonCount,
    avgOpenTaskAgeDays: o.avgOpenTaskAgeDays,
    medianOpenTaskAgeDays: o.medianOpenTaskAgeDays,
    avgCycleTimeDays: o.avgCycleTimeDays,
    workloadImbalancePct: o.workloadImbalancePct,
    velocity: o.velocity,
    paceVsPrevPeriodPct: o.paceVsPrevPeriodPct,
    topAssignees: o.topAssignees.slice(0, 10),
    topClients: o.topClients.slice(0, 10),
    topPods: o.topPods,
    trackers: o.trackers,
    sampleOverdueTasks: o.overdueTasks.slice(0, 6).map(taskBrief),
    sampleDueSoonTasks: o.dueSoonTasks.slice(0, 6).map(taskBrief),
  };
}

type Match = { id: string; name: string };
type ResolveResult =
  | { status: "ok"; match: Match }
  | { status: "ambiguous"; matches: Match[] }
  | { status: "not_found" };

// Pods table is small (a handful of rows org-wide), so fetching every ilike
// match and deduping is cheap and exact.
async function resolvePodId(
  admin: ReturnType<typeof createAdminClient>,
  podName: string
): Promise<ResolveResult> {
  const { data } = await admin.from("pods").select("id, name").ilike("name", `%${podName}%`).limit(50);
  const rows = data ?? [];
  if (rows.length === 0) return { status: "not_found" };
  const byId = new Map<string, string>();
  for (const r of rows) byId.set(r.id as string, r.name as string);
  const matches = [...byId.entries()].map(([id, name]) => ({ id, name }));
  if (matches.length > 1) return { status: "ambiguous", matches };
  return { status: "ok", match: matches[0] };
}

// Querying asana_tasks directly for this used to seem reasonable ("a small,
// fixed roster of assignee_ids, ordering by assignee_id clusters each
// person's rows together so a generous limit surfaces every distinct
// match") but doesn't actually hold up: PostgREST silently caps every
// response at 1000 rows regardless of the requested .limit(), and a single
// prolific bookkeeper's own task-row count alone can exceed 1000 — burying
// every other real match with no indication anything was cut off (confirmed
// live: searching a common letter returned only one person's rows, out of
// ~20 real assignees who should have matched). asana_members is the actual
// bookkeeper roster (a few dozen rows total) — querying it instead sidesteps
// the cap entirely rather than trying to outrun it, matching the same
// small-table approach resolvePodId already uses for pods.
async function resolveAssignee(
  admin: ReturnType<typeof createAdminClient>,
  personName: string
): Promise<ResolveResult> {
  const { data } = await admin
    .from("asana_members")
    .select("id, name")
    .ilike("name", `%${personName}%`)
    .limit(50);
  const rows = data ?? [];
  if (rows.length === 0) return { status: "not_found" };
  const matches = rows.map((r) => ({ id: r.id as string, name: r.name as string }));
  if (matches.length > 1) return { status: "ambiguous", matches };
  return { status: "ok", match: matches[0] };
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_asana_overview",
    description:
      "Get organization-wide Asana task stats: open/overdue/due-soon counts, completion velocity, workload balance, top bookkeepers and clients by open task count, recurring-tracker status, and sample overdue/due-soon tasks. Use for any question about overall task load or workload across the whole company.",
    input_schema: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          description: "Trailing window in days for velocity/completion stats (7 for 'this week', 30 for 'this month'). Defaults to 7.",
          minimum: 1,
          maximum: 90,
        },
      },
    },
  },
  {
    name: "get_asana_pod_detail",
    description:
      "Get Asana task stats scoped to one specific pod/team (e.g. 'MAS Legato', 'Jemajo', 'Philippines'). Use when the question names a specific pod rather than the whole company.",
    input_schema: {
      type: "object",
      properties: {
        podName: { type: "string", description: "The pod name, matched case-insensitively (partial names OK)." },
        days: { type: "integer", description: "Trailing window in days. Defaults to 7.", minimum: 1, maximum: 90 },
      },
      required: ["podName"],
    },
  },
  {
    name: "get_asana_person_detail",
    description:
      "Get Asana task stats for one specific bookkeeper by name: open/overdue counts, task age, and recent completions. Use when the question names an individual.",
    input_schema: {
      type: "object",
      properties: {
        personName: { type: "string", description: "The bookkeeper's name, matched case-insensitively (partial names OK)." },
      },
      required: ["personName"],
    },
  },
  {
    name: "get_hubstaff_overview",
    description:
      "Get Hubstaff time-tracking stats: active member count, productivity/activity percentages, billable vs idle hours, and per-pod / per-member hours. Use for any question about hours worked or activity levels.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", description: "Trailing window in days (1 for 'today'). Defaults to 1.", minimum: 1, maximum: 90 },
      },
    },
  },
  {
    name: "get_aircall_overview",
    description:
      "Get Aircall phone stats: total calls, inbound vs outbound, answer/connect rates, missed calls, calls per day. Use for any question about call volume, e.g. 'how many calls a day'. Aircall's API has no endpoint for message history, so this never returns SMS/WhatsApp data — point the user to Aircall's own analytics for that.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", description: "Trailing window in days. Defaults to 7.", minimum: 1, maximum: 90 },
      },
    },
  },
  {
    name: "get_hiver_overview",
    description:
      "Get the current live count of open/unresolved Hiver email conversations across all inboxes. Use for any question about unresolved or open email volume. Does not break down by inbox — for that, direct the user to the Hiver dashboard.",
    input_schema: { type: "object", properties: {} },
  },
];

async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  const admin = createAdminClient();

  switch (name) {
    case "get_asana_overview": {
      const overview = await getAsanaOverview(clampDays(input.days, 7));
      return asanaDigest(overview);
    }
    case "get_asana_pod_detail": {
      const podName = String(input.podName ?? "").trim();
      if (!podName) return { error: "podName is required" };
      const resolved = await resolvePodId(admin, podName);
      if (resolved.status === "not_found") return { error: `No pod matching "${podName}" was found.` };
      if (resolved.status === "ambiguous") {
        return {
          ambiguous: true,
          query: podName,
          matches: resolved.matches.map((m) => ({ name: m.name })),
          message: `"${podName}" matches more than one pod (${resolved.matches.map((m) => m.name).join(", ")}). Ask the user which one they meant instead of picking one.`,
        };
      }
      const pod = resolved.match;
      const detail = await getAsanaPodDetail(pod.id, clampDays(input.days, 7));
      if (!detail) return { error: `Pod "${pod.name}" has no Asana data.` };
      return {
        podName: detail.name,
        rangeLabel: detail.rangeLabel,
        open: detail.open,
        overdue: detail.overdue,
        overdueRatePct: detail.overdueRatePct,
        dueSoon: detail.dueSoon,
        completedInRange: detail.completedInRange,
        createdInRange: detail.createdInRange,
        netInRange: detail.netInRange,
        paceVsPrevPeriodPct: detail.paceVsPrevPeriodPct,
        overallCompletionPct: detail.overallCompletionPct,
        avgOpenTaskAgeDays: detail.avgOpenTaskAgeDays,
        avgCycleTimeDays: detail.avgCycleTimeDays,
        workloadImbalancePct: detail.workloadImbalancePct,
        openByProject: detail.openByProject.slice(0, 10),
        members: detail.members.map((m) => ({
          name: m.name,
          isLeader: m.isLeader,
          total: m.total,
          dueToday: m.dueToday,
          tomorrow: m.tomorrow,
          pending: m.pending,
          completedInRange: m.completedInRange,
        })),
        sampleOverdueTasks: detail.overdueTasks.slice(0, 6).map(taskBrief),
      };
    }
    case "get_asana_person_detail": {
      const personName = String(input.personName ?? "").trim();
      if (!personName) return { error: "personName is required" };
      const resolved = await resolveAssignee(admin, personName);
      if (resolved.status === "not_found") {
        return { error: `No bookkeeper matching "${personName}" was found among current open Asana tasks.` };
      }
      if (resolved.status === "ambiguous") {
        return {
          ambiguous: true,
          query: personName,
          matches: resolved.matches.map((m) => ({ name: m.name })),
          message: `"${personName}" matches more than one bookkeeper (${resolved.matches.map((m) => m.name).join(", ")}). Ask the user which one they meant instead of picking one.`,
        };
      }
      const person = resolved.match;
      const detail = await getAsanaPersonDetail(person.id);
      if (!detail) return { error: `No Asana data found for ${person.name}.` };
      return {
        name: detail.name,
        podName: detail.podName,
        open: detail.open,
        overdue: detail.overdue,
        dueSoon: detail.dueSoon,
        completedThisWeek: detail.completedThisWeek,
        completedThisMonth: detail.completedThisMonth,
        avgOpenTaskAgeDays: detail.avgOpenTaskAgeDays,
        medianOpenTaskAgeDays: detail.medianOpenTaskAgeDays,
        openByProject: detail.openByProject.slice(0, 10),
        sampleOverdueTasks: detail.overdueTasks.slice(0, 6).map(taskBrief),
      };
    }
    case "get_hubstaff_overview": {
      // Hubstaff's own API hard-rejects date ranges over 31 days; clampDays'
      // shared 90-day ceiling is fine for Asana/Aircall but would silently
      // come back empty here, so this call site clamps tighter.
      const overview = await getHubstaffOverview(Math.min(clampDays(input.days, 1), 31), 10);
      if (overview.error) return { error: overview.error };
      return {
        rangeLabel: overview.rangeLabel,
        orgName: overview.orgName,
        activeCount: overview.activeCount,
        productivityPct: overview.productivityPct,
        avgMemberActivityPct: overview.avgMemberActivityPct,
        medianMemberActivityPct: overview.medianMemberActivityPct,
        activityStdDevPct: overview.activityStdDevPct,
        billableRatioPct: overview.billableRatioPct,
        idleRatioPct: overview.idleRatioPct,
        hoursTracked: overview.hoursTracked,
        billableHours: overview.billableHours,
        idleHours: overview.idleHours,
        pods: overview.pods,
        topMembers: overview.members.slice(0, 10).map((m) => ({
          name: m.name,
          pod: m.pod,
          hours: m.hours,
          activityPct: m.activityPct,
        })),
      };
    }
    case "get_aircall_overview": {
      // skipContacts: this digest returns counts, rates and durations only —
      // no contact names — so resolving one Aircall contact per unique phone
      // number in the window was pure latency on every chatbot answer.
      const overview = await getAircallOverview(10, clampDays(input.days, 7), { skipContacts: true });
      if (overview.error) return { error: overview.error };
      return {
        total: overview.total,
        inbound: overview.inbound,
        outboundAnswered: overview.outboundAnswered,
        outboundUnanswered: overview.outboundUnanswered,
        missedOrVoicemail: overview.missedOrVoicemail,
        callsPerDay: overview.callsPerDay,
        avgDurationSeconds: overview.avgDurationSeconds,
        medianDurationSeconds: overview.medianDurationSeconds,
        inboundAnswerRatePct: overview.inboundAnswerRatePct,
        outboundConnectRatePct: overview.outboundConnectRatePct,
        missedRatePct: overview.missedRatePct,
        lines: overview.lines,
        messaging: { note: "Aircall's API has no endpoint for message history — point the user to Aircall's own analytics instead.", analyticsUrl: AIRCALL_MESSAGING_ANALYTICS_URL },
      };
    }
    case "get_hiver_overview": {
      return await getHiverOverview();
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

const SYSTEM_PROMPT = (today: string) => `You are the operations assistant embedded in GP Bookkeeper's internal ops dashboard. You help staff understand what's happening across Asana (tasks), Hubstaff (time tracking), Aircall (phone + SMS/WhatsApp), and Hiver (shared email inboxes).

Today's date is ${today}.

Rules:
- For ANY question involving a number, count, rate, or trend, you MUST call the relevant tool and base your answer only on what it returns. Never guess, estimate, or recall a figure from general knowledge — this dashboard's whole point is real numbers.
- If a tool returns an error or a null value, say plainly that the data isn't available right now. Do not fill the gap with a made-up number.
- Pick the time window from context: "today" -> days=1, "this week" or no window mentioned -> days=7, "this month" -> days=30. State the window you used (e.g. "over the last 7 days").
- Keep answers short and concrete: lead with the number, then at most 1-2 sentences of context. This is a working dashboard for busy staff, not a report.
- If a pod or person name doesn't resolve, say so and ask for the correct name rather than guessing which one was meant.
- If get_asana_pod_detail or get_asana_person_detail returns an object with "ambiguous": true, that name matches more than one real record (e.g. two bookkeepers with the same last name) — do NOT pick one and answer. List the candidate names from "matches" and ask the user which one they meant.
- Hiver data is limited to a live org-wide unresolved count — you cannot break it down by inbox. If asked for an inbox-level Hiver breakdown, say so and point to the Hiver dashboard page.
- get_aircall_overview's messaging field is always a "note" pointing to Aircall's own analytics (analyticsUrl) — Aircall's API has no endpoint for message history, so for any message-volume question, say that and share the link instead.`;

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Chatbot not configured — ANTHROPIC_API_KEY is missing." }, { status: 500 });

  const body = (await req.json().catch(() => null)) as { messages?: ChatMessage[] } | null;
  const rawHistory = body?.messages;
  if (!Array.isArray(rawHistory) || rawHistory.length === 0) {
    return NextResponse.json({ error: "messages is required" }, { status: 400 });
  }

  const history = rawHistory
    .filter((m): m is ChatMessage => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim().length > 0)
    .slice(-MAX_HISTORY);
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return NextResponse.json({ error: "last message must be from the user" }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });
  const today = new Date().toISOString().slice(0, 10);
  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));

  try {
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT(today),
        tools: TOOLS,
        messages,
      });

      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n\n")
          .trim();
        return NextResponse.json({ reply: text || "I wasn't able to generate a response — try rephrasing your question." });
      }

      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUses.map(async (tu): Promise<Anthropic.ToolResultBlockParam> => {
          try {
            const result = await runTool(tu.name, tu.input as Record<string, unknown>);
            return { type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result) };
          } catch (e) {
            return { type: "tool_result", tool_use_id: tu.id, content: `Error: ${(e as Error).message}`, is_error: true };
          }
        })
      );
      messages.push({ role: "user", content: toolResults });
    }

    return NextResponse.json({
      reply: "I looked into several data sources but couldn't finish in time — try asking a narrower question (e.g. scope it to one integration or pod).",
    });
  } catch (e) {
    return NextResponse.json({ error: `Chatbot error: ${(e as Error).message}` }, { status: 500 });
  }
}
