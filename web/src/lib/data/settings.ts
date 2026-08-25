import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export async function getAdminSettings(): Promise<Record<string, number>> {
  const admin = createAdminClient();
  const { data } = await admin.from("admin_settings").select("key, value");
  const obj: Record<string, number> = {};
  for (const row of data ?? []) obj[row.key] = Number(row.value);
  return obj;
}

export type HealthStatus = "ok" | "warn" | "critical";

// direction "highBad": exceeding the threshold is the problem (overdue tasks,
// missed calls). "lowBad": falling below it is the problem (activity %).
export function statusFor(
  value: number | null,
  warnAt: number | undefined,
  criticalAt: number | undefined,
  direction: "highBad" | "lowBad"
): HealthStatus {
  if (value == null) return "ok";
  if (direction === "highBad") {
    if (criticalAt != null && value >= criticalAt) return "critical";
    if (warnAt != null && value >= warnAt) return "warn";
  } else {
    if (criticalAt != null && value <= criticalAt) return "critical";
    if (warnAt != null && value <= warnAt) return "warn";
  }
  return "ok";
}
