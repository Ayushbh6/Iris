// Phase 5: everything the owner can read back. Conversations, their messages and
// screen events, messages left for Ayush, the retention sweep. All of it lives in
// the same SQLite Durable Object as the budget, so one transaction covers both.
// No audio, API keys or provider credentials are ever written here.

const HOUR = 3600000,
  DAY = 86400000;

export const MAX_MESSAGES_PER_CONVERSATION = 500;
export const MAX_EVENTS_PER_CONVERSATION = 1500;
const MAX_TEXT = 8000;
const MAX_EVENT_BYTES = 8000;

// Events the browser may report. Anything else is rejected, so a forged request
// cannot put arbitrary labels into the owner's viewer.
export const BROWSER_EVENTS = [
  "screen.event",
  "view.rendered",
  "connect.requested",
  "mode.voice",
  "mode.text",
  "usage.reported",
  "conversation.ended",
  "error",
] as const;

export type MessageEntry = {
  type: "message";
  id?: string; // idempotency key; a retry with the same id is ignored
  uuid?: string; // server-made message id, so other rows can point at it
  parent?: string | null; // the message this answers; default: the latest visitor message
  role: "user" | "assistant";
  text: string;
  status?: "complete" | "interrupted" | "incomplete" | "failed";
  at?: number;
};
export type EventEntry = {
  type: "event";
  key?: string; // idempotency key
  source: "browser" | "server";
  name: string;
  data?: unknown;
  at?: number;
  messageId?: string; // the message this happened during
  modelRequestId?: string; // the model call that produced it
};
export type Entry = MessageEntry | EventEntry;

type Sql = SqlStorage;
const one = <T extends Record<string, SqlStorageValue>>(
  sql: Sql,
  query: string,
  ...args: unknown[]
) => sql.exec<T>(query, ...args).toArray()[0];

// Browser clocks lie; a turn's own time is kept only when it is plausible.
const clampTime = (at: number | undefined, now: number) =>
  typeof at === "number" && Number.isFinite(at) && at <= now && at > now - HOUR
    ? Math.floor(at)
    : now;

const payload = (data: unknown) => {
  const text = JSON.stringify(data ?? {});
  return text.length <= MAX_EVENT_BYTES
    ? text
    : JSON.stringify({ truncated: true, bytes: text.length });
};

// Appends messages and events in order, atomically. Entries already stored
// (same id/key) are skipped, and a conversation stops growing at its cap.
export function writeEntries(
  ctx: DurableObjectState,
  conversationId: string,
  entries: Entry[],
  now = Date.now(),
) {
  const sql = ctx.storage.sql;
  return ctx.storage.transactionSync(() => {
    let messageSeq =
      one<{ n: number }>(
        sql,
        "SELECT COALESCE(MAX(sequence_number),0) n FROM messages WHERE conversation_id=?",
        conversationId,
      )?.n ?? 0;
    let eventSeq =
      one<{ n: number }>(
        sql,
        "SELECT COALESCE(MAX(sequence_number),0) n FROM events WHERE conversation_id=?",
        conversationId,
      )?.n ?? 0;
    let lastUser =
      one<{ id: string }>(
        sql,
        "SELECT id FROM messages WHERE conversation_id=? AND role='user' ORDER BY sequence_number DESC LIMIT 1",
        conversationId,
      )?.id ?? null;
    let written = 0,
      dropped = 0,
      ended = false;
    for (const entry of entries) {
      const at = clampTime(entry.at, now);
      if (entry.type === "message") {
        const text = entry.text.slice(0, MAX_TEXT);
        const id =
          entry.uuid ??
          (entry.id ? `${conversationId}.${entry.id}` : crypto.randomUUID());
        if (
          messageSeq >= MAX_MESSAGES_PER_CONVERSATION ||
          one(sql, "SELECT 1 FROM messages WHERE id=?", id)
        ) {
          dropped++;
          continue;
        }
        const parent =
          entry.parent !== undefined
            ? entry.parent
            : entry.role === "assistant"
              ? lastUser
              : null;
        sql.exec(
          "INSERT INTO messages(id,conversation_id,sequence_number,role,kind,content_json,parent_message_id,tool_call_id,status,created_at,completed_at) VALUES (?,?,?,?,'text',?,?,NULL,?,?,?)",
          id,
          conversationId,
          ++messageSeq,
          entry.role,
          JSON.stringify({ text }),
          parent,
          entry.status ?? "complete",
          at,
          now,
        );
        if (entry.role === "user") lastUser = id;
      } else {
        const key = `${conversationId}:${entry.key ?? crypto.randomUUID()}`;
        if (
          eventSeq >= MAX_EVENTS_PER_CONVERSATION ||
          one(sql, "SELECT 1 FROM events WHERE deduplication_key=?", key)
        ) {
          dropped++;
          continue;
        }
        sql.exec(
          "INSERT INTO events(id,conversation_id,message_id,model_request_id,sequence_number,source,event_type,provider_event_id,deduplication_key,occurred_at,received_at,payload_json) VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?)",
          crypto.randomUUID(),
          conversationId,
          entry.messageId ?? null,
          entry.modelRequestId ?? null,
          ++eventSeq,
          entry.source,
          entry.name,
          key,
          at,
          now,
          payload(entry.data),
        );
        if (entry.name === "conversation.ended") ended = true;
      }
      written++;
    }
    if (ended)
      sql.exec(
        "UPDATE conversations SET updated_at=?, status=CASE WHEN status='active' THEN 'ended' ELSE status END, ended_at=COALESCE(ended_at,?) WHERE id=?",
        now,
        now,
        conversationId,
      );
    else
      sql.exec(
        "UPDATE conversations SET updated_at=? WHERE id=?",
        now,
        conversationId,
      );
    return { written, dropped };
  });
}

