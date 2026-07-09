import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, bearerFrom } from "@/lib/auth/verify-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sendInviteEmail } from "@/lib/email/send-invite";
import { ROLES } from "@/lib/auth/types";

export async function POST(req: NextRequest) {
  const check = await verifyAdmin(bearerFrom(req));
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { name, email, role = "viewer" } = await req.json();
  if (!name || !email) {
    return NextResponse.json({ error: "Name and email are required." }, { status: 400 });
  }
  if (!ROLES.includes(role)) {
    return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  }

  const admin = createAdminClient();
  const origin = new URL(req.url).origin;

  const { data: existing } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "A user with that email already exists." }, { status: 400 });
  }

  // Passing role via raw_user_meta_data lets the existing handle_new_user()
  // trigger create the profiles row with the right role directly — no
  // manual upsert needed (the trigger casts this to the real `user_role` enum).
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: {
      data: { full_name: name, role },
      redirectTo: `${origin}/auth/callback`,
    },
  });
  if (linkError || !linkData?.user) {
    return NextResponse.json({ error: linkError?.message ?? "Could not create invite." }, { status: 500 });
  }

  const hashedToken = linkData.properties.hashed_token;
  const inviteUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/verify?token=${encodeURIComponent(hashedToken)}&type=invite&redirect_to=${encodeURIComponent(`${origin}/auth/callback`)}`;

  await admin.auth.admin.updateUserById(linkData.user.id, {
    app_metadata: { onboarding_pending: true },
  });

  const supabase = await createClient();
  const { data: { user: invitedBy } } = await supabase.auth.getUser();
  const { sent } = await sendInviteEmail({
    to: email,
    name,
    inviteUrl,
    invitedBy: (invitedBy?.user_metadata?.full_name as string | undefined) ?? "An admin",
  });

  return NextResponse.json({ ok: true, smtp: sent, inviteUrl });
}
