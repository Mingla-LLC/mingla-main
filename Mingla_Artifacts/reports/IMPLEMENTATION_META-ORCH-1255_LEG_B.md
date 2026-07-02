# IMPLEMENTATION — META-ORCH-1255 [multi-venue first-class creation] — LEG B

**Phase:** IMPLEMENT (Leg B: mingla-business client)
**Worktree:** `~/Desktop/mingla-orchs/orch-1255-[venue-first-class-multi]` on branch `orch-1255-venue-first-class-multi`
**Spec (binding):** `Mingla_Artifacts/specs/SPEC_META-ORCH-1255_MULTI_VENUE_FIRST_CLASS.md` (b236bfaf9) + `Mingla_Artifacts/specs/DESIGN_META-ORCH-1255_VENUE_SURFACES.md` (f4962ba72)
**Leg A as-built consumed:** `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1255_LEG_A.md` — client calls match the AS-BUILT signatures (engine RPC = ONE function with optional `p_venue_id`/`p_brand_id` per Leg A D2; `biz_upsert_brand_hours(p_venue_id, p_hours)` per D5; pipeline edge fn requires `venue_id` on EVERY action).
**Commits:** `c46534156` (foundation) · `297ab08f2` (creator sheet + TopSheet clamp) · `9a66cef8b` (suite venue-scoping + gate flip) · `0957b18c2` (card list + per-venue page + wizard + hub gate + todos + toggle removal + gates) · `071deaa6c` (regression suite) · `d669c2285` (foreground refresh) · doc touch-up + this report.
**Status label:** implemented, partially verified (all static/unit/gate layers proven; runtime against the new RPCs is impossible pre-apply — §9).
**COMMS:** COMMS-0052 (BLOCK, OTA freeze) honored — no `eas update`, no deploy, no merge performed.

## 1. Summary

The business app now treats venues as first-class rows. The "+" creator sheet gains a 4th unconditional root option "Create venue listing" (with the REQUIRED TopSheet compact viewport clamp so 4 rows fit an iPhone-SE-class screen). The Hub "Venue" tab appears whenever the brand has ≥1 `venue_listings` row and shows a CARD LIST (EventListCard-parity anatomy: cover-or-hue, chip-first status incl. "In review", name, address, one honest data slot). Tapping a card pushes a NEW per-venue management page `/venue/{venueId}` hosting the whole venue suite scoped to that venue (header = back + name + status chip; suite store activation moved here; page renders the module pill row itself because the pushed page sits outside the hub layout). Every suite hook/service is venue-keyed against the Leg A schema (settings/tables/capacity/availability/blackouts/waitlist/reservations/hours reads+writes carry `venue_id`; realtime filters are venue-scoped; the slots RPC passes `p_venue_id`). The wizard now creates a venue LISTING under the CURRENT brand via `biz_create_venue_listing` — no brand insert, no brand switch — and success lands on the new venue's page. The venue draft store is per-brand multi-draft (v2). Venue to-dos are per-venue rows; the brand-edit physical-location toggle and its write paths are deleted.

## 2. SPEC success-criteria coverage (Leg B rows)

| SC | Status | Proof | Commit |
|----|--------|-------|--------|
| SC-6-Web/iOS/Android (4th option, wizard creates under CURRENT brand, no brand switch) | ✓ static+unit | T-B1 (ROOT_OPTIONS runtime shape + route), wizard rewire diff (`createVenueListing` + `upsertTier1Place({brandId, venueId})`, `setCurrentBrandId` call DELETED); parity automatic (one RN codebase). Live-fire pending apply (§9) | 297ab08f2 / 0957b18c2 |
| SC-7-Web/iOS/Android (venue tab iff ≥1 venue; card list; correct chip; push `/venue/{id}`; back retains scroll) | ✓ static+unit | T-B2 (gate), T-B3 ("In review" mapping), `VenueCardList`/`VenueListCard`/`app/venue/[venueId]/index.tsx`; native stack push preserves list scroll | 0957b18c2 |
| SC-7b-iOS (SE fit: clamp + unchanged chooser steps) | ✓ static (geometry) | root rows padV 16→12 (−32pt → panel ≈532pt < 647 usable SE) + compact clamp `min(measured+24, screenH − panelTop − spacing.xl)` with scroll ONLY when clamped, both TopSheet variants; event/experience `expRow` styles untouched. Needs sim eyeball (tester) | 297ab08f2 |
| SC-8 (no toggle; patch emits no `has_physical_location`) | ✓ unit+gate | BrandEditView block/handler/styles deleted; `brandPatch.ts` + `brandMapping.ts` write arms deleted; new gate `orch-1255-brandedit-no-physical-location-toggle.mjs` green; pinned `brandPatch` suite green | 0957b18c2 |
| SC-9 (per-venue todo rows; 0-venue brand → none) | ✓ unit | SC-9 tests in `metaOrch1255LegB.happy.test.ts` (per-venue `get_venue_live:{id}` naming A, `venue_claim_review:{id}` for B, empty-brand → no venue rows, no `add_venue`) | 071deaa6c |
| SC-10 (two brands hold independent drafts) | ✓ unit | SC-10 store test (b1 draft survives switch to b2 and back; `reset(brandId)` scoped) | 071deaa6c |

