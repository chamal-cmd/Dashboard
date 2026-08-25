"use client";

import { useState, useEffect, useCallback } from "react";
import { authedFetch } from "@/lib/supabase/authed-fetch";
import "../admin-theme.css";

interface ClientProject {
  id: string;
  name: string;
  asana_project_name: string;
  bookkeeper_member_id: string | null;
}
interface Bookkeeper { id: string; name: string; email: string }

// Registers client projects the numbered-prefix auto-detection in
// getClientProjectBreakdown (asana.ts) misses — real clients whose Asana
// project isn't numbered (e.g. "Dubbo Health Hub", checked live 2026-08-10) —
// and can override which bookkeeper a project's tasks roll up to. The
// numbered ones need no entry here; they're picked up automatically.
export default function ClientProjectsAdmin() {
  const [projects, setProjects] = useState<ClientProject[] | null>(null);
  const [bookkeepers, setBookkeepers] = useState<Bookkeeper[]>([]);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const [newAsanaName, setNewAsanaName] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newBookkeeper, setNewBookkeeper] = useState("");

  const refreshProjects = useCallback(async () => {
    const res = await authedFetch("/api/admin/client-projects");
    if (res.ok) setProjects(await res.json());
  }, []);

  useEffect(() => {
    (async () => {
      const res = await authedFetch("/api/admin/client-projects");
      if (res.ok) setProjects(await res.json());
    })();
    (async () => {
      const res = await authedFetch("/api/admin/pods");
      if (!res.ok) return;
      const pods = await res.json() as { members: { id: string; name: string; email: string }[] }[];
      const flat = pods.flatMap((p) => p.members).sort((a, b) => a.name.localeCompare(b.name));
      setBookkeepers(flat);
    })();
    (async () => {
      const res = await authedFetch("/api/admin/client-projects/candidates");
      if (res.ok) setCandidates((await res.json()).candidates ?? []);
    })();
  }, []);

  async function addProject() {
    if (!newAsanaName.trim()) return;
    setSaving("new");
    setError(null);
    const res = await authedFetch("/api/admin/client-projects", {
      method: "POST",
      body: JSON.stringify({
        name: newDisplayName.trim() || newAsanaName.trim(),
        asana_project_name: newAsanaName.trim(),
        bookkeeper_member_id: newBookkeeper || null,
      }),
    });
    if (res.ok) {
      setNewAsanaName(""); setNewDisplayName(""); setNewBookkeeper("");
      await refreshProjects();
    } else {
      setError((await res.json()).error ?? "Save failed");
    }
    setSaving(null);
  }

  async function updateProject(project: ClientProject, patch: Partial<ClientProject>) {
    setSaving(project.id);
    const res = await authedFetch(`/api/admin/client-projects/${project.id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    });
    if (res.ok) await refreshProjects();
    else setError((await res.json()).error ?? "Save failed");
    setSaving(null);
  }

  async function deleteProject(id: string) {
    if (!confirm("Remove this client project?")) return;
    setSaving(id + "-del");
    const res = await authedFetch(`/api/admin/client-projects/${id}`, { method: "DELETE" });
    if (res.ok) await refreshProjects();
    else setError((await res.json()).error);
    setSaving(null);
  }

  return (
    <div>
      {error && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 12, padding: "8px 12px", background: "#f8717115", borderRadius: 6 }}>{error}</div>}

      <div className="adminCard">
        <table className="adminTable">
          <thead>
            <tr>
              <th>Display Name</th>
              <th>Asana Project (exact match)</th>
              <th>Bookkeeper</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(projects ?? []).map((p) => (
              <tr key={p.id}>
                <td>
                  <input
                    className="adminInput adminInputSm"
                    defaultValue={p.name}
                    onBlur={(e) => e.target.value.trim() && e.target.value !== p.name && updateProject(p, { name: e.target.value.trim() })}
                    style={{ width: 200 }}
                  />
                </td>
                <td style={{ fontSize: 12, color: "var(--text-3)" }}>{p.asana_project_name}</td>
                <td>
                  <select
                    className="adminInput adminInputSm"
                    value={p.bookkeeper_member_id ?? ""}
                    onChange={(e) => updateProject(p, { bookkeeper_member_id: e.target.value || null })}
                    disabled={saving === p.id}
                    style={{ width: 180 }}
                  >
                    <option value="">Unassigned</option>
                    {bookkeepers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </td>
                <td>
                  <button className="adminBtn adminBtnSm adminBtnDanger" onClick={() => deleteProject(p.id)} disabled={saving === p.id + "-del"}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {projects != null && projects.length === 0 && (
              <tr><td colSpan={4} style={{ fontSize: 12, padding: "10px 4px", color: "var(--text-3)" }}>
                No client projects registered yet — numbered projects (&quot;04. ...&quot;) already show up automatically; add one here only for a client whose project isn&apos;t numbered.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-3)", marginBottom: 10 }}>Add client project</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            className="adminInput"
            value={newAsanaName}
            onChange={(e) => { setNewAsanaName(e.target.value); if (!newDisplayName) setNewDisplayName(e.target.value); }}
            style={{ maxWidth: 320 }}
          >
            <option value="">Pick the Asana project…</option>
            {candidates.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            className="adminInput"
            placeholder="Display name (e.g. Dubbo Health Hub)"
            value={newDisplayName}
            onChange={(e) => setNewDisplayName(e.target.value)}
            style={{ maxWidth: 240 }}
          />
          <select
            className="adminInput"
            value={newBookkeeper}
            onChange={(e) => setNewBookkeeper(e.target.value)}
            style={{ maxWidth: 200 }}
          >
            <option value="">Unassigned</option>
            {bookkeepers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button className="adminBtn" onClick={addProject} disabled={saving === "new" || !newAsanaName.trim()}>
            {saving === "new" ? "Adding…" : "Add"}
          </button>
        </div>
        {candidates.length === 0 && (
          <div className="dpMuted" style={{ fontSize: 11, marginTop: 6 }}>
            No unregistered, non-numbered active Asana projects found — every real client already looks covered.
          </div>
        )}
      </div>
    </div>
  );
}
