import { z } from "zod";

// Generative UI contract. The model composes any view from these blocks; the
// browser renders them with fixed, polished components. No model-written code,
// HTML or arbitrary URLs ever reach the page. Unknown keys inside blocks are
// dropped (zod strips by default); unknown kinds, ids and link targets fail.

export const PROJECT_IDS = [
  "socrates",
  "checker",
  "sec_summariser",
  "this_website",
] as const;
export const LINK_TARGETS = [
  "cv",
  "email",
  "linkedin",
  "github",
  "socrates_repo",
  "checker_repo",
  "sec_repo",
] as const;

const short = (max: number) => z.string().trim().min(1).max(max);
const heading = short(80).optional();

const block = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), heading, body: short(700) }),
  z.object({
    kind: z.literal("bullets"),
    heading,
    points: z.array(short(220)).min(1).max(8),
  }),
  z.object({
    kind: z.literal("stats"),
    heading,
    stats: z
      .array(z.object({ value: short(24), label: short(90) }))
      .min(1)
      .max(4),
  }),
  z.object({
    kind: z.literal("timeline"),
    heading,
    entries: z
      .array(
        z.object({
          period: short(40),
          title: short(80),
          org: short(80),
          note: short(220).optional(),
        }),
      )
      .min(1)
      .max(8),
  }),
  z.object({
    kind: z.literal("project"),
    project: z.enum(PROJECT_IDS),
    emphasis: short(300).optional(),
  }),
  z.object({
    kind: z.literal("flow"),
    heading,
    steps: z.array(short(48)).min(2).max(6),
  }),
  z.object({
    kind: z.literal("fit"),
    heading,
    rows: z
      .array(
        z.object({
          requirement: short(120),
          evidence: short(260),
          strength: z.enum(["strong", "partial", "gap"]),
        }),
      )
      .min(1)
      .max(8),
  }),
  z.object({
    kind: z.literal("tags"),
    heading,
    tags: z.array(short(40)).min(1).max(16),
  }),
  z.object({
    kind: z.literal("links"),
    heading,
    links: z.array(z.enum(LINK_TARGETS)).min(1).max(7),
  }),
]);

export const renderView = z
  .object({
    title: short(90),
    subtitle: short(180).optional(),
    layout: z.enum(["stack", "grid"]).default("stack"),
    blocks: z.array(block).min(1).max(8),
  })
  .strict();

export type RenderView = z.infer<typeof renderView>;
export type RenderBlock = RenderView["blocks"][number];

// Gemini cannot enforce the union strictly, so the declared schema is a single
// permissive block shape; renderView above is the authority.
const str = { type: "string" };
const strArray = { type: "array", items: str };
export const renderParametersJsonSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short view title, max 90 chars." },
    subtitle: { type: "string", description: "Optional, max 180 chars." },
    layout: {
      type: "string",
      enum: ["stack", "grid"],
      description: "grid places blocks side by side on wide screens.",
    },
    blocks: {
      type: "array",
      description: "1-8 blocks. Only use the fields listed for each kind.",
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: [
              "text",
              "bullets",
              "stats",
              "timeline",
              "project",
              "flow",
              "fit",
              "tags",
              "links",
            ],
            description: [
              "text: heading?, body (<=700 chars).",
              "bullets: heading?, points (1-8 strings).",
              "stats: heading?, stats [{value, label}] (1-4).",
              "timeline: heading?, entries [{period, title, org, note?}] (1-8).",
              "project: project (id), emphasis? — shows the curated project card.",
              "flow: heading?, steps (2-6 short labels) — a workflow/architecture diagram.",
              "fit: heading?, rows [{requirement, evidence, strength: strong|partial|gap}] (1-8) — job-description match.",
              "tags: heading?, tags (1-16 short strings).",
              "links: heading?, links (targets).",
            ].join(" "),
          },
          heading: str,
          body: str,
          points: strArray,
          stats: {
            type: "array",
            items: {
              type: "object",
              properties: { value: str, label: str },
              required: ["value", "label"],
            },
          },
          entries: {
            type: "array",
            items: {
              type: "object",
              properties: { period: str, title: str, org: str, note: str },
              required: ["period", "title", "org"],
            },
          },
          project: { type: "string", enum: [...PROJECT_IDS] },
          emphasis: str,
          steps: strArray,
          rows: {
            type: "array",
            items: {
              type: "object",
              properties: {
                requirement: str,
                evidence: str,
                strength: {
                  type: "string",
                  enum: ["strong", "partial", "gap"],
                },
              },
              required: ["requirement", "evidence", "strength"],
            },
          },
          tags: strArray,
          links: {
            type: "array",
            items: { type: "string", enum: [...LINK_TARGETS] },
          },
        },
        required: ["kind"],
      },
    },
  },
  required: ["title", "blocks"],
} as const;

export function validateView(
  args: unknown,
): { ok: true; view: RenderView } | { ok: false; error: string } {
  const result = renderView.safeParse(args);
  if (result.success) return { ok: true, view: result.data };
  const error = result.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "view"}: ${i.message}`)
    .join("; ");
  return { ok: false, error };
}
