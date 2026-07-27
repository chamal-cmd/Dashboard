import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAdmin, bearerFrom } from "@/lib/auth/verify-admin";

export async function GET(req: Request) {
  const auth = await verifyAdmin(bearerFrom(req));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  const { data, error } = await admin.from("admin_settings").select("key, value");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const obj: Record<string, unknown> = {};
  for (const row of data ?? []) obj[row.key] = row.value;
  return NextResponse.json(obj);
}

export async function POST(req: Request) {
  const auth = await verifyAdmin(bearerFrom(req));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body: Record<string, unknown> = await req.json();
  const admin = createAdminClient();
  const rows: { key: string; value: number; updated_at: string }[] = [];
  for (const [key, value] of Object.entries(body)) {
    const num = typeof value === "number" ? value : Number(value);
    if (Number.isNaN(num)) return NextResponse.json({ error: `Invalid value for ${key}` }, { status: 400 });
    rows.push({ key, value: num, updated_at: new Date().toISOString() });
  }
  const { error } = await admin.from("admin_settings").upsert(rows, { onConflict: "key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
