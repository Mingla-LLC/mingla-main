# SPEC ORCH-0953 — Stripe live-mode cutover

**Date:** 2026-05-24
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0953-[stripe-live-cutover]/`
**Branch:** `ORCH-0953-stripe-live-cutover`
**Author:** Claude `mingla-forensics` (SPEC mode)
**Investigation source:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0953_STRIPE_LIVE_CUTOVER_AUDIT.md`](../reports/INVESTIGATION_ORCH-0953_STRIPE_LIVE_CUTOVER_AUDIT.md)
**Dispatch source:** [`Mingla_Artifacts/prompts/SPEC_DISPATCH_ORCH-0953_STRIPE_LIVE_CUTOVER.md`](../prompts/SPEC_DISPATCH_ORCH-0953_STRIPE_LIVE_CUTOVER.md)
**Confidence:** High — every contract below cites a six-field investigation finding or a confirmed code site at file:line.

---

## §1 Scope statement

### What this SPEC ships (IMPLEMENT lane)
Nine bounded code/config contracts (§3.1–3.9) that close every code-side NO-GO finding from the investigation. Together they remove all silent test-mode fallbacks in production builds, complete the webhook router contract for dispute and refund lifecycle events, persist disputes to a new table, align native URL schemes against PaymentSheet return URLs, gate native paid checkout against the tax-deferral gap, and add operator alerting hooks for dispute creation and webhook signature failure.

### What this SPEC documents but does NOT ship (OPERATOR lane)
The full Phase A–E Stripe Dashboard + Supabase secrets activation checklist (§4) is operator-owned. The IMPLEMENT lane assumes operator completes Phase A–E in parallel with implementation and BEFORE TEST. No code in this SPEC writes secrets, mutates Stripe Dashboard state, or runs against live mode.

### Explicit non-goals (deferred to future ORCHs)
- Implementing native Stripe Tax (Investigation F-8) — gated, not built, by §3.8.
- Re-onboarding existing connected accounts to a different controller shape — DEC-156 platform-liable Express stays locked in per §10.
- Replacing the `STRIPE_SECRET_KEY` exception in `brand-stripe-tax-dashboard-link` — kept as the single accepted full-key surface; documented in §4 and the evidence pack.
- Cleaning up `STRIPE_RAK_TAX_DASHBOARD_LINK` legacy secret — operator marks for deletion at Phase B but no code change; investigation confirmed it is unused.
- Hardening IP-allowlist for the webhook endpoint from soft-fail to fail-closed (Investigation F-5) — operator decision deferred (see Open Question OQ-13 resolution below: stays monitoring-only for launch; alerting added in §3.10).

### Assumptions
- Operator confirms the same Stripe account `acct_1TTnt1PjlZyAYA40` ("MINGLA LLC sandbox") will be the activated-to-live target account, OR identifies a different live Mingla LLC business account at Phase A — see OQ-1 resolution and gate in §4.
- The Supabase production project ref remains `gqnoajqerqhnvulmnyvv`.
- The Supabase edge-function egress IP range (needed for live RAK IP allowlists in Phase B) is operator-discoverable at Phase B time; SPEC does not block on it.

---

## §2 Resolved open questions

Each of the 15 open questions from the investigation report is resolved below as one of:
- **ANSWERED** — answered from the Phase A–E operator memo or from DEC-156 / DEC-154.
- **OPERATOR DECISION** — operator must answer before IMPLEMENT begins; SPEC marks the gate.
- **DEFERRED** — explicit non-goal; documented for future ORCH.

| # | Question (summary) | Resolution |
|---|---|---|
| OQ-1 | Which Stripe account is the intended live target? | **OPERATOR DECISION** at Phase A.1. SPEC assumes `acct_1TTnt1PjlZyAYA40` activates to live unless operator names a separate Mingla LLC business account. If different, every Supabase live secret is created against the new account; the redacted evidence pack (§5) confirms account identity. **Gate:** IMPLEMENT may begin without the answer (code changes are account-agnostic), but Phase B operator work cannot start until OQ-1 is answered. |
| OQ-2 | Accept platform-liable Express for live (DEC-156)? | **ANSWERED — YES, locked.** DEC-156 superseded DEC-154 (5) on 2026-05-15 for live ticket sales. This SPEC locks the platform-liable Express controller for live per §10's proposed new DEC. Operator may revert by opening a new ORCH that re-onboards all connected accounts. |
| OQ-3 | Allow `STRIPE_SECRET_KEY` fallback in `_shared/stripeBlueprintClient.ts`? | **ANSWERED — NO.** §3.1 removes the fallback in production builds. The full-secret-key path remains permitted only in `brand-stripe-tax-dashboard-link` per Investigation F-2 accepted-exception note. |
| OQ-4 | Live webhook endpoints already exist + correct events? | **OPERATOR DECISION** at Phase C. SPEC mandates the exact event subscription matrix at §4 Phase C and verifies via evidence pack (§5). If endpoints exist, operator either edits subscriptions or recreates per §4. |
| OQ-5 | Implement / no-op / unsubscribe `charge.succeeded`, `charge.failed`, `payment_intent.processing`? | **ANSWERED — UNSUBSCRIBE.** Per §4 Phase C, live endpoints do NOT subscribe to these three events. Router stays unchanged (it already silently audits unknown events at its default branch — verified at `_shared/stripeWebhookRouter.ts:30-61`). Investigation F-4 noisy-but-not-harmful concern is resolved by not subscribing. |
| OQ-6 | Live dispute operating model? | **ANSWERED.** §3.3 ships: new `stripe_disputes` table, router handlers for `charge.dispute.created` + `charge.dispute.updated` + `charge.dispute.closed`, operator alert via `dispatchNotification`. Admin UI is **DEFERRED** to a follow-up ORCH; for launch, operator monitors via Stripe Dashboard + alert. |
| OQ-7 | Enable native paid checkout before native Stripe Tax exists? | **ANSWERED — CONDITIONAL.** §3.8 ships a config-driven gate `NATIVE_PAID_ALLOWED_REGIONS` (env-controlled allowlist). For launch, operator sets the allowlist to non-tax-collecting regions OR explicitly accepts the tax gap for tested regions. Native Stripe Tax stays **DEFERRED**. |
| OQ-8 | Does production mingla-business EAS build register `com.sethogieva.minglabusiness://stripe-redirect`? | **OPERATOR VERIFICATION** at Phase D. §3.5 leaves the existing scheme intact (deliberate per `nativeCheckoutFlow.native.ts:100-110` comment + Apple Pay processing cert is on `merchant.com.sethogieva.minglabusiness`). SPEC adds an explicit Android intent filter (§3.5) and a Maestro/EAS production-build smoke test at §6 to verify deep-link resolution. |
| OQ-9 | Does production consumer Android build resolve `com.mingla.app.v2://stripe-redirect`? | **ANSWERED — ADD INTENT FILTER.** §3.6 adds an explicit Android custom-scheme intent filter (currently only HTTPS app links per `app.json:44-75`). Verified at §6 by a production-like Android build + Maestro deep-link test. |
| OQ-10 | Apple Pay merchant IDs enrolled in live with processing certs? | **OPERATOR ACTION** at Phase D. Two merchant IDs: `merchant.com.mingla.app.v2` (consumer) and `merchant.com.sethogieva.minglabusiness` (business — note: NOT `merchant.com.mingla.business.v2` as the dispatch incorrectly listed; corrected here per `nativeCheckoutFlow.native.ts:109` operator-observed-live comment 2026-05-16). Evidence pack §5 confirms enrollment screenshots (redacted). |
| OQ-11 | Google Pay configured for production for both apps? | **ANSWERED — FIX.** §3.7 removes the `testEnv: __DEV__` gate in both apps so production builds run Google Pay in production env. |
| OQ-12 | Remove or guard `pk_test_` fallback in mingla-business? | **ANSWERED — GUARD.** §3.2 keeps the fallback for non-production builds (deliberate per `app.config.ts:79-87` Cycle B2a V3 SPEC §13 A2 reference), throws at module load if production build has no `pk_live_` value. |
| OQ-13 | Live connected accounts already exist + 1:1 brand mapping? | **OPERATOR VERIFICATION** at Phase E. §3.9 ships a read-only reconciliation SQL probe. Operator runs it after Phase A activation and BEFORE any live sale. PASS = every active live Stripe connected account maps to exactly one `public.stripe_connect_accounts.stripe_account_id`. |
| OQ-14 | Live platform statement descriptor + support email/URL configured? | **OPERATOR ACTION** at Phase A. Evidence pack §5 confirms presence (redacted). |
| OQ-15 | First-live-sale runbook owner? | **OPERATOR-OWNED** runbook drafted at §9 (rollback plan). Operator owns the first-10-live-sale monitoring window. |

