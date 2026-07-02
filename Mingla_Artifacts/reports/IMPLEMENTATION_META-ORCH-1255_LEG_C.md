# IMPLEMENTATION — META-ORCH-1255 [multi-venue first-class creation] — LEG C

**Phase:** IMPLEMENT (Leg C: public surfaces + admin re-point + consumer reserve flow + the five ratified discovery fixes D-A..D-E)
**Worktree:** `~/Desktop/mingla-orchs/orch-1255-[venue-first-class-multi]` on branch `orch-1255-venue-first-class-multi` (rebased on merged main incl. ORCH-1256)
**Spec (binding):** `Mingla_Artifacts/specs/SPEC_META-ORCH-1255_MULTI_VENUE_FIRST_CLASS.md` §Leg C + `DESIGN_META-ORCH-1255_VENUE_SURFACES.md` §6 (+§3/§4 chip/card context)
**Legs A/B as-built consumed:** `IMPLEMENTATION_META-ORCH-1255_LEG_A.md` (§10 deviations D1–D10, §13 discoveries) · `IMPLEMENTATION_META-ORCH-1255_LEG_B.md` (§10 D-B1–D-B9, §13)
**Status label:** implemented, partially verified (DB layer LIVE-FIRED on a rebuilt local full-chain Postgres; client/admin layers static+unit+build-verified; anon web runtime pending Vercel deploy — §9 honesty split)
**COMMS:** COMMS-0052 honored (no `eas update`, no deploy, no merge). COMMS-0051 honored (prefix re-scan §4). COMMS-0056 honored (no CORS header changes; gate green).

## 1. Summary

Venues are now publicly first-class. Anyone logged-out can open `/b/{brandSlug}/v/{venueSlug}` and see a verified venue's themed page — cover, "Verified venue" identity with a "By {brand}" backlink, proxy-served static map + open-in-maps card, accent-barred hours, the brand's currency-aware menu, a photo strip, and (only when the venue actually takes reservations) a "Reserve a table" bar. The public brand page gains a "Locations" section listing every verified venue. Search/social bots on the new URL get the brand OG card. The mingla-admin claims queue now lists VENUE rows ("{venue} — {brand}") and every review action (approve/reject/needs-fixes/mark-called/tweak/score/feedback) is venue-keyed end-to-end. The consumer reserve flow passes the resolver's new `venue_id` through slots + reservation-create so a multi-venue brand books the exact venue (deck untouched). Five ratified discovery fixes shipped in a new migration M6: the two admin RPCs that still read the dead brand place-pointer (D-A), the pricing resolver's N-rows hazard (D-B), the venue cover-picker target so a venue hero never clobbers the parent brand's cover (D-C), the intelligence RPC's venue re-key (D-D), and D-E verified against prod read-only (M5 already covers both live-servable orphans). One additional discovered break (D-F): `public_menus_view` was gated on the never-again-verified `brands.claim_status` — re-gated on verified venue rows, or every public menu would have gone permanently empty at apply.

## 2. SPEC success-criteria coverage (Leg C rows)

