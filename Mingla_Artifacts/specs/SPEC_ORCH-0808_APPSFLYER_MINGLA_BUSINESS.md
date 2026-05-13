# SPEC — ORCH-0808 — AppsFlyer Integration for Mingla Business

**Status:** DRAFT (awaiting operator approval before implementor dispatch)
**Author:** Claude `mingla-forensics` (SPEC mode)
**Date:** 2026-05-12
**Type:** missing-feature (instrumentation)
**Severity:** S2
**Surface:** `mingla-business/` (native iOS + Android), `supabase/functions/` (S2S event seams)

---

## 1. Scope & Non-Goals

### Scope

Integrate the AppsFlyer mobile SDK into the Mingla Business app — mirroring the production-grade pattern already shipping in `app-mobile/` — so that organizer install attribution, identity binding, and the canonical organizer-funnel events stream into a **dedicated Mingla Business AppsFlyer app dashboard**.

In scope:

1. SDK install — `react-native-appsflyer` package + Expo config plugin in `mingla-business/package.json` and `mingla-business/app.json`.
2. Service module — `mingla-business/src/services/appsFlyerService.ts` mirroring the four-function surface of `app-mobile/src/services/appsFlyerService.ts` (`initializeAppsFlyer`, `setAppsFlyerUserId`, `registerAppsFlyerDevice`, `logAppsFlyerEvent`).
3. Init wiring — call `initializeAppsFlyer()` once at root mount in `mingla-business/app/_layout.tsx` (inside `RootLayoutInner`, after Sentry init).
4. Identity binding + first-event fire — invoke `setAppsFlyerUserId` + `registerAppsFlyerDevice` from `mingla-business/src/context/AuthContext.tsx` `onAuthStateChange(SIGNED_IN)` handler, and fire `af_complete_registration` (first-time creator) or `af_login` (returning) once per auth session.
5. Canonical organizer-funnel events — instrumentation points for: brand created, Stripe Connect started, Stripe Connect activated (charges_enabled=true), event published, first ticket sold (S2S), first payout received (S2S).
6. Supabase schema — extend the existing `appsflyer_devices` table with an `app` discriminator column (default `'consumer'`) so the business app's UIDs do not collide with the consumer app's UIDs for the same `user_id`. Migrate the existing unique constraint and the consumer-side service to write `app = 'consumer'`.
7. ATT deferral — mirror ORCH-0349 — `timeToWaitForATTUserAuthorization: 0` at init; no ATT prompt on cold start.
8. iOS `infoPlist` — add `NSUserTrackingUsageDescription` (required when AppsFlyer SDK is linked even if ATT is deferred — Apple rejects builds linking the IDFA-capable framework without the key).
9. EAS env wiring — `EXPO_PUBLIC_APPSFLYER_DEV_KEY`, `EXPO_PUBLIC_APPSFLYER_IOS_APP_ID`, `EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID` read by the service at init; absence guarded as no-op (TRANSITIONAL ship pattern from `_layout.tsx` Sentry init).
10. Tests — unit tests for service (mocked SDK), unit test for the `app` discriminator on insert, unit test for "init guarded when env missing", Constitution-#3 audit for silent-failure paths.

### Non-goals (explicit, with rationale)

- **OneLink deep links / deferred deep linking** — `onDeepLinkListener: false` in init. Buyer flow already uses Universal Links (`applinks:business.usemingla.com`) and Android App Links handled by expo-router. OneLink adds an attribution dimension we don't need until paid-acquisition campaigns are running. Defer to a later ORCH.
- **Onelink Smart Banner / OneFlow / SmartScript** — out of scope.
- **In-app purchase / revenue events on the device** — Mingla Business doesn't run any in-app IAP. All revenue (ticket sales) lands in Stripe → the canonical `af_purchase` for first-ticket-sold and first-payout fires **server-side (S2S)** from the edge function processing the Stripe webhook. No client-side `af_purchase` from the device.
- **Cross-app user stitching** — a consumer-side user who also creates an organizer account does NOT have their consumer UID merged with their business UID at the AppsFlyer level. They are two distinct installs by design (different bundle IDs). Stitching is a future product question, not an instrumentation question.
- **Conversion uplift A/B testing** — out of scope. SDK ships with `onInstallConversionDataListener: false`. Future ORCH for SKAdNetwork conversion windows.
- **Analytics dashboard parity check vs Mixpanel** — Mixpanel may be wired separately in a future ORCH. This spec does not unify the two.
- **Android Google Play install referrer plugin** — `react-native-appsflyer` bundles the install-referrer handling itself; no additional plugin needed. Verified against `app-mobile/` precedent (no separate referrer plugin there).
- **Adding events that don't exist today** — first-payout requires a webhook seam that already exists (`stripeWebhookRouter`). Brand-created requires the existing brand-insert path. We do not invent new domain events; we instrument existing seams.

