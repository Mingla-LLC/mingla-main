# SPEC — ORCH-1263 [claim-adoption]: claim a seeded venue via the create-wizard CLAIM VARIANT

- **Phase:** SPEC (binding build contract — no implementation here)
- **Date:** 2026-07-02 · **Branch:** `orch-1263-claim-adoption` · **Worktree:** `~/Desktop/mingla-orchs/orch-1263-[claim-adoption]/`
- **Author:** mingla-forensics
- **Evidence base:** `Mingla_Artifacts/reports/INVENTORY_ORCH-1263_CREATE_VS_CLAIM.md` (commit `e0e4a09c1`) — findings cited as §/F-/R-/Q- IDs from that file. Ratified decisions cited as **D-A..D-F** (orchestrator dispatch, final).
- **Product intent (Seth-confirmed):** claiming a seeded venue reuses the create-venue wizard as a CLAIM VARIANT: every step pre-filled with what exists (photos/hours/summary/contact/price/category), keep/edit/delete per item, cover chosen from the adopted gallery (or upload) — the one mandatory new decision; same approval pipeline unchanged; pending-admin-approval stays a card state.

---

## 1. Executive summary

Today "Yes, this is me" pre-fills only name/address/pin/category/hours and throws away the rest of the seeded listing (inventory §1.1/§1.2). Worse, three live-place hazards fire pre-approval: the wizard's hours overwrite the live deck hours at submit (F-2 anchor: `run-business-place-authoring-pipeline/index.ts:580`), a hero pick wipes the seeded gallery to `[hero]` (R-1: `index.ts:1662`), and overnight venues can't pass the hours step at all (R-2: `venueWizardValidation.ts:32–34`).

This build ships the **adoption layer** on the existing machinery (inventory: "no new pipeline needed", §1.3/§3.1):

- **Leg A (server):** a claimed-flag on claim search + a single-place **adoption-detail** contract (phone/website/price/summary/facets/full gallery), a **stage-only pre-approval write model** for the claim path (D-A), and an **approve-time application** of authored content in `admin-review-venue-claim` (D-A), plus non-destructive hero semantics (D-E). One migration.
- **Leg B (client):** claim variant of the wizard — copy-on-start adoption into the persisted draft (D-B), category confirm (D-F), per-step "already on Mingla" keep/edit/delete affordances, a new **Photos & cover** claim step (D-E), claimed-state front-loaded in search results + same-brand half-claim retry (D-C), overnight-hours validation fix (D-D).
- **Leg C (tests/gates):** behavioral fails-on-revert tests per layer, SQL contract tests, 2 strict-grep CI gates, 6 DRAFT invariants.

Approval pipeline, card states, and admin state machine are **unchanged** (inventory §3.1, META-ORCH-1255 D-4).

---

## 2. Scope & non-goals

### In scope
1. Everything in §1 above, bounded to the files in the allowlist (§12).
2. Killing the dead `photoUris` draft field (inventory §1.2 s5 — prefilled, rendered as a count, never uploaded) as part of the draft-store reshape.
3. `get_authoring_context` cover truth fix (Q-1: `cover_media_url = stored_photo_urls[0]` fake at `index.ts:1624` misreports a seeded photo as a chosen cover on claim resume) — venue row is the cover truth per 1255(C) D-C.
4. Overnight-hours acceptance in BOTH validators (`venueWizardValidation.ts` and the identical `o >= c` rule in `VenueSettingsModule.tsx:251–261`). Declared D-D extension: a claimed late-night venue must also be able to SAVE its real hours post-approve in Settings; leaving the second copy of the same broken rule would re-block the same 4,211-venue cohort one screen later. One-rule change, same predicate, both files.

### Non-goals (explicit)
- **No approval-pipeline changes**: `biz_review_venue_claim` state machine, card states, admin UI flows stay byte-identical (§3.1). The approve HANDLER gains one application step (§4.A5) — the state machine does not change.
- **No multi-period-per-day hours support** (mapper keeps first-period-wins, §1.2 s2 note); the hours step is editable, the banner tells the operator to review.
- **No adoption surface for** `accessibility_options` / `parking_options` / `payment_options` / `reviews` / `google_maps_uri` (§2: no wizard surface exists — out of scope).
- **No `photo_collage_url` regeneration** (R-4): collage is consumed by seeding/intelligence only, `discover-cards` does not read it (inventory §2). Approve-time photo application leaves it stale exactly as create-new already does. Registered as a discovery, not built.
- **No `venue_reservation_settings` default change** (R-11: DEFAULT false is probe-locked by `20261003000007:62–78`). Google `reservable=true` becomes a pre-answered facet + nothing more.
- **No claim-search ranking changes**; rate limit stays 10/min.
- **No `rating`/`review_count` exposure** — the ban stays (see §4.A security note).
- **No cleanup of `VenueClaimStatusBanner.tsx`** (pre-1255 remnant, inventory §4) — DO-NOT-TOUCH; registered for a housekeeping ORCH.
- **No consumer-app (`app-mobile`) code changes.**

