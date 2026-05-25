# Implementation Report: Native Stripe Tax For Platforms (ORCH-0955)

> Date: 2026-05-25
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0955_NATIVE_STRIPE_TAX.md`
> Context: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0955_NATIVE_STRIPE_TAX.md`
> Status: implemented and verified for scoped gates; broad app typechecks still fail on existing unrelated repo diagnostics
> Implementation commit: `d2106b21499a6b3c04e0259a2d76a4440f0cb2c4`

## 1. Layman Summary

Native mobile checkout now calculates Stripe Tax before opening PaymentSheet, charges the tax-inclusive amount, commits the Stripe Tax transaction after successful payment, and reverses the Stripe Tax transaction during refunds. The old region gate and Stripe dashboard login-link tax UI are removed; brands now get an embedded Stripe Tax account-session route for registrations/settings. Receipts now include tax, and CI has ORCH-0955 gates to keep the tax commit/refund/embedded UI contracts from regressing.

## 2. Request And Context

- **Request:** Implement ORCH-0955 exactly per the binding spec in the per-ORCH worktree.
- **Source:** SPEC_ORCH-0955 §7 implementation order, Investigation findings F-1..F-11, Amendment 1, COMMS-0001, COMMS-0002.
- **Affected surfaces:** Supabase migration/RPCs, ticket checkout create edge function, webhook router, refund edge function, receipt dispatch, app-mobile checkout, mingla-business checkout and brand payments UI, CI strict-grep gates.
- **Related artifacts:** `COMMS_LEDGER.md` COMMS-0001 and COMMS-0002 were acknowledged by `implementor+codex (ORCH-0955)`.

## 3. Scope

- **In scope:** Native Stripe Tax preview/create path, tax transaction commit/reversal, embedded Stripe Tax UI replacement, receipts, migration safety checks, ORCH-0840 happy-path tests T-IH-01..T-IH-13, ORCH-0863 allowlist entry.
- **Out of scope:** `supabase db push`, edge-function deploy, Stripe Dashboard/secret mutation, live-fire brand testing blocked on ORCH-0954.
- **Assumptions:** Hosted web Checkout continues to own automatic tax on web; native surfaces require buyer billing address before PaymentSheet.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/specs/SPEC_ORCH-0955_NATIVE_STRIPE_TAX.md` | Binding contract | Locked 20-step implementation order and test requirements. |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0955_NATIVE_STRIPE_TAX.md` | Root-cause context | Explained native tax gap, refund gap, and dashboard:none conflict. |
| `COMMS_LEDGER.md` | Mandatory entry scan | COMMS-0001 required embedded Tax UI rewrite; COMMS-0002 required ORCH-0863 allowlist coordination. |
| `supabase/functions/ticket-checkout-create/index.ts` | Native checkout owner | Region-gated native PI path needed tax preview/create split. |
| `supabase/functions/_shared/stripeWebhookRouter.ts` | Payment success owner | Webhook finalization needed Stripe Tax transaction commit/backstop. |
| `supabase/functions/refund-order/index.ts` | Refund owner | Refund flow needed Stripe Tax reversal before successful DB commit. |
| `mingla-business/src/components/brand/BrandPaymentsView.tsx` | Brand tax UI owner | Old login-link flow had to become embedded account session. |
| `app-mobile/src/components/expandedCard/TicketCartSheet.tsx` and business payment routes | Native buyer UI owners | Pay button needed address/tax preview before native PaymentSheet. |

## 5. Blast Radius

- **Direct changes:** Migration, edge functions, shared webhook router, refund flow, receipt email, native checkout services, buyer checkout UI, brand payments UI, CI gates, regression tests.
- **Cascade changes:** Old region-gate tests and old dashboard-link files were deleted; strict-grep gates now enforce the new contracts.
- **Parity surfaces:** Consumer native checkout and business native checkout both require billing address/tax preview before native payment.
- **Cache impact:** No React Query key changes. Cart context gained optional buyer address state.
- **State boundaries:** Billing address lives in checkout UI/cart state until checkout create; Stripe Tax calculation ID is passed once to native checkout create.
- **Auth/RLS/security:** New account-session function requires authenticated user plus payments-manager authorization before minting Stripe embedded Tax session.
- **Deploy path:** Operator applies DB migration after REVIEW; orchestrator deploys edge functions after operator prerequisite confirmation.

## 6. File-By-File Change Summary

