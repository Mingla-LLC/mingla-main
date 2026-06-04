# SPEC — ORCH-1065 [consumer-experience-deck-card]

**Mode:** SPEC (binding contract for implementor + tester)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1065-[consumer-experience-deck-card]/` on branch `ORCH-1065-consumer-experience-deck-card`
**Base:** `origin/main` `b9d272156` (full META-ORCH-1059 experiences schema present)
**Date:** 2026-06-03
**Input investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1065_CONSUMER_EXPERIENCE_DECK_CARD.md` (read in full; all file:line proven on this base)

**Comms-ledger acks (this turn):**
- COMMS-0014 (WARN) + COMMS-0016 (WARN) — experiences MUST route checkout through `ticket-checkout-create` (same `eventId` contract), NO parallel money fn. **Baked in as HARD CONSTRAINT** (§6, SC-8, T-08). acked.
- COMMS-0018 (WARN) — the venue→deck `place_pool`/`ai_signal_scores`/`run-signal-scorer` path has a live `signal_id` correctness bug that strands venues. **This SPEC's supply seam deliberately bypasses that path entirely** (§3.1, Decision D1). acked.
- COMMS-0002 (WARN) — any new/edited `supabase/functions/*` or migration MUST add its files to the ORCH-0863 C7 backend allowlist in the SAME commit. **Baked in** (§3.5, SC-12). acked.
- COMMS-0003 (WARN) — external-API/SQL docs cited inline for any new RPC. **Baked in** (§3.1 doc citations). acked.

---

## 1. LAYMAN SUMMARY

Today, brand-authored "experiences" (multi-stop outings a venue publishes in the business app) are completely invisible on the consumer swipe deck — the deck only ever shows AI-curated strolls and single places. This SPEC makes every published-live experience automatically appear as a swipeable card on the consumer Home deck, looking like the multi-stop curated card but stamped with the brand's logo + name and a **Book** button (instead of curated's "See Full Plan"). Tapping it opens the existing business-event booking sheet and checks out through the existing money pipeline — no new payment code. The only genuinely new machinery is a server-side query inside the deck-supply edge function that selects eligible experiences near the user and interleaves them into the deck, plus a deck card face variant and a discriminator so the deck/expand logic can tell a brand experience from an AI curated card.

---

## 2. SCOPE / NON-GOALS / ASSUMPTIONS

### 2.1 In scope
1. **Supply (the only true gap):** a server-side `events` source inside `supabase/functions/discover-cards/index.ts` (SOLO path only) that selects deck-eligible experiences by geo + intent and **server-interleaves** them into the returned `cards[]` array alongside place + (client-merged) curated cards. Bypasses `place_pool`/`ai_signal_scores`/signal-scorer (COMMS-0018).
2. **Deck card face + discriminator:** a new `cardType:'experience'` discriminator + brand-attribution fields on the client card payload; the curated multi-stop renderer (`CuratedExperienceSwipeCard`) reused for the FACE with an added **brand badge (logo + name)** and a **Book** CTA.
3. **Client converter:** an experience→`Recommendation` converter in `deckService.ts` so the new envelope decodes correctly.
4. **Expand → book routing:** experience tap routes to `{ kind: "businessEvent" }` → existing `ExpandedBusinessEventSheet` → existing `nativeCheckoutFlow` → existing `ticket-checkout-create` (the exact ORCH-1016 trip pattern, with `eventId = experience.id`).
5. **Regression tests:** an implementor happy-path test + a tester adversarial test, both at real paths, fails-on-revert proven (§8, Step-0.5 gate).

### 2.2 Non-goals (explicitly NOT in this ORCH)
- **No new/parallel money function.** `ticket-checkout-create` is NOT modified (it already defaults `event_type='experience'` to the event path — investigation §D, confirmed at `ticket-checkout-create/index.ts:300,326,718`). The SPEC only ADDS a regression test asserting an experience checks out through it.
- **No `place_pool` / `ai_signal_scores` / `run-signal-scorer` involvement** (COMMS-0018; supply option E-3 REJECTED — Decision D1).
- **No collab-deck experiences.** The collab positional deck (`handleDeterministicV2`, `session_deck_cards`) is OUT — experiences ride the SOLO deck only (Decision D6). Collab is a separate ORCH if ever wanted.
- **No business/admin/buyer-web surface changes.** Authoring (META-ORCH-1059) + public page + buyer-web checkout already shipped.
- **No new `show_in_swipeable_deck` opt-in flag.** Eligibility is AUTO-SURFACE off existing published-live columns (operator-locked Decision 2; Decision D5).
- **No change to the curated AI itinerary expand view.** Experiences do NOT open the curated `CuratedPlanView`; they open `ExpandedBusinessEventSheet` (Decision D7).
- **No Pexels/Giphy, no When-copy polish, no OTA** (those are separate open META-ORCH-1059 items).

### 2.3 Assumptions (stated, not all runtime-proven — TEST seeds + verifies)
- A1. At least one published-live experience exists (or will be seeded by TEST) with materialized `ticket_types` (one row) + `event_dates` + `experience_stops` + `experience_intents`. (Investigation §A.3/A.4 proves the publish RPCs materialize these; runtime presence is unproven and is a TEST setup step.)
- A2. `experience_stops` anon SELECT is RLS-allowed for published experiences (`experience_stops_select_public`, migration `20260824000000:124-135`) — but the supply query runs **service-role** inside the edge fn, so RLS is not the gate; the query's WHERE is.
- A3. The consumer deck's category pills include `adventurous`, `romantic`, `group-fun`, and `icebreakers` (first-date-friendly) — confirmed `CATEGORY_TO_SIGNAL` (`discover-cards/index.ts:88-122`) + `SESSION_INTENT_IDS` (`:151-158`).
- A4. i18n keys `intent_adventurous`, `intent_first_date`, `intent_romantic`, `intent_group_fun` exist (`app-mobile/src/i18n/locales/en/common.json:107-110`).

---

## 3. LAYER-BY-LAYER SPECIFICATION

### 3.0 Data-flow contract (the whole pipeline)

