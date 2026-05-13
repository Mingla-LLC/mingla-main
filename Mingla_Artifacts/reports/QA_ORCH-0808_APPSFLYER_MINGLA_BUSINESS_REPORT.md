# QA Report — ORCH-0808 — AppsFlyer Integration for Mingla Business

**Tester:** Claude `mingla-tester` (parity mirror; canonical is `mingla-forensics` TEST mode)
**Date:** 2026-05-12
**Mode:** TARGETED (spec-compliance + code forensics)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec:** [Mingla_Artifacts/specs/SPEC_ORCH-0808_APPSFLYER_MINGLA_BUSINESS.md](../specs/SPEC_ORCH-0808_APPSFLYER_MINGLA_BUSINESS.md)
**Implementation report:** [Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0808_APPSFLYER_MINGLA_BUSINESS.md](IMPLEMENTATION_ORCH-0808_APPSFLYER_MINGLA_BUSINESS.md)

---

## Verdict

**CONDITIONAL PASS** — implementation is structurally sound, schema migration is safe, all Constitution rules hold, and 18/19 spec test cases pass on code-read evidence. **One P1 deviation from spec** and **two P2 issues** require operator decision before CLOSE. Native build + AppsFlyer dashboard smoke test deferred to operator (cannot be done without `eas build`).

| Severity | Count |
|---|---|
| P0 (BLOCKING) | 0 |
| P1 (must-fix or operator-accept) | 1 |
| P2 (fix this sprint) | 2 |
| P3 (fix when convenient) | 3 |
| P4 (note / observation) | 4 |

---

## 1. Layman Summary

The AppsFlyer integration is solid — the migration is safe, the consumer + business services coexist correctly, the Stripe webhook router fires server-side events without ever blowing up Stripe, and Constitution #6 (logout clears everything) is implemented in three places (explicit signOut callback, SIGNED_OUT branch, and the in-memory dedup cache reset). The strict-grep CI gate correctly detects violations.

The one structural issue I'd want operator sign-off on before CLOSE: the spec promised that `mingla_stripe_connect_activated` would fire **once per brand** (a "first activation" milestone). The implementor instead built a transition gate (`charges_enabled false → true`). For 99% of cases these are identical. But if a brand ever gets restricted by Stripe (`charges_enabled → false`) and then clears it (`charges_enabled → true` again), the event fires a second time. The implementor flagged this as "intentional" in their report §12, citing simpler idempotency for webhook retries. Operator decision: accept this trade-off as CONDITIONAL PASS, or send back for rework to ship a `first_activated_at` milestone column.

Beyond that, two minor process gaps and a handful of edge-case notes — none blocking.

---

## 2. Blast Radius Verification

Files actually changed (matches implementor report §3):

```
.github/scripts/strict-grep/orch-0808-appsflyer-devices-app-discriminator.mjs   NEW (gate)
.github/workflows/strict-grep-mingla-business.yml                                 MOD
app-mobile/src/services/appsFlyerService.ts                                       MOD (consumer parity)
mingla-business/app.json                                                          MOD
mingla-business/app/_layout.tsx                                                   MOD (init)
mingla-business/package.json + package-lock.json                                  MOD (dep)
mingla-business/src/context/AuthContext.tsx                                       MOD (identity)
mingla-business/src/services/appsFlyerService.ts                                  NEW
mingla-business/src/services/brandStripeService.ts                                MOD (event)
mingla-business/src/services/brandsService.ts                                     MOD (event)
mingla-business/src/services/businessEvents.ts                                    MOD (event)
supabase/functions/_shared/appsFlyerS2S.ts                                        NEW
supabase/functions/_shared/stripeWebhookRouter.ts                                 MOD (3 S2S sites)
supabase/migrations/20260601000000_orch_0808_appsflyer_devices_app_discriminator.sql NEW
```

Downstream impact analysis:
- **Consumer app (app-mobile)** — the consumer-side `appsflyer_devices` upsert must land in the same commit as the migration; verified. The implementor did this correctly.
- **Stripe webhook entry function** (`supabase/functions/stripe-webhook/index.ts`) — imports `routeStripeEvent`; new S2S code inside the router does NOT change the public surface, so the entry function does not need redeployment beyond the standard "re-deploy because shared code changed" pattern.
- **No admin dashboard / web changes** — AppsFlyer is mobile-only. ✓
- **No React Query keys touched** — no cache invalidation work needed.

