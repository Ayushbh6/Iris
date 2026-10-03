"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { AGENT_URL } from "../../lib/agent/visitor";
import Detail from "./detail";
import Overview from "./overview";
import {
  REFRESH_MS,
  short,
  Updated,
  usd,
  usePoll,
  when,
  type Call,
  type Row,
} from "./lib";
import "./admin.css";

// Owner viewer: charts, conversations (per visitor too), messages left for
// Ayush, spend and the kill switch. The token is typed in and kept only for
// this browser tab.

const TOKEN_KEY = "ayushbh.admin";
type Tab = "overview" | "conversations" | "visitors" | "messages" | "status";
const TABS: Tab[] = [
  "overview",
  "conversations",
  "visitors",
  "messages",
  "status",
];

export default function Admin() {
  const [token, setToken] = useState("");
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [visitor, setVisitor] = useState(""); // scopes the conversation list
  const [error, setError] = useState("");
  const [unread, setUnread] = useState(0);
  const [tick, setTick] = useState(0);
  const [summary, setSummary] = useState<Row | null>(null);
  const [requests, setRequests] = useState(0); // in flight right now
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    document.title = "Admin";
    try {
      setToken(window.sessionStorage.getItem(TOKEN_KEY) ?? "");
    } catch {}
  }, []);

  const call = useCallback(
    async (path: string, method = "GET"): Promise<Row | null> => {
      setRequests((n) => n + 1);
      try {
        const response = await fetch(`${AGENT_URL}${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.status === 404 && path.startsWith("/admin/status")) {
          setError("That token was not accepted.");
          setToken("");
          try {
            window.sessionStorage.removeItem(TOKEN_KEY);
          } catch {}
          return null;
        }
        return response.ok ? await response.json() : null;
      } catch {
        setError("Could not reach the Worker.");
        return null;
      } finally {
        setRequests((n) => n - 1);
      }
    },
    [token],
  );

  usePoll(
    useCallback(async () => {
      if (!token) return;
      const [data, status] = await Promise.all([
        call("/admin/leave-messages"),
        call("/admin/status"),
      ]);
      setUnread(
        (data?.messages ?? []).filter((m: Row) => m.status === "new").length,
      );
      if (status) setSummary(status);
    }, [call, token]),
    REFRESH_MS,
    tick,
  );

  // Pressing Refresh reloads whatever is on screen now, and the icon keeps
  // turning until the data is back (at least a moment, so the press is seen).
  const refreshNow = () => {
    setTick((t) => t + 1);
    setPressed(true);
    setTimeout(() => setPressed(false), 700);
  };
  const spinning = pressed || requests > 0;

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const t = draft.trim();
    const response = await fetch(`${AGENT_URL}/admin/status`, {
      headers: { Authorization: `Bearer ${t}` },
    }).catch(() => null);
    if (!response) return setError("Could not reach the Worker.");
    if (!response.ok) return setError("That token was not accepted.");
    try {
      window.sessionStorage.setItem(TOKEN_KEY, t);
    } catch {}
    setToken(t);
    setDraft("");
  }

  // Not for search engines (React hoists these into the document head).
  const head = (
    <>
      <title>Admin</title>
      <meta name="robots" content="noindex, nofollow" />
    </>
  );

  if (!token)
    return (
      <main className="adm adm-gate">
        {head}
        <h1>Admin</h1>
        <form onSubmit={signIn}>
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Admin token"
            aria-label="Admin token"
            autoComplete="off"
            autoFocus
          />
          <button type="submit">Open</button>
        </form>
        {error && <p className="adm-error">{error}</p>}
        <p className="adm-muted">
          The token is kept for this tab only and sent only to your Worker.
        </p>
      </main>
    );

  return (
    <main className="adm">
      {head}
      <header className="adm-head">
        <h1>Admin</h1>
        <nav>
          {TABS.map((t) => (
            <button
              key={t}
              className={tab === t ? "on" : ""}
              onClick={() => {
                if (t === "conversations") setVisitor("");
                setTab(t);
              }}
            >
              {t[0].toUpperCase() + t.slice(1)}
              {t === "messages" && unread > 0 && (
                <span className="adm-badge">{unread}</span>
              )}
            </button>
          ))}
        </nav>
        <button
          className="adm-refresh"
          onClick={refreshNow}
          disabled={spinning}
          aria-label="Refresh data"
        >
          <RefreshCw size={14} className={spinning ? "spin" : ""} />
          {spinning ? "Refreshing…" : "Refresh"}
        </button>
        <button
          className="adm-quiet"
          onClick={() => {
            try {
              window.sessionStorage.removeItem(TOKEN_KEY);
            } catch {}
            setToken("");
          }}
        >
          Lock
        </button>
      </header>
      {summary && <Summary status={summary} />}
      {tab === "overview" && <Overview call={call} tick={tick} />}
      {tab === "messages" && <Messages call={call} tick={tick} />}
      {tab === "conversations" && (
        <Conversations
          call={call}
          tick={tick}
          visitor={visitor}
          setVisitor={setVisitor}
        />
      )}
      {tab === "visitors" && (
        <Visitors
          call={call}
          tick={tick}
          open={(id) => {
            setVisitor(id);
            setTab("conversations");
          }}
        />
      )}
      {tab === "status" && <Status call={call} token={token} tick={tick} />}
    </main>
  );
}

// Always on top: what it has cost and how busy it has been.
function Summary({ status }: { status: Row }) {
  const b = status.budgets ?? {};
  const t = status.today ?? {};
  const money = (v?: number) => `$${(v ?? 0).toFixed(2)}`;
  return (
    <div
      className="adm-summary"
      title="Voice sessions are counted at their worst case ($0.15 each), so real spend is lower."
    >
      <div>
        <span className="adm-muted">Spent today</span>
        <strong>{money(b.day?.usedUsd)}</strong>
        <span className="adm-muted">of {money(b.day?.limitUsd)}</span>
      </div>
      <div>
        <span className="adm-muted">Spent in total</span>
        <strong>{money(b.experiment?.usedUsd)}</strong>
        <span className="adm-muted">of {money(b.experiment?.limitUsd)}</span>
      </div>
      <div>
        <span className="adm-muted">Today</span>
        <strong>{t.visitors ?? 0} visitors</strong>
        <span className="adm-muted">{t.conversations ?? 0} conversations</span>
      </div>
      {status.paused && (
        <div>
          <strong className="adm-error">Paused</strong>
        </div>
      )}
    </div>
  );
}

function Messages({ call, tick }: { call: Call; tick: number }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [all, setAll] = useState(false);
  const load = useCallback(async () => {
    const data = await call(`/admin/leave-messages${all ? "?all=1" : ""}`);
    if (data) setRows(data.messages ?? []);
  }, [call, all]);
  const updated = usePoll(load, REFRESH_MS, tick);
  const act = async (path: string) => {
    await call(path, "POST");
    void load();
  };
  return (
    <section>
      <label className="adm-check">
        <input
          type="checkbox"
          checked={all}
          onChange={(e) => setAll(e.target.checked)}
        />{" "}
        Show archived
      </label>
      <Updated at={updated} />
      {rows === null && <p className="adm-muted">Loading…</p>}
      {rows?.length === 0 && <p className="adm-muted">No messages yet.</p>}
      {rows?.map((m) => (
        <article key={m.id} className={`adm-card ${m.status}`}>
          <div className="adm-line">
            <strong>{m.name}</strong>
            <a href={`mailto:${m.email}`}>{m.email}</a>
            <span className="adm-muted">{when(m.created_at)}</span>
            <span className={`adm-pill ${m.status}`}>{m.status}</span>
          </div>
          <p className="adm-body">{m.body}</p>
          <div className="adm-actions">
            {m.status !== "read" && (
              <button
                onClick={() =>
                  act(`/admin/leave-messages?id=${m.id}&status=read`)
                }
              >
                Mark read
              </button>
            )}
            {m.status !== "archived" && (
              <button
                onClick={() =>
                  act(`/admin/leave-messages?id=${m.id}&status=archived`)
                }
              >
                Archive
              </button>
            )}
            <button
              className="adm-danger"
              onClick={() =>
                window.confirm("Delete this message for good?") &&
                act(`/admin/delete?kind=leave-message&id=${m.id}`)
              }
            >
              Delete
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

function Conversations({
  call,
  tick,
  visitor,
  setVisitor,
}: {
  call: Call;
  tick: number;
  visitor: string;
  setVisitor: (id: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [more, setMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const first = useRef(true);
  const [open, setOpen] = useState("");
  const [person, setPerson] = useState<Row | null>(null);
  // A different filter starts a fresh list.
  useEffect(() => {
    setRows([]);
    setLoaded(false);
    first.current = true;
  }, [visitor]);
  const page = useCallback(
    async (before?: number) => {
      const data = await call(
        `/admin/conversations?limit=30${before ? `&before=${before}` : ""}${visitor ? `&visitor=${visitor}` : ""}`,
      );
      if (!data) return;
      const next: Row[] = data.conversations ?? [];
      setRows((r) => {
        if (before) return [...r, ...next];
        // A refresh replaces the newest page and keeps older pages already loaded.
        const oldest =
          next.length === 30 ? next[next.length - 1].started_at : 0;
        return [...next, ...r.filter((c) => c.started_at < oldest)];
      });
      if (before || first.current) setMore(next.length === 30);
      first.current = false;
      setLoaded(true);
    },
    [call, visitor],
  );
  const refresh = useCallback(() => (open ? undefined : page()), [open, page]);
  const updated = usePoll(refresh, REFRESH_MS, tick);
  // Who the filter is, for the header card.
  useEffect(() => {
    setPerson(null);
    if (!visitor) return;
    void call("/admin/visitors?limit=100").then((d) =>
      setPerson(
        (d?.visitors ?? []).find((v: Row) => v.visitor_id === visitor) ?? null,
      ),
    );
  }, [call, visitor, tick]);
  const toggleBlock = async () => {
    if (!person) return;
    if (
      !person.blocked &&
      !window.confirm("Block this visitor from using the assistant?")
    )
      return;
    await call(
      `/admin/${person.blocked ? "unblock" : "block"}?visitor=${visitor}`,
      "POST",
    );
    setPerson({ ...person, blocked: !person.blocked });
  };
  if (open)
    return (
      <Detail
        id={open}
        call={call}
        tick={tick}
        openVisitor={(id) => {
          setOpen("");
          setVisitor(id);
        }}
        back={(changed) => {
          setOpen("");
          if (changed) void page();
        }}
      />
    );
  return (
    <section>
      {visitor && (
        <div className="adm-card">
          <div className="adm-line">
            <strong>Visitor {short(visitor)}</strong>
            <code className="adm-muted">{visitor}</code>
            {person?.blocked && <span className="adm-pill">blocked</span>}
          </div>
          {person && (
            <span className="adm-muted">
              First seen {when(person.first_seen)} · last{" "}
              {when(person.last_seen)} · {person.conversations} conversations ·{" "}
              {person.user_turns} messages · {usd(person.cost_usd_micros)}{" "}
              counted
              {person.left_messages
                ? ` · left ${person.left_messages} message(s)`
                : ""}
            </span>
          )}
          <div className="adm-actions">
            <button onClick={() => setVisitor("")}>← All conversations</button>
            {person && (
              <button
                className={person.blocked ? "" : "adm-danger"}
                onClick={toggleBlock}
              >
                {person.blocked ? "Unblock" : "Block this visitor"}
              </button>
            )}
          </div>
        </div>
      )}
      <Updated at={updated} />
      {!loaded && <p className="adm-muted">Loading…</p>}
      {loaded && rows.length === 0 && (
        <p className="adm-muted">No conversations yet.</p>
      )}
      {rows.map((c) => (
        <div
          key={c.id}
          className="adm-row"
          role="button"
          tabIndex={0}
          onClick={() => setOpen(c.id)}
          onKeyDown={(e) => e.key === "Enter" && setOpen(c.id)}
        >
          <span className="adm-when">{when(c.started_at)}</span>
          <span className={`adm-pill ${c.mode}`}>{c.mode}</span>
          <span className="adm-first">
            {c.first_message || (
              <em className="adm-muted">(no visitor message)</em>
            )}
          </span>
          <span className="adm-muted">
            {c.user_turns} {c.user_turns === 1 ? "message" : "messages"} ·{" "}
            {usd(c.cost_usd_micros)} ·{" "}
            {!visitor ? (
              <button
                className="adm-link"
                title="Show only this visitor"
                onClick={(e) => {
                  e.stopPropagation();
                  setVisitor(c.visitor_id);
                }}
              >
                visitor {short(c.visitor_id)}
              </button>
            ) : (
              `visitor ${short(c.visitor_id)}`
            )}
          </span>
        </div>
      ))}
      {more && (
        <button
          className="adm-quiet"
          onClick={() => page(rows[rows.length - 1].started_at)}
        >
          Load more
        </button>
      )}
    </section>
  );
}

function Visitors({
  call,
  tick,
  open,
}: {
  call: Call;
  tick: number;
  open: (id: string) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const load = useCallback(async () => {
    const data = await call("/admin/visitors?limit=100");
    if (data) setRows(data.visitors ?? []);
  }, [call]);
  const updated = usePoll(load, REFRESH_MS, tick);
  return (
    <section>
      <Updated at={updated} />
      <p className="adm-muted">
        Visitors are anonymous: a random ID per browser, not a name. Click one
        to see all their conversations.
      </p>
      {rows === null && <p className="adm-muted">Loading…</p>}
      {rows?.length === 0 && <p className="adm-muted">No visitors yet.</p>}
      {rows?.map((v) => (
        <button
          key={v.visitor_id}
          className="adm-row adm-visitor"
          onClick={() => open(v.visitor_id)}
        >
          <span className="adm-when">{when(v.last_seen)}</span>
          <span>
            <strong>{short(v.visitor_id)}</strong>
            {v.blocked && <span className="adm-pill"> blocked</span>}
            {v.left_messages > 0 && (
              <span className="adm-pill new"> left a message</span>
            )}
          </span>
          <span className="adm-first adm-muted">
            first seen {when(v.first_seen)}
          </span>
          <span className="adm-muted">
            {v.conversations} conversations ({v.voice_conversations} voice) ·{" "}
            {v.user_turns} messages · {usd(v.cost_usd_micros)}
          </span>
        </button>
      ))}
    </section>
  );
}

function Status({
  call,
  token,
  tick,
}: {
  call: Call;
  token: string;
  tick: number;
}) {
  const [s, setS] = useState<Row | null>(null);
  const load = useCallback(async () => {
    const next = await call("/admin/status");
    if (next) setS(next);
  }, [call]);
  const updated = usePoll(load, REFRESH_MS, tick);
  if (!s) return <p className="adm-muted">Loading…</p>;
  const b = s.budgets ?? {};
  async function exportAll() {
    const response = await fetch(`${AGENT_URL}/admin/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return;
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `ayushbh-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section>
      <div className="adm-card">
        <div className="adm-line">
          <strong>{s.paused ? "Paused" : "Running"}</strong>
          <button
            className={s.paused ? "" : "adm-danger"}
            onClick={async () => {
              if (
                !s.paused &&
                !window.confirm("Pause the assistant for everyone?")
              )
                return;
              await call(s.paused ? "/admin/resume" : "/admin/pause", "POST");
              void load();
            }}
          >
            {s.paused ? "Resume" : "Pause"}
          </button>
        </div>
      </div>
      <div className="adm-grid">
        {(["day", "month", "experiment"] as const).map((k) => (
          <div key={k} className="adm-card">
            <span className="adm-muted">
              {k === "experiment" ? "All time" : k}
            </span>
            <strong>
              ${b[k]?.usedUsd?.toFixed(2)} / ${b[k]?.limitUsd?.toFixed(2)}
            </strong>
            <span className="adm-muted">{b[k]?.percent ?? 0}% used</span>
          </div>
        ))}
      </div>
      <div className="adm-card">
        <span className="adm-muted">Today</span>
        <div className="adm-line">
          <span>{s.today.visitors} visitors</span>
          <span>{s.today.conversations} conversations</span>
          <span>{s.today.voiceSessions} voice sessions</span>
          <span>{s.today.textTurns} text turns</span>
        </div>
      </div>
      <div className="adm-actions">
        <button onClick={exportAll}>Download everything (JSON)</button>

        <Updated at={updated} />
      </div>
    </section>
  );
}
