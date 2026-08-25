"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import "../auth-theme.css";

const ERROR_MESSAGES: Record<string, string> = {
  "no-code": "Sign-in failed. Please try again.",
  "exchange-failed": "Sign-in failed. Please try again.",
  not_invited: "This account is not authorised. Contact your administrator.",
  suspended: "Your account has been suspended. Contact your administrator.",
  "oauth-init-failed": "Google sign-in is not available right now.",
};

// createBrowserClient() throws synchronously if these are unset — guard so
// the page still renders (buttons just error on click) before Supabase is configured.
const SUPABASE_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Derived once from the URL at mount — not effect state, so it can be
  // computed directly in the initializer instead of set from an effect.
  const [error, setError] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const qErr = new URLSearchParams(window.location.search).get("error");
    return qErr ? ERROR_MESSAGES[qErr] ?? "Sign-in failed. Please try again." : null;
  });
  const [loading, setLoading] = useState(false);
  // SUPABASE_CONFIGURED is a build-time constant, so the "nothing to check"
  // case can be the initial value directly instead of an effect setState.
  const [checkingSession, setCheckingSession] = useState(SUPABASE_CONFIGURED);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        setCheckingSession(false);
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single();
      router.replace(profile?.role === "admin" ? "/admin" : "/dashboard");
    });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!SUPABASE_CONFIGURED) {
      setError("Supabase isn't configured yet — see README.md.");
      return;
    }
    setLoading(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError("Incorrect email or password.");
      setLoading(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user!.id)
      .single();
    router.push(profile?.role === "admin" ? "/admin" : "/dashboard");
  }

  if (checkingSession) return null;

  return (
    <div className="authBody">
      <div className="wrap">
        <div className="logo">
          <div className="logoIcon">GP</div>
          <div className="logoTitle">Operations Hub</div>
          <div className="logoSub">GP Bookkeeper Pty Ltd</div>
        </div>

        <div className="card">
          {error && <div className="alert alertError">{error}</div>}

          <div className="cardTitle">Welcome back</div>
          <div className="cardSub">Sign in to your Operations Hub account.</div>

          <a className="btnGoogle" href="/api/auth/google">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width={18} height={18}>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </a>
          <div className="divider"><span>or continue with email</span></div>

          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Email Address</label>
              <input
                type="email"
                placeholder="you@gpbookkeeper.com.au"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                type="password"
                placeholder="Your password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button type="submit" className="btnPrimary" disabled={loading}>
              {loading ? "Signing in..." : "Sign In →"}
            </button>
          </form>
        </div>

        <div className="footer">GP Bookkeeper Operations Hub &middot; Confidential</div>
      </div>
    </div>
  );
}