export const conversationOwnedBy = (
  ctx: DurableObjectState,
  conversationId: string,
  visitorId: string,
) =>
  !!one(
    ctx.storage.sql,
    "SELECT 1 FROM conversations WHERE id=? AND visitor_id=?",
    conversationId,
    visitorId,
  );

// Owner viewer: newest first, paged by start time.
export function listConversations(
  ctx: DurableObjectState,
  limit: number,
  before: number,
  visitorId?: string,
) {
  return ctx.storage.sql
    .exec(
      `SELECT c.id, c.visitor_id, c.mode, c.status, c.started_at, c.updated_at, c.ended_at,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id) AS messages,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.role='user') AS user_turns,
        (SELECT COALESCE(SUM(u.cost_usd_micros),0) FROM usage_records u JOIN model_requests r ON r.id=u.model_request_id WHERE r.conversation_id=c.id) AS cost_usd_micros,
        (SELECT json_extract(m.content_json,'$.text') FROM messages m WHERE m.conversation_id=c.id AND m.role='user' ORDER BY m.sequence_number LIMIT 1) AS first_message
       FROM conversations c WHERE c.started_at < ? AND (? IS NULL OR c.visitor_id = ?) ORDER BY c.started_at DESC LIMIT ?`,
      before,
      visitorId ?? null,
      visitorId ?? null,
      limit,
    )
    .toArray();
}

export function conversationRecord(ctx: DurableObjectState, id: string) {
  const sql = ctx.storage.sql;
  const conversation = one(
    sql,
    "SELECT id,visitor_id,status,mode,knowledge_version,recording_policy_json,started_at,updated_at,ended_at,retain_until FROM conversations WHERE id=?",
    id,
  );
  if (!conversation) return null;
  return {
    conversation,
    messages: sql
      .exec(
        "SELECT id,sequence_number,role,kind,content_json,parent_message_id,status,created_at,completed_at FROM messages WHERE conversation_id=? ORDER BY sequence_number",
        id,
      )
      .toArray(),
    events: sql
      .exec(
        "SELECT id,sequence_number,source,event_type,message_id,model_request_id,occurred_at,received_at,payload_json FROM events WHERE conversation_id=? ORDER BY sequence_number",
        id,
      )
      .toArray(),
    requests: sql
      .exec(
        `SELECT r.id,r.provider,r.model,r.request_kind,r.status,r.trigger_message_id,r.started_at,r.finished_at,
          r.request_payload_json,r.context_manifest_json,r.response_payload_json,
          COALESCE(SUM(u.cost_usd_micros),0) AS cost_usd_micros,
          MAX(u.normalized_usage_json) AS usage_json,
          MAX(u.record_type) AS cost_basis
         FROM model_requests r LEFT JOIN usage_records u ON u.model_request_id=r.id
         WHERE r.conversation_id=? GROUP BY r.id ORDER BY r.started_at`,
        id,
      )
      .toArray(),
  };
}

