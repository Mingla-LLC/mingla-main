# SPEC — ORCH-0844 [Explorer PaymentSheet: Connect Account ID per-PI + 60s timeout removal]

**Mode:** SPEC (Option A from investigation)
**Author:** Claude `mingla-forensics`
**Date:** 2026-05-15
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation input:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0844_EXPLORER_PAYMENTSHEET_DOUBLE_RESOLVE.md`
**Architectural input:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0843_CHARGE_SHAPE_RECONCILIATION.md` + REWORK; `DECISION_LOG.md` DEC-154 / DEC-155 / DEC-156

---

## 1. PROBLEM RESTATEMENT (one paragraph)

After ORCH-0843 [charge-shape reconciliation] flipped every ticket PaymentIntent to a **direct charge on a connected account** (created with the third-arg `{ stripeAccount }` request option at `ticket-checkout-create/index.ts:498`), the mobile Stripe SDK on explorer was never told which connected account the PI belongs to. The PaymentSheet's mid-flow confirm hits Stripe under the PLATFORM context and the connected-account `client_secret` is rejected with a 404 — manifesting on iOS 26 as the native `RCTPromiseResolveBlock` firing twice (early-error + late-completion), which RN's TurboModule bridge logs as `"tried to resolve a promise more than once"`. Compounding it, our own 60s `withTimeout` wrapper around `presentPaymentSheet` (added in ORCH-0829-B-D-1 to guard against the now-fixed dashboard-fan-out hang) is itself a double-settle vector. Operator confirmed: **do NOT pivot to Hosted Checkout** — Payment Sheet is Stripe's officially recommended pattern; fix the two real gaps.

## 2. SCOPE / NON-GOALS / ASSUMPTIONS

### 2.1 In scope
- **A-1** Edge function returns `stripeAccountId` (and customer fields per A-3) on `requires_payment`; mobile calls `initStripe({ publishableKey, stripeAccountId })` immediately before `initPaymentSheet`.
- **A-2** Remove the 60s `withTimeout` wrappers around both `initPaymentSheet` AND `presentPaymentSheet` in `packages/payments-native/useStripePaymentSheet.ts`. Keep the once-only `inFlightInitRef` / `inFlightPresentRef` guards.
- **A-3** Edge function creates (or finds) a Stripe **Customer on the connected account** by buyer email, mints an **ephemeralKey** for that customer, returns `customerId` + `customerEphemeralKeySecret`; mobile passes both to `initPaymentSheet`.
- **A-4** Drop `allowsDelayedPaymentMethods: false` from `initPaymentSheet` (redundant under `payment_method_types: ['card']`).
- **CI gate** new strict-grep script `.github/scripts/strict-grep/orch-0844-stripe-connect-account-id-per-pi.mjs` (sub-checks T-G1..T-G4) wired into `.github/workflows/strict-grep-mingla-business.yml`.
- **Regression-check** flip `app-mobile/scripts/ci/orch-0829b-d1-regression-check.mjs` so T-A6..T-A9 enforce **absence** of the timeout race (or delete those four sub-checks and keep T-A1..T-A5 for the migration + try/catch pieces, which remain valid).
- **Invariants** — establish `I-PROPOSED-STRIPE-CONNECT-ACCOUNT-ID-PER-PI`; amend `I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG`; retire `I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE`; preserve `I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY` and `I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES` unchanged.
- **DECISION_LOG draft** DEC-157 entry (to be appended by orchestrator at CLOSE) capturing iOS-26 double-resolve mechanism + Option-A resolution.

### 2.2 Non-goals
- **No Hosted Checkout pivot** for explorer (Option B is reserved as fallback only — DO NOT implement).
- **No changes** to `payment_method_types: ['card']` (ORCH-0837 invariant — preserved).
- **No changes** to `handleURLCallback` wiring at `app-mobile/app/index.tsx:1803-1835` (H-1 disproven; preserved).
- **No changes** to `packages/payments-native/StripeNativeProvider.tsx`. The connected-account ID is per-PI (not per-app-mount); `initStripe` is the correct surface, not the provider prop.
- **No changes** to the ORCH-0843 charge shape (direct charge + `application_fee_amount` + statement_descriptor_suffix MINGLA stay).
- **No changes** to the web Checkout Session branch (surface = `"web"` / `"mobile-web"`).
- **No changes** to free-ticket flow (`kind: "free_completed"`).
- **No migrations.** This SPEC is code-only.
- **No edge function deploy** until orchestrator gate (per Mingla protocol).

### 2.3 Assumptions
- `stripeAccountId` is already in scope at line 498 of `ticket-checkout-create/index.ts` (verified — derived from `session.stripeAccountId` at line 185-188; guard at 188 returns early if missing).
- Stripe `customers.search` and `customers.create` accept the `{ stripeAccount }` request option (verified — direct-charge customer scoping; Customer must live on the connected account, not the platform, for direct charges).
- `stripe.ephemeralKeys.create` requires an `apiVersion` string equal to the API version the mobile SDK expects; Stripe RN 0.65.1 native SDK pins to its own internal version. Edge function will pass `apiVersion: STRIPE_API_VERSION` from `_shared/stripe.ts` (currently `"2026-04-22.dahlia"`) — Stripe iOS SDK accepts ephemeralKey versions ≥ the SDK's internal floor, and ahead-of-SDK versions are non-fatal (sheet still loads). If the iOS SDK rejects the version at runtime, fall back to omitting `customer` + `customerEphemeralKeySecret` from `initPaymentSheet` for that call (guest-checkout path) and surface a warn log — sheet works in guest mode without saved-PM.
- Buyer email is already validated as RFC-shape at line 71-72 of the edge function before reaching the PI path.
- Idempotent customer creation by email is safe for guest-checkout (no auth required); if a customer with the same email already exists on the connected account, `customers.search` returns it.

