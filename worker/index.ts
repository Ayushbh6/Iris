import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { buildSteps } from "../lib/agent/history.ts";
import {
  ChatProviderError,
  runChat,
  maxInputTokens,
  MAX_OUTPUT_TOKENS,
} from "./chat.ts";
import {
  hashNetwork,
  safeEqual,
  SECRET_OK,
  signVisitor,
  verifyTurnstile,
  verifyVisitor,
  newVisitorId,
  inviteId,
  type VisitorClaims,
} from "./visitor.ts";
import { bytes, textCost, textPricing } from "./accounting.ts";
import { takeLimit } from "./rate.ts";
import { relayLive, type LiveTicket } from "./live.ts";
import migration1 from "../db/migrations/0001_initial.sql";
import migration2 from "../db/migrations/0002_records.sql";
import {
  BROWSER_EVENTS,
  conversationOwnedBy,
  conversationRecord,
  deleteConversations,
  deleteLeaveMessage,
  exportAll,
  LEAVE_PER_SITE_PER_DAY,
  LEAVE_PER_VISITOR_PER_DAY,
  leaveCounts,
  listConversations,
  listLeaveMessages,
  listVisitors,
  saveLeaveMessage,
  setLeaveStatus,
  stats,
  sweep,
  writeEntries,
  type Entry,
} from "./records.ts";
import {
  buildLiveConfig,
  KNOWLEDGE_VERSION,
  LIVE_API_VERSION,
  LIVE_MODEL,
  PRICING_USD_PER_M,
  TEXT_MODEL,
} from "../lib/agent/config.ts";
interface Env {
  PORTFOLIO: DurableObjectNamespace<PortfolioStore>;
  API_RATE_LIMIT?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
  NETWORK_DAILY_USD_MICROS?: string;
  VISITOR_SESSIONS_PER_HOUR?: string;
  VISITOR_CHAT_REQUESTS_PER_HOUR?: string;
  VISITOR_SESSION_BURST?: string;
  VISITOR_CHAT_BURST?: string;
  TURNSTILE_HOSTNAMES?: string;
  AI_ENABLED: string;
  GEMINI_API_KEY?: string;
  EXPERIMENT_LIMIT_USD_MICROS: string;
  MONTHLY_LIMIT_USD_MICROS: string;
  DAILY_LIMIT_USD_MICROS: string;
  SESSION_RESERVE_USD_MICROS: string;
  SESSION_MAX_SECONDS: string;
  NETWORK_SESSIONS_PER_HOUR: string;
  CHAT_REQUESTS_PER_HOUR: string;
  CHAT_TOKEN_CAP: string;
  CHAT_RESERVE_USD_MICROS: string;
  ALLOWED_ORIGINS: string;
  // Production hosting: the same Worker serves the static site (ASSETS) and the API.
  ASSETS?: Fetcher;
  CANONICAL_HOST?: string; // e.g. ayushbh.com; www.<host> redirects here
  // Abuse protection. Secrets are set with `wrangler secret put`, never in config.
  TURNSTILE_SECRET?: string;
  VISITOR_SECRET?: string;
  ADMIN_TOKEN?: string;
  INVITE_CODES?: string; // comma-separated; a matching code raises a visitor's daily limit
  ALERT_WEBHOOK_URL?: string; // optional ntfy.sh-style endpoint for budget alerts
  VISITOR_DAILY_USD_MICROS: string;
  VISITOR_INVITED_DAILY_USD_MICROS: string;
  VISITOR_TOKENS_PER_HOUR: string; // new visitor tokens per network per hour
  VISITOR_TOKEN_DAYS: string;
  // Records (Phase 5).
  CONVERSATION_RETENTION_DAYS: string;
  MESSAGE_RETENTION_DAYS: string;
  LOG_REQUESTS_PER_HOUR: string;
  MESSAGE_REQUESTS_PER_HOUR: string;
}
// Applied in order, once each; the version lives in Durable Object storage.
const MIGRATIONS: [number, string][] = [
  [1, migration1],
  [2, migration2],
];
const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1][0];
const visitorRequest = z
  .object({
    turnstileToken: z.string().min(1).max(2048),
    invite: z.string().max(64).optional(),
  })
  .strict();
const chatRequest = z
  .object({
    conversationId: z.string().max(64).optional(),
    history: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          text: z.string().max(4000),
        }),
      )
      .max(60),
    message: z.string().trim().min(1).max(1500),
    hidden: z.boolean().optional(), // a screen event, not something the visitor typed
  })
  .strict();
const sessionRequest = z
  .object({ conversationId: z.string().max(64).optional() })
  .strict();
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/);
const logRequest = z
  .object({
    conversationId: z.string().max(64),
    entries: z
      .array(
        z.discriminatedUnion("type", [
          z
            .object({
              type: z.literal("message"),
              id,
              role: z.enum(["user", "assistant"]),
              text: z.string().max(8000),
              status: z.enum(["complete", "interrupted"]).optional(),
              at: z.number().optional(),
            })
            .strict(),
          z
            .object({
              type: z.literal("event"),
              key: id,
              name: z.enum(BROWSER_EVENTS),
              data: z.record(z.string(), z.unknown()).optional(),
              at: z.number().optional(),
            })
            .strict(),
        ]),
      )
      .max(30),
  })
  .strict();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const leaveRequest = z
  .object({
    conversationId: z.string().max(64).optional(),
    name: z.string().trim().min(1).max(80),
    email: z.string().trim().max(200).regex(emailPattern),
    message: z.string().trim().min(5).max(2000),
  })
  .strict();
const int = (value: string | undefined) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
};
const HOUR = 3600000,
  DAY = 86400000;
