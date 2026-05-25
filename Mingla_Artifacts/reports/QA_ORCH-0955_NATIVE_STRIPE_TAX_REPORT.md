# QA_ORCH-0955_NATIVE_STRIPE_TAX_REPORT

## Verdict

**FAIL - release blocked.**

ORCH-0955 is not ready to close because the live deployed `ticket-checkout-create` function is stale and still runs the pre-ORCH-0955 region-gated native checkout path. The local branch also contains a payment-plan tax calculation defect that can charge the buyer for the full trip order plus full tax even when only the installment deposit should be charged.

The expected live-fire end-to-end test remains blocked by the known Stripe restricted API key scope gap and the missing live brand dependency, but those caveats are not the cause of this FAIL verdict. The blockers below are source/deploy/CI issues that can be verified without mutating Stripe, Supabase schema, secrets, or dashboard settings.

## Scope

- ORCH: ORCH-0955 [Native Stripe Tax for Platforms]
- Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0955-[native-stripe-tax]/`
- Branch: `ORCH-0955-native-stripe-tax`
- Verified HEAD: `d673f1d542fee6081b165e51d70c31f581300a68`
- Migration status: `20260727000000_orch_0955_native_stripe_tax.sql` is applied on remote per Supabase migrations list.
- Hard constraints honored:
  - Did not apply migrations.
  - Did not deploy edge functions.
  - Did not mutate Stripe Dashboard, Stripe secrets, or Supabase secrets.
  - Did not use osascript.

## Comms Ledger

- Acknowledged `COMMS-0001` for ORCH-0955: the deleted Stripe Tax dashboard-link path breaks under `dashboard.none` and ORCH-0955 owns the replacement.
- Acknowledged `COMMS-0002` for ALL: ORCH-0863 strict-grep C7 blocks backend PRs touching `supabase/functions`.

## Evidence Commands

| Gate | Command | Result |
|---|---|---|
| Edge typecheck | `deno check supabase/functions/ticket-checkout-create/index.ts supabase/functions/refund-order/index.ts supabase/functions/brand-stripe-tax-account-session/index.ts supabase/functions/stripe-webhook/index.ts supabase/functions/ticket-confirmation-dispatch/index.ts` | PASS |
| ORCH-0955 unit tests | `deno test --allow-read supabase/functions/__tests__/orch_0955_native_stripe_tax.test.ts` | PASS: 14 tests, 0 failed |
| Full strict-grep bundle | `orch-0804`, `orch-0863`, and ORCH-0955 strict grep scripts | FAIL: ORCH-0863 C7 rejects `supabase/functions/__tests__/orch_0955_native_stripe_tax.test.ts` |
| ORCH-0955 strict-grep scripts only | `orch-0955-native-tax-coverage`, `tax-commit`, `tax-reversal`, `embedded-tax-ui`, `region-gate-deleted` | PASS |
| Legacy source-token scan | `rg "brand-stripe-tax-dashboard-link|stripeTaxDashboardLink|native_paid_not_allowed_in_region|isNativePaidAllowedForBrand|NATIVE_PAID_ALLOWED_REGIONS|useBrandStripeTaxDashboardLink|brandStripeTaxDashboard" --glob '!Mingla_Artifacts/**' --glob '!COMMS_LEDGER.md' --glob '!node_modules/**' .` | PASS: no matches |
| Remote migrations | Supabase `list_migrations` | PASS: migration applied |
| Remote edge deployments | Supabase `list_edge_functions` plus `get_edge_function` | FAIL: live `ticket-checkout-create` is version 111 from anchor/main and contains stale pre-ORCH-0955 code |

## Release-Blocking Findings

### P0 - Live checkout deployment is stale and does not run ORCH-0955 native tax code

**Status:** FAIL

The active remote `ticket-checkout-create` function is not the ORCH-0955 implementation. Supabase reports version 111 with an anchor/main entrypoint, while the prompt expected version 110 from the ORCH-0955 deploy. Its live source still imports `isNativePaidAllowedForBrand` from `../_shared/stripeTax.ts`, returns `native_paid_not_allowed_in_region`, creates native PaymentIntents with `amount: totalCents`, and does not include the ORCH-0955 buyer-address, tax calculation, tax preview, or `mingla_tax_calculation_id` flow.

**Impact:** live native paid checkout will not calculate or collect Stripe Tax, will still apply the deleted region gate, and cannot satisfy SC-1, SC-2, SC-3, SC-7, SC-8, SC-11, or SC-15 in production.

**Required fix:** redeploy `ticket-checkout-create` from the ORCH-0955 branch after source fixes are complete, then verify the remote function body contains the ORCH-0955 tax path and no longer contains `stripeTax.ts`, `isNativePaidAllowedForBrand`, `NATIVE_PAID_ALLOWED_REGIONS`, or `native_paid_not_allowed_in_region`.

### P0 - Payment-plan native checkout can overcharge trip buyers

**Status:** FAIL

The migration builds `lineItems` from the full ticket order before reducing `totalCents` to the installment deposit. The edge function then sends those full-price line items to Stripe Tax and creates the PaymentIntent for `taxCalculation.amount_total`.

Evidence:

- `supabase/migrations/20260727000000_orch_0955_native_stripe_tax.sql` builds `lineItems` using full ticket price totals before payment-plan handling.
- The same RPC later changes `v_total` to the installment deposit amount for payment-plan deposits.
- `supabase/functions/ticket-checkout-create/index.ts` builds Stripe Tax `line_items` from `session.lineItems`.
- The PaymentIntent amount is set to `taxCalculation.amount_total`.
- Business trip checkout calls the native checkout path for trip events but does not pass a payment-plan choice into the ORCH-0955 edge function.

**Impact:** a buyer selecting an installment deposit can be charged the full trip order amount plus full tax, while future installment state may still exist. This violates payment integrity and the existing installment-plan contract.

**Required fix:** ensure Stripe Tax line items and the PaymentIntent amount are based on the amount actually being charged now. Add a regression test where a trip with a payment plan has a full order total greater than the deposit and assert the native PaymentIntent amount equals deposit plus deposit tax, not full order plus full tax.

### P1 - ORCH-0863 strict-grep C7 blocks the backend PR

**Status:** FAIL

The full strict-grep bundle fails at ORCH-0863 C7:

```text
FAIL [C7: no-new-backend-files] Backend files changed outside the approved ORCH-0955 allowlist.
Offenders:
  - supabase/functions/__tests__/orch_0955_native_stripe_tax.test.ts
