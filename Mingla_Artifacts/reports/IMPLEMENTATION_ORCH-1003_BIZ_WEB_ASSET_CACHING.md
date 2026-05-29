# ORCH-1003 — Business web asset caching (speed)

**Severity:** S2-medium · **Class:** `performance`
**Affected Surfaces:** business-web + buyer-web (the `mingla-business` Vercel deployment). NOT in scope: native apps, admin-web, supabase.
**Parent:** the speed/reliability program proposed as META-ORCH-1002 (that ID was already taken by android-glass-hardening; renumbered to ORCH-1003 per COMMS-0004). The dropdown/empty-page reliability investigation is a separate follow-on ORCH.

## Problem

Expo's web export emits content-hashed asset filenames under `/_expo/static/` (e.g. `index-d7283047….js`) — the filename changes whenever the content changes, so the file is safe to cache forever. But Vercel served them with its default `cache-control: public, max-age=0, must-revalidate`, forcing the browser to re-validate the full ~8.8 MB bundle on **every** page load. That round-trip is the primary cause of the slow loads, and on flaky connections a failed revalidation can yield a blank/partial page (a likely contributor to the "had to refresh multiple times" reports).

## Fix

One header rule added to `mingla-business/vercel.json`:

```json
{ "source": "/_expo/static/(.*)",
  "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] }
```

Docs: Vercel headers config — https://vercel.com/docs/projects/project-configuration#headers

## Why updates still reach users (no staleness risk)

- The HTML shell is **not** under `/_expo/static/`, so it keeps Vercel's default `max-age=0, must-revalidate` and is re-checked on every load.
- A deploy changes asset contents → changes the hash → changes the filename. The fresh HTML references the new filename, which the browser has never cached → it downloads the new bundle. Verified live on the ORCH-1001 deploy (`a5d93c70…` → `d7283047…`).
- The catch-all rewrite `/(.*) → /` does NOT swallow real static files — Vercel serves an existing file before applying SPA-fallback rewrites — so the header attaches to the served asset correctly.
- No service worker is in play (Expo web export adds none); the browser HTTP cache is the only cache and obeys these headers exactly.

Net effect: returning visitors with unchanged code fetch **zero bytes** for the bundle (instant); a real deploy auto-busts via the new filename.

## Dependency walk (config-layer: vercel.json)

- `orch-0964-well-known-json-content-type.mjs` — matches the `.well-known` rules by content via `.some()`, not by index/length → unaffected (verified: exit 0).
- `orch-0891-marketing-performance-budget.mjs` — verified exit 0.
- `playwright/meta-orch-0952-static-server.mjs` — a local static file server; does not read vercel.json headers → unaffected.
- Vercel build/serve — the consumer; the new rule sits alongside the existing `headers` entries and is independent of `rewrites`.

## Step 0.5 regression tests

- Happy-path `__tests__/orch1003.assetCaching.test.ts` — asserts the `/_expo/static/(.*)` rule with `public, max-age=31536000, immutable` (fails-on-revert).
- Adversarial `__tests__/orch1003.assetCaching.adversarial.test.ts` — DIFFERENT angle: asserts we did NOT over-cache (no immutable/long max-age on the HTML shell or `/(.*)`), immutable caching is scoped only to the hashed-asset path, the SPA catch-all rewrite survives and stays last, and the `.well-known` content-type rules are preserved.

## Live verification (post-deploy)

- `GET /_expo/static/js/web/index-<hash>.js` → `Cache-Control: public, max-age=31536000, immutable`.
- `GET /` (HTML) → still `max-age=0, must-revalidate`, and points at the current hashed bundle filename.
