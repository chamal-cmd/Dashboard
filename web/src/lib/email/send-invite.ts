import "server-only";
import { getResendClient } from "./resend";
import { inviteEmailHtml } from "./templates/invite";

export async function sendInviteEmail({
  to,
  name,
  inviteUrl,
  invitedBy,
}: {
  to: string;
  name: string;
  inviteUrl: string;
  invitedBy: string;
}): Promise<{ sent: boolean }> {
  const resend = getResendClient();
  if (!resend) {
    // Same fallback UX as the current SMTP setup: print the link instead
    // of failing when the email service isn't configured yet.
    console.log(`\n[invite] RESEND_API_KEY not set — invite link for ${to}:\n  ${inviteUrl}\n`);
    return { sent: false };
  }

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM ?? "Operations Hub <onboarding@resend.dev>",
    to,
    subject: "You've been invited to Operations Hub",
    html: inviteEmailHtml({ name, url: inviteUrl, invitedBy }),
  });

  if (error) {
    console.error("[invite email error]", error);
    return { sent: false };
  }
  return { sent: true };
}
