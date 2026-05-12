# Implementation Report — ORCH-0808 — AppsFlyer Integration for Mingla Business

**Status:** implemented and verified (TypeScript + strict-grep gates pass; native build + S2S smoke deferred to operator + tester)
**Author:** Claude `mingla-implementor` (parity mirror)
**Date:** 2026-05-12
**Spec:** [Mingla_Artifacts/specs/SPEC_ORCH-0808_APPSFLYER_MINGLA_BUSINESS.md](../specs/SPEC_ORCH-0808_APPSFLYER_MINGLA_BUSINESS.md)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

---

## 1. Layman Summary

We added AppsFlyer install attribution + event instrumentation into Mingla Business, mirroring the consumer-app integration. Six client events fire on key organiser actions (registration, login, brand creation, Stripe connect started, event published) and three server events fire from the Stripe webhook router (connect activated, first ticket sold, first payout received). The shared `appsflyer_devices` table now distinguishes consumer vs business installs via a new `app` discriminator column, and a new `brand_appsflyer_milestones` table makes the server-fired events idempotent. ATT remains deferred at startup. No visible UI changes.

---

## 2. Pre-Flight Summary

- **Mission**: implement the spec written by Claude `mingla-forensics` for ORCH-0808.
- **Battlefield read**: consumer service + init wiring, current `appsflyer_devices` schema, mingla-business `_layout.tsx`, `AuthContext.tsx`, `brandsService.ts`, `brandStripeService.ts`, `businessEvents.ts`, `stripeWebhookRouter.ts` (handlePayout, syncAccount, handleTicketCheckoutPaymentIntent), strict-grep workflow + script conventions, `creatorAccount.ts` for first-time signal.
- **Plan announced**: yes (3-line plan in chat before code).
- **Invariant pre-check**: Constitution #3 (no silent failures), #5 (server state server-side), #6 (logout clears everything), #14 (persisted-state startup) — all preserved by design.

---

## 3. Files Changed — Old → New Receipts