// One row per visitor: how many times they came, what they asked, what it cost.
export function listVisitors(
  ctx: DurableObjectState,
  limit: number,
  before: number,
) {
  return ctx.storage.sql
    .exec(
      `SELECT c.visitor_id,
        MIN(c.started_at) AS first_seen, MAX(c.started_at) AS last_seen,
        COUNT(*) AS conversations,
        SUM(CASE WHEN c.mode='voice' THEN 1 ELSE 0 END) AS voice_conversations,
        (SELECT COUNT(*) FROM messages m JOIN conversations c2 ON c2.id=m.conversation_id WHERE c2.visitor_id=c.visitor_id AND m.role='user') AS user_turns,
        (SELECT COALESCE(SUM(u.cost_usd_micros),0) FROM usage_records u JOIN model_requests r ON r.id=u.model_request_id JOIN conversations c3 ON c3.id=r.conversation_id WHERE c3.visitor_id=c.visitor_id) AS cost_usd_micros,
        (SELECT COUNT(*) FROM leave_messages l WHERE l.visitor_id=c.visitor_id) AS left_messages
       FROM conversations c GROUP BY c.visitor_id HAVING MAX(c.started_at) < ? ORDER BY last_seen DESC LIMIT ?`,
      before,
      limit,
    )
    .toArray();
}

// Volume, spend and engagement over the last `days` UTC days (oldest first).
export function stats(ctx: DurableObjectState, days: number, now = Date.now()) {
  const sql = ctx.storage.sql;
  const today = now - (now % DAY);
  const since = today - (days - 1) * DAY;
  const rows = <T extends Record<string, SqlStorageValue>>(
    query: string,
    ...args: unknown[]
  ) => sql.exec<T>(query, ...args).toArray();
  const series = Array.from({ length: days }, (_, i) => ({
    date: new Date(since + i * DAY).toISOString().slice(0, 10),
    voice: 0,
    text: 0,
    visitors: 0,
    turns: 0,
    costUsd: 0,
    views: 0,
    messages: 0,
  }));
  const at = (ms: number) => series[Math.floor((ms - since) / DAY)];
  const seen = series.map(() => new Set<string>());
  const hours = Array<number>(24).fill(0);
  const visitors = new Set<string>();
  const conversations = rows<{
    id: string;
    started_at: number;
    mode: string;
    visitor_id: string;
  }>(
    "SELECT id,started_at,mode,visitor_id FROM conversations WHERE started_at>=? LIMIT 20000",
    since,
  );
  for (const c of conversations) {
    const day = at(c.started_at);
    if (!day) continue;
    if (c.mode === "voice") day.voice++;
    else day.text++;
    seen[Math.floor((c.started_at - since) / DAY)].add(c.visitor_id);
    visitors.add(c.visitor_id);
    hours[new Date(c.started_at).getUTCHours()]++;
  }
  series.forEach((d, i) => (d.visitors = seen[i].size));
  let turns = 0;
  for (const m of rows<{ created_at: number }>(
    "SELECT created_at FROM messages WHERE role='user' AND created_at>=? LIMIT 50000",
    since,
  )) {
    const day = at(m.created_at);
    if (day) (day.turns++, turns++);
  }
  let cost = 0;
  for (const u of rows<{ recorded_at: number; cost_usd_micros: number }>(
    "SELECT recorded_at,cost_usd_micros FROM usage_records WHERE recorded_at>=? LIMIT 50000",
    since,
  )) {
    const day = at(u.recorded_at);
    if (day)
      ((day.costUsd += u.cost_usd_micros / 1e6), (cost += u.cost_usd_micros));
  }
  let views = 0,
    jobDescriptions = 0;
  for (const e of rows<{ received_at: number; fit: number }>(
    "SELECT received_at, payload_json LIKE '%\"kind\":\"fit\"%' AS fit FROM events WHERE event_type='view.rendered' AND received_at>=? LIMIT 50000",
    since,
  )) {
    const day = at(e.received_at);
    if (day) (day.views++, views++);
    if (e.fit) jobDescriptions++;
  }
  let messages = 0;
  for (const l of rows<{ created_at: number }>(
    "SELECT created_at FROM leave_messages WHERE created_at>=?",
    since,
  )) {
    const day = at(l.created_at);
    if (day) (day.messages++, messages++);
  }
  const engaged =
    one<{ n: number }>(
      sql,
      "SELECT COUNT(*) n FROM conversations c WHERE c.started_at>=? AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.role='user')",
      since,
    )?.n ?? 0;
  const topViews = rows<{ title: string; n: number }>(
    "SELECT json_extract(payload_json,'$.title') AS title, COUNT(*) n FROM events WHERE event_type='view.rendered' AND received_at>=? AND title IS NOT NULL GROUP BY title ORDER BY n DESC LIMIT 8",
    since,
  );
  for (const d of series) d.costUsd = Number(d.costUsd.toFixed(4));
  return {
    days,
    series,
    hours,
    topViews,
    totals: {
      conversations: conversations.length,
      visitors: visitors.size,
      userTurns: turns,
      engagedConversations: engaged,
      avgTurns: conversations.length
        ? Number((turns / conversations.length).toFixed(1))
        : 0,
      voiceShare: conversations.length
        ? Number(
            (
              conversations.filter((c) => c.mode === "voice").length /
              conversations.length
            ).toFixed(2),
          )
        : 0,
      costUsd: Number((cost / 1e6).toFixed(4)),
      viewsShown: views,
      jobDescriptions,
      leftMessages: messages,
    },
  };
}