## 3. Files changed (52 files, +3,405 / −558 vs the DESIGN commit)

NEW: `src/services/venueListingsService.ts` (201) · `src/hooks/useVenueListings.ts` (96) · `src/components/venue/ListingStatusChip.tsx` (75) · `src/components/venue/VenueListCard.tsx` (239) · `src/components/venue/VenueCardList.tsx` (394) · `app/venue/[venueId]/index.tsx` (297) · `__tests__/metaOrch1255LegB.happy.test.ts` (260) · `.github/scripts/strict-grep/orch-1255-brandedit-no-physical-location-toggle.mjs`.

MODIFIED (see §7 receipts): `UniversalCreatorSheet.tsx`, `TopSheet.tsx`, `useBrandPlacePipelineState.ts`, `businessPlaceAuthoringService.ts`, `deckReadinessRoutes.ts`, `draftVenueStore.ts`, `VenueCreatorWizard.tsx`, `app/venue/create.tsx`, `app/venue/deck-readiness.tsx`, `useHubTabs.ts`, `app/(tabs)/hub/_layout.tsx`, `app/(tabs)/hub/listing.tsx`, `app/brand/[id]/listing.tsx`, `VenueSuiteShell.tsx`, `VenueListingContent.tsx`, `VenueSettingsModule/Tables/Availability/Reservations/Waitlist` modules, `VenueCapacityRulesPanel.tsx`, `ReservationCreateSheet.tsx`, `WaitlistConvertSheet.tsx`, `useVenueReservationSettings/Tables/Availability/CapacityRules/Reservations/Waitlist/BrandHours/ClaimFeedback/ClaimRefresh` hooks, `venueClaimService.ts`, `VenueClaimStatusBanner.tsx`, `VenueClaimFeedbackSheet.tsx`, `brandsService.ts` (hours fns), `businessTodos.ts`, `useBusinessTodos.ts`, `BrandEditView.tsx` (deletions), `brandPatch.ts`/`brandMapping.ts` (deletions), `types/venueReservation.ts`, `orch-1255-venue-approval-per-venue-row.mjs` (LEG_B_ACTIVE flip), `strict-grep-mingla-business.yml` (1 job APPENDED).

## 4. Data-model changes applied

None (Leg A owns `supabase/migrations` — untouched, verified `git diff` clean on `supabase/`).

## 5. Edge functions touched

None (Leg A owns them). Client payloads now match Leg A's contracts: every pipeline action carries `venue_id`; `venue-claim-submitted-email` invoked with `{ venue_id }`; `biz_create_venue_listing`, `biz_resubmit_venue_claim(p_venue_id)`, `biz_reservation_create(p_venue_id,…)`, `pg_venue_available_slots({p_date,p_party_size,p_venue_id})`, `biz_upsert_brand_hours(p_venue_id,…)`.

## 6. Regression tests added (+ fails-on-revert proof)

Path: `mingla-business/__tests__/metaOrch1255LegB.happy.test.ts` — 10 tests: T-B1 ×2 (4 root rows, venue LAST, `/venue/create`, siblings untouched) · T-B2 ×2 (venueCount gate) · T-B3 ×2 (In review / Live mapping) · SC-9 ×3 (per-venue rows, empty brand, finish_venue) · SC-10 ×1 (per-brand drafts). Passing run: `Tests: 10 passed, 10 total`.

