# Implementation Report: Native Stripe Tax QA Fixes (ORCH-0955)

> Date: 2026-05-25
> Mode: Rework
> Spec: `Mingla_Artifacts/reports/QA_ORCH-0955_NATIVE_STRIPE_TAX_REPORT.md`
> Status: implemented, partially verified

## 1. Layman Summary

The QA-blocking code defects are fixed in the ORCH-0955 branch. Native installment checkouts now calculate Stripe Tax against the deposit being charged now, embedded Stripe Tax tools show a recoverable error if the client secret cannot load, unsupported tax countries show specific buyer copy, and confirmation emails can show jurisdiction names in the tax row. The live stale `ticket-checkout-create` deployment was not redeployed because this dispatch explicitly forbids edge-function deploys without Seth authorizing that phase.

## 2. Request And Context

- **Request:** Fix the ORCH-0955 QA failures without applying migrations, deploying functions, mutating Stripe Dashboard, or touching secrets.
- **Source:** User-dispatched implementor rework from `QA_ORCH-0955_NATIVE_STRIPE_TAX_REPORT.md`.
- **Affected surfaces:** `ticket-checkout-create`, cart tax preview in consumer and business apps, embedded Tax web route, ticket email renderer, ORCH-0863 strict-grep allowlist, regression tests.
- **Related issues/artifacts:** `COMMS-0001`, `COMMS-0002`, `COMMS-0003`, Stripe docs for Tax Registrations, Tax Settings, and Tax Calculation create.

## 3. Scope

- **In scope:** P0 installment overcharge, ORCH-0863 C7 allowlist, embedded Tax load error, unsupported-country tax error copy, ticket email jurisdiction breakdown rendering, deploy handoff notes for stale live function.
- **Out of scope:** Applying migrations, deploying edge functions, changing Stripe Dashboard settings, changing secrets, live-fire checkout.
- **Assumptions:** The checkout RPC migration already applied remotely; the overcharge can be fixed in the edge function by normalizing Stripe Tax calculation line items to the current charge amount for installment deposits.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `COMMS_LEDGER.md` | Required entry scan | COMMS-0003 required provider-doc verification; COMMS-0002 flagged ORCH-0863 C7. |
| `Mingla_Artifacts/reports/QA_ORCH-0955_NATIVE_STRIPE_TAX_REPORT.md` | Controlling QA input | Six failures to resolve; deploy remains unauthorized. |
| `supabase/functions/ticket-checkout-create/index.ts` | Native checkout/tax path | Full-order line items could feed Stripe Tax for installment deposits. |
| `supabase/migrations/20260727000000_orch_0955_native_stripe_tax.sql` | RPC source | RPC returns full `lineItems` while `totalCents` can be deposit-only. |
| `mingla-business/app/connect-tax-registrations/index.tsx` | Embedded Tax UI | Missing `onLoadError`. |
| `app-mobile/src/components/checkout/CartTaxPreview.tsx` | Consumer tax preview | Generic invoke error copy only. |
| `mingla-business/src/components/checkout/CartTaxPreview.tsx` | Business tax preview | Generic invoke error copy only. |
| `supabase/functions/_shared/email/ticketBody.ts` | Confirmation email body | Aggregate tax row ignored `taxBreakdown`. |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | CI blocker | ORCH-0955 test file missing from backend allowlist. |
| Stripe docs | Provider contract check | Tax calculations use `line_items.amount` as the line total; embedded Tax Settings and Tax Registrations are the documented components. |

## 5. Blast Radius

- **Direct changes:** Edge tax line-item normalization and error classification; two cart preview components; embedded Tax route; email tax row; tests; strict-grep allowlist.
- **Cascade changes:** Installment deposit PaymentIntent amount now follows deposit plus deposit tax, not full order plus full tax.
- **Parity surfaces:** Consumer and business cart previews now use the same unsupported-country copy.
- **Cache impact:** None.
- **State boundaries:** Server still owns tax calculation and persisted checkout state; React component state only renders local preview/load errors.
- **Auth/RLS/security:** No auth/RLS changes; no secrets touched.
- **Deploy path:** `ticket-checkout-create` still needs an authorized deploy before live remote QA can pass.