**IMPLEMENT lane is unblocked.** OQ-1, OQ-4, OQ-8, OQ-10, OQ-13, OQ-14, OQ-15 are operator decisions/actions that run in parallel with IMPLEMENT and are gated at the OPERATOR lane (§4) and evidence pack (§5) before TEST.

---

## §2.5 Cross-Surface Impact

| Surface | In scope? | What this SPEC demands on the surface | Files touched | Parity |
|---|---|---|---|---|
| **Consumer iOS** (`app-mobile/` on iOS) | YES | Google Pay in production env (no `__DEV__` gate); Apple Pay live enrollment via operator; native paid checkout subject to region gate; live publishable key returned by `ticket-checkout-create` | `app-mobile/app/_layout.tsx`, `ticket-checkout-create` (no code change — env only) | Manual parity with Android (separate SC-3-iOS / SC-3-Android) |
| **Consumer Android** (`app-mobile/` on Android) | YES | Google Pay production env; explicit custom-scheme intent filter for `com.mingla.app.v2://stripe-redirect`; same region gate | `app-mobile/app.json` (intent filters), `app-mobile/app/_layout.tsx` | Manual parity with iOS |
| **Buyer/anonymous Web** (`mingla-business/` `/checkout/{eventId}`, `/e/...`, `/b/...`) | YES | Live `pk_live_…` publishable key required at module load in production builds (fail-close); hosted Checkout depends on `checkout.session.completed` subscription (§4 Phase C) | `mingla-business/app.config.ts` (fail-close), webhook subscriptions (operator) | Automatic (shared edge function) |
| **Business iOS** (`mingla-business/` on iOS) | YES | URL scheme verification only (no change to `com.sethogieva.minglabusiness` per Apple Pay cert constraint); Google Pay production env | `mingla-business/app.config.ts` (verify), `mingla-business/src/payments/nativeCheckoutFlow.native.ts` (no scheme change) | Manual parity with Android |
| **Business Android** (`mingla-business/` on Android) | YES | Explicit custom-scheme intent filter for `com.sethogieva.minglabusiness://stripe-redirect`; Google Pay production env | `mingla-business/app.json` (intent filters) | Manual parity with iOS |
| **Admin Web** (`mingla-admin/`) | NO | Admin does not render Stripe checkout, dispute UI, or refund UI — no admin code path touches live keys. Future dispute admin UI is a separate ORCH (OQ-6 deferred). | none | n/a |
| **Business Web preview** (`mingla-business/` dev/web build) | NO — non-production builds keep `pk_test_` fallback | Non-production EAS profiles retain the test-fallback behavior. Only `EAS_BUILD_PROFILE === "production"` triggers fail-close. | none beyond §3.2 | n/a |

**Backend / edge functions (cross-cutting, all surfaces):**
- `_shared/stripeBlueprintClient.ts` — fail-close onboarding RAK (§3.1).
- `_shared/stripeWebhookRouter.ts` — dispute event handlers (§3.3).
- New migration `stripe_disputes` table (§3.3).
- New env vars: `NATIVE_PAID_ALLOWED_REGIONS` (§3.8), `STRIPE_DISPUTE_ALERT_USERS` (§3.3).
- All surfaces depend on operator-completed Phase A–E (§4) before TEST.

---

## §3 IMPLEMENT lane — code + config contracts

Each contract is bounded. Each names file paths, before/after behavior, success criteria, and the regression-test path the implementor lands.

### §3.1 Fail-close `_shared/stripeBlueprintClient.ts` onboarding RAK

**Files:** `supabase/functions/_shared/stripeBlueprintClient.ts`
**Lines:** 109-110, 166-167

**Before:**
```ts
envVarNames: ["STRIPE_RAK_ONBOARD", "STRIPE_SECRET_KEY"],
```

**After:**
```ts
envVarNames: ["STRIPE_RAK_ONBOARD"],
```

Both occurrences (`createRecipientAccount` line 110, `createRecipientAccountLink` line 167). No additional code changes — the existing `stripeBlueprintRequest` helper throws on the first missing env var name, which now becomes the desired fail-closed behavior when `STRIPE_RAK_ONBOARD` is absent or empty in production.

**Success criterion:** SC-1 — Onboarding edge functions fail-close at boot with explicit "STRIPE_RAK_ONBOARD is required" error when the RAK is missing; no silent fallback to `STRIPE_SECRET_KEY`.

**Regression test path:** `supabase/functions/_shared/__tests__/stripeBlueprintClient_failclose.test.ts` — Deno test that unsets `STRIPE_RAK_ONBOARD`, asserts the request throws with a recognizable error message, and asserts the error does NOT mention `STRIPE_SECRET_KEY` (no fallback hint leaking).

**Fails-on-revert verification:** the test passes with the SPEC change and fails when lines 110/167 are reverted to `["STRIPE_RAK_ONBOARD", "STRIPE_SECRET_KEY"]`. Implementor records the commit hash of both states in the implementation report per ORCH-0840.

---

### §3.2 Fail-close mingla-business publishable key in production builds

**File:** `mingla-business/app.config.ts`
**Lines:** 79-87

**Before:** Hardcoded `pk_test_51TTnt1PjlZyAYA40…` fallback for any build profile.

**After:**
```ts
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: (() => {
  const fromEnv = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const buildProfile = process.env.EAS_BUILD_PROFILE; // "production" | "preview" | "development" | undefined
  if (buildProfile === "production") {
    if (!fromEnv || !fromEnv.startsWith("pk_live_")) {
      throw new Error(
        "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY must be a pk_live_… value for production builds. Set it in EAS env."
      );
    }
    return fromEnv;
  }
  // Non-production builds: env if present, else sandbox fallback (deliberate per Cycle B2a Path C V3 SPEC §13 A2).
  return fromEnv ?? "pk_test_51TTnt1PjlZyAYA40f3kjmxF6uXjfEJKfFR25LiJpVqd7qw6TYfDqqKLcNamL3JGlD2vxh94Bzn4ciaqsMNN1PJ0C00oZVosOxd";
})(),
```

The existing inline comment block (lines 79-84) is preserved and amended to note the fail-close.

**Success criterion:** SC-2 — `EAS_BUILD_PROFILE === "production"` + missing or non-`pk_live_` `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` throws at config eval; non-production builds keep the existing fallback behavior.

