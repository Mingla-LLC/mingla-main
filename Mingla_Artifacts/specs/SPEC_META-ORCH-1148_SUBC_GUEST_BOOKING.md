# SPEC — META-ORCH-1148 sub-ORCH 2.2 — GUEST-FACING BOOKING (Consumer app + Anonymous web)

> **Type:** BUILD CONTRACT (the binding spec the implementor builds from; no code here, snippets ≤2–3 lines).
> **Author:** mingla-forensics (SPEC mode) · **Date:** 2026-06-17 · **ORCH:** META-ORCH-1148 sub-ORCH 2.2 ("2.2", "Sub-C").
> **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1148-[venue-guest-booking]/` on branch `ORCH-1148-venue-guest-booking` (rebased onto origin/main; operator core 2.0/2.1a/2.1b merged).
> **Binding inputs read VERBATIM:** the journey map `design/JOURNEY_MAP_META-ORCH-1148_RESERVATION_E2E.md` (DECISIONS LOCKED §336–346) · VISION · PRD §5/§7/§8/§9 · the engine migration `supabase/migrations/20261008000001_orch_1148_available_slots_rpc_v2.sql` · the reservations/settings/capacity/waitlist schema + the 2.1b lifecycle/waitlist RPCs · `ticket-checkout-create/index.ts` + `_shared/allInPricingEngine.ts` · the anon-web funnel (`checkout/[eventId]/{buyer,payment,confirm}.tsx`, `ticketCheckoutService.ts`, `coldLoadAuthGates.ts`, `app/o/[orderId].tsx`) · the consumer reuse (`ExpandedCardModal.tsx`, `ExperienceOccurrencePicker.tsx`, `TicketCartSheet.tsx`, `nativeCheckoutFlow.ts`, `useAuthSimple.ts`).
> **Comms Ledger:** read on entry. No `BLOCK` or `to:mingla-forensics`/`to:ORCH-1148` entries. Factored the standing WARN-to-ALL deploy hazards: COMMS-0015 (deploy edge fns only from MERGED origin/main, never a worktree), COMMS-0011/0024 (ID-collision → git-fetch before any new ID), and the migration-via-Management-API rule.

---

## 0. THE LOCKED DECISIONS THIS SPEC ENCODES (journey map §336–346, Seth 2026-06-16)

1. **Reserve from the EXISTING place card** — a "Reserve a table" action inside `ExpandedCardModal`'s `nightOut` branch, alongside `VenueExperiencesSection`. **NO new deck card kind, NO new deck supply.**
2. **Consumer app = light one-tap sign-in AT CONFIRM** (existing Apple/Google one-tap). **Anonymous WEB stays fully login-free** (guest = name/email/E.164, identity on the row). So: web = guest/no-login; app = one-tap sign-in at the commit step (journey C5-opt-1; §5 Q3 resolved).
3. **FREE reservations STILL pass a confirm/review step** — not skip-to-instant. Free and paid share ONE flow; paid adds the PaymentSheet/hosted-Checkout step after review.
4. Already-resolved (supersedes PRD §9): waitlist "table's ready" = **Twilio SMS** (shipped 2.1b `send-venue-sms`); no-show = **auto-forfeit** (policy stored; capture is OUT of 2.2 per §2 non-goals — see OQ-4).

---

## 1. EXECUTIVE SUMMARY

2.1 stood up a bookable venue and froze the truthful availability engine. **2.2 is the demand-side conversion layer** that turns reservations ON for real guests on two surfaces — the consumer app (`app-mobile`, iOS + Android) and the login-free anonymous buyer web (`mingla-business` Expo-Router web). It is the largest and riskiest 2.x stage because it crosses the money path, the anon-engine GRANT, four surfaces, and the all-surface-parity rule.

Five net-new load-bearing pieces, everything else reuse:
1. **The engine anon-GRANT flip (KEYSTONE)** — `pg_venue_available_slots` is authenticated-only today; 2.2 grants `anon` EXECUTE so logged-out web (and any anon-browsing app path) can see truthful slots. The function is `SECURITY DEFINER`, returns ONLY 4 availability columns (no reservation PII, no cross-brand data), and the seam was pre-authored in the 2.1a migration (lines 295–298).
2. **`venue-reservation-create` edge function** — the SINGLE guest reservation write path, mirroring `ticket-checkout-create`'s shape: FREE → write the row + return; FEE → ride the shared all-in engine → native PaymentSheet (app) or hosted Stripe Checkout redirect (web) → reservation on success. Server-enforces capacity rules and RE-VALIDATES the slot against the engine at write time (anti-double-book).
3. **The 3-step reserve flow UI** (party+date → slot grid → confirm/review → free-confirm OR fee-pay), built once and rendered on app (native) + web (hosted), bound to the engine, sharing the confirm/review step across free and paid.
4. **The entry affordances** — a Reserve action on the nightOut expanded card (app) + a floating "Reserve a table" button on the public venue page (web/native parity) + the new public `/reserve/` route added to `PUBLIC_BUYER_ROUTE_PREFIXES`.
5. **Consumer "my reservations"** (app, tied to the signed-in user, with cancel-within-policy) + the web `/o/` reservation receipt (with cancel-from-link via a guest token).

**Recommended split: 2.2a (backend) → 2.2b (consumer app) → 2.2c (anon web).** See §12.

---

## 2. SCOPE & NON-GOALS

### In scope
- Engine anon-GRANT flip + a read-only exposure-probe + the named invariant.
- `venue-reservation-create` edge fn (free + fee; native-PaymentSheet vs hosted-Checkout fork; capacity + slot re-validation; brand-scoped; audited).
- A guest reservation write RPC (`pg_create_guest_reservation`, SECURITY DEFINER, service-role-only — the edge fn's atomic writer; see §4.A.3) — because the existing `biz_reservation_create` HARD-GATES on manager rank and CANNOT be the guest path.
- Consumer-app reserve flow + sign-in-at-confirm gate + "my reservations" + cancel.
- Anon-web reserve flow (new route + allowlist entry + buyer/payment/confirm reuse + `/o/` reservation receipt + cancel-from-link).
- The consumer "see my own reservation" SELECT RLS policy (deferred from 2.0, see `20261003000005` header line 6–7).
- `reservations.created_via` extension to include `website`/`consumer`-vs-`guest`; a `guest_cancel_token` column for web cancel; the `reservable` flag derivation read path.
- All-surface parity (consumer iOS + consumer Android + anon web) + consumer dev-channel OTA on close.
- Waitlist consumer self-join when the slot grid is empty (journey W1/W2; §5 Q4 → recommended self-join in v1) — **see OQ-3; SPEC defaults to including it in 2.2c but flags it as a confirm-or-defer.**

### Non-goals (explicitly NOT in 2.2)
- **The operator suite UI** (Tables/Availability/Reservations/Waitlist/Settings/shell) — READ-ONLY here; do not touch (shipped 2.0/2.1).
- **No-show auto-forfeit CAPTURE** — the *policy* is stored + shown to the guest; the actual Stripe capture/forfeit charge of a deposit on no-show is its own money-capture ORCH (the 2.1b lifecycle RPC explicitly defers capture). 2.2 records `no_show_fee_policy` on the row + displays terms; it does NOT capture. (OQ-4.)
- **Forking the all-in engine** — REUSE `_shared/allInPricingEngine.ts` + the `ticket-checkout-create` money seam verbatim; do not hand-roll fee/tax math.
- **A new deck card kind / new deck supply** (locked decision 1).
- **Admin web / business web preview** — no 2.2 surface.
- **Paystack reservation fees** — the fee path mirrors ticket-checkout-create which ALREADY routes Paystack for NG brands; if the venue's brand is a Paystack brand the same `requires_paystack_redirect` arm applies. No NEW Paystack work; it falls out of reuse. (If a venue brand is NG + fee-enabled, the web hosted-redirect arm uses the Paystack authorization URL. Confirm none of Mingla's live venues are NG fee-enabled today — OQ-5.)

### Assumptions
- A venue is "reservable" iff `venue_reservation_settings.reservations_enabled = true` AND ≥1 active reservable table AND a `venue_availability_config` row exists (journey §2a A7). The engine already returns zero rows unless all three hold, so the client `reservable` flag is a display gate; the engine is the authority.
- `place_pool.id` is the deck card's `card.id` and links a `nightOut` card to its brand via the existing place→brand association used by `VenueExperiencesSection` (`pg_brand_experiences_for_place`). The reserve affordance needs the `brand_id`; it is resolved the same way (see §4.D.1, OQ-1).

---

## 3. CROSS-SURFACE IMPACT DECLARATION (HARD GATE)

| # | Surface | Covered | User-visible behavior | Files touched | Parity |
|---|---|---|---|---|---|
| 1 | **Consumer iOS** (`app-mobile`) | YES | Reserve action on nightOut expanded card → 3-step sheet → engine slots → free confirm OR native PaymentSheet → confirmation → "my reservations" + cancel | `ExpandedCardModal.tsx`, new `VenueReserveSheet.tsx` + `VenueSlotPicker.tsx`, new `useVenueAvailability`/`useReserveTable` hooks, new `venueReservationService.ts`, reuse `nativeCheckoutFlow.ts` + `useAuthSimple.ts`, new "my reservations" surface | Shared RN code → auto-parity with Android |
| 2 | **Consumer Android** (`app-mobile`) | YES | Identical to iOS | same as #1 | Auto (shared RN). Android opaque-glass policy applies to every new sheet/card |
| 3 | **Anonymous buyer Web** (`mingla-business`) | YES | Floating "Reserve a table" on `/b/{brandSlug}` (and/or `/reserve/{brandSlug}`) → 3-step web flow → engine slots (anon) → buyer details → free confirm OR hosted Stripe Checkout → `/o/` reservation receipt → cancel-from-link. Login-free | new `app/reserve/[brandSlug]/...` routes, `coldLoadAuthGates.ts` (+`/reserve/` prefix + its test), `venueReservationService.ts` (web `surface:"web"`), reuse `app/o/[orderId].tsx`, the public venue page CTA | MANUAL — separate web entry/render path; SC split per-surface |
| 4 | **Business iOS** | NO (operator list already receives the booking; no NEW operator UI in 2.2) | The inbound `source='mingla'`/`'website'` row lands in the SHIPPED 2.1b operator Reservations list (realtime/refetch). No new operator code | none (read-only) | n/a — shipped |
| 5 | **Business Android** | NO (same as #4) | same | none | n/a |
| 6 | **Admin Web** (`mingla-admin`, adjacent) | NO | No 2.2 surface | none | n/a |
| 7 | **Business Web preview** (adjacent) | NO | No 2.2 surface | none | n/a |

**Parity rule (memory `feedback_public_trip_page_all_surface_parity.md`):** the Reserve experience MUST be coherent on consumer iOS + consumer Android + anon web, incl. the floating reserve button on the public page. Success criteria below are SPLIT per-surface (`-iOS`/`-Android`/`-Web`) wherever parity is manual.

---

## 4. LAYERED SPECIFICATION

### A. DATABASE / RPC

#### A.1 — Engine anon-GRANT flip (THE KEYSTONE) — migration `20261012000000_orch_1148_2_2_engine_anon_grant.sql`

**Decision: GRANT anon EXECUTE on the existing engine `pg_venue_available_slots(uuid, date, int)` — do NOT wrap it.** Rationale and exposure verdict below.

**Exposure audit (the load-bearing safety check):**
- The function is `SECURITY DEFINER` `STABLE` with `SET search_path = public, pg_temp` and a frozen `RETURNS TABLE(slot_start_utc timestamptz, slot_local_label text, remaining int, is_full boolean)` — **4 columns, all aggregate availability data; ZERO reservation PII** (no guest name/phone/email, no reservation ids, no table ids, no other-brand data).
- Internally it reads `venue_reservation_settings`, `venue_availability_config`, `venue_blackouts`, `venue_tables`, and `reservations` — but ONLY to (a) gate on `reservations_enabled`, (b) compute candidate slots, and (c) `count(*)` overlapping live reservations for `remaining`. The only thing derived from `reservations` that escapes the function is the integer `remaining`/`is_full` — a count, not a row. **No reservation row leaves the function.**
- Because the engine is `SECURITY DEFINER`, granting `anon` EXECUTE on the ENGINE alone is sufficient: when anon calls the engine, the body runs as the function OWNER, so the engine's reads of the locked-down tables and its internal call to the helper `pg_venue_turn_minutes_for_party(jsonb,int)` execute under the owner's privileges — anon never needs (and must NOT get) direct EXECUTE on the helper or direct SELECT on those tables. **Verify in the probe (A.4) that the helper stays anon-REVOKE'd and the underlying tables stay anon-unreadable.**
- Inputs are `(brand_id, date, party_size)`. An anon caller can enumerate brand ids to probe availability — but availability is *public demand data by design* (the whole point of a public reserve page is to show open tables). It exposes no more than the public venue page already implies. Brand-id is not a secret. **Verdict: SAFE to grant anon EXECUTE on the engine.**

**Migration body (the seam already documents the exact line at 2.1a `20261008000001` line 296):**
- `GRANT EXECUTE ON FUNCTION public.pg_venue_available_slots(uuid, date, int) TO anon;`
- DO NOT grant the helper to anon. DO NOT grant anon SELECT on any venue_* / reservations table. (Defense-in-depth — least privilege; the engine's definer rights are the only path.)
- Idempotent, additive, `BEGIN`/`COMMIT`, applied via the Supabase Management API (not `db push`).
- Carry an explanatory comment citing the 2.1a seam + the exposure verdict.

**Invariant established (DRAFT):** `I-PROPOSED-1148-ENGINE-ANON-EXPOSES-ONLY-SLOTS` — the anon-callable engine returns EXACTLY the 4 availability columns and the helper + underlying tables remain anon-unreadable. Fails-on-revert: §9.

#### A.2 — `reservations` schema additions — migration `20261012000001_orch_1148_2_2_reservations_guest_fields.sql`

Additive-only `ALTER TABLE`:
- Widen `created_via` CHECK from `('operator','consumer')` to `('operator','consumer','guest')` (drop+re-add the CHECK constraint; `guest` = anon-web, `consumer` = signed-in app, `operator` = manual). **NOTE the migration-baseline rule: a CHECK widen is a DROP-then-ADD, not an in-place edit.**
- Add `guest_cancel_token text NULL` (a random opaque token minted for `source='website'` rows, used by the web cancel-from-link; never exposed to other guests; NULL for app/operator rows where the signed-in user owns the row).
- Add an index `reservations_guest_cancel_token_idx ON reservations (guest_cancel_token) WHERE guest_cancel_token IS NOT NULL` (the cancel-link lookup path).
- Do NOT alter `source` — it already includes `'mingla'` (app) and `'website'` (anon web).

#### A.3 — `pg_create_guest_reservation` (the atomic guest writer) — migration `20261012000002_orch_1148_2_2_guest_reservation_rpc.sql`

**Why a new RPC:** `biz_reservation_create` and `biz_reservation_transition` are operator RPCs — they `RAISE EXCEPTION 'not_authorized'` unless `biz_brand_effective_rank_for_caller >= event_manager`. A guest (anon or a normal consumer with no brand role) CANNOT call them. 2.2 needs a distinct, guarded guest writer.

- `CREATE OR REPLACE FUNCTION public.pg_create_guest_reservation(p_brand_id uuid, p_reserved_for timestamptz, p_party_size int, p_source text, p_created_via text, p_consumer_user_id uuid, p_guest_name text, p_guest_phone_e164 text, p_guest_email text, p_fee_cents int, p_fee_currency char(3), p_payment_intent_id text, p_payment_status text, p_guest_cancel_token text, p_status text DEFAULT 'confirmed') RETURNS public.reservations`
- `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp`.
- **Grants: `service_role` ONLY.** REVOKE from PUBLIC + anon + authenticated. The guest path goes through the `venue-reservation-create` edge fn (service-role), never client-direct — this is the I-PROPOSED guest-fee-via-shared-engine boundary and prevents a client forging a free reservation on a fee venue.
- **Body must, ATOMICALLY (single statement / FOR-the-slot lock):**
  1. Verify the venue is reservable (`reservations_enabled = true` + a config row) — else `RAISE EXCEPTION 'venue_not_reservable'`.
  2. **RE-VALIDATE the slot against the engine at write time** — call `pg_venue_available_slots(p_brand_id, (p_reserved_for in venue tz)::date, p_party_size)` and assert the requested `reserved_for` instant matches a returned `slot_start_utc` whose `is_full = false` (remaining > 0). Else `RAISE EXCEPTION 'slot_unavailable'`. This closes the stale-slot / double-book race: two concurrent guests racing the last seat — the second re-validation sees `remaining = 0` and is rejected. (The engine's `remaining` is computed live from `reservations`; wrap the read+insert so the second writer recomputes after the first commits. Use a transaction-level advisory lock keyed on `(brand_id, slot_start_utc)` or `SERIALIZABLE` semantics so the count is consistent across the check→insert window — the implementor picks the mechanism; the CONTRACT is "no two confirmed reservations can exceed `remaining` for the same slot.")
  3. **Enforce capacity rules server-side** — `party_fit` (party between the eligible table min/max, already enforced inside the engine's eligible-table set → re-validation covers it) and `deposit_threshold` (if a `deposit_threshold` rule with `min_party_for_fee` ≤ `p_party_size` is active, the reservation MUST carry a paid `fee_cents`/`payment_status='paid'`; a `guest`/`consumer` free write for a deposit-required party → `RAISE EXCEPTION 'deposit_required'`). The edge fn computes the fee; the RPC asserts consistency.
  4. INSERT the `reservations` row with the supplied fields (`source`, `created_via`, `consumer_user_id` or guest fields, `fee_*`, `payment_*`, `guest_cancel_token`, `status`). `place_pool_id` resolved from `venue_reservation_settings.place_pool_id` for the brand.
  5. Write an `audit_log` row (action `venue_reservation.guest_create`, `after` = source/created_via/party/reserved_for/fee).
  6. RETURN the row.
- A `pg_cancel_guest_reservation(p_reservation_id uuid, p_guest_cancel_token text, p_consumer_user_id uuid)` companion (service-role) for web cancel-link + an authenticated consumer-cancel wrapper (see A.5). Honors `cancel_cutoff_hours` (status → `cancelled_by_guest`; refund eligibility flagged if before cutoff and fee was refundable — refund EXECUTION reuses the existing refund engine via the edge fn, OQ-4-adjacent).

**Invariants established (DRAFT):**
- `I-PROPOSED-1148-RESERVATION-WRITE-REVALIDATES-SLOT` — the guest writer rejects any reserved_for that is not a currently-available engine slot (no fabricated availability, no double-book).
- `I-PROPOSED-1148-GUEST-FEE-VIA-SHARED-ALL-IN-ENGINE` — a deposit/fee reservation is only created with `payment_status='paid'` after the shared all-in engine + `ticket-checkout-create` money path completed; the guest writer rejects a free write when a deposit threshold applies.

#### A.4 — Engine-exposure read-only PROBE — migration `20261012000003_orch_1148_2_2_engine_anon_probe.sql` (or a `Mingla_Artifacts/tests/` SQL harness)

A read-only assertion harness (pattern: the 2.1a `..._booking_core_p3_probes.sql` / 2.1b `..._reservation_lifecycle_probes.sql`) that asserts, against `information_schema`/`pg_proc`/ACLs:
1. `anon` HAS EXECUTE on `pg_venue_available_slots(uuid,date,int)`.
2. `anon` does NOT have EXECUTE on `pg_venue_turn_minutes_for_party(jsonb,int)`.
3. `anon` does NOT have EXECUTE on `biz_reservation_create` / `biz_reservation_transition` / `pg_create_guest_reservation`.
4. `anon` does NOT have table-level SELECT on `reservations`, `venue_tables`, `venue_reservation_settings`, `venue_availability_config`, `venue_capacity_rules`, `venue_blackouts`, `venue_waitlist`.
5. The engine's `RETURNS TABLE` definition still has exactly the 4 columns (no PII column crept in).

#### A.5 — Consumer "see / cancel my own reservation" RLS + RPC — in `20261012000002`

- Add the deferred SELECT policy (2.0 header promised it): `CREATE POLICY "reservations consumer can read own" ON public.reservations FOR SELECT TO authenticated USING (consumer_user_id = auth.uid())`. (The existing brand-member-read policy is unaffected; RLS is permissive-OR.)
- Add `pg_cancel_my_reservation(p_reservation_id uuid)` SECURITY DEFINER `TO authenticated` — asserts `consumer_user_id = auth.uid()`, honors `cancel_cutoff_hours`, transitions to `cancelled_by_guest`, writes audit, returns the row + a `refund_eligible` boolean. (Does NOT execute the refund; flags it. Refund execution = reuse `refund-order` if a deposit was paid — wire only if OQ-4 says so.)

### B. EDGE FUNCTION — `venue-reservation-create`

**Deploy from MERGED origin/main only (COMMS-0015).** Mirrors `ticket-checkout-create` structure (`serve(wrapEdgeHandler(...))`, `ticketCorsHeaders`, `jsonResponse`, `normalizePhoneE164`, `serviceClient`, `userIdFromAuthHeader`).

- **Method/route:** `POST /functions/v1/venue-reservation-create`. CORS preflight OK; non-POST → 405.
- **Auth:** OPTIONAL. `userIdFromAuthHeader(req)` → if present, `created_via='consumer'` + `consumer_user_id`; if absent (anon web), `created_via='guest'`. `verify_jwt` must be OFF for this fn (it is a public buyer endpoint, like ticket-checkout-create) — the fn validates inputs and uses the service client.

**Request body:**
```
{ brandId, reservedForUtc (ISO), partySize, buyer:{name,email,phone},
  surface:"native"|"web", marketingOptIn?, occasion?, guestNotes? }