| File | Change summary |
|---|---|
| `.github/scripts/strict-grep/orch-0804-stripe-tax-enabled-on-checkout.mjs` | Updated legacy tax-dashboard expectations to embedded Tax account-session route/function. |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | Added `ORCH_0955_BACKEND_ALLOWLIST` in the same implementation commit as migration and new tax account-session edge function. |
| `.github/scripts/strict-grep/orch-0955-embedded-tax-ui.mjs` | Added gate for embedded Tax UI/account-session contract. |
| `.github/scripts/strict-grep/orch-0955-native-tax-coverage.mjs` | Added gate for native checkout preview/create tax coverage. |
| `.github/scripts/strict-grep/orch-0955-region-gate-deleted.mjs` | Added gate ensuring old native paid region gate and dashboard-link flow stay deleted. |
| `.github/scripts/strict-grep/orch-0955-tax-commit-on-success.mjs` | Added gate for Stripe Tax transaction commit on successful payment. |
| `.github/scripts/strict-grep/orch-0955-tax-reversal-on-refund.mjs` | Added gate for Stripe Tax reversal on refund. |
| `.github/workflows/strict-grep-mingla-business.yml` | Added ORCH-0955 strict-grep job. |
| `app-mobile/src/components/checkout/CartTaxPreview.tsx` | Added native billing-address entry and preview invoke component. |
| `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` | Passed tax calculation ID and billing address into native checkout. |
| `app-mobile/src/components/expandedCard/TicketCartSheet.tsx` | Added tax preview before pay; Pay button waits for preview and displays tax-inclusive total. |
| `app-mobile/src/payments/__tests__/nativeCheckoutFlow_regionGateToast.test.tsx` | Deleted obsolete region-gate fallback test. |
| `app-mobile/src/payments/nativeCheckoutFlow.ts` | Required billing address, accepted tax calculation ID, removed region-gate message remap, returned tax fields. |
| `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` | Added native tax preview/address gate and tax-inclusive pay amount for trips. |
| `mingla-business/app/checkout/[eventId]/payment.tsx` | Added native tax preview/address gate and tax-inclusive pay amount for events. |
| `mingla-business/app/connect-tax-registrations/index.tsx` | Added embedded Stripe Tax route using Connect Tax Registrations/Settings components. |
| `mingla-business/src/components/brand/BrandPaymentsView.tsx` | Rewired Tax CTA from dashboard login link to embedded account-session flow. |
| `mingla-business/src/components/checkout/CartContext.tsx` | Added optional buyer billing address to checkout state. |
| `mingla-business/src/components/checkout/CartTaxPreview.tsx` | Added business parity component for native tax preview. |
| `mingla-business/src/hooks/useBrandStripeTaxAccountSession.ts` | Added hook to mint and open embedded Tax session route. |
| `mingla-business/src/hooks/useBrandStripeTaxDashboardLink.ts` | Deleted obsolete dashboard-login hook. |
| `mingla-business/src/payments/__tests__/nativeCheckoutFlow_regionGateToast.test.tsx` | Deleted obsolete region-gate fallback test. |
| `mingla-business/src/payments/nativeCheckoutFlow.native.ts` | Required billing address, accepted tax calculation ID, removed region-gate message remap. |
| `mingla-business/src/payments/nativeCheckoutFlow.ts` | Updated web stub types for address/tax calculation parity. |
| `mingla-business/src/services/brandStripeTaxAccountSessionService.ts` | Added service invoking `brand-stripe-tax-account-session`. |
| `mingla-business/src/services/brandStripeTaxDashboardLinkService.ts` | Deleted obsolete dashboard-login service. |
| `supabase/functions/__tests__/orch_0955_native_stripe_tax.test.ts` | Added T-IH-01..T-IH-13 plus legacy-removal regression suite. |
| `supabase/functions/_shared/email/ticketBody.ts` | Added Tax row before Total. |
| `supabase/functions/_shared/email/types.ts` | Added tax amount/breakdown context fields. |
| `supabase/functions/_shared/stripe.ts` | Removed old dashboard-link helper export. |
| `supabase/functions/_shared/stripeTax.ts` | Deleted old native region gate helper. |
| `supabase/functions/_shared/stripeWebhookRouter.ts` | Added Stripe Tax transaction commit on PI success and refund-event reversal backstop. |
| `supabase/functions/brand-stripe-tax-account-session/index.ts` | Added authz-guarded embedded Tax account-session function. |
| `supabase/functions/brand-stripe-tax-dashboard-link/index.ts` | Deleted obsolete login-link edge function. |
| `supabase/functions/refund-order/index.ts` | Added full/partial Stripe Tax reversal before successful refund commit. |
| `supabase/functions/ticket-checkout-create/__tests__/nativePaidRegionGate.test.ts` | Deleted obsolete native region-gate test. |
| `supabase/functions/ticket-checkout-create/__tests__/nativeRegionGate_adversarial.test.ts` | Deleted obsolete native region-gate adversarial test. |
| `supabase/functions/ticket-checkout-create/index.ts` | Added preview/create modes, billing-address validation, Tax calculation create/retrieve, tax-inclusive PI amount, and persisted calculation fields. |
| `supabase/functions/ticket-confirmation-dispatch/index.ts` | Included order tax fields in receipt context. |
| `supabase/migrations/20260725000002_orch_0950_expanded_scope_dashboard_coherence.sql` | Source-reconciled already-remote migration so ORCH-0955 has no remote-only predecessor. |
| `supabase/migrations/20260727000000_orch_0955_native_stripe_tax.sql` | Added order/refund/session tax columns, RPC return amendments, and refund commit tax transaction parameter. |

