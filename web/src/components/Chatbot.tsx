"use client";

import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import "./chatbot.css";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const GREETING: ChatMessage = {
  role: "assistant",
  content:
    "Hi — I can answer questions about Asana tasks, Hubstaff hours, Aircall calls/messages, and Hiver unresolved emails. I pull live numbers for anything factual, e.g. \"how many calls a day this week\" or \"how is Ridmal's workload looking\".",
};

export default function Chatbot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, loading, open]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? `Request failed (${res.status})`);
      } else {
        setMessages((cur) => [...cur, { role: "assistant", content: data.reply ?? "" }]);
      }
    } catch {
      setError("Couldn't reach the assistant — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      <button
        className={`cbLauncher ${open ? "cbLauncherActive" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close assistant" : "Open assistant"}
      >
        {open ? "✕ Close" : "💬 Assistant"}
      </button>

      {open && (
        <div className="cbPanel">
          <div className="cbHead">
            <div>
              <div className="cbTitle">Ops Assistant</div>
              <div className="cbSub">Live data from Asana, Hubstaff, Aircall & Hiver</div>
            </div>
          </div>

          <div className="cbList" ref={listRef}>
            {messages.map((m, i) => (
              <div key={i} className={`cbMsg ${m.role === "user" ? "cbMsgUser" : "cbMsgBot"}`}>
                {m.content}
              </div>
            ))}
            {loading && (
              <div className="cbMsg cbMsgBot cbMsgLoading">
                <span className="cbDot" />
                <span className="cbDot" />
                <span className="cbDot" />
              </div>
            )}
            {error && <div className="cbError">{error}</div>}
          </div>

          <div className="cbInputRow">
            <textarea
              className="cbInput"
              placeholder="Ask about tasks, hours, calls, emails…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              disabled={loading}
            />
            <button className="cbSend" onClick={send} disabled={loading || !input.trim()}>
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