```
- Validate: `brandId` uuid; `partySize` int 1..100; `buyer.name` ≥2; `buyer.email` regex (same as ticket-checkout-create line 260); `buyer.phone` → `normalizePhoneE164` non-null; `reservedForUtc` parseable + in the future; `surface` ∈ {native, web}. Bad input → 400 with the same structured-error shape (`{error:"..."}`).

**Server-side resolution (service client):**
1. Read `venue_reservation_settings` for `brandId` → `reservations_enabled` (else 409 `venue_not_reservable`), `fee_enabled`/`fee_amount_cents`/`fee_currency`/`fee_refundable`/`cancel_cutoff_hours`/`no_show_fee_policy`/`pass_*_override`.
2. **Re-validate the slot** by calling the engine RPC (service-role) and confirming the requested instant is an available, non-full slot → else 409 `slot_unavailable`.
3. Evaluate capacity rules: load active `venue_capacity_rules` for the brand; if a `deposit_threshold` rule's `min_party_for_fee` ≤ partySize → fee is REQUIRED even if `fee_enabled=false`; the fee amount = the deposit rule's configured amount (else `fee_amount_cents`).
4. **Paid-publish/charge integrity (ORCH-1073 lineage):** if a fee applies, the brand MUST be charge-ready (`stripe_charges_enabled` for Stripe brands, or a Paystack subaccount for NG) — mirror ticket-checkout-create's `stripe_account_not_ready` 409.

**FREE path (no fee, no deposit threshold):**
- After the client's confirm/review step (the body arriving here IS post-review), call `pg_create_guest_reservation(... fee NULL, payment_status='none', status='confirmed' ...)` with a freshly minted `guest_cancel_token` for `surface='web'`.
- Push (consumer) via the existing `businessNotifyTriggers`/OneSignal path on success.
- Response: `{ kind:"free_completed", reservationId, reservedForUtc, partySize, brandId, guestCancelToken?, receiptUrl? }`. (For web, `receiptUrl` = `/o/{reservationId}` — see D.7.)

**FEE path (reservation fee or deposit threshold):**
- REUSE the all-in engine the SAME way ticket-checkout-create does: resolve the brand pricing inputs (pass/absorb switches with the reservation `pass_*_override` taking precedence over brand defaults), region/currency, `computeBuyerSubtotal`/`buildPricingBreakdown`, Stripe Tax for the fee (venue-sourced, degrade-not-fail), Paystack arm for NG. **Do NOT re-implement the math — call the shared engine.**
- **`surface:"native"` →** create the PaymentIntent on the connected account (direct charge, `application_fee_amount` = Mingla take) + provision the Customer/ephemeral key exactly as ticket-checkout-create's native arm. Return the native-PaymentSheet union:
  `{ kind:"requires_payment", reservationDraftId, clientSecret, paymentIntentId, stripeAccountId, customerId, customerEphemeralKeySecret, publishableKey, totalCents, currency, pricingBreakdown }`.
- **`surface:"web"` →** create a hosted Stripe Checkout Session (or `requires_paystack_redirect` for NG) and return `{ kind:"requires_web_redirect", reservationDraftId, hostedCheckoutUrl, totalCents, currency }` (or `requires_paystack_redirect` + `authorizationUrl`).
- **Reservation row creation on FEE:** the row is created in `status='confirmed'`, `payment_status='paid'` ONLY after payment finalizes. Two viable shapes — **the implementor MUST follow the ticket-checkout-create precedent**: persist a *pending* reservation draft (a `reservations` row in `status='requested'` + `payment_status='none'`, or a small `reservation_checkout_sessions` mirror) keyed to the PI/checkout-session, and FLIP it to `confirmed`/`paid` in the webhook/confirm step. **Reuse the existing finalize/confirm webhook plumbing** (`stripeWebhookRouter` / `ticket-checkout-confirm` analog) rather than minting a parallel one. The CONTRACT: no fee reservation is ever `confirmed` without a verified successful charge; no charge ever happens without a reservation record to flip. (OQ-2: confirm whether to extend the existing ticket session table with a `reservation` mode or add a thin `reservation_checkout_sessions` — recommended: a thin dedicated table to avoid overloading ticketing, mirroring how `venue_waitlist` deliberately did NOT overload `tickets`.)

**Error shapes (all `{error:"..."}` + HTTP):** `venue_not_reservable` 409, `slot_unavailable` 409, `deposit_required` 422, `stripe_account_not_ready` 409, `buyer_*` 400, `pricing_config_unavailable` 409, `internal_error` 500.

### C. SERVICE LAYER

- **Consumer app `app-mobile/src/services/venueReservationService.ts`** (new) — `createVenueReservation(input): Promise<VenueReservationResult>` calling `venue-reservation-create` with `surface:"native"`. The result is the response union above. Mirrors the consumer ticket service + `nativeCheckoutFlow` consumption.
- **Web `mingla-business/src/services/venueReservationService.ts`** (new) — `createVenueReservation(input)` with `surface:"web"`; returns the union; mirrors `ticketCheckoutService.createTicketCheckout` (uses `invokeOrThrow`). Plus `cancelVenueReservationByToken(reservationId, token)`.
- Error contract: throw on transport/edge error; the response union's `kind` is the success discriminator (NOT thrown). Matches the existing checkout services.

### D. HOOKS

- `useVenueAvailability(brandId, date, partySize)` (app + web shared logic; RN + web-callable) — React Query, query key `["venueAvailability", brandId, date, partySize]`, calls the engine RPC via the Supabase client (anon-callable post-A.1), `staleTime` short (e.g. 30s — slots go stale fast), `enabled` only when all three params set + the sheet is on step 2. Returns `{slots:{slotStartUtc,label,remaining,isFull}[], isLoading, error}`. **Never fabricate slots** — empty array = "fully booked" state, not a fallback.
- `useReserveTable()` (app) — mutation wrapping `venueReservationService.createVenueReservation` + the `nativeCheckoutFlow` PaymentSheet for the fee path; on success invalidates `["myReservations", userId]`; `onError` toasts. Returns the outcome union.
- `useMyReservations(userId)` (app) — query key `["myReservations", userId]`, reads `reservations WHERE consumer_user_id = me` via the new SELECT RLS; `enabled: !!userId`.

### E. COMPONENT LAYER

#### E.1 — Consumer app
- **`ExpandedCardModal.tsx` (MODIFY):** in the `nightOut` branch (`target.kind==="nightOut"`, `card = target.data`), add a **"Reserve a table"** affordance in the ActionButtons region (alongside / just above `VenueExperiencesSection` at the busyness→weather slot, lines ~2069–2073, or as a new ActionButtons prop `onReserveTable` parallel to the experience Book). **Gated on a `reservable` flag** resolved for `card.id`'s brand (see D/OQ-1). Tapping opens `VenueReserveSheet`. Mirror the experience "Book" pattern (ORCH-1065/1072). **No dead tap** — if `reservable` is unknown/false the affordance does not render.
- **`VenueReserveSheet.tsx` (NEW)** — a `BaseBottomSheet` (theme `"dark"`, opaque Android fill per glass policy), 3 steps in one sheet:
  - **Step 1 — party + date:** party-size stepper (bounded by the venue's table min/max once known; default 1..table-max), date picker bounded by `advance_window_days`. CTA "See times".
  - **Step 2 — slot grid:** `VenueSlotPicker` (NEW, mirrors `ExperienceOccurrencePicker.tsx`'s `BaseBottomSheet` grid + disabled/sold-out tokens: available chip, `is_full` rows rendered disabled `opacity:0.45` labelled "full" — NEVER hidden). Empty result → the no-availability state (W1): "Fully booked — try another day" + (if OQ-3 confirms) "Join the waitlist".
  - **Step 3 — confirm / review (ALWAYS, even FREE — locked decision 3):** summary (venue · day · time · party). FREE → "Confirm". FEE → the fee shown all-in WYSIWYP (from the edge fn preview/breakdown) + "Confirm & pay".
  - **Sign-in gate AT CONFIRM:** on tapping Confirm/Confirm & pay, if `useAuthSimple().user === null`, trigger the existing one-tap (`signInWithApple`/`signInWithGoogle`); on success continue the same commit; on cancel, stay on step 3 (no booking). Every app reservation carries a `consumer_user_id`.
  - **FREE commit:** `useReserveTable` → `free_completed` → confirmation.
  - **FEE commit:** `useReserveTable` → `requires_payment` → `nativeCheckoutFlow` PaymentSheet → on `succeeded` confirmation; `canceled` → silent return to step 3; `failed` → toast.
  - All states specified: loading (slots fetching), error (engine/edge error → retry), empty (fully booked), submitting (spinner on CTA, disabled), success (confirmation), offline. a11y labels on stepper/date/slot/CTA (I-39, ≥44pt).
- **Confirmation (E.1.x):** restrained-celebratory — checkmark + venue + summary + "Added to your plans" + haptic tick; CTA → "my reservations". OneSignal confirmation push.
- **"My reservations" surface (NEW)** — list from `useMyReservations` (venue, time, party, fee/free, cancel terms); **Cancel** → `pg_cancel_my_reservation` (honors cutoff; shows refund-eligibility if a deposit was paid). Post-booking home (journey §5 Q7 → Plans/my-reservations, NOT a deck card). **Where it mounts is OQ-6** (a Plans/Saved tab vs a profile sub-screen) — recommend a "Reservations" section in the existing saved/plans area.

#### E.2 — Anon web (`mingla-business`)
- **Public venue page floating CTA:** add a **"Reserve a table"** floating button on `PublicBrandPage`/`PublicVenueDetail` (and/or the venue detail route), mirroring `TripReserveBar variant="floating"|"docked"` (theme-aware) — NOT the hardcoded-orange `FloatingOfferingBar`. Gated on a server-computed `reservable` flag on the public venue payload. When not reservable → no CTA (or a "Not taking reservations" note). Parity with the trip/experience floating reserve button.
- **New route `app/reserve/[brandSlug]/index.tsx` (+ steps):** the 3-step web flow. Step 1 party+date, step 2 the anon engine slot grid (`useVenueAvailability` anon), step 3 buyer details (REUSE the `checkout/[eventId]/buyer.tsx` form: name ≥2, email regex, E.164 PhoneInput; state via a small reserve context mirroring `CartContext`) + the confirm/review (FREE still reviews). 
  - **FREE →** `venueReservationService.createVenueReservation({surface:"web"})` → `free_completed` → route to `/o/{reservationId}` receipt.
  - **FEE →** `requires_web_redirect` → persist to sessionStorage (mirror payment.tsx) → `window.location.assign(hostedCheckoutUrl)` → Stripe → return → confirm/finalize (reuse the confirm.tsx sync-confirm + realtime-fallback pattern) → `/o/{reservationId}`.
- **`/o/[orderId].tsx` (EXTEND):** render a reservation receipt when the id resolves to a reservation (venue, day/time, party, fee/free, cancel policy + a **cancel-from-link** button calling `cancelVenueReservationByToken`). Anon-tolerant (already in the allowlist). No QR (reservations have no ticket QR; show a confirmation number). **OQ-7: `/o/{reservationId}` reads from client-side stores today (`useOrderStore`/`useLiveEventStore`) — a deep-linked anon receipt has no store; the reservation receipt likely needs a small anon-readable RPC `pg_public_reservation_receipt(id, token)` (service-definer, token-gated) rather than relying on a store. Confirm the receipt data path.**

### F. AUTH GATE / ALLOWLIST
- `coldLoadAuthGates.ts`: add `"/reserve/", // /reserve/[brandSlug]/… — guest table reservation` to `PUBLIC_BUYER_ROUTE_PREFIXES` (after `/checkout-experience/`). The segment-safe matcher + the root `_layout.tsx` `isPublicBuyerRoute` consumption auto-exempt it. Update the ORCH-1115 allowlist test (`orch_1115_anon_buyer_route_allowlist.test.ts`) to assert `/reserve/x` matches and `/reserver` does not. **Invariant `I-PROPOSED-1148-PUBLIC-RESERVE-ROUTE-ALLOWLISTED` (DRAFT).**

