import { test } from "node:test";
import assert from "node:assert/strict";
import { drainPlayback } from "../lib/agent/playbackDrain.ts";

test("goodbye drains past six seconds and finishes once playback ends", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let playing = true;
  let finished = 0;
  drainPlayback(
    () => playing,
    () => finished++,
  );
  t.mock.timers.tick(7_000);
  assert.equal(finished, 0);
  playing = false;
  t.mock.timers.tick(250);
  assert.equal(finished, 1);
  t.mock.timers.tick(20_000);
  assert.equal(finished, 1);
});

test("suspended playback cannot prevent handover indefinitely", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let finished = 0;
  drainPlayback(
    () => true,
    () => finished++,
  );
  t.mock.timers.tick(15_000);
  assert.equal(finished, 1);
});

test("ending or replacing the session cancels its pending handover", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let finished = 0;
  const cancel = drainPlayback(
    () => true,
    () => finished++,
  );
  t.mock.timers.tick(250);
  cancel();
  t.mock.timers.tick(20_000);
  assert.equal(finished, 0);
});
