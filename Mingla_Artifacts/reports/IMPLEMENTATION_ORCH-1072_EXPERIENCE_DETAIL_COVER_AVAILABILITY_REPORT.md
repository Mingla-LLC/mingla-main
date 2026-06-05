# IMPLEMENTATION — ORCH-1072 [experience-detail-cover-availability]

**Status:** implemented and verified (source + read-only live-data probe; sim live-fire deferred to TEST).
**Worktree:** `~/Desktop/mingla-orchs/tmp-business-metro` on branch `ORCH-1072-experience-detail-cover-availability` (base `origin/main` `59496eaab`).
**Date:** 2026-06-04.
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_experience_detail_and_availability.md`.

A published brand experience now renders + books correctly on the consumer app: the deck card shows the real cover (image/video) with the stop photos as a strip below; the expanded detail shows the real cover + description + multi-stop itinerary; the action is a single Book button (no Save/Schedule); and availability works (pick an upcoming date with remaining capacity → quantity → pay).

---

## Commits (per part)

| Part | Commit | Subject |
|---|---|---|
| 1 | `781ef1659` + `f073d5c28` (DROP fix) | Supply: real cover + description + upcoming occurrences in `pg_eligible_experiences_for_deck` + both edge envelopes + C7 allowlist + supply test |
| 2 | `a8122b9ab` | Client mapper carries cover/description/occurrences + tag-loss hardening |
| 3 | `422764705` + `7708732b2` (prop fix) | Card cover hero + stop strip; sheet mapper uses real cover/description/stops/occurrences |
| 4 | `978816833` | Detail sheet: itinerary + upcoming-dates picker + Book |
| 5 | `3e2e25972` | `ticket-checkout-create` optional `eventDateId` occurrence param + checkout test |

---

## PART 1 — Supply (backend)

### New `pg_eligible_experiences_for_deck` columns (additive)
`RETURNS TABLE` widened from 15 → 19 columns. New columns: `description text`, `cover_media_url text`, `cover_media_type text`, `upcoming_occurrences jsonb`.

- `cover_media_url` / `cover_media_type` ← `events.cover_media_url` / `events.cover_media_type` (image/video/gif).
- `description` ← `COALESCE(events.description, '')` (honest empty default — never the tagline).
- `upcoming_occurrences` ← `jsonb_agg` of the next ≤12 future `event_dates` (`end_at > p_now`), ordered `start_at ASC`.

### Occurrence shape (one element)
```json
{ "event_date_id": "uuid", "start_at": "ts", "end_at": "ts",
  "capacity": int|null, "sold": int, "remaining": int|null }
```
Capacity model is **per-event** (investigation §F): the experience has exactly ONE sellable online ticket (existing I-1 gate). `remaining = GREATEST(quantity_total − sold, 0)` or `NULL` for unlimited, matching `pg_public_ticket_types_remaining` (ORCH-0946); `sold` counts `tickets.status IN ('valid','used','transferred')` (same formula as the checkout RPC + `biz_experience_sold_count`). Every occurrence of an experience therefore shows the same event-level remaining — no per-occurrence cap is invented (Constitution #9).

### Critical migration detail (DROP-then-CREATE)
A bare `CREATE OR REPLACE` cannot change an existing function's return columns (`cannot change return type of existing function`). Verified the live remote signature is the old 15-column shape; added `DROP FUNCTION IF EXISTS public.pg_eligible_experiences_for_deck(double precision, double precision, double precision, text[], timestamptz, uuid[], integer);` before the CREATE (atomic inside the migration transaction → no live gap for service-role callers). Function body ends with `;` before the GRANT.

### Edge envelopes (threaded identically — no parallel system)
- `discover-cards/index.ts` `ExperienceDeckCard` + `fetchEligibleExperiences` map → adds `coverMediaUrl`, `coverMediaType`, `description`, `upcomingOccurrences` + shared `mapExperienceOccurrences` helper.
- `generate-curated-experiences/index.ts` `CuratedExperienceDeckCard` + `fetchEligibleExperiencesForCurated` map → identical fields + identical `mapExperienceOccurrences`.

### Migration / C7
New file `supabase/migrations/20260908000000_orch_1072_experience_detail_cover_availability.sql` added to `ORCH_1072_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (same commit, COMMS-0002). C7 gate run: **PASS** (15 backend files, all allowlisted). No `place_pool`/`ai_signal_scores` (COMMS-0018).

---

## PART 2 — Client mapper + tag fix

- `deckService.experienceCardToRecommendation` now carries `description`, `coverMediaUrl`, `coverMediaType`, `upcomingOccurrences[]` onto the experience Recommendation (verbatim, read via runtime cast in SwipeableCards).
- `BusinessEventCard` (mergedDiscover.ts) gains optional `experienceStops?` + `upcomingOccurrences?` (experience-only; undefined for events/trips → byte-safe).

