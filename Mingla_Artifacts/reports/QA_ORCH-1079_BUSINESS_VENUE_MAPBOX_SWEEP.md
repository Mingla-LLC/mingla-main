# QA — ORCH-1079 [Business-venue Google→Mapbox sweep]

**Mode:** TARGETED (orchestrator-dispatched verification)
**Skill:** mingla-tester+claude
**Worktree:** `~/Desktop/mingla-orchs/orch-1079-[business-venue-mapbox-sweep]/` on branch `orch-1079-business-venue-mapbox-sweep`
**Commit under test:** `9f3df194a` (HEAD; the impl report cites `da4b60a87` — a pre-squash hash; the diff content matches the report 1:1).
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1079_BUSINESS_VENUE_MAPBOX_SWEEP.md`
**Impl report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1079_BUSINESS_VENUE_MAPBOX_SWEEP.md`
**Date:** 2026-06-05
**Comms acks:** COMMS-0002 (backend allowlist in same commit — verified green), COMMS-0003 (Mapbox docs URLs inline — present in SPEC §2/§3.D + the edge-fn source). No BLOCK entries addressed to this ORCH/skill.

---

## VERDICT: CONDITIONAL PASS

Static + gate + unit verification of the dedup logic, Google retirement, and gates is **solid and complete (PASS)**. The live Mapbox service path the business field calls is **proven on the deployed edge fn (A-5)**. The on-device render+pick of the three in-scope surfaces (Trip / Brand / Venue) and the venue-claim dedup end-to-end (A-1/A-2/A-3) are **BLOCKED ON BUSINESS-SIM LOGIN** — the dev session is in-memory-only and was lost; no credentials available, not fabricated per dispatch. The §3.D.1 region fallback (A-4) is **gated on the orchestrator's CLOSE edge-deploy** (the deployed fn v27 confirmed does NOT yet carry the fallback) — unit test T-4A is the verified correctness floor.

- **P0:** 0
- **P1:** 0
- **P2:** 0
- **P3:** 1 (append-only policy has no clean test-deletion override — implementor-flagged, orchestrator process note)
- **P4:** 2 (praise + minor)

**Why CONDITIONAL not PASS:** per the tester verdict gate, a PASS on a UI/runtime change requires `proven`-level on-device render+pick on each platform. That leg is `probable` (attempted, reached the offering chooser + the Trip surface on iOS, then blocked by an auth/RLS wall on the test account) — not `proven`. The dedup correctness (the one real hazard) is fully proven at the unit + RPC-invariant level, so this is a deferral-on-login, not a defect.

---

## Item 1 — Static + gate + unit verification: PASS (complete)

### 1.1 The 3 new strict-grep gates — PASS
All three self-test (exit 0) AND run-against-repo (exit 0):
- `i-biz-venue-input-uses-mapbox.mjs` (INV-1) — all 3 surfaces import `MapboxAddressInput`; zero `AddressAutocompleteInput`/`googlePlacesService`/`parseGooglePlaceResult` tokens. ✅
- `i-no-biz-google-places-autocomplete.mjs` (INV-2) — 4 dead files absent; zero refs under `mingla-business/src` (589 files scanned); `GOOGLE_MAPS_API_KEY` retention P0-guard green. ✅
- `i-mapbox-suggest-no-types-filter.mjs` (INV-3) — suggest call filter-free. ✅

### 1.2 C7 backend allowlist (COMMS-0002) — PASS
`node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` → `OK [C7: no-new-backend-files]` (exit 0, 26 files changed). All 5 backend-diff files (`mapbox-geocode/index.ts` + its 2 test files, `places-autocomplete/index.ts` + `index.test.ts`) are in `ORCH_1079_BACKEND_ALLOWLIST`, which is spread into `ALLOWLIST`. Verified the diff base is `origin/main...HEAD` and origin/main = `ab934a811` (parent of the SPEC commit), so C7 genuinely evaluated the full ORCH-1079 changeset.

