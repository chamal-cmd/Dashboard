import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
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
