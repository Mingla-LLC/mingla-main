# CLOSE NOTE — ORCH-0875 [Tr4 Refund Tiers + Booking Deadline]

**Closed:** 2026-05-18
**By:** Claude `mingla-orchestrator`
**Verdict:** CONDITIONAL PASS Grade A (tester) → operator iOS-sim live-fire PASS on Step 5 UX hot-fix rework → CLOSE
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

---

## What shipped

Trip planners can now configure cascading refund policies (Flexible / Standard / Strict templates OR custom tiers with monotonicity enforcement) and an optional auto-close booking deadline on Step 5 of the trip-creator wizard. Operators can cancel any booking from the trip dashboard with a refund preview that runs the cascading tier engine + SC-22 freshness re-compare at commit time. Anonymous buyers get a dedicated `/booking/{orderId}/cancel` route (HMAC token-gated) that surfaces the same refund preview + single-tap Cancel CTA for non-zero refunds (type-to-confirm friction for $0 refunds). Stripe direct-charge refunds execute per-PI with idempotency keys + `refund_application_fee:true` + connected-account routing. Hourly pg_cron auto-closes bookings past the deadline. Buyer notifications reuse ORCH-0788 [ticket-confirmation-dispatch] `buyer_refund_issued` + `buyer_order_cancelled` kinds with 4 new template branches (D-1..D-4) per cancel-actor × refund-amount matrix.

## Files (35 product + 4 test + 6 artifacts)

**Migrations (2):**
- `supabase/migrations/20260612000000_tr4_refund_tiers_booking_deadline.sql` (NEW, parent — 8 columns, 5 RPCs, 2 triggers, 2 CHECK constraints, hourly pg_cron, 4 indexes, self-verification DO-block)
- `supabase/migrations/20260612000001_tr4_revoke_rpc_anon_grants.sql` (NEW, P0 hotfix — REVOKE EXECUTE on 4 SECURITY DEFINER RPCs from anon + authenticated; re-GRANT to service_role + ACL self-verification)

**Edge functions (2 new + 4 modified):**
- `supabase/functions/cancel-trip-booking/index.ts` (NEW, ~530 lines, dual buyer HMAC / operator JWT auth, SC-22 STRICT-EQUAL freshness re-compare with HTTP 409 `policy_updated` + currentRefundTotalCents, per-PI loop with `{stripeAccount}` + idempotency-key + `refund_application_fee:true`, rollback on partial failure, notification dispatch)
- `supabase/functions/process-booking-deadlines/index.ts` (NEW, ~150 lines, hourly pg_cron handler, service-role auth, batched WHERE-filtered UPDATE — idempotent)
- `supabase/functions/ticket-checkout-create/index.ts` (MOD, surgical bookings-closed gate — `event_type='trip' AND (bookings_closed=true OR booking_deadline <= now())` returns HTTP 403 `bookings_closed`)
- `supabase/functions/process-scheduled-installments/index.ts` (MOD, 2 SQL filters — `.is("cancelled_at", null)` on both scheduled + failed-retry queries; belt-and-braces with DB trigger)
- `supabase/functions/_shared/email/buyerLifecycleAdapters.ts` (MOD, +210 lines, RefundIssuedPayloadShape + OrderCancelledPayloadShape extended with Tr4 fields, BuyerContext extended with organizerEmail + cardLast4, 4 template branches D-1..D-4 keyed on cancelledBy presence)
- `supabase/functions/ticket-confirmation-dispatch/index.ts` (MOD, OrderJoin brands extended with contact_email; BuyerContext construction extended)

