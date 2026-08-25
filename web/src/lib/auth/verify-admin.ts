import "server-only";

type VerifyResult = { ok: true; userId: string } | { ok: false; status: number; error: string };

// Validates a Supabase access token belongs to a real session (step 1), then
// checks the caller's role via the profiles table using the service-role
// key, which bypasses RLS (step 2) — never trust a client-sent role claim.
export async function verifyAdmin(bearerToken: string | null): Promise<VerifyResult> {
  if (!bearerToken) return { ok: false, status: 401, error: "Not authenticated" };

  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const userRes = await fetch(`${sbUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${bearerToken}`, apikey: anonKey },
  });
  if (!userRes.ok) return { ok: false, status: 401, error: "Not authenticated" };
  const user = await userRes.json();
  if (!user?.id) return { ok: false, status: 401, error: "Not authenticated" };

  const profileRes = await fetch(
    `${sbUrl}/rest/v1/profiles?select=role&id=eq.${user.id}&limit=1`,
    { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } }
  );
  if (!profileRes.ok) return { ok: false, status: 403, error: "Admin access required" };
  const profiles = await profileRes.json();
  if (profiles?.[0]?.role !== "admin") {
    return { ok: false, status: 403, error: "Admin access required" };
  }
  return { ok: true, userId: user.id as string };
}

export function bearerFrom(req: Request): string | null {
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
}
