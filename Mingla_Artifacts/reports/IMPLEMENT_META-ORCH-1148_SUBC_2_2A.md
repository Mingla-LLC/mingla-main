# IMPLEMENT — META-ORCH-1148 sub-ORCH 2.2a (guest-booking BACKEND)

> **Implementor:** mingla-implementor · **Date:** 2026-06-17 · **Branch:** `ORCH-1148-venue-guest-booking`
> **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1148-[venue-guest-booking]/`
> **HEAD commit:** `7e090cd9e5a3cd2acba8055734ec2b98709f7222`
> **Binding SPEC:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1148_SUBC_GUEST_BOOKING.md` (built ONLY the 2.2a slice + the DECISIONS LOCKED section).
> **Comms Ledger:** read on entry (AGENT_HANDOFFS.md COMMS-00xx). No BLOCK / to:ORCH-1148 entries. Factored COMMS-0015 (deploy edge fns from MERGED main only) + the migration-via-Management-API rule.

## 1. SCOPE BUILT (2.2a backend only)
Engine anon-GRANT keystone + exposure probe · `reservations` guest fields + consumer-own RLS + cancel RPCs · `reservation_checkout_sessions` thin fee table · `pg_create_guest_reservation` atomic guest writer (slot re-validation + capacity) · brand-scoped pricing resolver · `venue-reservation-create` edge fn (free + fee; native PaymentSheet / web hosted Checkout / Paystack NG) · `venue-reservation-confirm` edge fn (verify charge → atomic mint). NO consumer/web UI (2.2b/2.2c). NO operator-suite / engine-body / `ticket-checkout-create` / `allInPricingEngine` edits.

## 2. CHANGED FILES (all NEW; commit `7e090cd9e`)
| File | What |
|---|---|
| `supabase/migrations/20261012000000_orch_1148_2_2_engine_anon_grant.sql` | KEYSTONE — `GRANT EXECUTE … pg_venue_available_slots(uuid,date,int) TO anon` + re-REVOKE helper from anon + protective `COMMENT`. Engine body FROZEN. |
| `supabase/migrations/20261012000001_orch_1148_2_2_reservations_guest_fields.sql` | Widen `created_via` CHECK (+`guest`); add `guest_cancel_token` + partial index; deferred consumer-own-read SELECT RLS policy (`consumer_user_id = auth.uid()`). |
| `supabase/migrations/20261012000002_orch_1148_2_2_reservation_checkout_sessions.sql` | Thin fee-session table (OQ-2 locked) — buyer/slot/amount/charge-ref/status/`reservation_id` link; RLS-enabled, deny-by-default (service-role only). |
| `supabase/migrations/20261012000003_orch_1148_2_2_guest_reservation_rpc.sql` | `pg_create_guest_reservation` (writer) + `pg_cancel_guest_reservation` (token) + `pg_cancel_my_reservation` (consumer) + `pg_reservation_before_cancel_cutoff` + `resolve_brand_pricing_inputs` (brand-scoped pricing resolver). |
| `supabase/migrations/20261012000004_orch_1148_2_2_engine_anon_probe.sql` | Read-only exposure probe (fails-on-revert). |
| `supabase/functions/venue-reservation-create/index.ts` | The single guest write path (free + fee). |
| `supabase/functions/venue-reservation-confirm/index.ts` | The fee finalize (verify charge → atomic mint). |
| `Mingla_Artifacts/tests/TEST_META-ORCH-1148_SUBC_2_2A_guest_booking.test.sql` | Live behavioral harness C-01..C-12. |