**fails-on-revert verified at 071deaa6c** — TRUE LINE DELETION (not comment-out): deleted the venue entry from `ROOT_OPTIONS` AND the `venueCount` arm from `deriveHubVisibleTabs` → run shows `✕ exactly 4 root rows…`, `✕ the 3 sibling rows…`, `✕ venueCount 1 → venue tab present` (`Tests: 3 failed, 7 passed`); restored → `10 passed`. Structural reverts are additionally CI-gated: re-adding the BrandEditView toggle fails the new gate; re-pointing the wizard at the hidden-brand RPC fails `orch-1255-no-hidden-brand-on-venue-create.mjs`; a `p_brand_id` review call in `venueClaimService.ts` fails the now-ACTIVE Leg-B rule of `orch-1255-venue-approval-per-venue-row.mjs`.

Append-only: no existing test file modified or deleted. All previously-green pinned suites re-run GREEN unmodified (166/166 across 22 suites incl. `businessTodos` ×2, `useHubTabs` ×3, `venueTab.contract`, `listing.orch_1040` — this one was RED on origin/main (line 73 `chromeMode="tab"` pin, pre-existing) and is now GREEN, `orch1186HoursUnification`, `VenueCreatorWizard.ve2`, `useVenueTables.softDelete`, `venueClaimService`, `brandPatch`, `deckReadinessRoutes`, `reservationViews`, `venueSuiteLeakAndExit` 10/10). The 5 suites failing on this branch (`orch_1092`, `KeyboardRoot`, `venueSuiteShell.orch1184.render`, 2× `orch1143.render`) fail IDENTICALLY on origin/main (missing RTL/dedicated configs/deleted TripBrandWizard) — pre-existing, not regressions (verified by detached origin/main run: same 5 failures).

## 7. Old → New receipts

### UniversalCreatorSheet.tsx (+ TopSheet.tsx)
**Before:** 3 root rows; compact TopSheet had NO viewport clamp and no scroll (4 rows would overflow SE/short-Android/phone-web). **Now:** 4th unconditional "Create venue listing" row (icon `location`, designer copy, close+push `/venue/create`); root rows padV 16→12 (`spacing.sm + spacing.xs`, icon wrap stays 44×44 — I-38); both TopSheet variants clamp compact height to `min(measured+24, screenH − panelTop − spacing.xl)` and scroll the content ONLY when clamped, measuring natural height on an inner wrapper inside the ScrollView (no clamp/measure feedback loop). `fixed-70` + Brand Switcher byte-identical. **Why:** SPEC #1, DESIGN §2.1/§2.2. **Lines:** ~120.

### venueListingsService.ts / useVenueListings.ts (NEW)
**Before:** venue "rows" were hidden brands. **Now:** owner-RLS reads of `venue_listings` (list by brand, detail by id) + `createVenueListing` → RPC `biz_create_venue_listing` (23505→SlugCollisionError / duplicate-place copy; AppsFlyer `mingla_venue_listing_submitted`; fire-and-forget `{venue_id}` claim email) + `venueListingKeys` factory + create mutation invalidating listings+pipeline. **Why:** SPEC #2/#3. **Lines:** ~300.

### useBrandPlacePipelineState.ts / businessPlaceAuthoringService.ts
**Before:** one pipeline row per brand (`.maybeSingle()` on brand — breaks at N rows); edge payloads brand-only. **Now:** `useVenuePipelineState(venueId)` + `useBrandPipelineStates(brandId)`; every pipeline action payload carries `venue_id`; context is (brand, place, venue)-keyed; `BrandPlacePipelineState` gains `venue_id`. The legacy brand-keyed single read is KEPT as a multi-row-safe latest-row alias `[TRANSITIONAL]` (pinned source-contract tests; no live caller). **Why:** SPEC #4/#5; F-2 client kill. **Lines:** ~120.

