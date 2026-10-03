import { build } from "esbuild";
import {
  Miniflare,
  convertV4MiniflareOptions,
  WebSocketPair,
  Response as MFResponse,
} from "miniflare";
import assert from "node:assert/strict";
import { signVisitor, inviteId, verifyVisitor } from "../worker/visitor.ts";
const result = await build({
  entryPoints: ["worker/index.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  external: ["cloudflare:workers"],
  loader: { ".sql": "text" },
});
const script = result.outputFiles[0].text;
const ORIGIN = "http://127.0.0.1:3107";
const disabledVars = {
  AI_ENABLED: "false",
  EXPERIMENT_LIMIT_USD_MICROS: "0",
  MONTHLY_LIMIT_USD_MICROS: "0",
  DAILY_LIMIT_USD_MICROS: "0",
  SESSION_RESERVE_USD_MICROS: "400000",
  SESSION_MAX_SECONDS: "300",
  NETWORK_SESSIONS_PER_HOUR: "4",
  CHAT_REQUESTS_PER_HOUR: "40",
  CHAT_TOKEN_CAP: "150000",
  CHAT_RESERVE_USD_MICROS: "100000",
  VISITOR_DAILY_USD_MICROS: "50000000",
  VISITOR_INVITED_DAILY_USD_MICROS: "90000000",
  VISITOR_TOKENS_PER_HOUR: "100",
  VISITOR_TOKEN_DAYS: "30",
  VISITOR_SESSIONS_PER_HOUR: "100",
  VISITOR_CHAT_REQUESTS_PER_HOUR: "100",
  VISITOR_SESSION_BURST: "30",
  VISITOR_CHAT_BURST: "30",
  NETWORK_DAILY_USD_MICROS: "50000000",
  TURNSTILE_SECRET: "test-turnstile-secret",
  VISITOR_SECRET: "test-visitor-secret-0123456789",
  ADMIN_TOKEN: "test-admin-token-0123456789abcdef",
  INVITE_CODES: "vip-code, other-code",
  ALERT_WEBHOOK_URL: "https://alerts.test/topic",
  CONVERSATION_RETENTION_DAYS: "90",
  MESSAGE_RETENTION_DAYS: "365",
  LOG_REQUESTS_PER_HOUR: "300",
  MESSAGE_REQUESTS_PER_HOUR: "5",
  ALLOWED_ORIGINS: ORIGIN,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const providerCalls = [];
const chatCalls = [];
let chatFails = false;
let turnstileFails = false;
const turnstileCalls = [];
const alertCalls = [];
const sseBody = (events) =>
  events
    .map((e) => `event: ${e.event_type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("") + "data: [DONE]\n\n";
const usageOf = (n) => ({
  total_input_tokens: n,
  total_output_tokens: 10,
  total_thought_tokens: 0,
  total_tokens: n + 10,
});
// Stands in for the Interactions endpoint. A user message containing "view" gets a
// tool call (no text) and then, once the result comes back, the written answer.
function chatMock(body, tokens) {
  const steps = body.input;
  const hasResult = steps.some((x) => x.type === "function_result");
  const last =
    steps.filter((x) => x.type === "user_input").at(-1)?.content?.[0]?.text ??
    "";
  const events = [{ event_type: "interaction.created", interaction: {} }];
  const text = (t, i) => [
    { event_type: "step.start", index: i, step: { type: "model_output" } },
    { event_type: "step.delta", index: i, delta: { type: "text", text: t } },
    { event_type: "step.stop", index: i },
  ];
  if (/view/.test(last) && !hasResult) {
    const args = JSON.stringify({
      title: "Mock view",
      blocks: [{ kind: "text", body: "hello" }],
    });
    events.push(
      {
        event_type: "step.start",
        index: 0,
        step: {
          type: "function_call",
          id: "c1",
          name: "render",
          signature: "sig",
        },
      },
      {
        event_type: "step.delta",
        index: 0,
        delta: { type: "arguments_delta", arguments: args.slice(0, 20) },
      },
      {
        event_type: "step.delta",
        index: 0,
        delta: { type: "arguments_delta", arguments: args.slice(20) },
      },
      { event_type: "step.stop", index: 0 },
    );
  } else
    events.push(...text(hasResult ? "Here is the answer." : "Plain reply.", 0));
  events.push({
    event_type: "interaction.completed",
    interaction: { status: "completed", usage: usageOf(tokens) },
  });
  return sseBody(events);
}
let providerFails = false;
function worker(bindings) {
  return new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "test-worker",
          modules: true,
          script,
          compatibilityDate: "2026-09-01",
          durableObjects: {
            PORTFOLIO: { className: "PortfolioStore", useSQLite: true },
          },
          bindings,
          // Stands in for Google's token endpoint; no network or paid call.
          outboundService: async (request) => {
            if (request.url.includes("turnstile/v0/siteverify")) {
              const form = new URLSearchParams(await request.text());
              turnstileCalls.push(Object.fromEntries(form));
              return Response.json({
                success: !turnstileFails && form.get("response") !== "bad",
                hostname: bindings.MOCK_TURNSTILE_HOST ?? "local",
                action: bindings.MOCK_TURNSTILE_ACTION ?? "iris",
              });
            }
            if (request.url.includes("alerts.test")) {
              alertCalls.push(await request.text());
              return new Response("ok");
            }
            if (request.url.includes("/v1beta/interactions")) {
              const body = await request.json();
              chatCalls.push(body);
              if (bindings.MOCK_CHAT_DELAY)
                await sleep(Number(bindings.MOCK_CHAT_DELAY));
              if (
                chatFails ||
                (bindings.MOCK_CHAT_FAIL_SECOND &&
                  body.input.some((x) => x.type === "function_result"))
              )
                return new Response("nope", { status: 500 });
              return new Response(
                bindings.MOCK_CHAT_TRUNCATE
                  ? sseBody([
                      { event_type: "interaction.created", interaction: {} },
                    ])
                  : chatMock(body, Number(bindings.MOCK_CHAT_TOKENS ?? 100)),
                { headers: { "Content-Type": "text/event-stream" } },
              );
            }
            if (request.url.includes("BidiGenerateContent")) {
              if (providerFails) return new Response("{}", { status: 400 });
              const pair = new WebSocketPair();
              pair[1].accept();
              pair[1].addEventListener("message", (ev) => {
                const m = JSON.parse(ev.data);
                if (m.setup) {
                  providerCalls.push({ url: request.url, body: m });
                  pair[1].send(JSON.stringify({ setupComplete: {} }));
                } else if (m.realtimeInput?.text && bindings.MOCK_LIVE_USAGE) {
                  const input =
                    bindings.MOCK_LIVE_USAGE === "budget" ? 10000 : 4000;
                  const output =
                    bindings.MOCK_LIVE_USAGE === "budget" ? 1000 : 100;
                  pair[1].send(
                    JSON.stringify({
                      usageMetadata: {
                        promptTokenCount: input,
                        responseTokenCount: output,
                        totalTokenCount: input + output,
                      },
                      serverContent: {
                        modelTurn: { parts: [{ text: "mock" }] },
                        turnComplete: true,
                      },
                    }),
                  );
                }
              });
              return new MFResponse(null, { status: 101, webSocket: pair[0] });
            }
            throw new Error("Unexpected provider route");
          },
        },
      ],
    }),
  );
}
// Visitors: one token per worker instance unless a test asks for another.
const visitorTokens = new WeakMap();
async function mintVisitor(
  mf,
  { ip = "198.51.100.200", invite, proof = "ok" } = {},
) {
  return mf.dispatchFetch("https://local/visitor", {
    method: "POST",
    headers: {
      "CF-Connecting-IP": ip,
      "Content-Type": "application/json",
      Origin: ORIGIN,
    },
    body: JSON.stringify({
      turnstileToken: proof,
      ...(invite ? { invite } : {}),
    }),
  });
}
async function tokenFor(mf) {
  if (!visitorTokens.has(mf)) {
    const response = await mintVisitor(mf);
    visitorTokens.set(mf, (await response.json()).visitorToken);
  }
  return visitorTokens.get(mf);
}
const authHeader = async (mf, auth) =>
  auth === null
    ? {}
    : { Authorization: `Bearer ${auth ?? (await tokenFor(mf))}` };
async function sessionTicket(mf, ip = "198.51.100.1", origin = ORIGIN, auth) {
  return mf.dispatchFetch("https://local/session", {
    method: "POST",
    headers: {
      "CF-Connecting-IP": ip,
      ...(origin ? { Origin: origin } : {}),
      ...(await authHeader(mf, auth)),
    },
  });
}
async function openRelay(mf, token, ip = "198.51.100.1") {
  const r = await mf.dispatchFetch("https://local/live", {
    headers: {
      "CF-Connecting-IP": ip,
      Origin: ORIGIN,
      Upgrade: "websocket",
      "Sec-WebSocket-Protocol": `iris, ticket.${token}`,
    },
  });
  return r;
}
// Budget fixtures exercise a real relay connection, then close without usage.
// Unknown provider usage keeps the reservation. Dedicated relay tests follow.
async function post(mf, ip = "198.51.100.1", origin = ORIGIN, auth) {
  const response = await sessionTicket(mf, ip, origin, auth);
  if (response.status !== 200) return response;
  const body = await response.json();
  const live = await openRelay(mf, body.token, ip);
  const ws = live.webSocket;
  assert.ok(ws);
  ws.accept();
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("mock relay timed out")),
      3000,
    );
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.setupComplete || m.irisNotice) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  ws.close(1000);
  await sleep(30);
  return new Response(JSON.stringify(body), {
    status: response.status,
    headers: response.headers,
  });
}

const mf = worker(disabledVars);
try {
  const ns = await mf.getDurableObjectNamespace("PORTFOLIO");
  const stub = ns.get(ns.idFromName("test"));
  const response = await mf.dispatchFetch("https://local/health");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).paidAI, false);
  assert.equal((await post(mf)).status, 503);
  assert.equal(providerCalls.length, 0);
  assert.equal(
    (await mf.dispatchFetch("https://local/admin", { method: "POST" })).status,
    405,
  );
  const visitor = "visitor_test_12345678901234567890";
  const c = await stub.createConversation(visitor, "voice", {
    facts: ["synthetic test"],
  });
  const entries = [
    { type: "message", id: "m1", role: "user", text: "synthetic input" },
    {
      type: "event",
      key: "e1",
      source: "browser",
      name: "screen.event",
      data: { text: "synthetic" },
    },
  ];
  const first = await stub.recordFor(visitor, c.id, entries);
  assert.equal(first.written, 2);
  const duplicate = await stub.recordFor(visitor, c.id, entries);
  assert.equal(duplicate.written, 0); // a retried batch is not stored twice
  const replay = await stub.replay(visitor, c.id);
  assert.equal(replay.messages.length, 1);
  assert.equal(replay.events.length, 1);
  await assert.rejects(() => stub.replay("another_visitor", c.id));
  await assert.rejects(() => stub.reserve("paid-operation", 100));
  console.log(
    "PASS: disabled mode — migration, records, idempotency, ownership isolation, /session fails closed with no provider call.",
  );
} finally {
  await mf.dispose();
}

// Enabled mode with a 1.0 USD daily cap: exactly two 0.4 USD sessions fit.
const live = worker({
  ...disabledVars,
  AI_ENABLED: "true",
  GEMINI_API_KEY: "test-key-not-real",
  EXPERIMENT_LIMIT_USD_MICROS: "5000000",
  MONTHLY_LIMIT_USD_MICROS: "5000000",
  DAILY_LIMIT_USD_MICROS: "1000000",
  NETWORK_SESSIONS_PER_HOUR: "2",
});
try {
  assert.equal(
    (await post(live, "198.51.100.9", "https://evil.example")).status,
    403,
  );
  const first = await post(live);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  const body = await first.json();
  assert.match(body.token, /^[a-f0-9]{64}$/);
  assert.equal(body.model, "gemini-3.8-live");
  const sent = providerCalls.at(-1);
  assert.match(sent.url, /BidiGenerateContent/);
  const constraints = JSON.stringify(sent.body);
  assert.match(constraints, /gemini-3\.8-live/);
  assert.match(constraints, /Topics to deflect/); // prompt is locked into the token
  assert.match(constraints, /"render"/);
  assert.equal((await post(live)).status, 200);
  assert.equal((await post(live)).status, 429); // same network, third session this hour
  assert.equal((await post(live, "198.51.100.2")).status, 503); // daily budget used
  console.log(
    "PASS: enabled mode — origin allow-list, locked token constraints, per-network limit, daily budget cap.",
  );
} finally {
  await live.dispose();
}

// Text chat: stateless Interactions turns with tools run in the Worker.
const chatPost = async (
  mf,
  payload,
  ip = "198.51.100.20",
  origin = ORIGIN,
  raw,
  auth,
) =>
  mf.dispatchFetch("https://local/chat", {
    method: "POST",
    headers: {
      "CF-Connecting-IP": ip,
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
      ...(await authHeader(mf, auth)),
    },
    body: raw ?? JSON.stringify(payload),
  });
async function events(response) {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((b) => b.startsWith("data:"))
    .map((b) => JSON.parse(b.slice(5)));
}
const chatVars = {
  ...disabledVars,
  AI_ENABLED: "true",
  GEMINI_API_KEY: "test-key-not-real",
  EXPERIMENT_LIMIT_USD_MICROS: "5000000",
  MONTHLY_LIMIT_USD_MICROS: "5000000",
  DAILY_LIMIT_USD_MICROS: "5000000",
};
const off = worker(disabledVars);
try {
  assert.equal(
    (await chatPost(off, { history: [], message: "hi" })).status,
    503,
  );
  assert.equal(chatCalls.length, 0);
} finally {
  await off.dispose();
}
const chat = worker({
  ...chatVars,
  CHAT_TOKEN_CAP: "65000",
  MOCK_CHAT_TOKENS: "20000",
  CHAT_REQUESTS_PER_HOUR: "5",
});
try {
  assert.equal(
    (
      await chatPost(
        chat,
        { history: [], message: "hi" },
        "198.51.100.30",
        "https://evil.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (await chatPost(chat, { history: [], message: "" })).status,
    400,
  );
  assert.equal(
    (await chatPost(chat, { history: [], message: "hi", extra: 1 })).status,
    400,
  );
  assert.equal(
    (await chatPost(chat, null, undefined, ORIGIN, "x".repeat(100_001))).status,
    413,
  );
  assert.equal(chatCalls.length, 0);
  // Plain reply: start, text, done with the provider's token count.
  const first = await chatPost(chat, { history: [], message: "hello there" });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("Content-Type"), "text/event-stream");
  assert.equal(first.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  const ev1 = await events(first);
  assert.deepEqual(
    ev1.map((e) => e.type),
    ["start", "text", "done"],
  );
  const id = ev1[0].conversationId;
  assert.equal(ev1.at(-1).tokensUsed, 20010);
  const sent = chatCalls.at(-1);
  assert.equal(sent.store, false);
  assert.equal(sent.model, "gemini-3.8-flash");
  assert.match(sent.system_instruction, /written chat/);
  assert.doesNotMatch(sent.system_instruction, /AH-yoosh/); // never spell names phonetically in text
  assert.equal(sent.input.at(-1).content[0].text, "hello there");
  // History is rebuilt server-side: assistant-first history gets a leading user step.
  await events(
    await chatPost(chat, {
      conversationId: id,
      history: [
        { role: "assistant", text: "Welcome!" },
        { role: "user", text: "a" },
        { role: "user", text: "b" },
      ],
      message: "c",
    }),
  );
  const rebuilt = chatCalls.at(-1).input;
  assert.deepEqual(
    rebuilt.map((x) => x.type),
    ["user_input", "model_output", "user_input"],
  );
  assert.equal(rebuilt[0].content[0].text, "[visitor joined]");
  assert.equal(rebuilt[2].content[0].text, "a\nb\nc");
  // Token cap: 410 + 410 = 820 < 1000 allowed on the next call (820), then 1230 >= 1000.
  const third = await chatPost(chat, {
    conversationId: id,
    history: [],
    message: "again",
  });
  assert.equal(third.status, 200);
  await events(third);
  const capped = await chatPost(chat, {
    conversationId: id,
    history: [],
    message: "once more",
  });
  assert.equal(capped.status, 429);
  const capBody = await capped.json();
  assert.equal(capBody.error, "CONVERSATION_LIMIT");
  assert.equal(capBody.tokenCap, 65000);
  // Tool call: effect emitted, tool result sent back, then the written answer.
  const before = chatCalls.length;
  const tool = await events(
    await chatPost(chat, { history: [], message: "show a view" }),
  );
  assert.deepEqual(
    tool.map((e) => e.type),
    ["start", "effect", "text", "done"],
  );
  assert.equal(tool[1].effect.type, "render");
  assert.equal(tool[1].effect.view.title, "Mock view");
  assert.equal(chatCalls.length - before, 2);
  const roundTwo = chatCalls.at(-1).input;
  assert.equal(roundTwo.at(-1).type, "function_result");
  assert.equal(roundTwo.at(-2).type, "function_call");
  assert.equal(roundTwo.at(-2).arguments.title, "Mock view"); // streamed argument chunks reassembled
  // Hourly chat limit (5 requests): the cap and tool calls above used them up.
  const limited = await chatPost(chat, { history: [], message: "hello" });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error, "RATE_LIMITED");
  console.log(
    "PASS: text chat — validation, origin allow-list, streaming, locked text prompt, history rebuild, token cap, tool loop, hourly limit.",
  );
} finally {
  await chat.dispose();
}
chatFails = true;
const broken = worker({ ...chatVars, DAILY_LIMIT_USD_MICROS: "100000" });
try {
  const failed = await events(
    await chatPost(broken, { history: [], message: "hello" }, "198.51.100.40"),
  );
  assert.equal(failed.at(-1).type, "error");
  assert.equal(failed.at(-1).code, "PROVIDER_ERROR");
  chatFails = false;
  // The failed round retains its bound; another small round still fits the 0.10 USD cap.
  const ok = await events(
    await chatPost(broken, { history: [], message: "hello" }, "198.51.100.40"),
  );
  assert.equal(ok.at(-1).type, "done");
  console.log(
    "PASS: ambiguous text failure keeps its reserve; subsequent bounded work still fits.",
  );
} finally {
  await broken.dispose();
}

// ---------------------------------------------------------------------------
// Abuse protection: visitor identity, per-visitor and per-network limits, kill
// switch, owner controls, alerts.
// ---------------------------------------------------------------------------
const safetyVars = {
  ...disabledVars,
  AI_ENABLED: "true",
  GEMINI_API_KEY: "test-key-not-real",
  EXPERIMENT_LIMIT_USD_MICROS: "50000000",
  MONTHLY_LIMIT_USD_MICROS: "50000000",
  DAILY_LIMIT_USD_MICROS: "50000000",
  SESSION_RESERVE_USD_MICROS: "100000",
};
const adminCall = (
  mf,
  path,
  method = "GET",
  token = disabledVars.ADMIN_TOKEN,
) =>
  mf.dispatchFetch(`https://local${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

// 1. Visitor tokens
const gate = worker({ ...safetyVars, VISITOR_TOKENS_PER_HOUR: "3" });
try {
  assert.equal(
    (await mintVisitor(gate, { ip: "203.0.113.1", proof: "bad" })).status,
    403,
  );
  assert.equal(turnstileCalls.at(-1).secret, "test-turnstile-secret");
  assert.equal(turnstileCalls.at(-1).remoteip, "203.0.113.1");
  const forbidden = await gate.dispatchFetch("https://local/visitor", {
    method: "POST",
    headers: {
      Origin: "https://evil.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ turnstileToken: "ok" }),
  });
  assert.equal(forbidden.status, 403);
  const badBody = await gate.dispatchFetch("https://local/visitor", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ nothing: true }),
  });
  assert.equal(badBody.status, 400);
  // Failed verifications use up the per-network allowance (3 per hour) too.
  const okResponse = await mintVisitor(gate, { ip: "203.0.113.2" });
  assert.equal(okResponse.status, 200);
  const minted = await okResponse.json();
  assert.equal(minted.invited, false);
  assert.ok(minted.expiresAt > Date.now() + 29 * 86400000);
  const tooMany = [];
  for (let i = 0; i < 3; i++)
    tooMany.push((await mintVisitor(gate, { ip: "203.0.113.3" })).status);
  assert.deepEqual(tooMany, [200, 200, 200]);
  const limited = await mintVisitor(gate, { ip: "203.0.113.3" });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error, "RATE_LIMITED");
  // Invite codes: right one upgrades the token, wrong one is silently ignored.
  const vip = await (
    await mintVisitor(gate, { ip: "203.0.113.4", invite: "vip-code" })
  ).json();
  const wrong = await (
    await mintVisitor(gate, { ip: "203.0.113.5", invite: "nope" })
  ).json();
  assert.equal(vip.invited, true);
  assert.equal(wrong.invited, false);
  console.log(
    "PASS: visitor tokens — Turnstile check, origin allow-list, validation, per-network mint limit, invite codes.",
  );
} finally {
  await gate.dispose();
}

