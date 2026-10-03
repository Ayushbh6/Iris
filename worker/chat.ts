import { bytes } from "./accounting.ts";
import { TEXT_MODEL } from "../lib/agent/config.ts";
import { buildSystemInstruction } from "../lib/agent/prompt.ts";
import {
  executeToolCall,
  functionDeclarations,
  type ToolEffect,
} from "../lib/agent/tools.ts";
import type { TextStep } from "../lib/agent/history.ts";

// One text turn against gemini-3.8-flash (Interactions API, stateless, store:false).
// The tools run here: they are pure validators, so the Worker can answer them and
// loop without a browser round trip. Only text and UI effects reach the browser.

const ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions";
export const MAX_OUTPUT_TOKENS = 1500;
const MAX_ROUNDS = 3;

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "effect"; effect: ToolEffect }
  | { type: "round-start"; round: number; maxInputTokens: number }
  | { type: "round-rejected"; round: number }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      round: number;
    };

type Step = Record<string, unknown>;

const tools = functionDeclarations.map((f) => ({
  type: "function",
  name: f.name,
  description: f.description,
  parameters: f.parametersJsonSchema,
}));

async function* sse(response: Response): AsyncGenerator<Record<string, any>> {
  const reader = response
    .body!.pipeThrough(new TextDecoderStream())
    .getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += value.replaceAll("\r\n", "\n");
    if (buffer.length > 256_000)
      throw new ChatProviderError("PROVIDER_FRAME_TOO_LARGE");
    let split: number;
    while ((split = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data);
      } catch {
        // Ignore a malformed keep-alive or partial block.
      }
    }
    if (done) return;
  }
}

// UTF-8 bytes bound token count conservatively. Include serialisation and a
// margin for provider framing; no chars/4 assumption for Unicode or tool args.
export const maxInputTokens = (input: Step[]) =>
  bytes(JSON.stringify(input)) +
  bytes(buildSystemInstruction("text")) +
  bytes(JSON.stringify(tools)) +
  2048;

export class ChatProviderError extends Error {}

export async function* runChat(
  apiKey: string,
  steps: TextStep[],
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  let input: Step[] = [...steps];
  const system_instruction = buildSystemInstruction("text");
  for (let round = 0; round < MAX_ROUNDS; round++) {
    yield { type: "round-start", round, maxInputTokens: maxInputTokens(input) };
    const response = await fetch(ENDPOINT, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        model: TEXT_MODEL,
        system_instruction,
        tools,
        input,
        store: false,
        stream: true,
        generation_config: {
          thinking_level: "low",
          max_output_tokens: MAX_OUTPUT_TOKENS,
        },
      }),
    });
    if (!response.ok || !response.body) {
      // Only a definitive client/quota rejection is known to be unbilled.
      if ([400, 401, 403, 404, 429].includes(response.status))
        yield { type: "round-rejected", round };
      throw new ChatProviderError(`HTTP ${response.status}`);
    }

    const produced: Step[] = [];
    let current: Step | null = null;
    let args = "";
    let roundText = "";
    let completed = false;
    for await (const ev of sse(response)) {
      switch (ev.event_type) {
        case "step.start":
          current = { ...ev.step };
          args = "";
          break;
        case "step.delta": {
          const d = ev.delta ?? {};
          if (d.type === "text" && typeof d.text === "string") {
            roundText += d.text;
            yield { type: "text", delta: d.text };
          } else if (d.type === "thought_signature" && current)
            current.signature = d.signature;
          else if (typeof d.arguments === "string") args += d.arguments;
          break;
        }
        case "step.stop":
          if (current) {
            if (current.type === "function_call") {
              try {
                current.arguments = args
                  ? JSON.parse(args)
                  : (current.arguments ?? {});
              } catch {
                current.arguments = {};
              }
            }
            produced.push(current);
            current = null;
          }
          break;
        case "interaction.completed": {
          const u = ev.interaction?.usage;
          if (
            !u ||
            ![
              u.total_input_tokens,
              u.total_output_tokens,
              u.total_tokens,
            ].every((n) => Number.isSafeInteger(n) && n >= 0)
          )
            throw new ChatProviderError("MISSING_USAGE");
          if (completed) throw new ChatProviderError("DUPLICATE_COMPLETION");
          completed = true;
          yield {
            type: "usage",
            round,
            inputTokens: u.total_input_tokens,
            outputTokens: u.total_output_tokens + (u.total_thought_tokens ?? 0),
            totalTokens: u.total_tokens,
          };
          break;
        }
        case "error":
          throw new ChatProviderError(
            String(ev.error?.message ?? "stream error"),
          );
      }
    }

    if (!completed) throw new ChatProviderError("INCOMPLETE_STREAM");
    const calls = produced.filter((s) => s.type === "function_call");
    if (!calls.length) break;
    const results: Step[] = [];
    let failed = false;
    for (const call of calls) {
      const out = executeToolCall({
        id: String(call.id),
        name: String(call.name),
        args: (call.arguments ?? {}) as Record<string, unknown>,
      });
      if (out.effect) yield { type: "effect", effect: out.effect };
      else failed = true;
      results.push({
        type: "function_result",
        name: call.name,
        call_id: call.id,
        result: [
          { type: "text", text: JSON.stringify(out.functionResponse.response) },
        ],
      });
    }
    // An answer written next to the tool call is complete; otherwise (or after an
    // invalid view) the model needs another round to write it or fix the call.
    if (roundText.trim() && !failed) break;
    input = [...input, ...produced, ...results];
  }
}