**Mingla-business UI (8 new + 4 modified):**
- `mingla-business/src/components/trip/RefundPolicyDisplay.tsx` (NEW, vertical timeline with marker dots, optional currentTierIndex callout)
- `mingla-business/src/components/trip/RefundPolicyEditor.tsx` (NEW, 3 template chips + Custom mode + tier rows + LIVE-COMMIT drafts + 2-tap confirm-on-clear)
- `mingla-business/src/components/trip/BookingDeadlinePicker.tsx` (NEW, Switch + pending-state spinner + Set/Cancel buttons + iOS `themeVariant="dark"` legibility)
- `mingla-business/src/components/trip/RefundPreviewBody.tsx` (NEW, shared composition — hero amount + tier explanation + GlassCard breakdown + SC-22 quoted-at caption + 0%-tier warning banner)
- `mingla-business/src/components/trip/RefundPreviewSheet.tsx` (NEW, operator wrapper + reason TextInput 10-200 chars + Cancel/Keep CTAs + loading/error/success/submitError branches + SC-22 auto-refetch on `policy_updated`)
- `mingla-business/src/components/trip/TripCreatorStep5Policy.tsx` (NEW, Step 5 body wrapping RefundPolicyEditor + BookingDeadlinePicker in 2 stacked GlassCards)
- `mingla-business/app/booking/[orderId]/cancel.tsx` (NEW, ~440 lines, anon-tolerant route — NO useAuth, HMAC token from URL, 7 states: loading/preview-$X>0/preview-$0-type-to-confirm/confirming/success/error/token-invalid, SafeArea allowlist comment)
- `mingla-business/src/services/refundPolicyService.ts` (NEW, FLEXIBLE/STANDARD/STRICT defaults, direct DB writes, client-side validator mirroring DB CHECK, 5-pattern error discrimination)
- `mingla-business/src/services/cancelTripBookingService.ts` (NEW, previewBuyer/previewOperator/commitBuyer/commitOperator, FunctionsHttpError context extraction, typed errors with policy_updated carrying currentRefundTotalCents)
- `mingla-business/src/hooks/useCancelTripBooking.ts` (NEW, 4 hooks — preview 60s staleTime matching SC-22; commit invalidates orderInstallmentKeys + cancelTripBookingKeys)
- `mingla-business/src/hooks/useRefundPolicy.ts` (NEW, useUpdateRefundPolicy + useUpdateBookingDeadline)
- `mingla-business/src/components/trip/TripCreatorWizard.tsx` (MOD, 5→6 step refactor, STEP_COUNT=6, STEPPER_STEPS 6 entries, new tripToStep5Draft + step5Draft state, autosaveStep5, render branch step===5 → TripCreatorStep5Policy, step===6 → Review)
- `mingla-business/app/trip/[id]/index.tsx` (MOD, replaced ORCH-0873 "Refund · coming in Tr4" disabled stub with active "Cancel & refund" Pressable + RefundPreviewSheet mount)
- `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` (MOD, refund-policy ladder GlassCard render when policy !== null + booking-deadline state computation — closed banner, countdown pill, or nothing)
- `mingla-business/src/services/tripsService.ts` + `src/hooks/usePublicTripBySlug.ts` (MOD, Trip interface extended with refundPolicy + bookingDeadline + bookingsClosed + bookingsClosedAt; EventRow + mapTrip + manual construction all extended)

**CI gates (3 strict-grep):**
- `.github/scripts/strict-grep/i-proposed-tr4-booking-deadline-respected-at-checkout.mjs` (NEW)
- `.github/scripts/strict-grep/i-proposed-tr4-cancelled-installment-never-charged.mjs` (NEW)
- `.github/scripts/strict-grep/i-proposed-tr4-refund-cascade-monotonicity.mjs` (NEW)
- `.github/workflows/strict-grep-mingla-business.yml` (MOD, 3 new jobs)

**Regression tests (4 files):**
- Implementor happy-path: `mingla-business/src/services/__tests__/refundPolicyService.test.ts` (7/7 jest), `mingla-business/src/services/__tests__/cancelTripBookingService.test.ts` (4/4 jest), `supabase/functions/cancel-trip-booking/__tests__/contract_invariants.test.ts` (9/9 deno)
- Tester adversarial: `supabase/functions/cancel-trip-booking/__tests__/adversarial_security.test.ts` (20/20 deno, 12 attack angles)

