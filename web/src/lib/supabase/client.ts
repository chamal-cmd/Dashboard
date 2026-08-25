import { createBrowserClient } from "@supabase/ssr";

// Factory function, not a module-level singleton — constructing it at import
// time would throw during `next build` whenever env vars are blank.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