**Regression test path:** `mingla-business/src/__tests__/appConfig_pkLiveFailClose.test.ts` — Jest test that sets `process.env.EAS_BUILD_PROFILE = "production"`, unsets `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`, requires `app.config.ts`, asserts throws with `pk_live_` in the error message; a second case sets `EAS_BUILD_PROFILE = "development"` and asserts the sandbox fallback returns; a third case sets production + a `pk_test_…` value and asserts throws.

**Fails-on-revert verification:** test fails when the production-profile gate is removed.

---

### §3.3 Webhook router: dispute lifecycle handlers + `stripe_disputes` persistence

**Files:**
- `supabase/migrations/<timestamp>_create_stripe_disputes.sql` (new)
- `supabase/functions/_shared/stripeWebhookRouter.ts`
- `supabase/functions/_shared/stripeDisputeHandlers.ts` (new — pattern mirrors `_shared/installmentWebhookHandlers.ts`)
- `supabase/functions/_shared/__tests__/stripeDisputeHandlers.test.ts` (new)

**Migration contract:**

```sql
CREATE TABLE public.stripe_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_dispute_id text NOT NULL UNIQUE,
  stripe_charge_id text NOT NULL,
  stripe_payment_intent_id text,
  stripe_account_id text NOT NULL, -- connected account
  brand_id uuid REFERENCES public.brands(id),
  order_id uuid REFERENCES public.orders(id),
  amount integer NOT NULL, -- minor units
  currency text NOT NULL,
  status text NOT NULL, -- 'warning_needs_response' | 'warning_under_review' | 'warning_closed' | 'needs_response' | 'under_review' | 'won' | 'lost'
  reason text NOT NULL,
  evidence_due_by timestamptz,
  is_charge_refundable boolean NOT NULL DEFAULT false,
  raw_event jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_stripe_disputes_brand_id ON public.stripe_disputes(brand_id);
CREATE INDEX idx_stripe_disputes_order_id ON public.stripe_disputes(order_id);
CREATE INDEX idx_stripe_disputes_status ON public.stripe_disputes(status);

ALTER TABLE public.stripe_disputes ENABLE ROW LEVEL SECURITY;

-- Service role full access (edge functions use service role).
CREATE POLICY "service_role_all_stripe_disputes"
  ON public.stripe_disputes FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Brand payment managers read-only access to their brand's disputes.
CREATE POLICY "brand_payment_managers_select_stripe_disputes"
  ON public.stripe_disputes FOR SELECT TO authenticated
  USING (
    brand_id IN (
      SELECT brand_id FROM public.brand_memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'payment_manager')
    )
  );
```

**Router contract additions to `STRIPE_ROUTED_EVENT_TYPES` (after line 60, before closing `] as const`):**

```ts
  // ORCH-0953: dispute lifecycle — platform-liable Express direct-charge model
  // (DEC-156) requires explicit dispute observability. Persisted to
  // public.stripe_disputes by handlers in _shared/stripeDisputeHandlers.ts.
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
```

**Router switch additions** (in `routeStripeEvent`, before the default branch):

```ts
case "charge.dispute.created":
case "charge.dispute.updated":
case "charge.dispute.closed":
  return await handleChargeDispute(supabase, event);
```

`handleChargeDispute` implementation in `_shared/stripeDisputeHandlers.ts`:
- Upsert into `stripe_disputes` keyed by `stripe_dispute_id`.
- Resolve `brand_id` via lookup on `stripe_connect_accounts.stripe_account_id`.
- Resolve `order_id` via lookup on `orders.stripe_charge_id` or `orders.stripe_payment_intent_id`.
- On `charge.dispute.created`: call `dispatchNotification` with operator alert payload (recipients from new env `STRIPE_DISPUTE_ALERT_USERS` — comma-separated user IDs) AND post AppsFlyer S2S event `dispute_created` per existing `postAppsFlyerS2SEvent` pattern.
- On `charge.dispute.closed` with `status='lost'`: post AppsFlyer S2S `dispute_lost`.
- Idempotent across re-deliveries (upsert on `stripe_dispute_id`).

**Success criteria:**
- SC-3 — `stripe_disputes` table exists post-migration with the schema above, RLS enabled, both policies present.
- SC-4 — `STRIPE_ROUTED_EVENT_TYPES` contains all three dispute event types.
- SC-5 — Sending a synthetic `charge.dispute.created` event to `stripe-webhook` inserts one row in `stripe_disputes` AND triggers a `dispatchNotification` call with the recipient set from `STRIPE_DISPUTE_ALERT_USERS`.
- SC-6 — Re-sending the same event ID is idempotent (one row, upserted).

**Regression test path:** `supabase/functions/_shared/__tests__/stripeDisputeHandlers.test.ts` — Deno test with: (a) happy-path `charge.dispute.created` produces one row + notification dispatched (mocked); (b) idempotency test re-sends same event, asserts one row; (c) `charge.dispute.closed` with `status='lost'` triggers AppsFlyer post (mocked); (d) missing `STRIPE_DISPUTE_ALERT_USERS` env logs warning but does not throw.

**Fails-on-revert:** removing the case arms in the router switch causes SC-5 test to fail.

---

### §3.4 Webhook router: no implementation for `charge.succeeded` / `charge.failed` / `payment_intent.processing`

**File:** `supabase/functions/_shared/stripeWebhookRouter.ts`
**Change:** none in code.
**Change in operator action:** §4 Phase C live webhook endpoints DO NOT subscribe to these three events. The router's default branch (`_shared/stripeWebhookRouter.ts:~520+`, the default `case` that audits unknown events without domain mutation) continues to handle any incidental delivery without harm.

**Rationale:** Investigation F-4 documented these as "stored but not meaningfully handled" in test mode. Operator decision (OQ-5): no domain meaning needed for these in launch; remove from live subscriptions to eliminate noise.

**Documentation:** Add inline comment block to `STRIPE_ROUTED_EVENT_TYPES` array (immediately above the dispute additions) stating:

```ts
  // ORCH-0953: charge.succeeded, charge.failed, and payment_intent.processing
  // are NOT routed and live webhook endpoints do NOT subscribe to them. The
  // direct-charge model surfaces success/failure via payment_intent.succeeded /
  // payment_intent.payment_failed. Delayed-payment methods are out of Phase 1
  // scope (see DEC-158 — only card/link/apple_pay/google_pay enabled).
```

**Success criterion:** SC-7 — Live platform + Connect webhook endpoints (per §4 Phase C event lists) do NOT include these three events. Verified in evidence pack (§5).

**Regression test path:** `supabase/functions/_shared/__tests__/stripeWebhookRouter_eventList.test.ts` — Deno test asserts `STRIPE_ROUTED_EVENT_TYPES` does NOT contain `charge.succeeded`, `charge.failed`, or `payment_intent.processing`. (Protects against future re-additions without explicit ORCH approval.)

---

### §3.5 Business-app URL scheme — verify, do not change

**Files:** `mingla-business/app.config.ts:38`, `mingla-business/app.json`, `mingla-business/src/payments/nativeCheckoutFlow.native.ts:109-110`
**Change:** none to existing scheme values. The `com.sethogieva.minglabusiness` scheme is deliberate per the operator-observed-live comment at `nativeCheckoutFlow.native.ts:100-110` (Apple Pay processing cert is on `merchant.com.sethogieva.minglabusiness`, breaking that breaks Apple Pay at sheet-confirm).

**What changes:** Add an explicit Android `intentFilter` entry for `com.sethogieva.minglabusiness://stripe-redirect` to `mingla-business/app.json` Android intent filters block. The current block (per investigation F-10) does not declare the custom scheme explicitly. Expo's generated manifest may or may not include it from top-level `scheme: "mingla-business"` alone; explicit declaration removes the ambiguity.