### Assumptions

- The operator will create a **new app** in the AppsFlyer dashboard for Mingla Business (separate from the consumer app), and will supply:
  - Dev key (single value, same on iOS + Android per AppsFlyer's model)
  - iOS App ID (numeric — App Store Connect; may be a TestFlight-only ID pre-launch; AF accepts pre-public IDs)
  - Android Package ID = `com.sethogieva.minglabusiness` (already declared in [app.json](mingla-business/app.json))
- Pre-MVP state of mingla-business (no public users yet) means we can ship the schema migration and the consumer-side `app='consumer'` backfill in the same change without staged-rollout coordination.
- The Stripe webhook router runs as a Supabase Edge Function with service-role access — it can read `appsflyer_devices` server-side and POST to AppsFlyer's S2S endpoint.

---

## 2. Investigation Reference

This spec is dispatched without a separate INVESTIGATE phase because (a) nothing is broken — this is a greenfield missing-feature, and (b) a complete reference implementation exists at `app-mobile/src/services/appsFlyerService.ts` and `app-mobile/app/index.tsx:332-364`. The "investigation" reduces to a pattern transcription with one schema adjustment (the `app` discriminator).

**Five-layer cross-check of the reference:**

| Layer | Source of truth | Confirmed state |
|---|---|---|
| Docs | This spec + prior ORCH-0349 (ATT deferral) | ATT deferred; init guarded |
| Schema | [supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:7392-15405](supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L7392) | `appsflyer_devices` table exists with RLS on `auth.uid() = user_id`, unique `(user_id, appsflyer_uid)`, FK to `auth.users` with `ON DELETE CASCADE`. Latest migration (no later migration touches the table — verified via `grep`). |
| Code | [app-mobile/src/services/appsFlyerService.ts](app-mobile/src/services/appsFlyerService.ts) (163 lines), [app-mobile/app/index.tsx:332-364](app-mobile/app/index.tsx#L332) | Pattern is clean: idempotent init flag, identity-guarded device upsert, dedup `Set` cache. |
| Runtime | [app-mobile/app.json:122](app-mobile/app.json#L122) — `"react-native-appsflyer"` plugin entry | Plugin is single-string form (no config object). No additional native config in app.json. |
| Data | Implicit (no published metrics in this checkout) | Out of scope — pattern reuse only. |

---

## 3. Per-Layer Specification

### 3.1 Database layer

**File:** `supabase/migrations/20260512000000_orch_0808_appsflyer_devices_app_discriminator.sql`

```sql
-- ORCH-0808 — add `app` discriminator to appsflyer_devices so consumer + business
-- installs for the same Supabase user_id don't collide on the unique constraint.

BEGIN;

-- 1) Add column with safe default to existing consumer rows.
ALTER TABLE public.appsflyer_devices
  ADD COLUMN IF NOT EXISTS app text NOT NULL DEFAULT 'consumer'
  CONSTRAINT appsflyer_devices_app_check CHECK (app IN ('consumer', 'business'));

-- 2) Drop the old unique constraint and add the new one keyed on app too.
ALTER TABLE public.appsflyer_devices
  DROP CONSTRAINT IF EXISTS appsflyer_devices_user_id_appsflyer_uid_key;

ALTER TABLE public.appsflyer_devices
  ADD CONSTRAINT appsflyer_devices_user_id_app_appsflyer_uid_key
  UNIQUE (user_id, app, appsflyer_uid);

-- 3) Index for S2S lookup by (user_id, app) — used by Stripe webhook handler
--    to find the business install for a brand owner.
CREATE INDEX IF NOT EXISTS idx_appsflyer_devices_user_id_app
  ON public.appsflyer_devices (user_id, app);

-- 4) RLS policies do not need changes — they already filter on auth.uid() = user_id.

COMMIT;
```

**Migration ordering:** strictly after the existing `appsflyer_devices` table creation in `20260505000000_baseline_squash_orch_0729.sql`. Timestamp `20260512000000` is later than every committed migration as of dispatch (last committed is `20260531000000_orch_0807_brand_avatars_storage.sql` — but ORCH-0807 is in-flight on a separate working branch; the operator confirms ordering at push time).

**Operator-applied:** YES (`supabase db push --linked` per memory rule). Implementor does NOT run `supabase db push`. Implementor leaves the SQL file in `supabase/migrations/` and notes "migration pending operator push" in the implementation report.

### 3.2 Edge function layer

**Touched function:** `supabase/functions/_shared/stripeWebhookRouter.ts` (and whichever entry-point function invokes the router — verify in implementor phase).

**New behavior:** on `checkout.session.completed` for a ticket order (first ticket sold for the brand) AND on `payout.paid` (first payout to the connected account), look up the brand owner's `appsflyer_devices` row WHERE `app = 'business'` and POST an S2S event to AppsFlyer.

**S2S endpoint:** `https://api3.appsflyer.com/inappevent/{APPSFLYER_IOS_APP_ID|APPSFLYER_ANDROID_APP_ID}`
**Auth header:** `authentication: <DEV_KEY>` (per AppsFlyer S2S spec — note: header literally lowercase `authentication`, not `Authorization`)
**Body shape (per AF S2S spec):**
```json
{
  "appsflyer_id": "<from appsflyer_devices.appsflyer_uid>",
  "customer_user_id": "<auth.users.id>",
  "eventName": "af_purchase" | "af_first_payout",
  "eventValue": "{\"af_revenue\":12.34,\"af_currency\":\"USD\"}",
  "eventTime": "2026-05-12 14:00:00.000",
  "eventCurrency": "USD"
}
```

**Idempotency:** the webhook router already de-dupes by Stripe event ID. The "first" qualifier (first-ticket / first-payout) is enforced by a new `brand_appsflyer_milestones` row check:

```sql
CREATE TABLE IF NOT EXISTS public.brand_appsflyer_milestones (
  brand_id uuid PRIMARY KEY REFERENCES public.brands(id) ON DELETE CASCADE,
  first_ticket_sold_at timestamptz,
  first_payout_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.brand_appsflyer_milestones ENABLE ROW LEVEL SECURITY;
-- service_role only; no public RLS policies needed (no client access).
```

Included in the same migration file as §3.1.

**Hard guard for implementor:** do not block the webhook's primary work (order fulfillment, payout reconciliation) on the AppsFlyer S2S call. Wrap in try/catch, log on failure, never throw. AppsFlyer is observability — Stripe correctness is not.

**Env additions to edge functions:** `APPSFLYER_BUSINESS_DEV_KEY`, `APPSFLYER_BUSINESS_IOS_APP_ID`, `APPSFLYER_BUSINESS_ANDROID_APP_ID` in the Supabase project secret store. Operator action — implementor surfaces the list in the implementation report.

### 3.3 Service layer (client)

**New file:** `mingla-business/src/services/appsFlyerService.ts`

Mirror the consumer service file exactly with these adjustments:

1. Constants read from `process.env`:
   ```ts
   const AF_DEV_KEY = process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY
   const AF_IOS_APP_ID = process.env.EXPO_PUBLIC_APPSFLYER_IOS_APP_ID
   const AF_ANDROID_APP_ID = process.env.EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID
   ```
   If any of the three is undefined, `initializeAppsFlyer` logs once and returns without calling `initSdk`. TRANSITIONAL guard pattern from `_layout.tsx` Sentry init.

2. `registerAppsFlyerDevice` writes `app: 'business'` to the upsert payload and uses the new unique key `(user_id, app, appsflyer_uid)`:
   ```ts
   supabase.from('appsflyer_devices').upsert(
     { user_id, appsflyer_uid, platform, app_id, app: 'business', updated_at: new Date().toISOString() },
     { onConflict: 'user_id,app,appsflyer_uid' },
   )
   ```

3. `logAppsFlyerEvent` signature identical to consumer (`eventName: string, eventValues: Record<string, string|number|boolean> = {}`).

4. Public exports identical to consumer: `initializeAppsFlyer`, `setAppsFlyerUserId`, `registerAppsFlyerDevice`, `logAppsFlyerEvent`.

**Touched file:** `app-mobile/src/services/appsFlyerService.ts` — implementor MUST also update the consumer service `registerAppsFlyerDevice` to write `app: 'consumer'` and use the new `onConflict: 'user_id,app,appsflyer_uid'` key. Without this update the consumer upsert breaks the moment the migration applies (old unique constraint is gone).

### 3.4 Hook layer

No new hooks. Instrumentation is fire-and-forget from inside existing hooks/services/contexts.

### 3.5 Component / context layer (init + event instrumentation)

**File:** `mingla-business/app/_layout.tsx`

Add inside `RootLayoutInner`, after Sentry init, before the splash-hide effects:

```ts
useEffect(() => {
  initializeAppsFlyer();
}, []);
```

**File:** `mingla-business/src/context/AuthContext.tsx`

Inside the `onAuthStateChange` handler (currently around line 171), on `SIGNED_IN`:

```ts
setAppsFlyerUserId(session.user.id);
registerAppsFlyerDevice(session.user.id);
```

Fire the first-event `af_complete_registration` or `af_login` exactly once per auth session, gated by a `useRef<boolean>` flag at the provider level (mirrors `afEventFiredRef` in [app-mobile/app/index.tsx:341](app-mobile/app/index.tsx#L341)). Determine "first-time" via the existence of a `creator_accounts` row for the user (`creatorAccount.ts` service):
- `creator_accounts` row exists → `af_login` (returning organizer)
- no row → `af_complete_registration` with `{ af_registration_method: 'email' | 'apple' | 'google' }`

The `af_registration_method` value is derived from `session.user.app_metadata?.provider` (mirrors consumer pattern).

**File:** `mingla-business/src/services/brandsService.ts` (verify exact filename in implementor phase — `brandsService.ts` is in the directory listing)

On successful brand-insert mutation resolution, fire:
```ts
logAppsFlyerEvent('mingla_brand_created', { brand_id: newBrand.id })
```
(Not an `af_*` reserved name — `mingla_brand_created` is the custom organizer-funnel event. AppsFlyer accepts any event name; `af_*` is reserved for the conversion-canonical set.)

**File:** `mingla-business/src/services/brandStripeService.ts` (verify in implementor phase)

- When the user clicks "Connect Stripe" and the function returns a hosted-onboarding URL: `logAppsFlyerEvent('mingla_stripe_connect_started', { brand_id })`
- When polling reveals `charges_enabled` flipped from `false` → `true` for the first time on the brand (gate on a `useRef` or a Zustand flag — the polling lives in the connect flow): `logAppsFlyerEvent('mingla_stripe_connect_activated', { brand_id })`

**File:** event-publish flow (locate in implementor phase — likely `mingla-business/src/services/eventDrafts.ts` or whichever service flips `events.is_published` to `true`)

On successful publish: `logAppsFlyerEvent('mingla_event_published', { event_id, brand_id, ticket_tiers: <int> })`

**No PII in eventValues.** No names, emails, phone numbers, exact prices in client-side event values — IDs only. Revenue events come from S2S where the server can attach `af_revenue` from Stripe's authoritative amount.

### 3.6 Realtime

N/A — no realtime channels in scope.

### 3.7 iOS / Android native config

**iOS** — add to `mingla-business/app.json` `ios.infoPlist`:
```json
"NSUserTrackingUsageDescription": "Mingla Business uses your advertising identifier to measure the performance of our ads and help us reach more organizers like you."
```

The ATT prompt itself is **NOT shown at startup** (`timeToWaitForATTUserAuthorization: 0`). The string is required by App Store Review because the AppsFlyer framework links against `AdSupport.framework`. A future ORCH will trigger the actual ATT prompt at a post-onboarding moment if/when paid acquisition campaigns warrant it.

**Android** — `app.json` already declares `android.permissions: ["android.permission.INTERNET", ...]`. The `react-native-appsflyer` plugin auto-merges the required `com.google.android.gms.permission.AD_ID` for Android 13+. No manual additions needed. Implementor verifies via `expo prebuild` dry-run if asked, but the audit can rely on plugin precedent in `app-mobile/`.

### 3.8 Package + plugin

**File:** `mingla-business/package.json`

Add:
```json
"react-native-appsflyer": "^6.17.8"
```
Match the consumer-side version exactly (pin to the same major+minor — currently `^6.17.8` per `app-mobile/package.json:72`). Version drift between the two apps is acceptable later but introducing the SDK at the same major is the safe default.

**File:** `mingla-business/app.json`

Add `"react-native-appsflyer"` to the `plugins` array (single-string form, no config object — mirrors consumer at [app-mobile/app.json:122](app-mobile/app.json#L122)).

### 3.9 EAS / env

- `EXPO_PUBLIC_APPSFLYER_DEV_KEY` — EAS secret (Expo public env so the bundler inlines it; AppsFlyer dev key is not a server secret — it appears in mobile binaries by design).
- `EXPO_PUBLIC_APPSFLYER_IOS_APP_ID` — EAS secret.
- `EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID` — EAS secret.
- `APPSFLYER_BUSINESS_DEV_KEY` — Supabase Function secret (server-side; **same value as `EXPO_PUBLIC_APPSFLYER_DEV_KEY`**, stored separately so the webhook router can read it without referencing the mobile env).
- `APPSFLYER_BUSINESS_IOS_APP_ID` — Supabase Function secret.
- `APPSFLYER_BUSINESS_ANDROID_APP_ID` — Supabase Function secret.

Operator action — surfaced in implementation report, not done by implementor.

---

## 4. Success Criteria

| # | Criterion | Observable via |
|---|---|---|
| 1 | On cold start with valid env, `initializeAppsFlyer` is called exactly once and `_initialized` flips to `true`. | Dev-build console: `[AppsFlyer] SDK initialized` |
| 2 | On cold start with any of the three env vars missing, `initializeAppsFlyer` returns without crashing and logs a single warning. | Dev-build console: `[AppsFlyer] env missing — init skipped` |
| 3 | On `SIGNED_IN`, `setCustomerUserId` is called with the Supabase user UUID exactly once per auth session. | AppsFlyer dashboard: customer_user_id present on session |
| 4 | On `SIGNED_IN`, a row in `appsflyer_devices` with `app='business'` exists after ~3 seconds (SDK UID fetch latency). | SQL: `SELECT * FROM appsflyer_devices WHERE user_id = $1 AND app = 'business'` |
| 5 | A consumer user already in `appsflyer_devices` (post-migration) has their row updated to `app='consumer'` and continues to receive consumer-side events without error. | SQL: post-migration `SELECT count(*) FROM appsflyer_devices WHERE app = 'consumer'` matches pre-migration `count(*)` |
| 6 | `af_complete_registration` fires exactly once per first-time creator (no `creator_accounts` row); `af_login` fires exactly once per returning creator. | AppsFlyer dashboard: event counts |
| 7 | `mingla_brand_created` fires on first successful brand insert per session. | AppsFlyer dashboard |
| 8 | `mingla_stripe_connect_started` fires when the hosted-onboarding URL is generated. | AppsFlyer dashboard |
| 9 | `mingla_stripe_connect_activated` fires once when `charges_enabled` flips `false → true` for the brand. | AppsFlyer dashboard |
| 10 | `mingla_event_published` fires on first successful publish. | AppsFlyer dashboard |
| 11 | On Stripe `checkout.session.completed` (ticket order) — S2S `af_purchase` posted to AppsFlyer with `af_revenue` from Stripe amount, and `brand_appsflyer_milestones.first_ticket_sold_at` is set if NULL. Subsequent ticket sales do NOT re-fire the milestone event. | Edge function logs + AF dashboard |
| 12 | On Stripe `payout.paid` (first time) — S2S `mingla_first_payout` posted, `brand_appsflyer_milestones.first_payout_at` set. | Edge function logs + AF dashboard |
| 13 | If env is missing OR AppsFlyer S2S endpoint errors, the Stripe webhook returns 200 and order/payout state is correct. AppsFlyer failure NEVER propagates to webhook caller. | Edge function logs (warn, not error) |
| 14 | iOS App Store build review passes — `NSUserTrackingUsageDescription` is present, no ATT prompt fires at startup. | Pre-submission build inspect + manual cold-start check |
| 15 | Logout via `AuthContext.signOut` does not retain AppsFlyer customer_user_id on the device. (AppsFlyer SDK retains `customer_user_id` until `setCustomerUserId('')` is called.) The signOut path must clear it. | Manual: sign out, sign in as user B, verify AF dashboard shows user B's customer_user_id |
| 16 | All Constitution rules pass (#1, #3, #5, #6, #8, #14 are the at-risk ones for this change). | TEST mode audit |

---

## 5. Invariants

### Preserved (must not regress)

- **I-ZUSTAND-PERSIST-NO-SERVER-SNAPSHOTS (ACTIVE post-ORCH-0742)** — no AppsFlyer state is persisted to Zustand. The `afEventFiredRef` is a `useRef`, not a Zustand store. Verified.
- **Constitution #3 (no silent failures)** — every catch in the service logs with `console.warn` and a contextual prefix. The TRANSITIONAL env-missing path logs once with an exit condition ("set EXPO_PUBLIC_APPSFLYER_DEV_KEY").
- **Constitution #5 (server state server-side)** — `appsflyer_devices` rows are server-owned; client only upserts its own row via RLS.
- **Constitution #6 (logout clears everything)** — see success criterion #15. `AuthContext.signOut` must call `appsFlyer.setCustomerUserId('')` and `appsFlyer.stop(true)` before completing.
- **Constitution #14 (persisted-state startup)** — init runs once at mount inside the hydrated `RootLayoutInner`; no Zustand hydration race because init takes no Zustand state.
- **`appsflyer_devices` RLS (`auth.uid() = user_id`)** — unchanged. The `app` column is not part of the RLS predicate.
- **Stripe webhook idempotency** — the existing event-ID dedup in `stripeWebhookRouter.ts` is the primary guard; the `brand_appsflyer_milestones` row is a secondary guard for "first-ever" semantics, not for replay safety.

### Established (new)

- **I-PROPOSED-AF-DISCRIMINATOR (DRAFT — flips to ACTIVE on ORCH-0808 CLOSE)** — every write to `appsflyer_devices` MUST include an explicit `app` value in `('consumer', 'business')`. CI gate: strict-grep for `.from('appsflyer_devices').upsert(` and `.from('appsflyer_devices').insert(` across the monorepo, requiring an `app:` key in the payload. Hooks into the strict-grep registry per `feedback_strict_grep_registry_pattern.md`.
- **I-PROPOSED-AF-MILESTONE-IDEMPOTENT (DRAFT — flips to ACTIVE on CLOSE)** — first-ticket and first-payout S2S events MUST be gated by `brand_appsflyer_milestones.first_ticket_sold_at IS NULL` / `first_payout_at IS NULL` checks performed in the same transaction that sets them. No external locks. PostgreSQL row-level lock via `SELECT ... FOR UPDATE` inside the webhook handler is the canonical pattern.

---

## 6. Test Cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | Cold start, env present | App launch | `[AppsFlyer] SDK initialized` logged once | Service + Init |
| T-02 | Cold start, dev key missing | App launch with `EXPO_PUBLIC_APPSFLYER_DEV_KEY` unset | Single warn log, no crash, `_initialized` stays `false`, subsequent service calls all return early | Service |
| T-03 | First-time creator signs in | Fresh email signup, no `creator_accounts` row | `setCustomerUserId` called once, `appsflyer_devices` row inserted with `app='business'`, `af_complete_registration` fired with `af_registration_method: 'email'` | Service + Context + DB |
| T-04 | Returning creator signs in | Existing `creator_accounts` row | `af_login` fired (NOT `af_complete_registration`), device upsert idempotent (no duplicate row) | Service + Context + DB |
| T-05 | Auth session flips A → B | Sign out as user A, sign in as user B in same app lifecycle | `setCustomerUserId('')` called on signOut, then `setCustomerUserId(B.id)` on SIGNED_IN, `afEventFiredRef` reset between sessions | Service + Context |
| T-06 | Brand created | Successful brand insert | `mingla_brand_created` fires once with `{ brand_id }`, repeat brand creation by same user fires again (per-brand, not per-user) | Service |
| T-07 | Stripe connect flow happy path | User connects Stripe → completes onboarding → `charges_enabled` flips true | `mingla_stripe_connect_started` then `mingla_stripe_connect_activated`, each fires once | Service |
| T-08 | Stripe connect activated twice | User toggles Stripe disconnect/reconnect (ORCH-0802) | `mingla_stripe_connect_activated` does NOT re-fire on reconnect (per-brand milestone, not per-toggle) | Service + Hook |
| T-09 | Event published | First publish of an event | `mingla_event_published` fires; subsequent edits-then-republish do NOT fire | Service |
| T-10 | First ticket sale S2S | Stripe `checkout.session.completed` for a ticket order | S2S POST to AF endpoint with `af_purchase` + `af_revenue`, `brand_appsflyer_milestones.first_ticket_sold_at` set, second sale on same brand does NOT re-fire `af_purchase` as a milestone | Edge function + DB |
| T-11 | First payout S2S | Stripe `payout.paid` for connected account | S2S `mingla_first_payout` posted, `first_payout_at` set, second payout does NOT re-fire | Edge function + DB |
| T-12 | AppsFlyer S2S endpoint 500 | Mock S2S to return 500 | Webhook handler returns 200 to Stripe, error logged, no Stripe retry storm | Edge function |
| T-13 | AppsFlyer S2S env missing | Unset `APPSFLYER_BUSINESS_DEV_KEY` | Webhook handler returns 200, skip log line, no S2S call attempted | Edge function |
| T-14 | Migration applied to existing data | DB with N pre-existing `appsflyer_devices` rows from consumer | Post-migration all N rows have `app='consumer'`, unique constraint recreated, consumer service upserts continue to work without error | DB migration |
| T-15 | Two-app same-user | Same `user_id` exists in both consumer and business installs | Two rows in `appsflyer_devices` distinguished by `app` column, no unique-constraint violation | DB + Service |
| T-16 | Constitution #6 logout | Sign out | `appsFlyer.setCustomerUserId('')` called before signOut resolves | Context |
| T-17 | ATT not prompted at startup | iOS cold start | No ATT system prompt visible in first 30s | iOS native |
| T-18 | iOS build review | Submit dev build to TestFlight | Build accepts without "missing NSUserTrackingUsageDescription" rejection | Native build |
| T-19 | DIAG marker reaping | Search codebase for `[ORCH-0808-DIAG]` after CLOSE | Zero matches | Process |

---

## 7. Implementation Order

1. **DB migration** (`supabase/migrations/20260512000000_orch_0808_appsflyer_devices_app_discriminator.sql`) — write file only; operator runs `supabase db push --linked`.
2. **Consumer-side service update** (`app-mobile/src/services/appsFlyerService.ts`) — add `app: 'consumer'` to upsert and update `onConflict` key. Critical to land in the same commit as migration so neither side is broken between push and deploy.
3. **Business-side service** (`mingla-business/src/services/appsFlyerService.ts`) — new file mirroring consumer with env-driven constants and `app: 'business'`.
4. **Business-side init wiring** — `mingla-business/app/_layout.tsx` adds `initializeAppsFlyer()` effect.
5. **Business-side identity binding** — `mingla-business/src/context/AuthContext.tsx` adds `setAppsFlyerUserId` / `registerAppsFlyerDevice` / first-event fire to the `onAuthStateChange` handler and clears identity on signOut.
6. **Business-side event instrumentation** — brand-created, stripe-connect-started, stripe-connect-activated, event-published seams (locate exact filenames in implementor phase).
7. **Edge-function S2S handler** — extend `supabase/functions/_shared/stripeWebhookRouter.ts` with `af_purchase` (first-ticket) + `mingla_first_payout` posts gated by `brand_appsflyer_milestones`.
8. **Package + plugin** — `mingla-business/package.json` + `mingla-business/app.json`.
9. **iOS infoPlist** — `NSUserTrackingUsageDescription`.
10. **Unit tests** — service tests, migration self-verify probe, S2S idempotency test.
11. **CI gate** — strict-grep `appsflyer_devices` writes-without-app-key into `.github/workflows/strict-grep-mingla-business.yml` (NEW job — per registry pattern, one script + one job).
12. **Implementor report** — `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0808_APPSFLYER_MINGLA_BUSINESS.md` with old→new receipts + operator-action list (env vars, migration push, EAS rebuild required).

**Hard guards on implementor:**
- Do NOT run `supabase db push`.
- Do NOT run `supabase functions deploy` — orchestrator owns deploys (per memory rule, codified 2026-05-10).
- Do NOT commit any dev key, app ID, or secret as a literal. Env-only.
- Do NOT add `onInstallConversionDataListener` or `onDeepLinkListener` — explicit non-goals.
- Do NOT change consumer-side init behavior beyond the upsert payload — pattern parity is the contract.
- Do NOT use `mcp__supabase__apply_migration` — operator runs `supabase db push --linked`.

**Native rebuild required:** YES. AppsFlyer adds native iOS frameworks and Android dependencies. The OTA `eas update` channel does NOT propagate native module additions — operator must run a fresh `eas build` for both iOS (TestFlight) and Android (internal track) before testing.

---

## 8. Regression Prevention

- **Strict-grep CI gate** — new job in `.github/workflows/strict-grep-mingla-business.yml` (additive — per `feedback_strict_grep_registry_pattern.md`) that fails the build if any `appsflyer_devices` write in the monorepo omits the `app:` key. Script lives at `scripts/ci/strict-grep-appsflyer-devices-app-key.sh`.
- **Migration self-verify probe** — at the end of the migration file, an inline `DO $$ ... $$;` block that confirms every row has `app IN ('consumer', 'business')` and raises if not. Pattern from prior migrations.
- **Idempotency test** — automated test that fires the Stripe webhook twice for the same `checkout.session.completed` event and asserts `af_purchase` S2S is called exactly once.
- **Constitution #6 audit in TEST mode** — explicit verification that `signOut` calls `setCustomerUserId('')`. The current consumer-side `app-mobile/` does NOT have this safeguard (verified via grep — opportunity to retrofit). Forensics will register that as a P2 finding under the side-discoveries section if confirmed during TEST.
- **DIAG-marker reaping at CLOSE** — Step 1.5 of CLOSE protocol checks for `[ORCH-0808-DIAG]` markers and confirms zero matches.

---

## 9. Out-of-Scope Side Discoveries (for orchestrator registration)

While writing this spec the following adjacent issues surfaced. The orchestrator should decide whether to register them as separate ORCHs:

1. **Consumer-side signOut does NOT clear AppsFlyer customer_user_id** — searched `app-mobile/` for `setCustomerUserId('')` and `appsFlyer.stop` — both absent. If user A signs out and user B signs in on the same device, AppsFlyer would still attribute B's events to A's customer_user_id until the next setCustomerUserId call. This violates Constitution #6. Suggest registering as ORCH-0809 (S2 consumer-side fix). The Mingla Business implementation should NOT inherit this gap — see success criterion #15.
2. **No central env-var validation for required EXPO_PUBLIC_* vars** — both `app-mobile/` and `mingla-business/` rely on ad-hoc `if (env) { ... }` guards scattered across init points (Sentry, OneSignal, soon AppsFlyer). A central env-presence check at root mount that surfaces an "instrumentation degraded" non-fatal warning in dev builds would reduce silent-no-op risk. Suggest as low-priority ORCH-0810.

---

## 10. Confidence

**HIGH.** Pattern is established and shipping in production on the consumer side. The novel work is the `app` discriminator column (mechanical schema change with backward-compatible default) and the S2S webhook handler (mirrors the AF S2S spec verbatim — no exotic surface). Five-layer cross-check on the reference is green. No contradictory migrations, no stale schema, no documentation drift.

---

## 11. Layman Summary

We're adding the same install-tracking SDK the consumer app uses into Mingla Business so that when we later run ads aimed at organizers ("Sell tickets faster with Mingla"), we can prove which ad brought which signup, which signup created a brand, which brand connected Stripe, and which brand made their first ticket sale and their first payout. Buyer-side tracking continues to live on the consumer app and is unaffected. The only shared piece is a Supabase table that stores AppsFlyer's per-device IDs — we add a column to that table so consumer rows and business rows don't collide for the same Supabase user. Revenue events (first ticket, first payout) fire from the server (Stripe webhook), not the device, because Stripe is the source of truth for money. ATT (iOS tracking prompt) stays off at launch — same posture as the consumer app — and gets switched on later when paid campaigns warrant it.

---

**END OF SPEC.**
