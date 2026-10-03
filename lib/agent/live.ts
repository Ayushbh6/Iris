// Same-origin voice transport. Provider credentials and setup stay on the Worker.
import type {
  LiveServerMessage,
  Content,
  LiveSendRealtimeInputParameters,
  LiveSendClientContentParameters,
  LiveSendToolResponseParameters,
} from "@google/genai";
import { AGENT_URL } from "./visitor.ts";
export type VoiceSession = {
  sendRealtimeInput(input: LiveSendRealtimeInputParameters): void;
  sendClientContent(input: LiveSendClientContentParameters): void;
  sendToolResponse(input: LiveSendToolResponseParameters): void;
  close(): void;
};
export function connectVoice(
  token: string,
  callbacks: {
    onmessage(m: LiveServerMessage): void;
    onerror(): void;
    onclose(event: CloseEvent): void;
  },
  base = AGENT_URL,
): Promise<VoiceSession> {
  const url = new URL(
    `${base}/live`,
    typeof location === "undefined" ? "http://localhost" : location.href,
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, ["iris", `ticket.${token}`]);
    let settled = false;
    let closing = false;
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Voice connection timed out."));
    }, 15_000);
    const session: VoiceSession = {
      sendRealtimeInput: (realtimeInput) => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ realtimeInput }));
      },
      sendClientContent: (input) => {
        // Bound the seed while keeping the newest complete turns.
        let turns = Array.isArray(input.turns)
          ? input.turns
              .filter(
                (t): t is Content =>
                  typeof t === "object" &&
                  t !== null &&
                  "role" in t &&
                  ["user", "model"].includes(t.role ?? ""),
              )
              .slice(-20)
          : [];
        while (
          new TextEncoder().encode(JSON.stringify(turns)).length > 7500 &&
          turns.length
        )
          turns = turns.slice(1);
        while (turns.length && turns[0].role !== "user") turns = turns.slice(1);
        if (turns.length && ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ clientContent: { ...input, turns } }));
      },
      sendToolResponse: () => {}, // the server validates and answers tool calls
      close: () => {
        closing = true;
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ irisClose: true }));
        if (ws.readyState !== WebSocket.OPEN) ws.close(1000, "VISITOR_ENDED");
        else
          setTimeout(() => {
            if (ws.readyState < WebSocket.CLOSING)
              ws.close(1000, "VISITOR_ENDED");
          }, 500);
      },
    };
    ws.onmessage = (event) => {
      try {
        const m = JSON.parse(event.data);
        if (m.setupComplete && !settled) {
          settled = true;
          clearTimeout(timeout);
          resolve(session);
        }
        if (m.irisNotice) {
          if (!settled)
            reject(new Error(`Voice could not start (${m.irisNotice.code}).`));
          return;
        }
        callbacks.onmessage(m);
      } catch {
        callbacks.onerror();
      }
    };
    ws.onerror = () => {
      if (closing) return;
      clearTimeout(timeout);
      if (!settled) reject(new Error("Could not connect to voice."));
      callbacks.onerror();
    };
    ws.onclose = (event) => {
      clearTimeout(timeout);
      if (!settled) reject(new Error("Could not connect to voice."));
      callbacks.onclose(event);
    };
  });
}