**`mingla-business/app.json` Android intent filters block additions:**

```json
{
  "action": "VIEW",
  "data": [
    { "scheme": "com.sethogieva.minglabusiness" }
  ],
  "category": ["BROWSABLE", "DEFAULT"]
}
```

**Success criterion:** SC-8 — Production EAS build of mingla-business on Android resolves `com.sethogieva.minglabusiness://stripe-redirect` to the app (verified at §6 by Maestro deep-link smoke).

**Regression test path:** `mingla-business/__tests__/intentFilters_stripeReturnScheme.test.ts` — Jest test that reads `app.json`, asserts the intent filter block contains an entry with `scheme: "com.sethogieva.minglabusiness"`. (Static manifest assertion; live deep-link is a §6 smoke test.)

---

### §3.6 Consumer Android explicit custom-scheme intent filter

**File:** `app-mobile/app.json`
**Lines:** 44-75 (Android `intentFilters` block)

**Change:** Add an explicit `intentFilter` for `com.mingla.app.v2://stripe-redirect`:

```json
{
  "action": "VIEW",
  "data": [
    { "scheme": "com.mingla.app.v2" }
  ],
  "category": ["BROWSABLE", "DEFAULT"]
}
```

Place alongside the existing HTTPS app-link filters (do not replace them).

**Success criterion:** SC-9 — Production EAS build of app-mobile on Android resolves `com.mingla.app.v2://stripe-redirect` to the app.

**Regression test path:** `app-mobile/__tests__/intentFilters_stripeReturnScheme.test.ts` — same shape as §3.5.

---

### §3.7 Google Pay — production env in both apps

**Files:**
- `app-mobile/app/_layout.tsx` (consumer `StripeNativeProvider` mount)
- `mingla-business/app/_layout.tsx` (business `StripeNativeProvider` mount)
- `app-mobile/src/payments/nativeCheckoutFlow.ts` (anywhere `testEnv` is passed to `initPaymentSheet`)
- `mingla-business/src/payments/nativeCheckoutFlow.native.ts` (same)

**Before:**
```ts
googlePay: { merchantCountryCode: "US", testEnv: __DEV__ }
```

**After:**
```ts
googlePay: {
  merchantCountryCode: "US",
  testEnv: process.env.EAS_BUILD_PROFILE !== "production",
}
```

Note: prefer `process.env.EAS_BUILD_PROFILE !== "production"` over `__DEV__` because `__DEV__` is React Native's debug-bundle flag, which is FALSE for both `preview` and `production` EAS profiles — so the current code already runs Google Pay in production env for production builds. **Implementor verifies this assumption against the live runtime behavior in evidence pack (§5).** If `__DEV__` already evaluates to `false` in production builds (most likely case), the change is mechanical-only with no behavior delta but still hardens the contract by binding to EAS profile explicitly.

**Success criterion:** SC-10 — Production builds use `testEnv: false` for Google Pay; non-production builds use `testEnv: true`. Verified in code (test) and at runtime in §6 Google Pay smoke.

**Regression test path:** `app-mobile/__tests__/googlePay_testEnvProductionGate.test.ts` + `mingla-business/__tests__/googlePay_testEnvProductionGate.test.ts` — Jest tests with `EAS_BUILD_PROFILE` mocked, assert the testEnv expression evaluates correctly per environment.

---

### §3.8 Native paid-flow region gate (Stripe Tax deferral)

**Files:**
- `supabase/functions/ticket-checkout-create/index.ts` (where `surface === "mobile-app"` is handled, per investigation F-8 cite at lines 756-762)
- `supabase/functions/_shared/stripeTax.ts` (new — pattern mirrors `stripePaymentMethods.ts`)

**`_shared/stripeTax.ts` contract:**

```ts
// ORCH-0953 §3.8: Native paid checkout does not run Stripe Tax (DEC-158 native scope).
// Operator gates which regions are allowed to take native paid via env allowlist.
// Empty allowlist = native paid is disabled entirely (web Checkout fallback for taxable buyers).
export const NATIVE_PAID_ALLOWED_REGIONS_ENV = "NATIVE_PAID_ALLOWED_REGIONS";

export function getNativePaidAllowedRegions(): readonly string[] {
  const raw = Deno.env.get(NATIVE_PAID_ALLOWED_REGIONS_ENV) ?? "";
  return raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
}

export function isNativePaidAllowedForBrand(brandCountry: string | null | undefined): boolean {
  const allowed = getNativePaidAllowedRegions();
  if (allowed.length === 0) return false;
  return allowed.includes((brandCountry ?? "").toUpperCase());
}
```

**`ticket-checkout-create/index.ts` change:** at the start of the native-PaymentSheet branch (where `surface === "mobile-app"` is detected), call `isNativePaidAllowedForBrand(brand.country)`. If false, return HTTP 400 with body `{ error: "native_paid_not_allowed_in_region", retryWithSurface: "web" }`. The mobile app's existing edge-function-error extractor already surfaces server error strings — implementor adds a copy line to the native checkout flow file that recognizes this error code and surfaces a toast directing the buyer to "Pay on the web" (handing them the buyer-web URL for the same event).

**Success criteria:**
- SC-11 — Native checkout returns HTTP 400 with `error: "native_paid_not_allowed_in_region"` when brand country is not in `NATIVE_PAID_ALLOWED_REGIONS`.
- SC-12 — Empty `NATIVE_PAID_ALLOWED_REGIONS` env disables native paid entirely (every brand returns the 400).
- SC-13 — Brand country in the allowlist proceeds to PaymentIntent creation (existing happy path unchanged).
- SC-14 — Mobile UI surfaces a toast pointing to the web URL when the 400 fires (consumer + business).

**Regression test paths:**
- `supabase/functions/ticket-checkout-create/__tests__/nativePaidRegionGate.test.ts` — Deno test: empty env returns 400 for any country; allowlist `"US,GB"` returns 400 for `"FR"` brand, succeeds for `"US"` brand.
- `app-mobile/src/payments/__tests__/nativeCheckoutFlow_regionGateToast.test.tsx` + `mingla-business/src/payments/__tests__/nativeCheckoutFlow_regionGateToast.test.tsx` — RTL tests that mock the edge response to return the 400, assert the toast renders with the web-fallback CTA.

---

### §3.9 Connect inventory reconciliation SQL probe

**Files:**
- `scripts/orch-0953/connect_inventory_reconciliation.sql` (new, read-only)
- `scripts/orch-0953/README.md` (new, runbook)

**SQL probe contract:** read-only SELECT comparing live Stripe connected accounts to `public.stripe_connect_accounts`. Operator runs it AFTER Phase A activation, BEFORE first live sale.

```sql
-- ORCH-0953 §3.9: Connect inventory reconciliation probe.
-- Run as service role. Read-only. No mutations.
-- Operator manually fetches the live connected-account list from Stripe Dashboard
-- (Connect → Accounts, filter by live) and inserts into a temp table _live_stripe_accounts(stripe_account_id text)
-- BEFORE running this query. The query then produces three result sets:

-- (A) Mingla rows with NO matching live Stripe account (orphan in Supabase)
SELECT s.stripe_account_id, s.brand_id, b.name AS brand_name, s.charges_enabled, s.payouts_enabled, s.detached_at
FROM public.stripe_connect_accounts s
LEFT JOIN public.brands b ON b.id = s.brand_id
LEFT JOIN _live_stripe_accounts l ON l.stripe_account_id = s.stripe_account_id
WHERE l.stripe_account_id IS NULL AND s.detached_at IS NULL;

-- (B) Live Stripe accounts with NO Mingla row (orphan in Stripe)
SELECT l.stripe_account_id
FROM _live_stripe_accounts l
LEFT JOIN public.stripe_connect_accounts s ON s.stripe_account_id = l.stripe_account_id AND s.detached_at IS NULL
WHERE s.stripe_account_id IS NULL;

-- (C) Multi-brand mapping: any stripe_account_id mapped to >1 active brand row
SELECT stripe_account_id, COUNT(*) AS active_rows
FROM public.stripe_connect_accounts
WHERE detached_at IS NULL
GROUP BY stripe_account_id
HAVING COUNT(*) > 1;
```

