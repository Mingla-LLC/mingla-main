# SPEC — ORCH-1313 [AppsFlyer attribution + OneLink] · PHASE 1 (attribution correctness)

**Phase:** SPEC (binding build contract — no product code written here)
**Date:** 2026-07-05
**Skill:** mingla-forensics / claude
**Upstream:** `Mingla_Artifacts/investigations/INVESTIGATION_ORCH-1313_APPSFLYER_ATTRIBUTION.md` (truth table F-1..F-16, gap list G-1..G-6). This SPEC honors that investigation's recommended scope; it does not widen or re-investigate.
**Scope lock:** PHASE 1 = attribution correctness only. **OneLink / deferred deep-linking is PHASE 2 and is explicitly OUT OF SCOPE here** (see §11-B). Product decisions from Seth are BINDING: (1) the ATT/tracking prompt moves to FIRST APP-OPEN for anonymous users to capture every install, preserving Apple's ATT-before-any-tracking ordering; (2) OneLink is deferred to Phase 2.
**Secret hygiene:** the consumer dev key is masked `W29Z6c…` throughout; no secret VALUE is printed. AppsFlyer app IDs (App Store numeric IDs / Play package names) are public identifiers and are shown in full.
**External-docs-verified:** every api3 shape below was checked against AppsFlyer's CURRENT public docs (`dev.appsflyer.com/hc/reference/s2s-events-api3-post` + overview, cross-checked against the AppsFlyer support S2S bulletin and Adapty's api2→api3 migration doc). No live AppsFlyer dashboard or live API was accessed.

---

## 1. Executive summary

Six related fixes make Mingla's AppsFlyer attribution actually correct at launch, in impact order:

- **A (consumer install undercount — G-1):** today the consumer app only starts transmitting to AppsFlyer AFTER the user signs in, so a download that bounces before sign-up is invisible to attribution — and on iOS it also blocks PostHog (which waits on the same ATT gate). Move the ATT prompt + AppsFlyer start to fire at **first app-open for anonymous users**, keeping ATT as the sole first system dialog. User identity still binds later when they sign in.
- **B (consumer logout-clear — G-5):** consumer logout resets OneSignal/RevenueCat/Mixpanel but NOT AppsFlyer (Constitution #6 gap). Add + wire `clearAppsFlyerUserId()` and `resetAppsFlyerDeviceCache()`, mirroring the business service which already has them.
- **C (consumer config parity — secret hygiene):** move the hard-coded consumer dev key + app IDs to `EXPO_PUBLIC_APPSFLYER_*` env with a build-time guard so a release build can never silently ship without the key (mirrors the GIPHY guard) — and add the same fail-loud guard to the business build so business AppsFlyer can never silently ship dark again (G-2).
- **D (backend S2S correctness — G-4/G-6):** the business revenue S2S posts to AppsFlyer's current api3 endpoint but with the wrong credential (a dev key where api3 requires the V2 S2S token) and a malformed iOS app id (bare number where api3 requires the `id`-prefixed form). Fix both; add the `os` field api3 requires; and DELETE the dead, deprecated-`api2` consumer `process-referral` S2S path (zero callers, confirmed).
- **E (SKAdNetwork — G-3, DEFERRABLE):** neither iOS app declares `SKAdNetworkItems`, so ATT-denied installs from paid networks can't attribute via SKAN. Add the scaffold now; the full network list must be in place before the first paid iOS campaign. LOW priority (no ad spend yet).

Nothing here builds OneLink, deep-linking, or conversion-data callbacks. Those are Phase 2.

---

## 2. Scope & non-goals

### In scope (Phase 1)
- **A.** Consumer: fire ATT + `startAppsFlyer()` at first app-open for anonymous (not-yet-signed-in) users. (§4.A)
- **B.** Consumer: add `clearAppsFlyerUserId()` + `resetAppsFlyerDeviceCache()` to the consumer service and wire both into `performPrivateAuthCleanup`. (§4.B)
- **C.** Consumer: env-drive the AppsFlyer dev key + app IDs via `EXPO_PUBLIC_APPSFLYER_*` with a release-bound build-time guard; add the symmetric guard to the business build. (§4.C)
- **D.** Backend: fix the business S2S auth credential (api3 V2 S2S token, not the dev key), normalize the iOS app id to the `id`-prefixed form, add the `os` field; DELETE the dead consumer `process-referral` path. (§4.D)
- **E.** iOS: add `SKAdNetworkItems` to both apps' `ios.infoPlist` (scaffold + AppsFlyer's own network ID now; full list before first paid iOS UA). DEFERRABLE. (§4.E)

### Non-goals (do NOT build in this ORCH)
- **OneLink, deferred deep-linking, `onDeepLinkListener`, `onInstallConversionDataListener`** — Phase 2. Both apps keep both listeners `false`. (F-10.)
- **No change to the consumer identity-binding effect** (`app/index.tsx` L391-413) — `setAppsFlyerUserId`/`registerAppsFlyerDevice`/`af_login`/`af_complete_registration` stay exactly as they are; they correctly fire on sign-in.
- **No change to the business ATT/start timing** — `mingla-business/app/_layout.tsx` already fires ATT + `initializeAppsFlyer()` at first-open (deferred mount effect, NOT auth-gated), which is already the Item-A behavior for business (F-7/F-8). Verify only; do not touch.
- **No change to the business identity lifecycle** (`AuthContext.tsx`) — already fully correct (F-5).
- **No change to the S2S caller sites** (`stripeWebhookRouter.ts`, `stripeDisputeHandlers.ts`) — the Item-D fix is internal to `_shared/appsFlyerS2S.ts` and transparent to callers.
- **No event-map / PII change** — event maps are already PII-clean (F-16).
- **No `eventValue` serialization change** — the current `JSON.stringify(eventValues)` matches AppsFlyer's documented S2S string-JSON convention; leaving it is deliberate, not an oversight.
- **No admin-web / buyer-web / business-web-preview change** — AppsFlyer is native-only; the web split is a no-op (F-*, correct).