// 2. Paid routes need a valid, current, genuine token
const strict = worker(safetyVars);
try {
  const providerBefore = providerCalls.length;
  const chatBefore = chatCalls.length;
  const secret = safetyVars.VISITOR_SECRET;
  const id = "a".repeat(32);
  const forged = await signVisitor("some-other-secret-0123456789", {
    v: id,
    inv: false,
    exp: Date.now() + 60000,
  });
  const expired = await signVisitor(secret, {
    v: id,
    inv: false,
    exp: Date.now() - 1000,
  });
  const valid = await signVisitor(secret, {
    v: id,
    inv: false,
    exp: Date.now() + 60000,
  });
  for (const auth of [null, "garbage", forged, expired]) {
    const s = await post(strict, "198.51.100.50", ORIGIN, auth);
    assert.equal(s.status, 401, `session with ${auth?.slice(0, 12)}`);
    assert.equal((await s.json()).error, "VISITOR_REQUIRED");
    const c = await chatPost(
      strict,
      { history: [], message: "hi" },
      "198.51.100.51",
      ORIGIN,
      undefined,
      auth,
    );
    assert.equal(c.status, 401);
  }
  assert.equal(providerCalls.length, providerBefore);
  assert.equal(chatCalls.length, chatBefore);
  assert.equal(
    (await post(strict, "198.51.100.50", ORIGIN, valid)).status,
    200,
  );
  console.log(
    "PASS: paid routes reject missing, forged, expired and malformed visitor tokens before any provider call.",
  );
} finally {
  await strict.dispose();
}

