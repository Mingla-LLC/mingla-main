# INVESTIGATION — ORCH-1065 [consumer-experience-deck-card]

**Mode:** INVESTIGATE (terrain map for SPEC; no solution proposed)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1065-[consumer-experience-deck-card]/` on branch `ORCH-1065-consumer-experience-deck-card`
**Base:** `origin/main` `b9d272156` (full META-ORCH-1059 experiences schema present)
**Date:** 2026-06-03
**Confidence:** HIGH (root-cause-grade; all file:line proven on this base). Source/code-only — no sim repro needed (this is a supply-architecture audit, exempt per Prime Directive 7).

**Comms ledger acks:** COMMS-0014 + COMMS-0016 (WARN — experiences MUST route checkout through `ticket-checkout-create`, no parallel money fn) and COMMS-0018 (WARN — signal_id scorer bug in the venue→deck `place_pool`/`ai_signal_scores` path) are directly load-bearing and factored into Sections D, E, F.

---

## GOAL (restated)

Render brand-authored "experiences" (`events` rows with `event_type='experience'`, published, with `experience_stops` + `experience_intents`) as cards on the CONSUMER swipe deck (`app-mobile/`), visually distinguishable as Mingla/brand experiences, fed into the consumer recommendations pool, with tap → booking through the EXISTING `ticket-checkout-create` native cart path (COMMS-0016/0014 hard constraint).

---

## A. EXPERIENCE DATA MODEL (real, on this base)

### A.1 `experience_stops` table — full column set
`supabase/migrations/20260824000000_meta_orch_1059_sub_a_experience_stops.sql:78-100`:

| column | type | notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `event_id` | uuid NOT NULL | FK → `events(id)` ON DELETE CASCADE (`:80`) |
| `stop_order` | integer NOT NULL | 0-based; `UNIQUE(event_id, stop_order)` (`:96`); `>= 0` (`:97`) |
| `place_id` | text | Mapbox feature id (validated pick) |
| `place_name` | text NOT NULL | → `CuratedStop.placeName` |
| `address` | text NOT NULL | Mapbox formatted address |
| `city` / `region` / `country_code` | text | nullable |
| `lat` / `lng` | double precision | non-null once validated (gated at publish, not column-level) |
| `image_urls` | text[] NOT NULL DEFAULT `'{}'` | ≤5 via CHECK `experience_stops_images_max5` (`:99`); `[0]` = primary |
| `start_time` | time | OPTIONAL per-stop intra-day time |
| `price_cents` | integer NOT NULL DEFAULT 0 | per-stop; 0 in whole mode (display-only); `>= 0` (`:98`) |
| `ai_description` | text NOT NULL DEFAULT `''` | per-stop blurb → `CuratedStop.aiDescription` |
| `created_at` / `updated_at` | timestamptz NOT NULL DEFAULT now() | |

Index: `experience_stops_event_id_idx` (`:102`). RLS: owner-write direct-predicate (`:142-157`); **anon/public SELECT** of published experience stops via `experience_stops_select_public` (`:124-135`) — gated on the parent event being `event_type='experience' AND published_at IS NOT NULL AND visibility='public'`. **This is the public read the consumer client can already use to render stops.**

### A.2 `events.experience_intents` (canonical multi) + `events.experience_intent` (legacy singular) + CHECK
- Singular `events.experience_intent text` added by `20260827000000_meta_orch_1059_wizard_intent_desc_validation.sql:52-53`; original CHECK allowed **6** ids (`:62-67`).
- **Superseded** by `20260828000000_meta_orch_1059_experience_intents_multi.sql`:
  - **NEW canonical array** `events.experience_intents text[]` (`:42-43`), backfilled from singular (`:46-49`).
  - **CHECK `events_experience_intents_chk`** (`:56-66`): `NULL OR (array_length 1..4 AND <@ ARRAY['adventurous','first-date','romantic','group-fun'])` — **the 4 ids**.
  - The legacy singular CHECK `events_experience_intent_chk` is **re-narrowed to the same 4 ids** (`:80-96`); `picnic-dates`/`take-a-stroll` removed (operator change `:5-9`). Singular column is KEPT as a back-compat mirror of `experience_intents[1]` (`:98-99`).
- **Authoritative current truth (grep-all → sort → read-latest):** `experience_intents text[]`, 1–4 of `adventurous · first-date · romantic · group-fun`, NULL on non-experience + draft, ≥1 required at publish. `experience_intent` (singular) = mirror of element [1].

> ⚠️ **Mismatch for SPEC:** the consumer client's curated/onboarding intent vocabulary is BROADER than these 4 brand ids. `app-mobile/src/types/curatedExperience.ts` `CuratedExperienceCard.experienceType` is a free `string`; `CuratedExperienceSwipeCard.tsx:114` maps via `t('common:intent_${rawIntentKey}')`. The 4 brand ids are a subset — mapping is straightforward but must be pinned in SPEC (see Open Questions).

### A.3 How a published live experience is marked
Set by `biz_create_experience` / `biz_publish_experience` on `p_publish=true` (latest defs: `20260828000000:382-384` and `:866-868`):
- `status` → `'scheduled'` (else `'draft'`)
- `visibility` → `'public'` (else `'draft'`)
- `published_at` → `now()` (else NULL)
- `event_dates` master row materialised **only at publish** (I-4) — drafts carry NONE → unsellable.
- `theme.experience_meta.next_occurrence_at` persisted for display readers (`:528-538`).
- **No `show_in_swipeable_deck` column exists on `events`.** There is NO deck-eligibility flag on experiences today (the place-pool deck uses `place_pool.is_servable`; events have no analog). This is a gap the SPEC must resolve (filter on `event_type='experience' + visibility='public' + published_at NOT NULL + a future date`, or add a flag).

### A.4 Materialised `ticket_types` + `event_dates` (so checkout works)
`biz_create_experience` (`20260828000000:417-470`) and `biz_publish_experience` (`:884-953`):
- **EXACTLY ONE `ticket_types` row** at the resolved total (I-1 one-ticket; `name='Standard'`, `available_online=true`, `is_free=(total=0)`). Per-stop prices are display-only.
- **`event_dates`** master (+ multi/recurring) rows materialised at publish (`:472-504` / `:955-978`).
- Both RPCs comment I-6 NO PARALLEL MONEY FN: "checkout stays on `ticket-checkout-create`; this RPC only writes the single sellable ticket the existing engine reads" (`20260824000000:24-25`). **The experience is checkout-ready the moment it publishes — same shape an event has.**

---

## B. HOW BRAND EVENTS / TRIPS ALREADY REACH THE CONSUMER (the precedent)

**Headline finding: brand events and trips reach the consumer through the DISCOVER TAB (a search/browse grid), NOT the swipe deck. The swipe deck has never carried a brand-authored row of any kind.** Two entirely separate supply systems exist.

### B.1 Supply path — the swipe deck (place-pool only)
- Deck pool is built 100% by `supabase/functions/discover-cards/index.ts`, invoked from `app-mobile/src/services/deckService.ts:479` (`trackedInvoke('discover-cards', …)`), orchestrated by `app-mobile/src/contexts/RecommendationsContext.tsx:1103` (`deckService.fetchDeck({…})`) → `setRecommendations(...)`.
- `discover-cards` reads cards EXCLUSIVELY from:
  - `place_pool` (`:775`, hydrate; RPCs `query_servable_places_by_signal` `:1913` and `query_servable_places_by_signal_intersection` `:1135` over the `place_pool` / `ai_signal_scores` / `session_deck_cards` machinery), and
  - `session_curated_cache` (`:1314`, `:1339`, …) for AI-generated curated multi-stop experiences (built by `generate-curated-experiences`, invoked `:587`).
- **Proof of exclusion:** `grep -c "from('events')|event_type|experience_stops|ticket_types|business"` in `discover-cards/index.ts` = **1** (a single comment, line 366, noting pre-M0 history). The `events` table — and thus all brand events/trips/experiences — is **NOWHERE** in the deck pipeline. This is the META-ORCH-1009 / `place_pool` / `ai_signal_scores` venue→deck machinery; it serves VENUES (places), not brand-authored offerings.

### B.2 Supply path — the Discover tab (brand events + trips)
- `supabase/functions/discover-merged-events/index.ts` joins `events` + `brands` + `ticket_types` (+ `business_public_events_view` for all-in price, `:434`) and is filtered **`.eq("event_type", "event")` (`:369`)** + `.eq("visibility","public")` (`:362`) + `.in("status",["scheduled","live"])` (`:370`). It merges Ticketmaster results (`:597`).
- Consumed by `app-mobile/src/services/nightOutExperiencesService.ts` → `app-mobile/src/components/DiscoverScreen.tsx` (`setBusinessEvents(bizItems)` `:1477`). These render as a GRID in the Discover tab, expandable via `setExpansionTarget({ kind: "businessEvent", data })` (`DiscoverScreen.tsx:1643`).
- **Trips (ORCH-1016 "Consumer Discover Trips Tab")** surface via a SEPARATE dedicated query into a SEPARATE tab, NOT the deck — confirmed by the explicit `discover-merged-events` comment `:362-369` ("exclude trip rows … trips surface to consumers in C1 via a dedicated query"). `discover-cards`/`deckService.ts` contain **zero** trip references (`grep -c "trip|event_type" deckService.ts` = 0).

### B.3 Client render & discriminator
- `app-mobile/src/components/ExpandedCardModal.tsx` carries a UNION (`app-mobile/src/types/expansion.ts:17-19`): `{ kind: "nightOut"; data } | { kind: "businessEvent"; data: BusinessEventCardData }`. Projected at `ExpandedCardModal.tsx:1382` (`businessEvent = target?.kind === "businessEvent" ? target.data : null`).
- When `businessEvent != null`, the modal renders `<ExpandedBusinessEventSheet>` (`:1728-1740`) — a self-contained sheet that maps the card onto the shared `@mingla/event-rendering` `PublicEventPage` (`mapCardToPublicEvent`, `ExpandedBusinessEventSheet.tsx:95-133`) keyed on `card.eventId` (`:99`).
- **The swipe-deck `Recommendation` discriminator is ONLY `cardType === 'curated'`** (`SwipeableCards.tsx:2593`; same in `ExpandedCardModal.tsx:1747`). There are exactly TWO deck renderers: `CuratedExperienceSwipeCard` (curated) and the default place/nature card (`SwipeableCards.tsx:2593-2601`). There is a documented dead `cardType === 'event'` note with **"0 callers today (audit-verified)"** at `ExpandedCardModal.tsx:1938-1939` — i.e. a deck event-card path was sketched and never wired.
- **Discriminator summary:** place/curated cards flow through `Recommendation` (`app-mobile/src/types/recommendation.ts`) with `cardType` (curated) the sole discriminator; brand events/trips flow through `BusinessEventCard` (`app-mobile/src/types/mergedDiscover.ts:18-81`) tagged by the `expansion.ts` union `kind`. **These two type systems do not meet on the deck today.**

---

## C. CURATED CARD RENDERER (the visual target shape)

- `app-mobile/src/types/curatedExperience.ts`: `CuratedExperienceCard` (`:69-85`) = `{ id; cardType:'curated'; experienceType; pairingKey; title; tagline; stops: CuratedStop[]; totalPriceMin/Max; estimatedDurationMinutes; matchScore; _locked? }`. `CuratedStop` (`:3-57`) ≈ a column-for-column mirror of `experience_stops` (placeName/address/lat/lng/imageUrls≤5/aiDescription/priceTier). **The Sub-A migration explicitly states `experience_stops` "Mirrors CuratedStop so authoring is deck-ready" (`20260824000000:75, :104-105`).** The shapes were intentionally aligned for exactly this ORCH.
- **No brand attribution:** `grep -c "brandId|brandName|brandSlug" curatedExperience.ts` = **0**. Curated cards are AI-generated from places and carry no brand identity — so reusing the curated card AS-IS would NOT satisfy the "distinguishable as a Mingla/brand experience" requirement without adding brand fields.
- `app-mobile/src/components/CuratedExperienceSwipeCard.tsx`: renders stacked stop photos, category label via `t('common:intent_${rawIntentKey}')` (`:114-115`), stop badges, `… · N stops` subtitle (`:132-133`), `onSeePlan` → expand. Maps `experienceType` → icon (`CURATED_ICON_MAP`, `:116`).
- **Renderer selection** (`SwipeableCards.tsx:2593`): `cardType === 'curated' ? <CuratedExperienceSwipeCard> : <default place card>`.
- **Two integration options (evidence on both):**
  - **Option C-1 — reuse `CuratedExperienceSwipeCard` for the deck FACE.** The card already renders multi-stop itineraries from a `CuratedStop[]`, which `experience_stops` mirrors 1:1. Lowest visual lift. Needs: a brand badge/distinguisher (new field, since curated has none) + an experience→`CuratedExperienceCard` converter. Tap-to-book then needs a DIFFERENT expand path than curated (which opens an AI itinerary view with no checkout).
  - **Option C-2 — reuse `ExpandedBusinessEventSheet` for the EXPANDED/BOOK path.** EBES is `event_type`-agnostic (keys off `eventId` + `usePublicEventTickets`), already wired to `ticket-checkout-create`, and is the PROVEN trip-reuse pattern (ORCH-1016, §D below). Needs: the deck card to carry `eventId` and route expand → `{ kind: "businessEvent" }` instead of curated. The hybrid most consistent with the codebase = **curated-style face + business-event-sheet expand/book.**

---

## D. NATIVE BOOKING PATH (COMMS-0016 constraint)

Traced end-to-end how a consumer books a brand EVENT today:
1. `ExpandedBusinessEventSheet.tsx` — on Buy/Get Free, seeds `TicketCartSheet` (`:177-180`), then `runNativeCheckout` (`useNativeCheckoutFlow()`, `:189`) with `{ eventId: data.eventId, lines: [{ticketTypeId, quantity}], …, intakeFormData? }` (`:260-283`).
2. `app-mobile/src/payments/nativeCheckoutFlow.ts` — `useNativeCheckoutFlow` (`:109`) invokes **`ticket-checkout-create`** with `surface:"native"`, body `{ eventId, lines, intakeFormData }` (`:124-128`). On `requires_payment` → `initPaymentSheet` (`:210`) → `presentPaymentSheet` (`:264`) → native Stripe PaymentSheet (ORCH-1025 seamless cart). Contract is `eventId` + `lines:[{ticketTypeId, quantity}]` (`:25-27`).
3. Edge fn `supabase/functions/ticket-checkout-create/index.ts` (reads `events` + `ticket_types`, all-in pricing via ORCH-1006 `resolve_event_pricing_inputs` — per COMMS-0013/0014).

**Would an experience's `eventId` work through this SAME path for free?** YES, with one caveat:
- An published experience HAS the materialised single `ticket_types` row (I-1) + `event_dates` (I-4) — exactly the rows `ticket-checkout-create` reads. `usePublicEventTickets(eventId)` will return the 'Standard' tier; `lines:[{ticketTypeId, quantity:1}]` is well-formed. EBES is `event_type`-agnostic. **This is the entire point of META-ORCH-1059 Sub-A's I-1/I-6 design and COMMS-0014/0016.**
- **GAP to verify in SPEC/TEST (not a blocker):** `ticket-checkout-create` may have an `event_type` allowlist or trip/event-specific branches (e.g. ORCH-0911 success-url branching, trip intake). The SPEC must confirm the edge fn accepts `event_type='experience'` (or treats unknown types as the event default) — this is a one-line read at IMPLEMENT, but must be an explicit success criterion. No parallel money fn is permitted (COMMS-0016).

**Precedent proof (ORCH-1016 trips):** `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` maps a trip onto the `BusinessEventCard` shape with **`eventId: d.tripId`** (`:139`) and reserves via `ExpandedBusinessEventSheet` + `nativeCheckoutFlow` (`:7, :37-41, :68`). Trips are `event_type='trip'` rows that ride the identical `eventId`→`ticket-checkout-create` path. **Experiences are the same class of object; the booking path is solved.** The ONLY novel surface in ORCH-1065 is the SWIPE DECK face + supply, not checkout.

---

## E. SUPPLY GAP (precise injection point)

**There is NO events→deck feeder at all.** Brand events/trips reach the consumer ONLY via the Discover-tab feeder `discover-merged-events` (Section B.2); the swipe deck is fed ONLY by `discover-cards`, which sources ONLY `place_pool` + `session_curated_cache` (Section B.1, proven `grep` = 1 comment hit). **Experiences are NOT sourced into `discover-cards` anywhere — explicitly proven.**

To appear in the deck pool, a published experience would need to be injected at ONE of:
- **E-1 (deck edge fn):** inside `discover-cards/index.ts`, add an `events` (`event_type='experience'`, published, future-dated) source and INTERLEAVE it into the returned card array alongside place + curated cards — the interleave/dedup machinery is already in `discover-cards` + `deckService.fetchDeck` (`RecommendationsContext.tsx:1205-1256`). This keeps ONE deck-supply HTTP call.
- **E-2 (client merge):** fetch experiences client-side (a new query or extend the `discover-merged-events` path to include `event_type='experience'`) and merge into `setRecommendations` in `RecommendationsContext`. Riskier for ordering/interleave invariants.
- **E-3 (ride `place_pool`):** materialise an experience into `place_pool` so it rides the existing venue→deck `ai_signal_scores` machinery. **NOT RECOMMENDED** — experiences are brand offerings, not Google-Places venues; would require fabricating a place row and inherits the COMMS-0018 signal_id scorer bug (Section F). Flagged for completeness; SPEC should reject unless operator wants it.

**Decision belongs to SPEC/operator** (Open Questions). E-1 is the most invariant-respecting (single supply call, server interleave, no new client merge), but it must NOT touch the `place_pool`/`ai_signal_scores`/signal-scorer path (which is independently buggy per COMMS-0018).

---

## F. CROSS-SURFACE + INVARIANTS

### F.1 Strict-grep gates that a new feeder must respect
From `.github/scripts/strict-grep/`:
- **`i-proposed-tr2-events-type-filter.mjs`** — scope is `mingla-business/src/services` + `hooks` only (`:45-47`); requires every `.from("events")` to chain `.eq("event_type", …)`. Its regex ALREADY whitelists `'experience'` (`:55, :57`). **Does NOT scan `app-mobile/` or `supabase/functions/`** — so a consumer-side or edge feeder is NOT bound by it, but any mingla-business touch would be.
- **`i-proposed-tr2-route-by-event-type.mjs`** — scope `mingla-business/app` + `src` only (canonical `routeForEventRow`). Consumer deck not bound, but note the pattern: route/render decisions are expected to branch on `event_type`. A consumer expand handler that assumes "event" for an experience would be the analogous bug class.
- **`i-discover-excludes-ended-master-date.mjs`** + **`orch-0809-no-discover-price-filter.mjs`** — govern `discover-merged-events`/discover queries (exclude ended master dates; no price filter). If experiences ride or extend that feeder (E-2), these gates apply.
- **`i-curated-hours-via-canonical-reader.mjs`** + **`orch-0910-chat-payload-curated-aware.mjs`** — curated-card invariants; relevant if the experience reuses the curated card face (Option C-1) — opening-hours must use the canonical reader, chat payloads must stay curated-aware.
- **`orch-0963-public-trip-rpc-and-route-segregation.mjs`** — trip route segregation precedent.
- **Backend allowlist (COMMS-0002):** any new/edited `supabase/functions/*` or migration MUST update the ORCH-0863 C7 backend allowlist (`.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`) in the SAME commit.

### F.2 COMMS constraints (load-bearing)
- **COMMS-0016 + COMMS-0014 (WARN):** experiences MUST route checkout through `ticket-checkout-create` (same `eventId` contract), inheriting the ORCH-1006 all-in engine, configurable take-rate, venue-tax basis, 3 switches, lock-after-sale, `pricing_breakdown`. **NO parallel money fn.** Section D confirms this is free for experiences (I-1/I-6). The SPEC's booking layer = reuse EBES + `nativeCheckoutFlow`, full stop.
- **COMMS-0018 (WARN):** the venue→deck `place_pool`/`ai_signal_scores` supply path has a live correctness bug — `admin-review-venue-claim` v92 invokes `run-signal-scorer` with `{place_ids}` but NO `signal_id`, and `run-signal-scorer/index.ts:81` hard-rejects with HTTP 400 `'signal_id is required'`, so approved venues never get `place_scores` and never reach the deck. **Directly relevant ONLY if ORCH-1065 chooses supply option E-3 (ride place_pool).** If experiences ride E-1 (a dedicated events source in discover-cards), they bypass the signal-scorer entirely and are unaffected — a strong argument AGAINST E-3.

### F.3 Cross-surface
- **Consumer iOS + Android (`app-mobile/`):** the ONLY surfaces this ORCH ships to (swipe deck + expand sheet + checkout). Shared RN code → parity automatic, but the deck card visual must be verified on both.
- **NOT covered:** Business iOS/Android/Web (authoring already shipped by META-ORCH-1059), Admin Web (no deck), Buyer-anon Web (experiences already have a public page + checkout per META-ORCH-1059). No business analog needed.

### F.4 Five-Layer Cross-Check
| Layer | Finding |
|---|---|
| **Docs** | MEMORY `meta_orch_1059` entry: "STILL OPEN: consumer deck card (app-mobile)" — this ORCH is the named open item. COMMS-0016 re-homed the checkout constraint to this lineage. |
| **Schema** | `events.event_type='experience'` + `experience_stops` + `experience_intents[]` (4 ids) + one `ticket_types` + `event_dates` all present on base (Section A). Anon read of published experience stops already RLS-allowed. |
| **Code (deck)** | `discover-cards` + `deckService` + `SwipeableCards` render ONLY place + curated cards; zero events/experiences (Section B.1, E). |
| **Code (book)** | EBES + `nativeCheckoutFlow` + `ticket-checkout-create` are `event_type`-agnostic and proven on trips (`tripId` as `eventId`); experiences inherit for free (Section D). |
| **Runtime/Data** | Not probed live (architecture audit). Whether published experiences exist in prod data is unverified here; SPEC/TEST should seed one and confirm it materialises ticket+dates. |

---

## INTEGRATION CONTRACT (findings, not a spec)

The minimal, no-parallel-systems integration has THREE seams. Exact files:

1. **SUPPLY (the only true gap).** Inject published experiences into the deck pool. The single-call, invariant-respecting seam is the deck edge fn:
   - `supabase/functions/discover-cards/index.ts` — add an `events` source (`event_type='experience'`, `visibility='public'`, `published_at IS NOT NULL`, future-dated via `event_dates`) and interleave it into the returned card array. Must NOT touch the `place_pool`/`ai_signal_scores`/`run-signal-scorer` path (avoids COMMS-0018). Reads `experience_stops` (anon-readable already) + the single `ticket_types` row for price.
   - Touches `app-mobile/src/services/deckService.ts` (converter for the new card kind) + `app-mobile/src/contexts/RecommendationsContext.tsx` (interleave is already handled by `fetchDeck`).
   - Backend allowlist update required (COMMS-0002).
   - Alternative client-merge seam = extend `discover-merged-events` to also emit `event_type='experience'` and merge in `RecommendationsContext` — heavier on client interleave invariants; only if SPEC rejects the edge-fn seam.

2. **DECK FACE + DISCRIMINATOR.**
   - `app-mobile/src/types/recommendation.ts` / `app-mobile/src/types/curatedExperience.ts` — the experience card needs a discriminator beyond `cardType:'curated'` (e.g. `cardType:'experience'` or a `brandExperience` flag) AND brand-attribution fields (curated has NONE — `brandId/brandName/brandSlug/coverMediaUrl`) to be "distinguishable as a Mingla/brand experience."
   - `app-mobile/src/components/SwipeableCards.tsx:2593` — extend the renderer switch (currently `curated` vs default) to a third branch (reuse `CuratedExperienceSwipeCard` for the multi-stop face, OR a new thin variant) carrying a brand badge.
   - `app-mobile/src/components/CuratedExperienceSwipeCard.tsx` — if reused, add brand-badge prop; experience→`CuratedExperienceCard`-shaped converter maps `experience_stops`→`CuratedStop[]` (1:1 mirror per Sub-A) and `experience_intents[0]`→`experienceType`.

3. **EXPAND + BOOK (already solved — reuse, do not rebuild).**
   - `app-mobile/src/components/ExpandedCardModal.tsx:1382, 1728-1740` + `app-mobile/src/types/expansion.ts:17-19` — route the experience tap to `{ kind: "businessEvent", data }` (mapping the experience onto `BusinessEventCard` with `eventId = experience.id`, exactly as ORCH-1016 trips do with `tripId`).
   - `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` + `app-mobile/src/payments/nativeCheckoutFlow.ts` + `supabase/functions/ticket-checkout-create/index.ts` — UNCHANGED; experience `eventId` rides the existing `lines:[{ticketTypeId, quantity}]` → native PaymentSheet path. SPEC must add a success criterion confirming `ticket-checkout-create` accepts `event_type='experience'` (no allowlist rejection).

**Net:** the ONLY genuinely new code is supply (seam 1) + a deck face variant + discriminator (seam 2). Checkout (seam 3) is pure reuse of the trip-proven path. Zero parallel money systems (COMMS-0016 satisfied by construction).

---

## OPEN QUESTIONS FOR SPEC (operator/orchestrator decisions)

1. **Supply seam — E-1 (events source inside `discover-cards`, server interleave) vs E-2 (client merge via extended `discover-merged-events`)?** E-1 keeps one deck-supply call + server interleave and bypasses the COMMS-0018-buggy signal path; E-2 is closer to the existing tab feeder but adds client-side interleave risk. **E-3 (ride `place_pool`) is NOT recommended** (fabricates a venue row, inherits the signal_id bug) — confirm rejected.
2. **Deck FACE — reuse `CuratedExperienceSwipeCard` (multi-stop, lowest lift, needs brand badge added) vs a new business-experience card variant?** The migrations intentionally mirrored `experience_stops`↔`CuratedStop` for reuse, but curated cards carry zero brand identity.
3. **Brand distinguisher UI** — how does the consumer know this is a brand/Mingla experience vs an AI-curated stroll? (brand logo + name chip, a "Curated by {brand}" ribbon, a distinct accent?) Needs a `mingla-designer` pass.
4. **Intent vocabulary mapping** — experiences use 4 ids (`adventurous/first-date/romantic/group-fun`); the consumer deck/onboarding intent space is broader. How do experiences slot into the user's selected vibe filters / deck signals? (Map 4→consumer intents; decide whether an experience appears regardless of the active deck signal or only on matching intent.)
5. **Deck-eligibility filter** — no `show_in_swipeable_deck` flag exists on `events`. Use `event_type='experience' + visibility='public' + published_at NOT NULL + future master date`, or add an explicit opt-in flag? (Also: should past/ended experiences be excluded like events are via `i-discover-excludes-ended-master-date`?)
6. **`ticket-checkout-create` event_type acceptance** — confirm (read at IMPLEMENT, assert at TEST) the edge fn has no `event_type` allowlist that rejects `'experience'`; if it does, the fix is to add `'experience'` to the existing event branch, NOT a new fn (COMMS-0016).
7. **Expand path coherence** — curated cards expand to an AI-itinerary view (no checkout); experiences must expand to the booking sheet. Confirm SPEC routes the experience tap to the business-event sheet (seam 3), not the curated itinerary renderer, even if the FACE reuses the curated card.
