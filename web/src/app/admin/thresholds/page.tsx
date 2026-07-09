import { createAdminClient } from "@/lib/supabase/admin";
import ThresholdsAdmin from "./ThresholdsAdmin";
import "../admin-theme.css";

async function getSettings() {
  const admin = createAdminClient();
  const { data } = await admin.from("admin_settings").select("key, value");
  const obj: Record<string, number> = {};
  for (const row of data ?? []) obj[row.key] = Number(row.value);
  return obj;
}

export default async function ThresholdsPage() {
  const settings = await getSettings().catch(() => ({} as Record<string, number>));

  return (
    <div className="shellPage">
      <div className="shellPageTitle">Alert Thresholds</div>
      <div className="shellPageSub">
        Set warn (orange) and critical (red) levels for key metrics across all integrations.
      </div>

      <div style={{ marginTop: 20 }}>
        <ThresholdsAdmin initial={settings} />
      </div>
    </div>
  );
}
