# ORCH-1085 Implementation — Business Web Mobile Sign-In Home

Status: implemented and verified locally on the physical Android phone.

## Outcome

Signed-in mobile browsers no longer enter the Expo/React Native web bootstrap before reaching Home. The auth callback persists the Supabase session, redirects to `/home`, and Vercel serves a static `home.html` shell. Signed-in phone visits to `/` also preboot-redirect to `/home` before Expo scripts run.

## Root Cause Confirmed

Physical Android Chrome on Samsung SM-A725F (`R58R54YV7JT`) repeatedly killed the signed-in `/home` renderer with:

```text
V8 javascript OOM (Ineffective mark-compacts near heap limit)
CrRendererMain >>> com.android.chrome:sandboxed_process0
```

Async routes and bundle trimming reduced the initial Expo payload from the original 9.24 MB single bundle to about 2.91 MB eager JS, but the phone still OOMed before React painted. DevTools showed `/home` downloaded eager scripts quickly, then hung with an empty body before the renderer crash. Therefore the deterministic mobile-browser fix is to keep the signed-in Home handoff out of the Expo/RN web bootstrap entirely.

## Changes

- Enabled Expo Router async routes for web only in `app.json`; native iOS/Android explicitly remain disabled.
- Deferred the Stripe Connect web SDK through a shared lazy web entry.
- Added web-only shims for native/heavy browser-boot leaks: Lottie, video compressor, lucide native icons, Reanimated, AppsFlyer, Mixpanel, RevenueCat, OneSignal, and push permission moment.
- Removed the remaining welcome-screen vector-icon dependency from the browser boot path.
- Added `public/home.html`, a static mobile-safe signed-in Home shell with no Expo bundle scripts.
- Changed `public/auth/callback.html` success redirect from `/` to `/home`.
- Added Vercel rewrite `/home -> /home.html` before the SPA fallback.
- Extended `scripts/inject-mobile-blur-css.mjs` to inject a signed-in mobile preboot redirect from `/` to `/home` before any Expo script runs.
- Added `scripts/ci/orch-1085-mobile-web-signin-home.mjs` and `npm run test:orch-1085`.
- Updated ORCH-1086 callback test to expect `/home`.
- Updated ORCH-1083 budget guard so async-route shared chunks are allowed while deferred dependencies remain forbidden in eager scripts.

## Verification

Build:

```text
EXPO_NO_TELEMETRY=1 npx expo export --platform web --output-dir web-build-orch1085-after
PASS
```

Final measured eager Expo payload:

```text
ORCH-1083 bundle-budget PASS — initial payload 2912837 bytes, 128 chunk files,
0 deferred specifiers in the main entry chunk, __common within cap.
```

Automated guards:

```text
npm run test:orch-1085
ORCH-1085 mobile-web sign-in PASS.

npm run test:orch-1086
PASS __tests__/authCallbackStatic.test.ts
3 passed
```

Physical Android phone:

```text
Device: Samsung SM-A725F, Chrome, serial R58R54YV7JT
Path: /auth/callback#access_token=... -> /home
Result: Home shell rendered with signed-in email.
Crash log grep: 0 lines for V8 OOM / CrRendererMain / Aw Snap / onServiceDisconnected.

Path: / with persisted signed-in session
Result: preboot redirect to /home, Home shell rendered.
Crash log grep: 0 lines for V8 OOM / CrRendererMain / Aw Snap / onServiceDisconnected.
```

Screenshots:

- `/tmp/mingla-phone-orch1085-callback-static.png`
- `/tmp/mingla-phone-orch1085-final-root.png`

Known unrelated check:

```text
npx tsc --noEmit --pretty false
FAILS on pre-existing repo-wide TypeScript debt, including account icon typing,
checkout buyer implicit-any issues, shared package React type resolution, and
existing DraftEvent test fixtures. No ORCH-1085-specific TypeScript error was
identified from the scoped JS/HTML guard path.
```

## Deploy Notes

This is a web-surface fix. Per COMMS-0015 and COMMS-0018, deploy only after the PR is merged to `main`; do not deploy from this worktree. The PR title must include `[deploy]` so Vercel ships the new static callback/Home routing and post-export preboot script from merged main.

No Supabase migration, edge function deploy, or native rebuild is required. Native OTA is not required for the static web shell; the shared native-safe code paths are either `.web` files or native-disabled async-router config.
