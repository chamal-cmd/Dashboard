// Shared "how does this range compare" display helpers — used by both the
// org-wide overview and the pod drilldown wherever a velocity/workload
// number needs a plain-language read rather than a bare figure.

export function NetBadge({ net }: { net: number }) {
  if (net === 0) return <span style={{ color: "var(--text-3)", fontSize: 11 }}>±0</span>;
  const up = net > 0;
  return (
    <span style={{ color: up ? "#f87171" : "#34d399", fontSize: 11, fontWeight: 600 }}>
      {up ? "▲" : "▼"} {Math.abs(net)} net {up ? "increase" : "decrease"}
    </span>
  );
}

export function PaceBadge({ pct, days }: { pct: number; days: number }) {
  if (Math.abs(pct) < 5) return <span style={{ color: "var(--text-3)", fontSize: 11 }}>on pace with the prior {days}-day period</span>;
  const ahead = pct > 0;
  return (
    <span style={{ color: ahead ? "#34d399" : "#f87171", fontSize: 11, fontWeight: 600 }}>
      {ahead ? "▲" : "▼"} {Math.abs(pct)}% {ahead ? "ahead of" : "behind"} the prior {days}-day period
    </span>
  );
}

export function imbalanceLabel(pct: number): { text: string; color: string } {
  if (pct < 30) return { text: "well balanced", color: "#34d399" };
  if (pct < 60) return { text: "some imbalance", color: "#fb923c" };
  return { text: "highly imbalanced", color: "#f87171" };
}
