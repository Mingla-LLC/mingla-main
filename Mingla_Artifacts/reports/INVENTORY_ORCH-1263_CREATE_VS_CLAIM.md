# INVENTORY — ORCH-1263 [claim-adoption]: CREATE-venue vs CLAIM-variant, side by side

- **Phase:** INVESTIGATE (inventory deliverable — no fixes proposed, option framing only)
- **Date:** 2026-07-02 · **Branch:** `orch-1263-claim-adoption` (rebased on main incl. META-ORCH-1255)
- **Author:** mingla-forensics
- **Data basis:** live prod read-only probes 2026-07-02 (35,249 servable places; numbers re-verified below)

---

## Executive summary (plain English)

Today, when a business owner types their venue's name and we find it in our directory, tapping
"Yes, this is me" only pre-fills the **basics**: name, address, map pin, category, and opening
hours. Everything else the place already has — its photo gallery, phone number, website, price
signal, description — is **thrown away**, and the owner is asked to re-enter or re-upload it all
from scratch after submitting. Worse, three things actively damage the live listing during a
claim: (1) the moment the wizard is submitted, the wizard's hours **overwrite** the real Google
hours on the live deck card; (2) picking a hero cover **wipes the place's entire stored photo
gallery** down to just that one image; (3) bars and late-night venues with overnight hours
(10pm–2am) **cannot even pass the hours step** — the wizard rejects overnight ranges.

The good news: the claim variant needs **no new pipeline**. The same wizard, the same
`biz_create_venue_listing` RPC, the same per-venue approval machine, and the same deck-readiness
screen already handle a claimed place end to end — the place even stays live on the consumer deck
the whole time (a live claim is never demoted). What's missing is purely the **adoption layer**:
a richer server payload for matches (phone/website/price/summary/full gallery are currently
blocked by the response whitelist), pre-filling every step and the deck-readiness screen from it,
a cover-from-gallery chooser (the one mandatory new decision — 0% of seeded places have a cover),
and making the pre-approval writes non-destructive.

**Everything below is evidence with file:line. The side-by-side table is the deliverable.**

---

## 1. SIDE-BY-SIDE WIZARD WALKTHROUGH

### 1.0 Flow shape today (CREATE)

`mingla-business/app/venue/create.tsx` — phases `gate → category → wizard → success`
(`Phase` type at create.tsx:39; resume logic `resolveInitialPhase` at :41–55).
Wizard = 6 steps (`VenueCreatorWizard.tsx:54–62`): Address · Name · Hours · Contact · Inputs
(description) · Review. Cover/photos are NOT wizard steps — they live post-submit on
`VenueDeckReadinessSetup` (Sub-E removed the dead cover step, VenueCreatorWizard.tsx:51–54).

### 1.1 The match/dedup seam (Ve2) — how "this place already exists" is detected today

| Aspect | Evidence |
|---|---|
| Where the search happens | The **gate** phase name field, NOT the address step. `create.tsx:115–119` — `usePoolMatchSearch(phase === "gate" ? workingName : "")`. Debounced 300ms, min 3 chars (`types/poolMatch.ts:30–32`). |
| Search path | `usePoolMatchSearch.ts:56` → `searchPoolMatches` (`poolSearchService.ts:53`) → edge fn `claim-search-pool` (`supabase/functions/claim-search-pool/index.ts:123`) → SECURITY DEFINER RPC `biz_search_place_pool_for_claim` (`supabase/migrations/20260809000000_...sql:496–546`): `place_pool WHERE is_active = true AND name ILIKE %q%`, prefix matches first, then `review_count DESC`. Rate limit 10/min per user (claim-search-pool/index.ts:22–23). |
| Does it exclude already-claimed places? | **No.** The RPC filters only `is_active = true` (line 532). A place already claimed by another brand still appears as a match; the second brand only fails at submit (see 3.4). |
| What a match returns | Whitelist contract `supabase/functions/_shared/poolMatchResponse.ts`: id, name, address, city, country, lat, lng, google_place_id, primary_type, types, opening_hours, stored_photo_urls (capped at 6, `photoUrlsFromRow` :58–63). `FORBIDDEN_RESPONSE_KEYS` (:41–54) **explicitly bans rating and review_count**; phone, website, price, summaries, facets are simply absent from the RPC's RETURNS TABLE. |
| Match UI | `PoolMatchCard.tsx` — photo + name + address + "Is this you?" with **Yes, this is me** / **No, different business** / **Skip — create from scratch** (create.tsx:262–275). |
| On YES (this IS the claim entry point today) | `goToWizardFromPool` (create.tsx:162–169) → `prefillDraftFromPoolMatch` (`utils/prefillDraftFromPoolMatch.ts:10–29`) patches the draft store and jumps **straight to the wizard, skipping the category phase** (category is derived — see row s-cat below). |
| What YES pre-fills today | `placePoolId`, `workingName/displayName`, `slug` (re-slugified), `formattedAddress`, `googlePlaceId`, `lat/lng`, `city`, `country→countryCode(2)`, `venueCategory` (derived), `hours` (Google periods → 7 wizard rows via `mapPoolOpeningHoursToBrandHours`), `photoUris` (≤6 URLs — **dead weight**, see s5). |
| On NO / SKIP | `goToCategory` (create.tsx:147–160) — `placePoolId: null`, normal create path. |
| Dedup integrity lock | `VenueStep1Address.tsx:43–71` (ORCH-1079 LOCKED §3.C): a Step-1 address re-pick or clear must NEVER touch `googlePlaceId` — the pool-derived Google id must survive so the RPC's `place_pool_google_place_id_mismatch` check passes (`20261130000003:137–151`). |
| Secondary entry points | None. Every route into venue creation lands on `/venue/create` gate: `UniversalCreatorSheet.tsx:169`, `VenueCardList.tsx:95`, `VenueListingContent.tsx:186`, `VenueIntelligenceModule.tsx:193`, `businessTodos.ts:239/268/274`. `?pool=1` param (create.tsx:59–60, 45) resumes an in-progress pool-linked draft directly in the wizard, but there is no standalone "claim this venue" affordance anywhere (business app, consumer app, or public page). |
| In-wizard claim banner | `VenueCreatorWizard.tsx:322–326` — "Prefilled from our directory — review each step before you submit." (static text; no per-field keep/edit/delete affordances). |

