import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAdmin, bearerFrom } from "@/lib/auth/verify-admin";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAdmin(bearerFrom(req));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const { name, color, leader_member_id } = await req.json();
  const admin = createAdminClient();
  const update: Record<string, string | null> = {};
  if (name?.trim()) update.name = name.trim();
  if (color) update.color = color;
  // Explicit null clears the leader (distinct from the key being absent,
  // which leaves it untouched) — the pod picker's "No leader" option sends null.
  if (leader_member_id !== undefined) update.leader_member_id = leader_member_id;
  const { data, error } = await admin.from("pods").update(update).eq("id", id).select("id, name, color, leader_member_id").single();
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
