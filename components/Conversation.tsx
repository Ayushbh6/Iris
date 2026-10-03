"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  AudioLines,
  ChevronLeft,
  FileText,
  Keyboard,
  Layers,
  Mic,
  MicOff,
  PanelLeft,
  Plus,
  Send,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { ProjectId } from "../lib/content";
import { useAgent, type ViewRef } from "../lib/agent/useAgent";
import {
  EXPLORE_ITEMS,
  explore,
  exploreView,
  type ExploreId,
} from "../lib/explore";
import GenerativeView, { LINKS } from "./GenerativeView";
import LeaveMessage from "./LeaveMessage";

type Props = {
  initialMode: "voice" | "text" | "project";
  initialProject?: ProjectId;
  onClose: () => void;
};

const DESKTOP = "(min-width: 900px)";
const EMAIL = "mailto:bhatt.ayush.1998@gmail.com";

export default function Conversation({
  initialMode,
  initialProject,
  onClose,
}: Props) {
  const agent = useAgent();
  const { start, status, level } = agent;
  const root = useRef<HTMLDivElement>(null);
  const orb = useRef<HTMLDivElement>(null);
  const mini = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const [sidebar, setSidebar] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DESKTOP).matches,
  );
  const [input, setInput] = useState("");
  const [active, setActive] = useState<ExploreId | null>(null);
  const lastVoice = useRef(initialMode !== "text");
  const started = useRef(false);
  const notifyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const live = status === "live";
  const connecting = status === "connecting";
  const idle = status === "idle" || status === "ended" || status === "error";
  const textMode = agent.mode === "text" && status !== "idle";
  const hasView = !!agent.view;
  const shown = agent.turns.filter((t) => !t.hidden);
  const lastAssistant = [...shown]
    .reverse()
    .find((t) => t.role === "assistant" && t.text.trim());
  const lastUser = [...shown].reverse().find((t) => t.role === "user");

  const orbState = connecting
    ? "connecting"
    : live && agent.mode === "voice"
      ? agent.speaking
        ? "speaking"
        : agent.micOn && !agent.micMuted
          ? "listening"
          : "idle"
      : live && agent.thinking
        ? "connecting"
        : live
          ? "idle"
          : "off";
  const statusText =
    orbState === "connecting"
      ? agent.thinking
        ? "Thinking…"
        : "Connecting…"
      : orbState === "speaking"
        ? "Speaking"
        : orbState === "listening"
          ? "Listening"
          : live
            ? agent.mode === "voice"
              ? "Microphone muted"
              : "Ready"
            : status === "ended"
              ? "Conversation ended"
              : status === "error"
                ? "Could not connect"
                : "Ready";

  const openExplore = useCallback(
    (id: ExploreId, notify: boolean) => {
      setActive(id);
      agent.showView(exploreView(id));
      if (window.matchMedia(DESKTOP).matches === false) setSidebar(false);
      if (!notify) return;
      if (notifyTimer.current) clearTimeout(notifyTimer.current);
      // Wait a moment so rapid clicking does not trigger a reply per click.
      notifyTimer.current = setTimeout(
        () => agent.notify(`[visitor opened ${explore.event(id)}]`),
        700,
      );
    },
    [agent],
  );

  // Voice and text openings start straight away; opening a project from the
  // landing page shows that page and waits for the visitor to choose Talk or Type.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (initialMode === "project") {
      const id: ExploreId =
        initialProject === "sec"
          ? "sec_summariser"
          : (initialProject ?? "socrates");
      setActive(id);
      agent.showView(exploreView(id));
      return;
    }
    void start({ voice: initialMode === "voice" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      if (notifyTimer.current) clearTimeout(notifyTimer.current);
    },
    [],
  );

  // Pulse the orbs with the assistant's voice.
  useEffect(() => {
    if (orbState !== "speaking") {
      orb.current?.style.setProperty("--level", "0");
      mini.current?.style.setProperty("--level", "0");
      return;
    }
    let frame = requestAnimationFrame(function tick() {
      const value = String(level());
      orb.current?.style.setProperty("--level", value);
      mini.current?.style.setProperty("--level", value);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [orbState, level]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [agent.turns, agent.thinking, textMode]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !window.matchMedia(DESKTOP).matches)
        setSidebar(false);
      if (e.key === "Tab") {
        const items = Array.from(
          root.current?.querySelectorAll<HTMLElement>("button,a[href],input") ??
            [],
        ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent);
        const first = items[0],
          last = items.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === root.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);

  function begin(voice: boolean) {
    lastVoice.current = voice;
    void start({
      voice,
      keepView: true,
      context: active ? explore.event(active) : undefined,
    });
  }
  function newConversation() {
    agent.reset();
    setActive(null);
    setInput("");
    if (!window.matchMedia(DESKTOP).matches) setSidebar(false);
    void start({ voice: lastVoice.current });
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    agent.sendText(input);
    setInput("");
  }
  function closeView() {
    setActive(null);
    agent.clearView();
  }
  function reopen(view: ViewRef) {
    setActive(null);
    agent.showView(view.view);
  }

  const connect = agent.connectRequest;
  const connectLinks = !connect
    ? []
    : connect.action === "download_cv"
      ? [LINKS.cv]
      : connect.action === "leave_message"
        ? []
        : [LINKS[connect.action]];

  const subtitle = lastAssistant?.text ?? "";
  const subtitleSize =
    subtitle.length > 260 ? "sm" : subtitle.length > 140 ? "md" : "lg";

  return (
    <div
      className={`cv${sidebar ? " sidebar-open" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Conversation with Iris, Ayush's assistant"
      ref={root}
      tabIndex={-1}
    >
      <header className="cv-header">
        <div className="cv-header-left">
          <button
            className="cv-icon"
            onClick={() => setSidebar((s) => !s)}
            aria-label={sidebar ? "Hide sidebar" : "Show sidebar"}
            aria-expanded={sidebar}
          >
            <PanelLeft size={19} />
          </button>
          <span className="cv-wordmark">Ayush Bhattacharya</span>
        </div>
        <button className="cv-home" onClick={onClose}>
          <ChevronLeft size={16} /> Home
        </button>
      </header>

      <div className="cv-body">
        <div
          className="cv-scrim"
          onClick={() => setSidebar(false)}
          aria-hidden="true"
        />
        <aside className="cv-sidebar" aria-label="Sidebar" inert={!sidebar}>
          <button className="cv-new" onClick={newConversation}>
            <Plus size={16} /> New conversation
          </button>
          <p className="cv-label">EXPLORE</p>
          <nav>
            {EXPLORE_ITEMS.map((item) => (
              <button
                key={item.id}
                className={active === item.id && hasView ? "active" : ""}
                onClick={() => openExplore(item.id, live)}
              >
                <span>{item.number}</span>
                {item.label}
                <ArrowUpRight size={14} />
              </button>
            ))}
            <a href={LINKS.cv.href} target="_blank" rel="noreferrer">
              <FileText size={15} />
              View CV <ArrowUpRight size={14} />
            </a>
          </nav>
          <p className="cv-side-note">
            Ask Iris anything out loud or in writing, or open a page and she
            will talk you through it.
          </p>
        </aside>

        <main className="cv-main">
          <div className="cv-stage">
            {textMode ? (
              <div className="cv-thread" ref={thread} key="thread">
                <div className="cv-thread-inner">
                  <div className="cv-thread-head">
                    <div
                      className={`orb mini ${orbState}`}
                      ref={orb}
                      aria-hidden="true"
                    >
                      <i />
                    </div>
                    <span>{statusText}</span>
                  </div>
                  {shown.map((t) => (
                    <div className={`cv-msg ${t.role}`} key={t.id}>
                      {t.text.trim() && <p>{t.text}</p>}
                      {t.views?.map((v, i) => (
                        <button
                          className="cv-chip"
                          key={i}
                          onClick={() => reopen(v)}
                        >
                          <Layers size={14} />
                          <span>{v.title}</span>
                          <em>Open</em>
                        </button>
                      ))}
                    </div>
                  ))}
                  {agent.thinking &&
                    !(lastAssistant && agent.turns.at(-1)?.text.trim()) && (
                      <div className="cv-msg assistant" aria-label="Thinking">
                        <span className="cv-dots">
                          <b />
                          <b />
                          <b />
                        </span>
                      </div>
                    )}
                </div>
              </div>
            ) : (
              <div className="cv-orb-stage" key="orb">
                <div className={`orb ${orbState}`} ref={orb} aria-hidden="true">
                  <i />
                </div>
                <p className="cv-status" aria-live="polite">
                  {statusText}
                </p>
                <div className="cv-subtitle" aria-live="polite">
                  {lastUser && live && <p className="you">{lastUser.text}</p>}
                  {lastAssistant ? (
                    <p
                      className={`assistant ${subtitleSize}`}
                      key={lastAssistant.id}
                    >
                      {lastAssistant.text}
                    </p>
                  ) : (
                    idle &&
                    !agent.error && (
                      <p className="assistant lg">
                        Talk with Iris, an assistant that knows Ayush’s work.
                      </p>
                    )
                  )}
                </div>
              </div>
            )}

            {hasView && agent.view && (
              <div className="cv-overlay" key={agent.view.title}>
                <div className="cv-content">
                  <button className="cv-close-view" onClick={closeView}>
                    <X size={15} /> Close
                  </button>
                  <GenerativeView
                    view={agent.view}
                    eyebrow={
                      active
                        ? active === "experience"
                          ? "BACKGROUND"
                          : "SELECTED WORK"
                        : "COMPOSED BY THE ASSISTANT"
                    }
                  />
                </div>
              </div>
            )}
            {connect?.action === "leave_message" && (
              <LeaveMessage
                note={connect.note}
                conversationId={agent.conversationId}
                onClose={agent.dismissConnect}
              />
            )}
            {connect && connectLinks.length > 0 && (
              <div className="connect-card" role="status">
                <span className="eyebrow">
                  {connect.action === "leave_message"
                    ? "LEAVE A MESSAGE"
                    : "FOR YOU"}
                </span>
                {connectLinks.map((l) => (
                  <a
                    className="inline-link"
                    key={l.href}
                    href={l.href}
                    target={l.href.startsWith("mailto") ? undefined : "_blank"}
                    rel="noreferrer"
                  >
                    {l.label} <ArrowUpRight size={16} />
                  </a>
                ))}
                <button
                  className="connect-dismiss"
                  onClick={agent.dismissConnect}
                  aria-label="Dismiss"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>

          <footer className="cv-footer">
            {hasView && (
              <div className="cv-miniline">
                <div
                  className={`orb mini ${orbState}`}
                  ref={mini}
                  aria-hidden="true"
                >
                  <i />
                </div>
                <div className="cv-caption" aria-live="polite">
                  <span>{statusText}</span>
                  {lastAssistant && <p>{lastAssistant.text}</p>}
                </div>
              </div>
            )}
            {live && agent.limitReached && (
              <div className="cv-limit" role="status">
                <p>
                  {agent.limitKind === "visitor"
                    ? "You have reached today's limit for one visitor. Please come back tomorrow, or reach Ayush directly."
                    : "That is as far as this conversation can go. To keep talking, reach Ayush directly."}
                </p>
                <div>
                  <a className="inline-link" href={EMAIL}>
                    Email Ayush <ArrowUpRight size={15} />
                  </a>
                  <a
                    className="inline-link"
                    href={LINKS.linkedin.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    LinkedIn <ArrowUpRight size={15} />
                  </a>
                  <button className="cv-secondary" onClick={newConversation}>
                    New conversation
                  </button>
                </div>
              </div>
            )}
            {live && !agent.limitReached && (
              <form onSubmit={submit} className="cv-composer">
                {agent.mode === "voice" ? (
                  <button
                    type="button"
                    className={`cv-icon mic${agent.micMuted ? "" : " active"}`}
                    aria-label={
                      agent.micMuted ? "Unmute microphone" : "Mute microphone"
                    }
                    aria-pressed={!agent.micMuted}
                    onClick={agent.toggleMic}
                  >
                    {agent.micMuted ? <MicOff size={19} /> : <Mic size={19} />}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="cv-icon voice"
                    aria-label="Switch to voice"
                    title="Switch to voice"
                    onClick={agent.resumeVoice}
                  >
                    <AudioLines size={20} />
                  </button>
                )}
                <label className="sr-only" htmlFor="question">
                  Ask about Ayush’s work
                </label>
                <input
                  id="question"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    agent.mode === "voice"
                      ? "Speak, or type to switch to text…"
                      : "Ask about my work…"
                  }
                  maxLength={1500}
                  autoComplete="off"
                />
                <button className="cv-icon send" aria-label="Send question">
                  <Send size={18} />
                </button>
                {agent.mode === "voice" && (
                  <>
                    <button
                      type="button"
                      className="cv-icon"
                      aria-label="Pause voice and type"
                      title="Pause voice and type"
                      onClick={agent.pauseVoice}
                    >
                      <Keyboard size={19} />
                    </button>
                    <button
                      type="button"
                      className="cv-icon"
                      aria-label={
                        agent.voiceOut
                          ? "Mute assistant voice"
                          : "Unmute assistant voice"
                      }
                      onClick={agent.toggleVoice}
                    >
                      {agent.voiceOut ? (
                        <Volume2 size={19} />
                      ) : (
                        <VolumeX size={19} />
                      )}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="cv-icon"
                  aria-label="End conversation"
                  title="End conversation"
                  onClick={() => agent.stop()}
                >
                  <Square size={15} />
                </button>
              </form>
            )}
            {idle && (
              <div className="cv-start">
                <button className="cv-primary" onClick={() => begin(true)}>
                  <Mic size={17} />
                  {status === "idle" ? "Talk" : "Start a new conversation"}
                </button>
                <button className="cv-secondary" onClick={() => begin(false)}>
                  {status === "idle" ? "Type instead" : "Chat by text"}
                </button>
              </div>
            )}
            {connecting && <p className="cv-hint">Connecting…</p>}
            {agent.error && (
              <p className="cv-hint" role="status">
                {agent.error}
              </p>
            )}
            <p className="cv-privacy">
              {live && agent.mode === "voice" && (
                <Countdown until={agent.expiresAt} />
              )}
              {agent.mode === "voice" || status === "idle"
                ? "Processed live by Google’s Gemini. The conversation is saved for Ayush to read; audio is not stored."
                : "Processed by Google’s Gemini. The conversation is saved for Ayush to read."}{" "}
              <a href="/privacy/" target="_blank" rel="noreferrer">
                Privacy
              </a>
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}

function Countdown({ until }: { until: number }) {
  const [left, setLeft] = useState(() => Math.max(0, until - Date.now()));
  useEffect(() => {
    const id = setInterval(
      () => setLeft(Math.max(0, until - Date.now())),
      1000,
    );
    return () => clearInterval(id);
  }, [until]);
  const m = Math.floor(left / 60000),
    sec = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  return (
    <span className="cv-time">
      {m}:{sec} of voice left ·{" "}
    </span>
  );
}