// 3. Per-visitor daily allowance (0.25 USD: two 0.10 voice sessions fit, a third does not)
const budget = worker({
  ...safetyVars,
  VISITOR_DAILY_USD_MICROS: "200000",
  VISITOR_INVITED_DAILY_USD_MICROS: "900000",
  NETWORK_SESSIONS_PER_HOUR: "50",
});
try {
  const a = (await (await mintVisitor(budget, { ip: "203.0.113.10" })).json())
    .visitorToken;
  const b = (await (await mintVisitor(budget, { ip: "203.0.113.11" })).json())
    .visitorToken;
  const v = (
    await (
      await mintVisitor(budget, { ip: "203.0.113.12", invite: "vip-code" })
    ).json()
  ).visitorToken;
  const go = (token) => post(budget, "198.51.100.60", ORIGIN, token);
  assert.equal((await go(a)).status, 200);
  assert.equal((await go(a)).status, 200);
  const over = await go(a);
  assert.equal(over.status, 429);
  assert.equal((await over.json()).error, "VISITOR_LIMIT");
  assert.equal((await go(b)).status, 200); // another visitor is unaffected
  for (let i = 0; i < 9; i++) assert.equal((await go(v)).status, 200); // invited: 0.90 USD
  assert.equal((await go(v)).status, 429);
  // Text chat counts against the same daily allowance.
  const chatOver = await chatPost(
    budget,
    { history: [], message: "hi" },
    "198.51.100.61",
    ORIGIN,
    undefined,
    a,
  );
  assert.equal(chatOver.status, 429);
  assert.equal((await chatOver.json()).error, "VISITOR_LIMIT");
  // A conversation belongs to the visitor who started it.
  const first = await events(
    await chatPost(
      budget,
      { history: [], message: "hello" },
      "198.51.100.62",
      ORIGIN,
      undefined,
      b,
    ),
  );
  const own = first[0].conversationId;
  const thief = (
    await (await mintVisitor(budget, { ip: "203.0.113.13" })).json()
  ).visitorToken;
  const stolen = await events(
    await chatPost(
      budget,
      { conversationId: own, history: [], message: "hello" },
      "198.51.100.62",
      ORIGIN,
      undefined,
      thief,
    ),
  );
  assert.notEqual(stolen[0].conversationId, own);
  console.log(
    "PASS: per-visitor daily allowance — voice and text share it, visitors are independent, invites raise it, conversations are owned.",
  );
} finally {
  await budget.dispose();
}

