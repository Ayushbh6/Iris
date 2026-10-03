// Black-box checks of a running site: static pages, security headers, and that
// every paid or private route refuses strangers. Safe to run against production:
// it never calls the AI, never spends anything and sends no real data.
//   node scripts/smoke.mjs https://ayushbh.<you>.workers.dev
//   SMOKE_ADMIN_TOKEN=... node scripts/smoke.mjs <url>   (also checks the owner endpoint)
import assert from "node:assert/strict";

const base = (process.argv[2] || "").replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("Usage: node scripts/smoke.mjs <site url>");
  process.exit(2);
}
let failed = 0;
const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
  } catch (error) {
    failed++;
    results.push({ name, ok: false });
    console.log(`FAIL  ${name} — ${error.message.split("\n")[0]}`);
  }
}
const get = (path, init) => fetch(base + path, { redirect: "manual", ...init });
const post = (path, body, headers = {}) =>
  fetch(base + path, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

await check("home page loads", async () => {
  const r = await get("/");
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /Ayush/);
  assert.match(html, /og:image/);
  assert.match(html, /application\/ld\+json/);
  return `${html.length} bytes`;
});
await check("security headers on pages", async () => {
  const r = await get("/");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  const csp = r.headers.get("content-security-policy") || "";
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /connect-src 'self'/);
  assert.doesNotMatch(csp, /generativelanguage\.googleapis\.com/);
  assert.match(csp, /challenges\.cloudflare\.com/);
});
await check("privacy page, CV, preview image, robots and sitemap", async () => {
  for (const [path, type] of [
    ["/privacy/", /html/],
    ["/Ayush_Bhattacharya_CV.pdf", /pdf/],
    ["/og.jpg", /image\/jpeg/],
    ["/robots.txt", /text/],
    ["/sitemap.xml", /xml/],
  ]) {
    const r = await get(path);
    assert.equal(r.status, 200, `${path} → ${r.status}`);
    assert.match(r.headers.get("content-type") || "", type, path);
  }
});
await check("admin page is served but marked noindex", async () => {
  const r = await get("/admin/");
  assert.equal(r.status, 200);
  assert.match(await r.text(), /noindex/);
});
await check("hashed assets are cached for a year", async () => {
  const html = await (await get("/")).text();
  const js = html.match(/\/_next\/static\/[^"']+\.js/)?.[0];
  assert.ok(js, "no script found");
  const r = await get(js);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control") || "", /immutable/);
});
await check("unknown page is a 404", async () => {
  assert.equal((await get("/definitely-not-here/")).status, 404);
});
await check("health reports schema and AI state", async () => {
  const r = await get("/health");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.ok(body.schemaVersion >= 2);
  return `schema ${body.schemaVersion}, paidAI ${body.paidAI}, paused ${body.paused}`;
});
// Paid and private routes must refuse a stranger (401 or, with AI off, 503) and never spend.
for (const [path, body] of [
  ["/session", undefined],
  ["/chat", { history: [], message: "hi" }],
  ["/log", { conversationId: "x", entries: [] }],
  ["/message", { name: "a", email: "a@b.co", message: "hello there" }],
]) {
  await check(`${path} refuses a visitor without a token`, async () => {
    const r = await post(path, body);
    assert.ok([401, 503].includes(r.status), `status ${r.status}`);
    return String(r.status);
  });
}
await check("a foreign website cannot call the API", async () => {
  const r = await post(
    "/chat",
    { history: [], message: "hi" },
    { Origin: "https://evil.example" },
  );
  assert.equal(r.status, 403);
});
await check("owner routes are invisible without the token", async () => {
  for (const headers of [
    {},
    { Authorization: "Bearer wrong-token-wrong-token-wrong" },
  ]) {
    for (const path of [
      "/admin/status",
      "/admin/conversations",
      "/admin/export",
    ]) {
      const r = await get(path, { headers });
      assert.equal(r.status, 404, `${path} → ${r.status}`);
    }
  }
});
if (process.env.SMOKE_ADMIN_TOKEN)
  await check("owner status works with the admin token", async () => {
    const r = await get("/admin/status", {
      headers: { Authorization: `Bearer ${process.env.SMOKE_ADMIN_TOKEN}` },
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok("budgets" in body);
    return `day cap $${body.budgets?.day?.limitUsd}, paused ${body.paused}`;
  });

console.log(
  `\n${results.length - failed}/${results.length} checks passed against ${base}`,
);
process.exit(failed ? 1 : 0);
