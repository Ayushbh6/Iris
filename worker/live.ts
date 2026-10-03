import {
  buildLiveConfig,
  LIVE_MODEL,
  LIVE_API_VERSION,
  PRICING_USD_PER_M,
} from "../lib/agent/config.ts";
import { executeToolCall } from "../lib/agent/tools.ts";
import { bytes, liveCost } from "./accounting.ts";

export type LiveTicket = {
  token: string;
  operationKey: string;
  amount: number;
  visitorId: string;
  network: string;
  conversationId: string;
  createdAt: number;
  connectBy: number;
  expiresAt: number;
};
type Callbacks = {
  register(close: () => void): void;
  defer(work: Promise<void>): void;
  finish(
    cost: number,
    usage: Record<string, any>[],
    uncertain: boolean,
    reason: string,
  ): Promise<void>;
};
// Keep enough credit for a bounded generation already in flight. Provider usage
// arrives after generation; this cushion is deliberately charged at audio rates.
export const LIVE_CONTEXT_CEILING = 16_000;
export const LIVE_OUTPUT_CEILING = 2048;
export const LIVE_CUSHION =
  LIVE_CONTEXT_CEILING * PRICING_USD_PER_M.inputAudio +
  LIVE_OUTPUT_CEILING * PRICING_USD_PER_M.outputAudio;

function setup() {
  const c = buildLiveConfig();
  return {
    setup: {
      model: `models/${LIVE_MODEL}`,
      generationConfig: {
        responseModalities: c.responseModalities,
        speechConfig: c.speechConfig,
        maxOutputTokens: LIVE_OUTPUT_CEILING,
        temperature: c.temperature,
      },
      systemInstruction: { parts: [{ text: c.systemInstruction }] },
      tools: c.tools,
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      contextWindowCompression: c.contextWindowCompression,
    },
  };
}

