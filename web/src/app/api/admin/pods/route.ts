import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAdmin, bearerFrom } from "@/lib/auth/verify-admin";

export async function GET(req: Request) {
  const auth = await verifyAdmin(bearerFrom(req));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  const [podsRes, membersRes] = await Promise.all([
    admin.from("pods").select("id, name, color").order("name"),
    admin.from("asana_members").select("id, email, pod_id").not("pod_id", "is", null),
  ]);
  const pods = (podsRes.data ?? []).map((p) => ({
    ...p,
    members: (membersRes.data ?? []).filter((m) => m.pod_id === p.id),
  }));
  return NextResponse.json(pods);
}

export async function POST(req: Request) {
  const auth = await verifyAdmin(bearerFrom(req));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  const admin = createAdminClient();
  const { data, error } = await admin.from("pods").insert({ name: name.trim() }).select("id, name, color").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...data, members: [] });
}
