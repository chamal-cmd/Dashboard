"use client";

import { useState, useEffect } from "react";

// A dashboard card whose body can be hidden, with the hidden/shown choice
// remembered per-card in localStorage so it survives reloads. The header
// (title + Hide/Show toggle) always stays visible so a hidden graph can be
// brought back. Used to let users declutter the Asana/Hubstaff pages by
// hiding graphs they don't care about.
export function HideableCard({
  storageKey,
  title,
  subtitle,
  children,
}: {
  storageKey: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  // Starts shown on both server and first client render (avoids a hydration
  // mismatch); the stored preference is applied in an effect right after.
  const [hidden, setHidden] = useState(false);

  // Reading localStorage must happen after mount (it doesn't exist during SSR),
  // so applying the saved preference here is intentional — starting shown on
  // both server and first client render is what keeps hydration consistent.
  useEffect(() => {
    let stored = false;
    try { stored = localStorage.getItem(`hidegraph:${storageKey}`) === "1"; } catch { /* blocked → stay shown */ }
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHidden(true);
    }
  }, [storageKey]);

  const toggle = () => {
    setHidden((prev) => {
      const next = !prev;
      try { localStorage.setItem(`hidegraph:${storageKey}`, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <div className="dpTableWrap" style={{ marginBottom: 20 }}>
      <div className="dpTableHead">
        <div>
          <div className="dpTableTitle">{title}</div>
          {subtitle && <div className="dpTableSub">{subtitle}</div>}
        </div>
        <button className="acTab" onClick={toggle} aria-expanded={!hidden}>
          {hidden ? "Show ▾" : "Hide ▴"}
        </button>
      </div>
      {!hidden && children}
    </div>
  );
}