```
Consumer Home deck → RecommendationsContext.fetchDeck → deckService.fetchDeck
  → trackedInvoke('discover-cards', { categories, location, … })   [ONE http call]
      └─ discover-cards SOLO path:
           finalCards = [place cards…]                              (existing)
           experienceCards = await fetchEligibleExperiences(...)    (NEW §3.1)
           merged = interleaveExperiences(finalCards, experienceCards)  (NEW §3.1)
           return { cards: merged, … }
  → discoverCardsPayloadToRecommendations(data)                     (§3.3 — decode new envelope)
  → (client) round-robin interleave with curated cards             (existing)
  → setRecommendations → SwipeableCards
       renderer switch: cardType==='experience' → CuratedExperienceSwipeCard
                          + brandBadge + Book CTA                   (§3.4)
       tap → setExpandedBrandExperience(card)                       (NEW §3.4)
  → ExpandedCardModal target={ kind:"businessEvent", data }         (§3.4)
       → ExpandedBusinessEventSheet (UNCHANGED)
       → nativeCheckoutFlow → ticket-checkout-create (UNCHANGED)    (§3.6)
```

---

### 3.1 🔒 EDGE FUNCTION — `supabase/functions/discover-cards/index.ts` (SOLO path only)

**This is the only genuinely new backend code.** All changes confined to the SOLO branch (after the `handleDeterministicV2` collab early-return at `:1608`). The collab path is NOT touched.

#### 3.1.1 New helper: `fetchEligibleExperiences(...)`

Add a module-level async helper (service-role client) that selects deck-eligible experiences.

**Signature (LOCKED):**
```ts
async function fetchEligibleExperiences(args: {
  supabaseAdmin: SupabaseClient;
  lat: number;
  lng: number;
  radiusMeters: number;
  signalIds: string[];          // resolved from the request's category pills (§3.1.3)
  nowIso: string;               // request time (datetimePref ?? new Date()) ISO
  excludeEventIds: string[];    // from excludeCardIds (already-seen)
  limit: number;
}): Promise<ExperienceDeckCard[]>
```

**Deck-eligibility predicate (LOCKED — this is the SQL contract).** Implement as a single SECURITY DEFINER RPC `pg_eligible_experiences_for_deck` (NEW migration §3.2) called via `supabaseAdmin.rpc(...)`. The RPC's WHERE:

```sql
-- An experience row is deck-eligible IFF ALL hold:
e.event_type   = 'experience'
AND e.visibility   = 'public'
AND e.status       = 'scheduled'
AND e.published_at IS NOT NULL
AND e.experience_intents IS NOT NULL
AND array_length(e.experience_intents, 1) >= 1
-- has a FUTURE master/active date (mirrors i-discover-excludes-ended-master-date):
AND EXISTS (
  SELECT 1 FROM public.event_dates ed
  WHERE ed.event_id = e.id
    AND ed.end_at > p_now            -- not ended
)
-- has exactly the one sellable ticket the all-in engine reads (I-1; gates unsellable drafts):
AND EXISTS (
  SELECT 1 FROM public.ticket_types tt
  WHERE tt.event_id = e.id
    AND tt.available_online = true
)
-- intent overlap with the user's active deck signals (§3.1.3); empty p_intents ⇒ no intent filter:
AND (p_intents = '{}' OR e.experience_intents && p_intents)
-- geo: at least one stop within radius of the user (experience location = its stops):
AND EXISTS (
  SELECT 1 FROM public.experience_stops s
  WHERE s.event_id = e.id
    AND s.lat IS NOT NULL AND s.lng IS NOT NULL
    AND earth_distance(
          ll_to_earth(s.lat, s.lng),
          ll_to_earth(p_lat, p_lng)
        ) <= p_radius_m
)
AND e.id <> ALL(p_exclude_ids)
```

> **Geo note (Decision D3):** use `earthdistance`/`cube` (`ll_to_earth` + `earth_distance`) — already an enabled extension pattern in this DB. If `earthdistance` is NOT enabled, fall back to a haversine expression in plain SQL (no extension dependency). The implementor MUST verify extension availability via `mcp__supabase__list_extensions` at IMPLEMENT and pick the available path; the predicate's MEANING (≥1 stop within `p_radius_m` metres) is LOCKED, the distance mechanism is 🎨 OPEN.

**Order + limit (LOCKED):** `ORDER BY` soonest future `event_dates.start_at` ASC (next-occurring first), then `e.published_at DESC`; `LIMIT p_limit` (cap 30). Rationale: experiences are time-anchored offerings; show the soonest first.

**RPC returns** one row per eligible experience with the columns the card needs (§3.1.2). The RPC aggregates stops (ordered by `stop_order`) into a JSON array so the edge fn does one round-trip, not N+1.

**Docs cited (COMMS-0003):**
- Supabase RPC via PostgREST: https://supabase.com/docs/guides/database/functions and https://postgrest.org/en/stable/references/api/functions.html
- `supabaseAdmin.rpc()` JS contract: https://supabase.com/docs/reference/javascript/rpc
- `earthdistance`/`cube` (`ll_to_earth`, `earth_distance`): https://www.postgresql.org/docs/current/earthdistance.html
- `SECURITY DEFINER` + `search_path` hardening: https://www.postgresql.org/docs/current/sql-createfunction.html and https://supabase.com/docs/guides/database/postgres/row-level-security#security-definer-functions

#### 3.1.2 New card envelope: `ExperienceDeckCard` (server shape)

The edge fn maps each RPC row into this envelope and pushes it into `cards[]`. **Shape (LOCKED):**

