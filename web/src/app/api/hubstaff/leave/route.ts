import { NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/get-user";
import { getHubstaffLeave } from "@/lib/data/hubstaff";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const data = await getHubstaffLeave();
  return NextResponse.json(data);
}