// 4. Network limits group IPv6 addresses by /64
const net = worker({ ...safetyVars, NETWORK_SESSIONS_PER_HOUR: "2" });
try {
  assert.equal((await post(net, "2001:db8:1:2::1")).status, 200);
  assert.equal(
    (await post(net, "2001:db8:1:2:aaaa:bbbb:cccc:dddd")).status,
    200,
  );
  assert.equal((await post(net, "2001:db8:1:2:1234::9")).status, 429); // same /64
  assert.equal((await post(net, "2001:db8:1:3::1")).status, 200); // different /64
  console.log("PASS: IPv6 addresses in one /64 share a network allowance.");
} finally {
  await net.dispose();
}

// 5. Kill switch and owner controls
const owner = worker({ ...safetyVars, NETWORK_SESSIONS_PER_HOUR: "50" });
try {
  for (const bad of [null, "wrong-token-wrong-token-wrong"]) {
    assert.equal(
      (await adminCall(owner, "/admin/status", "GET", bad)).status,
      404,
    );
    assert.equal(
      (await adminCall(owner, "/admin/pause", "POST", bad)).status,
      404,
    );
  }
  const status = await (await adminCall(owner, "/admin/status")).json();
  assert.equal(status.paused, false);
  assert.ok(
    "day" in status.budgets &&
      "month" in status.budgets &&
      "experiment" in status.budgets,
  );
  assert.equal((await post(owner)).status, 200);
  const afterOne = await (await adminCall(owner, "/admin/status")).json();
  assert.equal(afterOne.today.voiceSessions, 1);
  assert.equal(afterOne.budgets.day.usedUsd, 0.1);
  await adminCall(owner, "/admin/pause", "POST");
  const health = await (
    await owner.dispatchFetch("https://local/health")
  ).json();
  assert.equal(health.paused, true);
  const paused = await post(owner);
  assert.equal(paused.status, 503);
  assert.equal((await paused.json()).error, "PAUSED");
  assert.equal(
    (await chatPost(owner, { history: [], message: "hi" })).status,
    503,
  );
  assert.equal((await mintVisitor(owner, { ip: "203.0.113.70" })).status, 503);
  await adminCall(owner, "/admin/resume", "POST");
  assert.equal((await post(owner)).status, 200);
  // Block one visitor without touching the others.
  const token = await tokenFor(owner);
  const visitorId = JSON.parse(
    Buffer.from(token.split(".")[0], "base64url").toString(),
  ).v;
  await adminCall(owner, `/admin/block?visitor=${visitorId}`, "POST");
  const blocked = await post(owner);
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error, "VISITOR_BLOCKED");
  assert.equal(
    (await adminCall(owner, "/admin/block?visitor=not-an-id", "POST")).status,
    400,
  );
  await adminCall(owner, `/admin/unblock?visitor=${visitorId}`, "POST");
  assert.equal((await post(owner)).status, 200);
  console.log(
    "PASS: owner controls — hidden without the admin token, status, pause/resume kill switch, per-visitor block.",
  );
} finally {
  await owner.dispose();
}
const noAdmin = worker({ ...safetyVars, ADMIN_TOKEN: "short" });
try {
  assert.equal(
    (await adminCall(noAdmin, "/admin/status", "GET", "short")).status,
    404,
  ); // too short to count as configured
} finally {
  await noAdmin.dispose();
}