### G. REALTIME (loop close — already shipped operator-side)
- No new operator realtime in 2.2. The inbound row appears via the SHIPPED 2.1b operator-list realtime/refetch on `reservations`. The consumer "my reservations" may optionally subscribe to its own rows (channel filtered `consumer_user_id=eq.me`) — optional, not required; refetch-on-focus suffices for v1.

---

## 5. SUCCESS CRITERIA (numbered, per-surface where parity is manual)

- **SC-1 (engine GRANT):** An anon Supabase client can call `pg_venue_available_slots(brandId, date, party)` and receive the 4-column slot rows for a reservable venue; the same call against the helper or a direct SELECT on `reservations`/`venue_*` is DENIED. Probe A.4 passes.
- **SC-2 (no PII leak):** The anon engine response contains ONLY slot_start_utc/slot_local_label/remaining/is_full — no guest fields, no ids, no other-brand rows.
- **SC-3 (free write):** `venue-reservation-create` FREE path creates exactly one `reservations` row (`source` per surface, correct `created_via`, `status='confirmed'`, `payment_status='none'`) and returns `free_completed`. The row appears in the operator list.
- **SC-4-iOS / SC-4-Android (app free reserve):** From a nightOut card → Reserve → party/date → pick a slot → review → (one-tap sign-in if anon) → Confirm → confirmation screen; the booking shows in "my reservations".
- **SC-5-iOS / SC-5-Android (app fee reserve):** A fee/deposit venue routes step 3 to "Confirm & pay" with the all-in WYSIWYP total (no buyer tax form), native PaymentSheet opens, on success the reservation is `confirmed`/`paid` and shows in "my reservations"; on cancel nothing is written.
- **SC-6-Web (anon free reserve):** Logged-out on `/reserve/{brandSlug}` (reachable — no sign-in bounce) → party/date → slot → buyer details → review → Confirm → `/o/{id}` receipt; row appears in operator list with `source='website'`.
- **SC-7-Web (anon fee reserve):** Fee venue → hosted Stripe Checkout redirect → pay → return → finalize → `/o/{id}` receipt; reservation `confirmed`/`paid`; no fee reservation is `confirmed` without a verified charge.
- **SC-8 (slot re-validation / no double-book):** Two concurrent commits for the last seat of a slot → exactly one succeeds; the other gets `slot_unavailable` 409. A commit for a slot not returned by the engine (stale/fabricated) → `slot_unavailable`.
- **SC-9 (capacity enforcement):** A party that no table can seat → the engine returns no slot (cannot reserve). A `deposit_threshold` party on a free venue → step 3 shows a fee and the FREE write is rejected (`deposit_required`).
- **SC-10 (sign-in at confirm, app):** Anon app user reaches step 3, taps Confirm → one-tap sign-in fires; declining leaves no reservation; accepting books with `consumer_user_id` set.
- **SC-11 (login-free web):** No sign-in modal ever appears on `/reserve/...`; identity is the buyer name/email/E.164 on the row.
- **SC-12 (free still reviews):** Both app and web FREE paths render the confirm/review step before writing (no skip-to-instant).
- **SC-13 (cancel within policy):** Consumer cancels their own reservation before `cancel_cutoff_hours` → status `cancelled_by_guest`, refund-eligible flagged (if deposit paid + refundable); after cutoff → cancel blocked or non-refundable per policy; web cancel-from-link works with the guest token, fails with a wrong token.
- **SC-14 (parity):** The reserve experience is coherent across iOS/Android/web; the floating "Reserve a table" CTA renders on the public venue page on all surfaces where the public page renders.
- **SC-15 (RLS):** A signed-in consumer can SELECT only their own reservations; cannot read another user's or any brand's reservation rows; a brand member still reads their brand's rows.

