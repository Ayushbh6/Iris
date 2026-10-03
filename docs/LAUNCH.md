# Launch checklist

One Cloudflare Worker serves the site and the API on one address, so there is nothing else to host. Everything below is in order. **[You]** means only you can do it (account, payment, phone). Everything else is already built: `npm run deploy` does checks, build, deploy and a smoke test.

Already done and verified here: production config, security headers and CSP, same-origin hosting, www redirect, social preview image and SEO tags, deploy/secrets/smoke scripts, and a full local rehearsal of the production build (`npm run rehearse`: 14/14 smoke checks, real chat through the production Worker).

## 1. Cloudflare account [You] — 5 min, free
Sign up at dash.cloudflare.com, then in a terminal in `website/`:
```sh
npx wrangler login
```

## 2. Turnstile widget [You] — 3 min, free
Dashboard → Turnstile → Add widget. Name `ayushbh`, hostname `ayushbh.com`, mode **Managed**. Copy the **site key** into `deploy.config.json` (`"turnstileSiteKey"`). Keep the **secret key** for step 4.

## 3. First deploy
```sh
npm run deploy
```
Wrangler asks you once to pick a free `workers.dev` name. It prints your address (`https://ayushbh.<name>.workers.dev`) and smoke-tests it. The assistant stays off until step 4, so this is safe.

## 4. Secrets [You paste one thing]
```sh
npm run deploy:secrets
```
It reads your Gemini key from your local `.env` file (or the original workspace’s `../.env`), asks for the Turnstile secret (hidden), generates the rest, and puts your **admin token on the clipboard: paste it into your password manager immediately**. It also prints an invite code and an alert topic; install the free **ntfy** app and subscribe to the topic.

## 5. Allow the workers.dev address in Turnstile [You] — 1 min
Turnstile → your widget → Hostnames → add `ayushbh.<name>.workers.dev`.

## 6. Test it for real [You] — 20 min
Open the address, then check on each device: **iPhone Safari**, **Android Chrome**, **desktop Chrome**.
- Talk: allow the mic, hear the voice, see the orb react, ask about experience (a view should open), paste a job description (fit table).
- Type instead; switch voice to typing and back; open Explore pages.
- Leave a message (check `/admin/` inbox and the ntfy ping).
- Open `/admin/`, paste the token: conversations show, Status shows spend.
- Use a private window and a phone on mobile data (Turnstile must pass invisibly).
- Open it with `/?invite=<your code>` once.
Voice on iPhone Safari is the one thing I could not test here; if it misbehaves tell me exactly what you saw and I will fix it. Typing always works as the fallback.

## 7. Google cap [You] — 3 min
In Google AI Studio, put this key's project under a monthly spend cap (60 USD suggested). Details in docs/SAFETY.md.

## 8. The domain [You] — 10 min, about 10 USD a year
Register **ayushbh.com** in the Cloudflare dashboard (Domain Registration), which also puts its DNS on Cloudflare. Then tell me, or: in `worker/wrangler.prod.jsonc` uncomment `routes`, and run `npm run deploy`. Add `www` and the apex are both covered; `www` redirects to `ayushbh.com`. Re-run `npm run smoke -- https://ayushbh.com` and repeat a quick phone test.

## 9. After launch
- Put `https://ayushbh.com` on your LinkedIn, CV and email signature; send recruiters `?invite=<code>` links.
- Optional: the Cloudflare rate-limit rule in docs/SAFETY.md.
- Check `/admin/` now and then; `/admin/export` is your backup.

## If something goes wrong
- Pause everything: the Pause button on `/admin/` (Status), or the curl in docs/SAFETY.md.
- Roll back: Cloudflare dashboard → Workers → `ayushbh` → Deployments → pick the previous version.
- `npm run smoke -- <url>` shows what is broken from the outside.