**Success criterion:** SC-15 — Operator runs the probe post-Phase-A; all three result sets return zero rows BEFORE any live sale. Evidence pack §5 includes the three result counts.

**Regression test path:** `scripts/orch-0953/__tests__/reconciliation_query_shape.test.ts` — Jest test that parses the SQL file and asserts it contains only SELECT statements (no INSERT/UPDATE/DELETE/DROP/ALTER) using a simple regex; codifies the read-only contract.

---

### §3.10 Operator alerting hooks

**Files:**
- `supabase/functions/_shared/stripeDisputeHandlers.ts` (per §3.3 — already includes the dispute-created alert).
- `supabase/functions/stripe-webhook/index.ts` — add an alert hook on signature-verification failure rate (existing audit at lines 66-86 logs but does not alert).

**Signature-failure alert contract:** at `stripe-webhook/index.ts` after the existing signature-failure audit write (around lines 48-60 where `verifyStripeWebhookSignature` returns invalid), if the env `STRIPE_WEBHOOK_FAILURE_ALERT_USERS` is set, call `dispatchNotification` with payload `{ type: "stripe_webhook_signature_failure", event_id: rawHeaders["stripe-signature"]?.slice(0, 20) ?? null }`. Soft-fail rate is monitoring-only (no fail-close per OQ-13 resolution); alert provides operator visibility.

**Payment-failure spike:** out of scope for this SPEC — operator uses Stripe Dashboard alerts for `payment_intent.payment_failed` rate spikes (configurable in Dashboard).

**Success criteria:**
- SC-16 — A simulated invalid-signature webhook to `stripe-webhook` triggers one `dispatchNotification` call with `STRIPE_WEBHOOK_FAILURE_ALERT_USERS` recipients (when env is set).
- SC-17 — Missing `STRIPE_WEBHOOK_FAILURE_ALERT_USERS` env results in no notification call, no throw.

**Regression test path:** `supabase/functions/stripe-webhook/__tests__/signatureFailureAlert.test.ts` — Deno test.

---

## §4 OPERATOR lane — Stripe Dashboard + Supabase secrets checklist

This checklist is operator-owned. The operator runs it AFTER IMPLEMENT merges to `main` and BEFORE TEST dispatch. The implementor does NOT execute any of these steps.

### Phase A — Stripe Dashboard activation

- [ ] **A.1** Confirm live target account: same `acct_1TTnt1PjlZyAYA40` ("MINGLA LLC sandbox") flipped to live, OR record alternative live Mingla LLC account ID here: `_______________`. (Resolves OQ-1.)
- [ ] **A.2** Activate live mode on the target Stripe account: legal business name, EIN/SSN, bank account, statement descriptor + prefix (`MINGLA*`), support email, support URL, ToS URL.
- [ ] **A.3** Enable Connect in live mode. Re-fill platform profile: name, brand color, logo, support contact.
- [ ] **A.4** Set Connect OAuth redirect URI to the live URL (must match what the onboarding edge function uses).
- [ ] **A.5** Confirm Connect controller model for live: platform-liable Express per DEC-156 + new DEC in §10. (No further action — `stripeBlueprintClient.ts` already creates accounts with this shape.)
- [ ] **A.6** Configure payout schedule on platform + default for connected accounts (recommended: daily for platform, manual for connected — operator confirms in evidence pack).
- [ ] **A.7** Enable Radar rules in live mode (minimum: block high-risk, CVC fail, ZIP fail).
- [ ] **A.8** Require authenticator-app/passkey 2FA for all team members; remove SMS 2FA.

### Phase B — Supabase live secrets (operator creates Stripe keys + writes Supabase secrets)

The operator creates each live key in Stripe Dashboard (Developers → API keys → Restricted keys → +Create restricted key), assigns the permission set named below, applies an IP allowlist to the Supabase edge-function egress range (looked up at operation time), and writes to Supabase via `supabase secrets set --project-ref gqnoajqerqhnvulmnyvv KEY="rk_live_..."`.