```

The allowlist in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` includes the ORCH-0955 functions, migration, and strict-grep scripts, but not the ORCH-0955 test file.

**Impact:** the PR close gate will fail even if product code is otherwise fixed.

**Required fix:** add `supabase/functions/__tests__/orch_0955_native_stripe_tax.test.ts` to the ORCH-0955 backend allowlist and rerun the full strict-grep bundle. Per Amendment A, include a remove-and-restore validation for the allowlist gate.

## Additional Findings

### P2 - Embedded Stripe Tax UI has no expired client-secret load-error state

**Status:** FAIL

`mingla-business/app/connect-tax-registrations/index.tsx` renders `ConnectTaxRegistrations` and `ConnectTaxSettings` without `onLoadError` handlers. The local `@stripe/react-connect-js` components expose `onLoadError`, but the page only handles account-session creation errors before the embedded components mount.

**Impact:** invalid or expired account-session client secrets can leave the tax setup page without the required actionable error: `Tax tools temporarily unavailable. Close this window and try again from the app.`

**Required fix:** wire `onLoadError` for both embedded tax components, render the required retry/close message, and add a focused UI test or component-level regression.

### P2 - Unsupported-country tax errors are not classified for the cart

**Status:** FAIL

The edge function catches all Stripe Tax calculation failures and returns `502 tax_calculation_failed`. Both mobile and business `CartTaxPreview` components render the generic retry message for invoke errors.

**Impact:** an unsupported country such as `XX` does not show the required copy: `Tax couldn't be calculated for this country. Choose a different billing country.`

**Required fix:** classify unsupported-country/address errors distinctly at the edge, return a stable error code, and map that code in both cart preview components.

### P2 - Ticket confirmation email does not render jurisdiction names from tax breakdown

**Status:** FAIL

`ticket-confirmation-dispatch` passes `taxBreakdown` into the email body input, but `supabase/functions/_shared/email/ticketBody.ts` renders only a single `Tax` row in HTML and text. It does not display jurisdiction names from `order.taxBreakdown`.

**Impact:** receipt emails can show the tax amount but not the required per-jurisdiction detail.

**Required fix:** render jurisdiction labels consistently in HTML and text email bodies, or update the product contract if the receipt should intentionally stay aggregate-only.

## Success Criteria Matrix