## 7. Implementation Details

- **Architecture decisions:** Native checkout now has `mode: "preview" | "create"`; preview calculates tax without creating a PaymentIntent, create reuses a valid calculation ID or recalculates if needed.
- **Data flow:** UI collects billing address -> `ticket-checkout-create` preview -> UI stores calculation ID -> native checkout create -> Stripe PaymentIntent amount equals Stripe Tax `amount_total` -> webhook commits Stripe Tax transaction after successful payment.
- **Refund flow:** `refund-order` creates a Stripe Tax transaction reversal before committing a successful refund; webhook backstop attempts reversal if a refund event arrives without a stored reversal ID.
- **Embedded Tax UI:** Old dashboard login-link function is replaced by `brand-stripe-tax-account-session`, then the business app opens `/connect-tax-registrations`.
- **Error handling:** Missing/invalid native billing address returns a 400 contract before payment. Tax reversal failure returns 502 and commits the refund as failed rather than silently treating tax as reversed.
- **Notifications:** Ticket receipt context includes tax amount/breakdown and renders tax before total.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Native checkout calculates tax before PaymentSheet | Yes | T-IH-01, T-IH-02, ORCH-0955 native tax coverage gate | PASS |
| PaymentIntent amount is tax-inclusive | Yes | T-IH-01 | PASS |
| Stripe Tax transaction commits after successful payment | Yes | T-IH-03, tax commit gate | PASS |
| Refunds reverse Stripe Tax transaction | Yes | T-IH-04, T-IH-05, tax reversal gate | PASS |
| Migration adds tax columns/RPC amendments | Yes | T-IH-06, linked migration list, remote data probe | PASS |
| Embedded Tax UI replaces dashboard login link | Yes | T-IH-07, T-IH-11, embedded UI gate | PASS |
| Receipts show tax | Yes | T-IH-08 | PASS |
| Consumer/business native UI parity | Yes | T-IH-09, T-IH-10 | PASS |
| ORCH-0863 C7 allowlist added in same implementation commit | Yes | T-IH-13, ORCH-0863 strict-grep | PASS |
| Region gate/dashboard-link removed | Yes | legacy-removal test, region-gate-deleted gate, rg legacy-token scan | PASS |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| No remote-only migration before handoff | Yes | Yes | `/Users/sethogieva/bin/supabase migration list --linked` shows 20260727000000 local-only and no blank-local remote rows. |
| Remote data shape supports migration | Yes | Yes | Read-only probe: `orders_with_null_tax_amount=0`, `total_refunds=7`. |
| No Supabase DB mutation by implementor | Yes | Yes | No `supabase db push`; only read-only query/list commands were run. |
| No edge-function deploy by implementor | Yes | Yes | No `supabase functions deploy`. |
| No Stripe Dashboard/secrets mutation | Yes | Yes | No Stripe Dashboard writes or Supabase secrets writes. |
| ORCH-0863 C7 backend guard remains scoped | Yes | Yes | ORCH-0955 allowlist added and strict-grep passes. |

## 10. Parity Check