| SC | Status | Proof | Commit |
|----|--------|-------|--------|
| SC-11-Web (anon venue page renders verified venue; pending URL → not-found, no leak) | ✓ static+unit (runtime pending deploy) | T-C1 service half live (jest: view-only read, mapping, null→not-found), route-half source contract, page built to DESIGN §6; anon browser run is tester phase post-deploy | 350d1a679 / 7d8e6346a |
| SC-12-Web (brand page Locations section; 0 venues → absent) | ✓ static+unit | `LocationsSection` (shared page) renders IFF venues.length>0; SC-12 jest arm (mapping + empty→[]); route sibling fetch | 5ee4ba623 |
| SC-13 (admin queue lists venue rows; approve E2E venue-keyed) | ✓ static (E2E = tester live-fire post-apply) | admin service/page venue-keyed jest arm; edge fn + RPCs venue-keyed (Leg A) + M6 D-A; M6 brands admin-read policy for the embedded brand name | eb9ac4e45 / 2b2ed0726 |
| SC-14 (consumer reserve venue-keyed; per-venue settings split) | ✓ static (runtime = tester T-C5 post-apply) | resolver `venue_id` consumed; slots `p_venue_id`; create body `venueId`; gate extended to require venue_id (no dead tap) | 7670f5612 |
| D-A (admin tweak/score-override venue-keyed) | ✓ LIVE | M6 §1/§2 + edge wrapper `p_venue_id`; M6-2/M6-2b/M6-3 PASS on the full-chain local DB | 2b2ed0726 / 1e8aa46fb |
| D-B (deterministic venue-scoped pricing resolution) | ✓ LIVE | M6 §3 + `venue-reservation-create` passes `p_venue_id`; M6-1 PASS (1 row at N settings; per-venue overrides resolve); fails-on-revert live-reproduced ("got 2") | 2b2ed0726 / 1e8aa46fb |
| D-C (venue hero writes the venue listing, never the brand cover) | ✓ static+unit | `CoverTarget` venue variant; device/provider/video paths brand-patch-free; `sync_hero_media` now writes `venue_listings.cover_media_*` (service-role, post-ownership-assert); wizard target swapped; D-C jest seam | 3ea0696fa / 1e8aa46fb |
| D-D (intelligence venue place/tz) | ✓ LIVE (SQL) + static (client) | M6 §4; M6-4 PASS (venue place signals with NULL brand pointer); shell/module/hook/service thread venueId | 2b2ed0726 / fd079fb57 |
| D-E (M5 covers the 2 servable orphans) | ✓ VERIFIED read-only on PROD | probe 2026-07-02: predicate matches exactly 3 rows — Lantern & Vine (servable), Lumen Wine Bar (servable), The Tuscanny Place; no M5-successor needed; prod untouched | n/a (verification only) |
| D-F (public_menus_view venue-claim gate — discovered) | ✓ LIVE | M6 §5; M6-5 PASS (anon menu rows appear IFF a venue is verified; brands.claim_status stays 'none') | 2b2ed0726 |
| Bot rewrite (spec L-C #5) | ✓ unit | vercel.json rule `/b/:brandSlug/v/:venueSlug` → `/api/public-brand` (same UA matcher); JSON parse OK; jest arm | 2e3247d06 |

## 3. Files changed (12 commits, `2b2ed0726..f4109dd8b`)

NEW: `supabase/migrations/20261130000005_orch_1255_leg_c_discovery_rekeys.sql` (M6, ~660) · `supabase/migrations/__tests__/orch_1255_leg_c_rekeys.test.sql` (~330) · `mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx` (147) · `mingla-business/src/components/venue/PublicVenuePage.tsx` (~700) · `mingla-business/src/components/venue/PublicVenueNotFound.tsx` (142) · `mingla-business/__tests__/metaOrch1255LegC.happy.test.ts` (~300).

MODIFIED (see §7): `supabase/functions/{venue-reservation-create,admin-review-venue-claim,run-business-place-authoring-pipeline}/index.ts` · `mingla-business/src/services/publicEventsService.ts` (+~270) · `src/hooks/usePublicEvents.ts` · `src/constants/publicUrls.ts` · `src/components/brand/PublicBrandPage.tsx` · `app/b/[brandSlug]/index.tsx` · `vercel.json` · `src/components/ui/{coverTarget.ts,CoverPicker.tsx}` · `src/hooks/useEventCoverVideoUpload.ts` · `src/components/venue/{VenueCreatorWizard.tsx,VenueSuiteShell.tsx,VenueIntelligenceModule.tsx}` · `src/hooks/useVenueIntelligence.ts` · `src/services/venueIntelligenceService.ts` · `packages/brand-rendering/{PublicBrandPage.tsx,types.ts,index.ts}` · `mingla-admin/src/{services/adminClaimsService.js,pages/ClaimsPage.jsx,components/claims/ClaimRow.jsx}` · `app-mobile/src/{hooks/useVenueReservable.ts,hooks/useVenueAvailability.ts,services/venueReservationService.ts,components/expandedCard/VenueReserveSheet.tsx,components/ExpandedCardModal.tsx}`.

## 4. Data-model changes (M6 — `20261130000005_orch_1255_leg_c_discovery_rekeys.sql`)

Prefix re-scan per COMMS-0051 at IMPLEMENT (2026-07-02): origin/main max = 20261129000000; branch max = 20261130000004 (M1–M5); all `~/Desktop/mingla-orchs/*` worktrees ≤ 20261129000000 → **20261130000005** free everywhere. Function/view DDL only; zero table-data mutation; old signatures whose key param renamed are DROPped in the same file (PostgREST ambiguity).

1. **D-A** `admin_tweak_venue_claim_fields(p_venue_id, p_patch)` — venue row + its place; `venue_not_pending_review` guard on the VENUE machine; brands row never written. Old `(uuid,jsonb)` dropped.
2. **D-A** `admin_apply_score_override(p_venue_id, …)` — place via `venue_listings.place_pool_id`; else byte-identical (audit veto + place_scores UPSERT).
3. **D-B** `resolve_brand_pricing_inputs(p_brand_id, p_venue_id DEFAULT NULL)` — LATERAL settings: explicit venue → that row (≤1 by PK); NULL → the row iff the brand has exactly ONE settings row, else brand defaults. Never an arbitrary rows[0]. Old 1-arg dropped; service-role-only grants re-asserted.
4. **D-D** `venue_intelligence_overview(p_brand_id, p_venue_id DEFAULT NULL)` — explicit venue (brand-match asserted, 42501) → its place + availability-config tz; NULL → the brand's single venue when exactly one, else legacy brand pointer (pre-1255 compat). Orders stay brand-level (events aren't venue-keyed — out of D-D scope). Buckets/currency byte-identical.
5. **D-F** `public_menus_view` gate: `b.claim_status='verified'` → `EXISTS(verified venue_listings)`. Definer + grants re-asserted.
6. **Admin brand-name read** (forced cascade): `CREATE POLICY "brands admin can read" … USING (is_admin_user())` — SELECT-only. Without it the spec's embedded `brand:brand_id(...)` join is silently RLS-nulled for every admin (SC-13 requires the brand name). Mirrors the M1 venue_listings admin-read policy + the "Admins can read brand_hours" precedent.

## 5. Edge functions touched (+ verify_jwt to preserve at deploy)

| Function | Leg C change | verify_jwt |
|---|---|---|
| `venue-reservation-create` | pricing rpc gains `p_venue_id: venueId` (D-B) | FALSE (config.toml) |
| `admin-review-venue-claim` | tweak_fields / score_override call the venue-keyed RPCs (`p_venue_id`) | default TRUE — preserve |
| `run-business-place-authoring-pipeline` | `sync_hero_media` also writes `venue_listings.cover_media_url/type` (D-C truth; service-role client, ownership pre-asserted by loadOwnedBrand→loadOwnedVenue) | default TRUE — preserve |

`deno check` green on all three; `deno test -A supabase/functions/admin-review-venue-claim/` → **40/40** (append-only suites untouched). No CORS headers touched (orch-1205 gate green).

## 6. Regression tests added (+ fails-on-revert proofs)

