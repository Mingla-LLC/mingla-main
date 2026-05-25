# Implementation Report: Buyer Pay-In-Full Opt-Out (ORCH-0915)

> Date: 2026-05-24  
> Mode: Spec Execute  
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md`  
> Status: implemented, partially verified  
> Working tree: `/Users/sethogieva/Desktop/mingla-orchs/orch-0915-[buyer-pay-in-full-opt-out]` on branch `orch-0915-buyer-pay-in-full-opt-out`  
> Implementation commit: `041d81d2` (`ORCH-0915 buyer pay-in-full opt-out`)

## 1. Layman Summary

Buyers on a trip tier with an organiser payment plan can now choose either to pay the full trip price today or use the deposit/future-installment plan. The checkout page defaults to pay-in-full, passes the buyer choice through the business checkout service and native business PaymentSheet bridge, validates it at `ticket-checkout-create`, and adds a backward-compatible RPC parameter so legacy callers still behave as `auto`. The pay-in-full branch stores `ticket_checkout_sessions.installment_schedule = NULL`, so Stripe and finalize use the existing non-installment single-charge path.

## 2. Request And Context

- **Request:** Implement ORCH-0915 buyer/traveller pay-in-full opt-out exactly per dispatch.
- **Source:** `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md`, SPEC, INVESTIGATION F-1..F-6, REVIEW observations and operator decisions.
- **Affected surfaces:** buyer-anon-web primary; business iOS, business Android, business web preview through shared `mingla-business` payment route; Supabase `ticket-checkout-create`; create-session RPC.
- **Related artifacts:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md`, `Mingla_Artifacts/reports/REVIEW_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md`.

## 3. Scope

- **In scope:** Payment choice UI on trip payment screen, service/native payloads, edge validation/RPC call, monotonic migration, regression tests, strict-grep invariant.
- **Out of scope:** Refund math/UX changes, tier creator UI, `tier_metadata.allow_pay_in_full`, admin-web, consumer mobile UI, confirm/reconcile/webhook edits, deploys.
- **Assumptions:** Operator decisions in REVIEW §3 are binding: default full, all plan-active tiers eligible, copy-only refund language, organiser toggle deferred.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md` | Dispatch | Defined hard guards, deliverables, tests, report contract. |
| `Mingla_Artifacts/specs/SPEC_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md` | Contract | SC-01..SC-15 and implementation order. |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md` | Evidence | UI/service/RPC lockout and Money tab compatibility. |
| `Mingla_Artifacts/reports/REVIEW_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md` | Binding decisions | Default full, all plan tiers eligible, no organiser toggle. |
| `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` | UI/control/CTA | Existing page forced deposit CTA when schedule existed. |
| `mingla-business/src/services/ticketCheckoutService.ts` | Service payload | No payment choice field existed. |
| `mingla-business/src/payments/nativeCheckoutFlow*.ts` | Business native branch | Native business checkout invokes `ticket-checkout-create` directly. |
| `supabase/functions/ticket-checkout-create/index.ts` | Edge validation/Stripe | Installment Stripe shape already derived from returned `installmentSchedule`. |
| `supabase/functions/_shared/ticketCheckout.ts` | Idempotency | Choice needed in idempotency key to avoid full/installment session reuse. |
| `supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql` | RPC source | Copied and amended current create-session behavior. |
| `mingla-business/app/trip/[id]/money/index.tsx` | Money tab | Paid orders with zero installment rows already render as paid in full. |
| Existing strict-grep gates | Hard guards | ORCH-0921 and ORCH-0925 gates preserved. |

## 5. Blast Radius