- **Mobile:** app-mobile native checkout has CartTaxPreview, billing address, tax calculation ID, tax-inclusive total.
- **Business app:** event and trip native payment screens have the same preview/address gate and tax-inclusive amount. Web hosted Checkout remains unchanged.
- **Admin:** No admin UI change.
- **Public/web:** Web checkout continues through hosted Stripe Checkout.
- **Solo/collab:** Not applicable.
- **Gaps:** Live-fire brand validation remains blocked until ORCH-0954 dashboard:none cutover prerequisites are complete.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** Checkout response adds subtotal/tax/taxBreakdown fields; CartContext buyer state adds optional address.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Business web route `/connect-tax-registrations` reads query params and renders embedded Stripe components only on web.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Deno edge check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/ticket-checkout-create/index.ts supabase/functions/refund-order/index.ts supabase/functions/brand-stripe-tax-account-session/index.ts supabase/functions/stripe-webhook/index.ts supabase/functions/ticket-confirmation-dispatch/index.ts` | PASS | Exit 0. |
| ORCH-0955 happy path tests | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/__tests__/orch_0955_native_stripe_tax.test.ts` | PASS | 14 passed, 0 failed. |
| Fails-on-revert proof | Temp worktree at implementation commit, reverse-applied implementation diff excluding test file, then ran same Deno test | PASS | T-IH-01..T-IH-13 all failed on revert of `d2106b21499a6b3c04e0259a2d76a4440f0cb2c4`. |
| Strict-grep bundle | `node .github/scripts/strict-grep/orch-0804-stripe-tax-enabled-on-checkout.mjs && node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs && node .github/scripts/strict-grep/orch-0955-native-tax-coverage.mjs && node .github/scripts/strict-grep/orch-0955-tax-commit-on-success.mjs && node .github/scripts/strict-grep/orch-0955-tax-reversal-on-refund.mjs && node .github/scripts/strict-grep/orch-0955-embedded-tax-ui.mjs && node .github/scripts/strict-grep/orch-0955-region-gate-deleted.mjs` | PASS | ORCH-0804, ORCH-0863 C7, and all ORCH-0955 gates passed. |
| Legacy-token scan | `rg -n "brand-stripe-tax-dashboard-link|stripeTaxDashboardLink|native_paid_not_allowed_in_region|isNativePaidAllowedForBrand|NATIVE_PAID_ALLOWED_REGIONS|useBrandStripeTaxDashboardLink|brandStripeTaxDashboard" --glob '!Mingla_Artifacts/**' --glob '!COMMS_LEDGER.md' --glob '!node_modules/**' .` | PASS | Exit 1 with no matches. |
| Migration list | `/Users/sethogieva/bin/supabase migration list --linked` | PASS | No remote-only rows; `20260727000000` is local-only ORCH-0955. |
| Remote invariant probe | `/Users/sethogieva/bin/supabase db query --linked "SELECT (SELECT COUNT(*) FROM public.orders WHERE tax_amount_cents IS NULL) AS orders_with_null_tax_amount, (SELECT COUNT(*) FROM public.refunds) AS total_refunds;"` | PASS | `orders_with_null_tax_amount=0`, `total_refunds=7`. |
| Business typecheck | `cd mingla-business && npm run typecheck` | FAIL, unrelated | ORCH-0955 payment-screen diagnostics were fixed. Remaining failures are existing buyer-screen implicit anys, marketing editor, UI style/native module package types, DraftEvent test shape, and shared package type resolution. |
| Consumer typecheck | `cd app-mobile && npx tsc --noEmit` | FAIL, unrelated | Remaining failures are existing Deno test imports, board/session JSX namespace/types, `nativeCheckoutFlow.ts` Apple Pay type from pre-existing config, and shared package type resolution. ORCH-0955 TicketCartSheet implicit callback diagnostics were fixed. |

## 13. ORCH-0840 Regression-Test Gate

All tests below pass on the implementation and fail when implementation commit `d2106b21499a6b3c04e0259a2d76a4440f0cb2c4` is reverted while the test file remains.

