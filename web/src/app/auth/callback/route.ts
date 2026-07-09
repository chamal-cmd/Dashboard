import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/auth/types";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (!code) return NextResponse.redirect(`${origin}/login?error=no-code`);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login?error=exchange-failed`);
  }

  const admin = createAdminClient();
  let profile: Profile | null = null;
  {
    const { data: byId } = await admin
      .from("profiles")
      .select("*")
      .eq("id", data.user.id)
      .maybeSingle();
    profile = byId;
  }

  if (!profile) {
    // Google re-auth case: this email was invited under a different auth
    // UID (e.g. originally invited for email/password, now signing in via
    // Google for the first time). Repoint the existing profile row's id.
    const { data: byEmail } = await admin
      .from("profiles")
      .select("*")
      .eq("email", data.user.email!)
      .maybeSingle();
    if (byEmail) {
      await admin.from("profiles").update({ id: data.user.id }).eq("email", data.user.email!);
      profile = { ...byEmail, id: data.user.id };
    }
  }

  if (!profile) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=not_invited`);
  }

  if (!profile.is_active) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=suspended`);
  }

  // No last-login write needed — Supabase already stamps
  // auth.users.last_sign_in_at natively on every sign-in.

  if (data.user.app_metadata?.onboarding_pending) {
    return NextResponse.redirect(`${origin}/auth/welcome`);
  }
  return NextResponse.redirect(`${origin}${profile.role === "admin" ? "/admin" : "/dashboard"}`);
}
