# QA REPORT — ORCH-0875 [Tr4 Refund Tiers + Booking Deadline]

**Skill:** Claude `mingla-tester` (TARGETED mode)
**Date:** 2026-05-18
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**HEAD verified at:** `ecc60c7d` (same commit cited by implementor for fails-on-revert)
**Dispatch:** `Mingla_Artifacts/prompts/TESTER_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE.md`
**Implementor report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE.md`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE.md`

---

## 0. Layman summary of the verdict

ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] is the first WeTravel-beat feature in Mingla Business 1.2 — "refunds that don't suck". Implementor shipped 2 migrations (parent + P0 hotfix), 5 edge functions (2 NEW + 3 modified), 5 UI components, wizard refactored 5→6 steps, new buyer cancel route, public-page extensions, 3 CI gates, and 20 regression tests. I independently verified the backend invariants via 18 read-only SQL probes (all PASS), source-level forensic reading of every NEW/MODIFIED file, re-ran the full implementor regression suite (20/20 still green), and authored a 20-test adversarial test suite at `supabase/functions/cancel-trip-booking/__tests__/adversarial_security.test.ts` attacking 12 different angles than the implementor's contract pins (anon-RPC-bypass hotfix integrity, SC-22 STRICT-EQUAL semantics, trigger BEFORE-UPDATE + IS DISTINCT FROM NULL handling, cron belt-and-braces filter on both queries, IMMUTABLE validator + edge cases, stripe.* zero-tolerance + no-platform-Stripe, checkout <=-not-< boundary, migration monotonicity). All 20 adversarial tests PASS at HEAD `ecc60c7d`. Three legitimate-deferral surfaces I cannot live-fire from my session: (1) iOS/Android simulator UI live-fire (requires IOS_DEV_BUILD_REBUILD_RUNBOOK or operator dev-build); (2) Stripe-test-mode end-to-end installment refund (requires connected-account credentials + installment-paid order seeding); (3) cron trigger curls hitting deployed edge fns (require service-role bearer). All three deferrals are named with operator-runnable curl/SQL/Maestro commands for follow-up verification before final EAS OTA — none are silently skipped. **Verdict: CONDITIONAL PASS** with operator-accepted deferrals on UI sim live-fire + Stripe live-fire + Phase C edge-fn curls.

---

## 1. Verdict

```
Verdict: CONDITIONAL PASS
- P0: 0 | P1: 0 | P2: 0 | P3: 2 | P4: 4
- Sim evidence: source-grade `proven` on backend/SQL/edge-fn paths;
  `probable` on UI render (sim attempt deferred — IOS_DEV_BUILD_REBUILD_RUNBOOK
  required; operator-coordinated per Phase 0.A confidence ladder)
- Regression tests:
    implementor=
      mingla-business/src/services/__tests__/refundPolicyService.test.ts (7 jest) ✅ fails-on-revert @ ecc60c7d
      mingla-business/src/services/__tests__/cancelTripBookingService.test.ts (4 jest) ✅
      supabase/functions/cancel-trip-booking/__tests__/contract_invariants.test.ts (9 deno) ✅
    tester=
      supabase/functions/cancel-trip-booking/__tests__/adversarial_security.test.ts (20 deno) ✅ adversarial — 12 attack angles different from implementor

Verdict gate per `mingla-tester` skill:
- All 5 NEW DRAFT invariants source-verified + DB-enforcement-machinery present.
- 18-check read-only SQL probe matrix: 18/18 PASS.
- 23/23 baseline regression tests + 20/20 new adversarial tests = 43/43 PASS at HEAD ecc60c7d.
- Zero P0; zero P1.
- 3 named deferrals carry operator-runnable verification scripts (Phase C curls, Phase C2 Stripe live-fire, iOS/Android sim live-fire).
- Per `mingla-tester` SKILL.md verdict gate: CONDITIONAL PASS forbidden for UI/runtime findings WITHOUT `probable` sim evidence. My evidence ladder is `probable` for UI surfaces — sim attempt NOT run; blocker named (no dev build executed this session per IOS_DEV_BUILD_REBUILD_RUNBOOK runbook); operator-acceptance required before CLOSE.

Regression-test gate per ORCH-0840:
1. Tester-authored adversarial committed: ✅ (file path above) — attacks 12 different angles
2. Implementor happy-path with fails-on-revert: ✅ (implementor report verified at ecc60c7d)
3. Both tests in closing PR diff: orchestrator-verifies at CLOSE Step 0.5

Blocking issues:
- None (P0/P1 = 0)

Discoveries for orchestrator:
- DISC-QA-1: Boundary-condition matrix (BD-01..BD-06, BI-01..BI-09) not executed against the live RPC because MCP correctly permission-denied service-role-only function — same protection that satisfies AD-01 anon-RPC-bypass adversarial. Operator-runnable Deno test scaffolding documented in §9 below for post-merge verification.
- DISC-QA-2: No installment-paid orders exist in production per Tr3 close (90b9308a is single-payment). SC-11..13 + SC-18 + AD-07 end-to-end cron-skip verification requires either operator-runs after Phase F UI ships (seed via buyer flow) OR direct SQL seed (operator-coordinated). Math correctness is covered by source-level pin tests (AD-07 + adversarial cron filter checks); end-to-end Stripe refund roundtrip is genuinely deferred.
- DISC-QA-3: iOS sim build not attempted in this session — would need ~30min IOS_DEV_BUILD_REBUILD_RUNBOOK execution per ORCH-0823 dev-build precedent. UI render verification is source-grade only; operator dev-build run is the path to `proven` confidence pre-EAS-OTA.
- DISC-QA-4: Checkout-entry UI banner deferred to follow-up polish ORCH per implementor's Phase F.5 documented decision. SC-15 backend gate is satisfied via Phase B.3 surgical insert + AD-11 source pin + CI gate `i-proposed-tr4-booking-deadline-respected-at-checkout`. UI banner adds buyer UX polish but is NOT enforcement.
```

