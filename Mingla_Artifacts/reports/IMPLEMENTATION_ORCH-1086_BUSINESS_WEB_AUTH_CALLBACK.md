# ORCH-1086 — Business Web Auth Callback Static Cut

Date: 2026-06-05
Branch: `ORCH-1086-business-web-auth-callback`
Worktree: `~/Desktop/mingla-orchs/ORCH-1086-[business-web-auth-callback]/`

## User-Visible Problem

On iPhone Safari, `business.usemingla.com` reached the welcome screen, but after OAuth sign-in Safari repeatedly crashed on:

`https://business.usemingla.com/auth/callback`

The screenshot showed Safari's native "A problem repeatedly occurred" page, which means the browser process repeatedly failed while loading that callback URL.

## Root Cause

`/auth/callback` was handled by the Expo Router SPA route `mingla-business/app/auth/callback.tsx`. That route imports the business app auth context and therefore asks mobile Safari to load the same large Expo web bundle at the most fragile point in the OAuth flow.

Supabase's local `@supabase/auth-js` implementation confirms the implicit OAuth callback extracts `access_token`, `refresh_token`, expiry metadata, fetches `/auth/v1/user`, and saves a JSON session to the storage key derived by `@supabase/supabase-js`: `sb-gqnoajqerqhnvulmnyvv-auth-token`.

## Fix

Added `mingla-business/public/auth/callback.html`, a tiny static callback page that:

- Parses the OAuth hash/search parameters without mounting the Expo app.
- Fetches the Supabase user via `https://gqnoajqerqhnvulmnyvv.supabase.co/auth/v1/user`.
- Falls back to JWT payload decoding if the user lookup is transiently unavailable.
- Saves the session to `localStorage` using Supabase's existing storage key and JSON session shape.
- Clears tokens from the visible URL and redirects to `/`.
- Shows a small retry message if the callback contains an OAuth error or no session tokens.

Updated `mingla-business/vercel.json` so Vercel serves `/auth/callback` from `/auth/callback.html` before the existing catch-all SPA fallback.

## Regression Test

Added `mingla-business/__tests__/authCallbackStatic.test.ts`:

- Verifies `/auth/callback` rewrite precedes `/(.*)`.
- Verifies the callback file stores the Supabase session and redirects home without Expo bundle markers.
- Verifies error and missing-session branches stay inside the static page.

## Verification

Commands run from `mingla-business`:

```sh
npm run test:orch-1086
npx jest __tests__/authCallbackStatic.test.ts --runInBand
npx expo export -p web --clear
node scripts/inject-mobile-blur-css.mjs
test -f dist/auth/callback.html
grep -q 'sb-gqnoajqerqhnvulmnyvv-auth-token' dist/auth/callback.html
```

Results:

- Jest: PASS, 3/3.
- Expo export: PASS.
- Mobile blur post-export injection: PASS.
- `dist/auth/callback.html`: present and contains the expected Supabase storage key.

Additional WebKit smoke against the exported static file:

- Started a local static server from `mingla-business/dist`.
- Opened `http://127.0.0.1:8126/auth/callback.html#access_token=...&refresh_token=...&expires_in=3600&token_type=bearer` in Playwright WebKit with an iPhone-size viewport.
- Confirmed the page redirected to `/`.
- Confirmed `localStorage["sb-gqnoajqerqhnvulmnyvv-auth-token"]` contained the access token, refresh token, and user id.
- Confirmed zero page errors.

## Scope Notes

This is the deterministic emergency cut for the observed Safari callback crash. It does not change `web.output`, async routes, Supabase settings, Google settings, native app links, or auth provider configuration.

The broader business-web boot problem still needs ORCH-1085 architectural code-splitting/static-output work. Domain/app-link ownership should also be cleaned up separately because Android currently claims the business host broadly, but that was not the direct cause of the iPhone Safari `/auth/callback` crash shown in the screenshot.
