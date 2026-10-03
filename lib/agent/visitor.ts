// Browser half of the abuse protection. A visitor passes Cloudflare Turnstile once
// (invisible unless it needs a click), receives a signed token from the Worker
// and sends it with every paid request. No account, no login screen.

export const AGENT_URL =
  process.env.NEXT_PUBLIC_AGENT_URL ?? "http://127.0.0.1:8787";

// Cloudflare's published always-passes test key; production sets the real key.
const SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA";

const TOKEN_KEY = "ayushbh.visitor";
const INVITE_KEY = "ayushbh.invite";
const RENEW_BEFORE_MS = 60 * 60 * 1000;

export class VisitorError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

type Saved = { token: string; exp: number; invite?: string };
const read = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {}
};

function savedToken(): Saved | null {
  try {
    const saved = JSON.parse(read(TOKEN_KEY) ?? "null") as Saved | null;
    return saved && typeof saved.token === "string" && saved.exp > Date.now()
      ? saved
      : null;
  } catch {
    return null;
  }
}

// A private link such as ayushbh.com/?invite=CODE raises the daily allowance.
function invite(): string | undefined {
  const fromUrl = new URLSearchParams(window.location.search).get("invite");
  if (fromUrl) write(INVITE_KEY, fromUrl.slice(0, 64));
  return read(INVITE_KEY) ?? undefined;
}

type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptLoading: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoading = null;
      reject(new VisitorError("TURNSTILE_BLOCKED"));
    };
    document.head.appendChild(script);
  });
  return scriptLoading;
}

function turnstileToken(): Promise<string> {
  return loadTurnstile().then(
    () =>
      new Promise<string>((resolve, reject) => {
        const box = document.createElement("div");
        box.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:60";
        document.body.appendChild(box);
        let widget = "";
        const finish = (done: () => void) => {
          clearTimeout(timer);
          try {
            if (widget) window.turnstile?.remove(widget);
          } catch {}
          box.remove();
          done();
        };
        const timer = setTimeout(
          () => finish(() => reject(new VisitorError("TURNSTILE_TIMEOUT"))),
          45_000,
        );
        widget = window.turnstile!.render(box, {
          sitekey: SITE_KEY,
          // Invisible for most visitors; a checkbox only appears if Cloudflare is unsure.
          appearance: "interaction-only",
          action: "iris",
          callback: (token: string) => finish(() => resolve(token)),
          "error-callback": () =>
            finish(() => reject(new VisitorError("TURNSTILE_FAILED"))),
        });
      }),
  );
}

let minting: Promise<string> | null = null;
async function mint(): Promise<string> {
  const invitation = invite();
  const previous = savedToken();
  const proof = await turnstileToken();
  const response = await fetch(`${AGENT_URL}/visitor`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(previous ? { Authorization: `Bearer ${previous.token}` } : {}),
    },
    body: JSON.stringify({ turnstileToken: proof, invite: invitation }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.visitorToken)
    throw new VisitorError(body.error ?? "VISITOR_FAILED");
  write(
    TOKEN_KEY,
    JSON.stringify({
      token: body.visitorToken,
      exp: body.expiresAt,
      invite: invitation,
    }),
  );
  return body.visitorToken as string;
}

export function visitorToken(force = false): Promise<string> {
  if (!force) {
    const saved = savedToken();
    const invitation = invite();
    if (
      saved &&
      saved.invite === invitation &&
      saved.exp - Date.now() > RENEW_BEFORE_MS
    )
      return Promise.resolve(saved.token);
  }
  minting ??= mint().finally(() => {
    minting = null;
  });
  return minting;
}

// fetch with the visitor token; one automatic renewal if the Worker rejects it.
export async function authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const send = async (force: boolean) =>
    fetch(`${AGENT_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${await visitorToken(force)}`,
      },
    });
  const first = await send(false);
  if (first.status !== 401) return first;
  write(TOKEN_KEY, null);
  return send(true);
}