---

## 6. INVARIANTS

**Preserved (must not regress):**
- `I-PROPOSED-1148-AVAILABILITY-ENGINE-SOLE-SLOT-SOURCE` — slots come ONLY from the engine; the client never fabricates. Verified by SC-1/SC-8 + the no-`?? fallback` slot rule.
- `I-PROPOSED-1148-CAPACITY-RULE-ENFORCED-SERVER-SIDE` — party_fit/deposit_threshold enforced in the DB, not just UI (SC-9).
- `I-PROPOSED-1148-RESERVATION-LIFECYCLE-TRANSITIONS-GUARDED-SERVER-SIDE` — cancel goes through guarded transitions.
- `I-PROPOSED-1148-RESERVATIONS-RLS-BRAND-SCOPED` — extended, not loosened, by the additive consumer-own-read policy (SC-15).
- The money seam: `ticket-checkout-create` + `allInPricingEngine` are the single owner; the no-buyer-tax-form gate (`orch-1130-no-buyer-tax-form`), direct-charges-only, PM allowlist, WYSIWYP — all preserved (the fee path reuses, never forks).
- Android opaque-glass policy on every new sheet/card; a11y I-39; no dead taps; ORCH-1115 public-buyer-route allowlist semantics.

**Established (DRAFT — orchestrator flips ACTIVE on CLOSE):**
- `I-PROPOSED-1148-ENGINE-ANON-EXPOSES-ONLY-SLOTS` (§4.A.1)
- `I-PROPOSED-1148-RESERVATION-WRITE-REVALIDATES-SLOT` (§4.A.3)
- `I-PROPOSED-1148-GUEST-FEE-VIA-SHARED-ALL-IN-ENGINE` (§4.A.3/§4.B)
- `I-PROPOSED-1148-FREE-RESERVATION-HAS-CONFIRM-STEP` (§4.E, SC-12)
- `I-PROPOSED-1148-PUBLIC-RESERVE-ROUTE-ALLOWLISTED` (§4.F)

