# Implementation decisions — 20 September 2026

User authorized local implementation and an eight-table database scaffold. No deployment or purchase authorized. Port 3000 must remain untouched; website uses 3107, Worker uses 8787.

Visual thesis: a warm editorial portfolio with restrained violet, original Vienna imagery and a full-screen conversational canvas.
Content plan: image-led hero; three selected projects; selected professional experience; personal background; contact and original CV.
Interaction thesis: entrance sequence; tactile project hover; full-canvas transition; reduced-motion alternative.

Typography: self-hosted Newsreader roman/italic and Manrope. No premium commercial font license purchased. Styles use plain CSS tokens rather than Tailwind, and CSS transitions rather than Motion: this initial interface does not need those additional dependencies.

Original design images remain untouched in design-references. Public asset copies and the AI CV are local only. The broader job-search workspace is not imported as public agent knowledge. Earlier publication exclusions for AI by DNA/ALIGNIA remain respected in selected website case studies.

Voice remains the primary CTA. Visitors will not need accounts. This build exposes honest offline states rather than fake AI responses. Live voice/text needs configuration and the enforcement work listed in DATABASE.md. No ongoing provider cost is possible from this preview.

Validation: production static build, TypeScript frontend/Worker, four budget unit tests, SQLite schema/constraints, and Miniflare runtime migration/replay/ownership/idempotency/offline endpoints. Desktop 1440x1000 and mobile 390x844 inspected with Playwright. These checks do not validate real voice latency, audio capture, provider billing, live cap enforcement, or a full accessibility audit.

# Phase 2 decisions — 1 October 2026

Agent runs on Gemini Live (`gemini-3.8-live`, base model for latency; extended thinking rejected for speaking delays). The Interactions API does not support real-time audio. One Live session handles voice and typed text.

Generative UI is a single `render` tool composing validated blocks, not model-written code: faster speech, no injection surface, consistent design. `lookup` was dropped: the knowledge (~4k tokens) fits in the locked system instruction and avoids a mid-speech round trip. `connect` handles CV and contact.

Tools are NON_BLOCKING with SILENT success responses; this removed duplicate spoken confirmations. The prompt asks for one short sentence before large views; job-fit first audio fell from 4.4 s to about 1.2 s.

Ephemeral tokens lock model, prompt and tools; a client-supplied system prompt was verified to be ignored. Tokens are single-use.

Budget: each session reserves `SESSION_RESERVE_USD_MICROS` (default 0.40 USD) and settles it in full as an estimate. Live sessions measured 0.007–0.06 USD, so this is deliberately conservative until real usage reconciliation exists.

Live validation, 1 October 2026 (`npm run live:test`): 25/25 checks over five real sessions — multi-turn render/connect, job-description fit with honest gaps, visa/salary/phone deflection, prompt-injection and off-topic refusal, TU Wien only when asked, spoken audio input, prompt lock and single use. Median first audio 762 ms, max 1.7 s; run cost 0.11 USD. Not validated: browser audio capture/playback, interruption handling in a real UI, mobile networks, public traffic.

# Phase 3 decisions — 2 October 2026

The canvas starts a conversation on Talk / Chat and keeps the curated browse as the fallback. The browser connects straight to Gemini with the single-use token; the Worker only issues tokens.

Tool scheduling revised: both tools now return WHEN_IDLE with a short instruction, so the model always speaks after a view or link appears. Silent acknowledgement left the agent mute after render and after a CV request. Prompt order for visual answers: one short lead-in, render, then 2-3 spoken sentences. A "speak and render in parallel" prompt was tried and rejected: it produced silent turns and skipped fit tables.

Job-description fit tables are mandatory in the prompt (verified).

Browser verification (1-2 October 2026, built-in browser, real Gemini): text chat renders timeline and project views; voice via a recorded question injected into the microphone path was transcribed, answered aloud (68 audio chunks scheduled) with the view composed; budget-exhausted and error states display friendly messages; desktop, tablet and 375 px layouts inspected. Final live suite: 25/25, median first audio 0.84 s, run cost about 0.12 USD.

