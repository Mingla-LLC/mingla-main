# INVESTIGATION — ORCH-0824 — Business Events in Consumer Discover + Wizard Step 1 Taxonomy Replacement

**Mode:** INVESTIGATE only (no solutions, no spec).
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Date:** 2026-05-13.
**Investigator:** Claude `mingla-forensics`.

---

## Operator clarification appended 2026-05-13 (post-investigation)

The operator clarified two points after reading the initial report:

1. **Card visual is NOT required to be identical to a Ticketmaster card.** Business event cards may have a unique hero treatment and layout. This supersedes finding B-3 / X-5's "identical cards" framing and Constraint Inventory item implied under C-3.
2. **Tap behavior MUST open the same expanded sheet that a Ticketmaster card opens** (the in-app `ExpandedCardModal` imported at top of `DiscoverScreen.tsx`), not an external URL or a cross-app deep link. The consumer never leaves `app-mobile`. The expanded sheet becomes the entry point for the buyer flow (CTA opens checkout in-app — mechanism is a SPEC decision: in-sheet WebView pointed at the existing public `app/e/{brandSlug}/{eventSlug}` route in `mingla-business`, OR reimplemented buyer flow in `app-mobile`).

**Implications for the findings below:**
- **X-5 (contradiction)** is partially resolved: cards no longer need identical visual; but a different contradiction is established — business-event data must conform to whatever shape the `ExpandedCardModal` consumes (need to trace that contract in SPEC phase).
- **B-5 (card tap routes to external `ticketUrl`)** is now a known divergence point, not a problem: business events take a different tap path into the existing `ExpandedCardModal`.
- **C-1 / cross-app routing concern** is downgraded. The buyer flow remains in-app; only the checkout WebView (if that's the chosen mechanism) crosses domains.
- **Open question Q5 (tap routing)** is resolved at this level: tap → expanded sheet. **A new open question replaces it:** how does the buyer flow inside the expanded sheet wire into checkout (in-sheet WebView vs in-app reimplementation)?

The body of the report below was written before this clarification arrived and references "identical cards" in places — read those passages with this clarification in mind.

---

## Operator answers to four big open questions (captured 2026-05-13)

1. **City semantics:** Use the **CityPickerSheet selection** as the consumer's city. (Resolves Q1.)
2. **Event city storage:** Derive city from the wizard's **address validation step** (autocomplete returns structured city), write to a new `events.city` column at publish time. (Resolves Q3.)
3. **Merge topology:** **Server-side fan-out.** A new (or extended) edge function reads both sources, applies business-first ranking, returns one merged response. (Resolves Q4.)
4. **Filter degradation:** When a Mingla-native filter (Party Type / Vibe) is active, **show only business events** for that query — suppress Ticketmaster entirely. (Resolves Q6.)

## NEW Finding D-1 — Address autocomplete in business wizard does not exist (🔴 Root Cause for the "deduce city from address" path)

**Claim:** The operator's strategy "validate the address (Google or Seper) and deduce the city" depends on an autocomplete integration that **does not exist in mingla-business**. The wizard's Step 3 (Where) uses a plain `<Input>` for address with no geocoding, no autocomplete, no validation. Furthermore, **no Seper integration exists anywhere in the codebase** — only Google Places, and only in the consumer app.

**Evidence file/line:**
- Wizard address field: [mingla-business/src/components/event/CreatorStep3Where.tsx:6-12](mingla-business/src/components/event/CreatorStep3Where.tsx#L6-L12) (comment "Real geocoding + Google Places autocomplete land in B-cycle"), [:70-77](mingla-business/src/components/event/CreatorStep3Where.tsx#L70-L77) (plain Input).
- Consumer-side Google Places integration: [app-mobile/src/services/geocodingService.ts:302](app-mobile/src/services/geocodingService.ts#L302) (`https://places.googleapis.com/v1/places:autocomplete`).
- Seper search: grep across entire repo returned only typos in third-party iOS headers; no Seper SDK / endpoint / config exists.

**Quoted snippet (CreatorStep3Where.tsx:5-12):**
```
 *   - in_person: venue name + address + map placeholder + privacy info
 *   - online: conferencing URL + privacy info
 *   - hybrid: BOTH in_person fields AND online URL
 *
 * Map preview is a solid striped placeholder. Real geocoding +
 * Google Places autocomplete land in B-cycle.
```

**Layer:** Code (business app) + Schema (Seper SDK absence).
**Confidence:** H.
**Implication:** Three options for the SPEC phase:
- (D-1a) Bring the consumer-app Google Places integration into mingla-business as a shared service. Lowest cost; one provider; reuses the API key we already pay for.
- (D-1b) Add Seper as a new integration. Requires SDK selection, API key, infra. No prior art.
- (D-1c) Ship the city column first via a different derivation (e.g., reverse-geocode `location_geo` at publish via the consumer-side Google integration called from an edge function), and defer wizard autocomplete to a follow-up ORCH. Decouples this ORCH from a wizard rework.

**Dependency call:** The operator's preferred path (D-1a) implies the wizard autocomplete becomes either (1) in-scope for this ORCH (expanding scope), or (2) a prerequisite ORCH that must land first. SPEC must pick.

**Operator decision (2026-05-13):** **Bundle into this ORCH.** Port the consumer-app Google Places integration (`app-mobile/src/services/geocodingService.ts:302` → `places.googleapis.com/v1/places:autocomplete`) into a shared module usable from `mingla-business`, wire it into `CreatorStep3Where.tsx`, extract `locality` from `addressComponents` at place-pick time, persist into the new `events.city` column at publish.

**Note on Serper:** Serper is integrated in the codebase via `supabase/functions/run-place-intelligence-trial/index.ts` against `google.serper.dev/reviews` for Google Maps reviews on the consumer place_pool (ORCH-0712). Serper does also offer `/places` and `/maps` endpoints which are not currently wired. For ORCH-0824, Google Places is preferred for the type-ahead UX; Serper remains a cost-optimization candidate for a future ORCH if event volume grows.

---

## Summary of decisions consolidated 2026-05-13 (all locked for SPEC phase)

| # | Decision | Source |
|---|----------|--------|
| 1 | Category field fully removed; backfilled where possible. | Operator (orchestrator confirmation) |
| 2 | Business event cards may use unique hero; not constrained to Ticketmaster card shape. | Operator clarification 2026-05-13 |
| 3 | Card tap opens the same in-app `ExpandedCardModal` that Ticketmaster cards open. | Operator clarification 2026-05-13 |
| 4 | Consumer "city" = current CityPickerSheet selection. | Operator answer Q1 |
| 5 | Event city = new `events.city` text column populated at publish from address autocomplete. | Operator answer Q3 |
| 6 | Merge = server-side fan-out edge function. | Operator answer Q4 |
| 7 | When Mingla-native filter (Party Type / Vibe) is active → suppress Ticketmaster entirely. | Operator answer Q6 |
| 8 | Match scope = same city as the consumer (city equality on the picker's selection). | Operator initial answer |
| 9 | Business events rank above Ticketmaster for the same query. | Operator initial intent |
| 10 | Google Places (already integrated in `app-mobile`) is the address-autocomplete provider; port into `mingla-business` as part of this ORCH. | Operator answer 2026-05-13 |

**Remaining SPEC-phase decisions (smaller, can be resolved by Spec author with operator review):**
- Buyer flow inside `ExpandedCardModal`: in-sheet WebView pointed at `https://<mingla-business-domain>/e/{brandSlug}/{eventSlug}`, OR reimplement the checkout natively in `app-mobile`.
- Schema strategy for Party Type / Vibe / Music Genre: top-level columns (`party_type text`, `vibe_tags text[]`, `music_genres text[]`) with btree + GIN indexes, OR JSONB-only.
- Required vs optional at publish for each of Party Type / Vibe / Music Genre.
- Concrete Mingla↔Ticketmaster Music Genre mapping table.
- Ranking detail: strict partition (all business, then all TM) vs business-priority interleave.



## Headline (read this first)

**The operator's premise is partially incorrect — and the gap is large.**

The operator described Party Type, Vibe Tags, and Music Genre as fields that "already exist further down the form" on the Create Experience wizard, with the intent to **promote** them to Step 1 and drop the Category section. The screenshots provided are from a **Figma file** (`figma.com` is visible in the browser chrome of the workspace screenshot), not the running app.

**Reality in the codebase:**

1. The Create Experience wizard has **only four fields on Step 1**: name, format, **category** (8 hard-coded placeholder strings: Nightlife/Brunch/Concert/Festival/Workshop/Pop-up/Private/Other — explicitly labeled `[TRANSITIONAL] TRANS-CYCLE-3-6` in code), description. There is **no** Party Type dropdown, **no** Vibe Tags grid, **no** Music Genre grid anywhere in the business app.
2. The `events` table has **no `category` column, no `party_type` column, no `vibe_tags` column, no `music_genres` column, and no `city` column.** The wizard's `category` value is buried inside `events.theme` JSONB as `theme->'business_event'->>'category'` — not queryable as a real column.
3. The consumer Discover screen is **Ticketmaster-only**, served by the `discover-cards` edge function chain. It has **no awareness of the business `events` table** today.

So the work is not "promote three existing fields and add three filter facets." It is:

- **Greenfield** schema for Party Type / Vibes / Music Genres on `events` (new columns + indexes + constraints, or a normalized lookup table)
- **Greenfield** UI on the business wizard for those three pill groups
- **Greenfield** integration on the consumer Discover service to merge business events with Ticketmaster results
- **Backfill** of the existing free-form `category` JSONB blob to the new taxonomy (if mapping exists) and a UI migration to drop the Category section

Confidence: **High** that the premise gap is real. Six-field evidence below.

---

## 1. Phase 0 — Ingestion Summary

| Source | One-line takeaway |
|---|---|
| `Mingla_Artifacts/PRIORITY_BOARD.md` | (read directly from disk in this session — no current item touches business→consumer surfacing) |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | Contains anon-tolerant buyer-route invariants and constitutional rules; no invariant currently scopes business-event surfacing on consumer Discover. |
| `Mingla_Artifacts/DECISION_LOG.md` | No prior decision on cross-app event surfacing — this is a fresh initiative. |
| `Mingla_Artifacts/INVESTIGATION_ORCH-0822_*`, `_ORCH-0823_*` | Unrelated (Twilio TFV and Event Wizard space/capslock glitch). |
| `feedback_anon_buyer_routes.md` (memory) | `/checkout/{eventId}`, `/e/{brandSlug}/{eventSlug}`, `/b/{brandSlug}` MUST remain outside `app/(tabs)/`, never call `useAuth`, never redirect to sign-in. The consumer's "tap a business event card → opens public event page" path must reuse this contract. |
| `feedback_verify_db_column_names_before_writing_queries.md` (memory) | "TS types are camelCased mobile mappings, NOT raw column names. Grep CREATE TABLE before writing any new `.select()`." Applied throughout this investigation. |

---

## 2. Layer A — Business app: wizard Step 1 + events schema

### A.1 — Wizard Step 1 contents (Finding A-1, 🔵 Observation)

**Claim:** Step 1 of the Create Experience wizard contains four fields: name, format, category (single-select via sheet), description. There is no Party Type, no Vibe Tags, no Music Genre.
**Evidence file/line:** [mingla-business/src/components/event/CreatorStep1Basics.tsx:50-59](mingla-business/src/components/event/CreatorStep1Basics.tsx#L50-L59) and [:119-211](mingla-business/src/components/event/CreatorStep1Basics.tsx#L119-L211).
**Quoted snippet:**
```ts
// [TRANSITIONAL] 8 placeholder categories — TRANS-CYCLE-3-6.
// Real categories taxonomy lands B-cycle when consumer-side filtering
// + admin-side categorization tooling come online together.
const CATEGORIES: readonly string[] = [
  "Nightlife", "Brunch", "Concert", "Festival",
  "Workshop", "Pop-up", "Private", "Other",
] as const;
```
**Layer:** Code.
**Confidence:** H.
**What would raise it:** Running the wizard in iOS simulator to visually confirm — but the source is unambiguous; sim repro is not necessary for a code audit per Phase 1 carve-out.

**Note:** The code comment explicitly states the real taxonomy is deferred to "B-cycle" coinciding with the exact work the operator is now requesting. The current code is already labeled transitional.

### A.2 — events table has no Party Type / Vibe / Genre / Category columns (Finding A-2, 🔴 Root Cause for the cross-app spine)

**Claim:** The `events` table — across the baseline migration and every subsequent migration — has **no** `category`, `party_type`, `vibe_tags`, `music_genres`, or `city` column. No `ALTER TABLE events ADD COLUMN` for any of these exists anywhere.
**Evidence file/line:** [supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:7792-7823](supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L7792-L7823). Verified by grepping every later migration for `ALTER TABLE.*events.*ADD COLUMN` — zero hits.
**Quoted snippet (final column list, baseline + only column additions across all migrations):**
```sql
CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" uuid, "brand_id" uuid, "created_by" uuid,
    "title" text, "description" text, "slug" text,
    "location_text" text, "location_geo" point, "online_url" text,
    "is_online" bool, "is_recurring" bool, "is_multi_date" bool,
    "recurrence_rules" jsonb,
    "cover_media_url" text, "cover_media_type" text, "theme" jsonb,
    "organiser_contact" jsonb, "visibility" text, "show_on_discover" bool,
    "show_in_swipeable_deck" bool, "status" text, "published_at" timestamptz,
    "timezone" text, "created_at"/"updated_at"/"deleted_at" timestamptz
    /* + ORCH-0769 currency columns + ORCH-0783 cover_media_* columns */
);
```
**Later additions found** (not Party/Vibe/Genre):
- `20260515000009_orch_0769_app_wide_currency.sql` → currency columns
- `20260515000018_orch_0783_event_cover_provider_metadata.sql` → cover_media_provider, _source_url, _credit, _credit_url, _alt, _cancelled_at
**Layer:** Schema.
**Confidence:** H.
**What would raise it:** Running `\d public.events` against production via Management API (planned but not executed in this session — schema is dispositive).

### A.3 — `draft.category` is silently buried in `events.theme` JSONB (Finding A-3, 🟡 Hidden Flaw)

**Claim:** The wizard's `draft.category` value is sent to the publish RPC inside the `business_draft` JSONB payload, which the RPC then writes into `events.theme->'business_event'` jsonb. There is **no top-level column** receiving it, and **no SELECT path** can filter on it efficiently.
**Evidence file/line:**
- Client mapping: [mingla-business/src/utils/serverDraftEventMapper.ts:243-251](mingla-business/src/utils/serverDraftEventMapper.ts#L243-L251) sets `category: draft.category` inside `BusinessDraftPayload`.
- Server destination: [supabase/migrations/20260525000000_orch_0792_publish_writes_event_dates.sql:311-340](supabase/migrations/20260525000000_orch_0792_publish_writes_event_dates.sql#L311-L340)
**Quoted snippet (RPC UPDATE):**
```sql
UPDATE public.events SET
  title = v_title, description = v_description, slug = v_final_slug,
  ...
  theme = (v_theme - 'business_draft') || jsonb_build_object(
    'business_event',
    (v_business_draft - 'tickets') || jsonb_build_object('currency', v_currency::text),
    ...
  ),
  status = 'scheduled', visibility = v_visibility, published_at = v_now, ...
WHERE id = p_event_id AND status = 'draft' AND deleted_at IS NULL;
```
The RPC writes the entire `v_business_draft` (sans `tickets`) into `theme.business_event`. `category` rides along, but no SET column captures it.
**Layer:** Schema vs Code contradiction (TS draft has the field; SQL never promotes it to a real column).
**Confidence:** H.
**What would raise it:** A SELECT against `events` confirming `theme->'business_event'->>'category'` is the persisted location (Management API probe — not executed; code path is unambiguous).

### A.4 — `events.location_text` is free-form; `events.location_geo` is a `point`; there is no `city` field (Finding A-4, 🔴 Root Cause for city-match scope)

**Claim:** Business events have no normalized city column. `location_text` is free user-typed text; `location_geo` is a PostGIS point (lat/lng). The operator's "match by city" requirement cannot be satisfied today without (a) introducing a `city` column + index, (b) deriving city from `location_geo` via reverse-geocoding, or (c) joining via `brands.city` if one exists (not verified in this scope).
**Evidence file/line:** [supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:7799-7800](supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L7799-L7800).
**Quoted snippet:** `"location_text" "text", "location_geo" "point",`
**Layer:** Schema.
**Confidence:** H.
**What would raise it:** Inspect `brands` table — if it carries a normalized city, a brand-side join could be cheaper than denormalizing onto events. (Not inspected in this scope; flagged for SPEC phase.)

### A.5 — Anon SELECT on `events` is already open for published rows (Finding A-5, 🔵 Observation)

**Claim:** The RLS posture already allows anonymous consumers to SELECT business events where `visibility='public' AND status IN ('scheduled','live') AND deleted_at IS NULL`. No new policy is needed for read access — only the consumer's query needs to be wired.
**Evidence file/line:** [supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:14450](supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L14450).
**Quoted snippet:**
```sql
CREATE POLICY "Public can read published events (anon or authenticated)"
ON "public"."events" FOR SELECT TO "authenticated", "anon"
USING (("deleted_at" IS NULL)
   AND ("visibility" = 'public'::"text")
   AND ("status" = ANY (ARRAY['scheduled'::"text", 'live'::"text"])));
```
Adjacent policies also expose `event_dates`, `ticket_types`, and `brands` (for brands with at least one public event) to anon — the buyer-flow stack is already public.
**Layer:** Schema (RLS).
**Confidence:** H.
**What would raise it:** Live anon `SELECT` from the consumer app against production confirming row visibility.

### A.6 — Public buyer route exists at `app/e/[brandSlug]/[eventSlug].tsx` (Finding A-6, 🔵 Observation)

**Claim:** The consumer-tap-to-detail route already exists and is anon-tolerant per the memory invariant.
**Evidence file/line:** `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` (confirmed by directory listing).
**Layer:** Code.
**Confidence:** H.
**Note:** The consumer app would deep-link out to this route on `mingla-business.app` (or similar) since the route lives in the business app, not in `app-mobile`. **This is a cross-app routing question** the SPEC must address (in-app webview? domain redirect? share-URL deep link?).

---

## 3. Layer B — Consumer app: Discover + Ticketmaster

### B.1 — Discover screen → service → edge function chain (Finding B-1)

**Claim:** The Discover feed is end-to-end Ticketmaster. The chain is: `DiscoverScreen` → `NightOutExperiencesService.searchEvents()` → `supabase.functions.invoke(...)` → Ticketmaster API (via `_shared/ticketmasterClassifications.ts`). There is no Supabase `events` table read on this path.
**Evidence file/line:**
- Screen: [app-mobile/src/components/DiscoverScreen.tsx:1-80](app-mobile/src/components/DiscoverScreen.tsx#L1-L80) (file head imports NightOutExperiencesService).
- Service: [app-mobile/src/services/nightOutExperiencesService.ts:80-160](app-mobile/src/services/nightOutExperiencesService.ts#L80-L160).
- Quoted snippet: `const { data, error } = await supabase.functions.invoke(...)` (line 148).
- Edge function chain: `_shared/ticketmasterClassifications.ts` resolves segment+genre slugs to TM IDs.
**Layer:** Code (full chain).
**Confidence:** H.

### B.2 — Filter facets today: date + segment + genre (Finding B-2)

**Claim:** The Discover filter UI exposes three facets — **date** (any/today/tomorrow/weekend/next-week/month), **segment** (music/sports/arts-theatre/film), **genre** (slug list, 40+ values, segment-scoped). Filter state is held in the screen's local React state (`selectedFilters`), not Zustand, not URL.
**Evidence file/line:**
- Types: [app-mobile/src/types/discoverFilters.ts:1-120](app-mobile/src/types/discoverFilters.ts#L1-L120).
- State shape: [app-mobile/src/components/DiscoverScreen.tsx:101-111](app-mobile/src/components/DiscoverScreen.tsx#L101-L111).
**Quoted snippet:**
```ts
type DateFilter = "any" | "today" | "tomorrow" | "weekend" | "next-week" | "month";
type GenreFilter = DiscoverGenreSlug;
type SegmentFilter = DiscoverSegmentSlug;
interface NightOutFilters { date: DateFilter; segment: SegmentFilter; genre: GenreFilter; }
```
**Layer:** Code.
**Confidence:** H.

### B.3 — Card normalization shape (Finding B-3)

**Claim:** The `NightOutVenue` interface defines the consumer card shape that the merged feed must conform to. Required fields: `id`, `eventName`, `artistName`, `venueName`, `image` (+ `images[]`), `priceMin/Max/Currency`, `price` (formatted), `date`, `time`, `localDate`, `dateTimeUTC`, `location` (free text), `address`, `coordinates` (lat/lng), `genre`, `subGenre`, `tags[]`, `ticketUrl`, `ticketStatus`, `distance` (null in city-mode), optional `seatMapUrl`.
**Evidence file/line:** [app-mobile/src/services/nightOutExperiencesService.ts:7-35](app-mobile/src/services/nightOutExperiencesService.ts#L7-L35).
**Layer:** Code.
**Confidence:** H.
**Note for SPEC:** Business events must be normalized to this shape (or this shape extended with optional fields) for "identical card" rendering per operator decision.

### B.4 — City-mode is already a first-class search dimension (Finding B-4, 🔵 Helpful coincidence)

**Claim:** `NightOutSearchInput` already accepts **`city`** (with optional `stateCode`, `countryCode`, and lat/lng fallback) as the primary search dimension, alongside the lat/lng `location` option ("EXACTLY ONE of city or location must be present"). The city picker UI exists in `app-mobile/src/components/discover/CityPickerSheet.tsx`. This means the consumer side already has the **city → query** plumbing; the work is to make the business-events query honor the same city.
**Evidence file/line:** [app-mobile/src/services/nightOutExperiencesService.ts:43-58](app-mobile/src/services/nightOutExperiencesService.ts#L43-L58).
**Quoted snippet:** `city?: { name: string; stateCode?: string | null; countryCode?: string | null; fallbackLat?: number; fallbackLng?: number; ... }`
**Layer:** Code.
**Confidence:** H.

### B.5 — Card tap behavior today: opens `ticketUrl` (Finding B-5, 🟠 Contributing Factor for routing)

**Claim:** Discover cards today launch the external Ticketmaster URL. The codebase has no in-app event detail screen for Discover-sourced events — the assumption is that the URL is the destination. Business events must route differently (to the public buyer flow in `mingla-business`).
**Evidence file/line:** [app-mobile/src/components/DiscoverScreen.tsx:96 (interface), :1020, :1164, :1203](app-mobile/src/components/DiscoverScreen.tsx#L1020).
**Layer:** Code.
**Confidence:** M.
**What would raise it:** Tracing the exact `onPress` handler on a Discover card to where `ticketUrl` is consumed (Linking.openURL? in-app browser?). The SPEC phase must answer this because the business-event card tap will diverge.

---

## 4. Layer C — The integration seam

### C.1 — Consumer city is GPS-derived, not stored as a normalized field (Finding C-1)

**Claim:** The consumer app uses `useUserLocation` → `enhancedLocationService.getCurrentLocation()` → returns `{lat, lng}`. The city name is derived on demand via `geocodingService` reverse-geocode. There is no persisted "user.city" field on profile rows that a query could JOIN against. Discover's existing city-mode is driven by user picking a city in `CityPickerSheet`, not by the user's home city.
**Evidence file/line:** [app-mobile/src/hooks/useUserLocation.ts:1-60](app-mobile/src/hooks/useUserLocation.ts#L1-L60); [app-mobile/src/services/preferencesService.ts:227-308](app-mobile/src/services/preferencesService.ts#L227-L308) (location_history only).
**Layer:** Code.
**Confidence:** H.
**Implication for SPEC:** "Same city as the consumer" is ambiguous between (a) user's current GPS-derived city, (b) the city the user has picked in the Discover city picker, (c) a profile-level "home city" that does not yet exist. SPEC must pick one.

### C.2 — Business event city is not normalized; only `location_text` (free) + `location_geo` (point) exist (Finding C-2, restatement of A-4 from the seam perspective)

**Claim:** A consumer-side "where city = X" query has no business-events column to filter against today. Three resolution paths (each with cost):
1. Add a `city` text column to `events` + index + populate at publish time.
2. Reverse-geocode `location_geo` on read (slow; rate-limited).
3. JOIN through `brands` if `brands` carries a city column (not verified in this scope).
**Evidence file/line:** Same as A-4.
**Layer:** Schema.
**Confidence:** H.

### C.3 — Merge / rank topology — both paths viable, neither prototyped (Finding C-3, 🟡 Hidden Flaw)

**Claim:** Two integration topologies are feasible. **Server-side fan-out:** a new edge function (or extension of an existing one) reads business events from Postgres, queries Ticketmaster, merges with business-first ordering, returns a single `NightOutSearchOutput`-shaped response. **Client-side merge:** the consumer issues two queries (existing `searchEvents` + a new `searchBusinessEvents`), and merges/ranks on device.
**Trade-offs (not decisions):**
- Server-side: single network round-trip, single cache key, server controls priority/ranking. Cost: new edge function, RLS-aware Postgres reads under service-role or anon JWT, slower iteration on ranking heuristics.
- Client-side: faster iteration on ranking, parallel network. Cost: two cache keys to manage, duplicate filter-shape mapping, mobile must hold both result sets in memory, pagination is harder.
**Evidence:** Both options compatible with existing service/hook patterns.
**Layer:** Architecture.
**Confidence:** H on feasibility; trade-off pick is for SPEC.

### C.4 — Filter parity gap: Party Type / Vibe have no Ticketmaster analog (Finding C-4, 🟠 Contributing Factor)

**Claim:** Ticketmaster's classification model is segment → genre → subgenre (Music/Sports/Arts-Theatre/Film). It has **no** concept of Party Type ("Rooftop Party", "House Party", "Boat Party") or Vibe ("Energetic", "Chill", "Wild"). The 16 Party Type values and 16 Vibe values from the Figma are Mingla-native taxonomies.
**Evidence file/line:** [app-mobile/src/types/discoverFilters.ts:23-78](app-mobile/src/types/discoverFilters.ts#L23-L78) — full TM taxonomy enumerated.
**Layer:** Schema (external API contract).
**Confidence:** H.
**Implication:** If the consumer applies "Party Type = Rooftop Party", Ticketmaster cannot satisfy that facet. Either (a) TM is silently filtered out of the result for that query (business events only), or (b) TM is queried with no Party Type constraint and returned regardless. SPEC must decide.

### C.5 — Music Genre overlap with TM is partial and named differently (Finding C-5)

**Claim:** The Figma's 13 Music Genres (Electronic/EDM, Hip-Hop/Rap, Pop, Rock, Latin, Afrobeats, R&B/Soul, Disco/Funk, Reggae/Dancehall, Indie, Country, Jazz, Classical, Mixed/Variety) **mostly** overlap with TM's existing `DiscoverGenreSlug` set, but **labels and slugs differ** (e.g., "Electronic/EDM" vs `dance-electronic`; "Hip-Hop/Rap" vs `hiphop-rap`; "Afrobeats" vs `afro`; "Disco/Funk" — no direct TM slug; "Indie" — no direct TM slug; "Mixed/Variety" — no TM slug).
**Evidence file/line:** [app-mobile/src/types/discoverFilters.ts:30-50](app-mobile/src/types/discoverFilters.ts#L30-L50) vs the Figma image text.
**Layer:** Schema (taxonomy alignment).
**Confidence:** H.
**Implication:** SPEC must produce a mapping table (Mingla Music Genre → TM `DiscoverGenreSlug`) and identify Mingla-only values that filter TM out entirely.

### C.6 — Backfill scope: unknown today (Finding C-6)

**Claim:** Production event count and `category` distribution were **not** queried via Management API in this session. The orchestrator can request a probe in SPEC phase. Expected order of magnitude is small (the product is pre-launch in mingla-business; recent close-notes reference ORCH-0807/0815-B Marketing Hub and Stripe Connect onboarding — not a live event marketplace).
**Evidence:** Inferred from recent closes; not directly measured.
**Layer:** Data.
**Confidence:** L on the actual number; H that the unknown should be measured before SPEC commits to a backfill strategy.

---

## 5. Contradictions detected

| # | Layer 1 | Layer 2 | Contradiction |
|---|---|---|---|
| **X-1** | Operator's intent ("Party Type/Vibes/Genre already on the form") | Code (`CreatorStep1Basics.tsx`) | The fields do not exist in the running app. The screenshots are a Figma mockup. |
| **X-2** | Client (`draft.category`, `BusinessDraftPayload.category`) | Schema (`events` has no `category` column) | `category` is silently buried in `events.theme` JSONB. Not queryable for filtering. |
| **X-3** | Operator's intent ("same filter, just add three facets") | API contract (Ticketmaster) | Party Type and Vibe have no TM analog. Music Genre overlaps partially with renaming. |
| **X-4** | Operator's intent ("match by city") | Schema (`events`) | No `city` column on events; only free-text `location_text` and `point` `location_geo`. |
| **X-5** | Operator's intent ("identical cards, business ranks higher") | Code (Discover cards tap → external `ticketUrl`) | Business cards must route to `app/e/{brandSlug}/{eventSlug}` (cross-app), not an external URL — different tap handler required. |

---

## 6. Root-state map

| Layer | Ticketmaster (today) | Business events (proposed) |
|---|---|---|
| **Source** | Ticketmaster Discovery API (external) | Supabase `public.events` (Postgres + RLS) |
| **Filter input** | Mingla slugs → TM IDs (server-resolved via `_shared/ticketmasterClassifications.ts`) | **TBD** — new columns or JSONB-backed (party_type / vibe_tags / music_genres) |
| **City** | TM accepts city string + state/country | **TBD** — no city column exists today |
| **Query layer** | `nightOutExperiencesService.searchEvents()` → `functions.invoke()` → edge fn | **TBD** — either same edge function fans out, or new client-side service |
| **Edge function** | (existing TM proxy) | **TBD** — new fan-out merge OR new direct-Postgres read endpoint |
| **Cache key** | React Query, key derived from `NightOutSearchInput` shape | **TBD** — same key (merged response) or sibling key (client-side merge) |
| **Card normalization** | TM → `NightOutVenue` | Business → `NightOutVenue` (mapping required, especially `genre`/`subGenre`, `priceMin/Max`, `ticketUrl`, `dateTimeUTC`) |
| **Render** | `DiscoverScreen` grid (`NightOutCardData`) | Same component, identical visual (operator decision) |
| **Tap** | `Linking.openURL(ticketUrl)` (per B-5, M confidence) | Open public buyer route `app/e/{brandSlug}/{eventSlug}` — **cross-app, must define mechanism** |
| **RLS** | N/A (external API) | Anon SELECT already allowed for `visibility=public AND status IN (scheduled,live)` (A-5) |

---

## 7. Constraint Inventory (what the SPEC must resolve)

**Schema:**
- C-S1: `events` has no `party_type`, `vibe_tags`, `music_genres`, `category`, or `city` column today.
- C-S2: `draft.category` payload is dropped into `theme` JSONB by the publish RPC; any new taxonomies must be either (a) promoted to top-level columns with indexes, or (b) accept the JSONB-only query performance penalty.
- C-S3: No GIN index on `theme` JSONB; ad-hoc `theme->'business_event'->'vibe_tags' ? 'energetic'` queries will be slow at scale.
- C-S4: `events.location_geo` is a `point` (no PostGIS GIST index found in baseline grep — flag for verification).

**RLS:**
- C-R1: Anon SELECT is open for published events — no policy change required for read-side. ✓
- C-R2: If a server-side merge edge function uses service-role to bypass RLS, the SPEC must document why and what fields are exposed.

**Routing:**
- C-RT1: Tap-to-detail on a business card crosses app boundaries (consumer `app-mobile` → public route in `mingla-business`). The mechanism (in-app webview / Linking to https URL / shared domain deep-link) must be chosen in SPEC.

**Filter UX:**
- C-F1: Party Type and Vibe have no Ticketmaster analog — the SPEC must define merge behavior when those facets are active (filter out TM? include TM unfiltered?).
- C-F2: Music Genre needs a Mingla↔TM mapping table for values present in both, plus a list of Mingla-only values that filter TM out.

**City matching:**
- C-CT1: "Consumer's city" needs a definition (GPS-derived now vs CityPicker selection vs profile.home_city). The latter does not exist yet.
- C-CT2: "Business event's city" needs a derivation source (new column + populate at publish time, OR `brands.city` JOIN if it exists, OR reverse-geocode on read).

**Wizard UI:**
- C-W1: Step 1 redesign: category removed, three new pill groups added (Party Type single-select, Vibe Tags multi-select, Music Genre multi-select). Step 1 length grows substantially; keyboard-blocking-input rule must be re-verified.
- C-W2: Validation: which of the three are required vs optional? Today, `category` is required (`draftEventValidation.ts:91`).

**Backfill:**
- C-B1: Production event count and current `category` value distribution unmeasured. SPEC should request a Management API probe before deciding on backfill strategy.
- C-B2: No mapping function exists today from the 8 placeholder categories (`Nightlife/Brunch/Concert/Festival/Workshop/Pop-up/Private/Other`) to the new 16 Party Types — mapping is non-trivial because semantics differ.

---

## 8. Adjacent issues discovered (register as separate ORCH candidates)

- **ORCH candidate: Wizard `category` value is silently buried.** Even before this ORCH lands, every published business event today carries a category that no SELECT path filters on. Either expose it or remove the field — current state is dead data. Severity: S3-low (no user-visible bug; just dead state). **Note:** This ORCH-0824 effectively resolves it by replacing the field.
- **ORCH candidate: No PostGIS index on `events.location_geo`.** Any future "near me" radius query on business events will table-scan. Severity: S2 (perf), pre-blocker for scale.
- **ORCH candidate: Discover filter state is screen-local, not persisted.** Backgrounding the app resets segment+genre+date selection. Severity: S3-low UX nit; tracked separately to keep ORCH-0824 scoped.
- **ORCH candidate: Discover card tap routing is undocumented in this report (B-5 at M confidence).** Worth a fast trace + clear contract regardless of business-events work.

---

## 9. Open questions for SPEC phase

1. **City semantics.** Match against (a) user's GPS-derived city, (b) the CityPicker selection, or (c) a new `profiles.home_city`? Operator preferred "same city as the consumer" — pick concrete source.
2. **Schema strategy.** Three top-level columns (`party_type text`, `vibe_tags text[]`, `music_genres text[]`) with GIN/btree indexes — OR — JSONB-only with GIN on `theme->'business_event'`? (Recommendation pending SPEC.)
3. **City storage on events.** New `events.city text` column + populate at publish via reverse-geocode of `location_geo`, OR JOIN through `brands.city`?
4. **Merge topology.** Server-side fan-out edge function (single response) OR client-side merge (two queries, two cache keys)?
5. **Tap routing.** Cross-app navigation mechanism: `Linking.openURL("https://mingla-business-domain/e/{brand}/{event}")` (web), OR in-app `WebView`, OR shared `mingla://` deep link?
6. **Filter degradation.** When Party Type or Vibe is active, do we (a) suppress TM entirely, (b) keep TM but unfiltered on those facets, (c) hide the facets when TM-only results would be returned?
7. **Music Genre mapping.** Concrete Mingla↔TM `DiscoverGenreSlug` map, plus the list of Mingla-only values.
8. **Backfill plan.** Once the new schema lands, what happens to existing `theme.business_event.category` values? (Operator answered "fully remove + backfill" — but the destination column must be chosen before backfill is defined.)
9. **Required vs optional.** Of the three new fields, which are required at publish time? Current `category` is required.
10. **Card normalization.** Business event → `NightOutVenue` mapper: where does `ticketUrl` resolve to (public event URL?), `genre`/`subGenre` (use Music Genre?), `tags[]` (use Vibe Tags?), `dateTimeUTC` (from `event_dates` master row)?
11. **Ranking priority detail.** "Business first" — is the rank strictly partitioned (all business, then all TM), or interleaved with business-priority tiebreak?
12. **Pagination.** How does the merged result paginate? TM has `page/size`; business events would need ORDER BY + LIMIT/OFFSET or keyset.
13. **Brand city assumption.** Verify whether `brands` carries a city column — affects C-CT2 decision.

---

## 10. Confidence summary

**Overall confidence in the investigation:** **High** for the schema, RLS, wizard structure, and Ticketmaster integration. **Medium** for the exact tap-routing handler in DiscoverScreen (B-5). **Low** for production data volume (C-6 — not measured).

**What's proven:**
- The wizard does not contain Party Type / Vibes / Music Genre today (A-1, H).
- The events table does not contain any of these columns today (A-2, H).
- `draft.category` is buried in `theme` JSONB (A-3, H).
- Anon SELECT on published events is open (A-5, H).
- Discover is Ticketmaster-only (B-1, H).
- City-mode is already a first-class search dimension (B-4, H).
- TM has no Party Type / Vibe analog (C-4, H).

**What's probable but not directly measured:**
- Production event volume is small (C-6, L→M with one Management API count probe).
- DiscoverScreen card tap routes to `Linking.openURL(ticketUrl)` (B-5, M; one more trace would prove).

**What's unproven:**
- The exact reverse-geocoding strategy for the city derivation.
- Whether `brands.city` exists (C-CT2 unresolved).

---

## Discoveries for orchestrator

- The screenshots provided by the operator are a Figma mockup, not the running app. Premise reframe required before SPEC.
- The Step 1 category field is already labeled `[TRANSITIONAL]` in code — replacing it aligns with prior intent.
- Three additional adjacent ORCHs registered in §8 — none are in-scope here but should be tracked.

NEXT HANDOFF — paste into Claude `mingla-orchestrator`:

ORCH-0824 investigation is complete and lives at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md`. The headline is a premise correction: the operator believed Party Type / Vibe Tags / Music Genre already exist as fields on the Create Experience wizard (those are Figma mockups, not running code), and that filtering them is just a Discover UI addition. In reality the wizard Step 1 has only name/format/category/description, the `events` table has no `party_type`/`vibe_tags`/`music_genres`/`category`/`city` columns (the current `draft.category` value is silently buried in `events.theme` JSONB and not queryable), and the consumer Discover screen is Ticketmaster-only with no Supabase-events read on its path — but anon SELECT on published events is already open and the consumer service already supports a `city` search dimension. Thirteen open questions for SPEC are captured (city semantics, schema strategy, merge topology, cross-app tap routing, filter-degradation behavior when TM has no analog for Party Type / Vibe, Mingla↔TM Music Genre mapping, backfill plan, etc.) plus four adjacent ORCH candidates registered. The orchestrator should review the report, decide whether to re-confirm scope with the operator given the premise reframe (recommended), and on operator approval dispatch Claude `mingla-forensics` (SPEC mode) — the SPEC must answer the 13 open questions before any implementation can begin. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
