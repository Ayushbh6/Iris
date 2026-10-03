import { test } from "node:test";
import assert from "node:assert/strict";
import { reserve, settle } from "../lib/budget.ts";
const bucket = () => [{ id: "experiment", limit: 100, used: 0, reserved: 0 }];
test("reserved funds cannot be spent by a second session", () => {
  const held = reserve(bucket(), 75);
  assert.throws(() => reserve(held, 30), /EXHAUSTED/);
  assert.equal(held[0].reserved, 75);
});
test("settlement releases only the unused portion", () => {
  assert.deepEqual(settle(reserve(bucket(), 75), 75, 50), [
    { id: "experiment", limit: 100, used: 50, reserved: 0 },
  ]);
});
test("missing budget and invalid amounts fail closed", () => {
  assert.throws(() => reserve([], 10));
  for (const amount of [-1, 0, 1.5, Infinity])
    assert.throws(() => reserve(bucket(), amount));
});
test("unexpected provider overage does not release reservation", () => {
  const held = reserve(bucket(), 75);
  assert.throws(() => settle(held, 75, 76));
  assert.equal(held[0].reserved, 75);
});