### Assumptions (from the dispatch's CONFIRMED NEW FACTS — do NOT re-investigate)
- Business EAS production env HAS `EXPO_PUBLIC_APPSFLYER_DEV_KEY` + `_IOS_APP_ID` + `_ANDROID_APP_ID` (EAS secret-type). (Live-fire inlining confirmation is a REMAINS-FOR-SETH item — §10.)
- Supabase secrets present: `APPSFLYER_DEV_KEY`, `APPSFLYER_BUSINESS_DEV_KEY` (same digest as `APPSFLYER_DEV_KEY` → single AppsFlyer account, shared dev key), `APPSFLYER_BUSINESS_IOS_APP_ID`, `APPSFLYER_BUSINESS_ANDROID_APP_ID`. A new `APPSFLYER_S2S_TOKEN` secret must be provisioned for Item D (§10).
- Single AppsFlyer account ⇒ the consumer literal `W29Z6c…` SHOULD equal the account `APPSFLYER_DEV_KEY`. §4.C requires a digest-equality verification; a mismatch means the consumer points at the WRONG account → ELEVATE (§10, RISK-1).

---

## 3. Cross-Surface Impact Declaration (MANDATORY per-surface)

| # | Surface | Covered | User-visible behavior demanded | Files touched here | Parity |
|---|---------|---------|--------------------------------|--------------------|--------|
| 1 | **Consumer iOS** (`app-mobile/` iOS) | YES (A,B,C,E) | ATT dialog appears at first app-open (anonymous), before any tracking; install attributes even without sign-in; logout clears AF identity; SKAN scaffold present. | `app/index.tsx`, `src/services/appsFlyerService.ts`, `src/utils/authCleanup.ts`, `app.config.ts`, `app.json` | manual (RN shared code; iOS-specific ATT + infoPlist) |
| 2 | **Consumer Android** (`app-mobile/` Android) | YES (A,B,C) | No ATT dialog (Android ATT is a no-op — gate opens immediately); `startAppsFlyer()` fires at first app-open (anonymous); install attributes without sign-in; logout clears AF identity. | same as row 1 minus `app.json` SKAN | manual (ATT branch differs) |
| 3 | **Buyer/anonymous Web** (`mingla-business/` `/checkout/*`, `/e/*`, `/b/*`, `/t/*`) | NO | none | none | n/a — AppsFlyer is native-only; the `.web.ts` split is a no-op (F-*). |
| 4 | **Business iOS** | YES (C,D,E) | Build fails loud if AF env absent (no more silent-dark); revenue milestone S2S actually lands (correct api3 token + `id`-prefixed iOS id); SKAN scaffold present. Start-timing already correct (no change). | `app.config.ts`, `app.json`, backend `_shared/appsFlyerS2S.ts` | manual |
| 5 | **Business Android** | YES (C,D) | Build fails loud if AF env absent; revenue milestone S2S lands (correct token; Android package unchanged). | `app.config.ts`, backend `_shared/appsFlyerS2S.ts` | manual |
| 6 | **Admin Web** (`mingla-admin/`, adjacent) | NO | none | none | n/a — no AppsFlyer. |
| 7 | **Business Web preview** (adjacent) | NO | none | none | n/a — `appsFlyerService.web.ts` all no-ops. |

Backend edge (`supabase/functions/_shared/appsFlyerS2S.ts` + deletion of `process-referral/`) is a shared backend surface serving rows 4/5.

---

## 4. Layered specification

### 4.A — CONSUMER first-open attribution (fixes G-1)

**File:** `app-mobile/app/index.tsx` — the ATT effect currently at **L927-952** (`const attFiredRef = useRef(false); useEffect(() => { … }, [isAuthenticated, isLoadingAuth, user?.id])`).

**Root of the undercount (F-3, re-stated for the implementor):** the effect early-returns on `if (!isAuthenticated || !user?.id) return` (L931). `ensureAttRequested()` (which resolves the ATT gate) is therefore never called for an anonymous session. Consequence on iOS: `whenAttResolved()` never resolves → `startAppsFlyer()` never runs AND `postHogService.initialize()` (which internally `await whenAttResolved()` at `src/services/postHogService.ts` L163-164 before constructing the client) blocks forever. So an anonymous iOS user gets NO ATT prompt, NO AppsFlyer install/session postback, and NO PostHog. This is the single biggest launch attribution risk.

**Required change (behavior contract):**
- Remove the auth gate. The ATT trigger must fire **once per process at first app-open, independent of auth state** — `AppContent` is mounted for anonymous users (it renders welcome/onboarding/home), so a mount-scoped effect fires at cold start.
- Convert the effect to fire on mount: guard with the existing `attFiredRef` (set it true on first run), drop `isAuthenticated`/`user?.id`/`isLoadingAuth` from the gate and from the dependency array (`[]`, intentionally-once — keep the existing eslint-disable-next-line comment pattern used by the sibling mount effects at L384/L357).
- Keep, verbatim, the body's two calls and their ordering:
  - `whenAttResolved().then(() => resumeInAppMessages())` (the ORCH-1260 IAM-hold-until-ATT behavior),
  - `ensureAttRequested().then(() => startAppsFlyer()).catch((err) => { console.warn("[ATT] …", err); startAppsFlyer(); })`.
- **Do NOT touch** `ensureAttRequested()`/`whenAttResolved()`/`requestAttWhenActive()` in `permissionOrchestrator.ts` — they are already anonymous-safe: `ensureAttRequested()` is single-flight (`_attRequestInFlight`) and internally AppState-`active`-gated (`shouldRequestAttNow`), so ATT is still issued exactly once and only on foreground-`active`. On non-iOS the gate is already open at module load (L56-59) so `startAppsFlyer()` runs immediately at first-open.
- **Do NOT touch** `requestPostTourPermissions()` (permissionOrchestrator L161-176) — it still routes through the same single-flight gate, so the post-onboarding path and the new first-open path can never double-prompt ATT or double-start AppsFlyer (both are idempotent).

