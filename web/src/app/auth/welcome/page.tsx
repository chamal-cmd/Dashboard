"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import "../../auth-theme.css";

export default function WelcomePage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      const metaName = (user.user_metadata?.full_name as string | undefined) ?? "";
      setFullName(metaName);
    });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const updates: { data: { full_name: string }; password?: string } = {
      data: { full_name: fullName },
    };
    if (password) updates.password = password;

    const { error: updateError } = await supabase.auth.updateUser(updates);
    if (updateError) {
      setError("Could not save your details. Please try again.");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/auth/complete-onboarding", { method: "POST" });
    const body = await res.json();
    router.push(body.role === "admin" ? "/admin" : "/dashboard");
  }

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

          <div className="cardTitle">Welcome aboard</div>
          <div className="cardSub">Confirm your name and set a password to finish setting up your account.</div>

          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Full Name</label>
              <input
                type="text"
                placeholder="Your name"
                required
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Password (optional)</label>
              <input
                type="password"
                placeholder="Set a password for email sign-in"
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button type="submit" className="btnPrimary" disabled={loading}>
              {loading ? "Saving..." : "Continue →"}
            </button>
          </form>
        </div>

        <div className="footer">GP Bookkeeper Operations Hub &middot; Confidential</div>
      </div>
    </div>
  );
}
