# SPEC — ORCH-0849: Stripe payment-method parity across consumer + mingla-business

**Mode:** SPEC (no implementation)
**Skill:** Claude `mingla-forensics`
**Date:** 2026-05-15
**Investigation:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md`](../reports/INVESTIGATION_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md)
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md` (PRIVATE_PROMPT_NOT_VERSIONED — gitignored)
**Bundle authorization:** operator pre-approved per Working-Branch Discipline rule 5 ("we do them together to ensure parity"), 2026-05-15
**Implementor:** Codex `implementor-mingla` (default IMPLEMENT owner)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Confidence:** High — investigation was `root cause proven` on F-1 and F-2; this spec binds the implementor to the investigation's §8 SPEC scope clauses with no widening.

---

## 1. Summary (layman first)

Two coupled changes, one bundled implementation:

(a) **Consumer:** expand `payment_method_types` from `["card"]` to a curated allowlist `["card", "link", "apple_pay", "google_pay"]`. This re-enables Apple Pay, Google Pay, and Link inside PaymentSheet. Safe under ORCH-0844 [Explorer PaymentSheet — Connect account ID per-PI + 60s timeout removal]'s three load-bearing fixes (initStripe per-PI with stripeAccountId, Customer + ephemeralKey, withTimeout removal).

(b) **Mingla-business:** retire ORCH-0839-B [Stripe Hosted Checkout pivot]. Adopt the same native PaymentSheet pattern as consumer — same SDK, same edge-function response shape, same nativeCheckoutFlow pattern. Requires EAS rebuild (adds native Stripe RN module back).

After this lands, both apps render the same expanded sheet with Card + Link + Apple Pay + Google Pay buttons. Card-only PI is retired. Hosted Checkout is retired.

---

## 2. Scope, Non-Goals, Assumptions

### 2.1 Scope (LOCKED — implementor must not widen)

**S-1.** Edge function `supabase/functions/ticket-checkout-create/index.ts` — replace hardcoded `payment_method_types: ["card"]` (line ~480) with a curated allowlist sourced from a new shared module.

**S-2.** New file `supabase/functions/_shared/stripePaymentMethods.ts` — exports:
- `MINGLA_PM_ALLOWLIST: readonly ["card", "link", "apple_pay", "google_pay"]` (frozen literal)
- `getPaymentMethodTypes(): readonly string[]` (returns `MINGLA_PM_ALLOWLIST` slice; future-proofs for per-surface or per-account variants)

**S-3.** Update CI gate `.github/scripts/strict-grep/orch-0837-regression-check.mjs`:
- Keep T-C1 (forbids `automatic_payment_methods: { enabled: true }`).
- AMEND existing check that asserts `payment_method_types: ["card"]` — replace with assertion that `payment_method_types` is set AND its value is sourced from `MINGLA_PM_ALLOWLIST` (presence-check for the import + spread).

**S-4.** Add `@stripe/stripe-react-native` dependency to `mingla-business/package.json` at the SAME version pinned in `app-mobile/package.json` (currently `0.65.x`). Lockfile updated.

**S-5.** Add Stripe plugin entry to `mingla-business/app.json`:
```jsonc
{
  "plugins": [
    // existing plugins...
    [
      "@stripe/stripe-react-native",
      {
        "merchantIdentifier": "merchant.com.mingla.business.v2",
        "enableGooglePay": true
      }
    ]
  ]
}
```

**S-6.** Mount `<StripeNativeProvider>` at `mingla-business/app/_layout.tsx` root, mirror of consumer at `app-mobile/app/_layout.tsx:72-83`:
```tsx
<StripeNativeProvider
  merchantIdentifier="merchant.com.mingla.business.v2"
  urlScheme="com.mingla.business.v2"
>
  {/* existing root tree */}
</StripeNativeProvider>
```
Remove the existing comment "Hosted Stripe Checkout via expo-web-browser needs no provider" at line 36.

**S-7.** Create `mingla-business/src/payments/nativeCheckoutFlow.ts` — exact mirror of `app-mobile/src/payments/nativeCheckoutFlow.ts`, with two adaptations:
- Imports `supabase` from `mingla-business`'s supabase client (not `app-mobile`'s)
- `merchantIdentifier`/`urlScheme` passed to `initStripe({...})` are the business values

The file body is otherwise copy-pasted from the consumer version. The shared logic (initStripe-per-PI, initPaymentSheet with customer+ephemeralKey, presentPaymentSheet, outcome union) lives in `@mingla/payments-native` already; this file is the per-app glue.

**S-8.** Replace `mingla-business/app/checkout/[eventId]/payment.tsx` body — swap from `WebBrowser.openAuthSessionAsync` to invoking the new `nativeCheckoutFlow` mirror. Top-level imports change from `expo-web-browser` to `useStripePaymentSheet` + the new `nativeCheckoutFlow`. The buyer-info form, confirm-screen routing, and other surrounding UI stay unchanged.

**S-9.** Delete `mingla-business/src/components/checkout/PaymentElementStub.tsx` (dead `[TRANSITIONAL]` marker per investigation F-5). Confirm zero importers via grep before deletion.

**S-10.** Retire CI gate `.github/scripts/strict-grep/orch-0839-b-mingla-business-no-native-stripe.mjs`. Steps: (a) delete the script file, (b) remove the corresponding job from `.github/workflows/strict-grep-mingla-business.yml`, (c) remove the registry comment line.