### Save/Schedule tag-loss root cause + fix
**Root cause (investigation §A/B):** routing keys on `currentRec.cardType === 'experience'`; when that discriminator is present the card correctly routes to `ExpandedBusinessEventSheet` (Book, no Save/Schedule). The reported symptom appears only if an experience reaches the renderer WITHOUT the tag — then it falls to the curated/place branch which renders `ActionButtons` (Save/Schedule). The supply always tags `'experience'`, so the practical defect was that the experience routed to the right sheet but showed the wrong DATA (fabricated cover/description) — fixed by Parts 1, 3, 4.
**Hardening:** `isExperiencePayload` now also recovers the discriminator **structurally** — a brand experience uniquely carries a non-empty `brandId` + `eventId` + a `stops[]` array, whereas curated AI cards have stops but NO brand attribution. If the explicit tag is ever lost upstream, the decoder still classifies it as an experience and `experienceCardToRecommendation` re-stamps `cardType:'experience'`, so it can never fall to the Save/Schedule branch. The renderer's strict `=== 'experience'` discriminator is unchanged (ORCH-1065 ADV test still green).

---

## PART 3 — Card (cover hero + stop strip)

`CuratedExperienceSwipeCard`: for the brand-experience variant with a real cover, the hero is the cover rendered via the shared `@mingla/event-rendering` `EventCoverMedia` (`autoplay muted loop` — the event-card video contract; image/gif/video all handled) taking the top ~74% of the image section, with the stop photos as a smaller strip beneath (~26%). Curated cards + cover-less experiences keep the unchanged full stop-strip hero (SC-13).

Cover is passed via a SEPARATE optional `experienceCover` prop (NOT folded into `brandExperience`) to preserve the ORCH-1065-locked `brandExperience: { brandName; brandLogoUrl }` contract byte-identically (locked test `orch1065_experience_expand` T-12/SC-13 re-passes, 22/22).

---

## PART 4 — Expanded sheet

`ExpandedBusinessEventSheet` (renders the shared `PublicEventPage`):
- Cover (image/video) + description now flow through the existing `mapCardToPublicEvent` (they read `card.coverMediaUrl/coverMediaType/description`, all now real).
- `datesList` (previously hardcoded `[]`) now populated from `upcomingOccurrences` for experiences → the real upcoming dates render in PublicEventPage's existing dates section.
- New `ExperienceItinerary` section (multi-stop route) injected beneath PublicEventPage's content via the scroll host.
- New `ExperienceOccurrencePicker` (PICK FROM UPCOMING DATES): on Book, `beginBooking(ticketId)` decides — >1 bookable occurrence opens the picker (each row = date + remaining chip; sold-out `remaining===0` disabled); exactly 1 occurrence auto-selects (one-off); 0 occurrences (event/trip) opens the cart with no date (unchanged). The chosen `event_date_id` is threaded into the existing `TicketCartSheet` → `runNativeCheckout`. No parallel sheet.

---

## PART 5 — Checkout (money — careful)