export type LeaveMessage = {
  visitorId: string;
  conversationId?: string;
  name: string;
  email: string;
  body: string;
};

// Cheap server-side limits: the form is behind the visitor token, these bound
// what one visitor, one network or the whole site can drop in the owner's inbox.
export const LEAVE_PER_VISITOR_PER_DAY = 3;
export const LEAVE_PER_SITE_PER_DAY = 100;

export function leaveCounts(
  ctx: DurableObjectState,
  visitorId: string,
  now: number,
) {
  const since = now - (now % DAY);
  const sql = ctx.storage.sql;
  return {
    visitor:
      one<{ n: number }>(
        sql,
        "SELECT COUNT(*) n FROM leave_messages WHERE visitor_id=? AND created_at>=?",
        visitorId,
        since,
      )?.n ?? 0,
    site:
      one<{ n: number }>(
        sql,
        "SELECT COUNT(*) n FROM leave_messages WHERE created_at>=?",
        since,
      )?.n ?? 0,
  };
}

export function saveLeaveMessage(
  ctx: DurableObjectState,
  m: LeaveMessage,
  retainDays: number,
  now = Date.now(),
) {
  const id = crypto.randomUUID();
  ctx.storage.sql.exec(
    "INSERT INTO leave_messages(id,visitor_id,conversation_id,name,email,body,status,created_at,read_at,retain_until) VALUES (?,?,?,?,?,?,'new',?,NULL,?)",
    id,
    m.visitorId,
    m.conversationId ?? null,
    m.name,
    m.email,
    m.body,
    now,
    now + retainDays * DAY,
  );
  return id;
}

export function listLeaveMessages(ctx: DurableObjectState, all: boolean) {
  return ctx.storage.sql
    .exec(
      `SELECT * FROM leave_messages ${all ? "" : "WHERE status<>'archived'"} ORDER BY created_at DESC LIMIT 200`,
    )
    .toArray();
}

