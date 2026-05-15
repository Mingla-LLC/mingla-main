# SPEC — ORCH-0824 — Business events in consumer Discover + wizard Step 1 taxonomy + Step 3 Google Places autocomplete

**Author:** Claude `mingla-forensics` (SPEC mode)
**Date:** 2026-05-13
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Dispatch:** `Mingla_Artifacts/prompts/SPEC_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md` (prompts directory is gitignored per the documentation system — `PRIVATE_PROMPT_NOT_VERSIONED`)
**Investigation:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md`](../reports/INVESTIGATION_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md)

---

## Spec corrections appended 2026-05-13 (post-operator-review)

Operator reviewed the spec layman summary and issued two corrections.

### Correction A — Party Type is multi-select (not single-select)

Party Type behaves like Vibe Tags and Music Genres: a multi-select pill grid, user picks as many as apply. "Required at publish" means **at least one** Party Type, not exactly one.

**All references to `party_type text` (singular) and `partyType: string | null` in the body below are SUPERSEDED by `party_types text[]` and `partyTypes: string[]`.** Concretely:

| Section | Original | Corrected |
|---|---|---|
| §3.1.1 column | `party_type text` (nullable) | `party_types text[] NOT NULL DEFAULT '{}'` |
| §3.1.2 CHECK | `party_type IS NULL OR party_type = ANY (...)` | `party_types <@ ARRAY[<canonical 15 slugs>]` |
| §3.1.3 index | `idx_events_party_type_published` (btree, partial) | `idx_events_party_types_gin` GIN (`party_types`) `WHERE deleted_at IS NULL` |
| §3.1.4 RPC reads | `v_party_type := NULLIF(v_business_draft->>'partyType', '')` | `v_party_types := COALESCE((SELECT array_agg(value::text) FROM jsonb_array_elements_text(v_business_draft->'partyTypes')), ARRAY[]::text[])` |
| §3.1.4 RPC validation | `IF v_party_type IS NULL THEN RAISE 'party_type_required'` | `IF array_length(v_party_types, 1) IS NULL THEN RAISE 'party_types_required'` + `IF NOT (v_party_types <@ canonical_list) THEN RAISE 'party_types_not_canonical'` |
| §3.1.4 RPC write | `party_type = v_party_type` | `party_types = v_party_types` |
| §3.1.5 backfill | `SET party_type = CASE ... END` (scalar) | `SET party_types = CASE theme->'business_event'->>'category' WHEN 'Nightlife' THEN ARRAY['club-night'] WHEN 'Festival' THEN ARRAY['festival'] WHEN 'Private' THEN ARRAY['house-party'] ELSE ARRAY[]::text[] END WHERE coalesce(array_length(party_types,1),0) = 0 AND theme->'business_event'->>'category' IS NOT NULL` |
| §3.2.2 request schema | `partyTypeSlug?: string` (single) | `partyTypeSlugs?: string[]` (array) |
| §3.2.3 BusinessEventCard | `partyType: string` | `partyTypes: string[]` |
| §3.2.4 TM suppression gate | `partyTypeSlug == null` | `(partyTypeSlugs == null \|\| partyTypeSlugs.length === 0)` |
| §3.2.4 SQL filter | `e.party_type = $partyTypeSlug` | `e.party_types && $partyTypeSlugs` (array overlap) |
| §3.5.2 wizard UI | "single-select sheet picker" for Party Type | **Multi-select pill grid**, identical pattern to Vibe Tags — 3-4 column responsive layout, tap toggles selection, no sheet |
| §3.5.3 DraftEvent | `partyType: string \| null` | `partyTypes: string[]` (default `[]`) |
| §3.5.4 validation | `if (d.partyType === null) → error "Pick a party type."` | `if (d.partyTypes.length === 0) → error "Pick at least one party type."` + canonical-subset check via `!d.partyTypes.every(s => PARTY_TYPE_SLUGS.includes(s))` |
| §3.5.5 mapper | `partyType: draft.partyType` | `partyTypes: draft.partyTypes` |
| §3.7.1 filter state | `partyType: string \| null` | `partyTypes: string[]` (default `[]`) |
| §3.7.2 filter UI | "single-select pill row" for Party Type | **Multi-select pill grid**, same pattern as Vibes filter |
| §3.7.3 query key | `partyType` | `partyTypes` |
| §3.8.2 expanded sheet | "Party Type chip" (singular) | "Party Type chips" (plural — one chip per selected slug) |
| §6.2 invariant | `I-PROPOSED-EVENT-TAXONOMY-CANONICAL` text covers it; no new invariant needed | Update I-PROPOSED-EVENT-CITY-CANONICAL sibling to "every published event must have `array_length(party_types, 1) >= 1`" |

The 22-step implementation order in §8 is unchanged in count; only the file contents change per the table above. The 28-row test matrix in §5 updates as follows:
- **T-02 (filter suppression: party type):** `partyTypeSlugs=['rooftop-party']` → items: business-only.
- **T-07 (wizard publish happy):** form picks BOTH "Rooftop Party" AND "Themed Party" → row has `party_types = ['rooftop-party', 'themed-party']`.
- **T-08 (wizard validation: missing PT):** form with zero Party Types selected → validation error on Step 1.
- **T-17 (publish RPC: missing partyTypes):** payload with `partyTypes: []` → raise `party_types_required`.
- **T-19 (publish RPC: invented slug):** payload with `partyTypes: ['invented-slug']` → raise `party_types_not_canonical`.
- **T-22 / T-23 (pagination):** unchanged.
- Add **T-29:** filter with two Party Types selected → returns events that match EITHER (array overlap semantics) → confirms `&&` semantics chosen.

### Correction B — Operator confirms in-sheet WebView is the chosen buyer-flow mechanism

Operator confirmed (after seeing the three options A/B/C) that the in-sheet WebView path **already specified in §3.8.2 as SPEC-1** matches intent. The phrasing in the spec ("in-sheet WebView via `InAppBrowserModal`") is correct: the user never leaves `app-mobile`, the WebView is a React Native `<Modal>` containing a `<WebView>` component over the expanded sheet, and there is no `Linking.openURL` to Safari or any external browser.

A future ORCH-0824-B may carve out a fully native checkout (Stripe `@stripe/stripe-react-native` PaymentSheet ported into `app-mobile`, new PaymentIntent edge function, native ticket selector + buyer form) — but explicitly OUT OF SCOPE for ORCH-0824 to keep ship velocity.

### Implementor note

When implementing, read the corrections table above FIRST, then read the body. Wherever there is a conflict, the corrections table wins. The body has been left intact for full context and rationale, but the resolved spec is body-modified-by-corrections.

---

## 1. Inputs ingested

| File | Read | Key takeaway |
|---|---|---|
| Investigation report (above) | Full | 10 locked operator decisions; events schema lacks taxonomy spine + city; Discover is TM-only; anon SELECT on published events already open. |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | Skimmed for relevant invariants | Anon-buyer routes, RLS posture, query-key discipline, currency-aware UI apply. |
| `Mingla_Artifacts/DECISION_LOG.md` | Searched for prior discover/event decisions | No prior decision conflicts. |
| `mingla-business/src/components/event/CreatorStep1Basics.tsx` | Full | 4-field Step 1 (name/format/category sheet 8 placeholders/description). Category is `[TRANSITIONAL]`. |
| `mingla-business/src/components/event/CreatorStep3Where.tsx` | Full | Plain `<Input>` for address; comment says "Real geocoding + Google Places autocomplete land in B-cycle". |
| `mingla-business/src/store/draftEventStore.ts` (lines 210-340) | Schema region | `DraftEvent` has `category: string \| null`; no `partyType`/`vibeTags`/`musicGenres`/`city`/`locationGeo` fields today. |
| `mingla-business/src/utils/serverDraftEventMapper.ts` (lines 240-260, 405-420) | Mapping path | `BusinessDraftPayload.category = draft.category`; SQL publish RPC drops it into `events.theme.business_event` JSONB. |
| `mingla-business/src/utils/draftEventValidation.ts` (lines 80-100) | Validation | `if (d.category === null) → error "Pick a category"` on Step 1. |
| `supabase/migrations/20260525000000_orch_0792_publish_writes_event_dates.sql` (lines 311-340) | Publish RPC | `UPDATE events SET theme = (v_theme - 'business_draft') \|\| jsonb_build_object('business_event', ...)`. No category column write. |
| `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` (lines 7792-7823, 14450) | Events table + anon RLS | Final column list confirmed; anon SELECT policy exists for `visibility=public AND status IN (scheduled,live)`. |
| `app-mobile/src/services/nightOutExperiencesService.ts` (lines 1-160) | TM service contract | `NightOutSearchInput` accepts `city {name, stateCode, countryCode, fallbackLat, fallbackLng}` or `location {lat,lng}`; output `{events: NightOutVenue[], meta}`. |
| `app-mobile/src/services/geocodingService.ts` (lines 282-360) | Google Places autocomplete | Direct client fetch to `places.googleapis.com/v1/places:autocomplete` using `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`. Returns `{displayName, fullAddress, placeId}` per suggestion. Place-details (for structured city) is NOT called today — must be added. |
| `app-mobile/src/types/expandedCardTypes.ts` (lines 1-80, 244+) | ExpandedCardData shape | Place-centric (rating, reviewCount, distance, travelTime, openingHours, strollData, picnicData). Already imports `EventDetailLayout` per `ExpandedCardModal.tsx:51`, so a TM-event render branch exists. Business event needs a sibling render branch via discriminator. |
| `app-mobile/src/components/DiscoverScreen.tsx` (lines 1-110, filter region) | Filter state | Local `selectedFilters: { date, segment, genre }`. Card tap currently routes via `ExpandedCardModal`. |
| `app-mobile/src/types/discoverFilters.ts` | Full | `DiscoverGenreSlug` enum (15 TM music genres + sports + arts + film). Lockstep rule with server mapping. |
| `supabase/functions/_shared/ticketmasterClassifications.ts` (referenced) | Not directly read; investigation cited. | Server resolves slugs → TM IDs. |

---

## 2. Scope, non-goals, assumptions

### Scope

- **DB:** Add `events.city`, `events.party_type`, `events.vibe_tags`, `events.music_genres`. Indexes. Backfill from `theme.business_event` JSONB. Update publish RPC. Add canonical-value CHECK constraints. No new RLS policy.
- **Edge functions:** New `discover-merged-events` edge function (server-side fan-out: reads business events via service-role + JWT-pinned RLS, calls existing TM proxy internally, merges with business-first ranking, returns discriminated-union response). Update `_shared/ticketmasterClassifications.ts` with the Mingla-Music-Genre mapping.
- **Service layer (app-mobile):** Replace `nightOutExperiencesService.searchEvents()` call site so Discover always calls the merged endpoint. Add `MergedDiscoverItem` discriminated union type.
- **Hook layer:** No new hook; reuse existing React Query usage in `DiscoverScreen.tsx` with extended query key (adds `partyType`, `vibeTags`, `musicGenres`).
- **Component layer (consumer Discover):** Add 3 new filter facets (Party Type single, Vibe Tags multi, Music Genres multi) to existing filter sheet. Render business-event cards with a unique hero treatment (brand cover image; "On Mingla" pill is allowed but not a Ticketmaster-style badge — operator may iterate visual). Tap routes through existing `ExpandedCardModal` with new `kind: 'business_event'` discriminator.
- **ExpandedCardModal:** Add a new render branch keyed on `kind === 'business_event'`. Branch renders title, brand chip, party-type chip, vibes chips, genre chips, hero image, date/time, venue (or "Hidden until purchase" per `hideAddressUntilTicket`), description, and a primary "Get Tickets" CTA that opens an in-sheet WebView pointed at the existing public buyer route. ExistingTicketmaster + place-card branches unchanged.
- **Wizard Step 1:** Remove Category section + sheet + validation. Add three new pill groups (Party Type single-select sheet, Vibe Tags multi-select grid, Music Genres multi-select grid). Update `DraftEvent`, validation, mapper.
- **Wizard Step 3:** Replace plain address Input with Google-Places-autocomplete-enabled input. New shared module `mingla-business/src/services/googlePlacesService.ts`. On suggestion pick: fetch Place Details (FieldMask `addressComponents,location`), extract `locality` → `draft.city`, `location` → `draft.locationGeo` (new field), formatted text → `draft.address`.
- **Canonical taxonomy constants:** New module per app: `mingla-business/src/constants/eventTaxonomy.ts` + `app-mobile/src/constants/eventTaxonomy.ts` + `supabase/functions/_shared/eventTaxonomy.ts`. Identical contents (no monorepo shared-package plumbing in this ORCH). CI strict-grep gate enforces parity.
- **Backfill:** One-shot SQL backfill from `theme->'business_event'->>'category'` into the new `party_type` column using the mapping table in §3.1.5.

### Non-goals

- **No Seper integration.** Out of scope; Google Places only.
- **No Discover filter visual redesign.** Three facets are appended to the existing filter UI.
- **No change to the Ticketmaster card render or tap path.** Only the business-event branch is new.
- **No native reimplementation of buyer checkout in `app-mobile`.** Buyer flow remains in `mingla-business` and is surfaced via in-sheet WebView (SPEC-1 decision below).
- **No new RLS policies on `events`.** The existing "Public can read published events" policy already satisfies anon read.
- **No `events.category` DROP COLUMN.** Column never existed; the legacy value lives in `theme.business_event.category` JSONB and is left in place as audit-trail. Code paths writing it are removed.
- **No CityPicker change.** Consumer city = existing `CityPickerSheet` selection; no new UI.
- **No `profiles.home_city` field.** Explicitly rejected per Q1 answer.
- **No removal of the wizard map placeholder.** Out of scope; lives in Step 3.

### Assumptions

- The Ticketmaster-proxy edge function the consumer currently calls is invokable from another edge function (server-to-server) using the same request shape. To be verified at implementation start; if it's not, the merged edge function fans out via direct HTTP to TM (using `TM_API_KEY` from env) instead.
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` is already provisioned for `mingla-business` builds (same key used by `app-mobile`). If not, operator provisions before implementation. If quota separation is required, a new restricted key is provisioned (out of SPEC scope; operator decision at implementation start).
- Canonical taxonomy list per the operator's Figma (counted from screenshots): 15 Party Types, 16 Vibe Tags, 14 Music Genres. The operator's prior comment said "16/16/13" — the discrepancy is resolved by adopting the actual Figma values listed in §3.6; operator should confirm before implementation merges.