// 6. Alerts at 50%, 80% and when the budget runs out, once each
const alerts = worker({
  ...safetyVars,
  DAILY_LIMIT_USD_MICROS: "1000000",
  SESSION_RESERVE_USD_MICROS: "300000",
  NETWORK_SESSIONS_PER_HOUR: "50",
});
try {
  alertCalls.length = 0;
  assert.equal((await post(alerts)).status, 200); // 30%
  await sleep(300);
  assert.equal(alertCalls.length, 0);
  assert.equal((await post(alerts)).status, 200); // 60%
  await sleep(300);
  assert.equal(alertCalls.length, 1);
  assert.match(alertCalls[0], /60% of the daily cap/);
  assert.equal((await post(alerts)).status, 200); // 90%
  await sleep(300);
  assert.equal(alertCalls.length, 2);
  assert.equal((await post(alerts)).status, 503); // budget exhausted
  assert.equal((await post(alerts)).status, 503);
  await sleep(300);
  assert.equal(alertCalls.length, 3);
  assert.match(alertCalls[2], /budget is used up/);
  console.log(
    "PASS: budget alerts fire at 50%, 80% and exhaustion, once per day each.",
  );
} finally {
  await alerts.dispose();
}
const quiet = worker({
  ...safetyVars,
  DAILY_LIMIT_USD_MICROS: "400000",
  SESSION_RESERVE_USD_MICROS: "300000",
  ALERT_WEBHOOK_URL: "",
});
try {
  const before = alertCalls.length;
  await post(quiet);
  await post(quiet);
  await sleep(300);
  assert.equal(alertCalls.length, before); // no webhook configured, nothing sent, nothing breaks
  console.log(
    "PASS: without a webhook configured, alerts are skipped quietly.",
  );
} finally {
  await quiet.dispose();
}

