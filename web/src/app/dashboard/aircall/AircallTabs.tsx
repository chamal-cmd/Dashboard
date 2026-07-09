"use client";

import { useState } from "react";
import "./aircall-page.css";

// Inline types so this client component doesn't import the server-only data module
interface AircallCall {
  id: number; direction: string; status: string; duration: number;
  number: string; contactName: string | null; contactCompany: string | null;
  agent: string | null; startedAt: string;
}
interface RepeatCaller {
  number: string; contactName: string | null; contactCompany: string | null;
  count: number; totalDuration: number; lastCallAt: string;
}
interface AircallMessage {
  id: number; body: string; from: string | null; to: string | null;
  direction: "inbound" | "outbound"; status: string;
  channel: string | null;
  agent: string | null; line: string | null; contactName: string | null; createdAt: string;
}
interface MessagingStats {
  total: number; inbound: number; outbound: number;
  delivered: number; failed: number; deliveryRatePct: number | null;
  recentMessages: AircallMessage[];
}
interface AircallOverview {
  total: number | null; inbound: number | null; outboundAnswered: number | null;
  outboundUnanswered: number | null; missedOrVoicemail: number | null;
  totalTalkTimeSeconds: number | null; avgDurationSeconds: number | null; medianDurationSeconds: number | null;
  inboundAnswerRatePct: number | null; outboundConnectRatePct: number | null;
  missedRatePct: number | null; callsPerDay: number | null; lines: string[];
  recentCalls: AircallCall[]; repeatCallers: RepeatCaller[];
  messaging: MessagingStats | null;
}

