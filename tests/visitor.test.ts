import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashNetwork,
  newVisitorId,
  normalizeNetwork,
  safeEqual,
  signVisitor,
  verifyVisitor,
} from "../worker/visitor.ts";

const secret = "test-secret-at-least-16-chars";

test("visitor tokens verify, and tampering, expiry and a wrong secret fail", async () => {
  const v = newVisitorId();
  const token = await signVisitor(secret, {
    v,
    inv: false,
    exp: Date.now() + 60_000,
  });
  assert.deepEqual(await verifyVisitor(secret, token), {
    v,
    inv: false,
    exp: (await verifyVisitor(secret, token))!.exp,
  });
  assert.equal(await verifyVisitor("another-secret-16-chars-xx", token), null);
  const [payload, sig] = token.split(".");
  const forged = Buffer.from(
    JSON.stringify({ v, inv: true, exp: Date.now() + 60_000 }),
  ).toString("base64url");
  assert.equal(await verifyVisitor(secret, `${forged}.${sig}`), null); // upgraded claims, old signature
  assert.equal(await verifyVisitor(secret, `${payload}.${sig}x`), null);
  assert.equal(await verifyVisitor(secret, `${payload}`), null);
  assert.equal(await verifyVisitor(secret, ""), null);
  assert.equal(await verifyVisitor(secret, "a.b.c"), null);
  const expired = await signVisitor(secret, {
    v,
    inv: false,
    exp: Date.now() - 1,
  });
  assert.equal(await verifyVisitor(secret, expired), null);
  const badId = await signVisitor(secret, {
    v: "not-hex",
    inv: false,
    exp: Date.now() + 60_000,
  });
  assert.equal(await verifyVisitor(secret, badId), null);
});

test("invite flag survives a round trip and cannot be added later", async () => {
  const v = newVisitorId();
  const token = await signVisitor(secret, {
    v,
    inv: true,
    exp: Date.now() + 60_000,
  });
  assert.equal((await verifyVisitor(secret, token))!.inv, true);
});

test("networks: IPv4 as is, IPv6 grouped by /64, mapped addresses unwrapped", () => {
  assert.equal(normalizeNetwork("203.0.113.9"), "203.0.113.9");
  assert.equal(
    normalizeNetwork("2001:db8:aaaa:bbbb:1:2:3:4"),
    normalizeNetwork("2001:0db8:aaaa:bbbb:ffff:eeee:dddd:cccc"),
  );
  assert.notEqual(
    normalizeNetwork("2001:db8:aaaa:bbbb::1"),
    normalizeNetwork("2001:db8:aaaa:bbbc::1"),
  );
  assert.equal(normalizeNetwork("2001:db8::1"), "v6:2001:0db8:0000:0000");
  assert.equal(normalizeNetwork("::ffff:203.0.113.9"), "203.0.113.9");
  assert.equal(normalizeNetwork("::1"), "v6:0000:0000:0000:0000");
});

test("network hashes are stable and hide the address", async () => {
  const a = await hashNetwork("2001:db8:aaaa:bbbb:1::1");
  const b = await hashNetwork("2001:db8:aaaa:bbbb:9::9");
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.ok(!a.includes("2001"));
});

test("safeEqual compares secrets", async () => {
  assert.equal(await safeEqual("abc", "abc"), true);
  assert.equal(await safeEqual("abc", "abd"), false);
  assert.equal(await safeEqual("abc", "abcd"), false);
});
