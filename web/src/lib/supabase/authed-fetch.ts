"use client";

import { createClient } from "./client";

// Attaches the current Supabase access token as a bearer header — used by
// every client component calling /api/admin/* routes, which verify the
// token server-side rather than trusting a cookie session directly.
export async function authedFetch(path: string, init: RequestInit = {}) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${session?.access_token ?? ""}`,
    },
  });
}
