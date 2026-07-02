# INVESTIGATION — META-ORCH-1255 [multi-venue first-class creation]

**Phase:** INVESTIGATE (forensic map for SPEC — feature scoping, not a bug hunt)
**Worktree:** `~/Desktop/mingla-orchs/orch-1255-[venue-first-class-multi]` on branch `orch-1255-venue-first-class-multi`
**Date:** 2026-07-01
**Live DB probed READ-ONLY:** project `gqnoajqerqhnvulmnyvv` (live prod — COMMS-0061 honored, zero writes)
**Live-fire exemption:** code/schema/data audit for a feature spec — no reproducer-bound bug; sim run not required (SKILL Prime Directive 7 exemption). Backend runtime truth WAS verified live (pg_proc / pg_policies / pg_constraint / row counts).

---

## Executive summary (layman)

Today Mingla has **no such thing as "a brand with several venues" — every venue listing IS its own brand**. When an operator finishes the "List your venue" wizard, the app silently creates a **brand-new brand row** whose `claim_status` is born `pending_review`, links exactly one `place_pool` row to it, and even switches the operator's active brand to that new venue-brand. The admin approval queue, the emails, the push notifications, the public page, the Hub Venue tab, the to-do rows, the reservations suite, the menus, and the hours are all keyed to **that one brand = that one venue**.

The good news: the underlying **place** data (photos, gallery, AI scores, deck servability, authoring status) already lives per-`place_pool` row, and the deck/consumer side treats each place row independently. The pipeline-state table is even shaped `(brand_id, place_pool_id)` — it is one `UNIQUE (brand_id)` constraint plus a handful of brand-level claim columns away from being per-venue. And prod data is empty on this axis (**0** brands bound to a venue, **0** pipeline rows), so the backfill burden is essentially nil.

The hard part is not the tables — it is that the **admin approval pipeline's unit of review is a brand row** (`brands.claim_status`), and the dispatch requires that pipeline to stay EXACTLY as-is. That forces a spec-level choice (documented, not decided, in §Verdict): move the claim columns onto a per-venue row and re-key four admin RPCs' lookups, or keep hidden per-venue "listing brands" under a parent brand. The rest — the 4th "+"-sheet option, the Hub card list, per-venue listing management — is client work with clear insertion points, all mapped below with file:line.

---

