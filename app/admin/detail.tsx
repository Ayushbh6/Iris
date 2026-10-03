"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PRICING_USD_PER_M } from "../../lib/agent/config";
import {
  describe,
  duration,
  Fields,
  Json,
  LIVE_MS,
  parse,
  short,
  Updated,
  usd,
  usd4,
  usePoll,
  when,
  whenFull,
  type Call,
  type Row,
} from "./lib";

// One conversation: the transcript, and an inspector for whatever you click
// (a message, a tool call or event, a model call) with its full metadata.

type Sel = { kind: "message" | "event" | "request"; id: string } | null;

export default function Detail({
  id,
  call,
  tick,
  back,
  openVisitor,
}: {
  id: string;
  call: Call;
  tick: number;
  back: (changed: boolean) => void;
  openVisitor: (visitorId: string) => void;
}) {
  const [data, setData] = useState<Row | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [showEvents, setShowEvents] = useState(true);
  const inspector = useRef<HTMLElement>(null);
  const load = useCallback(async () => {
    const next = await call(`/admin/conversation?id=${id}`);
    if (next) setData(next);
  }, [call, id]);
  const updated = usePoll(load, LIVE_MS, tick);
  useEffect(() => {
    // On a phone the inspector sits below the transcript: bring it into view.
    if (sel && window.matchMedia("(max-width: 900px)").matches)
      inspector.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [sel]);

  if (!data)
    return (
      <section>
        <button className="adm-quiet" onClick={() => back(false)}>
          ← Back
        </button>
        <p className="adm-muted">Loading…</p>
      </section>
    );

  const c = data.conversation;
  const msgs: Row[] = data.messages.map((m: Row) => ({
    ...m,
    c: parse(m.content_json),
  }));
  const evs: Row[] = data.events.map((e: Row) => ({
    ...e,
    p: parse(e.payload_json),
    at: e.occurred_at ?? e.received_at,
  }));
  const reqs: Row[] = data.requests.map((r: Row) => ({
    ...r,
    usage: parse(r.usage_json),
    payload: parse(r.request_payload_json),
    manifest: parse(r.context_manifest_json),
    response: parse(r.response_payload_json),
  }));
  const byId = new Map(msgs.map((m) => [m.id, m]));
  const textOf = (m: Row) => String(m.c.text ?? "");

  // Which events and model call belong to a message.
  const nextUserAfter = (m: Row) =>
    msgs.find(
      (x) => x.role === "user" && x.sequence_number > m.sequence_number,
    );
  const eventsOf = (m: Row): Row[] => {
    if (m.role !== "assistant") return [];
    const start = byId.get(m.parent_message_id)?.created_at ?? m.created_at;
    const end = nextUserAfter(m)?.created_at ?? Infinity;
    return evs.filter(
      (e) =>
        e.message_id === m.id || (!e.message_id && e.at >= start && e.at < end),
    );
  };
  const requestOf = (m: Row): Row | undefined => {
    if (m.role === "user")
      return reqs.find((r) => r.trigger_message_id === m.id);
    const linked = evs.find((e) => e.message_id === m.id && e.model_request_id);
    return (
      reqs.find((r) => r.id === linked?.model_request_id) ??
      reqs.find((r) => r.trigger_message_id === m.parent_message_id) ??
      reqs
        .filter(
          (r) =>
            r.request_kind === "live_session_token" &&
            r.started_at <= m.created_at,
        )
        .at(-1)
    );
  };

  type Item = {
    at: number;
    order: number;
    kind: "message" | "event";
    row: Row;
  };
  const items: Item[] = [
    ...msgs.map((row, i) => ({
      at: row.created_at,
      order: i,
      kind: "message" as const,
      row,
    })),
    ...(showEvents
      ? evs.map((row, i) => ({
          at: row.at,
          order: 1e6 + i,
          kind: "event" as const,
          row,
        }))
      : []),
  ].sort((a, b) => a.at - b.at || a.order - b.order);

  const cost = reqs.reduce((n, r) => n + r.cost_usd_micros, 0);
  const usage = evs.filter((e) => e.event_type === "usage.reported").at(-1)?.p;
  const voiceEstimate = usage
    ? ((usage.promptTokens ?? 0) * PRICING_USD_PER_M.inputAudio +
        (usage.responseTokens ?? 0) * PRICING_USD_PER_M.outputAudio) /
      1e6
    : null;
  const plain = items
    .map((i) =>
      i.kind === "message"
        ? `${i.row.role === "user" ? "Visitor" : "Iris"}: ${textOf(i.row)}`
        : `  (${describe(i.row.event_type, i.row.p)})`,
    )
    .join("\n");

  const selMsg = sel?.kind === "message" ? byId.get(sel.id) : undefined;
  const selEvent =
    sel?.kind === "event" ? evs.find((e) => e.id === sel.id) : undefined;
  const selReq =
    sel?.kind === "request" ? reqs.find((r) => r.id === sel.id) : undefined;

  const requestFields = (r: Row): [string, React.ReactNode][] => {
    const u = r.usage;
    return [
      ["Model", `${r.provider} · ${r.model}`],
      ["Kind", r.request_kind],
      ["Status", r.status],
      ["Started", whenFull(r.started_at)],
      ["Latency", r.finished_at ? duration(r.finished_at - r.started_at) : "—"],
      ...(r.response.firstTextMs != null
        ? ([["First words after", duration(r.response.firstTextMs)]] as [
            string,
            React.ReactNode,
          ][])
        : []),
      ...(u.totalTokens != null
        ? ([
            [
              "Tokens in / out",
              `${u.inputTokens ?? 0} / ${u.outputTokens ?? 0}`,
            ],
            ["Tokens total", u.totalTokens],
          ] as [string, React.ReactNode][])
        : []),
      [
        "Cost counted",
        `${usd4(r.cost_usd_micros)} (${r.cost_basis ?? "none"})`,
      ],
      ...(r.response.toolCalls
        ? ([
            [
              "Tool calls",
              r.response.toolCalls.length
                ? r.response.toolCalls.join(", ")
                : "none",
            ],
          ] as [string, React.ReactNode][])
        : []),
      ...(r.payload.historyTurns != null
        ? ([["History sent", `${r.payload.historyTurns} turns`]] as [
            string,
            React.ReactNode,
          ][])
        : []),
      ...(r.manifest.tokenCap
        ? ([
            [
              "Token budget",
              `${r.manifest.tokensBefore} used before this turn of ${r.manifest.tokenCap}`,
            ],
          ] as [string, React.ReactNode][])
        : []),
      ...(r.response.failure
        ? ([["Failure", r.response.failure]] as [string, React.ReactNode][])
        : []),
      ["Request ID", <code key="id">{r.id}</code>],
    ];
  };

  const jump = (kind: "message" | "event" | "request", target: string) => (
    <button className="adm-link" onClick={() => setSel({ kind, id: target })}>
      {kind === "message"
        ? "open message"
        : kind === "request"
          ? "open model call"
          : "open event"}
    </button>
  );

  const toolEvent = (e: Row) => (
    <li key={e.id} className="adm-tool">
      <button
        className="adm-link"
        onClick={() => setSel({ kind: "event", id: e.id })}
      >
        {describe(e.event_type, e.p)}
      </button>
      <span className="adm-muted">{new Date(e.at).toLocaleTimeString()}</span>
      {e.event_type === "view.rendered" && (
        <span className="adm-muted">
          {(e.p.blocks ?? []).map((b: Row) => b.kind).join(" · ")}
        </span>
      )}
    </li>
  );

  const inspectorBody = () => {
    if (selMsg) {
      const m = selMsg;
      const text = textOf(m);
      const req = requestOf(m);
      const calls = eventsOf(m);
      const parent = byId.get(m.parent_message_id);
      const answers = msgs.filter((x) => x.parent_message_id === m.id);
      return (
        <>
          <h3>{m.role === "user" ? "Visitor message" : "Iris reply"}</h3>
          <div className="adm-fulltext">
            {text || <em className="adm-muted">(empty)</em>}
          </div>
          <Fields
            rows={[
              ["Status", m.status],
              ["Sequence", `#${m.sequence_number}`],
              ["Sent", whenFull(m.created_at)],
              ["Completed", whenFull(m.completed_at)],
              [
                "Length",
                `${text.length} characters · ${text.split(/\s+/).filter(Boolean).length} words`,
              ],
              ["Kind", m.kind],
              ...(parent
                ? ([
                    [
                      "Answers",
                      <>
                        {`“${textOf(parent).slice(0, 60)}”`}{" "}
                        {jump("message", parent.id)}
                      </>,
                    ],
                  ] as [string, React.ReactNode][])
                : []),
              ...(answers.length
                ? ([
                    [
                      "Answered by",
                      answers.map((a) => (
                        <span key={a.id}>{jump("message", a.id)} </span>
                      )),
                    ],
                  ] as [string, React.ReactNode][])
                : []),
              ["Message ID", <code key="id">{m.id}</code>],
            ]}
          />
          {req && (
            <>
              <h4>Model call</h4>
              <Fields rows={requestFields(req)} />
            </>
          )}
          {calls.length > 0 && (
            <>
              <h4>Tool calls and events in this turn</h4>
              <ul className="adm-tools">{calls.map(toolEvent)}</ul>
            </>
          )}
          <Json
            label="Raw data"
            value={{
              message: { ...m, c: undefined, content: m.c },
              request: req ?? null,
              events: calls,
            }}
          />
        </>
      );
    }
    if (selEvent) {
      const e = selEvent;
      const linked = e.message_id ? byId.get(e.message_id) : undefined;
      return (
        <>
          <h3>{describe(e.event_type, e.p)}</h3>
          <Fields
            rows={[
              ["Type", <code key="t">{e.event_type}</code>],
              ["Source", e.source],
              ["When", whenFull(e.at)],
              ["Received", whenFull(e.received_at)],
              ["Sequence", `#${e.sequence_number}`],
              ...(linked
                ? ([["During message", jump("message", linked.id)]] as [
                    string,
                    React.ReactNode,
                  ][])
                : []),
              ...(e.model_request_id
                ? ([
                    ["Made by model call", jump("request", e.model_request_id)],
                  ] as [string, React.ReactNode][])
                : []),
              ["Event ID", <code key="id">{e.id}</code>],
            ]}
          />
          {e.event_type === "view.rendered" && (
            <>
              <h4>What was shown</h4>
              <p>
                <strong>{e.p.title}</strong>
                {e.p.subtitle ? ` · ${e.p.subtitle}` : ""}
              </p>
              <ul className="adm-tools">
                {(e.p.blocks ?? []).map((b: Row, i: number) => (
                  <li key={i}>
                    <span className="adm-pill">{b.kind}</span>{" "}
                    {b.heading ?? b.project ?? b.body?.slice(0, 80) ?? ""}
                  </li>
                ))}
              </ul>
            </>
          )}
          <Json label="Full payload" value={e.p} />
        </>
      );
    }
    if (selReq) {
      return (
        <>
          <h3>Model call</h3>
          <Fields rows={requestFields(selReq)} />
          <Json
            label="Raw request, context and response"
            value={{
              request: selReq.payload,
              context: selReq.manifest,
              response: selReq.response,
              usage: selReq.usage,
            }}
          />
        </>
      );
    }
    return (
      <>
        <h3>Conversation</h3>
        <p className="adm-muted">
          Click any message, tool call or model call to see everything about it.
        </p>
        <Fields
          rows={[
            ["Mode", c.mode],
            ["Status", c.status],
            ["Started", whenFull(c.started_at)],
            ["Last activity", whenFull(c.updated_at)],
            ["Ended", whenFull(c.ended_at)],
            ["Length", duration((c.ended_at ?? c.updated_at) - c.started_at)],
            [
              "Messages",
              `${msgs.length} (${msgs.filter((m) => m.role === "user").length} from the visitor)`,
            ],
            ["Events", evs.length],
            ["Model calls", reqs.length],
            ["Cost counted", usd4(cost)],
            ...(voiceEstimate != null
              ? ([
                  [
                    "Voice, estimated",
                    `≈ ${usd4(voiceEstimate * 1e6)} from ${usage.totalTokens} reported tokens`,
                  ],
                ] as [string, React.ReactNode][])
              : []),
            ["Knowledge version", c.knowledge_version],
            ["Kept until", new Date(c.retain_until).toLocaleDateString()],
            [
              "Visitor",
              <button
                key="v"
                className="adm-link"
                onClick={() => openVisitor(c.visitor_id)}
              >
                {short(c.visitor_id)} · all their conversations
              </button>,
            ],
            ["Conversation ID", <code key="id">{c.id}</code>],
          ]}
        />
        <h4>Model calls</h4>
        {reqs.length === 0 && <p className="adm-muted">None recorded.</p>}
        <ul className="adm-tools">
          {reqs.map((r) => (
            <li key={r.id} className="adm-tool">
              <button
                className="adm-link"
                onClick={() => setSel({ kind: "request", id: r.id })}
              >
                {r.request_kind === "text_turn" ? "Text turn" : "Voice session"}
              </button>
              <span className="adm-muted">
                {new Date(r.started_at).toLocaleTimeString()} · {r.status} ·{" "}
                {usd4(r.cost_usd_micros)}
                {r.finished_at
                  ? ` · ${duration(r.finished_at - r.started_at)}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
        <Json label="Raw conversation row" value={c} />
      </>
    );
  };

  return (
    <section>
      <div className="adm-line">
        <button className="adm-quiet" onClick={() => back(false)}>
          ← Back
        </button>
        <span className="adm-muted">
          {when(c.started_at)} · {c.mode} · {c.status} · {usd(cost)} ·{" "}
          <button
            className="adm-link"
            onClick={() => openVisitor(c.visitor_id)}
          >
            visitor {short(c.visitor_id)}
          </button>
        </span>
      </div>
      <Updated at={updated} />
      <div className="adm-actions">
        <button onClick={() => navigator.clipboard?.writeText(plain)}>
          Copy transcript
        </button>
        <label className="adm-check">
          <input
            type="checkbox"
            checked={showEvents}
            onChange={(e) => setShowEvents(e.target.checked)}
          />{" "}
          Show tool calls and events
        </label>
        {sel && (
          <button className="adm-quiet" onClick={() => setSel(null)}>
            Conversation info
          </button>
        )}
        <button
          className="adm-danger"
          onClick={async () => {
            if (!window.confirm("Delete this conversation for good?")) return;
            await call(`/admin/delete?kind=conversation&id=${id}`, "POST");
            back(true);
          }}
        >
          Delete
        </button>
      </div>
      <div className="adm-detail">
        <div className="adm-thread">
          {items.map((i) =>
            i.kind === "message" ? (
              <button
                key={i.row.id}
                className={`adm-msg ${i.row.role}${sel?.id === i.row.id ? " sel" : ""}`}
                onClick={() => setSel({ kind: "message", id: i.row.id })}
              >
                <span className="adm-who">
                  {i.row.role === "user" ? "Visitor" : "Iris"} ·{" "}
                  {new Date(i.at).toLocaleTimeString()}
                  {i.row.status !== "complete" && ` · ${i.row.status}`}
                </span>
                {textOf(i.row)}
              </button>
            ) : (
              <button
                key={i.row.id}
                className={`adm-evt${sel?.id === i.row.id ? " sel" : ""}`}
                onClick={() => setSel({ kind: "event", id: i.row.id })}
              >
                {describe(i.row.event_type, i.row.p)}
              </button>
            ),
          )}
        </div>
        <aside className="adm-inspector" ref={inspector}>
          {inspectorBody()}
        </aside>
      </div>
    </section>
  );
}