- **Direct changes:** `mingla-business` trip payment page, checkout service/native bridge, Supabase edge function, create-session RPC migration, tests/gates.
- **Cascade changes:** Explicit payment choice changes Stripe amount/metadata through returned `installmentSchedule`; idempotency key now separates explicit full/installment sessions.
- **Parity surfaces:** Buyer web and business native/web-preview share the route; consumer app unchanged and legacy omitted choice remains `auto`.
- **Cache impact:** No React Query key changes.
- **State boundaries:** Choice is local UI state only; cart, buyer, intake, and sessionStorage restore are not cleared on toggle.
- **Auth/RLS/security:** Edge + RPC validate invalid choices; no RLS or auth policy changes.
- **Deploy path:** Operator pushes migration; orchestrator redeploys `ticket-checkout-create`; business web deploy needed at CLOSE because `mingla-business/` changed.

## 6. Old To New Receipts

| File | Before | After | Why |
|---|---|---|---|
| `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` | Plan-active tiers showed only schedule, plan banner, and deposit CTA. | Adds accessible two-option control after order summary; default `full`; branch copy, banner, CTA, and payload change with choice. | Buyer-controlled opt-out. |
| `mingla-business/src/services/ticketCheckoutService.ts` | `TicketCheckoutCreateInput` had no choice field. | Adds `paymentPlanChoice?: "full" \| "installments"` and maps to `payment_plan_choice` only when defined. | Legacy/event callers keep old request shape. |
| `mingla-business/src/payments/nativeCheckoutFlow.ts` | Native input had no choice. | Adds optional choice type. | Shared route native branch can honor the same decision. |
| `mingla-business/src/payments/nativeCheckoutFlow.native.ts` | Native body had no choice. | Sends `payment_plan_choice` when present. | Business iOS/Android parity. |
| `supabase/functions/_shared/ticketCheckout.ts` | Idempotency ignored choice. | Adds optional choice suffix for explicit full/installment only. | Prevents same cart from reusing wrong branch session after toggle/cancel. |
| `supabase/functions/ticket-checkout-create/index.ts` | No parse/validation/RPC param. | Parses choice, rejects invalid with 400, passes `p_payment_plan_choice`, maps RPC invalid error, keeps Stripe installment logic schedule-derived. | Edge contract and legacy auto behavior. |
| `supabase/migrations/20260724000006_orch_0915_pay_in_full_opt_out.sql` | RPC auto-generated schedule for valid plan tiers. | Adds `p_payment_plan_choice text DEFAULT 'auto'`; `full` skips schedule/deposit override; `auto/installments` preserve existing behavior. | DB-owned truth for opt-out. |
| `.github/scripts/strict-grep/i-proposed-pay-in-full-opt-out-no-installment-rows.mjs` | No invariant. | New source gate with self-test fixtures. | Prevents full branch from writing installment state. |
| Tests listed in SPEC §9 | Missing. | Added ORCH-0915 UI/service/edge/RPC/strict-grep tests and Money tab case. | Regression coverage ships with implementation commit. |

## 7. Implementation Details

- **Architecture decisions:** `ticket_checkout_sessions.installment_schedule = NULL` remains the canonical non-installment signal. No new table/flag.
- **Data flow:** `payment.tsx` → `createTicketCheckout` or business native checkout → `payment_plan_choice` → edge `paymentPlanChoice` → RPC `p_payment_plan_choice`.
- **State handling:** Default state is `"full"`; toggles only `paymentPlanChoice`, not cart/buyer/intake/sessionStorage.
- **Error handling:** Edge invalid values return `400 { error: "payment_plan_choice_invalid" }`; RPC also raises `payment_plan_choice_invalid`.
- **Copy/accessibility:** Group label `Payment option`; radio-style Pressables expose selected state. Branch copy follows SPEC §2.5.
- **Stripe behavior:** Full branch relies on null schedule, so no installment metadata, no `setup_future_usage`, and no forced Customer creation. Installment branch unchanged.

## 8. Spec / Goal Traceability