### 1.3 Append-only CI check (the specific dispatch concern) — PASS, NOT a FAIL
`node .github/scripts/test-append-only-check.js` → **7 passed, 0 failed**. Critically, the rewritten `places-autocomplete/index.test.ts` (169 deleted lines → retirement marker) is classified MODIFIED and covered by the `[TEST-MOD-APPROVED ORCH-1079]` override token — it does **NOT** trip the append-only gate. The renamed mapper test is detected as RENAMED (R055) with `[TEST-RENAME-APPROVED ORCH-1079]`. Confirmed: the retirement-marker rewrite is a legal MODIFY, not a deletion → no FAIL to flag.

### 1.4 Importers + deletions + key retention — PASS
- Zero real importers of `AddressAutocompleteInput`/`googlePlacesService` in `mingla-business/src` (the single `CreatorStep3Where.tsx` hit is a comment string, not an import; test-file hits are the gates' own coverage tests).
- `places-autocomplete/index.ts` + the 3 dead frontend files all gone; `places-autocomplete/` dir retains only the retirement-marker test (expected).
- `GOOGLE_MAPS_API_KEY` present in all 6 legitimate edge fns (admin-seed-places, admin-refresh-places, admin-place-search, backfill-place-photos, get-companion-stops, get-picnic-grocery). NOT deleted.

### 1.5 The 22 implementor tests — PASS (25 total with my adversarial)
- **9 Deno** (mapbox-geocode region-fallback x3, meta-1060 region-code x5, places-autocomplete retirement marker x1) — all green.
- **13 Jest** (venue dedup x4, trip x4, brand x4, mapper rename x1) — all green.
- **+3 Jest** my adversarial — all green. Total 25.

**Dedup guard tests spot-verified (T-3A/T-3C/T-3D):** confirmed they genuinely assert `googlePlaceId` is neither written nor nulled by onPick/onClear:
- T-3A: seeds `googlePlaceId="ChIJpoolGooglePlaceId"`, runs the locked onPick body, asserts `s.googlePlaceId` is UNCHANGED and `!== mapboxPick.placeId`.
- T-3C/T-3D source-char: strips comments, asserts no `patch({...})` call contains `googlePlaceId`.
- T-3D behavioral: seeds the key, runs onClear, asserts the key survives while address/geo null.
The component source (`VenueStep1Address.tsx:43-71`) matches exactly: onPick patches only `formattedAddress/lat/lng/city/countryCode`; onClear nulls only those 5. Brand (`:360-366`) sets `googlePlaceId: null` on pick. Trip stores `place.placeId` opaquely in `*PlaceId` theme keys.

### 1.6 tsc — clean
`npx tsc --noEmit` in `mingla-business` → **0 errors** (the impl report's "pre-existing noise" is no longer present at this HEAD; my new test adds none).

### 1.7 My adversarial regression test (different angle) — PASS + fails-on-revert
Path: `mingla-business/src/components/venue/__tests__/VenueStep1Address.rpcDedupInvariant.adversarial.test.ts` (3 tests).
**Different angle:** the implementor's test asserts the *store* keeps the key. Mine ports the **actual RPC dedup invariant** (`biz_create_venue_brand_authoring`, migration `20260809000000:311-326` — `nullif(trim(coalesce(...,'')),'')` + `IS DISTINCT FROM`) into JS and drives the **full faithful claim chain** (`prefillDraftFromPoolMatch` → store → locked onPick → `VenueCreatorWizard:181` → `brandsService:368 (?? "")` → RPC). It asserts (1) the preserved pool id PASSES the RPC invariant, and (2) every poisoned variant the guard prevents — mapbox_id, null-out, empty-string, whitespace-only — WOULD throw `place_pool_google_place_id_mismatch`. Attacks the RPC normalization edge cases (empty/whitespace/`?? ""`) the implementor's store-only test never touches.
**Fails-on-revert proven:** when I simulated the reverted guard (onPick writes `googlePlaceId = p.placeId`), the full-chain test broke at the exact dedup-key assertion (2 failed, 1 passed). The guard is load-bearing.

---

## Item 2 — On-device parity (business app): PROBABLE (blocked on login)

### Setup (mechanical blockers RESOLVED per machine-trust)
- iPhone 17 Pro sim (`17091E60-...`) booted; Android emulator-5554 up; both have `com.sethogieva.minglabusiness` installed.
- The worktree `node_modules` was a symlink to the anchor, and the anchor install is **corrupted** (near-empty `.bin`, `wonka.makeSubject is not a function` on `expo start`). RESOLVED by removing the symlink and running a clean `npm ci` in the worktree (1226 packages; expo CLI now resolves 54.0.24). `@mingla/location-input` resolves via metro.config `extraNodeModules` → `../packages/location-input` (present in worktree).
- Metro started from the worktree on port 8101; the business dev build bundled + launched from worktree code (confirmed in Metro logs).

### A-5 — venue/business NAME search returns pickable POIs: PASS (live, service layer)
Drove the **deployed `mapbox-geocode` edge fn** (the exact backend the business Mapbox field calls via `supabase.functions.invoke`) with the app's anon key:
- `suggest "The Wine Bar Raleigh"` → HTTP 200, 5 POI suggestions: "The Hippo Wine Bar & Shop" (123 E Martin St, Raleigh NC), "The Den Coffeehouse and Wine Bar" (DC), "San Antonio Winery" (LA), etc. — each with `placeId` (mapbox_id), `displayName` (business name), `fullAddress`. These are **POIs/businesses, not just addresses** → proves the no-`types`-filter LOCK holds live and venue-name search does not regress vs Google.
- `retrieve mapbox_id=<Hippo>` → HTTP 200 with full `PlaceDetails` (`city:"Raleigh", region, regionCode:"NC", countryCode:"US", location{lat,lng}`) — the exact shape every business surface consumes.

### Render/pick parity on the 3 surfaces (SC-1/2/3 on-device): PROBABLE — BLOCKED ON LOGIN
Reached the create-offering chooser on iOS (Home → "Create your first offering" → event/experience/trip chooser rendered). Tapped "Create trip or otherwise" → the Trip creator attempted to mint a backend draft and **failed with an RLS error** (`new row violates row-level security policy for table "events"`, brand `53aaea42-...` Lantern & Vine) before `TripCreatorStep1Basics` (the address field) could render. On relaunch the session was gone: Metro logs show `[auth] bootstrap-no-session`; AsyncStorage holds no auth key (Supabase session was in-memory / Keychain and did not persist). I have no business credentials and per the dispatch did NOT guess any.
**Consequence:** the Mapbox dropdown render + a pick filling the field on the three in-scope surfaces was NOT driven on-device. The shared field's render+pick IS independently proven in production via the already-shipped event venue picker (`CreatorStep3Where`, same `MapboxAddressInput` wrapper + same `mapbox-geocode` fn) and via the live A-5 service evidence above — but that is parity-by-shared-component + service-layer proof, not a `proven` per-surface on-device drive.

### A-4 — POI without derivable city does not 500 (region fallback): UNIT-PROVEN; live deploy pending
The **deployed edge fn is version 27 and does NOT yet contain** the `?? ctx.region?.name` fallback (confirmed by fetching the live source — its `featureToDetails` city chain ends at `district?.name ?? null`). This is expected: Phase-0 edge deploy is the orchestrator's CLOSE carve-out (SPEC §5.1 + impl report §5). The worktree source adds exactly the one fallback line (verified the diff is comment + the single `?? ctx.region?.name`), and T-4A (Deno) proves the fallback resolves a region-only POI instead of 500ing AND fails-on-revert. **Floor: PASS via unit test; live A-4 cannot be confirmed until the CLOSE deploy.**

### Android leg
The Android emulator carries the same app and would hit the identical login wall — not separately driven. Parity is by shared RN component + shared edge fn; the live service evidence (A-5) is platform-agnostic (server-side).

---

## Item 3 — Venue-claim dedup guard end-to-end (A-1/A-2/A-3): CONDITIONAL-ON-LOGIN

A logged-in business account with a claimable pool-matched venue was NOT reachable (session lost; no credentials; no seeded claimable venue available to drive without auth). Per the dispatch this is a CONDITIONAL-on-login deferral, and the **unit tests are the correctness floor**, which I independently verified are real and load-bearing:
- **A-1 (pool-match → Mapbox re-pick → submit carries ORIGINAL pool id):** floor = T-3A + my adversarial full-chain test (proven the RPC arg stays the pool google id; fails-on-revert).
- **A-2 (create-new → `brands.google_place_id` NULL):** floor = T-3B + my adversarial create-new test (RPC arg `""` → NULL).
- **A-3 (clear preserves the key):** floor = T-3D.
The dedup logic — the single real hazard in this ORCH — is therefore proven correct at the unit + ported-RPC-invariant level; only the on-device end-to-end submit against a live claimable venue is deferred.

---

## Constitution (touched rules)
- #2 One owner per truth — `google_place_id` written only on the claim/create path; the Mapbox pick never competes for it. PASS.
- #3 No silent failures — `MapboxAddressInput` keeps the loud pick-error contract; the region fallback REDUCES 500s, doesn't hide them. PASS.
- #9 No fabricated data — region-name fallback is real Mapbox `context.region.name`, not invented. PASS.
- Others: N/A (no auth/currency/datetime/persisted-startup surface touched).

---

## Findings

- **P3-1 (process, implementor-flagged):** ORCH-0840 append-only CI has no `[TEST-DELETE-APPROVED]` override for the legitimate "unit-under-test removed" case; the only clean path was rewrite-in-place into a retirement marker. Recommend the orchestrator consider adding the override. Not a blocker for this ORCH.
- **P4-1 (praise):** the dedup guard is implemented exactly to the LOCKED §3.C contract (onPick + onClear both omit `googlePlaceId`), with a regression test that has both a source-characterization catcher and a behavioral replay — and it genuinely fails on revert.
- **P4-2 (minor):** impl report cites commit `da4b60a87` but HEAD is `9f3df194a` (pre-squash hash drift). Diff content matches the report; cosmetic only.

## Discoveries for orchestrator
1. **Login/seed needed to finish item 2/3 to `proven`:** business-sim credentials (or a seeded brand whose RLS allows draft-event INSERT) to render the Trip/Brand/Venue Mapbox fields on-device, plus a claimable pool-matched venue to drive A-1/A-2/A-3 end-to-end. The test account `Lantern & Vine` (brand `53aaea42-...`) currently fails draft-event INSERT with an RLS violation — unrelated to ORCH-1079 but it blocks the Trip surface.
2. **A-4 live confirmation is post-CLOSE-deploy:** deployed `mapbox-geocode` is v27 (no region fallback). After the CLOSE deploy, pick a region-only POI on any surface and confirm no `no_locality` 500.
3. **Anchor `node_modules` is corrupted** (`wonka.makeSubject` error, empty `.bin`) — any session trying `expo start` from the anchor or its symlinked worktrees will fail until a real `npm ci`.

---

## Verdict gate compliance
- Item 1 (static/gate/unit): `proven` — all command output captured above.
- Item 2 on-device render/pick: `probable` — sim reached, blocker (auth/RLS) named; live service path (A-5) proven; A-4 unit-proven + live gated on CLOSE deploy.
- Item 3 dedup: `proven` at unit + ported-RPC-invariant level; on-device end-to-end `conditional-on-login`.
- Regression tests: implementor happy-path present + fails-on-revert (cited in impl report); tester adversarial present at `mingla-business/src/components/venue/__tests__/VenueStep1Address.rpcDedupInvariant.adversarial.test.ts`, different angle (RPC invariant), fails-on-revert verified. Both ship in `git diff origin/main...HEAD` (adversarial added this turn — must be committed with the close PR).
- 0 open P0, 0 open P1.

**Maximum honest verdict without business-sim login: CONDITIONAL PASS** — the correctness-critical dedup logic and Google retirement are fully proven; the remaining gap is on-device render/pick which is deferred on a credential blocker, not a defect.
