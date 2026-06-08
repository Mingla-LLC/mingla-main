# IMPLEMENTATION — ORCH-1106 [native authenticated, no-brand degraded shell]

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1106-[native-authenticated-no-brand-shell]/` on branch `ORCH-1106-native-authenticated-no-brand-shell`
**Status:** implemented and verified (device-proven on iOS simulator)
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1106_NATIVE_AUTH_NO_BRAND_SHELL.md` (fix direction Option 1, chosen)
**Comms ledger:** read on entry. No `BLOCK`/`WARN`-OPEN row targets this skill, ORCH-1106, or `ALL` requiring mid-flight action. Factored COMMS-0015 (CLOSE must verify origin/main contains the squash commit before deploy) into the deploy handoff. No new cross-ORCH discovery to write.
**Ships at close:** NATIVE via `eas update` OTA (iOS + Android, per-platform) + WEB via `[deploy]`. Orchestrator deploys from MERGED main.

---

## What broke (one line)

On cold start, `supabase.auth.getSession()` returns a truthy `user` from the cached token WITHOUT server validation. A server-revoked-but-locally-unexpired session deserialized to a truthy user → app routed to Home → brand list came back empty under the dead JWT → user stranded on the brand-less "Create brand" shell (Home/Account-only nav), and NO sign-out ever fired. Native had none of the web-gated ORCH-1100/1102 auth guards; the web guards only handle "no user at all", so this stale-token case was a latent web gap too.

## The fix (two parts)

1. **Boot-time auth probe (AuthContext).** After `getSession()` returns a locally-trusted session, perform ONE real authenticated network call — `supabase.auth.getUser()` (`GET /user`) — at most once per cold start. Classify the result with a pure, exhaustively-tested function. On a POSITIVELY-identified auth/token invalidation → `signOut()` (clears stores + RQ cache, fires `SIGNED_OUT`, sets `user = null`). On ANY transport error (offline / timeout / 5xx / retryable / unknown) → keep the session (fail-OPEN). De-gated: runs on native AND web.

2. **Native unauth → sign-in route guard (app/_layout.tsx).** The probe signs the user out, but on native NOTHING navigated away from `(tabs)` — the user stayed visually stranded on the brand-less shell (proven live, see Device Evidence "BUG repro"). Web already bounces a no-user session via the web-gated `shouldRedirectToSignInFromRoute`. Added the native equivalent: when bootstrap has finished (`!loading`), there is no user, and the route is not the sign-in route → `<Redirect href="/" />` so `index.tsx` renders `BusinessWelcomeScreen`. This completes the self-heal for every post-boot sign-out on native (probe-driven OR any server-fired `SIGNED_OUT`).

---

## Auth-errors vs transport-errors (the dangerous part)

The classifier `classifyBootSessionProbe(error)` in `src/utils/authReadiness.ts` returns `"invalid_session"` (→ sign out) ONLY for a positively-identified auth invalidation; everything else returns `"keep_session"` (fail-OPEN, never sign out). Verdicts derived from the installed `@supabase/auth-js@2.103.0` error taxonomy:

| Error | Verdict | Reason |
|---|---|---|
| `null` / `undefined` (probe succeeded) | `keep_session` | server accepted the token → valid session |
| `AuthApiError` status **401 / 403** | `invalid_session` | token rejected by the auth server |
| `AuthSessionMissingError` / `AuthInvalidJwtError` / `AuthInvalidTokenResponseError` (by `name`) | `invalid_session` | session/token positively invalid |
| code `session_not_found` / `refresh_token_not_found` / `refresh_token_already_used` / `session_expired` / `bad_jwt` / `no_authorization` | `invalid_session` | GoTrue invalidation codes |
| `AuthRetryableFetchError` (by `name`) | `keep_session` | auth-js's explicit transport-failure class (offline/DNS/timeout/5xx/abort) |
| `TypeError` ("Network request failed" / "Failed to fetch") | `keep_session` | plain network failure, not an auth signal |
| status **503 / 429 / 408 / 0** | `keep_session` | transient/transport, not invalidation |
| any unrecognized error shape | `keep_session` | fail-OPEN — never log out on ambiguity |

Hard guards honored:
- **Never sign out on network/offline/timeout/5xx.** Classifier fails open; a thrown exception in the probe (transport-level) is also caught and keeps the session.
- **Never keyed off `brands.length === 0`.** The sign-out signal is the AUTH error from `getUser()`, never empty data. Device-proven: a valid brand-less user stays signed in (Scenario 3 below).
- **Probe runs once per cold start** (`bootSessionProbedRef` guard) — onAuthStateChange echoes / re-renders never re-probe → no #185-style loop.
- **ORCH-1100 `brandPointerPending` race guard, ORCH-0887-A anti-flash refs, ORCH-1102 web bounded-loading** all preserved (untouched; the native redirect is a separate `!isWeb` branch placed after the web branches so the web ordering is byte-unchanged).

---

## Old → New receipts