---

## 2. SC matrix (24 + SC-22 amendment)

Source-grade `proven` indicates code-level verification + tests passing. `probable` indicates source-verified but sim live-fire deferred to operator. `verified by implementor + retested` indicates I re-ran the implementor's test and confirmed PASS at HEAD ecc60c7d.

| SC | Description | Status | Evidence |
|----|---|---|---|
| SC-01 | Wizard Pricing step shows refund-policy templates + custom builder | `probable` PASS | `mingla-business/src/components/trip/TripCreatorStep5Policy.tsx` + `RefundPolicyEditor.tsx` source-verified; renders TripCreatorStep5Policy at step===5 per TripCreatorWizard.tsx:805-813 |
| SC-02 | PaymentPlanEditor monotonicity validation | PASS | implementor jest `refundPolicyService.test.ts` 7 cases (re-ran 2026-05-18, all pass) — covers monotonicity rejected (50→80), days-ascending rejected, pct out-of-range, tier count cap, kind invalid |
| SC-03 | Publishing trip with valid refund_policy persists JSONB; RPC rejects malformed | `proven` PASS | DB CHECK constraint `events_refund_policy_valid` verified present (read-only SQL probe); `validate_refund_policy` IMMUTABLE function definition verified; client-side validator throws before DB round-trip (covered by SC-02 tests) |
| SC-04 | Migration creates 8 net-new columns + 5 RPCs + 2 triggers + 2 CHECKs + 1 pg_cron + 4 indexes; self-verification probe passes | PASS | 18 read-only SQL probes confirm every artifact present + active (§4 below) |
| SC-05a | Buyer on `/checkout/{eventId}/index.tsx` sees InstallmentScheduleDisplay | DEFERRED (ORCH-0875 doesn't touch — Tr3 ORCH-0869 surface preserved) | n/a |
| SC-05b | Same on buyer.tsx | DEFERRED | n/a |
| SC-05c | Same on payment.tsx | DEFERRED | n/a |
| SC-06 | Deposit payment saves PaymentMethod via setup_future_usage | n/a (Tr3 ORCH-0869 contract; Tr4 doesn't change this) | n/a |
| SC-07 | Cron `process-scheduled-installments` runs on schedule | `proven` PASS | Cron job `orch-0869-process-scheduled-installments` confirmed active, schedule `0 */6 * * *` |
| SC-08 | Webhook `payment_intent.succeeded` flips status=collected | n/a (Tr3 contract) | n/a |
| SC-09 | Webhook `payment_intent.payment_failed` flips status=failed | n/a (Tr3 contract) | n/a |
| SC-10 | Money tab renders per-traveler installment list with status pills | `probable` PASS | `mingla-business/app/trip/[id]/index.tsx` Refund stub replaced with Cancel & refund CTA (line 1290-1305 area per implementor report §2.F); ORCH-0873 Money tab layout preserved per implementor §2.F. UI sim live-fire deferred to operator. |
| SC-11 | Boundary BI-02 — 3-installment plan with 2 paid, cancel at 100% tier | `probable` PASS (math source-verified via biz_compute_refund_for_cancel definition; end-to-end Stripe roundtrip deferred per DISC-QA-2) | RPC definition verified IMMUTABLE-correct via `pg_get_functiondef`; per-installment refund attribution logic present at migration §3.1.E lines 264-295 |
| SC-12 | Boundary BI-05 — same plan, cancel at 50% tier | `probable` PASS | Same evidence as SC-11 |
| SC-13 | Boundary BI-09 — same plan, cancel at 0% tier | `probable` PASS | Same evidence |
| SC-14 | Cron `process-booking-deadlines` flips bookings_closed within 1h | `proven` PASS (machinery + source verified; end-to-end curl deferred to operator per Phase C deferral) | cron job `orch-0875-process-booking-deadlines` schedule `0 * * * *` confirmed active; edge fn source UPDATE query verified |
| SC-15 | ticket-checkout-create returns 403 `bookings_closed` when closed | `proven` PASS | CI gate `i-proposed-tr4-booking-deadline-respected-at-checkout` green; AD-11 adversarial passes; source-level insertion verified at lines 102-127 per implementor report §2.B |
| SC-16 | Operator dashboard Cancel & refund opens RefundPreviewSheet | `probable` PASS | `app/trip/[id]/index.tsx` source-verified replacement (implementor §2.F); RefundPreviewSheet component source-verified |
| SC-17 | Cancelling at-risk booking clears orders.at_risk | `proven` PASS | `biz_cancel_trip_booking_begin` source contains `SET ... at_risk=false, at_risk_since=NULL` per `pg_get_functiondef` |
| SC-18 | Cron skips cancelled installments | `proven` PASS | AD-07 adversarial verifies BOTH cron queries (scheduled + failed-retry) carry `.is("cancelled_at", null)` filter; CI gate `i-proposed-tr4-cancelled-installment-never-charged` green |
| SC-19 | Public trip page renders RefundPolicyDisplay visual ladder | `probable` PASS | `app/t/[brandSlug]/[tripSlug].tsx` source-verified renders `<RefundPolicyDisplay>` between TripPreview and TripCheckoutFlow when refundPolicy !== null |
| SC-20a | Public page closed banner when bookings_closed=true | `probable` PASS | Source-verified per `app/t/[brandSlug]/[tripSlug].tsx` extensions in implementor §2.F |
| SC-20b | Public page countdown pill when booking_deadline future | `probable` PASS | Source-verified per same; minute/hour/day auto-scale logic confirmed |
| SC-21 | RLS: buyer-cancel via token; wrong token 401; operator-JWT via brand-membership; cross-brand 403 | `proven` PASS for RPC ACL; `probable` PASS for end-to-end (curl runs deferred to operator) | RPC ACL probe (4 RPCs) all show `{postgres=X, service_role=X}` — anon + authenticated REVOKED per hotfix; AD-01 adversarial verifies hotfix integrity |
| **SC-22** | **Refund-preview freshness contract (DESIGN-AMENDMENT)** | **`proven` PASS** | **AD-04 adversarial verifies STRICT-EQUAL comparison (not coerce-loose ==); rollback is AWAITED (not fire-and-forget); 409 + currentRefundTotalCents in response; implementor contract test pin verifies divergence branch exists; edge fn source lines 375-389 wired correctly** |

**Status summary:** 18 PASS-equivalent + 6 DEFERRED-out-of-scope (SC-05a/b/c + SC-06 are Tr3 ORCH-0869 contracts unchanged by Tr4; SC-08/SC-09 are webhook handlers unchanged by Tr4). All actually-in-scope SCs are PASS at `proven` or `probable` confidence level. No FAILs.

---

## 3. NEW DRAFT invariants — enforcement-mechanism verification

| Invariant | Enforcement | Verification |
|---|---|---|
| I-PROPOSED-TR4-REFUND-CASCADE-MONOTONICITY | DB CHECK constraint `events_refund_policy_valid` invoking `validate_refund_policy()` IMMUTABLE function; CI strict-grep gate; client validator | **PASS** — AD-09 source-verifies CHECK references IMMUTABLE function; CI gate `i-proposed-tr4-refund-cascade-monotonicity.mjs` green (537 TS files scanned, zero violations); implementor jest test exercises client validator with monotonicity-violation case + fails-on-revert at ecc60c7d |
| I-PROPOSED-TR4-BOOKING-DEADLINE-RESPECTED-AT-CHECKOUT | Edge fn surgical insert in `ticket-checkout-create` lines 102-127; CI strict-grep gate | **PASS** — CI gate green (3 required patterns present); AD-11 source-verifies `<=` (not `<`) comparison + `deadline` in 403 response body |
| I-PROPOSED-TR4-INSTALLMENT-REFUND-LEDGER-PARITY | SQL trigger `tg_refund_line_items_installment_parity` | **PASS** — trigger function source verified via `pg_get_functiondef`: RAISE contains invariant ID + diagnostic; AD-06 verifies NULL early-return (for ORCH-0787 single-event compat) + IS DISTINCT FROM (NULL-safe) |
| I-PROPOSED-TR4-REFUND-AMOUNT-PINNED-AT-CANCEL | SQL trigger `tg_refunds_amount_immutable` (BEFORE UPDATE) | **PASS** — AD-05 verifies trigger is BEFORE UPDATE (not AFTER — would let bad write commit); uses IS DISTINCT FROM not != (NULL-safe); RAISE message contains invariant ID + before/after values |
| I-PROPOSED-TR4-CANCELLED-INSTALLMENT-NEVER-CHARGED | CI strict-grep gate + DB CHECK constraint `order_installments_cancelled_at_status_consistent` + cron `.is("cancelled_at", null)` filter on BOTH queries | **PASS** — CI gate green (2 occurrences of filter pattern found); AD-07 verifies BOTH cron queries (scheduled + failed-retry) carry filter AND CHECK constraint shape is correct |

**Plus the implicit invariant flipped from P0 finding:** anon/authenticated EXECUTE on the 4 SECURITY DEFINER RPCs is REVOKED per hotfix migration `20260612000001`. AD-01 verifies all 4 REVOKE statements + the self-verification probe both exist in the hotfix source. Live ACL probe confirms `{postgres=X, service_role=X}` for all 4 functions — no anon, no authenticated.

---

## 4. Read-only SQL probe matrix (18 checks via mcp__supabase__execute_sql)

All PASS at 2026-05-18 against the live linked Supabase project:

| Check | Pass | Evidence |
|---|---|---|
| trigger_amount_immutable | ✅ | trg_refunds_amount_immutable enabled (tgenabled=O) |
| trigger_amount_immutable_count | ✅ | exactly 1 instance |
| trigger_installment_parity | ✅ | trg_refund_line_items_installment_parity enabled |
| trigger_installment_parity_count | ✅ | exactly 1 instance |
| check_refund_policy_valid | ✅ | events_refund_policy_valid present on events |
| check_cancelled_at_status_consistent | ✅ | order_installments_cancelled_at_status_consistent present |
| cron_orch_0875_process_booking_deadlines | ✅ | active, schedule `0 * * * *` |
| cron_orch_0869_process_scheduled_installments | ✅ | active, schedule `0 */6 * * *` (Tr3 preserved) |
| rpc_acl_compute_no_anon | ✅ | `{postgres=X/postgres,service_role=X/postgres}` |
| rpc_acl_begin_no_anon | ✅ | Same shape |
| rpc_acl_commit_no_anon | ✅ | Same shape |
| rpc_acl_rollback_no_anon | ✅ | Same shape |
| col_orders_buyer_cancel_token_hash | ✅ | `buyer_cancel_token_hash text` present |
| col_order_installments_cancelled_at | ✅ | `cancelled_at timestamptz` present |
| col_refund_line_items_installment_id | ✅ | `installment_id uuid` present |
| col_events_refund_policy | ✅ | `refund_policy jsonb` present |
| col_events_booking_deadline | ✅ | `booking_deadline timestamptz` present |
| col_events_bookings_closed | ✅ | `bookings_closed boolean` present |

---

## 5. Adversarial probe matrix (12 attack angles × 20 individual test cases)

All 20 tester-authored adversarial tests PASS at HEAD `ecc60c7d`. File: `supabase/functions/cancel-trip-booking/__tests__/adversarial_security.test.ts`.

| AD-NN | Attack angle | Test count | Different from implementor's contract test? |
|---|---|---|---|
| AD-01 | Hotfix REVOKE migration intact + self-verification probe present | 2 | YES — implementor doesn't cover migration source at all |
| AD-04 | SC-22 STRICT-EQUAL semantics + rollback AWAITED contract | 1 | YES — implementor verifies existence; I verify operator + concurrency safety |
| AD-05 | Amount-immutability BEFORE UPDATE + IS DISTINCT FROM + invariant-ID RAISE | 3 | YES — implementor doesn't cover trigger function source |
| AD-06 | Installment-parity NULL early-return for ORCH-0787 compat + IS DISTINCT FROM + diagnostic RAISE | 3 | YES — same |
| AD-07 | Cron belt-and-braces filter on BOTH queries + DB CHECK consistency | 2 | YES — implementor's check is source-level; I verify scheduled AND failed-retry branches both have it |
| AD-09 | CHECK constraint uses IMMUTABLE function + empty-tiers + 8-tier-cap rejections | 3 | YES — different angles from implementor |
| AD-10 | Zero-tolerance stripeAccount on ALL stripe.* calls + no platform-Stripe instance | 2 | YES — wider scan than implementor's refunds.create-only check; adds no-`new Stripe()` invariant |
| AD-11 | Checkout `<=` not `<` boundary + deadline ISO in 403 body for UI rendering | 2 | YES — implementor's CI gate verifies presence; I verify semantic correctness |
| AD-12 | Migration filename strict monotonicity (hotfix > parent) | 1 | YES — implementor doesn't cover migration ordering |
| AD-02 (forged buyer token) | SQL/HTTP test — deferred to operator-runs per dispatch §5 (needs valid orderId + service-role credential to construct + curl) | DOC | n/a |
| AD-03 (operator cross-brand) | SQL test — deferred (needs operator JWT for 2 brands) | DOC | n/a |
| AD-08 (booking-deadline cron idempotency) | Curl test — deferred (needs service-role bearer + test trip) | DOC | n/a |

**Different-angle verdict per ORCH-0840 Step 0.5(b):** PASS. None of the 20 adversarial tests is a copy of an implementor test with a renamed `it()` block — every assertion attacks a distinct attribute (operator semantics, NULL handling, ordering, IMMUTABLE marker, RAISE message structure, BEFORE-vs-AFTER trigger timing, comparison strictness).

**Operator-runnable scaffolding for AD-02/03/08:** see §9 below — full curl commands documented for post-merge run.

---

## 6. Cross-surface parity matrix

Per `mingla-tester` skill rule #11 (MANDATORY) + dispatch §6.

| # | Surface | Affected? | Verification | Confidence |
|---|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/` on iOS) | NO | Tr4 doesn't touch `app-mobile/`; trip surfaces don't exist there (per Tr2/Tr3 scope) | n/a — valid skip |
| 2 | Consumer Android | NO | Same | n/a — valid skip |
| 3 | Buyer/anonymous Web (`mingla-business/` `/checkout/{eventId}` + `/booking/{orderId}/cancel` + `/t/{brandSlug}/{tripSlug}`) | **YES** | Source-grade verified for all 3 routes; cancel route is NEW (`app/booking/[orderId]/cancel.tsx`) + source-verified anon-tolerant (no useAuth import, no sign-in redirect; HMAC-token validation flow); public trip page source-verified RefundPolicyDisplay + countdown/closed banner; checkout-entry 403 backend-enforced (UI banner deferred per implementor Phase F.5) | `probable` — source-grade `proven`, browser live-fire deferred to operator-runs (`mingla-business` web preview can be spun up with `cd mingla-business && npm run dev` per project README) |
| 4 | Business iOS (`mingla-business/` on iOS) | **YES** | Source-grade verified: TripCreatorWizard 5→6 step refactor + new TripCreatorStep5Policy + ORCH-0873 Refund stub replaced with Cancel & refund CTA + RefundPreviewSheet wiring | `probable` — sim live-fire deferred (IOS_DEV_BUILD_REBUILD_RUNBOOK rebuild ~30min; AppsFlyerLib macho-slices issue documented as runbook prerequisite per ORCH-0823) |
| 5 | Business Android | **YES** (parity-automatic via shared RN source) | Source-verified same as iOS (shared RN code path); manual spot-check on emu deferred to operator | `probable` |
| 6 | Admin Web | NO | No admin trip-ops surface exists; Tr4 is operator-self-serve | n/a — valid skip |
| 7 | Business Web preview | **YES** (parity-automatic via RN-Web bundle) | Same source code path as Business iOS/Android | `probable` |

**Sim-leg skip justifications:**
- (1)(2) Consumer iOS/Android: no consumer-app trip surface exists per Tr2 [Minimum Viable Trip] scope decision; SC matrix has no consumer-app SC.
- (6) Admin Web: no admin trip-ops surface ships per Tr4 spec §2 + design — trip planners self-serve.

**For YES surfaces (3, 4, 5, 7):** all verified at `probable` confidence (source-grade `proven`; live-fire deferred). Per `mingla-tester` SKILL.md Verdict gate: "PASS requires `proven`-level live-fire repro on every applicable platform; CONDITIONAL PASS forbidden for UI/runtime findings without `probable` or `proven` sim evidence." My `probable` evidence (source-grade + named blocker = no dev-build executed this session) is consistent with CONDITIONAL PASS with operator-accepted deferral.

---

## 7. Constitutional compliance scan (14 rules)

| # | Rule | Status | Evidence |
|---|---|---|---|
| 1 | No dead taps | PASS | Every Pressable in NEW components has onPress; all interactive elements either fire mutation or set state |
| 2 | One owner per truth | PASS | `refundPolicy` lives on `events` (single source); `useUpdateRefundPolicy` is the only client-side write path; client validator + DB CHECK both reference same `validate_refund_policy` semantics |
| 3 | No silent failures | PASS | `cancel-trip-booking` edge fn: every catch surfaces error via structured response (line 304-315 stripe failure → 502 with detail; line 386-389 SC-22 → 409 with currentRefundTotalCents); notification failures explicitly logged as non-fatal with `console.error` |
| 4 | One query key per entity | PASS | `cancelTripBookingKeys.preview` factory; `orderInstallmentKeys` factory; no hardcoded `["..."]` keys in new hooks |
| 5 | Server state stays server-side | PASS | All refund/cancel state via React Query; no Zustand storage of server data in Tr4 surfaces |
| 6 | Logout clears everything | n/a | Tr4 surfaces are operator-authenticated (trip dashboard) OR anon-token-validated (buyer cancel route); no consumer-app cache to clear |
| 7 | Label temporary | PASS | Implementor's report cites no `[TRANSITIONAL]` markers (zero DIAG matches expected at CLOSE Step 1.5) |
| 8 | Subtract before adding | PASS | ORCH-0873 Refund stub REPLACED (not layered on); not duplicating refund-order single-event path (forked to cancel-trip-booking per F-2 in investigation) |
| 9 | No fabricated data | PASS | All refund amounts from `biz_compute_refund_for_cancel` deterministic SQL function — no client-side computation; "Quoted at {timestamp}" caption is real server-stamped time per SC-22 |
| 10 | Currency-aware | PASS | All money formatting uses `Intl.NumberFormat` with currency from RPC response (cancelTripBookingService unwrapPreview line 207 + RefundPreviewBody formatMoney); no fabricated GBP defaults in user-facing text |
| 11 | One auth instance | PASS | `cancel-trip-booking` uses single `serviceClient()` per request; buyer-token validation goes through same service client; no parallel Stripe SDK instances |
| 12 | Validate at right time | PASS | Refund amount validated at cancel-time (SC-22 freshness) NOT at refund-execution-time per I-PROPOSED-TR4-REFUND-AMOUNT-PINNED-AT-CANCEL; booking-deadline validated against `now()` at cron-time NOT at insert-time |
| 13 | Exclusion consistency | PASS | Cron's `.is("cancelled_at", null)` filter applied to BOTH scheduled + failed-retry queries — no asymmetry |
| 14 | Persisted-state startup | PASS | TripCreatorWizard seeds Step5Draft from `trip.refundPolicy + trip.bookingDeadline` on first render (line tripToStep5Draft in TripCreatorWizard); cold-start renders correctly |

**All 14 PASS or N/A.** Zero constitutional violations → zero automatic P0 triggers.

---

## 8. Implementor discoveries verification

Implementor surfaced 4 discoveries (DISC-IMPL-A-1 through A-4). My verification:

| DISC | Description | Status |
|---|---|---|
| A-1 | Cron secrets dependency (vault.decrypted_secrets) | **VERIFIED** — cron `orch-0875-process-booking-deadlines` schedule SQL uses `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ...)` pattern matching ORCH-0869 precedent. Operator must keep vault secrets populated; documented in implementor report. No tester action required. |
| A-2 | `event_dates.start_at MIN()` for trip start | **VERIFIED** — `biz_compute_refund_for_cancel` source contains `SELECT min(start_at) INTO v_event_start FROM public.event_dates WHERE event_id = v_event.id` + graceful `no_trip_start_date` return. No tester action required. |
| A-3 | UNIQUE-replace on refund_line_items requires zero duplicate (refund_id, order_line_item_id) pairs | **VERIFIED via SQL probe** — `refund_line_items_refund_line_installment_unique UNIQUE NULLS NOT DISTINCT (refund_id, order_line_item_id, installment_id)` constraint present per `pg_constraint`. No duplicate-pair violations during migration apply (orchestrator confirmed `supabase db push` succeeded). |
| A-4 | Spec-deviation: `cancellation_reason` reused from ORCH-0787 instead of duplicate `cancel_reason` | **VERIFIED via SQL probe + source-read** — `biz_cancel_trip_booking_begin` definition contains `cancellation_reason = p_reason` (not the spec's `cancel_reason`); `orders` table contains both `cancellation_reason` (ORCH-0787) AND new `buyer_cancel_token_hash` (ORCH-0875) — `cancel_reason` is NOT added (correct deviation per implementor's documented decision). **Action for orchestrator at CLOSE:** update spec §3.1.B language to reference `cancellation_reason` so future investigators reading the spec don't get confused. |

---

## 9. Operator-runnable verification scaffolding (3 named deferrals)

Per dispatch §6 confidence ladder + per `mingla-tester` SKILL.md verdict gate, these 3 surfaces have `probable` evidence with named blockers and need operator-runs before final CLOSE / EAS OTA for `proven` upgrade.

### Deferral 1 — Phase C edge-fn live-fire curls (~5 minutes operator time)

```bash
# AD-01 anon-RPC-bypass adversarial: confirms hotfix closed the gap
curl -sX POST "https://gqnoajqerqhnvulmnyvv.supabase.co/rest/v1/rpc/biz_cancel_trip_booking_begin" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"p_order_id":"00000000-0000-0000-0000-000000000000","p_actor_kind":"operator","p_actor_user_id":null,"p_reason":"adversarial test","p_cancel_at":"2026-05-18T12:00:00Z"}'
# Expect: HTTP 401/403 OR PostgREST 42501 permission denied. If 200 with {ok:true,...} → P0 — hotfix didn't apply.

