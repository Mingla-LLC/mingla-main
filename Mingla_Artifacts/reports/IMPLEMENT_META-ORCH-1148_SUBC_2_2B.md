# IMPLEMENT — META-ORCH-1148 sub-ORCH 2.2b (consumer-app reserve flow + "my reservations")

> **Implementor:** mingla-implementor · **Date:** 2026-06-17 · **Branch:** `ORCH-1148-venue-consumer-reserve`
> **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1148-[venue-consumer-reserve]/`
> **Binding SPEC:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1148_SUBC_GUEST_BOOKING.md` (built ONLY the 2.2b slice — the CONSUMER app, on the shipped 2.2a backend) + the JOURNEY_MAP §0/§DECISIONS LOCKED incl. the **2026-06-17 CORRECTION (NO sign-in step in the consumer reserve flow)**.
> **Comms Ledger:** read on entry (AGENT_HANDOFFS.md). No BLOCK / `to:ORCH-1148` / `to:mingla-implementor` directives for me. Factored COMMS-0015 (deploy edge fns + apply migrations only from MERGED origin/main), COMMS-0011/0024/0037 (git-fetch before any new ID), Android opaque-glass policy, a11y I-39.

## 1. SCOPE BUILT (2.2b consumer app only)
The consumer reserve flow on the shipped 2.2a backend: a reservable-venue gate + "Reserve a table" affordance on the nightOut expanded card → a 3-step `VenueReserveSheet` (party+date → engine slots → confirm/review) → FREE confirm (`venue-reservation-create` free path) OR FEE native PaymentSheet + `venue-reservation-confirm`; plus "my reservations" folded into the existing Calendar tab as a third `UnifiedRow` kind with a Cancel action. **NO operator-suite / engine-body / ticket-checkout-create / allInPricingEngine edits. NO web reserve flow (2.2c). NO new sign-in.** One net-new anon resolve RPC (OQ-1) is the only backend change.