// 6. Records: what was said is saved, the owner can read it, retention deletes it.
const DAY = 86400000;
const records = worker({
  ...safetyVars,
  NETWORK_SESSIONS_PER_HOUR: "50",
  VISITOR_DAILY_USD_MICROS: "90000000",
  CHAT_REQUESTS_PER_HOUR: "200",
  LOG_REQUESTS_PER_HOUR: "300",
});
try {
  const mintToken = async (ip) =>
    (await (await mintVisitor(records, { ip })).json()).visitorToken;
  const alice = await mintToken("203.0.113.80");
  const bob = await mintToken("203.0.113.81");
  const turn = async (token, message, conversationId, hidden) =>
    events(
      await chatPost(
        records,
        { conversationId, history: [], message, ...(hidden ? { hidden } : {}) },
        "198.51.100.80",
        ORIGIN,
        undefined,
        token,
      ),
    );
  const detail = async (id) =>
    (await adminCall(records, `/admin/conversation?id=${id}`)).json();
  const parsed = (rows) =>
    rows.map((r) => ({
      ...r,
      c: JSON.parse(r.content_json ?? "{}"),
      p: JSON.parse(r.payload_json ?? "{}"),
    }));

  // Text chat is recorded on the server: question, answer, shown view, screen event.
  const t1 = await turn(alice, "hello there");
  const textId = t1[0].conversationId;
  await turn(alice, "[visitor opened the Socrates page]", textId, true);
  await turn(alice, "show me a view of the work", textId);
  let rec = await detail(textId);
  const said = parsed(rec.messages).map((m) => `${m.role}:${m.c.text}`);
  assert.deepEqual(said, [
    "user:hello there",
    "assistant:Plain reply.",
    "assistant:Plain reply.", // the reply to the screen event
    "user:show me a view of the work",
    "assistant:Here is the answer.",
  ]);
  const names = parsed(rec.events).map((e) => e.event_type);
  assert.deepEqual(names, ["screen.event", "view.rendered"]);
  assert.equal(
    parsed(rec.events)[0].p.text,
    "[visitor opened the Socrates page]",
  );
  assert.ok(parsed(rec.events)[1].p.title);
  assert.equal(
    rec.conversation.retain_until - rec.conversation.started_at,
    90 * DAY,
  );
  assert.ok(rec.requests.length >= 3);
  assert.ok(rec.requests.every((r) => r.cost_usd_micros > 0));

  // Voice: the session gives a conversation id; the browser reports turns and events.
  const sessionFor = async (token, body) =>
    mf2(records, "/session", token, body);
  const mf2 = async (mfx, path, token, body, ip = "198.51.100.81") =>
    mfx.dispatchFetch(`https://local${path}`, {
      method: "POST",
      headers: {
        "CF-Connecting-IP": ip,
        "Content-Type": "application/json",
        Origin: ORIGIN,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const voice = await (await sessionFor(alice)).json();
  const logBatch = (token, conversationId, entries, ip) =>
    mf2(records, "/log", token, { conversationId, entries }, ip);
  const batch = [
    {
      type: "message",
      id: "u1",
      role: "user",
      text: "Tell me about Checker",
      at: Date.now() - 2000,
    },
    {
      type: "event",
      key: "v1",
      name: "view.rendered",
      data: { title: "Checker" },
    },
    {
      type: "message",
      id: "a1",
      role: "assistant",
      text: "Checker is a demo.",
      status: "interrupted",
    },
  ];
  const ok = await logBatch(alice, voice.conversationId, batch);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).written, 3);
  assert.equal(
    (await (await logBatch(alice, voice.conversationId, batch)).json()).written,
    0,
  );
  rec = await detail(voice.conversationId);
  assert.deepEqual(
    parsed(rec.messages).map((m) => m.status),
    ["complete", "interrupted"],
  );
  assert.equal(rec.conversation.mode, "voice");
  // Forged or malformed logs: no token, wrong owner, unknown event name, oversize batch.
  assert.equal((await logBatch(null, voice.conversationId, batch)).status, 401);
  assert.equal((await logBatch(bob, voice.conversationId, batch)).status, 404);
  assert.equal(
    (
      await logBatch(alice, voice.conversationId, [
        { type: "event", key: "x1", name: "admin.promote", data: {} },
      ])
    ).status,
    400,
  );
  const many = Array.from({ length: 31 }, (_, i) => ({
    type: "event",
    key: `m${i}`,
    name: "error",
    data: {},
  }));
  assert.equal((await logBatch(alice, voice.conversationId, many)).status, 400);
  assert.equal(
    (
      await mf2(records, "/log", alice, {
        conversationId: voice.conversationId,
        entries: [],
        extra: 1,
      })
    ).status,
    400,
  );

  // Going back to voice, or typing after voice, continues the same record.
  const resumed = await (
    await sessionFor(alice, { conversationId: voice.conversationId })
  ).json();
  assert.equal(resumed.conversationId, voice.conversationId);
  const foreign = await (
    await sessionFor(bob, { conversationId: voice.conversationId })
  ).json();
  assert.notEqual(foreign.conversationId, voice.conversationId);
  const typed = await turn(alice, "and by text?", voice.conversationId);
  assert.equal(typed[0].conversationId, voice.conversationId);
  rec = await detail(voice.conversationId);
  assert.equal(rec.messages.length, 4);
  assert.deepEqual(
    parsed(rec.messages).map((m) => m.sequence_number),
    [1, 2, 3, 4],
  );

  // A conversation stops growing at its cap instead of filling the database.
  let dropped = 0;
  for (let i = 0; i < 18; i++) {
    const chunk = Array.from({ length: 30 }, (_, j) => ({
      type: "message",
      id: `f${i}x${j}`,
      role: "user",
      text: "x",
    }));
    dropped += (
      await (await logBatch(alice, voice.conversationId, chunk)).json()
    ).dropped;
  }
  rec = await detail(voice.conversationId);
  assert.equal(rec.messages.length, 500);
  assert.ok(dropped > 0);

  // Ending a conversation closes it.
  await logBatch(alice, textId, [
    { type: "event", key: "end", name: "conversation.ended", data: {} },
  ]);
  rec = await detail(textId);
  assert.equal(rec.conversation.status, "ended");
  assert.ok(rec.conversation.ended_at);
  console.log(
    "PASS: records — text and voice turns saved in order, screen events, idempotent retries, ownership, event allow-list, caps, one thread across voice and text.",
  );

  // Leave a message.
  const send = (token, body, ip = "198.51.100.82") =>
    mf2(records, "/message", token, body, ip);
  const note = {
    name: "Dana Recruiter",
    email: "dana@example.com",
    message: "Hello Ayush, let's talk about a role.",
    conversationId: textId,
  };
  const before = alertCalls.length;
  assert.equal((await send(alice, note)).status, 200);
  await sleep(200);
  const pinged = alertCalls.slice(before).join("|");
  assert.match(pinged, /New message/);
  assert.doesNotMatch(pinged, /dana@example\.com|Dana|role/); // content never leaves the database
  assert.equal((await send(null, note)).status, 401);
  assert.equal(
    (await send(alice, { ...note, email: "not-an-email" })).status,
    400,
  );
  assert.equal((await send(alice, { ...note, message: "hi" })).status, 400);
  assert.equal((await send(alice, { ...note, extra: true })).status, 400);
  assert.equal((await send(alice, note)).status, 200);
  assert.equal((await send(alice, note)).status, 200);
  const limited = await send(alice, note);
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error, "MESSAGE_LIMIT");
  assert.equal((await send(bob, note, "198.51.100.83")).status, 200); // another visitor
  await adminCall(records, "/admin/pause", "POST");
  assert.equal((await send(bob, note, "198.51.100.84")).status, 200); // still open while paused
  await adminCall(records, "/admin/resume", "POST");
  console.log(
    "PASS: leave a message — validated, limited per visitor, alerted without content, open while paused.",
  );

  // Owner viewer.
  assert.equal(
    (await adminCall(records, "/admin/conversations", "GET", null)).status,
    404,
  );
  const list = (
    await (await adminCall(records, "/admin/conversations?limit=10")).json()
  ).conversations;
  const row = list.find((c) => c.id === textId);
  assert.equal(row.user_turns, 2);
  assert.equal(row.first_message, "hello there");
  assert.ok(row.cost_usd_micros > 0);
  assert.equal(list.find((c) => c.id === voice.conversationId).mode, "voice");
  assert.equal(
    (await adminCall(records, "/admin/conversation?id=nope", "GET")).status,
    404,
  );
  // Every row of a text turn points at the answer and the model call that made it.
  const linked = await detail(textId);
  const msgs = linked.messages;
  const answers = msgs.filter((m) => m.role === "assistant");
  assert.equal(answers[0].parent_message_id, msgs[0].id);
  assert.equal(answers[1].parent_message_id, null); // reply to a screen event
  assert.equal(answers[2].parent_message_id, msgs[3].id);
  const shownView = linked.events.find((e) => e.event_type === "view.rendered");
  assert.equal(shownView.message_id, answers[2].id);
  const call = linked.requests.find((r) => r.id === shownView.model_request_id);
  assert.equal(call.trigger_message_id, msgs[3].id);
  assert.equal(call.model, "gemini-3.8-flash");
  assert.ok(JSON.parse(call.usage_json).totalTokens > 0);
  assert.equal(JSON.parse(call.response_payload_json).toolCalls[0], "render");
  // Scoping by visitor, the visitor list and the charts.
  const aliceId = linked.conversation.visitor_id;
  const mine = (
    await (
      await adminCall(records, `/admin/conversations?visitor=${aliceId}`)
    ).json()
  ).conversations;
  assert.ok(mine.length >= 2 && mine.every((c) => c.visitor_id === aliceId));
  assert.equal(
    (await adminCall(records, "/admin/conversations?visitor=a%20b")).status,
    400,
  );
  const people = (await (await adminCall(records, "/admin/visitors")).json())
    .visitors;
  const alicia = people.find((v) => v.visitor_id === aliceId);
  assert.ok(
    alicia.conversations >= 2 &&
      alicia.user_turns >= 2 &&
      alicia.cost_usd_micros > 0,
  );
  assert.equal(alicia.blocked, false);
  assert.ok(people.length >= 2);
  const chart = await (await adminCall(records, "/admin/stats?days=7")).json();
  assert.equal(chart.series.length, 7);
  assert.equal(chart.hours.length, 24);
  assert.ok(chart.totals.conversations >= 3 && chart.totals.visitors >= 2);
  assert.ok(chart.totals.viewsShown >= 1 && chart.totals.costUsd > 0);
  assert.ok(chart.series.at(-1).text >= 1 && chart.series.at(-1).voice >= 1);
  assert.ok(chart.topViews.length >= 1);
  assert.equal(
    (await adminCall(records, "/admin/stats?days=7", "GET", null)).status,
    404,
  );
  const inbox = (
    await (await adminCall(records, "/admin/leave-messages")).json()
  ).messages;
  assert.equal(inbox.length, 5);
  assert.equal(inbox[0].status, "new");
  const target = inbox[0].id;
  assert.equal(
    (
      await adminCall(
        records,
        `/admin/leave-messages?id=${target}&status=read`,
        "POST",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await adminCall(
        records,
        `/admin/leave-messages?id=${target}&status=bogus`,
        "POST",
      )
    ).status,
    400,
  );
  const afterRead = (
    await (await adminCall(records, "/admin/leave-messages")).json()
  ).messages;
  assert.equal(afterRead.find((m) => m.id === target).status, "read");
  assert.ok(afterRead.find((m) => m.id === target).read_at);
  const dump = await (await adminCall(records, "/admin/export")).json();
  assert.ok(dump.messages.length >= 504 && dump.leaveMessages.length === 5);
  assert.ok(!JSON.stringify(dump).includes("test-key-not-real"));
  // Delete one conversation and one message on request.
  assert.equal(
    (
      await adminCall(
        records,
        `/admin/delete?kind=conversation&id=${textId}`,
        "POST",
      )
    ).status,
    200,
  );
  assert.equal(
    (await adminCall(records, `/admin/conversation?id=${textId}`)).status,
    404,
  );
  assert.equal(
    (
      await adminCall(
        records,
        `/admin/delete?kind=conversation&id=${textId}`,
        "POST",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await adminCall(
        records,
        `/admin/delete?kind=leave-message&id=${target}`,
        "POST",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await adminCall(
        records,
        "/admin/delete?kind=nonsense&id=abcdefgh",
        "POST",
      )
    ).status,
    400,
  );
  console.log(
    "PASS: owner viewer — list, replay, inbox, mark read, export, delete on request, hidden without the admin token.",
  );

  // Retention sweep: expired records go, unclosed conversations are marked ended.
  const ns = await records.getDurableObjectNamespace("PORTFOLIO");
  const store = ns.get(ns.idFromName("v1-local-audit-store"));
  const soon = await store.sweep(Date.now() + 3 * 3600000);
  assert.ok(soon.markedEnded >= 1);
  assert.equal(
    (await detail(voice.conversationId)).conversation.status,
    "ended",
  );
  const late = await store.sweep(Date.now() + 91 * DAY);
  assert.ok(late.conversationsDeleted >= 2);
  assert.equal(
    (await adminCall(records, `/admin/conversation?id=${voice.conversationId}`))
      .status,
    404,
  );
  assert.equal(
    (await (await adminCall(records, "/admin/leave-messages")).json()).messages
      .length,
    4,
  ); // kept a year
  const later = await store.sweep(Date.now() + 366 * DAY);
  assert.equal(later.messagesDeleted, 4);
  const health = await (
    await records.dispatchFetch("https://local/health")
  ).json();
  assert.equal(health.schemaVersion, 2);
  console.log(
    "PASS: retention — conversations expire after 90 days, messages after a year, unclosed conversations are marked ended.",
  );
} finally {
  await records.dispose();
}

// 7. Hosting: www redirects to the apex, and the site's own origin may call the API.
const hosting = worker({
  ...safetyVars,
  CANONICAL_HOST: "ayushbh.com",
  ALLOWED_ORIGINS: "",
});
try {
  const moved = await hosting.dispatchFetch(
    "https://www.ayushbh.com/privacy/?a=1",
    {
      redirect: "manual",
    },
  );
  assert.equal(moved.status, 301);
  assert.equal(
    moved.headers.get("Location"),
    "https://ayushbh.com/privacy/?a=1",
  );
  const own = await hosting.dispatchFetch("https://ayushbh.com/visitor", {
    method: "POST",
    headers: {
      Origin: "https://ayushbh.com",
      "Content-Type": "application/json",
      "CF-Connecting-IP": "198.51.100.150",
    },
    body: JSON.stringify({ turnstileToken: "ok" }),
  });
  assert.equal(own.status, 200); // same origin, although ALLOWED_ORIGINS is empty
  const foreign = await hosting.dispatchFetch("https://ayushbh.com/visitor", {
    method: "POST",
    headers: {
      Origin: "https://evil.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ turnstileToken: "ok" }),
  });
  assert.equal(foreign.status, 403);
  console.log(
    "PASS: hosting — www redirects to the apex, same-origin calls allowed, foreign origins refused.",
  );
} finally {
  await hosting.dispose();
}

// Regression cases from the production rate-limit audit.
async function statusOf(mf) {
  return await (await adminCall(mf, "/admin/status")).json();
}
async function detailOf(mf, id) {
  return await (await adminCall(mf, `/admin/conversation?id=${id}`)).json();
}
const claimsOf = (token) =>
  JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());

const overage = worker({ ...chatVars, MOCK_CHAT_TOKENS: "200000" });
try {
  const es = await events(
    await chatPost(overage, { history: [], message: "hello" }),
  );
  const record = await detailOf(overage, es[0].conversationId);
  assert.equal(record.requests[0].cost_usd_micros, 150038);
  const status = await statusOf(overage);
  assert.equal(status.paused, true);
  assert.ok(Math.abs(status.budgets.day.usedUsd - 0.150038) < 0.0001);
  assert.equal(es.at(-1).code, "PAUSED");
  assert.equal(
    (await chatPost(overage, { history: [], message: "again" })).status,
    503,
  );
  console.log(
    "PASS: unexpected overage is charged in full and pauses further paid work.",
  );
} finally {
  await overage.dispose();
}

for (const mode of ["partial", "missing"]) {
  const failedRound = worker({
    ...chatVars,
    ...(mode === "partial"
      ? { MOCK_CHAT_FAIL_SECOND: "true", MOCK_CHAT_TOKENS: "1000" }
      : { MOCK_CHAT_TRUNCATE: "true" }),
  });
  try {
    const es = await events(
      await chatPost(failedRound, {
        history: [],
        message: mode === "partial" ? "show a view" : "hello",
      }),
    );
    assert.equal(es.at(-1).type, "error");
    const record = await detailOf(failedRound, es[0].conversationId);
    const usage = JSON.parse(record.requests[0].usage_json);
    if (mode === "partial") assert.equal(usage.inputTokens, 1000);
    assert.ok(usage.totalTokens > 1000);
    assert.ok(record.requests[0].cost_usd_micros > 788);
    const status = await statusOf(failedRound);
    assert.ok(status.budgets.day.usedUsd > 0);
    assert.equal(status.budgets.day.reservedUsd, 0);
  } finally {
    await failedRound.dispose();
  }
}
console.log(
  "PASS: completed tool rounds survive a later failure; truncated/missing usage retains a conservative charge.",
);

const concurrent = worker({ ...chatVars, MOCK_CHAT_DELAY: "150" });
try {
  const seed = await events(
    await chatPost(concurrent, { history: [], message: "hello" }),
  );
  const id = seed[0].conversationId;
  const payload = { conversationId: id, history: [], message: "again" };
  const responses = await Promise.all([
    chatPost(concurrent, payload),
    chatPost(concurrent, payload),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 429]);
  const accepted = responses.find((r) => r.status === 200);
  const rejected = responses.find((r) => r.status === 429);
  assert.equal((await rejected.json()).error, "REQUEST_IN_PROGRESS");
  const es = await events(accepted);
  assert.equal(es.at(-1).tokensUsed, 220);
  const rec = await detailOf(concurrent, id);
  assert.equal(rec.requests.length, 2);
  console.log(
    "PASS: parallel requests cannot lose token counts or start two paid calls for a visitor.",
  );
} finally {
  await concurrent.dispose();
}

const identity = worker({
  ...chatVars,
  VISITOR_DAILY_USD_MICROS: "22000",
  NETWORK_DAILY_USD_MICROS: "22000",
  MOCK_CHAT_TOKENS: "10000",
});
try {
  const original = await mintVisitor(identity, { ip: "203.0.113.100" });
  const cookie = original.headers.get("Set-Cookie").split(";")[0];
  assert.match(
    original.headers.get("Set-Cookie"),
    /HttpOnly.*SameSite=Lax.*Secure/,
  );
  const token = (await original.json()).visitorToken;
  const id = claimsOf(token).v;
  await events(
    await chatPost(
      identity,
      { history: [], message: "hello" },
      "203.0.113.100",
      ORIGIN,
      undefined,
      token,
    ),
  );
  const renewal = await identity.dispatchFetch("https://local/visitor", {
    method: "POST",
    headers: {
      "CF-Connecting-IP": "203.0.113.100",
      Origin: ORIGIN,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ turnstileToken: "ok", invite: "vip-code" }),
  });
  const renewed = await renewal.json();
  assert.equal(claimsOf(renewed.visitorToken).v, id);
  assert.equal(renewed.invited, true);
  const fresh = (
    await (await mintVisitor(identity, { ip: "203.0.113.100" })).json()
  ).visitorToken;
  const reset = await chatPost(
    identity,
    { history: [], message: "again" },
    "203.0.113.100",
    ORIGIN,
    undefined,
    fresh,
  );
  assert.equal(reset.status, 429);
  assert.equal((await reset.json()).error, "NETWORK_LIMIT");
  await adminCall(identity, `/admin/block?visitor=${id}`, "POST");
  const blockedRenewal = await identity.dispatchFetch("https://local/visitor", {
    method: "POST",
    headers: {
      "CF-Connecting-IP": "203.0.113.100",
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ turnstileToken: "ok" }),
  });
  assert.equal(blockedRenewal.status, 403);
  console.log(
    "PASS: cookie renewal preserves identity and blocks; invite upgrades reuse identity; fresh tokens share network dollars.",
  );
} finally {
  await identity.dispose();
}

const retired = worker({
  ...chatVars,
  INVITE_CODES: "",
  VISITOR_DAILY_USD_MICROS: "1000",
  VISITOR_INVITED_DAILY_USD_MICROS: "1000000",
});
try {
  for (const includeId of [false, true]) {
    const token = await signVisitor(chatVars.VISITOR_SECRET, {
      v: "b".repeat(32),
      inv: true,
      exp: Date.now() + 60000,
      ...(includeId
        ? { inviteId: await inviteId(chatVars.VISITOR_SECRET, "vip-code") }
        : {}),
    });
    const response = await chatPost(
      retired,
      { history: [], message: "hello" },
      undefined,
      ORIGIN,
      undefined,
      token,
    );
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error, "VISITOR_LIMIT");
  }
  console.log(
    "PASS: retired invite codes and legacy invite flags cannot preserve an elevated allowance.",
  );
} finally {
  await retired.dispose();
}