### 1.2 Step-by-step: CREATE today vs what CLAIM must show

Store: `draftVenueStore.ts` (AsyncStorage-persisted, per-brand multi-draft v2, :33–59 shape).
Submit: `VenueCreatorWizard.handleSubmit` (:129–253) → `biz_create_venue_listing` RPC → `upsertTier1Place` edge action.

| Step | CREATE today (user does) | Data written (store → RPC → DB) | CLAIM variant should pre-fill (place_pool source) | Keep / edit / delete semantics | GAP (what must change) |
|---|---|---|---|---|---|
| **Gate** (pre-wizard) | Types name; sees match cards; Yes/No/Skip | `workingName`, `placePoolId` | n/a — this IS the claim trigger | Yes = claim; No/Skip = create | Match card shows only 1 photo + address; no richness (hours/phone/rating banned by whitelist) to convince the owner it's really their place. Whitelist contract must be consciously widened or a second authed "claim detail" fetch added — flagged, not decided (§5 R-6). |
| **Category** (pre-wizard, skipped on claim) | Picks restaurant / play / creative_and_arts | `venueCategory` → RPC `p_venue_category` → `venue_listings.venue_category` (CHECK restaurant\|play\|creative_and_arts, `20261130000000:53`) | `primary_type`+`types` → `mapPoolTypesToVenueCategory` (`_shared/mapMinglaSlugToVenueCategory.ts:11–18`): play→play, creative_arts→creative_and_arts, **EVERYTHING else → restaurant** | Today: silently derived, never shown on claim path | **Fabrication risk at scale**: live distribution (probe §Appendix A) — only 451 play + 619 creative_arts of 35,249; 8,449 nature, 3,821 unmapped, 697 groceries, 1,083 movies_theatre, 145 flowers etc. ALL default to "restaurant". Claim variant needs the category surfaced for confirm/edit + an unmappable flag. |
| **s0 Address** | Mapbox autocomplete (`VenueStep1Address.tsx`, proxy per ORCH-1079) | `formattedAddress, lat, lng, city, countryCode` → RPC → `venue_listings.address/lat/lng/city/country_code` | Already pre-fills from match (`prefillDraftFromPoolMatch:19–24`). Source: `place_pool.address/lat/lng/city/country` | Keep (default) / edit via re-pick — googlePlaceId survives edits (locked §3.C) | None functional. Claim UI should present as "confirm what we have", not an empty search box (design). |
| **s1 Name + slug** | Types name; slug auto-derived, per-brand availability check (`VenueStep2NameSlug.tsx`; truth = `venue_listings UNIQUE (brand_id, slug)`) | `displayName, slug` → `p_name/p_slug` → venue row | Already pre-fills `name` from match; slug re-derived | Keep / edit | None functional. |
| **s2 Hours** | `BrandHoursEditor` 7 rows (`VenueStep4Hours.tsx`); default Mon–Sat 9–5, Sun closed | `hours[7]` → `p_hours` → **7 `brand_hours` rows venue-keyed** (`20261130000003:215–245`, ORCH-1186-A single-owner) + service-period seed (`biz_derive_service_periods_from_brand_hours`, :275). ALSO written BACK to `place_pool.opening_hours` as Google `{periods}` at tier-1 (`run-business-place-authoring-pipeline/index.ts:580`, `normalizeBusinessHoursForPool`) | Already pre-fills from `place_pool.opening_hours` (93.2% coverage) via `mapPoolOpeningHoursToBrandHours.ts` | Keep / edit / mark-closed per day | **F-2 (blocker):** overnight hours cannot pass validation — `venueWizardValidation.ts:32–34` rejects `open >= close` ("Overnight hours … aren't supported yet"), and the mapper emits e.g. 22:00→02:00 verbatim (`mapPoolOpeningHoursToBrandHours.ts:61–83` uses close.hour regardless of close.day). 4,211 drinks_and_music places servable — late-night claims will hard-stop at s2. Also: two hours truths post-claim (brand_hours venue rows AND place_pool.opening_hours) — pre-fill must round-trip losslessly or the deck card hours change on claim. |
| **s3 Contact** | Email and/or phone, ≥1 required (`VenueStep5Contact.tsx`) | `contactEmail, contactPhone` → `p_contact_email/p_contact_phone` → `venue_listings.contact_email/contact_phone` (public on venue page via `venue_public_view`, `20261130000003:994`) | Phone: `place_pool.national_phone_number` (51.1%). Email: **no place_pool source exists** — stays operator-entered | Keep / edit / delete (validation still ≥1) | `national_phone_number` is NOT in the PoolMatch whitelist/RPC — server contract must grow for phone pre-fill. |
| **s4 Description** | Optional tagline + description ≥20 chars (`VenueStep6Description.tsx`) | `tagline, description` → concatenated into `p_description` (`venueListingsService.ts:136–139`) → **place_pool.generative_summary via pipeline** (venue row has NO description column — `20261130000003:53–56`); also seeds AI `operator_inputs` (`VenueDeckReadinessSetup.tsx:288–291`) | Pre-draft from `editorial_summary` / `generative_summary` (40.9% either) | Keep / edit; if kept verbatim it becomes the AI's operator seed | Not pre-filled today; neither summary column is in the match payload. |
| **s5 Review + submit** | Reviews rows incl. "Photos: N selected" (`VenueStep7Review.tsx:49–52`) then **Submit for review** | See 1.3 pipeline below | Should reflect adopted content incl. gallery + cover decision | n/a | `photoUris` is **dead weight**: prefilled with ≤6 pool URLs (`prefillDraftFromPoolMatch:27`) but only ever rendered as a count (Review :51) — never uploaded, never sent to any RPC, never reaches the gallery (grep: only 5 non-test references, all store/prefill/count). |
| **Post-submit: deck-readiness** (`VenueDeckReadinessSetup.tsx`) | Hero cover (CoverPickerSheet), gallery upload 5–20 (required), website (required), price tiers, vibes, facet questionnaire, "Recommend me" AI → edit pitch → Approve & publish | See §2 adoption map for each | Gallery ← `stored_photo_urls` (100%, avg 4.8); cover ← chosen FROM that gallery or upload (0% have covers); website ← `place_pool.website` (90.5%); price ← `price_tiers` (49.2% already in consumer taxonomy) / `price_level`; facets ← the 20+ `serves_*`/`good_for_*`/etc boolean columns; pitch ← summary | Per-item keep/remove in gallery grid already exists (`handleRemovePhoto` :368–379) — but starts EMPTY on claim | **F-1/F-3 (destructive writes + no adoption):** resume path passes `initialGallery` = `get_authoring_context.gallery_urls` = `business_gallery_urls` only (index.ts:1631, `galleryUrls` :392–397) — the seeded `stored_photo_urls` are never offered. And picking a hero cover executes `stored_photo_urls = [mediaUrl]` (`handleSyncHeroMedia`, index.ts:1662) — **wipes the seeded gallery on the live deck card instantly**. |