- **`mingla-business/__tests__/metaOrch1255LegC.happy.test.ts`** — 12 tests: T-C1 service half ×2 (view-only read + full mapping incl. hours parse + gallery cascade; null → not-found) · SC-12 feed ×1 · T-C1 route half ×3 (route contract, comment-stripped no-useAuth, map-fail-safe + fail-closed reserve + shared menu renderer) · vercel bot rewrite ×1 · T-C3 admin static half ×2 · D-B/D-C/app-mobile seams ×3. Passing run: `Tests: 12 passed, 12 total`.
- **`supabase/migrations/__tests__/orch_1255_leg_c_rekeys.test.sql`** — M6-1..M6-5 (+M6-2b guard arm), one rollback transaction. **6/6 PASS LIVE** on a rebuilt local Postgres carrying the full 301-migration chain (deduped scratch per Leg A's COMMS-0051 workaround; M1–M6 applied IN ORDER by `supabase db reset`). All 5 Leg A SQL suites re-run on the M6 DB: **19/19 still PASS** (5/1/4/4/5).

**fails-on-revert verified at `0f3ac08e9`** — TRUE deletions, both re-proven then restored:
1. Deleted `app/b/[brandSlug]/v/[venueSlug].tsx` → suite fails (ENOENT on the route contract — SPEC §9's "deleting the venue route file fails T-C1"). Restored → 12/12.
2. Deleted `p_venue_id: venueId` from the pricing rpc call → D-B seam test fails (assertion tightened to the PRICING call specifically after the first proof exposed it matching the slots call). Restored via `git checkout` → 12/12.
3. **Live schema revert:** dropped the M6 resolver and re-created the pre-M6 brand-joined body on the local DB → `M6-1 FAIL: expected exactly 1 resolver row without p_venue_id, got 2` (the exact production hazard). Re-applied M6 (idempotency proven) → 6/6 PASS.

Append-only: no existing test modified or deleted; both new files are net-new and in this branch/PR diff.

## 7. Old → New receipts

### 20261130000005 (M6) + orch_1255_leg_c_rekeys.test.sql
**Before:** admin tweak/score RPCs read `brands.claim_status`/`brands.place_pool_id` (inert → `brand_not_pending_review`/`no_linked_place` for every new venue); pricing resolver could return N rows (edge took rows[0]); intelligence RPC read the dead brand pointer + a nondeterministic brand-level config; public_menus_view permanently empty post-1255; admins couldn't read brand names through embeds. **Now:** all venue-keyed/deterministic; menus gate on verified venues; admin SELECT-only brands policy. **Why:** ratified D-A/D-B/D-D + discovered D-F + SC-13 cascade. **Lines:** ~660 SQL + ~330 test.

### venue-reservation-create / admin-review-venue-claim / pipeline (sync_hero_media)
**Before:** pricing brand-only (rows[0] winner); tweak/score wrapper derived a brand then called brand-keyed RPCs (latently broken); hero sync wrote place_pool only while the client's brand cover target clobbered `brands.cover_media_url`. **Now:** `p_venue_id` end-to-end; hero sync writes the venue row's cover columns (one owner). **Lines:** ~45.

### publicEventsService / usePublicEvents / publicUrls
**Before:** no anon venue read path in the client. **Now:** `VenuePublicViewRow`/`PublicVenue`/`PublicVenueSummary`/`PublicVenueReservable` types; `getPublicVenueBySlug` + `fetchPublicBrandVenues` + `getPublicVenueReservable` (view/RPC only — the anon-safe gate enforces no `from("venue_listings")`); `venueBySlug`/`brandVenues`/`venueReservable` key-factory entries + hooks; `venuePublicPath/Url`. **Lines:** ~340.

### PublicVenuePage + route + PublicVenueNotFound
**Before:** `/b/{brand}/v/{venue}` did not exist. **Now:** DESIGN §6 built — ParallaxCoverShell + `createThemePalette(resolveTheme(venue.theme))` + theme font; venueSlug-hash hue fallback; phone identity block / desktop hero overlay + §6.10 sticky panel (name, address, today-line, By-brand, Share, reserve CTA); §6.4 map via `buildStaticMapUrl` (server proxy; null → hidden) + open-in-maps address card; §6.5 hours with accent today-bar + tabular-nums; §6.6 menu via the shared `PublicMenuSections` (currency-aware incl. zero-decimal) hidden at 0 items; 240×180 snap gallery with per-photo a11y labels; §6.7 reserve = fail-closed display gate → phone sticky bar / desktop panel CTA (bar suppressed ≥1024), non-reservable → NO bar; §6.8 ONE not-found state ("This venue isn't on Mingla yet") for missing AND not-live + brand link only when the parent brand publicly resolves; §6.9 route loading/error mirror `/b`; §6.11 Head/OG (brand OG fallback); `web_public_offering_viewed` offering_type "venue". No auth hooks anywhere (the `/b/` allowlist prefix covers the nested path segment-safely — verified in `coldLoadAuthGates.ts`). **Lines:** ~990.

### packages/brand-rendering (+ business adapter + /b route)
**Before:** shared brand page had no venues concept; MenuTab unexported. **Now:** additive `venues?: PublicBrandVenueSummary[]` + `onOpenVenue` callback; `LocationsSection` (explicitly-annotated component — zero new tsc noise under the package's broken-React.FC regime) rendered with the About pane; `PublicMenuSections` exported (one menu renderer for brand + venue pages). Adapter passes venues + pushes `venuePublicPath`; the `/b` route feeds a SIBLING `usePublicBrandVenues` query (append-only ve4 pins forbid re-shaping `getPublicBrandBySlug` — §10-C1). Consumer app passes nothing → section absent (unchanged). **Lines:** ~180.

### CoverPicker plumbing (D-C client)
**Before:** no venue target — the wizard used `kind:"brand"`, whose device/provider/video paths ALL patch `brands.cover_media_url` (two venues fight over the parent brand's cover). **Now:** `CoverTarget` gains `{kind:"venue", brandId, venueId}`; device upload → storage-only `uploadBrandCover` + emit; provider select → `coverFromProviderRef` validation only + emit; video → new `"venue"` kind rides the brand server pipeline but SKIPS the on-ready apply (the brands write); persistence = the wizard's existing `handleCoverChange → syncHeroMedia` → venue row (+ the fn-side venue cover write). Wizard `[TRANSITIONAL]` marker removed (exit condition met). **Lines:** ~130.

### Admin claims (service + page + row)
**Before:** queue read `brands` rows (empty forever post-1255); brand-keyed bodies. **Now:** `from("venue_listings")` + embedded `brand:brand_id(id,name,slug)` + place_pool join; venue-keyed `reviewClaim/tweakClaimFields/overrideClaimScore/addClaimFeedback/getClaimReviewBundle` bodies; rows + modal title "{venue} — {brand}"; `duplicate_of_venue_id`; hours by `venue_id`. `addClaimFeedback` keeps its append-only-pinned param NAME (value = venue id, §10-C2). **Lines:** ~110.

### app-mobile reserve flow
**Before:** slots + create were brand-keyed (post-apply a multi-venue brand → empty slots / 409 via the shim). **Now:** `VenueReservableRow.venue_id` consumed; both gates (button + sheet, kept mirror-identical) also require `venue_id`; `useVenueAvailability(venueId)` → `p_venue_id`; create body sends `venueId` (fn prefers it; brandId rides for logging). Deck untouched (spec §3 proof — no deck/discover file in the diff). **Lines:** ~70.

### VenueIntelligence (D-D client)
**Before:** module brand-keyed (D-B9). **Now:** shell passes `venueId`; hook/service send `p_venue_id` (brandId-first `byVenue` key so brand-prefix invalidations still match). **Lines:** ~35.

## 8. Cross-surface impact

| Surface | Effect | Parity |
|---|---|---|
| Buyer/anon Web | NEW venue page + Locations section + bot rewrite; ships FIRST via Vercel `[deploy]` at CLOSE | manual (web-only surfaces) — built |
| Business iOS / Android / Web preview | D-C cover target + D-D intelligence scoping (same RN code) | automatic; native rides the NEXT BUILD (COMMS-0052) |
| Consumer iOS / Android | reserve flow venue-keyed; deck byte-untouched | automatic (shared RN) |
| Admin Web | claims queue venue-keyed end-to-end | manual — built |
| Backend | M6 + 3 edge fn deltas | applied/deployed at CLOSE only |

Sequencing: nothing is user-visible until CLOSE applies M1–M6 + deploys the fns + Vercel `[deploy]`. Pre-apply prod behavior unchanged.

## 9. Verification — proven vs pending (honest split)

**Proven:**
- **DB LIVE:** full 301-migration chain (M1–M6 in order) applied cleanly on a rebuilt local Supabase Postgres (deduped scratch, teardown confirmed); M6 suite 6/6 PASS; all 5 Leg A suites 19/19 PASS on the M6 DB; M6 re-applies idempotently; live schema-revert proof (§6.3).
- **PROD read-only:** D-E probe (M5 predicate = exactly the 3 orphans incl. both servable). No prod writes.
- Jest: Leg C 12/12; Leg B 10/10 re-run; affected sweep green (CoverPicker.selectedState, VenueCreatorWizard.ve2, orch_1089, businessTodos, venueClaimService, useHubTabs×2, brandPatch smoke, anon-buyer allowlist, tripFetch-excluded — see pre-existing).
- `npx tsc --noEmit`: mingla-business **879 == 879** baseline (normalized diff = union-order permutations only); app-mobile **960 == 960**. Zero new errors.
- `npx expo export -p web --clear` → exit 0. `mingla-admin` `npm run build` (vite) → built. Admin `npm test` 19/19 + orch1064 panel 5/5.
- Strict-grep: all 5 orch-1255 gates + orch-1205 CORS + orch-1218 vendor-leak + orch-1186 hours + orch-0885-a — PASS (self-tests OK). vercel.json JSON-parses. No workflow file touched.
- Deno: check green ×3; admin-review-venue-claim 40/40 (`-A`).
- fails-on-revert at `0f3ac08e9` (§6).

**Pending (tester / post-CLOSE):**
- SC-11/SC-12 logged-out BROWSER runs against the deployed preview (anon pages fully verifiable per SPEC §9); T-C2/T-C4/T-C5 adversarial; SC-13 admin approve E2E live-fire (needs applied M1–M6 + deployed fns + the SPEC §11 test fixtures).
- Edge fns: statically verified only (no local edge runtime); one curl each at CLOSE (§11).
- D-C venue VIDEO cover end-to-end (processed-URL → syncHeroMedia) — static-only; needs runtime.
- Reserve bar CTA app-handoff UX eyeball (see §10-C4).

**Pre-existing failures (verified identical on origin/main or the Leg B tip — NOT Leg C regressions):** `publicEventsService.{ve4,test,tripFetch}` fail under the default jest config ("Cannot find module '@mingla/offering-rendering'" — import added on main pre-Leg-C); `venueTab.contract.test.ts` 2 failures pin the pre-1255 hub gate and fail identically at the Leg B tip `914378eae` (Discovery #2).

## 10. Deviations from the SPEC (each forced, none silent)

- **C1 — `getPublicBrandBySlug` NOT re-shaped** (spec #3: "overlay read REPLACED… `venue` → `venues`"). UNSATISFIABLE against append-only `publicEventsService.ve4.test.ts`, which pins at runtime: the `claimed_venues_public_view` read, the `venue` overlay object, and `expect(mockFrom).toHaveBeenCalledTimes(3)` (any added from() breaks it). Shipped: the overlay stays dormant ([TRANSITIONAL-2] view returns 0 rows forever — it can never produce conflicting truth) and `venues` is a SIBLING query (`usePublicBrandVenues`) in the route. SC-12's observable behavior is delivered exactly. Same conflict class as Leg B D-B1/D-B2.
- **C2 — `addClaimFeedback` keeps the pinned param name** `brandId` (append-only ORCH-1064 suite pins the exact signature); the VALUE is the venue id, body sends `venue_id`, JSDoc says so. Same class as Leg B D-B4.
- **C3 — Locations section renders adjacent to the About pane** (not inside AboutTab): the shared package's `React.FC` annotations collapse under the business tsconfig (pre-existing "Cannot find module 'react'" regime), so threading new props through AboutTab added 8 new implicit-any/never error lines. `LocationsSection` uses inline param annotation → zero new tsc lines (879==879). Visual result matches the spec's contract (cards: name, address/city, photo, tap → venue page; omitted at 0).
- **C4 — Reserve CTA v1 = app handoff `https://usemingla.com`** `[TRANSITIONAL]`. DESIGN §6.7 left the destination as "the SPEC's call (web reserve flow vs app handoff)" and the SPEC never made it; NO anon web reserve flow exists (the `/reserve/{brandId}` success routes referenced by venue-reservation-create have no page — pre-existing). The marketing site (store links) is the only real destination; a disabled/dead CTA is constitutionally forbidden. Exit: a buyer-web guest reserve flow ORCH re-points the CTA. Non-reservable venues get NO bar (fail closed), exactly per spec.
- **C5 — venue pitch (§6.3) + price-tier chips (§6.6) OMITTED**: the M4 `venue_public_view` (spec-verbatim DDL) exposes neither a pitch/description nor `price_tiers`; DESIGN's rule is data-absent → element hidden. Exposing them needs a view widening (follow-on; see Discoveries #3).
- **C6 — D-F `public_menus_view` re-gate added** (not in the ratified D-list): without it the spec's own §L-C.2 menu section ([TRANSITIONAL-3] via `fetchPublicMenus`) and the brand page Menu tab go PERMANENTLY empty at apply (view was gated on `brands.claim_status='verified'`, which no flow ever writes again). Same legacy-pointer class as D-A/D-D. Proven live (M6-5).
- **C7 — brands admin-read policy added in M6** (spec assumed the embedded brand join "passes RLS via the M1 policy" — that policy is on venue_listings; PostgREST embeds are filtered by the JOINED table's RLS, and brands had no admin SELECT policy → brand names silently NULL). SELECT-only, `is_admin_user()`-gated.
- **C8 — spec's Leg C file list named `VenueSlotPicker.tsx`** for the create passthrough; the picker is presentational — the actual call sites are `VenueReserveSheet.tsx` + `ExpandedCardModal.tsx` (changed); the picker needed no change.
- **C9 — gallery strip uses the house Ve4 cascade** (cover first; pool photos only as fallback — `buildVenueGalleryPhotoUrls` shipped semantics), not cover+pool additive; richer galleries need `business_gallery_urls` in the view (Discoveries #3).

## 11. Operator action required — UPDATED ordered apply plan (supersedes Leg A §11: now M1→M6)

Do NOT `db push` (history drift). Apply via the Supabase Management API against `gqnoajqerqhnvulmnyvv`, from MERGED main, in this exact order, one read-back each:

1. `20261130000000_orch_1255_venue_listings_core.sql`
   → `SELECT count(*) FROM pg_policies WHERE tablename='venue_listings';` (expect 2) · `SELECT has_table_privilege('anon','public.venue_listings','SELECT');` (expect f)
2. `20261130000001_orch_1255_pipeline_feedback_venue_rekey.sql`
   → `SELECT conname FROM pg_constraint WHERE conname LIKE 'brand_place_pipeline_state%unique';` (expect ONLY `..._venue_unique`)
3. `20261130000002_orch_1255_ops_rekey.sql`
   → PK of `venue_reservation_settings` = `venue_id` · `SELECT pg_get_function_identity_arguments('public.pg_venue_available_slots'::regproc);` (expect `p_date date, p_party_size integer, p_venue_id uuid, p_brand_id uuid`)
4. `20261130000003_orch_1255_claim_rpcs_public_views.sql`
   → `SELECT has_table_privilege('anon','public.venue_public_view','SELECT');` (expect t) · stub check per Leg A §11.4
5. `20261130000004_orch_1255_orphan_place_cleanup.sql`
   → `SELECT id,name,deleted_at,is_servable,is_active FROM place_pool WHERE deleted_reason LIKE 'orch-1255:%';` (expect 3 rows, all deleted+unservable+inactive — incl. Lantern & Vine `8b720912-…` and Lumen Wine Bar `3b10d972-…`, both servable pre-apply per the 2026-07-02 probe)
6. **`20261130000005_orch_1255_leg_c_discovery_rekeys.sql`** (M6 — NEW)
   → `SELECT pg_get_function_identity_arguments('public.resolve_brand_pricing_inputs'::regproc);` (expect `p_brand_id uuid, p_venue_id uuid`)
   → `SELECT pg_get_function_identity_arguments('public.admin_tweak_venue_claim_fields'::regproc);` (expect `p_venue_id uuid, p_patch jsonb`)
   → `SELECT pg_get_function_identity_arguments('public.venue_intelligence_overview'::regproc);` (expect `p_brand_id uuid, p_venue_id uuid`)
   → `SELECT count(*) FROM pg_policies WHERE tablename='brands' AND policyname='brands admin can read';` (expect 1)
   → `SELECT definition LIKE '%venue_listings%' FROM pg_views WHERE viewname='public_menus_view';` (expect t)

Then deploy edge fns from MERGED main (`supabase functions deploy <fn> --project-ref gqnoajqerqhnvulmnyvv`), preserving §5 verify_jwt values: `run-business-place-authoring-pipeline`, `admin-review-venue-claim`, `venue-claim-submitted-email`, `venue-claim-decision-email`, `venue-reservation-create` (+ optionally confirm/cancel — no code delta). Cheapest live curls: pipeline fn missing `venue_id` → 400; `venue-reservation-create` with only a random legacy `brandId` → 409 `venue_ambiguous`; `admin-review-venue-claim` tweak without `venue_id` → 400 `venue_id_required`.

Then: Vercel `[deploy]` (the venue page + Locations + bot rewrite ship with it). NO `eas update` (COMMS-0052 — business native rides the next build; consumer OTA frozen). Flip the 4 DRAFT invariants ACTIVE at CLOSE (orchestrator-owned).

## 12. Known issues / deferred ([TRANSITIONAL] ledger, Leg C additions)

- **C4 reserve CTA app-handoff** — exit: buyer-web guest reserve flow ORCH.
- Venue pitch + price tiers + richer gallery hidden pending a `venue_public_view` widening (Discoveries #3).
- Legacy `venueIntelligenceKeys.detail(brandId)` key kept beside `byVenue` (no live caller passes null venueId from the shell; hub/legacy mounts may).
- `resolve_brand_pricing_inputs` NULL-venue arm (single-settings-row back-compat) — exit: with [TRANSITIONAL-1]'s drop, make `p_venue_id` required.
- Leg A/B [TRANSITIONAL-1/2/3] unchanged.

## 13. Discoveries for Orchestrator

1. **Append-only suites broken on main under the default jest config (P2):** `publicEventsService.{ve4,test,tripFetch}` all fail with `Cannot find module '@mingla/offering-rendering'` on origin/main — a main-side import (pre-Leg-C) broke them and nobody noticed; the ve4 pins that forced deviation C1 are currently not even executing in CI's default path. Worth a config fix (moduleNameMapper) + a decision on superseding the ve4 pins so the spec's one-owner re-shape can land properly.
2. **`venueTab.contract.test.ts` (ORCH-1145) fails 2/12 at the Leg B tip** — it pins the pre-1255 `hasPhysicalLocation||hasPlacePool` hub gate that Leg B re-keyed; contradicts Leg B §6's "all pinned suites green" claim (possibly drifted during the ORCH-1256 rebase). Needs a TEST-MOD-APPROVED supersession together with D-B1's exit.
3. **`venue_public_view` is thin for the page design (P3):** no pitch (`place_pool.generative_summary`), no `price_tiers`, no `business_gallery_urls`. A follow-on view widening (CREATE OR REPLACE, additive columns) would light up DESIGN §6.3/§6.6 fully.
4. **No anon WEB reserve flow exists** while `venue-reservation-create` emits `/reserve/{brandId}/…` success URLs for its web path — pre-existing dead route class; the venue page CTA (C4) is the second consumer of this gap. Candidate ORCH.
5. **`supabase start` still cannot boot main's chain** (duplicate version prefixes) — reconfirmed; this leg rebuilt a fully-renumbered scratch chain (script pattern: sorted-order sequential renumber). Same doc-note/repair decision as Leg A Discovery #3.
6. **Admin `listing.tsx`-style deep links from admin pushes/emails** (`?venue=`) were Leg A/B work; the admin QUEUE itself never links out to the business app — fine, but the admin modal could deep-link the public venue page post-approve (tiny UX follow-on).

---

# REWORK — round-2 P1 slug re-key (META-ORCH-1255(R), 2026-07-02)

## What failed (tester RETEST round 2, TEST_META-ORCH-1255_MULTI_VENUE.md)

**P1-NEW (runtime-proven):** `checkVenueSlugAvailable` / `suggestVenueSlugs` /
`resolveAvailableVenueSlug` in `mingla-business/src/services/brandsService.ts`
still queried the **brands** table for slug collisions. Post-1255 venue slug
truth is `venue_listings UNIQUE (brand_id, slug)` (migration 20261130000000,
`venue_listings_brand_slug_uniq`). A same-name second venue in ONE brand showed
"✓ Available — auto-selected" (brands has no such slug) and then "This URL slug
is taken" when the DB backstop rejected the insert — a contradictory loop with
no escape. **P2-R2-1 (same screen):** the step-2 preview rendered the pre-1255
URL shape `/b/{venueSlug}` instead of the real D-2 route
`/b/{brandSlug}/v/{venueSlug}`.

## What changed (commit `3cc6090b71efd19e65566526a833e6a7e304d112`)

### mingla-business/src/services/brandsService.ts
**Before:** `checkVenueSlugAvailable` queried
`.from("brands").select("id").eq("slug", s).is("deleted_at", null).limit(1)`;
`suggestVenueSlugs` / `resolveAvailableVenueSlug` built on it; the third param
was a vestigial `ownAccountId`.
**Now:** the availability probe is
`.from("venue_listings").select("id").eq("brand_id", brandId).eq("slug", s).limit(1)`
— scoped to the brand the listing will live under (same slug under a DIFFERENT
brand is available). `brandId` threads through the old `ownAccountId` position
in all three functions (kept optional so legacy arity compiles; when absent the
check still targets `venue_listings`, never brands). RLS: the
"venue_listings brand member can read" policy admits the authed caller for
exactly the scope queried. `.eq("brand_id")` intentionally precedes
`.eq("slug")` — the pre-existing pinned suites' chain mocks key off the FINAL
`.eq` argument, keeping them green unmodified.
**Lines:** ~35 (mostly doc comments).

### mingla-business/src/components/venue/VenueStep2NameSlug.tsx
**Before:** prop `accountId` fed the checks; preview rendered
`business.usemingla.com/b/{venueSlug}`.
**Now:** props `brandId` (scopes both the debounced check and the suggestion
pills) + `brandSlug`; preview renders
`business.usemingla.com/b/{brandSlug}/v/{venueSlug}` (degrades to the bare
`/b/` prefix only if brandSlug is absent, which the brand-scoped wizard never
produces). **Lines:** ~20.

### mingla-business/src/components/venue/VenueCreatorWizard.tsx
**Before:** `resolveAvailableVenueSlug(name, slug, user.id)`; step-2 got
`accountId={user?.id}`.
**Now:** submit-time resolver gets `currentBrand.id` (guarded non-null before
the call); step-2 gets `brandId={currentBrand?.id}` +
`brandSlug={currentBrand?.slug}`. **Lines:** ~8.

## Regression test (fails-on-revert)

New suite: `mingla-business/src/services/__tests__/venueSlugPerBrand.metaOrch1255R.test.ts` — 9 tests:
- same-brand + same slug → TAKEN (the P1 collision);
- DIFFERENT brand + same slug → AVAILABLE (per-brand scoping);
- resolver advances a same-brand duplicate to `…1`; keeps preferred when only
  another brand holds it;
- suggestions skip the in-brand-taken root, offer the numbered fallback;
- **query-target assertion:** every availability query hits `venue_listings`
  with a `brand_id` eq — the brands table is NEVER consulted;
- source pins (P2-R2-1): step-2 interpolates `${brandSlug}/v/` after the
  `/b/` prefix; `brandSlug` prop declared.

**fails-on-revert verified at `3cc6090b71efd19e65566526a833e6a7e304d112`** —
true line deletion of the fix (the `brand_id` scoping lines in
`checkVenueSlugAvailable` + the `${brandSlug}/v/` preview line) → 6/9 tests
FAIL; fix restored → 9/9 PASS.

## Gates (real output)

- Slug suites (new + both pre-existing, UNMODIFIED):
  `Test Suites: 3 passed · Tests: 20 passed`.
- Affected sweep (`useBrands metaOrch1255 orch1256 venueTab.contract
  businessTodos brandPatch deckReadinessRoutes venueClaimService
  listing.orch_1040 orch1186Hours useHubTabs venueSlug
  resolveAvailableVenueSlug`): `Test Suites: 24 passed · Tests: 224 passed`.
- `tsc --noEmit` (mingla-business): 721 errors before = 721 after (all
  pre-existing, `packages/phone-input`); ZERO in touched files.
- `expo export -p web --clear`: exit 0, full 27M dist with route bundles.
- strict-grep: all five `orch-1255-*.mjs` gates PASS.
- append-only: `12 passed, 0 failed` — this rework MODIFIES no existing test
  file; the HEAD commit carries `[TEST-MOD-APPROVED META-ORCH-1255]` because
  the gate reads the token from the branch-HEAD body and the tester's two
  approved supersessions live on this branch below HEAD.

## Cross-surface impact

Business iOS / Android / Web (one RN codebase — parity automatic): wizard slug
check + preview URL. Consumer iOS/Android, buyer anon web, admin web:
UNAFFECTED (authed business wizard only; no migration, no edge fn, no route
change).

## Scope attestation

Exactly the two seams the tester scoped: one service + the wizard step-2
preview + the param threading they force + the new test suite. No other
changes; P2-R2-2 (deck-readiness exit) untouched (needs Seth UX decision).

---

# R2 — ORCH-1083 web bundle-budget rework (eager `__common` over cap)

## What failed

PR #710's ORCH-1083 gate: `eager __common chunk is 2,299,229 bytes, over the
2,250,000-byte cap`. Reproduced locally at 2,299,285 (56 B env noise).
origin/main baseline (clean worktree export): **2,241,918** — only 8 KB of
pre-existing headroom; Leg B/C added ~57 KB of eager weight.

## Root cause (source-map byte attribution, branch vs origin/main)

Metro hoists any module statically shared by 2+ route chunks into the EAGER
`__common` boot chunk. Four Leg B/C import-topology changes did that:

1. **`packages/brand-rendering/PublicBrandPage.tsx` +27,432 B** — the venue
   public page value-imported `PublicMenuSections` from the barrel, whose
   re-export lived INSIDE PublicBrandPage.tsx → the whole brand page hoisted.
2. **`VenueCreatorWizard.tsx` file (24,013 B) + all six venue step modules
   (~13,500 B)** — `VenueDeckReadinessSetup` lived in the wizard file and is
   consumed by BOTH `app/venue/create.tsx` and `app/venue/deck-readiness.tsx`
   → the whole wizard graph hoisted (pre-existing at baseline, venue-scoped).
3. **`useVenueReservationSettings.ts` +3,346 B** — the per-brand LIST hook
   (hub card list chunk) shared a file with the per-venue detail/mutation
   hooks (venue suite chunk).
4. **`TicketTierEditSheet.tsx` 25,557 B** (pre-existing) — statically imported
   by `CreatorStep5Tickets`, which is shared by the compose + edit chunks.

## Fix (deferral restored; cap and ORCH-1083 gate script UNTOUCHED)

All four are import-graph refactors — code moved VERBATIM; zero behavior
change except one house-pattern lazy split:

- `packages/brand-rendering/PublicMenuSections.tsx` (NEW): MenuTab +
  formatMenuPrice + menu styles moved out of PublicBrandPage.tsx; barrel
  re-exports from the new file; `PublicVenuePage.tsx` uses the DEEP specifier
  `@mingla/brand-rendering/PublicMenuSections` (barrel import is type-only).
- `mingla-business/src/components/venue/VenueDeckReadinessSetup.tsx` (NEW):
  setup component + helpers + its style subset moved out of the wizard;
  `deck-readiness.tsx` imports the new module; the wizard imports it too.
- `mingla-business/src/hooks/useBrandReservationSettingsList.ts` (NEW): the
  list hook + list key + row type moved out of useVenueReservationSettings.ts;
  `VenueCardList.tsx` repointed.
- `CreatorStep5Tickets.tsx`: `TicketTierEditSheet` → `React.lazy` +
  `<Suspense fallback={null}>` (ORCH-1083 house pattern — Connect bodies /
  QR renderer). fallback null is behavior-identical: the sheet renders null
  until `visible`.

## Before / after chunk bytes

| Metric | Before (branch) | After (branch) | origin/main baseline | Cap |
|---|---|---|---|---|
| eager `__common` | 2,299,285 | **2,223,290** | 2,241,918 | 2,250,000 |
| margin under cap | −49,285 (FAIL) | **+26,710 (PASS)** | +8,082 | — |
| gate verdict | FAIL | **PASS** (`initial payload 3,228,765; 145 chunks; 0 deferred specifiers in entry`) | PASS | — |

`__common` now sits 18.6 KB BELOW the origin/main baseline (the wizard-graph
and ticket-sheet deferrals recovered more than Leg B/C's genuine growth in
already-shared modules, which remains: publicEventsService venue fetchers +
useBusinessTodos venue to-dos + useMenus/menusService shared by the hub list
and venue suite chunks — all real cross-chunk usage).

## Pin supersessions (sanctioned: `[TEST-MOD-APPROVED META-ORCH-1255]` in HEAD body)

- `packages/brand-rendering/__tests__/publicMenu.render.test.tsx` — menu-block
  reads follow the move to PublicMenuSections.tsx; EVERY assertion unchanged
  (tab-gate asserts still read PublicBrandPage.tsx).
- `mingla-business/__tests__/metaOrch1255LegC.happy.test.ts` (D-C) — the
  `kind: "venue"` cover-target pin follows the setup move; adds
  `wizard NOT kind:"brand"` retained + setup `NOT kind:"brand"`.
- Gate anchors (NOT the 1083 gate): `orch-1186c-menu-display-only.mjs`
  sharedPage → PublicMenuSections.tsx (same block anchor + tokens);
  `orch-1218-venue-authoring-no-vendor-leak.mjs` scans the wizard + setup
  files as ONE concatenated unit (same >= 4 sanitizer-call binding; both
  self-tests pass).

## Regression test (fails-on-revert)

`mingla-business/__tests__/metaOrch1255R2.bundleBudgetDeferral.happy.test.ts`
— 10 tests pinning all four deferrals in source. TRUE LINE-DELETION proofs:
deleting the React.lazy lines fails R2-3 ("React.lazy dynamic import…" ✕);
deleting the deep-specifier import fails R2-1 ("DEEP specifier" ✕); restored →
10/10 pass. fails-on-revert verified at b7297df2c.

## Gates (real output)

- Budget: `ORCH-1083 bundle-budget PASS — initial payload 3228765 bytes
  (ceiling 9405478), 145 chunk files, 0 deferred specifiers in the main entry
  chunk, __common within cap.` (`__common` file = 2,223,290 B.)
- `expo export -p web --clear`: exit 0.
- Jest sweep (metaOrch1255* + R2 + venueTab.contract + orch1256 +
  businessTodos + deckReadinessRoutes + venueClaimService + orch_1089 +
  useHubTabs + venueSlug): **18 suites / 205 tests passed**; plus
  `publicMenu.render.test.tsx` 6/6 via `npx jest --roots ..`.
- KeyboardRoot VenueCreatorWizard pins: 2/2 pass (suite's TripBrandWizard /
  web-bundle failures are PRE-EXISTING — identical on pristine branch).
- `tsc --noEmit`: 721 → 722 lines; the delta is the pre-existing
  `../packages/*` "Cannot find module 'react'" environment noise following
  the moved lines (every packages/ file emits it); ZERO new errors in
  mingla-business src/app. No CI tsc gate exists.
- strict-grep: all 5 `orch-1255-*` gates + full registered sweep green
  (only pre-existing env-dependent `orch-1225-careers-runtime-dom` fails,
  identical on pristine branch).

## Runtime smoke (anon venue page on web)

Served the fixed export statically + headless Chromium at
`/b/r2-smoke-brand/v/r2-smoke-venue` (real anon backend reads): renders the
single indistinguishable not-found state ("This venue isn't on Mingla yet"),
ZERO page errors. The stripe-mode handshake was stubbed to `test` — the local
export carries the dev pk_test key while prod is live-mode, a PRE-EXISTING
local-export condition (identical fail-close on the origin/main baseline
export). TicketTierEditSheet's lazy body: verified structurally + by the R2
suite; authed compose runtime is not reachable from this session (known cap) —
tester should tap "Add ticket" once on web + iOS to see the sheet open.

## Cross-surface impact (R2)

Business web: boot payload −76 KB eager. Business iOS/Android: same code,
Metro inlines async imports natively (ORCH-1083 precedent: lazy QR/Connect) —
no behavior change. Consumer app / admin / buyer anon web funnel: untouched
(brand-rendering package refactor is consumed identically; app-mobile imports
the barrel only).