const noFunds = worker({ ...chatVars, DAILY_LIMIT_USD_MICROS: "1000" });
try {
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await chatPost(noFunds, { history: [], message: "hello" })).status,
      503,
    );
  const list = await (await adminCall(noFunds, "/admin/conversations")).json();
  assert.equal(list.conversations.length, 0);
  console.log("PASS: refused requests create no conversation records.");
} finally {
  await noFunds.dispose();
}

for (const field of ["MOCK_TURNSTILE_HOST", "MOCK_TURNSTILE_ACTION"]) {
  const proof = worker({ ...chatVars, [field]: "another-site" });
  try {
    assert.equal((await mintVisitor(proof)).status, 403);
  } finally {
    await proof.dispose();
  }
}
const invalid = worker(chatVars);
try {
  for (let i = 0; i < 90; i++)
    assert.equal(
      (
        await chatPost(
          invalid,
          { history: [], message: "hi" },
          "203.0.113.102",
          ORIGIN,
          undefined,
          null,
        )
      ).status,
      401,
    );
  assert.equal(
    (
      await chatPost(
        invalid,
        { history: [], message: "hi" },
        "203.0.113.102",
        ORIGIN,
        undefined,
        null,
      )
    ).status,
    429,
  );
  // Character length is below the limit, UTF-8 bytes exceed it.
  assert.equal(
    (await chatPost(invalid, null, "203.0.113.103", ORIGIN, "界".repeat(34000)))
      .status,
    413,
  );
  console.log(
    "PASS: Turnstile hostname/action, unauthenticated bursts, and streaming UTF-8 body limits fail closed.",
  );
} finally {
  await invalid.dispose();
}

