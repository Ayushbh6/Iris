# Safety runbook — spend limits and abuse protection

The goal: a stranger with no login cannot run up a bill. The design assumes someone will try, and bounds the damage regardless of who they are.

## The layers

| Layer | Enforcement |
| --- | --- |
| Global USD admission caps | $3/day, $60/month, $150 experiment; all paid work reserves first in one transactional Durable Object. |
| Visitor allowance | $0.60 per UTC day; valid invites raise it to $3, subject to the other caps. Voice and text share it. |
| Network allowance | $1.20 per UTC day across all visitor IDs on that network; fresh browser tokens cannot reset it. IPv6 addresses share a /64. |
| Rolling visitor limits | Four voice starts/hour (two/minute), 40 written turns/hour (six/minute), one active paid engine per visitor. |
| Rolling network limits | 24 voice starts/hour, 200 written turns/hour (30/minute), 24 token mints/hour. Broader than visitor limits for shared offices. |
| Front door | Native Cloudflare edge binding: 90 API attempts/minute/network. Before auth, the Durable Object also checks 600 attempts/hour/network and 6,000/hour globally, including invalid tokens. |
| Turnstile | Server verifies success, the configured hostname and `iris` action with an eight-second timeout. Only the published development test key relaxes hostname/action. |
| Identity | Signed 30-day token plus HttpOnly, Secure, SameSite=Lax cookie in production. Cookie/header renewal preserves visitor ID, quota and blocks. This is browser identity, not a person/account. |
| Invites | Signed invite identifier is an HMAC of the code. Every paid request rechecks it against current codes; removal immediately downgrades old tokens. Existing visitors can upgrade without replacing their ID. |
| Conversation | 150k tokens for text, preflighted before each bounded model round; voice five minutes maximum, server-enforced. Voice compression triggers at 12k tokens and targets 6k; outputs capped at 2,048 tokens. |
| Owner controls | Pause/block closes active voice sockets and aborts active text calls. Alerts at 50/80/100 percent remain content-free. |

**Accounting:** written rounds reserve from a conservative UTF-8 byte token bound plus maximum output before calling Google. Each completed round settles immediately, so a later tool failure cannot erase earlier usage. Disconnects, truncated streams, missing usage and ambiguous provider errors retain the full affected reservation. Definitive unbilled client/quota rejections refund that round. Reported cost is never clamped to the reserve: an unexpected overage is charged in full and pauses further paid work. Configured reductions apply to existing buckets immediately.

Voice traffic passes through `/live`; visitors never receive a Gemini credential or control its setup. The relay meters Google's per-generation usage, including reprocessed audio context, and keeps $0.072576 of session credit as an in-flight generation cushion. It closes when another generation would no longer fit, rejects unbounded text/seeds and audio uploads, and paces 16kHz PCM to real time. A clean end settles reported cost; unknown final usage retains the session reserve. An unused relay ticket expires after 60 seconds and refunds, since it never opened a provider connection.

These are admission and runtime controls, not a claim of an exact Google billing hard cap. Usage arrives after generation; a provider reporting more than the reserved bound is recorded and stops further work. Reservations survive uncertain crashes instead of being automatically refunded. A separate Google project budget is an optional additional backstop; its configuration has not been verified here.

## One-time setup before going live

The step-by-step order, including who does what, is in [docs/LAUNCH.md](LAUNCH.md). The safety-relevant parts:

1. **Secrets:** `npm run deploy:secrets` sets `GEMINI_API_KEY` (from your local `.env` file (or the original workspace’s `../.env`)), `TURNSTILE_SECRET` (you paste it, hidden), and generates `VISITOR_SECRET`, `ADMIN_TOKEN` (put on your clipboard, never printed), an invite code and an optional ntfy alert topic. It skips secrets that already exist; `-- --rotate NAME` replaces one.
2. **Turnstile:** Cloudflare dashboard, Turnstile, Add widget. Hostnames: `ayushbh.com`, `www.ayushbh.com` and the `workers.dev` address of the first deploy. Mode: Managed. The site key goes in `deploy.config.json` (public); the secret goes through step 1. Local development uses Cloudflare's published test keys automatically.
3. **Google budget:** consider a dedicated project budget as an additional backstop. The application does not read or verify billing-account settings; do not assume this exists from the runbook alone.
4. **Alerts:** install the ntfy app and subscribe to the topic the secrets script prints. You get a message at 50%, 80% and exhaustion of the daily cap, when the assistant is paused or resumed, and when someone leaves a message (without its content). Unset, alerts are skipped quietly.
5. **Caps** live in `worker/wrangler.prod.jsonc` (micro-USD): 3000000 a day, 60000000 a month, 150000000 ever; per visitor 600000 (about four voice sessions), invited 3000000. Change and run `npm run deploy`. Until the secrets exist the assistant fails closed.
6. **Edge limiter:** deployed automatically by the `API_RATE_LIMIT` binding in Wrangler; no dashboard rule is needed for this layer.
7. **Origins:** the site and API share one origin, which is always allowed. `ALLOWED_ORIGINS` only matters for other sites and is empty in production.