---

## 3. Per-layer specification

### 3.1 Database

#### 3.1.1 New columns on `public.events`

```
ALTER TABLE public.events
  ADD COLUMN city           text,
  ADD COLUMN party_type     text,
  ADD COLUMN vibe_tags      text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN music_genres   text[]  NOT NULL DEFAULT '{}';
```

Nullability:
- `city` — NULL allowed for legacy rows; new published rows MUST be non-null (enforced in publish RPC, not via NOT NULL on column).
- `party_type` — NULL allowed for legacy rows; new published rows MUST be non-null.
- `vibe_tags`, `music_genres` — NOT NULL DEFAULT `'{}'` (empty array represents "no tags").

#### 3.1.2 CHECK constraints

Use a partial constraint approach for forward-compatibility (taxonomy may grow):

```
ALTER TABLE public.events
  ADD CONSTRAINT events_party_type_canonical
    CHECK (party_type IS NULL OR party_type = ANY (ARRAY[<canonical 15 slugs from §3.6>])),
  ADD CONSTRAINT events_vibe_tags_canonical
    CHECK (vibe_tags <@ ARRAY[<canonical 16 vibe slugs from §3.6>]),
  ADD CONSTRAINT events_music_genres_canonical
    CHECK (music_genres <@ ARRAY[<canonical 14 genre slugs from §3.6>]);
```

The implementor must expand `<canonical ... slugs>` with the exact slug strings from §3.6. CI strict-grep gate (§7.3) verifies that the canonical lists in code and SQL match.

#### 3.1.3 Indexes

```
CREATE INDEX idx_events_city_published
  ON public.events (city)
  WHERE deleted_at IS NULL
    AND visibility = 'public'
    AND status IN ('scheduled','live');

CREATE INDEX idx_events_party_type_published
  ON public.events (party_type)
  WHERE deleted_at IS NULL
    AND visibility = 'public'
    AND status IN ('scheduled','live');

CREATE INDEX idx_events_vibe_tags_gin
  ON public.events USING gin (vibe_tags)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_events_music_genres_gin
  ON public.events USING gin (music_genres)
  WHERE deleted_at IS NULL;
```