## Investigation manifest (files read, in trace order)

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `mingla-business/src/components/ui/UniversalCreatorSheet.tsx` | code/UI | 4th-option insertion point |
| 2 | `mingla-business/app/(tabs)/home.tsx` (creator wiring ~636-645, ~971-975) | code/UI | sheet mounts |
| 3 | `mingla-business/app/(tabs)/hub/_layout.tsx` | code/UI | Venue-tab gating + creator mount |
| 4 | `mingla-business/src/hooks/useHubTabs.ts` | code | tab-visibility predicate |
| 5 | `mingla-business/app/(tabs)/hub/listing.tsx` | code/UI | Venue tab route |
| 6 | `mingla-business/src/components/venue/VenueSuiteShell.tsx` | code/UI | suite scoping |
| 7 | `mingla-business/src/components/venue/VenueListingContent.tsx` | code/UI | listing mgmt surface |
| 8 | `mingla-business/src/components/venue/VenueCreatorWizard.tsx` (submit path 85-255) | code | creation flow truth |
| 9 | `mingla-business/app/venue/create.tsx` | code | gate→category→wizard→success |
| 10 | `mingla-business/app/venue/deck-readiness.tsx` + `src/utils/deckReadinessRoutes.ts` | code | per-venue edit route params |
| 11 | `mingla-business/src/services/businessPlaceAuthoringService.ts` | code | pipeline client + `.eq(brand_id).maybeSingle()` |
| 12 | `mingla-business/src/hooks/useBrandPlacePipelineState.ts` | code | query keys |
| 13 | `mingla-business/src/utils/listingStatus.ts` | code | status-label logic |
| 14 | `mingla-business/src/utils/businessTodos.ts` + `src/hooks/useBusinessTodos.ts` | code | venue to-do rows |
| 15 | `mingla-business/src/components/brand/BrandEditView.tsx` (385-394, 501-539) | code/UI | physical-location toggle |
| 16 | `mingla-business/src/utils/brandPatch.ts`, `src/services/brandMapping.ts` | code | hasPhysicalLocation write path |
| 17 | `mingla-business/src/services/brandsService.ts` (395-495) | code | `createVenueBrandPendingReview` → RPC |
| 18 | `mingla-business/src/hooks/useBrands.ts` (660-710) | code | `useCreateVenueBrand` |
| 19 | `mingla-business/src/services/venueClaimService.ts`, `venueClaimBannerLogic.ts` | code | claim status client |
| 20 | `mingla-business/app/brand/[id]/listing.tsx` | code | legacy redirect (deep-link targets) |
| 21 | `mingla-business/src/types/brand.ts` (295-358) | code/types | claimStatus/placePoolId/hasPhysicalLocation |
| 22 | `mingla-business/src/services/publicEventsService.ts` (venue sections) | code | public /b/{slug} venue fetch |
| 23 | `supabase/functions/run-business-place-authoring-pipeline/index.ts` (full keying + 480-690) | edge | pipeline writer |
| 24 | `supabase/functions/admin-review-venue-claim/index.ts` (60-230, 480-700) | edge | approve/reject/go-live |
| 25 | `supabase/functions/venue-claim-submitted-email/index.ts` (header) | edge | submit email trigger |
| 26 | `supabase/migrations/20260613000000_ve1_*.sql`, `20260614000000_ve1_pr_review_hardening.sql`, `20260618000000_ve2_pool_match_claim.sql`, `20260619000000_ve3_admin_claim_review.sql`, `20260622000000_ve4_claimed_venues_public_view.sql` | schema | claim-flow origin |
| 27 | `supabase/migrations/20260729000000_meta_orch_0972_universal_authoring.sql` | schema | latest `biz_create_venue_brand_pending_review` + `biz_review_venue_claim` |
| 28 | `supabase/migrations/20260809000000_meta_orch_1009_sub_e_business_supply_feeder.sql` (+000300 compat) | schema | pipeline-state table |
| 29 | `supabase/migrations/20260814000000_orch_1040_brand_has_physical_location.sql` | schema | the toggle column |
| 30 | `supabase/migrations/20260831000000_meta_orch_1062_admin_vetting_rpcs.sql`, `20260901000000_orch_1064_venue_claim_feedback.sql`, `20260909000000_orch_1073_admin_suspend_delete_listing.sql` | schema | admin state machine |
| 31 | `supabase/migrations/20261003000000/…000004_orch_1148_*.sql`, `20261116000000_orch_1186_a_*.sql`, `20261118000000_orch_1186c_menus_menu_items.sql`, `20261007000000_orch_1138_rework_deck_supply.sql` | schema | venue-suite + deck-supply keying |
| 32 | `mingla-admin/src/services/adminClaimsService.js`, `mingla-admin/src/pages/ClaimsPage.jsx` (tab keying) | code/admin | review queue keying |
| 33 | `app-mobile/src/hooks/useVenueExperiences.ts`, `useVenueReservable.ts` | code/consumer | per-place consumer hooks |
| 34 | Live DB: information_schema.columns, pg_constraint, pg_policies, pg_proc, row counts | runtime/data | authoritative current state |
| 35 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` (I-VENUE-CLAIM-OPTIONAL, I-PROPOSED-1218-VENUE-AUTHORING-NO-VENDOR-LEAK, I-CLAIM-REBOUNCE-ON-APPROVE, I-SCORER-INVOKE-HAS-SIGNAL-ID) | docs | binding invariants |

---

## Q-scorecard

- **Q1 — Where does the one-venue-per-brand assumption live?** Everywhere the claim lifecycle lives on the `brands` row, plus `UNIQUE (brand_id)` on `brand_place_pipeline_state`, plus every brand-keyed venue-suite table. Full inventory in F-1…F-8 + table below. **Verdict: answered, proven (schema+code+live DB).**
- **Q2 — What is the admin approval pipeline, end to end, and what is its keying?** A brand-row state machine on `brands.claim_status` (`none → pending_review → verified/rejected`, `verified → suspended/revoked`, resubmit → `pending_review`), driven by 4 brand-keyed RPCs + 1 edge fn; deck go-live is a separate per-place flip (`place_pool.is_servable`). Documented in §Pipeline. **Verdict: answered, proven.**
- **Q3 — Minimal data-model change for N venues per brand?** Drop `UNIQUE (brand_id)` on the pipeline table → `UNIQUE (brand_id, place_pool_id)` and move the 4 claim-lifecycle columns per-venue (on that table or a sibling), then re-key 4 RPC lookups + 3 RLS/view predicates. Backfill ≈ nil (live counts). §Verdict. **Verdict: answered, proven for schema; flagged tension with "pipeline unchanged".**
- **Q4 — Public/consumer blast radius for N venues?** Consumer deck already per-place (unchanged); `/b/{slug}` and `pg_brand_experiences_for_place`/`pg_venue_reservable_for_place` resolve brand↔place 1:1 and must change. Options in §Public options. **Verdict: answered, proven.**
- **Q5 — Exact insertion points for the 4th creator option + hub gating change + toggle removal blast?** Mapped with file:line in F-9…F-12. **Verdict: answered, proven (source).**
- **Q6 — How must the venue to-do rows re-scope?** F-13. **Verdict: answered.**

---

## Findings

### F-1 — CONFIRMED: a venue listing IS a brand today — the wizard creates a NEW brand born `pending_review` (answers Q1, Q2)
- **Symptom:** "one venue per brand" is not a limitation of a venue table — there is no venue table; the brand row is the venue listing.
- **Layer:** code + schema + runtime (live pg_proc).
- **Probe:** read `VenueCreatorWizard.tsx` submit path; read `brandsService.ts:441-495`; live SQL `select proname… from pg_proc where proname in ('biz_create_venue_brand_authoring',…)`.
- **Evidence:**
  - `mingla-business/src/components/venue/VenueCreatorWizard.tsx:175` — `const brand = await createVenue.mutateAsync({ … })` then `:198` `upsertTier1Place({ brandId: brand.id, … })`, then `:225` `useCurrentBrandStore.getState().setCurrentBrandId(brand.id);` with the comment (lines 220-224): *"make the just-created venue the ACTIVE brand. The venue is its own brand"*.
  - `mingla-business/src/services/brandsService.ts:446` — the RPC called is `biz_create_venue_brand_authoring`.
  - `supabase/migrations/20261116000000_orch_1186_a_hours_single_owner_seed.sql` (latest def, ~line 225-264 of fn body) — `INSERT INTO public.brands (…, claim_status, …) VALUES (…, 'pending_review', …)`. Live pg_proc confirms `biz_create_venue_brand_authoring` exists and `mentions_pending_review = true`.
- **Mechanism:** the "+ Create venue listing" feature cannot simply add a row option; the entire creation flow's terminal action spawns a brand and re-points the operator's active brand at it. First-class multi-venue means this flow must attach a venue to the CURRENT brand instead.
- **Severity:** CONFIRMED ROOT CAUSE (of the one-venue model).

### F-2 — CONFIRMED: `brand_place_pipeline_state` is hard-locked to one row per brand (Q1, Q3)
- **Symptom:** the pipeline state (draft/processing/needs_fix/deck_eligible/failed) cannot exist per-venue.
- **Layer:** schema + code (edge + client).
- **Probe:** live `pg_constraint`; grep of edge fn + service.
- **Evidence (live DB):** `brand_place_pipeline_state_brand_unique` = `UNIQUE (brand_id)`; columns `brand_id uuid NOT NULL` (FK brands ON DELETE CASCADE), `place_pool_id uuid NULL` (FK place_pool ON DELETE SET NULL), `status` CHECK in ('draft','processing','needs_fix','deck_eligible','failed').
  - Edge writer: `supabase/functions/run-business-place-authoring-pipeline/index.ts:673` — `.upsert(row, { onConflict: "brand_id" })`.
  - Client reader: `mingla-business/src/services/businessPlaceAuthoringService.ts:330-334` — `.from("brand_place_pipeline_state").select(…).eq("brand_id", brandId).maybeSingle()`.
  - Query key: `useBrandPlacePipelineState.ts:15-21` — `byBrand(brandId)` only.
- **Mechanism:** if a second venue were created for the same brand without schema change, the edge upsert would **silently overwrite** the first venue's pipeline row (onConflict brand_id) — data loss, not an error.
- **Severity:** CONFIRMED ROOT CAUSE (hard constraint) — but note the table already CARRIES `place_pool_id`, so it is the natural per-venue row.

### F-3 — CONFIRMED: the claim lifecycle (the admin approval unit) lives on `brands` columns (Q1, Q2, Q3)
- **Layer:** schema + runtime.
- **Probe:** live information_schema + pg_constraint + migration chain (ve1 → ve3 → 0972 → 1073 latest defs verified via pg_proc).
- **Evidence (live DB, `brands` table):** `claim_status text NOT NULL DEFAULT 'none'` with CHECK `('none','pending_review','verified','rejected','suspended','revoked')`; `claim_follow_up_at timestamptz`; `claim_decision_emailed_at timestamptz`; `rejection_reason` (read by clients); `place_pool_id uuid NULL` FK → place_pool ON DELETE SET NULL; `google_place_id text`; `venue_category` CHECK ('restaurant','play','creative_and_arts'); `has_physical_location boolean NOT NULL DEFAULT false`; `duplicate_of_brand_id uuid` FK brands.
- **Mechanism:** "pending admin approval" for a venue card = `brands.claim_status = 'pending_review'` on the venue's own brand row (with `claim_follow_up_at` non-null = the "needs fixes / updates requested" sub-state). The card-status source for the new Hub card list must read exactly these fields per venue — wherever they end up living.
- **Severity:** CONFIRMED ROOT CAUSE.

### F-4 — CONFIRMED: per-venue data already lives on `place_pool` — the place layer is multi-venue-ready (Q1, Q3, Q4)
- **Layer:** schema + data.
- **Probe:** live column list + counts.
- **Evidence (live):** `place_pool` carries `business_author_brand_id uuid` FK brands, `business_authoring_status` CHECK ('none','draft','processing','needs_fix','deck_eligible','failed'), `business_authoring_inputs jsonb`, `business_gallery_urls text[]`, `business_hero_video_present`, `business_recommend_edit_count`, `is_claimed`, `claimed_by` FK auth.users, `is_servable`, `bouncer_reason`, `ai_signal_scores`, `deleted_at/deleted_reason` (ORCH-1073). NO unique constraint ties a brand to one place from this side.
- **Mechanism:** photos, AI outputs, gallery, deck servability and go-live are per-place today. The consumer deck consumes place rows (each servable row = one card), so N venues = N deck cards works without consumer-deck changes.
- **Severity:** SECONDARY (enabling) finding.

### F-5 — CONFIRMED: the entire venue SUITE is brand-keyed — one hours set, one reservations config, one menu, one table inventory per brand (Q1, Q3 blast radius)
- **Layer:** schema.
- **Probe:** migration reads.
- **Evidence:**
  - `20261003000004_orch_1148_venue_reservation_settings.sql:24` — `brand_id uuid PRIMARY KEY REFERENCES public.brands(id)` (one settings row per brand); `place_pool_id uuid NULL` annotation only.
  - `20261003000000_orch_1148_venue_tables.sql:27-28` — `brand_id uuid NOT NULL` + nullable `place_pool_id`.
  - `20261118000000_orch_1186c_menus_menu_items.sql:44,68` — menus/menu_items keyed `brand_id`.
  - `20261116000000_orch_1186_a_hours_single_owner_seed.sql:2-6` — "brand_hours is the SINGLE OWNER" of venue hours; `venue_availability_config (brand_id, place_pool_id)` seeded from `b.place_pool_id`.
  - All `VenueSuiteShell` modules take only `brandId` (`VenueSuiteShell.tsx:64-74,163-188`).
- **Mechanism:** under multi-venue, tables/hours/menus/reservation settings become ambiguous ("which location?"). Under the current brand-per-venue model they are correct. This is the largest hidden scope cliff of the feature.
- **Severity:** SUSPECTED CONTRIBUTOR to scope — MUST be a spec scope decision (v1 could scope the suite per-venue only via the card→management view, or keep suite brand-level and only multi-venue the LISTING).

### F-6 — CONFIRMED: RLS + public read models bind public visibility to `brands.place_pool_id` + `brands.claim_status='verified'` (Q1, Q3, Q4; security inspection)
- **Layer:** schema (RLS) + runtime (live pg_policies).
- **Probe:** live `pg_policies` for brands/place_pool/brand_place_pipeline_state/venue_claim_feedback; ve4 + 0972 migrations.
- **Evidence (live policies, verbatim predicates):**
  - `place_pool` · "Public can read place_pool for verified-claimed venues" (anon+auth SELECT): `EXISTS (SELECT 1 FROM brands b WHERE b.place_pool_id = place_pool.id AND b.deleted_at IS NULL AND b.claim_status = 'verified')`.
  - `place_pool` · `place_pool_business_owner_update` (auth UPDATE): owner via `claimed_by = auth.uid()` OR brand where `b.id = place_pool.business_author_brand_id OR b.place_pool_id = place_pool.id`.
  - `brand_place_pipeline_state` · owner select/insert/update via `b.id = brand_id AND b.account_id = auth.uid()` (fine for multi-row).
  - `venue_claim_feedback` · admin ALL via `is_admin_user()`; owner SELECT via `biz_brand_effective_rank_for_caller(brand_id) >= biz_role_rank('brand_owner')` — brand-keyed, place-agnostic (`place_pool_id` column exists but is not in the predicate).
  - Views: `claimed_venues_public_view` (ve4/0972) = `brands JOIN place_pool ON pp.id = b.place_pool_id WHERE claim_status='verified'` — one venue row per brand slug.
- **Mechanism:** any per-venue re-keying MUST update these predicates in lockstep; the public-read policy in particular is the anon gate for venue photos/hours — get it wrong and either verified venues vanish from public pages or unverified place data leaks.
- **Severity:** CONFIRMED (security-load-bearing surface list). Not a bug today.

### F-7 — CONFIRMED: the consumer/public place→brand resolvers assume the 1:1 reverse pointer (Q4)
- **Layer:** schema + code.
- **Probe:** `20261007000000_orch_1138_rework_deck_supply.sql:332,467-468`; app-mobile hooks.
- **Evidence:** `pg_brand_experiences_for_place(p_place_pool_id)` … `WHERE b.place_pool_id = p_place_pool_id AND b.claim_status = 'verified'`; consumer `useVenueExperiences.ts` ("experiences authored by the VERIFIED brand that has claimed the venue") and `useVenueReservable.ts:39-41` → `pg_venue_reservable_for_place(p_place_pool_id)` (returns brand_id for checkout). Same 1:1 join in `admin_suspend_listing` (`20260909…_orch_1073…sql:94` — `where place_pool_id = p_place_id and … claim_status='verified' limit 1`).
- **Mechanism:** with a join table / per-venue rows, these three resolvers change from `b.place_pool_id = X` to the new binding. Behavior per PLACE stays identical (each deck card still resolves one brand).
- **Severity:** SECONDARY (contained, enumerable change set).

### F-8 — CONFIRMED (data layer): prod has ZERO venue-bound brands — backfill burden ≈ nil (Q3)
- **Layer:** data (live, read-only).
- **Probe:** `select count(*)…` battery on live prod.
- **Evidence (2026-07-01):** brands_total=10; brands_with_place=0; brands_physical (has_physical_location)=1; pipeline_rows=0; authored_places=0 (`business_author_brand_id` all NULL); claimed_places=3; brands.claim_status='none' for all 10. The 3 claimed `place_pool` rows (Lumen Wine Bar, The Tuscanny Place, Lantern & Vine — all `fetched_via='business_authored'`, `claimed_by=b17e3e15-…`, `business_author_brand_id=NULL`) are **orphans**: no brand row points at them (consistent with the 2026-06-22 prod test-data wipe deleting brands while `ON DELETE SET NULL` kept the places).
- **Mechanism:** whatever data-model the spec picks, existing-brand backfill is a no-op in prod; the only cleanup decision is the 3 orphaned business_authored place rows (2 of them `deck_eligible`/claimed — verify none is servable before ignoring; none is referenced by any brand).
- **Severity:** CONFIRMED (favorable).

### F-9 — CONFIRMED: 4th root option insertion point (Q5)
- **Layer:** code.
- **Evidence:** `mingla-business/src/components/ui/UniversalCreatorSheet.tsx`
  - `ROOT_OPTIONS` const at lines **113-144** (3 entries: event/experience/trip). A 4th entry with `route: "/venue/create"` uses the existing close+push path (`pushRoute`, lines 216-227; `handleRootSelect` 229-239 — route options need no new logic).
  - Type changes required: `RootOption.key` union `"event" | "experience" | "trip"` (line 93) and the local `IconName` union (line 90: `"calendar" | "sparkle" | "globe" | "flash" | "list" | "chevR"`) — a venue-appropriate glyph (e.g. `"location"`, already used by BrandEditView's CTA `leadingIcon="location"`) must be added to the union and exist in `src/components/ui/Icon`.
  - `heightMode="compact"` TopSheet (line 264) — 4 rows vs 3: must verify compact height fits (design/QA point, not a code blocker).
  - Mount points (all inherit the 4th row automatically, single component): `app/(tabs)/home.tsx:971`, `app/(tabs)/hub/_layout.tsx:322-329`, `app/(tabs)/account.tsx`, `app/(tabs)/marketing/_layout.tsx`, `app/(tabs)/hub/getstarted.tsx`, `hub/events.tsx`, `hub/experiences.tsx` (experiences passes `initialStep="experience"` — unaffected), `app/experience/snap.tsx`.
- **Severity:** N/A (map).

### F-10 — CONFIRMED: Hub Venue-tab gating predicate + card-list conversion surface (Q5, dispatch item c/d)
- **Layer:** code.
- **Evidence:**
  - Gate: `src/hooks/useHubTabs.ts:68-71` — `if (venue.hasPhysicalLocation || venue.hasPlacePool) visible.push("venue")`; inputs built in `app/(tabs)/hub/_layout.tsx:83-93` from `currentBrand.hasPhysicalLocation` / `currentBrand.placePoolId`. For "tab appears when brand has ≥1 venue (any state)" this predicate must become a per-brand venue-listings count query (new hook), and `hasPhysicalLocation` drops out of the predicate.
  - Tab body: `app/(tabs)/hub/listing.tsx` mounts `VenueSuiteShell(brandId)`; the card list replaces/precedes this mount, and tapping a card must mount the suite/listing **scoped to that venue** — today `VenueSuiteShell` and `VenueListingContent` take only `brandId` (`VenueListingContent.tsx:104-107` derives `placePoolId = brand.placePoolId`, `pipeline = useBrandPlacePipelineState(brandId)`). The per-venue edit route ALREADY accepts explicit place scoping: `/venue/deck-readiness?brand_id=…&place_pool_id=…` (`app/venue/deck-readiness.tsx:51-62`, `deckReadinessRoutes.ts:37-52`), and the edge fn accepts `body.place_pool_id ?? brand.place_pool_id` on every action (`run-business-place-authoring-pipeline/index.ts:1158,1339,1456,1522,1591,1618`) — so the server API is largely venue-addressable already; the CLIENT hooks/components are not.
  - Card status source (per card): `src/utils/listingStatus.ts:19-87` `listingStatusView({hasVenue, status, claimStatus})` already produces exactly the dispatch's card states — Draft / Processing / Needs fixes / **In review** (= `deck_eligible` OR `pending_review` → the "PENDING ADMIN APPROVAL" state) / Live / Changes needed / Suspended / Removed. It is pure and reusable per-venue unchanged, provided per-venue `status` + `claimStatus` inputs exist.
- **Severity:** N/A (map).

### F-11 — CONFIRMED: BrandEditView toggle removal blast radius (Q5, dispatch item e)
- **Layer:** code (+ docs contradiction).
- **Evidence — every consumer of `hasPhysicalLocation` (business app, non-test):**
  - `src/components/brand/BrandEditView.tsx:501-539` — the PHYSICAL LOCATION GlassCard: `InlineToggle` writing `draft.hasPhysicalLocation` (516-524) + inline "Add your venue" CTA shown when `hasPhysicalLocation && claimStatus==='none' && placePoolId==null` (526-538) → `handleClaimVenue` (385-394) which seeds `draftVenueStore` and pushes `/venue/create`. Removing the block also orphans `handleClaimVenue`, the `InlineToggle` usage, and the related styles.
  - `src/utils/brandPatch.ts:66-67` — diffs `draft.hasPhysicalLocation` into the update patch; `src/services/brandMapping.ts:449-450` maps it to `has_physical_location` (and `:316` maps the read). With the toggle gone these become dead write-paths (reads stay harmless).
  - `src/utils/businessTodos.ts:174-191` — `hasPhysicalLocation` gates the `add_venue`/`finish_venue` rows (F-13).
  - `src/hooks/useBusinessTodos.ts:146` — feeds the gate.
  - `src/hooks/useHubTabs.ts:22,68-71` + `app/(tabs)/hub/_layout.tsx:83-93` — tab gate (F-10).
  - `src/types/brand.ts:329-335` — type field.
  - Comment-only references: `src/components/brand/BrandProfileView.tsx:409`, `src/components/hub/HubSubNav.tsx:45`.
- **Onboarding/creation writes: NONE.** `BrandCreationFlow.tsx` never sets it; no RPC or edge fn writes `has_physical_location` (grep across `supabase/functions` + all migrations: only the ORCH-1040 `add column` + comment). **Docs↔code contradiction:** the live column comment and `types/brand.ts:332-334` claim it is "auto-set true when a venue is created/claimed" — nothing implements that (the venue-brand created by the wizard keeps the default `false`; its tab appears via `placePoolId` instead). So removing the toggle removes the ONLY writer of this column.
- **What breaks on removal:** with the toggle gone and gating moved to "≥1 venue row", nothing else consumes the flag — but the `add_venue` to-do row's gate must be replaced or the row deleted (F-13), and `deriveHubVisibleTabs` must stop reading it, otherwise brands that toggled it on pre-change (1 brand in prod) lose nothing (tab shows only with a venue). DB column can stay (additive, inert).
- **Severity:** N/A (map) + the docs/code contradiction flagged.

### F-12 — CONFIRMED: deep-links + legacy routes that must survive the card-list conversion (Q5 blast)
- **Layer:** code.
- **Evidence:** `app/brand/[id]/listing.tsx` (whole file) is a kept redirect (sets currentBrand from `:id`, forwards `?focus=feedback`) targeted by: to-do routes (`useBusinessTodos.ts:158-164` → `/brand/{id}/listing[?focus=feedback]`), admin push deep-links `mingla-business://brand/{id}/listing` (`admin-review-venue-claim/index.ts:651,686`), `new_review` notifications, global search registry. All of these are **brand-scoped, venue-agnostic** — under multi-venue they land on the CARD LIST (acceptable) or need a venue param added (spec decision). The `?focus=feedback` auto-open currently rides `VenueListingContent` via the brand's single claim (`listing.tsx` route → `VenueSuiteShell(focus)` — note: since META-ORCH-1148/1186 the focus param is consumed in the Settings module path, `VenueSuiteShell.tsx:130-138` comment).
- **Severity:** N/A (map).