## 3. RPC / FUNCTION SIGNATURES
- `pg_create_guest_reservation(p_brand_id uuid, p_reserved_for timestamptz, p_party_size int, p_source text, p_created_via text, p_consumer_user_id uuid, p_guest_name text, p_guest_phone_e164 text, p_guest_email text, p_fee_cents int, p_fee_currency char(3), p_payment_intent_id text, p_payment_status text, p_guest_cancel_token text, p_occasion text DEFAULT NULL, p_guest_notes text DEFAULT NULL, p_status text DEFAULT 'confirmed') RETURNS public.reservations` — SECURITY DEFINER, **service_role ONLY** (REVOKE PUBLIC+anon+authenticated).
- `pg_cancel_guest_reservation(p_reservation_id uuid, p_guest_cancel_token text) RETURNS TABLE(reservation public.reservations, refund_eligible boolean)` — SECURITY DEFINER, service_role ONLY.
- `pg_cancel_my_reservation(p_reservation_id uuid) RETURNS TABLE(reservation public.reservations, refund_eligible boolean)` — SECURITY DEFINER, **authenticated** (asserts `consumer_user_id = auth.uid()`).
- `resolve_brand_pricing_inputs(p_brand_id uuid) RETURNS TABLE(pass_tax, pass_mingla_fee, pass_service_fee, pricing_region, pricing_currency, effective_take_rate_bps, take_rate_source, stripe_account_id, stripe_charges_enabled, payment_provider, payment_country, paystack_subaccount_code, vat_rate_bps)` — SECURITY DEFINER, service_role ONLY. Reservation `pass_*_override` on `venue_reservation_settings` wins over brand defaults.
- `pg_reservation_before_cancel_cutoff(p_reserved_for timestamptz, p_cancel_cutoff_hours int) RETURNS boolean` — STABLE helper.

## 4. THE ENGINE GRANT + EXPOSURE VERDICT
The seam pre-authored at 2.1a `20261008000001:296` is flipped ON. Verdict (SPEC §4.A.1, re-confirmed): the engine is SECURITY DEFINER, returns EXACTLY the 4 aggregate columns (`slot_start_utc/slot_local_label/remaining/is_full`) — ZERO reservation PII; the only thing leaving from `reservations` is the integer `remaining` count. anon needs ONLY engine EXECUTE (definer-rights reach the locked tables + helper); the helper + tables stay anon-denied. **SAFE.**

**Probe (000004) asserts:** (1) anon HAS engine EXECUTE; (2) helper anon-DENIED; (3) writer RPCs anon-DENIED; (4) every venue_*/reservations table is RLS-enabled with NO anon/PUBLIC policy; (5) engine return has the 4 cols + no PII/id column crept in; (6) the writer body re-validates against `pg_venue_available_slots` + takes `pg_advisory_xact_lock` + enforces `deposit_threshold`/`deposit_required`.

> **Environment-faithful correction (finding):** Supabase's `public`-schema ALTER DEFAULT PRIVILEGES blanket-GRANT table-level SELECT to `anon` on EVERY table — the grant is INERT, RLS is the real boundary. So the probe asserts the **RLS** boundary (RLS-enabled + no anon policy), NOT grant-absence (which Supabase always contradicts). Proven live: anon reads **0** reservation rows despite the grant. This matches how the shipped 2.1a/2.1b probes operate (they assert function EXECUTE ACLs, never table-grant absence).

## 5. FEE / FREE / CONFIRM CONTRACT (fee model = CHARGE UPFRONT, forfeit after cutoff)
- **FREE** (no fee, no deposit threshold): `venue-reservation-create` calls `pg_create_guest_reservation` directly → `{ kind:"free_completed", reservationId, guestCancelToken?, receiptUrl }`.
- **FEE** (reservation fee OR deposit_threshold): rides the **shared** all-in engine (`computeBuyerSubtotal`/`buildPricingBreakdown`/`computeConfigVat`, no inline math) → writes a `reservation_checkout_sessions` row (`status='pending'`) FIRST (durable charge record) → `surface:"native"` ⇒ PaymentIntent on the connected account + Customer/ephemeral key ⇒ `{ kind:"requires_payment", reservationDraftId, clientSecret, … }`; `surface:"web"` ⇒ hosted Stripe Checkout ⇒ `{ kind:"requires_web_redirect", reservationDraftId, hostedCheckoutUrl, … }`; NG ⇒ `{ kind:"requires_paystack_redirect", … }` (falls out of reuse — no new Paystack work).
- **CONFIRM** (`venue-reservation-confirm`, mirrors ticket-checkout-confirm): buyer-status-token hash-gated; verifies the PI succeeded (resolves PI from the hosted Checkout session on web) → mints the reservation via the SAME writer with `payment_status='paid'` → flips the session to `completed` + links `reservation_id`. **Atomicity contract:** no fee reservation is `confirmed` without a verified charge; the pending session is the record that prevents a charge without a row to flip. If the slot was taken between create and confirm, the writer rejects `slot_unavailable` and the session is flagged `slot_unavailable_after_charge_refund_due` (refund seam → reuse `refund-order`, wired in 2.2b/2.2c).
- **Charge-readiness gate (ORCH-1073 lineage):** a fee venue must have `stripe_charges_enabled=true` (or a Paystack subaccount for NG) → else 409 `stripe_account_not_ready`. NO buyer tax form — tax is venue-sourced via the brand region (degrade-to-flat-absorb when no registration; inclusive VAT re-derived deterministically). WYSIWYP.

