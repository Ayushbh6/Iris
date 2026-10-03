"use client";
import { useEffect, useState } from "react";

// Shared helpers for the owner viewer.

export type Row = Record<string, any>;
export type Call = (path: string, method?: string) => Promise<Row | null>;

export const REFRESH_MS = 30_000; // lists and status
export const LIVE_MS = 10_000; // an open conversation

export const usd = (micros: number) => `$${(micros / 1e6).toFixed(2)}`;
export const usd4 = (micros: number) => `$${(micros / 1e6).toFixed(4)}`;
export const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
export const whenFull = (ms?: number | null) =>
  ms
    ? new Date(ms).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";
export const short = (id: unknown) => String(id ?? "").slice(0, 6);
export const parse = (text: unknown): Row => {
  try {
    return JSON.parse(String(text ?? "{}"));
  } catch {
    return {};
  }
};
export const duration = (ms: number) =>
  ms < 1000
    ? `${ms} ms`
    : ms < 60_000
      ? `${(ms / 1000).toFixed(1)} s`
      : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;

// Runs `load` now and then every `ms` while the tab is visible; coming back to
// the tab refreshes at once. Stops when the page is hidden, so it costs nothing.
export function usePoll(
  load: () => Promise<unknown> | void,
  ms: number,
  tick = 0, // changes when the owner presses Refresh
) {
  const [updated, setUpdated] = useState(0);
  useEffect(() => {
    let alive = true;
    const run = async (always = false) => {
      if (!always && document.visibilityState === "hidden") return;
      await load();
      if (alive) setUpdated(Date.now());
    };
    void run(true); // the first load happens even in a background tab
    const again = () => void run();
    const timer = setInterval(again, ms);
    document.addEventListener("visibilitychange", again);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", again);
    };
  }, [load, ms, tick]);
  return updated;
}

export const Updated = ({ at }: { at: number }) =>
  at ? (
    <span className="adm-muted adm-updated">
      Updated {new Date(at).toLocaleTimeString()} · refreshes automatically
    </span>
  ) : null;

// Plain-language line for an event.
export function describe(name: string, data: Row): string {
  switch (name) {
    case "view.rendered":
      return `Tool call: render → ${data.title ?? "untitled"}`;
    case "connect.requested":
      return `Tool call: connect → ${String(data.action ?? "").replace("_", " ")}`;
    case "screen.event":
      return `Screen: ${data.text ?? ""}`;
    case "mode.voice":
      return data.resumed ? "Back to voice" : "Voice started";
    case "mode.text":
      return `Switched to typing (${data.reason ?? "visitor"})`;
    case "usage.reported":
      return `Voice usage reported: ${data.totalTokens ?? "?"} tokens`;
    case "message.left":
      return "Left a message for Ayush";
    case "limit.reached":
      return "Conversation limit reached";
    case "conversation.ended":
      return "Conversation ended";
    case "error":
      return `Error: ${data.code ?? data.where ?? "unknown"}`;
    default:
      return name;
  }
}

// A key/value table used by the inspector panels.
export function Fields({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="adm-fields">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Json({ label, value }: { label: string; value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  return (
    <details className="adm-json">
      <summary>{label}</summary>
      <button
        className="adm-quiet"
        onClick={() => navigator.clipboard?.writeText(text)}
      >
        Copy
      </button>
      <pre>{text}</pre>
    </details>
  );
}