**S-11.** Add NEW CI gate `.github/scripts/strict-grep/i-stripe-paymentsheet-parity.mjs`:
- Asserts `app-mobile/app/_layout.tsx` mounts `<StripeNativeProvider>` with `merchantIdentifier` AND `urlScheme` props
- Asserts `mingla-business/app/_layout.tsx` mounts `<StripeNativeProvider>` with `merchantIdentifier` AND `urlScheme` props
- Asserts both `app-mobile/src/payments/nativeCheckoutFlow.ts` AND `mingla-business/src/payments/nativeCheckoutFlow.ts` exist and import `initStripe` from `@stripe/stripe-react-native`
- Asserts both files call `initStripe({...})` with a `stripeAccountId` key
- Asserts both files call `initPaymentSheet({...})` with both `customer` AND `customerEphemeralKeySecret` keys
- Modeled on `i-ari-no-oklch.mjs` (regex-style, single-file scans, presence-check)
- Register in `.github/workflows/strict-grep-mingla-business.yml` per memory `feedback_strict_grep_registry_pattern.md` (one script + one job)

**S-12.** Add NEW CI gate `.github/scripts/strict-grep/i-stripe-pm-method-allowlist.mjs`:
- Scans `supabase/functions/ticket-checkout-create/index.ts`
- Asserts `payment_method_types` value is sourced from an identifier matching `MINGLA_PM_ALLOWLIST` or `getPaymentMethodTypes(` (not a hardcoded array literal)
- Forbids any hardcoded `["card"]` or `[...]` array literal as the value
- Forbids `automatic_payment_methods` (preserves ORCH-0837 invariant)
- Register in workflow per the registry pattern

**S-13.** Update `Mingla_Artifacts/INVARIANT_REGISTRY.md`:
- AMEND I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES (ORCH-0837) — change text from "card-only" to "sourced from `MINGLA_PM_ALLOWLIST` allowlist constant; NEVER `automatic_payment_methods: { enabled: true }`; allowlist expansion requires a new ORCH that proves redirect-flow / delayed-method plumbing"
- RETIRE I-PROPOSED-MINGLA-BUSINESS-HOSTED-CHECKOUT-ONLY (ORCH-0839-B) — flip status to RETIRED with cross-reference to ORCH-0849 close
- ADD NEW I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY (DRAFT → flips ACTIVE on ORCH-0849 CLOSE) — both apps mount StripeNativeProvider, both call initStripe with stripeAccountId per-PI, both consume the same edge-fn `requires_payment` response shape
- ADD NEW I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST (DRAFT → ACTIVE on CLOSE) — `payment_method_types` sourced from allowlist constant

**S-14.** Update `Mingla_Artifacts/DECISION_LOG.md` — new DEC entry (next available DEC-ID) documenting:
- ORCH-0849 closes the bundled consumer expansion + business re-pivot
- Phase 1 PM allowlist: Card + Link + Apple Pay + Google Pay
- Phase 2 deferred: Cash App Pay, Klarna, Afterpay, ACH, SEPA, regional redirect methods (each needs separate ORCH proving redirect-flow / delayed-method plumbing)
- ORCH-0838 [Apple Pay merchant cert verification + re-enable] is ABSORBED into ORCH-0849 close

### 2.2 Non-goals (OUT of scope — implementor must NOT touch)

**NG-1.** Cash App Pay — needs live-fire validation of urlScheme deep-link return; Phase 2 ORCH.

**NG-2.** Klarna / Afterpay / Clearpay — redirect-flow methods; need `handleURLCallback` independent verification; Phase 2 ORCH.

**NG-3.** ACH / SEPA Debit — delayed payment methods; need `allowsDelayedPaymentMethods: true`, webhook routing for `payment_intent.processing`, and a "ticket pending" UX; Phase 2 ORCH.

**NG-4.** iDEAL / Bancontact / EPS / P24 / regional redirect methods — out of scope; low US demand.

**NG-5.** `charge.dispute.created` webhook routing (ORCH-0843-FOLLOWUP-DISPUTES, P1) — cross-referenced in investigation §10 #1 but NOT absorbed; stays as a separate ORCH. Phase 1 allowlist doesn't include any method with novel dispute mechanics.

**NG-6.** `customerId: null` guest-mode investigation (ORCH-0844 P3 follow-up) — orthogonal; separate ORCH.

**NG-7.** Refactoring `application_fee_amount` to dynamic per-brand config — orthogonal.

