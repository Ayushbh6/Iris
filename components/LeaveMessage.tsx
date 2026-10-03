"use client";
import { useState } from "react";
import { Send, X } from "lucide-react";
import { authedFetch, VisitorError } from "../lib/agent/visitor";

const EMAIL = "bhatt.ayush.1998@gmail.com";

const PROBLEMS: Record<string, string> = {
  MESSAGE_LIMIT: "You have sent several messages today. Please email Ayush.",
  RATE_LIMITED: "Too many attempts for now. Please email Ayush.",
  BAD_REQUEST: "Please check your email address and message.",
};

// A short form that saves a message for Ayush. If anything fails, a plain
// email link is offered, so a message can always reach him.
export default function LeaveMessage({
  note,
  conversationId,
  onClose,
}: {
  note?: string;
  conversationId: () => string;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState(note ?? "");
  const [state, setState] = useState<"edit" | "sending" | "sent">("edit");
  const [problem, setProblem] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setProblem("");
    setState("sending");
    try {
      const response = await authedFetch("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          message,
          conversationId: conversationId() || undefined,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblem(
          PROBLEMS[body.error] ?? "Could not send that. Please email Ayush.",
        );
        return setState("edit");
      }
      setState("sent");
    } catch (error) {
      setProblem(
        error instanceof VisitorError
          ? "Could not verify this browser. Please email Ayush."
          : "Could not send that. Please email Ayush.",
      );
      setState("edit");
    }
  }

  const mailto = `mailto:${EMAIL}?subject=${encodeURIComponent("Message from your website")}&body=${encodeURIComponent(message)}`;

  return (
    <div className="connect-card leave-card" role="status">
      <span className="eyebrow">LEAVE A MESSAGE</span>
      {state === "sent" ? (
        <p className="leave-done">
          Sent. Ayush will read it and get back to you.
        </p>
      ) : (
        <form className="leave-form" onSubmit={submit}>
          <div className="leave-row">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              aria-label="Your name"
              maxLength={80}
              required
              autoComplete="name"
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Your email"
              aria-label="Your email"
              type="email"
              maxLength={200}
              required
              autoComplete="email"
            />
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Your message for Ayush"
            aria-label="Your message"
            maxLength={2000}
            minLength={5}
            rows={4}
            required
          />
          <div className="leave-actions">
            <button
              className="cv-primary leave-send"
              type="submit"
              disabled={state === "sending"}
            >
              <Send size={14} /> {state === "sending" ? "Sending…" : "Send"}
            </button>
            <a className="inline-link" href={mailto}>
              or write by email
            </a>
          </div>
          {problem && <p className="leave-problem">{problem}</p>}
          <p className="leave-note">
            Saved for Ayush only. Please don’t include sensitive personal
            details.
          </p>
        </form>
      )}
      <button
        className="connect-dismiss"
        onClick={onClose}
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
