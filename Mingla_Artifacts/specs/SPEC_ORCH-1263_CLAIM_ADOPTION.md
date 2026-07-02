# SPEC — ORCH-1263 [claim-adoption]: claim a seeded venue via the create-wizard CLAIM VARIANT

- **Phase:** SPEC (binding build contract — no implementation here) — **v2, embeds the design contract**
- **Date:** 2026-07-02 · **Branch:** `orch-1263-claim-adoption` · **Worktree:** `~/Desktop/mingla-orchs/orch-1263-[claim-adoption]/`
- **Author:** mingla-forensics
- **Evidence base:** `Mingla_Artifacts/reports/INVENTORY_ORCH-1263_CREATE_VS_CLAIM.md` (commit `e0e4a09c1`) — findings cited by §/F-/R-/Q- IDs. Ratified decisions cited **D-A..D-F** (orchestrator dispatch, final).
- **Design contract (EMBEDDED, binding for all UI/copy/motion/a11y):** `Mingla_Artifacts/specs/DESIGN_ORCH-1263_CLAIM_WALKTHROUGH.md` (commit `3abffeada`) — cited as **DESIGN §N**. Where this SPEC and the DESIGN state the same surface, the DESIGN owns pixels/copy/motion; this SPEC owns data contracts, write boundaries, validation, and tests. Deltas from the DESIGN are called out explicitly (there are two: §4.B0 note on D-F, §4.B4 reorder-input decision).
- **Product intent (Seth-confirmed):** claiming a seeded venue reuses the create-venue wizard as a CLAIM VARIANT: every step pre-filled with what exists (photos/hours/summary/contact/price/category), keep/edit/delete per item, cover chosen from the adopted gallery (or upload) — the one mandatory new decision; same approval pipeline unchanged; pending-admin-approval stays a card state.

---

## 1. Executive summary

Today "Yes, this is me" pre-fills only name/address/pin/category/hours and throws away the rest of the seeded listing (inventory §1.1/§1.2). Three live-place hazards fire pre-approval: the wizard's hours overwrite the live deck hours at submit (`run-business-place-authoring-pipeline/index.ts:580`), a hero pick wipes the seeded gallery to `[hero]` (R-1: `index.ts:1662`), and overnight venues can't pass the hours step (R-2: `venueWizardValidation.ts:32–34`).

This build ships the **adoption layer** on the existing machinery (inventory: "no new pipeline needed", §1.3/§3.1):

- **Leg A (server):** claim-state + presence facts on claim search, a single-place **adoption-detail** contract, a **stage-only pre-approval write model** for the claim path (D-A), an **approve-time application** of authored content (D-A), non-destructive hero semantics (D-E). One migration, three edge fns touched.
- **Leg B (client):** the DESIGN's 10-step claim walkthrough (c0–c9) with copy-on-start adoption (D-B), provenance chips, category confirm (D-F), cover chooser (D-E), claimed-state blocked at the gate + same-brand half-claim retry (D-C), overnight hours accepted (D-D).
- **Leg C (tests/gates):** behavioral fails-on-revert tests per layer, SQL contract tests, 2 strict-grep CI gates, 6 DRAFT invariants.

Approval pipeline, card states, and the admin state machine are **unchanged** (inventory §3.1; META-ORCH-1255 D-4; DESIGN §8.1 "adds zero states to it").

---

## 2. Scope & non-goals

### In scope
1. Everything in §1, bounded to the allowlist (§12).
2. Kill the dead `photoUris` draft field (inventory §1.2 s5) as part of the draft-store reshape.
3. `get_authoring_context` cover truth fix (inventory Q-1: `cover_media_url = stored_photo_urls[0]` fake at `index.ts:1624`) — venue row is the cover truth per 1255(C) D-C.
4. Overnight acceptance in BOTH validators (`venueWizardValidation.ts` AND the identical `o >= c` rule in `VenueSettingsModule.tsx:251–261`). Declared D-D extension: a claimed late-night venue must also be able to SAVE its real hours post-approve in Settings — same one-line predicate, both files.