## Operating it

Replace `$URL` with the Worker address and `$ADMIN` with your admin token.

```sh
curl -H "Authorization: Bearer $ADMIN" $URL/admin/status          # spend, today's counts, paused?
curl -X POST -H "Authorization: Bearer $ADMIN" $URL/admin/pause    # kill switch: visitors see a friendly message
curl -X POST -H "Authorization: Bearer $ADMIN" $URL/admin/resume
curl -X POST -H "Authorization: Bearer $ADMIN" "$URL/admin/block?visitor=<32-hex id>"
curl -X POST -H "Authorization: Bearer $ADMIN" "$URL/admin/unblock?visitor=<32-hex id>"
```

The admin routes answer 404 to anyone without the token, so they are invisible. The easiest way to use them is the viewer at `/admin` on the site: paste the token, it is kept for that tab only. The visitor id shown there (first six characters) is the start of the `v` field inside the token payload; the full id is in the conversation's `visitor_id` (export or `/admin/conversations`).

Reading and housekeeping, also available as commands:

```sh
curl -H "Authorization: Bearer $ADMIN" "$URL/admin/conversations?limit=30"        # newest first; add &before=<started_at> to page
curl -H "Authorization: Bearer $ADMIN" "$URL/admin/conversation?id=<id>"          # messages, events, model calls, cost
curl -H "Authorization: Bearer $ADMIN" "$URL/admin/leave-messages"                # the inbox (add ?all=1 for archived)
curl -X POST -H "Authorization: Bearer $ADMIN" "$URL/admin/leave-messages?id=<id>&status=read"   # new | read | archived
curl -X POST -H "Authorization: Bearer $ADMIN" "$URL/admin/delete?kind=conversation&id=<id>"     # or kind=leave-message
curl -H "Authorization: Bearer $ADMIN" $URL/admin/export > backup.json            # everything readable, no secrets
```

Back up with `export` now and then; records are stored in one Durable Object, so it is the portable copy.

**Invite links:** share `https://ayushbh.com/?invite=<code>` with a recruiter. The code upgrades the existing visitor token. It is rechecked on every paid request. Remove a code from `INVITE_CODES` to revoke the upgrade immediately; the ordinary limit then applies to the same visitor and existing spend.

**If the bill alert fires:** pause, look at `/admin/status`, block the visitor if one stands out, lower `DAILY_LIMIT_USD_MICROS`, resume.

## Identity limits

A determined visitor can clear both cookie and local storage and solve another Turnstile check. The network dollar/rate limits remain. A VPN or another network can change that grouping; without login there is no reliable way to identify one human across all devices. Shared networks also share the network allowance. None of these identities bypasses the global spending reservations.

The origin check is browser courtesy; Turnstile and signed tokens/tickets gate paid work. Text pricing follows Google's published January 2027 change automatically. Current price sources: [Gemini pricing](https://ai.google.dev/gemini-api/docs/latest-model), [Live usage](https://ai.google.dev/api/live), [Cloudflare rate binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

## Verification

`npm run worker:test` covers the previous runtime checks plus full overage accounting, partial tool failures, missing usage, concurrent requests, renewal and invite revocation, token-reset network budgets, refused-request storage, UTF-8 byte limits, invalid-auth bursts, Turnstile hostname/action, one-use relay tickets, live metering/pacing, active pause/block and server deadlines. `npm test` covers pricing rollover and rolling-window boundaries. `npm run live:test` verifies real Gemini voice, microphone input, UI tools, resume memory, text and Iris' identity against an isolated local Worker.