export async function relayLive(
  _request: Request,
  apiKey: string,
  ticket: LiveTicket,
  cb: Callbacks,
): Promise<Response> {
  const pair = new WebSocketPair(),
    client = pair[0],
    socket = pair[1];
  socket.accept();
  let upstream: WebSocket | undefined,
    finished = false,
    ready = false;
  let cost = 0,
    inputPending = false,
    generating = false,
    lastUsage = false;
  let audioCredit = 32_000,
    creditAt = Date.now(),
    textBytes = 0,
    seedUsed = false;
  let messageTimes: number[] = [],
    audioBytes = 0;
  let queuedText: string | null = null;
  let providerMessages = Promise.resolve();
  const usage: Record<string, any>[] = [];
  const stop = (reason: string, definitelyUnbilled = false) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    clearTimeout(connectTimer);
    const uncertain =
      !definitelyUnbilled && (inputPending || generating || !lastUsage);
    const charged = definitelyUnbilled
      ? 0
      : uncertain
        ? Math.max(cost, ticket.amount)
        : cost;
    try {
      socket.send(JSON.stringify({ irisNotice: { code: reason } }));
      socket.close(1000, reason);
    } catch {}
    try {
      upstream?.close(1000, reason);
    } catch {}
    // Durable Object storage writes keep this event alive; failures retain the
    // original reservation rather than returning credits for unknown usage.
    void cb.finish(charged, usage, uncertain, reason).catch(() => {});
  };
  const timer = setTimeout(
    () => stop("SESSION_EXPIRED"),
    Math.max(1, ticket.expiresAt - Date.now()),
  );
  const connectTimer = setTimeout(
    () => stop("PROVIDER_UNAVAILABLE", !ready),
    15_000,
  );
  cb.register(() => stop("PAUSED"));
  socket.addEventListener("close", () => stop("BROWSER_CLOSED"));
  socket.addEventListener("error", () => stop("CONNECTION_ENDED"));
  socket.addEventListener("message", (event) => {
    if (finished) return;
    if (
      !ready ||
      !upstream ||
      typeof event.data !== "string" ||
      bytes(event.data) > 16_000
    )
      return stop("BAD_REQUEST");
    try {
      const m = JSON.parse(event.data);
      const now = Date.now();
      messageTimes = messageTimes.filter((t) => t > now - 1000);
      if (messageTimes.length >= 50) return stop("RATE_LIMITED");
      messageTimes.push(now);
      if (m.irisClose === true) return stop("CONNECTION_ENDED");
      if (Object.keys(m).length !== 1) return stop("BAD_REQUEST");
      // Tool responses are server-produced; a browser can only acknowledge UI.
      if (m.toolResponse) return;
      if (cost + LIVE_CUSHION > ticket.amount) return stop("SESSION_BUDGET");
      if (m.clientContent) {
        const c = m.clientContent;
        if (
          seedUsed ||
          c.turnComplete !== false ||
          !Array.isArray(c.turns) ||
          c.turns.length > 20
        )
          return stop("BAD_REQUEST");
        for (const t of c.turns) {
          if (!["user", "model"].includes(t.role) || !Array.isArray(t.parts))
            return stop("BAD_REQUEST");
          for (const p of t.parts) {
            if (Object.keys(p).length !== 1 || typeof p.text !== "string")
              return stop("BAD_REQUEST");
            textBytes += bytes(p.text);
          }
        }
        if (textBytes > 8000) return stop("TOO_LARGE");
        seedUsed = true;
      } else if (m.realtimeInput) {
        const r = m.realtimeInput;
        if (Object.keys(r).length !== 1) return stop("BAD_REQUEST");
        if (typeof r.text === "string") {
          if (inputPending || generating) {
            // A screen click can arrive during a spoken reply. Keep its latest
            // notification until the current generation settles.
            if (bytes(r.text) > 1500) return stop("TOO_LARGE");
            queuedText = event.data;
            return;
          }
          if (bytes(r.text) > 1500) return stop("TOO_LARGE");
          textBytes += bytes(r.text);
          if (textBytes > 16_000) return stop("TOO_LARGE");
          inputPending = true;
        } else if (r.audio) {
          const a = r.audio;
          if (
            a.mimeType !== "audio/pcm;rate=16000" ||
            typeof a.data !== "string" ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(a.data)
          )
            return stop("BAD_REQUEST");
          const n = atob(a.data).length;
          if (!n || n % 2 || n > 6400) return stop("BAD_REQUEST");
          audioCredit = Math.min(32_000, audioCredit + (now - creditAt) * 32);
          creditAt = now;
          if (n > audioCredit) return stop("RATE_LIMITED");
          audioCredit -= n;
          audioBytes += n;
          if (audioBytes > 32_000 * 300) return stop("SESSION_EXPIRED");
        } else if (r.audioStreamEnd !== true) return stop("BAD_REQUEST");
      } else return stop("BAD_REQUEST");
      upstream.send(event.data);
    } catch {
      stop("BAD_REQUEST");
    }
  });
  cb.defer(
    (async () => {
      try {
        const handshake = new AbortController();
        const deadline = setTimeout(() => handshake.abort(), 10_000);
        const response = await fetch(
          `https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${LIVE_API_VERSION}.GenerativeService.BidiGenerateContent`,
          {
            headers: { Upgrade: "websocket", "x-goog-api-key": apiKey },
            signal: handshake.signal,
          },
        );
        clearTimeout(deadline);
        if (!response.webSocket || response.status !== 101) {
          console.error(
            "Live upstream rejected",
            response.status,
            (await response.text())
              .replaceAll(apiKey, "[redacted]")
              .slice(0, 400),
          );
          stop(
            "PROVIDER_UNAVAILABLE",
            [400, 401, 403, 404, 429].includes(response.status),
          );
          return;
        }
        upstream = response.webSocket;
        upstream.accept();
        upstream.addEventListener("message", (event) => {
          providerMessages = providerMessages.then(async () => {
            if (finished) return;
            try {
              const data = event.data as any;
              const raw =
                typeof data === "string"
                  ? data
                  : typeof data.text === "function"
                    ? await data.text()
                    : new TextDecoder().decode(data);
              const m = JSON.parse(raw);
              if (m.setupComplete) {
                ready = true;
                clearTimeout(connectTimer);
              }
              if ((m.serverContent?.modelTurn || m.toolCall) && !generating) {
                generating = true;
                lastUsage = false;
              }
              if (m.usageMetadata) {
                const u = m.usageMetadata;
                if (
                  ![
                    u.promptTokenCount,
                    u.responseTokenCount,
                    u.totalTokenCount,
                  ].every((n) => Number.isSafeInteger(n) && n >= 0)
                )
                  return stop("MISSING_USAGE");
                cost += liveCost(u);
                usage.push(u);
                lastUsage = true;
                inputPending = false;
                if (
                  cost > ticket.amount ||
                  u.promptTokenCount > LIVE_CONTEXT_CEILING
                )
                  return stop("SESSION_BUDGET");
              }
              if (m.serverContent?.turnComplete) {
                generating = false;
                // A completion with no usage is ambiguous and consumes its reserve.
                if (!lastUsage) return stop("MISSING_USAGE");
              }
              socket.send(raw);
              if (m.toolCall) {
                if (cost + LIVE_CUSHION > ticket.amount)
                  return stop("SESSION_BUDGET");
                const calls = m.toolCall.functionCalls ?? [];
                if (calls.length > 4) return stop("BAD_REQUEST");
                const functionResponses = calls.map(
                  (call: any) => executeToolCall(call).functionResponse,
                );
                upstream!.send(
                  JSON.stringify({ toolResponse: { functionResponses } }),
                );
                inputPending = true;
              }
              if (m.serverContent?.turnComplete) {
                if (cost + LIVE_CUSHION > ticket.amount)
                  return stop("SESSION_BUDGET");
                if (queuedText) {
                  const pending = queuedText;
                  queuedText = null;
                  const text = JSON.parse(pending).realtimeInput.text;
                  textBytes += bytes(text);
                  if (textBytes > 16_000) return stop("TOO_LARGE");
                  inputPending = true;
                  upstream!.send(pending);
                }
              }
            } catch (error) {
              console.error(
                "Live message failed",
                String(error).replaceAll(apiKey, "[redacted]").slice(0, 400),
              );
              stop("PROVIDER_ERROR");
            }
          });
        });
        upstream.addEventListener("close", (event) => {
          if (!finished)
            console.error(
              "Live upstream closed",
              event.code,
              event.reason.replaceAll(apiKey, "[redacted]").slice(0, 400),
            );
          stop("PROVIDER_CLOSED");
        });
        upstream.addEventListener("error", (event) => {
          console.error(
            "Live upstream error",
            String((event as any).message)
              .replaceAll(apiKey, "[redacted]")
              .slice(0, 400),
          );
          stop("PROVIDER_ERROR");
        });
        upstream.send(JSON.stringify(setup()));
      } catch (error) {
        console.error(
          "Live connection failed",
          String(error).replaceAll(apiKey, "[redacted]"),
        );
        stop("PROVIDER_UNAVAILABLE");
      }
    })(),
  );
  return new Response(null, {
    status: 101,
    webSocket: client,
    headers: { "Sec-WebSocket-Protocol": "iris" },
  });
}