| Supabase env var | Stripe key type | Least-privilege permissions | Consumer functions |
|---|---|---|---|
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_…` | n/a (public) | returned by `ticket-checkout-create`; also read by mingla-business buyer-web (`app.config.ts` per §3.2) |
| `STRIPE_RAK_TICKET_CHECKOUT` | `rk_live_…` | PaymentIntents: write · Checkout Sessions: write · Customers: write · Customer balance transactions: write · Ephemeral keys: write · Setup intents: write · Connect: read accounts | `ticket-checkout-create`, installment PI creation |
| `STRIPE_RAK_TICKET_REFUND` | `rk_live_…` | Refunds: write · Application fees: write (refund) · Charges: read · PaymentIntents: read · Connect: read accounts | `refund-order`, `cancel-trip-booking` |
| `STRIPE_RAK_ONBOARD` | `rk_live_…` | Accounts v2: write · Account links: write · Persons: write · Account sessions: write · Connect: read accounts · Capabilities: read | `brand-stripe-onboard`, `_shared/stripeBlueprintClient.ts` |
| `STRIPE_RAK_REFRESH_STATUS` | `rk_live_…` | Connect: read accounts · Capabilities: read | account status refresh |
| `STRIPE_RAK_DETACH` | `rk_live_…` | Connect: write accounts (delete/detach only) | account detach |
| `STRIPE_RAK_BALANCES` | `rk_live_…` | Balance: read (connected) | balance retrieval |
| `STRIPE_RAK_KYC_REMINDER` | `rk_live_…` | Connect: read accounts · Capabilities: read | KYC stall reminder |
| `STRIPE_RAK_WEBHOOK` | `rk_live_…` | Webhook endpoints: read · Events: read · PaymentIntents: read · Refunds: read · Disputes: read · Connect: read accounts | `stripe-webhook` router-side reads (verification uses webhook secret, not the RAK) |
| `STRIPE_SECRET_KEY` | `sk_live_…` | full key (single accepted exception) | `brand-stripe-tax-dashboard-link` only (`accounts.createLoginLink` requires full key — Investigation F-2 accepted exception) |
| `STRIPE_WEBHOOK_SECRET_PLATFORM` | live webhook signing secret | n/a (HMAC) | `stripe-webhook` (platform endpoint) |
| `STRIPE_WEBHOOK_SECRET` | live webhook signing secret | n/a (HMAC) | `stripe-webhook` (Connect endpoint) |
| `STRIPE_WEBHOOK_SECRET_PREVIOUS` | empty at activation | n/a | rotation slot |
| `NATIVE_PAID_ALLOWED_REGIONS` | comma-separated country codes (§3.8) | n/a | `ticket-checkout-create` native gate |
| `STRIPE_DISPUTE_ALERT_USERS` | comma-separated Supabase user UUIDs | n/a | `stripe-webhook` (dispute handler §3.3) |
| `STRIPE_WEBHOOK_FAILURE_ALERT_USERS` | comma-separated Supabase user UUIDs | n/a | `stripe-webhook` (signature-failure alert §3.10) |

Mark for deletion (Phase B closure):
- [ ] **B.X1** `STRIPE_RAK_TAX_DASHBOARD_LINK` — Supabase secret + (if exists) Stripe key. Confirmed unused by investigation.

### Phase C — Live webhook endpoints

Create two endpoints in Stripe Dashboard (Developers → Webhooks → +Add endpoint), both pointing at the Supabase `stripe-webhook` edge function URL (`https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/stripe-webhook`), both with API version pinned to `2026-04-22.dahlia`.

- [ ] **C.1 — Platform endpoint** subscribes to:
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `payment_intent.canceled`
  - `checkout.session.completed`
  - `refund.created`
  - `refund.updated`
  - `charge.refunded`
  - `charge.refund.updated`
  - `application_fee.created`
  - `application_fee.refunded`

  Save the platform signing secret to `STRIPE_WEBHOOK_SECRET_PLATFORM`.

- [ ] **C.2 — Connect endpoint** ("Listen to events on Connected accounts") subscribes to:
  - `account.updated`
  - `account.application.deauthorized`
  - `account.external_account.created`
  - `account.external_account.updated`
  - `account.external_account.deleted`
  - `capability.updated`
  - `person.created`
  - `person.updated`
  - `person.deleted`
  - `payout.created`
  - `payout.paid`
  - `payout.failed`
  - `payout.canceled`
  - `charge.dispute.created`
  - `charge.dispute.updated`
  - `charge.dispute.closed`

  Save the Connect signing secret to `STRIPE_WEBHOOK_SECRET`.

- [ ] **C.3** Explicitly DO NOT subscribe `charge.succeeded`, `charge.failed`, `payment_intent.processing` per OQ-5.

### Phase D — Wallets + production env

- [ ] **D.1** Apple Pay live enrollment: `merchant.com.mingla.app.v2` (consumer) and `merchant.com.sethogieva.minglabusiness` (business). Production processing certs uploaded to live Stripe account.
- [ ] **D.2** Google Pay live enrollment: confirm Google Pay business profile is approved for production for both Android apps (no code action — operator-side console).
- [ ] **D.3** Operator confirms `EAS_BUILD_PROFILE` is set to `"production"` in EAS production build secrets for both apps so §3.2 fail-close and §3.7 testEnv gate behave correctly.

### Phase E — Pre-live verification

- [ ] **E.1** Run the §3.9 connect-inventory reconciliation probe. All three result sets must return zero rows.
- [ ] **E.2** Verify operator-monitoring channel(s) for `STRIPE_DISPUTE_ALERT_USERS` and `STRIPE_WEBHOOK_FAILURE_ALERT_USERS` actually receive a test notification (operator may trigger a synthetic event via Stripe CLI `stripe trigger charge.dispute.created --live` — confirm OneSignal/in-app delivery).
- [ ] **E.3** First-live-sale runbook (§9 rollback plan) reviewed; operator owns the first 10 live transactions monitoring window.

---

## §5 Evidence pack contract (redacted Dashboard readback)

Operator returns this file to the orchestrator BEFORE TEST dispatch:
`Mingla_Artifacts/reports/EVIDENCE_PACK_ORCH-0953_LIVE_ACTIVATION.md`

**Required content (no secret values — prefix-only references throughout):**

1. **Platform account identity:** account name + Stripe account ID prefix (e.g., `acct_…AYA40` last-5).
2. **Live mode status:** confirmation that Dashboard upper-right is "Live mode" not "Test mode."
3. **Publishable key prefix:** `pk_live_…[last 5]`.
4. **Per-RAK key table:** each row = `STRIPE_RAK_<NAME>: rk_live_…[last 5] · permissions: <bulleted list> · IP allowlist: <yes/no + range>`.
5. **Single full-key exception:** `STRIPE_SECRET_KEY: sk_live_…[last 5] · purpose: brand-stripe-tax-dashboard-link only · IP allowlist: <yes/no + range>`.
6. **Platform webhook endpoint:** endpoint ID `we_…[last 5]` · URL · API version · full subscribed event list (must match §4 Phase C.1 exactly) · signing secret prefix `whsec_…[last 5]`.
7. **Connect webhook endpoint:** endpoint ID `we_…[last 5]` · URL · API version · full subscribed event list (must match §4 Phase C.2 exactly) · signing secret prefix `whsec_…[last 5]`.
8. **Apple Pay enrollment:** redacted screenshots showing `merchant.com.mingla.app.v2` and `merchant.com.sethogieva.minglabusiness` listed under the live Stripe account's Apple Pay merchant IDs.
9. **Google Pay enrollment:** redacted screenshot showing live Google Pay status for both Android apps.
10. **Statement descriptor:** value + prefix.
11. **Payout schedule:** platform schedule + connected-account default.
12. **Connect controller model (live):** controller properties (`losses.payments`, `fees.payer`, `requirement_collection`, `stripe_dashboard.type`) confirmed as platform-liable Express per DEC-156 + new DEC §10.
13. **Reconciliation probe results (§3.9):** Result counts for (A), (B), (C) — all zero.
14. **Synthetic dispute test (§E.2):** screenshot of operator receiving the test alert.
15. **Marked-for-deletion list:** `STRIPE_RAK_TAX_DASHBOARD_LINK` confirmed deleted.

**No secret values in the file.** No full keys, no full webhook secrets, no private API material. Redacted screenshots are acceptable; pasted key strings are not.

---

## §6 TEST lane — live-fire smoke matrix

Owner: Claude `mingla-tester` (dispatched by orchestrator AFTER evidence pack §5 is approved).

**Matrix dimensions:**
- 4 native surfaces: consumer iOS, consumer Android, business iOS, business Android.
- 1 buyer-web surface: hosted Checkout on production `business.usemingla.com`.

**Per-surface test cases:**

| Test ID | Scenario | Steps | Expected (PASS = all observable) |
|---|---|---|---|
| T-01 | Paid checkout — happy path | Buy a $1 live test event with a real card | PaymentIntent on live connected account · order row populated · application_fee row · `payment_intent.succeeded` webhook delivered + processed · receipt email sent |
| T-02 | Paid checkout — wallet (Apple Pay native iOS / Google Pay native Android / browser wallet on web) | Same as T-01 but pay via wallet | Same as T-01 + wallet path engaged (verified via PaymentMethod type in PI) |
| T-03 | 3DS / redirect return | Use Stripe live test card requiring 3DS (e.g., `4000 0027 6000 3184`) | App receives 3DS challenge · returns via `<scheme>://stripe-redirect` · order completes |
| T-04 | Refund — in-app | From admin/business UI, refund T-01 order | Refund created on connected account · application fee refunded · `refund.created` + `charge.refunded` webhooks delivered + processed · `orders.refunded_at` set |
| T-05 | Refund — Dashboard-initiated | Refund from Stripe Dashboard manually | Same webhooks delivered + processed; order state matches |
| T-06 | Installment deposit + scheduled charge | Create an installment-eligible order, confirm deposit charge; trigger or wait for scheduled charge | Both PIs settle on connected account · `installment` webhook handlers fire (existing `_shared/installmentWebhookHandlers.ts`) |
| T-07 | Webhook idempotency | Replay a previous webhook delivery (Stripe Dashboard → endpoint → resend event) | Second delivery is idempotent — no duplicate DB rows |
| T-08 | Connected-account onboarding (live) | Onboard a fresh test brand via the live `brand-stripe-onboard` flow | Account created with platform-liable Express controller (per DEC-156) · row inserted into `stripe_connect_accounts` · `account.updated` webhook delivered · capabilities active |
| T-09 | Dispute simulation | Via Stripe CLI `stripe trigger charge.dispute.created --live` (if Stripe permits live triggers on the platform account) OR by creating a real $1 dispute via a chargeback-test card | Row inserted into `stripe_disputes` · `dispatchNotification` alert sent · AppsFlyer S2S `dispute_created` posted |
| T-10 | Native paid region gate | Set `NATIVE_PAID_ALLOWED_REGIONS=""` (empty); attempt native paid | HTTP 400 with `error: "native_paid_not_allowed_in_region"` · toast surfaces with web-fallback CTA · web URL works |
| T-11 | Fail-close validation | (Implementor smoke before tester takes over) Deploy `stripe-webhook` with `STRIPE_RAK_ONBOARD` unset and attempt onboarding | Edge function throws at boot with `STRIPE_RAK_ONBOARD is required`; no silent fallback |

