import { z } from "zod";
export const canvasAction = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("show_project"),
      projectId: z.enum(["socrates", "checker", "sec"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("show_architecture"),
      projectId: z.enum(["socrates", "checker", "sec"]),
    })
    .strict(),
  z.object({ type: z.literal("show_experience") }).strict(),
  z.object({ type: z.literal("show_contact") }).strict(),
]);
export type CanvasAction = z.infer<typeof canvasAction>;
