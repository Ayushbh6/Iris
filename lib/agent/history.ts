// Turns the browser's conversation into the shapes each model engine accepts.
// Pure and shared so the Worker, the browser and the tests agree. Models only
// ever see text turns; the views shown are summarised in the turn text.

export type HistoryTurn = { role: "user" | "assistant"; text: string };

export type TextStep =
  | { type: "user_input"; content: { type: "text"; text: string }[] }
  | { type: "model_output"; content: { type: "text"; text: string }[] };

export type LiveTurn = { role: "user" | "model"; parts: { text: string }[] };

const JOINED = "[visitor joined]";

// Drops empty turns, merges neighbours with the same role and makes the thread
// start with the visitor, which both APIs require.
function normalize(history: HistoryTurn[]): HistoryTurn[] {
  const turns: HistoryTurn[] = [];
  for (const turn of history) {
    const text = turn.text.trim();
    if (!text) continue;
    const last = turns.at(-1);
    if (last && last.role === turn.role) last.text += `\n${text}`;
    else turns.push({ role: turn.role, text });
  }
  if (turns[0]?.role === "assistant")
    turns.unshift({ role: "user", text: JOINED });
  return turns;
}

export function buildSteps(
  history: HistoryTurn[],
  message: string,
): TextStep[] {
  return normalize([...history, { role: "user", text: message }]).map((t) => ({
    type: t.role === "user" ? "user_input" : "model_output",
    content: [{ type: "text", text: t.text }],
  }));
}

// Initial history for a Live session: it must end with the model's turn, because
// the next thing the visitor does is speak.
export function liveSeed(history: HistoryTurn[]): LiveTurn[] {
  const turns = normalize(history);
  while (turns.at(-1)?.role === "user") turns.pop();
  return turns.map((t) => ({
    role: t.role === "user" ? "user" : "model",
    parts: [{ text: t.text }],
  }));
}