## 6. Old To New Receipts

### `supabase/functions/ticket-checkout-create/index.ts`

- **Before:** Installment sessions could send full-order `lineItems` to Stripe Tax while `totalCents` was deposit-only; unsupported Stripe Tax failures returned generic `tax_calculation_failed`.
- **After:** `normalizeTaxLineItemsForCurrentCharge` replaces mismatched installment tax lines with one deposit line, ignores client-supplied tax calculation IDs for installment plans, and maps country/address unsupported failures to `tax_country_unsupported` with HTTP 422.
- **Why:** Prevents deposit buyers from being charged full order plus full tax and lets clients render specific unsupported-country copy.
- **Approx lines changed:** 90.

### `app-mobile/src/components/checkout/CartTaxPreview.tsx`

- **Before:** All preview invoke failures rendered `Couldn't calculate tax. Tap to retry.`
- **After:** The component reads the edge error body and renders `Tax couldn't be calculated for this country. Choose a different billing country.` for `tax_country_unsupported`.
- **Why:** Fixes T-TA-12 on consumer checkout.
- **Approx lines changed:** 25.

### `mingla-business/src/components/checkout/CartTaxPreview.tsx`

- **Before:** Business checkout had the same generic retry copy.
- **After:** It mirrors the consumer unsupported-country handling.
- **Why:** Keeps buyer-web parity with consumer app.
- **Approx lines changed:** 25.

### `mingla-business/app/connect-tax-registrations/index.tsx`

- **Before:** Embedded Tax components had no load-error state after account-session initialization.
- **After:** `ConnectTaxRegistrations` and `ConnectTaxSettings` both wire `onLoadError` to the required error shell copy.
- **Why:** Expired/invalid account-session client secrets now fail visibly and recoverably.
- **Approx lines changed:** 18.

### `supabase/functions/_shared/email/ticketBody.ts`

- **Before:** Emails rendered aggregate `Tax` only.
- **After:** Emails render jurisdiction labels from `taxBreakdown` in HTML and text when available.
- **Why:** Fixes T-TA-15 without changing aggregate total behavior.
- **Approx lines changed:** 48.

### `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`

- **Before:** C7 rejected `supabase/functions/__tests__/orch_0955_native_stripe_tax.test.ts`.
- **After:** The ORCH-0955 test file is allowlisted.
- **Why:** Removes the unrelated backend PR blocker while preserving C7 enforcement.
- **Approx lines changed:** 1.

### Tests

- **Before:** ORCH-0955 tests did not cover deposit tax-line normalization, unsupported-country edge code, embedded load errors, jurisdiction labels, or the ORCH-0863 allowlist file.
- **After:** `orch_0955_native_stripe_tax.test.ts` covers all five contracts, and `shell.test.ts` renders a real jurisdiction breakdown in HTML/text.
- **Why:** Contracts now fail on the QA-reported regressions.
- **Approx lines changed:** 85.

## 7. Implementation Details

