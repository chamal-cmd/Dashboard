"use client";

import { useState, useCallback } from "react";
import { authedFetch } from "@/lib/supabase/authed-fetch";
import "../admin-theme.css";

interface Tracker {
  id: string; key: string; label: string;
  project_name: string | null; active: boolean; sort_order: number;
}

export default function TrackersAdmin({ initial }: { initial: Tracker[] }) {
  const [trackers, setTrackers] = useState<Tracker[]>(initial);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newProject, setNewProject] = useState("");

  const refresh = useCallback(async () => {
    const res = await authedFetch("/api/admin/trackers");
    if (res.ok) setTrackers(await res.json());
  }, []);

  async function update(tracker: Tracker, patch: Partial<Tracker>) {
    setSaving(tracker.id);
    setError(null);
    const res = await authedFetch(`/api/admin/trackers/${tracker.id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    });
    if (res.ok) await refresh();
    else setError((await res.json()).error ?? "Save failed");
    setSaving(null);
  }

  async function deleteTracker(id: string) {
    if (!confirm("Delete this tracker?")) return;
    setSaving(id + "-del");
    const res = await authedFetch(`/api/admin/trackers/${id}`, { method: "DELETE" });
    if (res.ok) await refresh();
    else setError((await res.json()).error);
    setSaving(null);
  }

  async function addTracker() {
    if (!newLabel.trim()) return;
    setSaving("new");
    setError(null);
    const res = await authedFetch("/api/admin/trackers", {
      method: "POST",
      body: JSON.stringify({ label: newLabel.trim(), project_name: newProject.trim() || null }),
    });
    if (res.ok) { setNewLabel(""); setNewProject(""); await refresh(); }
    else setError((await res.json()).error);
    setSaving(null);
  }

  return (
    <div>
      {error && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 12, padding: "8px 12px", background: "#ef444415", borderRadius: 6 }}>{error}</div>}

      <div className="adminCard">
        <table className="adminTable">
          <thead>
            <tr>
              <th>Label</th>
              <th>Asana Project Name (exact match)</th>
              <th>Active</th>
              <th>Order</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {trackers.map((t) => (
              <TrackerRow
                key={t.id}
                tracker={t}
                saving={saving === t.id}
                onSave={(patch) => update(t, patch)}
                onDelete={() => deleteTracker(t.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#9ca3af", marginBottom: 10 }}>Add tracker</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            className="adminInput"
            placeholder="Label (e.g. PAYG withholding tracker)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            style={{ maxWidth: 280 }}
          />
          <input
            className="adminInput"
            placeholder="Asana project name (optional, must be exact)"
            value={newProject}
            onChange={(e) => setNewProject(e.target.value)}
            style={{ maxWidth: 340 }}
          />
          <button
            className="adminBtn"
            onClick={addTracker}
            disabled={saving === "new" || !newLabel.trim()}
          >
            {saving === "new" ? "Adding…" : "Add tracker"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TrackerRow({
  tracker, saving, onSave, onDelete,
}: {
  tracker: Tracker;
  saving: boolean;
  onSave: (patch: Partial<Tracker>) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(tracker.label);
  const [project, setProject] = useState(tracker.project_name ?? "");
  const [order, setOrder] = useState(String(tracker.sort_order));

  return (
    <tr>
      <td>
        <input
          className="adminInput adminInputSm"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => label !== tracker.label && onSave({ label })}
          onKeyDown={(e) => { if (e.key === "Enter") onSave({ label }); }}
          style={{ width: 200 }}
        />
      </td>
      <td>
        <input
          className="adminInput adminInputSm"
          value={project}
          onChange={(e) => setProject(e.target.value)}
          onBlur={() => onSave({ project_name: project.trim() || null })}
          onKeyDown={(e) => { if (e.key === "Enter") onSave({ project_name: project.trim() || null }); }}
          placeholder="no project linked"
          style={{ width: 300 }}
        />
      </td>
      <td>
        <input
          type="checkbox"
          className="adminToggle"
          checked={tracker.active}
          onChange={(e) => onSave({ active: e.target.checked })}
          disabled={saving}
        />
      </td>
      <td>
        <input
          className="adminInput adminInputSm"
          type="number"
          value={order}
          onChange={(e) => setOrder(e.target.value)}
          onBlur={() => onSave({ sort_order: Number(order) })}
          style={{ width: 56, textAlign: "center" }}
        />
      </td>
      <td>
        <button className="adminBtn adminBtnSm adminBtnDanger" onClick={onDelete} disabled={saving}>
          Delete
        </button>
      </td>
    </tr>
  );
}