### 1.3 What submit actually runs (identical machinery the claim variant rides)

1. `resolveAvailableVenueSlug` (wizard :172–176, brand-scoped).
2. RPC `biz_create_venue_listing` (`20261130000003:58–279`): validates (incl.
   `place_pool_google_place_id_mismatch` when `p_place_pool_id` set, :137–151); inserts
   `venue_listings` row **`claim_status = 'pending_review'` hardcoded** (:210); 7 venue-keyed
   `brand_hours` rows; per-venue `brand_place_pipeline_state` row (`status='draft'`); service
   periods. Never inserts a brand (I-PROPOSED-1255-NO-HIDDEN-BRAND…, CI-gated).
3. `upsertTier1Place` edge action (`run-business-place-authoring-pipeline/index.ts:539–685`).
   **Claim-existing branch (:558–611) mutates the LIVE place immediately:**
   `is_claimed=true, claimed_by=userId, business_hero_video_present,
   business_authoring_status='processing', opening_hours = wizard hours (OVERWRITE, :580),
   business_authoring_inputs`; then stamps `venue_listings.place_pool_id + google_place_id`
   (:590–597); pipeline → `linked_existing`. (`is_servable` untouched — card stays served.)
4. Wizard clears THIS brand's draft (:238) → `VenueDeckReadinessSetup`.
5. Tier-2 "Recommend me" (`handleTier2` :1207–1387): Gemini over `business_gallery_urls` +
   website scan; archives Google name/address/website into
   `raw_google_data.business_claim_diff` (`buildCrossValidation` :1122–1153); cap = initial + 3
   runs (:1228–1237).
