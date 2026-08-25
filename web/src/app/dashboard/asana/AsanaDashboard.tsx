"use client";

import type { AsanaOverview } from "@/lib/data/asana";
import { LoadingScreen } from "@/components/LoadingScreen";
import { ControlPanelShell } from "@/components/ControlPanelShell";
import { AsanaSectionTabs } from "@/components/asana/AsanaSectionTabs";
import { AsanaRangeControls } from "@/components/asana/AsanaRangeControls";
import { useAsanaRange } from "@/components/asana/useAsanaRange";
import { LastRefreshed } from "@/components/LastRefreshed";

// Overview — content cleared on request, starting from blank. The section
// structure (this page + the six others under AsanaSectionTabs) stays; the
// panels that used to live here (Open Tasks KPIs, Velocity, Backlog Health)
// were removed. Previous content backed up outside the repo, not committed
// to git — ask if any of it needs to come back.
export default function AsanaDashboard({ initial }: { initial: AsanaOverview }) {
  const { asana, days, custom, setCustom, loading, pickPreset, submitCustom, refreshData, lastRefreshed } = useAsanaRange(initial);

  if (loading) {
    return <LoadingScreen icon="✓" title="ASANA" status="Loading Asana data…" color="#a78bfa" />;
  }

  return (
    <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
      <main style={{ flex: 1, minWidth: 340 }}>
        <AsanaSectionTabs />

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(167,139,250,0.13)", border: "1px solid rgba(167,139,250,0.35)", color: "#c4b5fd", borderRadius: 999, padding: "6px 14px", fontSize: 12, fontWeight: 600 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#a78bfa" }} />
            Showing {asana.rangeLabel}
          </div>
          <button className="acTab" onClick={refreshData} title="Re-fetch the latest data for the current range">
            ↻ Refresh
          </button>
          <LastRefreshed at={lastRefreshed} />
        </div>

        <div className="dpTableWrap">
          <div className="dpEmpty">Nothing here yet — this section is starting from blank.</div>
        </div>
      </main>

      <ControlPanelShell storageKey="asana-overview">
        <AsanaRangeControls days={days} custom={custom} setCustom={setCustom} loading={loading} pickPreset={pickPreset} submitCustom={submitCustom} allPods={asana.allPods} />
      </ControlPanelShell>
    </div>
  );
}