**Identity binding once the user signs in (unchanged — restate, do not modify):** the separate effect at `app/index.tsx` L391-413 already fires `setAppsFlyerUserId(user.id)` + `registerAppsFlyerDevice(user.id)` on `user?.id`, plus the once-per-session `af_login`/`af_complete_registration` event. `setAppsFlyerUserId`/`registerAppsFlyerDevice` require only `_initialized` (not `_started`), and `initializeAppsFlyer()` already runs at mount (L384-386), so binding works whenever sign-in happens — before OR after `startAppsFlyer()`. Correct order at runtime: init (mount) → ATT resolves → `startAppsFlyer()` (anonymous install/session begins) → later sign-in → `setCustomerUserId` attaches the user to the already-attributed device. No change needed.

**Business app (Item-A check — NO CHANGE):** `mingla-business/app/_layout.tsx` L459-534 fires ATT then `initializeAppsFlyer()` inside a deferred mount effect (`InteractionManager.runAfterInteractions` → `setTimeout(0)`, deps `[]`), NOT auth-gated. Business uses SDK v6.17.9 without `manualStart`, so `initSdk` auto-starts transmission at cold boot (no `startSdk` needed). That is already the first-open-for-anonymous behavior. **Verify parity; do not modify.**

**Edge cases (A):**
- Cold-start into background (push-launched): `ensureAttRequested()` waits for the first `active` transition before prompting — handled, no change.
- Returning user who already answered ATT: `requestTrackingPermissionsAsync()` resolves immediately with the prior decision (no re-prompt) — unchanged.
- React remount / Strict-mode double-invoke: `attFiredRef` + `ensureAttRequested()` single-flight + `startAppsFlyer()`'s `_started` guard make every call idempotent.
- Apple reviewer (the ORCH-1228/1257/1258 rejection history): ATT now presents EARLIER (first-open, not post-sign-in), which strictly helps the "reviewer could not locate the ATT prompt" concern. The single-dialog ordering (ATT → onboarding location → push) is preserved because onboarding's location step still `await`s `whenAttResolved()` and push still routes through `requestPostTourPermissions()`.

### 4.B — CONSUMER logout-clear (fixes G-5, Constitution #6)