6. `confirm_ai_outputs` (:1389–1505): **overwrites** `generative_summary` (:1468),
   `price_tiers`/`price_level` (:1476–1477), `stored_photo_urls = hero + business gallery`
   (:1478, `storedPhotosForDeck` :451–462), facet columns (:1479); `is_servable` prior-true
   preserved (`nextIsServableForConfirm` :414–418, I-NO-CLAIM-DEMOTION).

Partial-failure trap already live: if step 3 fails after step 2 succeeded, retrying submit hits
`venue_listings_place_uniq` against the operator's OWN half-created row and shows the
"already in our verification queue" copy (§3.4). Draft is only cleared after tier-1 success, so
the operator is stuck in a loop. Pre-existing; claim variant inherits it (R-7).

---

## 2. FIELD ADOPTION MAP — every adoptable place_pool column

Live column list verified against prod information_schema (Appendix A). "Copy vs reference":
**copy-on-start** = value copied into the client draft at claim start, server untouched;
**reference-until-edited** = read live from place_pool until the operator edits.
Today's wizard is copy-on-start for everything it prefils (pure client patch,
`prefillDraftFromPoolMatch`), and **nothing server-side moves until Review-submit** — that is the
safe abandon boundary that the claim variant inherits IF pre-fill stays client-side.