- **Architecture decisions:** Fixed the payment-plan overcharge at the edge boundary because Stripe Tax and PaymentIntent creation both happen there and because rewriting an already-applied migration would create source/remote drift.
- **Data flow:** RPC session total remains the current charge amount; edge tax calculation line items are normalized to that current charge for installment deposits.
- **Mutation/query behavior:** Checkout session failure state still persists before returning an edge error.
- **State handling:** Embedded Tax UI uses local `embeddedLoadError`; cart previews use local error text only.
- **Error handling:** `tax_country_unsupported` is stable edge output; generic tax failures still return `tax_calculation_failed`.
- **Copy/accessibility:** Required unsupported-country and embedded Tax load-error copy is present.
- **Analytics/notifications/realtime:** No changes.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| P0 stale checkout deploy gap | Code source ready; deploy command documented | Deploy intentionally not run | Partial |
| P0 installment-plan overcharge | Edge tax line items normalize to deposit/current charge | ORCH-0955 Deno test; Deno check | Pass locally |
| ORCH-0863 C7 allowlist failure | Test file allowlisted | Gate pass plus remove/restore negative check | Pass locally |
| Embedded Tax load error | `onLoadError` wired for both components | ORCH-0955 Deno source test; targeted TS check | Pass locally |
| Unsupported-country tax copy | Edge error code and both cart mappings added | ORCH-0955 Deno source test; targeted TS check | Pass locally |
| Ticket email jurisdiction rendering | HTML/text render jurisdiction labels | Email shell Deno render test | Pass locally |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| I-TAX-NATIVE-PLATFORM-CALCULATION | Yes | Yes locally | Current charge amount is the tax base for installment deposits. |
| I-TAX-TRANSACTION-AFTER-SUCCESS | Yes | Yes | No webhook commit ordering changes. |
| I-TAX-REFUND-REVERSAL-BEFORE-REFUND-SUCCESS | Yes | Yes | Refund path untouched; gate still passes. |
| I-TAX-EMBEDDED-ACCOUNT-SESSIONS | Yes | Yes locally | Embedded components now have load-error handling. |
| I-TAX-NO-REGION-GATE | Yes | Yes locally | Region gate scan still returns no matches in source. |
| I-ORCH-0863-BACKEND-ALLOWLIST-STRICT-GREP | Yes | Yes | Remove/restore validation proves the allowlist line is active. |

## 10. Parity Check

- **Mobile:** Consumer cart preview maps unsupported country copy.
- **Business app:** Business cart preview and embedded Tax route updated.
- **Admin:** Not applicable.
- **Public/web:** Buyer-web cart parity covered through `mingla-business`.
- **Solo/collab:** Not applicable.
- **Gaps:** Live remote function remains stale until an authorized deploy.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** Adds stable edge error code only; existing success payload unchanged.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** No persisted client state change.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Stripe docs cross-check | Official docs: `https://docs.stripe.com/connect/supported-embedded-components/tax-registrations`, `https://docs.stripe.com/connect/supported-embedded-components/tax-settings`, `https://docs.stripe.com/api/tax/calculations/create` | PASS | Confirms embedded components and tax calculation line-item amount contract. |
| Remote migration status | `/Users/sethogieva/bin/supabase migration list --linked` | PASS | No remote-only rows; remote/local aligned through `20260727000000`. No migration applied. |
| Edge typecheck | `/Users/sethogieva/.deno/bin/deno check supabase/functions/ticket-checkout-create/index.ts supabase/functions/refund-order/index.ts supabase/functions/brand-stripe-tax-account-session/index.ts supabase/functions/stripe-webhook/index.ts supabase/functions/ticket-confirmation-dispatch/index.ts` | PASS | Exit 0. |
| ORCH-0955 regression | `/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/__tests__/orch_0955_native_stripe_tax.test.ts` | PASS | 17 passed, 0 failed. |
| Email jurisdiction render | `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/_shared/email/__tests__/shell.test.ts` | PASS | 10 passed, 0 failed. |
| ORCH-0863 C7 restored | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS | C7 now green. |
| ORCH-0863 C7 remove check | Temporarily removed allowlist line, ran same script, restored line | PASS | Failed on `supabase/functions/__tests__/orch_0955_native_stripe_tax.test.ts`, then passed after restore. |
| ORCH-0804 + ORCH-0955 strict-grep | `node` strict-grep scripts for ORCH-0804 and all five ORCH-0955 gates | PASS | All pass. |
| Legacy source-token scan | `rg "brand-stripe-tax-dashboard-link|stripeTaxDashboardLink|native_paid_not_allowed_in_region|isNativePaidAllowedForBrand|NATIVE_PAID_ALLOWED_REGIONS|useBrandStripeTaxDashboardLink|brandStripeTaxDashboard" --glob '!Mingla_Artifacts/**' --glob '!COMMS_LEDGER.md' --glob '!node_modules/**' .` | PASS | No matches; `rg` exit 1 means no legacy tokens found. |
| Targeted business TS | `npx tsc --noEmit --jsx react-jsx --esModuleInterop --moduleResolution node --module esnext --target esnext --lib dom,esnext --skipLibCheck app/connect-tax-registrations/index.tsx src/components/checkout/CartTaxPreview.tsx` | PASS | Exit 0. |
| Targeted consumer TS | `npx tsc --noEmit --jsx react-jsx --esModuleInterop --moduleResolution node --module esnext --target esnext --lib dom,esnext --skipLibCheck src/components/checkout/CartTaxPreview.tsx` | PASS | Exit 0. |
| Full business typecheck | `npm run typecheck -- --noEmit` in `mingla-business` | FAIL unrelated baseline | Existing errors in checkout buyer params, ComposerV2, shared packages, and package type resolution; no errors referenced changed files. |
| Full consumer typecheck | `npx tsc --noEmit` in `app-mobile` | FAIL unrelated baseline | Existing Deno test/import, board discussion, shared package, and Stripe PaymentSheet type errors; no errors referenced changed file. |
| Diff hygiene | `git diff --check` | PASS | Exit 0. |

