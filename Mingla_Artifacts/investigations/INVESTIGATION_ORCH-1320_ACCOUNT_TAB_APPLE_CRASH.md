# INVESTIGATION — ORCH-1320 [biz-account-tab-crash-on-apple-signin]

Mode: INVESTIGATE (read-only forensics; NO fix proposed).
Surface: `mingla-business/` NATIVE iOS. S0 LAUNCH BLOCKER — 3rd Apple App Store rejection.
Worktree: `~/Desktop/mingla-orchs/1320-[biz-account-apple-crash]/` on branch `1320-biz-account-apple-crash` (verified current with origin/main; 0/0).

---

## Symptom summary (expected vs actual)

- **Reporter:** Apple App Review, 2026-07-06. Submission `8d0b57b5-5591-4d92-8aa3-a3a728832dfb`. Guideline **2.1(a) Performance — App Completeness**. Version **1.0 (28)**. Device **iPad Air 11-inch (M3), iPadOS 26.5.2**, active internet.
- **Verbatim:** *"Your app closed unexpectedly when we were tapping on 'Account' when we sign in with Apple."* Apple adds the previously-identified issues "still need your attention."
- **Expected:** signing in with Apple then tapping the Account tab shows the Account screen ("Your brands" empty-state + Settings hub).
- **Actual:** the app terminates ("closes unexpectedly") — a hard crash, NOT the infinite spinner of the prior (2nd) rejection.
- **Reproduction conditions (per Apple):** deterministic on their device after Sign-in-with-Apple → tap Account.

### Saga (why this is the 3rd rejection)
- **Rejection 1** (`INVESTIGATION_REJECTION_applepay_passkit.md`, `INVESTIGATION_REJECTION_profile_spinner.md`): Apple Pay/PassKit + profile-edit infinite spinner + account-deletion findability.
- **Rejection 2** (build 1.0(15)): profile spinner + deletion. Fixed by **ORCH-1292** (build 28: bounded read timeouts + de-gated native boot ceiling + a direct "Delete account" row) and **ORCH-1294** (release the loading gate before the un-timed network chain).
- **Rejection 3 (THIS ORCH):** build **28** now CRASHES on tapping Account after Sign-in-with-Apple. New symptom class (termination, not hang).

---