### F-13 — CONFIRMED: `useBusinessTodos` venue rows and their multi-venue re-scoping points (Q6)
- **Layer:** code.
- **Evidence:** `src/utils/businessTodos.ts`:
  - `add_venue`/`finish_venue` (lines 174-191): gated `pipelineFetched && pipelineStatus === null && hasPhysicalLocation`; `finish` vs `add` chosen by `venueDraftInProgress` (a SINGLE global persisted `draftVenueStore` — `useBusinessTodos.ts:55-60`); action routes `/venue/create`.
  - `get_venue_live` (lines 192-203): fires when the ONE pipeline row is `processing|needs_fix|failed`; routes `routeForPipelineStateFix` (per-brand, place from the row).
  - `venue_claim_review` (lines 215-233): gated `venueClaimPending` = `venueClaimBannerVariant(currentBrand.claimStatus…)` ∈ {pending_review, follow_up} (`useBusinessTodos.ts:102-112`); badge from `useVenueClaimOpenCount(brandId, claimFollowUpAt)`; routes `/brand/{id}/listing[?focus=feedback]`.
- **Re-scoping requirements (facts, not design):** (a) `pipelineStatus === null` no longer means "no venue" once N rows exist — the input must become per-venue aggregates (e.g. counts by status) or per-venue rows; (b) `hasPhysicalLocation` gate disappears with the toggle (F-11) — without a replacement the `add_venue` nag would show for EVERY brand or NO brand; (c) `venueDraftInProgress` is global-singleton — two concurrent venue drafts collide (the wizard `reset()`s on submit, `VenueCreatorWizard.tsx:229`); (d) `venue_claim_review` reads the BRAND claim — must read per-venue claim rows and either emit one row per pending venue or an aggregate with a count badge; (e) `useVenueClaimOpenCount`/`venue_claim_feedback` is brand+round keyed (feedback table has a nullable `place_pool_id` column already — favorable).
- **Severity:** N/A (map).