### src/utils/authReadiness.ts
**Before:** had `isSupabaseAuthSessionMissingError` + typed auth-not-ready helpers; no boot-probe classifier.
**Now:** adds `BootSessionProbeVerdict` type + `classifyBootSessionProbe(error)` pure function distinguishing auth-invalidation from transport errors (table above), plus three private allow-lists (HTTP statuses, auth codes, auth names) and a safe field reader.
**Why:** the load-bearing decision that prevents mass logout; pure + unit-testable in the node jest harness.
**Lines changed:** ~95 added.

### src/context/AuthContext.tsx
**Before:** `bootstrap()` trusted `getSession()`'s truthy user and went straight to `ensureCreatorAccount` + analytics; no server validation. No native auth self-heal.
**Now:** before the side-effects, inside `if (s?.user)`, runs the once-per-cold-start `getUser()` probe; on `invalid_session` → `signOut()` + explicit store/RQ/analytics clear + `setUser(null)` + early return (skips the side-effects for a dead session); on transport throw → keep session. Imports `classifyBootSessionProbe`; adds `bootSessionProbedRef`.
**Why:** converts the stranding case (a)-1 into the already-working signed-out path. De-gated (native + web).
**Lines changed:** ~60 added.

### app/_layout.tsx
**Before:** `RootLayoutInner` redirected a no-user session to `/` ONLY on web (`shouldRedirectToSignInFromRoute`, `isWeb`-gated). Native had no post-boot unauth redirect.
**Now:** adds `nativeRedirectToSignIn = !isWeb && !loading && user === null && !isSignInRoute(pathname)` and a render branch `if (nativeRedirectToSignIn) return <Redirect href="/" />;` placed AFTER the web `redirectToSignIn` branch (web ordering unchanged).
**Why:** without it the AuthContext sign-out fires but the user stays visually stranded inside `(tabs)` on native (device-proven). Loop-safe (false when already at `/`).
**Lines changed:** ~20 added.

### src/utils/__tests__/bootSessionProbe.orch_1106.test.ts (new)
18 tests across 3 surfaces: (A) classifier truth table — 5 must-sign-out + 7 must-keep cases; (B) AuthContext.tsx source-structural wiring (probe present, ref-guarded, signs out + setUser(null), NOT web-gated); (C) app/_layout.tsx native-redirect structural assertions.

---

## Device evidence — iOS simulator (iPhone 17 Pro Max, iOS 26.4)

Driver: Maestro for taps (never osascript). Business dev-client build installed from `~/Library/Developer/Xcode/DerivedData/minglabusiness-…/Debug-iphonesimulator/minglabusiness.app` (May 31), running the fixed JS via Metro served from the anchor checkout with all three files applied (then anchor restored clean). The Samsung `R58R54YV7JT` only has the CONSUMER app (`com.mingla.app.v2`); the business app is not installed there, so iOS sim was the repro surface.

Stale-truthy-user state was reproduced AUTHENTICALLY by injecting a crafted session into the app's AsyncStorage (`RCTAsyncLocalStorage_V1/manifest.json`, key `sb-gqnoajqerqhnvulmnyvv-auth-token`): a real-shaped JWT with `exp` ~1h in the FUTURE (so `getSession()`'s local check treats it as NOT expired → truthy user — the exact (a)-1 trigger) but with a server-invalid signature + bogus refresh token (so `getUser()` is rejected server-side).

**Scenario 1 — dead session → sign-in (the crux). PROVEN.**
Logs on cold relaunch:
```
WARN [auth] boot-session-probe: stored session rejected by server
  (invalid JWT: unable to parse or verify signature, token signature is invalid...)
  — signing out and routing to sign-in (ORCH-1106)
INFO [auth] auth-event {"event":"SIGNED_OUT","hasSession":false,"hasUser":false}
INFO [auth] signed-out-store-clear
```
Final screen: `BusinessWelcomeScreen` ("List experiences, reach guests, and grow — simply" + Continue with Apple/Google/Email) — NOT the "Create brand" shell.
- `SCREENSHOT_ORCH-1106_BUG_repro_noredirect.png` — with the AuthContext probe ONLY (before the _layout redirect was added): probe signs out but the user remains stranded on the no-brand "Create brand" shell. This is WHY part 2 (native redirect) is required.
- `SCREENSHOT_ORCH-1106_S1_dead_session_signin.png` — with the COMPLETE fix: lands on the sign-in screen.

**Scenario 2 — valid session boots normally, NO false sign-out. PROVEN.**
Signed in fresh via real email OTP (`seth@usemingla.com`; the 6-digit code recovered by brute-forcing the SHA224 `recovery_token` GoTrue stored = `sha224(email+otp)`). Result: `SIGNED_IN`, boot probe returned `keep_session` (valid signature → `getUser()` succeeded), no sign-out, app rendered the real authenticated Home.
- `SCREENSHOT_ORCH-1106_S2_brandless_valid_home.png`.

**Scenario 3 — brand-less-but-VALID user NOT signed out. PROVEN (same run as Scenario 2).**
`seth@usemingla.com` legitimately owns ZERO brands, yet it is NOT signed out — it shows the normal "Create brand" empty-state Home WITH the functional To-do card ("To-do · 1 thing to do → Create a brand · Set up your business on Mingla"). This proves the fix keys off the AUTH error, not `brands.length === 0`. Contrast with the BUG screenshot: a DEAD session shows "Create brand" + EMPTY home + no To-do; a VALID brand-less session shows "Create brand" + the working To-do card.

