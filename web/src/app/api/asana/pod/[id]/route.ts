import { NextRequest, NextResponse } from "next/server";
import { getAsanaPodDetail } from "@/lib/data/asana-pod";
import { getUser } from "@/lib/supabase/get-user";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const raw = Number(req.nextUrl.searchParams.get("days") ?? "7");
  const days = isNaN(raw) || raw < 1 ? 7 : Math.min(raw, 90);
  const data = await getAsanaPodDetail(id, days);
  if (!data) return NextResponse.json({ error: "Pod not found" }, { status: 404 });
  return NextResponse.json(data);
}