`ticket-checkout-create/index.ts` EXTENDED (not forked — COMMS-0014/0016) with an OPTIONAL `eventDateId`:
- Parsed `body.eventDateId` → string or `null`.
- When non-null, validated against `event_dates` (must belong to THIS event AND `end_at > now`): mismatch → `422 occurrence_not_found`; past/sold-out → `422 occurrence_not_available`. Runs immediately after the existing `event_no_active_dates` gate — BEFORE any PaymentIntent.
- Persisted to (a) `ticket_checkout_sessions.metadata.event_date_id` (merged into the existing status-token UPDATE — no extra round-trip) and (b) the PaymentIntent metadata `mingla_event_date_id` (Stripe metadata: keys ≤40 / values ≤500 chars — https://docs.stripe.com/api/metadata).
- **When omitted, every branch is byte-identical to today** — no new query, no new metadata key (all writes spread-conditional on `eventDateId !== null`). Events, trips, one-off experiences unchanged. `verify_jwt` + the trip/event paths untouched (no `event_type==='experience'` branch introduced).

Client: `nativeCheckoutFlow` `NativeCheckoutInput.eventDateId?` forwarded to the body only when present.

### Residual money-path risk
- **Capacity race:** the occurrence validation proves the date is future + belongs to the event, but ticket-level sold-out is still enforced by the existing `biz_ticket_checkout_create_session` capacity gate (409 `ticket_capacity_exceeded`) at the per-event ticket level — unchanged. Two buyers racing the last seat are still caught by that gate; the occurrence param does not add per-occurrence capacity (none exists in the schema). Low risk, identical to today's events/trips.
- **Web hosted-Checkout branch:** untouched — web buyers don't send `eventDateId` (consumer-native only), so the web path is byte-identical. No new divergence beyond the pre-existing COMMS-0013 tax note.
- **PI-metadata → order:** the booked occurrence is recorded on the PI + session metadata; wiring it onto a dedicated `orders.event_date_id` column is NOT done (no such column exists; adding one + threading the session/finalize RPCs was out of the byte-identical-when-omitted budget). Operator/analytics can read the occurrence from PI/session metadata today.

---

## Regression tests

| Test | Path | Result |
|---|---|---|
| Supply (6) | `supabase/functions/discover-cards/__tests__/orch_1072_experience_detail_supply.test.ts` | 6/6 PASS |
| Checkout (5) | `supabase/functions/ticket-checkout-create/__tests__/orch1072_experience_occurrence_checkout.test.ts` | 5/5 PASS |

**Fails-on-revert verified at `59496eaab` (base):**
- Cover-not-fabricated: removing the `coverMediaUrl` carry from the discover envelope → supply T-03 FAILS.
- Date-occurrence checkout: removing the PI-metadata persist → checkout T-A4 + T-A5 FAIL.
- Sold-out rejection: removing the `occurrence_not_available` 422 → checkout T-A3 FAILS.
All restored green after.

**No locked tests modified.** ORCH-1065 suite (22 tests) + ORCH-1065 checkout (3) re-run green.

---

## Live read-only probe (Supabase MCP, no mutation)

Ran the new RPC's query body against live remote data:
- Remote migration head = `20260907000000` (no remote-only rows; `20260908000000` is next).
- `events.cover_media_url`, `events.description`, `ticket_checkout_sessions.metadata` all exist.
- Live experience **Raleigh Wine and Dine Crawl** returns a real Cloudinary `.mp4` cover (`cover_media_type='video'`), a real description, and a `{event_date_id, start_at, end_at, capacity:20, sold:0, remaining:20}` occurrence — proving the video-cover + description + availability path end-to-end. **DC Evening Crawl** (unlimited) returns `remaining: null` (no sold-out chip).

---

## Gates

- `deno check`: discover-cards, generate-curated-experiences, ticket-checkout-create — all CLEAN.
- `tsc --noEmit` (app-mobile): no NEW errors in any touched file (pre-existing unrelated errors only: `applePay` config L253, Deno test files mis-picked-up, legacy `LockedPlanBanner`/`BoardDiscussion`).
- ORCH-0863 C7 strict-grep gate: PASS (15 backend files, all allowlisted).

---

## Files changed

**Backend:** `supabase/migrations/20260908000000_orch_1072_experience_detail_cover_availability.sql` (NEW), `supabase/functions/discover-cards/index.ts`, `supabase/functions/generate-curated-experiences/index.ts`, `supabase/functions/ticket-checkout-create/index.ts`, 2 new test files, `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`.
**Client:** `app-mobile/src/services/deckService.ts`, `app-mobile/src/types/mergedDiscover.ts`, `app-mobile/src/components/SwipeableCards.tsx`, `app-mobile/src/components/CuratedExperienceSwipeCard.tsx`, `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`, `app-mobile/src/payments/nativeCheckoutFlow.ts`, + 2 new components (`ExperienceOccurrencePicker.tsx`, `ExperienceItinerary.tsx`).

---

## Deploy commands (for the orchestrator)

1. **Migration (operator runs `db push`):**
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/tmp-business-metro" && /Users/sethogieva/bin/supabase db push --linked
```
(Standard `--linked`, NOT `--include-all`: prefix `20260908000000` is in-order, one above the remote head `20260907000000`. The migration DROPs + re-creates the RPC additively; verified read-only that the query body executes against the live schema.)

2. **Edge functions (after the migration lands + close promotes to main):**
```bash
supabase functions deploy discover-cards --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy generate-curated-experiences --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy ticket-checkout-create --project-ref gqnoajqerqhnvulmnyvv
```
`ticket-checkout-create` keeps `verify_jwt` as configured (no change). Verify-first-call each with a curl returning non-404 after deploy.

3. **Client (app-mobile):** pure-JS change → rides an `eas update` per-platform (ios then android) on close, or the next build.

---

## Discoveries for orchestrator

- **D-1 (carried from investigation, consumer sold-out gap, P1-class):** `TicketCartSheet` still gates sold-out only on configured `quantity_total ≤ 0`, not on live `remaining`. ORCH-1072 surfaces remaining per-occurrence in the PICKER (sold-out occurrences disabled), but the cart's per-tier "+" cap is still the static `quantity_total`. The authoritative backstop remains the 409 at Pay + the new occurrence 422. A full consumer adoption of `pg_public_ticket_types_remaining` into `publicEventTicketsService` is still its own ORCH (investigation D-1). Not absorbed here.
- **D-2:** the booked occurrence is recorded on PI/session metadata, not a dedicated `orders.event_date_id` column. If per-occurrence reporting/scanning is needed, register a follow-up to add the column + thread the session/finalize RPCs.
