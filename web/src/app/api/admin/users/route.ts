import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, bearerFrom } from "@/lib/auth/verify-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { toAdminUserView, type Profile } from "@/lib/auth/types";

// "Last sign in" lives on auth.users, not profiles — fetch it via the
// Admin API and merge by id. Paginated defensively; a small team will
// never need more than one page, but this avoids silently truncating.
async function getLastSignInMap(admin: ReturnType<typeof createAdminClient>) {
  const map = new Map<string, string | null>();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data) break;
    for (const u of data.users) map.set(u.id, u.last_sign_in_at ?? null);
    if (data.users.length < 200) break;
  }
  return map;
}

export async function GET(req: NextRequest) {
  const check = await verifyAdmin(bearerFrom(req));
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const admin = createAdminClient();
  const { data, error } = await admin.from("profiles").select("*").order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const lastSignInByUserId = await getLastSignInMap(admin);
  const users = (data as Profile[]).map((p) => toAdminUserView(p, lastSignInByUserId.get(p.id) ?? null));
  return NextResponse.json(users);
}