Not verified: a real microphone with room echo, Safari/iOS audio, interruption by a human voice, long sessions, public traffic.

Dev note: `npm run worker:dev:live` caps local spend (0.15 USD reservation per session, 3 USD/day). Stop it before `npm run live:test`, which starts its own Worker on the same port.

# Conversation screen redesign — 2 October 2026

Replaced the old project-browser canvas with an app-style conversation screen after user testing: the old screen mixed a stored project browser with the live chat and its X/Back buttons threw the visitor to the landing page. New design: fixed header/footer, scrolling stage, collapsible sidebar, orb as the resting state, views take over the stage.

Decisions from the user: voice Kore with the pronunciation hint; no conversation history (a one-off tool for recruiters, no login, no storage); sidebar items open stored pages and notify the assistant; soft violet/pink/lavender orb; phone sidebar is a slide-in drawer.

Verified 2 October 2026: live suite 30/30 (median first audio 0.89 s, run cost about 0.16 USD), including the page-click comment (41 words, no re-render, offers the build story). Browser: text conversation, Socrates click with spoken comment, Close back to the orb, Home, 375 px drawer and layout. Not re-verified in the browser after the redesign: voice via microphone (audio code unchanged, covered by the earlier injected-mic test).

# Text engine, mode switching and polish — 2 October 2026

User testing showed "Type instead" still used the voice model. Decision: voice uses Gemini 3.8 Live, text uses Gemini 3.8 Flash (Interactions API) through the Worker, one shared thread in the browser. Routing is by mode, not by message, so two engines never run at once. Typing while talking pauses voice; a mic button resumes it with the thread seeded into a new Live session (`sendClientContent`; verified the model remembers earlier typed and spoken turns).