| Criterion | Implemented | Verification | Status |
|---|---:|---|---|
| SC-01 | Yes | UI source test asserts two choices for plan-active tiers. | PASS |
| SC-02 | Yes | `useState<PaymentPlanChoice>("full")`; UI test. | PASS |
| SC-03 | Yes | UI test asserts copy/banner/CTA branch changes and no state clearing calls in choice control. | PASS |
| SC-04 | Yes | Service test + UI source test assert full payload. | PASS |
| SC-05 | Yes | Service test + UI source test assert installments payload. | PASS |
| SC-06 | Yes | Service test asserts omitted request shape; edge defaults `auto`; migration defaults `auto`. | PASS |
| SC-07 | Yes | RPC source test asserts full skips installment generation and schedule persists only when generated. | PASS |
| SC-08 | Yes | Edge Deno test asserts Stripe installment fields remain guarded by `isInstallmentPlan`, which is returned-schedule-derived. | PASS |
| SC-09 | Yes | Full branch creates null schedule; existing finalize creates no child rows unless plan root and schedule exist. New strict-grep gate pins this source contract. | PASS |
| SC-10 | Yes | Existing ORCH-0925 tests/gate pass; installment schedule path remains unchanged except inside non-full branch. | PASS |
| SC-11 | Yes | ORCH-0921 strict gate passes. ORCH-0882 happy-path wiring test has unrelated stale failure; adversarial payment-page test passes. | PASS with unrelated stale test noted |
| SC-12 | Yes | Money tab test adds ORCH-0915 paid-in-full opt-out row case. | PASS |
| SC-13 | Yes | `git diff -- app-mobile` empty; edge omitted choice remains `auto`. App-mobile tsc fails on unrelated pre-existing errors. | PASS with compile caveat |
| SC-14 | Yes | Edge Deno test asserts invalid choice rejected before RPC; RPC validates too. | PASS |
| SC-15 | Yes | Implementation commit `041d81d2` includes product code + regression tests/gate. | PASS |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---:|---:|---|
| ORCH-0921 finalize callers pass installment params | Yes | Yes | Gate: 191 files, 4 finalize callers, 1 free skip, 0 violations. No confirm/reconcile/webhook edits. |
| ORCH-0925 installment plan attaches Customer | Yes | Yes | Gate: 191 files, 1 Checkout Session caller, 2 PI callers, 0 violations; Deno tests pass. |
| New ORCH-0915 full opt-out no installment rows | Yes | Yes | Gate self-test PASS; repo scan 4 files, 0 violations. |
| ORCH-0924 rollback allowlist comments | Yes | Yes | Not touched. |

## 10. Parity Check