```ts
interface ExperienceDeckCard {
  cardType: 'experience';            // DISCRIMINATOR (Decision D2)
  id: string;                        // = events.id  (this is the eventId for checkout)
  eventId: string;                   // = events.id  (explicit, for the booking seam)
  experienceType: string;            // experience_intents[0]  ('adventurous'|'first-date'|'romantic'|'group-fun')
  title: string;                     // events.title
  tagline: string;                   // events.theme.experience_meta tagline ?? '' (best-effort; '' ok)
  // BRAND ATTRIBUTION (curated has NONE — this is what distinguishes a brand experience):
  brandId: string;                   // brands.id
  brandName: string;                 // brands.name
  brandSlug: string;                 // brands.slug
  brandLogoUrl: string | null;       // brands.profile_photo_url (honest null)
  eventSlug: string;                 // events.slug
  // PRICE (single all-in ticket; display-only on the face):
  totalPriceMin: number;             // major units; from business_public_events_view.display_price_cents/100 ?? ticket price
  totalPriceMax: number;             // == totalPriceMin (single ticket)
  currency: string;                  // events.currency ?? brand default
  // DATE:
  masterDateUtc: string | null;      // soonest future event_dates.start_at (ISO)
  masterEndAtUtc: string | null;     // its end_at (ISO)
  timezone: string;                  // events.timezone ?? 'UTC'
  // STOPS (mirror of experience_stops → CuratedStop, ordered by stop_order):
  stops: Array<{
    stopNumber: number;              // stop_order + 1
    placeId: string;                 // experience_stops.place_id ?? id
    placeName: string;               // place_name
    address: string;
    imageUrl: string;                // image_urls[0] ?? ''
    imageUrls: string[];             // image_urls (≤5)
    aiDescription: string;           // ai_description
    lat: number; lng: number;
    priceMin: number; priceMax: number;  // price_cents/100 (display-only; 0 in whole mode)
    rating: number;                  // 0 (experiences carry no Google rating — honest 0, NOT fabricated)
    reviewCount: number;             // 0
    distanceFromUserKm: number | null;  // computed server-side (haversine) — honest null if no user loc
    travelTimeFromUserMin: number | null;
  }>;
  estimatedDurationMinutes: number;  // sum of stop estimates if present, else 0
  matchScore: number;                // 85 default (parity with curated)
}
```

> The `stops[]` shape is a deliberate subset of `CuratedStop` (investigation §C confirms the migrations mirrored `experience_stops`↔`CuratedStop` for exactly this reuse). The client converter (§3.3) fills the remaining `CuratedStop` fields with honest defaults so `CuratedExperienceSwipeCard` renders unchanged.

#### 3.1.3 Intent → signal-lane mapping (LOCKED — Decision D4)

The request's category pills resolve to `signalIds` (existing `CATEGORY_TO_SIGNAL`, `:1846`). For the experience filter, map the active deck signals back to the 4 experience-intent ids using this table:

| Active deck signal / pill | experience_intents id it matches |
|---|---|
| `adventurous` | `adventurous` |
| `romantic` | `romantic` |
| `group-fun`, `lively` | `group-fun` |
| `icebreakers` | `first-date` |
| (any other signal) | — (does not pull an experience intent) |

Build `p_intents text[]` = the DISTINCT set of experience-intent ids reachable from the request's pills via this table. **If the resulting set is EMPTY** (user picked only food/movies/etc. chips with no intent overlap), pass `p_intents = '{}'` and the RPC applies NO intent filter — i.e. **every geo-eligible published experience surfaces regardless of active vibe** (operator-locked Decision 2: "AUTO-SURFACE … filtered/ranked by geo + intents"; the intent filter NARROWS when the user has intent-bearing chips, and is permissive otherwise so experiences are never starved). This is 🔒 LOCKED.

> **Why permissive-on-empty:** the operator locked "every published live experience is automatically deck-eligible." A strict intent AND would hide all experiences whenever the user's deck is, e.g., a pure "Brunch" deck. The geo gate + soonest-date order keep the volume sane; the intent overlap only re-ranks/narrows when the user expressed a matching vibe.

#### 3.1.4 Interleave into `finalCards` (LOCKED)

After `const finalCards = hoursFilteredCards;` (`:2046`) and BEFORE the populated `return new Response(...)` (`:2055`):

```ts
// ORCH-1065: server-interleave brand-authored experiences into the deck.
// Bypasses place_pool/ai_signal_scores/run-signal-scorer entirely (COMMS-0018).
let experienceCards: ExperienceDeckCard[] = [];
try {
  experienceCards = await fetchEligibleExperiences({
    supabaseAdmin, lat: location.lat, lng: location.lng,
    radiusMeters, signalIds: uniqueSignalIds, nowIso: curatedUtcNow.toISOString(),
    excludeEventIds: excludeCardIds, limit: Math.min(limit, 30),
  });
} catch (err) {
  // Best-effort: an experience-source failure MUST NOT degrade the place deck.
  console.warn(`[discover-cards] experience source failed (tolerating): ${(err as Error).message}`);
}
const mergedCards = interleaveExperiencesIntoDeck(finalCards, experienceCards);
```

**`interleaveExperiencesIntoDeck` (LOCKED behavior):** deterministic round-robin that places one experience card after roughly every `Math.ceil(place.length / (exp.length + 1))` place cards (even spread), preserving the existing place order; dedupe by `id`; experiences NEVER displace place cards (additive merge). If `finalCards` is empty but experiences exist, the deck is experiences-only (still a populated `path:'pipeline'` response, NOT `pool-empty`). **The populated `return` uses `mergedCards`** for `cards`, `total`, `poolSize`, `fromPool`. Add `experienceCount: experienceCards.length` to `sourceBreakdown` for telemetry.

> ⚠️ **Empty-pool early-return hazard (LOCKED handling).** The SOLO path early-returns `buildEmptyResponse({ path:'pool-empty' })` at `:1862/:1901/:1955/:1986` when the place pool yields zero rows — BEFORE `finalCards` exists. To honor "auto-surface every published experience," the implementor MUST also attempt `fetchEligibleExperiences` before/at the `:1986` "RPCs succeeded but zero rows" branch and, if experiences exist, return a populated `path:'pipeline'` response built from experiences alone instead of the empty response. The other three early returns (`auth-required`, `pipeline-error`, missing-categories `400`) are NOT experience-eligible (no user/loc/categories context) and stay unchanged. This is 🔒 LOCKED; the exact refactor (hoist the experience fetch above the zero-row branch vs. add a dedicated experiences-only return) is 🎨 OPEN.

