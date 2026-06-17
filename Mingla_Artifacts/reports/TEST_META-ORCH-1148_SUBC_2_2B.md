# TEST — META-ORCH-1148 sub-ORCH 2.2b (consumer-app reserve flow + "my reservations")

> **Tester:** mingla-tester (brutal) · **Date:** 2026-06-17 · **Branch:** `ORCH-1148-venue-consumer-reserve` · **Impl HEAD:** `b5635f6d2`
> **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1148-[venue-consumer-reserve]/`
> **Method:** independent code-trace of all 13 changed files + the 2.2a contracts they consume; full 252-migration Docker chain (`supabase/postgres:17.4.1.075`); live anon/authenticated leak + cross-user probes; my OWN adversarial SQL test (different angle than the implementor's structural .mjs); app-mobile tsc/eslint/check gates run myself. Docker created + torn down.

## VERDICT: **CONDITIONAL PASS**

The reservable gate, engine-sole-source, free/fee routing, no-sign-in, calendar union, the resolve-RPC exposure, and consumer-own cancel/read ownership are all **proven correct** (SQL proven live; UI proven by code-trace, per the runtime-evidence policy — the device/sim visual leg defers to the consumer dev-OTA). The conditions are NOT money-correctness or security defects — they are a documented SPEC-copy deviation on the fee step-3 display and a cosmetic filter inconsistency.

### Conditions to clear (all P3/P4 — none block the free-reserve loop or money correctness)
- **C1 (P3) — fee step-3 does not meet the SPEC's "Confirm & pay" + on-screen all-in.** SPEC §195 / SC-5 lock: *"FEE → the fee shown all-in WYSIWYP + 'Confirm & pay'."* The sheet's CTA is **always** `"Confirm reservation"` and step 3 renders **no numeric total** before the PaymentSheet. WYSIWYP is still genuinely preserved (the native PaymentSheet shows the exact charge before the buyer confirms — no checkout surprise), and the constraint is real: the sheet can't know free-vs-fee or the total until `venue-reservation-create` returns its union `kind`, and the allowlist forbids adding a preview arm. Implementor flagged this honestly (report §8). **Clear by:** orchestrator accepts the PaymentSheet-as-WYSIWYP substitute for this slice, OR spawns a follow-up to add a `venue-reservation-create` preview arm so step 3 can render the total + flip the CTA to "Confirm & pay". Recommend ACCEPT for this slice + register the follow-up.
- **C2 (P4) — reservation rows bypass the Calendar search/when filters.** Calendar entries + ticket orders pass through `filteredActive*`; reservations are merged from the raw `activeReservations`/`archiveReservations`, so a search term or "when" filter does NOT narrow the reservation rows. Cosmetic inconsistency only (rows still render correctly, bucket correctly). Register as polish.

## Per-criterion results

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | **Resolve RPC exposure (live)** | **PASS** | Full chain applied clean on Docker. ACL: anon/authenticated/service_role = EXECUTE, **PUBLIC = no execute** (`has_function_privilege('public',…)=f`); SECURITY DEFINER + STABLE + `search_path=public,pg_temp`; exactly 3 OUT cols `{reservable, brand_id, currency}`. Behavioral as **anon**: reservable+verified → `{t, brand_id, USD}`; disabled → `{f, NULL, NULL}` (no leak); no-settings → `{f, NULL, NULL}`; **unverified claim (enabled) → 0 rows**; **soft-deleted → 0 rows**; fake place → 0 rows; NULL → 0 rows no-crash. anon direct reads of `reservations` + `venue_reservation_settings` → **0 rows** (RLS default-deny; only the SECURITY DEFINER resolver path returns data). |
| 2 | **No dead tap / reservable gate** | **PASS** | `ExpandedCardModal` button (L2115) + sheet mount (L2337) both gated `venueReservable?.reservable === true && venueReservable.brand_id !== null`, INSIDE the `isNightOut && nightOut` branch. `useVenueReservable(card?.id)` disabled (no fetch) for non-uuid ids (stroll/picnic/curated/Ticketmaster). Non-reservable place → `{f, null}` → no button. |
| 3 | **Engine is the SOLE slot source** | **PASS** | `useVenueAvailability` calls only `pg_venue_available_slots` (signature `p_brand_id/p_date/p_party_size` → `slot_start_utc/slot_local_label/remaining/is_full` — verified matches the 2.1a engine v2). Maps engine rows 1:1; no fabricated fallback. Empty → `VenueSlotPicker` "Fully booked"; full slots `disabled` at opacity 0.45 (not hidden, no dead tap). **No waitlist self-join present** (deferred — confirmed absent). |
| 4 | **Free vs fee routing + confirm step + no client tax + no sign-in** | **PASS (with C1)** | FREE → `created.kind==="free_completed"` → succeeded. FEE → `requires_payment` → Connect re-init (`initStripe` with `stripeAccountId`) → `presentPaymentSheet` → `finalizeFee` → `venue-reservation-confirm`. Paystack arm present (in-app browser + bounded poll). Step 3 confirm/review renders for FREE **and** FEE (locked). No client tax math (server all-in only). **NO sign-in** anywhere — sheet imports no `signInWith*`; reservation attaches via bearer token. **C1:** fee step-3 lacks the on-screen all-in + "Confirm & pay" copy (PaymentSheet substitutes). |
| 5 | **Calendar union + cancel (consumer-own only)** | **PASS** | Third `UnifiedRow "reservation"` kind; bucket by effective end (cancelled/completed/no_show/past → Archive); render branch in BOTH Active + Archive maps; existing ticket/calendar branches intact (no regression). Cancel → `pg_cancel_my_reservation` (authenticated-only; asserts `consumer_user_id = auth.uid()`; returns `(reservation, refund_eligible)` — matches the hook). **Live-proven: a user CANNOT read or cancel another user's reservation** (ADV-5/6 below). `[TRANSITIONAL]` refund-execution gap is flagged in code (`useMyReservations.ts` + `handleCancelReservation`) + UI copy ("Any deposit refund will follow") — acceptable + clearly labeled. |
| 6 | **No regressions / scope** | **PASS** | The 2.2b commit touches ONLY the 13 scoped files. `venue-reservation-create`/`-confirm` edge bodies last touched by 2.2a (`3c7c6c1e2`); engine RPC by 2.1a — **not modified by 2.2b**. No web reserve (2.2c) files added. No operator-suite / `allInPricingEngine` / `ticket-checkout-create` edits. Existing Calendar rows render unchanged. |
| 7 | **Tester's OWN adversarial test** | **PASS + fails-on-revert** | See below. |
| 8 | **Gates run by tester** | **PASS** | tsc `--noEmit` = **416 errors = baseline**, **0 in any 2.2b file**. ESLint changed files = only `import/no-unresolved '@mingla/payments-native'` — **proven pre-existing** (identical in `src/payments/nativeCheckoutFlow.ts`, the reused seam). 2.2b structural check = **33/33 PASS**, revert → **4 failures, exit 1**. No jest runner in app-mobile (the `.mjs` convention is correct). Migration full chain applied clean on Docker. |

## Resolve-RPC exposure verdict: **SAFE — no leak**
`pg_venue_reservable_for_place` is a SECURITY DEFINER display-gate that exposes EXACTLY `{reservable, brand_id, currency}` and ONLY through the verified-claim + not-deleted + reservations_enabled path. Live anon probes proved: brand_id/currency are NULL when reservations are off; the function returns ZERO rows for an unverified claim, a soft-deleted brand, or a fake place id; no reservation PII / fee amount / other settings column is ever returned; anon cannot read the underlying tables directly (RLS default-deny). The verified gate is **load-bearing** — stripping it leaks an unverified brand's `brand_id`+`currency` (proven by direct revert below). brand_id is already public via the deck/experiences RPCs, so exposing it for a *verified-reservable* venue is consistent with the existing posture.

## My adversarial test (DIFFERENT angle than the implementor's 33 structural greps)
**Path:** `supabase/migrations/__tests__/orch_1148_2_2b_consumer_reserve.adversarial.test.sql` (append-only; runs in one txn + ROLLBACK; live-fire on Docker, NOT a text grep).

The implementor's gate only greps SOURCE TEXT — it never EXECUTES the resolver, the consumer-own RLS, or the cancel RPC, so it cannot catch a wrong predicate, a missing ownership gate, or a cross-user leak. My test executes the real DDL+RLS+RPCs with TWO authenticated consumers + anon and asserts security BY BEHAVIOR. All 8 PASS live:
- **ADV-1** unverified-claim brand → 0 rows (resolver verified gate). **ADV-2** disabled venue → `{f, NULL, NULL}` (no leak). **ADV-3** soft-deleted → 0 rows. **ADV-4** reservable → `{t, brand_id, USD}`.
- **ADV-5** consumer B canNOT read consumer A's reservation (A reads own=1, B reads A=0) — consumer-own RLS.
- **ADV-6** consumer B calling `pg_cancel_my_reservation` on A's row → `reservation_not_found` AND A's row stays `confirmed` (a user CANNOT cancel another's).
- **ADV-7** owner A cancels own → `cancelled_by_guest`. **ADV-8** anon sees 0 reservation + 0 settings rows.

**Fails-on-revert (proven live, cited against HEAD `b5635f6d2`):**
- Strip `claim_status='verified'` from `pg_venue_reservable_for_place` → **ADV-1 FAILS** (reverted fn returned `{t, b4, USD}` for the unverified brand where the shipped fn returns 0 rows). Restored from the migration → ADV-1 PASS again.
- Strip `AND consumer_user_id = v_uid` from `pg_cancel_my_reservation` → **ADV-6 FAILS** ("consumer B CANCELLED consumer A's reservation"). Restored → ADV-6 PASS again.

The implementor's `.mjs` revert also bites (4 seams: no-fabricated-slots, free-has-confirm, affordance gate, calendar render).

## Defects
- **P3 — C1:** fee step-3 lacks the SPEC-locked on-screen all-in WYSIWYP total + "Confirm & pay" CTA; relies on the native PaymentSheet for the amount. Real constraint (no preview arm in the 2.2a contract; free-vs-fee unknown until create returns). Money correctness intact (PaymentSheet = genuine pre-charge review). Recommend ACCEPT for this slice + register a preview-arm follow-up.
- **P4 — C2:** reservation Calendar rows bypass the search/when filters (cosmetic).
- **P4 (note):** `useVenueReservable` fires one RPC per nightOut card expansion. Acceptable (5-min staleTime cache; mirrors `useVenueExperiences`).
- **[TRANSITIONAL] (accepted):** cancel refund EXECUTION not wired (`pg_cancel_my_reservation` only FLAGS `refund_eligible`); clearly labeled in code + UI. Acceptable per the prompt ("the refund-execution seam may be stubbed + flagged").

## Runtime evidence ledger
- SQL/RLS/RPC: **PROVEN LIVE** on Docker `supabase/postgres:17.4.1.075` (full 252-migration chain + anon/2-consumer probes + fails-on-revert). Container torn down.
- App UI (reservable gate, engine-sole-source, free/fee routing, no-sign-in, calendar union): **PROVEN by code-trace + the structural gate** (capped at "verified-by-source" per policy). The device/sim visual leg (free reserve, fee PaymentSheet, cancel, Calendar rows on iOS + consumer Android) **DEFERS to the consumer dev-OTA** — flagged for the close-time device pass per the report's DEPLOY NEEDS.

---
*No code was modified by the tester (only the append-only adversarial test artifact was added). Do NOT deploy/apply/merge — orchestrator owns that from merged main.*
