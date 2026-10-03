import { test } from "node:test";
import assert from "node:assert/strict";
import { validateView } from "../lib/agent/render.ts";
import { executeToolCall, functionDeclarations } from "../lib/agent/tools.ts";
import { buildSystemInstruction } from "../lib/agent/prompt.ts";
import { buildLiveConfig, LIVE_MODEL } from "../lib/agent/config.ts";

const view = {
  title: "Where Ayush has worked",
  blocks: [
    {
      kind: "timeline",
      entries: [
        {
          period: "2026 — now",
          title: "Operational Risk Intern",
          org: "Erste Group",
        },
      ],
    },
    {
      kind: "fit",
      rows: [
        {
          requirement: "RAG",
          evidence: "ALIGNIA evidence retrieval",
          strength: "strong",
        },
      ],
    },
    { kind: "project", project: "socrates" },
    { kind: "links", links: ["cv", "github"] },
  ],
};

test("valid view passes and defaults layout", () => {
  const r = validateView(view);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.view.layout, "stack");
});

test("drops unknown block keys instead of rendering them", () => {
  const r = validateView({
    title: "x",
    blocks: [{ kind: "text", body: "hi", url: "https://evil" }],
  });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.view.blocks[0], { kind: "text", body: "hi" });
});

test("rejects unknown kinds, top-level extras, arbitrary links and oversize content", () => {
  for (const bad of [
    { title: "x", blocks: [{ kind: "html", body: "<script>" }] },
    { title: "x", blocks: [{ kind: "text", body: "hi" }], script: "alert(1)" },
    { title: "x", blocks: [{ kind: "project", project: "secret_repo" }] },
    { title: "x", blocks: [{ kind: "links", links: ["https://evil"] }] },
    { title: "x", blocks: [{ kind: "text", body: "a".repeat(701) }] },
    { title: "x", blocks: [] },
    { title: "x", blocks: Array(9).fill({ kind: "text", body: "hi" }) },
  ])
    assert.equal(validateView(bad).ok, false, JSON.stringify(bad).slice(0, 60));
});

test("render tool returns effect on success and error without effect on failure", () => {
  const ok = executeToolCall({ id: "1", name: "render", args: view });
  assert.equal(
    (ok.functionResponse.response.output as { shown: boolean }).shown,
    true,
  );
  assert.equal(ok.functionResponse.scheduling, "WHEN_IDLE");
  assert.equal(
    executeToolCall({ name: "connect", args: { action: "email" } })
      .functionResponse.scheduling,
    "WHEN_IDLE",
  );
  assert.equal(ok.effect?.type, "render");
  const bad = executeToolCall({
    id: "2",
    name: "render",
    args: { title: "x" },
  });
  assert.match(String(bad.functionResponse.response.error), /Invalid view/);
  assert.equal(bad.effect, undefined);
  assert.equal(bad.functionResponse.id, "2");
});

test("connect tool validates action and trims note", () => {
  const ok = executeToolCall({
    name: "connect",
    args: { action: "leave_message", note: " hi ".padEnd(400, "x") },
  });
  assert.equal(ok.effect?.type, "connect");
  if (ok.effect?.type === "connect") assert.equal(ok.effect.note?.length, 300);
  assert.ok(
    executeToolCall({ name: "connect", args: { action: "call_phone" } })
      .functionResponse.response.error,
  );
  assert.ok(
    executeToolCall({ name: "delete_everything" }).functionResponse.response
      .error,
  );
});

test("system instruction carries policy and profile; config locks tools", () => {
  const prompt = buildSystemInstruction();
  assert.match(prompt, /Topics to deflect/);
  assert.match(prompt, /ALIGNIA/);
  assert.doesNotMatch(prompt, /\+43/); // phone stays off the public agent
  const config = buildLiveConfig();
  assert.equal(LIVE_MODEL, "gemini-3.8-live");
  assert.deepEqual(
    config.tools[0].functionDeclarations.map((f) => f.name),
    ["render", "connect"],
  );
  assert.equal(functionDeclarations.length, 2);
  assert.equal(
    config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
    "Kore",
  );
  assert.match(prompt, /AH-yoosh/);
  assert.match(prompt, /visitor opened the X page/);
});

test("text prompt never asks for phonetic names or spoken delivery", () => {
  const text = buildSystemInstruction("text");
  assert.match(text, /written chat/);
  assert.doesNotMatch(text, /AH-yoosh|CHAR-yah/);
  assert.match(text, /Never spell names phonetically/);
  assert.match(text, /# Profile/);
  assert.match(text, /Topics to deflect/);
  assert.match(buildSystemInstruction("voice"), /AH-yoosh/);
});

import { buildSteps, liveSeed } from "../lib/agent/history.ts";

test("history: merges, starts with the visitor and appends the new message", () => {
  const steps = buildSteps(
    [
      { role: "assistant", text: "Welcome!" },
      { role: "user", text: "a" },
      { role: "user", text: " b " },
      { role: "assistant", text: "" },
    ],
    "c",
  );
  assert.deepEqual(
    steps.map((s) => s.type),
    ["user_input", "model_output", "user_input"],
  );
  assert.equal(steps[0].content[0].text, "[visitor joined]");
  assert.equal(steps[2].content[0].text, "a\nb\nc");
});

test("history: live seed alternates, starts with the visitor and ends with the model", () => {
  const seed = liveSeed([
    { role: "assistant", text: "Hi" },
    { role: "user", text: "Show me Socrates" },
    { role: "assistant", text: "Here it is." },
    { role: "user", text: "and then" },
  ]);
  assert.deepEqual(
    seed.map((t) => t.role),
    ["user", "model", "user", "model"],
  );
  assert.equal(seed.at(-1)?.parts[0].text, "Here it is.");
  assert.deepEqual(liveSeed([{ role: "user", text: "lonely" }]), []);
});
