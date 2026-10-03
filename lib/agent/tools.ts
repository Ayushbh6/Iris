import {
  renderParametersJsonSchema,
  validateView,
  type RenderView,
} from "./render.ts";

// Two broad tools. `render` is generative UI; `connect` hands the visitor to Ayush.
// Knowledge lives in the system instruction, so no lookup round trip is needed mid-speech.

export const CONNECT_ACTIONS = [
  "download_cv",
  "email",
  "linkedin",
  "github",
  "leave_message",
] as const;
export type ConnectAction = (typeof CONNECT_ACTIONS)[number];

export const functionDeclarations = [
  {
    name: "render",
    behavior: "NON_BLOCKING",
    description:
      "Show a visual view on the visitor's screen while you talk: experience, projects, skills, workflows, metrics or a job-description fit table. Replaces the current view. Compose freely from the block kinds.",
    parametersJsonSchema: renderParametersJsonSchema,
  },
  {
    name: "connect",
    behavior: "NON_BLOCKING",
    description:
      "Help the visitor reach Ayush: download his CV, show email, LinkedIn or GitHub, or open a form to leave him a message. Use when the visitor asks or shows clear interest.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...CONNECT_ACTIONS] },
        note: {
          type: "string",
          description:
            "Optional short context to prefill a message, max 300 chars.",
        },
      },
      required: ["action"],
    },
  },
];

export type ToolEffect =
  | { type: "render"; view: RenderView }
  | { type: "connect"; action: ConnectAction; note?: string };

export type ToolCall = {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
};

export type ToolResult = {
  functionResponse: {
    id?: string;
    name?: string;
    response: Record<string, unknown>;
    scheduling: "WHEN_IDLE";
  };
  effect?: ToolEffect;
};

// Pure: validates the call and returns both the model-facing response and the UI effect.
// Tools are non-blocking so speech never waits on the screen. A shown view
// (or connect card) nudges the model to speak after it appears (WHEN_IDLE),
// so a request never ends in silence; errors let the model retry.
export function executeToolCall(call: ToolCall): ToolResult {
  const reply = (
    response: Record<string, unknown>,
    effect?: ToolEffect,
  ): ToolResult => ({
    functionResponse: {
      id: call.id,
      name: call.name,
      response,
      scheduling: "WHEN_IDLE",
    },
    effect,
  });
  if (call.name === "render") {
    const checked = validateView(call.args ?? {});
    if (!checked.ok)
      return reply({
        error: `Invalid view, nothing shown. Fix and call again. ${checked.error}`,
      });
    return reply(
      {
        output: {
          shown: true,
          next: "The view is on screen. Now speak your answer in 2-3 sentences; do not mention the view.",
        },
      },
      { type: "render", view: checked.view },
    );
  }
  if (call.name === "connect") {
    const action = call.args?.action;
    if (!CONNECT_ACTIONS.includes(action as ConnectAction))
      return reply({
        error: `Unknown action. Use one of: ${CONNECT_ACTIONS.join(", ")}`,
      });
    const raw = call.args?.note;
    const note =
      typeof raw === "string" && raw.trim()
        ? raw.trim().slice(0, 300)
        : undefined;
    return reply(
      {
        output: {
          done: true,
          action,
          next: "A button or link for it is now on the visitor's screen (nothing downloads automatically). Say so in one short sentence.",
        },
      },
      {
        type: "connect",
        action: action as ConnectAction,
        ...(note ? { note } : {}),
      },
    );
  }
  return reply({ error: `Unknown tool: ${call.name}` });
}