### `supabase/migrations/20260601000000_orch_0808_appsflyer_devices_app_discriminator.sql` (NEW)
**What it did before:** N/A — new file.
**What it does now:** Adds `app text NOT NULL DEFAULT 'consumer' CHECK (app IN ('consumer','business'))` to `appsflyer_devices`. Drops the old unique constraint `(user_id, appsflyer_uid)` and adds `(user_id, app, appsflyer_uid)`. Adds index `idx_appsflyer_devices_user_id_app`. Creates `brand_appsflyer_milestones` table (PK `brand_id` → `brands.id ON DELETE CASCADE`, columns `first_ticket_sold_at`, `first_payout_at`, `created_at`, `updated_at`) with RLS enabled and `service_role` ALL policy. Includes a `DO $$` self-verify probe that fails the migration if any row ends with an invalid `app` value.
**Why:** spec §3.1 + §3.2.
**Lines:** 97.
**Filename note:** chose `20260601000000` not the spec-stated `20260512000000` — repo already contains `20260531000000_orch_0807_brand_avatars_storage.sql` (in-flight ORCH-0807 work on Seth branch). Monotonic migration rule (cross-skill parity #10) requires strictly-greater prefix.

### `app-mobile/src/services/appsFlyerService.ts` (MODIFIED — 1 hunk)
**What it did before:** Upserted to `appsflyer_devices` with payload `{ user_id, appsflyer_uid, platform, app_id, updated_at }` and `onConflict: 'user_id,appsflyer_uid'`.
**What it does now:** Adds `app: 'consumer'` to the payload and uses `onConflict: 'user_id,app,appsflyer_uid'`.
**Why:** schema change in §3.1 drops the old unique constraint — the consumer service MUST land in the same commit or the upsert breaks the moment the migration applies.
**Lines:** +2 (payload field + comment), 1 modified (onConflict string).

### `mingla-business/src/services/appsFlyerService.ts` (NEW)
**What it did before:** N/A — new file.
**What it does now:** Mirror of consumer service with env-driven constants (`EXPO_PUBLIC_APPSFLYER_DEV_KEY|IOS_APP_ID|ANDROID_APP_ID`), `app: 'business'` in upsert, `onConflict: 'user_id,app,appsflyer_uid'`, ATT deferred via `timeToWaitForATTUserAuthorization: 0`. Adds a `clearAppsFlyerUserId()` helper (sets customer_user_id to '') and `resetAppsFlyerDeviceCache()` (clears the in-memory dedup Set) for Constitution #6 compliance on signOut. Init is no-op + single warn log when any of the three env vars is missing (TRANSITIONAL guard).
**Why:** spec §3.3.
**Lines:** 205.

### `mingla-business/app/_layout.tsx` (MODIFIED — 2 hunks)
**What it did before:** Did not import or initialize AppsFlyer.
**What it does now:** Imports `initializeAppsFlyer` from the new service and calls it once via `useEffect(() => initializeAppsFlyer(), [])` inside `RootLayoutInner`, placed before the AppState/focusManager wiring.
**Why:** spec §3.5 — init point.
**Lines:** +9.

### `mingla-business/src/context/AuthContext.tsx` (MODIFIED — 4 hunks)
**What it did before:** Did not touch AppsFlyer. No identity binding, no signOut clear.
**What it does now:**
1. Imports `setAppsFlyerUserId`, `clearAppsFlyerUserId`, `registerAppsFlyerDevice`, `resetAppsFlyerDeviceCache`, `logAppsFlyerEvent` from the new business service.
2. Adds `useRef` import and an `afEventFiredRef` flag at provider level.
3. **Bootstrap path (warm restore from persisted session)**: calls `setAppsFlyerUserId` + `registerAppsFlyerDevice` on `s.user.id` after the recovery check. Does NOT fire `af_login` on bootstrap to avoid inflating event counts on every cold start.
4. **`onAuthStateChange` SIGNED_IN branch**: calls `setAppsFlyerUserId` + `registerAppsFlyerDevice`, then fires either `af_complete_registration` (first-time creator — detected via `creator_accounts.created_at < 30s ago`) or `af_login` once per session via `afEventFiredRef`. Provider derived from `session.user.app_metadata.provider` (google/apple/email).
5. **`onAuthStateChange` SIGNED_OUT branch**: calls `clearAppsFlyerUserId()` + `resetAppsFlyerDeviceCache()` + resets `afEventFiredRef` so the next sign-in re-fires the first-event logic.
6. **Explicit `signOut()` callback**: same three clears, for symmetry with the existing `clearAllStores()` + `queryClient.clear()` defensive pair.
**Why:** spec §3.5 + Constitution #6 (logout clears everything) + spec success criteria #3, #4, #6, #15.
**Lines:** +73, 0 modified.

### `mingla-business/src/services/brandsService.ts` (MODIFIED — 2 hunks)
**What it did before:** `createBrand` returned the inserted brand. No instrumentation.
**What it does now:** After successful insert, fires `logAppsFlyerEvent('mingla_brand_created', { brand_id })`. Import added.
**Why:** spec §3.5 — organiser-funnel.
**Lines:** +6.

### `mingla-business/src/services/brandStripeService.ts` (MODIFIED — 2 hunks)
**What it did before:** `startBrandStripeOnboarding` invoked the edge function and returned the result.
**What it does now:** On success, fires `logAppsFlyerEvent('mingla_stripe_connect_started', { brand_id })`. Import added.
**Why:** spec §3.5 — organiser-funnel.
**Lines:** +9.

### `mingla-business/src/services/businessEvents.ts` (MODIFIED — 2 hunks)
**What it did before:** `publishBusinessEventDraft` called the RPC and returned the published event.
**What it does now:** After the success/slug guards, fires `logAppsFlyerEvent('mingla_event_published', { event_id, brand_id })`. Import added.
**Why:** spec §3.5 — organiser-funnel.
**Lines:** +9.

### `supabase/functions/_shared/appsFlyerS2S.ts` (NEW)
**What it did before:** N/A — new file.
**What it does now:** Self-contained AppsFlyer S2S poster for edge functions. Exports `postAppsFlyerS2SEvent(supabase, userId, eventName, eventValues?, eventTime?)`, `resolveBrandOwnerUserId(supabase, brandId)`, `claimBrandMilestone(supabase, brandId, column)`. Reads `APPSFLYER_BUSINESS_DEV_KEY|IOS_APP_ID|ANDROID_APP_ID` from `Deno.env`. Looks up the brand owner's `appsflyer_devices` row WHERE `app = 'business'` to retrieve the platform-correct `appsflyer_uid` + app ID. POSTs to `https://api3.appsflyer.com/inappevent/{APP_ID}` with the lowercase `authentication` header (per AF S2S spec) and the AF-formatted UTC eventTime. Hard contract: NEVER throws. All failures log + return false. Milestone helper does an atomic `UPDATE ... WHERE column IS NULL` so two concurrent webhooks racing for the same first event resolve with exactly one winner.
**Why:** spec §3.2.
**Lines:** 232.

### `supabase/functions/_shared/stripeWebhookRouter.ts` (MODIFIED — 4 hunks)
**What it did before:** Routed Stripe events with no AppsFlyer S2S firing.
**What it does now:**
1. Imports `postAppsFlyerS2SEvent`, `resolveBrandOwnerUserId`, `claimBrandMilestone` from the new helper.
2. In `syncAccount` (account.updated handler), after the audit write: if `prior.charges_enabled !== true` AND `account.charges_enabled === true`, resolves the brand owner and fires S2S `mingla_stripe_connect_activated`. The transition gate is naturally idempotent — subsequent identical webhooks with `charges_enabled` already true skip.
3. In `handleTicketCheckoutPaymentIntent` (payment_intent.succeeded branch), after the order finalize + ticket-confirmation-dispatch fire: claims `brand_appsflyer_milestones.first_ticket_sold_at` atomically. If claimed (i.e. this is the first ticket sale for this brand), resolves owner and fires S2S `af_purchase` with `af_revenue = paymentIntent.amount / 100` and `af_currency` from Stripe.
4. In `handlePayout`, after the audit write: only on `event.type === "payout.paid"`, claims `brand_appsflyer_milestones.first_payout_at`. If claimed, resolves owner and fires S2S `mingla_first_payout` with payout amount as `af_revenue`. Payout statuses created/failed/canceled do NOT trigger.
All three integrations are wrapped in try/catch — AppsFlyer failure NEVER propagates to Stripe's webhook caller.
**Why:** spec §3.2 + §3.5 + success criteria #11, #12.
**Lines:** +95.

### `mingla-business/package.json` (MODIFIED — 1 line)
**What it did before:** Did not depend on `react-native-appsflyer`.
**What it does now:** Adds `"react-native-appsflyer": "^6.17.8"` (resolved to 6.17.9 via npm install, matching the consumer-app major+minor).
**Why:** spec §3.8.
**Lines:** +1. `package-lock.json` regenerated.

### `mingla-business/app.json` (MODIFIED — 2 hunks)
**What it did before:** iOS `infoPlist` lacked `NSUserTrackingUsageDescription`. Plugins list did not include `react-native-appsflyer`.
**What it does now:** Adds the `NSUserTrackingUsageDescription` string (required by App Store Review whenever the AppsFlyer framework is linked, even if ATT is deferred). Adds `"react-native-appsflyer"` to the plugins array (single-string form mirroring consumer at `app-mobile/app.json:122`).
**Why:** spec §3.7 + §3.8.
**Lines:** +2.

### `.github/scripts/strict-grep/orch-0808-appsflyer-devices-app-discriminator.mjs` (NEW)
**What it did before:** N/A — new file.
**What it does now:** Babel-AST-based strict-grep gate. Walks `app-mobile/src/`, `mingla-business/src/`, `supabase/functions/` for any `.from('appsflyer_devices').insert|update|upsert(payload)` call. Verifies the payload `ObjectExpression` contains an `app:` key (Identifier or StringLiteral). Allowlist marker `// orch-strict-grep-allow appsflyer-devices-app-discriminator — <reason>` on the line above the call permits exceptions. Exits 1 on any unallowlisted miss; exits 2 on parse/read errors with no real violations.
**Why:** spec §8 regression prevention + I-PROPOSED-AF-DISCRIMINATOR.
**Lines:** 182. **Local run: PASS** (no violations after consumer + business + S2S code).

### `.github/workflows/strict-grep-mingla-business.yml` (MODIFIED — 2 hunks)
**What it did before:** Did not register the ORCH-0808 gate.
**What it does now:** Adds the gate to the registry comment block AND adds a new job `orch-0808-appsflyer-devices-app-discriminator` that installs `@babel/parser` + `@babel/traverse` and runs the script.
**Why:** spec §8 + `feedback_strict_grep_registry_pattern.md` (one script + one job per gate).
**Lines:** +14.

---

## 4. Spec Traceability — Success Criteria

| # | Criterion | Status |
|---|---|---|
| 1 | initializeAppsFlyer called once at cold start with valid env | implemented (init point in `_layout.tsx` + `_initialized` flag in service) |
| 2 | initializeAppsFlyer no-op + single warn when env missing | implemented (explicit guard + Constitution #3 log) |
| 3 | setCustomerUserId once per auth session | implemented (called from bootstrap + SIGNED_IN branch) |
| 4 | appsflyer_devices row with `app='business'` exists after sign-in | implemented (registerAppsFlyerDevice writes `app: 'business'`) |
| 5 | Existing consumer rows migrate to `app='consumer'` | implemented (migration default = 'consumer'; consumer service writes 'consumer' on upsert) |
| 6 | af_complete_registration once per first-time, af_login once per returning | implemented (first-time = `creator_accounts.created_at < 30s ago`; gated by `afEventFiredRef`) |
| 7 | mingla_brand_created fires on brand insert | implemented (brandsService.ts:createBrand) |
| 8 | mingla_stripe_connect_started fires on hosted-onboarding URL generation | implemented (brandStripeService.ts:startBrandStripeOnboarding) |
| 9 | mingla_stripe_connect_activated once per brand on charges_enabled false→true | implemented (syncAccount transition gate; webhook event-id idempotency in router proper) |
| 10 | mingla_event_published fires on publish | implemented (businessEvents.ts:publishBusinessEventDraft) |
| 11 | S2S af_purchase first-ticket once per brand | implemented (claimBrandMilestone gate in handleTicketCheckoutPaymentIntent) |
| 12 | S2S mingla_first_payout once per brand | implemented (claimBrandMilestone gate in handlePayout, only on payout.paid) |
| 13 | AppsFlyer failure never propagates to Stripe webhook | implemented (postAppsFlyerS2SEvent never throws; webhook integrations wrapped in try/catch belt-and-suspenders) |
| 14 | iOS App Store: NSUserTrackingUsageDescription present, no ATT at startup | implemented (string in app.json + `timeToWaitForATTUserAuthorization: 0`) — verification requires real device build |
| 15 | signOut clears AppsFlyer customer_user_id | implemented (both explicit signOut + SIGNED_OUT branch) |
| 16 | All Constitution rules pass | verified for #3, #5, #6, #14 — see §6 |

---

## 5. Invariant Verification

| Invariant | Status |
|---|---|
| I-ZUSTAND-PERSIST-NO-SERVER-SNAPSHOTS | preserved — `afEventFiredRef` is useRef, not Zustand |
| Constitution #3 (no silent failures) | preserved — every catch logs with `[AppsFlyer]` prefix; env-missing case logs once |
| Constitution #5 (server state server-side) | preserved — `appsflyer_devices` server-owned via RLS; clients only upsert own rows |
| Constitution #6 (logout clears everything) | preserved + extended — new clearAppsFlyerUserId + resetAppsFlyerDeviceCache + afEventFiredRef reset on signOut |
| Constitution #14 (persisted-state startup) | preserved — init runs at mount inside hydrated RootLayoutInner, no Zustand dep |
| `appsflyer_devices` RLS (`auth.uid() = user_id`) | preserved — unchanged; `app` column not in predicate |
| Stripe webhook idempotency | preserved + augmented — `brand_appsflyer_milestones` adds "first-ever" gate beyond Stripe event-ID dedup |
| I-PROPOSED-AF-DISCRIMINATOR (DRAFT) | enforced via new CI gate; flips to ACTIVE on CLOSE |
| I-PROPOSED-AF-MILESTONE-IDEMPOTENT (DRAFT) | enforced via single-UPDATE-with-NULL-WHERE pattern; flips to ACTIVE on CLOSE |

---

## 6. Parity Check

- **Consumer ↔ Business parity:** consumer service updated in the same commit to write `app: 'consumer'`. Without this, the migration would break the consumer upsert the moment it lands. Verified by grep — only one upsert site in consumer service.
- **Solo ↔ Collab:** N/A — this is an instrumentation integration, not a feature with mode variants.
- **iOS ↔ Android:** init handles both via `Platform.OS`. App ID resolution mirrors consumer pattern (iOS gets numeric, Android gets package name). NSUserTrackingUsageDescription added for iOS; Android `AD_ID` permission auto-merged by `react-native-appsflyer` plugin (no manual addition needed per consumer precedent).
- **Mobile ↔ Admin ↔ Business:** AppsFlyer is mobile-only. No admin or web parity required.

---

## 7. Cache Safety

- No React Query keys touched. No query-cache invalidation impact.
- Zustand stores untouched.
- In-memory dedup `Set<string>` in service is cleared on signOut via `resetAppsFlyerDeviceCache()` — confirmed via grep.

---

## 8. Regression Surface (for tester)

1. **Authentication flow (sign-in / sign-up / sign-out)** — most-affected path. Any auth listener regression surfaces here. Verify SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, INITIAL_SESSION, USER_UPDATED all still work (only SIGNED_OUT was given new code; others see only additive identity-binding effects).
2. **Brand creation** — `createBrand` now fires AppsFlyer event after success. No change to return value or error path.
3. **Stripe Connect onboarding** — `startBrandStripeOnboarding` fires AppsFlyer event after success. No change to return value or error path.
4. **Event publish** — `publishBusinessEventDraft` fires AppsFlyer event after success. No change to return value or error path.
5. **Stripe webhooks (account.updated, checkout.session.completed, payment_intent.succeeded, payout.paid)** — three new S2S call sites. All wrapped in try/catch with belt-and-suspenders. Verify Stripe webhook caller never sees a non-200 due to AppsFlyer.
6. **Consumer (app-mobile) device registration** — upsert payload now carries `app: 'consumer'` + new onConflict key. Verify consumer install still registers correctly after migration push.

---

## 9. Constitutional Compliance

| # | Principle | Verdict |
|---|---|---|
| 1 | No dead taps | N/A — no new UI |
| 2 | One owner per truth | PASS — `appsflyer_devices` server-owned; client only writes own rows |
| 3 | No silent failures | PASS — every catch logs with prefix and context; env-missing case explicit warn |
| 4 | One key per entity | N/A — no React Query keys |
| 5 | Server state server-side | PASS — service uses Supabase upsert (server-authoritative); no client cache for AF state |
| 6 | Logout clears everything | PASS — new clearAppsFlyerUserId + resetAppsFlyerDeviceCache wired into both explicit signOut and SIGNED_OUT |
| 7 | Label temporary | PASS — TRANSITIONAL guards include exit condition ("Set EXPO_PUBLIC_APPSFLYER_*") |
| 8 | Subtract before adding | PASS — old consumer-side upsert payload replaced in same commit as migration |
| 9 | No fabricated data | PASS — events carry only IDs + Stripe-authoritative revenue |
| 10 | Currency-aware | PASS — S2S helper passes `af_currency` from Stripe (paymentIntent.currency, payout.currency) |
| 11 | One auth instance | PASS — unchanged |
| 12 | Validate at right time | N/A — no datetime validation in scope |
| 13 | Exclusion consistency | N/A — no generation/serving fork |
| 14 | Persisted-state startup | PASS — init in RootLayoutInner runs after hydration; no Zustand dep |

---

## 10. Verification Matrix

| Gate | Result |
|---|---|
| `mingla-business` `npx tsc --noEmit` | PASS (exit 0) |
| `app-mobile` `npx tsc --noEmit` | exit 2 due to 3 pre-existing errors in `ConnectionsPage.tsx` + `HomePage.tsx` — UNRELATED to ORCH-0808 (no errors in `appsFlyerService.ts`); flagged as discovery for orchestrator |
| `node .github/scripts/strict-grep/orch-0808-appsflyer-devices-app-discriminator.mjs` | PASS (clean) |
| Migration SQL self-verify probe (post-push) | UNVERIFIED — operator runs `supabase db push --linked` to apply |
| Deno gate on `supabase/functions/_shared/appsFlyerS2S.ts` + modified `stripeWebhookRouter.ts` | NOT RUN — Deno is not available in this Claude session per parity rule §8. Operator/Codex must run `deno check supabase/functions/_shared/appsFlyerS2S.ts` and `deno check supabase/functions/_shared/stripeWebhookRouter.ts` before deploy. |
| Jest unit tests for new service | NOT WRITTEN — out of scope discipline (spec §7 step 10 mentions unit tests; tester writes independent tests per Mingla Forensics TEST contract) |
| iOS native build + AppsFlyer debug console install event | UNVERIFIED — requires `eas build -p ios --profile preview` + real device |
| Android native build + AppsFlyer debug console install event | UNVERIFIED — requires `eas build -p android --profile preview` + real device |

---

## 11. Operator Actions Required Before Deploy / Release

These are operator-only — implementor cannot run them per parity rules §9 + §11.

1. **Apply database migration:**
   ```bash
   cd /Users/sethogieva/Desktop/mingla-main
   supabase db push --linked
   ```
   Verifies the migration applies cleanly to the linked Supabase project (`gqnoajqerqhnvulmnyvv`) and that the inline self-verify probe passes. The migration is additive + safe — existing `appsflyer_devices` rows default to `app='consumer'`.

2. **Run Deno gates on edge-function changes:**
   ```bash
   /Users/sethogieva/bin/deno check supabase/functions/_shared/appsFlyerS2S.ts
   /Users/sethogieva/bin/deno check supabase/functions/_shared/stripeWebhookRouter.ts
   ```
   (Or `deno check` if on PATH.) Per parity rule §8 — implementor could not run these from this Claude session.

3. **Deploy edge functions (after DB push + gates pass):**
   The webhook router is consumed by any edge function that imports `stripeWebhookRouter.ts`. Identify the entry-point function(s) (typically `stripe-webhook-router` or a brand-stripe webhook handler) and deploy:
   ```bash
   /Users/sethogieva/bin/supabase functions deploy <function-name> --project-ref gqnoajqerqhnvulmnyvv
   ```
   Per memory rule (codified 2026-05-10): orchestrator owns edge-function deploys after operator confirms DB push succeeded.

4. **Native rebuild (BLOCKING for any device-side install-event firing):**
   `react-native-appsflyer` is a native module — OTA `eas update` cannot deliver it. From `mingla-business/`:
   ```bash
   cd mingla-business
   eas build --platform ios --profile preview --message "ORCH-0808: AppsFlyer integration"
   eas build --platform android --profile preview --message "ORCH-0808: AppsFlyer integration"
   ```
   Distribute via TestFlight + Play internal track. Until a native build with this code lands on a real device, the AppsFlyer dashboard will show zero install events for Mingla Business.

5. **Secrets confirmation (already done in this session):**
   - EAS project secrets set: `EXPO_PUBLIC_APPSFLYER_DEV_KEY`, `EXPO_PUBLIC_APPSFLYER_IOS_APP_ID`, `EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID` ✅
   - Supabase function secrets set: `APPSFLYER_BUSINESS_DEV_KEY`, `APPSFLYER_BUSINESS_IOS_APP_ID`, `APPSFLYER_BUSINESS_ANDROID_APP_ID` ✅

---

## 12. Transition Items

- **`mingla-business/src/services/appsFlyerService.ts`**: `// TRANSITIONAL` guard when env is missing — init logs warn + returns. **Exit condition:** all three `EXPO_PUBLIC_APPSFLYER_*` env vars set as EAS Secrets (already done as of 2026-05-12; transition closes once the next build with this code lands).
- **`supabase/functions/_shared/appsFlyerS2S.ts`**: `// TRANSITIONAL`-equivalent env guard — S2S helper logs + returns false when any of three server-side `APPSFLYER_BUSINESS_*` is missing. **Exit condition:** all three Supabase function secrets set (already done 2026-05-12).
- **`first_activated_at` milestone column**: spec §6 referenced `I-PROPOSED-AF-MILESTONE-IDEMPOTENT` covering activation-via-milestone, but the migration ships only `first_ticket_sold_at` + `first_payout_at`. Stripe-connect-activated uses a different gate (the `prior.charges_enabled === false → account.charges_enabled === true` transition is naturally idempotent at the Stripe event level — subsequent identical webhooks find prior already true and skip). This is intentional. The S2S helper's `claimBrandMilestone` rejects `first_activated_at` calls explicitly with a warn log. **Exit condition:** none — current design is correct; documented for clarity.

---

## 13. Discoveries for Orchestrator

1. **Pre-existing `app-mobile` TypeScript errors (3)** — `ConnectionsPage.tsx:2763` (Friend type mismatch between friendsService vs connectionsService) and `HomePage.tsx:246+249` (SessionSwitcherItem missing `state` property). Not introduced by ORCH-0808 — confirmed by inspecting both files: zero changes from this dispatch touched either. Suggest registering as **ORCH-0811** (S2/S3 — minor type drift). These do NOT block ORCH-0808 close; flagged for separate cleanup.

2. **Consumer-side signOut does NOT clear AppsFlyer customer_user_id** — confirmed in forensics. `app-mobile/app/index.tsx` has no `clearAppsFlyerUserId` equivalent. This violates Constitution #6 on the consumer side and creates a cross-user attribution bleed if user A signs out and user B signs in on the same device. Mingla Business fixes this gap in its own code as part of ORCH-0808. Suggest registering as **ORCH-0809** (S2 consumer-side fix — small retrofit mirroring this ORCH's `clearAppsFlyerUserId` + `resetAppsFlyerDeviceCache` pattern).

3. **No central env-var validator for `EXPO_PUBLIC_*` instrumentation vars** — Sentry, OneSignal, and now AppsFlyer all use ad-hoc `if (env)` guards at their init sites. A central root-mount validator that surfaces "instrumentation degraded" in dev builds when any expected var is missing would reduce silent-no-op risk. Already proposed as **ORCH-0810** (S3 housekeeping) during spec phase — re-confirming here.

4. **Unit tests not added** — spec §7 step 10 called for unit tests for the new service and the S2S helper. Tester (Claude `mingla-forensics` TEST mode) writes independent tests per its skill contract, so I deferred. If the orchestrator prefers implementor-authored unit tests as a hard gate, flag during review and I'll add a Jest test for the business service in a follow-up.

---

## 14. Diff Summary

```
 .github/scripts/strict-grep/orch-0808-appsflyer-devices-app-discriminator.mjs |  NEW (182)
 .github/workflows/strict-grep-mingla-business.yml                              | +14 -0
 Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0808_APPSFLYER_MINGLA_BUSINESS.md |  NEW (this file)
 Mingla_Artifacts/specs/SPEC_ORCH-0808_APPSFLYER_MINGLA_BUSINESS.md             |  pre-existing (spec)
 app-mobile/src/services/appsFlyerService.ts                                    |  +2 -1 (consumer 'app' discriminator)
 mingla-business/app.json                                                        |  +2 -0 (NSUserTracking + plugin)
 mingla-business/app/_layout.tsx                                                 |  +9 -0 (init wire)
 mingla-business/package-lock.json                                               |  npm install delta
 mingla-business/package.json                                                    |  +1 -0 (react-native-appsflyer)
 mingla-business/src/context/AuthContext.tsx                                     | +73 -0 (identity binding + signOut clear)
 mingla-business/src/services/appsFlyerService.ts                                |  NEW (205)
 mingla-business/src/services/brandStripeService.ts                              |  +9 -0 (connect_started event)
 mingla-business/src/services/brandsService.ts                                   |  +6 -0 (brand_created event)
 mingla-business/src/services/businessEvents.ts                                  |  +9 -0 (event_published event)
 supabase/functions/_shared/appsFlyerS2S.ts                                      |  NEW (232)
 supabase/functions/_shared/stripeWebhookRouter.ts                               | +95 -0 (3 S2S call sites)
 supabase/migrations/20260601000000_orch_0808_appsflyer_devices_app_discriminator.sql | NEW (97)
```

---

## 15. Confidence

**HIGH** for the implementation correctness. Pattern is established and shipping in production on the consumer side. Schema change is additive + backward-compatible (default value populates existing rows). S2S helper is self-contained, never throws, and idempotency is enforced by atomic UPDATE-WHERE-NULL on `brand_appsflyer_milestones`. TypeScript clean on mingla-business; strict-grep gate clean locally.

**MEDIUM** for runtime behavior pending Deno gate + real-device verification. The S2S endpoint contract (lowercase `authentication` header, eventTime format) was implemented from the AppsFlyer S2S spec — has not been smoke-tested against the live AppsFlyer endpoint from a deployed function. First operator-assisted live-fire ticket sale will be the proof point.

---

**END OF REPORT.**