### F-14 — RULED OUT: any existing multi-venue support hiding in the data (Q1)
- **Probe:** live `group by business_author_brand_id having count(*)>1` → 0 rows; `UNIQUE (brand_id)` on pipeline; admin queue lists brands not places (`adminClaimsService.js:43-77`).
- **Verdict:** no brand has, or can have, >1 venue today at any layer. RULED OUT.

---

## One-venue assumption inventory (consolidated table)

| # | Artifact | Exact binding | Layer | Multi-venue impact |
|---|----------|---------------|-------|--------------------|
| 1 | `brands.place_pool_id` | nullable FK → place_pool, ON DELETE SET NULL | schema | the 1:1 pointer; becomes legacy/primary-venue or dropped |
| 2 | `brands.claim_status` (+`claim_follow_up_at`, `rejection_reason`, `claim_decision_emailed_at`, `google_place_id`, `venue_category`) | per-brand claim lifecycle | schema | the approval unit; must move per-venue OR keep venue-as-hidden-brand |
| 3 | `brand_place_pipeline_state` | **UNIQUE (brand_id)**; edge upsert `onConflict:"brand_id"` (`index.ts:673`); client `.eq(brand_id).maybeSingle()` (`businessPlaceAuthoringService.ts:330-334`) | schema+code | THE hard constraint; silent-overwrite hazard |
| 4 | `brand_hours` | brand-keyed; "single owner" of venue hours (1186-A) | schema | one hours set per brand |
| 5 | `venue_reservation_settings` | `brand_id PRIMARY KEY` | schema | one reservations config per brand |
| 6 | `venue_tables` / `venue_availability_config` / blackouts / waitlist / reservations | `brand_id NOT NULL` (+nullable place_pool_id) | schema | suite is per-brand |
| 7 | `menus` / `menu_items` (1186-C) | brand-keyed | schema | one menu per brand |
| 8 | `venue_claim_feedback` | brand_id + round (place_pool_id column exists, unused in RLS/logic) | schema | rounds are per-brand |
| 9 | RLS "Public can read place_pool for verified-claimed venues" | `b.place_pool_id = place_pool.id AND b.claim_status='verified'` | schema/RLS | anon photo/hours gate |
| 10 | RLS `place_pool_business_owner_update` | `b.id = business_author_brand_id OR b.place_pool_id = place_pool.id` | schema/RLS | owner-write gate |
| 11 | `claimed_venues_public_view` / `brands_public_view` (ve4/0972) | brands JOIN place_pool ON `b.place_pool_id` | schema/view | one public venue per brand slug |
| 12 | `pg_brand_experiences_for_place`, `pg_venue_reservable_for_place` | `WHERE b.place_pool_id = p_place_pool_id AND claim_status='verified'` | schema/fn | consumer place→brand resolvers |
| 13 | `biz_review_venue_claim(p_brand_id)`, `admin_get_claim_review_bundle(p_brand_id)`, `admin_add_venue_claim_feedback(p_brand_id)`, `biz_resubmit_venue_claim(p_brand_id)` | brand-keyed review RPCs | schema/fn | approval keying |
| 14 | `admin_suspend_listing` / `admin_soft_delete_listing` / `admin_restore_listing` (`p_place_id`) | resolves THE brand via `place_pool_id = p_place_id … limit 1` | schema/fn | 1:1 reverse lookup |
| 15 | `biz_create_venue_brand_authoring` | INSERTs a NEW brand `pending_review` per venue | schema/fn | the creation model itself |
| 16 | `run-business-place-authoring-pipeline` `loadOwnedBrand` + `body.place_pool_id ?? brand.place_pool_id` fallbacks | edge | edge | actions ALREADY venue-addressable; only the pipeline upsert + tier1 brand-write are 1:1 |
| 17 | `handleTier1` writes `brands.place_pool_id` (`index.ts:545-552, 612-623`) | edge | edge | brand pointer write |
| 18 | `useBrandPlacePipelineState` keys `byBrand(brandId)` / `context(brandId, placePoolId)` | code | biz app | context key already carries placePoolId (favorable) |
| 19 | `listingStatusView` inputs | pure — per-venue-ready | code | reusable unchanged |
| 20 | `useBusinessTodos` / `buildBusinessTodos` venue rows | single pipeline + brand claim + global draft store | code | F-13 |
| 21 | Hub gate `deriveHubVisibleTabs` | `hasPhysicalLocation \|\| hasPlacePool` | code | F-10 |
| 22 | `VenueSuiteShell` + all 7 modules, `VenueListingContent`, `VenueSettingsModule` | `brandId` only | code | need venue scoping (or explicit v1 non-goal) |
| 23 | `BrandEditView` toggle + CTA | writes the only `has_physical_location` | code | F-11 |
| 24 | mingla-admin `ClaimsPage`/`adminClaimsService` | queues = `brands.claim_status` eq-filters; `place_pool:place_pool_id` embedded join | admin | list stays brand-row-shaped |
| 25 | admin push/email decisions | per brand (`claim_decision_emailed_at` once-per-brand; deep-link `/brand/{id}/listing`) | edge | once-per-VENUE semantics needed |
| 26 | `venue-claim-submitted-email` | asserts `brandRow.claim_status === 'pending_review'` | edge | per-venue submit email keying |
| 27 | Duplicate-claim guard in `biz_review_venue_claim` | same `google_place_id` verified elsewhere → `duplicate_of_brand_id` | schema/fn | stays valid per-place |
| 28 | `draftVenueStore` | ONE persisted global draft | code | concurrent-draft collision |
| 29 | Public `/b/{slug}` (`publicEventsService.ts:1339-1392`) | fetches ONE `claimed_venues_public_view` row by slug → `venue:` prop | code/web | F-7 / §Public options |

