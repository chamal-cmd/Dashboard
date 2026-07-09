import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/get-user";

const BASE = "https://api2.hiverhq.com";

async function hGet(path: string, key: string, attempt = 0): Promise<unknown> {
  const res = await fetch(`${BASE}/${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (res.status === 429) {
    if (attempt < 8) {
      const delay = Math.min(500 * Math.pow(2, attempt), 20000);
      await new Promise((r) => setTimeout(r, delay));
      return hGet(path, key, attempt + 1);
    }
    throw new Error(`Rate limited: ${path}`);
  }
  if (!res.ok) throw new Error(`Hiver ${res.status}: ${path}`);
  const text = await res.text();
  return JSON.parse(text);
}

async function hAll(basePath: string, key: string, max = 2000): Promise<unknown[]> {
  let results: unknown[] = [];
  let next: string | null = null;
  do {
    const url = next ? `${basePath}&next_page=${encodeURIComponent(next)}` : basePath;
    const d = await hGet(url, key) as { data?: { results?: unknown[]; pagination?: { next_page?: string } } };
    results = results.concat(d.data?.results ?? []);
    next = d.data?.pagination?.next_page ?? null;
  } while (next && results.length < max);
  return results;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const key = process.env.HIVER_API_KEY;
  if (!key) return NextResponse.json({ error: "not configured" }, { status: 500 });

  const { id } = await params;
  const createdAfter = req.nextUrl.searchParams.get("created_after");
  const convSuffix = createdAfter ? `&created_after=${createdAfter}` : "";

  try {
    // users + tags in parallel (small, 1 page each)
    const [usArr, tagsArr] = await Promise.all([
      hAll(`v1/inboxes/${id}/users?limit=100`, key),
      hAll(`v1/inboxes/${id}/tags?limit=100`, key),
    ]);

    // conversations sequentially (may have multiple pages)
    const convArr = await hAll(`v1/inboxes/${id}/conversations?limit=100${convSuffix}`, key);

    const users: Record<number, unknown> = {};
    const tags: Record<number, unknown> = {};
    (usArr as { id: number }[]).forEach((u) => { users[u.id] = u; });
    (tagsArr as { id: number }[]).forEach((t) => { tags[t.id] = t; });

    // normalize status and attach inbox id
    convArr.forEach((c) => {
      const conv = c as { _inbox_id: string; status: string };
      conv._inbox_id = id;
      if (conv.status === "close") conv.status = "closed";
    });

    return NextResponse.json({
      userIds: (usArr as { id: number }[]).map((u) => u.id),
      users,
      tags,
      conversations: convArr,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