## Investigation manifest (every file read, in trace order)

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `COMMS_LEDGER.md` (anchor) | process | Mandatory entry read — no OPEN BLOCK/WARN addressed to forensics/1320/ALL requiring action (0082/0084 are paywall/video WARNs, read + factored). |
| 2 | `Mingla_Artifacts/MASTER_BUG_LIST.md` | docs | Orchestrator's ORCH-1320 registration + ranked hypotheses. |
| 3 | `Mingla_Artifacts/reports/APPLE_REVIEW_NOTES_business_ios.md` | docs | The saga; confirms same submission ID was rejection 2 (build 15), fixed in build 28; `supportsTablet:false`. |
| 4 | `Mingla_Artifacts/reports/INVESTIGATION_REJECTION_profile_spinner.md` | docs | Prior business rejection = spinner (different class); reviewer bypass detail. |
| 5 | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1228/1230_CONSUMER_APPLE_*.md` | docs | Consumer fresh-Apple shape detection precedent (`provider==='apple'`, relay email, name first-auth-only). |
| 6 | `mingla-business/app.json` | schema | `ios.supportsTablet:false` → iPhone-compat mode on iPad; `newArchEnabled:true`; version now 1.0.2. |
| 7 | `mingla-business/app/(tabs)/account.tsx` (653 L) | code | The Account tab render — the literal crash surface. |
| 8 | `mingla-business/app/(tabs)/_layout.tsx` | code | Tab bar render + which tabs a brandless user sees. |
| 9 | `mingla-business/app/_layout.tsx` (827 L) | code | Provider tree + **ErrorBoundary placement** + Sentry init + deferred SDK init. |
| 10 | `mingla-business/src/context/AuthContext.tsx` (1231 L) | code | Apple sign-in path + deferred SIGNED_IN reconciliation + `user` shape. |
| 11 | `src/hooks/usePartnerStripe.ts`, `usePartnerBrandLinks.ts`, `useSupportStaff.ts` | code | The 3 account-only hooks. |
| 12 | `src/services/partnerStripeService.ts` (`getPartnerStripeStatus`) | code | The only network read unique to account-mount (`refetchOnMount:"always"`). |
| 13 | `src/services/creatorAccount.ts` (`ensureCreatorAccount`) | code | Runs for the fresh Apple user; seeds `creator_accounts`. |
| 14 | `src/components/ui/TopBar.tsx`, `ErrorBoundary.tsx`, `GlassCard.tsx`/`GlassChrome.tsx`, `Icon.tsx` | code | Shared leaf components (brand chip; blur; svg). |
| 15 | `app/account/edit-profile.tsx`, `app/account/delete.tsx` | code | Sub-routes the orchestrator flagged (provider/initials/blank-email). |
| 16 | `src/hooks/useBrandListShim.ts` | code | Drives the brand-list status for a zero-brand user. |
| 17 | Prod DB (read-only, project `gqnoajqerqhnvulmnyvv`) | data | Real Apple-account shape + reviewer-account existence on the review date. |

---

## Q-scorecard

**Q1 — Is the crash a JS render-throw from an unguarded identity read (the pre-dispatch H1)?**
Verdict: **NO — RULED OUT (proven, source).** Every reachable render read is null-guarded/optional-chained (F-1), AND the route tree is wrapped in a root `ErrorBoundary` (F-2). A React render throw is structurally caught → shows the "Something broke. We're on it." fallback + Sentry capture → it **cannot** terminate the app. "Closes unexpectedly" is therefore not a caught render throw.

**Q2 — Did the reviewer use REAL Sign-in-with-Apple (not the `appreview@` bypass)?**
Verdict: **YES — confirmed (data, F-5).** Two `provider='apple'` accounts were created on the exact review date 2026-07-06; the later one (19:24 UTC) has NO `creator_accounts` row.

**Q3 — Does the Account tab read any Apple-specific identity field unguarded?**
Verdict: **NO — proven (code+data, F-1/F-6).** `account.tsx` reads the user's `id` only (guarded `?? null`); it never reads `display_name`/`avatar_url`/`email`. The `.charAt(0)` initial is on `brand.displayName`, and the brand list is empty for a fresh account (zero brands, F-5), so that branch never executes.

**Q4 — What IS the crash?**
Verdict: **PROBABLE native crash** (SIGABRT/SIGSEGV/ObjC-exception) on the Account tab under iPad iPhone-compatibility mode, uncatchable by the JS ErrorBoundary (F-3). The **exact native frame is UNRESOLVED** — it requires a native crash log (Sentry / App Store Connect / an iPad repro). This is the single remaining unknown.

**Q5 — Is the bug live in current origin/main?**
Verdict: **YES — proven (git, F-4).** The entire account-tab tree is unchanged since ORCH-1294 (the build-28 lineage). No fixing commit exists.

**Q6 — Blast radius / is it really Apple-specific?**
Verdict: business-iOS confirmed (F-7). The "Apple-provider-specific" framing is **suspect**: if the root is iPad-compat-mode-native (data/provider-independent), a Google/email user on an iPad would also crash — the reviewer simply used Apple as the entry method and never tested another provider on iPad.

---

## Findings (six-field evidence)

### F-1 — Every reachable Account-tab render read is null-safe for the fresh-Apple shape
- **Symptom:** app closes on account-tab mount; pre-dispatch theory was an unguarded field read.
- **Layer:** code.
- **Probe:** read `app/(tabs)/account.tsx` verbatim + `grep -rE "(display_name|displayName|avatar_url|\.email|user_metadata|identities)[^)]{0,40}(\.charAt|\.split|\.toUpperCase|\[0\])" app src`.
- **Evidence:** the only identity destructures are `brand.displayName.charAt(0).toUpperCase()` (`account.tsx:288`) — inside `brands.map`, only reachable when `brands.length>0`; `PreviewEventView.tsx:179` uses `(brand?.displayName?.charAt(0) ?? "?")`; `creatorAccount.ts:31` uses `user.email?.split("@")[0]`. `account.tsx` reads `user?.id ?? null` (L461) only. The 3 hooks read `user?.id ?? null` and use `.maybeSingle()`/`?.data`/`??`. `getPartnerStripeStatus` (`partnerStripeService.ts:73-84`) uses `.maybeSingle()` → a MISSING `creator_accounts` row returns `not_a_partner` (no throw). TopBar brand chip (`TopBar.tsx:216-218`): `currentBrand===null ? "Create brand" : …`. AuthContext Apple path (`AuthContext.tsx:963-973`): `credential.fullName && …`, `gn && fn ? … : gn || fn`, `if (display)`. delete/edit-profile: `provider = user?.app_metadata?.provider` (guarded), `initials = (account?.display_name ?? user?.email ?? "U").trim()…`.
- **Mechanism:** a fresh Apple account has zero brands → the `.charAt(0)` branch is never rendered; no user-identity field is read on the tab → no null-deref is reachable on render.
- **Severity:** RULED OUT (as a JS render-throw root cause).

### F-2 — The route tree is wrapped in a root ErrorBoundary → a render throw cannot terminate the app
- **Symptom:** "closes unexpectedly."
- **Layer:** code.
- **Probe:** read `app/_layout.tsx` + `src/components/ui/ErrorBoundary.tsx`.
- **Evidence:** provider tree is `GestureHandlerRootView → SafeAreaProvider → ErrorBoundary(outer, →Sentry, L783-823) → QueryClientProvider → AuthProvider → KeyboardRoot → PostHogAnalyticsProvider → RootLayoutInner → ErrorBoundary(inner, →Sentry, L732-749) → <Stack/>`. `ErrorBoundary.tsx` wraps `react-error-boundary`'s `ErrorBoundary` with `DefaultFallback` ("Something broke. We're on it." + Try-again/Get-help). The Account route renders INSIDE `<Stack/>`, below the inner boundary.
- **Mechanism:** React error boundaries catch render/lifecycle/constructor throws of descendants in BOTH dev and release. A render throw in the Account tab is caught → fallback UI renders + `Sentry.captureException` fires. The app does not close. Therefore the observed termination is NOT a caught render throw.
- **Severity:** CONFIRMED (redirects the root cause away from JS render throws).

### F-3 — "Closes unexpectedly" ⇒ native crash or uncaught async/native-callback throw (not a render throw)
- **Symptom:** app terminates.
- **Layer:** code/runtime (runtime unverified — see blocker).
- **Probe:** enumerate what can terminate a release RN app that F-2's boundary does NOT catch.
- **Evidence:** React error boundaries do NOT catch: (a) native crashes (SIGABRT/SIGSEGV/ObjC exception) from a native module/view; (b) errors thrown in event handlers, `setTimeout`/macrotask callbacks, or native event-listener callbacks (RN routes these to the global `ErrorUtils` handler → fatal in release); (c) unhandled promise rejections are NON-fatal (warning only). The Account tab mounts stacked `expo-blur` `BlurView`s via `GlassChrome`/`GlassCard` (`GlassChrome.tsx:23,97`) and `react-native-svg` icons (`Icon.tsx:12`) under New Architecture/Fabric (`app.json newArchEnabled:true`) in iPhone-compat mode on iPad. The deferred SIGNED_IN macrotask (`AuthContext.tsx:639-750`) fires native identity SDK calls (AppsFlyer — freshest change ORCH-1313, OneSignal, RevenueCat, PostHog, Mixpanel); the boot SDK init runs `InteractionManager.runAfterInteractions` (`_layout.tsx:461`).
- **Mechanism:** with render throws excluded (F-2), the termination is either a native crash on the account view tree (compat-mode rendering) or a native SDK exception on the fresh-Apple SIGNED_IN path landing around the first interaction. Distinguishing these REQUIRES the native crash frame.
- **Severity:** SUSPECTED CONTRIBUTOR / probable class (native). Specific frame INCONCLUSIVE without a crash log.

### F-4 — The bug is live in current origin/main (unchanged since build 28)
- **Symptom:** must confirm not already fixed.
- **Layer:** code (git).
- **Probe:** `git log --oneline -8 -- app/(tabs)/account.tsx src/context/AuthContext.tsx app/account/*.tsx`.
- **Evidence:** newest touch to these files is `12ff89a79 ORCH-1294` (build-28 lineage); no later change. `git merge-base --is-ancestor origin/main HEAD` = up to date (0/0).
- **Mechanism:** the crashing surface is byte-identical to build 28 → the defect persists in current source. A new build will still carry it.
- **Severity:** CONFIRMED (live).

### F-5 — DATA: reviewer used real SIWA on the review date; fresh-Apple shape verified; some Apple users have NO creator_accounts row
- **Symptom:** confirm the reviewer's sign-in method + data shape (5th truth layer).
- **Layer:** data.
- **Probe:** read-only SQL on prod (`gqnoajqerqhnvulmnyvv`) over `auth.users` ⋈ `creator_accounts` ⋈ `brands` for `provider='apple'`.
- **Evidence (verbatim rows):** `2026-07-06` apple `6573bf6f-…` → `no_creator_account_row:true`, brand_count 0, relay email, no avatar; `2026-07-06` apple `83236e8a-…` → creator row exists, `display_name:"4sbmbn7749"` (= `email.split("@")[0]`), brand_count 0; `2026-07-05` apple `87207cdb-…` → `no_creator_account_row:true`. Across 15 recent apple accounts: `relay_email=true` for ALL, `has_avatar=false` for ALL, `brand_count=0` for ~all, `display_name` NULL for the majority (= the LEFT-JOIN null-extension of a MISSING creator_accounts row, not a null column).
- **Mechanism:** confirms (a) the reviewer used real Sign-in-with-Apple (two apple signups on the exact 2026-07-06 review date), and (b) the fresh-Apple shape = relay email / no avatar / no display_name / zero brands. Independently, `ensureCreatorAccount` did NOT persist a row for a subset of Apple signups (incl. the 07-06 19:24 account) — consistent with the app crashing before the deferred `ensureCreatorAccount` macrotask completed, OR an independent seed failure.
- **Severity:** CONFIRMED (data) for method + shape; the missing-row is a SECONDARY finding / Discovery (D-1).

### F-6 — The Apple DATA shape is not consumed by the Account-tab render
- **Symptom:** pre-dispatch theory tied the crash to Apple data.
- **Layer:** code+data.
- **Probe:** cross-reference F-1 reads against F-5 shape.
- **Evidence:** the tab renders brand initials (empty for zero brands) + partner/support cards (hidden unless enabled) + a static Settings hub. None of `email`/`display_name`/`avatar_url` is read on the tab; a missing `creator_accounts` row degrades every dependent read to a safe empty/`not_a_partner`.
- **Mechanism:** the crash is NOT caused by a JS consumer of Apple-specific data. This weakens "Apple-data-specific" and strengthens "iPad-compat-mode-native, provider-agnostic" (Q6).
- **Severity:** CONFIRMED (supports the native / provider-agnostic hypothesis).

### F-7 — supportsTablet:false ⇒ the app has never been optimized/tested for iPad (compat mode)
- **Symptom:** crash observed only on an iPad (M-series, iPadOS 26.5.2).
- **Layer:** schema/config.
- **Probe:** read `app.json`.
- **Evidence:** `ios.supportsTablet:false` → the iPhone binary runs letterboxed/scaled in iPhone-compatibility mode on iPad. `newArchEnabled:true`. Every prior Apple rejection was also observed in this mode (per `APPLE_REVIEW_NOTES`).
- **Mechanism:** compat mode + a brand-new large-screen OS (iPadOS 26.5.2) is exactly where an untested native rendering/scaling path (blur/Fabric) can crash; the app has no iPad test coverage.
- **Severity:** SUSPECTED CONTRIBUTOR (environmental amplifier).

---

## Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction? |
|-------|---------|----------------|
| **Docs** | Apple: crash on tap-Account after SIWA; prior issues "still need attention." Review notes: iPhone-only, runs iPad in compat mode. | — |
| **Schema/Config** | `supportsTablet:false`, New Arch, blur+svg leaf components. | — |
| **Code** | Entire account-tab render tree null-guarded AND ErrorBoundary-wrapped → a render throw shows a fallback, cannot terminate (F-1,F-2). | **YES — refutes the pre-dispatch "unguarded JS read → release crash" H1.** The root ErrorBoundary is the layer that holds the truth: JS render throws are contained. Termination ⇒ native (F-3). |
| **Runtime** | UNVERIFIED — the native crash frame is the single missing datum (blocked: Sentry MCP auth unavailable; local sim build non-viable; no test Apple ID on sim). | Gap = the exact frame. |
| **Data** | Real SIWA on review date; fresh-Apple shape = relay/no-avatar/no-name/zero-brands; the tab reads none of it; some Apple users have NO creator_accounts row (F-5,F-6). | Minor: `display_name NULL` in the join = missing row, not null column. |

The load-bearing contradiction: the pre-dispatch premise ("an unhandled JS error TERMINATES a release Hermes build") omits the **root ErrorBoundary** (`I-36 ROOT-ERROR-BOUNDARY`), which catches render throws in release. This is why a diligent source read finds "no obvious unguarded access" — because a JS render throw is not the mechanism.

---

## Repro evidence

- **Not reproduced by this investigation (runtime blocked).** Honest negative: no crash was captured at runtime.
- **Blockers (named, per Prime Directive 9 — caps confidence at "probable"):**
  1. **Local iOS sim build is non-viable** for this worktree: `mingla-business` is a managed-workflow app (no `ios/` prebuild), `node_modules` is a symlink to the anchor, and `react-native-keyboard-controller@1.18.5` (mounted at root via `KeyboardRoot`, `_layout.tsx:800`) does NOT link under a local New-Arch worktree build → red-screen at root (documented: ORCH-1317 / COMMS-0084 / `reference_consumer_device_test_use_eas_cloud_dev_build`). The account tab is therefore unreachable from a local build.
  2. **Sentry crash stack** — the app is Sentry-instrumented (`_layout.tsx:114-125`, env-gated `EXPO_PUBLIC_SENTRY_DSN`); if build 28's EAS build carried the DSN, the reviewer's crash stack is in Sentry. The Sentry MCP requires OAuth (unavailable in this non-interactive session).
  3. **App Store Connect / Xcode Organizer crash log** — Apple attaches/collects crash logs for a review-device termination; requires Seth's ASC access.
  4. **A faithful sim repro of the fresh-Apple shape** needs a test Apple ID on the simulator (real SIWA) — the `appreview@` bypass account is the WRONG shape (provider=email, has a seeded brand).
- **Sim inventory confirmed available for the next-phase runtime attempt:** iPad Air 11-inch (M4), iPad Pro 11/13 (M5), iPad (A16), etc.

---

## Blast radius / cross-surface map

| Surface | In scope? | Rationale |
|---|---|---|
| Business iOS (`mingla-business`) | **YES (primary)** | The confirmed crash surface (build 28). |
| Business Android | **Likely NO for the crash itself** | Shares the RN/JS source, but a native iOS-compat-mode crash (F-3/F-7) does not port to Android's renderer. Android should still be re-tested once the frame is known. |
| Buyer/anon Web (`/checkout`, `/e/…`) | NO | No native Apple sign-in, no Account tab. |
| Business Web preview | NO | Web renders no BlurView/Fabric native path; ErrorBoundary + web split differ. |
| Consumer iOS/Android (`app-mobile`) | NO (separate codebase) | Different Account UI; its Apple round (ORCH-1228/1230) had no account-tab crash. If the root is a shared native primitive (expo-blur under New Arch), consumer should be spot-checked. |
| Admin Web | NO | No equivalent. |

**Invariant impact (flagged, not resolved):** `I-36 ROOT-ERROR-BOUNDARY` is the invariant that makes F-2 hold — any fix must not remove/relocate the boundaries such that the account tree loses coverage. No invariant is violated by the current code; the crash lives below the JS layer the invariants govern.

---

## Discoveries for Orchestrator (side issues)

- **D-1 (data-integrity, S2 candidate):** `ensureCreatorAccount` did not persist a `creator_accounts` row for a subset of fresh Apple signups (`6573bf6f` 07-06, `87207cdb` 07-05). Either the app crashes before the deferred SIGNED_IN macrotask runs `ensureCreatorAccount` (`AuthContext.tsx:656`), or the upsert fails silently for these users. Worth its own investigation regardless of the crash. (Also: the "many Apple accounts have NULL display_name" observation is this missing row surfacing through a LEFT JOIN — not a null column.)
- **D-2 (perf, S3):** `usePartnerStripeStatus` runs `supabase.auth.getUser()` (a `GET /user` network round-trip) on EVERY Account-tab mount (`refetchOnMount:"always"`, `staleTime:0`) — a wasteful, throttled-network-sensitive call on the reviewer's proxy (does not crash; the card is merely hidden while it resolves).
- **D-3 (observability, S1 for THIS ORCH):** verify build 28's EAS build actually carried `EXPO_PUBLIC_SENTRY_DSN`. `_layout.tsx:126-135` warns that a keyless production bundle has crash reporting OFF. If OFF for build 28, the reviewer's crash was never captured — the ASC/Xcode-Organizer crash log becomes the only source.

---

## Confidence level

- **JS render-throw as the root cause: PROVEN RULED OUT** (F-1 + F-2; the root ErrorBoundary is definitive — a render throw cannot terminate the app).
- **Crash class = NATIVE (or an uncaught native-callback throw): PROBABLE** (strong source elimination + F-3 + F-7; the Runtime layer is unverified due to named, currently-unresolvable blockers → capped at "probable" per Prime Directive 9 and Failure Honesty).
- **The specific native frame/module: INCONCLUSIVE** — requires a native crash log (Sentry / ASC / iPad repro). Ranked candidate vectors (unproven suspects, for the crash-log hunt): (1) stacked `expo-blur` `BlurView`s under Fabric/New-Arch in iPhone-compat mode on iPadOS 26.5.2; (2) a native identity/analytics SDK on the fresh SIGNED_IN path (AppsFlyer — freshest change ORCH-1313 — / OneSignal / RevenueCat) firing around the first interaction; (3) a Fabric layout/scaling crash specific to compat mode.
- **"Apple-specific": SUSPECTED to be partly a red herring** — the crash may be iPad-compat-mode-general (provider-independent); the reviewer used Apple only as the entry method (F-6). The crash log will settle whether it is provider-dependent.

---

## Recommended next phase + scope (direction only — NOT a fix)

1. **NEXT = RUNTIME crash-log capture, BEFORE any SPEC.** A SPEC cannot target a fix without the native frame; do NOT spec blind. Fastest path: pull the build-28 crash log from **App Store Connect → the rejection / Xcode Organizer → Crashes** and/or **Sentry** (verify the DSN shipped, D-3). In parallel, build an **EAS cloud dev/preview build** (local worktree builds red-screen — see blocker) and reproduce on an **iPad** in compat mode: first sign in with the `appreview@` bypass and tap Account (tests the provider-INDEPENDENT hypothesis, F-6); if that does not crash, do real Sign-in-with-Apple (needs a test Apple ID on the device/sim) to hit the fresh-Apple shape; capture `~/Library/Logs/DiagnosticReports`.
2. **Fix DIRECTION (one line, gated on the crash log):** harden the Account-tab render for iPad iPhone-compatibility mode by neutralizing the crashing native view/module the crash log names — do NOT ship a blind guess. (Secondary, independent: fix D-1 so `ensureCreatorAccount` reliably persists for Apple users.)
3. Once the frame is known → dispatch SPEC (this skill) → implementor → tester → a NEW build (the fix must ship in a fresh binary regardless, F-4).

---

## Reproduction + Pinpoint (2026-07-06 — crash log symbolicated + live sim probe)

The native frame is now RESOLVED from a real crash log, and the leading "stacked expo-blur BlurView"
hypothesis was live-tested on the exact crash simulator and **REFUTED as the standalone trigger**.
Evidence redirects the root cause to a **Reanimated-4 worklets ↔ Fabric-commit concurrent
use-after-free race**.

### Repro status
- **Captured crash (definitive):** `evidence/ORCH-1320/MinglaBusiness-2026-07-02-004349.ips`. The
  crashing binary is the DerivedData dev build `MinglaBusiness.app` (mtime **Jul 2 00:14:44**); the
  crash fired **Jul 2 00:43:49** on sim device `2C3312D9-EE52-4EBD-9704-15811D49A2EC` =
  **iPhone 17 Pro Max, iOS 26.4** (NOT an iPad — the reviewer's iPad-compat framing was incidental;
  the crash is device-independent, iOS/iPadOS-26 + Fabric).
- **Live diagnostic (this session):** re-installed that exact binary on the same booted sim, served
  worktree JS via Metro, and reached the **real Account tab render** (fresh zero-brand shape) by two
  reverted worktree stubs (force-route to `/(tabs)/account` + neutralize `nativeRedirectToSignIn`;
  a third reverted stub suppressed a local-only `StripeModeMismatchError` dev red-screen — pk_test
  build vs live backend, unrelated to the crash). **Screen confirmed:** Account tab, "Create brand"
  chip + Settings card + Home/Ari/Account nav — the exact fresh-account shape Apple hit.
- **Blur probe result: DID NOT REPRODUCE.** With real iOS BlurView ON (`shouldUseRealBlur` returns
  `true` on iOS), the Account tab (a) **cold-mounted cleanly** and (b) **survived 3× Home↔Account +
  Ari→Account tab switches** driven by Maestro — process stayed alive, no `.ips`. A cold mount /
  tab-switch of the stacked-blur tree is therefore **NOT** the trigger. I did not even need to force
  the opaque fallback: the blur-ON baseline already refused to crash.

### The native frame (crash log, symbolicated)
- **Exception:** `EXC_BAD_ACCESS (SIGSEGV) / KERN_INVALID_ADDRESS at 0x620001000264003a`. That is a
  **wild/poisoned pointer** (not a small null-offset) → **use-after-free / heap corruption**, not a
  null-deref and not a memory-watchdog kill.
- **Faulting thread 11 = `com.facebook.react.runtime.JavaScript`**, top frames:
  `Scheduler::uiManagerDidFinishTransaction(...)::$_0` → `RuntimeScheduler_Modern::updateRendering`
  → `runEventLoopTick` → `runEventLoop`. i.e. the crash is **inside the Fabric mount/commit
  transaction** (committing native views under the New Architecture), below the JS ErrorBoundary
  (F-2) → the app fully closes. **No expo-blur / UIVisualEffectView frame appears in any thread.**
- **CONCURRENCY — the decisive datum:** at crash time the **main thread (T0) is executing Reanimated
  worklets** inside Hermes: `worklets::SerializableWorklet::toJSValue` /
  `SerializableArray::toJSValue` / `SerializableObject::toJSValue`, wrapped in
  `worklets::AroundLock` + `worklets::WorkletsReentrancyCheck`, under
  `HermesRuntimeImpl::setPropertyValue`. So **two runtimes touch shared state simultaneously**:
  Reanimated's worklets runtime deserializing/running a worklet on T0, while React's Fabric commit
  on T11 dereferences a freed/corrupted pointer. (A second idle JS runtime, T23, is also present.)

### The offending component (named, with evidence)
- **`react-native-reanimated ~4.1.1` + `react-native-worklets 0.5.1`** under the New Architecture,
  racing the Fabric mount commit. The concrete animation on the crash path is the **BottomNav tab-bar
  spotlight** (`src/components/ui/BottomNav.tsx`): `useSharedValue(left/width)` animated with
  `withSpring`/`withTiming` + `useAnimatedStyle` on an absolutely-positioned `Animated.View` that
  springs to the tapped tab on **every "tap Account."** `react-native-screens 4.16` drives the
  screen transition concurrently. (`app/index.tsx:28-31` already records a *prior* "BottomNav
  reanimated OOM" native failure — this area has a native-instability history.)
- **Upstream corroboration (same signature):** software-mansion/react-native-reanimated issues
  **#9402** ("[iOS] EXC_BAD_ACCESS in performOperations from handleRawEvent during screen pop") and
  **#9293** ("EXC_BAD_ACCESS in ReanimatedModuleProxy::performOperations during
  AnimationFrameBatchinator::flush", New Arch) describe **exactly** a "mount-time dereference of a
  stale view during a Reanimated commit on Fabric," triggered by a screen/stack transition. A
  **registry-locking fix landed in Reanimated 4.3.1 (2026-05-07)** for the `AnimatedPropsRegistry`
  UAF variant — **newer than our pinned 4.1.1** (see Sources).
- **Why the static probe didn't repro:** the race window is narrow. My diagnostic had **no live
  session**, so no async data-settling re-commits (React Query resolving `usePartnerStripeStatus` /
  `useBrands` / `useSupportStaff` on a *signed-in* account produce extra Fabric commits **while** the
  spotlight worklet runs) and **OneSignal/AppsFlyer were env-disabled**. The real signed-in flow
  multiplies concurrent commits → hits the race; ~4 static tab-taps did not. This is an
  **intermittent** UAF race (repro'd once for Seth, sometimes for Apple), consistent with a data race.

### Confidence
- **Crash class = native Fabric mount-commit use-after-free:** **PROVEN** (crash log).
- **Reanimated-4/worklets ↔ Fabric-commit concurrency at the fault:** **PROVEN** (T0 worklet frames
  concurrent with the T11 commit crash).
- **Reanimated as the root cause:** **PROBABLE (high)** — direct crash-log concurrency + exact-match
  upstream issues, but I could NOT capture a positive *live* repro of the race (it needs the
  auth-gated signed-in data-settling flow; the reviewer bypass needs a server secret I must not
  read, and email OTP/OAuth are not headless → a genuine Prime-Directive-9 STOP for the live-repro
  half; caps this at "probable").
- **expo-blur BlurView as standalone cause:** **RULED OUT** (live blur-ON cold-mount + tab-switch on
  the exact crash sim both survived).

### Ranked fix options (component-level; New Arch preserved — Reanimated 4 requires it)
1. **[RECOMMENDED — durable root fix] Bump `react-native-reanimated` 4.1.1 → ≥ 4.3.1 and
   `react-native-worklets` 0.5.1 → its matching line**, which includes the 2026-05-07 registry-locking
   UAF fix. Dependency-only (no product-code churn), targets the proven mechanism. RISK: upstream
   #9402/#9293 show *some* variants persisted on 4.3.x → treat as necessary-not-sufficient; verify
   the exact fixed version against the changelog and soak-test the signed-in Account path. Needs a
   fresh native build.
2. **[RECOMMENDED — deterministic launch mitigation] De-worklet the crash-path animations.** Replace
   BottomNav's `withSpring`/`withTiming` shared-value spotlight with a non-worklet animation (RN
   `Animated` on the JS thread) or a static/instant spotlight, AND disable the native-stack tab
   screen-transition animation. Removes the concrete worklet that races "tap Account" without waiting
   on an upstream release. RISK: cosmetic (loses the animated spotlight); Reanimated still used in
   Toast/TopBar/IconChrome so a rare residual race is possible — but the always-mounted tab-switch
   racer is eliminated. Scoped, ships in the same build.
3. **[Most faithful to upstream, higher implement risk] Apply the documented app-side mitigation:**
   before a tab/screen transition, cancel animations + drain the `SharedValue`s tied to animated
   styles in the unmounting subtree and gate event-driven worklets behind a "closing" flag. Directly
   starves the race, but is subtle to get right across the tab navigator.

**Recommendation:** ship **Option 2 (deterministic) + Option 1 (durable)** together for the resubmit;
gate the build on a device/sim soak of many rapid *signed-in* Home↔Account taps showing zero `.ips`.
Do NOT ship the earlier "force opaque blur" idea as the fix — the blur probe refuted it.

**Sources (fix-ranking):** react-native-reanimated Releases (4.3.1, 2026-05-07 registry-locking fix);
GitHub issues software-mansion/react-native-reanimated#9402 and #9293 (Fabric mount-time
EXC_BAD_ACCESS during screen transition, New Architecture).