---

## 7. TEST CASES

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | Anon engine grant happy | anon client calls engine for reservable venue | 4-col slot rows | DB/RLS |
| T-02 | Anon helper denied | anon calls `pg_venue_turn_minutes_for_party` | permission denied | DB/RLS |
| T-03 | Anon table read denied | anon SELECT on `reservations`/`venue_*` | denied | DB/RLS |
| T-04 | No PII column | inspect engine RETURNS TABLE | exactly 4 columns | Schema |
| T-05 | Free write happy | edge FREE, valid slot | `free_completed`, 1 row, status confirmed | Edge/DB |
| T-06 | Slot unavailable | edge with reserved_for not in engine output | 409 `slot_unavailable`, 0 rows | Edge/DB |
| T-07 | Double-book race | 2 concurrent commits, last seat | exactly 1 success, 1×409 | DB (concurrency) |
| T-08 | Deposit threshold on free venue | party ≥ min_party_for_fee, free write | 422 `deposit_required` | Edge/DB |
| T-09 | Fee path native | edge FEE surface:native | `requires_payment` with PI/customer fields | Edge |
| T-10 | Fee path web | edge FEE surface:web | `requires_web_redirect` + hostedCheckoutUrl | Edge |
| T-11 | Fee not charge-ready | fee venue, brand stripe_charges_enabled=false | 409 `stripe_account_not_ready`, 0 rows | Edge |
| T-12 | App anon confirm gate | anon app user taps Confirm | one-tap sign-in fires; decline → no row | Component |
| T-13 | Web no auth bounce | logged-out hits `/reserve/x` | renders (no sign-in redirect) | Web/route |
| T-14 | Allowlist segment-safe | `/reserver` vs `/reserve/x` | false vs true | Util test |
| T-15 | Free reviews | free path both surfaces | review step rendered before write | Component |
| T-16 | Consumer own-read RLS | user A reads user B's reservation | denied | RLS |
| T-17 | Cancel before cutoff | consumer cancel < cutoff, deposit refundable | cancelled_by_guest + refund_eligible | DB |
| T-18 | Cancel after cutoff | consumer cancel > cutoff | blocked/non-refundable per policy | DB |
| T-19 | Web cancel token | correct vs wrong guest token | success vs denied | Edge/DB |
| T-20 | Operator loop close | free + fee reservations | appear in 2.1b operator list (source mingla/website) | Integration |
| T-21 | Empty slots | fully-booked day | empty grid + no-availability state (no fabricated slots) | Component |
| T-22 | Android glass | new sheets on Android | opaque fill, no translucent regression | Platform |