## 3. PER-LAYER SPECIFICATION

### 3.1 Database

No schema change. No migration. No RLS change.

### 3.2 Edge Function — `supabase/functions/ticket-checkout-create/index.ts`

#### 3.2.1 Request shape — unchanged

No change to the request body. Mobile continues to send `{ eventId, surface: "native", buyer, lines, idempotencyKey? }`.

#### 3.2.2 Response shape — `kind: "requires_payment"` — extended

**Old (lines 546-558):**
```ts
return jsonResponse({
  kind: "requires_payment",
  checkoutSessionId,
  buyerStatusToken,
  totalCents,
  currency: String(session.currency ?? "GBP"),
  clientSecret,
  paymentIntentId: paymentIntent.id,
  publishableKey: Deno.env.get("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY") ?? ... ?? null,
});
```

**New:** three NEW fields appended (none removed; additive change for backward compat). Field order in the response object is documented for log-stability but not load-bearing.

```ts
return jsonResponse({
  kind: "requires_payment",
  checkoutSessionId,
  buyerStatusToken,
  totalCents,
  currency: String(session.currency ?? "GBP"),
  clientSecret,
  paymentIntentId: paymentIntent.id,
  publishableKey: /* unchanged */ ?? null,

  // ORCH-0844 NEW: Connect direct-charge mobile config
  stripeAccountId,                           // string — the connected account the PI lives on (already in scope; see line 185-188)
  customerId,                                // string | null — connected-account Customer; null if customer creation failed (guest fallback)
  customerEphemeralKeySecret,                // string | null — ephemeralKey secret; null if customer is null OR ephemeralKey creation failed
});
```

**Type contract:** when `customerId` is `null`, `customerEphemeralKeySecret` MUST also be `null` (paired-or-absent invariant). When `stripeAccountId` is missing, the edge function MUST NOT reach this `requires_payment` branch (existing guard at line 188 already returns 4xx).

#### 3.2.3 NEW Stripe Customer + EphemeralKey block (placed immediately AFTER line 544 `persistPaymentError` block, BEFORE the `jsonResponse({ kind: "requires_payment", ... })` call at line 546)

Logic (pseudocode, exact TS in IMPLEMENT):

