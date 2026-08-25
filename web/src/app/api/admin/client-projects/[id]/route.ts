import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAdmin, bearerFrom } from "@/lib/auth/verify-admin";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAdmin(bearerFrom(req));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const body = await req.json();
  const admin = createAdminClient();
  const update: Record<string, string | null> = {};
  if (body.name?.trim()) update.name = body.name.trim();
  if (body.asana_project_name?.trim()) update.asana_project_name = body.asana_project_name.trim();
  if (body.bookkeeper_member_id !== undefined) update.bookkeeper_member_id = body.bookkeeper_member_id || null;
  const { data, error } = await admin
    .from("client_projects")
    .update(update)
    .eq("id", id)
    .select("id, name, asana_project_name, bookkeeper_member_id, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAdmin(bearerFrom(_req));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const admin = createAdminClient();
  const { error } = await admin.from("client_projects").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
