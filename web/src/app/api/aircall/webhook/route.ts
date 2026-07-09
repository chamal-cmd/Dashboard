import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  // Verify the pre-shared secret embedded in the webhook URL (?secret=...).
  // Trimmed because secrets pushed from a Windows .env file can carry a
  // trailing \r that silently fails exact comparison.
  const secret = req.nextUrl.searchParams.get("secret")?.trim();
  const expected = process.env.AIRCALL_WEBHOOK_SECRET?.trim();
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { event, data } = payload as { event?: string; data?: Record<string, unknown> };

  // ACK all non-message events without storing anything
  if (!event?.startsWith("message.") || !data) {
    return NextResponse.json({ ok: true });
  }

  const msgId = data.id;
  if (msgId === undefined || msgId === null) {
    return NextResponse.json({ error: "Missing message id" }, { status: 400 });
  }

  // Look up the human-readable line name using the Aircall numbers API
  let numberName: string | null = null;
  const numberId = data.number_id;
  if (numberId) {
    try {
      const aircallId = process.env.AIRCALL_API_ID;
      const aircallToken = process.env.AIRCALL_API_TOKEN;
      if (aircallId && aircallToken) {
        const auth = Buffer.from(`${aircallId}:${aircallToken}`).toString("base64");
        const r = await fetch(`https://api.aircall.io/v1/numbers/${numberId}`, {
          headers: { Authorization: `Basic ${auth}` },
        });
        if (r.ok) {
          const numData = await r.json() as { number?: { name?: string } };
          numberName = numData?.number?.name ?? null;
        }
      }
    } catch {
      // Non-critical — store the message without the line name
    }
  }

  const supabase = createAdminClient();
  const { error: dbError } = await supabase.from("aircall_messages").upsert(
    {
      id: Number(msgId),
      number_id: numberId != null ? Number(numberId) : null,
      number_name: numberName,
      contact_id: data.contact_id != null ? Number(data.contact_id) : null,
      direction: (data.direction as string) ?? "unknown",
      channel: (data.channel as string) ?? null,
      content: (data.content as string) ?? null,
      status: (data.status as string) ?? null,
      external_id: (data.external_id as string) ?? null,
      event_type: event,
      message_at: (data.created_at as string) ?? null,
      raw: data,
    },
    { onConflict: "id" }
  );

  if (dbError) {
    console.error("[aircall-webhook] Supabase error:", dbError.message);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
