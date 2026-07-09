import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAdmin, bearerFrom } from "@/lib/auth/verify-admin";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAdmin(bearerFrom(req));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const { name, color } = await req.json();
  const admin = createAdminClient();
  const update: Record<string, string> = {};
  if (name?.trim()) update.name = name.trim();
  if (color) update.color = color;
  const { data, error } = await admin.from("pods").update(update).eq("id", id).select("id, name, color").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAdmin(bearerFrom(_req));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const admin = createAdminClient();
  await admin.from("asana_members").update({ pod_id: null }).eq("pod_id", id);
  const { error } = await admin.from("pods").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