**Artifacts (6):**
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE.md`
- `Mingla_Artifacts/design/DESIGN_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE.md`
- `Mingla_Artifacts/reports/QA_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE_REPORT.md`
- `Mingla_Artifacts/CLOSE_NOTE_ORCH-0875.md` (this note)

## Pipeline

INTAKE (operator AskUserQuestion → buyer-self + operator-override cancel ownership + single-ORCH staging) → Claude `mingla-forensics` INVESTIGATE+SPEC (single session, 11-section investigation + 13-section spec with 24 SCs including SC-22 + T-25 amendment + 5 NEW DRAFT invariants + Q1-Q10 RESOLVED) → `/ui-ux-pro-max` DESIGN (821-line spec, 49 sections) → Claude `mingla-implementor` (35 files; DISC-IMPL-A-4 hotfix mid-flight when parent migration failed on `cancelled_by already exists` — patched to reuse ORCH-0787 columns; ACL probe discovered Supabase project-level default privileges grant EXECUTE to anon/authenticated → P0 hotfix migration `20260612000001`) → Claude `mingla-tester` TARGETED+SECURITY (CONDITIONAL PASS Grade A; 18-check SQL probe matrix, 20 adversarial tests across 12 angles, Constitutional 14/14, cross-surface parity verified; 3 named operator-runnable deferrals documented) → Claude `mingla-orchestrator` REVIEW + HOT-FIX REWORK on Step 5 picker UX after operator iOS-sim live-fire surfaced 3 P1 UX defects (BookingDeadlinePicker toggle snap-back + spinner illegibility + auto-commit; RefundPolicyEditor blur-commit race + 1-tap clear) → operator iOS-sim live-fire PASS on rework → Claude `mingla-orchestrator` CLOSE (this note).

## Step 0.5 regression-test gate SATISFIED

(a) **Implementor happy-path:**
- `mingla-business/src/services/__tests__/refundPolicyService.test.ts` — 7/7 PASS (fails-on-revert verified at HEAD `ecc60c7d` by changing `if (tier.refund_pct > prevPct)` to `< -999` → test FAILED → restored → PASS)
- `mingla-business/src/services/__tests__/cancelTripBookingService.test.ts` — 4/4 PASS
- `supabase/functions/cancel-trip-booking/__tests__/contract_invariants.test.ts` — 9/9 PASS

(b) **Tester adversarial:**
- `supabase/functions/cancel-trip-booking/__tests__/adversarial_security.test.ts` — 20/20 PASS across 12 attack angles different from implementor's happy-path (AD-01 hotfix REVOKE intact + self-verification probe, AD-04 STRICT-EQUAL + AWAITED rollback + 409, AD-05 BEFORE UPDATE + IS DISTINCT FROM + invariant-ID RAISE, AD-06 NULL early-return + IS DISTINCT FROM + diagnostic, AD-07 filter on both cron queries + DB CHECK consistency, AD-09 CHECK uses IMMUTABLE + empty/8-tier rejections, AD-10 zero-tolerance `stripe.*` + no `new Stripe()`, AD-11 `<=` not `<` + deadline ISO in 403 body, AD-12 migration filename monotonicity)

Both test sets ship in this PR (`git diff origin/main...HEAD --name-only` includes all 4 files).

**Hot-fix UX rework regression evidence:** the 3 P1 picker fixes (controlled-Switch snap-back, iOS spinner contrast, blur-commit race) are rendering-realm-specific bugs that RTL cannot meaningfully exercise — regression proof is the operator iOS-sim live-fire PASS documented in this close. Service-layer + edge-fn tests above cover the data semantics unchanged by the UX rework.

## CI gates (0-violation)

- `i-proposed-tr4-booking-deadline-respected-at-checkout`: verifies HTTP 403 + trip-gate + bookings_closed check in ticket-checkout-create
- `i-proposed-tr4-cancelled-installment-never-charged`: verifies ≥2 occurrences of `.is("cancelled_at", null)` in process-scheduled-installments
- `i-proposed-tr4-refund-cascade-monotonicity`: scans 537 TS files for `.update(` with `refund_policy:` outside canonical validator

## Invariants flipped DRAFT → ACTIVE

- `I-PROPOSED-TR4-REFUND-CASCADE-MONOTONICITY` (DB CHECK `events_refund_policy_valid` + client validator + CI gate)
- `I-PROPOSED-TR4-BOOKING-DEADLINE-RESPECTED-AT-CHECKOUT` (ticket-checkout-create 403 + CI gate)
- `I-PROPOSED-TR4-CANCELLED-INSTALLMENT-NEVER-CHARGED` (process-scheduled-installments filter + DB trigger + CI gate)
- `I-PROPOSED-TR4-INSTALLMENT-REFUND-LEDGER-PARITY` (refund_line_items.installment_id FK + trigger `tg_refund_line_items_installment_parity`)
- `I-PROPOSED-TR4-REFUND-AMOUNT-PINNED-AT-CANCEL` (SC-22 STRICT-EQUAL re-compare + HTTP 409 `policy_updated` + currentRefundTotalCents)

## DIAG-marker reap

`grep -rn "\[ORCH-0875-DIAG\]" mingla-business/src/ mingla-business/app/ app-mobile/src/ supabase/functions/ mingla-admin/src/` → **ZERO matches**. ✓

## Coordination flag (resolved by-design)

ORCH-0876 [Trip CRUD + Purchase Flow Completion] INVESTIGATION §6 warned that ORCH-0875's buyer-cancel surface was a routing risk against the event-side `/checkout/{eventId}/confirm` chain. Actual ORCH-0875 implementation built a DEDICATED `/booking/{orderId}/cancel` route (Q10 spec resolution) which is purchase-route-agnostic. Coordination concern resolved without rework. Trip-purchase remains broken pending ORCH-0876 fix (S-3); ORCH-0875 cancel infrastructure activates once buyers can complete a trip purchase.

## Tester-named deferrals (operator-accepted, not blocking close)

1. Phase C edge-fn live-fire curls — operator-runnable in ~5 min with service-role bearer (anon-RPC-bypass probe, cron dryRun, checkout 403)
2. Phase C2 Stripe-test-mode installment refund — needs seeding via buyer flow post-EAS-OTA + ORCH-0876 trip-purchase fix
3. iOS/Android sim live-fire — Step 5 wizard satisfied 2026-05-18 via UX hot-fix rework re-test; Stripe-payment + cancel-route live-fire deferred until trip-purchase reactivated post-ORCH-0876

## Discoveries for follow-up

- **DISC-QA-4:** update spec §3.1.B language `cancel_reason` → `cancellation_reason` (1-line edit, post-close)
- **DISC-QA-5:** register checkout-entry UI banner as low-priority follow-up polish ORCH (not blocking)
- **DISC-IMPL-A-4:** ORCH-0787 column reuse (cancelled_at, cancelled_by, cancellation_reason already existed on orders + order_installments) — documented in WORLD_MAP closure note

## Cross-Surface Impact

- **business-iOS + business-Android (planner):** Step 5 wizard + Refund button on trip dashboard + RefundPreviewSheet — verified via operator iOS-sim live-fire on Step 5 (Cancellation & deadline) after hot-fix rework
- **buyer-anon-web:** new `/booking/{orderId}/cancel` route (NO useAuth, HMAC token-gated) — source-verified, live-fire deferred per Phase C2 (depends on ORCH-0876 trip-purchase fix)
- **database:** 2 migrations applied via `supabase db push --linked`
- **edge functions:** 2 new + 4 modified, deployed via `supabase functions deploy` (operator-confirmed)
- **Surfaces NOT in scope:** consumer-iOS/Android (no trips on consumer app), admin-web (no admin refund queue — trip planners self-serve), Ve experiences (Q6 forensics rec — deferred)

## EAS OTA

ELIGIBLE — pure JS for UI + edge functions + migrations; no new native modules. Publish post-merge via:

```bash
cd mingla-business && eas update --branch production --platform ios,android --message "ORCH-0875: Tr4 Refund Tiers + Booking Deadline"
```

Confirm correct EAS project before publish (mingla-business, not app-mobile).

## PR

`Seth → main` per one-PR-per-CLOSE rule. Both migrations already applied to remote via operator `supabase db push`. Both new edge functions already deployed via `supabase functions deploy`. Pre-merge gate: 5 conditions verified before merge.
