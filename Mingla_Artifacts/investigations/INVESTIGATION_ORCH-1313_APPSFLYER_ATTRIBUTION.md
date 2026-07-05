# INVESTIGATION — ORCH-1313 [appsflyer-attribution-verification-and-gaps]

**Phase:** INVESTIGATE (READ-ONLY forensics — no product-code change, no spec, no fix proposed)
**Date:** 2026-07-05
**Skill:** mingla-forensics / claude
**Repo:** `/Users/sethogieva/Desktop/mingla-main` (anchor, `main`, read-only)
**Classification:** quality-gap + data-integrity · Severity **S1-high** (attribution blindness at launch degrades a critical growth flow)
**Affected surfaces:** iOS-consumer, Android-consumer, business-iOS, business-Android, backend-S2S
**NOT in scope:** buyer-web (AppsFlyer is native-only; web export stubbed), admin-web (no AppsFlyer), business-web-preview (stubbed no-op)
**Secret hygiene:** the consumer dev key is masked as `W29Z6c…` throughout; no secret values are printed.

---

## Executive summary (plain English)

The **consumer app's** AppsFlyer client is real and wired (key + app IDs hardcoded, plugin always compiled), but it only starts transmitting **after the user signs in** — so downloads that never sign up are invisible to attribution, and the whole pipeline has **never been proven to land in the AppsFlyer dashboard**. The **business app's** AppsFlyer is almost certainly **dark**: no AppsFlyer keys exist anywhere in the repo (`.env`, `eas.json`, `app.config.ts`), and the build config actively strips the AppsFlyer native module out when those keys are absent — so unless Seth set them in the EAS dashboard, business installs, sessions, and revenue events are not being attributed at all. Two server-to-server (S2S) paths exist: the **consumer referral** path is **dead code with no caller** and points at AppsFlyer's **deprecated** endpoint, while the **business revenue** path is correctly wired to the current endpoint but likely uses the wrong auth key and a malformed iOS app id — both latent until the business client is switched on. Nothing here can be graded above "SUSPECTED" without live-fire, because the repo cannot see the AppsFlyer dashboard, the EAS environment, or Supabase secrets.

---