| place_pool column (coverage) | Claim wizard landing spot | Authoring-model landing (on submit/confirm) | Copy vs reference | On claim ABANDON (pre-submit) | On abandon AFTER submit (today) |
|---|---|---|---|---|---|
| `name` | s1 name | `venue_listings.name` | copy-on-start (already) | nothing written | venue row exists pending_review |
| `address,lat,lng,city,country` | s0 | `venue_listings.address/lat/lng/city/country_code` | copy-on-start (already) | nothing | as above |
| `google_place_id` | hidden dedup key | `venue_listings.google_place_id` | copy-on-start, edit-proof (ORCH-1079 lock) | nothing | as above |
| `primary_type,types` (+`primary_type_display_name`) | category confirm chip | `venue_listings.venue_category` | copy-on-start via mapper | nothing | as above |
| `opening_hours` (93.2%) | s2 hours rows | `brand_hours` (7 venue rows) AND write-back to `place_pool.opening_hours` at tier-1 | copy-on-start (already) | nothing | **live hours already overwritten** (index.ts:580) |
| `secondary_opening_hours` | — | — | n/a | n/a | 0 servable rows have it (probe) — ignore |
| `national_phone_number` (51.1%) | s3 phone | `venue_listings.contact_phone` | copy-on-start — **needs server payload** | nothing | — |
| `website` (90.5%) | deck-readiness website (required field) | `place_pool.website` re-written at tier-2/confirm (:1358, :1475) | copy-on-start — **needs server payload** | nothing | — |
| `price_tiers` (49.2% consumer taxonomy) / `price_level` / `price_range_*` | deck-readiness price chips (`PRICE_TIERS_BIZ`, VenueDeckReadinessSetup.tsx:123–128) | `place_pool.price_tiers + price_level` at confirm (:1476–1477; reverse map `PRICE_TIER_TO_GOOGLE_LEVEL` :424–429) | copy-on-start | nothing | overwritten only at confirm |
| `editorial_summary` / `generative_summary` (40.9% either) | s4 description pre-draft + AI operator seed + pitch editor | `place_pool.generative_summary` at confirm (:1468) | copy-on-start | nothing | overwritten only at confirm |
| `stored_photo_urls` (100%, avg 4.8, Mingla-hosted) | **editable starting gallery** in deck-readiness | `business_gallery_urls` (sync_gallery :1713) + `stored_photo_urls` (hero+gallery merge at confirm :1478) | copy-on-start of URLs is safe — photos are already Mingla-hosted, no re-upload; but note provenance (uploaded-by-us vs operator, R-5) | nothing IF client-side | **hero pick wipes it to [hero]** (:1662) |
| `photo_collage_url` (96.5%) + `photo_collage_fingerprint` | not a wizard surface | consumed by seeding/intelligence only (grep: admin-seed-places, run-place-intelligence-trial; discover-cards does NOT read it) | n/a | n/a | goes stale when stored_photo_urls replaced — nothing regenerates it (R-4) |
| `rating`, `review_count` (97.8%) | display-only trust signal (currently FORBIDDEN in whitelist) | not writable — place keeps them | reference | n/a | untouched (good) |
| `reservable` (20.0% true) | could inform reservations default | `venue_reservation_settings.reservations_enabled` — DEFAULT false (`20261003000004:27`, probe-locked by `20261003000007:62–78`); configured post-create in VenueReservationsModule | reference → one-time default suggestion | nothing | untouched today |
| `serves_*` (10), `good_for_*` (3), `outdoor_seating`, `live_music`, `allows_dogs`, `has_restroom`, `menu_for_children`, `dine_in`, `takeout`, `delivery`, `curbside_pickup` | deck-readiness facet questionnaire (ids match columns — `FACET_CORE/RESTAURANT/PLAY/ARTS`, VenueDeckReadinessSetup.tsx:132–169) | same columns, overwritten at confirm (:1479) | copy-on-start into `initialFacets` (today starts `EMPTY_FACETS`) | nothing | overwritten only at confirm |
| `accessibility_options`, `parking_options`, `payment_options` (jsonb) | no wizard surface exists | not written by pipeline | n/a | n/a | untouched — out of scope unless spec adds a surface |
| `reviews` (jsonb), `google_maps_uri` | no wizard surface | not written | reference (display candidates for the match/claim card) | n/a | untouched |
| `ai_signal_scores` | shown read-only post-approve in listing management (ORCH-1040) | re-scored at approve (per-signal run-signal-scorer) | reference | n/a | reset at approve |
| contact **email** | s3 email | `venue_listings.contact_email` | no source column — operator-entered | — | — |

---

## 3. THE APPROVAL + PUBLIC SEAM

### 3.1 Claim submissions ride the identical pipeline — confirmed

`biz_create_venue_listing` sets `claim_status='pending_review'` unconditionally
(`20261130000003:210`) whether `p_place_pool_id` is null (create) or set (claim). The per-venue
machine is D-4-byte-identical: none→pending_review→verified/rejected; pending_review +
`claim_follow_up_at` = needs-fixes; verified→suspended/revoked; resubmit→pending_review
(`20261130000000:9–13`, `biz_review_venue_claim` `20261130000003:302–457`). Business-app card
state renders via `ListingStatusChip` fed by `listingStatusView()` (ListingStatusChip.tsx:1–9);
`VenueListingContent.tsx:132–133, 233–235` keys pending/needs-fixes/rejected/live off
`venue.claimStatus`. Unchanged per META-ORCH-1255 D-4 — the claim variant adds no states.

### 3.2 The live deck card between claim-submit and approve

- **Stays served.** Tier-1 never touches `is_servable`; tier-2 and confirm preserve prior `true`
  (`nextIsServableForConfirm` index.ts:414–418, :1343–1345, :1459–1461 — I-NO-CLAIM-DEMOTION).
  Consumer deck reads `place_pool` servable rows only (`discover-cards/index.ts:847–925`), it
  never reads `claim_status`.
- **But content is NOT frozen until approve.** Pre-approval mutations of the live card, in order:
  wizard hours overwrite `opening_hours` at tier-1 (:580); hero pick replaces
  `stored_photo_urls` with `[hero]` (:1662); confirm overwrites summary/price/facets/photos
  (:1463–1481). So "authored precedence" today = **in-place overwrite at operator-confirm time**,
  not at admin-approve time, and not a read-time coalesce.
- Google originals survive ONLY for name/address/website, archived under
  `raw_google_data.business_claim_diff.archived_google` (:1137–1148). Hours, photos, price,
  summary, facets have **no archive and no restore path**.

### 3.3 What flips at approve — the exact reads