**File 1:** `app-mobile/src/services/appsFlyerService.ts` — ADD two exports, mirroring the business service (`mingla-business/src/services/appsFlyerService.ts` L168-177 and L259-261) exactly:
- `clearAppsFlyerUserId(): void` — `if (!_initialized) return;` then `appsFlyer.setCustomerUserId("", cb)` inside try/catch (consumer imports `appsFlyer` statically at module top, so no `!appsFlyer` guard is needed — match the consumer's existing `setAppsFlyerUserId` shape at L88-97, not the business `!appsFlyer` shape). Protective JSDoc: "Constitution #6 — logout clears everything, including third-party identity caches that survive Supabase signOut."
- `resetAppsFlyerDeviceCache(): void` — `registeredDeviceKeys.clear();` (the consumer already owns `registeredDeviceKeys` at L19). JSDoc: "Call on signOut so the next signed-in user is registered fresh rather than skipped as already-registered."

**File 2:** `app-mobile/src/utils/authCleanup.ts` — inside the `if (includeIntegrations) { … }` block (L51-70), alongside the OneSignal/RevenueCat/Mixpanel resets, ADD the AppsFlyer clear. Use the SYNCHRONOUS static-import style (the consumer service is a plain static module, not a lazy dynamic import): import `{ clearAppsFlyerUserId, resetAppsFlyerDeviceCache }` and call both inside a try/catch that warns with the `reason` on failure (match the OneSignal block's shape at L52-57).

**Call order + idempotency (B):**
- Order within the integrations block does not matter functionally (each reset is independent), but place the AppsFlyer clear alongside the others for readability; call `clearAppsFlyerUserId()` then `resetAppsFlyerDeviceCache()`.
- Both are idempotent: `clearAppsFlyerUserId` no-ops if `!_initialized`; `resetAppsFlyerDeviceCache` clearing an empty Set is a no-op. Safe to call on every cleanup (logout, account-switch, JWT-expiry) — `performPrivateAuthCleanup` runs on all three.
- **Do NOT** gate the clear behind `currentUserId` — logout must always clear, and account-switch (`performPrivateAuthCleanup` with a new `currentUserId`) must reset the device cache so the next user re-registers.
- **Ordering vs Supabase signOut:** `performPrivateAuthCleanup` runs BEFORE `supabase.auth.signOut()` in `signOutWithPrivateCleanup` (authCleanup L92-93). AppsFlyer's `setCustomerUserId("")` is a local SDK call (no Supabase dependency), so clearing before the Supabase session tears down is correct — the prior user's `customer_user_id` is dropped from the SDK immediately.

### 4.C — CONSUMER config parity / secret hygiene

**Design principle:** the AppsFlyer dev key is an app-embedded, extractable value (it ships in every binary), like the Supabase anon key and the Stripe publishable key already handled in `app.config.ts`. "Secret hygiene" here means SINGLE-SOURCE + env-override + fail-loud-if-missing, NOT true secrecy. The overriding constraint is **zero attribution regression**: the consumer app works today because the key is hard-coded; moving to env must not introduce a silent-dark failure mode.

**File 1:** `app-mobile/app.config.ts` — this dynamic config already spreads `app.json` and emits `extra` (the OTA/Hermes-safe runtime path, per the COMMS-0028 lesson documented in the business `app.config.ts` L136-144). ADD an `extra` block emitting the three AppsFlyer values, guarded exactly like the business GIPHY guard (`mingla-business/app.config.ts` L241-279):
- `EXPO_PUBLIC_APPSFLYER_DEV_KEY`: an IIFE that reads `process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY`; on a **release-bound EAS profile** (`EAS_BUILD_PROFILE ∈ {production, production-apk, preview, preview-sim}`) THROW if absent (fail the build, loud — this IS the build-time inlining assertion the dispatch requires); on local/dev (`EAS_BUILD_PROFILE` undefined) fall back to the current literal `"W29Z6c…"` (paste the real literal from `appsFlyerService.ts` L9) so a developer without env still gets a working build.
- `EXPO_PUBLIC_APPSFLYER_IOS_APP_ID`: same guard, dev fallback `"6760440898"`.
- `EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID`: same guard, dev fallback `"com.mingla.app.v2"`.
- Protective comment referencing this ORCH and the "release-bound throw = never ships dark" rationale.

**File 2:** `app-mobile/src/services/appsFlyerService.ts` — replace the three hard-coded literals (L9-11) with reads that prefer `extra` then `process.env`, mirroring `supabase.ts`'s `Constants.expoConfig?.extra?.X ?? process.env.X` pattern:
- `const AF_DEV_KEY = (Constants.expoConfig?.extra?.EXPO_PUBLIC_APPSFLYER_DEV_KEY as string | undefined) ?? process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY;` (import `Constants` from `expo-constants`), and likewise for the two app IDs.
- Add a `hasAppsFlyerEnv` boolean and make `initializeAppsFlyer()` early-return with a single `console.warn` when it is false (mirror the business service L110-116) — defense-in-depth; on release builds the app.config guard guarantees the values are present, so this warn path only ever fires in a misconfigured dev build.
- The `react-native-appsflyer` plugin stays UNCONDITIONALLY in `app-mobile/app.json` plugins (L169) — consumer AppsFlyer is always-on; do NOT env-gate the plugin (unlike business).

**File 3 (business symmetric guard — hardens G-2):** `mingla-business/app.config.ts` — the business build currently STRIPS the AppsFlyer plugin silently when env is absent (`filterOptionalNativeStartupPlugins` L23-31 + `hasAppsFlyerEnv` L13-18), which is exactly how business shipped dark (F-6). ADD a release-bound assertion: at the top of the default-export config function, if `EAS_BUILD_PROFILE` is release-bound AND `!hasAppsFlyerEnv()`, THROW with a clear message ("business AppsFlyer env missing on a release build — installs/revenue would not attribute; set EXPO_PUBLIC_APPSFLYER_DEV_KEY + _IOS_APP_ID + _ANDROID_APP_ID in the EAS environment"). Dev/local builds keep the strip-and-no-op behavior (no throw). This flips business AppsFlyer from silently-optional to loudly-required on release-bound profiles — a deliberate hardening, safe because the business EAS production env already has the vars (dispatch's confirmed facts). Flagged as OQ-2 (§10) for Seth's confirmation.

**Verification (C — live-fire, §10):** confirm the consumer literal `W29Z6c…` digest equals the account `APPSFLYER_DEV_KEY` secret digest (which per the dispatch equals `APPSFLYER_BUSINESS_DEV_KEY`). If they differ, the consumer is pointed at the WRONG AppsFlyer account — STOP and elevate (RISK-1).

**REVIEW dependency-walk (MANDATORY, C):** touching `app.config.ts` / `app.json` / env config is a NATIVE build-input change. The implementor MUST flag this for the REVIEW dependency-walk: (a) both consumer platforms require a fresh native build (not OTA) to pick up new `extra`/infoPlist; (b) the `expo config` resolution must be run locally to prove the guard does not throw for the local/dev profile and DOES throw when a release profile is simulated with the env unset; (c) EXPO_PUBLIC inlining is only realized at build time (§10 live-fire).

### 4.D — BACKEND S2S correctness (fixes G-4 + G-6)

**File:** `supabase/functions/_shared/appsFlyerS2S.ts`.

Verified api3 contract (from AppsFlyer's `s2s-events-api3-post` reference):
- **iOS `app_id` MUST be `id`-prefixed** — doc verbatim: "Ensure to prefix with id, for example id123456789." Android uses the bare Play package name.
- **api3 requires the V2 S2S key**, not the legacy dev key (the dev key was for `api2`, which AppsFlyer deprecated in December 2023). The credential is passed in the `authentication` header (header NAME is correct today; the VALUE is wrong).
- **`os` field**: doc verbatim — "To enable correct data processing you **must** send this parameter." Currently absent.
- **`eventValue`**: required JSON — the current `JSON.stringify(...)` string-JSON is the documented S2S convention; leave it.

**D-i — auth credential (fixes F-13):**
- Read a NEW env `const s2sToken = Deno.env.get("APPSFLYER_S2S_TOKEN");` and pass it in the `authentication` header (keep the header key literally lowercase `"authentication"` — L173-174).
- Replace the env-presence guard (L134-142): require `s2sToken` + `iosAppId` + `androidAppId` (drop `APPSFLYER_BUSINESS_DEV_KEY` from the guard — it is no longer used for auth). If `APPSFLYER_S2S_TOKEN` is absent, `console.warn` a clear reason and `return false` — **fail-closed; NEVER fall back to the dev key** (the silent-auth-fail is the current bug).
- Leave `APPSFLYER_BUSINESS_DEV_KEY` referenced nowhere in the auth path. (Removing the Supabase secret itself is a Seth action, not code.)
- Update the header doc comment + the `Env required` JSDoc block (L13-16) to name `APPSFLYER_S2S_TOKEN` and describe it as the api3 V2 S2S token (from AppsFlyer Security Center), explicitly NOT the dev key.

**D-ii — iOS app id `id`-prefix (fixes F-14):**
- Add an idempotent normalizer and apply it when the device is iOS: e.g. `const appId = device.platform === "ios" ? ensureIdPrefix(iosAppId) : androidAppId;` where `ensureIdPrefix(v) => v.startsWith("id") ? v : "id" + v`. This is robust whether the `APPSFLYER_BUSINESS_IOS_APP_ID` secret holds `6768737367` or `id6768737367` (no double-prefix). Android is unchanged (package name, no prefix).
- Protective comment: "AppsFlyer api3 requires the iOS app id in the `id`-prefixed form (id6768737367); the bare number returns 200 OK but silently drops the event."

**D-iii — app discriminator (already correct for the LIVE path):**
- `fetchBusinessDevice()` ALREADY filters `.eq("app", "business")` (L55). No change — the LIVE business S2S never crosses consumer rows. Restate for the implementor: do NOT remove this filter. The only un-discriminated read was in the DEAD `process-referral` path (F-11 L118-121), which D-v deletes entirely.

**D-iv — `os` field (api3-required correctness):**
- Add `os: device.platform` to the POST body (`device.platform` is already `"ios" | "android"`). Doc-required for correct processing; we have the value for free.
- Do NOT add `bundleIdentifier` in this pass — the correct value is the reverse-DNS bundle id (e.g. `com.sethogieva.minglabusiness`), which is a DIFFERENT identifier than the app-id we have in env; introducing a wrong value is worse than omitting an optional best-practice field. Note it for a possible follow-up.

**D-v — DELETE the dead consumer `process-referral` S2S (fixes G-6):**
- Confirmed ZERO callers repo-wide (grep across `app-mobile`, `mingla-business`, `supabase`, `mingla-admin`, `packages` returns nothing outside the function's own dir). The function is "notification-only + a dead S2S" that targets the deprecated `api2` endpoint (L127) with a bare iOS id and no app discriminator.
- **Recommended: DELETE the entire `supabase/functions/process-referral/` directory.** The referral CREDIT is handled by the DB trigger `credit_referral_on_friend_accepted` (function header L10-22); the notification it also sent is dead code with no client caller.
- ⚠️ **Ambiguity flag for the implementor:** the function ALSO contains a `notify-dispatch` referral-credited push block (L162-208). The investigation and the repo grep found no CALLER of `process-referral`, meaning that push never fires today either. Deleting the whole function is therefore behavior-neutral. IF the implementor's own grep finds ANY caller (client `functions.invoke('process-referral')`, cron, or webhook), STOP and request a SPEC amendment — do not delete a live function. (Expected: none — proceed with deletion.)
- The orchestrator should also remove the DEPLOYED function post-merge (`supabase functions delete process-referral`), or leave it orphaned (authenticated, uncalled, harmless). Note in the implementation report; do not run the delete from this phase.

**Callers = DO-NOT-TOUCH:** `supabase/functions/_shared/stripeWebhookRouter.ts` (imports at L48-50; call sites L403-411, L624-634, L1293+) and `supabase/functions/_shared/stripeDisputeHandlers.ts` (L287-292 per F-12) call `postAppsFlyerS2SEvent` / `claimBrandMilestone` / `resolveBrandOwnerUserId`. The D-i/D-ii/D-iv changes are INTERNAL to those functions' bodies and transparent to callers — do NOT change any call site.

### 4.E — SKAdNetwork (iOS, both apps) — DEFERRABLE (G-3)

**Files:** `app-mobile/app.json` (`ios.infoPlist`) + `mingla-business/app.json` (`ios.infoPlist`).
- Neither app declares `SKAdNetworkItems` (grep returns 0 hits both apps), and the `react-native-appsflyer` Expo plugin injects only AppDelegate deep-link hooks, NOT SKAN (F-9). So StoreKit has no SKAdNetwork allow-list and ATT-denied paid installs won't attribute via SKAN.
- ADD an `SKAdNetworkItems` array under each app's `ios.infoPlist` (a JSON array of `{ "SKAdNetworkIdentifier": "<id>.skadnetwork" }`). At minimum include AppsFlyer's own identifier `v9wttpbfk9.skadnetwork`. Seth must paste AppsFlyer's CURRENT published SKAdNetworkItems list (their maintained ad-network ID set) before the first paid iOS campaign — that list is a REMAINS-FOR-SETH data item (§10), not something to hard-code stale here.
- **Priority: LOW / DEFERRABLE within Phase 1.** SKAN postbacks only matter once paid iOS UA runs (no ad spend yet). Implement the scaffold + AppsFlyer's own ID now so the plumbing exists; the exhaustive list can land in a follow-up before the first campaign. If time-boxed, the implementor MAY defer E entirely and register it as a tracked follow-up — A/B/C/D are the launch-material items.
- REVIEW dependency-walk: infoPlist change → both apps need a fresh native build.

---

## 5. Success criteria (numbered, observable, per-surface where parity is manual)

- **SC-A-iOS:** On a fresh consumer iOS install, opening the app while signed OUT presents the ATT system dialog as the FIRST system dialog, before any onboarding/location/push prompt, and before PostHog transmits. After the ATT decision, `startAppsFlyer()` has run (SDK transmission active) with NO sign-in required.
- **SC-A-Android:** On a fresh consumer Android install, opening the app while signed OUT runs `startAppsFlyer()` at first-open (no dialog; the ATT gate is open immediately on non-iOS), with NO sign-in required.
- **SC-A-both:** After the user later signs in, `setAppsFlyerUserId(user.id)` binds the Supabase UUID to the already-started/attributed device (the identity effect at L391-413 fires unchanged).
- **SC-A-invariant:** No AppsFlyer `startSdk` call and no PostHog client construction occurs before `whenAttResolved()` resolves (ATT-before-any-tracking preserved).
- **SC-B:** On consumer logout (and account-switch, and JWT-expiry — all routes through `performPrivateAuthCleanup`), `clearAppsFlyerUserId()` and `resetAppsFlyerDeviceCache()` are both called; the SDK's `customer_user_id` is emptied and the in-memory device-dedup Set is cleared, so a subsequent different sign-in registers fresh.
- **SC-C-build-consumer:** A consumer EAS build on a release-bound profile (`production`/`production-apk`/`preview`/`preview-sim`) with `EXPO_PUBLIC_APPSFLYER_DEV_KEY` UNSET FAILS the build with the ORCH-1313 guard message; the SAME build with the env SET succeeds and the built bundle contains the key (inlining live-fire, §10). A local/dev build (no `EAS_BUILD_PROFILE`) succeeds using the literal fallback.
- **SC-C-build-business:** A business EAS build on a release-bound profile with the AppsFlyer env UNSET FAILS the build (no more silent-dark); with it SET, succeeds and the AppsFlyer plugin is included.
- **SC-C-parity:** The consumer literal `W29Z6c…` digest equals the account `APPSFLYER_DEV_KEY` secret digest (verified §10); if not, ELEVATE.
- **SC-D-auth:** The business S2S POST sends the `authentication` header equal to `APPSFLYER_S2S_TOKEN`; when `APPSFLYER_S2S_TOKEN` is unset, `postAppsFlyerS2SEvent` returns `false` and logs a clear reason (never sends the dev key).
- **SC-D-iosid:** For an iOS business device, the api3 URL path is `https://api3.appsflyer.com/inappevent/id<appleId>` (single `id` prefix, idempotent for a secret that already includes it); for Android it is the bare package name.
- **SC-D-os:** Every S2S POST body includes `os` equal to the device platform.
- **SC-D-delete:** `supabase/functions/process-referral/` no longer exists; no code references `process-referral`; the three S2S call sites in `stripeWebhookRouter.ts`/`stripeDisputeHandlers.ts` are unchanged and still compile.
- **SC-E (if implemented):** Both apps' `ios.infoPlist` contain a non-empty `SKAdNetworkItems` array including `v9wttpbfk9.skadnetwork`.

---

## 6. Invariants

### Preserved (must not break)
- **Constitution #6** (logout clears all third-party identity caches) — Item B extends it to AppsFlyer on consumer; business already honors it (F-5).
- **Constitution #3** (never fail silently) — Item C/D guards log a clear reason on every no-op/fail-closed path.
- **ATT-before-any-tracking ordering** (ORCH-1228/1257/1258/1260) — Item A must preserve it; the `ensureAttRequested`/`whenAttResolved` single-flight gate is unchanged.
- **AppsFlyer app-discriminator** (`appsflyer_devices.app`, ORCH-0808) — Item D keeps the `.eq("app","business")` filter; the un-discriminated read is deleted with `process-referral`.

### NEW — staged DRAFT (I-PROPOSED-*, flip ACTIVE at CLOSE — orchestrator owns the flip; DO NOT flip here)

**`I-PROPOSED-1313-CONSUMER-ATT-NOT-AUTH-GATED` (DRAFT)**
- **Rule:** the consumer ATT/`startAppsFlyer()` trigger in `app-mobile/app/index.tsx` fires for anonymous (pre-sign-in) sessions; the ATT effect MUST NOT early-return on `!isAuthenticated || !user?.id`, and its dependency array MUST NOT reintroduce an auth gate. Every install must be capturable without sign-in.
- **Enforcement:** strict-grep gate asserting the ATT effect block contains no `isAuthenticated`/`user?.id` early-return, plus a comment anchor `// ORCH-1313: ATT fires at first-open (anonymous) — do NOT auth-gate`.
- **Fails-on-revert:** re-adding the auth gate → gate exits 1.

**`I-PROPOSED-1313-ATT-BEFORE-ANY-TRACKING-TRANSMISSION` (DRAFT)**
- **Rule:** no tracking SDK transmits before the ATT gate resolves — `startAppsFlyer()` is only ever called inside the `ensureAttRequested()` `.then`/`.catch` or `requestPostTourPermissions()`; `postHogService.initialize()` `await`s `whenAttResolved()` before constructing the PostHog client. Moving the trigger to first-open must not add an ungated transmit.
- **Enforcement:** strict-grep asserting (a) every `startAppsFlyer()` call site is inside the ATT-gate continuation, and (b) `postHogService.ts` retains the `await whenAttResolved()` before `new PostHogClass(...)`.
- **Fails-on-revert:** adding a `startAppsFlyer()`/PostHog-construct outside the gate → gate exits 1.

**`I-PROPOSED-1313-LOGOUT-CLEARS-APPSFLYER-IDENTITY` (DRAFT)**
- **Rule:** the consumer `performPrivateAuthCleanup` integrations block calls BOTH `clearAppsFlyerUserId()` and `resetAppsFlyerDeviceCache()`, alongside the OneSignal/RevenueCat/Mixpanel resets.
- **Enforcement:** strict-grep asserting `authCleanup.ts` imports and calls both AppsFlyer-clear functions inside `if (includeIntegrations)`.
- **Fails-on-revert:** removing either call → gate exits 1.

**`I-PROPOSED-1313-S2S-API3-AUTH-TOKEN-NOT-DEVKEY` (DRAFT)**
- **Rule:** the api3 `authentication` header in `_shared/appsFlyerS2S.ts` carries `APPSFLYER_S2S_TOKEN`; the legacy `APPSFLYER_BUSINESS_DEV_KEY` is never used as the S2S auth credential.
- **Enforcement:** strict-grep asserting the header value reads `Deno.env.get("APPSFLYER_S2S_TOKEN")` and that no `APPSFLYER_BUSINESS_DEV_KEY` read feeds the `authentication` header.
- **Fails-on-revert:** reverting the header to the dev key → gate exits 1.

**`I-PROPOSED-1313-S2S-API3-IOS-ID-PREFIXED` (DRAFT)**
- **Rule:** the S2S iOS app id in the api3 URL is always `id`-prefixed (idempotent normalizer); Android is the bare package name.
- **Enforcement:** unit test on `ensureIdPrefix` (idempotent: `id6768737367` and `6768737367` both → `id6768737367`) + strict-grep asserting the iOS branch applies the normalizer.
- **Fails-on-revert:** removing the normalizer → the unit test fails.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-A1 (happy) | Fresh iOS install, signed out, opened | app open, no auth | ATT dialog shows first; after decision `startAppsFlyer()` ran; PostHog inits | consumer iOS runtime |
| T-A2 (happy) | Fresh Android install, signed out, opened | app open, no auth | `startAppsFlyer()` fires at first-open (no dialog) | consumer Android runtime |
| T-A3 (edge) | Anonymous session, then sign in | open → sign in | `setAppsFlyerUserId` binds after start; no double ATT prompt; no double start | consumer runtime |
| T-A4 (adversarial/ordering) | iOS, instrument transmit order | app open | NO AppsFlyer `startSdk` and NO PostHog client construction observed before `whenAttResolved()` resolves | consumer iOS runtime |
| T-A5 (error) | ATT request throws | force `ensureAttRequested` reject | `startAppsFlyer()` still runs (catch branch); gate still opens | consumer runtime |
| T-B1 (happy) | Logout | signed-in user taps logout | both AF-clear fns called; SDK `customer_user_id` emptied | consumer service/unit |
| T-B2 (edge) | Account switch (A→B) | cleanup with new `currentUserId` | device cache reset so B re-registers | consumer service/unit |
| T-B3 (idempotent) | Logout when AF not initialized | `_initialized === false` | both fns no-op, no throw | consumer unit |
| T-C1 (happy) | Release build, env set | `EAS_BUILD_PROFILE=production`, env present | build succeeds; bundle contains key | build/CI |
| T-C2 (adversarial) | Release build, env unset | `EAS_BUILD_PROFILE=production`, env absent | build THROWS ORCH-1313 guard (both consumer AND business) | build/CI |
| T-C3 (edge) | Local build, env unset | `EAS_BUILD_PROFILE` undefined | build succeeds via literal fallback | build/CI |
| T-D1 (happy) | Business S2S with token set | `APPSFLYER_S2S_TOKEN` set, iOS device | POST to `…/inappevent/id<id>`, `authentication: <token>`, body has `os:"ios"`; returns true on 2xx | edge unit (mock fetch) |
| T-D2 (adversarial) | Token unset | `APPSFLYER_S2S_TOKEN` absent | returns false, logs reason, NEVER sends dev key | edge unit |
| T-D3 (edge) | iOS id already prefixed | secret = `id6768737367` | URL has single `id` prefix (no `idid…`) | edge unit |
| T-D4 (happy) | Android device | Android business device | URL = bare package; `os:"android"` | edge unit |
| T-D5 (regression) | `process-referral` removed | repo grep | directory gone; no reference; router still compiles | static/CI |
| T-E1 (if built) | infoPlist SKAN present | expo config export | both apps' infoPlist have non-empty `SKAdNetworkItems` incl. `v9wttpbfk9.skadnetwork` | build/config |

**Runtime-proof requirement (tester):** T-A1..A5 and T-B1 are reproducer-bound (ATT dialog + transmit ordering) — the tester must run them on the iOS simulator/device and instrument transmit ordering (source-only reasoning is capped at "suspected" per the forensics live-fire rule). T-D1..D4 are unit-testable against a mocked `fetch`. T-C2 is provable by simulating the env in a local `expo config` run.

---

## 8. Implementation order

1. **D (backend)** — `_shared/appsFlyerS2S.ts` auth token + iOS `id`-prefix + `os` field; delete `process-referral/`. (Isolated; no client build.) Add edge unit tests (T-D1..D5).
2. **B (consumer service + cleanup)** — add `clearAppsFlyerUserId` + `resetAppsFlyerDeviceCache`; wire into `authCleanup.ts`. Add unit tests (T-B1..B3).
3. **A (consumer ATT effect)** — drop the auth gate in `app/index.tsx` L927-952; convert to mount-once. Simulator repro (T-A1..A5).
4. **C (config)** — `app-mobile/app.config.ts` extra + guard; `appsFlyerService.ts` env reads; `mingla-business/app.config.ts` symmetric guard. `expo config` local proof (T-C1..C3).
5. **E (SKAN, optional/deferrable)** — both apps' `app.json` infoPlist `SKAdNetworkItems`.
6. Run all gates; prove each new strict-grep/unit test fails-on-revert.

---

## 9. Regression prevention (fails-on-revert contract)

Each item ships with a structural safeguard that FAILS when the fix is reverted and PASSES when restored, plus a protective comment naming ORCH-1313 and the "why":
- **A:** strict-grep gate for `I-PROPOSED-1313-CONSUMER-ATT-NOT-AUTH-GATED` (no auth early-return in the ATT effect) + the ordering gate for `…ATT-BEFORE-ANY-TRACKING…`. Protective comment at the effect.
- **B:** strict-grep gate for `…LOGOUT-CLEARS-APPSFLYER-IDENTITY` (both clear fns called in the integrations block).
- **C:** a CI/config test that runs `expo config` (or the guard IIFE) with `EAS_BUILD_PROFILE=production` and the env unset and asserts it THROWS (both apps) — this is the fails-on-revert for the build-time guard.
- **D:** edge unit tests asserting the `authentication` header == token (not dev key), the iOS `id`-prefix (idempotent), and the `os` field; plus a static grep test asserting no `process-referral` reference remains.
- **Tester adversarial angle (distinct from the implementor's fails-on-revert):** the tester must, independently, (1) instrument the iOS transmit sequence to PROVE no tracking fires before ATT resolves under the new anonymous-first flow (T-A4 — the ordering is the thing most likely to silently regress); (2) attempt an account-switch A→B and confirm B does not inherit A's `customer_user_id` (T-B2); (3) simulate a release build with the env removed and confirm BOTH apps fail loud (T-C2); (4) mock the api3 endpoint and assert a bare (un-prefixed) iOS id or a dev-key `authentication` header never leaves the function.

---

## 10. Open questions + REMAINS FOR SETH (live-fire / dashboard)

### Open questions (decisions)
- **OQ-1 (D auth credential):** the dispatch is BINDING that api3 needs a separate V2 S2S token (`APPSFLYER_S2S_TOKEN`), not the dev key. AppsFlyer's docs confirm api3 needs the "S2S key" and that api2 (dev-key auth) is deprecated. HOWEVER, for a FIRST-PARTY owner sending its own app's events, it is not 100% certain from public docs alone whether api3 will accept the app dev key vs strictly the S2S token — this is only fully resolvable by a live test event. The code is written credential-agnostic (reads `APPSFLYER_S2S_TOKEN`), so if live-fire proves the dev key works, the orchestrator can point that ONE secret at whichever value AppsFlyer accepts, with no code change. **Recommendation:** provision `APPSFLYER_S2S_TOKEN` with the real S2S token; confirm by a single test event before relying on business revenue attribution.
- **OQ-2 (C business guard):** §4.C File 3 flips business AppsFlyer from silently-optional to loudly-required on release-bound EAS profiles. Confirm Seth wants the build to FAIL if the business AF env is ever unset (recommended — it prevents a silent-dark relapse of G-2). If Seth prefers business AF to remain optional, drop File 3 and rely on the live-fire inlining check alone.
- **OQ-3 (E scope):** confirm whether to land the SKAN scaffold now or defer E entirely to a pre-paid-campaign follow-up (no ad spend today).

### REMAINS FOR SETH (only Seth/dashboard can do these — none is product code)
1. **Confirm EXPO_PUBLIC inlining on the business build (dispatch's flagged unknown):** after a business release build, verify the built JS bundle actually contains the AppsFlyer dev key (EXPO_PUBLIC secret-type vars must INLINE at build time — see `reference_expo_public_env_inlining_gotchas`). If it does NOT inline, business AppsFlyer is still dark despite the env being set. The §4.C build-time guard converts an ABSENT env into a loud failure, but only a bundle inspection proves a PRESENT env actually inlined.
2. **Obtain the api3 V2 S2S token** from AppsFlyer: account menu (email dropdown) → **Security Center** → **AppsFlyer API tokens** → **Manage your AppsFlyer API tokens** → **+ New token** → S2S type. ⚠️ CAVEAT (from AppsFlyer docs): "For most ad networks, S2S token generation is no longer self-serve… admins won't see the option." Seth may need to contact AppsFlyer support to get an S2S token issued. S2S tokens take up to ~30 min to activate (status Pending → Active). Provision it as the Supabase secret `APPSFLYER_S2S_TOKEN` (masked).
3. **Verify the consumer dev key matches the account (RISK-1 gate):** compare the digest of the consumer literal `W29Z6c…` against the `APPSFLYER_DEV_KEY` secret (which equals `APPSFLYER_BUSINESS_DEV_KEY`). Equal → consumer is on the right account. Different → consumer is pointed at the WRONG AppsFlyer account; STOP and elevate before shipping C.
4. **Provision the consumer EAS env** (orchestrator, per the dispatch) across release-bound profiles: `EXPO_PUBLIC_APPSFLYER_DEV_KEY` (= account dev key), `EXPO_PUBLIC_APPSFLYER_IOS_APP_ID=6760440898`, `EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID=com.mingla.app.v2`. Do this BEFORE the build that removes the source literals, or the §4.C guard will (correctly) fail the build.
5. **Confirm each app's store-connection in the AppsFlyer dashboard:** consumer iOS App Store ID `6760440898` + Play `com.mingla.app.v2`; business iOS App Store ID `6768737367` + Play `com.sethogieva.minglabusiness`; App Store Connect + Google Play integrations linked so installs are read.
6. **SKAdNetwork list (Item E):** obtain AppsFlyer's CURRENT published `SKAdNetworkItems` list and paste it into both apps' infoPlist before the first paid iOS campaign.
7. **End-to-end install attribution live-fire** (proves G-1): on a clean device, install consumer from the live store link, open WITHOUT signing in, and confirm the install now appears in the AppsFlyer dashboard (it would NOT have, pre-A).

---

## 11. Scoped allowlist / DO-NOT-TOUCH + downstream routing

### 11-A. Allowlist (the implementor may modify ONLY these)
- `app-mobile/app/index.tsx` — ATT effect (L927-952) only: drop the auth gate, mount-once. (A)
- `app-mobile/src/services/appsFlyerService.ts` — add `clearAppsFlyerUserId` + `resetAppsFlyerDeviceCache`; env-drive the 3 constants + `hasAppsFlyerEnv` guard. (B, C)
- `app-mobile/src/utils/authCleanup.ts` — wire the two AppsFlyer-clear calls into the integrations block. (B)
- `app-mobile/app.config.ts` — emit AppsFlyer `extra` + release-bound build guard. (C)
- `app-mobile/app.json` — `ios.infoPlist.SKAdNetworkItems`. (E)
- `mingla-business/app.config.ts` — symmetric release-bound build guard. (C)
- `mingla-business/app.json` — `ios.infoPlist.SKAdNetworkItems`. (E)
- `supabase/functions/_shared/appsFlyerS2S.ts` — auth token + iOS `id`-prefix + `os`. (D)
- DELETE `supabase/functions/process-referral/` (whole directory). (D)
- Test/gate files (append-only): new strict-grep gates + edge/unit tests for the DRAFT invariants.

### 11-B. DO-NOT-TOUCH (stop-and-amend before touching)
- `app-mobile/app/index.tsx` identity effect (L391-413) — correct as-is.
- `app-mobile/src/services/permissionOrchestrator.ts` — the ATT gate is already anonymous-safe.
- `app-mobile/src/services/postHogService.ts` — the ATT `await` must remain, but no change is required; leave it.
- `mingla-business/src/services/appsFlyerService.ts`, `mingla-business/src/context/AuthContext.tsx`, `mingla-business/app/_layout.tsx` — business identity + ATT/start already correct (F-5/F-7/F-8); reference-only.
- `supabase/functions/_shared/stripeWebhookRouter.ts`, `supabase/functions/_shared/stripeDisputeHandlers.ts` — S2S callers; the D fix is internal and transparent.
- **OneLink / deep-linking anything** — PHASE 2, OUT OF SCOPE. Keep `onDeepLinkListener:false` + `onInstallConversionDataListener:false` in BOTH services. Do not add OneLink templates, deferred-deep-link handlers, or conversion-data callbacks in this ORCH.

### 11-C. OUT OF SCOPE — PHASE 2 (do NOT build here)
**OneLink + deferred deep-linking** is Phase 2: the smart one-link that routes to App Store vs Play by device and lands a deferred install on a specific offering/brand, plus the runtime install-conversion-data callback. It requires enabling the two listeners, an app-side deep-link router, and an AppsFlyer OneLink template (dashboard). None of that belongs in Phase 1. Anyone tempted to "wire the deep link while I'm here" must STOP.

### 11-D. Downstream routing
Next = **mingla-implementor** (build A-E per this contract, prove each gate fails-on-revert, write the implementation report). Then = **mingla-tester** (adversarial angles in §9 + §7 runtime proofs; iOS transmit-ordering is the highest-risk regression). Then = **mingla-orchestrator** CLOSE (flip the five `I-PROPOSED-1313-*` invariants ACTIVE; provision the EAS/Supabase secrets per §10; deploy the edge function; delete the orphaned `process-referral` deployment). Worktree: this ORCH is operating on the anchor (`~/Desktop/mingla-main`, `main`) — the orchestrator should spawn a per-ORCH worktree (`ORCH-1313-[appsflyer-attribution]`) for the implement phase per the worktree-per-ORCH rule before any code change.