---

## Admin approval pipeline — AS-IS state machine (must remain unchanged)

**Unit of review: one `brands` row** (which today ≡ one venue). Two independent axes:

**Axis 1 — identity/claim (`brands.claim_status`):**
```
none ──(biz_create_venue_brand_authoring @ wizard submit — brand born)──▶ pending_review
pending_review ──(admin approve · biz_review_venue_claim via admin-review-venue-claim edge fn)──▶ verified
pending_review ──(admin reject  · same RPC, rejection_reason set)──▶ rejected
pending_review ──(admin need_more_info / add_feedback · claim_follow_up_at=now(), feedback round rows)──▶ pending_review+follow_up   ["needs fixes"]
pending_review+follow_up ──(operator biz_resubmit_venue_claim · clears stamp)──▶ pending_review          [back to admin queue]
verified ──(admin_suspend_listing(p_place_id) · also place_pool.is_active=false + feedback round)──▶ suspended
suspended ──(biz_resubmit_venue_claim)──▶ pending_review
verified ──(admin_soft_delete_listing)──▶ revoked   (admin_restore_listing → verified)
```
Actors: operator (create/resubmit via business app), admin (approve/reject/need_more_info/suspend/revoke via mingla-admin → `admin-review-venue-claim` edge fn → RPCs). Side-effects on decision: Resend email (guarded once by `claim_decision_emailed_at`), OneSignal push + inbox row (`business.claim_decision`), deep-link `mingla-business://brand/{id}/listing`.

