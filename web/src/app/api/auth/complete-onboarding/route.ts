import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Clears app_metadata.onboarding_pending — only the service-role key can
// write app_metadata, so this can't be done from the client directly.
// Any authenticated user may clear their own flag; there's nothing
// admin-only here.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const admin = createAdminClient();
  await admin.auth.admin.updateUserById(user.id, {
    app_metadata: { onboarding_pending: false },
  });

  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  return NextResponse.json({ ok: true, role: profile?.role ?? "viewer" });
}