- **Mobile:** Business iOS/Android path now forwards `payment_plan_choice` through `nativeCheckoutFlow.native.ts`. Consumer mobile unchanged.
- **Business app:** Shared checkout route updated; Money tab test covers paid-in-full row behavior.
- **Admin:** No admin-web changes.
- **Public/web:** Buyer-anon-web route updated.
- **Solo/collab:** N/A.
- **Gaps:** No browser/device visual smoke was run in this implementation turn.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** New optional request/RPC parameter only.
- **AsyncStorage/Zustand impact:** CartContext and checkout resume payload are preserved; toggle does not clear them.
- **Cold start behavior:** Default `full` after route load for plan-active tier; legacy callers/no-plan tiers omit choice or hit `auto`.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Tests fail before implementation | `npx jest 'app/checkout-trip/\[tripEventId\]/__tests__/orch_0915_pay_in_full_choice.test.tsx' 'src/services/__tests__/ticketCheckoutService.orch0915.test.ts' --runInBand` | FAIL | UI 4/4 failed; service failed TS because `paymentPlanChoice` was unknown. |
| New strict-grep pre-implementation | `node .github/scripts/strict-grep/i-proposed-pay-in-full-opt-out-no-installment-rows.test.mjs && node .github/scripts/strict-grep/i-proposed-pay-in-full-opt-out-no-installment-rows.mjs` | FAIL on repo scan | Self-test PASS; repo scan failed because migration missing. |
| ORCH-0915 + Money + ORCH-0882 adversarial Jest | `npx jest 'app/checkout-trip/\[tripEventId\]/__tests__/orch_0915_pay_in_full_choice.test.tsx' 'src/services/__tests__/ticketCheckoutService.orch0915.test.ts' 'app/trip/\[id\]/money/__tests__/money-redesign.test.tsx' 'app/trip/\[id\]/money/__tests__/money-redesign-adversarial.test.tsx' 'src/components/trip/__tests__/InstallmentScheduleDisplay_wiring_adversarial.test.ts' --runInBand` | PASS | 5 suites, 70 tests. |
| Deno check + Deno tests | `/Users/sethogieva/.deno/bin/deno check supabase/functions/ticket-checkout-create/index.ts && /Users/sethogieva/.deno/bin/deno test --allow-read ...` | PASS | 18 Deno tests passed including ORCH-0925 + ORCH-0915. |
| Strict-grep gates | `node ...0915.test.mjs && node ...0921...mjs && node ...0925...mjs && node ...0915...mjs` | PASS | 0915 self-test PASS; ORCH-0921/0925/new gate all 0 violations. |
| Migration monotonic local/origin | `ls supabase/migrations \| tail -10`; `git ls-tree origin/main supabase/migrations/ \| tail -10` | PASS | Max local and origin/main head were `20260724000005`; new file is `20260724000006`. |
| Remote migration list | `/Users/sethogieva/bin/supabase migration list --linked` | BLOCKED | CLI returned `Cannot find project ref. Have you run supabase link?`; no DB mutation attempted. |
| Business typecheck | `npx tsc --noEmit --pretty false` in `mingla-business` | FAIL unrelated | Existing broad TS failures in buyer routes, ComposerV2, shared packages, native payment module typing, tests. |
| App-mobile typecheck | `npx tsc --noEmit --pretty false` in `app-mobile` | FAIL unrelated | Existing broad TS failures in board/chat/shared packages/native payment typings. `git diff -- app-mobile` is empty. |
| ORCH-0882 happy-path wiring | `npx jest 'src/components/trip/__tests__/InstallmentScheduleDisplay_wiring.test.ts' --runInBand` | FAIL unrelated stale test | Still expects `InstallmentScheduleDisplay` in `app/trip/[id]/index.tsx` MoneyTabBody after ORCH-0913 moved Money to dedicated route. |
| App-mobile diff guard | `git diff -- app-mobile --stat && git diff -- app-mobile --name-only` | PASS | Empty output; consumer app UI untouched. |
| Whitespace | `git diff --check` | PASS | No whitespace errors. |

## 13. Fails-On-Revert Evidence

Verified at implementation commit `041d81d2`.

Method: temporarily applied the reverse patch for only `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` from `041d81d2`, leaving the new regression test in place.

Failing command:

```text
npx jest 'app/checkout-trip/\[tripEventId\]/__tests__/orch_0915_pay_in_full_choice.test.tsx' --runInBand
```

Fail output summary:

```text
FAIL app/checkout-trip/[tripEventId]/__tests__/orch_0915_pay_in_full_choice.test.tsx
Tests: 4 failed, 4 total
Expected substring: "type PaymentPlanChoice = \"full\" | \"installments\""
Expected substring: "paymentPlanChoice:"
```

Restore command: reapplied the same `041d81d2` patch for `payment.tsx`.

Restored pass output:

```text
PASS app/checkout-trip/[tripEventId]/__tests__/orch_0915_pay_in_full_choice.test.tsx
Tests: 4 passed, 4 total
```

## 14. Regression Surface

1. Full-pay opt-out must never store non-null `installment_schedule`.
2. Installment branch must keep deposit amount, installment metadata, Customer creation/attachment, and card-only method list.
3. Legacy event/app-mobile callers must keep omitted-choice `auto`.
4. Idempotency must not reuse a full session for an installment choice or vice versa.
5. Money tab must not mistake a deposit-only leaked order for paid in full; DB contract prevents this by keeping full branch total at full cart price.