#### 3.1.5 🔒 Invariants the edge change must preserve
- INV-043 (every response path returns explicitly) — the new experiences-only path is an explicit return with `path:'pipeline'`.
- INV-042 (runtime failure ≠ data absence) — experience-source failure is swallowed (best-effort), never converted to `pool-empty`/`pipeline-error`.
- The collab positional path (`handleDeterministicV2`) is byte-untouched.
- No reference to `place_pool`, `ai_signal_scores`, `run-signal-scorer`, `session_deck_cards` from the new code (grep-clean — preserves the COMMS-0018 bypass).

---

### 3.2 🔒 DATABASE — new migration

**File (LOCKED name):** `supabase/migrations/20260901000000_orch_1065_eligible_experiences_for_deck.sql`
(timestamp strictly greater than the latest META-ORCH-1059 migration `20260829000000`; implementor confirms no collision via `mcp__supabase__list_migrations`).

**Contents:**
1. `CREATE OR REPLACE FUNCTION public.pg_eligible_experiences_for_deck(p_lat double precision, p_lng double precision, p_radius_m double precision, p_intents text[], p_now timestamptz, p_exclude_ids uuid[], p_limit int) RETURNS TABLE(...)` — `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `STABLE`, `LANGUAGE sql`. Body = the predicate in §3.1.1 + a `jsonb_agg` of stops ordered by `stop_order` + the brand/ticket/date joins + the §3.1.2 column projection.
2. `GRANT EXECUTE ON FUNCTION public.pg_eligible_experiences_for_deck(...) TO service_role;` (the edge fn calls it service-role; do NOT grant anon — there is no anon caller).
3. A supporting index if not present: `CREATE INDEX IF NOT EXISTS experience_stops_latlng_idx ON public.experience_stops (event_id) WHERE lat IS NOT NULL AND lng IS NOT NULL;` (the per-event stop lookups in the EXISTS clauses) — 🎨 OPEN whether also a GiST earth index; the functional index above is the LOCKED floor.

**🔒 NO RLS table changes.** This function reads existing tables under `SECURITY DEFINER` for the service-role edge caller only. It does not expose any new anon surface.

**Docs cited (COMMS-0003):** PostgreSQL `CREATE FUNCTION`/`SECURITY DEFINER` https://www.postgresql.org/docs/current/sql-createfunction.html ; `earthdistance` https://www.postgresql.org/docs/current/earthdistance.html ; Supabase DB functions https://supabase.com/docs/guides/database/functions ; `jsonb_agg`/`ORDER BY` in aggregate https://www.postgresql.org/docs/current/functions-aggregate.html .

**Migration application:** Seth runs `supabase db push` (autonomy posture: orchestrator may run it at CLOSE, but the tester does NOT apply migrations — Rule 13). TEST verifies with a read-only `SELECT * FROM pg_eligible_experiences_for_deck(...)` against a seeded experience.

---

### 3.3 🔒 CLIENT SERVICE — `app-mobile/src/services/deckService.ts`

**Add an experience-envelope converter and route it in `discoverCardsPayloadToRecommendations` (`:267`).**

1. `isExperiencePayload(card): boolean` → `card?.cardType === 'experience'` (checked BEFORE `isCuratedPayload`, since an experience envelope also has `stops[]`).
2. `experienceCardToRecommendation(card): Recommendation` — produces a `Recommendation` whose runtime shape is a `CuratedExperienceCard` superset PLUS the discriminator + brand fields. **Mapping (LOCKED):**
   - `cardType: 'experience'` (carried through verbatim).
   - `id`, `eventId`, `title`, `experienceType`, `tagline`, `brandId`, `brandName`, `brandSlug`, `brandLogoUrl`, `eventSlug`, `currency`, `masterDateUtc`, `masterEndAtUtc`, `timezone`, `totalPriceMin`, `totalPriceMax`, `estimatedDurationMinutes`, `matchScore` — carried verbatim.
   - `stops`: map server stops → `CuratedStop[]` filling missing fields with honest defaults: `stopLabel` derived (`'Start Here'`/`'Then'`/`'End With'` by index), `placeType:''`, `priceLevelLabel:''`, `priceTier:'free'` when price 0, `openingHours:null`, `isOpenNow:null`, `website:null`, `reviewCount:0`, `rating:0`, `travelTimeFromPreviousStopMin:null`, `travelModeFromPreviousStop:null`, `distanceFromUserKm`/`travelTimeFromUserMin` from server (honest null). **No fabricated ratings/reviews** (Constitution #9).
   - Also populate the base `Recommendation` fields the deck list needs: `category` = the intent label, `categoryIcon`, `image` = `stops[0].imageUrl`, `images` = first stop's `imageUrls`, `lat/lng` = `stops[0]`, `address` = `stops[0].address`, `distance`/`travelTime` honest-null from `stops[0]`, `socialStats` zeros, `matchFactors` parity defaults.
3. In `discoverCardsPayloadToRecommendations`: `if (isExperiencePayload(card)) return experienceCardToRecommendation(card);` placed FIRST in the map callback (before the curated/single branches).

> The `Recommendation` interface (`recommendation.ts`) is NOT widened with brand fields — the deck carries them on the runtime object via the curated-style `as unknown as` pattern already used for curated cards (`SwipeableCards.tsx:2595`). The brand fields are read off the runtime object in §3.4 with a typed local cast. (Decision D2 — discriminator + runtime fields, no interface bloat; matches how `cardType:'curated'` already works.)

---

### 3.4 🔒 + 🎨 CLIENT COMPONENT — deck face, discriminator, expand routing

#### 3.4.1 `app-mobile/src/components/SwipeableCards.tsx` — renderer switch (`:2593`)

Extend the two-way switch to a three-way:

```tsx
{(currentRec as any).cardType === 'experience' ? (
    <CuratedExperienceSwipeCard
      card={currentRec as unknown as CuratedExperienceCard}
      onSeePlan={handleCardExpand}
      travelMode={effectiveTravelMode}
      measurementSystem={accountPreferences?.measurementSystem}
      currencyCode={accountPreferences?.currency || 'USD'}
      brandExperience={{
        brandName: (currentRec as any).brandName,
        brandLogoUrl: (currentRec as any).brandLogoUrl,
      }}            // NEW prop (§3.4.3)
      ctaOverride="Book"   // NEW prop (§3.4.3)
    />
) : (currentRec as any).cardType === 'curated' ? (
    <CuratedExperienceSwipeCard … />        // unchanged
) : (
    <>{/* default place card */}</>
)}
```

#### 3.4.2 `SwipeableCards.tsx` — expand routing (the critical seam)

Today `selectedCardForExpansion` is wrapped as `{ kind: "nightOut", data }` at `:2732`. Add a PARALLEL state for brand experiences:

- New state: `const [expandedBrandExperience, setExpandedBrandExperience] = useState<BusinessEventCard | null>(null);`
- In `handleCardExpand` (`:1498`), BEFORE the curated branch (`:1518`):
  ```ts
  if ((currentRec as any).cardType === 'experience') {
    setExpandedBrandExperience(experienceRecToBusinessEventCard(currentRec));
    return;
  }
  ```
- New mapper `experienceRecToBusinessEventCard(rec): BusinessEventCard` (colocated, mirrors `tripToBusinessEventCard` in `ConsumerTripDetailScreen.tsx:137-170`): `eventId: rec.eventId`, `brandId/brandSlug/brandName/brandProfilePhotoUrl(brandLogoUrl)/eventSlug`, `title`, `description: rec.tagline ?? null`, `coverMediaUrl: rec.stops[0]?.imageUrl ?? null`, `coverMediaType:'image'`, `coverHue: hueFromId(rec.eventId)`, `masterDateUtc/masterEndAtUtc/timezone`, `venueName: rec.stops[0]?.placeName`, `city`, `address: null`, `hideAddressUntilTicket:false`, `format:'in-person'`, `locationGeo: rec.stops[0]`, `partyTypes/vibeTags/musicGenres: []`, `priceMin/priceMax: rec.totalPriceMin`, `currency`, `displayPriceCents`/`displayCurrency` carried if present, `publicBuyerUrl: https://business.usemingla.com/e/{brandSlug}/{eventSlug}`.
- At the stable overlay mount (`:2728`), the `ExpandedCardModal` `target` prop becomes:
  ```tsx
  target={
    expandedBrandExperience ? { kind: "businessEvent", data: expandedBrandExperience }
    : selectedCardForExpansion ? { kind: "nightOut", data: selectedCardForExpansion }
    : null
  }
  ```