**NG-8.** Centralizing "is past" semantics across Discover + PublicEventPage + Checkout (ORCH-0845 [Discover excludes ended events] discovery #1) — orthogonal.

**NG-9.** Changing the direct-charge architecture (DEC-156 [ORCH-0843 Charge-Shape Reconciliation]) — preserved verbatim.

**NG-10.** Changing the sticky-controller properties / Connect onboarding posture (DEC-154) — preserved verbatim.

**NG-11.** Any new schema migration — `payments.payment_method_type` is already TEXT and accepts arbitrary Stripe method strings. Verified during investigation.

**NG-12.** Refactoring Stripe Connect Embedded Components used for mingla-business onboarding (`@stripe/connect-js` + `@stripe/react-connect-js` — only consumed by `mingla-business/app/connect-onboarding.tsx`). Untouched. Implementor must NOT remove these dependencies.

### 2.3 Assumptions (operator-side prereqs the implementor must verify before opening PR)

**A-1.** Operator has registered Apple Pay merchant identifier `merchant.com.mingla.business.v2` in Stripe Dashboard for the Mingla platform Stripe account, with merchant cert verified active. Implementor checks via `https://dashboard.stripe.com/settings/payments/apple_pay` and confirms cert green.

**A-2.** Operator has verified existing Apple Pay merchant identifier `merchant.com.mingla.app.v2` (consumer) cert is still active.

**A-3.** Operator has confirmed at least one charges-enabled connected account has Apple Pay + Link + Google Pay enabled in their per-account payment-method-configuration. Implementor probes via `https://api.stripe.com/v1/payment_method_configurations` with the `Stripe-Account` header on at least one live brand and includes the result in the implementation report.

**A-4.** Apple Pay domain-association files are hosted at the correct URLs for both merchant identifiers per Stripe's domain verification requirements.

**A-5.** Stripe RN SDK version `0.65.x` (the same version pinned in `app-mobile/package.json`) is compatible with the current `mingla-business` Expo / RN version. Implementor cross-checks `mingla-business/package.json` Expo + RN versions against the consumer's, confirms compatibility per Stripe's compatibility matrix at `https://github.com/stripe/stripe-react-native#installation`, and documents the comparison in the implementation report.

**A-6.** `application_fee_amount` (1.5% per DEC-156) applies identically to all PM types in the allowlist — verified per Stripe docs (`https://docs.stripe.com/connect/direct-charges#collect-fees`): direct-charge `application_fee_amount` is method-agnostic.

**A-7.** The EAS build queue is available; implementor opens PR with explicit "this requires `eas build` for mingla-business; OTA not safe" note.

If ANY of A-1..A-4 fails verification, the implementor MUST stop and surface to operator before code changes. A-5..A-7 are documented confirmations only.

---

## 3. Layer-by-layer specification

### 3.1 Database

**No schema changes.** Verified during investigation: `payments.payment_method_type` is TEXT (no enum constraint). Webhook routing already covers `payment_intent.succeeded` + `charge.succeeded` + `charge.refunded` which fire for all four allowlisted methods identically. The implementor must include a one-line confirmation in the report citing the migration that defines the column.

### 3.2 Edge function — `supabase/functions/ticket-checkout-create/index.ts`

#### 3.2.1 New shared module

Create `supabase/functions/_shared/stripePaymentMethods.ts`:

```ts
/**
 * ORCH-0849 — curated Stripe payment-method allowlist for Mingla ticket
 * checkout PaymentIntents.
 *
 * Phase 1 allowlist (this ORCH): card + link + apple_pay + google_pay.
 * All four are direct-charge-compatible (Stripe-Account header), require no
 * redirect-flow plumbing beyond what ORCH-0834-rescoped/ORCH-0837 already
 * wired (urlScheme + handleURLCallback), and require no delayed-method
 * webhook routing beyond what's already covered.
 *
 * Phase 2 candidates (separate ORCHs, NOT this one):
 *   - cash_app_pay — needs urlScheme deep-link live-fire
 *   - klarna / afterpay_clearpay — redirect-flow, needs handleURLCallback live-fire
 *   - us_bank_account / sepa_debit — delayed methods, needs payment_intent.processing
 *     webhook routing + buyer-pending UX
 *
 * Invariant: I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST — payment_method_types
 * MUST be sourced from this module; never hardcoded; never derived from
 * automatic_payment_methods.
 *
 * CI gate: .github/scripts/strict-grep/i-stripe-pm-method-allowlist.mjs.
 */

export const MINGLA_PM_ALLOWLIST = [
  "card",
  "link",
  "apple_pay",
  "google_pay",
] as const;

export type MinglaPaymentMethod = (typeof MINGLA_PM_ALLOWLIST)[number];

/**
 * Returns the payment_method_types array for a new PaymentIntent.
 * Currently returns the full allowlist unconditionally. Future variants
 * (per-surface or per-connected-account filtering) can branch here without
 * changing call sites.
 */
export function getPaymentMethodTypes(): readonly MinglaPaymentMethod[] {
  return MINGLA_PM_ALLOWLIST;
}
```

#### 3.2.2 Required diff to `ticket-checkout-create/index.ts`

At the top of the file, add:
```ts
import { getPaymentMethodTypes } from "../_shared/stripePaymentMethods.ts";
```

At line ~480, replace:
```ts
payment_method_types: ["card"],
```
with:
```ts
// ORCH-0849 — sourced from curated allowlist (Card + Link + Apple Pay +
// Google Pay). See _shared/stripePaymentMethods.ts and invariant
// I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST.
payment_method_types: [...getPaymentMethodTypes()],
```

The `[...getPaymentMethodTypes()]` spread produces a mutable `string[]` that PostgREST's Stripe SDK type accepts. No other line in the file changes.

#### 3.2.3 Response shape — UNCHANGED

The `requires_payment` response already returns `{ stripeAccountId, customerId, customerEphemeralKeySecret }` per ORCH-0844. Business will consume this same shape; no edge-fn response changes needed.

#### 3.2.4 `verify_jwt` — UNCHANGED

`ticket-checkout-create` `verify_jwt: false` (anon-callable for guest buyers) — preserved. Implementor verifies via `mcp__supabase__list_edge_functions` post-deploy.

### 3.3 Mobile (app-mobile / consumer)

**No code changes.** The consumer side gets the new allowlist automatically via the edge function. Verify post-deploy that PaymentSheet renders all four methods on a charges-enabled brand.

### 3.4 Mobile (mingla-business)

#### 3.4.1 `mingla-business/package.json`

Add (preserving alphabetical order):
```jsonc
{
  "dependencies": {
    "@stripe/stripe-react-native": "0.65.x",  // pin to same version as app-mobile
    // existing deps unchanged
  }
}
```

Also remove the script `test:orch-0839-b` (line ~10 of package.json scripts block — points to a gate that's being retired).

Run `npm install` (or operator runs); commit the updated `package-lock.json` / `yarn.lock`.

#### 3.4.2 `mingla-business/app.json`

Add to the `plugins` array (preserving order of existing entries):
```jsonc
[
  "@stripe/stripe-react-native",
  {
    "merchantIdentifier": "merchant.com.mingla.business.v2",
    "enableGooglePay": true
  }
]
```

#### 3.4.3 `mingla-business/app/_layout.tsx`

At line 36, remove the comment "Hosted Stripe Checkout via expo-web-browser needs no provider — pivot."

Import:
```tsx
import { StripeNativeProvider } from "@mingla/payments-native";
```

Wrap the existing root tree:
```tsx
<StripeNativeProvider
  merchantIdentifier="merchant.com.mingla.business.v2"
  urlScheme="com.mingla.business.v2"
>
  {/* existing root tree (do not modify) */}
</StripeNativeProvider>
```

Mount point must be ABOVE the navigation root so PaymentSheet has access to the provider context from any checkout screen.

#### 3.4.4 `mingla-business/src/payments/nativeCheckoutFlow.ts` (NEW file)

Copy `app-mobile/src/payments/nativeCheckoutFlow.ts` verbatim. Adapt only two things:
- Change `import { supabase } from "../services/supabase"` to whatever the business supabase client path is (likely `import { supabase } from "../lib/supabase"` — implementor confirms).
- The `initStripe({...})` call's `merchantIdentifier` + `urlScheme` values come from the same business values as the provider above; pull from props or hardcode-mirror the provider values (whichever the consumer does — implementor mirrors).

Do NOT introduce new abstractions. The point of this mirror is parity; if the consumer file has a particular shape, the business file has the same shape with only the two adaptations above.

#### 3.4.5 `mingla-business/app/checkout/[eventId]/payment.tsx`

Strip out the entire `expo-web-browser` + `openAuthSessionAsync` flow (lines ~40, 71–73, 215, 218, 273, 276 per investigation citations). Replace with:
```tsx
import { useStripePaymentSheet } from "@mingla/payments-native";
import { nativeCheckoutFlow } from "../../../src/payments/nativeCheckoutFlow";
// (remove `import * as WebBrowser from "expo-web-browser";`)
```

Replace the `WebBrowser.openAuthSessionAsync(...)` call with a `nativeCheckoutFlow({...})` invocation. The function returns the discriminated union `{ outcome: "succeeded"|"canceled"|"failed", ... }` — branch on `outcome` and route to the appropriate screen (success → `/checkout/[eventId]/confirm`, canceled → stay on payment screen, failed → toast + stay). Mirror the routing logic from the consumer's `nativeCheckoutFlow` consumer at `app-mobile/src/payments/...` (implementor reads the consumer caller and mirrors).

#### 3.4.6 `mingla-business/src/components/checkout/PaymentElementStub.tsx`

DELETE. Implementor confirms zero importers via `grep -rn "PaymentElementStub" mingla-business/` before deletion (expected: zero or only the file itself). Stage as `git rm`.

### 3.5 CI gates

#### 3.5.1 Update existing — `.github/scripts/strict-grep/orch-0837-regression-check.mjs`

Preserve T-C1 (forbids `automatic_payment_methods: { enabled: true }`).

Amend the check that asserts `payment_method_types: ["card"]` literal — replace with:
- Assert `payment_method_types` appears in `ticket-checkout-create/index.ts` (any value)
- Assert the value is `[...getPaymentMethodTypes()]` (spread of the helper call) — substring check
- Assert `import { getPaymentMethodTypes }` exists at top of file

Implementor pattern-matches on the existing check structure; do not refactor the gate beyond what's needed for this amendment.

#### 3.5.2 Retire — `.github/scripts/strict-grep/orch-0839-b-mingla-business-no-native-stripe.mjs`

`git rm` the script. Remove the corresponding job block from `.github/workflows/strict-grep-mingla-business.yml`. Remove the one-line registry comment.

#### 3.5.3 New gate 1 — `.github/scripts/strict-grep/i-stripe-paymentsheet-parity.mjs`

Modeled on `i-ari-no-oklch.mjs`. Single-file regex-style scans. Detection rules:
- File `app-mobile/app/_layout.tsx` contains `<StripeNativeProvider` AND `merchantIdentifier="merchant.com.mingla.app.v2"` AND `urlScheme="com.mingla.app.v2"`
- File `mingla-business/app/_layout.tsx` contains `<StripeNativeProvider` AND `merchantIdentifier="merchant.com.mingla.business.v2"` AND `urlScheme="com.mingla.business.v2"`
- File `app-mobile/src/payments/nativeCheckoutFlow.ts` exists AND contains `initStripe(` AND `stripeAccountId`
- File `mingla-business/src/payments/nativeCheckoutFlow.ts` exists AND contains `initStripe(` AND `stripeAccountId`
- Both nativeCheckoutFlow files contain both `customer` AND `customerEphemeralKeySecret` (as keys passed to initPaymentSheet)

Exit 0 on all green; exit 1 on any miss with clear "ORCH-0849 regression: ..." message.

Register in workflow:
```yaml
  i-stripe-paymentsheet-parity:
    name: "ORCH-0849: PaymentSheet parity across consumer + business (I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY)"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Run ORCH-0849 parity gate
        run: node .github/scripts/strict-grep/i-stripe-paymentsheet-parity.mjs
```
Plus one-line registry comment under "Currently registered gates".

#### 3.5.4 New gate 2 — `.github/scripts/strict-grep/i-stripe-pm-method-allowlist.mjs`

Modeled on `i-ari-no-oklch.mjs`. Detection rules:
- File `supabase/functions/_shared/stripePaymentMethods.ts` exists and exports `MINGLA_PM_ALLOWLIST`
- File `supabase/functions/ticket-checkout-create/index.ts` contains `import { getPaymentMethodTypes }` from `../_shared/stripePaymentMethods.ts` (or `./...` relative)
- File contains `payment_method_types: [...getPaymentMethodTypes()]` substring
- File does NOT contain hardcoded `payment_method_types: ["card"]` or `payment_method_types: [` literal (filter to non-comment lines)
- File does NOT contain `automatic_payment_methods` anywhere

Register in workflow as another job with the same pattern.

### 3.6 Tests (mandatory per ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5)

#### 3.6.1 Implementor happy-path test

**Path:** `supabase/functions/ticket-checkout-create/__tests__/payment_method_allowlist.test.ts`

**Test shape (binding contract):**
- Pure-function test of `getPaymentMethodTypes()` — assert returned array has length 4 and contains exactly `["card", "link", "apple_pay", "google_pay"]` in that order
- Source-file test of `ticket-checkout-create/index.ts` — assert the import is present AND the spread call is present at the PI-create body construction site
- Anti-regression: source-file test that `payment_method_types: ["card"]` literal is ABSENT and `automatic_payment_methods` is ABSENT

**Fails-on-revert verification:** required. Revert the allowlist constant to a single-element `["card"]` array OR revert the source file to the hardcoded literal, run tests, confirm failure, restore. Cite revert commit hash in the implementation report.

#### 3.6.2 Tester adversarial regression test

**Path:** `supabase/functions/ticket-checkout-create/__tests__/payment_method_allowlist_adversarial.test.ts`

Bind to attack vectors DIFFERENT from the happy-path:
- **Attack 1 — allowlist exhaustiveness:** assert that adding a fifth element to the allowlist constant requires updating the type union `MinglaPaymentMethod` (compile-time check via Deno's TS); test that a synthetic mistyped allowlist (e.g., `["card", "ftw"]` cast through `as any`) would fail the union type at the test boundary.
- **Attack 2 — anti-regression to dashboard-fan-out:** source-file test that no `automatic_payment_methods` substring appears anywhere in the edge function source (the ORCH-0837 H2 root cause regression).
- **Attack 3 — boundary: empty allowlist:** assert that `getPaymentMethodTypes()` never returns an empty array (Stripe rejects empty `payment_method_types`).
- **Attack 4 — Phase 2 method gate:** assert that the allowlist does NOT contain `cash_app_pay`, `klarna`, `afterpay_clearpay`, `us_bank_account`, `sepa_debit`, `ideal`, `bancontact`, `eps`, `p24` — these are deferred to Phase 2 ORCHs and accidentally adding them here would skip the required Phase 2 validation work.

**Fails-on-revert verification:** required. Two separate revert paths exercising distinct attack vectors per ORCH-0840 Step 0.5 precedent (see ORCH-0845 [Discover excludes ended events] QA report for the two-revert-path template).

#### 3.6.3 Parity test (additional, lives in mingla-business)

**Path:** `mingla-business/__tests__/payments/native_checkout_flow_parity.test.ts`

Source-file structural test (no runtime):
- Asserts `mingla-business/src/payments/nativeCheckoutFlow.ts` exists and imports `initStripe` from `@stripe/stripe-react-native`
- Asserts it calls `initStripe({...})` with a `stripeAccountId` key
- Asserts it calls `initPaymentSheet({...})` with both `customer` AND `customerEphemeralKeySecret` keys
- Asserts `mingla-business/app/checkout/[eventId]/payment.tsx` does NOT import `expo-web-browser`
- Asserts `mingla-business/app/_layout.tsx` mounts `<StripeNativeProvider>` with the business merchantIdentifier

Counts as part of the implementor happy-path suite for Step 0.5 purposes (it's a separate file because it covers a separate code path).

### 3.7 Documentation updates

#### 3.7.1 `Mingla_Artifacts/INVARIANT_REGISTRY.md`

- Edit I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES (ORCH-0837) section: amend statement per S-13. Cross-reference ORCH-0849.
- Edit I-PROPOSED-MINGLA-BUSINESS-HOSTED-CHECKOUT-ONLY (ORCH-0839-B) section: change status to "RETIRED — superseded by ORCH-0849 [Stripe payment-method parity] which re-adopts native PaymentSheet on mingla-business per ORCH-0844 [Explorer PaymentSheet] pattern. Historical-context only." Move to a "Retired Invariants" subsection (create if not exists).
- Add NEW I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY (DRAFT) section per S-13. Status flips to ACTIVE on orchestrator CLOSE of ORCH-0849.
- Add NEW I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST (DRAFT) section per S-13.

#### 3.7.2 `Mingla_Artifacts/DECISION_LOG.md`

Add new DEC entry at the top (next available DEC-ID — likely DEC-158) per S-14.

#### 3.7.3 `Mingla_Artifacts/WORLD_MAP.md`

Orchestrator-owned at CLOSE — implementor does NOT edit.

---

## 4. Success criteria

| ID | Criterion | Verification |
|----|-----------|--------------|
| SC-01 | Edge function `ticket-checkout-create` source contains `import { getPaymentMethodTypes }` AND `payment_method_types: [...getPaymentMethodTypes()]` | `grep` + strict-grep gate `i-stripe-pm-method-allowlist.mjs` |
| SC-02 | Edge function source contains NO hardcoded `payment_method_types: ["card"]` AND NO `automatic_payment_methods` | strict-grep gate |
| SC-03 | New file `supabase/functions/_shared/stripePaymentMethods.ts` exists, exports `MINGLA_PM_ALLOWLIST` as a frozen-literal array of exactly four strings | `deno check` + happy-path test |
| SC-04 | `mingla-business/package.json` declares `@stripe/stripe-react-native` at the same major.minor as `app-mobile/package.json` | implementor report cite + lock file diff |
| SC-05 | `mingla-business/app.json` `plugins` array contains the Stripe RN entry with `merchantIdentifier: "merchant.com.mingla.business.v2"` AND `enableGooglePay: true` | source grep + parity gate |
| SC-06 | `mingla-business/app/_layout.tsx` mounts `<StripeNativeProvider>` at root with the business merchantIdentifier + urlScheme | parity gate |
| SC-07 | `mingla-business/src/payments/nativeCheckoutFlow.ts` exists; structurally mirrors `app-mobile/src/payments/nativeCheckoutFlow.ts`; calls `initStripe({stripeAccountId, ...})` BEFORE `initPaymentSheet({customer, customerEphemeralKeySecret, ...})` | parity gate + parity test |
| SC-08 | `mingla-business/app/checkout/[eventId]/payment.tsx` does NOT import `expo-web-browser` AND DOES invoke `nativeCheckoutFlow` | grep + parity gate |
| SC-09 | `mingla-business/src/components/checkout/PaymentElementStub.tsx` is DELETED | `git status` shows the deletion in the closing PR diff |
| SC-10 | `.github/scripts/strict-grep/orch-0839-b-mingla-business-no-native-stripe.mjs` is DELETED AND its job is removed from the workflow yml | PR diff |
| SC-11 | New strict-grep gates `i-stripe-paymentsheet-parity.mjs` and `i-stripe-pm-method-allowlist.mjs` exist, registered in the workflow, exit 0 on head, exit 1 on synthetic revert | implementor captures gate outputs in report |
| SC-12 | `INVARIANT_REGISTRY.md` reflects: ORCH-0837 invariant AMENDED; ORCH-0839-B invariant RETIRED; two new ORCH-0849 invariants ADDED as DRAFT | diff review at CLOSE |
| SC-13 | After deploy of `ticket-checkout-create`, a live HTTP probe with a charges-enabled Raleigh brand returns a `requires_payment` response containing `stripeAccountId` + `customerId` + `customerEphemeralKeySecret` (UNCHANGED — verifies no regression to ORCH-0844 contract) | orchestrator post-deploy probe |
| SC-14 | After EAS rebuild + reinstall of both apps on iOS sim, consumer PaymentSheet renders Card + Link + Apple Pay + Google Pay rows (operator's Stripe dashboard must have these enabled on the connected account) | TARGETED live-fire |
| SC-15 | After EAS rebuild + reinstall, mingla-business PaymentSheet renders the same four-method sheet | TARGETED live-fire parity |
| SC-16 | Both apps successfully complete a card payment using test card `4242 4242 4242 4242` end-to-end through PaymentSheet (sheet opens, card entered, sheet dismisses with success, order written, calendar/hub updated) | TARGETED live-fire — required for proven-level PASS |
| SC-17 | After deploy + rebuild, NO regression to ORCH-0844 fixes: `initStripe` is called per-PI (not at module load), Customer + ephemeralKey are passed to `initPaymentSheet`, NO withTimeout race wraps `presentPaymentSheet` | source check + parity gate + live test |
| SC-18 | All 8 preserved invariants from investigation §7 remain ACTIVE (verified by their existing CI gates remaining green) | CI gates passing on the PR |
| SC-19 | Diff scope limited to the files named in §3 — NO mobile changes in `app-mobile/` beyond the deployed edge function (consumer gets the new methods automatically via server-side fix); NO admin changes; NO migration files | `git diff --name-only` at REVIEW |
| SC-20 | Operator-side ops prereqs A-1..A-4 confirmed BEFORE PR open (implementor captures confirmation in the report) | implementor report + operator confirmation |

---

## 5. Invariants

### 5.1 Preserved verbatim

- I-PROPOSED-STRIPE-CHARGE-SHAPE-IS-DIRECT (ORCH-0843 [Charge-Shape Reconciliation])
- I-PROPOSED-STRIPE-APPLICATION-FEE-PRESENT (ORCH-0843)
- I-PROPOSED-STRIPE-ACCOUNT-HEADER-ON-CONNECTED-CALLS (ORCH-0843)
- I-PROPOSED-STRIPE-STATEMENT-DESCRIPTOR-SUFFIX-MINGLA (ORCH-0843)
- I-PROPOSED-STRIPE-CONNECT-ACCOUNT-ID-PER-PI (ORCH-0844 [Explorer PaymentSheet])
- I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG (ORCH-0844, amended at that close)
- I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY (ORCH-0844)
- I-PROPOSED-STRIPE-CALLBACK-WIRED (ORCH-0837 [Stripe PI card-only + handleURLCallback wired])

### 5.2 Amended

**I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES (ORCH-0837)** — amendment per S-13. New statement:
> The `ticket-checkout-create` edge function MUST set `payment_method_types` explicitly on every PaymentIntent it creates. The value MUST be sourced from `MINGLA_PM_ALLOWLIST` (or `getPaymentMethodTypes()`) in `supabase/functions/_shared/stripePaymentMethods.ts`. Hardcoded array literals at the PI-create call site are forbidden. `automatic_payment_methods: { enabled: true }` is forbidden. Allowlist expansion to new methods (Phase 2 — Cash App Pay, Klarna, ACH, etc.) requires a new ORCH that independently proves the redirect-flow / delayed-method plumbing for that method type. Enforced by CI gate `.github/scripts/strict-grep/i-stripe-pm-method-allowlist.mjs` + (legacy) `orch-0837-regression-check.mjs` T-C1.

### 5.3 Retired

**I-PROPOSED-MINGLA-BUSINESS-HOSTED-CHECKOUT-ONLY (ORCH-0839-B [Stripe Hosted Checkout pivot])** — RETIRED on ORCH-0849 CLOSE. Replaced by I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY. Historical-context only.

### 5.4 New (DRAFT — flip ACTIVE on ORCH-0849 CLOSE)

**I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY** — both `app-mobile` and `mingla-business` mount `<StripeNativeProvider>` at root with their respective merchantIdentifier + urlScheme; both call `initStripe({stripeAccountId})` per-PI BEFORE `initPaymentSheet`; both consume the same `requires_payment` response shape from `ticket-checkout-create`. Enforced by `.github/scripts/strict-grep/i-stripe-paymentsheet-parity.mjs`.

**I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST** — `payment_method_types` on every Mingla PaymentIntent is sourced from `MINGLA_PM_ALLOWLIST` in `_shared/stripePaymentMethods.ts`. CI gate `.github/scripts/strict-grep/i-stripe-pm-method-allowlist.mjs` enforces.

---

## 6. Test cases (binding)

| ID | Scenario | Input | Expected | Layer | Owner |
|----|----------|-------|----------|-------|-------|
| T-01 | allowlist function returns 4 methods | `getPaymentMethodTypes()` | `["card","link","apple_pay","google_pay"]` exact | Edge fn helper | Implementor happy-path |
| T-02 | edge fn source uses helper | grep `ticket-checkout-create/index.ts` | finds `[...getPaymentMethodTypes()]` AND import | Edge fn source | Implementor happy-path |
| T-03 | edge fn source forbids old literal | grep | absent `payment_method_types: ["card"]` literal | Edge fn source | Implementor happy-path |
| T-04 | anti-regression to dashboard fan-out | grep | absent `automatic_payment_methods` | Edge fn source | Tester adversarial Attack 2 |
| T-05 | allowlist exhaustiveness | TS compile + assert | type union narrow to allowlist | Edge fn helper | Tester adversarial Attack 1 |
| T-06 | empty allowlist forbidden | invariant assertion | `getPaymentMethodTypes().length > 0` | Edge fn helper | Tester adversarial Attack 3 |
| T-07 | Phase 2 method gate | assert allowlist excludes deferred methods | allowlist ∩ {cash_app_pay, klarna, afterpay_clearpay, us_bank_account, sepa_debit, ideal, bancontact, eps, p24} = ∅ | Edge fn helper | Tester adversarial Attack 4 |
| T-08 | business parity — provider mounted | grep `mingla-business/app/_layout.tsx` | `<StripeNativeProvider merchantIdentifier="merchant.com.mingla.business.v2"` | Mobile source | Implementor parity test |
| T-09 | business parity — nativeCheckoutFlow exists | file existence + grep | file exists, imports initStripe, calls with stripeAccountId | Mobile source | Implementor parity test |
| T-10 | business parity — payment.tsx swapped | grep | NO `expo-web-browser` import, YES `nativeCheckoutFlow` call | Mobile source | Implementor parity test |
| T-11 | strict-grep parity gate green on head | run gate | exit 0 | CI | Implementor SC-11 |
| T-12 | strict-grep allowlist gate green on head | run gate | exit 0 | CI | Implementor SC-11 |
| T-13 | strict-grep parity gate red on synthetic revert | revert provider mount, run gate | exit 1 | CI | Implementor fails-on-revert |
| T-14 | strict-grep allowlist gate red on synthetic revert | revert helper import, run gate | exit 1 | CI | Implementor fails-on-revert |
| T-15 | retired gate orch-0839-b is gone | file existence | `orch-0839-b-mingla-business-no-native-stripe.mjs` ABSENT | CI | Implementor SC-10 |
| T-16 | post-deploy edge fn response shape | live HTTP probe | response on `requires_payment` returns `stripeAccountId + customerId + customerEphemeralKeySecret` | Live | Orchestrator SC-13 |
| T-17 | consumer PaymentSheet — 4 methods | live-fire iOS sim | sheet renders Card + Link + Apple Pay + Google Pay rows | Live UI | Tester live-fire SC-14 |
| T-18 | business PaymentSheet — 4 methods | live-fire iOS sim | same sheet shape on business app | Live UI | Tester live-fire SC-15 |
| T-19 | consumer end-to-end card payment | live-fire test card 4242 | sheet → success → order written → calendar updated | Live | Tester SC-16 |
| T-20 | business end-to-end card payment | live-fire test card 4242 | sheet → success → order written → hub updated | Live | Tester SC-16 |
| T-21 | Android emulator parity (consumer + business) | live-fire Android | Google Pay row + card row visible on both | Live UI | Tester parity SC-15/16 |

---

## 7. Implementation order (binding — implementor follows exactly)

1. **Pre-flight (BEFORE any code edits):** confirm operator-side ops A-1..A-4 are satisfied. Implementor probes Stripe Dashboard, captures screenshots / API response in `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0849_*.md` §"Pre-flight verification". If any fails → STOP, surface to operator.
2. Create `supabase/functions/_shared/stripePaymentMethods.ts` per §3.2.1.
3. Edit `supabase/functions/ticket-checkout-create/index.ts` per §3.2.2 — add import + replace one-line predicate.
4. Run `deno check supabase/functions/ticket-checkout-create/index.ts` — must exit clean.
5. Write happy-path test `__tests__/payment_method_allowlist.test.ts` per §3.6.1. Run; must pass.
6. **Fails-on-revert capture (helper revert):** synthetically revert `MINGLA_PM_ALLOWLIST` to `["card"] as const`, re-run test, capture FAIL output, restore. Document revert hash in implementation report.
7. **Fails-on-revert capture (source-file revert):** synthetically revert the edge fn line to `payment_method_types: ["card"]` literal, re-run, capture FAIL, restore. Document.
8. Update CI gate `orch-0837-regression-check.mjs` per §3.5.1.
9. Create CI gate `i-stripe-pm-method-allowlist.mjs` per §3.5.4. Run; assert exit 0. Synthetic-revert helper file, re-run, assert exit 1, restore.
10. Add `@stripe/stripe-react-native` to `mingla-business/package.json` per §3.4.1. Run `npm install`. Commit lockfile.
11. Add Stripe plugin entry to `mingla-business/app.json` per §3.4.2.
12. Mount `<StripeNativeProvider>` in `mingla-business/app/_layout.tsx` per §3.4.3.
13. Create `mingla-business/src/payments/nativeCheckoutFlow.ts` per §3.4.4 (copy consumer + adapt 2 things).
14. Replace `mingla-business/app/checkout/[eventId]/payment.tsx` body per §3.4.5.
15. `git rm mingla-business/src/components/checkout/PaymentElementStub.tsx` per §3.4.6 + §S-9.
16. `git rm .github/scripts/strict-grep/orch-0839-b-mingla-business-no-native-stripe.mjs` per §S-10. Remove job from workflow yml. Remove registry comment line.
17. Create CI gate `i-stripe-paymentsheet-parity.mjs` per §3.5.3. Run on head; assert exit 0. Synthetic-revert provider mount in business `_layout.tsx`, re-run, assert exit 1, restore.
18. Write parity test `mingla-business/__tests__/payments/native_checkout_flow_parity.test.ts` per §3.6.3. Run; assert pass.
19. Update `INVARIANT_REGISTRY.md` per §3.7.1. AMEND ORCH-0837 entry. RETIRE ORCH-0839-B entry. ADD two new DRAFT entries.
20. Update `DECISION_LOG.md` per §3.7.2 — new DEC entry.
21. Run scoped Deno tests + all strict-grep gates locally. Capture outputs.
22. Run TypeScript check on both `mingla-business/` and `app-mobile/` workspaces (where applicable) — must be clean. Tester-written adversarial test (T-04..T-07) is written by Claude `mingla-tester` later, NOT by implementor in this step.
23. Write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md` with: old→new diff receipts for every changed file, gate run outputs, fails-on-revert hashes, full file list matching SC-19, EAS rebuild prereq stated explicitly, operator-side ops confirmation receipts captured pre-flight.

---

## 8. Regression prevention

**R-1.** New CI gate `i-stripe-paymentsheet-parity.mjs` blocks any single-app regression — if either app's provider mount or initStripe per-PI is removed, gate goes red.

**R-2.** New CI gate `i-stripe-pm-method-allowlist.mjs` blocks any attempt to bypass the allowlist (hardcoded literal at PI-create site OR re-enable of `automatic_payment_methods: enabled: true`).

**R-3.** Existing CI gate `orch-0837-regression-check.mjs` T-C1 remains as a second line of defense against `automatic_payment_methods` regression.

**R-4.** Two append-only regression tests per ORCH-0840 [Regression-test enforcement + append-only CI] — happy-path + adversarial — make method-set drift detectable at test time.

**R-5.** Amended I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES explicitly forbids Phase 2 methods (Cash App Pay, Klarna, Afterpay, ACH, SEPA, regional redirects) from being added to the allowlist without a new ORCH that proves redirect/delayed-method plumbing. Tester adversarial Attack 4 enforces this.

**R-6.** Stripe RN SDK version drift between the two apps would silently break the parity invariant. The parity gate could be extended in a future ORCH to compare `package.json` versions across both apps; for ORCH-0849 we accept that drift would be caught at first run via type / runtime divergence, NOT statically. Documented as a residual risk.

---

## 9. Rollback plan

**Trigger (consumer side):** post-deploy SC-14 / SC-19 fails — PaymentSheet hangs or returns "method not supported" errors on a charges-enabled brand.

**Procedure (consumer):**
1. Redeploy a prior `ticket-checkout-create` version (v48 or earlier) via `/Users/sethogieva/bin/supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv` from the git ref before the ORCH-0849 commit.
2. Verify the rollback version reverts to `payment_method_types: ["card"]`.
3. Allowlist file + CI gates STAY (they're invariant-level — leaving them blocks accidental rebreak; gate goes red until a corrected forward-fix lands).
4. Open hot-fix ORCH-0849-A for the corrected forward fix.

**Trigger (business side):** post-rebuild SC-15 / SC-16 / SC-20 fails — business PaymentSheet hangs, crashes, or never renders.

**Procedure (business):**
1. `git revert` the business mobile changes (steps 10–15 of implementation order) on a hot-fix branch.
2. EAS rebuild business with the reverted state — drops back to Hosted Checkout.
3. Parity gate goes red on the revert (only one app has the parity wiring) — this is the correct signal; gate stays red until forward-fix lands.
4. Open hot-fix ORCH-0849-B for the corrected forward fix.

**Time to recovery:**
- Consumer rollback (server-side only): < 5 min (one edge fn redeploy).
- Business rollback (requires EAS rebuild): ~15–30 min for build + propagation.

**Data integrity:** No DB rollback needed. PaymentIntents created during the window with the expanded allowlist may be in `requires_payment` or `succeeded` state — those orders are valid; no data corruption possible because the schema doesn't change.

---

## 10. Confidence

`High` — investigation was `root cause proven` on both surfaces; ORCH-0844 provides the load-bearing infrastructure that makes both changes safe; same patterns reused (no novel design); allowlist + CI gates ensure regression prevention; rollback paths are clean per-app.

**Residual risks documented:**
- Apple Pay merchant cert state for the NEW business merchant identifier is operator-side ops; if cert verification fails post-rebuild, Apple Pay row will be silently absent on business — NOT a hang (per ORCH-0844 fixes). SC-14/15 may show 3 methods instead of 4 on business. Implementor captures cert state in pre-flight per A-1.
- Stripe RN SDK version drift between consumer and business at install time — A-5 verification step.
- EAS build queue availability is not guaranteed — operator-coordinated, A-7.
- Per-connected-account method enabling is operator-side per A-3; brands without Link / Apple Pay enabled will see fewer methods (NOT a bug — Stripe gracefully omits).

---

## 11. Cross-references

- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md`
- Dispatch: `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md` (PRIVATE_PROMPT_NOT_VERSIONED — gitignored)
- Prior decisions consumed: DEC-157 (ORCH-0844 [Explorer PaymentSheet — Connect account ID per-PI + 60s timeout removal] CLOSE), DEC-156 (ORCH-0843 [Charge-Shape Reconciliation] CLOSE), DEC-154 (Stripe Connect onboarding baseline).
- Prior closes consumed: ORCH-0837 [Stripe PI card-only + handleURLCallback wired] investigation + close; ORCH-0839-B [Stripe Hosted Checkout pivot] (retired by this spec); ORCH-0844 [Explorer PaymentSheet] (load-bearing infrastructure); ORCH-0838 [Apple Pay merchant cert verification + re-enable] (absorbed).
- Pattern references: consumer's `app-mobile/src/payments/nativeCheckoutFlow.ts` (the verbatim template for the business mirror); `packages/payments-native/StripeNativeProvider.tsx` (provider wrapper used by both apps); `packages/payments-native/useStripePaymentSheet.ts` (hook used by both flows).
- Memory: `feedback_strict_grep_registry_pattern.md` (one script + one job in workflow), `feedback_orchestrator_deploys_edge_functions.md` (orchestrator owns deploy split), `feedback_universal_skill_output_format.md` (4-section chat output).
