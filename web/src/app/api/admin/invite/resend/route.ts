import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, bearerFrom } from "@/lib/auth/verify-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sendInviteEmail } from "@/lib/email/send-invite";
import type { Profile } from "@/lib/auth/types";

export async function POST(req: NextRequest) {
  const check = await verifyAdmin(bearerFrom(req));
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing user id." }, { status: 400 });

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("id", id)
    .single<Profile>();
  if (!profile) return NextResponse.json({ error: "User not found." }, { status: 404 });

  // "Pending" is derived from auth.users, not stored — a resend only makes
  // sense if this person has never actually signed in yet.
  const { data: authUser } = await admin.auth.admin.getUserById(id);
  if (authUser?.user?.last_sign_in_at) {
    return NextResponse.json({ error: "Only pending invites can be resent." }, { status: 400 });
  }

  const origin = new URL(req.url).origin;
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "invite",
    email: profile.email,
    options: {
      data: { full_name: profile.full_name, role: profile.role },
      redirectTo: `${origin}/auth/callback`,
    },
  });
  if (linkError || !linkData) {
    return NextResponse.json({ error: linkError?.message ?? "Could not resend invite." }, { status: 500 });
  }

  const hashedToken = linkData.properties.hashed_token;
  const inviteUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/verify?token=${encodeURIComponent(hashedToken)}&type=invite&redirect_to=${encodeURIComponent(`${origin}/auth/callback`)}`;

  const supabase = await createClient();
  const { data: { user: invitedBy } } = await supabase.auth.getUser();
  await sendInviteEmail({
    to: profile.email,
    name: profile.full_name,
    inviteUrl,
    invitedBy: (invitedBy?.user_metadata?.full_name as string | undefined) ?? "An admin",
  });

  return NextResponse.json({ ok: true });
}
