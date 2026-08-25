import { NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllOpenTasks } from "@/lib/data/asana";
import { getHiverInboxList } from "@/lib/data/hiver";

// Powers the top bar's global search. Pods and Asana bookkeepers come
// straight from Supabase; Hiver inboxes cost one cheap list call (~8 items).
// Hubstaff/Aircall data is deliberately excluded — those require live,
// slower external API calls that shouldn't run on every page load.
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const admin = createAdminClient();
    const [{ data: podRows }, openRows, hiverInboxes] = await Promise.all([
      admin.from("pods").select("id, name").order("name"),
      fetchAllOpenTasks(admin),
      getHiverInboxList(),
    ]);

    const peopleMap = new Map<string, string>();
    for (const r of openRows) {
      if (r.assignee_id && r.assignee_name && !peopleMap.has(r.assignee_id)) {
        peopleMap.set(r.assignee_id, r.assignee_name);
      }
    }
    const people = Array.from(peopleMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      pods: (podRows ?? []).map((p) => ({ id: p.id as string, name: p.name as string })),
      people,
      hiverInboxes: hiverInboxes.map((i) => ({ id: String(i.id), name: i.name })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
