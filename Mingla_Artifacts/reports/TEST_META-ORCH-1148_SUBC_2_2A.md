# TEST — META-ORCH-1148 sub-ORCH 2.2a (guest-booking BACKEND)

> **Tester:** mingla-tester · **Date:** 2026-06-17 · **Branch:** `ORCH-1148-venue-guest-booking`
> **HEAD under test:** `7e090cd9e` (impl report `59bc5fd47`)
> **Method:** LIVE runtime-fire on `supabase/postgres:17.4.1.075` Docker (reused the implementor's `mingla_1148_test` + a clean-room rebuild `mingla_1148_tester_fresh`); ran every assertion as the ACTUAL `anon`/`authenticated` roles, two concurrent psql sessions for the real race, and `deno check` + money-seam gates on the edge code. Both containers torn down.
> **Comms Ledger:** read on entry. No BLOCK or to:ORCH-1148 rows. COMMS-0002 (ORCH-0863 backend strict-grep) noted — money-seam gates run clean.

## VERDICT: **CONDITIONAL PASS** — one P1 must be fixed before the fee path ships to multi-table venues

The keystone (anon engine exposure) and the double-book race are **PROVEN SAFE**. One real **P1 atomicity defect** in the fee confirm path: the guest writer is not idempotent on `payment_intent_id`, so a double-fired / replayed / flip-failure-retried `venue-reservation-confirm` on a slot with `remaining ≥ 2` mints **two reservations from one charge**. No live blast radius today (0 reservable venues, single-table slots self-protect), but it WILL bite multi-table venues at launch. Everything else passes.

---

## Per-criterion results (all LIVE)

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | **Engine anon exposure (keystone)** | **PASS** | As role `anon`: engine EXECUTE = true, returns EXACTLY 4 cols (`slot_start_utc/slot_local_label/remaining/is_full`), no PII/id. anon reads **0 rows** from reservations (with a PII canary present), venue_tables, settings, availcfg, reservation_checkout_sessions. Helper `pg_venue_turn_minutes_for_party` → `permission denied`. Writer RPCs anon-denied. PII-coax (negative/huge party, other-brand, nonexistent brand) → 0 rows, never an error. |
| 2 | **Double-book race + bad slots** | **PASS** | **TRUE concurrent last-seat race** (two background psql sessions, advisory lock held across a 3s txn): exactly ONE mint, the second blocked then got `slot_unavailable` (remaining recomputed 0). Fabricated 3:17am slot, past slot, whole-day blackout slot, `remaining=0` → all `slot_unavailable`. |
| 3 | **Charge↔reservation atomicity** | **FAIL (P1)** | No reservation without a verified charge (mint gated on PI `succeeded`) ✔. BUT re-mint of the same `payment_intent_id` on a `remaining≥2` slot → **2 reservations** (no idempotency guard). Proven two ways: double-confirm + flip-failure-retry. See DEFECT-1. |
| 4 | **Capacity rules server-side** | **PASS** | party_fit (party 50, max table cap 2) → `slot_unavailable` in the RPC itself. `deposit_threshold` (min_party_for_fee=2): a free write for a party-2 → `deposit_required`; a paid write succeeds. Enforced in the writer, NOT bypassable by calling it directly with `payment_status='none'`. |
| 5 | **Free vs fee routing** | **PASS (source-verified)** | Free → `pg_create_guest_reservation` direct, `free_completed` (proven live). Fee → `resolve_brand_pricing_inputs` + the SHARED `allInPricingEngine` (6 engine calls, 0 inline bps/×100 math — grep clean); native `requires_payment` / web `requires_web_redirect` / NG `requires_paystack_redirect`. Web Checkout bills `buyerSubtotalCents` + Stripe `automatic_tax` on top — the established ORCH-1147 pattern (NOT double-tax; verified identical to ticket-checkout-create). Currency-aware. |
| 6 | **RLS / guest ownership** | **PASS** | Consumer c1 (real JWT GUC `request.jwt.claim.sub`) sees ONLY own row, not other-consumer or guest rows; anon sees 0 even by exact id. `pg_cancel_my_reservation`: c1 cancels own, c2's row → `reservation_not_found`. **Cross-guest token cancel denied** (GuestY token vs GuestX row → not_found, no oracle). Cutoff: paid+refundable BEFORE cutoff → `refund_eligible=true`; AFTER cutoff → `false` (forfeit) — matches the locked charge-upfront/forfeit model. |
| 7 | **Money seam + engine frozen** | **PASS** | Engine BODY unchanged (only the GRANT + a belt REVOKE + COMMENT). `git diff` = 5 scoped migrations + 2 edge fns, nothing else. Gates: `orch-1130-no-buyer-tax-form` PASS, `orch-0843-stripe-direct-charges-only` PASS, `i-stripe-pm-method-allowlist` PASS. |
| 8 | **Own adversarial test** | **DONE** | `Mingla_Artifacts/tests/TEST_META-ORCH-1148_SUBC_2_2A_tester_adversarial.test.sql` — T-A1 idempotency (FAILS on HEAD, documents the P1), T-A2 anon PII-coax, T-A3 cross-guest cancel, T-A4 keystone fails-on-revert. Different angle from C-01..C-12 (concurrency/idempotency/coax, not single-shot). |
| 9 | **Migration chain + deno + gates** | **PASS** | **Clean-room rebuild**: full 245-file chain applies CLEAN from scratch through the exposure probe (which prints its NOTICE). `deno check` both edge fns → EXIT 0. Implementor's C-01..C-12 harness re-run on the fresh DB → 14 PASS, 0 FAIL (independently reproduced, not self-doctored). No pre-existing gate failures to disambiguate (all gates green). |

---

## DEFECT-1 (P1) — fee-confirm not idempotent → duplicate reservation from one charge

**`pg_create_guest_reservation` has no idempotency key on `payment_intent_id`, and `venue-reservation-confirm` has no FOR-UPDATE / early-return guard on the session row.** The only thing preventing a duplicate is slot-capacity exhaustion.

- `reservations` has NO unique index on `payment_intent_id`; `reservation_checkout_sessions` has none beyond its PK.
- `venue-reservation-confirm/index.ts`: the `if (session.status === "completed" && session.reservation_id)` fast-path is a **non-atomic TOCTOU read** outside any lock; the final `.update({status:"completed", reservation_id})` is fire-and-forget (not error-checked). Two concurrent confirms both read `pending`, both verify the PI `succeeded`, both call the writer.
- The writer's `pg_advisory_xact_lock(brand_id||reserved_for)` serializes the two calls but the second still **mints** because it only re-validates *slot capacity* — which passes when `remaining ≥ 2`.

**Live proof (capacity-2 × 2 tables → `remaining=2` slot):** minting `pi_idem_001`/`pi_orphan_001` twice → **2 reservation rows for one PI** (`dup=2`). The second is orphaned: charged, never linked to its session.

**Trigger paths in the live confirm fn:** client double-fire (spec has the client "fall through to a realtime/poll"); POST network retry after the mint; the unchecked session-flip failing then a re-confirm; or a deliberate replay of `{reservationDraftId, buyerStatusToken}` (both are handed to the client; the token is the sole, reusable gate).

**Why it's P1 not P0:** single-eligible-table slots (`cap_per_slot=1`) self-protect — the first mint exhausts capacity and the second hits `slot_unavailable` (verified). The defect bites **multi-table venues** (most real restaurants). Zero live blast radius today (no reservable brands), so it can ship after a fix without an emergency.

**Fix shape (the cited mirror already does this):** make the writer/confirm idempotent on the session — `ticket-checkout-confirm`'s `biz_ticket_checkout_finalize` takes `FOR UPDATE` on the session row and early-returns the existing order when `order_id` is set. The venue path dropped that guard. Recommended: pass the `reservation_checkout_session_id` into the writer (or a dedicated finalize RPC), `SELECT ... FOR UPDATE` the session, return the existing `reservation_id` if already linked, else mint + link in the SAME txn. A unique partial index on `reservations(payment_intent_id) WHERE payment_intent_id IS NOT NULL` is a cheap DB-level belt.

---

## Lower-severity notes (P3/P4 — not blocking)

- **P3 — charge-without-reservation on slot-loss-after-charge is FLAGGED, not refunded.** When the slot is taken between create and confirm, the confirm fn marks the session `slot_unavailable_after_charge_refund_due` and returns 409 `refundDue:true`, but the refund EXECUTION is deferred to 2.2b/2.2c. So a buyer can be charged with no reservation until 2.2b wires `refund-order`. Spec-acknowledged; flag it does NOT regress when 2.2b lands. (Atomicity criterion #3 "no charge without a completed reservation" is satisfied *eventually*, not synchronously.)
- **P4 — `expires_at` on sessions is set (30 min) but nothing reaps `pending` rows to `expired`;** abandoned fee sessions linger as `pending`. Cosmetic until a cleanup cron exists (2.2c). The confirm fn does honor `expired` if something sets it.

---

## Adversarial test + fails-on-revert (cited)

- **My harness:** `Mingla_Artifacts/tests/TEST_META-ORCH-1148_SUBC_2_2A_tester_adversarial.test.sql` (immutable, append-only, txn-rollback). T-A2/T-A3/T-A4 PASS; **T-A1 FAILS on HEAD `7e090cd9e`**, encoding the correct one-reservation-per-charge contract → it is the regression sentinel for DEFECT-1 (will flip to PASS when the writer/confirm becomes idempotent).
- **Keystone fails-on-revert (proven live):** `REVOKE EXECUTE … pg_venue_available_slots FROM anon` → the implementor's probe `20261012000004` trips with *"anon MUST have EXECUTE on pg_venue_available_slots (the 2.2 keystone grant was reverted)"*; restoring the grant → probe passes. Re-confirmed against commit `7e090cd9e`.

## Recommendation
Fix DEFECT-1 (idempotent finalize, mirroring `biz_ticket_checkout_finalize`'s FOR-UPDATE + early-return) and re-run T-A1. The keystone, race, RLS, capacity, and money-seam are production-grade as-is. Containers torn down.

*End of TEST report.*
