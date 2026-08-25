import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAdmin, bearerFrom } from "@/lib/auth/verify-admin";

export async function GET(req: Request) {
  const auth = await verifyAdmin(bearerFrom(req));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("client_projects")
    .select("id, name, asana_project_name, bookkeeper_member_id, created_at")
    .order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  const auth = await verifyAdmin(bearerFrom(req));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { name, asana_project_name, bookkeeper_member_id } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (!asana_project_name?.trim()) return NextResponse.json({ error: "asana_project_name required" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("client_projects")
    .insert({
      name: name.trim(),
      asana_project_name: asana_project_name.trim(),
      bookkeeper_member_id: bookkeeper_member_id || null,
    })
    .select("id, name, asana_project_name, bookkeeper_member_id, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