async function readySocket(mf, ticket, ip = "198.51.100.1") {
  const response = await openRelay(mf, ticket.token, ip);
  assert.equal(response.status, 101);
  const ws = response.webSocket;
  ws.accept();
  await new Promise((resolve) =>
    ws.addEventListener(
      "message",
      (event) => {
        if (JSON.parse(event.data).setupComplete) resolve();
      },
      { once: true },
    ),
  );
  return ws;
}
async function nextMessage(ws) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("relay message timeout")),
      3000,
    );
    ws.addEventListener(
      "message",
      (ev) => {
        clearTimeout(timeout);
        resolve(JSON.parse(ev.data));
      },
      { once: true },
    );
  });
}
for (const mode of [
  "reported",
  "budget",
  "pause",
  "setup",
  "flood",
  "block",
  "timeout",
]) {
  const mf = worker({
    ...safetyVars,
    MOCK_LIVE_USAGE: mode,
    ...(mode === "timeout" ? { SESSION_MAX_SECONDS: "1" } : {}),
  });
  try {
    const ticket = await (await sessionTicket(mf)).json();
    const ws = await readySocket(mf, ticket);
    assert.equal((await openRelay(mf, ticket.token)).status, 401); // single use
    assert.equal((await sessionTicket(mf)).status, 429); // no overlapping paid engines
    const next = nextMessage(ws);
    if (mode === "pause") await adminCall(mf, "/admin/pause", "POST");
    else if (mode === "block")
      await adminCall(
        mf,
        `/admin/block?visitor=${claimsOf(await tokenFor(mf)).v}`,
        "POST",
      );
    else if (mode === "setup")
      ws.send(JSON.stringify({ setup: { model: "other-model" } }));
    else if (mode === "flood") {
      const data = Buffer.alloc(6400).toString("base64");
      for (let i = 0; i < 8; i++)
        ws.send(
          JSON.stringify({
            realtimeInput: {
              audio: { data, mimeType: "audio/pcm;rate=16000" },
            },
          }),
        );
    } else if (mode !== "timeout")
      ws.send(JSON.stringify({ realtimeInput: { text: "hello" } }));
    const m = await next;
    if (mode === "reported") {
      assert.ok(m.usageMetadata);
      ws.send(JSON.stringify({ irisClose: true }));
    } else if (mode === "budget") {
      assert.ok(m.usageMetadata);
      const notice = await nextMessage(ws);
      assert.equal(notice.irisNotice.code, "SESSION_BUDGET");
    } else assert.ok(m.irisNotice);
    await sleep(30);
    const record = await detailOf(mf, ticket.conversationId);
    assert.equal(record.requests.length, 1);
    if (mode === "reported")
      assert.equal(record.requests[0].cost_usd_micros, 13200); // missing modalities: 4000*3 +100*12
    if (mode === "budget")
      assert.equal(record.requests[0].cost_usd_micros, 42000);
    assert.equal((await statusOf(mf)).budgets.day.reservedUsd, 0);
  } finally {
    await mf.dispose();
  }
}
console.log(
  "PASS: live relay — one-use tickets, server-only setup, actual usage, budget stop, pause/block active sockets, paced audio, server deadline.",
);
const unused = worker(safetyVars);
try {
  await sessionTicket(unused);
  assert.equal((await statusOf(unused)).budgets.day.reservedUsd, 0.1);
  const ns = await unused.getDurableObjectNamespace("PORTFOLIO");
  await ns.get(ns.idFromName("v1-local-audit-store")).sweep(Date.now() + 61000);
  const status = await statusOf(unused);
  assert.equal(status.budgets.day.reservedUsd, 0);
  assert.equal(status.budgets.day.usedUsd, 0);
  console.log(
    "PASS: unused relay tickets expire and refund without ever calling the provider.",
  );
} finally {
  await unused.dispose();
}