### Assumptions
- META-ORCH-1255 as-built is the baseline (venue_listings model, per-venue pipeline, COMMS-0064). Business delivery is **NATIVE BUILD ONLY** (COMMS-0052/0063) — nothing here may be OTA'd to the business production channel.
- `venue_listings` rows in prod = 0 (inventory Appendix A) — no data migration needed for the new write model.

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered? | Behavior demanded / reason not covered | Files touched there | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/`) | NOT covered | No consumer code path touches claim authoring; deck benefits passively (hours/gallery no longer corrupted pre-approve) | none | n/a |
| 2 | Consumer Android (`app-mobile/`) | NOT covered | same as #1 | none | n/a |
| 3 | Buyer/anon Web (`/b/{brandSlug}`, `/b/{slug}/v/{venueSlug}`) | NOT covered (behavioral no-op) | `venue_public_view` unchanged; verified-gating unchanged (§3.3) | none | automatic (no change) |
| 4 | Business iOS | **COVERED (primary)** | Full claim variant: claimed-state card, adoption prefill, category confirm, Photos & cover step, overnight hours, half-claim retry | `mingla-business/` allowlist §12 | automatic with #5 (shared RN code) |
| 5 | Business Android | **COVERED** | identical to #4 | same shared files | automatic (shared code; image picker + time picker per-platform paths already exist in `BrandHoursEditor`/gallery service) |
| 6 | Admin Web (`mingla-admin/`, adjacent) | COVERED server-side only | Approve now applies authored content before go-live (§4.A5); admin UI screens unchanged; review bundle unchanged | `supabase/functions/admin-review-venue-claim/` only | manual — edge fn only, no admin UI files |
| 7 | Business Web preview (adjacent) | COVERED by shared code, claims capped | Same RN-web wizard; authed biz-web runtime is unreachable for live proof (standing memory `feedback_biz_web_authed_runtime_unreachable_cap_claims`) — tester caps web claims at code-level + web export compile | same shared files | automatic (shared), verification capped |

---

## 4. Layered specification

### LEG A — server contract growth + mutation boundary

#### A1. Migration `supabase/migrations/20261202000000_orch_1263_claim_adoption.sql`

**Prefix collision protocol (COMMS-0051):** latest prefix on this branch is `20261130000005`. `20261202000000` is free locally. The implementor MUST re-scan at build time (`git fetch origin && git ls-tree -r origin/main --name-only supabase/migrations | sort | tail`) and bump the prefix if any `202612*` landed meanwhile. Apply to prod via the Management API from MERGED main at CLOSE only (standing rules; blind `db push` UNSAFE).

**A1.1 — `biz_search_place_pool_for_claim`: add `already_claimed`.**
Return type changes → `DROP FUNCTION IF EXISTS public.biz_search_place_pool_for_claim(text, int);` then re-CREATE (house precedent: 1255 M4 drop-then-create). The new definition is the `20260809000000:496–546` body **verbatim** plus exactly one output column:

```sql
EXISTS (SELECT 1 FROM public.venue_listings vl WHERE vl.place_pool_id = p.id) AS already_claimed
```

- Keep: `WHERE p.is_active = true`, ILIKE + escape, prefix-first ordering, `review_count DESC` tiebreak (ordering may keep using review_count internally — it is not RETURNED, unchanged from today), `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO service_role` **only**.
- `already_claimed` counts ANY `venue_listings` row pointing at the place (pending_review included) — matches the `venue_listings_place_uniq` truth (`20261130000000:74–75`): a pending claim by anyone blocks a second claim, so the UI must say so up front (D-C).

**A1.2 — NEW RPC `biz_get_place_adoption_detail(p_place_pool_id uuid)`.**
Single-row adoption payload, fetched only on explicit claim intent ("Yes, this is me"). RETURNS TABLE columns — the **complete adoption whitelist**:

- Identity/location: `id, name, address, city, country, lat, lng, google_place_id, primary_type, types`
- Hours: `opening_hours` (jsonb, Google shape)
- Photos: `stored_photo_urls` (**full array, uncapped** — the search payload stays capped at 6 via `photoUrlsFromRow`)
- Contact: `national_phone_number`
- Web: `website`
- Price: `price_tiers, price_level`
- Summary: `generative_summary, editorial_summary`
- Facets: the 23 `FACET_COLUMNS` exactly as defined at `run-business-place-authoring-pipeline/index.ts:18–42` (`serves_brunch, serves_lunch, serves_dinner, serves_breakfast, serves_beer, serves_wine, serves_cocktails, serves_coffee, serves_dessert, serves_vegetarian_food, outdoor_seating, live_music, good_for_groups, good_for_children, good_for_watching_sports, allows_dogs, has_restroom, reservable, menu_for_children, dine_in, takeout, delivery, curbside_pickup`)

Body constraints (binding):
```sql
WHERE p.id = p_place_pool_id
  AND p.is_active = true
  AND NOT EXISTS (SELECT 1 FROM public.venue_listings vl WHERE vl.place_pool_id = p.id)
```
Fail-close: an already-claimed or inactive place returns **zero rows** (the edge fn maps that to `place_not_available`). `SECURITY DEFINER`, `search_path` pinned, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO service_role` **only**. COMMENT states the whitelist rule and the forbidden set.

