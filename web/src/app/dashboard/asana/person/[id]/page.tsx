import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/get-user";
import { getAsanaPersonDetail } from "@/lib/data/asana-person";
import { TaskRow } from "@/components/asana/TaskRow";
import { InfoTip } from "@/components/InfoTip";
import { displayName } from "@/lib/asana-client-map";
import "@/components/detail-page-theme.css";
import "@/components/info-tip.css";

export const dynamic = "force-dynamic";

export default async function AsanaPersonPage({ params }: { params: Promise<{ id: string }> }) {
  // Check auth before touching data: the layout also gates, but layout and
  // page render concurrently — without this, an unauthenticated hit aborts
  // the page's queries and surfaces as a 404 instead of the login redirect.
  const user = await getUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const person = await getAsanaPersonDetail(id);
  if (!person) notFound();

  return (
    <div className="shellPage dpPage">
      <div className="dpHeader">
        <div className="dpHeaderLeft">
          <div style={{ marginBottom: 6 }}>
            <Link href="/dashboard/asana" style={{ fontSize: 12, color: "#4f8ef7", textDecoration: "none" }}>← Asana overview</Link>
          </div>
          <div className="dpTitle">{displayName(person.name)}</div>
          <div className="dpSub">{person.podName ?? "No pod"} · Asana workload</div>
        </div>
        <span className="dpBadge dpBadgeLive">Live</span>
      </div>

      {/* ── Workload KPIs ─────────────────────────────────── */}
      <div className="dpSectionLbl">Workload</div>
      <div className="dpKpiGrid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <a href="#section-open" className="dpKpi" style={{ "--kpi-accent": "#4f8ef7", textDecoration: "none", color: "inherit" } as React.CSSProperties}>
          <div className="dpKpiVal">{person.open}</div>
          <div className="dpKpiLbl">Open tasks<InfoTip text="Every incomplete task currently assigned to this person — a live count." /></div>
        </a>
        <a href="#section-overdue" className="dpKpi" style={{ "--kpi-accent": "#f87171", textDecoration: "none", color: "inherit" } as React.CSSProperties}>
          <div className="dpKpiVal">{person.overdue}</div>
          <div className="dpKpiLbl">Overdue<InfoTip text="This person's open tasks whose due date has already passed." /></div>
        </a>
        <a href="#section-duesoon" className="dpKpi" style={{ "--kpi-accent": "#fbbf24", textDecoration: "none", color: "inherit" } as React.CSSProperties}>
          <div className="dpKpiVal">{person.dueSoon}</div>
          <div className="dpKpiLbl">Due in next 7 days<InfoTip text="This person's open tasks due within the next 7 days." /></div>
        </a>
        <div className="dpKpi" style={{ "--kpi-accent": "#a78bfa" } as React.CSSProperties}>
          <div className="dpKpiVal">{person.avgOpenTaskAgeDays != null ? `${person.avgOpenTaskAgeDays}d` : "—"}</div>
          <div className="dpKpiLbl">Avg open task age{person.medianOpenTaskAgeDays != null ? ` (median ${person.medianOpenTaskAgeDays}d)` : ""}<InfoTip text="Mean days since creation across this person's open tasks. Median is shown too since a few very old tasks can skew the average upward." /></div>
        </div>
      </div>

      <div className="dpSectionLbl" style={{ marginTop: 8 }}>Throughput</div>
      <div className="dpKpiGrid dpKpiGridLast" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <a href="#section-completed" className="dpKpi" style={{ "--kpi-accent": "#34d399", textDecoration: "none", color: "inherit" } as React.CSSProperties}>
          <div className="dpKpiVal">{person.completedThisWeek}</div>
          <div className="dpKpiLbl">Completed this week<InfoTip text="Tasks this person marked complete in the last 7 days." /></div>
        </a>
        <a href="#section-completed" className="dpKpi" style={{ "--kpi-accent": "#34d399", textDecoration: "none", color: "inherit" } as React.CSSProperties}>
          <div className="dpKpiVal">{person.completedThisMonth}</div>
          <div className="dpKpiLbl">Completed this month<InfoTip text="Tasks this person marked complete in the last 30 days." /></div>
        </a>
      </div>

      {/* ── Open by Client ────────────────────────────────── */}
      <div className="dpTableWrap" style={{ marginBottom: 28 }}>
        <div className="dpTableHead">
          <div>
            <div className="dpTableTitle">Open by Client / Project</div>
            <div className="dpTableSub">{person.openByProject.length} projects with open tasks</div>
          </div>
        </div>
        {person.openByProject.length === 0 ? (
          <div className="dpEmpty">No open tasks.</div>
        ) : (
          <table className="dpTable">
            <thead><tr><th>Client / Project</th><th>Open</th><th>Overdue</th></tr></thead>
            <tbody>
              {person.openByProject.map((p) => (
                <tr key={p.project}>
                  <td className="dpPrimary">{p.project}</td>
                  <td className="dpMuted">{p.open}</td>
                  <td style={{ color: p.overdue > 0 ? "#f87171" : "var(--text-3)", fontSize: 13 }}>{p.overdue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── All open tasks (flat) ─────────────────────────── */}
      <div id="section-open" className="dpTableWrap" style={{ marginBottom: 28 }}>
        <div className="dpTableHead">
          <div>
            <div className="dpTableTitle">All Open Tasks</div>
            <div className="dpTableSub">Every incomplete task assigned to this person — {person.openTasks.length} total</div>
          </div>
        </div>
        {person.openTasks.length === 0 ? (
          <div className="dpEmpty">No open tasks.</div>
        ) : (
          <table className="dpTable">
            <thead><tr><th>Task</th><th>Due</th><th>Project</th></tr></thead>
            <tbody>{person.openTasks.map((t) => <TaskRow key={t.id} task={t} showAssignee={false} />)}</tbody>
          </table>
        )}
      </div>

      {/* ── Overdue ───────────────────────────────────────── */}
      <div id="section-overdue" className="dpTableWrap" style={{ marginBottom: 28 }}>
        <div className="dpTableHead">
          <div>
            <div className="dpTableTitle" style={{ color: "#f87171" }}>Overdue Tasks</div>
            <div className="dpTableSub">Oldest first — {person.overdueTasks.length} total</div>
          </div>
        </div>
        {person.overdueTasks.length === 0 ? (
          <div className="dpEmpty">No overdue tasks.</div>
        ) : (
          <table className="dpTable">
            <thead><tr><th>Task</th><th>Due</th><th>Project</th></tr></thead>
            <tbody>{person.overdueTasks.map((t) => <TaskRow key={t.id} task={t} showAssignee={false} />)}</tbody>
          </table>
        )}
      </div>

      {/* ── Due soon ──────────────────────────────────────── */}
      <div id="section-duesoon" className="dpTableWrap" style={{ marginBottom: 28 }}>
        <div className="dpTableHead">
          <div>
            <div className="dpTableTitle" style={{ color: "#fbbf24" }}>Due in Next 7 Days</div>
            <div className="dpTableSub">Earliest first — {person.dueSoonTasks.length} total</div>
          </div>
        </div>
        {person.dueSoonTasks.length === 0 ? (
          <div className="dpEmpty">No tasks due in the next 7 days.</div>
        ) : (
          <table className="dpTable">
            <thead><tr><th>Task</th><th>Due</th><th>Project</th></tr></thead>
            <tbody>{person.dueSoonTasks.map((t) => <TaskRow key={t.id} task={t} showAssignee={false} />)}</tbody>
          </table>
        )}
      </div>

      {/* ── Recently completed ────────────────────────────── */}
      <div id="section-completed" className="dpTableWrap" style={{ marginBottom: 28 }}>
        <div className="dpTableHead">
          <div>
            <div className="dpTableTitle" style={{ color: "#34d399" }}>Recently Completed</div>
            <div className="dpTableSub">Last 30 days — {person.recentCompletions.length} total</div>
          </div>
        </div>
        {person.recentCompletions.length === 0 ? (
          <div className="dpEmpty">No tasks completed in the last 30 days.</div>
        ) : (
          <table className="dpTable">
            <thead><tr><th>Task</th><th>Completed</th><th>Project</th></tr></thead>
            <tbody>{person.recentCompletions.map((t) => <TaskRow key={t.id} task={t} showCompleted showAssignee={false} />)}</tbody>
          </table>
        )}
      </div>

      {/* ── Recently modified ─────────────────────────────── */}
      <div id="section-modified" className="dpTableWrap" style={{ marginBottom: 24 }}>
        <div className="dpTableHead">
          <div>
            <div className="dpTableTitle">Recently Modified</div>
            <div className="dpTableSub">Open tasks, last 30 days — most recently updated first — {person.recentlyModified.length} total</div>
          </div>
        </div>
        {person.recentlyModified.length === 0 ? (
          <div className="dpEmpty">No open tasks modified in the last 30 days.</div>
        ) : (
          <table className="dpTable">
            <thead><tr><th>Task</th><th>Due</th><th>Project</th></tr></thead>
            <tbody>{person.recentlyModified.map((t) => <TaskRow key={t.id} task={t} showAssignee={false} />)}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
