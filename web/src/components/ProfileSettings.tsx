"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import "./shell-theme.css";

export default function ProfileSettings({
  userId,
  initialName,
  email,
  role,
}: {
  userId: string;
  initialName: string;
  email: string;
  role: string;
}) {
  const [name, setName] = useState(initialName);
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [nameSaving, setNameSaving] = useState(false);

  const [password, setPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setNameSaving(true);
    setNameMsg(null);

    const supabase = createClient();
    // Allowed by the profiles_update_own RLS policy — no admin key needed.
    const { error } = await supabase.from("profiles").update({ full_name: name }).eq("id", userId);
    if (error) {
      setNameMsg({ ok: false, text: "Could not save your name." });
    } else {
      await supabase.auth.updateUser({ data: { full_name: name } });
      setNameMsg({ ok: true, text: "Saved." });
    }
    setNameSaving(false);
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setPasswordMsg({ ok: false, text: "Password must be at least 8 characters." });
      return;
    }
    setPasswordSaving(true);
    setPasswordMsg(null);

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setPasswordMsg({ ok: false, text: "Could not update password." });
    } else {
      setPasswordMsg({ ok: true, text: "Password updated." });
      setPassword("");
    }
    setPasswordSaving(false);
  }

  return (
    <>
      <div className="settingsCard">
        <div className="settingsCardTitle">Profile</div>
        <form onSubmit={saveName}>
          <div className="settingsField">
            <label>Full Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="settingsField">
            <label>Email</label>
            <input type="email" value={email} disabled />
          </div>
          <div className="settingsField">
            <label>Role</label>
            <input type="text" value={role} disabled />
          </div>
          <button type="submit" className="settingsBtn" disabled={nameSaving}>
            {nameSaving ? "Saving…" : "Save changes"}
          </button>
          {nameMsg && (
            <div className={`settingsMsg ${nameMsg.ok ? "settingsMsgOk" : "settingsMsgErr"}`}>{nameMsg.text}</div>
          )}
        </form>
      </div>

      <div className="settingsCard">
        <div className="settingsCardTitle">Change Password</div>
        <form onSubmit={savePassword}>
          <div className="settingsField">
            <label>New Password</label>
            <input
              type="password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <button type="submit" className="settingsBtn" disabled={passwordSaving}>
            {passwordSaving ? "Updating…" : "Update password"}
          </button>
          {passwordMsg && (
            <div className={`settingsMsg ${passwordMsg.ok ? "settingsMsgOk" : "settingsMsgErr"}`}>{passwordMsg.text}</div>
          )}
        </form>
      </div>
    </>
  );
}
