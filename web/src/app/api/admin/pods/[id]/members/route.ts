import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAdmin, bearerFrom } from "@/lib/auth/verify-admin";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAdmin(bearerFrom(req));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: pod_id } = await params;
  const { email } = await req.json();
  if (!email?.trim()) return NextResponse.json({ error: "email required" }, { status: 400 });
  const admin = createAdminClient();
  // Upsert: if email already exists in asana_members, just update pod_id
  const { data: existing } = await admin.from("asana_members").select("id").eq("email", email.trim().toLowerCase()).maybeSingle();
  if (existing) {
    const { data, error } = await admin.from("asana_members").update({ pod_id }).eq("id", existing.id).select("id, email, pod_id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }
  const { data, error } = await admin.from("asana_members").insert({ email: email.trim().toLowerCase(), pod_id }).select("id, email, pod_id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
