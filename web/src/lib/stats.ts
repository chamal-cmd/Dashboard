// Shared descriptive-stats helpers. Kept dependency-free and pure so both
// server data layers (hubstaff.ts, asana.ts) and client components can use
// them without pulling in a stats library.

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Population standard deviation (we have the whole group, not a sample).
export function stdDev(values: number[]): number | null {
  if (values.length === 0) return null;
  const m = mean(values)!;
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// Coefficient of variation, as a percentage — std dev relative to the mean.
// Lets you compare "spread" across groups of different sizes/scales (e.g.
// workload counts across a 5-person pod vs a 15-person pod).
export function coefficientOfVariationPct(values: number[]): number | null {
  const m = mean(values);
  const sd = stdDev(values);
  if (m == null || sd == null || m === 0) return null;
  return (sd / m) * 100;
}

export const round1 = (n: number) => Math.round(n * 10) / 10;
export const roundInt = (n: number) => Math.round(n);
