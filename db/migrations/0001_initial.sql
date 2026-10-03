PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS visitors (
 id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','blocked'))
);
CREATE TABLE IF NOT EXISTS conversations (
 id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL REFERENCES visitors(id), status TEXT NOT NULL CHECK(status IN ('active','ended','incomplete')),
 mode TEXT NOT NULL CHECK(mode IN ('voice','text')), knowledge_version TEXT NOT NULL,
 knowledge_snapshot_json TEXT NOT NULL CHECK(json_valid(knowledge_snapshot_json)),
 recording_policy_json TEXT NOT NULL CHECK(json_valid(recording_policy_json)),
 started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ended_at INTEGER, retain_until INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS conversations_visitor ON conversations(visitor_id,started_at);
CREATE TABLE IF NOT EXISTS messages (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), sequence_number INTEGER NOT NULL CHECK(sequence_number>0),
 role TEXT NOT NULL CHECK(role IN ('user','assistant','tool','system')), kind TEXT NOT NULL CHECK(kind IN ('text','audio','tool_call','tool_result')),
 content_json TEXT NOT NULL CHECK(json_valid(content_json)), parent_message_id TEXT REFERENCES messages(id), tool_call_id TEXT,
 status TEXT NOT NULL CHECK(status IN ('streaming','complete','interrupted','failed','incomplete')), created_at INTEGER NOT NULL, completed_at INTEGER,
 UNIQUE(conversation_id,sequence_number)
);
CREATE TABLE IF NOT EXISTS model_requests (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), trigger_message_id TEXT REFERENCES messages(id),
 provider TEXT NOT NULL, model TEXT NOT NULL, connection_id TEXT, provider_request_id TEXT,
 request_kind TEXT NOT NULL, request_payload_json TEXT NOT NULL CHECK(json_valid(request_payload_json)),
 context_manifest_json TEXT NOT NULL CHECK(json_valid(context_manifest_json)), response_payload_json TEXT CHECK(response_payload_json IS NULL OR json_valid(response_payload_json)),
 status TEXT NOT NULL CHECK(status IN ('pending','running','complete','cancelled','failed','uncertain')),
 operation_key TEXT NOT NULL UNIQUE, retry_of_request_id TEXT REFERENCES model_requests(id), started_at INTEGER NOT NULL, finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS events (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), message_id TEXT REFERENCES messages(id), model_request_id TEXT REFERENCES model_requests(id),
 sequence_number INTEGER NOT NULL CHECK(sequence_number>0), source TEXT NOT NULL CHECK(source IN ('browser','server','provider')),
 event_type TEXT NOT NULL, provider_event_id TEXT, deduplication_key TEXT NOT NULL UNIQUE,
 occurred_at INTEGER, received_at INTEGER NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 UNIQUE(conversation_id,sequence_number)
);
CREATE INDEX IF NOT EXISTS events_request ON events(model_request_id,sequence_number);
CREATE TABLE IF NOT EXISTS media_assets (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), message_id TEXT REFERENCES messages(id),
 direction TEXT NOT NULL CHECK(direction IN ('input','output')), sequence_number INTEGER NOT NULL, object_key TEXT NOT NULL UNIQUE,
 mime_type TEXT NOT NULL, codec TEXT NOT NULL, sample_rate_hz INTEGER CHECK(sample_rate_hz>0), duration_ms INTEGER CHECK(duration_ms>=0),
 byte_length INTEGER NOT NULL CHECK(byte_length>=0), sha256 TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','stored','failed','deleted')), created_at INTEGER NOT NULL, retain_until INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_records (
 id TEXT PRIMARY KEY, model_request_id TEXT NOT NULL REFERENCES model_requests(id), provider_usage_id TEXT, deduplication_key TEXT NOT NULL UNIQUE,
 usage_basis TEXT NOT NULL CHECK(usage_basis IN ('incremental','cumulative')),
 raw_usage_json TEXT NOT NULL CHECK(json_valid(raw_usage_json)), normalized_usage_json TEXT NOT NULL CHECK(json_valid(normalized_usage_json)),
 pricing_snapshot_json TEXT NOT NULL CHECK(json_valid(pricing_snapshot_json)), cost_usd_micros INTEGER NOT NULL CHECK(cost_usd_micros>=0),
 record_type TEXT NOT NULL CHECK(record_type IN ('estimate','reported','reconciled')), supersedes_id TEXT REFERENCES usage_records(id), recorded_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS quota_buckets (
 id TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK(scope IN ('experiment','month','day','visitor','network','concurrency')),
 subject_key TEXT NOT NULL, metric TEXT NOT NULL CHECK(metric IN ('usd_micros','voice_ms','requests','connections')),
 window_start INTEGER NOT NULL, window_end INTEGER NOT NULL CHECK(window_end>window_start),
 limit_value INTEGER NOT NULL CHECK(limit_value>=0), used_value INTEGER NOT NULL DEFAULT 0 CHECK(used_value>=0),
 reserved_value INTEGER NOT NULL DEFAULT 0 CHECK(reserved_value>=0), updated_at INTEGER NOT NULL,
 CHECK(used_value+reserved_value<=limit_value), UNIQUE(scope,subject_key,metric,window_start)
);
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'Events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS usage_no_update BEFORE UPDATE ON usage_records BEGIN SELECT RAISE(ABORT,'Usage is append-only; append a correction'); END;
PRAGMA user_version = 1;