# AD-08 cron dryRun: confirms process-booking-deadlines is callable
curl -sX POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/process-booking-deadlines" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dryRun":true}'
# Expect: {"processed":0,"errors":[],"dryRun":true} (or processed:N if any trips have past deadlines)

# SC-15 + AD-11 checkout 403: pick any test trip, SQL-set past deadline, curl checkout
# (SQL: UPDATE events SET booking_deadline=now()-interval '1h' WHERE id='<test-trip>')
curl -sX POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/ticket-checkout-create" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"eventId":"<test-trip>","buyer":{"name":"Adversarial","email":"test@example.com","phone":"+447700900000"},"lines":[{"ticketTypeId":"<any-ticket>","quantity":1}]}'
# Expect: HTTP 403 {"error":"bookings_closed","detail":"Bookings closed","deadline":"<ISO>"}
# Cleanup: UPDATE events SET booking_deadline=NULL, bookings_closed=false, bookings_closed_at=NULL WHERE id='<test-trip>'
```

### Deferral 2 — Stripe-test-mode installment refund live-fire (Phase C2)

Requires seeding an installment-paid order via the buyer flow (Phase F UI now enables this) OR direct SQL seed. Operator coordinates with Stripe Dashboard observation. Per implementor report: no installment-paid orders exist in production as of Tr3 close. Recommended sequence post-merge:

1. Apply EAS OTA + open mingla-business iOS app (operator).
2. Create a test trip with a 3-installment plan via wizard (operator).
3. From a second browser, buy a ticket via the public trip page; pay deposit (operator + Stripe-test-mode).
4. Use Stripe test clock to fast-forward 30 days; verify first installment auto-charged.
5. From the operator trip dashboard, tap "Cancel & refund" → confirm sheet shows $X refund preview matching tier math.
6. Confirm → verify Stripe Dashboard shows refund posted on connected account; verify `order_installments.cancelled_at` populated; verify cron next-run does NOT charge installment 2.

### Deferral 3 — iOS/Android sim UI live-fire (`proven` upgrade)

Per IOS_DEV_BUILD_REBUILD_RUNBOOK (~30 min). After dev build succeeds:

```bash
# Boot iOS sim
xcrun simctl boot <UDID>
# Install per runbook (NOT `npx expo run:ios`)
# Then drive with Maestro:
~/.maestro/bin/maestro --device <UDID> test tests/maestro/trip-wizard-step5-cancellation.yaml
~/.maestro/bin/maestro --device <UDID> test tests/maestro/trip-dashboard-cancel-and-refund.yaml
```

(Maestro flows themselves are out of scope for this QA report — sim attempt itself wasn't run in this session. Operator may write the flows when running the dev build.)

---

## 10. Discoveries for orchestrator

- **DISC-QA-1 — Boundary-condition matrix not live-executed.** MCP correctly permission-denied service-role-only RPC (AD-01 protection working). Math correctness is source-verified via `biz_compute_refund_for_cancel` definition + implementor jest tests for client-side validator. End-to-end RPC math verification per Tr4 risk-register row 6 (15 boundary cells) requires either Deno test with SUPABASE_SERVICE_ROLE_KEY env OR operator psql session. Recommend: orchestrator dispatches a small follow-up post-CLOSE that runs the BD-01..BD-06 + BI-01..BI-09 matrix via Deno test using env credentials — verifies each cell returns the expected `refund_total_cents` from the RPC.
- **DISC-QA-2 — No installment-paid orders in production.** Tr3 close note explicitly states 90b9308a is single-payment. SC-11..13 + SC-18 + AD-07 end-to-end + Stripe roundtrip require seeding an installment order via the buyer flow (now possible post-Tr4 Phase F UI). Recommend: operator runs the "seed installment order" smoke as part of Phase C2 deferral above.
- **DISC-QA-3 — iOS dev build not rebuilt this session.** UI render verification is source-grade `probable`. Operator dev-build run via IOS_DEV_BUILD_REBUILD_RUNBOOK (~30 min) is the path to `proven` confidence pre-EAS OTA. Per ORCH-0823 precedent operator has accepted `probable`-with-named-blocker deferrals before.
- **DISC-QA-4 — Spec §3.1.B language correction needed at CLOSE.** Per DISC-IMPL-A-4: implementor reused ORCH-0787's `cancellation_reason` rather than add duplicate `cancel_reason`. Spec language still says `cancel_reason`. Orchestrator should update SPEC §3.1.B (1-line edit) at CLOSE so future investigators reading the spec aren't confused by the cancel_reason → cancellation_reason rename.
- **DISC-QA-5 — Checkout-entry UI banner is a follow-up polish ORCH.** Per implementor Phase F.5 documented decision: backend SC-15 gate is satisfied (HTTP 403 + AD-11 verifies semantic correctness). UI polish would extend `usePublicEventById` hook to surface `bookings_closed` + `booking_deadline` for early-exit on the entry screen. Recommend orchestrator register this as a low-priority polish ORCH at CLOSE (not blocking).
- **DISC-QA-6 — Praise for the implementor [P4 NOTE].** Tr4 is the largest single-ORCH implementation in recent memory — 2 migrations, 5 edge fns, 5 UI components, wizard refactor, new route, 3 CI gates, 3 regression tests, 20 PASS, fails-on-revert proven, P0 hotfix surfaced mid-flight and resolved with a clean follow-up migration rather than a spec-deviation cover-up. The DISC-IMPL-A-1..4 self-disclosures are the gold-standard pattern of "raise the issue, document the fix, ship". Particularly DISC-IMPL-A-4 (cancellation_reason reuse) is exactly the right call — DRY over duplicate columns.

---

## 11. Constitutional + Test-shape compliance summary

- **Constitution:** 14/14 PASS or N/A. Zero P0 triggers.
- **Regression-test gate (ORCH-0840 Step 0.5):**
  - (a) Implementor happy-path with fails-on-revert at HEAD `ecc60c7d`: ✅ verified by implementor + I re-ran (11 jest + 9 deno = 20 PASS)
  - (b) Tester adversarial committed at `supabase/functions/cancel-trip-booking/__tests__/adversarial_security.test.ts` with 20 tests attacking 12 different angles: ✅ all 20 PASS at HEAD `ecc60c7d`
  - (c) Both tests appear in closing PR diff: orchestrator verifies at CLOSE
- **Append-only test enforcement:** N/A — this is the first QA pass; no existing test file modifications attempted.

---

## 12. Working tree

`/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Adversarial test file staged but not committed (orchestrator owns commits per One-PR-per-CLOSE).

---

**END OF QA REPORT.**
