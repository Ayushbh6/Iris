// Full production rehearsal on this machine: builds the site exactly as it ships
// (same-origin, no localhost address baked in), runs the production Worker config
// (static site + API on ONE port) with local test secrets, and smoke-tests it.
// Uses Cloudflare's always-pass Turnstile test keys, so nothing needs an account.
//   npm run rehearse          build, start, smoke test, stop
//   npm run rehearse -- --keep  leave it running at http://127.0.0.1:8788
import { spawn, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { localEnvFile } from "./local_env.mjs";

const PORT = 8788;
const keep = process.argv.includes("--keep");
const env = localEnvFile();
const real =
  existsSync(env) && /GEMINI_API_KEY=/.test(readFileSync(env, "utf8"));

console.log("Building the site for production…");
execFileSync("npm", ["run", "build"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_PUBLIC_AGENT_URL: "",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  },
});

const vars = {
  AI_ENABLED: real ? "true" : "false",
  DAILY_LIMIT_USD_MICROS: "1000000",
  MONTHLY_LIMIT_USD_MICROS: "5000000",
  EXPERIMENT_LIMIT_USD_MICROS: "5000000",
  TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
  VISITOR_SECRET: "rehearsal-visitor-secret-not-for-production",
  ADMIN_TOKEN: "rehearsal-admin-token-not-for-production",
  INVITE_CODES: "rehearsal-invite",
};
const args = [
  "wrangler",
  "dev",
  "--config",
  "worker/wrangler.prod.jsonc",
  "--port",
  String(PORT),
  "--persist-to",
  ".wrangler/rehearsal",
];
if (real) args.push("--env-file", env);
for (const [k, v] of Object.entries(vars)) args.push("--var", `${k}:${v}`);
const worker = spawn("npx", args, { stdio: ["ignore", "pipe", "pipe"] });
let log = "";
worker.stdout.on("data", (d) => (log += d));
worker.stderr.on("data", (d) => (log += d));
const stop = () => worker.kill("SIGTERM");
process.on("SIGINT", () => (stop(), process.exit(130)));

const url = `http://127.0.0.1:${PORT}`;
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try {
    up = (await fetch(`${url}/health`)).ok;
  } catch {}
  if (!up) await new Promise((r) => setTimeout(r, 500));
}
if (!up) {
  console.error("Worker did not start:\n" + log.slice(-2500));
  stop();
  process.exit(1);
}
console.log(
  `\nRehearsal site running at ${url} (${real ? "real Gemini key" : "AI off: no key found"})\n`,
);
let code = 0;
try {
  execFileSync("node", ["scripts/smoke.mjs", url], {
    stdio: "inherit",
    env: { ...process.env, SMOKE_ADMIN_TOKEN: vars.ADMIN_TOKEN },
  });
} catch {
  code = 1;
}
if (keep && !code) {
  console.log(
    `\nLeft running. Open ${url}  (admin token: ${vars.ADMIN_TOKEN}). Ctrl+C to stop.`,
  );
  await new Promise(() => {});
}
stop();
process.exit(code);