export function setLeaveStatus(
  ctx: DurableObjectState,
  id: string,
  status: "new" | "read" | "archived",
  now = Date.now(),
) {
  const result = ctx.storage.sql.exec(
    "UPDATE leave_messages SET status=?, read_at=CASE WHEN ?='new' THEN NULL ELSE COALESCE(read_at,?) END WHERE id=?",
    status,
    status,
    now,
    id,
  );
  return result.rowsWritten > 0;
}

export function deleteLeaveMessage(ctx: DurableObjectState, id: string) {
  return (
    ctx.storage.sql.exec("DELETE FROM leave_messages WHERE id=?", id)
      .rowsWritten > 0
  );
}

// Children first: the foreign keys refuse a parent that still has rows.
export function deleteConversations(ctx: DurableObjectState, ids: string[]) {
  const sql = ctx.storage.sql;
  ctx.storage.transactionSync(() => {
    for (const id of ids) {
      sql.exec(
        "DELETE FROM usage_records WHERE model_request_id IN (SELECT id FROM model_requests WHERE conversation_id=?)",
        id,
      );
      sql.exec("DELETE FROM events WHERE conversation_id=?", id);
      sql.exec("DELETE FROM media_assets WHERE conversation_id=?", id);
      sql.exec("DELETE FROM model_requests WHERE conversation_id=?", id);
      sql.exec("DELETE FROM messages WHERE conversation_id=?", id);
      sql.exec("DELETE FROM conversations WHERE id=?", id);
      ctx.storage.kv.delete(`chat-tokens:${id}`);
    }
  });
  return ids.length;
}

// Everything the owner could want to back up. No model payloads, no secrets.
export function exportAll(ctx: DurableObjectState) {
  const sql = ctx.storage.sql;
  const rows = (query: string) => sql.exec(query).toArray();
  return {
    exportedAt: Date.now(),
    conversations: rows(
      "SELECT id,visitor_id,status,mode,knowledge_version,started_at,updated_at,ended_at,retain_until FROM conversations ORDER BY started_at",
    ),
    messages: rows(
      "SELECT id,conversation_id,sequence_number,role,kind,content_json,status,created_at FROM messages ORDER BY conversation_id,sequence_number",
    ),
    events: rows(
      "SELECT conversation_id,sequence_number,source,event_type,occurred_at,received_at,payload_json FROM events ORDER BY conversation_id,sequence_number",
    ),
    leaveMessages: rows("SELECT * FROM leave_messages ORDER BY created_at"),
  };
}

// Daily housekeeping: expired records go, conversations nobody closed are marked
// ended, and spent rate-limit buckets and old bookkeeping keys are dropped.
export function sweep(ctx: DurableObjectState, now = Date.now()) {
  const sql = ctx.storage.sql;
  const expired = sql
    .exec<{ id: string }>(
      "SELECT id FROM conversations WHERE retain_until<? LIMIT 500",
      now,
    )
    .toArray()
    .map((r) => r.id);
  if (expired.length) deleteConversations(ctx, expired);
  const stale = sql.exec(
    "UPDATE conversations SET status='ended', ended_at=updated_at WHERE status='active' AND updated_at<?",
    now - 2 * HOUR,
  ).rowsWritten;
  const messages = sql.exec(
    "DELETE FROM leave_messages WHERE retain_until<?",
    now,
  ).rowsWritten;
  sql.exec(
    "DELETE FROM visitors WHERE expires_at<? AND id NOT IN (SELECT visitor_id FROM conversations)",
    now,
  );
  sql.exec(
    "DELETE FROM quota_buckets WHERE scope IN ('visitor','network') AND window_end<?",
    now - 2 * DAY,
  );
  for (const [key, value] of ctx.storage.kv.list<{
    state?: string;
    createdAt?: number;
  }>({ prefix: "reservation:" }))
    if (value.state === "settled" && (value.createdAt ?? 0) < now - 7 * DAY)
      ctx.storage.kv.delete(key);
  return {
    conversationsDeleted: expired.length,
    markedEnded: stale,
    messagesDeleted: messages,
  };
}