function formatDuration(s: number) {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}
function formatHoursMinutes(s: number) {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleString("en-AU", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}
function callStatusClass(s: string) {
  if (s === "missed") return "acStatusBadge acStatusMissed";
  if (s === "voicemail") return "acStatusBadge acStatusVoicemail";
  return "acStatusBadge acStatusDone";
}
function msgStatusClass(s: string) {
  if (s === "failed" || s === "undelivered") return "acStatusBadge acStatusMissed";
  if (s === "delivered" || s === "sent" || s === "received") return "acStatusBadge acStatusDone";
  return "acStatusBadge acStatusVoicemail";
}

type Tab = "calls" | "messaging";

export default function AircallTabs({ aircall }: { aircall: AircallOverview }) {
  const [tab, setTab] = useState<Tab>("calls");

  return (
    <>
      {/* ── Tab bar ───────────────────────────────────────── */}
      <div className="acTabBar">
        <button className={`acTab ${tab === "calls" ? "acTabActive" : ""}`} onClick={() => setTab("calls")}>
          📞 Calling
        </button>
        <button className={`acTab ${tab === "messaging" ? "acTabActive" : ""}`} onClick={() => setTab("messaging")}>
          💬 Messaging
        </button>
      </div>

      {/* ── Calling tab ───────────────────────────────────── */}
      {tab === "calls" && (
        <>
          <div className="dpSectionLbl">Volume</div>
          <div className="dpKpiGrid dpKpiGrid5">
            {[
              { val: aircall.total,              lbl: "Total Calls",          color: "#4f8ef7" },
              { val: aircall.inbound,            lbl: "Inbound",              color: "#22c55e" },
              { val: aircall.outboundAnswered,   lbl: "Outbound Answered",    color: "#a78bfa" },
              { val: aircall.outboundUnanswered, lbl: "Outbound Unanswered",  color: "#f59e0b" },
              { val: aircall.missedOrVoicemail,  lbl: "Missed / Voicemail",   color: "#ef4444" },
            ].map(({ val, lbl, color }) => (
              <div key={lbl} className="dpKpi" style={{ "--kpi-accent": color } as React.CSSProperties}>
                <div className="dpKpiVal">{val}</div>
                <div className="dpKpiLbl">{lbl}</div>
              </div>
            ))}
          </div>

          <div className="dpSectionLbl">Quality</div>
          <div className="dpKpiGrid dpKpiGrid5 dpKpiGridLast">
            <div className="dpKpi" style={{ "--kpi-accent": "#22c55e" } as React.CSSProperties}>
              <div className="dpKpiVal">{aircall.inboundAnswerRatePct != null ? `${aircall.inboundAnswerRatePct}%` : "—"}</div>
              <div className="dpKpiLbl">Inbound Answer Rate</div>
            </div>
            <div className="dpKpi" style={{ "--kpi-accent": "#a78bfa" } as React.CSSProperties}>
              <div className="dpKpiVal">{aircall.outboundConnectRatePct != null ? `${aircall.outboundConnectRatePct}%` : "—"}</div>
              <div className="dpKpiLbl">Outbound Connect Rate</div>
            </div>
            <div className="dpKpi" style={{ "--kpi-accent": "#4f8ef7" } as React.CSSProperties}>
              <div className="dpKpiVal">{aircall.avgDurationSeconds != null ? formatDuration(aircall.avgDurationSeconds) : "—"}</div>
              <div className="dpKpiLbl">Avg Duration {aircall.medianDurationSeconds != null && <span style={{ opacity: 0.6 }}>({formatDuration(aircall.medianDurationSeconds)} median)</span>}</div>
            </div>
            <div className="dpKpi" style={{ "--kpi-accent": "#f59e0b" } as React.CSSProperties}>
              <div className="dpKpiVal">{aircall.callsPerDay ?? "—"}</div>
              <div className="dpKpiLbl">Calls / Day</div>
            </div>
            <div className="dpKpi" style={{ "--kpi-accent": "#ef4444" } as React.CSSProperties}>
              <div className="dpKpiVal">{aircall.missedRatePct != null ? `${aircall.missedRatePct}%` : "—"}</div>
              <div className="dpKpiLbl">Missed Rate</div>
            </div>
          </div>

          <div className="dpNote" style={{ marginTop: -4 }}>
            Total talk time: {aircall.totalTalkTimeSeconds != null ? formatHoursMinutes(aircall.totalTalkTimeSeconds) : "—"}
            {aircall.lines.length > 0 && <> · Line{aircall.lines.length !== 1 ? "s" : ""}: {aircall.lines.join(", ")}</>}
          </div>

          {aircall.repeatCallers.length > 0 && (
            <div className="dpTableWrap" style={{ marginBottom: 24 }}>
              <div className="dpTableHead">
                <div>
                  <div className="dpTableTitle">Repeat Callers</div>
                  <div className="dpTableSub">Numbers that called 2+ times this week</div>
                </div>
              </div>
              <table className="dpTable">
                <thead><tr><th>Caller</th><th>Calls</th><th>Total Duration</th><th>Last Call</th></tr></thead>
                <tbody>
                  {aircall.repeatCallers.map((r) => (
                    <tr key={r.number}>
                      <td className="dpPrimary">
                        {r.contactName ?? r.number}
                        {r.contactName && <div className="dpMuted" style={{ fontSize: 11, fontWeight: 400 }}>{r.number}{r.contactCompany ? ` · ${r.contactCompany}` : ""}</div>}
                      </td>
                      <td className="dpMuted">{r.count}</td>
                      <td className="dpMuted">{formatHoursMinutes(r.totalDuration)}</td>
                      <td className="dpMuted">{formatTime(r.lastCallAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="dpTableWrap">
            <div className="dpTableHead">
              <div>
                <div className="dpTableTitle">All Calls</div>
                <div className="dpTableSub">{aircall.recentCalls.length} call{aircall.recentCalls.length !== 1 ? "s" : ""}, most recent first</div>
              </div>
            </div>
            {aircall.recentCalls.length === 0 ? (
              <div className="dpEmpty">No calls in the last 7 days.</div>
            ) : (
              <table className="dpTable">
                <thead><tr><th>Caller</th><th>Direction</th><th>Status</th><th>Agent</th><th>Duration</th><th>Time</th></tr></thead>
                <tbody>
                  {aircall.recentCalls.map((c) => (
                    <tr key={c.id}>
                      <td className="dpPrimary">
                        {c.contactName ?? c.number}
                        {c.contactName && <div className="dpMuted" style={{ fontSize: 11, fontWeight: 400 }}>{c.number}{c.contactCompany ? ` · ${c.contactCompany}` : ""}</div>}
                      </td>
                      <td><span className={`acDirBadge ${c.direction === "inbound" ? "acDirInbound" : "acDirOutbound"}`}>{c.direction}</span></td>
                      <td><span className={callStatusClass(c.status)}>{c.status}</span></td>
                      <td className="dpMuted">{c.agent ?? "—"}</td>
                      <td className="dpMuted">{formatDuration(c.duration)}</td>
                      <td className="dpMuted">{formatTime(c.startedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ── Messaging tab ─────────────────────────────────── */}
      {tab === "messaging" && (
        <>
          {!aircall.messaging || aircall.messaging.total === 0 ? (
            <div className="acMsgUnavailable">
              <div className="acMsgUnavailableIcon">💬</div>
              <div className="acMsgUnavailableTitle">No messages yet</div>
              <div className="acMsgUnavailableBody">
                Messages appear here once the Aircall webhook is connected.<br />
                Register the webhook URL in <strong>Aircall&nbsp;→&nbsp;Integrations&nbsp;→&nbsp;Webhooks</strong> to start capturing SMS &amp; WhatsApp history.
              </div>
            </div>
          ) : (
            <>
              <div className="dpSectionLbl">Volume</div>
              <div className="dpKpiGrid dpKpiGrid5">
                {[
                  { val: aircall.messaging.total,     lbl: "Total Messages", color: "#06b6d4" },
                  { val: aircall.messaging.inbound,   lbl: "Inbound",        color: "#22c55e" },
                  { val: aircall.messaging.outbound,  lbl: "Outbound",       color: "#a78bfa" },
                  { val: aircall.messaging.delivered, lbl: "Delivered",      color: "#22c55e" },
                  { val: aircall.messaging.failed,    lbl: "Failed",         color: "#ef4444" },
                ].map(({ val, lbl, color }) => (
                  <div key={lbl} className="dpKpi" style={{ "--kpi-accent": color } as React.CSSProperties}>
                    <div className="dpKpiVal">{val}</div>
                    <div className="dpKpiLbl">{lbl}</div>
                  </div>
                ))}
              </div>
              {aircall.messaging.deliveryRatePct != null && (
                <div className="dpNote" style={{ marginTop: -4 }}>Delivery rate: {aircall.messaging.deliveryRatePct}%</div>
              )}

              <div className="dpTableWrap">
                <div className="dpTableHead">
                  <div>
                    <div className="dpTableTitle">All Messages</div>
                    <div className="dpTableSub">
                      {aircall.messaging.recentMessages.length} message{aircall.messaging.recentMessages.length !== 1 ? "s" : ""}, most recent first
                    </div>
                  </div>
                </div>
                {aircall.messaging.recentMessages.length === 0 ? (
                  <div className="dpEmpty">No messages in the last 7 days.</div>
                ) : (
                  <table className="dpTable">
                    <thead>
                      <tr><th>Message</th><th>Channel</th><th>Direction</th><th>Status</th><th>Line</th><th>Time</th></tr>
                    </thead>
                    <tbody>
                      {aircall.messaging.recentMessages.map((m) => (
                        <tr key={m.id}>
                          <td className="dpMuted acMsgBody">{m.body || <em style={{ opacity: 0.4 }}>no body</em>}</td>
                          <td className="dpMuted" style={{ textTransform: "uppercase", fontSize: 11, letterSpacing: "0.5px" }}>{m.channel ?? "—"}</td>
                          <td><span className={`acDirBadge ${m.direction === "inbound" ? "acDirInbound" : "acDirOutbound"}`}>{m.direction}</span></td>
                          <td><span className={msgStatusClass(m.status)}>{m.status}</span></td>
                          <td className="dpMuted">{m.line ?? "—"}</td>
                          <td className="dpMuted">{formatTime(m.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