| Test | Contract | Fails-on-revert commit |
|---|---|---|
| T-IH-01 | Native create calculates tax before PI | `d2106b21499a6b3c04e0259a2d76a4440f0cb2c4` |
| T-IH-02 | Preview mode returns preview without PI | `d2106b21499a6b3c04e0259a2d76a4440f0cb2c4` |
| T-IH-03 | Webhook commits Stripe Tax transaction | `d2106b21499a6b3c04e0259a2d76a4440f0cb2c4` |
| T-IH-04 | Full refund reverses tax | `d2106b21499a6b3c04e0259a2d76a4440f0cb2c4` |
| T-IH-05 | Partial refund builds reversal line items | `d2106b21499a6b3c04e0259a2d76a4440f0cb2c4` |
| T-IH-06 | Migration has tax columns/RPC amendments | `d2106b21499a6b3c04e0259a2d76a4440f0cb2c4` |
| T-IH-07 | Account-session edge function mints embedded Tax client secret | `d2106b21499a6b3c04e0259a2d76a4440f0cb2c4` |
| T-IH-08 | Email receipt renders Tax before Total | `d2106b21499a6b3c04e0259a2d76a4440f0cb2c4` |
| T-IH-09 | Consumer CartTaxPreview invokes preview and renders tax | `d2106b21499a6b3c04e0259a2d76a4440f0cb2c4` |
| T-IH-10 | Business CartTaxPreview mirrors preview contract | `d2106b21499a6b3c04e0259a2d76a4440f0cb2c4` |
| T-IH-11 | BrandPaymentsView opens embedded Tax route | `d2106b21499a6b3c04e0259a2d76a4440f0cb2c4` |
| T-IH-12 | ORCH-0955 strict-grep gates exist | `d2106b21499a6b3c04e0259a2d76a4440f0cb2c4` |
| T-IH-13 | ORCH-0863 C7 allowlist includes ORCH-0955 backend files | `d2106b21499a6b3c04e0259a2d76a4440f0cb2c4` |

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Live-fire brand test blocked | Full Stripe Tax platform live behavior cannot be validated until ORCH-0954 cutover sequencing completes. | ORCH-0954 closes, then tester runs live-fire brand validation. | Downstream QA |
| Broad app typechecks fail | Repo has existing unrelated TypeScript failures; scoped gates pass. | Separate cleanup ORCH or existing owner fixes broad typecheck debt. | `mingla-business`, `app-mobile`, shared packages |
| Stripe Tax RAK permissions | New Tax APIs will fail at runtime if restricted keys lack Tax scopes. | Operator confirms scopes before deploy. | Pre-deploy prerequisites |

## 15. Discoveries For Orchestrator

- No new cross-ORCH ledger entry was needed. COMMS-0001 and COMMS-0002 were already acknowledged and implemented into this ORCH.
- The linked worktree initially lacked Supabase link metadata; `supabase link --project-ref gqnoajqerqhnvulmnyvv` was run locally to enable read-only migration checks.

## 16. Deploy Notes

- **Migrations:** Operator applies after orchestrator REVIEW, not by implementor.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0955-[native-stripe-tax]" && /Users/sethogieva/bin/supabase db push --linked
```

- **Edge functions:** Orchestrator deploys after REVIEW and operator DB push. Required deploy set: `ticket-checkout-create`, `refund-order`, `brand-stripe-tax-account-session`, `stripe-webhook`, `ticket-confirmation-dispatch`.
- **Mobile OTA/native:** Native checkout JS changed; ship through the normal app release/OTA channel. No new native module dependency was added.
- **Business/admin web:** Business app route `/connect-tax-registrations` must be deployed with the brand payments UI update.
- **Env vars/secrets:** No secrets were written by implementor.

## Pre-deploy Operator Prerequisites

1. Confirm `STRIPE_RAK_TICKET_CHECKOUT` has Stripe Tax calculation read/write and Tax transaction create permissions needed by `stripe.tax.calculations.*` and `stripe.tax.transactions.createFromCalculation`.
2. Confirm `STRIPE_RAK_TICKET_REFUND` has Tax transaction reversal permission needed by `stripe.tax.transactions.createReversal`.
3. Confirm `STRIPE_RAK_ONBOARD` can create Connect account sessions for embedded Tax components.
4. Confirm Stripe Tax for Platforms is enabled/available on the platform account and connected-account embedded components are allowed for dashboard:none accounts.
5. If any RAK scope changes require key rotation, update Supabase secrets before edge deploy.
6. After deploy and live verification, remove obsolete native-region-gate secret/config if still present per the SPEC close step.

## Suggested Commit Message

```text
ORCH-0955: implement native Stripe Tax

Resolves: ORCH-0955
Evidence: supabase/functions/__tests__/orch_0955_native_stripe_tax.test.ts; ORCH-0955 strict-grep gates
Deploy: operator runs Supabase DB push, then orchestrator deploys edge functions
```

## Ready-To-Test Checklist

1. Native consumer event checkout: select paid tickets, enter billing address, tap Calculate tax, confirm Tax and Total appear, then Pay becomes enabled.
2. Native business event/trip checkout: repeat tax preview, confirm Pay amount includes tax.
3. Brand payments surface: tap Manage tax registrations and confirm embedded Stripe Tax UI route opens after account-session mint.
4. After DB push and edge deploy: run a Stripe test checkout, confirm `orders.stripe_tax_transaction_id` is populated after successful payment.
5. Refund the order, confirm `refunds.stripe_tax_transaction_id` is populated after reversal.