**RLS / security notes on this contract growth (mandatory per dispatch):**
- **What is newly exposed:** phone, website, price, both summaries, facet booleans, and the full photo array — for exactly ONE place per call, only behind an authed session (`requireUser`), only under the shared 10/min rate bucket, and only for places not yet claimed. This is Google-derived public directory data (all of it visible on Google Maps); the marginal exposure is bounded to ~10 places/min/user and is required for the claim walkthrough to show "what exists".
- **Why the SEARCH payload is NOT widened** (deviation from the dispatch's "likely" leg framing, with rationale): `claim-search-pool` runs with `fetch_all: true` and no row cap (`poolSearchService.ts:56–59`, RPC comment "p_limit is legacy and ignored"). Widening the per-row search whitelist would turn a 3-char ILIKE search into a bulk scraper of phone/website/summaries across 35k rows at 10 queries/min. The two-call shape (lean search + single-place detail on YES) delivers the identical product experience with a scrape surface ~3 orders of magnitude smaller. The search whitelist grows by exactly one boolean (`already_claimed`), which leaks only "someone claimed this" — already discoverable via the 23505 path today.
- **`rating` / `review_count` STAY FORBIDDEN** (dispatch: investigate intent before overriding). Provenance verified: the ban ships in the original Ve2 whitelist commit `c07de2a49` ("public-safe fields only (no scoring / bouncer / AI columns)") together with the AI/bouncer bans, and no later commit or migration relaxed it. It is a deliberate exposure boundary (internal quality signals + Google-derived ratings are not for business-facing bulk APIs — ToS-cautious and anti-gaming: operators must not shop for high-rating unclaimed places to squat). Both new response mappers MUST run `assertNoForbiddenKeys`; the adoption RPC does not select either column. `I-PROPOSED-1263-ADOPTION-PAYLOAD-WHITELISTED` (§6) locks this.

**A1.3 — no other DDL.** No new tables, no RLS policy changes. The `place_pool_business_owner_update` policy (`claimed_by = auth.uid()`, `20261130000003:1354–1388`, inventory §4) is untouched as a policy — but under the stage-only model `claimed_by` is no longer set until approve (§4.A3), so the operator's direct place-UPDATE grant now activates at approve instead of at submit. This closes a real pre-approval hole: today tier-1 hands the operator raw RLS UPDATE power over a LIVE place before any admin has looked at the claim.

#### A2. Edge fn `supabase/functions/claim-search-pool/index.ts` + `_shared/poolMatchResponse.ts`

- `PoolMatchRow`/`PoolMatchResult` gain `already_claimed: boolean` / `alreadyClaimed: boolean`; `rowToPoolMatch` maps it. `FORBIDDEN_RESPONSE_KEYS` unchanged.
- New types `PoolAdoptionDetailRow` / `PoolAdoptionDetail` + mapper `rowToAdoptionDetail(row)` in `poolMatchResponse.ts` (same file — it IS the whitelist module): camelCase mapping of §A1.2, `facets` folded into a `Record<string, boolean | null>` keyed by the 23 facet ids, `photoUrls` = full `stored_photo_urls` (http(s)-filtered, uncapped). Mapper output MUST pass `assertNoForbiddenKeys`.
- Request routing: body with `place_id` (uuid) → detail mode; body with `query` → search mode (unchanged). Detail mode: same `requireUser` + `checkRateLimit` (shared bucket), `place_id` must be a uuid (400 `invalid_place_id`), RPC `biz_get_place_adoption_detail`; zero rows → 404 `{ error: "place_not_available" }`; success → `{ detail: PoolAdoptionDetail }`.
- Error shapes stay the existing `{ error: string }` convention.

#### A3. Mutation boundary — `supabase/functions/run-business-place-authoring-pipeline/index.ts` (D-A, D-B, D-E)

**The mode rule (exported pure function, unit-tested):**
```ts
export function placeWriteMode(venueClaimStatus, placeAuthorBrandId): "apply" | "stage"
```
`"apply"` iff `venueClaimStatus === "verified"` **or** `placeAuthorBrandId !== null` (business-authored create-new row — owns its own never-served-until-approve row); else `"stage"`. A pre-approval CLAIM of a seeded place is always `"stage"`.

Plumbing: `loadOwnedVenue` select adds `claim_status`; `handleTier1`'s claim-branch place read (`:563–568`) adds `business_author_brand_id`; `handleSyncHeroMedia`/`handleConfirmAiOutputs`/`handleTier2` read the place row already (`select("*")`) or must fetch `business_author_brand_id` (sync_hero_media currently reads no place row — add a single-column read).

**A3.1 `handleTier1` claim-existing branch (`:558–611`) — stage mode:**
The `place_pool` update payload becomes EXACTLY:
```ts
{ business_authoring_status: "processing",
  business_hero_video_present: coverMediaType === "video",
  business_authoring_inputs: { tier1: draft, selected_place_pool_id, adoption: draft.adoption ?? null },
  business_gallery_urls: <staged kept-gallery, only when draft.adoptedGalleryUrls is a non-empty array> }
```
**Killed from the claim-path payload (D-A):** `opening_hours` overwrite (`:580`), `is_claimed: true`, `claimed_by: userId` (`:575–576`) — all three now happen at approve (§A5). `business_gallery_urls` staging is new: the operator's kept adopted photos (post keep/delete, Leg B) land in the staging column so tier-2 AI (`galleryUrls`, `:1253`) and deck-readiness resume (`gallery_urls`, `:1631`) work without touching `stored_photo_urls`. Staging columns (`business_*`) are confirmed non-serving: `discover-cards` reads none of them; `business_hero_video_present` is read only by `signalScorer` which runs at approve over authored state. Venue-row stamp (`place_pool_id`, `google_place_id`, `:590–597`), pipeline upsert (`linked_existing`), and response shape are unchanged. The create-new branch (`:614–685`) is byte-unchanged.

**A3.2 `handleSyncHeroMedia` (`:1646–1690`) — D-E for both paths:**
- `venue_listings.cover_media_*` write (`:1674–1683`): unchanged, always (venue row is the hero truth, 1255(C) D-C).
- `place_pool` write, stage mode: `{ business_hero_video_present: mediaType === "video" }` ONLY. Never `stored_photo_urls`.
- `place_pool` write, apply mode: replace the wipe (`stored_photo_urls: [mediaUrl]`, `:1662`) with the exported pure function:
```ts
export function nextStoredPhotosForHero(prior: string[], gallery: string[], hero: string | null): string[]
```
Contract: result = dedup(`[hero (when non-null), ...gallery, ...prior-entries-not-previously-hero]`) where "previously-hero" = prior entries not in `gallery` (mirror of `storedPhotosForDeck`'s hero detection, `:460`). Result length is NEVER < `gallery.length`; clearing the hero (`mediaUrl === ""`) yields `gallery ∪ prior-non-hero`, never `[]`. **The gallery is never wiped by a hero pick** (I-PROPOSED-1263-GALLERY-NEVER-WIPED-BY-HERO).

**A3.3 `handleConfirmAiOutputs` (`:1389–1505`) — stage mode:**
`place_pool` update payload becomes EXACTLY `{ business_authoring_inputs: mergedInputs, business_authoring_status: nextStatus, bouncer_reason, bouncer_validated_at }`. Omitted in stage mode: `generative_summary`, `is_servable` (prior true is preserved by not writing — stricter than the current identity-write), `website`, `price_tiers`, `price_level`, `stored_photo_urls`, facet columns. Apply mode: current behavior unchanged (`:1463–1481`). Status/coaching/pipeline-row logic unchanged in both modes.

**A3.4 `handleTier2` (`:1207–1387`) — stage mode:** omit the `website` write (`:1358`) and the `is_servable` write (prior true preserved by omission). Keep: `ai_signal_scores`, `photo_analysis`, `raw_google_data` (carries the claim-diff archive), `business_authoring_inputs`, `business_authoring_status`, `bouncer_reason/validated_at`, `business_recommend_edit_count` — all authoring/diagnostic state the admin review bundle needs, none serving-read.

**A3.5 `handleGetAuthoringContext` (`:1574–1644`) — cover truth fix (Q-1):** `cover_media_url` / `cover_media_type` in the response come from the VENUE row (`venue.cover_media_url/cover_media_type`, already selected by `loadOwnedVenue`), not from `storedPhotoUrls[0]` + `business_hero_video_present` inference (`:1624–1629`). Applies to both paths (create-new has written the venue cover since 1255(C)).

#### A4. Shared apply module `supabase/functions/_shared/authoredApply.ts` (NEW)

Exported, pure, unit-testable:
```ts
export function buildAuthoredApplyPatch(input: { place, venue, brandHours, ownerUserId }): Record<string, unknown>
```
Builds the approve-time patch from authored truth (the "1255 authored-precedence reads": venue row + venue-keyed brand_hours + `business_authoring_inputs`/`business_gallery_urls`):
- `opening_hours` = `normalizeBusinessHoursForPool(brandHours→BusinessHourRow[])` (import `_shared/businessHoursToGoogle.ts`; brand_hours `open_time/close_time` "HH:MM:SS" parse via `parseHm` — supported). Only when ≥1 brand_hours row exists; else omit key.
- `stored_photo_urls` = dedup(`[venue.cover_media_url (when set), ...business_gallery_urls]`) — same merge semantics as `storedPhotosForDeck`. Only when the union is non-empty; else omit.
- `generative_summary` = `business_authoring_inputs.confirmed_ai_outputs.sales_bio` when present; else omit (admin may approve before operator confirm — never blank a live summary).
- `price_tiers`/`price_level` from `business_authoring_inputs.tier2.price_tiers` via the same tier→level mapping as `priceTiersFromTier2`/`priceLevelFromTiers` (`index.ts:423–446`) — MOVE those two helpers + `PRICE_TIER_TO_GOOGLE_LEVEL` into `authoredApply.ts` and re-import in the pipeline fn (one owner, no drift). Omit when tier2 absent.
- facet columns from `confirmed_ai_outputs.facets` (filtered to the FACET_COLUMNS set — export that set from `authoredApply.ts` too, pipeline re-imports). Omit when absent.
- `website` = `tier2.website` when non-empty; else omit.
- `is_claimed: true`, `claimed_by: ownerUserId` (the venue's brand `account_id`).
- `raw_google_data` merge: extend `business_claim_diff.archived_google` with the PRE-application values of every key the patch overwrites (`hours`, `stored_photo_urls`, `generative_summary`, `price_tiers`, `price_level`, `website`, facets) — merged non-destructively over the tier-2 archive (`buildCrossValidation` `:1137–1148` archives name/address/website only today; this closes the "no archive and no restore path" gap, inventory §3.2). Never overwrite an existing `archived_google` key (first archive wins — it holds the Google original).

#### A5. `supabase/functions/admin-review-venue-claim/index.ts` — approve-time application (D-A)

New exported orchestration step `applyAuthoredContentOnApprove(admin, venueId): Promise<{applied: string[]}>`:
1. Read venue row (`brand_id, place_pool_id, cover_media_url, cover_media_type`), its brand's `account_id`, the venue's `brand_hours` rows, and the place row.
2. `buildAuthoredApplyPatch(...)` → single `place_pool` UPDATE.
3. Idempotent (re-approve after resubmit re-applies current authored truth — correct by design).

Call site + ordering (binding): inside the `approve` action, AFTER `biz_review_venue_claim('approve')` succeeds and the edit-count reset (`:590–597`), BEFORE `runApproveGoLive` — so the re-bounce (`:110–142`) and per-signal scoring run over the now-authored content ("re-bounce over CURRENT data" contract preserved, and `business_hero_video_present`'s scorer boost sees the authored hero). Run for every approve (create-new patch ≈ identity; idempotent). Application failure → return the structured error, do NOT proceed to go-live (fail-close: never serve a verified claim whose authored content failed to land).

**Approve/abandon semantics after this leg (D-A/D-B summary, binding):**
- Pre-submit abandon: zero server writes anywhere (adoption is a client-draft copy).
- Post-submit, pre-approve: venue row (`pending_review`) + staging columns only; `opening_hours`, `stored_photo_urls`, `generative_summary`, price, facets, `website`, `claimed_by`, `is_claimed` on the live place are byte-identical to pre-claim. Deleting/rejecting the claim needs no place restore.
- Approve: authored copy becomes canonical in one patch + archive; scorer re-runs; public venue surfaces light up via the unchanged `claim_status='verified'` gates (§3.3 of the inventory).

### LEG B — client claim variant (`mingla-business/`)

#### B1. Types + services
- `src/types/poolMatch.ts`: `PoolMatch` + `alreadyClaimed: boolean`; new `PoolAdoptionDetail` (camelCase mirror of §A1.2 incl. `facets: Record<string, boolean | null>`, `photoUrls: string[]`, `phone`, `website`, `priceTiers: string[]`, `generativeSummary`, `editorialSummary`, `reservable`).
- `src/services/poolSearchService.ts`: map `alreadyClaimed` (default false when absent — old fn version tolerance); new `fetchPlaceAdoptionDetail(placePoolId, {signal})` → claim-search-pool `{place_id}`; `place_not_available` throws a typed error the UI copy-maps.
- `src/services/venueListingsService.ts`: new `findOwnListingForPlace(brandId, placePoolId): Promise<VenueListing | null>` — own-RLS select on `venue_listings` `.eq(brand_id).eq(place_pool_id).maybeSingle()` (R-10 retry probe).

#### B2. Draft store `src/store/draftVenueStore.ts` — v3
- `DraftVenueState` gains:
```ts
claim: null | {
  adopted: { phone: string|null; website: string|null; priceTiers: string[]; facets: Record<string, boolean|null>;
             summary: string|null; summarySource: "generative"|"editorial"|null; galleryUrls: string[];
             categoryFromTypes: VenueCategory };          // immutable copy-on-start snapshot (D-B)
  keptGalleryUrls: string[];                              // gallery after keep/delete
  coverChoice: { url: string; type: "image"|"gif" } | null;
  categoryConfirmed: boolean;                             // D-F
}
```
- `photoUris` REMOVED (dead weight, §1.2 s5) — update `pickDraft`, `initial`, and the Review row (§B5).
- Persist name bump `…-draft-venue-v2` → `…-draft-venue-v3` (house precedent v1→v2, prod-safe: pre-submit drafts abandoned; `claim` must survive `activateBrand` stash/restore via `pickDraft`).
- `src/utils/prefillDraftFromPoolMatch.ts` → superseded by `prefillDraftFromAdoption(match: PoolMatch, detail: PoolAdoptionDetail): Partial<DraftVenueState>`: everything the current prefill does (`:14–28`, minus `photoUris`) PLUS `contactPhone` ← `detail.phone ?? ""`, `description` ← `detail.generativeSummary` when present (see Open Question OQ-2: `editorialSummary` is NEVER prefilled verbatim — it seeds only `claim.adopted.summary` with `summarySource:"editorial"` for AI context), `claim` block populated (`keptGalleryUrls` initialized = `galleryUrls`, `coverChoice: null`, `categoryConfirmed: false`). Hours prefill continues through `mapPoolOpeningHoursToBrandHours` (unchanged file — its overnight emission `22:00→02:00` is CORRECT once D-D lands; round-trips losslessly through `businessHoursToGoogleOpeningHours` which already emits `close.day = +1`).

#### B3. Gate + category confirm — `app/venue/create.tsx`, `src/components/brand/PoolMatchCard.tsx`
- **Claimed state front-loaded (D-C):** `PoolMatchCard` gains `alreadyClaimed` handling: when true — eyebrow "Already on Mingla", an "Already claimed" badge, NO "Yes, this is me" button; body copy: *"This place has already been claimed on Mingla. If this is your business, contact support from Home → Support."*; "No, different business" / "Skip" remain. A11y: badge text in `accessibilityLabel`.
- **On YES** (unclaimed): fetch `fetchPlaceAdoptionDetail` (button shows loading, card disabled while in flight); on success `patch(prefillDraftFromAdoption(match, detail))` → `setPhase("category")`. On `place_not_available`: swap the card to the claimed state (race backstop). On network error: inline retry copy *"Couldn't load your listing details. Try again."* — NEVER silently fall back to the lean prefill (partial adoption = half-truths).
- **Category confirm (D-F):** claim drafts enter the category phase with `venueCategory` pre-selected (97% land "restaurant" — fine per D-F) and claim copy: heading unchanged, sub *"We matched this as {label} — confirm or change it."* Continue → `patch({claim: {...claim, categoryConfirmed: true}})` → wizard. `goToCategory` (No/Skip) must clear `claim: null` alongside `placePoolId: null` (`:154–158`).
- `resolveInitialPhase` (`:41–55`): pool-linked draft resumes to `"wizard"` only when `claim === null` (legacy) or `claim.categoryConfirmed`; else `"category"`.

#### B4. Wizard claim variant — `src/components/venue/VenueCreatorWizard.tsx` + steps
- **Step model:** `export function venueWizardSteps(isClaim: boolean): StepperStep[]` — create: existing 6 (byte-stable order); claim: 7 — `Address · Name · Hours · Contact · Photos · Inputs · Review`. Step components keyed by step ID, not raw index; `venueStepError(stepId, d)` re-keyed to IDs (validation rules unchanged except D-D + the new photos rule). `TOTAL` derived from the array.
- **Per-step "already on Mingla" affordance (keep/edit/delete contract):** new tiny component `src/components/venue/AdoptedFieldBanner.tsx` — caption row (`typography.caption`, `textTokens.secondary`, existing tokens only): *"From your Mingla listing — check it, edit it, or clear it."* rendered at the top of steps whose fields were adopted (Address, Name, Hours, Contact, Inputs when prefilled). Keep = tap Continue untouched; edit = the fields themselves; delete = the fields' existing clear affordances (contact fields clearable; description clearable; hours per-day "Closed" toggle). No new per-field chrome beyond the banner — the wizard's fields ARE the keep/edit/delete surface; the Photos step carries true per-item delete. The generic pool banner (`:322–326`) is replaced by this per-step banner on the claim path (create path keeps current behavior).
- **NEW `src/components/venue/VenueStepClaimPhotos.tsx` (D-E — the one mandatory new decision):**
  - Data: `claim.adopted.galleryUrls` (grid, `EventCoverMedia` tiles, same 92px pattern as deck-readiness `:536–559`), `claim.keptGalleryUrls`, `claim.coverChoice`.
  - Interactions: per-photo remove (×, `hitSlop 8`, a11y "Remove photo") with removed tiles collapsing to an "Undo — restore N removed" row; tap a kept photo → sets `coverChoice {url, type:"image"}` (selected ring + "Cover" badge, a11y "Set as cover"/"Current cover"); "Upload a different cover" button → `pickGalleryPhotos(1)` + `uploadGalleryPhoto(brandId, asset)` (brand-scoped storage works pre-submit) → sets `coverChoice` and appends to `keptGalleryUrls`. Upload busy/error states mirror deck-readiness gallery copy. Video hero is NOT offered pre-submit (post-submit "Change hero cover" CoverPickerSheet still supports video) — see OQ-3.
  - States: empty adopted gallery (0 seeded photos — impossible per Appendix A 100% coverage, but defensive): copy *"No photos yet — upload a cover to continue."* + upload button.
  - Validation (`venueStepError`): claim path requires `coverChoice !== null` → error *"Pick a cover photo — it's what customers see first."* No minimum on kept gallery (deck-readiness still enforces GALLERY_MIN before "Recommend me").
- **Hours step (D-D):** `venueWizardValidation.ts` case 2 — same-day AND overnight ranges valid; ONLY `o === c` rejected: *"Open and close can't be the same time. For 24 hours use 00:00–23:59; overnight hours like 10pm–2am are supported."* `VenueSettingsModule.tsx` `hoursInvalid` gets the identical rule (`o >= c` → `o === c`). `BrandHoursEditor.tsx`: when `closeTime < openTime` on an open day, render a caption "closes next day" on that row (existing caption typography). Slot-engine note (declared limitation, NOT built): `biz_derive_service_periods_from_brand_hours` copies `start/end` verbatim (`20261130000002:253–272`); an overnight derived period may yield zero reservation slots until the operator authors explicit periods in the reservations module — reservations default OFF (R-11), acceptable; registered as a discovery for the reservations ORCH space.
- **Submit (`handleSubmit`, `:129–253`) — claim deltas:**
  1. **Half-claim retry (D-C / R-7):** when `st.placePoolId !== null`, call `findOwnListingForPlace(currentBrand.id, st.placePoolId)` FIRST. Row found → skip `createVenue`, reuse `venueId`, proceed to `upsertTier1Place` (RPC-side inserts are conflict-safe to skip: hours/pipeline rows already exist; pipeline upsert is `ON CONFLICT (venue_id)`). Row found AND its pipeline `tier1_completed_at` set (via `fetchVenuePipelineState`) → route straight to deck-readiness resume (`/venue/deck-readiness?brand_id=…&venue_id=…`). The foreign-claim 23505 support copy (`venueListingsService.ts:160–171`) remains as the backstop (D-C).
  2. `createVenue` call gains `coverMediaUrl: claim?.coverChoice?.url ?? null`, `coverMediaType: claim?.coverChoice?.type ?? null` (RPC already persists venue cover; today hardcoded null `:199–200`).
  3. `upsertTier1Place` draft gains `coverMediaUrl/coverMediaType` (same values) and, on claim, `adoptedGalleryUrls: claim.keptGalleryUrls` + `adoption: {source: "place_pool", adoptedAt, summarySource}` (provenance, R-5 — rides `business_authoring_inputs`).
  4. `createdVenue` state carries `{coverChoice, keptGalleryUrls, adoptedTier2}` where `adoptedTier2 = {website: adopted.website, price_tiers: adopted.priceTiers (filtered to chill/comfy/bougie/lavish), vibe_chips: []}` and adopted facets → so the deck-readiness handoff pre-fills (next bullet).
- **Deck-readiness handoff (wizard leg):** `VenueDeckReadinessSetup` receives `initialCover` (= coverChoice), `initialGallery` (= keptGalleryUrls), `initialTier2` (= adoptedTier2), `initialFacets` (= adopted facets, pre-answered incl. `reservable` from Google, R-11-safe). The component already supports every one of these props (`:72–78`) — **no state-model change**, only the wizard passing real values instead of defaults. Resume path (`app/venue/deck-readiness.tsx`) works via server truth: staged `business_gallery_urls` → `gallery_urls`, venue-row cover (§A3.5), staged tier2. One addition to `VenueDeckReadinessSetup`: on claim first-mount the staged gallery is already server-persisted (tier-1), so no extra sync fires; `handleCoverChange`/gallery handlers unchanged (server-side mode rule makes them safe).

#### B5. Review step — `src/components/venue/VenueStep7Review.tsx`
Replace the dead "Photos: N selected" row (`:49–52`, fed by removed `photoUris`): claim path → "Photos: N kept · cover chosen"; create path → row omitted. Claim path adds a summary line *"Submitting sends your listing for review. Your live page stays exactly as it is until it's approved."* (D-A made this TRUE — the copy is the user-facing contract).

### LEG C — tests & gates (detail in §7/§9)

---

## 5. Success criteria (numbered, testable)

- **SC-1 (D-C front-load):** searching a name whose place has ANY `venue_listings` row shows the match card in the "Already claimed" state with no "Yes, this is me" button. Server: `already_claimed=true` in the search response.
- **SC-2 (adoption fetch):** tapping "Yes, this is me" on an unclaimed match loads the adoption detail; the draft then contains phone (when 51.1%-present), summary (generative only), hours, category, gallery URLs, and the claim block — with zero server writes (D-B: verified by DB diff = no change).
- **SC-3 (D-F):** the claim path always shows the category phase pre-selected; Continue records `categoryConfirmed`; the wizard is unreachable on a claim draft without it.
- **SC-4 (D-D):** a claim of a place with `22:00→02:00` hours passes step Hours with zero edits; the same range saves in venue Settings post-approve. `open === close` is rejected with the new copy in both.
- **SC-5 (D-E):** the Photos step blocks Continue until a cover is chosen; per-photo remove/undo works; upload-cover works; removing photos never mutates the server pre-submit.
- **SC-6 (D-A submit):** after claim submit (tier-1 success), the live place row's `opening_hours`, `stored_photo_urls`, `generative_summary`, `price_tiers`, `price_level`, `website`, facet columns, `claimed_by`, `is_claimed` are byte-identical to pre-claim; `business_authoring_status/inputs` + `business_gallery_urls` (staged kept gallery) are set; the venue row is `pending_review` with the chosen cover; the deck card renders unchanged.
- **SC-7 (D-A deck-readiness):** hero pick and gallery edits pre-approve write venue cover + `business_*` columns only; `stored_photo_urls` untouched; "Recommend me" + confirm reach `deck_eligible` without touching any serving column (stage-mode payload key-sets exact per §A3.3/§A3.4).
- **SC-8 (D-A approve):** admin approve applies authored hours/photos/summary/price/facets/website + `claimed_by`/`is_claimed` in one patch, archives pre-application values under `raw_google_data.business_claim_diff.archived_google`, then re-bounces + scores over authored content; `venue_public_view` serves the venue; deck card now shows authored content.
- **SC-9 (D-E apply-mode hero):** post-approve (and on create-new), changing the hero yields `stored_photo_urls` ⊇ gallery ∪ {hero}; clearing the hero never empties the array while a gallery exists.
- **SC-10 (D-C retry):** after a forced tier-1 failure post-RPC, re-tapping Submit as the SAME brand resumes (no 23505, no support copy) and completes; a DIFFERENT brand gets the claimed-state card at search (SC-1) and the support copy at the 23505 backstop.
- **SC-11 (whitelist):** search + detail responses contain no forbidden key (`rating`, `review_count`, ai/bouncer columns); the detail RPC returns zero rows for claimed/inactive places.
- **SC-12 (regression):** the create-from-scratch path is behaviorally unchanged (6 steps, same order, same writes — pipeline behavioral tests green).

Business iOS + Android parity is automatic (shared code); SC-1..5 must be smoke-tested on the iOS simulator; Android spot-check SC-4/SC-5 (time picker + image picker platform paths). Web preview: compile + code-level only (§3 row 7).

## 6. Invariants

**Preserved (existing):** I-NO-CLAIM-DEMOTION (`nextIsServableForConfirm` untouched; stage mode strengthens it by not writing `is_servable` at all — test T-A6); I-NET-NEW-HOLD (create-new unchanged); I-PROPOSED-1255-NO-HIDDEN-BRAND-ON-VENUE-CREATE (no brands writes anywhere here; stub untouched); I-PROPOSED-1255-VENUE-APPROVAL-PER-VENUE-ROW (state machine untouched; approve handler addition is content application, not state); I-PROPOSED-1255-PER-VENUE-OPS-NO-SHARED-INVENTORY (no pipeline keying changes); I-PROPOSED-1255-PUBLIC-VENUE-PAGE-ANON-SAFE (view untouched); ORCH-1079 §3.C googlePlaceId edit-lock (Step-1 untouched); I-CATEGORY-SLUG-CANONICAL (mapper unchanged).

**NEW — all DRAFT (orchestrator flips ACTIVE at CLOSE):**
1. **I-PROPOSED-1263-NO-LIVE-PLACE-MUTATION-PRE-APPROVE** — on the claim path (`placeWriteMode === "stage"`), no pipeline action writes a serving-read `place_pool` column (`opening_hours, stored_photo_urls, generative_summary, price_tiers, price_level, website, facet columns, is_servable, name, address, lat, lng`) nor `claimed_by`/`is_claimed`. Enforcement: T-A1..T-A6 payload key-set tests + gate G-1.
2. **I-PROPOSED-1263-CLAIM-ADOPTION-COPY-ON-START** — adoption is a client-draft copy at YES; pre-submit abandon = zero server writes. Enforcement: T-B2 (prefill is pure), T-E2 (no fetch-side writes: detail RPC is `STABLE`, SQL test asserts `provolatile='s'`).
3. **I-PROPOSED-1263-GALLERY-NEVER-WIPED-BY-HERO** — `nextStoredPhotosForHero` result ⊇ gallery; the literal one-element write is banned. Enforcement: T-A4 + gate G-1 token ban.
4. **I-PROPOSED-1263-CLAIMED-STATE-FRONT-LOADED** — search response carries `already_claimed`; the card blocks YES on it; 23505 copy remains backstop-only for foreign brands; same-brand retry resumes. Enforcement: T-B5/T-B6 + SQL T-D1 + gate G-2.
5. **I-PROPOSED-1263-ADOPTION-PAYLOAD-WHITELISTED** — `rating`/`review_count` + AI/bouncer columns never appear in claim-search or adoption-detail responses; detail is single-place, authed, rate-limited, fail-closed on claimed. Enforcement: T-E1 (adversarial mapper test) + SQL T-D2 (functiondef scan).
6. **I-PROPOSED-1263-OVERNIGHT-HOURS-VALID** — both hours validators accept `close < open`, reject only `open === close`. Enforcement: T-B3 + gate G-2 token ban on the `o >= c` predicate in the two files.

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-A1 | tier-1 claim stage-mode payload (happy) | fake client, `selected_place_pool_id` set, venue pending_review, place author-null | place update key-set EXACTLY §A3.1; no `opening_hours`/`claimed_by`/`is_claimed` | edge (deno, `run-business-place-authoring-pipeline/__tests__/orch_1263_stage_only_claim.test.ts`) |
| T-A2 | tier-1 create-new unchanged (regression) | `selected_place_pool_id` null | insert payload byte-compatible with today (existing `pipeline_behavioral.test.ts` stays green) | edge |
| T-A3 | sync_hero_media stage mode | claim venue pending_review | place update = `{business_hero_video_present}` only; venue cover written | edge |
| T-A4 | `nextStoredPhotosForHero` (happy/edge/error) | (prior=[g1..g5+oldHero], gallery, hero=new) / (hero=null) / (prior=[]) | ⊇ gallery always; never `[hero]` alone with non-empty gallery; `[]` only when all empty | edge pure |
| T-A5 | confirm stage-mode payload | claim pending_review, servable place | update key-set EXACTLY §A3.3; `is_servable` ABSENT; place `generative_summary` unchanged | edge |
| T-A6 | tier-2 stage mode preserves servable by omission | prior `is_servable=true` | no `is_servable` key; no `website` key | edge (extends `meta_orch_1062_no_demotion.test.ts` family) |
| T-A7 | `placeWriteMode` matrix | (verified, null)/(pending, null)/(pending, author-set)/(verified, author-set) | apply/stage/apply/apply | edge pure |
| T-C1 | `buildAuthoredApplyPatch` full (happy) | confirmed inputs + hours + gallery + cover | patch has all §A4 keys; archive holds pre-values; first-archive-wins on re-approve | shared (`_shared/__tests__/authoredApply.test.ts`) |
| T-C2 | apply patch partial (edge) | no confirmed_ai_outputs, no tier2 | summary/price/facets/website keys ABSENT; hours/photos/claimed_by present | shared |
| T-C3 | approve ordering (error) | apply step throws | approve returns structured error; `runApproveGoLive` NOT invoked | edge (admin fn test, fake client) |
| T-D1 | search RPC `already_claimed` | seeded place ± venue row | flag flips with row existence incl. pending_review | SQL (`supabase/migrations/orch_1263_claim_adoption.test.sql`) |
| T-D2 | detail RPC contract | claimed place / inactive place / unclaimed | zero rows / zero rows / full row; `pg_get_functiondef` contains no `rating`/`review_count`/`ai_` selects; grants = service_role only; `provolatile='s'` | SQL |
| T-E1 | forbidden-key mappers (adversarial) | row objects carrying `rating`/`review_count`/`ai_confidence` | `assertNoForbiddenKeys` throws for BOTH `rowToPoolMatch` and `rowToAdoptionDetail` outputs when polluted | edge (poolMatchResponse test) |
| T-E2 | detail mode auth/limit/errors | no auth / rate exceeded / bad uuid / claimed | 401 / 429 / 400 `invalid_place_id` / 404 `place_not_available` | edge |
| T-B1 | `venueWizardSteps` + step-id validation | claim vs create | 7 vs 6 steps, IDs stable, create order byte-identical | jest (`mingla-business/__tests__/orch1263ClaimAdoption.happy.test.tsx`) |
| T-B2 | `prefillDraftFromAdoption` | detail with all fields / editorial-only summary | claim block populated; `description` empty on editorial-only (`summarySource:"editorial"`) ; pure (no IO) | jest |
| T-B3 | overnight validation both files | 22:00→02:00 / 09:00→09:00 / 09:00→17:00 | valid / rejected(new copy) / valid — in `venueStepError` AND `hoursInvalid` | jest |
| T-B4 | Photos step gating | no coverChoice / chosen / all photos removed | Continue blocked / enabled / upload-cover fallback shown | jest render |
| T-B5 | claimed-state card | `alreadyClaimed:true` | no YES button; badge + support copy rendered | jest render |
| T-B6 | half-claim resume branch | `findOwnListingForPlace` returns row (tier1 not done / done) | createVenue skipped, tier-1 reinvoked with same venueId / routed to deck-readiness | jest (service mocked) |
| T-B7 | category confirm gating | claim draft, unconfirmed | `resolveInitialPhase` → category; confirmed → wizard | jest |

## 8. Implementation order

1. **Migration** `20261202000000_orch_1263_claim_adoption.sql` (§A1) + SQL tests T-D1/T-D2.
2. **`_shared/authoredApply.ts`** (§A4, moving the price helpers + FACET_COLUMNS export) + T-C1/T-C2.
3. **Pipeline edge fn** (§A3: `placeWriteMode`, tier-1 stage branch, hero/gallery/confirm/tier-2 stage modes, context cover fix) + T-A1..T-A7; re-point pipeline imports at `authoredApply.ts`.
4. **`admin-review-venue-claim`** (§A5) + T-C3.
5. **`poolMatchResponse.ts` + `claim-search-pool`** (§A2) + T-E1/T-E2.
6. **Client types/services** (§B1), **draft store v3 + prefill** (§B2) + T-B2.
7. **Gate/category/card** (§B3) + T-B5/T-B7.
8. **Wizard variant + Photos step + hours fix + review step** (§B4/§B5) + T-B1/T-B3/T-B4/T-B6.
9. **Strict-grep gates G-1/G-2** (§9) registered in `.github/workflows/strict-grep-mingla-business.yml`, each with `--self-test` + GOOD/BAD fixtures.
10. Edge deploys (`run-business-place-authoring-pipeline`, `claim-search-pool`, `admin-review-venue-claim`) + migration apply happen at CLOSE from merged main per standing rules (orchestrator-owned; one-curl verify per fn).

## 9. Regression prevention (fails-on-revert contracts)

- **G-1 `.github/scripts/strict-grep/orch-1263-claim-stage-only-preapprove.mjs`:** FAILS when, in `run-business-place-authoring-pipeline/index.ts`: (a) the token `opening_hours: normalizeBusinessHoursForPool` appears more than ONCE (the create-new insert is the only legal site — reverting the tier-1 claim overwrite re-adds the second site); (b) any `stored_photo_urls:` write of a fresh one-element array from `mediaUrl` exists (`stored_photo_urls: mediaUrl` / `[mediaUrl]` token family); (c) `handleSyncHeroMedia` body lacks the call token `nextStoredPhotosForHero(`; (d) the tier-1 claim branch contains `claimed_by:` or `is_claimed:` (scoped: between the `selectedPlacePoolId !== null` guard and the `claim_path: "existing"` return). Self-test with GOOD (current fixed source) + BAD (reverted snippet) fixtures.
- **G-2 `.github/scripts/strict-grep/orch-1263-claim-front-load-and-overnight.mjs`:** FAILS when (a) `PoolMatchCard.tsx` lacks the `alreadyClaimed` token; (b) the search-RPC migration's CREATE lacks `already_claimed`; (c) `venueWizardValidation.ts` or `VenueSettingsModule.tsx` contains the reverted predicate token `o >= c`.
- **Behavioral fails-on-revert:** every T-A/T-C test asserts exact payload KEY-SETS — reverting any stage-mode change reintroduces a key and fails the test; T-A4/T-B3 fail on the exact reverted logic. Each new test file carries a header comment naming the invariant + "must FAIL when the D-A/D-E/D-D change is reverted". Test files are append-only per the standing CLOSE gate; existing pinned tests (`pipeline_behavioral`, `meta_orch_1062_no_demotion`, `metaOrch1255*`) must stay green untouched (SC-12).
- **Protective comments:** each killed write site gets a `// I-1263-…: <why>` comment naming the invariant (G-1 tokens do the enforcing; comments carry the why).

## 10. Open questions (for Seth — defaults bind if unanswered)

- **OQ-1 (support CTA copy):** claimed-state card says "contact support from Home → Support" (the 1104 live-chat). OK, or deep-link the support screen from the card?
- **OQ-2 (editorial summary, inventory Q-2):** default bound here = Google-authored `editorial_summary` is never pre-filled verbatim into the operator's description; it only seeds AI context. Generative (our own AI) summaries DO pre-fill. Confirm or loosen.
- **OQ-3 (video cover pre-submit):** claim Photos step offers image covers only; video hero remains available immediately after submit via deck-readiness. Acceptable for v1?
- **OQ-4 (design polish):** this SPEC binds behavior/states/copy/a11y reusing the wizard's existing visual system (tokens, GlassCard, EventCoverMedia tiles); no pixel-precise mingla-designer pass was commissioned by the dispatch. If Seth wants one, route designer → SPEC amendment before implement.

## 11. Downstream routing

- **Next:** `mingla-implementor` in THIS worktree (`~/Desktop/mingla-orchs/orch-1263-[claim-adoption]/`, branch `orch-1263-claim-adoption`), implementation order §8, stop-and-amend on any allowlist breach. NO edge deploy / NO migration apply / NO OTA from the worktree (business = native-build-only, COMMS-0052/0063).
- **Then:** `mingla-tester` — adversarial pass over SC-1..SC-12 + the Raleigh acceptance script (§13); sim-first (3 sims + operator iPhone rules), live-fire the SQL RPCs (headless QA insufficient per standing memory).
- **Then:** orchestrator CLOSE — merge-gate (ALL checks green), Management-API migration apply + 3 edge deploys from merged main, one-curl verify each, invariant flips DRAFT→ACTIVE, registry row removal, worktree reap.

## 12. Scoped allowlist + DO-NOT-TOUCH

**Allowlist (the implementor may modify/create ONLY these):**

Server: `supabase/migrations/20261202000000_orch_1263_claim_adoption.sql` (new) · `supabase/migrations/orch_1263_claim_adoption.test.sql` (new) · `supabase/functions/_shared/poolMatchResponse.ts` · `supabase/functions/_shared/authoredApply.ts` (new) · `supabase/functions/claim-search-pool/index.ts` (+ its `__tests__/`, new) · `supabase/functions/run-business-place-authoring-pipeline/index.ts` (+ `__tests__/orch_1263_stage_only_claim.test.ts` new) · `supabase/functions/admin-review-venue-claim/index.ts` (+ `__tests__/` new) · `supabase/functions/_shared/__tests__/authoredApply.test.ts` (new).

Client (`mingla-business/`): `src/types/poolMatch.ts` · `src/services/poolSearchService.ts` · `src/services/venueListingsService.ts` · `src/services/businessPlaceAuthoringService.ts` (tier-1 input type + adoption fields only) · `src/store/draftVenueStore.ts` · `src/utils/prefillDraftFromPoolMatch.ts` (rename/supersede to `prefillDraftFromAdoption`) · `app/venue/create.tsx` · `src/components/brand/PoolMatchCard.tsx` · `src/components/venue/VenueCreatorWizard.tsx` · `src/components/venue/venueWizardValidation.ts` · `src/components/venue/VenueStepClaimPhotos.tsx` (new) · `src/components/venue/AdoptedFieldBanner.tsx` (new) · `src/components/venue/VenueStep7Review.tsx` · `src/components/venue/VenueDeckReadinessSetup.tsx` (prop pass-through only) · `src/components/venue/BrandHoursEditor.tsx` (next-day caption only) · `src/components/venue/VenueSettingsModule.tsx` (`hoursInvalid` predicate only) · `__tests__/orch1263ClaimAdoption.happy.test.tsx` (new).

Gates: `.github/scripts/strict-grep/orch-1263-claim-stage-only-preapprove.mjs` (new) · `.github/scripts/strict-grep/orch-1263-claim-front-load-and-overnight.mjs` (new) · `.github/workflows/strict-grep-mingla-business.yml` (register only).

**DO-NOT-TOUCH (stop-and-amend required):** `supabase/functions/_shared/businessHoursToGoogle.ts` (already overnight-correct) · `_shared/mapMinglaSlugToVenueCategory.ts` · `src/utils/mapPoolOpeningHoursToBrandHours.ts` · `discover-cards/**` · `venue_public_view` / any 1255 migration file · `biz_review_venue_claim` / review RPC bodies · `VenueClaimStatusBanner.tsx` · `VenueStep1Address.tsx` (ORCH-1079 lock) · `VenueStep2NameSlug/4Hours/5Contact/6Description` beyond banner insertion points (banner mounts from the wizard, not inside the steps — if a step file must change, amend first) · `venue_reservation_settings` defaults / `20261003000007` probe · brands table / brandsService · all `app-mobile/**` · all pinned test files (append-only) · `biz_create_venue_listing` RPC body (cover params already exist; no SQL change needed — if one becomes needed, amend).

## 13. Acceptance criteria — the Raleigh script (tester-owned, binding)

Target: one REAL servable Raleigh place (pick from prod: `is_active AND is_servable AND stored_photo_urls≥5 AND opening_hours IS NOT NULL AND national_phone_number IS NOT NULL AND city ILIKE 'raleigh'`; prefer a `drinks_and_music` one with overnight hours to exercise D-D).

1. **Pre-test snapshot (mandatory):** `SELECT to_jsonb(p.*) FROM place_pool p WHERE id = :target` saved to the test report + `CREATE TABLE IF NOT EXISTS _orch1263_test_snapshots AS SELECT now() at, p.* FROM place_pool p WHERE id = :target` (or insert). Also snapshot: zero `venue_listings` rows for the place.
2. Business app (dev build, test brand): type the place name → match card shows photos/name/address, NOT "Already claimed". Tap YES → category pre-selected → confirm → walk all 7 steps: verify hours/phone/summary pre-filled (overnight day passes untouched), delete one adopted photo, pick a cover from the gallery, submit.
3. **DB assert (SC-6):** live row serving columns byte-identical to the snapshot; staging columns set; venue row `pending_review` with cover; consumer deck card for the place renders identically (spot-check via discover-cards or the consumer sim).
4. Deck-readiness: website/price/facets pre-filled; add photos to ≥5 if needed; Recommend me → edit pitch → Approve & publish. **Re-assert serving columns still identical** (SC-7).
5. Second test brand: search the same place → "Already claimed" card (SC-1). Direct RPC attempt → 23505 copy (backstop).
6. Half-claim drill (SC-10): on a SECOND target place, force tier-1 failure (airplane-mode after RPC), relaunch, resubmit → resumes without support copy. Snapshot+revert this place too.
7. Admin approve (Seth or admin session): mark_called → approve. **DB assert (SC-8):** authored application landed, archive present, place servable, `venue_public_view` row live; reservations: open the venue Reservations module, toggle on, confirm a slot renders (overnight-period caveat §B4 noted if slots empty — author one explicit period).
8. **Full revert protocol (mandatory, from snapshots):** `UPDATE place_pool SET (…) = (snapshot values incl. opening_hours, stored_photo_urls, generative_summary, price_tiers, price_level, website, facets, claimed_by, is_claimed, business_* columns, raw_google_data, ai_signal_scores, bouncer_*) WHERE id = :target;` delete in order: `venue_reservation_settings`/`venue_availability_config` rows for the venue, `brand_place_pipeline_state` (venue), venue-keyed `brand_hours`, `place_scores` rows created at approve for the place (re-scored at approve — restore is delete + note), `venue_listings` row(s); re-run the snapshot SELECT and diff = empty. Repeat for the half-claim place. Test brands cleaned per tester SOP.

---

*SPEC complete per the 11-section contract; §12/§13 bind the allowlist and acceptance. Implementor builds without questions; anything outside the allowlist requires a SPEC amendment first.*