**Axis 2 — deck readiness (per brand row via `brand_place_pipeline_state.status`, written ONLY by `run-business-place-authoring-pipeline`):**
```
draft → processing (tier1/tier2) → needs_fix ⇄ deck_eligible ; failed (terminal-with-retry)
```
**Axis 3 — deck go-live (per PLACE, admin approve only):** `runApproveGoLive(place_pool_id)` re-bounces the place (I-CLAIM-REBOUNCE-ON-APPROVE), flips `place_pool.is_servable=true`, scores all active signals (I-SCORER-INVOKE-HAS-SIGNAL-ID), rolls back servable on total scoring failure. Reject resets `business_recommend_edit_count`.

**Brand-facing status label** (`listingStatusView`): admin decisions take precedence — rejected/failed → "Changes needed"; suspended → "Suspended"; revoked → "Removed"; verified → "Live on Mingla"; `deck_eligible` OR `pending_review` → "In review" (⇐ this IS the "PENDING ADMIN APPROVAL" card state); needs_fix → "Needs fixes"; processing → "Processing"; else "Draft".

**Keying takeaway for the spec:** the pipeline is keyed per **brand row** on axis 1+2 and per **place row** on axis 3. To keep the pipeline "exactly as-is" while re-scoping per venue, the review unit must remain a row that carries `{claim_status, claim_follow_up_at, rejection_reason, place_pool_id}` — whether that row is a new per-venue row or a hidden child brand.

