"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { connectVoice, type VoiceSession } from "./live.ts";
import { MicCapture, Player } from "./audio";
import { executeToolCall, type ConnectAction } from "./tools";
import type { RenderView } from "./render";
import { liveSeed, type HistoryTurn } from "./history";

import { authedFetch, visitorToken, VisitorError } from "./visitor";
import { ConversationLog } from "./log";

// One conversation, two engines. Voice and text go through the Worker to
// Gemini Live and Flash. The turns live here, so
// switching engines keeps the whole thread.
export type AgentStatus = "idle" | "connecting" | "live" | "ended" | "error";
export type Mode = "voice" | "text";
export type ViewRef = { title: string; view: RenderView };
export type Turn = {
  id: number;
  role: "user" | "assistant";
  text: string;
  hidden?: boolean; // screen events sent to the model, never shown
  views?: ViewRef[];
  via?: "voice"; // voice turns are saved by the browser; text turns by the Worker
  at?: number;
};
export type ConnectRequest = { action: ConnectAction; note?: string };

const ERRORS: Record<string, string> = {
  REQUEST_IN_PROGRESS:
    "Please wait for the current reply or end voice before starting another.",
  NETWORK_LIMIT:
    "This network has reached today’s assistant allowance. Please try again tomorrow or email Ayush.",
  RATE_LIMITED: "Please wait a moment before trying again.",
  BUDGET_EXHAUSTED:
    "The assistant is resting for now. Please browse the work or email Ayush.",
  AI_DISABLED: "The assistant is not switched on right now.",
  PROVIDER_UNAVAILABLE:
    "The voice service did not answer. Please try again in a moment.",
  PROVIDER_ERROR: "The assistant did not answer. Please try again.",
  STREAM_ABORTED: "The reply was interrupted. Please try again.",
  TOO_LARGE: "That message is too long.",
  VISITOR_LIMIT:
    "You have reached today's limit for one visitor. Please come back tomorrow, or email Ayush.",
  VISITOR_BLOCKED:
    "This browser can't use the assistant right now. Please email Ayush.",
  PAUSED: "The assistant is paused for a moment. Please email Ayush.",
  TURNSTILE_FAILED:
    "We couldn't verify this browser. Please reload the page and try again.",
  TURNSTILE_BLOCKED:
    "The browser check was blocked. Please allow challenges.cloudflare.com (or disable your blocker) and try again.",
  TURNSTILE_TIMEOUT:
    "The browser check took too long. Please reload the page and try again.",
  VISITOR_FAILED: "Could not verify this browser. Please try again.",
};

// Problems before a request even reaches the assistant (browser check, network).
const problem = (error: unknown, fallback: string) =>
  error instanceof VisitorError ? (ERRORS[error.code] ?? fallback) : fallback;

const clip = (text: string, max: number) => text.slice(0, max);

function historyOf(turns: Turn[]): HistoryTurn[] {
  return turns
    .filter((t) => t.text.trim() || t.views?.length)
    .slice(-40)
    .map((t) => {
      const screen = t.views?.length
        ? `\n[On screen: ${t.views.map((v) => v.title).join(", ")}]`
        : "";
      return { role: t.role, text: clip(t.text, 3800) + screen };
    });
}

