import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAdmin, bearerFrom } from "@/lib/auth/verify-admin";

export async function GET(req: Request) {
  const auth = await verifyAdmin(bearerFrom(req));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  const { data, error } = await admin.from("asana_trackers").select("*").order("sort_order");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  const auth = await verifyAdmin(bearerFrom(req));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json();
  const { label, project_name, key, sort_order } = body;
  if (!label?.trim()) return NextResponse.json({ error: "label required" }, { status: 400 });
  const admin = createAdminClient();
  const slug = (key ?? label).toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  const { data, error } = await admin.from("asana_trackers")
    .insert({ key: slug, label: label.trim(), project_name: project_name?.trim() || null, sort_order: sort_order ?? 99 })
    .select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