### Non-goals (explicit)
- **No approval-pipeline state changes** (§3.1; the approve HANDLER gains one content-application step, §4.A5 — the machine does not change).
- **No multi-period-per-day hours** (mapper keeps first-period-wins; DESIGN §6.3's honest closed-day display covers the spill day).
- **No 24-hour venues** (`open == close` rejected — DESIGN §6.3 "out of scope").
- **No adoption surface for** `accessibility_options` / `parking_options` / `payment_options` / `reviews` / `google_maps_uri` (inventory §2: no wizard surface exists).
- **No `photo_collage_url` regen** (R-4: not read by `discover-cards`; stale-collage parity with create-new; registered as a discovery).
- **No `venue_reservation_settings` default change** (R-11 probe-locked; DESIGN §6.9 "the design never fights it" — switch always starts OFF).
- **No claim-search ranking changes**; rate limit stays 10/min.
- **No `rating`/`review_count` VALUE exposure** — the ban stays; presence-only booleans allowed (§4.A1 security note).
- **No cleanup of `VenueClaimStatusBanner.tsx`** (pre-1255 remnant, inventory §4) — DO-NOT-TOUCH; registered for housekeeping.
- **No consumer-app (`app-mobile`) code changes.** No full pointer-drag reorder dependency (§4.B4 decision).

### Assumptions
META-ORCH-1255 as-built is the baseline (COMMS-0064). Business delivery is **NATIVE BUILD ONLY** (COMMS-0052/0063) — nothing here ships via `eas update` to the business production channel. `venue_listings` prod rows = 0 (inventory Appendix A) — no data migration.

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered? | Behavior / reason | Files | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS | NOT covered | no consumer code path; deck benefits passively (no more pre-approve corruption) | none | n/a |
| 2 | Consumer Android | NOT covered | same as #1 | none | n/a |
| 3 | Buyer/anon Web | NOT covered (no-op) | `venue_public_view` + verified gates unchanged | none | automatic |
| 4 | Business iOS | **COVERED (primary)** | full claim walkthrough per DESIGN §0–§10 | allowlist §12 | automatic w/ #5 |
| 5 | Business Android | **COVERED** | identical + DESIGN §9 opaque-glass/platform deltas | same files | automatic (per-platform arms exist) |
| 6 | Admin Web (adjacent) | COVERED server-side only | approve applies authored content (§4.A5); admin UI byte-identical (DESIGN §0 row 4) | `admin-review-venue-claim` only | manual — edge only |
| 7 | Business Web preview (adjacent) | COVERED by shared code; claims capped | DESIGN §9 web deltas (numbered stepper, fade transitions, 720 col, keyboard move-menu); authed biz-web runtime unreachable → tester caps at code-level + web export compile | same shared files | automatic, verification capped |

---

## 4. Layered specification

### LEG A — server contract growth + mutation boundary

#### A1. Migration `supabase/migrations/20261202000000_orch_1263_claim_adoption.sql`

**Prefix collision protocol (COMMS-0051):** latest prefix on branch = `20261130000005`; `20261202000000` free locally. Implementor MUST re-scan at build time (`git fetch origin && git ls-tree -r origin/main --name-only supabase/migrations | sort | tail`) and bump if `202612*` landed. Apply to prod via Management API from MERGED main at CLOSE only.

**A1.1 — `biz_search_place_pool_for_claim`: presence facts + claim state (DESIGN §0 server-contract note, §4.1, §4.3/§4.4).**
Return type changes → `DROP FUNCTION IF EXISTS public.biz_search_place_pool_for_claim(text, int);` re-CREATE with the `20260809000000:496–546` body verbatim PLUS these output columns (booleans/counts only — scrape-safe):

```sql
(p.opening_hours IS NOT NULL)                        AS has_hours,
(p.national_phone_number IS NOT NULL)                AS has_phone,
(p.website IS NOT NULL)                              AS has_website,
(p.rating IS NOT NULL)                               AS has_rating,        -- presence ONLY; value stays banned
coalesce(array_length(p.stored_photo_urls, 1), 0)    AS photo_count,       -- full count (search photoUrls stay capped 6)
CASE WHEN EXISTS (SELECT 1 FROM public.venue_listings vl
                  WHERE vl.place_pool_id = p.id AND vl.claim_status = 'verified') THEN 'claimed'
     WHEN EXISTS (SELECT 1 FROM public.venue_listings vl
                  WHERE vl.place_pool_id = p.id)                            THEN 'pending'
     ELSE 'available' END                            AS claim_state
```

Keep: WHERE/ordering/escape, `SECURITY DEFINER`, pinned `search_path`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO service_role` only. `claim_state='pending'` covers pending_review, needs-fixes AND rejected rows (any surviving `venue_listings` row blocks re-claim via `venue_listings_place_uniq` — support resolves; DESIGN §4.4 copy handles it).

**A1.2 — NEW RPC `biz_get_place_adoption_detail(p_place_pool_id uuid)`** — the full adoption payload, fetched ONLY on explicit claim intent ("Yes, this is me"). RETURNS TABLE (single row):
- `id, name, address, city, country, lat, lng, google_place_id, primary_type, types`
- `opening_hours` (jsonb) · `stored_photo_urls` (**full, uncapped**) · `national_phone_number` · `website` · `price_tiers, price_level` · `generative_summary, editorial_summary` · `reservable`
- the 23 `FACET_COLUMNS` exactly as at `run-business-place-authoring-pipeline/index.ts:18–42`

Body constraints (binding): `WHERE p.id = p_place_pool_id AND p.is_active = true AND NOT EXISTS (SELECT 1 FROM public.venue_listings vl WHERE vl.place_pool_id = p.id)`. Fail-close: claimed/pending/inactive → **zero rows** (edge maps to `place_not_available`). `SECURITY DEFINER`, pinned path, `STABLE`, grants service_role only. COMMENT names the whitelist rule + forbidden set.

**Security notes on the contract growth (mandatory):**
- **Newly exposed:** phone/website/price/summaries/facets/full gallery — ONE place per call, authed, shared 10/min bucket, unclaimed places only. All Google-derived public directory data; marginal exposure ≈ 10 places/min/user, and only under explicit claim intent.
- **Why the SEARCH row payload gains only booleans/counts** (deviation from the dispatch's "likely" whitelist-expansion framing; DESIGN §0 endorses: "booleans defeat the scraping concern that motivated the whitelist"): `claim-search-pool` runs `fetch_all: true` with no row cap (`poolSearchService.ts:56–59`; RPC comment "p_limit is legacy and ignored"). Widening per-row values would turn a 3-char ILIKE into a bulk scraper over 35k rows. The two-call shape (facts at search, values on YES) delivers the DESIGN's proof-of-knowledge card with a scrape surface orders of magnitude smaller.
- **`rating`/`review_count` VALUES stay FORBIDDEN.** Provenance verified: the ban ships in the original Ve2 whitelist commit `c07de2a49` ("public-safe fields only — no scoring / bouncer / AI columns") alongside the AI/bouncer bans; never relaxed since. Deliberate exposure boundary (ToS-cautious + anti-gaming: no shopping for high-rating unclaimed places). `has_rating` (boolean) satisfies DESIGN §4.1's "Rated on Google" fact without crossing it. Both response mappers MUST pass `assertNoForbiddenKeys`; the detail RPC selects neither column. Locked by I-PROPOSED-1263-ADOPTION-PAYLOAD-WHITELISTED.

**A1.3 — no other DDL.** `place_pool_business_owner_update` RLS (claimed_by arm) untouched as policy — but `claimed_by` is no longer written until approve (§A3.1), so the operator's direct place-UPDATE grant activates at approve, not submit. Closes a real pre-approval hole (raw RLS UPDATE power over a LIVE place before any admin review).

#### A2. Edge `claim-search-pool/index.ts` + `_shared/poolMatchResponse.ts` + `_shared/mapMinglaSlugToVenueCategory.ts`

- `PoolMatchRow`/`PoolMatchResult`: add `has_hours/hasHours`, `has_phone/hasPhone`, `has_website/hasWebsite`, `has_rating/hasRating`, `photo_count/photoCount`, `claim_state/claimState: "available"|"pending"|"claimed"`, and `venueCategoryConfident: boolean` (computed edge-side — next bullet). `FORBIDDEN_RESPONSE_KEYS` unchanged.
- `mapMinglaSlugToVenueCategory.ts` gains ADDITIVE export `isConfidentVenueCategory(primaryType, types): boolean` — true only for the explicit play / creative_arts / true-restaurant-family mapper arms; the catch-all→restaurant default returns false (DESIGN §6.1 rule; one owner for the confidence logic, server-computed so client and server can never drift).
- New `PoolAdoptionDetailRow`/`PoolAdoptionDetail` + `rowToAdoptionDetail(row)` in `poolMatchResponse.ts`: camelCase §A1.2, facets folded to `Record<string, boolean|null>` keyed by the 23 ids, `photoUrls` = full array (http(s)-filtered, uncapped), plus `venueCategory` + `venueCategoryConfident` via the shared mapper. Output MUST pass `assertNoForbiddenKeys`.
- Routing: body `{place_id}` (uuid) → detail mode (same `requireUser` + shared `checkRateLimit`; non-uuid → 400 `invalid_place_id`; zero rows → 404 `place_not_available`; ok → `{detail}`); body `{query}` → search mode (unchanged shape + new fields).

#### A3. Mutation boundary — `run-business-place-authoring-pipeline/index.ts` (D-A, D-B, D-E)

**Mode rule (exported pure, unit-tested):**
```ts
export function placeWriteMode(venueClaimStatus, placeAuthorBrandId): "apply" | "stage"
```
`"apply"` iff `venueClaimStatus === "verified"` OR `placeAuthorBrandId !== null` (create-new authored row — owns its never-served-until-approve row); else `"stage"`. A pre-approval CLAIM of a seeded place is always `"stage"`. Plumbing: `loadOwnedVenue` select adds `claim_status`; tier-1 claim place read (`:563–568`) adds `business_author_brand_id`; `handleSyncHeroMedia` adds a single-column place read.

**A3.1 `handleTier1` claim branch (`:558–611`), stage mode — the place update payload becomes EXACTLY:**
```ts
{ business_authoring_status: "processing",
  business_hero_video_present: coverMediaType === "video",
  business_authoring_inputs: {
    tier1: draft, selected_place_pool_id,
    adoption: draft.adoption ?? null,                       // provenance (R-5): source, adoptedAt, summarySource, wantsReservations
    tier2: { website: draft.website ?? null,                // c6/c7 staging seed → deck-readiness resume + tier-2 AI
             price_tiers: draft.priceTiers ?? [], vibe_chips: [] } },
  business_gallery_urls: <draft.adoptedGalleryUrls when non-empty> }   // kept+added, in c3 order
```
**Killed on the claim path (D-A):** `opening_hours` overwrite (`:580`), `is_claimed: true`, `claimed_by: userId` (`:575–576`) — all move to approve (§A5). Staging columns are confirmed non-serving (`discover-cards` reads none; `business_hero_video_present` read only by `signalScorer`, which runs at approve over authored state). Venue-row stamp (`:590–597`), pipeline upsert (`linked_existing`), response shape unchanged. Create-new branch (`:614–685`) byte-unchanged.

**A3.2 `handleSyncHeroMedia` (`:1646–1690`) — D-E, both paths:**
- `venue_listings.cover_media_*` write unchanged, always (venue row = hero truth, 1255(C) D-C).
- Stage mode place write: `{ business_hero_video_present }` ONLY — never `stored_photo_urls`.
- Apply mode: replace the `[mediaUrl]` wipe (`:1662`) with exported pure `nextStoredPhotosForHero(prior, gallery, hero)`: dedup(`[hero?, ...gallery, ...prior-non-previous-hero]`) where previous-hero = prior entries not in gallery (mirror of `storedPhotosForDeck:460`). Result length NEVER < `gallery.length`; clearing hero yields gallery ∪ prior-non-hero, never `[]`. **A hero pick never wipes the gallery.**

**A3.3 `handleConfirmAiOutputs` (`:1389–1505`), stage mode — place update payload becomes EXACTLY** `{ business_authoring_inputs, business_authoring_status, bouncer_reason, bouncer_validated_at }`. Omitted: `generative_summary`, `is_servable` (prior true preserved by omission — stricter than the identity write), `website`, `price_tiers`, `price_level`, `stored_photo_urls`, facet columns. Apply mode: current behavior unchanged. Status/coaching/pipeline logic unchanged both modes.

**A3.4 `handleTier2` (`:1207–1387`), stage mode:** omit the `website` (`:1358`) and `is_servable` writes. Keep `ai_signal_scores`, `photo_analysis`, `raw_google_data` (claim-diff archive), `business_authoring_inputs`, `business_authoring_status`, `bouncer_*`, `business_recommend_edit_count` — authoring/diagnostic state the admin bundle needs; none serving-read.

**A3.5 `handleGetAuthoringContext` (`:1574–1644`) — cover truth fix (Q-1):** response `cover_media_url/cover_media_type` come from the VENUE row (already selected by `loadOwnedVenue`), not `storedPhotoUrls[0]` + video-flag inference (`:1624–1629`). Both paths.

#### A4. NEW shared module `supabase/functions/_shared/authoredApply.ts`

`export function buildAuthoredApplyPatch({ place, venue, brandHours, ownerUserId }): Record<string, unknown>` — pure, unit-tested. Builds the approve-time patch from authored truth (venue row + venue-keyed `brand_hours` + `business_authoring_inputs` + `business_gallery_urls` — the 1255 one-owner reads):
- `opening_hours` = `normalizeBusinessHoursForPool(brandHours → BusinessHourRow[])` (import `_shared/businessHoursToGoogle.ts`; `parseHm` accepts brand_hours' "HH:MM:SS"; the converter already emits overnight `close.day = +1` — `businessHoursToGoogle.ts:140–152`). Omit when zero rows.
- `stored_photo_urls` = dedup(`[venue.cover_media_url?, ...business_gallery_urls]`) (same merge family as `storedPhotosForDeck`). Omit when union empty.
- `generative_summary` = `confirmed_ai_outputs.sales_bio` → else `tier1.description` (operator's c5 pitch, when ≥20 chars) → else omit (admin may approve pre-confirm; never blank a live summary).
- `price_tiers`/`price_level` from `inputs.tier2.price_tiers` via the tier→level map — **MOVE `PRICE_TIER_ORDER`/`PRICE_TIER_TO_GOOGLE_LEVEL`/`priceTiersFromTier2`/`priceLevelFromTiers` (`index.ts:423–446`) + the `FACET_COLUMNS` set into `authoredApply.ts`**; pipeline re-imports (one owner, no drift). Omit when absent.
- facet columns from `confirmed_ai_outputs.facets` (filtered to FACET_COLUMNS). Omit when absent.
- `website` = `tier2.website` when non-empty; else omit.
- `is_claimed: true`, `claimed_by: ownerUserId` (venue's brand `account_id`).
- `raw_google_data` merge: extend `business_claim_diff.archived_google` with PRE-application values of every key the patch overwrites (hours, photos, summary, price, website, facets) — merged non-destructively; **never overwrite an existing `archived_google` key** (first archive wins — it holds the Google original). Closes the "no archive, no restore path" gap (inventory §3.2) and powers the Raleigh revert (§13).

#### A5. `admin-review-venue-claim/index.ts` — approve-time application (D-A)

New exported `applyAuthoredContentOnApprove(admin, venueId)`: read venue row (`brand_id, place_pool_id, cover_media_url, cover_media_type`) + brand `account_id` + venue `brand_hours` + place row → `buildAuthoredApplyPatch` → one `place_pool` UPDATE. Idempotent (resubmit → re-approve re-applies current authored truth).

**Ordering (binding):** inside `approve`, AFTER `biz_review_venue_claim('approve')` + edit-count reset (`:590–597`), BEFORE `runApproveGoLive` — so the re-bounce (`:110–142`) and per-signal scoring run over authored content (and the scorer's `business_hero_video_present` boost sees the authored hero). Runs on every approve (create-new patch ≈ identity). Application failure → structured error, go-live NOT attempted (fail-close: never a verified claim whose authored content failed to land).

**Write-boundary summary (D-A/D-B, binding):** pre-submit abandon = zero server writes anywhere. Post-submit pre-approve = venue row (pending_review) + staging columns only; live serving columns + `claimed_by`/`is_claimed` byte-identical to pre-claim; reject/delete needs no place restore. Approve = one authored patch + archive, then re-bounce + scoring; public surfaces light up via the unchanged `claim_status='verified'` gates.

### LEG B — client claim variant (`mingla-business/`) — UI per DESIGN §3–§10, contracts here

#### B0. Flow + step model
Claim mode = the DESIGN §1 flow: gate → (YES + detail fetch) → claim wizard **c0 Category · c1 Place · c2 Hours · c3 Photos · c4 Cover · c5 Pitch · c6 Contact · c7 Price · c8 Bookings · c9 Review** → submit → success (§DESIGN 8.1) → venue management page. **Claim mode does NOT enter the inline deck-readiness leg** (create mode unchanged: 6 steps → inline `VenueDeckReadinessSetup`). Deck-readiness stays reachable post-submit via the existing to-dos/resume route, pre-filled from staging (§A3.1 tier2 seed + `business_gallery_urls` + venue cover via §A3.5).
`export function venueWizardSteps(isClaim): StepperStep[]` — create: existing 6, byte-stable; claim: the 10 above. Step components keyed by stable step IDs; `venueStepError(stepId, draft)` re-keyed to IDs.
**D-F note (delta vs DESIGN §6.1, resolved):** DESIGN preselects category only on CONFIDENT mapper arms; D-F blesses the blanket restaurant default "with explicit user confirm". Binding: DESIGN §6.1 rule (confident → preselected + chip + `Keep & continue`; unconfident → unselected + "Pick what fits best — our directory wasn't sure."). Both variants force the explicit confirm D-F requires; the confident-only preselect implements D-F's "unmappables default sensibly with a confirm" without fabricating 34,179 restaurants (R-8). If Seth prefers the literal blanket default it is a one-line change (OQ-1).

#### B1. Types + services
- `src/types/poolMatch.ts`: `PoolMatch` += `hasHours, hasPhone, hasWebsite, hasRating: boolean; photoCount: number; claimState: "available"|"pending"|"claimed"; venueCategoryConfident: boolean`. New `PoolAdoptionDetail` (camelCase §A1.2 + `venueCategory`, `venueCategoryConfident`, `facets: Record<string, boolean|null>`).
- `src/services/poolSearchService.ts`: map new fields (defaults: claimState "available", booleans false, count 0 — old-fn tolerance); new `fetchPlaceAdoptionDetail(placePoolId, {signal})` → `{place_id}`; typed `PlaceNotAvailableError` for 404.
- `src/services/venueListingsService.ts`: new `findOwnListingForPlace(brandId, placePoolId): Promise<VenueListing | null>` (own-RLS `.eq/.eq.maybeSingle()`) — R-10 resume probe.
- `src/services/businessPlaceAuthoringService.ts`: `Tier1PlaceDraft` += `website?: string|null; priceTiers?: string[]; adoptedGalleryUrls?: string[]; adoption?: {source: "place_pool"; adoptedAt: string; summarySource: "generative"|"editorial"|null; wantsReservations: boolean} | null`.

#### B2. Draft store v3 — `src/store/draftVenueStore.ts`
- `DraftVenueState` += top-level `website: string; priceTiers: string[]; wantsReservations: boolean` (claim collects; create path ignores — website/price stay deck-readiness-owned for create) and:
```ts
claim: null | {
  adopted: { name: string; address: string; hours: BrandHourEntry[]; phone: string|null; website: string|null;
             priceTiers: string[]; facets: Record<string, boolean|null>; summary: string|null;
             summarySource: "generative"|"editorial"|null; galleryUrls: string[];
             category: VenueCategory; categoryConfident: boolean; reservableHint: boolean };  // immutable copy-on-start snapshot (D-B)
  keptGalleryUrls: string[];      // ordered (c3 order = public order, DESIGN §6.4)
  addedGalleryUrls: string[];     // operator uploads (`New` chips)
  coverChoice: { url: string; type: "image"|"video"|"gif"; isNew: boolean } | null;
  detailFetched: boolean;         // false on "Continue anyway" (DESIGN §4.2) — chips render only for arrived fields
}
```
- **Provenance is COMPUTED, never stored** (DESIGN §3: revert-to-adopted flips the chip back): `adopted` = current field === `claim.adopted.x`; `edited` = differs; `new` = no adopted value. Export pure `provenanceFor(field, draft): "adopted"|"edited"|"new"|null` (null = no chip).
- `photoUris` REMOVED (dead, §1.2 s5) — update `initial`/`pickDraft` and c9.
- Persist name bump → `mingla-business-draft-venue-v3` (house precedent v1→v2; pre-submit drafts, prod-safe). `claim` must survive `activateBrand` stash/restore via `pickDraft`.
- `src/utils/prefillDraftFromPoolMatch.ts`: keep the lean prefill (the DESIGN §4.2 "Continue anyway" fallback — sets `claim` with `detailFetched:false`, adopted limited to whitelist fields) + new `prefillDraftFromAdoption(match, detail)`: everything lean does PLUS `contactPhone` ← phone, `website`, `priceTiers` (filtered to chill/comfy/bougie/lavish), `description` ← `generativeSummary` only (OQ-2: `editorialSummary` never pre-fills verbatim; it rides `claim.adopted.summary` with `summarySource:"editorial"` as AI seed), full `claim` block (`keptGalleryUrls` = galleryUrls, `coverChoice: null`, `detailFetched: true`). Hours prefill stays `mapPoolOpeningHoursToBrandHours` (unchanged file — its `22:00→02:00` emission is CORRECT once D-D lands and round-trips losslessly via `businessHoursToGoogleOpeningHours`).

#### B3. Gate — `app/venue/create.tsx` + NEW `src/components/brand/ClaimMatchCard.tsx`
- `ClaimMatchCard` per DESIGN §4 (photo strip, facts row from the presence booleans, reassurance line ≥2 facts, a11y label; keep `PoolMatchCard` export until call-site swap — then it becomes dead and is REMOVED in this ORCH). States: default / YES-loading / fetch-error with **`Continue anyway`** (lean prefill; explicit, never silent) / `claimState==="claimed"` blocked-politely (DESIGN §4.3, `Message support` → `/support/inbox`, NO Yes button) / `claimState==="pending"` (DESIGN §4.4). Blocked variants sort below available (DESIGN §4.5).
- On YES success: `patch(prefillDraftFromAdoption(...))` → `setPhase("wizard")` (c0 is in-wizard; the pre-wizard category phase is create-path-only). `place_not_available` during YES → swap card to blocked state (race backstop).
- Resume card (DESIGN §8.4) when a persisted claim draft exists for the current brand: `Resume claim` → wizard at persisted `step`; `Start over` → confirm dialog → `reset(brandId)`.
- `resolveInitialPhase`: claim drafts (`claim !== null`) → `"gate"` (the resume card owns re-entry); `?pool=1` continues to mean wizard-resume for pool-linked drafts (claim or legacy).
- `goToCategory` (No/Skip) clears `claim: null` with `placePoolId: null` (`:154–158`). Success phase claim copy per DESIGN §8.1 (`That's it — {name} is in review`), Done → `/venue/{venueId}`.

#### B4. Claim wizard — `VenueCreatorWizard.tsx` + `src/components/venue/claim/*` + `ui/ProvenanceChip.tsx` + `Stepper.tsx`
- **New components (DESIGN §11 list, binding names/locations):** `src/components/ui/ProvenanceChip.tsx` (DESIGN §3 — 3 states + photo-scrim variant, `accessible={false}`) · `src/components/venue/claim/ClaimAdoptionBanner.tsx` (DESIGN §5.1 — full card on first paint, collapses to one-liner after c0; `n` = live count of steps c0–c8 whose adopted payload passes that step's validation) · `src/components/venue/claim/ClaimStepCategory.tsx` (c0, §6.1) · `ClaimStepPlace.tsx` (c1, §6.2 — collapsed cards EXPANDING IN PLACE to the existing `VenueStep1Address`/`VenueStep2NameSlug` editors; those two files are NOT modified; ORCH-1079 googlePlaceId lock untouched) · `ClaimStepHours.tsx` (c2, §6.3 — wraps `BrandHoursEditor`; single week-level chip) · `ClaimStepPhotos.tsx` (c3, §6.4) · `ClaimStepCover.tsx` (c4, §6.5 — the `CoverChooserStep`; upload path = existing CoverPicker flow, image/video; uploaded tile auto-selected, `New` chip) · `ClaimStepPitch.tsx` (c5, §6.6 — `Start fresh` clear) · `ClaimStepContact.tsx` (c6, §6.7 — phone/email/website; website field is claim-mode-only) · `ClaimStepPrice.tsx` (c7, §6.8 — PRICE_TIERS_BIZ chips; **selection required**) · `ClaimStepBookings.tsx` (c8, §6.9 — switch always starts OFF; suggestion row when `reservableHint`; flips `wantsReservations`) · `ClaimStepReview.tsx` (c9, §6.10 — KEPT/CHANGED/ADDED groups computed via `provenanceFor`; rows jump to steps).
- **Reorder decision (SPEC-owned per DESIGN §11):** NO new drag dependency. c3 reorder = long-press lift (reanimated, M-4 visuals) + the move menu (`Move earlier / Move later / Make first`) as the ONLY reorder input on ALL platforms (menu also = the web/keyboard path). Full pointer-drag is deferred; DESIGN M-4 drag visuals apply to the lift/settle only.
- `Stepper.tsx`: additive `prefilled?: boolean` per step (DESIGN §5.2 — green-45 dots / successTint circles; no checkmarks, no % bar).
- Wizard shell: claim step map + dock CTA labels (`Keep & continue` / `Save & continue` / `Continue` / disabled-until-cover on c4 / `Submit for review` on c9 — DESIGN §5.3, derived from `provenanceFor` + validity) + banner slot. Motion per DESIGN §7 (M-1..M-8, reduced-motion fallbacks binding).
- **Validation (`venueWizardValidation.ts`, re-keyed to step IDs):** create rules unchanged. Claim: c0 category required · c1 = existing address+name+slug rules · c2 hours — **D-D:** same-day AND overnight (`close < open`) valid; ONLY `open === close` rejected: `Open and close can't be the same time.` (DESIGN §6.3; the "aren't supported yet" copy DIES) · c3 none (GALLERY_MIN enforced at go-live, not at claim — DESIGN §6.4) · c4 `coverChoice !== null` (sub-dock caption `Pick a cover to continue`) · c5 ≥20 chars when non-empty… **binding: c5 may be EMPTY** (59% seeded-empty; DESIGN dock shows `Continue` disabled until valid only when text entered; empty = allowed, the AI pitch flow still exists post-submit. If text entered, ≥20 chars.) · c6 ≥1 of email/phone (existing copy); website optional, URL-shaped when present · c7 `priceTiers.length ≥ 1` · c8 none · c9 submit.
  `VenueSettingsModule.tsx` `hoursInvalid`: same D-D predicate (`o >= c` → `o === c`). `BrandHoursEditor.tsx`: the `next day` micro-line inside the Closes timeBtn when `close <= open` (DESIGN §6.3) — additive.
- **Submit (`handleSubmit`) claim deltas:**
  1. **Half-claim resume (D-C/R-7, DESIGN §8.3):** when `placePoolId !== null` → `findOwnListingForPlace(brand.id, placePoolId)` FIRST. Row + tier1 incomplete (`fetchVenuePipelineState.tier1_completed_at` null) → skip `createVenue`, reuse `venueId`, re-run `upsertTier1Place`. Row + tier1 complete → route to the venue management page (claim already submitted). Foreign 23505 → DESIGN §8.2 card (draft NOT cleared). Own-row 23505 can no longer occur (pre-check wins), but the catch must still branch on `findOwnListingForPlace` before showing §8.2 (race honesty).
  2. `createVenue` gains `coverMediaUrl/coverMediaType` = `claim.coverChoice` (RPC already persists venue cover; today hardcoded null at `:199–200`).
  3. `upsertTier1Place.draft` gains `coverMediaUrl/coverMediaType`, `website`, `priceTiers`, `adoptedGalleryUrls` = `keptGalleryUrls` (order preserved) ∪ `addedGalleryUrls`, `adoption` = `{source, adoptedAt, summarySource, wantsReservations}`.
  4. Success → claim success screen (B3), NOT inline deck-readiness. Draft cleared for this brand (existing `:238`).

#### B5. Review + create-path review
`VenueStep7Review.tsx` (create path): drop the dead "Photos: N selected" row (fed by removed `photoUris`); everything else unchanged. Claim review is the separate `ClaimStepReview.tsx` (c9).

### LEG C — tests & gates (§7, §9)

---

## 5. Success criteria

- **SC-1 (D-C front-load):** a place with any `venue_listings` row renders the blocked card (claimed/pending variants per DESIGN §4.3/§4.4) with NO "Yes, this is me"; `claim_state` correct in the search response for verified vs pending vs none.
- **SC-2 (adoption fetch, D-B):** YES on an available match loads the detail and fills the draft (phone/summary-per-OQ-2/hours/category/gallery/website/price + claim block) with ZERO server writes (DB diff empty). Fetch failure → explicit `Continue anyway` lean path; chips render only for arrived fields.
- **SC-3 (D-F):** c0 always renders; confident mapping preselected + chip + `Keep & continue`; catch-all arrives unselected with the DESIGN copy; wizard cannot pass c0 without a selection.
- **SC-4 (D-D):** adopted `22:00→02:00` passes c2 untouched and displays `next day`; the same range saves in Settings post-approve; `open === close` rejected with the new copy in both validators.
- **SC-5 (D-E):** c4 blocks until a cover is chosen (from gallery or upload); c3 supports per-photo remove/undo, `New` chips on uploads, move-menu reorder; nothing server-side mutates pre-submit.
- **SC-6 (D-A submit):** after claim tier-1, the live place's `opening_hours, stored_photo_urls, generative_summary, price_tiers, price_level, website`, facets, `claimed_by`, `is_claimed` are byte-identical to pre-claim; staging (`business_authoring_status/inputs` incl. tier2 seed + adoption, `business_gallery_urls`) set; venue row pending_review with cover; deck card renders unchanged.
- **SC-7 (D-A pre-approve):** hero/gallery/tier-2/confirm on a pending claim write venue-cover + `business_*`/diagnostic columns only — stage-mode payload key-sets EXACT per §A3.1–§A3.4.
- **SC-8 (D-A approve):** approve applies authored hours/photos/summary/price/facets/website + `claimed_by`/`is_claimed` in one patch, archives pre-application values (first-archive-wins), THEN re-bounces + scores authored content; `venue_public_view` serves; deck shows authored content. Application failure blocks go-live.
- **SC-9 (D-E apply-mode):** post-approve/create-new hero change yields `stored_photo_urls ⊇ gallery ∪ {hero}`; clearing hero never empties a non-empty gallery.
- **SC-10 (D-C retry):** forced tier-1 failure post-RPC → same-brand resubmit resumes (no 23505 card, DESIGN §8.3); a different brand sees SC-1 at the gate and DESIGN §8.2 at the backstop.
- **SC-11 (whitelist):** no forbidden key in search or detail responses; detail RPC returns zero rows for claimed/pending/inactive; search exposes booleans/counts only (no rating value).
- **SC-12 (regression):** create-from-scratch path behaviorally unchanged (6 steps, same order, same writes; existing pinned suites green).
- **SC-13 (design conformance):** provenance chips (3 states + computed transitions incl. revert), adoption banner live-`n` + collapse, prefilled stepper dots, dock CTA labels, motion M-1..M-8 with reduced-motion fallbacks, Android opaque-glass + web deltas — per DESIGN §3–§9 (tester spot-checks against the DESIGN as the source of truth).

SC-1..5 sim-proven on iOS; Android spot-check SC-4/SC-5 (time picker, image picker, opaque glass). Web preview: compile + code-level (§3 row 7).

## 6. Invariants

**Preserved:** I-NO-CLAIM-DEMOTION (strengthened: stage mode never writes `is_servable`) · I-NET-NEW-HOLD · I-PROPOSED-1255-NO-HIDDEN-BRAND-ON-VENUE-CREATE · I-PROPOSED-1255-VENUE-APPROVAL-PER-VENUE-ROW (machine untouched; §A5 is content application) · I-PROPOSED-1255-PER-VENUE-OPS-NO-SHARED-INVENTORY · I-PROPOSED-1255-PUBLIC-VENUE-PAGE-ANON-SAFE · ORCH-1079 §3.C googlePlaceId lock · I-CATEGORY-SLUG-CANONICAL · ANDROID_GLASS_USES_OPAQUE_FALLBACK (DESIGN §9) · WCAG kit I-38/I-39 (DESIGN §10).

**NEW — DRAFT (orchestrator flips at CLOSE):**
1. **I-PROPOSED-1263-NO-LIVE-PLACE-MUTATION-PRE-APPROVE** — stage mode never writes a serving-read place column (`opening_hours, stored_photo_urls, generative_summary, price_tiers, price_level, website, facets, is_servable, name, address, lat, lng`) nor `claimed_by`/`is_claimed`. Enforced: T-A1..T-A6 exact key-sets + gate G-1.
2. **I-PROPOSED-1263-CLAIM-ADOPTION-COPY-ON-START** — adoption is a client-draft copy at YES; pre-submit abandon = zero server writes. Enforced: T-B2 (prefill pure) + T-D2 (`provolatile='s'`).
3. **I-PROPOSED-1263-GALLERY-NEVER-WIPED-BY-HERO** — `nextStoredPhotosForHero` ⊇ gallery; the one-element write is banned. Enforced: T-A4 + G-1.
4. **I-PROPOSED-1263-CLAIMED-STATE-FRONT-LOADED** — search carries `claim_state`; blocked variants render at the gate; §8.2 backstop is foreign-only; same-brand retry resumes. Enforced: T-B5/T-B6 + T-D1 + G-2.
5. **I-PROPOSED-1263-ADOPTION-PAYLOAD-WHITELISTED** — rating/review_count values + AI/bouncer columns never cross either response; detail is single-place, authed, rate-limited, fail-closed. Enforced: T-E1 + T-D2.
6. **I-PROPOSED-1263-OVERNIGHT-HOURS-VALID** — both validators accept `close < open`, reject only equality. Enforced: T-B3 + G-2.

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-A1 | tier-1 claim stage payload | fake client; pool id set; venue pending; place author-null | place update key-set EXACTLY §A3.1 (incl. tier2 seed + adoption); no opening_hours/claimed_by/is_claimed | deno `orch_1263_stage_only_claim.test.ts` |
| T-A2 | create-new unchanged | pool id null | existing `pipeline_behavioral.test.ts` green, no payload drift | deno |
| T-A3 | hero stage vs apply | pending claim / verified / create-new | stage: `{business_hero_video_present}` only + venue cover; apply: `nextStoredPhotosForHero` used | deno |
| T-A4 | `nextStoredPhotosForHero` | (prior w/ old hero, gallery, new hero) / hero null / all empty | ⊇ gallery always; never `[hero]` with non-empty gallery; `[]` only when all empty | deno pure |
| T-A5 | confirm stage payload | pending claim, servable place | key-set EXACTLY §A3.3; no `is_servable`; place summary unchanged | deno |
| T-A6 | tier-2 stage | prior servable true | no `is_servable`/`website` keys | deno (extends no_demotion family) |
| T-A7 | `placeWriteMode` matrix | 4 combos | apply/stage/apply/apply | deno pure |
| T-C1 | `buildAuthoredApplyPatch` full | confirmed + tier2 + hours + gallery + cover | all keys; archive holds pre-values; first-archive-wins on re-approve | deno `_shared/__tests__/authoredApply.test.ts` |
| T-C2 | apply patch partial | no confirm, no tier2, pitch present | summary = tier1.description; price/facets/website absent; hours/photos/claimed_by present | deno |
| T-C3 | approve ordering | apply throws | structured error; `runApproveGoLive` NOT invoked | deno (admin fn, fake client) |
| T-D1 | search RPC facts + state | place ± pending row ± verified row | booleans/count correct; claim_state available/pending/claimed | SQL `orch_1263_claim_adoption.test.sql` |
| T-D2 | detail RPC contract | claimed / pending / inactive / available | zero rows ×3 / full row; functiondef has no rating/review_count/ai_ selects; grants service_role only; STABLE | SQL |
| T-E1 | forbidden keys (adversarial) | polluted rows w/ rating etc. | both mappers throw via `assertNoForbiddenKeys` | deno poolMatchResponse test |
| T-E2 | detail mode guards | no auth / rate / bad uuid / claimed | 401 / 429 / 400 / 404 `place_not_available` | deno |
| T-B1 | `venueWizardSteps` + ID validation | claim vs create | 10 vs 6, IDs stable, create byte-identical | jest `orch1263ClaimAdoption.happy.test.tsx` |
| T-B2 | `prefillDraftFromAdoption` + lean fallback | full detail / editorial-only / Continue-anyway | claim block right; description empty on editorial-only; `detailFetched` flag; pure | jest |
| T-B3 | overnight both validators | 22→02 / 09→09 / 09→17 | valid / rejected(new copy) / valid — `venueStepError` AND `hoursInvalid` | jest |
| T-B4 | c4 gating + c3 ops | no cover / chosen / remove-undo / move menu | Continue blocked/enabled; kept order updates; New chip on upload | jest render |
| T-B5 | ClaimMatchCard states | available(≥2 facts)/sparse/claimed/pending/fetch-error | facts row, reassurance rules, blocked variants, Continue-anyway | jest render |
| T-B6 | half-claim resume | own row (tier1 pending / done) / foreign 23505 | createVenue skipped + tier-1 rerun / route management / §8.2 card | jest (mocked services) |
| T-B7 | provenance + dock labels | adopted→edit→revert; per-step CTA | chip adopted→edited→adopted; Keep/Save/Continue per DESIGN §5.3 | jest pure (`provenanceFor`) + render |
| T-B8 | banner `n` computation | fully-seeded / sparse (n≤2) | live count of validation-passing steps; sparse copy swap | jest pure |

## 8. Implementation order

1. Migration §A1 + SQL tests T-D1/T-D2.
2. `_shared/authoredApply.ts` (§A4, helpers moved) + T-C1/T-C2.
3. Pipeline fn (§A3) + T-A1..T-A7; re-point imports at `authoredApply.ts`.
4. `admin-review-venue-claim` (§A5) + T-C3.
5. `poolMatchResponse.ts` + `mapMinglaSlugToVenueCategory.ts` (additive) + `claim-search-pool` (§A2) + T-E1/T-E2.
6. Client types/services (§B1) + store v3 + prefills (§B2) + T-B2.
7. Gate: `ClaimMatchCard`, resume card, YES flow (§B3) + T-B5.
8. Claim wizard: `ProvenanceChip`, `Stepper.prefilled`, banner, c0–c9, validation (D-D both files), submit deltas (§B4/§B5) + T-B1/T-B3/T-B4/T-B6/T-B7/T-B8.
9. Gates G-1/G-2 registered in `strict-grep-mingla-business.yml`, each `--self-test` + GOOD/BAD fixtures.
10. CLOSE-time (orchestrator-owned, from merged main): migration apply via Management API + deploy `run-business-place-authoring-pipeline`, `claim-search-pool`, `admin-review-venue-claim` + one-curl verify each. NO OTA (business = native build only).

## 9. Regression prevention (fails-on-revert)

- **G-1 `orch-1263-claim-stage-only-preapprove.mjs`:** FAILS when in `run-business-place-authoring-pipeline/index.ts`: (a) `opening_hours: normalizeBusinessHoursForPool` appears >1× (create-new insert is the only legal site); (b) any one-element `stored_photo_urls` write from `mediaUrl` exists; (c) `handleSyncHeroMedia` lacks the `nextStoredPhotosForHero(` call token; (d) the claim branch (between the `selectedPlacePoolId !== null` guard and `claim_path: "existing"`) contains `claimed_by:` or `is_claimed:`. Self-test with GOOD (fixed) + BAD (reverted) fixtures.
- **G-2 `orch-1263-claim-front-load-and-overnight.mjs`:** FAILS when (a) `ClaimMatchCard.tsx` lacks `claimState` handling tokens; (b) the search-RPC migration CREATE lacks `claim_state`; (c) `venueWizardValidation.ts` or `VenueSettingsModule.tsx` contains the reverted `o >= c` predicate.
- **Behavioral:** T-A/T-C assert exact payload KEY-SETS — any revert reintroduces a key and fails; T-A4/T-B3 fail on the exact reverted logic. Each new test file header names its invariant + "must FAIL when the D-A/D-D/D-E change is reverted". Test files append-only per the CLOSE gate; pinned suites (`pipeline_behavioral`, `meta_orch_1062_no_demotion`, `metaOrch1255*`) stay green untouched (SC-12).
- Killed write sites get `// I-1263-…` protective comments naming the invariant.
- DESIGN §11 regression guards honored: `sanitizeAuthoringError` call sites kept; `orch-1255-no-hidden-brand-on-venue-create.mjs` unaffected (nothing touches brand creation); desktop-contract suite untouched.

## 10. Open questions (defaults bind if unanswered)

- **OQ-1 (D-F literal vs DESIGN §6.1):** bound = confident-only preselect (§B0 note). Flip to blanket restaurant preselect? One-line change.
- **OQ-2 (editorial summary, inventory Q-2):** bound = Google-authored `editorial_summary` never pre-fills the pitch verbatim; it seeds AI context only. Generative (our AI) pre-fills. Confirm or loosen.
- **OQ-3 (c5 empty allowed):** bound = claim pitch may be empty (59% seeded-empty; AI flow post-submit covers it); create-path ≥20 rule unchanged. Confirm.
- **OQ-4 (reorder):** bound = long-press lift + move-menu everywhere, no drag dependency (§B4). Upgrade to full drag later if wanted.

## 11. Downstream routing

- **Next:** `mingla-implementor` in THIS worktree (branch `orch-1263-claim-adoption`), order §8; stop-and-amend on any allowlist breach; DESIGN file is read-only input. NO deploys/migrations/OTA from the worktree.
- **Then:** `mingla-tester` — adversarial SC-1..SC-13 + Raleigh script (§13); sim-first; live-fire the SQL RPCs (headless QA insufficient per standing memory).
- **Then:** orchestrator CLOSE — all checks green, Management-API migration + 3 edge deploys from merged main (one-curl verify each), invariants DRAFT→ACTIVE, registry row removal, worktree reap.

## 12. Scoped allowlist + DO-NOT-TOUCH

**Allowlist (modify/create ONLY these):**

Server: `supabase/migrations/20261202000000_orch_1263_claim_adoption.sql` (new) · `supabase/migrations/orch_1263_claim_adoption.test.sql` (new) · `supabase/functions/_shared/poolMatchResponse.ts` · `supabase/functions/_shared/mapMinglaSlugToVenueCategory.ts` (ADDITIVE export only: `isConfidentVenueCategory`) · `supabase/functions/_shared/authoredApply.ts` (new) · `supabase/functions/_shared/__tests__/authoredApply.test.ts` (new) · `supabase/functions/claim-search-pool/index.ts` (+ new `__tests__/`) · `supabase/functions/run-business-place-authoring-pipeline/index.ts` (+ new `__tests__/orch_1263_stage_only_claim.test.ts`) · `supabase/functions/admin-review-venue-claim/index.ts` (+ new `__tests__/`).

Client (`mingla-business/`): `src/types/poolMatch.ts` · `src/services/poolSearchService.ts` · `src/services/venueListingsService.ts` · `src/services/businessPlaceAuthoringService.ts` (Tier1PlaceDraft additions only) · `src/store/draftVenueStore.ts` · `src/utils/prefillDraftFromPoolMatch.ts` · `app/venue/create.tsx` · `src/components/brand/ClaimMatchCard.tsx` (new; `PoolMatchCard.tsx` removed once call sites swap) · `src/components/ui/ProvenanceChip.tsx` (new) · `src/components/ui/Stepper.tsx` (additive `prefilled` only) · `src/components/venue/VenueCreatorWizard.tsx` · `src/components/venue/venueWizardValidation.ts` · `src/components/venue/claim/` (new: `ClaimAdoptionBanner.tsx`, `ClaimStepCategory.tsx`, `ClaimStepPlace.tsx`, `ClaimStepHours.tsx`, `ClaimStepPhotos.tsx`, `ClaimStepCover.tsx`, `ClaimStepPitch.tsx`, `ClaimStepContact.tsx`, `ClaimStepPrice.tsx`, `ClaimStepBookings.tsx`, `ClaimStepReview.tsx`) · `src/components/venue/VenueStep7Review.tsx` (dead photos row only) · `src/components/venue/BrandHoursEditor.tsx` (`next day` line only) · `src/components/venue/VenueSettingsModule.tsx` (`hoursInvalid` predicate only) · `__tests__/orch1263ClaimAdoption.happy.test.tsx` (new).

Gates: `.github/scripts/strict-grep/orch-1263-claim-stage-only-preapprove.mjs` (new) · `.github/scripts/strict-grep/orch-1263-claim-front-load-and-overnight.mjs` (new) · `.github/workflows/strict-grep-mingla-business.yml` (register only).

**DO-NOT-TOUCH (stop-and-amend first):** `_shared/businessHoursToGoogle.ts` (already overnight-correct) · `src/utils/mapPoolOpeningHoursToBrandHours.ts` · `VenueStep1Address.tsx` / `VenueStep2NameSlug.tsx` / `VenueStep4Hours.tsx` / `VenueStep5Contact.tsx` / `VenueStep6Description.tsx` (claim steps WRAP, never edit; ORCH-1079 lock lives in Step1) · `VenueDeckReadinessSetup.tsx` (claim skips the inline leg; resume works via staging — no component change needed; if one becomes needed, amend) · `discover-cards/**` · every 1255 migration file / `venue_public_view` / review-RPC bodies (`biz_review_venue_claim` etc.) · `biz_create_venue_listing` RPC body · `VenueClaimStatusBanner.tsx` · `venue_reservation_settings` defaults / `20261003000007` probe · brands table / brandsService · all `app-mobile/**` · all pinned test files (append-only) · `Mingla_Artifacts/specs/DESIGN_ORCH-1263_CLAIM_WALKTHROUGH.md` (read-only input).

## 13. Acceptance criteria — the Raleigh script (tester-owned, binding)

Target: one REAL servable Raleigh place (`is_active AND is_servable AND array_length(stored_photo_urls,1)>=5 AND opening_hours IS NOT NULL AND national_phone_number IS NOT NULL AND city ILIKE 'raleigh'`; prefer `drinks_and_music` with overnight hours to exercise D-D).

1. **Pre-test snapshot (mandatory):** `SELECT to_jsonb(p.*) FROM place_pool p WHERE id = :target` saved in the test report AND into a scratch snapshot table; assert zero `venue_listings` rows for the place.
2. Business app (dev build, test brand): search the name → ClaimMatchCard shows photo strip + facts (photos/Hours/Phone/Website/Rated on Google) — NOT blocked. YES → detail loads → walk c0–c9: category confirm (chip when confident), c1 confirm cards, c2 overnight day passes untouched with `next day`, c3 remove one photo + reorder via move menu, c4 pick a cover from the gallery, c5 keep/edit pitch, c6 phone+website prefilled, c7 price chips preselected (49.2% cohort) or pick, c8 suggestion row when Google says reservable (switch stays OFF unless flipped), c9 groups show KEPT/CHANGED/ADDED. Submit.
3. **DB assert (SC-6):** serving columns byte-identical to the snapshot; staging set (inputs.tier1 + tier2 seed + adoption + business_gallery_urls); venue row pending_review with cover; consumer deck card unchanged (discover-cards or consumer sim spot-check).
4. Deck-readiness resume route for the venue: gallery/website/price/cover arrive pre-filled from staging + venue row; run Recommend me → confirm. **Re-assert serving columns still identical (SC-7).**
5. Second test brand: search the place → pending blocked card (SC-1). Direct RPC attempt → 23505 → foreign backstop only.
6. Half-claim drill (SC-10) on a SECOND snapshotted place: force tier-1 failure (kill network after RPC), relaunch, resubmit → resumes per DESIGN §8.3, no support card.
7. Admin approve (mark_called → approve): **DB assert (SC-8)** — authored application landed (hours/photos/summary/price/facets/website/claimed_by/is_claimed), `archived_google` extended, place servable, `venue_public_view` live, deck shows authored content. Reservations: open the venue Reservations module, enable, confirm a slot renders (overnight-derived periods may need one explicit operator period — declared limitation §B4/DESIGN §6.9 scope).
8. **Full revert protocol (mandatory, from snapshots):** restore the place row from the snapshot (all columns incl. serving set, `business_*`, `raw_google_data`, `ai_signal_scores`, `bouncer_*`, `claimed_by`, `is_claimed`); delete in order: reservation settings/availability config rows (venue), `brand_place_pipeline_state` (venue), venue-keyed `brand_hours`, approve-created `place_scores` rows, `venue_listings` row(s); re-run the snapshot SELECT → diff EMPTY. Repeat for the half-claim place. Test brands cleaned per tester SOP.

---

*v2 supersedes the v1 commit of this file: v1's 7-step model, `AdoptedFieldBanner`, and bare `already_claimed` boolean are replaced by the embedded DESIGN contract (10-step walkthrough, ProvenanceChip system, `claim_state` + presence facts). Implementor builds from THIS file + the DESIGN file without questions; anything outside §12 requires a SPEC amendment.*