Admin approve = edge `admin-review-venue-claim`:
1. RPC `biz_review_venue_claim('approve')` (requires `mark_called` first, :380–382; sets
   `claim_status='verified'`, clears rejection/follow-up, flags same-google-place
   pending_review rows `duplicate_of_venue_id` :404–413; hard-blocks if the google place is
   verified on ANOTHER venue row `google_place_already_verified` :386–394).
2. `business_recommend_edit_count` reset to 0 (edge :590–597).
3. `runApproveGoLive` (edge :96–230): re-bounce over CURRENT data; flip
   `is_servable=true, is_active=true` (no-op for an already-servable claim); loop ACTIVE
   signals → `run-signal-scorer` per signal over the (now authored) content; total-failure →
   rollback servable.
4. Public surfaces gated on `claim_status='verified'` light up:
   - `venue_public_view` (`20261130000003:990–1009`) — the ONLY anon venue read; serves
     `/b/{brandSlug}/v/{venueSlug}`; columns = venue row (name, cover, contact, category) +
     brand theme + `brand_hours` agg + `pp.stored_photo_urls AS pool_photo_urls`.
   - `pg_venue_reservable_for_place` (:1200–1238) and `pg_brand_experiences_for_place`
     (:1029–1186) — consumer resolvers keyed on `v.claim_status='verified'`.
   - anon `place_pool` read gate `_orch1255_place_has_verified_venue` (:1319–1352).

So the "attribution flip" at approve = public venue page + resolvers + anon place read + fresh
signal scores. The deck card's *content* precedence flipped earlier, at confirm (3.2).

### 3.4 Double-claim guard UX today

- DB truth: partial unique index `venue_listings_place_uniq ON (place_pool_id) WHERE place_pool_id
  IS NOT NULL` (`20261130000000:74–75`; **verified present in prod**, Appendix A).
- Surfaced copy: 23505 without "slug" in message →
  `"This place is already in our verification queue. Contact support if you need help."`
  (`venueListingsService.ts:160–171`).
- Ordering is safe: the RPC insert (and thus the 23505) fires BEFORE `upsertTier1Place`, so a
  losing second claim never mutates the live place.
- UX gap: because the claim search never filters claimed places (§1.1), the second brand walks
  ALL six steps before learning at submit. Second guard at approve: `google_place_already_verified`.

---

## 4. LEGACY AUDIT

| Item | Verdict | Evidence |
|---|---|---|
| `place_pool.is_claimed` | **Write-only legacy — no live reader.** 0 rows true in prod (Appendix A). Written at tier-1 (index.ts:575, :638), reset by orphan cleanup (`20261130000004:38`). Grep across app-mobile / mingla-business / mingla-admin / functions / migrations: no non-test reader except a derived alias in the baseline view (`20260505000000:7318` — `(pp.claimed_by IS NOT NULL) AS is_claimed`, itself pre-1255 legacy). Safe to treat as inert bookkeeping; do not build claim logic on it. |
| `place_pool.claimed_by` | **NOT dead.** Live RLS arm: `place_pool_business_owner_update` USING/WITH CHECK `claimed_by = auth.uid()` (`20261130000003:1354–1388`, re-keyed by 1255 but the claimed_by arm "survives verbatim" per :1305–1308). 0 rows set in prod today, but the moment a claim runs tier-1 it becomes the operator's direct place-UPDATE grant. |
| `brands.claim_status` / `brands.place_pool_id` | Legacy-inert per 1255 (COMMS-0064; `20261130000000:23–25, 84–87`). `venueListingsService.VenueListing.claimStatus` (venue-row field) is the live one. |
| Pre-1255 claim UI remnants | `VenueClaimStatusBanner.tsx` still exists under `components/brand/` (brand-keyed claimStatus) — pre-1255 shape; per-venue status now renders via ListingStatusChip/VenueListingContent. Not part of the create/claim flow; flag for the spec's do-not-touch or cleanup list. |
| `biz_create_venue_brand_authoring` | Fail-soft stub raising `venue_creation_moved:update_app` (`20261130000003:1262–1290`); guarded by CI gate `orch-1255-no-hidden-brand-on-venue-create.mjs` + SQL probe. **Must remain a stub** — any claim work re-adding a body fails CI. |
| `biz_create_venue_brand_pending_review` | DROPPED (`20261130000003:1296–1298`). |
| Comment drift (cosmetic) | `VenueStep1Address.tsx:48–50` still names `biz_create_venue_brand_authoring` as the mismatch-throwing RPC; the live thrower is `biz_create_venue_listing`. Same check, stale name. |

---

## 5. RISK REGISTER + OPEN QUESTIONS (for the SPEC)

