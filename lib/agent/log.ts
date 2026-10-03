import { authedFetch } from "./visitor";

// Saves what happens in a conversation to the Worker, for Ayush to read later.
// Text chat is saved by the Worker itself; this carries the parts only the
// browser sees: voice transcripts, screen events and the end of a conversation.
// Entries are batched, carry their own ids (so a retry never duplicates) and
// failures are ignored: saving must never get in the way of the conversation.

type Entry = Record<string, unknown>;
type Pending = { conversationId: string; entry: Entry; tries: number };

const FLUSH_MS = 4000;
const MAX_ENTRIES = 30; // the Worker's limit per request
const MAX_BYTES = 40_000; // keepalive requests are capped at 64 KB

export class ConversationLog {
  private id = "";
  private queue: Pending[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private counter = 0;
  private salt = Math.random().toString(36).slice(2, 8);

  setConversation(id: string) {
    this.id = id;
  }

  private key() {
    return `${this.salt}${(this.counter++).toString(36)}`;
  }

  private push(entry: Entry) {
    if (!this.id) return;
    this.queue.push({ conversationId: this.id, entry, tries: 0 });
    this.timer ??= setTimeout(() => void this.flush(), FLUSH_MS);
  }

  message(
    role: "user" | "assistant",
    text: string,
    status: "complete" | "interrupted" = "complete",
    at?: number,
  ) {
    if (!text.trim()) return;
    this.push({
      type: "message",
      id: this.key(),
      role,
      text: text.slice(0, 8000),
      status,
      at,
    });
  }

  event(name: string, data?: Record<string, unknown>) {
    this.push({ type: "event", key: this.key(), name, data, at: Date.now() });
  }

  // Sends everything queued. `urgent` is for a page that is closing.
  async flush(urgent = false) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.busy && !urgent) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        const first = this.queue[0];
        const batch: Pending[] = [];
        let bytes = 0;
        while (
          this.queue.length &&
          batch.length < MAX_ENTRIES &&
          this.queue[0].conversationId === first.conversationId
        ) {
          const size = JSON.stringify(this.queue[0].entry).length;
          if (batch.length && bytes + size > MAX_BYTES) break;
          bytes += size;
          batch.push(this.queue.shift()!);
        }
        try {
          const response = await authedFetch("/log", {
            method: "POST",
            keepalive: urgent,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              conversationId: first.conversationId,
              entries: batch.map((p) => p.entry),
            }),
          });
          if (response.status >= 500)
            throw new Error(`log failed ${response.status}`);
        } catch {
          // A network hiccup gets one more try later; anything else is dropped.
          const again = batch.filter((p) => ++p.tries < 2);
          this.queue.unshift(...again);
          if (again.length) {
            this.timer ??= setTimeout(() => void this.flush(), FLUSH_MS * 2);
            return;
          }
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
