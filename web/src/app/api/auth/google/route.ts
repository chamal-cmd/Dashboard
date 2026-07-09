import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Server-initiated OAuth. Critical for Cloudflare/edge: never call
// signInWithOAuth on the client — Cloudflare Workers lose localStorage
// across redirects, which breaks PKCE. Initiating here means the server
// client's cookie-writing persists the code verifier instead.
export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.redirect(`${origin}/login?error=oauth-init-failed`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
      skipBrowserRedirect: true,
      queryParams: { access_type: "offline", prompt: "select_account" },
    },
  });

  if (error || !data?.url) {
    return NextResponse.redirect(`${origin}/login?error=oauth-init-failed`);
  }

  return NextResponse.redirect(data.url);
}
