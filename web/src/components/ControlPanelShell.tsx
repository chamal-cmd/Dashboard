"use client";

import { useState, useEffect } from "react";

// Sticky sidebar shell for a dashboard's control panel (date range, show/hide
// toggles, etc.) — collapsible down to a slim strip so the chart column can
// have the full width when the controls aren't needed. Collapsed/expanded
// state is remembered per-dashboard (storageKey) across reloads.
export function ControlPanelShell({ storageKey, children }: { storageKey: string; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(`panel-collapsed:${storageKey}`) === "1") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCollapsed(true);
      }
    } catch { /* ignore */ }
  }, [storageKey]);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(`panel-collapsed:${storageKey}`, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  if (collapsed) {
    return (
      <aside style={{ width: 40, flexShrink: 0, position: "sticky", top: 16, alignSelf: "flex-start" }}>
        <button className="acTab" onClick={toggle} title="Show control panel" aria-expanded={false} style={{ width: "100%", padding: "10px 0", writingMode: "vertical-rl", textOrientation: "mixed" }}>
          ☰ Controls
        </button>
      </aside>
    );
  }

  return (
    <aside style={{ width: 240, flexShrink: 0, position: "sticky", top: 16, alignSelf: "flex-start" }}>
      <div className="dpTableWrap" style={{ padding: 16, marginBottom: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div className="dpTableTitle" style={{ marginBottom: 0 }}>Control panel</div>
          <button className="acTab" onClick={toggle} title="Collapse control panel" aria-expanded={true} style={{ padding: "2px 9px" }}>«</button>
        </div>
        {children}
      </div>
    </aside>
  );
}