- `handleCloseExpandedModal` (`:1574`) also clears `setExpandedBrandExperience(null)`.

> This reuses the EXISTING `ExpandedCardModal` businessEvent branch (`:1728-1740`) → `ExpandedBusinessEventSheet` verbatim. No new sheet. (Decision D7.)

#### 3.4.3 `app-mobile/src/components/CuratedExperienceSwipeCard.tsx` — brand badge + Book CTA (🔒 contract / 🎨 visual craft)

Add two OPTIONAL props (curated callers pass neither, so curated is byte-unaffected):
```ts
brandExperience?: { brandName: string; brandLogoUrl: string | null };
ctaOverride?: string;   // 'Book' for experiences; undefined → existing 'See Full Plan'/'See Details'
```
- **🔒 LOCKED:** when `brandExperience` is present, render a **brand badge** in the title overlay (logo thumbnail when `brandLogoUrl != null`, else a monogram/initial fallback — NEVER a fabricated logo; honest null → initial) + the brand name, visually distinct from the curated category chips so a user can tell "this is {Brand}'s experience" vs an AI stroll. The **CTA text** = `ctaOverride ?? (existing logic)` and the CTA icon for the Book variant is a ticket/calendar icon, not the `list-outline`. The badge MUST meet WCAG contrast (body ≥4.5:1, large ≥3:1) on the hero gradient — pin tokens in the DESIGN pass.
- **🎨 OPEN (handed to `mingla-designer`):** exact badge placement (above title vs. top-left chip vs. ribbon), logo size, corner radius, accent treatment, monogram fallback styling, Book-button color/press feel within the design-system band. **This SPEC REQUIRES a `mingla-designer` DESIGN pass** producing `Mingla_Artifacts/specs/DESIGN_ORCH-1065_BRAND_EXPERIENCE_DECK_CARD.md` with the full pinned visual contract (color light+dark tokens + computed contrast, typography, spacing tokens, safe-area, all 9 states, motion+haptics, no-AI-slop bans, References-examined line). The implementor builds to that DESIGN. **No UI ships with visuals undefined** (spec-granularity protocol).
- **No-AI-slop bans (LOCKED):** no generic gradient logos, no stock/AI brand imagery, no emoji as the brand mark, no decorative glow. The brand mark is the brand's real `profile_photo_url` or an honest text monogram.

**References examined (for the functional contract):** the existing `CuratedExperienceSwipeCard` chrome (this file), the trip Reserve pattern (`ConsumerTripDetailScreen.tsx`), `GlassBadge` vocabulary, the business-event public hero (`@mingla/event-rendering`). The DESIGN pass will examine premium multi-vendor marketplace cards (e.g. Airbnb Experiences host badge, Resy venue cards, Dice event cards) for the brand-attribution moment.

---

### 3.5 🔒 STRICT-GREP / CI