| # | Risk / question | Evidence anchor | Framing (options, not decisions) |
|---|---|---|---|
| R-1 | **Hero pick destroys the seeded gallery on the LIVE card** — `stored_photo_urls = [mediaUrl]` fires pre-approval | index.ts:1646–1664 | Claim variant must define the photo write model: (a) never write stored_photo_urls until confirm/approve, (b) merge instead of replace, or (c) stage authored photos in business_gallery_urls only. Undecided here. |
| R-2 | **Overnight hours hard-block s2** for seeded late-night venues (mapper emits 22:00→02:00; validator rejects open>=close) | mapPoolOpeningHoursToBrandHours.ts:61–83; venueWizardValidation.ts:32–34 | Options: extend validator/editor to overnight; or clamp/split on prefill with an explicit "review this day" flag. Blocks ~drinks_and_music cohort (4,211 servable). |
| R-3 | **Hours dual-truth**: brand_hours (venue) vs place_pool.opening_hours (deck) — tier-1 overwrites the live deck hours at submit, pre-approval | 20261130000003:215–245; index.ts:580 | Spec must state when (if ever) the claim's hours reach the live place: at approve vs at submit (today), and whether the Google original is archived. |
| R-4 | **Collage staleness**: 96.5% of places have `photo_collage_url`; nothing regenerates it when stored_photo_urls changes | probe; grep — no writer outside seeding/intelligence | Determine whether any live surface still renders the collage; if yes, photo adoption needs a regen hook; if no, note it dead for claims. |
| R-5 | **Photo provenance**: adopted gallery photos are Google-sourced, Mingla-hosted; operator "adoption" makes them look operator-authored | poolMatchResponse.photoUrlsFromRow; sync_gallery :1704–1714 | Spec should carry a provenance note (e.g. in business_authoring_inputs) distinguishing adopted-from-pool vs operator-uploaded; affects future takedown/attribution. |
| R-6 | **Whitelist contract**: phone/website/price/summary/facets/full-gallery pre-fill requires widening the claim payload; `rating`/`review_count` are explicitly FORBIDDEN response keys today | poolMatchResponse.ts:41–54; RPC RETURNS 20260809:499–512 | Options: widen `biz_search_place_pool_for_claim` + whitelist (authed-only surface), or add a second authed "claim-detail" fetch fired on YES. Security review required either way (the ban exists to stop scraping AI/score columns; probably also rating — confirm intent with Seth). |
| R-7 | **Half-created-claim trap**: RPC success + tier-1 failure leaves a pending venue row that 23505-blocks the operator's own retry with support copy | wizard :181–223; venueListingsService.ts:160–171 | Claim variant raises the frequency (more moving parts). Spec should define resume-not-recreate on retry. |
| R-8 | **Category default fabrication**: 97% of servable places would land `venue_category='restaurant'` (incl. 8,449 nature) | mapMinglaSlugToVenueCategory.ts:11–18; probe Appendix A | Options: surface a category-confirm step in the claim variant; and/or define unmappable handling (block, flag for admin, or new category — CHECK constraint change is a schema decision). |
| R-9 | **Draft-store shape**: `DraftVenueState` has no fields for website, priceTiers, facets, gallery adoption, cover choice, or per-item keep/edit/delete state; deck-readiness state is component-local and lost on exit (only server-synced parts resume) | draftVenueStore.ts:33–59; VenueDeckReadinessSetup.tsx:220–245 | Spec must decide: extend the persisted per-brand draft to carry adoption state (keeps abandon = zero server writes), vs earlier server staging (breaks the clean abandon boundary). |
| R-10 | **Claim search shows already-claimed places** → 6-steps-then-fail UX | 20260809:531–536; §3.4 | Option: exclude/annotate matches with an existing venue_listings row at search time (server-side — venue_listings is not anon/other-brand readable, so the RPC must do it). |
| R-11 | **Reservable hint**: `venue_reservation_settings.reservations_enabled` DEFAULT false is probe-locked (invariant probe raises if default ≠ false) | 20261003000004:27; 20261003000007:62–78 | Google `reservable=true` (20.0%) can only be a UI default-suggestion in the reservations module, not a DB default change. |
| Q-1 | Cover step placement: the mandatory cover-from-gallery decision — inside the claim wizard (new step) or in deck-readiness (where CoverPickerSheet + venue target already exist, VenueDeckReadinessSetup.tsx:797–808)? | §1.2 | For spec/design. Note `get_authoring_context` already fakes `cover_media_url = stored_photo_urls[0]` (:1624) — a claim resume would misreport a "cover" that is actually a seeded photo. |
| Q-2 | Should `editorial_summary` (Google-authored) pre-draft the pitch verbatim, or only seed the AI (`operator_inputs`)? Copyright/tone question for Seth. | §2 | For spec. |
| Q-3 | Keep/edit/delete UX granularity: per-field (every step) vs per-step confirm. Dispatch says "walked through what exists, keep/edit/delete each item" — designer contract needed at SPEC time. | product intent | mingla-designer invocation at SPEC. |

