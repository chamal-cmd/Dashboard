import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/get-user";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  // This proxies to Hiver with the company API key — without a session
  // check it would hand company email data to anyone on the internet.
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const key = process.env.HIVER_API_KEY;
  if (!key) return NextResponse.json({ error: "not configured" }, { status: 500 });

  const { path } = await params;
  const pathStr = path.join("/");
  const search = req.nextUrl.search;
  const url = `https://api2.hiverhq.com/${pathStr}${search}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const text = await res.text();
    try {
      return NextResponse.json(JSON.parse(text), { status: res.status });
    } catch {
      return NextResponse.json({ error: `Hiver returned non-JSON (${res.status})` }, { status: 502 });
    }
  } catch {
    return NextResponse.json({ error: "Hiver unreachable" }, { status: 502 });
  }
}