| Criterion | Status | Evidence |
|---|---|---|
| SC-1 Native Stripe Tax is calculated for buyer addresses | FAIL | Local source includes the path, but the live deployed checkout function is stale and does not calculate Stripe Tax. |
| SC-2 Checkout shows tax preview before confirmation | FAIL | Local source includes preview support, but the live deployed checkout function returns the old native checkout shape with no tax preview fields. |
| SC-3 PaymentSheet amount includes subtotal plus tax | FAIL | Live deployed checkout does not include tax. Local payment-plan path can overcharge full order plus full tax instead of deposit plus deposit tax. |
| SC-4 Refunds reverse committed tax transactions | CONDITIONAL PASS | `refund-order` live/local source includes reversal logic, but live checkout cannot currently create the original tax transaction because deployed checkout is stale and live-fire is blocked by RAK/live-brand constraints. |
| SC-5 Partial refunds reverse proportional tax | CONDITIONAL PASS | Source includes partial reversal line-items and tests cover reversal shape, but end-to-end proportionality cannot be live-fired yet. |
| SC-6 Duplicate webhook/refund retries do not duplicate tax commits/reversals | PASS | Source uses stable idempotency keys for tax commit and reversal paths; local tests pass. |
| SC-7 Native-paid events are no longer blocked by region gate | FAIL | Local source removes the gate, but live deployed `ticket-checkout-create` still returns `native_paid_not_allowed_in_region`. |
| SC-8 Buyer address is required before native paid checkout | FAIL | Local source validates buyer address, but live deployed checkout uses the old path and does not require ORCH-0955 buyer address input. |
| SC-9 Brand tax setup uses embedded Stripe Tax components | CONDITIONAL PASS | Account-session function and embedded page exist, and the live account-session function is deployed; no live brand is available and T-TA-11 load-error handling fails. |
| SC-10 Legacy Tax Dashboard link path is deleted from source | PASS | Source scan excluding artifacts/node_modules found no legacy dashboard-link tokens. The legacy deployed edge function still exists and is expected to be handled by CLOSE deprecation extension. |
| SC-11 Region allowlist config/function is removed | FAIL | Local source scan and strict grep pass, but live deployed checkout still imports the old region-gate helper. |
| SC-12 Confirmation receipts include tax amounts | PASS | Email body renders aggregate tax amount in HTML and text. Jurisdiction names fail separately under T-TA-15. |
| SC-13 DB schema persists tax calculation, transaction, breakdown, and comments | PASS | Migration is applied remotely and source migration adds/comment-documents the tax columns. |
| SC-14 No stale Supabase secrets remain after close | CONDITIONAL PASS | Not validated in this tester pass because CLOSE has not run and secret mutation/listing was out of scope. |
| SC-15 Stripe restricted keys have required Tax scopes | CONDITIONAL PASS | Known external blocker: Seth has not yet added the Tax permissions to `STRIPE_RAK_TICKET_CHECKOUT` and `STRIPE_RAK_TICKET_REFUND`. |
| SC-16 Tax reversal failure records failed refund state and avoids orphan refund rows | PASS | `refund-order` writes failed refund state on tax reversal failure and webhook has a backstop for failed refund rows. |

## Adversarial Test Matrix

| Test | Status | Evidence |
|---|---|---|
| T-TA-01 Lowercase country rejected at edge | PASS | Edge validation requires `^[A-Z]{2}$` and returns `buyer_address_invalid` for invalid country format. |
| T-TA-02 Expired preview taxCalculationId is not reused | PASS | Edge retrieves the existing calculation only if `expiresAt` is in the future; otherwise it creates a fresh calculation. |
| T-TA-03 Stripe Tax failure creates no orphan PaymentIntent | PASS | Tax calculation occurs before PaymentIntent creation; calculation failure writes failed session state and returns 502. |
| T-TA-04 Webhook finalizes order when taxCalculationId is null | PASS | Webhook only commits tax when a tax calculation id exists and otherwise continues order finalization. |
| T-TA-05 Duplicate webhook does not double commit tax | PASS | Tax transaction creation uses PaymentIntent id as idempotency key and persists the resulting transaction id. |
| T-TA-06 Refund without original tax transaction skips reversal | PASS | Refund code only calls reversal when `originalTaxTransactionId` exists. |
| T-TA-07 Reversal failure commits failed refund state | PASS | Refund code catches reversal failure, writes failed refund status/reason, and returns an error before success completion. |
| T-TA-08 Migration is idempotent | PASS | Migration uses `ADD COLUMN IF NOT EXISTS` for schema additions and `CREATE OR REPLACE` for functions; it is already applied remotely. |
| T-TA-09 Non-owner cannot mint account session | PASS | Account-session function calls `requirePaymentsManager` before calling Stripe. |
| T-TA-10 Detached brand gets 409 before Stripe call | PASS | Account-session function checks for missing `stripe_account_id` before `accountSessions.create`. |
| T-TA-11 Invalid embedded account-session clientSecret renders actionable error | FAIL | Embedded tax components do not wire `onLoadError`; invalid/expired client-secret load failure is not surfaced with required copy. |
| T-TA-12 Unsupported buyer country XX shows country-specific copy | FAIL | Edge returns generic `tax_calculation_failed`; cart preview components render generic retry copy. |
| T-TA-13 Changing address clears stale preview immediately | PASS | Both cart preview components clear preview state and call `onPreviewChange(null)` when address changes. |
| T-TA-14 Deleted region gate grep catches old code reintroduced | PASS | ORCH-0955 region-gate strict-grep passes and legacy source token scan returns no matches. |
| T-TA-15 Email receipt renders multiple jurisdiction names | FAIL | Email renderer uses only aggregate `Tax` amount and ignores jurisdiction names in `taxBreakdown`. |
| T-TA-16 Application fee excludes tax | PASS | Local source computes platform fee from `totalCents` before tax and sets PaymentIntent amount separately to tax-inclusive total. |
| T-TA-17 Strict-grep allowlist enforcement for ORCH-0863 C7 | FAIL | Full strict-grep bundle fails because the ORCH-0955 test file is missing from the ORCH-0863 backend allowlist. |