Partial indexes scoped to publishable rows keep index size small and match the Discover query shape exactly.

#### 3.1.4 Publish RPC update

Modify `public.business_publish_event_draft` (latest definition at `supabase/migrations/20260525000000_orch_0792_publish_writes_event_dates.sql:42-...`) to:

1. **Read new fields** from `v_business_draft`:
   - `v_party_type := NULLIF(v_business_draft->>'partyType', '')`
   - `v_vibe_tags := COALESCE((SELECT array_agg(value::text) FROM jsonb_array_elements_text(v_business_draft->'vibeTags')), ARRAY[]::text[])`
   - `v_music_genres := COALESCE((SELECT array_agg(value::text) FROM jsonb_array_elements_text(v_business_draft->'musicGenres')), ARRAY[]::text[])`
   - `v_city := NULLIF(v_business_draft->>'city', '')`
2. **Validate at publish:**
   - `IF v_party_type IS NULL THEN RAISE EXCEPTION 'party_type_required'`
   - `IF v_city IS NULL THEN RAISE EXCEPTION 'city_required'`
   - `IF v_party_type != ALL (canonical_list) THEN RAISE EXCEPTION 'party_type_not_canonical'` (and same for arrays via `<@` check)
3. **Write to columns** in the `UPDATE public.events SET ...` block:
   - `city = v_city, party_type = v_party_type, vibe_tags = v_vibe_tags, music_genres = v_music_genres,`
4. **Stop writing `category`** into `theme.business_event`. The JSONB payload for `theme` is rebuilt; remove `category` from `business_draft` before merging by adding `- 'category'` to the existing `(v_business_draft - 'tickets')` expression:
   - Change to `(v_business_draft - 'tickets' - 'category' - 'partyType' - 'vibeTags' - 'musicGenres' - 'city')` so the JSONB only carries forward unmapped fields.

#### 3.1.5 Backfill migration

One-shot UPDATE, run after column adds + before strict-grep CI gate flips on:

```
UPDATE public.events
SET party_type = CASE theme->'business_event'->>'category'
  WHEN 'Nightlife'  THEN 'club-night'
  WHEN 'Concert'    THEN NULL    -- ambiguous; honest null
  WHEN 'Festival'   THEN 'festival'
  WHEN 'Brunch'     THEN NULL    -- no party-type analog
  WHEN 'Workshop'   THEN NULL
  WHEN 'Pop-up'     THEN NULL
  WHEN 'Private'    THEN 'house-party'  -- best-effort
  WHEN 'Other'      THEN NULL
  ELSE NULL
END
WHERE party_type IS NULL
  AND theme->'business_event'->>'category' IS NOT NULL;
```

City backfill is **not** attempted for legacy rows (no reliable derivation from free-text `location_text`). Legacy rows remain `city = NULL` and will not appear in Discover until the brand edits + republishes the event.

#### 3.1.6 RLS

No new policy required. The existing `"Public can read published events (anon or authenticated)"` policy at baseline line 14450 covers anon SELECT on `visibility='public' AND status IN ('scheduled','live')`. The merged edge function (§3.2) reads via **service-role** for efficiency (no per-request RLS overhead) and re-applies the public-visibility filter in the WHERE clause as defense-in-depth.

### 3.2 Edge function — `discover-merged-events`

#### 3.2.1 Function metadata

- **Path:** `supabase/functions/discover-merged-events/index.ts`
- **Method:** POST
- **Auth:** Public (anon-callable). `verify_jwt: false` in `supabase/config.toml`.
- **Internal Postgres access:** `SERVICE_ROLE_KEY` for the Supabase client. Query MUST include the public-visibility filter explicitly (defense-in-depth even though service-role bypasses RLS).

#### 3.2.2 Request schema (TypeScript)

```ts
interface DiscoverMergedRequest {
  // City scope (REQUIRED — at least one of these)
  city: {
    name: string;          // e.g. "London"
    stateCode?: string;
    countryCode?: string;
    // For TM fallback path (preserved from existing service contract)
    fallbackLat?: number;
    fallbackLng?: number;
    fallbackRadiusKm?: number;
  };

  // Existing TM facets
  segmentSlug?: DiscoverSegmentSlug;
  genreSlugs?: DiscoverGenreSlug[];
  localStartEndDateTime?: string;
  keywords?: string[];
  sort?: string;
  page?: number;
  size?: number;

  // NEW Mingla-native facets
  partyTypeSlug?: string;       // Single-select; canonical from §3.6
  vibeTagSlugs?: string[];      // Multi-select; canonical
  musicGenreSlugs?: string[];   // Mingla genre slugs; canonical from §3.6
}
```

#### 3.2.3 Response schema (discriminated union)

```ts
type MergedDiscoverItem =
  | { source: 'business_event'; item: BusinessEventCard }
  | { source: 'ticketmaster';   item: NightOutVenue };

interface DiscoverMergedResponse {
  items: MergedDiscoverItem[];
  meta: {
    businessCount: number;
    ticketmasterCount: number;
    tmCalled: boolean;            // false when Party Type or Vibe filter active
    page: number;
    pageSize: number;
    fromCache: boolean;
  };
}

interface BusinessEventCard {
  // Identity
  eventId: string;          // events.id
  brandId: string;
  brandSlug: string;
  eventSlug: string;
  // Display
  title: string;
  description: string;
  coverMediaUrl: string | null;
  coverMediaType: 'image' | 'video' | 'gif' | null;
  coverHue: number;
  // Date / venue
  masterDateUtc: string;        // ISO from event_dates master row
  doorsOpenLocal: string | null;
  endsAtLocal: string | null;
  timezone: string;
  venueName: string | null;
  city: string;
  address: string | null;       // null when hideAddressUntilTicket=true
  hideAddressUntilTicket: boolean;
  locationGeo: { lat: number; lng: number } | null;
  // Taxonomy
  partyType: string;            // slug
  vibeTags: string[];           // slugs
  musicGenres: string[];        // slugs
  // Pricing (lowest priced active ticket type)
  priceMin: number | null;
  priceMax: number | null;
  currency: string;             // ISO 4217
  // CTA target
  publicBuyerUrl: string;       // https://<biz-domain>/e/{brandSlug}/{eventSlug}
}
```

#### 3.2.4 Server logic

```
1. Validate request: city.name non-empty; page/size within bounds (default page=1, size=20, max size=50).
2. Determine TM call gate:
     tmCalled = (partyTypeSlug == null && (vibeTagSlugs == null || vibeTagSlugs.length === 0))
3. Query business events:
   SELECT e.*, edm.start_at as masterDateUtc, /* ticket aggregates */
   FROM events e
   JOIN events_with_master_date_view ewmdv ON ewmdv.id = e.id
   /* OR join event_dates WHERE is_master */
   WHERE e.deleted_at IS NULL
     AND e.visibility = 'public'
     AND e.status IN ('scheduled','live')
     AND e.city = $city.name
     AND ($partyTypeSlug IS NULL OR e.party_type = $partyTypeSlug)
     AND ($vibeTagSlugs IS NULL OR e.vibe_tags && $vibeTagSlugs)
     AND ($musicGenreSlugs IS NULL OR e.music_genres && $musicGenreSlugs)
     AND ($localStartEndDateTime IS NULL OR ewmdv.start_at <@ $window)
   ORDER BY ewmdv.start_at ASC
   LIMIT $size OFFSET ($page-1)*$size;
4. If tmCalled:
   - Call existing TM proxy (server-to-server invoke OR direct fetch to TM API) with the
     resolved segment/genre/date/keywords payload.
   - Map TM-Music-Genre Mingla slugs → TM `DiscoverGenreSlug` via mapping table in §3.4.
     If musicGenreSlugs contains any "no TM analog" slug AND no TM-mappable slug,
     skip TM (treat as Mingla-only filter).
5. Merge:
   - items = [...businessItems.map(b => ({source:'business_event', item: b})), ...tmItems.map(t => ({source:'ticketmaster', item: t}))]
   - Strict partition: all business first, then TM. Within business: ORDER BY masterDateUtc ASC. TM keeps its own sort.
6. Pagination model: simple count-based — first `size` items from the merged list. Page-2+ requests TM separately with adjusted offset only after business events are exhausted. (Implementor note: keyset pagination is an optimization for ORCH-0824-B if scale demands.)
7. Return DiscoverMergedResponse.
```