---

## Appendix A — live prod probes (read-only, 2026-07-02, project gqnoajqerqhnvulmnyvv)

1. Counts: `venue_listings` rows = 0 · `is_claimed=true` = 0 · `claimed_by` set = 0 ·
   `business_author_brand_id` set = 0 · servable+active places = 35,249 ·
   `venue_listings_place_uniq` index present = 1.
2. Coverage over the 35,249 servable+active: stored_photo_urls 35,249 (100%, avg 4.8) ·
   opening_hours 32,867 (93.2%) · website 31,903 (90.5%) · national_phone_number 18,005 (51.1%) ·
   price signal (price_level or range) 15,765 (44.7%) · **price_tiers array already populated
   17,346 (49.2%)** · summary (editorial or generative) 14,413 (40.9%) · photo_collage_url
   34,018 (96.5%) · reservable=true 7,036 (20.0%) · secondary_opening_hours 0.
3. Category derivation distribution (via `pg_map_primary_type_to_mingla_category`): nature 8,449 ·
   brunch_lunch_casual 7,859 · icebreakers 7,465 · drinks_and_music 4,211 · (unmapped) 3,821 ·
   movies_theatre 1,083 · groceries 697 · creative_arts 619 · play 451 · upscale_fine_dining 449 ·
   flowers 145. → venue_category map yields play 451, creative_and_arts 619, restaurant-by-default
   34,179.
4. `place_pool` column list verified against information_schema (all §2 columns exist as named).

## Appendix B — investigation manifest (files read verbatim)

- mingla-business/app/venue/create.tsx · app/venue/deck-readiness.tsx
- mingla-business/src/components/venue/: VenueCreatorWizard.tsx, VenueStep1Address.tsx,
  VenueStep2NameSlug.tsx, VenueStep4Hours.tsx, VenueStep5Contact.tsx, VenueStep6Description.tsx,
  VenueStep7Review.tsx, VenueDeckReadinessSetup.tsx, venueWizardValidation.ts,
  ListingStatusChip.tsx, VenueListingContent.tsx (targeted), VenueCardList.tsx (targeted)
- mingla-business/src/components/brand/PoolMatchCard.tsx
- mingla-business/src/hooks/: usePoolMatchSearch.ts, useVenueListings.ts
- mingla-business/src/services/: poolSearchService.ts, venueListingsService.ts,
  businessPlaceAuthoringService.ts
- mingla-business/src/store/draftVenueStore.ts · src/utils/: prefillDraftFromPoolMatch.ts,
  mapPoolOpeningHoursToBrandHours.ts, venueBrandHours.ts (targeted), businessTodos.ts (targeted)
- mingla-business/src/types/poolMatch.ts
- supabase/functions/: claim-search-pool/index.ts, run-business-place-authoring-pipeline/index.ts,
  admin-review-venue-claim/index.ts (approve orchestration), discover-cards/index.ts (card
  transform), _shared/poolMatchResponse.ts, _shared/mapMinglaSlugToVenueCategory.ts,
  _shared/derivePoolCategory.ts
- supabase/migrations/: 20261130000000 (venue_listings core), 20261130000003 (claim RPCs + views
  + stub + RLS re-key), 20261130000004 (orphan cleanup), 20260809000000 (claim search RPC),
  20261003000004/7 (reservation settings default + probe), 20260505000000 (baseline, targeted)

## Confidence

**Proven** for all static/code/schema/data claims (file:line + live prod probes). No sim run:
this dispatch is a code-and-data inventory of two flows (one of which — the claim variant — does
not exist yet to drive), matching the "code audit only" exemption; the create flow's behavior
claims trace to the exact write statements quoted. Business-web authed runtime remains
unreachable for claims-capping per standing memory.

## Recommended next phase

SPEC (claim-variant of the create wizard + adoption layer + non-destructive pre-approval write
model), with a mingla-designer contract for the keep/edit/delete walkthrough and cover-from-
gallery chooser. Scope anchor: §1.2 gap column + §5 R-1/R-2/R-6/R-9 are the load-bearing
decisions; §3 confirms zero new approval machinery is needed.