## Invariant Check

| Invariant | Status | Evidence |
|---|---|---|
| I-TAX-NATIVE-PLATFORM-CALCULATION | FAIL | Local simple purchase path uses platform Stripe Tax, but live checkout is stale and payment-plan line items can be full-order while the charged subtotal should be deposit-only. |
| I-TAX-TRANSACTION-AFTER-SUCCESS | PASS | Webhook commits tax only after payment success and uses PaymentIntent idempotency. |
| I-TAX-REFUND-REVERSAL-BEFORE-REFUND-SUCCESS | PASS | Refund path attempts tax reversal before marking refund succeeded and records failure on reversal error. |
| I-TAX-EMBEDDED-ACCOUNT-SESSIONS | CONDITIONAL PASS | Server-side account-session function exists and uses Stripe Connect embedded components, but client-side load-error handling is incomplete and no live brand is available. |
| I-TAX-NO-REGION-GATE | FAIL | Local source passes, but live deployed checkout still has the region gate. |
| I-ORCH-0863-BACKEND-ALLOWLIST-STRICT-GREP | FAIL | The ORCH-0955 test file is not in the ORCH-0863 C7 backend allowlist. |

## Constitution 14-Rule Check

| Rule | Status | Notes |
|---|---|---|
| 1. No dead taps | CONDITIONAL PASS | Primary actions are wired in source, but embedded tax component load failure lacks the required recovery state. |
| 2. One owner per truth | PASS | Tax state is server-owned and persisted on order/refund records. |
| 3. No silent failures | FAIL | Live checkout silently runs stale non-tax path; embedded UI load failures and unsupported-country errors are under-specified. |
| 4. One key per entity | PASS | PaymentIntent id and refund id are used as stable idempotency anchors. |
| 5. Server state stays server-side | PASS | Stripe Tax commit/reversal and account sessions are server-side. |
| 6. Logout clears local user data | N/A | No auth persistence change in scope. |
| 7. Temporary states are labeled | PASS | Local source labels tax preview/calculation pending states. |
| 8. Subtract before adding | FAIL | Live checkout still contains the deleted region gate, so old gating behavior remains active in production. |
| 9. No fabricated data | FAIL | Payment-plan tax path can charge using full-order line items when the current charge should be deposit-only. |
| 10. Currency-aware money handling | PASS | Code uses integer cents and USD-oriented Stripe amounts. |
| 11. One auth instance | PASS | No duplicate auth client introduced. |
| 12. Validate at the right time | FAIL | Local source validates buyer address before native checkout, but live checkout does not. |
| 13. Exclusion lists stay consistent | PASS | No conflicting exclusion list change found. |
| 14. Persisted state hydrates correctly | N/A | No persisted client state hydration change in scope. |

## Required Retest Plan

1. Fix payment-plan native tax line items so the Stripe Tax calculation and PaymentIntent amount match the current charge amount.
2. Add the ORCH-0955 Deno regression for deposit-plus-tax vs full-order-plus-tax.
3. Add the ORCH-0955 test file to the ORCH-0863 C7 backend allowlist and rerun the full strict-grep bundle.
4. Add embedded tax component `onLoadError` handling and a focused regression.
5. Add unsupported-country error classification and cart copy mapping in both apps.
6. Render tax breakdown jurisdiction names in ticket confirmation emails, or formally amend the contract to aggregate-only receipt tax display.
7. Redeploy `ticket-checkout-create` from the fixed ORCH-0955 branch.
8. Re-verify remote deployed function content and rerun this tester pass.
9. After Seth scopes the Stripe Tax RAK permissions and ORCH-0954 provides a live brand, run the live-fire conditional acceptance test.