#### 3.2.5 Error contract

- `400` — missing/invalid `city.name`; non-canonical slug.
- `502` — TM upstream error; respond with business-only results + `meta.tmCalled=true, tmError: '...'` (do NOT 502 the whole call; honor business results).
- `500` — DB error; respond `500` (no partial). Never fabricate empty success.

### 3.3 Service layer (`app-mobile`)

#### 3.3.1 `nightOutExperiencesService.ts` — repoint to merged endpoint

- Replace `supabase.functions.invoke('<tm-proxy-name>', ...)` with `supabase.functions.invoke('discover-merged-events', { body: { ...mappedRequest } })`.
- Map the existing `NightOutSearchInput` fields 1:1; add the three new facets at the same level.
- Update the return type from `NightOutSearchOutput` → `DiscoverMergedResponse`.
- Keep the function exported under the same name so `DiscoverScreen.tsx` only needs minor changes; remove or deprecate any TM-only methods that bypass the merge.

#### 3.3.2 New types module

- File: `app-mobile/src/types/mergedDiscover.ts`
- Exports: `MergedDiscoverItem`, `BusinessEventCard`, `DiscoverMergedResponse`, plus a re-export of `NightOutVenue` for convenience.

### 3.4 `_shared/eventTaxonomy.ts` + Mingla↔TM mapping

Three triplicated modules (mingla-business / app-mobile / supabase functions `_shared`), all identical:

#### 3.4.1 Canonical exports

```ts
export const PARTY_TYPES = [
  { slug: 'birthday-party',    label: 'Birthday Party' },
  { slug: 'rooftop-party',     label: 'Rooftop Party' },
  { slug: 'club-night',        label: 'Club Night' },
  { slug: 'house-party',       label: 'House Party' },
  { slug: 'warehouse-party',   label: 'Warehouse Party' },
  { slug: 'beach-party',       label: 'Beach Party' },
  { slug: 'pool-party',        label: 'Pool Party' },
  { slug: 'boat-party',        label: 'Boat Party' },
  { slug: 'themed-party',      label: 'Themed Party' },
  { slug: 'corporate-event',   label: 'Corporate Event' },
  { slug: 'graduation-party',  label: 'Graduation Party' },
  { slug: 'holiday-party',     label: 'Holiday Party' },
  { slug: 'networking-event',  label: 'Networking Event' },
  { slug: 'rave',              label: 'Rave' },
  { slug: 'festival',          label: 'Festival' },
] as const;

export const VIBE_TAGS = [
  { slug: 'energetic',  label: 'Energetic',  emoji: '⚡' },
  { slug: 'chill',      label: 'Chill',      emoji: '😌' },
  { slug: 'intimate',   label: 'Intimate',   emoji: '🕯' },
  { slug: 'wild',       label: 'Wild',       emoji: '🎉' },
  { slug: 'classy',     label: 'Classy',     emoji: '🥂' },
  { slug: 'casual',     label: 'Casual',     emoji: '👕' },
  { slug: 'upscale',    label: 'Upscale',    emoji: '💎' },
  { slug: 'underground',label: 'Underground',emoji: '🔒' },
  { slug: 'mainstream', label: 'Mainstream', emoji: '🌟' },
  { slug: 'artsy',      label: 'Artsy',      emoji: '🎨' },
  { slug: 'social',     label: 'Social',     emoji: '🤝' },
  { slug: 'exclusive',  label: 'Exclusive',  emoji: '👑' },
  { slug: 'laid-back',  label: 'Laid-back',  emoji: '🌴' },
  { slug: 'vibrant',    label: 'Vibrant',    emoji: '🌈' },
  { slug: 'retro',      label: 'Retro',      emoji: '📻' },
  { slug: 'futuristic', label: 'Futuristic', emoji: '🚀' },
] as const;

export const MUSIC_GENRES = [
  { slug: 'electronic-edm',   label: 'Electronic/EDM',    tmSlug: 'dance-electronic' },
  { slug: 'hiphop-rap',       label: 'Hip-Hop/Rap',       tmSlug: 'hiphop-rap' },
  { slug: 'pop',              label: 'Pop',               tmSlug: 'pop' },
  { slug: 'rock',             label: 'Rock',              tmSlug: 'rock' },
  { slug: 'latin',            label: 'Latin',             tmSlug: 'latin' },
  { slug: 'afrobeats',        label: 'Afrobeats',         tmSlug: 'afro' },
  { slug: 'rnb-soul',         label: 'R&B/Soul',          tmSlug: 'rnb' },
  { slug: 'disco-funk',       label: 'Disco/Funk',        tmSlug: null },        // no TM analog
  { slug: 'reggae-dancehall', label: 'Reggae/Dancehall',  tmSlug: 'reggae' },
  { slug: 'indie',            label: 'Indie',             tmSlug: 'alternative' }, // closest
  { slug: 'country',          label: 'Country',           tmSlug: 'country' },
  { slug: 'jazz',             label: 'Jazz',              tmSlug: 'jazz' },
  { slug: 'classical',        label: 'Classical',         tmSlug: 'classical' },
  { slug: 'mixed-variety',    label: 'Mixed/Variety',     tmSlug: null },        // no TM analog
] as const;

export const PARTY_TYPE_SLUGS = PARTY_TYPES.map(p => p.slug);
export const VIBE_TAG_SLUGS   = VIBE_TAGS.map(v => v.slug);
export const MUSIC_GENRE_SLUGS = MUSIC_GENRES.map(g => g.slug);
```

#### 3.4.2 Helpers

```ts
export function mapMinglaMusicGenresToTmSlugs(minglaSlugs: string[]): {
  tmMappable: DiscoverGenreSlug[];
  minglaOnly: string[];   // values with tmSlug === null
} { /* ... */ }
```

Used by the edge function to decide TM-call eligibility and resolve TM IDs.

### 3.5 Wizard Step 1 — `CreatorStep1Basics.tsx`

#### 3.5.1 Remove

- Delete `CATEGORIES` constant.
- Delete the Category section (lines 152-180 in current file).
- Delete the Category sheet (lines 213-250).
- Delete `categorySheetVisible` state and related handlers.

#### 3.5.2 Add

Render order on Step 1 after Description (per operator Figma): Name → Format → Party Type → Vibe Tags → Music Genre → Description.

- **Party Type field:** Same pattern as the old Category — pressable picker row + Sheet with all 15 Party Types as selectable rows. Required. Error message `"Pick a party type."`.
- **Vibe Tags grid:** 4-column responsive grid (collapses to 2 on narrow widths) of toggle pills rendering each `VIBE_TAGS[].label` with `emoji`. Multi-select via array `draft.vibeTags`. Optional. Helper text: `"Vibe Tags (Select all that apply)"`.
- **Music Genres grid:** 2-column grid of toggle pills rendering each `MUSIC_GENRES[].label`. Multi-select via array `draft.musicGenres`. Optional. Helper text: `"Music Genre (Select all that will be played)"`.

Apply the operator-feedback memory `feedback_keyboard_never_blocks_input.md` (Claude memory; not versioned in this repo) — Step 1 grows substantially; ensure the Description field's `onFocus={scrollToBottom}` still lands flush above the keyboard. Implementor verifies on iOS sim.

#### 3.5.3 DraftEvent schema changes

In `mingla-business/src/store/draftEventStore.ts`:

- **Remove:** `category: string | null;`
- **Add:**
  - `partyType: string | null;`
  - `vibeTags: string[];`
  - `musicGenres: string[];`
  - `city: string | null;`         (new — Step 3 derived)
  - `locationGeo: { lat: number; lng: number } | null;`  (new — Step 3 derived)
- Update `createInitialDraft()` defaults to `partyType: null, vibeTags: [], musicGenres: [], city: null, locationGeo: null`.

#### 3.5.4 Validation changes

In `mingla-business/src/utils/draftEventValidation.ts`:

