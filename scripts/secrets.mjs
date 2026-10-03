// Sets the Worker's secrets in Cloudflare, interactively and safely.
//   npm run deploy:secrets             set whatever is missing
//   npm run deploy:secrets -- --rotate ADMIN_TOKEN   replace one secret
// Reads GEMINI_API_KEY from the local environment file (never printed), generates the random secrets
// itself, asks you only for the Turnstile secret (typed hidden), and puts the new
// admin token on your clipboard rather than on screen. Run it in your own terminal.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { localEnvFile } from "./local_env.mjs";

const CONFIG = "worker/wrangler.prod.jsonc";
const rotate = process.argv.includes("--rotate")
  ? process.argv[process.argv.indexOf("--rotate") + 1]
  : "";
const stop = (m) => {
  console.error(`\n✖ ${m}`);
  process.exit(1);
};
const wrangler = (args, input) =>
  spawnSync("npx", ["wrangler", ...args, "--config", CONFIG], {
    encoding: "utf8",
    input,
    stdio:
      input === undefined
        ? ["inherit", "pipe", "pipe"]
        : ["pipe", "pipe", "pipe"],
  });

const who = spawnSync("npx", ["wrangler", "whoami"], { encoding: "utf8" });
if (/not authenticated/i.test(who.stdout + who.stderr))
  stop("Not logged in. Run:  npx wrangler login   then try again.");

const listed = wrangler(["secret", "list", "--format", "json"]);
if (listed.status !== 0)
  stop(
    "Could not list secrets. Has the Worker been deployed yet?  Run  npm run deploy  first.",
  );
const have = new Set(JSON.parse(listed.stdout).map((s) => s.name));

const rl = createInterface({ input: process.stdin, output: process.stdout });
async function hidden(question) {
  process.stdout.write(question);
  spawnSync("stty", ["-echo"], { stdio: "inherit" });
  const answer = await rl.question("");
  spawnSync("stty", ["echo"], { stdio: "inherit" });
  process.stdout.write("\n");
  return answer.trim();
}
const put = (name, value) => {
  const r = wrangler(["secret", "put", name], value);
  if (r.status !== 0) stop(`Could not set ${name}:\n${r.stderr || r.stdout}`);
  console.log(`  ✔ ${name} set`);
};
const want = (name) => rotate === name || (!rotate && !have.has(name));
const random = (n) => randomBytes(n).toString("hex");

if (want("GEMINI_API_KEY")) {
  const env = localEnvFile();
  const key = existsSync(env)
    ? readFileSync(env, "utf8")
        .match(/^GEMINI_API_KEY=(.+)$/m)?.[1]
        ?.trim()
        .replace(/^["']|["']$/g, "")
    : "";
  if (!key) stop(`No GEMINI_API_KEY found in ${env}.`);
  put("GEMINI_API_KEY", key);
}
if (want("TURNSTILE_SECRET")) {
  const secret = await hidden(
    "Turnstile SECRET key (from the Cloudflare dashboard, hidden as you type): ",
  );
  if (secret.length < 20 || /^[123]x0+/.test(secret))
    stop(
      "That does not look like a real Turnstile secret (test keys are not accepted).",
    );
  put("TURNSTILE_SECRET", secret);
}
if (want("VISITOR_SECRET")) put("VISITOR_SECRET", random(32));
if (want("ADMIN_TOKEN")) {
  const token = random(32);
  put("ADMIN_TOKEN", token);
  const copied = spawnSync("pbcopy", { input: token }).status === 0;
  console.log(
    copied
      ? "  ➜ Your admin token is on the clipboard. Paste it into your password manager NOW; it is not shown anywhere and cannot be recovered (only replaced)."
      : `  ➜ Your admin token (save it now, it is not shown again): ${token}`,
  );
}
if (want("INVITE_CODES")) {
  const code = `hire-${random(3)}`;
  put("INVITE_CODES", code);
  console.log(
    `  ➜ Invite code: ${code}  → share links as  https://<your site>/?invite=${code}`,
  );
}
if (want("ALERT_WEBHOOK_URL")) {
  const answer = (
    await rl.question(
      "Phone alerts for spend and new messages via ntfy.sh? [Y/n] ",
    )
  )
    .trim()
    .toLowerCase();
  if (answer !== "n") {
    const topic = `ayushbh-${random(6)}`;
    put("ALERT_WEBHOOK_URL", `https://ntfy.sh/${topic}`);
    console.log(
      `  ➜ Install the free ntfy app and subscribe to the topic:  ${topic}`,
    );
  }
}
rl.close();
console.log(
  "\nDone. Visit /health on your site: it should now say paidAI true.",
);