### VenueCreatorWizard.tsx (+ create.tsx, deck-readiness.tsx)
**Before:** submit created a HIDDEN BRAND (`useCreateVenueBrand`) then switched the active brand to it; deck-readiness keyed off the brand. **Now:** submit creates a venue listing under the CURRENT brand, runs tier-1 venue-keyed, NEVER switches brands; success carries `{venueId, placePoolId}` into `VenueDeckReadinessSetup` (prop re-shape: `brandId/venueId/placePoolId/venueName/venueCategory/operator*` replace `brand: Brand`); "Done" lands on `/venue/{venueId}`; the resume route requires `venue_id` and reads the place pointer from the VENUE row. All 5 `sanitizeAuthoringError` call sites preserved (1218 gate green). Per-brand draft: `activateBrand(currentBrand.id)` after hydration; `reset(brandId)` clears only this brand. **Why:** SPEC #6, F-1 kill. **Lines:** ~230.

### draftVenueStore.ts
**Before:** ONE global persisted draft (brand-switch collision, R-5). **Now:** v2 (`mingla-business-draft-venue-v2`, v1 blob abandoned): active top-level fields + `drafts: Record<brandId, DraftVenueState>` + `activateBrand` stash/load + scoped `reset(brandId?)` (no-arg = full wipe, Constitution #6 logout path unchanged); step components' selectors untouched. **Why:** SPEC #7. **Lines:** ~130.

### useHubTabs.ts / hub/_layout.tsx / hub/listing.tsx
**Before:** venue tab gated on `hasPhysicalLocation || hasPlacePool`; tab mounted the suite + activated `venueSuiteStore`. **Now:** gate = `venueCount > 0` (layout feeds `useVenueListings(currentBrand.id).data.length`; shared cache with the card list); tab renders `VenueCardList` and does NOT touch the suite store (Hub pills stay over the list); "+" a11y label mentions venue. Legacy flag arms remain executable-but-dormant `[TRANSITIONAL]` (deviation D-B1). **Why:** SPEC #8/#9/#10, D-5. **Lines:** ~90.

### VenueCardList.tsx / VenueListCard.tsx / ListingStatusChip.tsx (NEW)
**Before:** n/a. **Now:** DESIGN §3/§4 built exactly: skeleton (3/4 cards, kit `Skeleton`, real-card dimensions), error retry card, empty GlassCard w/ "List your venue", populated list (phone single column) / 4-col `DESKTOP_HUB_GRID_COLUMNS` grid ≥1024 (events pattern verbatim), header "Your venues · N" + 34pt "+ Add venue" pill w/ hitSlop→44 (I-38), trailing quiet add row; card = EventListCard-parity host (Android opaque frosted), 76×92 `EventCoverMedia` cover w/ name-hash hue fallback, chip-first `ListingStatusChip` (extraction of the proven VenueListingContent badge, zero restyle), name 15/600, address-else-city-else-hidden, ONE data slot ("{n} to fix" > "{n} menu items" > "Reservations on" > hidden — no fabricated stats), whole-card Pressable labeled "Open {name}, status: {label}", web hover elevate + focus accent border. Data: listings + per-venue pipeline rows + one brand-level feedback read grouped per venue + one brand-level settings list read + brand menus count. **Lines:** ~710.

### app/venue/[venueId]/index.tsx (NEW)
**Before:** the suite was the brand-scoped Hub tab. **Now:** pushed per-venue page: DESIGN §5.2 header (back "Back to your venues", name h3 truncating, chip never truncating, no switcher/kebab), `venueSuiteStore` activate/deactivate on mount/unmount, page-owned `VenueModulePillRow` on native/web-phone (documented fallback — the layout bridge can't reach a pushed page), `VenueSuiteShell(brandId, venueId, focus)` with brandId derived FROM THE VENUE ROW (one owner per truth), loading/not-found states, venue-keyed claim banner + auto-opening feedback sheet on `?focus=feedback` + Toast host. **Lines:** ~300.

### Venue suite scoping (shell + 7 modules + sheets + 8 hooks + types)
**Before:** every ops read/write was brand-keyed; writes would now violate M3's `venue_id NOT NULL` and dead-key the venue-PK upserts. **Now:** `venueId` threads shell→modules→sheets; hooks take `(brandId, venueId)`; reads filter `.eq("venue_id", …)`; writes include `venue_id` + upsert `onConflict:"venue_id"` where the key moved (settings, availability config) and fail fast `venue_required` otherwise; query keys append venueId with brandId FIRST so the two pinned brand-prefix invalidations (`brandHoursKeys.byBrand(brandId)`, `venueAvailabilityKeys.config(brandId)` in useBrandHours — ORCH-1186 T8) remain literal AND correct via react-query prefix matching; realtime channels filter `venue_id=eq.{id}`; slots calls pass `p_venue_id` (legacy `p_brand_id` arm only when no venue in scope — [TRANSITIONAL-1] shim); hours read/upsert venue-scoped (`biz_upsert_brand_hours(p_venue_id)`); `VenueMenuModule` stays brand-keyed ([TRANSITIONAL-3]); `VenueIntelligenceModule` stays brand-keyed (orders/revenue are brand-level — see Discovery #3). Module `venueId` props are OPTIONAL (default null) so pinned render tests compile/behave unchanged. **Lines:** ~600.

### Claim loop re-key (venueClaimService + feedback hook + banner + sheet + VenueListingContent)
**Before:** claim status read from `brands.claim_status`; feedback filtered by brand; resubmit `p_brand_id`. **Now:** status from the `venue_listings` row; feedback filtered `venue_id` (+ a brand-level fetch grouped per venue for badges); `biz_resubmit_venue_claim({p_venue_id})`; banner accepts a venue `claimRow` override; sheet takes `venueId/venueName/venueFollowUpAt`; `VenueListingContent` takes required `venueId` and reads claim/pipeline/context venue-keyed (all ORCH-1040 source pins preserved, incl. the previously-RED `chromeMode="tab"` shell pin now restored via the shell's lineage doc). LEG_B_ACTIVE flipped in the per-venue-row gate in the same commit. **Lines:** ~200.

### businessTodos.ts / useBusinessTodos.ts
**Before:** singular venue band (`add_venue`/`finish_venue`/`get_venue_live`/`venue_claim_review`) keyed to the brand's one venue. **Now:** per-venue arrays `venuePipelines`/`venueClaims` (rows `get_venue_live:{venueId}` / `venue_claim_review:{venueId}`, names surface at >1 venue, routes `/brand/{id}/listing?venue={venueId}[&focus=feedback]`); `finish_venue` gated on the CURRENT brand's draft; `add_venue` NEVER renders on the live path; the hook feeds venue rows + per-venue open-feedback counts from one brand read. Legacy singular arms kept dormant `[TRANSITIONAL]` for the pinned fixtures (deviation D-B2). NO touch of any non-venue row and NO new non-venue inputs (D-6 / ORCH-1256 boundary; `BrandEditView` edits are pure deletions). **Lines:** ~250.

### BrandEditView.tsx / brandPatch.ts / brandMapping.ts
**Before:** PHYSICAL LOCATION section (toggle + inline "Add your venue" CTA), `handleClaimVenue`, draft-store seeding, `hasPhysicalLocation` diff+write mapping. **Now:** all deleted (pure deletion; `toggleRow/…` styles KEPT — shared by the attendee-count toggle, contra DESIGN §7's list; `claim*` styles + unused `useRouter` removed; spacing self-heals via the scroll `gap`). Read mapping `brandMapping.ts:316` kept per F-11. New CI gate blocks re-introduction. **Lines:** −97.

## 8. Cross-surface impact

| Surface | Effect | Parity |
|---|---|---|
| Business iOS / Android | All Leg B behavior; ships on the NEXT NATIVE BUILD (COMMS-0052 — no OTA) | automatic (one RN codebase) |
| Business Web preview (Vercel) | Same code, ships FIRST via `[deploy]` at CLOSE | automatic |
| Buyer/anon Web | NOT touched (Leg C owns `/b/{brand}/v/{venue}`, publicEventsService, vercel.json) | n/a |
| Consumer iOS/Android (`app-mobile/`) | NOT touched (Leg C owns the reserve-flow re-key) | n/a |
| Admin Web (`mingla-admin`) | NOT touched (Leg C re-points the claims queue) | n/a |

Sequencing note: NOTHING here is user-visible until CLOSE applies M1–M5 + deploys the Leg A edge fns; until then prod behavior is unchanged (the new code paths read empty tables only after apply).

## 9. Verification — proven vs pending (honest split)

**Proven:**
- `npx tsc --noEmit`: **879 lines on this branch == 879 on origin/main, diff of normalized errors = 0 new** (baseline measured by detaching THIS worktree to origin/main — same env, same node_modules).
- Jest: new suite 10/10; broad affected sweep 22 suites / 166 tests green UNMODIFIED; the only failing suites fail identically on origin/main (RTL/dedicated-config/pre-deleted-file issues — counts matched exactly on a detached origin/main run).
- fails-on-revert at `071deaa6c` (§6, true line deletion).
- Strict-grep: all 5 orch-1255 gates (self-test + run) + orch-1218 vendor-leak + orch-1186 hours-single-owner + orch-1186c ×2 + orch-1205 CORS + orch-0885-a — ALL PASS. Workflow YAML parses; 1 job APPENDED, none modified.
- `npx expo export -p web --clear` → exit 0.
- Pre-existing RED `listing.orch_1040.test.ts` (line 73) flipped GREEN.

**Pending (cannot be done from this session — tester phase after CLOSE applies the migrations + deploys the fns):**
- Live-fire of `biz_create_venue_listing` / venue-keyed pipeline actions / venue-keyed ops writes (RPCs not on prod yet). All client behavior against them is static/mocked-verified.
- Sim/device QA: SE-class 4-row sheet fit (SC-7b), card-list scroll retention on back, per-venue page pill-row swap on native, Maestro flow (sheet → wizard → card list) per SPEC §9.
- Biz-web authed runtime is capped per standing memory — anon surfaces are Leg C's.

## 10. Deviations from the SPEC (each forced, none silent)

- **D-B1 — `HubVenueVisibility` is a superset, not the spec's replacement type.** The spec ("`{ venueCount: number }`; hasPhysicalLocation/hasPlacePool drop out", compile-fail on revert) is UNSATISFIABLE alongside the append-only tester gate `useHubTabs.venueGate.adversarial.test.ts`, which EXECUTES the legacy flags (A1–A3 assert their behavior). Shape shipped: `venueCount?` + optional legacy flags, gate = `venueCount>0 || legacy flags`; the layout passes ONLY `{venueCount}`; the flags have no production writer → behavior equals the spec's intent. `[TRANSITIONAL]`, exit = TEST-MOD-APPROVED supersession of the 1145 gate.
- **D-B2 — `businessTodos` keeps the legacy singular arms dormant.** Same forcing: `businessTodos.test.ts` pins `add_venue`/`hasPhysicalLocation`/singular `get_venue_live` at runtime. Shipped: per-venue arrays take absolute precedence WHEN PRESENT (the live hook always passes them, so `add_venue` is unreachable in the app); legacy arms fire only for fixture-shaped inputs. `hasPhysicalLocation` input is optional (not deleted).
- **D-B3 — legacy pipeline reads kept as [TRANSITIONAL] aliases.** `useBrandPlacePipelineState(brandId)` / `fetchBrandPlacePipelineState` could not be deleted (ORCH-1040 source pins on VenueListingContent + the tier1 error test's call shape); re-implemented multi-row-safe (latest row), zero live callers. `upsertTier1Place.venueId` is type-optional for the same pinned test; the edge fn still 400s without it (structured, surfaced).
- **D-B4 — per-venue todo ids are `get_venue_live:{venueId}`** (the singular id string is pinned); labels/rows match SC-9 semantics exactly.
- **D-B5 — the per-venue page renders the module pill row itself.** DESIGN §5.4's "shell inline fallback" doesn't exist in the shipped shell (it renders no row); the pushed page is outside the hub layout, so without this the modules would be unreachable (dead page). The page drives the SAME store the shell syncs — one owner at a time.
- **D-B6 — venue-claim feedback surface on the per-venue page.** `?focus=feedback` was a DEAD deep link on main (VenueListingContent is mounted nowhere; the suite ignores `focus` — pre-existing, see Discovery #1). The page now mounts the venue-keyed banner + auto-opening sheet so the to-do/push deep link lands on a working loop.
- **D-B7 — BrandEditView `toggleRow/toggleTextCol/toggleLabel/toggleSub` styles KEPT** (DESIGN §7 listed them for deletion but they're shared by the attendee-count toggle at :783). Only the truly-orphaned `claim*` styles were deleted.
- **D-B8 — "View public page" still links `/b/{brand.slug}`** (pinned string + the venue route `/b/{slug}/v/{slug}` doesn't exist until Leg C — linking it now would be a dead tap). Leg C may upgrade.
- **D-B9 — `VenueIntelligenceModule` stays brand-keyed** (its RPC `venue_intelligence_overview(p_brand_id)` is order/revenue intelligence; not in the spec's hook re-key list). See Discovery #3 for its stale place-pointer read.

## 11. Operator action required (orchestrator)

Nothing to apply for Leg B itself. At CLOSE (after Leg C): apply M1–M5 + deploy the 5 Leg A edge fns per the Leg A report §11, Vercel `[deploy]`, NO `eas update` (COMMS-0052 — native rides the next business build). CI: the appended workflow job `orch-1255-brandedit-no-physical-location-toggle` will appear as a new required-check candidate.

## 12. Known issues / deferred ([TRANSITIONAL] ledger, Leg B additions)

- D-B1/D-B2/D-B3 dormant legacy arms (exit: test supersession ORCH).
- `[TRANSITIONAL-1]` client arm: `useAvailableSlots` falls back to `p_brand_id` only when no venueId is in scope (operator surfaces always pass venueId).
- `[TRANSITIONAL-3]` menus brand-level: `VenueMenuModule` + the card data slot's menu count are brand-shared across venues.
- `venueId?` optional on `types/venueReservation.ts` row types (append-only fixtures predate the column; DB is NOT NULL).
- CoverPickerSheet in deck-readiness still uses the `brand` target (see Discovery #2).

## 13. Discoveries for Orchestrator

1. **Pre-existing dead surfaces on main (P2):** `VenueListingContent` is mounted NOWHERE (the 1148 suite relocation orphaned it), so the `?focus=feedback` deep link and the whole business-side claim-feedback/resubmit UI were unreachable before this leg; also `VenueSuiteShell`'s `focus` prop is accepted but never consumed. Leg B restores reachability via the per-venue page (D-B6), but `VenueListingContent` itself remains unmounted — decide: mount it (e.g. as a suite "Listing" module) or delete it (its pins live in ORCH-1040 tests).
2. **Venue hero picker can overwrite the parent brand's cover (P1, pre-Leg-C polish):** the unified CoverPicker has no "venue" target; the deck-readiness hero flow uses `kind:"brand"`, whose `useBrandCoverUpload` ALSO patches `brands.cover_media_url`. Pre-1255 that was correct (venue==hidden brand); now every venue hero pick clobbers the brand profile cover, and two venues fight over it. The venue row's own cover is correctly written by `syncHeroMedia` (the truth). Needs a small follow-on: a `venue` picker target (upload+validate, no brand-row patch). CoverPicker was outside the Leg B allowlist — not touched.
3. **`venue_intelligence_overview` reads `brands.place_pool_id` for signal scores/timezone** (`20261117000000` lines 47/86/266) — legacy-inert for new venues → new venues' intelligence loses place-based signal scores/tz. Same class as Leg A Discovery #2 (`admin_tweak_venue_claim_fields`). Suggest one follow-on ORCH re-keying all three.
4. **Creator-sheet a11y copy on other mounts:** `home.tsx` / marketing / account mounts (DO-NOT-TOUCH here) still label the "+" button "Create event, experience, or trip"; hub's was in-allowlist and updated. Cosmetic follow-on.
5. **Default-config jest is not blanket-runnable** (pre-existing): several RTL/render suites fail under `npx jest` without their dedicated configs (`orch1143`, `orch1184`, `orch1190/1092/KeyboardRoot` — the latter due to a deleted `TripBrandWizard.tsx`). Identical on origin/main; worth a one-time cleanup ORCH so CI/test sweeps aren't noisy.
6. **`fetchVenueClaimStatus` now venue-keyed with zero live callers** (it was already orphaned with the banner path reading brand fields) — candidate for deletion in the same cleanup as Discovery #1.