- Replace the `if (d.category === null) ...` block with:
  - `if (d.partyType === null) → error { fieldKey: 'partyType', step: 0, message: 'Pick a party type.' }`
  - `if (!PARTY_TYPE_SLUGS.includes(d.partyType)) → error { fieldKey: 'partyType', step: 0, message: 'Pick a valid party type.' }` (defensive against stale persisted drafts).
- Vibes and Genres validators: no required check; ONLY enforce that any provided values are canonical (catch persistence corruption).
- In Step 3 validators: add `if (d.city === null) → error { fieldKey: 'address', step: 2, message: 'Pick the venue address from the suggestions.' }`.

#### 3.5.5 Mapper changes

In `mingla-business/src/utils/serverDraftEventMapper.ts`:

- In `buildBusinessDraftPayload`:
  - **Remove:** `category: draft.category,`
  - **Add:**
    - `partyType: draft.partyType,`
    - `vibeTags: draft.vibeTags,`
    - `musicGenres: draft.musicGenres,`
    - `city: draft.city,`
    - `locationGeo: draft.locationGeo,`
- In the server→draft converter (line ~414): remove the `category: asStringOrNull(businessDraft.category)` line; add the symmetric mappers for the five new fields. Read from row top-level columns (`row.party_type`, `row.vibe_tags`, `row.music_genres`, `row.city`) — NOT from `theme.business_event`.

### 3.6 Wizard Step 3 — `CreatorStep3Where.tsx` + new Google Places service

#### 3.6.1 New shared service: `mingla-business/src/services/googlePlacesService.ts`

```ts
export interface PlaceAutocompleteSuggestion {
  placeId: string;
  displayName: string;
  fullAddress: string;
}

export interface PlaceDetails {
  placeId: string;
  formattedAddress: string;
  city: string;                          // locality from addressComponents
  region: string | null;                 // administrative_area_level_1
  countryCode: string | null;            // country shortCode
  location: { lat: number; lng: number };
}

export async function autocompletePlaces(query: string): Promise<PlaceAutocompleteSuggestion[]>;
export async function fetchPlaceDetails(placeId: string): Promise<PlaceDetails>;
```

Implementation mirrors `app-mobile/src/services/geocodingService.ts:282-360` for autocomplete. Place Details uses `GET https://places.googleapis.com/v1/places/{placeId}` with header `X-Goog-FieldMask: id,formattedAddress,addressComponents,location`. Extract `city` by scanning `addressComponents` for the entry whose `types` includes `'locality'` (fall back to `'postal_town'` for UK).