const json = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
export class PortfolioStore extends DurableObject<Env> {
  private active = new Map<
    string,
    { controller: AbortController; close?: () => void }
  >();
  private pending = new Map<string, LiveTicket>();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const done = ctx.storage.kv.get<number>("schema-version") ?? 0;
      for (const [version, statements] of MIGRATIONS)
        if (version > done) {
          ctx.storage.sql.exec(statements.replace(/PRAGMA[^;]+;/g, ""));
          ctx.storage.kv.put("schema-version", version);
        }
      for (const [key, ticket] of ctx.storage.kv.list<LiveTicket>({
        prefix: "live-ticket:",
      })) {
        this.pending.set(key.slice("live-ticket:".length), ticket);
        setTimeout(
          () => this.expireTickets(),
          Math.max(1, ticket.connectBy - Date.now() + 50),
        );
      }
      // The retention sweep runs about every six hours.
      if ((await ctx.storage.getAlarm()) === null)
        await ctx.storage.setAlarm(Date.now() + 60_000);
    });
  }
  async alarm() {
    this.sweep();
    this.expireTickets();
    for (const [key, times] of this.ctx.storage.kv.list<number[]>({
      prefix: "rate:",
    }))
      if (!times.length || times.at(-1)! < Date.now() - HOUR)
        this.ctx.storage.kv.delete(key);
    await this.ctx.storage.setAlarm(Date.now() + 6 * HOUR);
  }
  // Also an internal RPC so tests can run a sweep at a chosen time.
  sweep(now = Date.now()) {
    this.expireTickets(now);
    return sweep(this.ctx, now);
  }
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === "/health")
      return json({
        ok: true,
        schemaVersion: SCHEMA_VERSION,
        paidAI: this.env.AI_ENABLED === "true" && !!this.env.GEMINI_API_KEY,
        paused: !!this.ctx.storage.kv.get("paused"),
      });
    if (
      ["/visitor", "/session", "/chat", "/live", "/log", "/message"].includes(
        url.pathname,
      )
    ) {
      try {
        // Attempts count before token validation, including malformed auth.
        this.takeNetworkAllowance("front:global", 6000, 600);
        this.takeNetworkAllowance(
          `front:${request.headers.get("x-network-key")}`,
          600,
          90,
        );
      } catch {
        return json({ error: "RATE_LIMITED" }, 429, { "Retry-After": "60" });
      }
    }
    this.expireTickets();
    if (url.pathname === "/live" && request.method === "GET")
      return this.live(request);
    if (url.pathname === "/visitor" && request.method === "POST")
      return this.issueVisitor(request);
    if (url.pathname.startsWith("/admin/")) return this.admin(request, url);
    if (url.pathname === "/session" && request.method === "POST")
      return this.startSession(request);
    if (url.pathname === "/log" && request.method === "POST")
      return this.log(request);
    if (url.pathname === "/message" && request.method === "POST")
      return this.leaveMessage(request);
    if (url.pathname === "/chat" && request.method === "POST")
      return this.chat(request);
    return json({ error: "NOT_FOUND" }, 404);
  }
  private expireTickets(now = Date.now()) {
    // Tickets are NOT provider credentials. Unused tickets may be released
    // safely because no provider connection has been made.
    for (const [token, ticket] of this.pending) {
      if (ticket.connectBy > now) continue;
      this.pending.delete(token);
      this.ctx.storage.kv.delete(`live-ticket:${token}`);
      void this.settle(ticket.operationKey, 0);
    }
  }
  private async startSession(request: Request) {
    if (this.env.AI_ENABLED !== "true" || !this.env.GEMINI_API_KEY)
      return json({ error: "AI_DISABLED" }, 503);
    const gate = await this.gate(request);
    if (gate instanceof Response) return gate;
    const { claims, network } = gate;
    let attach = "";
    try {
      const text = await request.text();
      if (text)
        attach = sessionRequest.parse(JSON.parse(text)).conversationId ?? "";
    } catch {
      return json({ error: "BAD_REQUEST" }, 400);
    }
    if (this.active.has(claims.v))
      return json({ error: "REQUEST_IN_PROGRESS" }, 429);
    const amount = int(this.env.SESSION_RESERVE_USD_MICROS);
    const maxSeconds = Math.min(int(this.env.SESSION_MAX_SECONDS), 300);
    if (!amount || !maxSeconds) return json({ error: "AI_DISABLED" }, 503);
    try {
      this.takeNetworkAllowance(`voice:${network}`);
      this.takeNetworkAllowance(
        `voice-visitor:${claims.v}`,
        int(this.env.VISITOR_SESSIONS_PER_HOUR ?? "4"),
        int(this.env.VISITOR_SESSION_BURST) || 2,
      );
    } catch {
      return json({ error: "RATE_LIMITED" }, 429, { "Retry-After": "60" });
    }
    const operationKey = `session:${crypto.randomUUID()}`;
    try {
      this.provisionBudget();
      await this.reserve(
        operationKey,
        amount,
        this.visitorLimit(claims),
        network,
      );
    } catch (error) {
      return this.refuse(error);
    }
    // Conversation rows are only created after a reservation succeeds.
    const conversation =
      attach && conversationOwnedBy(this.ctx, attach, claims.v)
        ? { id: attach }
        : await this.createConversation(claims.v, "voice", {
            knowledgeVersion: KNOWLEDGE_VERSION,
          });
    const token =
      crypto.randomUUID().replaceAll("-", "") +
      crypto.randomUUID().replaceAll("-", "");
    const ticket: LiveTicket = {
      token,
      operationKey,
      amount,
      visitorId: claims.v,
      network,
      conversationId: conversation.id,
      createdAt: Date.now(),
      connectBy: Date.now() + 60_000,
      expiresAt: Date.now() + maxSeconds * 1000,
    };
    this.pending.set(token, ticket);
    this.ctx.storage.kv.put(`live-ticket:${token}`, ticket);
    // Avoid forgotten holds after an ordinary failed microphone/connect attempt.
    setTimeout(() => this.expireTickets(), 60_050);
    return json({
      token,
      model: LIVE_MODEL,
      apiVersion: LIVE_API_VERSION,
      conversationId: conversation.id,
      expiresAt: ticket.expiresAt,
      knowledgeVersion: KNOWLEDGE_VERSION,
    });
  }
  private async live(request: Request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return json({ error: "WEBSOCKET_REQUIRED" }, 426);
    const token = request.headers.get("x-live-ticket") ?? "";
    const ticket = this.pending.get(token);
    if (
      !ticket ||
      ticket.connectBy <= Date.now() ||
      ticket.network !== request.headers.get("x-network-key")
    )
      return json({ error: "INVALID_TICKET" }, 401);
    // Consume synchronously, before any await: no ticket can open two sockets.
    this.pending.delete(token);
    this.ctx.storage.kv.delete(`live-ticket:${token}`);
    if (
      this.ctx.storage.kv.get("paused") ||
      this.ctx.storage.kv.get(`blocked:${ticket.visitorId}`) ||
      this.env.AI_ENABLED !== "true"
    ) {
      await this.settle(ticket.operationKey, 0);
      return json({ error: "PAUSED" }, 503);
    }
    if (this.active.has(ticket.visitorId)) {
      await this.settle(ticket.operationKey, 0);
      return json({ error: "REQUEST_IN_PROGRESS" }, 429);
    }
    const controller = new AbortController();
    this.active.set(ticket.visitorId, { controller });
    return relayLive(request, this.env.GEMINI_API_KEY!, ticket, {
      defer: (work) => this.ctx.waitUntil(work),
      register: (close) =>
        this.active.set(ticket.visitorId, { controller, close }),
      finish: async (actual, usage, uncertain, reason) => {
        try {
          await this.settle(ticket.operationKey, actual);
          this.recordLive(ticket, actual, usage, uncertain, reason);
          this.afterSpend();
        } catch (error) {
          this.ctx.storage.kv.put("paused", true);
          console.error("Live accounting failed; assistant paused");
          throw error;
        } finally {
          this.active.delete(ticket.visitorId);
        }
      },
    });
  }
  // One written turn on Gemini Flash, streamed back as server-sent events.
  // Order: network limit, conversation token cap, worst-case budget reservation,
  // then the provider. Usage is settled from the provider's own token counts.
  private async chat(request: Request) {
    if (this.env.AI_ENABLED !== "true" || !this.env.GEMINI_API_KEY)
      return json({ error: "AI_DISABLED" }, 503);
    const gate = await this.gate(request);
    if (gate instanceof Response) return gate;
    const { claims, network } = gate;
    const reserveAmount = int(this.env.CHAT_RESERVE_USD_MICROS);
    const cap = int(this.env.CHAT_TOKEN_CAP);
    const perHour = int(this.env.CHAT_REQUESTS_PER_HOUR);
    if (!reserveAmount || !cap || !perHour)
      return json({ error: "AI_DISABLED" }, 503);
    let body: z.infer<typeof chatRequest>;
    try {
      body = chatRequest.parse(await request.json());
    } catch {
      return json({ error: "BAD_REQUEST" }, 400);
    }
    try {
      this.takeNetworkAllowance(`chat:${network}`, perHour);
    } catch {
      return json({ error: "RATE_LIMITED" }, 429, { "Retry-After": "3600" });
    }
    try {
      this.takeNetworkAllowance(
        `chat-visitor:${claims.v}`,
        int(this.env.VISITOR_CHAT_REQUESTS_PER_HOUR ?? "40"),
        int(this.env.VISITOR_CHAT_BURST) || 6,
      );
    } catch {
      return json({ error: "RATE_LIMITED" }, 429, { "Retry-After": "60" });
    }
    if (this.active.has(claims.v))
      return json({ error: "REQUEST_IN_PROGRESS" }, 429, {
        "Retry-After": "2",
      });
    let conversationId = body.conversationId ?? "";
    if (
      conversationId &&
      !conversationOwnedBy(this.ctx, conversationId, claims.v)
    )
      conversationId = "";
    const tokens =
      this.ctx.storage.kv.get<number>(`chat-tokens:${conversationId}`) ?? 0;
    if (tokens >= cap)
      return json(
        {
          error: "CONVERSATION_LIMIT",
          conversationId,
          tokensUsed: tokens,
          tokenCap: cap,
        },
        429,
      );
    const steps = buildSteps(body.history, body.message);
    const firstBound = maxInputTokens(steps);
    if (tokens + firstBound + MAX_OUTPUT_TOKENS > cap)
      return json(
        {
          error: "CONVERSATION_LIMIT",
          conversationId,
          tokensUsed: tokens,
          tokenCap: cap,
        },
        429,
      );
    const firstReserve = textCost(firstBound, MAX_OUTPUT_TOKENS);
    if (firstReserve > reserveAmount) return json({ error: "TOO_LARGE" }, 413);
    const operationKey = `chat:${crypto.randomUUID()}`;
    const controller = new AbortController();
    this.active.set(claims.v, { controller }); // claim before awaiting reservation
    try {
      this.provisionBudget();
      await this.reserve(
        `${operationKey}:0`,
        firstReserve,
        this.visitorLimit(claims),
        network,
      );
      if (!conversationId)
        conversationId = (
          await this.createConversation(claims.v, "text", {
            knowledgeVersion: KNOWLEDGE_VERSION,
          })
        ).id;
    } catch (error) {
      this.active.delete(claims.v);
      return this.refuse(error);
    }
    // The visitor's words are saved before the provider is called, so a failed
    // answer still leaves a record of what was asked.
    const userMessageId = body.hidden ? null : crypto.randomUUID();
    this.record(
      conversationId,
      userMessageId
        ? [
            {
              type: "message",
              uuid: userMessageId,
              role: "user",
              text: body.message,
            },
          ]
        : [
            {
              type: "event",
              source: "browser",
              name: "screen.event",
              data: { text: body.message },
            },
          ],
    );
    const { readable, writable } = new TransformStream<Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const send = async (event: unknown) => {
      combinedSignal.throwIfAborted();
      let rejectAbort: () => void;
      const abort = new Promise<never>((_, reject) => {
        rejectAbort = () => reject(new Error("STREAM_ABORTED"));
        combinedSignal.addEventListener("abort", rejectAbort, { once: true });
      });
      try {
        await Promise.race([
          writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)),
          abort,
        ]);
      } finally {
        combinedSignal.removeEventListener("abort", rejectAbort!);
      }
    };
    const apiKey = this.env.GEMINI_API_KEY;
    const startedAt = Date.now();
    const combinedSignal = AbortSignal.any([
      request.signal,
      controller.signal,
      AbortSignal.timeout(90_000),
    ]);
    this.ctx.waitUntil(
      (async () => {
        let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
        let pending: { key: string; amount: number; maxTokens: number } | null =
          {
            key: `${operationKey}:0`,
            amount: firstReserve,
            maxTokens: firstBound + MAX_OUTPUT_TOKENS,
          };
        let cost = 0;
        let estimated = false;
        let failure = "";
        let answer = "";
        let firstTextMs: number | null = null;
        const calls: string[] = [];
        const shown: Entry[] = [];
        try {
          await send({ type: "start", conversationId });
          for await (const event of runChat(apiKey, steps, combinedSignal)) {
            if (event.type === "round-start") {
              const bound = event.maxInputTokens + MAX_OUTPUT_TOKENS;
              if (tokens + usage.totalTokens + bound > cap)
                throw new Error("CONVERSATION_LIMIT");
              const amount = textCost(
                event.maxInputTokens,
                MAX_OUTPUT_TOKENS,
                startedAt,
              );
              if (amount > reserveAmount) throw new Error("TOO_LARGE");
              const key = `${operationKey}:${event.round}`;
              if (event.round)
                await this.reserve(
                  key,
                  amount,
                  this.visitorLimit(claims),
                  network,
                );
              pending = { key, amount, maxTokens: bound };
            } else if (event.type === "round-rejected") {
              if (pending) await this.settle(pending.key, 0);
              pending = null;
            } else if (event.type === "usage") {
              usage.inputTokens += event.inputTokens;
              usage.outputTokens += event.outputTokens;
              usage.totalTokens += event.totalTokens;
              const actual = textCost(
                event.inputTokens,
                event.outputTokens,
                startedAt,
              );
              if (pending) await this.settle(pending.key, actual);
              cost += actual;
              pending = null;
              if (this.ctx.storage.kv.get("paused")) throw new Error("PAUSED");
            } else {
              if (event.type === "text") {
                answer += event.delta;
                firstTextMs ??= Date.now() - startedAt;
              } else if (event.effect.type === "render") {
                calls.push("render");
                shown.push({
                  type: "event",
                  source: "server",
                  name: "view.rendered",
                  data: event.effect.view,
                });
              } else {
                calls.push("connect");
                shown.push({
                  type: "event",
                  source: "server",
                  name: "connect.requested",
                  data: {
                    action: event.effect.action,
                    note: event.effect.note,
                  },
                });
              }
              await send(event);
            }
          }
        } catch (error) {
          console.error(
            "chat failed:",
            error instanceof Error ? error.stack : error,
          );
          const code = error instanceof Error ? error.message : "";
          failure = [
            "CONVERSATION_LIMIT",
            "VISITOR_LIMIT",
            "NETWORK_LIMIT",
            "PAUSED",
            "TOO_LARGE",
            "BUDGET_UNAVAILABLE",
          ].includes(code)
            ? code
            : error instanceof ChatProviderError
              ? "PROVIDER_ERROR"
              : "STREAM_ABORTED";
        }
        // An interrupted/ambiguous paid round retains its entire reserve. Already
        // completed rounds were settled immediately and cannot disappear on error.
        if (pending) {
          estimated = true;
          await this.settle(pending.key, pending.amount);
          cost += pending.amount;
          usage.totalTokens += pending.maxTokens;
        }
        const used =
          (this.ctx.storage.kv.get<number>(`chat-tokens:${conversationId}`) ??
            0) + usage.totalTokens;
        const requestId = crypto.randomUUID();
        let requestRecorded = false;
        try {
          this.afterSpend();
          this.ctx.storage.kv.put(`chat-tokens:${conversationId}`, used);
          this.recordChat({
            requestId,
            conversationId,
            triggerMessageId: userMessageId,
            operationKey,
            startedAt,
            usage,
            costMicros: cost,
            failure,
            details: {
              estimated,
              historyTurns: body.history.length,
              messageChars: body.message.length,
              hiddenEvent: !!body.hidden,
              firstTextMs,
              answerChars: answer.length,
              toolCalls: calls,
              tokenCap: cap,
              tokensBefore: tokens,
            },
          });
          requestRecorded = true;
        } catch (error) {
          this.ctx.storage.kv.put("paused", true);
          failure = "ACCOUNTING_ERROR";
          console.error("Accounting failed; assistant paused", String(error));
        }
        // Every row of this turn points at the model call that made it.
        const assistantId = crypto.randomUUID();
        const link = requestRecorded ? { modelRequestId: requestId } : {};
        const hasAnswer = !!answer.trim();
        this.record(conversationId, [
          ...(hasAnswer
            ? ([
                {
                  type: "message",
                  uuid: assistantId,
                  parent: userMessageId,
                  role: "assistant",
                  text: answer,
                  status: failure ? "incomplete" : "complete",
                },
              ] as Entry[])
            : []),
          ...shown.map((e) => ({
            ...e,
            ...link,
            ...(hasAnswer ? { messageId: assistantId } : {}),
          })),
          ...(failure
            ? ([
                {
                  type: "event",
                  source: "server",
                  name: "error",
                  data: { code: failure },
                  ...link,
                  ...(hasAnswer ? { messageId: assistantId } : {}),
                },
              ] as Entry[])
            : []),
          ...(used >= cap
            ? ([
                {
                  type: "event",
                  source: "server",
                  name: "limit.reached",
                  data: { tokensUsed: used, tokenCap: cap },
                  ...link,
                },
              ] as Entry[])
            : []),
        ]);
        try {
          if (failure) await send({ type: "error", code: failure });
          else
            await send({
              type: "done",
              conversationId,
              tokensUsed: used,
              tokenCap: cap,
            });
          await writer.close();
        } catch {}
        this.active.delete(claims.v);
      })().catch((error) => {
        this.ctx.storage.kv.put("paused", true);
        this.active.delete(claims.v);
        console.error("Accounting failed; assistant paused", String(error));
        void writer.abort(error);
      }),
    );
    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  }
  // Saving records must never break a conversation.
  private record(conversationId: string, entries: Entry[]) {
    if (!entries.length) return;
    try {
      writeEntries(this.ctx, conversationId, entries);
    } catch (error) {
      console.error(
        "record failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }
  // Voice turns and screen events arrive from the browser in small batches.
  private async log(request: Request) {
    const gate = await this.gate(request, true);
    if (gate instanceof Response) return gate;
    let body: z.infer<typeof logRequest>;
    try {
      body = logRequest.parse(await request.json());
    } catch {
      return json({ error: "BAD_REQUEST" }, 400);
    }
    try {
      this.takeNetworkAllowance(
        `log:${gate.network}`,
        int(this.env.LOG_REQUESTS_PER_HOUR),
      );
    } catch {
      return json({ error: "RATE_LIMITED" }, 429, { "Retry-After": "3600" });
    }
    if (!conversationOwnedBy(this.ctx, body.conversationId, gate.claims.v))
      return json({ error: "NOT_FOUND" }, 404);
    const entries: Entry[] = body.entries.map((e) =>
      e.type === "message" ? e : { ...e, source: "browser" as const },
    );
    return json({
      ok: true,
      ...writeEntries(this.ctx, body.conversationId, entries),
    });
  }
  // "Leave a message": stored for the owner, who is pinged without the content.
  private async leaveMessage(request: Request) {
    const gate = await this.gate(request, true);
    if (gate instanceof Response) return gate;
    let body: z.infer<typeof leaveRequest>;
    try {
      body = leaveRequest.parse(await request.json());
    } catch {
      return json({ error: "BAD_REQUEST" }, 400);
    }
    try {
      this.takeNetworkAllowance(
        `message:${gate.network}`,
        int(this.env.MESSAGE_REQUESTS_PER_HOUR),
      );
    } catch {
      return json({ error: "RATE_LIMITED" }, 429, { "Retry-After": "3600" });
    }
    const now = Date.now();
    const counts = leaveCounts(this.ctx, gate.claims.v, now);
    if (
      counts.visitor >= LEAVE_PER_VISITOR_PER_DAY ||
      counts.site >= LEAVE_PER_SITE_PER_DAY
    )
      return json({ error: "MESSAGE_LIMIT" }, 429);
    const conversationId =
      body.conversationId &&
      conversationOwnedBy(this.ctx, body.conversationId, gate.claims.v)
        ? body.conversationId
        : undefined;
    saveLeaveMessage(
      this.ctx,
      {
        visitorId: gate.claims.v,
        conversationId,
        name: body.name,
        email: body.email,
        body: body.message,
      },
      int(this.env.MESSAGE_RETENTION_DAYS) || 365,
      now,
    );
    if (conversationId)
      this.record(conversationId, [
        { type: "event", source: "server", name: "message.left" },
      ]);
    // The alert carries no name, address or text: webhook topics are not private.
    this.ctx.waitUntil(
      this.notify(
        "New message on ayushbh.com. Open the admin page to read it.",
      ),
    );
    return json({ ok: true });
  }
  private recordChat(r: {
    requestId: string;
    conversationId: string;
    triggerMessageId: string | null;
    operationKey: string;
    startedAt: number;
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
    costMicros: number;
    failure: string;
    details: Record<string, unknown>;
  }) {
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "INSERT INTO model_requests(id,conversation_id,trigger_message_id,provider,model,request_kind,request_payload_json,context_manifest_json,response_payload_json,status,operation_key,started_at,finished_at) VALUES (?,?,?,'google',?,'text_turn',?,?,?,?,?,?,?)",
        r.requestId,
        r.conversationId,
        r.triggerMessageId,
        TEXT_MODEL,
        JSON.stringify({
          stateless: true,
          store: false,
          historyTurns: r.details.historyTurns,
          messageChars: r.details.messageChars,
          hiddenEvent: r.details.hiddenEvent,
        }),
        JSON.stringify({
          knowledgeVersion: KNOWLEDGE_VERSION,
          tokensBefore: r.details.tokensBefore,
          tokenCap: r.details.tokenCap,
        }),
        JSON.stringify({
          failure: r.failure || null,
          firstTextMs: r.details.firstTextMs,
          answerChars: r.details.answerChars,
          toolCalls: r.details.toolCalls,
        }),
        r.failure ? "failed" : "complete",
        r.operationKey,
        r.startedAt,
        now,
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO usage_records(id,model_request_id,deduplication_key,usage_basis,raw_usage_json,normalized_usage_json,pricing_snapshot_json,cost_usd_micros,record_type,recorded_at) VALUES (?,?,?,'incremental',?,?,?,?,?,?)",
        crypto.randomUUID(),
        r.requestId,
        r.operationKey,
        JSON.stringify(r.usage),
        JSON.stringify(r.usage),
        JSON.stringify({
          model: TEXT_MODEL,
          usdPerMillion: textPricing(r.startedAt),
        }),
        r.costMicros,
        r.details.estimated ? "estimate" : "reported",
        now,
      );
    });
  }
  // Every paid route passes through here: network key, kill switch, then the
  // signed visitor token (and a manual block list).
  // Records and the contact form stay open while paused: they cost nothing.
  private async gate(
    request: Request,
    free = false,
  ): Promise<Response | { claims: VisitorClaims; network: string }> {
    const network = request.headers.get("x-network-key") || "";
    if (!/^[a-f0-9]{64}$/.test(network))
      return json({ error: "BAD_REQUEST" }, 400);
    if (!free && this.ctx.storage.kv.get("paused"))
      return json({ error: "PAUSED" }, 503);
    if (!SECRET_OK(this.env.VISITOR_SECRET))
      return json({ error: "AI_DISABLED" }, 503);
    const claims = await verifyVisitor(
      this.env.VISITOR_SECRET,
      (request.headers.get("x-auth") || "").replace(/^Bearer\s+/i, ""),
    );
    if (!claims) return json({ error: "VISITOR_REQUIRED" }, 401);
    if (this.ctx.storage.kv.get(`blocked:${claims.v}`))
      return json({ error: "VISITOR_BLOCKED" }, 403);
    let validInvite = false;
    if (claims.inviteId)
      for (const code of (this.env.INVITE_CODES ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean))
        if (
          await safeEqual(
            claims.inviteId,
            await inviteId(this.env.VISITOR_SECRET, code),
          )
        )
          validInvite = true;
    return { claims: { ...claims, inv: validInvite }, network };
  }
  private visitorLimit(claims: VisitorClaims) {
    return {
      id: claims.v,
      limit: int(
        claims.inv
          ? this.env.VISITOR_INVITED_DAILY_USD_MICROS
          : this.env.VISITOR_DAILY_USD_MICROS,
      ),
    };
  }
  private refuse(error: unknown) {
    if (
      error instanceof Error &&
      ["VISITOR_LIMIT", "NETWORK_LIMIT"].includes(error.message)
    )
      return json({ error: error.message }, 429);
    this.alertOnce(
      "exhausted",
      "The AI budget is used up. The assistant is refusing visitors until the cap resets.",
    );
    return json({ error: "BUDGET_EXHAUSTED" }, 503);
  }
  // Compares today's global spend with 50/80/100 percent of the daily cap.
  private afterSpend() {
    const now = Date.now();
    const row = this.ctx.storage.sql
      .exec<{ used_value: number; limit_value: number }>(
        "SELECT used_value,limit_value FROM quota_buckets WHERE scope='day' AND subject_key='global' AND metric='usd_micros' AND window_start=?",
        now - (now % DAY),
      )
      .toArray()[0];
    if (!row || !row.limit_value) return;
    const percent = (row.used_value / row.limit_value) * 100;
    const usd = (micros: number) => `$${(micros / 1e6).toFixed(2)}`;
    for (const threshold of [50, 80, 100])
      if (percent >= threshold)
        this.alertOnce(
          `day-${threshold}`,
          `AI spend today is at ${Math.round(percent)}% of the daily cap (${usd(row.used_value)} of ${usd(row.limit_value)}).`,
        );
  }
  private alertOnce(tag: string, message: string) {
    const now = Date.now();
    const key = `alert:${now - (now % DAY)}:${tag}`;
    if (this.ctx.storage.kv.get(key)) return;
    this.ctx.storage.kv.put(key, true);
    this.ctx.waitUntil(this.notify(message));
  }
  private async notify(message: string) {
    const url = this.env.ALERT_WEBHOOK_URL;
    if (!url) return;
    try {
      await fetch(url, {
        method: "POST",
        body: message,
        headers: { Title: "ayushbh.com assistant" },
      });
    } catch {}
  }
  // Turnstile proves a real browser; the reply is a signed token that stands in
  // for a login. Token minting is rate limited per network.
  private async issueVisitor(request: Request) {
    if (this.env.AI_ENABLED !== "true" || !this.env.GEMINI_API_KEY)
      return json({ error: "AI_DISABLED" }, 503);
    if (this.ctx.storage.kv.get("paused"))
      return json({ error: "PAUSED" }, 503);
    const secret = this.env.VISITOR_SECRET;
    const turnstile = this.env.TURNSTILE_SECRET;
    if (!SECRET_OK(secret) || !turnstile)
      return json({ error: "AI_DISABLED" }, 503);
    const network = request.headers.get("x-network-key") || "";
    if (!/^[a-f0-9]{64}$/.test(network))
      return json({ error: "BAD_REQUEST" }, 400);
    let body: z.infer<typeof visitorRequest>;
    try {
      body = visitorRequest.parse(await request.json());
    } catch {
      return json({ error: "BAD_REQUEST" }, 400);
    }
    try {
      this.takeNetworkAllowance(
        `visitor:${network}`,
        int(this.env.VISITOR_TOKENS_PER_HOUR),
      );
    } catch {
      return json({ error: "RATE_LIMITED" }, 429, { "Retry-After": "3600" });
    }
    const ok = await verifyTurnstile(
      turnstile,
      body.turnstileToken,
      request.headers.get("x-client-ip") || "",
      (this.env.TURNSTILE_HOSTNAMES || "local")
        .split(",")
        .map((h) => h.trim().toLowerCase()),
    );
    if (!ok) return json({ error: "TURNSTILE_FAILED" }, 403);
    const previous =
      (await verifyVisitor(secret, request.headers.get("x-visitor-cookie"))) ||
      (await verifyVisitor(
        secret,
        (request.headers.get("x-auth") || "").replace(/^Bearer\s+/i, ""),
      ));
    if (previous && this.ctx.storage.kv.get(`blocked:${previous.v}`))
      return json({ error: "VISITOR_BLOCKED" }, 403);
    let invited = false;
    let invitation: string | undefined;
    if (body.invite)
      for (const code of (this.env.INVITE_CODES || "").split(",")) {
        const clean = code.trim();
        // Compare against every code so timing does not reveal which one matched.
        if (clean && (await safeEqual(clean, body.invite))) {
          invited = true;
          invitation = await inviteId(secret, clean);
        }
      }
    const expiresAt =
      Date.now() + (int(this.env.VISITOR_TOKEN_DAYS) || 30) * DAY;
    const visitorToken = await signVisitor(secret, {
      v: previous?.v ?? newVisitorId(),
      inv: invited,
      exp: expiresAt,
      ...(invitation ? { inviteId: invitation } : {}),
    });
    return json({ visitorToken, expiresAt, invited }, 200, {
      "Set-Cookie": `iris_visitor=${visitorToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor((expiresAt - Date.now()) / 1000)}${request.headers.get("x-secure") === "true" ? "; Secure" : ""}`,
    });
  }
  // Owner controls, behind ADMIN_TOKEN. Unauthorised callers see a plain 404.
  private async admin(request: Request, url: URL) {
    const expected = this.env.ADMIN_TOKEN;
    const given = (request.headers.get("x-auth") || "").replace(
      /^Bearer\s+/i,
      "",
    );
    if (
      !expected ||
      expected.length < 24 ||
      !(await safeEqual(given, expected))
    ) {
      try {
        this.takeNetworkAllowance("front:global", 6000, 600);
        this.takeNetworkAllowance(
          `admin-invalid:${request.headers.get("x-network-key")}`,
          120,
          30,
        );
      } catch {
        return json({ error: "NOT_FOUND" }, 404);
      }
      return json({ error: "NOT_FOUND" }, 404);
    }
    const route = `${request.method} ${url.pathname}`;
    if (route === "POST /admin/pause") {
      this.ctx.storage.kv.put("paused", true);
      for (const { controller, close } of this.active.values()) {
        controller.abort();
        close?.();
      }
      this.ctx.waitUntil(this.notify("The assistant was paused."));
      return json({ paused: true });
    }
    if (route === "POST /admin/resume") {
      this.ctx.storage.kv.delete("paused");
      this.ctx.waitUntil(this.notify("The assistant was resumed."));
      return json({ paused: false });
    }
    if (route === "POST /admin/block" || route === "POST /admin/unblock") {
      const id = url.searchParams.get("visitor") || "";
      if (!/^[a-f0-9]{32}$/.test(id))
        return json({ error: "BAD_REQUEST" }, 400);
      if (route.endsWith("/block")) {
        this.ctx.storage.kv.put(`blocked:${id}`, true);
        this.active.get(id)?.controller.abort();
        this.active.get(id)?.close?.();
      } else this.ctx.storage.kv.delete(`blocked:${id}`);
      return json({ visitor: id, blocked: route.endsWith("/block") });
    }
    if (route === "GET /admin/status") return json(this.status());
    const ref = url.searchParams.get("id") || "";
    const validRef = /^[a-zA-Z0-9._-]{8,120}$/.test(ref);
    if (route === "GET /admin/visitors") {
      const limit = Math.min(
        Math.max(int(url.searchParams.get("limit") ?? "30"), 1),
        100,
      );
      const before =
        int(url.searchParams.get("before") ?? "") || Date.now() + 1;
      return json({
        visitors: listVisitors(this.ctx, limit, before).map((v) => ({
          ...v,
          blocked: !!this.ctx.storage.kv.get(`blocked:${v.visitor_id}`),
        })),
      });
    }
    if (route === "GET /admin/stats") {
      const days = Math.min(
        Math.max(int(url.searchParams.get("days") ?? "30"), 1),
        90,
      );
      return json(stats(this.ctx, days));
    }
    if (route === "GET /admin/conversations") {
      const limit = Math.min(
        Math.max(int(url.searchParams.get("limit") ?? "30"), 1),
        100,
      );
      const before =
        int(url.searchParams.get("before") ?? "") || Date.now() + 1;
      const visitor = url.searchParams.get("visitor") || undefined;
      if (visitor && !/^[a-zA-Z0-9_-]{8,100}$/.test(visitor))
        return json({ error: "BAD_REQUEST" }, 400);
      const rows = listConversations(this.ctx, limit, before, visitor);
      return json({ conversations: rows });
    }
    if (route === "GET /admin/conversation") {
      const record = validRef ? conversationRecord(this.ctx, ref) : null;
      return record ? json(record) : json({ error: "NOT_FOUND" }, 404);
    }
    if (route === "GET /admin/leave-messages")
      return json({
        messages: listLeaveMessages(
          this.ctx,
          url.searchParams.get("all") === "1",
        ),
      });
    if (route === "POST /admin/leave-messages") {
      const status = url.searchParams.get("status");
      if (
        !validRef ||
        (status !== "new" && status !== "read" && status !== "archived")
      )
        return json({ error: "BAD_REQUEST" }, 400);
      return setLeaveStatus(this.ctx, ref, status)
        ? json({ id: ref, status })
        : json({ error: "NOT_FOUND" }, 404);
    }
    if (route === "POST /admin/delete") {
      const kind = url.searchParams.get("kind");
      if (!validRef || (kind !== "conversation" && kind !== "leave-message"))
        return json({ error: "BAD_REQUEST" }, 400);
      const removed =
        kind === "conversation"
          ? !!conversationRecord(this.ctx, ref) &&
            !!deleteConversations(this.ctx, [ref])
          : deleteLeaveMessage(this.ctx, ref);
      return removed
        ? json({ deleted: ref })
        : json({ error: "NOT_FOUND" }, 404);
    }
    if (route === "GET /admin/export") return json(exportAll(this.ctx));
    return json({ error: "NOT_FOUND" }, 404);
  }
  private status() {
    this.provisionBudget(); // shows the configured limits even before the first spend
    const now = Date.now();
    const dayStart = now - (now % DAY);
    const sql = this.ctx.storage.sql;
    const one = <T extends Record<string, SqlStorageValue>>(
      q: string,
      ...a: unknown[]
    ) => sql.exec<T>(q, ...a).toArray()[0];
    const buckets = sql
      .exec<{
        scope: string;
        limit_value: number;
        used_value: number;
        reserved_value: number;
      }>(
        "SELECT scope,limit_value,used_value,reserved_value FROM quota_buckets WHERE scope IN ('experiment','month','day') AND metric='usd_micros' AND window_start<=? AND window_end>?",
        now,
        now,
      )
      .toArray();
    const usd = (micros: number) => Number((micros / 1e6).toFixed(4));
    return {
      paused: !!this.ctx.storage.kv.get("paused"),
      aiEnabled: this.env.AI_ENABLED === "true",
      budgets: Object.fromEntries(
        buckets.map((b) => [
          b.scope,
          {
            usedUsd: usd(b.used_value),
            reservedUsd: usd(b.reserved_value),
            limitUsd: usd(b.limit_value),
            percent: b.limit_value
              ? Math.round((b.used_value / b.limit_value) * 100)
              : null,
          },
        ]),
      ),
      today: {
        voiceSessions:
          one<{ n: number }>(
            "SELECT COUNT(*) n FROM model_requests WHERE request_kind IN ('live_session_token','live_session') AND started_at>=?",
            dayStart,
          )?.n ?? 0,
        textTurns:
          one<{ n: number }>(
            "SELECT COUNT(*) n FROM model_requests WHERE request_kind='text_turn' AND started_at>=?",
            dayStart,
          )?.n ?? 0,
        textTokens:
          one<{ n: number | null }>(
            "SELECT SUM(json_extract(normalized_usage_json,'$.totalTokens')) n FROM usage_records u JOIN model_requests r ON r.id=u.model_request_id WHERE r.request_kind='text_turn' AND r.started_at>=?",
            dayStart,
          )?.n ?? 0,
        conversations:
          one<{ n: number }>(
            "SELECT COUNT(*) n FROM conversations WHERE started_at>=?",
            dayStart,
          )?.n ?? 0,
        visitors:
          one<{ n: number }>(
            "SELECT COUNT(DISTINCT visitor_id) n FROM conversations WHERE started_at>=?",
            dayStart,
          )?.n ?? 0,
      },
    };
  }
  private takeNetworkAllowance(
    networkKey: string,
    limit = int(this.env.NETWORK_SESSIONS_PER_HOUR),
    burst = Math.max(2, Math.min(limit, 30)),
    now = Date.now(),
  ) {
    const key = `rate:${networkKey}`;
    const times = this.ctx.storage.kv.get<number[]>(key) ?? [];
    this.ctx.storage.kv.put(key, takeLimit(times, limit, burst, now));
  }
  // Creates the current experiment, month and day USD buckets from configuration.
  // A configured limit never drops below what is already used or reserved.
  private provisionBudget() {
    const now = Date.now(),
      date = new Date(now);
    const monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    const monthEnd = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    const dayStart = now - (now % DAY);
    const windows: [string, number, number, string][] = [
      [
        "experiment",
        0,
        Date.UTC(2100, 0, 1),
        this.env.EXPERIMENT_LIMIT_USD_MICROS,
      ],
      ["month", monthStart, monthEnd, this.env.MONTHLY_LIMIT_USD_MICROS],
      ["day", dayStart, dayStart + DAY, this.env.DAILY_LIMIT_USD_MICROS],
    ];
    this.ctx.storage.transactionSync(() => {
      for (const [scope, start, end, limit] of windows)
        this.ctx.storage.sql.exec(
          "INSERT INTO quota_buckets(id,scope,subject_key,metric,window_start,window_end,limit_value,updated_at) VALUES (?,?,'global','usd_micros',?,?,?,?) ON CONFLICT(scope,subject_key,metric,window_start) DO UPDATE SET limit_value=MAX(excluded.limit_value,used_value+reserved_value), updated_at=excluded.updated_at",
          crypto.randomUUID(),
          scope,
          start,
          end,
          int(limit),
          now,
        );
    });
  }
  private recordLive(
    ticket: LiveTicket,
    costMicros: number,
    usage: Record<string, any>[],
    uncertain: boolean,
    reason: string,
  ) {
    const requestId = crypto.randomUUID(),
      now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "INSERT INTO model_requests(id,conversation_id,provider,model,request_kind,request_payload_json,context_manifest_json,response_payload_json,status,operation_key,started_at,finished_at) VALUES (?,?,'google',?,'live_session',?,?,?, ?,?,?,?)",
        requestId,
        ticket.conversationId,
        LIVE_MODEL,
        JSON.stringify({ expiresAt: ticket.expiresAt, relay: true }),
        JSON.stringify({ knowledgeVersion: KNOWLEDGE_VERSION }),
        JSON.stringify({ reason }),
        uncertain ? "uncertain" : "complete",
        ticket.operationKey,
        ticket.createdAt,
        now,
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO usage_records(id,model_request_id,deduplication_key,usage_basis,raw_usage_json,normalized_usage_json,pricing_snapshot_json,cost_usd_micros,record_type,recorded_at) VALUES (?,?,?,'incremental',?,?,?, ?,?,?)",
        crypto.randomUUID(),
        requestId,
        ticket.operationKey,
        JSON.stringify(usage),
        JSON.stringify({ generations: usage.length, uncertain }),
        JSON.stringify({ model: LIVE_MODEL, usdPerMillion: PRICING_USD_PER_M }),
        costMicros,
        uncertain ? "estimate" : "reported",
        now,
      );
    });
  }
  // These RPC methods are never exposed by the public HTTP router.
  async createConversation(
    visitorId: string,
    mode: "voice" | "text",
    knowledge: unknown,
  ) {
    if (!/^[a-zA-Z0-9_-]{20,100}$/.test(visitorId))
      throw new Error("INVALID_VISITOR");
    const now = Date.now(),
      id = crypto.randomUUID();
    const retentionDays = int(this.env.CONVERSATION_RETENTION_DAYS) || 90;
    const retainUntil = now + retentionDays * DAY;
    return this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "INSERT INTO visitors(id,created_at,last_seen_at,expires_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at, expires_at=excluded.expires_at",
        visitorId,
        now,
        now,
        retainUntil,
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO conversations VALUES (?,?, 'active',?,'v1',?, ?,?,?,NULL,?)",
        id,
        visitorId,
        mode,
        JSON.stringify(knowledge),
        JSON.stringify({ audio: false, retentionDays }),
        now,
        now,
        retainUntil,
      );
      return { id, visitorId, mode };
    });
  }
  // Internal RPC (tests and tooling): the owner-checked record of one conversation.
  async replay(visitorId: string, id: string) {
    if (!conversationOwnedBy(this.ctx, id, visitorId))
      throw new Error("NOT_FOUND");
    return conversationRecord(this.ctx, id);
  }
  async recordFor(visitorId: string, conversationId: string, entries: Entry[]) {
    if (!conversationOwnedBy(this.ctx, conversationId, visitorId))
      throw new Error("NOT_FOUND");
    return writeEntries(this.ctx, conversationId, entries);
  }
  async settle(operationKey: string, actual: number) {
    const result = this.ctx.storage.transactionSync(() => {
      const key = `reservation:${operationKey}`;
      const held = this.ctx.storage.kv.get<{
        amount: number;
        state: string;
        bucketIds: string[];
        actual?: number;
        visitorId?: string;
      }>(key);
      if (!held) throw new Error("MISSING_RESERVATION");
      if (held.state === "settled") {
        if (held.actual !== actual) throw new Error("IDEMPOTENCY_CONFLICT");
        return held;
      }
      if (!Number.isSafeInteger(actual) || actual < 0)
        throw new Error("UNEXPECTED_PROVIDER_OVERAGE");
      if (actual > held.amount) this.ctx.storage.kv.put("paused", true);
      for (const id of held.bucketIds)
        this.ctx.storage.sql.exec(
          "UPDATE quota_buckets SET limit_value=MAX(limit_value,used_value+reserved_value-?+?),reserved_value=reserved_value-?,used_value=used_value+?,updated_at=? WHERE id=?",
          held.amount,
          actual,
          held.amount,
          actual,
          Date.now(),
          id,
        );
      const done = { ...held, state: "settled", actual };
      this.ctx.storage.kv.put(key, done);
      return done;
    });
    if (actual > result.amount) {
      for (const [id, active] of this.active) {
        if (id !== result.visitorId) active.controller.abort();
        active.close?.();
      }
      this.alertOnce(
        "overage",
        "A provider usage overage was recorded in full. The assistant paused automatically; inspect the owner status before resuming.",
      );
    }
    return result;
  }
  // Internal RPC only. Reservations survive disconnects; no expiry-based automatic release.
  async reserve(
    operationKey: string,
    amount: number,
    visitor?: { id: string; limit: number },
    network?: string,
  ) {
    if (this.env.AI_ENABLED !== "true") throw new Error("AI_DISABLED");
    if (this.ctx.storage.kv.get("paused")) throw new Error("PAUSED");
    if (!Number.isSafeInteger(amount) || amount <= 0)
      throw new Error("INVALID_AMOUNT");
    type Bucket = {
      id: string;
      limit_value: number;
      used_value: number;
      reserved_value: number;
    };
    return this.ctx.storage.transactionSync(() => {
      const key = `reservation:${operationKey}`;
      const existing = this.ctx.storage.kv.get<{
        amount: number;
        state: string;
      }>(key);
      if (existing) {
        if (existing.amount !== amount) throw new Error("IDEMPOTENCY_CONFLICT");
        return existing;
      }
      const now = Date.now();
      const fits = (b: Bucket) =>
        b.used_value + b.reserved_value + amount <= b.limit_value;
      const touched: Bucket[] = [];
      // A visitor's own daily allowance is checked first so the refusal says why.
      if (visitor) {
        const dayStart = now - (now % DAY);
        this.ctx.storage.sql.exec(
          "INSERT INTO quota_buckets(id,scope,subject_key,metric,window_start,window_end,limit_value,updated_at) VALUES (?,'visitor',?,'usd_micros',?,?,?,?) ON CONFLICT(scope,subject_key,metric,window_start) DO UPDATE SET limit_value=MAX(excluded.limit_value,used_value+reserved_value),updated_at=excluded.updated_at",
          crypto.randomUUID(),
          visitor.id,
          dayStart,
          dayStart + DAY,
          visitor.limit,
          now,
        );
        const own = this.ctx.storage.sql
          .exec<Bucket>(
            "SELECT * FROM quota_buckets WHERE scope='visitor' AND subject_key=? AND metric='usd_micros' AND window_start=?",
            visitor.id,
            dayStart,
          )
          .one();
        if (
          !fits(own) ||
          own.used_value + own.reserved_value + amount > visitor.limit
        )
          throw new Error("VISITOR_LIMIT");
        touched.push(own);
      }
      if (network) {
        const start = now - (now % DAY),
          limit = int(this.env.NETWORK_DAILY_USD_MICROS ?? "1200000");
        this.ctx.storage.sql.exec(
          "INSERT INTO quota_buckets(id,scope,subject_key,metric,window_start,window_end,limit_value,updated_at) VALUES (?,'network',?,'usd_micros',?,?,?,?) ON CONFLICT(scope,subject_key,metric,window_start) DO UPDATE SET limit_value=MAX(excluded.limit_value,used_value+reserved_value),updated_at=excluded.updated_at",
          crypto.randomUUID(),
          network,
          start,
          start + DAY,
          limit,
          now,
        );
        const own = this.ctx.storage.sql
          .exec<Bucket>(
            "SELECT * FROM quota_buckets WHERE scope='network' AND subject_key=? AND metric='usd_micros' AND window_start=?",
            network,
            start,
          )
          .one();
        if (!fits(own) || own.used_value + own.reserved_value + amount > limit)
          throw new Error("NETWORK_LIMIT");
        touched.push(own);
      }
      const global = this.ctx.storage.sql
        .exec<Bucket>(
          "SELECT * FROM quota_buckets WHERE scope IN ('experiment','month','day') AND metric='usd_micros' AND window_start<=? AND window_end>?",
          now,
          now,
        )
        .toArray();
      // All three independent limits must be provisioned; absent budget state fails closed.
      const limits = [
        int(this.env.EXPERIMENT_LIMIT_USD_MICROS),
        int(this.env.MONTHLY_LIMIT_USD_MICROS),
        int(this.env.DAILY_LIMIT_USD_MICROS),
      ];
      if (
        global.length !== 3 ||
        !global.every(fits) ||
        global.some(
          (b: Bucket & { scope?: string }) =>
            b.used_value + b.reserved_value + amount >
            limits[["experiment", "month", "day"].indexOf(b.scope ?? "")],
        )
      )
        throw new Error("BUDGET_UNAVAILABLE");
      touched.push(...global);
      for (const b of touched)
        this.ctx.storage.sql.exec(
          "UPDATE quota_buckets SET reserved_value=reserved_value+?, updated_at=? WHERE id=?",
          amount,
          now,
          b.id,
        );
      const reservation = {
        amount,
        state: "held",
        bucketIds: touched.map((b) => b.id),
        createdAt: now,
        visitorId: visitor?.id,
      };
      this.ctx.storage.kv.put(key, reservation);
      return reservation;
    });
  }
}
const BROWSER_ROUTES = ["/session", "/chat", "/visitor", "/log", "/message"];
const ADMIN_GETS = [
  "/admin/status",
  "/admin/conversations",
  "/admin/conversation",
  "/admin/visitors",
  "/admin/stats",
  "/admin/leave-messages",
  "/admin/export",
];
const ADMIN_POSTS = [
  "/admin/pause",
  "/admin/resume",
  "/admin/block",
  "/admin/unblock",
  "/admin/leave-messages",
  "/admin/delete",
];
const MAX_BODY: Record<string, number> = {
  "/chat": 100_000,
  "/visitor": 4_000,
  "/session": 1_000,
  "/log": 64_000,
  "/message": 6_000,
};

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const canonical = (env.CANONICAL_HOST || "").toLowerCase();
    if (canonical && url.hostname.toLowerCase() === `www.${canonical}`)
      return Response.redirect(
        `https://${canonical}${url.pathname}${url.search}`,
        301,
      );
    // The site itself: everything that is not an API route is a static file.
    const isApi =
      BROWSER_ROUTES.includes(url.pathname) ||
      url.pathname === "/live" ||
      url.pathname === "/health" ||
      (url.pathname.startsWith("/admin/") && url.pathname !== "/admin/");
    if (!isApi && env.ASSETS) return env.ASSETS.fetch(request);
    const origin = request.headers.get("Origin");
    const allowed = (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    // A page served by this Worker may always call it; others must be listed.
    const cors: Record<string, string> =
      origin && (origin === url.origin || allowed.includes(origin))
        ? {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "POST, GET",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Allow-Credentials": "true",
            Vary: "Origin",
          }
        : {};
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: origin && cors["Access-Control-Allow-Origin"] ? 204 : 403,
        headers: cors,
      });
    const isBrowserPost =
      request.method === "POST" && BROWSER_ROUTES.includes(url.pathname);
    const isAdmin =
      url.pathname.startsWith("/admin/") &&
      (request.method === "GET"
        ? ADMIN_GETS.includes(url.pathname)
        : request.method === "POST" && ADMIN_POSTS.includes(url.pathname));
    if (request.method !== "GET" && !isBrowserPost && !isAdmin)
      return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    if (
      request.method === "GET" &&
      url.pathname !== "/health" &&
      url.pathname !== "/live" &&
      !isAdmin
    )
      return json({ error: "NOT_FOUND" }, 404);
    // Browsers always send Origin on POST. This is a courtesy, not security:
    // the visitor token and Turnstile are what actually gate the paid routes.
    if (
      (isBrowserPost || url.pathname === "/live") &&
      origin &&
      !cors["Access-Control-Allow-Origin"]
    )
      return json({ error: "FORBIDDEN_ORIGIN" }, 403);
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const network = await hashNetwork(ip);
    if (
      (isBrowserPost || url.pathname === "/live") &&
      env.API_RATE_LIMIT &&
      !(await env.API_RATE_LIMIT.limit({ key: network })).success
    )
      return json({ error: "RATE_LIMITED" }, 429, { "Retry-After": "60" });
    let payload: string | undefined;
    if (isBrowserPost && MAX_BODY[url.pathname]) {
      const max = MAX_BODY[url.pathname];
      const length = Number(request.headers.get("Content-Length"));
      if (length > max) return json({ error: "TOO_LARGE" }, 413);
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader)
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > max) {
            await reader.cancel();
            return json({ error: "TOO_LARGE" }, 413);
          }
          chunks.push(value);
        }
      const buffer = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
      }
      payload = new TextDecoder().decode(buffer);
    }
    const stub = env.PORTFOLIO.get(
      env.PORTFOLIO.idFromName("v1-local-audit-store"),
    );
    const headers = new Headers();
    headers.set("x-network-key", network);
    headers.set("x-client-ip", ip);
    headers.set("x-secure", String(url.protocol === "https:"));
    const cookie = request.headers
      .get("Cookie")
      ?.match(/(?:^|;\s*)iris_visitor=([^;]+)/)?.[1];
    if (cookie) headers.set("x-visitor-cookie", cookie.slice(0, 600));
    if (url.pathname === "/live") {
      headers.set("Upgrade", "websocket");
      const ticket = request.headers
        .get("Sec-WebSocket-Protocol")
        ?.split(",")
        .map((v) => v.trim())
        .find((v) => /^ticket\.[a-f0-9]{64}$/.test(v));
      if (ticket) headers.set("x-live-ticket", ticket.slice(7));
    }
    const auth = request.headers.get("Authorization");
    if (auth) headers.set("x-auth", auth.slice(0, 700));
    if (payload !== undefined) headers.set("Content-Type", "application/json");
    const response = await stub.fetch(
      new Request(`https://internal${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        body: payload,
      }),
    );
    if (response.status === 101) return response;
    const out = new Response(response.body, response);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
} satisfies ExportedHandler<Env>;
