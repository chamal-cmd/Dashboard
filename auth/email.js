'use strict';
const nodemailer = require('nodemailer');

async function sendInvite({ to, name, inviteUrl, invitedBy }) {
  if (!process.env.SMTP_USER) {
    console.log(`\n╔══════════════════════════════════════════════════════╗`);
    console.log(`║  INVITE LINK (SMTP not configured — copy manually)  ║`);
    console.log(`║  To:  ${to.padEnd(46)}║`);
    console.log(`║  URL: ${inviteUrl.slice(0,46).padEnd(46)}║`);
    if (inviteUrl.length > 46) console.log(`║       ${inviteUrl.slice(46).padEnd(46)}║`);
    console.log(`╚══════════════════════════════════════════════════════╝\n`);
    return;
  }
  const t = nodemailer.createTransport({
    host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await t.sendMail({
    from:    `"Operations Hub" <${process.env.SMTP_USER}>`,
    to,
    subject: `You've been invited to Operations Hub`,
    html:    inviteHtml(name, inviteUrl, invitedBy)
  });
  console.log(`[email] Invite sent to ${to}`);
}

function inviteHtml(name, url, by) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0d12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px 20px">
  <div style="background:#0f1117;border:1px solid #1e2230;border-radius:16px;padding:40px;max-width:480px;width:100%">
    <div style="background:linear-gradient(135deg,#4f8ef7,#a78bfa);width:52px;height:52px;border-radius:14px;display:inline-flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#fff;margin-bottom:24px">GP</div>
    <h1 style="color:#f0f2ff;font-size:20px;margin:0 0 8px">You're invited to Operations Hub</h1>
    <p style="color:#6b7280;font-size:14px;margin:0 0 6px">Hi ${name},</p>
    <p style="color:#6b7280;font-size:14px;margin:0 0 28px">${by} has invited you to access the GP Bookkeeper Operations Hub. Click the button below to set up your account.</p>
    <a href="${url}" style="display:inline-block;background:#4f8ef7;color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Accept Invitation →</a>
    <p style="color:#374151;font-size:11px;margin:24px 0 0">This link expires in 7 days. If you weren't expecting this invitation, you can safely ignore it.</p>
  </div></div></body></html>`;
}

module.exports = { sendInvite };
