import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, bearerFrom } from "@/lib/auth/verify-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLES, toAdminUserView, type Profile } from "@/lib/auth/types";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await verifyAdmin(bearerFrom(req));
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  if (id === check.userId) {
    return NextResponse.json({ error: "Cannot modify your own account." }, { status: 400 });
  }

  const body = await req.json();
  const patch: Partial<Pick<Profile, "role" | "is_active">> = {};
  if (body.role !== undefined) {
    if (!ROLES.includes(body.role)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }
    patch.role = body.role;
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") {
      return NextResponse.json({ error: "Invalid isActive value." }, { status: 400 });
    }
    patch.is_active = body.isActive;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: authUser } = await admin.auth.admin.getUserById(id);
  return NextResponse.json({
    ok: true,
    user: toAdminUserView(data as Profile, authUser?.user?.last_sign_in_at ?? null),
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await verifyAdmin(bearerFrom(req));
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  if (id === check.userId) {
    return NextResponse.json({ error: "Cannot delete your own account." }, { status: 400 });
  }

  const admin = createAdminClient();
  // Explicit profiles delete first in case the auth user was already
  // removed manually; the FK cascade below would then be a no-op anyway.
  await admin.from("profiles").delete().eq("id", id);
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