---

## Minimal-change data-model verdict (with backfill sketch)

**Verdict: N venues per brand is NOT a client-only change — one UNIQUE constraint and four brand claim columns block it — but the minimal schema delta is small and the prod backfill is effectively zero.**

Minimal delta (stated as facts about what must change; HOW is the SPEC's decision):
1. **`brand_place_pipeline_state`:** drop `brand_place_pipeline_state_brand_unique` → `UNIQUE (brand_id, place_pool_id)` (+ `place_pool_id NOT NULL` for new rows, or a partial unique to tolerate the legacy NULL); edge `upsertPipelineState` `onConflict` must become `brand_id,place_pool_id` (`index.ts:673`); client `fetchBrandPlacePipelineState` drops `.maybeSingle()` for a list (or gains a place-scoped variant).
2. **Claim lifecycle per venue:** the four columns (`claim_status`, `claim_follow_up_at`, `rejection_reason`, `claim_decision_emailed_at`) need a per-venue home. Cheapest structurally: put them ON the (now per-venue) pipeline row or a new `venue_listings` row keyed `(brand_id, place_pool_id)`; `brands.claim_status` stays for compat/parent-level semantics. This is where the "pipeline stays EXACTLY as-is" constraint bites: `biz_review_venue_claim`, `admin_get_claim_review_bundle`, `admin_add_venue_claim_feedback`, `biz_resubmit_venue_claim` are all `p_brand_id`-keyed and update `brands` — re-scoping them to the per-venue row is a mechanical re-key (same states, same transitions, same side-effects) but IS a change to the pipeline's storage. The alternative that keeps the RPCs byte-identical is venue-as-hidden-child-brand (Option C below).
3. **Re-keyed predicates (complete list):** RLS "Public can read place_pool for verified-claimed venues"; `place_pool_business_owner_update`; `claimed_venues_public_view`; `pg_brand_experiences_for_place`; `pg_venue_reservable_for_place`; `admin_suspend/soft_delete/restore_listing`'s brand lookup; `venue-claim-submitted-email`'s status assert; the mingla-admin queue eq-filters. (RLS on `brands`, `brand_place_pipeline_state`, `venue_claim_feedback` are ownership-based and survive unchanged.)
4. **Backfill:** for every brand with `place_pool_id IS NOT NULL`, insert/annotate one per-venue row copying the brand's claim columns. **Live prod count of such brands: 0.** Pipeline rows to migrate: 0. Only artifacts: 3 orphaned `business_authored` place rows (F-8) — decide keep/purge; and 1 brand with `has_physical_location=true` (loses only a to-do nag). The wipe memory (`project_prod_db_test_wipe_2026_06_22`) corroborates.
5. **Not required for v1 (flag, don't silently include):** re-keying the venue SUITE tables (hours, reservation settings PK brand_id, tables, menus) — F-5. A v1 that multi-venues only the LISTING (create/status/manage listing) and pins the suite to… (spec decision) avoids ~6 more tables of churn.

---

## Public/consumer representation — options for Seth (NOT decided)

Today: consumer deck = one card per servable `place_pool` row (already N-ready); each card resolves its ONE verified brand for experiences/reservations. Public `/b/{slug}` renders the brand page with ONE `venue` section (hours/photos/category from `claimed_venues_public_view`) + menus for verified venues.

1. **One brand page, multi-location section.** `/b/{slug}` lists all LIVE venues of the brand (location cards: name/address/hours); deck cards stay per-place; `pg_brand_experiences_for_place` shows the brand's experiences on every location's card (or per-venue tagging later). — Cheapest public change; risk: experiences/menus/reservations ambiguity across locations ("which branch takes this booking?"); the reservation resolver returns brand_id today, so bookings would pool per brand unless the suite is also per-venue.
2. **Per-venue public pages.** Each venue listing gets its own slug/page (`/b/{brandSlug}/{venueSlug}` or first-class venue slugs), brand page links to its venues. — Cleanest consumer semantics, mirrors how the deck already treats places; cost: new public read model + routing + SEO/OG work on buyer-web, and the admin approve email's `defaultVenuePublicUrl(slug)` needs the venue slug.
3. **Venue = hidden child brand (minimal-schema path).** Keep today's mechanics: each "venue listing" remains its own brand row born `pending_review`, plus a new `parent_brand_id` grouping column; the business-app UI presents them as venue cards of the parent, admin pipeline/RPCs/RLS/public pages stay byte-identical. — Zero pipeline change (satisfies "EXACTLY as-is" literally); cost: brand-count semantics leak everywhere (team roles, Stripe per brand, brand switcher, slugs, analytics count venues as brands), and the product model stays crooked long-term.

---

## Five-truth-layer reconciliation

| Layer | State | Contradictions found |
|-------|-------|----------------------|
| Docs | ORCH-1040 column comment + `types/brand.ts:332-334` say `has_physical_location` is "auto-set true when a venue is created/claimed" | **Docs ≠ code:** no writer exists anywhere (F-11). Code is the truth. |
| Schema | as inventoried; migration chain verified to LATEST defs (0972 + 1073 + 1186a redefs confirmed live via pg_proc md5 probe) | none vs live DB |
| Code | brand-per-venue everywhere; edge actions already accept explicit `place_pool_id` | matches schema |
| Runtime | live pg_proc/pg_policies/pg_constraint match the migration-chain reading; client runtime not exercised (no repro needed) | none |
| Data | 0 venue-bound brands; 3 orphaned business_authored places contradict "place claimed ⇒ brand exists" | **Data ≠ schema intent:** orphans from the 2026-06-22 wipe (`ON DELETE SET NULL`); harmless but should be reconciled |

## Blast radius / cross-surface map

- **In scope:** Business iOS/Android/Web-preview (creator sheet, hub tab, listing mgmt, to-dos, BrandEditView), backend (pipeline table, claim RPCs, RLS, views, 3 edge fns), Admin Web (queue stays brand-row keyed — verify it still lists per-venue review units), Buyer/anon Web `/b/{slug}` (per chosen public option).
- **Out of scope but touched-by-decision:** Consumer iOS/Android (deck unchanged; `pg_*_for_place` resolver redefs are backend-side), venue SUITE tables (F-5 — explicit v1 scope decision), Stripe (per-brand — under options A/B payments stay on the parent brand; under C each venue-brand has its own Stripe, as today).
- **Shipping path:** business OTA FROZEN (COMMS-0052) — client changes ship via Vercel web + next native build; backend via Management-API migrations (mind COMMS-0051 version-prefix collisions) + edge deploys.

## Invariant impact (flagged, not resolved)

- `I-VENUE-CLAIM-OPTIONAL` — claim stays an opt-in booster, never an authoring gate: the 4th creator option must not gate event/experience/trip authoring.
- `I-CLAIM-REBOUNCE-ON-APPROVE` + `I-SCORER-INVOKE-HAS-SIGNAL-ID` — approve go-live per place must be preserved verbatim per venue.
- `I-PROPOSED-1218-VENUE-AUTHORING-NO-VENDOR-LEAK` — any wizard refactor must keep all `sanitizeAuthoringError` call sites (strict-grep gate counts ≥4 calls in `VenueCreatorWizard.tsx`).
- I-38/I-39 (44pt targets, a11y labels) — new card list + 4th row.
- `I-BRAND-UNIVERSAL-AUTHORING` — creator options render for EVERY brand unconditionally; a venue option that only shows conditionally would deviate (flag for spec: unconditional row is the sibling-consistent choice).
- 16 desktop-web contracts + LOCKED DECISION 5 (venue module pill row swap) — card list must not break the `venueSuiteStore` bridge in `hub/_layout.tsx:103-114,285-306`.

## Risk register

| R# | Risk | Evidence |
|----|------|----------|
| R-1 | Silent pipeline-row overwrite if client goes multi-venue before schema: edge upsert `onConflict:"brand_id"` clobbers venue #1's state with venue #2's | F-2 |
| R-2 | RLS/public-view re-keying is security-load-bearing (anon photo/hours gate; owner place-write gate) — a wrong predicate leaks unverified place data or blanks live venues | F-6 |
| R-3 | "Pipeline EXACTLY as-is" vs claim-columns-on-brands is a real tension: per-venue claim REQUIRES re-keying 4 RPCs + 2 admin edge lookups (mechanical but not zero) — needs an explicit Seth/spec ruling between per-venue rows and hidden child brands | F-1/F-3, §Verdict |
| R-4 | Venue suite (hours/tables/menus/reservation settings, `venue_reservation_settings.brand_id` PK) is per-brand — multi-venue without scoping silently shares one table inventory/menu/hours across locations, corrupting reservations | F-5 |
| R-5 | Wizard rewrite hazards: it creates a brand, switches `currentBrandId`, resets a single global draft store, and fires the submit email keyed to `claim_status='pending_review'` — re-pointing it at the current brand touches auth-warm gating (META-ORCH-1232), slug resolution, AppsFlyer event, and the concurrent-draft collision | F-1, F-13(c) |
| R-6 | Removing the toggle without replacing the `add_venue` gate flips the to-do nag to all-brands or no-brands; the tab gate must move to "≥1 venue row" the same commit | F-11, F-13(b) |
| R-7 | Once-per-brand decision plumbing (`claim_decision_emailed_at`, push idempotency `business.claim_decision:{brandId}:{decision}`, deep-links `/brand/{id}/listing`) under-notifies/mis-links for venue #2+ | inventory #25, F-12 |
| R-8 | Migration logistics: live prod, MGMT-API-only applies, duplicate version prefixes already on main (COMMS-0051), blind `db push` unsafe | memory + COMMS ledger |

## Discoveries for orchestrator (side issues, not in scope)

- D-1: 3 orphaned `business_authored` place_pool rows in live prod (2 `deck_eligible`, all `is_claimed=true`, `claimed_by` a deleted-brand owner, zero brand references) — wipe leftovers; candidate cleanup ORCH (verify `is_servable` first).
- D-2: `has_physical_location` "auto-set on venue create" is documented (DB comment + type JSDoc) but never implemented — today only the manual toggle writes it; harmless but the docs lie.
- D-3: `venue_claim_feedback.place_pool_id` exists but is absent from RLS + all read paths — free real estate for per-venue feedback, also a latent inconsistency today.
- D-4: `biz_create_venue_brand_pending_review` (0972) still exists live alongside `biz_create_venue_brand_authoring` (Sub-E, the one the client actually calls) — dead-RPC candidate.

## Confidence

**Proven** for schema/code/data layers (all claims carry live-DB or file:line evidence; latest-migration rule applied and cross-checked against live pg_proc/pg_policies/pg_constraint). Client runtime not exercised — irrelevant here (no reproducer-bound bug; feature forensics). Overall: **proven** for the map, per the backend-audit exemption of Prime Directive 7.

## Recommended next phase + scope (direction only)

SPEC (mingla-forensics SPEC mode), preceded by ONE Seth decision round: (1) per-venue claim rows vs hidden child brands (R-3), (2) public representation option 1/2/3, (3) v1 scope of the venue suite (listing-only multi-venue vs full suite scoping). Recommended v1 scope: 4th creator option + venue-scoped creation against the CURRENT brand + per-venue pipeline/claim rows + Hub card list + per-venue listing mgmt + toggle removal + to-do re-scoping; suite scoping and public option build-out as explicit follow-on legs.
