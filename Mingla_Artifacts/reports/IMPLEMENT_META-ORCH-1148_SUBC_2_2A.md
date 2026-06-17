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

*End of report. Do NOT deploy/apply/merge — orchestrator owns that from merged main.*
