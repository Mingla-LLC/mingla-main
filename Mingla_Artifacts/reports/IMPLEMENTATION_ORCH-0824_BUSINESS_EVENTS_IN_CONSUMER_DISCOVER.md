# IMPLEMENTATION — ORCH-0824 — Business events in consumer Discover + wizard taxonomy + Google Places autocomplete

**Implementor:** Claude `mingla-implementor` (parity-mirror; Codex `implementor-mingla` is canonical)
**Date:** 2026-05-13
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec:** [`Mingla_Artifacts/specs/SPEC_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md`](../specs/SPEC_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md)
**Investigation:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md`](INVESTIGATION_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md)
**Dispatch:** `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md` (prompts directory is gitignored per the documentation system — `PRIVATE_PROMPT_NOT_VERSIONED`)

---

## Status: PARTIAL — backend foundation complete (steps 1-11 of 22)

**Verification: `implemented, unverified`** — no Deno/test gates run; no sim repro; no deploys. The completed slice is a coherent vertical: every change from `events` schema through the merged Discover edge function through the Google Places service. The remaining 11 steps are all client UI surface (wizard rework, consumer Discover wiring, ExpandedCardModal branch) and CI gates — substantial work that warrants a fresh session for proper rigor.

### What's safe to push to staging now (post operator `supabase db push`):

- DB columns + indexes + CHECK constraints + backfill (migration 1).
- Publish RPC validates and writes the new columns (migration 2).
- `discover-merged-events` edge function callable; returns business events with empty TM section when called.

### What's NOT yet usable end-to-end:

- The business wizard still has the deprecated Category field on Step 1 (premise of step 14).
- The address field on Step 3 is still free-text (premise of steps 12-13).
- The consumer Discover screen still calls `ticketmaster-events` directly (premise of steps 15-18).
- Card tap → `ExpandedCardModal` has no business-event branch (premise of steps 19-20).
- CI gates not added (step 21-22).

**Practical impact:** the operator can `supabase db push` and orchestrator can deploy the edge function safely — neither will affect users today, because no client UI yet writes the new fields or calls the new endpoint. The next implementor session completes the user-visible surface.

---

## Inputs ingested

| Input | Read scope |
|---|---|
| Spec corrections block (top) | Full — Party Type is multi-select; in-sheet WebView is the buyer flow. |
| Spec body | Full §1-§11. |
| Investigation report | Full — locked 10 decisions + finding A-3 (category buried in JSONB) + finding D-1 (no autocomplete today). |
| `INVARIANT_REGISTRY.md` + relevant memories | Skimmed: anon-buyer routes, query-key, currency-aware, verify-column-names-against-migrations, orchestrator-deploys-edge-functions. |
| `mingla-business/src/components/event/CreatorStep1Basics.tsx` | Full pre-rewrite read; ORCH-0823 uncommitted changes noted for preservation in step 14. |
| `mingla-business/src/components/event/CreatorStep3Where.tsx` | Full. |
| `mingla-business/src/store/draftEventStore.ts` | Schema region lines 213-372. |
| `mingla-business/src/utils/serverDraftEventMapper.ts` | Lines 21-100 (types), 240-290 (outbound mapper), 380-470 (inbound mapper). |
| `mingla-business/src/utils/draftEventValidation.ts` | Lines 1-130 (validators region), 313-347 (validateWhere). |
| `app-mobile/src/services/geocodingService.ts` | Lines 282-360 (Google Places autocomplete pattern — used as template for new business service). |
| `supabase/migrations/20260525000000_orch_0792_publish_writes_event_dates.sql` | Full (455 lines) — basis for ORCH-0824 RPC rewrite. |
| `supabase/migrations/20260525000003_orch_0792_events_with_master_date_view.sql` | Lines 24-155 — `events_with_master_date_view` and `business_public_events_view` definitions. |
| `supabase/functions/ticketmaster-events/index.ts` | Lines 1-80 (request schema), response shape — used to design server-to-server invoke. |
| `supabase/functions/_shared/ticketmasterClassifications.ts` | Lines 51-141 — confirmed all 12 TM-mappable Mingla music genres exist in `DISCOVER_GENRE_ID`. |

---

## Old → New Receipts

### NEW — `supabase/migrations/20260604000000_orch_0824_event_taxonomy_columns.sql` (139 lines)

**What it does:** Adds four columns to `public.events` (`city text`, `party_types text[]`, `vibe_tags text[]`, `music_genres text[]`); adds three subset-CHECK constraints with the canonical 15/16/14 slug arrays; adds four partial indexes (btree on `city`, GIN on the three array columns); backfills `party_types` from legacy `theme->'business_event'->>'category'` JSONB (Nightlife→club-night, Festival→festival, Private→house-party, all else→empty array); runs a self-verify DO block that counts post-state and RAISES if any canonical-violation slipped through.

**Why:** SPEC §3.1.1, §3.1.2, §3.1.3, §3.1.5. The new top-level columns are the canonical filtering spine; JSONB-only was rejected for query performance.

**Monotonic prefix:** `20260604000000` > local max `20260603000001` ✓.

### NEW — `supabase/migrations/20260604000001_orch_0824_publish_rpc.sql` (348 lines)

**What it does:** `CREATE OR REPLACE FUNCTION business_publish_event_draft(...)` — modifies the ORCH-0792 body to:
1. Read `partyTypes`, `vibeTags`, `musicGenres`, `city` from `v_business_draft` JSONB payload.
2. Validate: raise `city_required`, `party_types_required`, `party_types_not_canonical`, `vibe_tags_not_canonical`, `music_genres_not_canonical`.
3. Write the four new columns in the events UPDATE.
4. Strip `category`, `partyTypes`, `vibeTags`, `musicGenres`, `city`, `locationGeo` from the `business_event` JSONB so the same data is not stored in two places. Top-level columns are canonical.

Auth, currency, title, tickets, event_dates logic is byte-equivalent to ORCH-0792.

**Why:** SPEC §3.1.4. Promotes the new fields from JSONB payload → real columns at the API boundary.

### NEW — `supabase/functions/_shared/eventTaxonomy.ts` (135 lines)

**What it does:** Canonical source of the 15 Party Types / 16 Vibe Tags / 14 Music Genres. Exports `PARTY_TYPES`, `VIBE_TAGS`, `MUSIC_GENRES` (with emoji on vibes, `tmSlug` on music genres including `null` for the 2 Mingla-only values: disco-funk, mixed-variety). Exports `PARTY_TYPE_SLUGS`, `VIBE_TAG_SLUGS`, `MUSIC_GENRE_SLUGS` helper arrays. Exports `mapMinglaMusicGenresToTmSlugs(slugs)` → `{tmMappable, minglaOnly}` for the edge function to decide TM-suppression. Exports `isSubsetOf(input, canonical)` defensive validator.

**Why:** SPEC §3.4.1. Canonical source for three parity-locked modules (next item).

### NEW — `mingla-business/src/constants/eventTaxonomy.ts` (135 lines, byte-identical to `_shared`)

### NEW — `app-mobile/src/constants/eventTaxonomy.ts` (135 lines, byte-identical to `_shared`)

**What they do:** Byte-equivalent copies of `_shared/eventTaxonomy.ts` for client use. CI parity gate (step 21-22, not yet written) enforces byte-equivalence.

**Verification:** `diff` confirmed byte-equivalence at write time (parity OK reported in implementor session).

**Why:** SPEC §3.4 + I-PROPOSED-EVENT-TAXONOMY-PARITY.

### NEW — `supabase/functions/discover-merged-events/index.ts` (~310 lines)

**What it does:** Server-side fan-out edge function. POST request with `city.name` (required), optional TM facets (segmentSlug, genreSlugs, date), optional Mingla facets (partyTypeSlugs, vibeTagSlugs, musicGenreSlugs). Validates canonical slugs at the edge. Reads business events from Postgres via service-role with explicit public+scheduled/live WHERE clause (defense-in-depth). Applies `&&` array-overlap filters for each non-empty Mingla facet. Sorts business events soonest-first. Decides TM call gate: if any Party Type or Vibe filter is active → TM is NOT called (I-PROPOSED-DISCOVER-TM-SUPPRESSION); if music genre filter has at least one TM-mappable value → call TM with the mapped slugs; if music genre filter has only Mingla-only values → suppress TM. Returns discriminated-union `items: ({source:'business_event', item: BusinessEventCard} | {source:'ticketmaster', item})[]` with `meta.tmCalled`, `meta.tmError`, `meta.businessCount`, `meta.ticketmasterCount`. TM upstream errors degrade gracefully — business results still return.

**Auth:** anon-callable; `verify_jwt = false` in `supabase/config.toml`.

**Why:** SPEC §3.2.

### MODIFIED — `supabase/config.toml`

```
[functions.discover-merged-events]
verify_jwt = false
```

Added below the existing `[functions.ticketmaster-events]` block.

**Why:** SPEC §3.2.1 — anon-callable.

### MODIFIED — `mingla-business/src/store/draftEventStore.ts`

**What it did before:** `DraftEvent` had `category: string | null` (single-select). `DEFAULT_DRAFT_FIELDS` defaulted `category: null`.

**What it does now:**
- Removed `category` field.
- Added `partyTypes: string[]`, `vibeTags: string[]`, `musicGenres: string[]` to Step 1 group with JSDoc citing SPEC §3.5.3.
- Added `city: string | null`, `locationGeo: { lat: number; lng: number } | null` to Step 3 group with JSDoc citing the autocomplete-populated semantics.
- `DEFAULT_DRAFT_FIELDS` updated: arrays default to `[]`; city/locationGeo default to `null`.

**Why:** SPEC §3.5.3 + corrections §A (multi-select).

**Risk:** Persisted drafts from older app builds have `category: string` and no `partyTypes`. Reading them through the unchanged Zustand persist will produce drafts with `partyTypes=undefined` (rather than `[]`) — defensive code in step 14 (CreatorStep1Basics.tsx) and validator (step 9, done) treats `undefined.length` defensively via the Array.isArray guards in the inbound mapper. **Manual test required**: cold-start business app with an old persisted draft and verify the wizard renders without crash. Flagged for tester.

### MODIFIED — `mingla-business/src/utils/draftEventValidation.ts`

**What it did before:** `validateBasics` required `d.category !== null` with message "Pick a category." `validateWhere` required venueName + address only.

**What it does now:**
- `validateBasics`: replaced category check with `partyTypes.length === 0 → "Pick at least one party type."` plus three canonical-subset defensive checks (partyTypes, vibeTags, musicGenres). The canonical subset checks catch persisted drafts with stale slugs from older builds.
- `validateWhere`: added `city === null` check (after address presence check) with message "Pick the venue address from the suggestions." This forces the user through Google Places autocomplete pick.
- Imports `PARTY_TYPE_SLUGS`, `VIBE_TAG_SLUGS`, `MUSIC_GENRE_SLUGS` from the new taxonomy module.

**Why:** SPEC §3.5.4 + corrections §A.

### MODIFIED — `mingla-business/src/utils/serverDraftEventMapper.ts`

**What it did before:**
- `ServerDraftEventRow` had no taxonomy or city/location_geo columns typed.
- `BusinessDraftPayload` had `category: string | null`.
- `buildBusinessDraftPayload` sent `category: draft.category`.
- `serverRowToDraft` read `businessDraft.category` from JSONB.

**What it does now:**
- `ServerDraftEventRow`: added `city`, `party_types`, `vibe_tags`, `music_genres`, `location_geo` as optional row fields (legacy rows pre-migration may not have them).
- `BusinessDraftPayload`: removed `category`; added `partyTypes`, `vibeTags`, `musicGenres`, `city`, `locationGeo`.
- `buildBusinessDraftPayload`: sends the five new fields; no longer sends `category`.
- `serverRowToDraft`: reads `partyTypes`, `vibeTags`, `musicGenres` from TOP-LEVEL row columns (`row.party_types` etc., NOT from `businessDraft` JSONB — per `feedback_verify_db_column_names_before_writing_queries.md`). `city` from `row.city`. `locationGeo` parsed from `row.location_geo` (handles both Postgres point string "(lng,lat)" and object `{x, y}`).

**Why:** SPEC §3.5.5 + §3.2.3. Top-level columns are canonical post-migration.

**Risk:** Legacy rows that have `theme.business_event.category` populated but no top-level taxonomy columns (pre-migration backfill) will round-trip as `partyTypes: []`. The validator then forces re-selection on republish. This is intentional per SPEC §10 backfill plan.

### NEW — `mingla-business/src/services/googlePlacesService.ts` (~145 lines)

**What it does:** Two exports:
- `autocompletePlaces(query)` → up to 5 `PlaceAutocompleteSuggestion[]`. Silent fallback to `[]` on failure (type-ahead UX). Uses `places.googleapis.com/v1/places:autocomplete`.
- `fetchPlaceDetails(placeId)` → `PlaceDetails` with structured city (locality → postal_town → administrative_area_level_2 fallback chain), region, countryCode, location lat/lng. THROWS on failure (`GOOGLE_MAPS_API_KEY_MISSING`, `PLACE_DETAILS_HTTP_<status>`, `PLACE_DETAILS_NO_LOCALITY`, `PLACE_DETAILS_NO_LOCATION`).

Uses `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` from `process.env` — same key as the consumer app.

**Why:** SPEC §3.6.1 + finding D-1 operator decision (bundle wizard autocomplete into ORCH-0824).

---

## Spec Traceability

| SPEC criterion (§4) | Step | Status |
|---|---|---|
| 1. Business events in city X above TM | 1, 6 | Implemented (schema + edge fn); end-to-end pending step 16 (consumer service repoint). |
| 2. TM-only fallback when no business events | 6 | Implemented in edge fn. |
| 3. Party Type filter → only business events, no TM | 6 | Implemented (suppression gate). |
| 4. Music Genre HipHop-Rap → both sources mapped | 4, 6 | Implemented. |
| 5. Mixed/Variety → only business, no TM | 4, 6 | Implemented (mapMinglaMusicGenresToTmSlugs). |
| 6. Wizard publish populates all 5 new columns | 1, 3, 8, 10 | Schema + RPC + draft store + mapper done; wizard UI not yet writing the new fields → **end-to-end pending step 14**. |
| 7. Wizard Step 1 no longer renders Category | — | **Pending step 14.** |
| 8. Step 3 Google Places autocomplete + city extraction | 11 | Service module done; wizard not yet wired → **pending step 12-13**. |
| 9. Card tap opens ExpandedCardModal (no Linking.openURL) | — | **Pending steps 18-20.** |
| 10. Get Tickets CTA opens InAppBrowserModal | — | **Pending step 20.** |
| 11. Backfill correctness | 2 | Implemented; integrity probe in DO block. |
| 12. RLS regression on private events | 1 | No RLS change; existing baseline policy preserves. |
| 13. RPC raises correct exceptions on bad payloads | 3 | Implemented (5 distinct exception strings). |
| 14. Lockstep TM↔Mingla genre table | 4, 5 | Implemented; CI test pending step 22. |
| 15. No `draft.category` / `events.category` writes remain | 8, 10 | Code path verified clean for the touched files; CI gate pending step 21. |

---

## Invariant Verification (preserved + new)

| Invariant | Status | Evidence |
|---|---|---|
| Anon-buyer-route (memory) | Preserved | No route changes in this slice. |
| One owner per truth (Constitution #2) | Preserved | DB columns are the single owner post-migration; JSONB payload mirrors are stripped by RPC. |
| One key per entity (Constitution #4) | Pending step 18 verification | Hook layer not yet touched. |
| Server state server-side (Constitution #5) | Preserved | New draft fields are scalars/arrays, not server snapshots. |
| No silent failures (Constitution #3) | Preserved | `fetchPlaceDetails` throws; edge fn returns explicit error JSON; RPC RAISES. |
| No fabricated data (Constitution #9) | Preserved | Backfill produces honest empty arrays for ambiguous categories. |
| Currency-aware (Constitution #10) | Preserved | `currency` retained in publish path; edge fn returns `currency` in BusinessEventCard. |
| Verify column names against migrations (memory) | Preserved | Mapper reads `row.party_types` (snake_case top-level), not `businessDraft.partyTypes` (camelCase JSONB). |
| Zustand persist no server snapshots (memory) | Preserved | New draft fields are scalars/arrays only. |
| **I-PROPOSED-EVENT-CITY-CANONICAL** (new) | DRAFT — flips ACTIVE on CLOSE | RPC `city_required` exception. |
| **I-PROPOSED-EVENT-TAXONOMY-CANONICAL** (new) | DRAFT | DB CHECK constraints + RPC canonical-list checks. |
| **I-PROPOSED-DISCOVER-MERGE-BUSINESS-FIRST** (new) | DRAFT | Edge fn strict-partition merge with business first. |
| **I-PROPOSED-DISCOVER-TM-SUPPRESSION** (new) | DRAFT | Edge fn gate when Party Type or Vibe filter active. |
| **I-PROPOSED-EVENT-TAXONOMY-PARITY** (new) | DRAFT — CI gate pending step 22 | Three modules byte-equivalent at write time. |
| **I-PROPOSED-EVENT-CATEGORY-FROZEN** (new) | DRAFT — CI gate pending step 21 | No `draft.category` / `events.category` writes in touched files. |

---

## Parity Check

- **Solo / collab:** N/A — ORCH-0824 is consumer Discover + business wizard; not deck/collab.
- **Mobile + business + admin:**
  - Mobile (app-mobile): pending steps 15-20.
  - Business (mingla-business): pending steps 12-14.
  - Admin (mingla-admin): not in scope per SPEC non-goals.
- **iOS + Android:** equal — no platform-specific code in this slice.

---

## Cache Safety

No query keys changed in this slice. Step 18 (DiscoverScreen) will rename or extend the existing key; pending implementor will verify cache invalidation when that change lands.

---

## Regression Surface (adjacent features at risk)

Pending fuller verification after steps 12-20 are done. Initial list:

1. **Existing business event publish** (any brand publishing a new event): the RPC now requires `partyTypes` and `city` — the wizard does NOT yet send them. **Publishing a new event will fail with `party_types_required` until step 14 lands.** Mitigation: do NOT deploy migration 2 (publish RPC) to production until step 14 ships. Operator should sequence: deploy migration 1 only → ship steps 12-22 → deploy migration 2 + edge function.
2. Existing draft autosave: `draftToServerInsert` still works; the new fields default to `[]`/null on insert and are ignored by the draft-save path (only the publish RPC validates them).
3. Existing buyer flow (`/checkout/{eventId}/...`): untouched; will continue to render published events including legacy ones.
4. Server-row hydration of existing drafts: handled defensively (`partyTypes: []` for older rows without the column populated).

---

## Constitutional Compliance

Quick scan of the 14 principles for this slice:

| # | Principle | Status |
|---|---|---|
| 1 | No dead taps | N/A — no new tappable surface in this slice. |
| 2 | One owner per truth | ✓ — DB columns canonical; JSONB stripped at publish. |
| 3 | No silent failures | ✓ — `fetchPlaceDetails` throws; edge fn explicit errors. |
| 4 | One key per entity (RQ) | Pending step 18. |
| 5 | Server state server-side | ✓ — Zustand only holds scalars/arrays. |
| 6 | Logout clears everything | Unchanged; new fields persist in draft store same as old ones. |
| 7 | Label temporary | N/A — no transitional items in this slice. |
| 8 | Subtract before adding | ✓ — `category` field removed before adding three replacements. |
| 9 | No fabricated data | ✓ — honest empty arrays in backfill. |
| 10 | Currency-aware | ✓ — preserved through publish path. |
| 11 | One auth instance | N/A. |
| 12 | Validate at right time | ✓ — `partyTypes.length === 0` at Step 1 boundary; `city === null` at Step 3 boundary; RPC re-validates at publish. |
| 13 | Exclusion consistency | ✓ — same canonical lists used by SQL CHECK, RPC validation, edge fn validation, and client validation. |
| 14 | Persisted-state startup | Defensive — Array.isArray guards on row read handle old persisted shape. |

---

## Discoveries for orchestrator

1. **Premise correction confirmed in code:** the wizard's old `category` field was indeed silently buried in `events.theme.business_event.category` JSONB (investigation finding A-3). The RPC stripping logic now removes both `category` AND the new taxonomy keys from the JSONB so the same data is not stored in two places.
2. **ORCH-0823 in-flight modifications present:** `CreatorStep1Basics.tsx`, `Input.tsx`, `Input.variants.ts`, `Input.variantBehaviour.test.tsx`, `package.json`, `eas.json` were modified by a prior ORCH-0823 session and remain uncommitted. ORCH-0824 step 14 (still pending) MUST preserve the ORCH-0823 changes to the Description TextInput (`autoCorrect={false}`, `autoCapitalize="none"` at lines ~205-211 of the modified file). Implementor in next session should not lose these.
3. **Migration ordering risk:** the new publish RPC (migration 2) requires `partyTypes` + `city` from the client. If migration 2 is deployed BEFORE the wizard ships those fields (steps 12-14), every business event publish in production will fail with `party_types_required` / `city_required`. Operator should sequence: ship the wizard OTA first, then run `supabase db push` for migration 2 + deploy edge function. Migration 1 (column adds + indexes + backfill) is safe to deploy independently because it doesn't change behavior.
4. **Edge function env requirement:** `MINGLA_BUSINESS_BUYER_DOMAIN` env var is read by the new edge function to build `publicBuyerUrl`. Default fallback is `"https://business.mingla.app"`. Operator should confirm or override at deploy time.
5. **Deno gate not run:** no Deno tooling available in this Claude session. Operator must run `deno check supabase/functions/discover-merged-events/index.ts` and (if applicable) `deno test` before edge-function deploy. Per implementor skill rule §8.
6. **`venueName` not yet returned from edge function:** the `BusinessEventCard.venueName` is hard-null in the current edge function because the venue name lives in `theme.business_event.venueName` JSONB (per draft store layout) and the v1 query doesn't extract it. Step 18/20 implementor should either (a) extract it from theme in a follow-up edge fn patch, or (b) accept that the expanded sheet shows just `city` for v1. Flagged for SPEC re-check.

---

## What the next implementor session must do

The remaining 11 steps in priority order — all client UI surface:

| # | File | Purpose | Approx LOC |
|---|---|---|---|
| 12 | `mingla-business/src/components/event/AddressAutocompleteInput.tsx` | New component | ~200 |
| 13 | `mingla-business/src/components/event/CreatorStep3Where.tsx` | Wire autocomplete | modify |
| 14 | `mingla-business/src/components/event/CreatorStep1Basics.tsx` | Drop category, add 3 pill grids; **preserve ORCH-0823 attrs on Description**; invoke `/ui-ux-pro-max` first | substantial rewrite |
| 15 | `app-mobile/src/types/mergedDiscover.ts` | Discriminated-union types | ~80 |
| 16 | `app-mobile/src/services/nightOutExperiencesService.ts` | Repoint to merged endpoint | modify |
| 17 | `app-mobile/src/components/discover/BusinessEventCard.tsx` | New card component | ~200 |
| 18 | `app-mobile/src/components/DiscoverScreen.tsx` | Add 3 filter facets + branched render | extensive |
| 19 | `app-mobile/src/types/expandedCardTypes.ts` | Add discriminated union | small |
| 20 | `app-mobile/src/components/ExpandedCardModal.tsx` | Business-event render branch + WebView CTA | substantial |
| 21 | `.github/workflows/strict-grep-mingla-business.yml` | EVENT-CATEGORY-FROZEN + TAXONOMY-PARITY gates | small |
| 22 | CI taxonomy parity test job | Gate | small |

After step 22: write the final implementation report (this file becomes `_v2.md` or is replaced in-place), running `deno check` on the edge function if Deno is available.

---

## Files changed in this session

```
NEW: supabase/migrations/20260604000000_orch_0824_event_taxonomy_columns.sql
NEW: supabase/migrations/20260604000001_orch_0824_publish_rpc.sql
NEW: supabase/functions/_shared/eventTaxonomy.ts
NEW: supabase/functions/discover-merged-events/index.ts
NEW: mingla-business/src/constants/eventTaxonomy.ts
NEW: mingla-business/src/services/googlePlacesService.ts
NEW: app-mobile/src/constants/eventTaxonomy.ts
MOD: supabase/config.toml
MOD: mingla-business/src/store/draftEventStore.ts
MOD: mingla-business/src/utils/draftEventValidation.ts
MOD: mingla-business/src/utils/serverDraftEventMapper.ts
```

11 files (7 new + 4 modified). The ORCH-0823 in-flight uncommitted changes were NOT touched.

---

NEXT HANDOFF — paste into Claude `mingla-implementor` (or Codex `implementor-mingla`):

Continue ORCH-0824 implementation from the partial checkpoint at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md` — 11 of 22 steps done (entire backend + Google Places service). Remaining 11 steps are all client UI surface per the report's "What the next implementor session must do" table: business wizard (Steps 12-14, including the AddressAutocompleteInput component, Step 3 wiring, and Step 1 multi-select pill rewrite that must PRESERVE the in-flight ORCH-0823 `autoCorrect={false} autoCapitalize="none"` attrs on the Description TextInput), consumer app (Steps 15-20: mergedDiscover types, nightOutExperiencesService repoint, new BusinessEventCard, DiscoverScreen filter additions + branched render, expandedCardTypes discriminator, ExpandedCardModal business-event render branch with in-sheet InAppBrowserModal CTA), and CI gates (Steps 21-22). Inputs to read in order: this implementation report (partial), the SPEC at `Mingla_Artifacts/specs/SPEC_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md` (corrections block FIRST, then body), the investigation at `reports/INVESTIGATION_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md`, the dispatch at `prompts/IMPLEMENTOR_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md`. Hard guards: stay in SPEC scope, do NOT modify any of the 7 new + 4 modified files from session 1 except to add usages of their exports, do NOT run `supabase db push` or deploy the edge function, invoke `/ui-ux-pro-max` before writing Step 14, preserve ORCH-0823 attributes on the Description TextInput, register adjacent bugs as separate ORCH candidates. On completion, update this same implementation report (rename to `_v2.md` if preferred) and ensure all 22 steps + their old→new receipts are documented; do NOT open the PR. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Downstream after full completion: Claude `mingla-forensics` (TEST mode TARGETED + SPEC-COMPLIANCE), then orchestrator CLOSE with OTA deploys for both apps on iOS + Android.