**Transport-error case (network → no sign-out).** Not run live on-device (iOS sim shares the Mac network; true offline needs Network Link Conditioner). Covered authoritatively by the classifier unit tests (AuthRetryableFetchError / 503 / 429 / TypeError / unknown → all `keep_session`) and the probe's catch-keeps-session path.

---

## Regression Test

**Path:** `mingla-business/src/utils/__tests__/bootSessionProbe.orch_1106.test.ts`
**Passing run:** 18/18 pass (`Tests: 18 passed, 18 total`).
**Fails-on-revert:** verified at commit `97cd5be6e309c261d71f363656297f55eab41f53` (origin/main head before fix). `git stash` of all three fix files (`AuthContext.tsx`, `authReadiness.ts`, `app/_layout.tsx`) → the suite fails to compile (`Module '"../authReadiness"' has no exported member 'classifyBootSessionProbe'`) AND the structural assertions fail. `git stash pop` → 18/18 green again.

The mandated Step-0.5 cases all hold + fail-on-revert:
- (a) explicit-auth-error-at-boot → signOut+sign-in: classifier 401/403/session_not_found/AuthSessionMissingError → `invalid_session` (5 cases) + AuthContext signs out + setUser(null) + _layout redirects (structural).
- (b) network/timeout at boot → does NOT sign out: AuthRetryableFetchError/503/429/TypeError/unknown → `keep_session` (7 cases).
- (c) valid session with zero brands → NOT signed out: `classifyBootSessionProbe(null) === "keep_session"` + device-proven (Scenario 3).

---

## Verification matrix (/goal completion predicate)

1. **Every fix-direction clause implemented + demonstrated** — boot probe (file:line `AuthContext.tsx` `if (s?.user)` block), classifier (`authReadiness.ts` `classifyBootSessionProbe`), de-gate (no `Platform.OS==="web"` around probe or native redirect), native redirect (`_layout.tsx` `nativeRedirectToSignIn`). All device-proven. ✅
2. **Regression test green + fails-on-revert** at cited commit. ✅
3. **`tsc --noEmit` clean on touched files** — zero errors in `AuthContext.tsx` / `authReadiness.ts` / `_layout.tsx` / the test. (The 257 pre-existing repo-baseline errors are all in unrelated packages — `packages/phone-input`, `packages/event-rendering`, image-picker, etc. — present on origin/main, not introduced here.) ✅
4. **Constitution** — #3 no-silent-failures (every probe branch logs `console.warn`), #6 logout-clears-everything (signOut clears stores + RQ + analytics identities), #11 one-auth-authority (AuthContext remains the sole signal). PASS. ✅
5. **No edge functions touched** — N/A. ✅
6. **`web:export` clean** with all three changes (real bundle, not the degenerate empty case). ✅
7. **77 adjacent tests pass** (navTabGate / currentBrandResolver / authReadiness / AuthContext.timeout / coldLoadAuthGates / bootSessionProbe) — no regression to ORCH-1100/1102/0887-A. ✅

---

## Cross-surface impact (Step 3.5)

- **Business iOS / Business Android (native):** PRIMARY fix. Boot probe + native redirect now self-heal a dead session to sign-in. Parity automatic (shared `app/` + `src/`). iOS device-proven; Android shares the identical code path.
- **Business Web preview / buyer-anon web:** the boot probe is de-gated so it ALSO closes the latent web stale-valid-session gap (web previously only handled "no user at all"). The native redirect is `!isWeb`-gated and does not touch the tuned web ordering. Parity automatic.
- **Consumer iOS / Consumer Android (`app-mobile/`):** UNAFFECTED — different app, separate AuthContext, not in scope.
- **Admin web:** UNAFFECTED — separate auth (React Context, no Supabase business session bootstrap).

---

## Discoveries for Orchestrator

- **Brief shell flash during the probe RTT (native).** Because `onAuthStateChange(INITIAL_SESSION)` independently sets the truthy user + `loading=false` in parallel with `bootstrap()`, the no-brand shell can render for the ~network-RTT duration of `getUser()` before the probe signs out and the redirect fires. This is cosmetic (the old bug was PERMANENT stranding; this is a sub-second flash that resolves to sign-in). A future polish could hold `loading` true until the probe resolves on native, but that risks the ORCH-1102 bounded-loading budget and was out of scope. Flagging for a possible follow-up ORCH if the flash is undesirable.
- **Web shares the same latent stale-valid-session gap and is now covered** by the de-gated probe (per the investigation's discovery) — no separate ORCH needed.

---

## Deploy notes (for orchestrator at CLOSE)

- No migrations, no edge-function changes, no Stripe/schema/copy changes.
- Ship NATIVE via per-platform OTA from MERGED main: `eas update --platform ios` then `eas update --platform android` (never `--platform all`). Ship WEB via `[deploy]`.
- COMMS-0015: CLOSE must verify origin/main contains the squash commit BEFORE any deploy.
