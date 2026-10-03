import { test } from "node:test";
import assert from "node:assert/strict";
import { textCost, liveCost } from "../worker/accounting.ts";
import { takeLimit } from "../worker/rate.ts";

test("text pricing changes on the published 2027 boundary, including thinking output", () => {
  assert.equal(textCost(1000, 500, Date.UTC(2026, 11, 31)), 2625);
  assert.equal(textCost(1000, 500, Date.UTC(2027, 0, 1)), 5250);
});
test("live bills reprocessed context per generation and missing modalities at audio rates", () => {
  const usage = {
    promptTokenCount: 1000,
    responseTokenCount: 100,
    promptTokensDetails: [
      { modality: "TEXT", tokenCount: 400 },
      { modality: "AUDIO", tokenCount: 600 },
    ],
    responseTokensDetails: [{ modality: "AUDIO", tokenCount: 100 }],
  };
  assert.equal(liveCost(usage), 3300);
  assert.equal(
    liveCost({ promptTokenCount: 1000, responseTokenCount: 100 }),
    4200,
  );
});
test("rolling limits stop hour-boundary bursts and apply reduced limits immediately", () => {
  const now = 3_600_001;
  const beforeBoundary = [3_599_900, 3_599_950];
  assert.throws(() => takeLimit(beforeBoundary, 2, 2, now), /RATE_LIMITED/);
  assert.throws(
    () => takeLimit([now - 90_000, now - 80_000], 1, 5, now),
    /RATE_LIMITED/,
  );
  assert.deepEqual(takeLimit([1], 2, 2, 3_600_002), [3_600_002]);
  assert.throws(() => takeLimit([], 0, 2, now), /RATE_LIMITED/);
});