**Per-surface skip rules:**
- T-02 wallet on consumer iOS: Apple Pay specifically. Skip Google Pay (not on iOS).
- T-02 wallet on consumer Android: Google Pay specifically. Skip Apple Pay.
- T-09 if Stripe does not allow live trigger and operator is unwilling to incur a real chargeback for the test: state "live dispute observed within first 30 days post-launch" as a deferred PASS condition; do not block CLOSE.

**Tester independent test files:**
- `supabase/functions/_shared/__tests__/stripeWebhookRouter_disputeAdversarial.test.ts` — adversarial test attacking dispute idempotency at a different angle than the implementor's happy-path: race two concurrent inserts of the same `stripe_dispute_id`, assert exactly one row exists.
- `supabase/functions/ticket-checkout-create/__tests__/nativeRegionGate_adversarial.test.ts` — adversarial: case-sensitivity (`"us"` vs `"US"`), whitespace in env, comma-only env, null brand country.

---

## §7 Binary success criteria (consolidated)

| ID | PASS = | FAIL = |
|---|---|---|
| SC-1 | `_shared/stripeBlueprintClient.ts` throws without `STRIPE_RAK_ONBOARD`; never logs `STRIPE_SECRET_KEY` | Silent fallback to secret key |
| SC-2 | Production EAS build throws if `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` is missing or non-`pk_live_` | Sandbox key reaches production runtime |
| SC-3 | `stripe_disputes` table exists with schema + RLS + both policies | Anything else |
| SC-4 | `STRIPE_ROUTED_EVENT_TYPES` contains all 3 dispute types | Missing any |
| SC-5 | `charge.dispute.created` → 1 row in `stripe_disputes` + 1 `dispatchNotification` call | Any other outcome |
| SC-6 | Re-sending same dispute event → exactly 1 row (upsert) | Duplicate rows |
| SC-7 | Live webhook endpoints do NOT subscribe `charge.succeeded`/`charge.failed`/`payment_intent.processing` | Any subscribed |
| SC-8 | Production mingla-business Android resolves `com.sethogieva.minglabusiness://stripe-redirect` | Deep link does not open the app |
| SC-9 | Production app-mobile Android resolves `com.mingla.app.v2://stripe-redirect` | Deep link does not open the app |
| SC-10 | `testEnv: false` in production builds, `true` otherwise | Inverted |
| SC-11 | Native checkout returns HTTP 400 when brand country not in `NATIVE_PAID_ALLOWED_REGIONS` | Proceeds to PI creation |
| SC-12 | Empty `NATIVE_PAID_ALLOWED_REGIONS` disables native paid entirely | Native paid succeeds |
| SC-13 | Allowed-region brand → PI creates and confirms | Native paid blocked for allowed region |
| SC-14 | Region-gate 400 → toast with web-fallback CTA | Silent failure |
| SC-15 | §3.9 reconciliation probe returns zero rows in all 3 result sets | Any orphan or multi-mapping |
| SC-16 | Invalid-signature webhook → `dispatchNotification` fires (when env set) | No alert |
| SC-17 | Missing alert-users env → no notification, no throw | Throw or unexpected behavior |

All 17 must PASS for live cutover. CONDITIONAL PASS is permitted only on T-09 (dispute simulation) per the deferred-PASS rule in §6.

---

## §8 Regression-test paths (per ORCH-0840)

Implementor-written happy-path tests (one per contract). Each test lands at a real path under `supabase/functions/**/__tests__/`, `app-mobile/**/__tests__/`, or `mingla-business/**/__tests__/`, and the implementor records the commit hash where `fails-on-revert verified at <commit>` is true in the implementation report.

| Contract | Test path |
|---|---|
| §3.1 | `supabase/functions/_shared/__tests__/stripeBlueprintClient_failclose.test.ts` |
| §3.2 | `mingla-business/src/__tests__/appConfig_pkLiveFailClose.test.ts` |
| §3.3 | `supabase/functions/_shared/__tests__/stripeDisputeHandlers.test.ts` |
| §3.4 | `supabase/functions/_shared/__tests__/stripeWebhookRouter_eventList.test.ts` |
| §3.5 | `mingla-business/__tests__/intentFilters_stripeReturnScheme.test.ts` |
| §3.6 | `app-mobile/__tests__/intentFilters_stripeReturnScheme.test.ts` |
| §3.7 | `app-mobile/__tests__/googlePay_testEnvProductionGate.test.ts` + `mingla-business/__tests__/googlePay_testEnvProductionGate.test.ts` |
| §3.8 | `supabase/functions/ticket-checkout-create/__tests__/nativePaidRegionGate.test.ts` + `app-mobile/src/payments/__tests__/nativeCheckoutFlow_regionGateToast.test.tsx` + `mingla-business/src/payments/__tests__/nativeCheckoutFlow_regionGateToast.test.tsx` |
| §3.9 | `scripts/orch-0953/__tests__/reconciliation_query_shape.test.ts` |
| §3.10 | `supabase/functions/stripe-webhook/__tests__/signatureFailureAlert.test.ts` |

Tester-written adversarial tests (lands during TEST phase, immutable thereafter per ORCH-0840):

| Adversarial angle | Test path |
|---|---|
| Dispute idempotency race | `supabase/functions/_shared/__tests__/stripeWebhookRouter_disputeAdversarial.test.ts` |
| Region gate edge cases (case, whitespace, null) | `supabase/functions/ticket-checkout-create/__tests__/nativeRegionGate_adversarial.test.ts` |

All tests are immutable post-landing per `.github/workflows/tests-append-only.yml`. Modifications require a new ORCH cited as `[TEST-MOD-APPROVED ORCH-NNNN]` in the commit body.

---

## §9 Rollback plan

**During IMPLEMENT (pre-merge):** standard `git reset` on the per-ORCH branch.

**Post-merge to main, pre-live activation:** revert PR. EAS rollback via `eas update --branch production --message "rollback ORCH-0953"` with the prior code (only needed if mobile bundle was already pushed — for this ORCH, the operator should hold the EAS Update until evidence pack approves).

**Post-live activation, first 10 live transactions monitoring window (operator-owned):**

Rollback triggers:
1. >5% `payment_intent.payment_failed` rate within the first 10 live transactions.
2. Any unexpected `charge.dispute.created` event (real chargeback) within the first 24 hours.
3. Any webhook signature verification failure with valid Stripe-source IP (indicates secret mismatch).
4. Any `_shared/stripeBlueprintClient.ts` boot-error indicating RAK is mis-scoped (caught by §3.1 fail-close).