- **`.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`** (Check 7 / C7 backend allowlist): add a NEW `ORCH_1065_BACKEND_ALLOWLIST` array containing the new migration path `supabase/migrations/20260901000000_orch_1065_eligible_experiences_for_deck.sql` AND `supabase/functions/discover-cards/index.ts` (the edited edge fn), wired into the C7 offender-exclusion exactly like the existing `ORCH_0875_BACKEND_ALLOWLIST` etc. — **in the SAME commit** as those backend files (COMMS-0002). `discover-cards/index.ts` is an EDIT not a new file, but include it defensively if C7 flags edits; verify locally which it does and scope accordingly.
- **`i-discover-excludes-ended-master-date.mjs`** — the new RPC's future-date EXISTS clause mirrors this invariant for experiences. If this gate's scope includes the new RPC's SQL, ensure the `end_at > p_now` predicate is present (it is). No gate edit expected; verify scope at IMPLEMENT.
- **`i-proposed-tr2-events-type-filter.mjs`** — scope is `mingla-business/src` only (investigation §F.1); the consumer client + edge fn are NOT bound. The new RPC's `event_type='experience'` predicate is nonetheless explicit (good hygiene). No edit.
- **`i-curated-hours-via-canonical-reader.mjs` / `orch-0910-chat-payload-curated-aware.mjs`** — experiences reuse the curated FACE but carry `cardType:'experience'`, NOT `'curated'`; confirm these gates key on `'curated'` and do not falsely flag the new branch. If a gate asserts "every `CuratedExperienceSwipeCard` consumer reads hours via canonical reader," note experiences pass `openingHours:null` (no hours) — verify no violation at IMPLEMENT.
- Run the existing jest/deno gates after edits. No NEW strict-grep gate is mandated by this SPEC (the discriminator + bypass are enforced by tests T-07/T-09, not a new CI script) — 🎨 OPEN: the implementor MAY add a tiny grep asserting `discover-cards` experiences code never references `place_pool`/`run-signal-scorer` (COMMS-0018 guard) if cheap; not required.

---

### 3.6 🔒 BOOKING — UNCHANGED (reuse, COMMS-0014/0016)

**NO code change to** `ExpandedBusinessEventSheet.tsx`, `nativeCheckoutFlow.ts`, or `ticket-checkout-create/index.ts`. The experience `eventId` rides the existing `{ eventId, lines:[{ticketTypeId, quantity}] }` contract:
- `ExpandedBusinessEventSheet` is `event_type`-agnostic (keys off `eventId` + `usePublicEventTickets(eventId)` → returns the single 'Standard' tier).
- `ticket-checkout-create` only special-cases `event_type==='trip'` (`:300,326,718`); `'experience'` falls through to the default event path (`event_no_active_dates` gate at `:274` passes because experiences have materialized `event_dates`).

**The ONLY booking deliverable is a regression test (SC-8 / T-08)** asserting an `event_type='experience'` eventId checks out through `ticket-checkout-create` (no allowlist rejection, correct all-in pricing via the ORCH-1006 engine).

---

## 4. CROSS-SURFACE IMPACT (Phase 2.5 — MANDATORY)

| # | Surface | Covered? | Behavior / files / parity |
|---|---|---|---|
| 1 | **Consumer iOS** (`app-mobile/` iOS) | ✅ COVERED | Experience cards appear in the Home swipe deck; brand badge + Book CTA; tap → `ExpandedBusinessEventSheet` → native PaymentSheet. Files: `deckService.ts`, `SwipeableCards.tsx`, `CuratedExperienceSwipeCard.tsx`. SC-1..SC-9. |
| 2 | **Consumer Android** (`app-mobile/` Android) | ✅ COVERED | Same shared RN code → **parity automatic**, BUT the brand-badge render + the deck card visual MUST be verified on Android too (GlassBadge/opaque-fallback policy). Per-surface SC: **SC-2-iOS** + **SC-2-Android** (visual), **SC-9-iOS** + **SC-9-Android** (checkout PaymentSheet). |
| 3 | **Buyer/anon Web** (`mingla-business/` `/e/...`, `/checkout/...`) | ❌ NOT COVERED | Experiences already have a public page + buyer-web checkout (META-ORCH-1059). No deck exists on web. |
| 4 | **Business iOS** (`mingla-business/` iOS) | ❌ NOT COVERED | Authoring shipped (META-ORCH-1059). No consumer deck here. |
| 5 | **Business Android** (`mingla-business/` Android) | ❌ NOT COVERED | Same. |
| 6 | **Admin Web** (`mingla-admin/`) — adjacent | ❌ NOT COVERED | Admin renders no consumer deck. |
| 7 | **Business Web preview** — adjacent | ❌ NOT COVERED | No deck surface. |

**Parity is automatic (shared RN) but visually MANUAL-verified** on iOS + Android per SC-2/SC-9 split — the implementor cannot ship iOS-only.

---

## 5. SUCCESS CRITERIA (observable / testable / unambiguous)

- **SC-1.** Given ≥1 published-live experience within the user's radius whose `experience_intents` overlap the active deck signals (or any published-live experience when the active deck has no intent-bearing chips), `discover-cards` SOLO returns ≥1 card with `cardType:'experience'`, the correct `eventId`, brand fields, and ordered `stops[]`.
- **SC-2 (iOS + Android).** That card renders in the deck via `CuratedExperienceSwipeCard` with (a) the multi-stop photo strip, (b) a **brand badge showing the brand logo + name** (monogram fallback when `brandLogoUrl` null), and (c) a **Book** CTA (not "See Full Plan"). Verified on iOS sim AND Android emulator/device.
- **SC-3.** A DRAFT experience (status≠'scheduled' OR visibility≠'public' OR `published_at IS NULL`) is NEVER returned by `pg_eligible_experiences_for_deck` (eligibility predicate).
- **SC-4.** An experience whose only `event_dates` are in the past (`end_at <= now`) is NEVER returned (future-date gate; mirrors `i-discover-excludes-ended-master-date`).
- **SC-5.** An experience with NO `available_online` ticket is NEVER returned (unsellable gate).
- **SC-6.** An experience whose stops are all outside `radiusMeters` is NEVER returned (geo gate).
- **SC-7.** Tapping an experience card opens `ExpandedBusinessEventSheet` (the business-event sheet) — NOT the curated AI itinerary (`CuratedPlanView`). The sheet shows the single 'Standard' ticket from `usePublicEventTickets(eventId)`.
- **SC-8.** An `event_type='experience'` eventId completes `ticket-checkout-create` (`surface:'native'`, `lines:[{ticketTypeId, quantity:1}]`) with NO `event_type` allowlist rejection, returning a valid PaymentIntent/free-claim, with all-in pricing from the ORCH-1006 engine. **No parallel money fn exists** (grep: zero new `*-checkout-*`/`*-create-*` edge fns).
- **SC-9 (iOS + Android).** End-to-end: deck → tap experience → Book → cart → native Stripe PaymentSheet presents (paid) or free-claim succeeds. Verified on both platforms.
- **SC-10.** The COMMS-0018 bypass holds: the new `discover-cards` experiences code references NONE of `place_pool`, `ai_signal_scores`, `run-signal-scorer`, `session_deck_cards` (grep-clean).
- **SC-11.** A failure in the experience source (RPC error/throw) does NOT degrade the place deck — the response is still a populated `path:'pipeline'` with the place cards (best-effort tolerance; INV-042 preserved).
- **SC-12.** The ORCH-0863 C7 backend allowlist contains the new migration (+ edge fn if flagged) in the SAME commit; CI C7 passes green.
- **SC-13.** Curated cards are byte-unaffected: a `cardType:'curated'` card still renders with no brand badge and its existing "See Full Plan"/"See Details" CTA, and still expands to `CuratedPlanView`.
- **SC-14.** The collab positional deck is unaffected (no experiences in collab; `handleDeterministicV2` untouched).