```ts
// ORCH-0844 — Connect direct-charge Customer + ephemeralKey for the
// mobile PaymentSheet. Both are scoped to the connected account
// (third-arg { stripeAccount } request option). Failure of either
// step is NON-FATAL: we return null for the missing field and the
// mobile SDK falls back to guest-checkout init (no saved-PM UI).
let customerId: string | null = null;
let customerEphemeralKeySecret: string | null = null;
try {
  // 3.2.3.a — Idempotent customer lookup by email on the CONNECTED ACCOUNT
  // Stripe's customers.search returns at most one match for our email filter
  // (we ensure uniqueness by always creating with the same email + metadata).
  // The { stripeAccount } request option scopes the search to that account.
  const searchResult = await stripe.customers.search(
    { query: `email:'${buyerEmail.replace(/'/g, "\\'")}'`, limit: 1 },
    { stripeAccount: stripeAccountId },
  );
  let customer = searchResult.data[0] ?? null;

  if (customer === null) {
    // 3.2.3.b — Idempotent creation by email-hashed idempotency-key.
    // sha256Hex is already imported from _shared/ticketCheckout.ts.
    const customerIdemKey = `mingla_customer:${stripeAccountId}:${await sha256Hex(buyerEmail)}`;
    customer = await stripe.customers.create(
      {
        email: buyerEmail,
        metadata: {
          mingla_buyer_email: buyerEmail,
          mingla_origin: "ticket_checkout_create_native",
        },
      },
      { idempotencyKey: customerIdemKey, stripeAccount: stripeAccountId },
    );
  }
  customerId = customer.id;

  // 3.2.3.c — EphemeralKey for the mobile SDK
  const ephemeralKey = await stripe.ephemeralKeys.create(
    { customer: customerId },
    {
      apiVersion: STRIPE_API_VERSION,  // imported from _shared/stripe.ts
      stripeAccount: stripeAccountId,
    },
  );
  customerEphemeralKeySecret = String(ephemeralKey.secret ?? "");
  if (customerEphemeralKeySecret.length === 0) {
    // defensive: Stripe returned a key with empty secret — treat as failure
    customerId = null;
    customerEphemeralKeySecret = null;
  }
} catch (customerErr) {
  // Non-fatal: log and continue with null customer fields. Mobile SDK
  // will init PaymentSheet in guest mode. This preserves the existing
  // happy path even if Connect customer-creation breaks on Stripe's side.
  console.warn(
    "[ticket-checkout-create] customer+ephemeralKey creation failed; continuing in guest mode",
    customerErr instanceof Error ? customerErr.message : customerErr,
  );
}
```

**Error policy:** customer creation failure is **non-fatal**. The buyer can still complete checkout in guest mode (no saved-PM). This preserves robustness — a transient Stripe customers-API outage must NOT block ticket sales.

**Side-effect on `ticket_checkout_sessions`:** none. The customer ID is not persisted in v1 of this SPEC (orchestrator may file a follow-up ORCH to persist `stripe_customer_id` for refund-by-customer analytics; out of scope here).

**Idempotency:** the email-hashed idempotency-key on `customers.create` ensures Stripe deduplicates retries within its 24h idempotency window. The `customers.search` first-pass covers the >24h case.

#### 3.2.4 Imports — confirm `STRIPE_API_VERSION` available

The edge function currently imports `stripeTicketCheckout` from `_shared/stripe.ts` (line 2). The implementor MUST also import `STRIPE_API_VERSION` from the same module:

```ts
import { stripeTicketCheckout, STRIPE_API_VERSION } from "../_shared/stripe.ts";
```

If `STRIPE_API_VERSION` is not currently exported from `_shared/ticketCheckout.ts` or `_shared/stripe.ts`, the implementor exports it (one-line `export` keyword addition; verified line 30 of `_shared/stripe.ts` already declares `export const STRIPE_API_VERSION = "2026-04-22.dahlia"`).

### 3.3 Mobile — `packages/payments-native/useStripePaymentSheet.ts`

#### 3.3.1 Remove the `withTimeout` wrapper from BOTH wrappers

**Old (lines 102-162):** both `initPaymentSheet` and `presentPaymentSheet` IIFEs await `withTimeout(stripeNativeCall, PAYMENT_SHEET_TIMEOUT_MS, label)`.

**New:** both IIFEs await the native call directly. The `withTimeout` helper, the `PAYMENT_SHEET_TIMEOUT_MS` constant, and the `"Timeout"` synthetic-error code are all DELETED from this file. The once-only `inFlightInitRef` / `inFlightPresentRef` guards REMAIN unchanged.

**Concrete contract:**
- `PAYMENT_SHEET_TIMEOUT_MS` constant: **DELETED**
- `withTimeout<T>(promise, ms, label)` helper: **DELETED**
- Inside `initPaymentSheet`'s IIFE (line 115): `await initPaymentSheet(input)` directly (no withTimeout wrap)
- Inside `presentPaymentSheet`'s IIFE (line 144-149): `await presentPaymentSheet()` directly (no withTimeout wrap)
- Header comment block (lines 26-39) explaining the timeout race: **DELETED**
- New header comment block explaining the removal and citing ORCH-0844 + ORCH-0837 as the supersession context: **ADDED** (see §3.3.3)

#### 3.3.2 Preserve once-only guards

`inFlightInitRef` and `inFlightPresentRef` stay. They serve double-tap defense (different mechanism than the deleted timeout race). Comments at lines 14-24 referencing `I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY` are preserved (with a one-line addendum noting the timeout race was removed in ORCH-0844 because the hang it guarded was resolved at the PI layer by ORCH-0837 `payment_method_types: ['card']`).

#### 3.3.3 New header comment (replacing the ORCH-0829-B D-1 H-3 block)

The implementor adds a 6-8 line comment block above `useStripePaymentSheet` summarizing:
- The once-only guard's purpose (double-tap suppression).
- That the 60s timeout race was REMOVED in ORCH-0844 — it was a workaround for the dashboard-fan-out hang (ORCH-0829-B D-1) which was resolved at the PI level by ORCH-0837 `payment_method_types: ['card']`. With card-only PIs, the sheet either resolves within ~2s or fails clean; no 60s hang is reachable.
- That the iOS-26 double-resolve mechanism (RN bridge `RCTPromiseResolveBlock` fired twice from native) is suppressed at the SOURCE by passing `stripeAccountId` per-PI in `nativeCheckoutFlow.ts` so the SDK's confirm call reaches Stripe under the correct connected-account context (no 404 error-resolve race).
- Cross-references: `I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY` (preserved), `I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE` (retired), `I-PROPOSED-STRIPE-CONNECT-ACCOUNT-ID-PER-PI` (new).

#### 3.3.4 `packages/payments-native/types.ts`

The `"Timeout"` code in the `PaymentSheetErrorCode` union (if present) MAY be removed for cleanliness OR kept as documentation that previous builds emitted it. Implementor choice; SPEC neutral. If removed, all downstream `result.error.code === "Timeout"` references must be removed too (grep before deleting — there should be zero callers in product code, since the synthetic-timeout was internal to the hook).

### 3.4 Mobile — `app-mobile/src/payments/nativeCheckoutFlow.ts`

#### 3.4.1 Import `initStripe`

**Old (line 19):**
```ts
import { useStripePaymentSheet } from "@mingla/payments-native";
```

**New:**
```ts
import { useStripePaymentSheet } from "@mingla/payments-native";
import { initStripe } from "@stripe/stripe-react-native";
```

`initStripe` is a top-level export from `@stripe/stripe-react-native` (verified — `node_modules/@stripe/stripe-react-native/src/components/StripeProvider.tsx:33-57` documents it as the imperative initializer corresponding to the `<StripeProvider>` component props).

#### 3.4.2 Extend the `CheckoutCreateResponse` discriminated-union type

**Old (lines 48-56):**
```ts
| {
    kind: "requires_payment";
    checkoutSessionId: string;
    buyerStatusToken: string;
    totalCents: number;
    currency: string;
    clientSecret: string;
    paymentIntentId: string;
    publishableKey: string | null;
  }
```

**New:**
```ts
| {
    kind: "requires_payment";
    checkoutSessionId: string;
    buyerStatusToken: string;
    totalCents: number;
    currency: string;
    clientSecret: string;
    paymentIntentId: string;
    publishableKey: string | null;
    // ORCH-0844 — Connect direct-charge mobile config
    stripeAccountId: string;
    customerId: string | null;
    customerEphemeralKeySecret: string | null;
  }
