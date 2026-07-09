"use client";

import { useState } from "react";
import { authedFetch } from "@/lib/supabase/authed-fetch";
import "../admin-theme.css";

interface Settings { [key: string]: number }

const SECTIONS = [
  {
    title: "Asana",
    rows: [
      { key: "asana.overdue_warn",     label: "Overdue tasks — warn at",     unit: "tasks", color: "#f97316" },
      { key: "asana.overdue_critical", label: "Overdue tasks — critical at",  unit: "tasks", color: "#ef4444" },
    ],
  },
  {
    title: "Hubstaff",
    rows: [
      { key: "hubstaff.activity_warn",     label: "Avg activity — warn below",     unit: "%",     color: "#f97316" },
      { key: "hubstaff.activity_critical", label: "Avg activity — critical below",  unit: "%",     color: "#ef4444" },
    ],
  },
  {
    title: "Aircall",
    rows: [
      { key: "aircall.missed_warn",     label: "Missed calls — warn at",    unit: "calls", color: "#f97316" },
      { key: "aircall.missed_critical", label: "Missed calls — critical at", unit: "calls", color: "#ef4444" },
    ],
  },
  {
    title: "Hiver",
    rows: [
      { key: "hiver.open_warn",     label: "Open emails — warn at",    unit: "emails", color: "#f97316" },
      { key: "hiver.open_critical", label: "Open emails — critical at", unit: "emails", color: "#ef4444" },
    ],
  },
];

export default function ThresholdsAdmin({ initial }: { initial: Settings }) {
  const [values, setValues] = useState<Settings>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    const res = await authedFetch("/api/admin/settings", {
      method: "POST",
      body: JSON.stringify(values),
    });
    if (res.ok) setSaved(true);
    else setError((await res.json()).error ?? "Save failed");
    setSaving(false);
  }

  return (
    <div>
      {error && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 12, padding: "8px 12px", background: "#ef444415", borderRadius: 6 }}>{error}</div>}

      <div className="adminThresholdGrid">
        {SECTIONS.map((section) => (
          <div className="adminThresholdCard" key={section.title}>
            <div className="adminThresholdTitle">{section.title}</div>
            {section.rows.map((row) => (
              <div className="adminThresholdRow" key={row.key}>
                <div className="adminThresholdLbl">{row.label}</div>
                <input
                  type="number"
                  className="adminThresholdInput"
                  value={values[row.key] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [row.key]: Number(e.target.value) }))}
                  min={0}
                />
                <div className="adminThresholdSwatch" style={{ background: row.color }} />
                <div className="adminThresholdUnit">{row.unit}</div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="adminSaveBar">
        <button className="adminBtn" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save all thresholds"}
        </button>
        {saved && <span className="adminSaved">Saved</span>}
        <span style={{ fontSize: 12, color: "#6b7280" }}>
          Thresholds affect badge colours on the overview dashboard. Changes take effect immediately.
        </span>
      </div>
    </div>
  );
}