Error contract: `autocompletePlaces` returns `[]` on failure (silent fallback acceptable for typeahead UX). `fetchPlaceDetails` throws on failure (the user-initiated pick must surface errors — Constitution #3).

API key: `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` from `process.env`. If missing, throw `"GOOGLE_MAPS_API_KEY_MISSING"` from `fetchPlaceDetails`; `autocompletePlaces` returns `[]`.

#### 3.6.2 Step 3 component change

Replace the address Input (current lines 70-80) with an `<AddressAutocompleteInput>` component:

- **File:** `mingla-business/src/components/event/AddressAutocompleteInput.tsx` (new)
- **Props:** `{ value: string; onPick: (details: PlaceDetails) => void; onClear: () => void; error?: string; }`
- **States:** idle / typing / loading / results-open / picked / error.
- **Behavior:**
  - On every keystroke (debounced 250ms), if `query.length >= 3`, call `autocompletePlaces`.
  - Render up to 5 suggestions below the field as a sheet-style list.
  - On pick: call `fetchPlaceDetails(placeId)`. While the call is in flight, show a spinner inside the field; disable Pressable.
  - On success: invoke `onPick(details)`. The parent (Step 3) writes `draft.address = details.formattedAddress; draft.city = details.city; draft.locationGeo = details.location;` atomically.
  - On `fetchPlaceDetails` error: show inline error `"Couldn't fetch address details. Tap to try again."`; clear `draft.city` + `draft.locationGeo` (but keep typed text).
  - "Clear address" affordance (X icon) inside the field; on tap → `onClear()` → parent zeroes the three fields.
- **Accessibility:** `accessibilityRole="combobox"`, `accessibilityHint="Type at least 3 characters to see suggestions."`, suggestion list cells are `accessibilityRole="button"`.

#### 3.6.3 Validation

Step 3 validation must require BOTH:
- `draft.address` non-empty (existing rule)
- `draft.city` non-null (new — catches "user typed an address but never picked from autocomplete")

### 3.7 Consumer Discover screen — `DiscoverScreen.tsx`

#### 3.7.1 Filter state extension

Extend `NightOutFilters`:
```ts
interface NightOutFilters {
  date: DateFilter;
  segment: SegmentFilter;
  genre: GenreFilter;
  partyType: string | null;       // single-select
  vibeTags: string[];             // multi-select
  musicGenres: string[];          // multi-select
}
```

Default state: `partyType: null, vibeTags: [], musicGenres: []`.

#### 3.7.2 Filter UI additions

Inside the existing filter sheet (the "More" expansion that lives off the pinned chip row), append three new sections:

- **Party Type** — single-select pill row, 15 chips (use `PARTY_TYPES` from `eventTaxonomy.ts`). One selection at a time. Tapping the selected chip clears.
- **Vibes** — multi-select pill grid (use `VIBE_TAGS`).
- **Music Genres** — multi-select pill grid (use `MUSIC_GENRES`).

Visual: use the existing `FilterChip` component (line ~503 in current file). No new visual primitive. Spec the operator-visible labels = `label` (not `slug`).

Filter state stays screen-local React state (no Zustand). Same query key extension below.

#### 3.7.3 Service call + query key

`useQuery({ queryKey: ['discoverMerged', citySelection, segment, genre, date, partyType, vibeTags, musicGenres, page], queryFn: () => searchMergedEvents(...) })`.

`staleTime`: 60s (match the existing TM cache freshness).

#### 3.7.4 Card render branching

Inside the existing grid map, replace the single-shape `<NightOutCard />` call with:

```tsx
{items.map((it) => it.source === 'business_event'
  ? <BusinessEventCard data={it.item} onPress={() => openExpanded({kind:'business_event', data: it.item})} ... />
  : <NightOutCard      data={it.item} onPress={() => openExpanded({kind:'ticketmaster', data: it.item})} ... />)}
```

#### 3.7.5 New `BusinessEventCard` component

- **File:** `app-mobile/src/components/discover/BusinessEventCard.tsx` (new)
- **Visual:** Same grid cell dimensions as `NightOutCard` (`GRID_CARD_WIDTH × GRID_CARD_HEIGHT`). Hero = `coverMediaUrl` (Image) OR colored band (using `coverHue` per existing EventCover pattern) when null. Bottom info chip: `title` + `formatted date` + `venueName ?? city`. Optional small "On Mingla" pill in the corner (not a TM-style badge — defer styling to ui-ux-pro-max per the operator-feedback memory `feedback_implementor_uses_ui_ux_pro_max.md` — Claude memory, not versioned in this repo).
- **No price overlay** on the card (price lives in the expanded sheet, matching TM cards).

### 3.8 ExpandedCardModal — business-event render branch

#### 3.8.1 Discriminator

Extend `ExpandedCardModalProps` to accept either the existing `card: ExpandedCardData | null` (legacy/place/TM) OR a new shape:

```ts
type ExpandedCardModalInput =
  | { kind: 'place';          data: ExpandedCardData }
  | { kind: 'ticketmaster';   data: ExpandedCardData }   // existing TM event branch (uses EventDetailLayout)
  | { kind: 'business_event'; data: BusinessEventCard };
```

Update the modal's prop signature accordingly. Existing call sites continue to work (default to `kind: 'place'` or `'ticketmaster'` via a small adapter).

#### 3.8.2 Business-event render branch

When `kind === 'business_event'`:

- **Header:** Hero image (`coverMediaUrl` or `coverHue` band), back/close affordance, share button.
- **Title block:** `title`, brand chip (with brand slug → tap to `/b/{brandSlug}` is OUT OF SCOPE for this ORCH; chip is a static label).
- **Taxonomy chips row:** Party Type chip + vibe chips + genre chips (label form). Use existing chip styling from the place-card branch.
- **Date / time:** Formatted from `masterDateUtc + timezone`. Show doors / ends if present.
- **Venue:** If `hideAddressUntilTicket === true`, show "Venue address revealed after purchase"; else show `venueName + address`.
- **Description:** From `description`.
- **Pricing line:** "From £X" or "£X – £Y" using existing `formatPriceRange`. Currency-aware per Constitution #10.
- **Primary CTA — "Get Tickets":** Opens an in-sheet WebView (using existing `InAppBrowserModal` per `ExpandedCardModal.tsx:50`) pointed at `publicBuyerUrl`. **SPEC-1 decision: in-sheet WebView is the chosen buyer-flow mechanism.** Rationale: re-uses the existing anon-tolerant `/e/{brandSlug}/{eventSlug}` route — zero net-new checkout code, faster ship, consumer never leaves `app-mobile`. Future ORCH may reimplement natively.
- **Secondary affordances:** Save (heart) reuses existing `useSavedCards` pattern keyed on `eventId`. Share opens `ShareModal` with the public URL.
- **Loading / error / empty:**
  - Loading: skeleton sections.
  - Error (data malformed): "We couldn't load this event." + Retry.
  - Empty: N/A (modal only opens with non-null data).

#### 3.8.3 No changes to existing branches

The `'place'` and `'ticketmaster'` branches render identically to today.

---

## 4. Success criteria (numbered, observable, testable)

1. A consumer with CityPicker = "London" opens Discover; business events in `city='London'` appear above Ticketmaster events for the same query.
2. A consumer with no business events in the selected city sees TM-only results identical to pre-ORCH behavior.
3. A consumer activates Party Type = "Rooftop Party"; the response includes only business events with `party_type='rooftop-party'`; `meta.tmCalled === false`; UI shows no TM section.
4. A consumer activates Music Genre = "Hip-Hop/Rap"; business events with `'hiphop-rap'` in `music_genres` appear above TM results filtered to `hiphop-rap`; `meta.tmCalled === true`.
5. A consumer activates Music Genre = "Mixed/Variety"; only business events appear (TM has no analog); `meta.tmCalled === true` BUT TM is skipped because no mappable genres.
6. A business creator publishes an event with Party Type = "Club Night", Vibes = ["Energetic","Wild"], Genres = ["Electronic/EDM","Hip-Hop/Rap"], picks address "123 Brick Lane, London E1" from autocomplete; the resulting `events` row has `city='London'`, `party_type='club-night'`, `vibe_tags=['energetic','wild']`, `music_genres=['electronic-edm','hiphop-rap']`, `location_geo=(lat,lng)`.
7. The wizard Step 1 no longer renders the Category section (post-merge, post-OTA).
8. The wizard Step 3 address field shows Google Places suggestions ≤500ms after the 3rd typed character; selecting a suggestion populates `draft.address` + `draft.city` + `draft.locationGeo` atomically; the inline spinner appears and disappears.
9. A consumer taps a business event card; `ExpandedCardModal` opens with the business-event branch (Party Type chip, vibes, genres, "Get Tickets" CTA visible); no `Linking.openURL` occurs.
10. Tapping "Get Tickets" inside the sheet opens the existing `InAppBrowserModal` pointed at `https://<biz-domain>/e/{brandSlug}/{eventSlug}`; the WebView loads the public buyer route; the consumer can complete a checkout without leaving app-mobile (proven by completing a £1 test ticket on staging).
11. Backfill migration completes successfully against staging; rows with `theme->'business_event'->>'category'` in `{Nightlife, Festival, Private}` map to `{club-night, festival, house-party}` respectively; ambiguous values map to NULL; no row is corrupted; pre/post count consistency `SELECT count(*) FROM events` unchanged.
12. RLS regression: `SELECT count(*) FROM events WHERE visibility != 'public'` returns 0 rows when called with anon JWT; same count returns non-zero when called with service-role.
13. Publish RPC raises `party_type_required` when payload omits partyType; raises `city_required` when payload omits city; raises `party_type_not_canonical` when payload has an invented slug.
14. Filter parity verified: every slug in `MUSIC_GENRE_SLUGS` with `tmSlug !== null` resolves to a real entry in `DISCOVER_GENRE_ID` in `_shared/ticketmasterClassifications.ts` (lockstep CI test).
15. No code in `mingla-business/src` or `app-mobile/src` references `draft.category` or `events.category` post-merge (grep CI gate returns 0 matches).

---

## 5. Test case matrix

| # | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | Happy: business + TM merge | city=London, no Mingla facet | items: 3 business first, then N TM; meta.tmCalled=true | edge fn + hook |
| T-02 | Filter suppression: party type | city=London, partyType=rooftop-party | items: business-only; meta.tmCalled=false | edge fn |
| T-03 | Filter suppression: vibe | city=London, vibeTags=[chill] | items: business-only; meta.tmCalled=false | edge fn |
| T-04 | TM-only when no business events | city=Tokyo, no Mingla facet | items: TM-only; meta.businessCount=0 | edge fn |
| T-05 | Music Genre w/ TM analog | city=London, musicGenres=[hiphop-rap] | business events first, TM filtered to hiphop-rap genre | edge fn |
| T-06 | Music Genre w/o TM analog | city=London, musicGenres=[mixed-variety] | business-only (no TM call) | edge fn |
| T-07 | Wizard publish happy | Form with PT/V/G + autocomplete-picked address | events row has city + party_type + vibe_tags + music_genres + location_geo | wizard + RPC |
| T-08 | Wizard validation: missing PT | Form with no Party Type selected | Validation error on Step 1; cannot proceed | validation |
| T-09 | Wizard validation: typed-but-not-picked address | Address typed, autocomplete never invoked | Step 3 validation error "Pick the venue address from the suggestions." | validation |
| T-10 | Autocomplete fetch details fails | Pick suggestion, Google API 500 | Inline error in field; draft.city stays null; user can retry | service + UI |
| T-11 | Anon read on published events | Anon JWT, edge fn merged-discover call | Returns rows | RLS |
| T-12 | Anon SELECT on private events | Anon JWT, direct SELECT WHERE visibility='private' | 0 rows | RLS |
| T-13 | Card tap opens sheet | Tap business card | ExpandedCardModal opens with kind='business_event'; no Linking.openURL fired | screen + sheet |
| T-14 | Get-Tickets CTA opens WebView | Tap CTA inside sheet | InAppBrowserModal opens to publicBuyerUrl; loads buyer page | sheet + browser |
| T-15 | Backfill mapping | Pre-existing event with theme.category='Nightlife' | party_type='club-night' post-migration | migration |
| T-16 | Backfill ambiguous | Pre-existing event with theme.category='Concert' | party_type=NULL post-migration | migration |
| T-17 | Publish RPC: missing partyType | Payload without partyType | raise party_type_required | RPC |
| T-18 | Publish RPC: missing city | Payload without city | raise city_required | RPC |
| T-19 | Publish RPC: invented slug | partyType='invented-slug' | raise party_type_not_canonical | RPC |
| T-20 | CI lockstep | musicGenres mapping table updated | Every tmSlug !== null exists in DISCOVER_GENRE_ID | CI test |
| T-21 | CI strict-grep | Any new write to events.category in code | CI fails | CI gate |
| T-22 | Pagination | 25 business + 30 TM, page=1 size=20 | items[0..19] = first 20 business | edge fn |
| T-23 | Pagination page 2 | Same data, page=2 size=20 | items = remaining 5 business + first 15 TM | edge fn |
| T-24 | TM upstream error | TM API 500 | items: business-only; meta.tmError populated; no client-facing 502 | edge fn |
| T-25 | Empty city | city.name='' | edge fn returns 400 | edge fn |
| T-26 | Wizard Step 1 keyboard | Focus Description with extended Step 1 fields | Description lands above keyboard (no occlusion) | wizard runtime |
| T-27 | Hide address true | Event with hideAddressUntilTicket=true | BusinessEventCard expanded sheet hides address text; shows "revealed after purchase" | sheet |
| T-28 | Anon buyer route renders inside WebView | WebView loads /e/{brandSlug}/{eventSlug} | Page renders, no auth gate fires | cross-app + invariant |

---

## 6. Invariants — preserved + new

### 6.1 Preserved (must not regress)

| Invariant | How preserved |
|---|---|
| Anon-tolerant buyer routes (`feedback_anon_buyer_routes.md`) | WebView opens existing `/e/{brandSlug}/{eventSlug}` route which already lives outside `(tabs)/` and never calls `useAuth`. T-28 verifies. |
| One owner per truth (Constitution #2) | Filter state stays in DiscoverScreen local React state (not Zustand); server data flows through React Query only. |
| One key per entity (Constitution #4) | Single query key `['discoverMerged', ...]` for the merged response. Existing TM-only key is retired. |
| Server state server-side (Constitution #5) | Zustand only holds CityPicker selection (already today); business events are React Query owned. |
| No silent failures (Constitution #3) | `fetchPlaceDetails` throws on failure; UI surfaces error. TM upstream failure surfaces via `meta.tmError`. |
| No fabricated data (Constitution #9) | Backfill produces honest NULL for ambiguous category values; no synthesized party_type. |
| Currency-aware (Constitution #10) | `BusinessEventCard.currency` is preserved; price renders via existing `formatCurrency`. |
| Verify column names against migrations (`feedback_verify_db_column_names_before_writing_queries.md`) | Mapper reads `row.party_type` etc — top-level columns, not TS-camelcased nested keys. |
| Persisted-state startup (Constitution #14) | New Zustand-persisted fields (`draft.city`, `draft.locationGeo`, `draft.partyType`, `draft.vibeTags`, `draft.musicGenres`) are scalar/array — no server records persisted (`feedback_zustand_persist_no_server_snapshots.md`). |

### 6.2 New invariants proposed

| ID | Description | Enforcement |
|---|---|---|
| **I-PROPOSED-EVENT-CITY-CANONICAL** | `events.city` must be populated for every new published event (post-CLOSE). Legacy NULL rows tolerated as historical. | Publish RPC raises `city_required`. CI test asserts. |
| **I-PROPOSED-EVENT-TAXONOMY-CANONICAL** | All values in `party_type`, `vibe_tags`, `music_genres` must come from `eventTaxonomy.ts` canonical lists. | DB CHECK constraint + publish RPC validation + CI test on the three modules' parity. |
| **I-PROPOSED-DISCOVER-MERGE-BUSINESS-FIRST** | Merged Discover responses must rank business events strictly above Ticketmaster within the same query. | Server-side ORDER. Unit test on edge fn output. |
| **I-PROPOSED-DISCOVER-TM-SUPPRESSION** | When `partyTypeSlug` is set OR `vibeTagSlugs` is non-empty, the edge function MUST NOT call Ticketmaster. | Server-side gate. Unit test asserts `meta.tmCalled === false`. |
| **I-PROPOSED-EVENT-TAXONOMY-PARITY** | The three `eventTaxonomy.ts` modules (mingla-business / app-mobile / _shared) must be byte-equivalent. | CI strict-grep gate. |
| **I-PROPOSED-EVENT-CATEGORY-FROZEN** | No code may write `events.category` or `draft.category` post-CLOSE. | CI strict-grep gate per [feedback_strict_grep_registry_pattern.md]. |

All six are tagged `status: DRAFT — flips to ACTIVE on ORCH-0824 CLOSE` in the registry update.

---

## 7. Regression prevention

### 7.1 Structural safeguards

- **DB CHECK constraints** enforce canonical-slug invariant at the schema level.
- **Publish RPC EXCEPTIONs** enforce required-field and canonical-value rules at the API layer.
- **Discriminated-union response shape** prevents accidental rendering of business event with TM card component (and vice versa) — the TypeScript types make the wrong path a compile error.

### 7.2 Tests (implementor must write)

- Unit: `eventTaxonomy.ts` module — every slug unique; every `tmSlug !== null` exists in `DISCOVER_GENRE_ID`.
- Unit: `mapMinglaMusicGenresToTmSlugs` — covers `[]`, `[mixed-variety]`, `[pop, classical]`, `[mixed-variety, pop]` cases.
- Unit: `serverDraftEventMapper.ts` — round-trip a draft with all new fields through `buildBusinessDraftPayload → applyBusinessDraftPayload` produces identical fields.
- Unit: validation — missing partyType triggers error; non-canonical partyType triggers error; missing city triggers error on Step 3.
- Integration: publish RPC with valid payload → row has all five new columns set. Three exception scenarios.
- Integration: edge fn `discover-merged-events` happy + suppression + TM-error + empty-city + pagination cases.
- Snapshot/component: `BusinessEventCard` renders title + date + venue/city.
- Component: `AddressAutocompleteInput` debounces 250ms, renders suggestions, fires `onPick` with `PlaceDetails`, shows error on `fetchPlaceDetails` rejection.

### 7.3 CI strict-grep gates (per [feedback_strict_grep_registry_pattern.md])

Add to `.github/workflows/strict-grep-mingla-business.yml`:

```bash
# I-PROPOSED-EVENT-CATEGORY-FROZEN
grep -rnE "draft\.category|events\.category|\"category\"\s*:" \
  mingla-business/src mingla-business/app app-mobile/src \
  --include="*.ts" --include="*.tsx" \
  && exit 1 || exit 0
```

```bash
# I-PROPOSED-EVENT-TAXONOMY-PARITY
diff <(sed -n '/^export const PARTY_TYPES/,/^] as const/p' mingla-business/src/constants/eventTaxonomy.ts) \
     <(sed -n '/^export const PARTY_TYPES/,/^] as const/p' app-mobile/src/constants/eventTaxonomy.ts) \
  || exit 1
# repeat for VIBE_TAGS, MUSIC_GENRES, and _shared module
```

### 7.4 Protective comments

Code comment in publish RPC body and at top of each `eventTaxonomy.ts` module:

```
-- ORCH-0824 — Party Type, Vibe Tags, Music Genres are the canonical event
-- taxonomy as of 2026-05-13. Replaces the deprecated `category` field
-- (now buried in legacy theme.business_event.category JSONB; do not read).
-- Canonical slug lists live in three parity-locked modules — see
-- I-PROPOSED-EVENT-TAXONOMY-PARITY. Adding a slug requires updating all
-- three modules + this RPC's CHECK list + the DB CHECK constraint.
```

---

## 8. Implementation order

The implementor must follow this exact sequence. Each step ships independently testable artifacts.

| # | Layer | Files (create C / modify M) | Verification |
|---|---|---|---|
| 1 | DB | `supabase/migrations/2026XXXXXXXXXX_orch_0824_event_taxonomy_columns.sql` (C) — column adds, indexes, CHECK constraints | Run on local + dry-run on staging. `mcp__supabase__list_tables` confirms. |
| 2 | DB | Same migration file — backfill UPDATE for `party_type` from legacy JSONB | Verify row counts pre/post; sample 20 rows. |
| 3 | DB | `supabase/migrations/2026XXXXXXXXXX_orch_0824_publish_rpc.sql` (C) — `CREATE OR REPLACE FUNCTION business_publish_event_draft(...)` with new validation + column writes | Manually call RPC with valid + 3 invalid payloads. |
| 4 | Shared constants | `supabase/functions/_shared/eventTaxonomy.ts` (C) | Module compiles in Deno. |
| 5 | Edge fn | `supabase/functions/_shared/ticketmasterClassifications.ts` (M) — add `DISCOVER_GENRE_ID` entries for any slug used in the mapping that's not yet present | CI lockstep test passes. |
| 6 | Edge fn | `supabase/functions/discover-merged-events/index.ts` (C) — full server logic | Local `supabase functions serve` smoke test with 6 scenarios from §5 T-01..T-06. |
| 7 | Shared constants (clients) | `mingla-business/src/constants/eventTaxonomy.ts` (C) + `app-mobile/src/constants/eventTaxonomy.ts` (C) — byte-equivalent to step 4 | CI parity gate passes. |
| 8 | Business draft schema | `mingla-business/src/store/draftEventStore.ts` (M) — remove `category`, add 5 new fields | TS compiles; existing tests pass after fixture updates. |
| 9 | Business validation | `mingla-business/src/utils/draftEventValidation.ts` (M) | Unit tests cover §5 T-08, T-09. |
| 10 | Business mapper | `mingla-business/src/utils/serverDraftEventMapper.ts` (M) — remove `category`, add 5 new fields, read top-level columns on inbound | Round-trip unit test. |
| 11 | Business UI | `mingla-business/src/services/googlePlacesService.ts` (C) | Unit test mocks fetch; integration test against real Google Places (manual). |
| 12 | Business UI | `mingla-business/src/components/event/AddressAutocompleteInput.tsx` (C) | Component test. |
| 13 | Business UI | `mingla-business/src/components/event/CreatorStep3Where.tsx` (M) — wire autocomplete | iOS sim manual smoke. |
| 14 | Business UI | `mingla-business/src/components/event/CreatorStep1Basics.tsx` (M) — remove category, add 3 pill groups | iOS sim manual smoke; per [feedback_implementor_uses_ui_ux_pro_max.md] invoke `/ui-ux-pro-max` for the new pill UI before writing. |
| 15 | Consumer types | `app-mobile/src/types/mergedDiscover.ts` (C) | TS compiles. |
| 16 | Consumer service | `app-mobile/src/services/nightOutExperiencesService.ts` (M) — repoint to merged endpoint | Existing Discover behavior preserved when no Mingla facet active. |
| 17 | Consumer UI | `app-mobile/src/components/discover/BusinessEventCard.tsx` (C) | Snapshot test. |
| 18 | Consumer UI | `app-mobile/src/components/DiscoverScreen.tsx` (M) — filter state extension, filter sheet additions, branched card render | iOS sim manual smoke. |
| 19 | Consumer UI | `app-mobile/src/types/expandedCardTypes.ts` (M) — add `ExpandedCardModalInput` discriminated union | TS compiles. |
| 20 | Consumer UI | `app-mobile/src/components/ExpandedCardModal.tsx` (M) — business-event render branch + WebView CTA | iOS sim manual smoke including £1 test checkout. |
| 21 | CI | `.github/workflows/strict-grep-mingla-business.yml` (M) — add EVENT-CATEGORY-FROZEN + TAXONOMY-PARITY gates | CI run. |
| 22 | CI | `.github/workflows/*` — taxonomy-parity diff job + tm-lockstep test | CI run. |

**Operator gates:** Steps 1–3 are DB migrations — operator owns `supabase db push --linked`. Step 6 edge function deploy — orchestrator owns via `supabase functions deploy discover-merged-events` per [feedback_orchestrator_deploys_edge_functions.md]. Steps 7–20 are client code — implementor ships in one PR; orchestrator runs tester before merge.

---

## 9. Open questions

**None.** All five SPEC-level decisions called out in the dispatch are resolved inline:

| # | Decision | Resolution | §ref |
|---|---|---|---|
| SPEC-1 | Buyer-flow mechanism inside ExpandedCardModal | **In-sheet WebView** via existing `InAppBrowserModal` pointed at public `/e/{brandSlug}/{eventSlug}` | §3.8.2 |
| SPEC-2 | Schema shape for the three taxonomies | **Top-level columns** + btree(city, party_type) + GIN(vibe_tags, music_genres) + DB CHECK constraints | §3.1 |
| SPEC-3 | Required vs optional at publish | **Party Type required; City required; Vibe Tags and Music Genres optional** | §3.1.4, §3.5.4 |
| SPEC-4 | Mingla↔TM Music Genre mapping | **Table of 14 with 2 Mingla-only (Disco/Funk, Mixed/Variety)** | §3.4.1 |
| SPEC-5 | Ranking interleave detail | **Strict partition: all business first (ORDER BY masterDateUtc ASC), then all TM (preserve TM order)** | §3.2.4 |

**One operator confirmation requested before implementation:** the canonical slug list in §3.6 was derived from the operator's Figma screenshots and counts to **15 Party Types / 16 Vibe Tags / 14 Music Genres** — the operator's prior comment said "16/16/13". The discrepancy is minor (one fewer Party Type, one extra Music Genre vs the operator's count). Operator should review §3.4.1 and confirm or hand the implementor the authoritative final list before step 4 lands. Implementor may proceed with the §3.4.1 list if operator does not respond within one cycle.

---

## 10. Backfill plan

Single-pass UPDATE in the same migration that adds the columns (§3.1.5). Pre/post integrity check:

```
-- Run BEFORE the backfill
SELECT count(*) AS total,
       count(*) FILTER (WHERE theme->'business_event'->>'category' IS NOT NULL) AS with_legacy_category
FROM public.events;

-- Run AFTER the backfill
SELECT count(*) AS total,
       count(*) FILTER (WHERE party_type IS NOT NULL) AS with_party_type,
       count(*) FILTER (WHERE party_type IS NULL AND theme->'business_event'->>'category' IS NOT NULL) AS legacy_with_no_mapping
FROM public.events;
```

The `legacy_with_no_mapping` row count is the operator-visible truth: those events stay invisible on Discover until brands edit + republish. The brand's edit screen (`mingla-business/app/event/[id]/edit.tsx` — exists per investigation) will force Party Type selection on save via the new validator. **No automated reminder system** is in scope; orchestrator may register a follow-up ORCH if mass re-publish nudging is required.

Rollback: backfill is forward-only and idempotent (column adds), but `CREATE OR REPLACE FUNCTION business_publish_event_draft` retains the prior body in migration history; operators can manually re-execute the ORCH-0792 version if needed. No `_archive_orch_0824_*` snapshot table is required.

---

## 11. Deploy notes

**Sequence (do NOT reorder):**

1. **Operator:** `supabase db push --linked` to apply the migration(s) from steps 1–3. Verify via `mcp__supabase__list_migrations` that both `2026XXXXXXXXXX_orch_0824_event_taxonomy_columns.sql` and `2026XXXXXXXXXX_orch_0824_publish_rpc.sql` are present remotely.
2. **Orchestrator:** Deploy edge functions:
   ```
   /Users/sethogieva/bin/supabase functions deploy discover-merged-events --project-ref gqnoajqerqhnvulmnyvv
   ```
   Confirm version bump via `mcp__supabase__list_edge_functions`. `verify_jwt` should remain default for public consumer-facing call (typically `verify_jwt: false`).
3. **Operator:** Commit + merge the client PR (mingla-business + app-mobile changes).
4. **Orchestrator:** Publish EAS OTAs:
   ```
   cd app-mobile && eas update --branch production --platform ios --message "ORCH-0824: business events in Discover + new event taxonomy"
   cd app-mobile && eas update --branch production --platform android --message "ORCH-0824: business events in Discover + new event taxonomy"
   cd mingla-business && eas update --branch production --platform ios --message "ORCH-0824: wizard taxonomy + Google Places autocomplete"
   cd mingla-business && eas update --branch production --platform android --message "ORCH-0824: wizard taxonomy + Google Places autocomplete"
   ```
5. **No native rebuild required** unless the implementor adds new Expo packages (none planned in this spec). If new packages are added, full `eas build` is required.

---

## Discoveries for orchestrator

- The Party Type / Vibe Tag / Music Genre count discrepancy (operator said 16/16/13; Figma shows 15/16/14) needs a one-line operator confirmation before step 4 lands. No new ORCH; just a confirmation in the next dispatch.
- `events_with_master_date_view` (ORCH-0792) is the canonical source for `masterDateUtc` in the edge function query. If it doesn't exist on remote, the edge function joins `event_dates WHERE is_master = true` directly.
- The Ticketmaster proxy edge function the consumer currently calls was not directly verified in the investigation (B-1 named the chain but not the function name). Implementor's first task is to confirm the exact function name and decide between server-to-server invoke vs direct TM HTTP fetch from the new merged edge function.

NEXT HANDOFF — paste into Codex `implementor-mingla`:

Implement the spec at `Mingla_Artifacts/specs/SPEC_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md`, following the investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md`. Stay strictly within the SPEC scope — 22 numbered implementation steps in §8, exact files to create or modify named for each step. Do NOT run `supabase db push --linked` (operator owns step 1–3 DB migrations); do NOT deploy edge functions (orchestrator owns step 6 deploy); confirm the operator's canonical slug-list count (15/16/14 per spec §3.4.1 vs operator's earlier "16/16/13") before step 4 if practical, otherwise proceed with the §3.4.1 list. Invoke `/ui-ux-pro-max` before writing Step 14 pill groups per [feedback_implementor_uses_ui_ux_pro_max.md]. On completion, write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md` with old→new receipts per the implementation report template. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Next dispatch after implementation report return will be Claude `mingla-forensics` (TEST mode) — TARGETED + SPEC-COMPLIANCE sub-modes — followed by Codex or Claude `mingla-orchestrator` for CLOSE.
