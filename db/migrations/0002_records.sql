-- Phase 5: messages left for the owner, plus indexes for the owner viewer and the retention sweep.
CREATE TABLE IF NOT EXISTS leave_messages (
 id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, conversation_id TEXT,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 email TEXT NOT NULL CHECK(length(email) BETWEEN 3 AND 200),
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','read','archived')),
 created_at INTEGER NOT NULL, read_at INTEGER, retain_until INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS leave_messages_created ON leave_messages(created_at);
CREATE INDEX IF NOT EXISTS leave_messages_visitor ON leave_messages(visitor_id,created_at);
CREATE INDEX IF NOT EXISTS conversations_started ON conversations(started_at);
CREATE INDEX IF NOT EXISTS conversations_retain ON conversations(retain_until);
CREATE INDEX IF NOT EXISTS model_requests_conversation ON model_requests(conversation_id,started_at);
CREATE INDEX IF NOT EXISTS usage_records_request ON usage_records(model_request_id);