Each SC must have ≥1 happy + error + edge case among T-01..T-22.

---

## 8. IMPLEMENTATION ORDER

**2.2a (backend, frozen contract first):** A.1 engine grant → A.4 probe → A.2 reservations fields → A.3 guest RPC (+ re-validation + capacity) → A.5 consumer RLS/cancel RPC → B `venue-reservation-create` edge fn (free + fee, native + web, reuse all-in engine) → the fee finalize/webhook wiring (OQ-2). Backend-provable end-to-end via SQL + edge invocations before any UI.

**2.2b (consumer app):** C app service → D hooks → E.1 `VenueSlotPicker` + `VenueReserveSheet` + `ExpandedCardModal` affordance + sign-in-at-confirm + confirmation → "my reservations" + cancel. Device-proven iOS + Android.

**2.2c (anon web):** F allowlist + test → C web service → E.2 `/reserve/[brandSlug]` flow (buyer/payment/confirm reuse) → public-page floating CTA → `/o/` reservation receipt + cancel-link (+ receipt data path OQ-7) → (OQ-3) waitlist self-join. Web-proven logged-out.

Within each: DB → edge → service → hook → component.

---

## 9. REGRESSION PREVENTION (fails-on-revert)

- **Engine exposure:** the A.4 probe (SQL ACL assertions) — FAILS if anon EXECUTE on the engine is reverted (SC-1) OR if anon gains EXECUTE on the helper / SELECT on the tables (SC-2/SC-3). Protective comment cites the 2.1a seam + the exposure verdict.
- **Slot re-validation:** a DB/edge test that inserts a confirmed reservation filling a slot, then attempts a second guest write for the same slot → must 409. FAILS if A.3's re-validation/lock is removed (double-book returns). 
- **Free-has-confirm:** a component test asserting the free path renders the review step before invoking the service. FAILS if a "skip-to-instant" shortcut is added.
- **Allowlist:** the ORCH-1115 allowlist test extended with `/reserve/` — FAILS if the prefix is dropped.
- **Money seam:** the existing `orch-1130-no-buyer-tax-form` + direct-charges gates already run over the edge fns; the fee path importing/calling the shared engine (not hand-rolled math) is asserted by a grep-gate that the new edge fn imports from `_shared/allInPricingEngine.ts` and does NOT contain inline fee arithmetic.