export function useAgent() {
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [mode, setMode] = useState<Mode>("voice");
  const [error, setError] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [view, setView] = useState<RenderView | null>(null);
  const [connectRequest, setConnectRequest] = useState<ConnectRequest | null>(
    null,
  );
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [voiceOut, setVoiceOut] = useState(true);
  const [expiresAt, setExpiresAt] = useState(0);
  const [limitKind, setLimitKind] = useState<"conversation" | "visitor" | null>(
    null,
  );

  const turnsRef = useRef<Turn[]>([]);
  const session = useRef<VoiceSession | null>(null);
  const mic = useRef<MicCapture | null>(null);
  const player = useRef<Player | null>(null);
  const open = useRef<{ user: number | null; assistant: number | null }>({
    user: null,
    assistant: null,
  });
  const nextId = useRef(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gen = useRef(0); // bumps whenever a Live session is replaced or closed
  const statusRef = useRef<AgentStatus>("idle");
  const modeRef = useRef<Mode>("voice");
  const voiceOutRef = useRef(true);
  const conversationId = useRef("");
  const chatAbort = useRef<AbortController | null>(null);
  const limitRef = useRef(false);
  const warmed = useRef(false);
  const log = useRef<ConversationLog | null>(null);
  const logged = useRef(new Set<number>());
  const voiceUsage = useRef<Record<string, number> | null>(null);
  const record = () => (log.current ??= new ConversationLog());
  // The conversation id comes from the Worker; the record follows it.
  const adopt = useCallback((id: string) => {
    conversationId.current = id;
    (log.current ??= new ConversationLog()).setConversation(id);
  }, []);

  const updateStatus = useCallback((next: AgentStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);
  const updateMode = useCallback((next: Mode) => {
    modeRef.current = next;
    setMode(next);
  }, []);
  const updateTurns = useCallback((fn: (all: Turn[]) => Turn[]) => {
    turnsRef.current = fn(turnsRef.current);
    setTurns(turnsRef.current);
  }, []);

  const newTurn = useCallback(
    (role: Turn["role"], text: string, extra: Partial<Turn> = {}) => {
      const id = nextId.current++;
      updateTurns((all) => [...all, { id, role, text, ...extra }]);
      return id;
    },
    [updateTurns],
  );
  const appendTo = useCallback(
    (id: number, text: string) =>
      updateTurns((all) =>
        all.map((t) => (t.id === id ? { ...t, text: t.text + text } : t)),
      ),
    [updateTurns],
  );

  // A finished voice turn is saved for Ayush; text turns are saved by the Worker.
  const closeRole = useCallback(
    (role: "user" | "assistant", interrupted = false) => {
      const id = open.current[role];
      open.current[role] = null;
      if (id === null || logged.current.has(id)) return;
      const turn = turnsRef.current.find((t) => t.id === id);
      if (turn?.via !== "voice") return;
      logged.current.add(id);
      (log.current ??= new ConversationLog()).message(
        role,
        turn.text,
        interrupted ? "interrupted" : "complete",
        turn.at,
      );
    },
    [],
  );
  const closeOpen = useCallback(() => {
    closeRole("user");
    closeRole("assistant");
  }, [closeRole]);

  // Voice transcripts: a new speaker closes the other's open turn.
  const append = useCallback(
    (role: "user" | "assistant", text: string) => {
      if (!text) return;
      closeRole(role === "user" ? "assistant" : "user");
      const existing = open.current[role];
      if (existing !== null) return appendTo(existing, text);
      open.current[role] = newTurn(role, text, {
        via: "voice",
        at: Date.now(),
      });
    },
    [appendTo, closeRole, newTurn],
  );

  // A view belongs to the assistant turn that produced it, so the thread can
  // offer it again later.
  const showRendered = useCallback(
    (rendered: RenderView, turnId?: number) => {
      let target = turnId ?? open.current.assistant;
      if (target === null || target === undefined) {
        target = newTurn("assistant", "", { via: "voice", at: Date.now() });
        open.current.assistant = target;
      }
      const id = target;
      updateTurns((all) =>
        all.map((t) =>
          t.id === id
            ? {
                ...t,
                views: [
                  ...(t.views ?? []),
                  { title: rendered.title, view: rendered },
                ],
              }
            : t,
        ),
      );
      setView(rendered);
    },
    [newTurn, updateTurns],
  );

  const closeVoice = useCallback(() => {
    closeOpen();
    if (voiceUsage.current && log.current) {
      log.current.event("usage.reported", voiceUsage.current);
      voiceUsage.current = null;
    }
    gen.current++; // ignore anything the old session still emits
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    mic.current?.stop();
    mic.current = null;
    player.current?.close();
    player.current = null;
    const live = session.current;
    session.current = null;
    try {
      live?.close();
    } catch {}
    open.current = { user: null, assistant: null };
    setMicOn(false);
    setSpeaking(false);
    setExpiresAt(0);
  }, [closeOpen]);

  const stop = useCallback(
    (reason?: string) => {
      chatAbort.current?.abort();
      chatAbort.current = null;
      setThinking(false);
      closeVoice();
      if (conversationId.current && log.current) {
        log.current.event("conversation.ended", reason ? { reason } : {});
        void log.current.flush(true);
      }
      if (statusRef.current !== "error") updateStatus("ended");
      if (reason) setError(reason);
    },
    [closeVoice, updateStatus],
  );

  // Voice ran out (time or network): the conversation carries on by typing.
  const fallBackToText = useCallback(
    (notice: string) => {
      closeVoice();
      record().event("mode.text", { reason: "voice ended" });
      updateMode("text");
      setError(notice);
    },
    [closeVoice, updateMode],
  );

  const sendChat = useCallback(
    async (message: string, hidden = false) => {
      if (limitRef.current) return;
      const history = historyOf(turnsRef.current);
      newTurn("user", message, hidden ? { hidden: true } : {});
      open.current = { user: null, assistant: null };
      const assistantId = newTurn("assistant", "");
      open.current.assistant = assistantId;
      setThinking(true);
      setError("");
      const abort = new AbortController();
      chatAbort.current = abort;
      let produced = false;
      const finish = (problem?: string) => {
        setThinking(false);
        // Drop an empty placeholder when nothing came back.
        updateTurns((all) =>
          all.filter(
            (t) => t.id !== assistantId || t.text.trim() || t.views?.length,
          ),
        );
        open.current.assistant = null;
        if (problem) setError(problem);
      };
      try {
        const response = await authedFetch("/chat", {
          method: "POST",
          signal: abort.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: conversationId.current || undefined,
            history,
            message: clip(message, 1500),
            hidden: hidden || undefined,
          }),
        });
        if (!response.ok || !response.body) {
          const body = await response.json().catch(() => ({}));
          if (
            body.error === "CONVERSATION_LIMIT" ||
            body.error === "VISITOR_LIMIT"
          ) {
            limitRef.current = true;
            setLimitKind(
              body.error === "VISITOR_LIMIT" ? "visitor" : "conversation",
            );
            return finish();
          }
          return finish(ERRORS[body.error] ?? "The assistant did not answer.");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (value) buffer += decoder.decode(value, { stream: true });
          let split: number;
          while ((split = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            const line = block.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            let event: Record<string, any>;
            try {
              event = JSON.parse(line.slice(5));
            } catch {
              continue;
            }
            if (event.type === "start") adopt(event.conversationId);
            else if (event.type === "text") {
              produced = true;
              setThinking(false);
              appendTo(assistantId, event.delta);
            } else if (event.type === "effect") {
              produced = true;
              if (event.effect.type === "render")
                showRendered(event.effect.view, assistantId);
              else if (event.effect.type === "connect")
                setConnectRequest({
                  action: event.effect.action,
                  note: event.effect.note,
                });
            } else if (event.type === "done") {
              if (event.tokensUsed >= event.tokenCap) {
                limitRef.current = true;
                setLimitKind("conversation");
              }
            } else if (event.type === "error")
              return finish(produced ? "" : ERRORS[event.code]);
          }
          if (done) break;
        }
        finish();
      } catch (e) {
        if ((e as Error).name === "AbortError") return finish();
        finish(problem(e, "The connection was interrupted. Please try again."));
      } finally {
        if (chatAbort.current === abort) chatAbort.current = null;
      }
    },
    [adopt, appendTo, newTurn, showRendered, updateTurns],
  );

  const startVoice = useCallback(
    async ({ context, resume }: { context?: string; resume?: boolean }) => {
      if (session.current) return;
      const myGen = ++gen.current;
      updateStatus("connecting");
      updateMode("voice");
      setError("");
      voiceOutRef.current = true;
      setVoiceOut(true);
      let pendingMic: MicCapture | null = null;
      try {
        const live: { current: VoiceSession | null } = { current: null };
        let micError = "";
        try {
          pendingMic = await MicCapture.start((pcm) => {
            let binary = "";
            for (const b of pcm) binary += String.fromCharCode(b);
            live.current?.sendRealtimeInput({
              audio: { data: btoa(binary), mimeType: "audio/pcm;rate=16000" },
            });
          });
        } catch {
          micError = "Microphone unavailable. You can type instead.";
        }
        if (!pendingMic) {
          // Without a microphone there is nothing for Live to do: use text.
          updateMode("text");
          updateStatus("live");
          setError(micError);
          if (!resume)
            void sendChat(
              context
                ? `[visitor joined while viewing: ${context}]`
                : "[visitor joined]",
              true,
            );
          return;
        }
        const response = await authedFetch("/session", {
          method: "POST",
          ...(conversationId.current
            ? {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  conversationId: conversationId.current,
                }),
              }
            : {}),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.token) {
          pendingMic.stop();
          pendingMic = null;
          throw new Error(
            ERRORS[body.error] ?? "Could not start the conversation.",
          );
        }
        if (myGen !== gen.current) {
          pendingMic.stop();
          return;
        }
        if (typeof body.conversationId === "string") adopt(body.conversationId);
        const p = new Player(false);
        p.onSpeakingChange = setSpeaking;
        player.current = p;
        mic.current = pendingMic;
        void p.resume();
        const s = await connectVoice(body.token, {
          onmessage: (m) => {
            if (myGen !== gen.current) return;
            for (const call of m.toolCall?.functionCalls ?? []) {
              const result = executeToolCall(call);
              if (result.effect?.type === "render") {
                showRendered(result.effect.view);
                record().event("view.rendered", result.effect.view);
              }
              if (result.effect?.type === "connect") {
                setConnectRequest({
                  action: result.effect.action,
                  note: result.effect.note,
                });
                record().event("connect.requested", {
                  action: result.effect.action,
                  note: result.effect.note,
                });
              }
              session.current?.sendToolResponse({
                functionResponses: [result.functionResponse as never],
              });
            }
            const usage = m.usageMetadata;
            if (usage)
              voiceUsage.current = {
                promptTokens: usage.promptTokenCount ?? 0,
                responseTokens: usage.responseTokenCount ?? 0,
                totalTokens: usage.totalTokenCount ?? 0,
              };
            const sc = m.serverContent;
            if (!sc) return;
            for (const part of sc.modelTurn?.parts ?? [])
              if (part.inlineData?.data)
                player.current?.push(part.inlineData.data);
            if (sc.interrupted) {
              player.current?.interrupt();
              closeRole("assistant", true);
            }
            if (sc.inputTranscription?.text)
              append("user", sc.inputTranscription.text);
            if (sc.outputTranscription?.text)
              append("assistant", sc.outputTranscription.text);
            if (sc.turnComplete) closeOpen();
          },
          onerror: () => {
            if (myGen !== gen.current) return;
            setError("The voice connection was interrupted.");
            record().event("error", { where: "voice" });
          },
          onclose: () => {
            if (myGen !== gen.current) return;
            fallBackToText(
              "The voice connection ended. You can keep going by typing.",
            );
          },
        });
        if (myGen !== gen.current) {
          s.close();
          pendingMic.stop();
          player.current?.close();
          return;
        }
        session.current = s;
        live.current = s;
        record().event("mode.voice", { resumed: !!resume });
        setMicOn(true);
        setMicMuted(false);
        setExpiresAt(body.expiresAt);
        updateStatus("live");
        timer.current = setTimeout(
          () =>
            fallBackToText(
              "Voice time is up. You can keep going by typing, or start a new conversation.",
            ),
          Math.max(0, body.expiresAt - Date.now() - 2000),
        );
        if (resume) {
          // Hand the earlier thread to the voice model before it speaks.
          const seed = liveSeed(historyOf(turnsRef.current));
          if (seed.length)
            s.sendClientContent({ turns: seed, turnComplete: false });
          s.sendRealtimeInput({ text: "[visitor switched back to voice]" });
        } else
          s.sendRealtimeInput({
            text: context
              ? `[visitor joined while viewing: ${context}]`
              : "[visitor joined]",
          });
        if (micError) setError(micError);
      } catch (e) {
        pendingMic?.stop();
        closeVoice();
        if (resume) {
          // Stay in the thread the visitor already has.
          updateMode("text");
          updateStatus("live");
        } else updateStatus("error");
        setError(
          problem(
            e,
            e instanceof Error && !(e instanceof VisitorError)
              ? e.message
              : "Could not start the conversation.",
          ),
        );
      }
    },
    [
      adopt,
      append,
      closeOpen,
      closeRole,
      closeVoice,
      fallBackToText,
      sendChat,
      showRendered,
      updateMode,
      updateStatus,
    ],
  );

  const start = useCallback(
    async ({
      voice,
      context,
      keepView,
    }: {
      voice: boolean;
      context?: string; // page the visitor already has open
      keepView?: boolean;
    }) => {
      if (statusRef.current === "connecting" || statusRef.current === "live")
        return;
      // Run the browser check in the background so the first message is not slowed by it.
      if (!warmed.current) {
        warmed.current = true;
        void visitorToken().catch(() => {});
      }
      turnsRef.current = [];
      setTurns([]);
      open.current = { user: null, assistant: null };
      logged.current.clear();
      void log.current?.flush(true);
      adopt("");
      limitRef.current = false;
      setLimitKind(null);
      setConnectRequest(null);
      if (!keepView) setView(null);
      if (voice) return startVoice({ context });
      updateMode("text");
      updateStatus("live");
      setError("");
      void sendChat(
        context
          ? `[visitor joined while viewing: ${context}]`
          : "[visitor joined]",
        true,
      );
    },
    [adopt, sendChat, startVoice, updateMode, updateStatus],
  );

  // Typing while talking pauses voice and moves the same thread to text.
  const pauseVoice = useCallback(() => {
    if (modeRef.current !== "voice" || statusRef.current !== "live") return;
    closeVoice();
    record().event("mode.text", { reason: "visitor typed" });
    updateMode("text");
    setError("");
  }, [closeVoice, updateMode]);

  const resumeVoice = useCallback(() => {
    if (modeRef.current === "voice" || statusRef.current !== "live") return;
    chatAbort.current?.abort();
    setThinking(false);
    void startVoice({ resume: true });
  }, [startVoice]);

  const sendText = useCallback(
    (text: string) => {
      const clean = text.trim().slice(0, 1500);
      if (!clean || statusRef.current !== "live" || limitRef.current) return;
      if (modeRef.current === "voice") pauseVoice();
      void sendChat(clean);
    },
    [pauseVoice, sendChat],
  );

  const toggleMic = useCallback(() => {
    if (!mic.current) return;
    const next = !mic.current.muted;
    mic.current.setMuted(next);
    setMicMuted(next);
  }, []);

  const toggleVoice = useCallback(() => {
    voiceOutRef.current = !voiceOutRef.current;
    player.current?.setMuted(!voiceOutRef.current);
    setVoiceOut(voiceOutRef.current);
  }, []);

  // Screen events (a click on a project) reach the model as bracketed text, not as a visible turn.
  const notify = useCallback(
    (text: string) => {
      if (statusRef.current !== "live") return;
      if (modeRef.current === "voice") {
        session.current?.sendRealtimeInput({ text });
        record().event("screen.event", { text });
      } else void sendChat(text, true);
    },
    [sendChat],
  );

  const reset = useCallback(() => {
    stop();
    turnsRef.current = [];
    setTurns([]);
    setView(null);
    setConnectRequest(null);
    setError("");
    logged.current.clear();
    adopt("");
    limitRef.current = false;
    setLimitKind(null);
    updateStatus("idle");
  }, [adopt, stop, updateStatus]);

  const level = useCallback(() => player.current?.level() ?? 0, []);
  const clearView = useCallback(() => setView(null), []);

  // Tear down only on a real unmount. React's dev mode mounts, unmounts and
  // remounts once; the remount sets `alive` again before this timer fires.
  const alive = useRef(false);
  useEffect(() => {
    // Hiding the tab sends what is queued; a closing page also saves the turn in progress.
    const hide = () => {
      if (document.visibilityState === "hidden") void log.current?.flush(true);
    };
    const close = () => {
      closeOpen();
      void log.current?.flush(true);
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", close);
    alive.current = true;
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", close);
      alive.current = false;
      setTimeout(() => {
        if (alive.current) return;
        chatAbort.current?.abort();
        closeVoice();
      }, 0);
    };
  }, [closeOpen, closeVoice]);

  return {
    status,
    mode,
    error,
    turns,
    view,
    connectRequest,
    speaking,
    thinking,
    micOn,
    micMuted,
    voiceOut,
    expiresAt,
    limitReached: limitKind !== null,
    limitKind,
    start,
    stop,
    reset,
    sendText,
    pauseVoice,
    resumeVoice,
    toggleMic,
    toggleVoice,
    level,
    clearView,
    showView: setView,
    notify,
    dismissConnect: () => setConnectRequest(null),
    conversationId: () => conversationId.current,
  };
}
