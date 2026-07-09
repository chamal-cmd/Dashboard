import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAdmin, bearerFrom } from "@/lib/auth/verify-admin";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAdmin(bearerFrom(req));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const body = await req.json();
  const admin = createAdminClient();
  const update: Record<string, unknown> = {};
  if (body.label !== undefined)        update.label        = body.label;
  if (body.project_name !== undefined) update.project_name = body.project_name || null;
  if (body.active !== undefined)       update.active       = body.active;
  if (body.sort_order !== undefined)   update.sort_order   = body.sort_order;
  const { data, error } = await admin.from("asana_trackers").update(update).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAdmin(bearerFrom(_req));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const admin = createAdminClient();
  const { error } = await admin.from("asana_trackers").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