---

## 10. OPEN QUESTIONS FOR SETH

1. **Reserve `brand_id` resolution from the place card (OQ-1).** The nightOut card carries `card.id = place_pool.id`; `VenueExperiencesSection` already maps place→brand experiences via `pg_brand_experiences_for_place`. Confirm the `reservable` flag + `brand_id` for the reserve affordance should resolve the SAME place→brand way (recommended), and whether to fold a `reservable` boolean into the existing place→brand read or add a tiny `pg_place_reservable(place_pool_id)` RPC.
2. **Fee-reservation persistence shape (OQ-2).** Recommend a thin dedicated `reservation_checkout_sessions` mirror (NOT overloading `ticket_checkout_sessions`), with the reservation row flipped to confirmed/paid by the existing webhook/confirm plumbing. Confirm — or prefer extending the ticket session table with a `reservation` mode?
3. **Waitlist consumer self-join in 2.2c (OQ-3).** Journey §5 Q4 recommended self-join; the operator waitlist + SMS are shipped (2.1b). Include consumer self-join (the no-availability catch) in 2.2c, or defer to a later sub-ORCH and ship the no-availability state as "try another day" only for now?
4. **No-show forfeit CAPTURE + refund execution (OQ-4).** 2.2 stores the policy and shows terms; it does NOT capture a no-show forfeit nor execute a deposit refund on cancel (only flags eligibility). Confirm capture + refund-execution are a SEPARATE money-capture ORCH (recommended — they carry dispute/capture complexity the journey map flagged), OR must 2.2 wire deposit-refund-on-cancel via the existing `refund-order` engine now?
5. **NG/Paystack fee venues (OQ-5).** The fee path inherits ticket-checkout-create's Paystack arm for NG brands automatically. Confirm no live venue brand is NG + fee-enabled today (zero blast radius), or flag if Paystack reservation fees need explicit on-device proof.
6. **"My reservations" mount point (OQ-6).** Recommend a Reservations section in the existing saved/plans area (journey §5 Q7 = a Plans/my-reservations home, not a deck card). Confirm the exact tab/screen.
7. **Anon `/o/` reservation-receipt data path (OQ-7).** Today `/o/{orderId}` reads client-side stores; a deep-linked anon reservation receipt has no store. Recommend a token-gated anon-readable `pg_public_reservation_receipt(id, token)` RPC for the web receipt + cancel-link. Confirm.