```

#### 3.4.3 Re-initialize Stripe SDK per-PI BEFORE `initPaymentSheet`

**Insertion point:** inside `if (data.kind === "requires_payment") {` branch, immediately BEFORE the existing `const initResult = await initPaymentSheet({...})` call at line 125.

```ts
// ORCH-0844 — Connect direct-charge: re-initialise the native Stripe SDK
// for THIS PaymentIntent's connected account. Without this, the SDK's
// mid-PaymentSheet confirm call hits Stripe under the platform context
// and the client_secret (bound to the connected account) is rejected
// with a 404. On iOS 26 the 404 manifests as the native
// RCTPromiseResolveBlock firing twice, which RN's TurboModule bridge
// logs as "tried to resolve a promise more than once".
//
// We skip the re-init if either field is missing (defensive — the edge
// function should always send them on requires_payment, but if a future
// surface adds a non-Connect platform-direct PI shape, this fall-through
// keeps it working).
if (data.publishableKey && data.stripeAccountId) {
  await initStripe({
    publishableKey: data.publishableKey,
    stripeAccountId: data.stripeAccountId,
    merchantIdentifier: "merchant.com.mingla.app.v2",
    urlScheme: "com.mingla.app.v2",
  });
}
```

**Why `merchantIdentifier` + `urlScheme` are re-passed:** `initStripe` REPLACES the prior SDK config; it does NOT merge. We must re-pass every field that was on the original `<StripeProvider>` mount in `app-mobile/app/_layout.tsx:72-75`, otherwise Apple Pay (future ORCH-0838) and any redirect-method (future ORCH) lose their config. The hard-coded values here are identical to the provider mount; if those ever change, both call sites change together (regression-check enforces equality — see §3.5.1 T-G2).

#### 3.4.4 Pass `customerId` + `customerEphemeralKeySecret` to `initPaymentSheet`; drop `allowsDelayedPaymentMethods`

**Old (lines 125-137):**
```ts
const initResult = await initPaymentSheet({
  merchantDisplayName: MERCHANT_DISPLAY_NAME,
  paymentIntentClientSecret: data.clientSecret,
  allowsDelayedPaymentMethods: false,
  returnURL: "com.mingla.app.v2://stripe-redirect",
});
```

**New:**
```ts
const initResult = await initPaymentSheet({
  merchantDisplayName: MERCHANT_DISPLAY_NAME,
  paymentIntentClientSecret: data.clientSecret,
  returnURL: "com.mingla.app.v2://stripe-redirect",
  // ORCH-0844 A-3 — Connect direct-charge Customer + ephemeralKey
  // Both are paired-or-absent (edge function contract §3.2.2).
  ...(data.customerId && data.customerEphemeralKeySecret
    ? {
        customerId: data.customerId,
        customerEphemeralKeySecret: data.customerEphemeralKeySecret,
      }
    : {}),
});
```

The `allowsDelayedPaymentMethods: false` line is REMOVED (A-4). Card-only is already enforced at the PI level (`payment_method_types: ['card']` from ORCH-0837 — preserved).

#### 3.4.5 No other changes to nativeCheckoutFlow.ts

`presentPaymentSheet()` call at line 148 is unchanged. Error-branch handling at 149-160 is unchanged. Success-return at line 167 is unchanged. The `checkoutInFlight` try/catch/finally pattern in `ExpandedBusinessEventSheet.tsx` (ORCH-0829-B D-1 T-A4/T-A5) is unchanged and remains valid.

### 3.5 CI Gates

#### 3.5.1 NEW gate — `.github/scripts/strict-grep/orch-0844-stripe-connect-account-id-per-pi.mjs`

Asserts the four sub-checks below. Follows the existing modular-script-per-invariant registry pattern (DEC-101 D-17b-5; codified 2026-05-05). Failure of any sub-check fails the PR.

| Sub-check | File | Assertion |
|---|---|---|
| **T-G1** | `app-mobile/src/payments/nativeCheckoutFlow.ts` | imports `initStripe` from `@stripe/stripe-react-native` — `/import\s*\{[^}]*\binitStripe\b[^}]*\}\s*from\s*["']@stripe\/stripe-react-native["']/` matches |
| **T-G2** | `app-mobile/src/payments/nativeCheckoutFlow.ts` | calls `initStripe({ publishableKey: ..., stripeAccountId: ... })` BEFORE `initPaymentSheet` — `/initStripe\s*\(\s*\{[\s\S]{0,500}?publishableKey[\s\S]{0,500}?stripeAccountId[\s\S]{0,500}?\}\s*\)/` matches AND the regex position of the `initStripe(` opener < the regex position of the FIRST `initPaymentSheet(` opener in the file |
| **T-G3** | `supabase/functions/ticket-checkout-create/index.ts` | `requires_payment` response includes `stripeAccountId` field — `/kind:\s*["']requires_payment["'][\s\S]{0,800}?stripeAccountId/` matches |
| **T-G4** | `supabase/functions/ticket-checkout-create/index.ts` | `requires_payment` response includes both `customerId` AND `customerEphemeralKeySecret` fields — both keys present within the same `jsonResponse({ kind: "requires_payment", ... })` block |

The script's structure mirrors `i-proposed-a-brands-deleted-filter.mjs` (same `checks.push({name, pass, detail})` + final exit-code pattern as `orch-0829b-d1-regression-check.mjs`). Implementor uses one of those two as a template.

#### 3.5.2 Workflow registration — `.github/workflows/strict-grep-mingla-business.yml`

Add a new job under the existing per-gate job pattern (one job per script, runs in parallel with the others). Name: `orch-0844-stripe-connect-account-id-per-pi`. Triggers on the same `paths:` filter (already covers `app-mobile/**`, `supabase/functions/**`, `.github/scripts/strict-grep/**`).

Also add the gate to the "Currently registered gates:" comment block (line 32-40) for future-orchestrator visibility.

#### 3.5.3 ORCH-0829-B D-1 regression-check flip — `app-mobile/scripts/ci/orch-0829b-d1-regression-check.mjs`

Sub-checks T-A1, T-A2, T-A3 (migration), T-A4, T-A5 (try/catch/finally in `handleBuy`) are **preserved unchanged** — they remain valid invariants (the tombstone migration and the `setCheckoutInFlight(false)` finally are both correct post-ORCH-0844).

Sub-checks T-A6, T-A7, T-A8, T-A9 (the `withTimeout` race assertions) are **flipped to absence assertions**:

| Old | New |
|---|---|
| T-A6 — file declares `PAYMENT_SHEET_TIMEOUT_MS = 60_000` and `withTimeout` helper | T-A6 (flipped) — file does NOT declare `PAYMENT_SHEET_TIMEOUT_MS` and does NOT declare `function withTimeout` — both regexes return `false` |
| T-A7 — both wrappers call `withTimeout(...)` | T-A7 (flipped) — neither wrapper calls `withTimeout(` — regex returns `false` for both `initPaymentSheet` and `presentPaymentSheet` IIFE bodies |
| T-A8 — synthetic error has `code: "Timeout"` | T-A8 (flipped) — file contains no `code:\s*["']Timeout["']` literal |
| T-A9 — diagnostic log `timed out after ${ms}ms` | T-A9 (flipped) — file contains no `timed out after \$\{ms\}ms` literal |

Implementor renames the file header comment from "asserts the three-layer fix" to "asserts that the timeout race was removed at ORCH-0844 while preserving the migration + try/finally layers." Each flipped sub-check's `detail` string is rewritten to explain the new invariant (e.g., "MUST NOT declare PAYMENT_SHEET_TIMEOUT_MS — the timeout race was removed in ORCH-0844 because the hang it guarded was resolved at the PI level by ORCH-0837 card-only PIs").

**Alternative (acceptable):** delete T-A6..T-A9 outright and rely solely on the new ORCH-0844 gate for the timeout-race-absence enforcement. SPEC neutral; either approach satisfies the regression-prevention requirement. Flipping is preferred because it preserves the dispatch-history paper trail.

### 3.6 DOCs / DECISION_LOG / INVARIANT_REGISTRY

#### 3.6.1 DECISION_LOG draft entry (DEC-157) — to be appended by orchestrator at CLOSE

The implementor includes the following draft block at the top of the implementation report so the orchestrator can paste it into `Mingla_Artifacts/DECISION_LOG.md` at CLOSE:

```
DEC-157 (2026-05-1X) — ORCH-0844 [Explorer PaymentSheet Connect-account-ID per-PI + 60s timeout removal]

Context: ORCH-0843 flipped every ticket PI to direct-charge on a connected
account via { stripeAccount } request option, but the mobile Stripe SDK was
never initialised with the matching stripeAccountId. On iOS 26 this surfaced
as the native RCTPromiseResolveBlock firing twice (early 404-error resolve +
late completion resolve), which RN's TurboModule bridge logs as "tried to
resolve a promise more than once". The 60s synthetic withTimeout race in
useStripePaymentSheet (added in ORCH-0829-B D-1 for the now-resolved
dashboard-fan-out hang) compounded the double-settle window.

Decision: Option A — fix the two real gaps, do NOT pivot to Hosted Checkout
(Payment Sheet is Stripe's officially recommended pattern).

(1) Edge function returns stripeAccountId + Connect-scoped Customer +
    ephemeralKey on requires_payment.
(2) Mobile calls initStripe({ publishableKey, stripeAccountId, ... }) per-PI
    before initPaymentSheet; passes customerId + customerEphemeralKeySecret
    to initPaymentSheet.
(3) Remove withTimeout wrappers from both initPaymentSheet and
    presentPaymentSheet (the once-only guards stay).
(4) Drop allowsDelayedPaymentMethods: false (redundant under card-only PI).

Invariants: ESTABLISH I-PROPOSED-STRIPE-CONNECT-ACCOUNT-ID-PER-PI; AMEND
I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG (now requires per-PI initStripe with
stripeAccountId for Connect direct-charges); RETIRE
I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE; PRESERVE
I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY + I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES
unchanged.

Hosted-Checkout pivot (Option B) explicitly REJECTED — that path was correct
for mingla-business (whose StripeNativeProvider was a no-op shim) but would
regress explorer away from Stripe's officially recommended mobile pattern.
Option B remains reserved as fallback if Option A demonstrably fails on
TEST after a clean cycle.

Supersedes: DEC-154-era "Stripe RN is fundamentally broken on iOS 26"
framing. The bug was specific config gaps × upstream-regression-class, not
wholesale SDK breakage.
```

#### 3.6.2 INVARIANT_REGISTRY updates — to be applied by orchestrator at CLOSE

| Invariant | Action | Body |
|---|---|---|
| `I-PROPOSED-STRIPE-CONNECT-ACCOUNT-ID-PER-PI` | **ESTABLISH (DRAFT → ACTIVE at CLOSE)** | "Every PaymentSheet `initPaymentSheet` call for a connected-account PaymentIntent (i.e., every PI created with `{ stripeAccount }` request option) MUST be preceded in the same call stack by `initStripe({ publishableKey, stripeAccountId, merchantIdentifier, urlScheme })` with the matching `stripeAccountId` returned from the server. Enforced by `.github/scripts/strict-grep/orch-0844-stripe-connect-account-id-per-pi.mjs` (T-G1..T-G4)." |
| `I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG` | **AMEND** | Existing "full config = `{ publishableKey, merchantIdentifier, urlScheme }`" definition is extended: when the app issues PaymentIntents on connected accounts (i.e., post-ORCH-0843), the "full config" requirement applies PER-PI via `initStripe(...)` rather than once at provider mount, because `stripeAccountId` is per-transaction. Provider mount config remains the platform-level baseline. |
| `I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE` | **RETIRE** | DEC-157 supersedes. The dashboard-fan-out hang this guarded was resolved at the PI level by ORCH-0837 card-only PIs; the timeout itself became a double-settle vector on iOS 26. CI gate flipped to enforce absence. |
| `I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY` | **PRESERVE** | Once-only `inFlightInitRef`/`inFlightPresentRef` guards remain — they suppress JS-side double-Promise creation on double-tap (a different mechanism than the native double-resolve). |
| `I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES` | **PRESERVE** | `payment_method_types: ['card']` remains the canonical PI shape. |
| `I-PROPOSED-STRIPE-CALLBACK-WIRED` | **PRESERVE** | `handleURLCallback` wiring at `app/index.tsx:1803-1835` stays (load-bearing for future redirect-method re-enable; harmless no-op today). |

The implementor does NOT edit `INVARIANT_REGISTRY.md` directly — orchestrator owns that artifact at CLOSE per `feedback_orchestrator_deploys_edge_functions.md` separation-of-concerns.

## 4. SUCCESS CRITERIA (numbered, observable, testable)

- **SC-01** On iOS 26 simulator with a fresh explorer dev build, a buyer can complete a £1.00 paid-ticket purchase using card `4242 4242 4242 4242` without seeing the "tried to resolve a promise more than once" RN bridge warning in Metro logs.
- **SC-02** PaymentSheet renders the card-entry form within ≤3 seconds of `presentPaymentSheet()` being called (no 60s loading-skeleton, no 90s self-dismiss).
- **SC-03** The `pi_…` created on a connected account is confirmable from within PaymentSheet (verified via Stripe Dashboard → Connected Account → Payments → succeeded), with `application_fee_amount` = 1.5% of total (ORCH-0843 charge shape preserved) and `statement_descriptor_suffix` = "MINGLA".
- **SC-04** On `presentPaymentSheet()` cancel (buyer taps the sheet's close affordance), the JS Promise resolves once with `result.error.code === "Canceled"`, the in-flight ref clears, and a second buy attempt within the same session re-opens a fresh sheet (no lockout).
- **SC-05** On a deliberate card decline (e.g., `4000 0000 0000 0002`), the JS Promise resolves once with `result.error.code === "Failed"`, the toast `"Payment failed."` (or Stripe's localized message) shows, and the buyer can retry.
- **SC-06** Apple Pay path remains gated (no Apple Pay button in the sheet today — ORCH-0838 unblocked but not delivered here); the sheet shows only card. (Verifies A-4 removal didn't accidentally surface Apple Pay before its merchant-cert work lands.)
- **SC-07** Free ticket (`kind: "free_completed"`) flow is unchanged: no `initStripe`, no `initPaymentSheet`, no `presentPaymentSheet`. Success toast fires from the existing branch.
- **SC-08** Edge function `requires_payment` response includes non-empty `stripeAccountId` (string, starts with `acct_`); `customerId` is either a non-empty string starting with `cus_` OR `null`; `customerEphemeralKeySecret` is paired with `customerId` (both present or both null).
- **SC-09** When Stripe customers-API is unreachable (simulated by transient error in customer-creation block), the edge function returns `requires_payment` with `customerId: null` and `customerEphemeralKeySecret: null` (non-fatal), and the mobile sheet still opens in guest mode and completes successfully.
- **SC-10** ORCH-0843 refund flow (per `IMPLEMENTATION_ORCH-0843_*` §refunds) is unchanged: refund-on-connected-account succeeds without any platform-context error.
- **SC-11** CI gate `orch-0844-stripe-connect-account-id-per-pi.mjs` fails the PR when any of T-G1..T-G4 is violated (verified by adversarial trip: temporarily delete the `initStripe` import, run the gate locally, observe FAIL).
- **SC-12** Flipped ORCH-0829-B D-1 regression-check fails the PR if `withTimeout` is re-introduced (verified by adversarial trip: temporarily re-add `PAYMENT_SHEET_TIMEOUT_MS = 60_000` to the hook, run the check, observe FAIL).
- **SC-13** Zero new TypeScript errors introduced in `app-mobile/`, `packages/payments-native/`, `supabase/functions/ticket-checkout-create/` (verified by `npx tsc --noEmit` per app + Deno's edge-function check).

## 5. TEST CASES (13 numbered)

| ID | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| **T-01** | Happy-path paid ticket on iOS 26 sim | £1 paid ticket; card 4242 4242 4242 4242; CVC 424; exp 12/34; zip 42424 | Sheet opens ≤3s, card form renders, tap Pay → success toast → ticket on calendar; zero "promise more than once" warning in Metro | Full stack |
| **T-02** | Happy-path paid ticket on Android emulator | Same as T-01 | Same behavior on Android; verify parity (Android Maestro flow or manual) | Full stack |
| **T-03** | Cancel via close button | Open sheet, tap close | `result.error.code === "Canceled"`; in-flight ref clears; second Pay tap re-opens fresh sheet | Mobile hook + UI |
| **T-04** | Card decline | Card `4000 0000 0000 0002` | `result.error.code === "Failed"`; toast surfaces; buyer can retry | Mobile + Stripe |
| **T-05** | Free ticket | £0 ticket | No PaymentSheet path; success from `free_completed` branch | Edge fn + Mobile |
| **T-06** | Customer-creation transient failure | Mock `stripe.customers.search` to throw once | Edge fn returns `requires_payment` with `customerId: null`, `customerEphemeralKeySecret: null`; sheet still opens in guest mode; T-01 happy path completes | Edge fn + Mobile |
| **T-07** | Existing customer on connected account | Second purchase by same buyer email | `customers.search` returns the existing customer; no new customer created; ephemeralKey created fresh; sheet shows saved-PM option (or guest entry if none saved) | Edge fn |
| **T-08** | Refund via Stripe Dashboard (ORCH-0843 invariant) | Issue a refund on the connected-account PI from Dashboard | Refund succeeds; no platform-context 404; webhook fires; mingla order row reflects refund | Stripe + webhook |
| **T-09** | Apple Pay gate (ORCH-0838 boundary) | Open sheet on iOS sim with Apple Pay configured at OS level | No Apple Pay button (PI is card-only); no behavioral regression | Mobile + Stripe |
| **T-10** | CI gate adversarial — T-G1 trip | Delete `initStripe` import from `nativeCheckoutFlow.ts`; run gate locally | Gate FAILs with T-G1 detail message | CI |
| **T-11** | CI gate adversarial — T-G3 trip | Remove `stripeAccountId` from edge-fn `requires_payment` response; run gate locally | Gate FAILs with T-G3 detail message | CI |
| **T-12** | Flipped regression-check adversarial — T-A6 trip | Re-add `PAYMENT_SHEET_TIMEOUT_MS = 60_000` to `useStripePaymentSheet.ts`; run check locally | Check FAILs with flipped T-A6 detail message | CI |
| **T-13** | `application_fee_amount` preservation | Inspect created PI on Stripe Dashboard for £10 ticket (15p platform cut at 1.5%) | PI has `application_fee_amount: 15` and `transfer_data` is null/absent (direct-charge shape, not destination-charge) | Stripe + Edge fn |

Every test case maps to ≥1 success criterion: T-01,T-02,T-03 → SC-01..SC-04; T-04 → SC-05; T-05 → SC-07; T-06,T-09 → SC-09,SC-06; T-07 → SC-08; T-08,T-13 → SC-10,SC-03; T-10,T-11 → SC-11; T-12 → SC-12.

## 6. INVARIANTS

### 6.1 New invariants this SPEC establishes

| ID | Status | Body | CI gate |
|---|---|---|---|
| `I-PROPOSED-STRIPE-CONNECT-ACCOUNT-ID-PER-PI` | DRAFT → ACTIVE at CLOSE | Every `initPaymentSheet` for a connected-account PI MUST be preceded by `initStripe({ publishableKey, stripeAccountId, merchantIdentifier, urlScheme })` with the server-returned `stripeAccountId`. | `orch-0844-stripe-connect-account-id-per-pi.mjs` T-G1..T-G4 |

### 6.2 Amended

| ID | Amendment |
|---|---|
| `I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG` | Definition of "full config" extended: for connected-account PIs the config applies per-PI via `initStripe`, not just at provider mount. |

### 6.3 Retired

| ID | Reason |
|---|---|
| `I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE` | DEC-157 supersedes. Hang it guarded was resolved at PI level by ORCH-0837; timeout itself became a double-settle vector. |

### 6.4 Preserved (no change)

- `I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY` — JS-side once-only guards stay.
- `I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES` — `payment_method_types: ['card']` stays.
- `I-PROPOSED-STRIPE-CALLBACK-WIRED` — `handleURLCallback` wiring stays.
- `I-PROPOSED-CHECKOUT-EXPIRY-TOMBSTONE` — migration + handleBuy try/finally stay.
- ORCH-0843 charge-shape invariants (direct charge, 1.5% application_fee_amount, statement_descriptor_suffix MINGLA) — preserved.
- Constitution Rule 3 (no silent failures) — customer-creation failure surfaces as a warn log; mobile UX is unaffected (guest fallback is intentional, not silent).

## 7. IMPLEMENTATION ORDER (mandatory sequencing)

1. **Edge function** (`supabase/functions/ticket-checkout-create/index.ts`)
   - Add `STRIPE_API_VERSION` to the import line from `_shared/stripe.ts`.
   - Insert the customer + ephemeralKey block (§3.2.3) after line 544.
   - Extend the `requires_payment` response (§3.2.2) with three new fields.
   - **STOP** for orchestrator deploy gate. Implementor does NOT run `supabase functions deploy ticket-checkout-create` — orchestrator owns that per `feedback_orchestrator_deploys_edge_functions.md`. Implementor reports "edge function changes complete, awaiting orchestrator deploy."

2. **Hook** (`packages/payments-native/useStripePaymentSheet.ts`)
   - Delete `PAYMENT_SHEET_TIMEOUT_MS`, `withTimeout`, and the iOS-26 timeout-race header block.
   - Inline the native calls in both IIFEs.
   - Add new ORCH-0844 header comment (§3.3.3).
   - Optionally clean up `"Timeout"` from `packages/payments-native/types.ts` (implementor choice).

3. **Glue** (`app-mobile/src/payments/nativeCheckoutFlow.ts`)
   - Add `initStripe` import.
   - Extend the `CheckoutCreateResponse` type.
   - Insert the `initStripe({ ... })` call before `initPaymentSheet`.
   - Add `customerId` + `customerEphemeralKeySecret` to `initPaymentSheet` (spread-conditional).
   - Remove `allowsDelayedPaymentMethods: false`.

4. **CI gates**
   - Create `.github/scripts/strict-grep/orch-0844-stripe-connect-account-id-per-pi.mjs` (T-G1..T-G4).
   - Wire into `.github/workflows/strict-grep-mingla-business.yml` (new job + comment-block registration).
   - Flip `app-mobile/scripts/ci/orch-0829b-d1-regression-check.mjs` T-A6..T-A9 to absence assertions; update header comment + detail strings.

5. **Adversarial trips** (implementor MUST run these before reporting completion)
   - Trip T-G1 (delete `initStripe` import locally; run gate; observe FAIL; restore).
   - Trip T-G3 (remove `stripeAccountId` from edge-fn response; run gate; observe FAIL; restore).
   - Trip flipped T-A6 (re-add `PAYMENT_SHEET_TIMEOUT_MS` to hook; run check; observe FAIL; restore).

6. **Type-checks**
   - `cd app-mobile && npx tsc --noEmit`
   - `cd packages/payments-native && npx tsc --noEmit` (if standalone tsconfig; otherwise app-level check suffices)
   - Deno check the edge function (if Mingla repo has a per-function check script; otherwise visual + lint).

7. **Implementation report** at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0844_EXPLORER_PAYMENTSHEET_CONNECT_ACCOUNT_ID.md`
   - Old → new code diffs for every file
   - Adversarial-trip evidence (paste FAIL output for each)
   - DEC-157 draft block at the top
   - Invariant-registry change list
   - Outstanding gates (the edge-function deploy gate for the orchestrator)

## 8. REGRESSION PREVENTION

| Bug class | Prevention |
|---|---|
| Future Connect-account-ID gap on a new PI surface | `I-PROPOSED-STRIPE-CONNECT-ACCOUNT-ID-PER-PI` + T-G1..T-G4. Any new mobile-PI path must wire `initStripe` per-PI or CI fails. |
| Future return of JS-side timeout race | Flipped `orch-0829b-d1-regression-check.mjs` T-A6..T-A9 (absence assertion). |
| Future provider-config drift between `_layout.tsx` and `nativeCheckoutFlow.ts` `initStripe(...)` | Comment in §3.4.3 mandates joint update. Optional follow-up: extract `STRIPE_NATIVE_PROVIDER_DEFAULTS` constant in `packages/payments-native/` so both call sites import from one source. SPEC neutral on this enhancement; orchestrator decides. |
| Future customer-creation failure cascading to ticket-sale block | `try/catch` in §3.2.3 makes customer failure non-fatal; T-06 verifies guest-mode fallback. |
| Future store rejection from undisclosed third-party PII handling | Stripe customer creation by email is covered under existing Stripe DPA + privacy policy disclosure (no new PII surface). |

## 9. PROTECTIVE COMMENTS

Each new code block (initStripe re-init in `nativeCheckoutFlow.ts`, customer/ephemeralKey block in edge fn, header comment in `useStripePaymentSheet.ts`) MUST include an inline comment explaining the "why" — specifically referencing ORCH-0844, the connected-account direct-charge architecture (ORCH-0843), and the iOS-26 double-resolve mechanism. Implementor MUST NOT collapse these to one-liners; future readers need the full causal chain.

## 10. HARD GUARDS (re-emphasized for implementor)

- **Do NOT pivot to Hosted Checkout.** Operator confirmed Option A.
- **Do NOT change** `payment_method_types: ['card']` PI shape (ORCH-0837 invariant).
- **Do NOT unwire** `handleURLCallback` (H-1 disproven in investigation).
- **Do NOT touch** `packages/payments-native/StripeNativeProvider.tsx`. Re-init happens via `initStripe` in `nativeCheckoutFlow.ts`, not via provider prop.
- **Do NOT change** the ORCH-0843 charge shape (direct charges + 1.5% fee + statement_descriptor_suffix MINGLA stay).
- **Do NOT run** `supabase functions deploy ticket-checkout-create` — orchestrator owns the deploy.
- **Do NOT run** `supabase db push` — there are no migrations in this SPEC.
- **Do NOT widen scope** to ORCH-0838 (Apple Pay re-enable). That is a separate ORCH; this SPEC unblocks it conceptually but does NOT deliver it.
- **Do NOT persist** `stripe_customer_id` in `ticket_checkout_sessions`. Out of scope here (separate ORCH if needed).

## 11. ROLLBACK

Each fix is independently revertible:
- **A-1** revert: remove `initStripe` call from `nativeCheckoutFlow.ts`; remove three new fields from edge-fn response.
- **A-2** revert: re-introduce `PAYMENT_SHEET_TIMEOUT_MS` constant, `withTimeout` helper, and wrap both native calls.
- **A-3** revert: delete the customer+ephemeralKey block from the edge function; drop the spread-conditional from `initPaymentSheet`.
- **A-4** revert: re-add `allowsDelayedPaymentMethods: false` to `initPaymentSheet`.

CI gates revert by deleting the new script and removing the new workflow job. Flipped regression-check reverts by un-flipping T-A6..T-A9.

## 12. OPEN QUESTIONS (none load-bearing)

- Should `STRIPE_NATIVE_PROVIDER_DEFAULTS = { merchantIdentifier, urlScheme }` be extracted to a shared constant to prevent drift between `_layout.tsx` and `nativeCheckoutFlow.ts`? Recommended follow-up; not in scope.
- Should `stripe_customer_id` be persisted on `ticket_checkout_sessions` for analytics? Recommended follow-up; not in scope.
- If Stripe RN ships 0.66.x with the upstream #2464 fix, should we re-evaluate any remaining defensive code? Orchestrator-tracked; not in scope.

---

**End of SPEC. Implementor reads this top-to-bottom before writing a single line of code.**
