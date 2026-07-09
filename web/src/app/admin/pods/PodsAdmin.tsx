"use client";

import { useState, useCallback } from "react";
import { authedFetch } from "@/lib/supabase/authed-fetch";
import "../admin-theme.css";

interface Member { id: string; email: string; pod_id: string }
interface Pod { id: string; name: string; color: string | null; members: Member[] }

export default function PodsAdmin({ initial }: { initial: Pod[] }) {
  const [pods, setPods] = useState<Pod[]>(initial);
  const [saving, setSaving] = useState<string | null>(null);
  const [newPodName, setNewPodName] = useState("");
  const [addEmails, setAddEmails] = useState<Record<string, string>>({});
  const [editNames, setEditNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await authedFetch("/api/admin/pods");
    if (res.ok) setPods(await res.json());
  }, []);

  async function createPod() {
    if (!newPodName.trim()) return;
    setSaving("new");
    setError(null);
    const res = await authedFetch("/api/admin/pods", {
      method: "POST",
      body: JSON.stringify({ name: newPodName.trim() }),
    });
    if (res.ok) { setNewPodName(""); await refresh(); }
    else setError((await res.json()).error);
    setSaving(null);
  }

  async function renamePod(pod: Pod) {
    const name = editNames[pod.id]?.trim() ?? pod.name;
    if (!name || name === pod.name) return;
    setSaving(pod.id + "-name");
    const res = await authedFetch(`/api/admin/pods/${pod.id}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    });
    if (res.ok) await refresh();
    else setError((await res.json()).error);
    setSaving(null);
  }

  async function deletePod(pod: Pod) {
    if (!confirm(`Delete pod "${pod.name}"? Members will be unassigned.`)) return;
    setSaving(pod.id + "-del");
    const res = await authedFetch(`/api/admin/pods/${pod.id}`, { method: "DELETE" });
    if (res.ok) await refresh();
    else setError((await res.json()).error);
    setSaving(null);
  }

  async function addMember(pod: Pod) {
    const email = addEmails[pod.id]?.trim().toLowerCase();
    if (!email) return;
    setSaving(pod.id + "-add");
    setError(null);
    const res = await authedFetch(`/api/admin/pods/${pod.id}/members`, {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    if (res.ok) { setAddEmails((p) => ({ ...p, [pod.id]: "" })); await refresh(); }
    else setError((await res.json()).error);
    setSaving(null);
  }

  async function removeMember(memberId: string) {
    setSaving(memberId);
    const res = await authedFetch(`/api/admin/members/${memberId}`, { method: "DELETE" });
    if (res.ok) await refresh();
    else setError((await res.json()).error);
    setSaving(null);
  }

  return (
    <div>
      {error && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 12, padding: "8px 12px", background: "#ef444415", borderRadius: 6 }}>{error}</div>}

      {pods.map((pod) => (
        <div className="podCard" key={pod.id}>
          <div className="podCardHead">
            <div>
              <div className="adminInlineEdit">
                <input
                  value={editNames[pod.id] ?? pod.name}
                  onChange={(e) => setEditNames((p) => ({ ...p, [pod.id]: e.target.value }))}
                  onBlur={() => renamePod(pod)}
                  onKeyDown={(e) => { if (e.key === "Enter") renamePod(pod); }}
                />
              </div>
              <div className="podMemberCount">{pod.members.length} member{pod.members.length !== 1 ? "s" : ""}</div>
            </div>
            <button
              className="adminBtn adminBtnSm adminBtnDanger"
              onClick={() => deletePod(pod)}
              disabled={saving === pod.id + "-del"}
            >
              Delete pod
            </button>
          </div>

          {pod.members.length > 0 && (
            <div className="podMemberList">
              {pod.members.map((m) => (
                <div className="podMemberRow" key={m.id}>
                  <span className="podMemberEmail">{m.email}</span>
                  <button
                    className="adminBtn adminBtnSm adminBtnDanger"
                    onClick={() => removeMember(m.id)}
                    disabled={saving === m.id}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="podAddRow">
            <input
              className="adminInput adminInputSm"
              placeholder="bookkeeper@gpbookkeeper.com.au"
              value={addEmails[pod.id] ?? ""}
              onChange={(e) => setAddEmails((p) => ({ ...p, [pod.id]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") addMember(pod); }}
            />
            <button
              className="adminBtn adminBtnSm"
              onClick={() => addMember(pod)}
              disabled={saving === pod.id + "-add" || !addEmails[pod.id]?.trim()}
            >
              Add email
            </button>
          </div>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input
          className="adminInput"
          placeholder="New pod name (e.g. Pod A)"
          value={newPodName}
          onChange={(e) => setNewPodName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") createPod(); }}
          style={{ maxWidth: 300 }}
        />
        <button
          className="adminBtn"
          onClick={createPod}
          disabled={saving === "new" || !newPodName.trim()}
        >
          {saving === "new" ? "Creating…" : "Create pod"}
        </button>
      </div>
    </div>
  );
}