---

## 11. SCOPED ALLOWLIST + DO-NOT-TOUCH

### Allowlist (per slice — implementor may create/modify ONLY these; stop-and-amend otherwise)

**2.2a (backend):**
- `supabase/migrations/20261012000000_orch_1148_2_2_engine_anon_grant.sql` (NEW)
- `supabase/migrations/20261012000001_orch_1148_2_2_reservations_guest_fields.sql` (NEW)
- `supabase/migrations/20261012000002_orch_1148_2_2_guest_reservation_rpc.sql` (NEW — guest writer + consumer RLS/cancel)
- `supabase/migrations/20261012000003_orch_1148_2_2_engine_anon_probe.sql` (NEW) + `Mingla_Artifacts/tests/` SQL harness
- (OQ-2) `supabase/migrations/20261012000004_orch_1148_2_2_reservation_checkout_sessions.sql` (NEW, if confirmed)
- `supabase/functions/venue-reservation-create/index.ts` (NEW) + the webhook/confirm wiring for the fee finalize (extend the existing router minimally; the exact file is named after OQ-2 resolves — STOP-AND-AMEND before editing `stripeWebhookRouter`/`ticket-checkout-confirm` beyond the additive reservation branch)
- `supabase/functions/_shared/` ONLY a NEW helper file if needed (do NOT modify `allInPricingEngine.ts`/`ticketCheckout.ts` — import them)

**2.2b (consumer app):**
- `app-mobile/src/components/ExpandedCardModal.tsx` (MODIFY — nightOut branch affordance only)
- `app-mobile/src/components/expandedCard/VenueReserveSheet.tsx`, `VenueSlotPicker.tsx` (NEW)
- `app-mobile/src/components/.../MyReservations*.tsx` + its mount (NEW, per OQ-6)
- `app-mobile/src/services/venueReservationService.ts`, `app-mobile/src/hooks/useVenueAvailability.ts`, `useReserveTable.ts`, `useMyReservations.ts` (NEW)
- Reuse (DO NOT modify) `nativeCheckoutFlow.ts`, `useAuthSimple.ts`, `BaseBottomSheet`, `ExperienceOccurrencePicker.tsx`

**2.2c (anon web):**
- `mingla-business/app/reserve/[brandSlug]/` route files (NEW)
- `mingla-business/src/utils/coldLoadAuthGates.ts` (MODIFY — add `/reserve/` prefix) + its allowlist test (MODIFY)
- `mingla-business/src/services/venueReservationService.ts` (NEW)
- `mingla-business/app/o/[orderId].tsx` (MODIFY — additive reservation-receipt branch)
- the public venue page floating CTA: `mingla-business/src/components/brand/PublicBrandPage.tsx` / `PublicVenueDetail` (MODIFY — additive CTA), reuse `TripReserveBar`
- a reserve context mirroring `CartContext` (NEW)

### DO-NOT-TOUCH (READ-ONLY)
- The entire operator suite: `venue_tables`/`venue_availability_config`/`venue_blackouts`/`venue_reservation_settings`/`venue_capacity_rules` schemas + their operator UI (Tables/Availability/Reservations/Waitlist/Settings/shell) + `biz_reservation_create`/`biz_reservation_transition`/`biz_waitlist_*` RPCs.
- **`pg_venue_available_slots` BODY** — the ONLY change is the anon GRANT (a separate migration); the function definition/return shape is FROZEN.
- `_shared/allInPricingEngine.ts`, `ticketCheckout.ts`, `ticket-checkout-create/index.ts` — import/reuse, never edit.
- `send-venue-sms` + the Twilio path (shipped 2.1b).
- The anchor checkout `~/Desktop/mingla-main`.

---

## 12. SUB-SPLIT RECOMMENDATION + DOWNSTREAM ROUTING

**Recommended split (provable boundaries — backend contract frozen first):**
- **2.2a — Engine anon-grant + `venue-reservation-create` + guest write/validate + RLS/cancel + probe.** Provable boundary: SQL ACL probe passes + edge fn returns the full response union (free + fee, native + web) + double-book test 409s — all WITHOUT any client. Both clients then build on a frozen contract. **HIGHEST RISK lives here; ship it alone.**
- **2.2b — Consumer app reserve flow + my-reservations.** Provable boundary: device-proven iOS + Android free + fee reserve + cancel.
- **2.2c — Anon web reserve flow + receipt + cancel-link (+ waitlist self-join if OQ-3 yes).** Provable boundary: web-proven logged-out free + fee + cancel-link.

Cut here because (1) the keystone + money path are the riskiest and benefit from isolated proof; (2) freezing the edge contract lets the two clients proceed without churn; (3) each slice is independently testable + independently shippable, and 2.2c's all-surface parity + OTA close the whole stage.

**Downstream routing:** NEXT = **mingla-implementor** for **2.2a** (this SPEC, this worktree). Then mingla-tester (adversarial: engine-anon-exposure, double-book race, free-vs-fee, capacity, RLS). Then implementor 2.2b → tester → implementor 2.2c → tester. Then orchestrator CLOSE (flip the 5 DRAFT invariants ACTIVE, World Map, OTA the consumer dev channel). **Deploy edge fns + apply migrations ONLY from MERGED origin/main via the Management API** (COMMS-0015 + the migration-apply rule). **Seth must answer §10 OQ-2 (persistence shape), OQ-3 (waitlist), and OQ-4 (forfeit/refund scope) before 2.2a starts — they shape the backend.**

*End of SPEC. Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1148-[venue-guest-booking]/` on branch `ORCH-1148-venue-guest-booking`.*

---
## DECISIONS LOCKED (Seth, 2026-06-17) — 2.2 backend-shaping
- **OQ-4 / fee model = CHARGE UPFRONT, forfeit after cutoff.** Reservation fee charged at booking via the existing all-in engine. Cancel BEFORE the cancellation cutoff → refund (reuse the existing refund-order machinery); cancel AFTER cutoff OR no-show → forfeit (no separate capture step — it's already charged). 2.2 ships the full fee path (no separate money ORCH). No-show auto-forfeit is automatic under this model.
- **OQ-3 / waitlist self-join = DEFERRED.** When fully booked, the guest sees "fully booked — try another day". NO consumer self-join in 2.2; operators still add waitlist guests manually (2.1b) and the table-ready SMS works. Consumer self-join is a fast follow-up ORCH.
- **OQ-2 (adopted, engineering):** fee reservations use a thin new `reservation_checkout_sessions` table (clean separation from ticket sessions).
- OQ-1/6/7 (place-card brand resolution, my-reservations location, anon web receipt data path) resolved at implement time per the SPEC recommendations.
