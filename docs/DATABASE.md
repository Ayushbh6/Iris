# Database

Schema: `db/migrations/0001_initial.sql` (budget, conversations, audit) and `0002_records.sql` (messages left for the owner, indexes). Migrations run once each, in order, at Durable Object start; the applied version is kept in Durable Object storage (`schema-version`).

Exactly nine application tables:

1. visitors — anonymous browser identity, timestamps, expiry.
2. conversations — visitor ownership, mode, knowledge version, status (active / ended / incomplete), `retain_until`.
3. messages — ordered visitor and assistant text (`content_json` = `{text}`), status (complete / interrupted / incomplete / failed).
4. events — ordered, append-only timeline: screen events, views shown, connect offers, mode changes, errors, voice usage, end of conversation. Idempotent by `deduplication_key`.
5. model_requests — one row per voice session token and per text turn, with model, kind, status.
6. media_assets — **unused by design**: audio is never stored.
7. usage_records — tokens and cost per call (text: reported; voice: the worst-case reservation as an estimate). Append-only.
8. quota_buckets — limits and spend for the experiment, month, day, per visitor and per network.
9. leave_messages — name, email and text left through the form, status (new / read / archived), `retain_until`.

No API keys, authorization headers, tokens or audio belong in any row.

## Links between rows

Assistant messages point at the visitor message they answer (`parent_message_id`). A text turn's model call has `trigger_message_id`, and its tool-call events carry `message_id` and `model_request_id`. Voice turns are linked by order and time because the browser cannot know server ids. The owner viewer builds its inspector from these links.

## What is written

- Text: `/chat` saves the visitor's words before calling the model, then the answer, the views and links it produced, and any error or limit event.
- Voice: the browser reports finished turns and events to `/log` in batches (ownership checked, event names allow-listed, at most 500 messages and 1500 events per conversation). Hidden screen events from text mode are saved as events, not messages.
- One conversation spans voice and text; returning to voice reuses the id.
- `leave_messages` rows come from `/message`.

## Retention

`conversations.retain_until` is 90 days from start; `leave_messages.retain_until` is one year. A Durable Object alarm sweeps every six hours: expired conversations are deleted with their messages, events, model requests and usage; conversations idle for two hours are marked ended; expired messages, visitors without conversations, spent visitor and network buckets, and settled reservations older than a week are removed. The owner can delete a conversation or message at any time (`/admin/delete`) and download everything (`/admin/export`).

## Runtime layout

One SQLite-backed Durable Object (`PortfolioStore`) holds everything, so a message and its cost can share a transaction and foreign keys are easy to check. Separate per-conversation objects are deferred; the shared budget coordinator must stay authoritative if that split happens. Cloudflare's internal KV tables do not count as application tables. D1 was considered and not used (see docs/DECISIONS.md).

## Spending

Reservations use Durable Object KV, indexed by an idempotent operation key; reservation and bucket changes share `transactionSync`. Three monetary buckets (experiment, month, day) must exist or admission fails, and a visitor's own daily bucket is checked first. Settlement releases unused allowance; overages and conflicting duplicates throw. `AI_ENABLED` defaults to false and all limits to 0, so paid routes fail closed. See docs/SAFETY.md.

## Honest limits

Event and usage UPDATE statements are blocked by triggers; deletion by retention or on request is deliberate. Records are what the Worker and browser reported: a closed tab can lose the last seconds of a voice turn, and no hidden model reasoning or unreceived network output can be reconstructed.