## 6. GATE RESULTS
| Gate | Result |
|---|---|
| Full migration chain (245 files) on `supabase/postgres:17.4.1.075` Docker | **ALL APPLIED CLEAN** through 20261012000004 |
| Exposure probe 20261012000004 | **PASS** (NOTICE printed) |
| Behavioral harness C-01..C-12 (live) | **14 PASS lines, 0 FAIL** |
| `deno check` (venue-reservation-create + -confirm) | **EXIT 0** (zero type errors) |
| `orch-1130-no-buyer-tax-form.mjs` | **PASS** |
| `orch-0843-stripe-direct-charges-only.mjs` | **PASS** |
| `i-stripe-pm-method-allowlist.mjs` | **PASS** |
| No-inline-fee-arithmetic (manual grep) | **CLEAN** — imports allInPricingEngine, 6× engine calls, 0 hand-rolled bps/×100 math |
| Monotonic above global max `20261011000001` | **YES** (000000–000004) |
| DO-NOT-TOUCH untouched (engine body, ticket-checkout-create, allInPricingEngine, operator suite, send-venue-sms) | **YES** (git status = only scoped NEW files) |

**Behavioral coverage:** C-01 anon engine callable + 4 cols · C-02 helper anon-denied · C-03 anon reads 0 rows · C-04 brand-scoped confirmed write · C-05 fabricated slot → slot_unavailable · C-06 last-seat double-book → slot_unavailable · C-07 oversize party → slot_unavailable (party_fit) · C-08 free write for deposit party → deposit_required · C-09 paid deposit write succeeds · C-10 consumer-own-read RLS (non-member sees only own) · C-11 cancel-by-token → cancelled_by_guest + refund-eligibility + wrong-token denied · C-12 fee-session pending→completed+linked, anon-unreadable. Maps to SC-1/2/3/8/9/13/15.

## 7. FAILS-ON-REVERT (proven live; cite commit `7e090cd9e`)
- **Keystone grant:** `REVOKE EXECUTE … FROM anon` on the engine → probe trips with `anon MUST have EXECUTE on pg_venue_available_slots (the 2.2 keystone grant was reverted)`. Restoring the grant → probe passes. **PROVEN.**
- **Slot re-validation:** replaced the writer with a no-revalidation stub → probe trips with `the guest writer MUST re-validate against pg_venue_available_slots (anti-double-book)`. Restoring the real writer → probe passes (+ the behavioral C-06 double-book also fails under the stub). **PROVEN.**

