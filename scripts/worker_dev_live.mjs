// Local Worker with real Gemini and a small spending cap. Key comes from the local environment file.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { localEnvFile } from "./local_env.mjs";
const env = localEnvFile();
if (!existsSync(env)) {
  console.error(`Missing ${env} (needs GEMINI_API_KEY).`);
  process.exit(1);
}
const vars = {
  AI_ENABLED: "true",
  EXPERIMENT_LIMIT_USD_MICROS: "20000000",
  MONTHLY_LIMIT_USD_MICROS: "20000000",
  DAILY_LIMIT_USD_MICROS: "10000000",
  NETWORK_SESSIONS_PER_HOUR: "20",
  SESSION_RESERVE_USD_MICROS: "100000",
  CHAT_REQUESTS_PER_HOUR: "120",
  VISITOR_TOKENS_PER_HOUR: "30",
  // Cloudflare's published Turnstile TEST secret: always passes, so no account is needed locally.
  TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
  // Local-only values. Production secrets are set with `wrangler secret put`.
  VISITOR_SECRET: "local-dev-visitor-secret-not-for-production",
  ADMIN_TOKEN: "local-dev-admin-token-not-for-production",
  INVITE_CODES: "local-invite",
};
// Quick overrides while testing, e.g. CHAT_TOKEN_CAP=9000 npm run worker:dev:live
vars.CHAT_TOKEN_CAP = "150000";
for (const key of Object.keys(vars))
  if (process.env[key]) vars[key] = process.env[key];
const args = [
  "wrangler",
  "dev",
  "--config",
  "worker/wrangler.jsonc",
  "--port",
  "8787",
  "--env-file",
  env,
];
for (const [k, v] of Object.entries(vars)) args.push("--var", `${k}:${v}`);
spawn("npx", args, { stdio: "inherit" }).on("exit", (code) =>
  process.exit(code ?? 0),
);