---

## 6. INVARIANTS

### Preserved (must not regress)
| ID | How preserved | Verifying test |
|---|---|---|
| INV-043 (discover-cards every-path-explicit-return) | new experiences-only path is an explicit `path:'pipeline'` return | T-11 |
| INV-042 (runtime-failure ≠ data-absence) | experience-source error swallowed, never `pool-empty`/`pipeline-error` | T-10 |
| I-1 (one sellable ticket per experience) | eligibility requires an `available_online` ticket; booking reads that one tier | T-05, T-08 |
| I-6 / COMMS-0014/0016 (NO parallel money fn) | booking reuses `ticket-checkout-create`; zero new money fns | T-08, SC-8 |
| COMMS-0018 bypass (no signal_id-buggy path) | new code grep-clean of place_pool/signal-scorer | T-09, SC-10 |
| I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME (honest null) | experience stops pass honest null distance/time; no fabrication | T-12 |
| Constitution #9 (no fabricated data) | rating/reviewCount = honest 0; logo null → monogram, never fake | T-12 |
| i-discover-excludes-ended-master-date (semantics) | future-date EXISTS clause | T-04 |

### New invariants established (DRAFT → ACTIVE on CLOSE)
- **I-PROPOSED-EXPERIENCE-DECK-CARD-TYPE** — every brand-authored experience surfaced on the consumer deck carries `cardType:'experience'` (NOT `'curated'`), routes expand to `ExpandedBusinessEventSheet` (NOT `CuratedPlanView`), and books through `ticket-checkout-create`. Verified by T-07 + T-08.
- **I-PROPOSED-EXPERIENCE-DECK-SUPPLY-BYPASSES-PLACEPOOL** — the experiences deck source never touches `place_pool`/`ai_signal_scores`/`run-signal-scorer` (COMMS-0018). Verified by T-09.

---

## 7. TEST PLAN (Step-0.5 gate: implementor happy-path + tester adversarial, real paths, fails-on-revert)

**Implementor happy-path tests (ship WITH the implementation):**

| Test | Scenario | Input | Expected | Layer | File (real path) |
|---|---|---|---|---|---|
| T-01 | Eligible experience surfaces | seeded published-live experience near user, matching intent | `discover-cards` returns a `cardType:'experience'` card with eventId + brand fields + stops | edge+RPC | `supabase/functions/discover-cards/__tests__/orch_1065_experience_supply.test.ts` |
| T-02 | Client converter | experience envelope | `discoverCardsPayloadToRecommendations` yields a `cardType:'experience'` Recommendation with brand fields + CuratedStop[] | service | `app-mobile/src/services/__tests__/deckService.orch1065.test.ts` |
| T-03 | Card face mapping | experience Recommendation | `mapCardToPublicEvent`-equivalent `experienceRecToBusinessEventCard` produces a valid `BusinessEventCard` (eventId set, single-ticket shape) | component-map | `app-mobile/src/components/__tests__/orch1065_experience_expand.test.tsx` |
| T-05 | Unsellable excluded | experience with no `available_online` ticket | RPC returns 0 rows | RPC | T-01 file (adversarial row) |
| T-08 | **Checkout regression (COMMS-0014/0016)** | `event_type='experience'` eventId → `ticket-checkout-create` `{lines}` | succeeds via event path, all-in pricing, NO rejection; assert no new money fn file exists | full stack | `supabase/functions/ticket-checkout-create/__tests__/orch1065_experience_checkout.test.ts` |