## 2. CHANGED FILES (HEAD commit `__HEAD__`)
| File | NEW/MOD | What |
|---|---|---|
| `supabase/migrations/20261012000006_orch_1148_2_2b_venue_reservable_for_place.sql` | NEW | OQ-1 resolve RPC `pg_venue_reservable_for_place(place_pool_id)` → `{reservable, brand_id, currency}`. SECURITY DEFINER, anon+authenticated EXECUTE, REVOKE PUBLIC. Mirrors the anon `pg_brand_experiences_for_place` verified-claim place→brand pattern. brand_id+currency NULL unless `reservations_enabled` (no leak when off). |
| `app-mobile/src/hooks/useVenueReservable.ts` | NEW | Calls the resolve RPC; disabled for non-uuid place ids (mirrors useVenueExperiences). Powers the affordance gate (no dead tap). |
| `app-mobile/src/hooks/useVenueAvailability.ts` | NEW | Reads the engine `pg_venue_available_slots` (anon-grant from 2.2a). SOLE slot source — never fabricates; empty = fully booked. 30s staleTime. |
| `app-mobile/src/services/venueReservationService.ts` | NEW | `createVenueReservation` (surface native) + `confirmVenueReservation` calling `venue-reservation-create` / `-confirm`. The response `kind` is the success discriminator; transport/edge errors throw. |
| `app-mobile/src/hooks/useReserveTable.ts` | NEW | The commit: FREE → succeeded; FEE → native PaymentSheet (reuses `@mingla/payments-native` `useStripePaymentSheet` + the ORCH-0844 Connect direct-charge re-init, mirroring `nativeCheckoutFlow` exactly) → `venue-reservation-confirm`; NG/Paystack → in-app browser + bounded-poll confirm. Invalidates `["myReservations", userId]` on success. |
| `app-mobile/src/hooks/useMyReservations.ts` | NEW | Reads the caller's own reservations via the 2.2a consumer-own SELECT RLS (joins brand name). `cancelMyReservation` calls `pg_cancel_my_reservation` (2.2a). |
| `app-mobile/src/components/expandedCard/VenueSlotPicker.tsx` | NEW | Step-2 slot grid (mirrors ExperienceOccurrencePicker's dark vocabulary): available chip; full slots **disabled** at opacity 0.45 (never hidden, no dead tap); empty → "Fully booked — try another day"; loading/error states. |
| `app-mobile/src/components/expandedCard/VenueReserveSheet.tsx` | NEW | The 3-step `BaseBottomSheet` (theme dark; Android opaque fill via BaseBottomSheet). Party stepper + date strip → slot grid → confirm/review (ALWAYS, even FREE). Collects a phone via the shared `PhoneInput` only when the signed-in user has none. a11y labels on stepper/date/slot/CTA. NO sign-in step. |
| `app-mobile/src/components/ExpandedCardModal.tsx` | MOD | nightOut branch: `useVenueReservable(card.id)` + a "Reserve a table" button gated on `reservable===true && brand_id!==null` (NO dead tap), opening `VenueReserveSheet` as a SIBLING of the root sheet (the proven sub-sheet pattern; root gated off via `anyChildModalOpen`). Success → restrained Alert pointing to Calendar→Reservations. |
| `app-mobile/src/components/activity/ReservationCalendarRow.tsx` | NEW | Renders one reservation row (venue · day/time · party · free/deposit · status) with a Cancel action for upcoming confirmed/requested rows. Mirrors BusinessEventCalendarRow's animation prop. |
| `app-mobile/src/components/activity/CalendarTab.tsx` | MOD | Added the third `UnifiedRow` kind `"reservation"`; `useMyReservations(user.id)`; bucket into Active/Archive (cancelled/completed/past → Archive); merge into both unified row builders; render branch in both Active + Archive maps; `handleCancelReservation` → `cancelMyReservation` + invalidate + outcome Alert. |
| `app-mobile/scripts/ci/orch-1148-2-2b-consumer-reserve-check.mjs` | NEW | 33-assertion structural/behavioral gate (app-mobile `.mjs` convention) with `ORCH1148_2_2B_SIMULATE_REVERT=1` fails-on-revert. |

## 3. LOCKED DECISIONS HONORED
- **NO sign-in step (2026-06-17 CORRECTION).** The reserve sheet never imports/calls `signInWithApple`/`signInWithGoogle`; the reservation attaches to `useAppStore().user` server-side via the bearer token (`created_via='consumer'`). Gate test asserts the absence.
- **Reserve from the EXISTING place card** — affordance in `ExpandedCardModal` nightOut branch, alongside `VenueExperiencesSection`. No new deck card / supply.
- **"My reservations" = EXTEND the Calendar tab** — third `UnifiedRow` kind merged into the existing Active/Archive buckets (reuses `computeEntryEffectiveEnd`-style bucketing). NOT a new surface (OQ-6 resolved: a Reservations row-kind in the existing Calendar/Plans area, per the journey map).
- **3-step flow**; **FREE STILL has the confirm/review step** (step 3 renders for free + fee; gate test asserts it).
- **All-in WYSIWYP, currency-aware, no buyer tax form** — the fee all-in is the server-computed total surfaced in the native PaymentSheet (genuine WYSIWYP — the buyer sees the exact charge before confirming; no client tax math). The free path has no fee.

## 4. THE NET-NEW BACKEND SEAM (OQ-1)
`pg_venue_reservable_for_place(p_place_pool_id uuid) RETURNS TABLE(reservable boolean, brand_id uuid, currency text)` — additive migration `20261012000006` (true global max was `20261012000005` → this is higher). It exists because there was no anon read to (a) tell the card whether the place is reservable and (b) get the brand_id to call the engine + edge fn. It mirrors the SHIPPED anon `pg_brand_experiences_for_place` verified-claim place→brand pattern exactly. **Exposure:** exactly 3 fields; brand_id + currency are NULL unless `reservations_enabled` (no leak when off); NO reservation PII / fee amount / other settings column; display gate only — `pg_venue_available_slots` stays the slot authority.

## 5. GATE RESULTS
| Gate | Result |
|---|---|
| **tsc `--noEmit` (app-mobile)** — error count WITH my changes | **416** = baseline (stash-confirmed below). **0 NEW errors in any of my 12 files.** |
| tsc baseline on HEAD (my changes stashed) | **416** pre-existing repo errors (Deno test files, BoardDiscussion, ConnectionsPage, **`nativeCheckoutFlow.ts:313` applePay** — the SAME pre-existing pattern I reuse). |
| **ESLint (changed files)** | Only ERROR is `import/no-unresolved '@mingla/payments-native'` in `useReserveTable.ts` — **PRE-EXISTING**: the proven `nativeCheckoutFlow.ts` (which I reuse verbatim) has the IDENTICAL error (workspace-package resolver limitation). All other items are pre-existing style warnings. Array-type warnings in my NEW files fixed. |
| **2.2b structural/behavioral gate** (33 checks) | **ALL 33 PASS** (resolve RPC shape/ACL/verified-link/no-leak · reservable gate · engine-no-fabricate · free-vs-fee routing · Connect re-init · invalidation · 3-step + free-confirm · no-sign-in · a11y · slot disabled/empty · affordance dead-tap gate · root-sheet gating · calendar union bucket/render×2/cancel). |
| **Migration full-chain Docker apply** (`supabase/postgres:17.4.1.075`, fresh container, all 251 migrations) | **ALL APPLIED CLEAN** including `20261012000006`. |
| **Resolve RPC ACL probes** (live) | anon=GRANT, authenticated=GRANT, service_role=GRANT, PUBLIC default REVOKE; SECURITY DEFINER + STABLE; exactly 3 OUT cols; unknown place → 0 rows. |
| **Resolve RPC behavioral** (live) | reservable venue → `{true, brand_id, USD}`; non-reservable → `{false, null, null}`; **unverified-claim brand → 0 rows** (verified gate bites). |
| DO-NOT-TOUCH untouched (engine body, ticket-checkout-create, allInPricingEngine, operator suite, venue-reservation-create/-confirm bodies, nativeCheckoutFlow, useAuthSimple) | **YES** — git status = only the 12 scoped files. |
| Migration monotonic above true global max `20261012000005` | **YES** (`20261012000006`). |

> **jest:** app-mobile has NO jest runner (the `test:orch-*` scripts are standalone node `.mjs` checks — the established convention). The 2.2b gate is that convention; there is no jest suite to run.

## 6. FAILS-ON-REVERT (proven)
`ORCH1148_2_2B_SIMULATE_REVERT=1 node scripts/ci/orch-1148-2-2b-consumer-reserve-check.mjs` → **exit 1**, with 4 load-bearing seams biting:
1. **No-fabricated-slots** — injecting a synthetic slot fallback into `useVenueAvailability` → ✗ (the engine-sole-source invariant bites).
2. **Free-has-confirm-step** — removing step 3 → ✗ (the locked free-still-reviews invariant bites).
3. **Affordance dead-tap gate** — loosening the Reserve button's `reservable && brand_id` gate to `true &&` → ✗ (the no-dead-tap invariant bites).
4. **Calendar reservation render** — dropping the `row.kind==="reservation"` branch → ✗ (the my-reservations-via-calendar-union invariant bites).
Normal run (no env) → **exit 0, all 33 PASS**. Migration fails-on-revert is the verified-claim behavioral test above (an unverified brand resolving would be the regression).

## 7. DRAFT INVARIANTS PRE-STAGED (orchestrator flips ACTIVE on CLOSE)
- `I-PROPOSED-1148-RESERVE-ONLY-FOR-RESERVABLE-VENUE` — the affordance renders ONLY when `reservable===true && brand_id!==null` (gate §7 of the check; no dead tap).
- `I-PROPOSED-1148-MY-RESERVATIONS-VIA-CALENDAR-UNION` — consumer reservations surface as a Calendar `UnifiedRow` kind, not a new surface.
- `I-PROPOSED-1148-RESERVE-ATTACHES-TO-SIGNED-IN-USER` — no sign-in step; the reservation carries the signed-in `consumer_user_id` server-side.
- `I-PROPOSED-1148-FREE-RESERVATION-HAS-CONFIRM-STEP` — the FREE path renders the confirm/review step before the write (shared with 2.2a/2.2c).
- `I-PROPOSED-1148-RESERVABLE-RESOLVER-EXPOSES-ONLY-DISPLAY-GATE` — the resolve RPC returns only `{reservable, brand_id, currency}`; never reservation rows/fee amounts/other settings cols, and only resolves via the verified-claim place link.

## 8. AMBIGUITY / [TRANSITIONAL] / NOTES FOR DOWNSTREAM
- **[TRANSITIONAL] Cancel refund execution is NOT wired.** `cancelMyReservation` calls the 2.2a `pg_cancel_my_reservation`, which honors the cutoff + FLAGS `refund_eligible`, but does NOT execute a deposit refund (reuse `refund-order`). The UI surfaces "Any deposit refund will follow." **Exit:** once an edge cancel endpoint executes the refund (the 2.2c / a follow-up edge-cancel seam), route the consumer cancel through it instead of the bare RPC. Marked `[TRANSITIONAL]` in `useMyReservations.ts` + `CalendarTab.handleCancelReservation`. (Per the prompt: "the refund-execution seam may be stubbed + flagged.")
- **FEE all-in display:** the SPEC asked for the all-in shown on step 3 before pay. There is no preview endpoint, and the allowlist forbids adding one. The implementation surfaces the exact server-computed all-in in the **native PaymentSheet** (genuine WYSIWYP — the buyer reviews the precise charge before confirming, no surprise), with a confirm-step note that a deposit may apply. If Seth wants the numeric all-in rendered ON step 3 pre-PaymentSheet, that needs a small preview arm on `venue-reservation-create` (out of this slice's allowlist) — **flagged for the orchestrator.**
- **Advance window:** the date strip offers the next 30 days; the engine (authority) returns empty slots for days outside the venue's `advance_window_days`, so out-of-window days correctly show "Fully booked" rather than the resolver exposing the operator window. Truthful, no extra exposure.
- **NG/Paystack:** `useReserveTable` handles the `requires_paystack_redirect` arm (in-app browser + bounded-poll confirm) — falls out of the 2.2a reuse; SPEC OQ-5 expects zero live NG fee venues today (zero blast radius). Stripe is the proven seam on device.
- **Phone collection:** the edge fn REQUIRES an E.164 phone (the venue contacts the guest); many signed-in users have no phone on file, so the confirm step collects one via the shared `PhoneInput` only when missing (E.164 assembled with the same `buildPendingCollabPhoneE164` helper). This is NOT a sign-in step.
- **OQ-6 (my-reservations mount):** resolved to the existing Calendar tab (a Reservations row-kind in the Active/Archive list), per the journey map's "Plans/my-reservations, not a deck card."

## 9. DEPLOY NEEDS (orchestrator — from MERGED origin/main ONLY)
- **Migration:** apply `20261012000006` via the **Supabase Management API** (CLI drift-wedged; MCP read-only). Additive, idempotent.
- **Edge fns:** NONE new in 2.2b (reuses the shipped 2.2a `venue-reservation-create` / `-confirm`).
- **OTA:** consumer dev channel (app-mobile runtime 1.1.0) on CLOSE — pure-JS RN change, no native module/config change → `eas update` (per the OTA gotchas memory), no `eas build`.
- Device-prove iOS + consumer Android: free reserve + fee reserve (PaymentSheet) + cancel + the Calendar Reservations rows (tester's job — this slice is source-+migration-proven).

---
*End of report. Do NOT deploy/apply/merge — orchestrator owns that from merged main. HEAD commit recorded below at commit time.*