## 8. SECRETS / DEPLOY NEEDS (orchestrator — from MERGED origin/main only)
- **config.toml registration (NOT added here — additive on deploy):** `[functions.venue-reservation-create] verify_jwt = false` and `[functions.venue-reservation-confirm] verify_jwt = false` (both are public buyer endpoints, auth optional via the bearer; the create fn keys app-vs-guest off `userIdFromAuthHeader`, the confirm fn off the buyer-status-token hash — exactly like ticket-checkout-create / ticket-checkout-confirm).
- **Migrations:** apply 20261012000000→000004 via the **Supabase Management API** (CLI drift-wedged; MCP read-only). Additive; idempotent.
- **Edge fns:** deploy `venue-reservation-create` + `venue-reservation-confirm` from MERGED main (COMMS-0015). They reuse existing secrets — no NEW secret: Stripe keys (`resolveStripeKey`), `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `MINGLA_PUBLIC_WEB_BASE_URL` (web hosted redirect), `PAYSTACK_*` (NG arm, already set for ticket-checkout). No Twilio.
- After CLOSE: flip the 4 DRAFT invariants ACTIVE (ENGINE-ANON-EXPOSES-ONLY-SLOTS, RESERVATION-WRITE-REVALIDATES-SLOT, GUEST-FEE-VIA-SHARED-ALL-IN-ENGINE, CHARGE-AND-RESERVATION-ATOMIC).

## 9. AMBIGUITY / NOTES FOR DOWNSTREAM
- **OQ-1/6/7 (UI-side, deferred to 2.2b/2.2c):** the report does not resolve them — they are client concerns. The receipt data path (OQ-7) will need a token-gated anon-readable `pg_public_reservation_receipt` in 2.2c (the `reservation_checkout_sessions` row + the `reservations.guest_cancel_token` are the seam).
- **NG/Paystack reservation confirm:** `venue-reservation-confirm` proves the **Stripe** verify seam live; NG fee venues finalize via the `paystack-webhook` arm (a thin additive reservation branch, named after the in-flight `paystack_reference` — flagged as the 2.2c/webhook wiring, STOP-AND-AMEND before editing `paystack-webhook`). The SPEC OQ-5 expects zero live NG fee venues today (zero blast radius).
- **Refund execution on cancel:** the cancel RPCs FLAG `refund_eligible` (paid + refundable + before cutoff); they do NOT execute the refund. The edge cancel endpoint (2.2b/2.2c) reuses `refund-order` when the flag is true. The `confirm` fn already flags `slot_unavailable_after_charge_refund_due` for the rare race-loss-after-charge case.
- **Brand-scoped pricing resolver added** (`resolve_brand_pricing_inputs`) because `resolve_event_pricing_inputs` is event-scoped and reservations are brand-scoped — it mirrors the event resolver exactly, brand-side, honoring the reservation `pass_*_override`.
- The Docker test container `mingla_1148_test` is left running for the tester; tear down with `docker rm -f mingla_1148_test`.

---

## 10. DEFECT-1 idempotency fix (P1, money integrity) — re-dispatched 2026-06-17

**Tester verdict:** CONDITIONAL PASS (`TEST_META-ORCH-1148_SUBC_2_2A.md`) — DEFECT-1: the fee-confirm path was NOT idempotent on `payment_intent_id`. A double-fired / replayed / flip-failure-retried `venue-reservation-confirm` on a slot with `remaining ≥ 2` minted TWO reservations from ONE charge. Tester's regression sentinel **T-A1 FAILED on HEAD `7e090cd9e`**.

**Root cause (two seams):**
1. `pg_create_guest_reservation` had no idempotency key on `payment_intent_id`; its advisory-lock guard only re-validates *slot capacity*, which passes when `remaining ≥ 2`.
2. `venue-reservation-confirm/index.ts` read the session `status` OUTSIDE any lock (TOCTOU), minted via the bare writer, then did a **fire-and-forget** `.update({status:"completed", reservation_id})` (unchecked). Two concurrent confirms both read `pending`, both verified the PI `succeeded`, both minted.

### The fix (mirrors `biz_ticket_checkout_finalize`'s FOR-UPDATE + return-existing)
**New migration `supabase/migrations/20261012000005_orch_1148_2_2a_idempotent_fee_finalize.sql`** (true global max was `20261012000004` → this is `20261012000005`; `$function$` closed before each GRANT; `REVOKE PUBLIC+anon+authenticated`, `GRANT service_role`):

1. **`pg_finalize_guest_reservation(p_session_id uuid, p_payment_intent_id text)`** — service-role-only. `SELECT * ... FROM reservation_checkout_sessions WHERE id = p_session_id FOR UPDATE`; if `reservation_id IS NOT NULL` → **early-return the existing reservation** (mirror of `biz_ticket_checkout_finalize`'s `IF v_session.order_id IS NOT NULL THEN RETURN <existing>`). Else: PI-keyed adopt-if-exists, else MINT via the unchanged `pg_create_guest_reservation` (advisory-lock double-book guard + slot re-validation + capacity/deposit all preserved) AND flip the session `completed` + link `reservation_id` **in the SAME txn** (no longer fire-and-forget). A racing same-PI mint that slips the lock raises `unique_violation` → caught and the winning row adopted.
2. **`CREATE UNIQUE INDEX reservations_payment_intent_id_uniq ON reservations(payment_intent_id) WHERE payment_intent_id IS NOT NULL`** — DB-layer belt: a duplicate mint for one PI is impossible even under a race the lock misses. Free rows (NULL PI) unconstrained.

`pg_create_guest_reservation` body/signature **UNCHANGED**.

**Edge fn `venue-reservation-confirm/index.ts` (`venue-reservation-confirm` BEFORE → AFTER):**
- BEFORE: `supabase.rpc("pg_create_guest_reservation", {…18 args…})` then a separate fire-and-forget `.update({status:"completed", reservation_id})`.
- AFTER: `supabase.rpc("pg_finalize_guest_reservation", { p_session_id: sessionId, p_payment_intent_id: session.stripe_payment_intent_id })`; the RPC returns `TABLE(reservation reservations, session_id uuid)` (PostgREST → one-row array, nested `reservation` composite) — extract `finalRow.reservation.id`. The mint + session-flip are now ONE atomic txn inside the RPC; the `slot_unavailable` refund seam is preserved. The pre-existing `status==="completed"` fast-path remains as belt-and-braces.

### Live proof (Docker `supabase/postgres:17.4.1.075`, fresh container, full 246-file chain applied CLEAN)
| Check | Result |
|---|---|
| Full migration chain incl. `20261012000005` | **APPLIED CLEAN** from scratch |
| `pg_finalize_guest_reservation` exists; `reservations_payment_intent_id_uniq` exists | **YES** |
| Finalize grants: anon=DENY, authenticated=DENY, service_role=GRANT | **CORRECT** |
| **Tester T-A1** (regression sentinel) | **PASS** — "writer is idempotent on payment_intent_id (one reservation per charge)" (was FAIL on HEAD) |
| Tester T-A2 / T-A3 / T-A4 (PII-coax / cross-guest cancel / keystone fails-on-revert) | **PASS** (still green) |
| Implementor C-01..C-12 harness | **14 PASS, 0 FAIL** (re-run on the fresh chain) |
| **Finalize idempotency harness** `TEST_META-ORCH-1148_SUBC_2_2A_defect1_finalize_idempotency.test.sql` (F-1 double-finalize→1 row+same id+atomic link, F-2 unique-index rejects dup-PI 23505, F-2b NULL unconstrained, F-3 early-return-if-linked) | **F-1/F-2/F-2b/F-3 ALL PASS** |
| `deno check` venue-reservation-confirm + -create | **EXIT 0** both |
| `deno lint` venue-reservation-confirm | **CLEAN** |
| Money-seam gates `orch-1130-no-buyer-tax-form` / `orch-0843-stripe-direct-charges-only` / `i-stripe-pm-method-allowlist` | **ALL PASS** |
| Migration monotonic above true global max | **YES** (`20261012000005`) |
| Diff scope | only `venue-reservation-confirm/index.ts` + the new migration + the new test |

### Fails-on-revert (proven live)
Reverting BOTH guards (drop `reservations_payment_intent_id_uniq` + strip the FOR-UPDATE/early-return so finalize naively always-mints) → a double-finalize of one session minted **2 reservations for ONE charge** → DEFECT-1 re-manifests. NOTICE: *"FAILS-ON-REVERT PROVEN: reverted finalize … minted 2 reservations for ONE charge → DEFECT-1 re-manifests. The fix is load-bearing."* Restoring the migration → T-A1 + F-1 PASS. The fix is load-bearing.

**Fix commit:** the DEFECT-1 fix is the branch tip on `ORCH-1148-venue-guest-booking`, rebased onto origin/main `9d962f248` (migration `20261012000005` + the `venue-reservation-confirm` edit + this report). Docker container `mingla_1148_fix` torn down. Do NOT deploy/apply/merge.

*End of report. Do NOT deploy/apply/merge — orchestrator owns that from merged main.*