Rollback actions (in order):
1. **Disable live sales surface** — operator sets brand-level kill switch (existing `brands.live_sales_enabled` if it exists; or temporarily detaches all live `stripe_connect_accounts` rows).
2. **Switch Supabase secrets back to test keys** — `supabase secrets set --project-ref gqnoajqerqhnvulmnyvv STRIPE_RAK_*` to the previously-stored test values.
3. **Redeploy** all Stripe-touching edge functions via `supabase functions deploy <name>` (orchestrator-owned).
4. **Refund** any live transactions that already cleared, via Stripe Dashboard manual refund.
5. **Disable live Stripe webhook endpoints** at the Stripe Dashboard (do not delete — disable to preserve the configuration for re-enable after fix).
6. **Open ORCH-0953-RW** for rework with the specific failure cited.

**First-live-sale runbook owner:** Seth (operator). Monitoring window: first 10 transactions OR first 48 hours, whichever comes second.

---

## §10 Proposed new DEC entry

To be added to `Mingla_Artifacts/DECISION_LOG.md` at CLOSE:

> **2026-05-24 — DEC-XXX logged — ORCH-0953 [Stripe live-mode cutover] CLOSE — Mingla's live Stripe Connect platform activated with platform-liable Express direct charges; DEC-154 / DEC-156 reconciled and locked.**
>
> **Decision:** Live Stripe activation proceeds with the platform-liable Express controller model (recipient + merchant capabilities, `losses_collector = "application"`, `fees_collector = "application"`, `requirement_collection = "stripe"`, `dashboard = "express"`) for both existing test connected accounts and all new live accounts.
>
> **Reconciliation of DEC-154 / DEC-156:** DEC-154 (2026-05-15) originally targeted Stripe-managed risk via embedded onboarding + Stripe-liable losses. DEC-156 (2026-05-15) amended DEC-154 (5) to platform-managed risk after ORCH-0843 [Charge-Shape Reconciliation] CLOSE shipped direct charges with `application_fee_amount` and the platform-liable controller shape — operator accepted platform-liable chargeback risk to ship live ticket sales faster. ORCH-0953 confirms this remains the live activation model; no re-onboarding campaign is undertaken.
>
> **Consequences locked in:**
> 1. Mingla absorbs negative-balance losses including fraud-driven losses, chargebacks on the 120-day post-event tail, and event-cancellation-driven mass-refund balance gaps.
> 2. The Connect controller model is sticky per DEC-154 (6); reversing to Stripe-managed risk requires a future ORCH that detaches + re-onboards every active connected account.
> 3. Dispute observability is implemented in this ORCH via the new `public.stripe_disputes` table + `charge.dispute.*` router handlers + operator alerting.
> 4. The DEC-154 (9)(c) webhook subscription set is finalized in §4 Phase C of this SPEC: platform endpoint = 10 events; Connect endpoint = 16 events including the 3 dispute events. `charge.succeeded`, `charge.failed`, `payment_intent.processing` are explicitly NOT subscribed.
> 5. The DEC-154 (9)(a) restricted-API-keys requirement is finalized in §4 Phase B with 9 distinct live RAKs + 1 accepted full-key exception (`STRIPE_SECRET_KEY` for `brand-stripe-tax-dashboard-link` per Stripe's `accounts.createLoginLink` API constraint).
>
> **New invariants:**
> - **I-PROPOSED-STRIPE-RAK-ONBOARD-FAIL-CLOSE** — `_shared/stripeBlueprintClient.ts` MUST throw at boot when `STRIPE_RAK_ONBOARD` is absent; no fallback to `STRIPE_SECRET_KEY` in production. Enforced by §3.1 + regression test.
> - **I-PROPOSED-MINGLA-BUSINESS-PK-LIVE-IN-PRODUCTION** — `mingla-business/app.config.ts` MUST throw at config eval when `EAS_BUILD_PROFILE === "production"` and `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` is missing or non-`pk_live_`. Enforced by §3.2 + regression test.
> - **I-PROPOSED-STRIPE-WEBHOOK-DISPUTE-ROUTED** — `STRIPE_ROUTED_EVENT_TYPES` MUST include `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`. Enforced by §3.3 + regression test.
> - **I-PROPOSED-STRIPE-DISPUTE-PERSISTED** — Every `charge.dispute.*` event MUST upsert into `public.stripe_disputes` keyed by `stripe_dispute_id`. Enforced by §3.3 + regression test.
> - **I-PROPOSED-STRIPE-NATIVE-PAID-REGION-GATED** — `ticket-checkout-create` MUST gate native paid surface behind `NATIVE_PAID_ALLOWED_REGIONS` env until native Stripe Tax is implemented. Enforced by §3.8 + regression test.
>
> **Cross-references:**
> - Investigation: [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0953_STRIPE_LIVE_CUTOVER_AUDIT.md`](../reports/INVESTIGATION_ORCH-0953_STRIPE_LIVE_CUTOVER_AUDIT.md)
> - SPEC: this file (`SPEC_ORCH-0953_STRIPE_LIVE_CUTOVER.md`)
> - Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0953_STRIPE_LIVE_CUTOVER.md` (written by implementor)
> - QA report: `Mingla_Artifacts/reports/QA_ORCH-0953_STRIPE_LIVE_CUTOVER_REPORT.md` (written by tester)
> - Evidence pack: `Mingla_Artifacts/reports/EVIDENCE_PACK_ORCH-0953_LIVE_ACTIVATION.md` (operator)
> - Supersedes: DEC-154 (5) original Stripe-managed-risk stance (already amended by DEC-156); finalizes DEC-156's platform-managed risk for live.

---

## §11 Implementation order (for the implementor)

1. **Database first:** §3.3 migration `<timestamp>_create_stripe_disputes.sql`. Operator runs `supabase db push --linked` AFTER implementor merges to main; orchestrator deploys edge functions AFTER operator confirms migration is on remote.
2. **Shared backend:** §3.1 (`_shared/stripeBlueprintClient.ts`), §3.3 (`_shared/stripeDisputeHandlers.ts` + router additions), §3.4 (router doc comment), §3.8 (`_shared/stripeTax.ts`), §3.10 (`stripe-webhook` alert hook).
3. **Edge functions touching shared:** redeploy `ticket-checkout-create`, `stripe-webhook`, `brand-stripe-onboard`, `refund-order`, `cancel-trip-booking`, `brand-stripe-tax-dashboard-link` (any function importing the touched `_shared/` files).
4. **Mobile config:** §3.2 (mingla-business `app.config.ts`), §3.5 (mingla-business `app.json`), §3.6 (app-mobile `app.json`), §3.7 (both layouts).
5. **Tests:** every regression test path in §8.
6. **Reconciliation probe + runbook:** §3.9 files under `scripts/orch-0953/`.

---

## §12 Cross-Surface Implementation matrix (per Phase 2.5)

Restated as separate success criteria per surface where parity is manual:

- SC-3-iOS / SC-3-Android — N/A (single migration, single backend).
- SC-8 = SC-8-iOS / SC-8-Android — covered by §3.5; per-surface verification at T-03 (3DS redirect) + T-02 (wallet) on business iOS and business Android separately.
- SC-9 = covered by §3.6; per-surface verification at T-03 on consumer iOS (existing top-level scheme) + consumer Android (new intent filter).
- SC-10 = SC-10-consumer / SC-10-business — both apps require the fix; both have their own regression test in §8.
- SC-11 / SC-12 / SC-13 = SC-11-consumer / SC-11-business — both native checkout flows must surface the region-gate behavior identically; both have their own regression test in §8.
- SC-14 = SC-14-consumer / SC-14-business — toast copy must match across both apps; tester validates side-by-side at T-10.

---

## End of SPEC.
