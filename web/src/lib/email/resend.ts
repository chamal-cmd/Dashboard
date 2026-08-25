import "server-only";
import { Resend } from "resend";

// Lazily constructed so importing this module never throws when
// RESEND_API_KEY is absent (e.g. during `next build` before credentials exist).
let client: Resend | null = null;

export function getResendClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}