Text cannot use browser-direct tokens, so `/chat` is a Worker endpoint with the same budget, origin and rate controls as `/session`, plus a per-conversation token cap (150k, from Google's reported usage; about 30 turns). Tools run inside the Worker: `executeToolCall` is a pure validator shared with the browser. The text prompt asks for the answer first, then `render`, so one model round suffices (about 4.3k tokens per turn, median 1.7 s); a call without text triggers a second round.

Findings that shaped the build: Flash has no "minimal" thinking level ("low" is the floor); the SDK's streaming for Interactions delivers events in a burst, so the Worker calls the REST endpoint and parses SSE itself; stateless history uses the steps format (`user_input` / `model_output`); the text model read the voice pronunciation hint aloud as "AH-yoosh", hence separate voice and text prompts. Pricing for Flash: 0.75 / 3.75 USD per million tokens until 31 Dec 2026, doubling from 1 Jan 2027.

Layout decisions from the user: base layer (orb or thread) plus views sliding over it, with chips to reopen; soft 6 px corners everywhere; token cap rather than message cap. Message text is not stored yet; usage and cost are.

Verified: live suite 50/50 (voice and text, policy and injection probes, explore click, resume-voice recall; median first audio 0.87 s; text 12 turns used 53k tokens), Worker tests with a mocked Interactions endpoint (validation, streaming, history rebuild, token cap, tool loop, provider failure), browser checks of text chat, view overlay and chip, text to voice to text with recall, the token-limit screen, and the 375 px layout. Not verified: a real microphone, Safari/iOS.

# Phase 4 — spend safety without a login — 2 October 2026

Decision: no login. Friction would cost recruiters; the protection that matters is a hard cap nobody can bypass, with identity layers only deciding who gets to spend it. Domain chosen: ayushbh.com (Cloudflare Registrar); until it is registered the Worker runs on a free workers.dev address and moving is configuration only (`ALLOWED_ORIGINS`, `NEXT_PUBLIC_AGENT_URL`, the Turnstile hostname).

Design: visitor identity is a Turnstile-gated, HMAC-signed token in localStorage (not a cookie). Cookies would be cross-site while the site and Worker sit on different origins and cannot be tested on plain-http localhost; the token has the same strength here, because its job is to make each new identity cost a Turnstile solve plus a per-network mint limit, not to be unforgeable identity. Per-visitor allowance is in USD (voice and text share it) so one number bounds one person. The origin check was kept only as a courtesy for browsers.

Behaviour choices: IPv6 rate limits use the /64 so address rotation inside a home or mobile allocation does not help; invite codes are verified server-side with a constant-time compare at token issue and carried as a signed claim; conversations are owned by the visitor who started them; the kill switch is a stored flag so it works instantly without a deploy; alerts are optional and quiet when unconfigured; admin routes return 404 without the token. Voice session reservation lowered to 0.15 USD (measured sessions cost 0.007–0.06; worst-case five minutes is under 0.15) so one visitor allowance of 0.60 USD covers about four sessions.

Recommended production caps: 3 USD/day, 60 USD/month, 150 USD ever, plus a Google AI Studio project cap of 60 USD/month as an independent backstop (Google enforces with about a ten-minute delay).

Verified: Worker tests (forgery, expiry, per-visitor and per-network limits, IPv6 grouping, invites, ownership, kill switch, block, owner endpoints, alerts), live suite against the real local Worker and Cloudflare's test Turnstile endpoint, and a browser run with Cloudflare's real Turnstile script (token issued, invite recognised, kill switch message shown). One live-suite scenario (voice job-fit table) missed once in four runs: the Live model occasionally answers without rendering the table. Not verified: production Turnstile keys, a real alert delivery to a phone, Cloudflare WAF rule (dashboard-only), Google's cap behaviour.

# Phase 5 — records, inbox, owner viewer, retention — 2 October 2026

Decision: conversations are now saved, reversing the Phase 3 "no storage" line. The reason is the owner's: transcripts show what recruiters ask, where the assistant fails and what to improve. Visitors never see a history (no login), so this is a one-way log. The privacy page, the notice under the composer and the assistant's own policy all say so; the assistant must never call a chat private.

Storage: the existing SQLite Durable Object, not D1. The nine-table schema, ownership checks and budget transactions already live there, one transaction can cover a message and its cost, and there is no extra binding; D1 would add a second database to keep consistent for a few thousand rows. The cost is that records are not queryable from outside the Worker, which `/admin/export` and the viewer cover. Revisit if volume or analysis needs grow.

Nine tables: the original eight plus `leave_messages` (migration 0002, run by a versioned migrator keyed in Durable Object storage). `media_assets` stays empty by design: audio is never stored.

What is saved: text turns by the Worker (the visitor's words before the provider is called, so a failed answer still leaves the question; the answer afterwards, marked incomplete if the stream broke), voice transcripts and screen events by the browser through `/log` (batched, idempotent ids, event allow-list, 500 messages and 1500 events per conversation, 300 requests/hour/network). Screen events and shown views are `events`, merged with messages by time in the viewer. One conversation id spans voice and text: `/session` accepts the id to continue and `/chat` accepts a voice conversation's id.

Voice cost stays the worst-case reservation (browser-reported usage is untrusted); the browser's reported Live token counts are saved as an event for reference only.

Leave a message: validated form, visitor token required, 3 per visitor per day, 100 per day site-wide, 5 per hour per network, open while paused (it costs nothing). The alert to the owner's phone carries no name, email or text, because webhook topics are not private. A plain email link is the fallback if anything fails.

Retention: conversations 90 days, messages for Ayush one year, swept every six hours by a Durable Object alarm, which also marks conversations nobody closed as ended and prunes spent rate-limit buckets and old reservations. Deletion on request: `/admin/delete`.

Owner viewer: a noindex page at `/admin` that takes the admin token by paste (kept in sessionStorage only). Not a login system; the token is the lock, and the routes return 404 without it.

Also fixed: the stage connect card was shifted off screen because the rise-in animation overrode its `translateX(-50%)`; it is now centred with margins.

Verified: Worker tests (text and voice turns in order, idempotent retries, forged logs, caps, one thread across engines, leave-message limits and content-free alerts, owner viewer, delete, retention sweep at +3 h/+91 d/+366 d), live suite 40/40 on scenarios 1 and 7 (12 real text turns saved identically to what the visitor saw, events, per-call cost, message and inbox), and a browser run (text chat, form sent, admin inbox, conversation replay, status). Not verified: the voice logging path in a real browser (needs a microphone; covered by Worker tests of `/log` and typechecks), Safari/iOS, a real alert delivery.

Live suite, full run: 62/63. The one miss was "no render validation errors left uncorrected" in the voice scenario (the Live model sent invalid `render` arguments and did not retry); two reruns of that scenario passed 16/16. Same family as the occasional skipped fit table: the Live model is not fully deterministic. The Phase 5 code does not touch voice tool handling.

# Phase 6 — shipping on Cloudflare — 2 October 2026

Decision: one Worker serves both the static export (Workers Static Assets) and the API, instead of a Pages site plus an API on a subdomain. Same origin means no CORS, one Turnstile hostname, one custom domain, and the visitor token and admin page work with no cross-site settings. `run_worker_first` lists only API paths (`/admin/*` except the `/admin/` page), so page views never wake the Worker and the 100k requests/day free allowance only counts API calls. A request from the Worker's own origin is always allowed; `ALLOWED_ORIGINS` is for other sites only.

The production config is a separate file (`worker/wrangler.prod.jsonc`) so a plain local run can never inherit `AI_ENABLED=true`. The production build bakes in an empty agent address (same origin) and the real Turnstile site key; `deploy` refuses a missing or test key. Production caps are the agreed ones: 3 USD/day, 60 USD/month, 150 USD ever. Until the secrets are set the Worker fails closed. The first deploy uses a free `workers.dev` address because custom domains need the domain's DNS on Cloudflare; routes are a commented block to enable after registration.

Hardening added: CSP (verified in a real browser: Turnstile, chat, an AudioWorklet from a blob and a Google WebSocket are allowed, an unlisted host is blocked), frame denial, nosniff, referrer policy, microphone limited to the site, `nosniff` on API JSON, year-long immutable caching for hashed assets.

Secrets are handled by `deploy:secrets` run in the owner's terminal: the Gemini key is read from `../.env` without printing, random secrets are generated locally, the Turnstile secret is typed hidden, and the admin token goes to the clipboard, not the screen.

Verified: 15 worker test groups including hosting (www redirect, same-origin allowed, foreign origin refused); `npm run rehearse` (production build and Worker config on one port, 14/14 smoke checks); a browser run of the rehearsal (Turnstile, visitor token, real text chat, CSP violations none, CSP actually blocks an unlisted host); `wrangler deploy --dry-run` validates the config, bindings and 69 assets. Not verified: a real deploy (needs the owner's Cloudflare login), Turnstile with a production key, custom-domain routing, real alert delivery, voice on a real microphone and Safari/iOS.

# Iris, language and owner viewer v2 — 2 October 2026

The assistant is named **Iris** (violet flower, the messenger who speaks for someone). Personality: warm, dry-witted, precise, quietly proud and never salesy; it says plainly it is an AI assistant for Ayush when asked. Same identity block in the voice and text prompts, so both engines sound alike; the UI and privacy page use the name.

Language: the first greeting is always English; after that the assistant answers in whatever language the visitor uses and switches when they do, including the text of any view it composes. Names, project names and technical terms stay as they are. Verified live: German written answer with a German timeline view, and a spoken German question through the Live API answered in German then back to English on request. Fit-table strength labels and the fixed UI chrome stay English.

Records are now linked, not just time-ordered: an assistant message points at the visitor message it answers (`parent_message_id`), a text turn's model call points at its trigger message (`trigger_message_id`), and tool-call events carry the answering message and model call (`message_id`, `model_request_id`). The model call now keeps latency, time to first words, tokens, tool calls, history size and token budget. Voice turns are linked by order and time window (the browser cannot know server ids).

Owner viewer v2 (same data, no new tables): Overview with charts (conversations by voice/text, visitors, messages, counted spend per day, time of day in the owner's timezone, most shown views) and tiles (engaged share, job descriptions pasted, views shown, messages left); Visitors tab and a per-visitor conversation filter with block/unblock; a conversation inspector (transcript plus full metadata for any message, tool call or model call, voice usage estimated from browser-reported tokens, raw JSON). Charts are small hand-written SVG, no library. "Who" stays an anonymous visitor ID by design.

Known: voice spend is counted at the worst-case reservation, so counted spend overstates voice; the inspector shows the browser-reported estimate beside it.

Verified: Worker tests for linking, visitor scoping, visitor list and stats; live suite scenario 9 (English greeting with the name, spoken German answered in German, back to English); browser run of every viewer screen against real data.

# Rate-limit and transport repair — 3 October 2026

Voice now uses a server WebSocket relay with one-use local tickets. Model setup and tool responses remain server-owned; deadline, paced audio, usage budget and pause/block can terminate active sessions. Compression is 12k/6k and maximum output is 2,048 tokens. Written calls reserve before every bounded model round, preserve completed usage through failures, count unknown usage conservatively and pause on an overage instead of clamping it.

Anonymous renewal preserves browser identity through an essential HttpOnly cookie. Each paid request revalidates the invite code; network daily dollars cover fresh tokens. Rolling limits and bursts exist per visitor and network, with edge and global attempt limits before authentication. Broader network request limits allow multiple visitors in a shared office. Rejected requests create no conversation records. Native SVG arrows replace emoji-prone characters in Chat instead and footer GitHub/CV links.

Verified and deployed 3 October 2026: frontend/Worker typechecks, 21/21 unit checks, unchanged nine-table schema, Worker regression suite, and 37/37 real Gemini checks (voice fit tools, text and records, project-click comments, resume memory, Iris greeting and spoken language switching). Production version `a490c76f-73b5-40f2-8052-5efab68ca402` at `https://ayushbh.ayushbh.workers.dev/` passed 13/13 public smoke checks after edge headers propagated. Browser verification at 390 x 844 confirmed the three SVG arrows, no horizontal overflow, and the public text greeting introducing Iris. A physical iPhone microphone/Safari session and Google billing-account settings remain unverified.

# Public Iris repository and project stories — 3 October 2026

Published only the website application as `Ayushbh6/Iris`, with a standalone README, environment example and GitHub Actions checks. The parent Me workspace is not a Git repository. Local databases, generated output, credentials and design references are ignored. Local scripts now support an environment file inside a standalone clone while preserving the original workspace fallback.

Reviewed the public main branches of Socrates, DPA_Guru and SEC-Summariser; pinned evidence is in `docs/PROJECTS.md`. Curated project pages now include implementation details, source links and original interactive workflow illustrations. Landing previews and assistant project blocks reuse the artwork. The diagrams are labelled illustrations, not product screenshots. Iris's approved knowledge was updated from the same source review; SEC Summariser has three tools in code despite its old two-tool README.

Verified frontend/Worker typechecks, 21 unit checks, Worker regression suite, production build and 14 local smoke checks. Browser checks at 1440 x 1000 and 390 x 844 covered all three pages, step changes and no horizontal overflow. A real Gemini text conversation correctly described SEC Summariser's three tools and rendered their explanation. No source changes were made to the three reviewed repositories.
