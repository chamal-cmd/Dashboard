"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/supabase/authed-fetch";
import { ROLES, ROLE_LABELS, ROLE_BADGE_CLASS, STATUS_BADGE_CLASS, type AdminUserView, type Role } from "@/lib/auth/types";
import "../../admin-theme.css";

export default function UsersPanel({ selfId }: { selfId: string }) {
  const [users, setUsers] = useState<AdminUserView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("viewer");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [toastMsg, setToastMsg] = useState<{ ok: boolean; msg: string } | null>(null);

  const loadUsers = useCallback(async () => {
    const res = await authedFetch("/api/admin/users");
    if (!res.ok) return;
    setUsers(await res.json());
    setLoaded(true);
  }, []);

  useEffect(() => {
    // Standard fetch-on-mount: loadUsers only calls setState after its
    // internal `await`, not synchronously — safe despite the lint rule's
    // static trace flagging it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUsers();
  }, [loadUsers]);

  function toast(ok: boolean, msg: string) {
    setToastMsg({ ok, msg });
    setTimeout(() => setToastMsg(null), 3000);
  }

  async function sendInvite() {
    const name = inviteName.trim();
    const email = inviteEmail.trim();
    if (!name || !email) {
      setInviteResult({ ok: false, msg: "Please enter name and email." });
      return;
    }
    setInviteBusy(true);
    const res = await authedFetch("/api/admin/invite", {
      method: "POST",
      body: JSON.stringify({ name, email, role: inviteRole }),
    });
    const body = await res.json();
    setInviteBusy(false);
    if (body.ok) {
      setInviteResult({
        ok: true,
        msg: body.smtp ? `Invite sent to ${email}.` : `Invite link (copy from server console — Resend not configured).`,
      });
      setInviteName("");
      setInviteEmail("");
      await loadUsers();
    } else {
      setInviteResult({ ok: false, msg: body.error });
    }
  }

  async function changeRole(id: string, role: Role) {
    const res = await authedFetch(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ role }) });
    const body = await res.json();
    if (body.ok) { toast(true, "Role updated."); await loadUsers(); }
    else toast(false, body.error);
  }

  async function setActive(id: string, isActive: boolean) {
    const res = await authedFetch(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) });
    const body = await res.json();
    if (body.ok) { toast(true, isActive ? "User activated." : "User suspended."); await loadUsers(); }
    else toast(false, body.error);
  }

  async function deleteUser(id: string, name: string) {
    if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
    const res = await authedFetch(`/api/admin/users/${id}`, { method: "DELETE" });
    const body = await res.json();
    if (body.ok) { toast(true, "User deleted."); await loadUsers(); }
    else toast(false, body.error);
  }

  async function resendInvite(id: string, email: string) {
    const res = await authedFetch("/api/admin/invite/resend", { method: "POST", body: JSON.stringify({ id }) });
    const body = await res.json();
    if (body.ok) toast(true, `Invite resent to ${email}.`);
    else toast(false, body.error);
  }

  return (
    <>
      <div className="sh">
        <div>
          <div className="shTitle">Invite New User</div>
          <div className="shSub">An email invite link will be sent. They set their own password.</div>
        </div>
      </div>
      <div className="inviteCard">
        <div className="inviteRow">
          <div className="f"><label>Name</label><input value={inviteName} onChange={(e) => setInviteName(e.target.value)} type="text" placeholder="Full name" /></div>
          <div className="f"><label>Email</label><input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} type="email" placeholder="user@example.com" /></div>
          <div className="f" style={{ maxWidth: 150 }}>
            <label>Role</label>
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          <button className="btnInvite" disabled={inviteBusy} onClick={sendInvite}>
            {inviteBusy ? "Sending…" : "Send Invite"}
          </button>
        </div>
        {inviteResult && (
          <div className={`inviteResult ${inviteResult.ok ? "inviteResultOk" : "inviteResultErr"}`}>{inviteResult.msg}</div>
        )}
      </div>

      <div className="sh">
        <div>
          <div className="shTitle">All Users</div>
          <div className="shSub">{loaded ? `${users.length} user${users.length !== 1 ? "s" : ""}` : ""}</div>
        </div>
        <button className="backBtn" style={{ fontSize: 11 }} onClick={loadUsers}>↻ Refresh</button>
      </div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last Login</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {!loaded ? (
              <tr><td colSpan={6} className="empty">Loading…</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={6} className="empty">No users yet.</td></tr>
            ) : (
              users.map((u) => {
                const isSelf = u.id === selfId;
                const lastLogin = u.lastLogin
                  ? new Date(u.lastLogin).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
                  : "—";
                return (
                  <tr key={u.id}>
                    <td><strong style={{ color: "#f0f2ff" }}>{u.name}</strong>{isSelf && <span style={{ fontSize: 10, color: "#4f8ef7" }}> (you)</span>}</td>
                    <td style={{ color: "#6b7280" }}>{u.email}</td>
                    <td><span className={`badge ${ROLE_BADGE_CLASS[u.role]}`}>{ROLE_LABELS[u.role]}</span></td>
                    <td><span className={`badge ${STATUS_BADGE_CLASS[u.status]}`}>{u.status}</span></td>
                    <td style={{ color: "#6b7280", fontSize: 12 }}>{lastLogin}</td>
                    <td>
                      {isSelf ? (
                        <span style={{ color: "#374151", fontSize: 11 }}>You</span>
                      ) : (
                        <div className="actRow">
                          <select className="roleSel" value={u.role} onChange={(e) => changeRole(u.id, e.target.value as Role)}>
                            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                          </select>
                          {u.status !== "suspended" ? (
                            <button className="actBtn actBtnWarn" onClick={() => setActive(u.id, false)}>Suspend</button>
                          ) : (
                            <button className="actBtn" onClick={() => setActive(u.id, true)}>Activate</button>
                          )}
                          {u.status === "pending" && (
                            <button className="actBtn" onClick={() => resendInvite(u.id, u.email)}>Resend</button>
                          )}
                          <button className="actBtn actBtnDanger" onClick={() => deleteUser(u.id, u.name)}>Delete</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {toastMsg && (
        <div className={`toast toastShow ${toastMsg.ok ? "toastOk" : "toastErr"}`}>{toastMsg.msg}</div>
      )}
    </>
  );
}
