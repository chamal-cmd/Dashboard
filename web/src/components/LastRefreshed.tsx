"use client";

// Shared "as of" indicator for every page/panel that refetches data client-side
// (request 2026-08-21: "for all refreshes in the system we need a last
// refreshd time"). `at` starts null and is only ever set from inside a
// successful fetch's own success branch — never from an on-mount effect —
// so there's no server/client hydration mismatch (a client-only Date.now()
// value rendered during the initial SSR pass would produce a different
// timestamp than the one produced during hydration).
export function LastRefreshed({ at }: { at: Date | null }) {
  if (!at) return null;
  return (
    <span className="dpMuted" style={{ fontSize: 11 }} title={`Refreshed ${at.toLocaleString("en-AU")}`}>
      Last refreshed {at.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </span>
  );
}
