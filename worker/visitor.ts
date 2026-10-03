// Visitor identity without a login. A visitor proves they are a real browser once
// (Cloudflare Turnstile), receives a signed token, and presents it on every call.
// The token is not an account: clearing it only costs another Turnstile solve,
// which is itself rate limited per network. The hard spending caps do not depend
// on any of this.

const encoder = new TextEncoder();

export type VisitorClaims = {
  v: string;
  inv: boolean;
  exp: number;
  inviteId?: string;
};

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const fromBase64Url = (text: string) => {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(
    atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)),
    (c) => c.charCodeAt(0),
  );
};

const hmacKey = (secret: string, usage: KeyUsage[]) =>
  crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usage,
  );

export const SECRET_OK = (secret: string | undefined): secret is string =>
  typeof secret === "string" && secret.length >= 16;

export async function signVisitor(
  secret: string,
  claims: VisitorClaims,
): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const key = await hmacKey(secret, ["sign"]);
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(payload)),
  );
  return `${payload}.${toBase64Url(signature)}`;
}

export async function verifyVisitor(
  secret: string,
  token: string | null | undefined,
  now = Date.now(),
): Promise<VisitorClaims | null> {
  if (!token || token.length > 600) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  try {
    const key = await hmacKey(secret, ["verify"]);
    // subtle.verify compares in constant time.
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(signature),
      encoder.encode(payload),
    );
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    if (
      typeof claims.v !== "string" ||
      !/^[a-f0-9]{32}$/.test(claims.v) ||
      !Number.isSafeInteger(claims.exp) ||
      claims.exp <= now
    )
      return null;
    return {
      v: claims.v,
      inv: claims.inv === true,
      exp: claims.exp,
      ...(typeof claims.inviteId === "string" &&
      /^[a-f0-9]{64}$/.test(claims.inviteId)
        ? { inviteId: claims.inviteId }
        : {}),
    };
  } catch {
    return null;
  }
}

export const newVisitorId = () => crypto.randomUUID().replaceAll("-", "");

// Constant-time string comparison for secrets such as the admin token and invite codes.
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const key = await hmacKey("safe-equal-key-not-a-secret", ["sign"]);
  const [x, y] = await Promise.all(
    [a, b].map(
      async (s) =>
        new Uint8Array(
          await crypto.subtle.sign("HMAC", key, encoder.encode(s)),
        ),
    ),
  );
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// Rate limits key on the network, not the single address: an IPv6 customer gets
// a whole /64, so rotating addresses inside it buys an attacker nothing.
export function normalizeNetwork(ip: string): string {
  const clean = ip.trim().toLowerCase();
  if (!clean.includes(":")) return clean || "unknown";
  const mapped = clean.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return mapped[1];
  const [head, tail] = clean.split("::");
  const front = head ? head.split(":") : [];
  const back = tail !== undefined && tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? front
      : [
          ...front,
          ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"),
          ...back,
        ];
  return (
    "v6:" +
    groups
      .slice(0, 4)
      .map((g) => g.padStart(4, "0"))
      .join(":")
  );
}

export async function hashNetwork(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`portfolio-network:${normalizeNetwork(ip)}`),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function inviteId(secret: string, code: string): Promise<string> {
  const key = await hmacKey(secret, ["sign"]);
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(`invite:${code}`)),
  );
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyTurnstile(
  secret: string,
  token: string,
  ip: string,
  hostnames: string[],
): Promise<boolean> {
  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      },
    );
    if (!response.ok) return false;
    const result = (await response.json()) as {
      success?: boolean;
      hostname?: string;
      action?: string;
    };
    // Published test keys do not echo hostname/action. Never relax production.
    const testKey = secret === "1x0000000000000000000000000000000AA";
    return (
      result.success === true &&
      (testKey ||
        (hostnames.includes((result.hostname ?? "").toLowerCase()) &&
          result.action === "iris"))
    );
  } catch {
    return false;
  }
}