## 13. Regression Surface

1. Installment deposits: current charge amount and tax line-item base must stay aligned.
2. Full-pay native checkout: existing tax calculation reuse remains allowed for non-installments.
3. Unsupported/invalid tax jurisdictions: edge code must stay stable for UI copy mapping.
4. Embedded Tax account sessions: expired client secret must show actionable recovery.
5. Receipt rendering: aggregate tax amount still shows even if breakdown is empty.
6. ORCH-0863 C7: allowlist should continue to block unapproved backend files.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Stale remote `ticket-checkout-create` | Production still runs old function until authorized deploy | Seth authorizes deploy and tester verifies remote body | Supabase edge function |
| Full app typechecks | Broad repo typechecks fail on pre-existing unrelated errors | Separate cleanup or package TS config repair | `mingla-business`, `app-mobile` |
| Stripe Tax RAK/live brand | Live-fire remains blocked by external setup noted in QA | Seth scopes RAK permissions and live brand exists | Stripe/Supabase config |

## 15. Discoveries For Orchestrator

- No new cross-ORCH ledger entry was created. COMMS-0002 and COMMS-0003 were already the relevant cross-ORCH items.

## 16. Deploy Notes

- **Migrations:** None created or applied.
- **Edge functions:** Do not run until Seth explicitly authorizes deploy. Required command for the held deploy phase:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0955-[native-stripe-tax]" && /Users/sethogieva/bin/supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv
```

- **Post-deploy verification:** Confirm remote `ticket-checkout-create` no longer contains `stripeTax.ts`, `isNativePaidAllowedForBrand`, `NATIVE_PAID_ALLOWED_REGIONS`, or `native_paid_not_allowed_in_region`, and that source contains `normalizeTaxLineItemsForCurrentCharge`.
- **Mobile OTA/native:** Consumer app source changed; release path depends on normal app distribution.
- **Business/admin web:** Business web/native source changed; deploy through the normal business app pipeline.
- **Env vars/secrets:** None touched.

## Suggested Commit Message

```text
fix(stripe-tax): resolve ORCH-0955 QA blockers

Resolves: ORCH-0955
Evidence: Deno edge checks, ORCH-0955 regression, email render test, ORCH-0863 remove/restore gate, targeted TS checks
Deploy: ticket-checkout-create deploy held pending Seth authorization
```

## Ready-To-Test Checklist

1. Run the Deno and strict-grep gates listed in §12.
2. After Seth authorizes edge deploy, deploy `ticket-checkout-create` with the command in §16.
3. Verify remote `ticket-checkout-create` source is the ORCH-0955 implementation and no longer has region-gate tokens.
4. Retest installment native checkout where full trip price exceeds deposit; expected PaymentIntent amount is deposit plus deposit tax.
5. Retest unsupported billing country; expected copy is `Tax couldn't be calculated for this country. Choose a different billing country.`
6. Retest embedded Tax page with invalid/expired client secret; expected copy is `Tax tools temporarily unavailable. Close this window and try again from the app.`
7. Retest ticket confirmation email with multi-jurisdiction `taxBreakdown`; expected HTML/text include jurisdiction labels.
