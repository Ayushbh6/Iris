// One command to ship: checks, production build, deploy, smoke test.
//   npm run deploy               everything
//   npm run deploy -- --fast     skip the test suites (build and deploy only)
//   npm run deploy -- --dry-run  build and validate the Worker, upload nothing
//   npm run deploy -- --allow-missing-key  first deploy, before the Turnstile widget exists
// Needs `npx wrangler login` once, and the Turnstile site key in deploy.config.json
// (it is public: it ends up in the page).
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const fast = process.argv.includes("--fast");
const dry = process.argv.includes("--dry-run");
const CONFIG = "worker/wrangler.prod.jsonc";
const say = (m) => console.log(`\n▸ ${m}`);
const stop = (m) => {
  console.error(`\n✖ ${m}`);
  process.exit(1);
};
const run = (cmd, args, env = {}) =>
  spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } })
    .status === 0;

let siteKey = "";
try {
  siteKey =
    JSON.parse(readFileSync("deploy.config.json", "utf8")).turnstileSiteKey ||
    "";
} catch {}
// First deploy only: ship before the Turnstile widget exists, to learn the workers.dev
// address. The assistant stays off (no secrets), but its browser check cannot pass yet.
if (!siteKey && process.argv.includes("--allow-missing-key"))
  siteKey = "pending-turnstile-key";
if (!siteKey && !dry)
  stop(
    'Set "turnstileSiteKey" in deploy.config.json first (Cloudflare dashboard → Turnstile → your widget → site key). See docs/LAUNCH.md step 2.',
  );
if (/^[123]x0+/.test(siteKey))
  stop(
    "That is one of Cloudflare's TEST site keys; use the real one from your widget.",
  );

if (!dry) {
  say("Checking you are logged in to Cloudflare");
  const who = spawnSync("npx", ["wrangler", "whoami"], { encoding: "utf8" });
  if (/not authenticated/i.test(who.stdout + who.stderr))
    stop("Not logged in. Run:  npx wrangler login   then try again.");
}

if (!fast) {
  for (const [name, script] of [
    ["Type check", "typecheck"],
    ["Worker type check", "worker:typecheck"],
    ["Unit tests", "test"],
    ["Database schema", "db:check"],
    ["Worker tests", "worker:test"],
  ]) {
    say(name);
    if (!run("npm", ["run", "-s", script]))
      stop(`${name} failed. Nothing was deployed.`);
  }
}

say("Building the site for production");
if (
  !run("npm", ["run", "build"], {
    NEXT_PUBLIC_AGENT_URL: "", // same origin: the Worker serves the site and the API
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: siteKey || "dry-run-key",
  })
)
  stop("Build failed. Nothing was deployed.");

say(dry ? "Validating the Worker (dry run, nothing uploaded)" : "Deploying");
const args = [
  "wrangler",
  "deploy",
  "--config",
  CONFIG,
  ...(dry ? ["--dry-run"] : []),
];
const child = spawn("npx", args, { stdio: ["inherit", "pipe", "pipe"] });
let out = "";
for (const stream of [child.stdout, child.stderr])
  stream.on("data", (d) => {
    out += d;
    process.stdout.write(d);
  });
const code = await new Promise((r) => child.on("close", r));
if (code !== 0) stop("Deploy failed (see above).");
if (dry) {
  console.log("\n✔ Dry run passed.");
  process.exit(0);
}

const url =
  out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0] ??
  out.match(/https:\/\/(?:www\.)?ayushbh\.com/i)?.[0];
say("Checking which secrets are set");
const listed = spawnSync(
  "npx",
  ["wrangler", "secret", "list", "--config", CONFIG, "--format", "json"],
  { encoding: "utf8" },
);
let have = [];
try {
  have = JSON.parse(listed.stdout).map((s) => s.name);
} catch {}
const need = [
  "GEMINI_API_KEY",
  "TURNSTILE_SECRET",
  "VISITOR_SECRET",
  "ADMIN_TOKEN",
];
const missing = need.filter((n) => !have.includes(n));
if (missing.length)
  console.log(
    `Missing: ${missing.join(", ")}. Run:  npm run deploy:secrets\n(Until then the assistant stays off and visitors are told to email you.)`,
  );

if (url) {
  say(`Smoke test against ${url}`);
  const ok = run("node", ["scripts/smoke.mjs", url]);
  console.log(
    ok
      ? `\n✔ Live at ${url}`
      : "\n✖ Some smoke checks failed; read the list above.",
  );
  process.exit(ok ? 0 : 1);
}
console.log("\nDeployed. Run  npm run smoke -- <your site url>  to check it.");