---

## 3. Spec Test Cases — Compliance Matrix

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| T-01 | Cold start, env present → init logs once, `_initialized = true` | PASS (code) | [appsFlyerService.ts:47-78](../../mingla-business/src/services/appsFlyerService.ts#L47); guarded by `_initialized` re-entry check at line 48 |
| T-02 | Cold start, env missing → single warn, no crash, no init | PASS (code) | [appsFlyerService.ts:49-55](../../mingla-business/src/services/appsFlyerService.ts#L49); explicit guard, returns early without setting `_initialized` |
| T-03 | First-time creator: af_complete_registration fires, device row inserted with `app='business'` | PASS (code) | [AuthContext.tsx:244-257](../../mingla-business/src/context/AuthContext.tsx#L244); `creator_accounts.created_at < 30_000ms` gate. `creator_accounts.created_at DEFAULT now()` confirmed in [baseline migration line 8027](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L8027) |
| T-04 | Returning creator: af_login fires once, device upsert idempotent | PASS (code) | [AuthContext.tsx:254-257](../../mingla-business/src/context/AuthContext.tsx#L254); upsert idempotent via new onConflict `user_id,app,appsflyer_uid` + in-memory `registeredDeviceKeys` Set dedup |
| T-05 | A → B sign-out/sign-in: customer ID flips correctly, no leak | PASS (code) | Three clear sites: explicit signOut [AuthContext.tsx:586-590](../../mingla-business/src/context/AuthContext.tsx#L586), SIGNED_OUT branch [AuthContext.tsx:278-281](../../mingla-business/src/context/AuthContext.tsx#L278), and `afEventFiredRef = false` reset |
| T-06 | Brand created → mingla_brand_created fires per insert | PASS (code) | [brandsService.ts:117-121](../../mingla-business/src/services/brandsService.ts#L117) — fires AFTER success guard |
| T-07 | Stripe connect started + activated fire correctly | PASS (code) | Client started: [brandStripeService.ts:165-171](../../mingla-business/src/services/brandStripeService.ts#L165). Server activated: [stripeWebhookRouter.ts:216-241](../../supabase/functions/_shared/stripeWebhookRouter.ts#L216) — see T-08 below for caveat |
| T-08 | **Reconnect does NOT re-fire activated event (per-brand milestone)** | **FAIL — spec deviation** | Implementor used a `prior.charges_enabled === false → true` transition gate, NOT a `brand_appsflyer_milestones.first_activated_at` milestone. Reconnect after restriction WILL re-fire. See §4 Finding #1 (P1) |
| T-09 | Event published → mingla_event_published fires; re-publish does not | PASS (code) | [businessEvents.ts:525-531](../../mingla-business/src/services/businessEvents.ts#L525); RPC `business_publish_event_draft` only succeeds on draft→live transition, so subsequent edits via update RPCs do not retrigger this code path |
| T-10 | First ticket S2S: af_purchase fires once per brand | PASS (code) | [stripeWebhookRouter.ts:789-825](../../supabase/functions/_shared/stripeWebhookRouter.ts#L789); atomic `claimBrandMilestone('first_ticket_sold_at')` UPDATE ... WHERE col IS NULL |
| T-11 | First payout S2S: mingla_first_payout fires once per brand | PASS (code) | [stripeWebhookRouter.ts:384-418](../../supabase/functions/_shared/stripeWebhookRouter.ts#L384); only fires on `payout.paid`; atomic milestone gate |
| T-12 | AppsFlyer S2S 500 does NOT propagate to Stripe webhook | PASS (code) | [appsFlyerS2S.ts:175-189](../../supabase/functions/_shared/appsFlyerS2S.ts#L175); `postAppsFlyerS2SEvent` never throws; webhook integrations wrap in try/catch belt-and-suspenders |
| T-13 | AppsFlyer S2S env missing → skip + log, webhook returns 200 | PASS (code) | [appsFlyerS2S.ts:131-139](../../supabase/functions/_shared/appsFlyerS2S.ts#L131); returns false on missing env, no throw |
| T-14 | Migration applied: existing consumer rows get `app='consumer'`, unique constraint recreated | PASS (code) | Migration uses `ADD COLUMN ... NOT NULL DEFAULT 'consumer'` which auto-fills existing rows. DROP+ADD constraint sequence is correct. Self-verify probe at lines 88-100 |
| T-15 | Two-app same-user: two rows distinguished by `app` column, no collision | PASS (code) | New unique constraint `(user_id, app, appsflyer_uid)` permits one row per (user, app) combo |
| T-16 | Constitution #6 signOut clears AppsFlyer customer_user_id | PASS (code) | `clearAppsFlyerUserId()` calls `setCustomerUserId('')` per [appsFlyerService.ts:106-115](../../mingla-business/src/services/appsFlyerService.ts#L106). Wired into explicit signOut + SIGNED_OUT branch |
| T-17 | ATT not prompted at startup | PASS (code) | `timeToWaitForATTUserAuthorization: 0` at [appsFlyerService.ts:65](../../mingla-business/src/services/appsFlyerService.ts#L65) |
| T-18 | iOS build review accepts (NSUserTrackingUsageDescription present) | UNVERIFIED — code-level | String present in [app.json:19](../../mingla-business/app.json#L19). Real verification requires `eas build` + TestFlight submission. Not blocking close. |
| T-19 | DIAG marker reaping (post-CLOSE) | N/A — pre-CLOSE | Grep confirmed zero `[ORCH-0808-DIAG]` markers in source. ✓ |

**Spec compliance:** 17 PASS, 1 FAIL (T-08), 1 UNVERIFIED (T-18 — operator-deferred), 1 N/A (T-19 — CLOSE-time).

---

## 4. Findings

### Finding #1 — Spec deviation: T-08 reconnect re-fires activation event (P1)

**Severity:** P1 — spec compliance gap; requires operator decision before CLOSE.

**Location:** [supabase/functions/_shared/stripeWebhookRouter.ts:216-241](../../supabase/functions/_shared/stripeWebhookRouter.ts#L216) (`syncAccount`)

**Evidence:**
```ts
const wasEnabled = prior.data?.charges_enabled === true;
const isEnabled = account.charges_enabled === true;
if (!wasEnabled && isEnabled) {
  // ... fires mingla_stripe_connect_activated
}
```

**What spec says (§6 T-08):** "User toggles Stripe disconnect/reconnect (ORCH-0802): `mingla_stripe_connect_activated` does NOT re-fire on reconnect (per-brand milestone, not per-toggle)."

**What implementation does:** Fires `mingla_stripe_connect_activated` on **every** `charges_enabled false → true` transition. If a brand is restricted by Stripe (`charges_enabled → false` via `account.updated`) and then clears the restriction (`charges_enabled → true`), the activation event fires a second time.

**Implementor's stated rationale** (from report §12): the migration ships only `first_ticket_sold_at` + `first_payout_at` columns. Activation uses a transition gate instead of a milestone gate, described as "intentional" because the Stripe-event-level idempotency handles webhook retries cleanly.

**Why this matters:** The spec contract was per-brand idempotency. The implementation gives per-transition. For pre-launch this is rare; for production it WILL fire duplicates on restriction-cycle brands.

**Fix options:**
1. **Accept as-is (CONDITIONAL PASS).** Operator agrees that "every reactivation" is acceptable funnel data. Update spec to match (or note as accepted deviation in CLOSE notes).
2. **Add `first_activated_at` column.** Small follow-up migration adds the column; the S2S helper already has the unreachable `first_activated_at` branch ready to wire up. ~15 minutes of work.

**Recommendation:** option 2 (proper milestone) — the helper code is half-written and rejected as `not supported` in [appsFlyerS2S.ts:222-232](../../supabase/functions/_shared/appsFlyerS2S.ts#L222). Cleaner long-term than accepting a spec deviation.

---

### Finding #2 — Bootstrap-init race on warm restore (P2)

**Severity:** P2 — degrades attribution quality on warm-restore cold starts; does not affect signin-from-fresh flows.

**Locations:**
- Init: [mingla-business/app/_layout.tsx:122-127](../../mingla-business/app/_layout.tsx#L122) (`useEffect(() => initializeAppsFlyer(), [])`)
- Bootstrap identity bind: [mingla-business/src/context/AuthContext.tsx:177-179](../../mingla-business/src/context/AuthContext.tsx#L177) (`setAppsFlyerUserId(s.user.id)` inside async bootstrap)
- Init flag set: [mingla-business/src/services/appsFlyerService.ts:69](../../mingla-business/src/services/appsFlyerService.ts#L69) (`_initialized = true` only inside SDK success callback — async)

**Race scenario:** React renders + commits effects child-first. Order on cold start with persisted session:
1. `RootLayoutInner` useEffect runs → `initializeAppsFlyer()` called → `appsFlyer.initSdk(opts, successCb, failCb)` returns synchronously, native bridge call pending
2. `AuthProvider` useEffect runs → `bootstrap()` invoked → awaits `supabase.auth.getSession()`
3. **Race:** does SDK successCb (`_initialized = true`) fire before getSession resolves and `setAppsFlyerUserId` runs?
4. If getSession wins the race, `setAppsFlyerUserId` checks `if (!_initialized) return` (line 89) and silently no-ops.

**Real-world impact:**
- Fresh sign-in: SIGNED_IN handler fires later in the lifecycle → bind succeeds. ✓
- Warm restore (already-signed-in cold start): if bind no-ops, AppsFlyer events fire without a Supabase `customer_user_id` linkage. Attribution still works at the device level; cross-funnel analysis degrades.
- User who never signs out: every subsequent cold start hits this race.

**Fix options:**
1. **Make `initializeAppsFlyer()` return a Promise**, await it in AuthContext bootstrap before calling identity binds.
2. **Queue pending identity binds inside the service** — store the desired userId during pre-init state; auto-bind after successCb fires.
3. **Reactive useEffect pattern** — mirror the consumer side (`useEffect(..., [user?.id, isLoadingAuth])`) so when `_initialized` flips OR user changes, identity bind re-runs.

**Recommendation:** option 2 (queue inside service) is the least-invasive. The service knows its own readiness state. AuthContext stays clean.

---

### Finding #3 — CI workflow paths filter excludes `app-mobile/` + `supabase/functions/` (P2)

**Severity:** P2 — future drift in consumer-side or edge-function AppsFlyer code won't trigger the gate.

**Location:** [.github/workflows/strict-grep-mingla-business.yml:6-10](../../.github/workflows/strict-grep-mingla-business.yml#L6)

**Evidence:**
```yaml
paths:
  - "mingla-business/**"
  - "supabase/migrations/**"
  - ".github/scripts/strict-grep/**"
  - ".github/workflows/strict-grep-mingla-business.yml"
```

The new gate scans `app-mobile/src/`, `mingla-business/src/`, AND `supabase/functions/`. But the workflow only triggers on changes to `mingla-business/`, `supabase/migrations/`, or its own files. If a future change ONLY edits `app-mobile/src/services/appsFlyerService.ts` (e.g. removes `app: 'consumer'`), the gate won't run.

**For this PR:** safe — `mingla-business/**` AND `supabase/migrations/**` both have changes, so the workflow fires.

**Fix:** add `app-mobile/**` and `supabase/functions/**` to the workflow paths filter. Note: this would also trigger every OTHER gate in the workflow on app-mobile changes, which may be heavy. Alternative: split into a per-gate workflow file (registry pattern allows this).

**Recommendation:** add `app-mobile/**` + `supabase/functions/**` paths in a follow-up cleanup ORCH; current PR is correctly covered.

---

### Finding #4 — Multi-device attribution: latest device wins (P3)

**Location:** [supabase/functions/_shared/appsFlyerS2S.ts:48-55](../../supabase/functions/_shared/appsFlyerS2S.ts#L48) (`fetchBusinessDevice` orders by `updated_at DESC LIMIT 1`)

**Scenario:** A creator who has Mingla Business installed on both iPhone (Tuesday) and Android (Wednesday) — when their brand makes its first ticket sale, the S2S event posts to the **Android** AppsFlyer app, not iPhone. The iPhone install's attribution funnel will show installs + signups but no revenue.

**Severity:** P3 — multi-device edge case, unusual real-world incidence.

**Fix options:** fan out S2S to ALL business devices for the user, or accept latest-device wins.

**Recommendation:** accept latest-device wins (current behavior) until multi-device organisers become a common pattern.

---

### Finding #5 — First-time 30-second window clock skew (P3)

**Location:** [mingla-business/src/context/AuthContext.tsx:255](../../mingla-business/src/context/AuthContext.tsx#L255)

**Evidence:** `const isFirstTime = createdAt !== null && Date.now() - createdAt < 30_000;`

**Issue:** `createdAt` is server-time (Postgres `now()`); `Date.now()` is client-time. Significant clock skew (>30s) could misfire. RN devices typically have NTP sync, so skew is usually <5s.

**Severity:** P3 — extreme edge case.

**Recommendation:** accept as-is. The 30s window is generous.

---

### Finding #6 — Concurrent webhook duplicate fire (P3)

**Scenario:** If Stripe sends two `account.updated` events for the same `event_id` truly concurrently (rare but possible on retry storms), both invocations could observe the same `prior.charges_enabled` value (false) and both fire `mingla_stripe_connect_activated`.

The first-ticket and first-payout milestones are protected by atomic UPDATE-WHERE-NULL, so those are race-safe. **Activation is NOT.**

Compounds Finding #1. If activation moves to a milestone gate per Finding #1 recommendation, this also fixes itself.

**Severity:** P3 — low-probability, low-impact.

**Recommendation:** fix together with Finding #1 (milestone column for activation).

---

### Finding #7 — `first_activated_at` dead branch in S2S helper (P4)

**Location:** [supabase/functions/_shared/appsFlyerS2S.ts:222-232](../../supabase/functions/_shared/appsFlyerS2S.ts#L222)

The `claimBrandMilestone` helper has a `first_activated_at` parameter that's explicitly rejected with a warn log. No caller passes this value. If Finding #1 is fixed via option 2 (add the column), this branch becomes live. Otherwise it's dead code.

**Severity:** P4 — observation. Cleanup if not used.

---

### Finding #8 — Bootstrap path divergence from consumer first-event policy (P4)

**Location:** [mingla-business/src/context/AuthContext.tsx:173-179](../../mingla-business/src/context/AuthContext.tsx#L173) (bootstrap path)

**Observation:** Bootstrap binds identity but does NOT fire `af_login`. The implementor's stated rationale (comment in source): "don't inflate af_login counts on every cold launch."

The **consumer side** (`app-mobile/app/index.tsx:341-364`) DOES fire `af_login` on every cold start (when `profile.has_completed_onboarding === true`). So business app diverges from consumer policy.

**Severity:** P4 — divergence is justifiable (AppsFlyer dashboards prefer login event = actual login interaction). Could also be argued that bootstrap warm-restore is an "implicit login." Not blocking.

**Recommendation:** document the divergence (already in source comment) and leave as-is.

---

### Finding #9 — Migration timestamp deviation from spec (P4)

**Location:** [supabase/migrations/20260601000000_orch_0808_appsflyer_devices_app_discriminator.sql](../../supabase/migrations/20260601000000_orch_0808_appsflyer_devices_app_discriminator.sql)

Spec §3.1 stated timestamp `20260512000000`. Implementor used `20260601000000` because `20260531000000_orch_0807_brand_avatars_storage.sql` already exists on Seth branch. Per monotonic naming rule (cross-skill parity #10), strictly-greater is required.

**Severity:** P4 — documented deviation; correct per parity rules.

---

### Finding #10 — TypeScript pre-existing errors in app-mobile (P4)

Three pre-existing TS errors in `ConnectionsPage.tsx` and `HomePage.tsx` unrelated to ORCH-0808. Implementor flagged as discovery for orchestrator (ORCH-0811 candidate). Confirmed: no ORCH-0808 changes touch those files.

**Severity:** P4 — flagged for separate cleanup.

---

## 5. Constitution Compliance (14 rules)

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A | No UI changes |
| 2 | One owner per truth | PASS | `appsflyer_devices` server-authoritative; `brand_appsflyer_milestones` service-role only |
| 3 | No silent failures | PASS | Every catch logs with `[AppsFlyer]` / `[AppsFlyerS2S]` / `[stripe-webhook]` prefix + context; env-missing case logs explicit reason |
| 4 | One key per entity | N/A | No React Query keys |
| 5 | Server state server-side | PASS | Service writes to Supabase server-authoritative table; dedup `Set` is process-local optimisation only |
| 6 | Logout clears everything | PASS | clearAppsFlyerUserId + resetAppsFlyerDeviceCache + afEventFiredRef=false in THREE places (explicit signOut, SIGNED_OUT branch, AND defensive re-entry on SIGNED_OUT) |
| 7 | Label temporary | PASS | TRANSITIONAL env-missing guard has explicit exit condition ("Set EXPO_PUBLIC_APPSFLYER_*") |
| 8 | Subtract before adding | PASS | Old consumer-side upsert payload replaced in same commit as migration (drops old constraint) |
| 9 | No fabricated data | PASS | Events carry IDs only on client; revenue values come from Stripe-authoritative `paymentIntent.amount` / `payout.amount` on server |
| 10 | Currency-aware | PASS | S2S helper passes `af_currency` from Stripe `paymentIntent.currency` / `payout.currency` |
| 11 | One auth instance | PASS | No changes to auth instance pattern |
| 12 | Validate at right time | N/A | No datetime validation |
| 13 | Exclusion consistency | N/A | No generation/serving fork |
| 14 | Persisted-state startup | PASS | Init in `RootLayoutInner` runs after Zustand hydration; no Zustand dep in AppsFlyer service |

**Result:** 14/14 PASS or N/A. Zero constitutional violations.

---

## 6. Cross-Domain Impact Verification

| Surface | Verdict | Notes |
|---|---|---|
| Mingla Business mobile (iOS) | code-level PASS | Native build + TestFlight install required for runtime verification |
| Mingla Business mobile (Android) | code-level PASS | Native build + Play internal required for runtime verification |
| Mingla consumer (`app-mobile`) | PASS | Single-line consumer service update verified; pre-existing TS errors unrelated |
| Stripe webhook entry function | PASS | Imports from shared router; will pick up new code on next deploy. Deploy command provided in impl report §11 |
| Stripe webhook idempotency | PASS | Existing event-ID dedup at [stripe-webhook/index.ts:104](../../supabase/functions/stripe-webhook/index.ts#L104) handles webhook retries; new milestone gate adds first-ever semantics on top |
| Admin dashboard | N/A | AppsFlyer is mobile-only |
| Web (mingla-business web export) | PASS | `react-native-appsflyer` is gated by `Platform.OS` in usage; web path → no native module loaded; service no-ops gracefully |
| RLS policies | PASS | `appsflyer_devices` RLS unchanged (user-scoped); new `brand_appsflyer_milestones` table service-role only |

---

## 7. Cache Safety

- No React Query keys touched. No cache invalidation impact.
- No Zustand stores touched.
- In-memory dedup `registeredDeviceKeys` Set is process-local; cleared on signOut via `resetAppsFlyerDeviceCache()`. Verified.

---

## 8. Independent Verification I Ran

| Check | Result |
|---|---|
| `mingla-business npx tsc --noEmit` | PASS (exit 0) — verified independently |
| `node .github/scripts/strict-grep/orch-0808-appsflyer-devices-app-discriminator.mjs` clean against current code | PASS (exit 0) |
| Injected deliberate violation, re-ran gate | DETECTED (exit 1, correct violation message) — confirms gate is not a no-op |
| `app-mobile npx tsc --noEmit` | 3 pre-existing errors in unrelated files; ZERO new errors from ORCH-0808 changes |
| Forensic read: migration DDL | clean — idempotent `IF NOT EXISTS` guards, default backfills existing rows, self-verify probe |
| Forensic read: business `appsFlyerService.ts` (all 230 lines) | clean — env guards, identity gates, fire-and-forget contract honored |
| Forensic read: `AuthContext.tsx` diff | clean — bootstrap binds identity, SIGNED_IN fires first-event with milestone gate, SIGNED_OUT clears defensively, explicit signOut clears for symmetry |
| Forensic read: `appsFlyerS2S.ts` (all 250 lines) | clean — never throws, atomic claimBrandMilestone uses UPDATE-WHERE-NULL, S2S endpoint contract matches AppsFlyer spec (lowercase `authentication` header, JSON-stringified eventValue, UTC eventTime format) |
| Forensic read: `stripeWebhookRouter.ts` 3 integration sites | clean — all wrapped in try/catch, payloads include brand_id, revenue derived from Stripe authoritative amount |
| Webhook router caller pattern (event-ID dedup) | confirmed — `payment_webhook_events` table dedups by `stripe_event_id` at [stripe-webhook/index.ts:104](../../supabase/functions/stripe-webhook/index.ts#L104) |
| `creator_accounts.created_at` DEFAULT | confirmed `now()` NOT NULL at [baseline:8027](../../supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L8027) — first-time logic is sound |

---

## 9. Operator-Only Gates Required Before CLOSE

These were correctly identified by the implementor in their report §11 and §10 verification matrix. Restating for tracking:

1. **Apply migration:** `supabase db push --linked` (operator)
2. **Deno gates** (not run in this Claude session, parity rule §8):
   - `deno check supabase/functions/_shared/appsFlyerS2S.ts`
   - `deno check supabase/functions/_shared/stripeWebhookRouter.ts`
3. **Deploy edge function:** `supabase functions deploy stripe-webhook --project-ref gqnoajqerqhnvulmnyvv` (orchestrator owns per memory rule codified 2026-05-10)
4. **Native rebuild (BLOCKING for any install event):**
   - `cd mingla-business && eas build --platform ios --profile preview`
   - `cd mingla-business && eas build --platform android --profile preview`
5. **AppsFlyer dashboard smoke** after TestFlight install:
   - Verify install event fires with customer_user_id linked to Supabase user UUID
   - Verify `af_complete_registration` or `af_login` event in dashboard
   - Make one brand → verify `mingla_brand_created` event
   - Start Stripe connect → verify `mingla_stripe_connect_started`
   - (Skip first ticket / first payout S2S smoke until production money flow available)

These are pre-CLOSE gates, not pre-PASS gates. PASS verdict here is contingent on code correctness; operator runs the gates to actually deploy.

---

## 10. Discoveries for Orchestrator

The implementor already registered three side discoveries in their report §13:
- **ORCH-0809 candidate** (S2): consumer-side `signOut` does not clear AppsFlyer `customer_user_id`
- **ORCH-0810 candidate** (S3): no central env-presence validator for `EXPO_PUBLIC_*` instrumentation vars
- **ORCH-0811 candidate** (S2/S3): pre-existing app-mobile TS errors in ConnectionsPage + HomePage

I confirmed all three are real and add three more from my forensic pass:

- **ORCH-0812 candidate** (S2): Bootstrap-init race on warm restore (Finding #2 above) — AppsFlyer identity may not bind on cold-start-with-persisted-session if SDK init callback resolves after `supabase.auth.getSession()`. Fix: queue identity binds in the service until init completes.
- **ORCH-0813 candidate** (S3): CI workflow paths filter excludes `app-mobile/**` + `supabase/functions/**` (Finding #3 above) — future drift in those areas won't trigger the gate. Fix: add to workflow `paths:` filter.
- **ORCH-0814 candidate** (S3): Consumer-side AuthContext lacks first-event-ref reset on signOut — even after ORCH-0809 fixes Constitution #6, the AppsFlyer event-fire ref in `app-mobile/app/index.tsx:341` doesn't reset on signOut. Logging in as user B after user A would not re-fire af_login because the ref stays true. Less critical than ORCH-0809.

---

## 11. Rework Recommendations (if FAIL is chosen)

If operator chooses to send back rather than accept the deviation:

**Minimal rework for T-08 spec compliance:**
1. Add to the existing migration (`20260601000000_orch_0808_appsflyer_devices_app_discriminator.sql`):
   ```sql
   ALTER TABLE public.brand_appsflyer_milestones
     ADD COLUMN IF NOT EXISTS first_activated_at timestamptz;
   ```
2. Remove the `first_activated_at` rejection branch in [appsFlyerS2S.ts:222-232](../../supabase/functions/_shared/appsFlyerS2S.ts#L222) — let it use the same UPDATE-WHERE-NULL path as the other two columns.
3. In `syncAccount` ([stripeWebhookRouter.ts:216-241](../../supabase/functions/_shared/stripeWebhookRouter.ts#L216)), replace the transition gate with `claimBrandMilestone(supabase, brandId, 'first_activated_at')` — same pattern as the other two S2S call sites.

Estimated rework: ~15 minutes. Returns to PASS without conditional.

---

## 12. Working-Branch Discipline

All scoped changes are on branch `Seth` in `/Users/sethogieva/Desktop/mingla-main`. QA report written here. Global indexes (DECISION_LOG, INVARIANT_REGISTRY, etc.) NOT touched by this skill.

---

## 13. Final Verdict Summary

**CONDITIONAL PASS** — pending operator decision on the T-08 deviation (Finding #1) and operator-run native build + Deno gates + edge deploy.

**If operator accepts T-08 deviation:** straight to CLOSE via Codex `orchestrator-mingla` (or current Claude orchestrator session).

**If operator wants T-08 compliance:** ~15-minute rework loop via Claude `mingla-implementor` per §11.

I would personally lean toward **rework** — the helper already has the dead branch ready to be wired up, the migration is trivial to extend, and it brings semantics in line with the original spec without arguing the trade-off. But that's an operator call.

**END OF REPORT.**