**Tester adversarial tests (independent; written by tester):**

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-04 | Past-dated experience | only past `event_dates` | NEVER surfaces (SC-4) | RPC |
| T-06 | Geo exclusion | stops all > radius | NEVER surfaces (SC-6) | RPC |
| T-07 | Expand routing | tap experience card | opens `ExpandedBusinessEventSheet`, NOT `CuratedPlanView` (SC-7) | component |
| T-09 | **COMMS-0018 bypass** | grep new discover-cards code | zero `place_pool`/`ai_signal_scores`/`run-signal-scorer`/`session_deck_cards` refs (SC-10) | static |
| T-10 | Source failure tolerance | force RPC throw | place deck still returns `path:'pipeline'` (SC-11) | edge |
| T-11 | Empty place pool + experiences | zero place rows, 1 experience | populated `path:'pipeline'` experiences-only deck, NOT `pool-empty` (SC-1 edge) | edge |
| T-12 | No fabrication | experience with null brand logo / no ratings | monogram fallback, rating 0, honest-null distance (Constitution #9) | component |
| T-13 | Curated unaffected | `cardType:'curated'` card | no brand badge, "See Full Plan", expands to `CuratedPlanView` (SC-13) | component |

**Fails-on-revert proof (LOCKED):** T-01 must FAIL if the interleave is reverted; T-07 must FAIL if the expand routing falls back to curated; T-08 must FAIL if a parallel money fn is introduced or `ticket-checkout-create` rejects `'experience'`; T-09 must FAIL if any place_pool/signal-scorer ref is added. The implementor + tester each run their suite, revert the relevant hunk locally, and confirm the test goes red (evidence in reports).

**Live-fire (tester, both platforms):** seed a published-live experience (via business-app authoring or direct insert mirroring the publish RPC output), boot iOS sim + Android emulator with the latest bundle, confirm the card appears in the deck, tap → Book → PaymentSheet. `proven`-level evidence required for PASS on this UI/runtime change (Prime Directive 7).

---

## 8. IMPLEMENTATION ORDER

1. **DB:** write migration `20260901000000_orch_1065_eligible_experiences_for_deck.sql` (RPC + grant + index). Verify extension availability (`list_extensions`) and no timestamp collision (`list_migrations`).
2. **Edge:** add `fetchEligibleExperiences` + `ExperienceDeckCard` envelope + intent→intent map + `interleaveExperiencesIntoDeck` + the empty-pool hazard handling in `discover-cards/index.ts` (SOLO path only). Write T-01/T-05.
3. **Strict-grep:** add `ORCH_1065_BACKEND_ALLOWLIST` to `orch-0863-marketing-hub-phase-b.mjs` in the SAME commit as steps 1–2. Run C7 locally.
4. **Client service:** add `isExperiencePayload` + `experienceCardToRecommendation` + route in `discoverCardsPayloadToRecommendations`. Write T-02.
5. **Client component:** extend `SwipeableCards` renderer switch + add `expandedBrandExperience` state + `experienceRecToBusinessEventCard` mapper + `ExpandedCardModal` target branch + `handleCardExpand`/close wiring. Write T-03.
6. **DESIGN dependency:** `mingla-designer` produces `DESIGN_ORCH-1065_BRAND_EXPERIENCE_DECK_CARD.md`; implement the brand badge + Book CTA on `CuratedExperienceSwipeCard` to that spec (steps 5–6 can parallelize; the badge visuals gate on the DESIGN).
7. **Checkout regression:** write T-08 against `ticket-checkout-create` (no fn change).
8. **Verify:** run jest + deno + strict-grep; tester live-fire iOS + Android; fails-on-revert proofs.

---

## 9. REGRESSION PREVENTION

- **Structural safeguard:** the discriminator `cardType:'experience'` + the dedicated `expandedBrandExperience` state make experiences a first-class branch that cannot silently fall into the curated or place path; the businessEvent expand branch is shared with the proven trip pattern.
- **Test safeguards:** T-07 (expand routing), T-08 (checkout reuse), T-09 (COMMS-0018 bypass), T-13 (curated unaffected) — all fails-on-revert.
- **Protective comments:** the new edge-fn block carries `// ORCH-1065: bypasses place_pool/signal-scorer (COMMS-0018)`; the expand mapper carries `// ORCH-1065: experience books via ticket-checkout-create — NO parallel money fn (COMMS-0014/0016)`.
- **Invariant registry:** the two new DRAFT invariants (§6) go ACTIVE on CLOSE.

---

## 10. RESIDUAL DECISIONS (numbered; my recommended default baked in — do NOT bounce trivial choices)

The operator locked Decisions 1–6 in the dispatch. The Open Questions from the investigation are RESOLVED as follows (all baked into the SPEC above; listed here for the record with my default where the dispatch left a sub-choice):

- **D1 — Supply seam.** RESOLVED to **E-1 (server-side events source inside `discover-cards`, server-interleave)** per operator lock #3. E-3 (ride `place_pool`) REJECTED (COMMS-0018). E-2 (client merge) rejected (heavier client interleave risk). ✅ locked.
- **D2 — Discriminator.** Default: **`cardType:'experience'`** runtime discriminator + brand fields on the runtime object (NOT a widened `Recommendation` interface) — mirrors how `cardType:'curated'` already works. Cleanest per investigation §B.3 type findings. ✅ recommended + baked.
- **D3 — Geo mechanism.** Default: **`earthdistance` (`ll_to_earth`/`earth_distance`)** if the extension is enabled, else a plain-SQL haversine fallback. Meaning locked (≥1 stop within radius); mechanism OPEN to whichever is available. Implementor confirms via `list_extensions`. ✅ recommended.
- **D4 — Intent vocabulary mapping.** Default: the §3.1.3 table (`adventurous→adventurous`, `romantic→romantic`, `group-fun/lively→group-fun`, `icebreakers→first-date`), **permissive when the active deck has no intent-bearing chip** (surface all geo-eligible experiences) so auto-surface is never starved. ✅ recommended + locked.
- **D5 — Eligibility filter.** Default: **no opt-in flag**; `event_type='experience' + visibility='public' + status='scheduled' + published_at NOT NULL + future event_date + available_online ticket + geo` (operator lock #2). ✅ locked.
- **D6 — Collab scope.** Default: **SOLO deck only**; collab positional deck out of scope (a future ORCH if wanted). ✅ recommended.
- **D7 — Expand coherence.** Default: experiences open **`ExpandedBusinessEventSheet`** (business-event sheet), NEVER the curated `CuratedPlanView`, even though the FACE reuses the curated renderer (operator lock #1 + COMMS-0016). ✅ locked.
- **D8 — `ticket-checkout-create` acceptance.** RESOLVED: I verified the fn only special-cases `'trip'` and defaults `'experience'` to the event path (`:300,326,718`). **No fn change**; SPEC adds the T-08 regression only. ✅ confirmed.
- **D9 — Card face variant (operator lock #1 sub-choice).** Default: **reuse `CuratedExperienceSwipeCard`** with optional `brandExperience` + `ctaOverride` props (curated callers unaffected) rather than a brand-new card component — lowest lift, the migrations intentionally mirrored the shapes. The visual treatment of the badge is the **designer's** job (DESIGN pass required). ✅ recommended.

**One genuinely open item handed to the designer (not bounced to Seth):** the exact brand-badge visual treatment + Book-button styling — RESOLVED to "required `mingla-designer` DESIGN pass" (§3.4.3). This is a craft decision, correctly routed to design, not an operator decision.