## 15. Constitution Audit

| Rule | Status | Evidence |
|---|---|---|
| #1 UX truthful/user-controlled | PASS | Segmented/radio choice with default full and selected accessibility state. |
| #3 No silent failures | PASS | Invalid choice 400 at edge; RPC exception; branch-specific sticky banner/CTA. |
| #9 No fabricated data | PASS | Amounts come from cart totals/projected schedule/RPC tier metadata; tests assert format/copy source. |
| #12 Server validation, not client-only | PASS | Edge validates external payload and DB validates RPC parameter. |

## 16. SC Coverage Table

| SC | Status | Evidence |
|---|---|---|
| SC-01 | PASS | UI test. |
| SC-02 | PASS | UI test/default state. |
| SC-03 | PASS | UI source test. |
| SC-04 | PASS | UI + service tests. |
| SC-05 | PASS | UI + service tests. |
| SC-06 | PASS | Service omitted-shape test + edge/RPC default. |
| SC-07 | PASS | RPC source test + strict gate. |
| SC-08 | PASS | Edge Deno test. |
| SC-09 | PASS | RPC null schedule + finalize invariant/source gate. |
| SC-10 | PASS | ORCH-0925 gate/tests pass. |
| SC-11 | PASS with unrelated stale test noted | ORCH-0921 strict gate passes; ORCH-0882 happy test stale on moved Money route. |
| SC-12 | PASS | Money test ORCH-0915 case. |
| SC-13 | PASS with compile caveat | No app-mobile diff; app-mobile broad typecheck has unrelated existing failures. |
| SC-14 | PASS | Edge Deno test + RPC validation. |
| SC-15 | PASS | Implementation commit `041d81d2` includes code + tests/gate. |

## 17. Open Items / Discoveries

- `mingla-business` broad `tsc` currently fails on unrelated existing type errors; not introduced by ORCH-0915-focused Jest/Deno coverage.
- `app-mobile` broad `tsc` currently fails on unrelated existing type errors; no `app-mobile` files changed.
- `mingla-business/src/components/trip/__tests__/InstallmentScheduleDisplay_wiring.test.ts` appears stale after ORCH-0913 moved Money out of `app/trip/[id]/index.tsx`; adversarial ORCH-0882 payment-page test passes.
- Remote migration history could not be checked because this worktree is not linked to a Supabase project ref.

## 18. Deploy Notes

- **Migrations:** Operator must run `supabase db push --linked` for `supabase/migrations/20260724000006_orch_0915_pay_in_full_opt_out.sql`.
- **Edge functions:** Orchestrator must redeploy `ticket-checkout-create` after migration push; preserve existing `verify_jwt` setting and verify version via Supabase MCP.
- **Mobile OTA/native:** No `app-mobile` changes. Business iOS/Android share `mingla-business` route; orchestrator owns EAS/OTA decision.
- **Business/admin web:** `mingla-business/` changed, so CLOSE should carry `[deploy]` YES for business web per dispatch.
- **Env vars/secrets:** None added.

## Suggested Commit Message

```text
ORCH-0915 buyer pay-in-full opt-out

Resolves: ORCH-0915
Evidence: IMPLEMENTATION_ORCH-0915_BUYER_PAY_IN_FULL_OPT_OUT.md
Deploy: push migration 20260724000006, then redeploy ticket-checkout-create
```

## Ready-To-Test Checklist

1. Buyer web: plan-active trip tier defaults to full pay; CTA shows full amount; Stripe request is single-charge.
2. Buyer web: switch to payment plan; schedule appears; CTA shows deposit; Stripe request carries installment metadata/Customer behavior.
3. Invalid edge payload `payment_plan_choice:"banana"` returns HTTP 400 `payment_plan_choice_invalid`.
4. Business iOS/Android: same choice drives native PaymentSheet amount/metadata.
5. Money tab: full-pay opt-out order appears as `Paid in full`, outstanding `0`, no charge/reminder action.
