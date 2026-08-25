import type { AsanaTask } from "@/lib/data/asana";
import { auTodayISODateClient } from "@/lib/business-tz-client";

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = iso.slice(0, 10);
  const [y, m, day] = d.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const label = `${months[parseInt(m) - 1]} ${parseInt(day)}`;
  return parseInt(y) !== new Date().getFullYear() ? `${label}, ${y}` : label;
}

export function isOverdue(dueOn: string | null): boolean {
  return !!dueOn && dueOn < auTodayISODateClient();
}

// Shared across the Asana overview, person drilldown, and pod drilldown
// tables. `showAssignee` defaults on for the org-wide/pod views; the person
// page passes false since every row already belongs to that one person.
export function TaskRow({
  task,
  showCompleted,
  showAssignee = true,
}: {
  task: AsanaTask;
  showCompleted?: boolean;
  showAssignee?: boolean;
}) {
  const overdue = !showCompleted && isOverdue(task.dueOn);
  // "0" in place of a project gid is a documented Asana shorthand — Asana
  // resolves the task by its own gid regardless and redirects to the right
  // project context, so no project id needs to be looked up or stored here.
  const asanaUrl = `https://app.asana.com/0/0/${task.id}`;
  return (
    <tr>
      <td className="dpPrimary" style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <a href={asanaUrl} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none" }} title="Open in Asana">
          {task.name || "—"}
        </a>
      </td>
      {showAssignee && (
        <td className="dpMuted" style={{ whiteSpace: "nowrap" }}>{task.assigneeName ?? "—"}</td>
      )}
      <td className="dpMuted" style={{ whiteSpace: "nowrap", color: overdue ? "#f87171" : undefined }}>
        {showCompleted ? fmtDate(task.completedAt) : fmtDate(task.dueOn)}
        {overdue && <span style={{ fontSize: 9, background: "#f8717120", color: "#f87171", borderRadius: 3, padding: "0 4px", marginLeft: 6 }}>overdue</span>}
      </td>
      <td className="dpMuted" style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
        {task.projectName ?? "—"}
      </td>
    </tr>
  );
}
