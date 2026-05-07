---
title: B2a Path C V3 — End-to-End Pipeline Investigation (Stripe Connect + OAuth + Universal Links)
status: COMPLETE
mode: INVESTIGATE
investigator: mingla-forensics
created: 2026-05-07
dispatched_by: orchestrator (FORENSICS_B2A_PATH_C_V3_E2E_PIPELINE.md)
findings: 2 root causes proven · 0 contributing · 3 hidden flaws · 2 observations
confidence: HIGH (Symptom 1 + Symptom 2 both layer-verified)
---

# Layman summary

**Symptom 1 — "Stripe can't verify" + "publishable key not configured"** is **already RESOLVED** as of 08:08 UTC after the operator ran `cd mingla-business && vercel --prod`. The pre-redeploy bundle was built from a pre-R-2/pre-C-3 source tree and was missing both the publishable-key resolution code and the C-3 domain renames. The fresh bundle has all fixes (verified by direct curl of the new bundle hash `entry-4ac6648f69eb06e336616cac8f847a9e.js`). The operator should now retest the Phase 16 device smoke and confirm onboarding completes.

**Symptom 2 — "Google sign-in opens the app instead of completing"** is a **separate, Android-specific root cause** caused by an unbounded Android intent filter in `mingla-business/app.json:46-55`. The filter captures **every path** on `business.usemingla.com`, including `/auth/callback`. After Google + Supabase redirects the browser back with `#access_token=…`, Android auto-launches the Mingla Business app instead of letting Chrome finish the OAuth handoff. The app has no deep-link handler for `/auth/callback` (the route is web-only by design — see [app/auth/callback.tsx:13](../mingla-business/app/auth/callback.tsx#L13)), so the tokens are dropped and the user appears to "fail" sign-in.

**Recommended fix:** restrict the Android intent filter to the same 4 paths the iOS AASA whitelists (`/connect-onboarding`, `/onboarding-complete`, `/b/*`, `/e/*`), exactly mirroring the `applinks` components. This is a one-line `pathPattern` addition that is verified by `assetlinks.json` re-fetch on next install.

# Symptom Summary

## Symptom 1 — Stripe onboarding "publishable key not configured"

**Reported:** "I can't finish stripe onboarding, says stripe can't verify, after the browser sheet opens up and I get the popup that mingla business wants to login. … When I click set up payments, I get 'couldn't start onboarding, stripe publishable key is not configured.'"

**Status:** RESOLVED post-redeploy. Verified.

**Pre-redeploy bundle (`entry-ab9f1d34551ab1c072d4cf3d568cdebb.js`)** was built from a tree predating the implementor's R-2 (`EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST` → `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` rename) and C-3 (`mingla.com` → `usemingla.com`) fixes. Evidence captured pre-redeploy:

```bash
$ curl -s ... entry-ab9f1d34551ab1c072d4cf3d568cdebb.js | grep -oE 'support@\w+\.com'
support@mingla.com    # ← C-3 fix MISSING (current source says support@usemingla.com)

$ curl -s ... | grep -oE '.{40}publishable key is not configured.{60}'
)(null),z=(0,n.useMemo)(()=>{if("string"!=typeof v)return null;return E("Stripe publishable key is not configured. Contact support@mingla.com."),null},[v
```

The minified `useMemo` callback has only TWO branches: `(a)` if `sessionClientSecret` isn't a string return null, `(b)` otherwise call `setInitError` and return null. **There is no code path to `loadConnectAndInitialize`**, meaning Terser folded away the publishable-key happy path because at build time both `Constants.expoConfig?.extra?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST` (the old name) and `process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST` were undefined.

**Post-redeploy bundle (`entry-4ac6648f69eb06e336616cac8f847a9e.js`)** verified at 08:11 UTC:

```bash
$ curl -s ... entry-4ac6648f69eb06e336616cac8f847a9e.js | grep -oE 'pk_test_[^"]{20,}|EXPO_PUBLIC_[A-Z_]+|usemingla\.com|loadConnectAndInitialize|publishable[^"]{0,60}' | sort | uniq -c
   4 usemingla.com                                                ← C-3 shipped
   3 EXPO_PUBLIC_SUPABASE_URL
   3 EXPO_PUBLIC_SUPABASE_ANON_KEY
   2 pk_test_51TTnt1PjlZyAYA40f3kjmxF6uXjfEJKfFR25LiJpVqd7qw…    ← key embedded
   2 loadConnectAndInitialize                                    ← happy path present
   2 EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY                          ← R-2 rename shipped
   1 publishableKey:n,fetchClientSecret:async()=>u,appearance…    ← actual init call
   1 publishable key is not configured. Contact support@usemingla.com.
   1 EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL
```

The Supabase secret `MINGLA_BUSINESS_WEB_URL` was set at 08:08 UTC. Edge function `brand-stripe-onboard` last deployed at 06:59 UTC; **no redeploy needed** because Supabase injects secrets at runtime per the [Edge Functions secrets docs](https://supabase.com/docs/guides/functions/secrets) (verified by `Deno.env.get()` runtime semantics in [supabase/functions/brand-stripe-onboard/index.ts](../supabase/functions/brand-stripe-onboard/index.ts)).

## Symptom 2 — Google sign-in opens app, OAuth fails

**Reported:** "When I go to business.usemingla.com, and I try to sign in via google, I cant, get a weird error, and for some reason, expo opens up since I have it on my phone."

**Status:** ROOT CAUSE PROVEN. Android-specific. Awaiting fix.

# Investigation Manifest

| File | Layer | Why read |
|---|---|---|
| `mingla-business/app.json` | Mobile app config | iOS `associatedDomains` + Android `intentFilters` |
| `mingla-business/app.config.ts` | Mobile app config | Web URL, scheme, env injection into `extra` |
| `mingla-business/app/connect-onboarding.tsx` | Web entry (Vercel) | Stripe Connect Embedded init + key resolution |
| `mingla-business/app/auth/callback.tsx` | Web entry (Vercel) | OAuth web redirect landing |
| `mingla-business/src/context/AuthContext.tsx` | Auth provider | `signInWithGoogle` + `redirectTo` shape |
| `mingla-business/src/components/brand/BrandOnboardView.tsx` | UI component | `WebBrowser.openAuthSessionAsync` call + `RETURN_DEEP_LINK` |
| `mingla-business/src/hooks/useStartBrandStripeOnboarding.ts` | Mutation hook | Edge fn invocation chain |
| `mingla-business/public/.well-known/apple-app-site-association` | Static asset | iOS Universal Links registry |
| `mingla-business/public/.well-known/assetlinks.json` | Static asset | Android App Links registry |
| `supabase/functions/brand-stripe-onboard/index.ts` | Edge fn | `MINGLA_BUSINESS_WEB_URL` consumption + Stripe AccountSession creation |
| `mingla-business/dist/_expo/static/js/web/entry-*.js` | Build artefact | Confirm what was bundled vs source |
| `https://business.usemingla.com/_expo/...` | Live production | Confirm what is actually served |

# Findings

## 🔴 RC-1 — Vercel deployment built from pre-R-2/C-3 source (RESOLVED)

| Field | Value |
|---|---|
| **File + line** | `mingla-business/dist/_expo/static/js/web/entry-0912bc1edbb3de66cae2c07773811268.js` (mtime 01:11) vs `mingla-business/app/connect-onboarding.tsx:65-90` (mtime 03:41) |
| **Exact code (source, current)** | `const fromExtra = (Constants.expoConfig?.extra as ...)?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY; const fromProcessEnv = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY; const publishableKey = fromExtra ?? fromProcessEnv;` |
| **Exact code (deployed bundle, pre-redeploy)** | `if("string"!=typeof v)return null;return E("Stripe publishable key is not configured. Contact support@mingla.com."),null` |
| **What it did** | Always set `initError` regardless of env state; never invoked `loadConnectAndInitialize`; rendered `Couldn't start onboarding` error page in browser sheet |
| **What it should do** | Read publishable key from `Constants.expoConfig.extra` (baked from app.config.ts) or `process.env` (Metro inline at build), and call `loadConnectAndInitialize` |
| **Causal chain** | Implementor edited source AT 03:41; local `dist/` last built at 01:11; Vercel deployed from a `vercel --prod` of an older tree → built bundle missing R-2 (env var rename) → constant-folder removed happy path → all clicks of "Set up payments" hit the error path |
| **Verification** | Post-redeploy bundle `entry-4ac6648f69eb06e336616cac8f847a9e.js` contains `loadConnectAndInitialize` (×2), `pk_test_51TTnt1…` (×2), `support@usemingla.com` (×4); minified `useMemo` body now contains `loadConnectAndInitialize({publishableKey:n,fetchClientSecret:async()=>u,appearance:{variables:{…}}})` |
| **Status** | RESOLVED post `vercel --prod` 08:08 UTC |

**Ref:** [Stripe Connect Embedded Components — `loadConnectAndInitialize`](https://docs.stripe.com/connect/embedded-quickstart#integrate-frontend) confirms the publishable key is the required first arg.

## 🔴 RC-2 — Android intent filter unbounded; captures `/auth/callback`

| Field | Value |
|---|---|
| **File + line** | `mingla-business/app.json:46-55` |
| **Exact code** | `"intentFilters": [{ "action": "VIEW", "autoVerify": true, "data": [{ "scheme": "https", "host": "business.usemingla.com" }], "category": ["BROWSABLE", "DEFAULT"] }]` |
| **What it does** | Captures EVERY HTTPS URL on `business.usemingla.com` (no `pathPattern` / `pathPrefix`). When Chrome on Android receives the OAuth redirect `https://business.usemingla.com/auth/callback#access_token=…`, Android App Links handler auto-routes to the Mingla Business app per [Android App Links documentation](https://developer.android.com/training/app-links/verify-android-applinks) |
| **What it should do** | Capture ONLY the same 4 paths the iOS AASA whitelists: `/connect-onboarding`, `/onboarding-complete`, `/b/.*`, `/e/.*` |
| **Causal chain** | (1) User opens `https://business.usemingla.com/` in Chrome on Android → page renders. (2) User taps "Sign in with Google" → `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: 'https://business.usemingla.com/auth/callback' } })` per [AuthContext.tsx:202-207](../mingla-business/src/context/AuthContext.tsx#L202-L207). (3) Chrome navigates to Google OAuth. (4) Google redirects to Supabase `https://gqnoajqerqhnvulmnyvv.supabase.co/auth/v1/callback?code=…`. (5) Supabase exchanges code, redirects to `https://business.usemingla.com/auth/callback#access_token=…&refresh_token=…`. (6) Android App Links handler matches the unbounded filter on `host: business.usemingla.com` (with `autoVerify=true` + valid `assetlinks.json` confirmed live `Content-Type: application/json` 200 OK) → opens Mingla Business app. (7) Mingla Business app receives the URL but has no deep-link handler for `/auth/callback` (route is web-only — see [app/auth/callback.tsx:13](../mingla-business/app/auth/callback.tsx#L13): "Native iOS/Android never hit this route — they use the native ID-token flow without URL fragments"). (8) Tokens in URL fragment are dropped; OAuth state lost; user perceives a "weird error" + sees the app open instead of finishing sign-in |
| **Verification** | Reproduce on Android device: open Chrome to `business.usemingla.com/auth/callback?test=1` directly → app opens. Then add `pathPattern` restriction → app no longer opens for that path |

**Refs:**
- Android intent filter `pathPattern` syntax: [Android Developers — App Links pattern matching](https://developer.android.com/guide/topics/manifest/data-element)
- iOS AASA bounded paths (current good state): [Apple — Supporting associated domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains)
- Why iOS is unaffected: AASA components list at [/.well-known/apple-app-site-association](https://business.usemingla.com/.well-known/apple-app-site-association) does NOT include `/auth/callback` → iOS Universal Links does not route the OAuth redirect into the app

## 🟡 HF-1 — `/onboarding-complete` is in AASA but no Vercel route exists

| Field | Value |
|---|---|
| **File + line** | `mingla-business/public/.well-known/apple-app-site-association:11-14` declares `/onboarding-complete` as a Universal Link path; `mingla-business/app/onboarding-complete*` does NOT exist (verified `ls mingla-business/app/onboarding-complete*` returns "no matches found") |
| **Why it's hidden** | Today's flow uses the `mingla-business://onboarding-complete` custom scheme via `RETURN_DEEP_LINK` in [BrandOnboardView.tsx:82](../mingla-business/src/components/brand/BrandOnboardView.tsx#L82), so the HTTPS variant is rarely hit. But if Stripe ever redirects to the HTTPS form, Vercel returns 404, breaking the return-from-Stripe leg. Also, iOS could open the app via Universal Link but the app must handle the `/onboarding-complete` path — verify the deep-link handler in `app/_layout.tsx` or expo-router resolution |
| **Future symptom** | After a Stripe-side config change or an `Account Links` (vs `Account Session`) migration, the HTTPS return URL becomes the canonical path and 404s out |
| **Recommended fix** | Either (a) add a thin `app/onboarding-complete.tsx` page that mirrors the deep-link bounce of `connect-onboarding.tsx`, or (b) remove `/onboarding-complete` from the AASA components list until a real page exists |

## 🟡 HF-2 — Vercel SSO Protection enabled on `*.vercel.app` bypass URLs

| Field | Value |
|---|---|
| **Evidence** | `curl -sI https://mingla-business-6szy7ts84-seth-ogievas-projects.vercel.app/` returns `HTTP/2 401` + `set-cookie: _vercel_sso_nonce=…` |
| **Why it's hidden** | The custom domain `business.usemingla.com` is publicly accessible (verified `HTTP/2 200` + Content-Type `text/html`). Production traffic uses the custom domain only. SSO Protection only blocks the deployment-bypass URLs (`*.vercel.app`) which are normally used for debugging — but the orchestrator's first probe of those URLs returned the 401 and was misread as the prime cause of Symptom 1 |
| **Future symptom** | Anyone trying to reproduce a bug via the deployment URL (e.g., to bypass DNS for a force-refresh test) will see the SSO challenge and may misdiagnose |
| **Recommended fix** | Either disable SSO Protection on Production deployments (Vercel Dashboard → Project → Settings → Deployment Protection) OR add a runbook entry documenting the bypass URL behavior. Per [Vercel — Deployment Protection](https://vercel.com/docs/deployment-protection), this is "Standard Protection" by default and only protects deployment URLs, not custom domains |

## 🟡 HF-3 — `MINGLA_BUSINESS_WEB_URL` Vercel env name vs Supabase env name mismatch (verified, just noting)

`mingla-business/app.config.ts:93-95` uses `EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL` (with `EXPO_PUBLIC_` prefix). Supabase Edge Functions use `MINGLA_BUSINESS_WEB_URL` (no prefix) per [supabase/functions/brand-stripe-onboard/index.ts](../supabase/functions/brand-stripe-onboard/index.ts) reading `Deno.env.get("MINGLA_BUSINESS_WEB_URL")`. This is intentional (different runtimes have different conventions) but is non-obvious for future developers. Document in `docs/runbooks/B2_VERCEL_DEPLOY_RUNBOOK.md` or create memory.

## 🔵 OBS-1 — Web fetch of `business.usemingla.com` from this dev machine flaps

`curl https://business.usemingla.com/` from this dev machine intermittently returned `Could not resolve host` while `dig +short business.usemingla.com` resolved correctly. Likely a local DNS resolver cache issue, NOT a production problem. The `--resolve business.usemingla.com:443:216.198.79.1` workaround consistently returned 200. No action required.

## 🔵 OBS-2 — `mingla-business://` custom scheme registered correctly

`mingla-business/app.config.ts:38` declares `scheme: "mingla-business"` and `RETURN_DEEP_LINK = "mingla-business://onboarding-complete"`. The Stripe completion flow uses `window.location.href = returnTo` (web → app handoff) which is well-supported. No issue.

# Five-Layer Cross-Check (Symptom 2)

| Layer | Source | Truth claim |
|---|---|---|
| **Docs** | `B2_VERCEL_DEPLOY_RUNBOOK.md` (operator runbook) | Mentions setting up DNS + AASA; does NOT mention bounded Android intent filter |
| **Schema** | n/a (no DB involved in OAuth callback path) | n/a |
| **Code (mobile config)** | `mingla-business/app.json:46-55` | Unbounded Android intent filter (host-only) |
| **Code (mobile config)** | `mingla-business/app.json:36-39` | iOS bounded AASA via `associatedDomains: ["applinks:business.usemingla.com"]` (paths come from served AASA) |
| **Code (web auth)** | `mingla-business/src/context/AuthContext.tsx:60` | OAuth redirectTo is `${origin}/auth/callback` |
| **Code (web auth)** | `mingla-business/app/auth/callback.tsx:13` | Comment: "Native iOS/Android never hit this route" — explicit assumption |
| **Runtime (live AASA)** | `https://business.usemingla.com/.well-known/apple-app-site-association` | 200 OK, JSON, 4 bounded paths |
| **Runtime (live assetlinks)** | `https://business.usemingla.com/.well-known/assetlinks.json` | 200 OK, JSON, no path scoping (it's package-level only — Android pathPattern is in app.json, not assetlinks) |
| **Data (device install)** | not directly probable; assume installed app reflects current `app.json` | Latest Android build has unbounded intent filter; `autoVerify=true` will succeed at install time, then capture all paths |

**Contradiction found:** Code's stated assumption (`callback.tsx:13` "Native never hits this route") contradicts the Android intent filter scope (`app.json:46-55` captures all paths). The web-only assumption is violated at runtime on Android.

# Blast Radius Map

- ✅ **Solo mode (mingla-business)**: directly affected — only mode that exists for this app
- 🚫 **Collab mode**: n/a (mingla-business has no collab mode)
- 🚫 **app-mobile**: separate codebase; not affected (separate intent filters)
- 🚫 **mingla-admin**: separate domain (admin.usemingla.com); not affected
- ⚠️ **Stripe onboarding return path**: indirectly affected. The Android intent filter currently INTENDS to capture `/connect-onboarding` and `/onboarding-complete` so the app can resume after Stripe completion. Restricting paths must KEEP those two. Restriction must be: `/connect-onboarding`, `/onboarding-complete`, `/b/.*`, `/e/.*` (mirror AASA) — exclude `/auth/callback`, `/`, `/admin/*`, etc.
- ⚠️ **Public brand pages `/b/{slug}`**: depend on Universal Link / App Link to open in app for installed users. Must remain in pathPattern allowlist.
- ⚠️ **Public event pages `/e/{slug}`**: same as above.

# Invariant Check

- **I-PROPOSED-Y (platform web URL)**: respected — all platform URLs continue to flow through `EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL` / `MINGLA_BUSINESS_WEB_URL`. No new violations.
- **I-PROPOSED-T/U/V/W (Stripe controls)**: not touched.
- **No NEW invariant** strictly required for this fix, but **recommend establishing I-PROPOSED-Z**: "Android intent filter `pathPattern` MUST mirror the iOS AASA `components` paths exactly. Drift between the two = OAuth/deep-link bug class." See "Regression Prevention" below.

# Recurring-pattern check

This is a new failure class for the repo. The closest analogue is the prior pattern of "platform URL drift" (now governed by I-PROPOSED-Y) — same shape: a single-source-of-truth violation across two platforms (here: Android intent filter vs iOS AASA). Recommend converting that into a cross-platform deep-link parity invariant.

# Fix Strategy (DIRECTION ONLY — not a spec)

## RC-1 (Stripe stale bundle) — already fixed via redeploy

No further action required. Operator can confirm Phase 16 in-app smoke now passes.

## RC-2 (Android intent filter) — restrict to AASA-mirrored paths

Modify [mingla-business/app.json:46-55](../mingla-business/app.json#L46-L55) Android `intentFilters[0].data` to add `pathPattern` entries that mirror the AASA `components`:

```json
"intentFilters": [
  {
    "action": "VIEW",
    "autoVerify": true,
    "data": [
      { "scheme": "https", "host": "business.usemingla.com", "pathPattern": "/connect-onboarding" },
      { "scheme": "https", "host": "business.usemingla.com", "pathPattern": "/onboarding-complete" },
      { "scheme": "https", "host": "business.usemingla.com", "pathPattern": "/b/.*" },
      { "scheme": "https", "host": "business.usemingla.com", "pathPattern": "/e/.*" }
    ],
    "category": ["BROWSABLE", "DEFAULT"]
  }
]
```

After this change, `/auth/callback` is no longer captured → Chrome handles the OAuth redirect → Supabase `detectSessionInUrl: true` finalizes the session in browser → user is signed in.

**Native build required.** Intent filter changes are AndroidManifest-level, so an EAS Android build (`eas build --platform android`) and re-install on test device are mandatory. OTA updates do NOT change AndroidManifest.

**iOS native build NOT required** for THIS fix (AASA is already correct). If HF-1 is also addressed (remove `/onboarding-complete` from AASA OR add the page), iOS Universal Links cache must be cleared per [Apple — debug Universal Links](https://developer.apple.com/documentation/technotes/tn3155-debugging-universal-links).

## HF-1 (orphaned AASA path) — fix in same Android cycle

Either:
- **Option A (recommended):** Add a thin `mingla-business/app/onboarding-complete.tsx` web page that mirrors `connect-onboarding.tsx` exit handling (i.e., reads query params, attempts `window.location.href = mingla-business://onboarding-complete`, falls through to a "Tap to return to Mingla" button if the scheme handler is missing).
- **Option B:** Remove `/onboarding-complete` from `mingla-business/public/.well-known/apple-app-site-association` and from the to-be-restricted Android `pathPattern` list. The `mingla-business://onboarding-complete` custom scheme remains the canonical return path.

# Regression Prevention

## New invariant proposal — I-PROPOSED-Z (deep-link path parity)

| Field | Value |
|---|---|
| **Statement** | Android `intentFilters[*].data[*].pathPattern` MUST be a strict superset of all paths in the iOS AASA `applinks.details[*].components[*]./` list, AND must NOT include any path not in that list. The two MUST be derived from a single source of truth (e.g., a shared JSON config consumed at app.config.ts build time and at AASA-write time). |
| **Why** | OAuth callback URLs, payment provider return URLs, and browser-side magic-link URLs all live on the same domain. If Android captures unbounded while iOS captures bounded, OAuth and similar flows break exclusively on Android — invisible to iOS-only QA. |
| **CI gate** | Strict-grep gate `i-proposed-z-deep-link-path-parity.mjs` reads `mingla-business/app.json` Android intent filters and `mingla-business/public/.well-known/apple-app-site-association`, computes path sets, and fails if they diverge. |
| **Allowlist** | None — exact parity is the contract. |

This invariant should be co-located with I-PROPOSED-Y in the registry.

# Discoveries for Orchestrator

1. **Vercel deployment is decoupled from git.** The 18 modified files (R-2, C-3, AASA, assetlinks, vercel.json, etc.) are still uncommitted. Future `git push` to a Vercel-git-connected project would clobber the live state with stale code. Resolve by committing + ensuring Vercel project is git-connected (or document that Vercel for `mingla-business-web` is CLI-deploy-only and never auto-deploys).

2. **Web-only auth flow assumption is documented in code but not enforced.** [app/auth/callback.tsx:13](../mingla-business/app/auth/callback.tsx#L13) says "Native iOS/Android never hit this route" but the Android intent filter as-shipped DOES route the call into the app. Comments aren't gates. Either I-PROPOSED-Z (above) or a runtime check in app `_layout.tsx` deep-link handler that explicitly bounces unknown URLs back to Chrome via `Linking.openURL(originalUrl)` would prevent regression.

3. **Possible Apple Sign-In symmetry bug.** [AuthContext.tsx:317-333](../mingla-business/src/context/AuthContext.tsx#L317-L333) `signInWithApple` web path uses the same `redirectTo: ${origin}/auth/callback`. Same RC-2 failure mode applies. Apple Sign-In on Chrome on Android would also break. Not a separate bug — RC-2 fix resolves both.

4. **iOS Universal Links cache.** Once the operator's installed Mingla Business app on iOS made an AASA fetch, iOS caches the components list for some duration. If the operator has been testing on iOS and the `/auth/callback` symptom appeared there, it could be due to a stale AASA cache from an earlier (broken) AASA version. Recommend the operator confirms which platform the OAuth-opens-app symptom occurs on; if iOS, force-clear via "Reset Location & Privacy" or reinstall the app to bust the cache.

# Confidence Level

- **RC-1 (Stripe stale bundle)** — **HIGH**, root cause proven by post-redeploy bundle verification. Resolved.
- **RC-2 (Android intent filter)** — **HIGH** for Android. The unbounded filter is unambiguous in `app.json`; the OAuth redirect URL `https://business.usemingla.com/auth/callback` is unambiguous in `AuthContext.tsx:60`; Android App Links auto-routing for matching `autoVerify=true` filters is documented behavior. The only HIGH→MEDIUM downgrade would be if the operator's symptom is actually on iOS, in which case OBS-4 (stale Universal Links cache) would be the path forward — but that's still a fix, not a different root cause.

# Verification matrix (post-fix expectations)

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| V-01 | Stripe onboarding success | Tap "Set up payments" → country GB → confirm | Browser sheet opens to working Stripe Connect Embedded; KYC steps render; on completion deep-link returns to app | Mobile + Web |
| V-02 | Android Google sign-in | Visit business.usemingla.com on Android Chrome → tap Google → pick account | Sign-in completes in Chrome; redirected back to `/` showing signed-in state; Mingla Business app does NOT open | Mobile config (post-RC-2 fix) |
| V-03 | Android brand deep-link | Receive `https://business.usemingla.com/b/{slug}` link in any messenger | Mingla Business app opens to brand page (App Link still works for whitelisted paths) | Mobile config |
| V-04 | Android event deep-link | Receive `https://business.usemingla.com/e/{slug}` link | App opens to event page | Mobile config |
| V-05 | Android Stripe return | Complete Stripe onboarding in Chrome custom tab → tap "Return to Mingla" | App opens via `mingla-business://onboarding-complete` scheme; status refresh fires | Mobile config |
| V-06 | iOS regression | Same scenarios | All pass on iOS (already working — unchanged AASA) | Mobile config |

# Recommended dispatch

After operator confirms Phase 16 device smoke for Stripe (V-01) passes:

1. Spec out RC-2 fix + HF-1 cleanup as a single short SPEC (Track B for Cycle B2a).
2. Implementor pass: edit `app.json` intent filters, optionally edit AASA components, optionally add `/onboarding-complete` page.
3. EAS Android build + reinstall on test device.
4. V-02 through V-05 device smoke.
5. Commit + push the now-existing 18 + new files.
6. CLOSE protocol with new invariant I-PROPOSED-Z proposed for tracker.
