export type AgeBucketKey = "due0to2" | "due3to7" | "due8to14" | "due15plus";

// Shared overdue-age bucket definitions, reused across Bookkeeper Projects
// and Bookkeeper Stats so both bar charts read identically. Colors escalate
// by severity (request 2026-08-20): green/blue/amber/deep red rather than
// the original all-red shades.
export const AGE_BUCKETS: { key: AgeBucketKey; label: string; hex: string }[] = [
  { key: "due0to2", label: "0–2 days", hex: "#34d399" },
  { key: "due3to7", label: "3–7 days", hex: "#4f8ef7" },
  { key: "due8to14", label: "8–14 days", hex: "#f59e0b" },
  { key: "due15plus", label: "15+ days", hex: "#b91c1c" },
];