## Investigation manifest (every file read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `app-mobile/src/services/appsFlyerService.ts` | consumer SDK service — init/start/identity/S2S-device/event |
| 2 | `app-mobile/app/index.tsx` (370-413, 915-953, 2082-2085) | consumer init + auth-gated start + identity + event fire |
| 3 | `app-mobile/src/services/permissionOrchestrator.ts` (120-176) | consumer ATT→startAppsFlyer sequencing |
| 4 | `app-mobile/src/components/AppStateManager.tsx` (749-799) | consumer signOut path |
| 5 | `app-mobile/src/utils/authCleanup.ts` | consumer logout SDK-clear inventory (Constitution #6) |
| 6 | `app-mobile/app.json` (15-60, 169-173) | consumer iOS infoPlist / ATT / SKAdNetwork / plugin |
| 7 | `mingla-business/src/services/appsFlyerService.ts` | business SDK service — env-driven, clear + reset present |
| 8 | `mingla-business/src/services/appsFlyerService.web.ts` | business web stub (all no-ops) |
| 9 | `mingla-business/app/_layout.tsx` (455-534) | business init + ATT prompt (correcting an established "fact") |
| 10 | `mingla-business/src/context/AuthContext.tsx` (425-780, 1155-1156) | business identity lifecycle (set/register/clear/reset) |
| 11 | `mingla-business/app.config.ts` | AppsFlyer plugin env-gate + `extra` plumbing |
| 12 | `mingla-business/eas.json` | per-profile env blocks (env provisioning) |
| 13 | `mingla-business/.env` | local build env (env provisioning) |
| 14 | `mingla-business/app.json` (12-146) | business iOS bundle id / ATT string / SKAdNetwork |
| 15 | `supabase/functions/_shared/appsFlyerS2S.ts` | business S2S poster (api3) + milestone claim |
| 16 | `supabase/functions/process-referral/index.ts` | consumer S2S referral (api2) + caller check |
| 17 | `supabase/functions/_shared/stripeWebhookRouter.ts` (403-411, 624-634, 1293-1304) | business S2S live invocation sites |
| 18 | `supabase/functions/_shared/stripeDisputeHandlers.ts` (287-292) | business S2S dispute invocation |
| 19 | `supabase/migrations/20260601000000_orch_0808_appsflyer_devices_app_discriminator.sql` | schema: app discriminator + milestones |
| 20 | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` (7392-7404, 15390-15405) | `appsflyer_devices` table + RLS (latest defn confirmed) |
| 21 | `react-native-appsflyer/expo/withAppsFlyer{Ios,Android}.js` (both apps' node_modules) | whether the AF plugin injects SKAdNetworkItems |
| 22 | AppsFlyer public docs (dev.appsflyer.com, support.appsflyer.com, adapty.io) | S2S API shape verification (external-docs-verified rule) |

**Comms ledger:** read on entry. No OPEN `BLOCK`/`WARN` entry is addressed to forensics, ORCH-1313, or `ALL` requiring action (COMMS-0052 business-OTA-freeze is RESOLVED/superseded by builds 15-19; COMMS-0006 is ACKNOWLEDGED and scoped to ORCH-0980). No AppsFlyer/attribution entry exists in the ledger. No new cross-ORCH discovery warranted a ledger write.

---

## Q-scorecard

- **Q1 — Consumer init→start→transmit: does start fire on both ATT branches, and can it race ATT?** Verdict: **CONFIRMED** — fires on ATT-allowed, ATT-denied, and ATT-error; never before ATT resolves (no race). BUT start is **auth-gated** (a separate, load-bearing finding).
- **Q2 — Business auto-start: does it transmit at cold start, and what IDFA state on iOS?** Verdict: **CONFIRMED** design — no `manualStart` → `initSdk` auto-starts at cold boot (not auth-gated), after a real ATT prompt resolves the IDFA. `startSdk` is not needed on business. Actual transmission is gated on the client being provisioned (Q3).
- **Q3 — Is business actually ON?** Verdict: **SUSPECTED OFF (dark)** — no AppsFlyer env anywhere in the repo; the plugin is stripped when env is absent. Confirming requires `eas env:list`.
- **Q4 — iOS ATT parity + SKAdNetwork declarations.** Verdict: consumer prompts ATT; **business ALSO prompts ATT** (corrects the dispatch's "never prompts"). **Neither app declares SKAdNetworkItems** — CONFIRMED gap.
- **Q5 — Store/dashboard linkage.** Verdict: **REQUIRES LIVE-FIRE** — repo cannot see the dashboard; checklist produced below. Repo-side app IDs enumerated for the match.
- **Q6 — Deep-linking / OneLink.** Verdict: **CONFIRMED** — both listeners off → deferred deep-linking, runtime conversion-data, and OneLink smart-routing are disabled; install/session attribution dashboards are unaffected.
- **Q7 — S2S correctness.** Verdict: consumer S2S is **CONFIRMED dead** (no caller) + deprecated endpoint; business S2S is **CONFIRMED wired** to the current endpoint but has a **SUSPECTED** auth-key and iOS-app-id defect.
- **Q8 — Event-map PII.** Verdict: **CONFIRMED clean** — IDs / enums / prices only; no PII in either app.
- **Q9 — Verdict caps.** Applied throughout; every unprovable claim tagged REQUIRES LIVE-FIRE.

---

## TRUTH TABLE — every finding with file:line + verdict

Verdicts: **CONFIRMED** (source/config-proven) · **SUSPECTED** (source-only reasoning, ceiling per Prime Directive 7 / dispatch) · **REQUIRES LIVE-FIRE** (needs dashboard / EAS env / secret / real device).

| ID | Finding | Evidence (file:line) | Verdict |
|----|---------|----------------------|---------|
| **F-1** | Consumer AF client is **provisioned & always compiled** — dev key `W29Z6c…` + iOS app id `6760440898` + Android `com.mingla.app.v2` hardcoded; `react-native-appsflyer` plugin is in static `app.json` (no env gate). | `app-mobile/src/services/appsFlyerService.ts:9-11`; `app-mobile/app.json:169` | CONFIRMED |
| **F-2** | Consumer `startAppsFlyer()` fires on **ATT-allowed** (`.then`), **ATT-denied** (same `.then`; ATT resolves either way), and **ATT-error** (`.catch`); it is only ever called inside `ensureAttRequested()`'s then/catch or after `await ensureAttRequested()` → **cannot fire before ATT resolves. No race.** | `app-mobile/app/index.tsx:942-951`; `permissionOrchestrator.ts:161-166` | CONFIRMED |
| **F-3** | Consumer `startAppsFlyer()` is **AUTH-GATED**: the start effect early-returns `if (!isAuthenticated || !user?.id)`. Both start paths (home effect + post-onboarding `requestPostTourPermissions`) run only post-auth. **⇒ the install/session postback NEVER transmits for an unauthenticated session** — a download that never signs up is invisible to AppsFlyer. | `app-mobile/app/index.tsx:931` (`if (!isAuthenticated || !user?.id) return`); start at `:945`/`:950`; onboarding caller `:2085` | CONFIRMED (source); install-undercount impact SUSPECTED |
| **F-4** | Consumer has **NO logout AppsFlyer clear** (Constitution #6 gap). `performPrivateAuthCleanup` clears OneSignal, RevenueCat, Mixpanel — but **not** AppsFlyer; the consumer service exports **no** `clearAppsFlyerUserId`/`resetAppsFlyerDeviceCache`. Repo-wide grep for any AF-clear in `app-mobile/` returns only the service's own `setCustomerUserId`. The prior user's `customer_user_id` persists until the next sign-in overwrites it. | `app-mobile/src/utils/authCleanup.ts:51-70` (no AF); `app-mobile/src/services/appsFlyerService.ts` (no clear fn) | CONFIRMED |
| **F-5** | Business identity lifecycle is **fully & correctly wired**: set+register on warm-restore (`:496-497`) and on `SIGNED_IN` (`:682-683`), first-event fire once per session (`:689-721`), and **clear + reset on `SIGNED_OUT` (`:769-770`)**, on invalid-session boot-probe (`:443-444`), and on explicit `signOut()` (`:1155-1156`). | `mingla-business/src/context/AuthContext.tsx` (lines cited) | CONFIRMED (correct) |
| **F-6** | **Business AF env is NOT provisioned in the repo.** `.env` holds only GIPHY keys; all 6 `eas.json` profiles list only ONESIGNAL + POSTHOG_HOST + SENTRY; `app.config.ts` **filters `react-native-appsflyer` OUT of the native build** when the 3 `EXPO_PUBLIC_APPSFLYER_*` are absent, and the service `hasAppsFlyerEnv` no-ops. ⇒ business AF native module not compiled and service inert **unless** the vars live in the EAS dashboard env. | `mingla-business/.env:1-4`; `mingla-business/eas.json:17-79`; `mingla-business/app.config.ts:13-31` (`if (name === "react-native-appsflyer") return hasAppsFlyerEnv()`); `mingla-business/src/services/appsFlyerService.ts:59-63,110-116` | **SUSPECTED OFF (dark)**; confirm via `eas env:list` → **REQUIRES LIVE-FIRE** |
| **F-7** | **Business DOES prompt ATT** — corrects the established "ATT deferred, NEVER prompts" fact. `_layout.tsx` fires `requestTrackingPermissionsAsync()` (expo-tracking-transparency) at deferred init **before** `initializeAppsFlyer()`. `timeToWaitForATTUserAuthorization: 0` only means the SDK itself does not block on ATT (the app already awaited it). Plugin wired by META-ORCH-1187/ORCH-1246. | `mingla-business/app/_layout.tsx:470-502`; `app.config.ts:88-94`; service `:127` | CONFIRMED (corrects a stated fact) |
| **F-8** | `startSdk` correctly **not** needed on business (v6.17.9, no `manualStart` → `initSdk` auto-starts); consumer (v6.17.8, `manualStart:true`) **must** call it and does. Business init runs at cold start (not auth-gated) → would transmit install at first launch **if provisioned** (better than consumer for install attribution). | business `appsFlyerService.ts:118-140` (no `manualStart`, no `startSdk`); `_layout.tsx:459,534` (`[]` once, not auth-gated); consumer `startSdk()` `:71` | CONFIRMED |
| **F-9** | **Neither app declares SKAdNetworkItems.** No `SKAdNetwork*` in `app.json`, `app.config.ts`, or any `ios/`. The AF iOS Expo plugin injects only AppDelegate deep-link hooks (`continueUserActivity`/`handleOpenUrl`), **not** SKAdNetworkItems. ⇒ on iOS, ATT-denied / IDFA-less installs from paid ad networks are not attributable via SKAdNetwork (StoreKit needs the Info.plist SKAdNetwork allow-list). | grep `SKAdNetwork` → 0 hits both apps; `react-native-appsflyer/expo/withAppsFlyerIos.js:32-87` (deep-link only) | CONFIRMED gap; paid-UA impact SUSPECTED (no paid iOS campaigns yet) |
| **F-10** | Both apps set `onDeepLinkListener:false` + `onInstallConversionDataListener:false` ⇒ **disabled:** deferred deep-linking (install→land on a specific offering/brand), runtime install-conversion-data callback, OneLink smart routing (one link → App Store or Play by device). **NOT disabled:** install/session/in-app-event attribution reporting to the dashboard. | consumer `appsFlyerService.ts:41-42`; business `appsFlyerService.ts:124-125` | CONFIRMED |
| **F-11** | **Consumer S2S (`process-referral`) is DEAD** — repo-wide grep finds **no client or backend caller** (referral crediting is a DB trigger; this fn is "notification-only" + S2S). Even if revived it is broken 3 ways: **deprecated `api2` endpoint**, **bare iOS app id** (`6760440898`, missing the required `id` prefix → AF returns 200 but drops the event), and **no `app` discriminator filter** on the `appsflyer_devices` query (would fan a consumer event out to business device rows too). | `supabase/functions/process-referral/index.ts:115-160` (endpoint `:127`, no `.eq("app",...)` `:118-121`); grep for callers → empty | CONFIRMED dead; revival-defects SUSPECTED |
| **F-12** | **Business S2S (`_shared/appsFlyerS2S.ts`) is LIVE-wired** to the **current `api3`** endpoint, filtered on `app='business'`, idempotent via `claimBrandMilestone`. Invoked from `stripeWebhookRouter` at 3 milestone sites (first_ticket_sold / first_payout / first_activated) + the dispute handler. | `appsFlyerS2S.ts:27,55,131-196`; `stripeWebhookRouter.ts:403-411,624-634,1293-1304`; `stripeDisputeHandlers.ts:287-292` | CONFIRMED wired |
| **F-13** | **Business S2S auth-key risk.** `api3` requires the **V2 S2S token** (AppsFlyer Security Center), NOT the legacy dev key. The code passes env `APPSFLYER_BUSINESS_DEV_KEY` — a "DEV_KEY"-named secret — in the `authentication` header. If that secret holds the legacy dev key rather than the api3 S2S token, **every business S2S call auth-fails silently** (non-2xx swallowed, returns false). | `appsFlyerS2S.ts:134,170-178`; AppsFlyer docs (api3 uses S2S token) | SUSPECTED → **REQUIRES LIVE-FIRE** (cannot read the secret) |
| **F-14** | **Business S2S iOS app id missing `id` prefix.** `APPSFLYER_BUSINESS_IOS_APP_ID` is documented "bare 10-digit Apple ID"; URL becomes `inappevent/6768737367` (no `id`). AppsFlyer docs: without the `id` prefix the endpoint returns **200 OK but does not record the event**. Currently moot — no `app='business'` device rows exist while the client is dark, so `postAppsFlyerS2SEvent` early-returns `false`. | `appsFlyerS2S.ts:14-16,154-155`; `eas.json:89` (ascAppId 6768737367); AppsFlyer docs (iOS `id` prefix) | SUSPECTED (strong) → REQUIRES LIVE-FIRE |
| **F-15** | Schema is secure. `appsflyer_devices` has RLS enabled + 4 `auth.uid() = user_id` policies (select/insert/update/delete own); `brand_appsflyer_milestones` is `service_role`-only. `app` discriminator + unique `(user_id, app, appsflyer_uid)` confirmed as the latest definition. | baseline squash `:15390-15405`; migration `20260601000000_*:17-83` | CONFIRMED secure |
| **F-16** | **Event map is PII-clean** in both apps — params carry content categories, content/brand/event/venue IDs, prices/ratings/method enums and a country code only. No email/name/phone. Consumer revenue events (`af_subscribe`) carry `af_revenue`/`af_currency` (correct AF reserved fields). | consumer `SwipeableCards.tsx:1844-1848,1922-1926`, `useRevenueCat.ts:152-158`; business `brandsService.ts:342,500`, `businessEvents.ts:883` | CONFIRMED clean |

---

## Five-Truth-Layer reconciliation (contradictions flagged)

| Layer | What it says | Contradiction / note |
|-------|--------------|----------------------|
| **Docs** | Dispatch established-fact: business "ATT deferred, NEVER prompts." Service header comment (business): "ATT deferred — mirrors consumer ORCH-0349. We never prompt at cold start." | **CONTRADICTED by code** (F-7): `_layout.tsx:470-502` DOES prompt ATT via expo-tracking-transparency before init. The service comment is stale; the truth is in `_layout.tsx` + `app.config.ts:88-94`. Code layer holds truth. |
| **Docs** | Service header (business): "TRANSITIONAL no-op guard when any env is missing… exit condition: operator sets EXPO_PUBLIC_APPSFLYER_* via EAS Secrets." | **Consistent with config** (F-6): the exit condition has **not** been met in the repo. Whether it was met in the EAS dashboard is unknowable from source → REQUIRES LIVE-FIRE. |
| **Schema** | `appsflyer_devices` app-discriminated + RLS-own; `brand_appsflyer_milestones` service-role. | No contradiction. Consumer `registerAppsFlyerDevice` writes `app:'consumer'`; business writes `app:'business'`. But the dead consumer S2S (F-11) reads devices **without** the discriminator — a schema-intent vs code-use gap (latent, path is dead). |
| **Code** | Consumer starts AF only post-auth (F-3). AppsFlyer's own guidance is to start as early as possible so every install attributes. | **Gap** between AppsFlyer best-practice (docs layer) and code — the auth gate is the structural undercount. Flagged, not fixed. |
| **Runtime** | Not observed — no device/dashboard access this phase. | All runtime claims are capped SUSPECTED / REQUIRES LIVE-FIRE per Prime Directive 7. |
| **Data** | `appsflyer_devices` / dashboard install rows not queried (read-only forensics; the meaningful proof is dashboard-side, unreachable). | The April-2026 audit's "working but NEVER dashboard-verified" still stands — this phase did not (could not) close it; it is the #1 live-fire item. |

---

## Blast radius / cross-surface map

| Surface | AppsFlyer present? | State (this investigation) |
|---------|--------------------|-----------------------------|
| Consumer iOS | Yes (SDK, hardcoded key) | Client ON; start auth-gated (F-3); no logout-clear (F-4); no SKAdNetworkItems (F-9); dashboard unverified |
| Consumer Android | Yes | Same as iOS minus ATT/SKAN (Android has no ATT); Play package `com.mingla.app.v2` |
| Business iOS | Env-gated SDK | SUSPECTED dark (F-6); if ON, ATT prompts (F-7), S2S auth/id defects latent (F-13/F-14) |
| Business Android | Env-gated SDK | SUSPECTED dark (F-6) |
| Backend S2S | Two paths | Consumer path DEAD (F-11); business path wired but latently misconfigured (F-12/13/14) |
| Buyer/anon web | **No** — native-only; `appsFlyerService.web.ts` all no-ops | OUT OF SCOPE (correct) |
| Admin web | **No** AppsFlyer | OUT OF SCOPE |
| Business web preview | Stubbed no-op (`.web.ts`) | OUT OF SCOPE |

**Invariant impact:** violates the Constitution #6 "logout clears everything (incl. third-party identity caches)" principle on the **consumer** side (F-4) — business honors it. No named `I-*` invariant in `INVARIANT_REGISTRY.md` currently pins AppsFlyer identity-clear; this investigation FLAGS the gap (it does not pre-decide a fix or propose an invariant — that is the SPEC's job).

---

## GAP LIST — ranked by launch-attribution impact

1. **[G-1] Whole pipeline never dashboard-verified + consumer install postback is auth-gated (F-3).** THE single biggest launch risk: even the one app that is provisioned (consumer) does not fire an install/session postback until sign-in, so real downloads that bounce before signup are unattributable — and no install has ever been proven to land in the dashboard. (CONFIRMED code + REQUIRES LIVE-FIRE dashboard.)
2. **[G-2] Business AppsFlyer is SUSPECTED dark (F-6).** If the EAS env vars are unset, all business installs/sessions/revenue-milestone attribution is silently absent — an entire app's growth loop unmeasured at launch. (REQUIRES LIVE-FIRE: `eas env:list`.)
3. **[G-3] No SKAdNetworkItems in either app (F-9).** ATT-denied iOS installs from paid ad networks won't attribute via SKAdNetwork. Impact is deferred until paid iOS UA runs, but it must be in place *before* the first iOS ad campaign. (CONFIRMED gap.)
4. **[G-4] Business S2S auth-key + iOS-id likely wrong (F-13/F-14).** Once the business client is switched on, revenue-milestone S2S events may still silently fail (wrong key on api3; iOS id lacks `id` prefix). (SUSPECTED → REQUIRES LIVE-FIRE.)
5. **[G-5] Consumer logout does not clear AppsFlyer identity (F-4).** Constitution #6 violation; shared-device / account-switch attribution can carry the prior user's `customer_user_id` in the logout→next-signin window. (CONFIRMED.)
6. **[G-6] Consumer referral S2S is dead + deprecated (F-11).** No consumer server-side event fires at all; if ever revived it targets AppsFlyer's sunset `api2` with a malformed iOS id and no app discriminator. (CONFIRMED dead.)

---

## SETH LIVE-FIRE + DASHBOARD CHECKLIST

Everything below is what the repo **cannot** see. Grouped by where Seth must look. None of this changes product code.

### A. AppsFlyer dashboard — config to verify (attribution cannot work until all are true)

1. **Consumer app registered** with App Store ID **`6760440898`** (iOS) and Play package **`com.mingla.app.v2`** (Android) — must exactly match `app-mobile/src/services/appsFlyerService.ts:9-11`.
2. **Business app registered** with App Store ID **`6768737367`** (iOS, from `eas.json:89`) and Play package **`com.sethogieva.minglabusiness`** (Android, from `mingla-business/app.json:47`). Confirm the business app exists in the AppsFlyer account **at all**.
3. **Store connection / App Store + Play integration** completed for each app (AppsFlyer must be linked to App Store Connect + Google Play so it can read store installs and validate the app IDs).
4. **Dev key** in the dashboard matches the consumer literal `W29Z6c…` (masked) and the business EAS env value.
5. **SKAdNetwork / conversion-value schema** configured for both iOS apps — and note G-3: the apps do **not** yet ship SKAdNetworkItems in Info.plist, so SKAN postbacks won't be delivered even if the dashboard is set. Flag for the SPEC/build phase.
6. **OneLink template** — only needed if/when deferred deep-linking is wanted (currently off, F-10). Not required for install/session dashboards.
7. **S2S postback keys:** locate the **api3 "V2 S2S token"** in Security Center for the **business** app (needed to validate G-4).

### B. EAS environment — confirm provisioning (repo shows NONE)

8. `eas env:list --profile production` (and `preview`) for the **business** project — confirm whether `EXPO_PUBLIC_APPSFLYER_DEV_KEY`, `EXPO_PUBLIC_APPSFLYER_IOS_APP_ID`, `EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID` exist. **If absent → business AppsFlyer is confirmed dark** (native module was stripped at build time, F-6). Cross-check the most recent business build actually bundled `react-native-appsflyer`.
9. `supabase secrets list` on `gqnoajqerqhnvulmnyvv` — confirm `APPSFLYER_BUSINESS_DEV_KEY` / `APPSFLYER_BUSINESS_IOS_APP_ID` / `APPSFLYER_BUSINESS_ANDROID_APP_ID` exist, and critically whether `APPSFLYER_BUSINESS_DEV_KEY` holds the **api3 V2 S2S token** (correct) or the **legacy dev key** (would silently fail, G-4). Also confirm the consumer `APPSFLYER_DEV_KEY` used by the dead `process-referral` (moot unless revived).

### C. Real-device install-from-store-link attribution test (proves G-1 end-to-end)

10. On a **clean** iPhone (AppsFlyer test device registered in the dashboard, or use the debug device / a fresh device with the store link), install the **consumer** app from the **live App Store link** (id 6760440898).
11. Launch, **accept ATT**, **sign in** (start is auth-gated — you MUST sign in for the postback to fire, F-3). Then check AppsFlyer dashboard → the install/session appears with the correct media source (`organic` for a direct store link) within minutes.
12. Repeat with **ATT denied** → confirm the install still appears (via device-match / SKAN once G-3 is fixed) and note the media source.
13. **Auth-gate proof:** install, open, but **do not sign in** → confirm the install does **not** appear in AppsFlyer (this is G-1's structural undercount, live-proven).
14. Repeat 10-12 for **Android** from the live Play link (package `com.mingla.app.v2`).
15. **Business:** only meaningful **after** step 8 confirms env is set — install business from its store link, sign in, complete a first ticket sale, and confirm both the client install AND the S2S `first_ticket_sold` land (this also live-tests G-4).

---

## Repro evidence

No runtime repro performed — this is a **backend/config/attribution-pipeline** investigation whose meaningful proof lives in the AppsFlyer dashboard, the EAS environment, and Supabase secrets, none of which the repo (or read-only forensics) can reach. Per Prime Directive 7, all runtime-dependent claims are capped **SUSPECTED** and routed to the Seth live-fire plan above. Source/config findings (F-1, F-2, F-4, F-5, F-6-config, F-7, F-8, F-9, F-10, F-11-dead, F-12, F-15, F-16) are **CONFIRMED** at the code/config layer; F-3 is CONFIRMED code with SUSPECTED impact; F-13/F-14 are SUSPECTED pending the secret.

## Discoveries for orchestrator (side issues, not in this ORCH's fix scope)

- **D-1:** The dead `process-referral` edge function still exists and still points at the deprecated `api2` endpoint (F-11). Candidate for deletion or, if consumer server-side attribution is wanted, a rewrite to api3 with the `app='consumer'` filter + `id`-prefixed iOS id. Registration recommended.
- **D-2:** The business service header comment ("we never prompt at cold start") is stale/misleading vs the actual ATT prompt in `_layout.tsx` (F-7) — a doc-drift cleanup.
- **D-3:** No `INVARIANT_REGISTRY.md` invariant pins AppsFlyer logout identity-clear; consumer drift (F-4) went unguarded. A future `I-*` (SPEC-owned) would prevent recurrence.

## Confidence

**Overall: probable → suspected split.** Config/code layer findings are high-confidence (CONFIRMED). The two launch-critical unknowns — is business AF on (F-6/G-2), and does the pipeline attribute in the dashboard (G-1) — are honestly **inconclusive from source** and are the core of the Seth live-fire plan. Business-off is graded **SUSPECTED (strong)** on the weight of: no env in `.env`/`eas.json`/`app.config`, the meticulous presence of every *other* SDK's env in the same files, and the "TRANSITIONAL no-op" service comment.

## Recommended next phase + scope (direction only — no fix, no spec)

Route to **SPEC** once Seth returns the live-fire/dashboard results (Section A-C). Likely SPEC scope, in impact order: (1) decide the consumer start-gate policy (auth-gate vs early-start, G-1); (2) provision/confirm business env or formally accept business-dark (G-2); (3) add SKAdNetworkItems to both apps' iOS config before paid iOS UA (G-3); (4) fix the business S2S auth key + iOS `id` prefix (G-4); (5) add the consumer logout AF-clear + a pinning invariant (G-5); (6) delete or rebuild the dead consumer referral S2S (G-6). **The SPEC must not begin until the dashboard/EAS/secret answers are in hand**, since three of the six gaps are REQUIRES-LIVE-FIRE and could resolve to "already fine."
