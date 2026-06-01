# DIAGNOSIS (CORRECTED) — Sub-E venue-wizard bugs (operator live-fire on physical iPhone)

**Date:** 2026-05-31
**Diagnostician:** Claude `mingla-orchestrator` (main session)
**Test brand:** "Sub-E Smoke Test" id `d27aaea5-0a92-435f-9d40-b8cd38e3ac6e`, account `b17e3e15-218d-475b-8c80-32d4948d6905`

> SUPERSEDES an earlier draft of this file that wrongly blamed RLS. VERIFIED FACTS (live DB):
> the edge fn `run-business-place-authoring-pipeline` already uses **service-role** for all
> place_pool ops (`index.ts:294 serviceClient`, passed to every handler at 1167-1184), and
> place_pool has a `service_role_all_place_pool` ALL policy — so RLS is NOT the blocker. All 24
> insert columns exist. The create-new RPC `biz_create_venue_brand_authoring` does NOT require
> google_place_id. My two earlier column/RLS theories were WRONG; do not act on them.

## Operator-approved architecture (2026-05-31)
1. **Create-new (no Google match) must be authored through the Sub-E pipeline** (`run-business-place-authoring-pipeline`, action `upsert_tier1_place`), which is the only path that writes a `place_pool` row with `fetched_via='business_authored'` + `business_authoring_status` + (via Tier-2) `ai_signal_scores`. Do NOT rely on the legacy brand RPC to produce the deck-rankable place row.
2. **Slug = alphanumeric only** (`^[a-z0-9]{1,32}$`, no hyphens) — matches the existing DB rule; NO migration.

## B6 — "Could not submit, try again" (CRITICAL)
The submit (`VenueCreatorWizard.tsx:114 handleSubmit`, create-new branch) runs TWO server calls:
1. `createVenue.mutateAsync` → `createVenueBrandPendingReview` → RPC **`biz_create_venue_brand_authoring`** (brandsService.ts:286). This RPC: enforces slug `^[a-z0-9]{1,32}$` (→ `invalid_slug` if the slug has hyphens/caps/>32), creates a NEW brand, touches place_pool, but does NOT set `business_authoring_status`/`fetched_via='business_authored'`.
2. `upsertTier1Place({brandId, selectedPlacePoolId:null, draft})` → edge fn create-new branch (`index.ts:388-448`) which DOES insert the `business_authored` row.

The generic "Could not submit. Try again." is the catch-all at `VenueCreatorWizard.tsx:193` — i.e. a non-SlugCollision error thrown by one of those two calls. **The exact runtime error was not captured** (Metro log rotated past the attempt; no live repro captured yet). Highest-probability causes, in order: (a) `invalid_slug` from call 1 because the slug Seth typed/derived contained hyphens or caps or exceeded 32 chars (consistent with the false "slug taken" + manual-slug bugs); (b) a mismatch/double-create between call 1 (new brand) and call 2 (place author) — entering from an EXISTING brand's Edit but the wizard creates ANOTHER brand.

**FIX (operator-approved):** rewire the create-new submit so the venue is authored via the Sub-E pipeline and the slug is always rule-valid:
- Ensure the slug passed to call 1 is sanitized to `^[a-z0-9]{1,32}$` (see B3) BEFORE submit, so `invalid_slug` can't fire.
- Keep call 2 (`upsertTier1Place`) as the authority for the `place_pool` business_authored row (it's correct). Confirm call 1's RPC and call 2's edge fn agree on the same brand (don't double-create or orphan).
- **Surface the REAL error**: replace the generic swallow at `VenueCreatorWizard.tsx:193` so any thrown error's message/code is shown (and console.warn'd) instead of "Could not submit. Try again." — so the next failure is diagnosable on device.
- After fix, a create-new submit MUST produce: a `brands` row for the venue + a `place_pool` row `fetched_via='business_authored'` `claimed_by` set `business_authoring_status='processing'`, then Tier-2 → `ai_signal_scores` (v4). Prove via DB.

## B5 — false "slug is taken"
`brandsService.ts:107` (`checkSlugAvailable`, scoped `deleted_at IS NULL`) + the RPC's own `23505`→SlugCollisionError mapping. With B3 (auto-gen unique slug) + B6 (real error surfaced) this should resolve; verify the availability check excludes the brand's own slug and is case-normalized.

## B3 — slug auto-generate from name + suggestions (alphanumeric-only, operator-approved)
`VenueStep2NameSlug.tsx` — derive slug from the NAME field onChange: lowercase, strip to `[a-z0-9]`, truncate 32. Offer the primary + 1-2 numbered fallbacks (e.g. `zzzwinebar`, `zzzwinebar2`) the operator taps to accept. Pre-fill, keep editable, but always emit a rule-valid slug. This kills manual typing + the invalid_slug/false-taken failures.

## B2 — Continue greyed until validated address
`VenueStep1Address.tsx` (Google Places via `AddressAutocompleteInput`→`parseGooglePlaceResult`, sets lat/lng; null when not a real pick). Gate `VenueCreatorWizard.tsx:295` Continue `disabled` on `draft.lat !== null && draft.lng !== null`, using the Button disabled state — not a live-looking no-op. (Provider is Google Places, not Mapbox — flag for operator, don't change provider here.)

## B4 — hero cover "coming soon" → unified CoverPicker (operator-approved)
Replace the venue-wizard hero-cover stub with `src/components/ui/CoverPicker.tsx` (image/GIF/video). Hero-video feeds the ×1.15 ranker boost.

## B1 — category cards width = Continue button width
`app/venue/create.tsx:243` ("What kind of place is it?") + `src/components/brand/VenueCategoryPicker.tsx` — align Restaurant/Play/Creative&arts cards to the same width/insets as the Continue button.

## Verified schema facts (for the implementer)
- place_pool NOT-NULL no-default cols: **name, lat, lng** only.
- Valid place_pool cols incl: address, city, country (NOT country_code/formatted_address/city_name/place_id; google_place_id exists, stays null for authored).
- business_authoring_status CHECK: none/draft/processing/needs_fix/deck_eligible/failed.
- Edge fn already service-role; KEEP it. KEEP `place_pool_business_owner_update` RLS policy.

## Test-data state
- Baselines: place_pool business_authored = 0, brand_place_pipeline_state = 0.
- "Sub-E Smoke Test" brand (`d27aaea5`) remains for testing; delete at final cleanup.
