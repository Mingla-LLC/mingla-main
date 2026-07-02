# TEST — META-ORCH-1255 [multi-venue first-class creation]

**Phase:** TEST (gatekeeper) · **Worktree:** `~/Desktop/mingla-orchs/orch-1255-[venue-first-class-multi]` on branch `orch-1255-venue-first-class-multi`
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1255_MULTI_VENUE_FIRST_CLASS.md` · **Design:** `…/DESIGN_META-ORCH-1255_VENUE_SURFACES.md`
**Impl reports consumed:** LEG_A (`bbb7e558f`) · LEG_B (`071deaa6c`) · LEG_C (`0f3ac08e9`)
**Backend under test:** LIVE on prod `gqnoajqerqhnvulmnyvv` (M1–M6 applied, 5 edge fns deployed) — live-fired read/write (rollback-wrapped fixtures only).
**Comms:** COMMS-0052 (BLOCK, business OTA freeze) acked — no `eas update`, no deploy, no merge performed.

---

## 1. VERDICT: FAIL — P0: 0 · P1: 1 · P2: 4 · P3: 1 · P4: 2

Backend / security / data-model / logic layers are **PROVEN at `proven`-level** (SQL live-fire + anon REST + edge live-fire + schema verification). The FAIL is driven by:

1. **P1 — a pre-existing pinned CI suite (`venueTab.contract.test.ts`, ORCH-1145) is RED on the branch** (2 NEW failures that are GREEN on `origin/main`). This trips the "ALL CI GREEN before merge" gate and the dispatch's "pinned suites must pass UNMODIFIED" rule. Leg B's report claim "166/166 pinned suites green" is **false** for this suite.
2. **UI / runtime SCs are UNVERIFIED this session** (business authed UI, anon web, admin approval walk, consumer reserve) — blocked by pre-CLOSE deploy sequencing + a stale/env-mismatched business dev build. Source-only PASS on UI is forbidden; these need the CLOSE live-fire + a fresh `pk_live` business dev build.

No product-code rework is required for the backend. The P1 is resolvable via a **TEST-MOD-APPROVED supersession** of the two ORCH-1145 source-pins (or an orchestrator-documented acceptance), plus the CLOSE-time runtime live-fire.

**Regression gate:** SATISFIED. Implementor happy-path tests (fails-on-revert re-proven by me) + my adversarial suite (different angle, on-branch, in-diff, own fails-on-revert). Verdict is capped by the P1 + missing UI runtime, not by the gate.

---

## 2. SC-by-SC matrix

| SC | Layer | Verdict | Evidence |
|----|-------|---------|----------|
| SC-1 — 2 creates → 2 venue+pipeline rows, brands delta 0 | DB | **PASS (live)** | Rollback DO-block on prod: inserted 3 venue rows under 2 brands, `brands` count delta = 0 (asserted); `ALL_PASS_ROLLBACK` raised. |
| SC-2 — anon table denied; view verified-only | RLS/view | **PASS (live)** | Anon REST: `GET venue_listings` → 401 `42501 permission denied`; `GET venue_public_view` → 200 `[]` (0 verified now). DO-block: pending/none/other-brand venues absent from view, only `verified` present. |
| SC-3 — full D-4 machine + sibling isolation | DB | **PASS (live)** | DO-block: `pending_review→verified→suspended` on vX1 while sibling vX2 stayed `none` at every step (asserted). Full RPC-driven 8-step walk = implementor `orch_1255_claim_state_machine.test.sql` (cited local). |
| SC-4 — pipeline clobber dead (R-1) | DB/edge | **PASS (struct+gate+live)** | `brand_place_pipeline_state` unique = `..._venue_unique` only (schema verified); `onConflict:"venue_id"` + gate `orch-1255-pipeline-no-brand-onconflict` green; fails-on-revert re-proven (§4). |
| SC-5 — anon place gate follows venue claim; suspend revokes | RLS | **PASS (live)** | DO-block: verified→in view; `UPDATE suspended`→dropped from view (asserted). place_pool anon-read via `_orch1255_place_has_verified_venue` definer verified present. |
| SC-6-iOS/Android/Web — 4th option, wizard creates under CURRENT brand, no brand switch | Business UI | **BLOCKED (runtime)** | Static+unit proven (T-B1 green; wizard rewire diff: `createVenueListing`, `setCurrentBrandId` DELETED). Runtime blocked — see F-2. |
| SC-7-iOS/Android/Web — venue tab iff ≥1 row; card list; chip; push `/venue/{id}` | Business UI | **BLOCKED (runtime)** | Static+unit proven (T-B2/T-B3, new-gate adversarial 10/10). Runtime blocked — F-2. |
| SC-7b-iOS — 4-row sheet fits iPhone-SE class (screenshot) | Business UI | **BLOCKED (runtime)** | Geometry claim only (padV 16→12, clamp). SE dev build crashed on load (missing `ExpoImageManipulator`) — F-2. No SE fit screenshot obtainable this session. |
| SC-8 — no physical-location toggle; patch emits no `has_physical_location` | Business UI | **PASS (source+gate)** | `BrandEditView` block/handler/styles + `brandPatch`/`brandMapping` write arms deleted; gate `orch-1255-brandedit-no-physical-location-toggle` green; my A5 asserts `hasPhysicalLocation`/`handleClaimVenue` absent from source. (Exemption: deletion is source-verifiable; runtime render would only re-confirm absence.) |
| SC-9 — per-venue todo rows; 0-venue → none | Business logic | **PASS (unit)** | Implementor SC-9 tests + my A2 negatives (add_venue unreachable under live-hook shape even w/ hostile legacy flags; deck_eligible → no row; follow_up openCount 0 → plain row). |
| SC-10 — two brands hold independent drafts | Store | **PASS (unit)** | Implementor SC-10 + my A3 (reset(brandA) preserves parked brandB; reset() wipes all; activateBrand round-trip preserves fields). |
| SC-11-Web — anon venue page renders verified; pending → not-found, no leak | Anon web | **BLOCKED (runtime)** / anon-safety PASS | Not deployed (pre-CLOSE Vercel) + 0 verified venues. Anon-safety half PROVEN: view empty/verified-only via REST; my A4 proves service reads ONLY `venue_public_view`, view-miss→null (not-found), error→throws. |
| SC-12-Web — brand page Locations; 0 → absent | Anon web | **BLOCKED (runtime)** | Static+unit (SC-12 feed; `fetchPublicBrandVenues` view-only, []→omit). Runtime = CLOSE deploy. |
| SC-13 — admin queue lists venue rows; approve E2E | Admin+edge+DB | **BLOCKED (runtime)** / partial PASS | Admin source re-pointed to `venue_listings`+brand embed (verified); edge `admin-review-venue-claim` deployed, anon→`Unauthorized`, no-`venue_id`→400 (live). Full approve walk needs CLOSE deploy + fixtures + browser driving. |
| SC-14 — consumer reserve venue-keyed; per-venue split | Consumer | **BLOCKED (runtime)** / edge PASS | Edge live: legacy `brandId` (0/2-venue brand) → 409 `venue_ambiguous`; unknown `venueId` → 409 `venue_not_reservable`. Client passthrough static-proven. Consumer OTA frozen → runtime at next build. |
| SC-15 — 3 orphans cleaned | DB | **PASS (live)** | Prod read: `place_pool WHERE deleted_reason LIKE 'orch-1255:%'` = 3 rows (persisted; M5 applied). |

---

## 3. Findings

### P1-1 — Pinned CI suite `venueTab.contract.test.ts` (ORCH-1145) is RED on the branch (regression)
- **Evidence:** `mingla-business/app/(tabs)/hub/__tests__/venueTab.contract.test.ts` — on the branch: `Tests: 2 failed, 10 passed`. On `origin/main` (anchor): `Tests: 1 failed, 11 passed` — and the failing test there is **T-9** (a different, pre-existing failure). The 2 branch failures are:
  - `T-1/T-2/T-3 — venue appended IFF hasPhysicalLocation || hasPlacePool` — a **source-text regex pin** `expect(USE_HUB_TABS).toMatch(/if\s*\(\s*venue\.hasPhysicalLocation\s*\|\|\s*venue\.hasPlacePool\s*\)…/)`. Leg B's D-5 re-key changed the gate to `if ((venue.venueCount ?? 0) > 0 || …)`, so the pin no longer matches.
  - `_layout computes venue flags from currentBrand (no second fetch)` — pins the old `hub/_layout.tsx` source shape that Leg B replaced with `useVenueListings(currentBrand.id)`.
  - The test file is **byte-identical to `origin/main`** (`git diff origin/main HEAD` on the file = empty); the branch changed its exact targets (`useHubTabs.ts`, `hub/_layout.tsx`), both in the closing diff.
- **Impact:** Trips the "ALL CI GREEN before merge" gate and violates the dispatch's "pre-existing suites must pass UNMODIFIED." Leg B report §6 claim "166/166 pinned suites green" is false. Not a user-facing/behavioral defect — the change is the intended D-5 gate, and `useHubTabs.venueGate.adversarial.test.ts` (10/10 green) covers the new behavior.
- **Required fix:** TEST-MOD-APPROVED supersession of the two ORCH-1145 source-pins (update the regexes to the new `venueCount>0 || legacy` gate shape and the `useVenueListings` layout read), OR orchestrator-documented acceptance of the supersession. This is a legitimate test update, NOT product-code rework. (Tester is append-only — cannot perform it here.)
- **Retest:** `npx jest venueTab.contract` → 12/12 green on the branch.

### P2-1 — `VenueListingContent` remains mounted NOWHERE (pre-existing, carried)
- **Evidence:** Leg B Discovery #1; the 1148 suite relocation orphaned it. Leg B restores reachability via the new per-venue page banner (D-B6) but the component itself is unmounted. **Impact:** dead source + the ORCH-1040 pins on it are load-bearing for the venueTab T-9 failure on main. **Fix:** decide mount-or-delete in a follow-on. Discovery, not this ORCH's fix.

### P2-2 — `venue_public_view` is thin for DESIGN §6 (pitch / price-tiers / rich gallery hidden)
- **Evidence:** Leg C C5/C9 + Discovery #3. The M4 view exposes no `generative_summary` pitch, no `price_tiers`, no `business_gallery_urls`; DESIGN §6.3/§6.6 elements render hidden (data-absent rule). **Impact:** venue page is functional but visually thinner than the design intends. **Fix:** additive `CREATE OR REPLACE` view widening (follow-on).

### P2-3 — No anon-web guest reserve flow; venue-page CTA is an app-handoff `[TRANSITIONAL]`
- **Evidence:** Leg C C4 + Discovery #4. `venue-reservation-create` emits `/reserve/{brandId}/…` success URLs but no such page exists. The public venue reserve CTA routes to `https://usemingla.com` (store links). **Impact:** anon web can't actually book on-page (by design v1); non-reservable venues correctly get NO bar (fail-closed, verified in source). **Fix:** buyer-web guest reserve ORCH.

### P2-4 — Leg B report over-claim ("166/166 pinned suites green")
- **Evidence:** contradicted by P1-1. **Impact:** erodes trust in the report's green claims; masked a red CI suite. **Fix:** correct the report at rework; orchestrator should treat "all green" claims as tester-verified only.

### P3-1 — Creator-sheet a11y copy on non-hub mounts still says "Create event, experience, or trip"
- **Evidence:** Leg B Discovery #4 (`home.tsx`/marketing/account mounts, DO-NOT-TOUCH here). Cosmetic follow-on.

### P4-1 (praise) — Cross-brand splice defense is genuinely airtight
- The `_orch1255_venue_belongs_to_brand` trigger is attached to all **11** `(brand_id, venue_id)` tables (verified via `pg_trigger`), and my live splice attempt (brand-X ops row → brand-Y venue) raised `venue_brand_mismatch` exactly as specified. RLS-alone could not see this; the trigger closes it. Clean defense-in-depth.

### P4-2 (praise) — Edge [TRANSITIONAL-1] shim + fail-close discipline
- `venue-reservation-create` returns precise 409s (`venue_ambiguous` / `venue_not_reservable`) and every admin/pipeline/email fn fail-closes to 401 for anon. `claim_status` CHECK constraint correctly rejected my invalid `'draft'` fixture value. Fail-closed by construction.

---

## 4. Step 0.5 — independent re-run of implementor fails-on-revert proofs

**Leg A — gate `orch-1255-pipeline-no-brand-onconflict.mjs` (proof commit `bbb7e558f`):** I edited `run-business-place-authoring-pipeline/index.ts` `onConflict:"venue_id"` → `"brand_id"` → gate FAILED (2 findings, "R-1 venue-clobber bug is back"); `git checkout` restore → gate PASSED. ✔

**Leg B — suite `metaOrch1255LegB.happy.test.ts` (proof commit `071deaa6c`):** TRUE line-deletion of the `venue` ROOT_OPTIONS entry (`UniversalCreatorSheet.tsx`) + the `venueCount` arm (`useHubTabs.ts`) → `Tests: 3 failed, 7 passed` (the exact T-B1/T-B1-siblings/T-B2 assertions); `git checkout` restore → `10 passed`. ✔

**Leg C — suite `metaOrch1255LegC.happy.test.ts` (proof commit `0f3ac08e9`):** (a) moved away `app/b/[brandSlug]/v/[venueSlug].tsx` → suite fails ENOENT on the route contract; restored → 12/12. (b) deleted `p_venue_id: venueId` from the pricing rpc call in `venue-reservation-create/index.ts` → the D-B seam test FAILED (`✕ D-B: venue-reservation-create resolves pricing venue-scoped`); `git checkout` restore → 12/12. ✔

All three implementor happy-path artifacts re-verified independently at the cited hashes.

---

## 5. Adversarial test added (tester-owned)

**Path:** `mingla-business/__tests__/metaOrch1255.tester.adversarial.test.ts` — committed `ef8cb3a06` — **21 tests, all green.** In the closing diff (`git diff origin/main...HEAD --name-only` ✔), append-only (new file).

Angles the implementors did NOT cover: A1 listingStatus admin-decision **precedence** (suspended/revoked/rejected-beats-deck_eligible/verified-beats-needs_fix — a wrong order would show "Live" on a suspended venue); A2 todo-band **negatives** (add_venue unreachable under the live-hook shape even with hostile legacy flags; deck_eligible → no row; follow_up openCount 0 → no escalation/badge); A3 draft-store **reset scoping** (reset(brandA) spares parked brandB; reset() wipes all; round-trip preserves data); A4 anon read **isolation** (queries ONLY `venue_public_view`, never `venue_listings`/`brands`; view-miss→null not-found; PostgREST error→throws not silent-empty; malformed hours jsonb cannot crash the mapper or fabricate rows); A5 ORCH-1256 `?section=` deep-link **survival** post-toggle-removal (closed set validated, no physical-location target, anchors intact); A6 `[TRANSITIONAL-1]` slots shim seam; A7 per-venue ops write seams (`venue_id` + `venue_required` fail-fast).

**fails-on-revert verified at `ef8cb3a06`** — two TRUE reverts: (1) `multiVenue = input.venuePipelines !== undefined` → `= false` in `businessTodos.ts` → A2 fails; (2) `getPublicVenueBySlug` `.from("venue_public_view")` → `.from("venue_listings")` → A4 fails. Both restored via `git checkout` → 21/21.

---

## 6. Live-fire evidence log (backend / security)

**Schema state (prod, read-only, matches as-built):** `venue_listings` 2 policies, anon SELECT = false; `venue_public_view` anon SELECT = true; pipeline unique = `..._venue_unique` only; `venue_reservation_settings` PK = `venue_id`; `pg_venue_available_slots(p_date, p_party_size, p_venue_id, p_brand_id)`; `resolve_brand_pricing_inputs(p_brand_id, p_venue_id)`; `admin_tweak_venue_claim_fields(p_venue_id, p_patch)`; `venue_intelligence_overview(p_brand_id, p_venue_id)`; `brands admin can read` policy present; `public_menus_view` gated on `venue_listings`; `biz_create_venue_brand_authoring` stub → `venue_creation_moved`; 3 orphans cleaned; 11 tables carry `_orch1255_venue_belongs_to_brand`.

**Anon REST (`https://gqnoajqerqhnvulmnyvv.supabase.co/rest/v1`, anon key):** `venue_listings` → 401 `42501 permission denied`; `venue_public_view` → 200 `[]`.

**Edge (`/functions/v1`):** pipeline fn no-auth → 401; anon-bearer → 401 `UNAUTHORIZED Invalid or expired session`; `admin-review-venue-claim` anon → 401 `Unauthorized`; `venue-claim-decision-email` no-auth → 401 (verify_jwt=true honored); `venue-reservation-create` legacy `brandId` (random, full guest body) → **409 `venue_ambiguous`**; unknown `venueId` → **409 `venue_not_reservable`**. Deployed versions: pipeline v126 (jwt f), admin-review v197 (jwt t), submitted-email v193 (jwt t), decision-email v196 (jwt f in list but config.toml verify_jwt=true and no-auth returns 401 — gateway enforces), reservation-create v51 (jwt f). All updated 2026-06-30/07-02.

**SQL adversarial (prod, rollback-wrapped DO-blocks, `RAISE` aborts → zero commit):** Block 1 `ALL_PASS_ROLLBACK` — SC-1 brands-delta-0, cross-brand splice → `venue_brand_mismatch`, sibling isolation, view verified-only, suspend-drops-from-view, cascade delete of ops rows. Block 2 `ALL_PASS_ROLLBACK` — `biz_create_venue_listing` fails-closed with no auth context, duplicate-place → unique violation. Plus: invalid `claim_status='draft'` rejected by CHECK constraint.

**Local SQL suites (`supabase/migrations/__tests__/*.test.sql`):** NOT runnable in this session — `supabase start` cannot boot main's chain (duplicate historical version prefixes; Leg A/C Discovery #3). Cited: implementor local-proof on a deduped full-chain scratch (Leg A 19/19; Leg C M6 6/6 + Leg A 19/19 re-run). My prod DO-block live-fire independently reproduces the same invariants (splice/sibling/view/cascade/SC-1) against LIVE schema.

---

## 7. Constitution 14-rule matrix (against the diff)

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | PASS (source) | Reserve bar fail-closed (no bar when non-reservable); card tap → `/venue/{id}`. Runtime unconfirmed (F-2). |
| 2 | One owner per truth | PASS | Venue row is the cover truth (D-C: `sync_hero_media` writes venue cols, brand-patch skipped); `brands.place_pool_id` gains no new writers. |
| 3 | No silent failures | PASS | Anon reads throw on error (A4); create RPC fail-closes; edge 409s explicit. |
| 4 | One query key per entity (factory) | PASS | `venueListingKeys`, `venuePublicKeys`, brandId-first venue keys (prefix-invalidation preserved). |
| 5 | Server state stays server-side | PASS | `draftVenueStore` holds a pre-submit DRAFT (client authoring state), not server records; per-brand v2. |
| 6 | Logout clears everything | PASS | `draftVenueStore.reset()` no-arg wipes active + parked (my A3 proves). |
| 7 | `[TRANSITIONAL]` labeled + exit | PASS | TRANSITIONAL-1/2/3 + D-B1/D-B2/D-B3/C1/C4 all carry exit conditions in reports. |
| 8 | Subtract before adding | PASS | Hidden-brand path decommissioned to a stub; toggle + write arms deleted. |
| 9 | No fabricated data | PASS | Card cover = real/placeholder tile (never stock); view maps null→null; A4 malformed-hours → 0 rows, never fabricated. |
| 10 | Currency-aware | PASS | Public menu uses row currency (zero-decimal aware); pricing via derived brand. |
| 11 | One auth instance | N/A | No new auth client. |
| 12 | Validate at right time | PASS | Slug resolved at submit (`resolveAvailableVenueSlug`); DB unique = backstop. |
| 13 | Exclusion consistency | PASS | View WHERE `claim_status='verified'` + `brands.deleted_at IS NULL`; resolvers same join. |
| 14 | Persisted-state startup gate | PASS | draft store `persist` v2; no server snapshots persisted. |

No constitutional violation found.

---

## 8. Device / parity matrix

| Surface | Verdict | Note |
|---|---|---|
| Consumer iOS/Android (`app-mobile`) | BLOCKED (runtime) / edge PASS | Reserve edge venue-keyed live; OTA frozen (COMMS-0051) → rides next build. |
| Buyer/anon Web | BLOCKED (runtime) / anon-safety PASS | Not deployed (pre-CLOSE Vercel). Anon-safety proven via REST + A4. |
| Business iOS | **BLOCKED (runtime)** | SE dev build crashed on load — `Cannot find native module 'ExpoImageManipulator'` (stale ORCH-0974 build). Worktree Metro (port 8088) + latest bundle loaded fine; the installed binary is too old. |
| Business Android | BLOCKED (runtime) | No emulator driven; shared RN → same code as iOS. |
| Business Web preview (Vercel) | BLOCKED (runtime) | pre-CLOSE. |
| Admin Web | BLOCKED (runtime) / source PASS | Not deployed with new queue; source re-point + edge auth verified live. |
| iPhone 17 Pro Max (business) | **BLOCKED (runtime)** | Loaded worktree bundle then fail-closed: `Stripe mode drift — backend live (pk_live) but app built with pk_test` (`stripeModeHandshake` guard). Env-mismatched dev build. |

**Physical iPhone (HITL):** not exercised — the runtime blockers below are dev-build/deploy issues resolvable machine-side (fresh build) or at CLOSE, not physical-device-specific. Operator-unblock ask in §10.

---

## 9. F-2 — Business-UI runtime blocker (detailed)

Both installed business dev clients fail-close BEFORE the JS UI renders, so no business-app runtime SC (SC-6/7/7b/8-render/9-render) could be live-fired:
- **iPhone SE (ORCH-0974 build):** `Uncaught Error: Cannot find native module 'ExpoImageManipulator'` (import chain `TripCreatorWizard → normalizeTripDayImage`). The build predates a native dep added to main — a stale-native-build blocker, unrelated to 1255 (Leg B is pure-JS).
- **iPhone 17 Pro Max build:** `Render Error: Stripe mode drift detected … built with a pk_test_ publishable key` — the `pk_live` production fail-close guard (`I-mingla_business_pk_live_in_production`). Env-mismatched dev build.

I resolved everything I could machine-side (booted both sims, symlinked node_modules confirmed, started worktree Metro on port 8088, loaded the latest bundle, launched both dev clients via deep link + Maestro-tapped "Open"). The remaining blocker requires a **fresh `pk_live` business dev build** (build-time keys are operator-controlled) or Seth's physical device — genuinely needs Seth. This is the standing "biz authed runtime capped" reality (`feedback_biz_web_authed_runtime_unreachable_cap_claims`).

---

## 10. Prod residue attestation

**PROD RESIDUE: NONE.** All my fixtures were rollback-wrapped DO-blocks that terminate in `RAISE EXCEPTION` (aborts the implicit transaction → zero commit); no persisted INSERT/UPDATE/DELETE ran. Verifying SQL (post-testing):
```
SELECT (SELECT count(*) FROM venue_listings) AS venue_listings_rows,
       (SELECT count(*) FROM venue_listings WHERE slug LIKE 'qa1255%' OR slug LIKE 'qadup%' OR slug='qarpcslug') AS qa_venue_residue,
       (SELECT count(*) FROM venue_tables WHERE name IN ('splice','ok-table')) AS qa_ops_residue,
       (SELECT count(*) FROM brand_place_pipeline_state) AS pipeline_rows;
-- → venue_listings_rows=0, qa_venue_residue=0, qa_ops_residue=0, pipeline_rows=0
```
No dedicated QA brand was created (the UI-fixture path was blocked by F-2; the SQL live-fire needed none). The 3 M5 orphan-cleanup rows are the implementor's persisted work (M5 applied), not tester residue. My worktree Metro (port 8088) was killed by PID (never global pkill; no other session's port/device touched).

---

## 11. Discoveries for Orchestrator

1. **`venueTab.contract.test.ts` (ORCH-1145) needs TEST-MOD-APPROVED supersession** (P1-1) — its source-pins encode the pre-D-5 hub gate; update the 2 regexes or document acceptance. Blocks CI green.
2. **Business dev builds are unusable for QA** — SE build missing `ExpoImageManipulator`; Max build is `pk_test` vs `pk_live` backend. A fresh `pk_live` business dev build is a prerequisite for ANY business-app runtime QA (this ORCH's SC-6/7/7b + future).
3. **`VenueListingContent` unmounted** (P2-1) — mount-or-delete decision (its ORCH-1040 pins drive venueTab T-9's main-side failure).
4. **`venue_public_view` widening** (P2-2) for DESIGN §6.3/§6.6 (pitch/price-tiers/gallery).
5. **Anon-web guest reserve flow** (P2-3) — the venue CTA + `venue-reservation-create` web success URLs both need it.
6. `supabase start` cannot boot main's migration chain (duplicate prefixes) — recurring; worth a one-time repair/doc.

---

## 12. Routing

**FAIL → REWORK (lightweight) + CLOSE-time live-fire.** Cited fixes:
- **P1-1 (SC-7 CI):** `mingla-business/app/(tabs)/hub/__tests__/venueTab.contract.test.ts` T-1/T-2/T-3 + layout-flags — TEST-MOD-APPROVED supersession to the D-5 gate shape, or orchestrator-documented acceptance. Retest: `npx jest venueTab.contract` → 12/12.
- **UI/runtime SCs (SC-6/7/7b/11/12/13/14):** require the CLOSE deploy (Vercel + admin + edge already live) + a fresh `pk_live` business dev build; live-fire per SPEC §8.4/§11 (the curls + the anon browser run + the admin approval walk + a persisted-then-cleaned QA-brand fixture). Backend/security/logic need NO rework — proven at `proven`-level.

The regression gate itself is satisfied; the FAIL is the red pinned suite + wholly-unverified UI runtime. Once P1-1 is superseded and CLOSE live-fires the UI, this is a clean PASS candidate.

---
---

# RETEST — Round 2 (orchestrator directive, 2026-07-02)

## R2.1 VERDICT: FAIL — P0: 0 · P1: 1 (NEW, runtime-proven) · P2: 3 · P3: 2 · P4: 3

Round 1's two blockers are RESOLVED: (a) the red pinned suites were superseded under the granted `[TEST-MOD-APPROVED META-ORCH-1255]` (two commits, see R2.2) and the full affected sweep is now **16 suites / 190 tests GREEN**; (b) the sim runtime path was resolved per the ORCH-1256 recipe and **every UI SC was live-fired this session**. The remaining FAIL is a single NEW, runtime-proven product defect:

**P1-NEW — venue slug availability still checks the `brands` table; a same-name second venue in one brand hits a contradictory Available/taken dead-end loop.**
- **Evidence (runtime, iPhone 17 Pro Max, worktree Metro, live prod):** created "QA Test Bistro One" (slug `qatestbistroone`) under the QA brand; started a third venue with the SAME name → the slug step showed `business.usemingla.com/b/qatestbistroone` "✓ Available — auto-selected" (`P1_dup_slug_shown_available.png`); Submit → bounced back to the slug step showing BOTH "✓ Available — auto-selected" (green) and "This URL slug is taken. Go back to Name and adjust it." (red) for the same slug (`P1_dup_slug_available_and_taken_contradiction.png`). Re-submitting reproduces forever (the resolver re-approves the same slug). DB backstop held: venue count stayed 2, zero phantom rows.
- **Root cause (source):** `mingla-business/src/services/brandsService.ts` — `checkVenueSlugAvailable()` (line ~143) queries `.from("brands").eq("slug",…)`, and `resolveAvailableVenueSlug()` / `suggestVenueSlugs()` build on it. Post-1255 venue slug truth is `venue_listings UNIQUE (brand_id, slug)` (M1). The checker was not re-keyed by Leg B (it sits in `brandsService.ts`, outside the Leg B allowlist — a spec gap, not implementor negligence).
- **Impact:** any operator naming a second venue the same as an existing venue of their brand (chains: "Joe's Cafe" ×2 locations differ by address, not name) is stuck in a contradictory loop; escape requires guessing that the NAME must change. Misleading UX + broken "GUARANTEED available" resolver contract.
- **Required fix:** re-key `checkVenueSlugAvailable` to `venue_listings` scoped `(brand_id, slug)` (needs the brandId param — plumb from the wizard), fix `suggestVenueSlugs`/`resolveAvailableVenueSlug` accordingly; ALSO fix the step-2 preview URL (P2-R2-1). One service + one component touch.
- **Retest:** same-name venue #2 in one brand → suggestions skip the taken slug (offer `…1`), submit succeeds, no loop.

### New P2/P3 findings (runtime walk)
- **P2-R2-1 — wizard step-2 public-page preview shows the pre-1255 URL shape** `business.usemingla.com/b/{venueSlug}` — the real page is `/b/{brandSlug}/v/{venueSlug}`. The operator is promised a URL that will 404/miss. Fix together with P1-NEW (same screen).
- **P2-R2-2 — deck-readiness screen has no skip/exit.** After venue creation the operator lands on "Get recommended on Mingla" whose ONLY exit is completing tier-2 (cover + 5 photos + website + price → "Recommend me to users"); no Done/X/skip — I had to kill the app to leave. The venue IS already created, so this is an operator trap, not data loss. Needs a UX decision (skip affordance or nav chrome).
- **P3-R2-1 — `Unknown icon name "location-outline"` warnings** (Metro log, deck-readiness path) — a fallback square renders somewhere in that flow.
- **P3-R2-2 — SC-7b nuance:** on the SE the 4th row's second subtitle line sits below the fold of the clamped sheet; a small in-sheet scroll reveals it (clamp+scroll per DESIGN §2.2 — compliant, but the "renders fully without interaction" reading is not met; screenshots both states).
- **P4-R2-1 (praise)** — admin feedback RPC input validation is strict and precise (`items_required`, `invalid_category`, `note_required` all raised on malformed payloads).
- **P4-R2-2 (praise)** — the per-venue claim loop (banner → sheet → per-item Mark fixed → progress bar → Re-submit) is complete and venue-scoped end-to-end at runtime.
- **P4-R2-3 (env)** — the pk_test crash from round 1 was a Metro env gotcha (dev Metro must run with `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_… MINGLA_STRIPE_MODE=live`), exactly as TEST_ORCH-1256 documented; memory `project_mingla_stripe_test_mode_alignment` ("Stripe TEST mode end-to-end") is stale, confirming 1256's D-3.

## R2.2 Order 1 — pinned-suite supersessions (TEST-MOD-APPROVED)

1. `mingla-business/app/(tabs)/hub/__tests__/venueTab.contract.test.ts` — the two ORCH-1145 source-pins updated to the D-5 contract (`venueCount>0` gate regex; `useVenueListings` layout read); inline notes follow the file's own `[TEST-MOD-APPROVED ORCH-1148]` precedent. Commit `ad9261070` (token in body). Now **12/12**.
2. **Second same-class red pin discovered:** `src/components/brand/__tests__/brandEditView.section.orch1256.test.ts` pinned the PHYSICAL LOCATION block "intact" — the block SPEC §D-5 deletes (the pin even names META-ORCH-1255; SPEC §8's merge-order note predicted the anchor dying). Inverted to assert full deletion; re-introduction stays CI-gated by `orch-1255-brandedit-no-physical-location-toggle.mjs`. Commit `6a0be62` (token in body). Now **12/12**.
- Append-only gate: `node .github/scripts/test-append-only-check.js` → **11 passed, 0 failed** (both MODIFIED rows show the override token).
- Full affected sweep after both: `orch1256 businessTodos venueTab.contract useHubTabs metaOrch1255 brandPatch listing.orch_1040 orch1186Hours deckReadinessRoutes venueClaimService` → **16 suites, 190 tests, ALL GREEN**.

## R2.3 Order 2 — sim path resolution (per the 1256 recipe)

Root-caused both round-1 "crashes": Max = missing `pk_live` Metro env (handshake guard fired correctly — env gotcha, not a build defect); SE = genuinely stale ORCH-0974 build (missing `ExpoImageManipulator`), fixed by installing the Max's current MinglaBusiness.app bundle onto the SE (`simctl install`). Worktree required a real `npm ci` (symlink → Metro lazy-import breakage, 1256 P4-2 reconfirmed). Metro on tester-owned port 8088 (verified free; killed by PID at the end). pk_live obtained from the deployed production web bundle (publishable key — public by design). Login: fresh disposable QA account `orch1255qa@web-library.net` (mail.tm API inbox) via the email-OTP flow; account deleted at cleanup. Driving: Maestro for text/rows + idb HID taps for kit Buttons (1256 P4-1 reconfirmed).

## R2.4 Order 3 — runtime SC results (all live-fired, screenshots in `Mingla_Artifacts/evidence/META-ORCH-1255/`)

| SC | Round-2 verdict | Evidence |
|----|-----------------|----------|
| SC-6 (4 options; wizard creates under CURRENT brand; NO brand switch) | **PASS (proven)** | `SC6_creator_sheet_4rows_promax.png`; venue #1+#2 created under "ORCH-1255 QA 0702"; header brand unchanged after both; DB: 2 venue rows, 2 pipeline rows, `hidden_brand_check=0` |
| SC-7 (tab iff ≥1 venue; card list; chips; push /venue/{id}; back) | **PASS (proven)** | Venue tab appeared after venue #1 (absent at 0 venues); `SC7_hub_venue_cardlist_inreview.png` ("In review" chip, cover fallback, address); tap → per-venue page (`SC7_per_venue_page_header_chip.png`); ‹Hub back returns to list |
| SC-7b (SE-class fit) | **PASS (proven, with P3-R2-2 note)** | `SC7b_creator_sheet_SE_fit.png` + `…_scrolled_full_venue_row.png` — clamp active, scrim + tab bar visible, all 4 rows reachable/tappable, subtitle ellipsized at 2 lines |
| SC-8 (toggle gone; ?section= intact) | **PASS (proven)** | Deep link `…/edit?section=contact` scrolled straight to CONTACT; CONTACT→SOCIAL→DISPLAY with NO physical-location block (`SC8_brandedit_section_contact_no_toggle.png`) |
| SC-9 (per-venue todos) | **PASS (proven)** | 0 venues → no venue rows (`SC9_home_todos_1venue.png` pre-state); 1 venue → singular copy; 2 venues → NAMED rows "Get QA Test Bistro One live" / "Get QA Test Loft Two live" / "Updates requested — QA Test Loft Two" + "2 to fix" badge |
| SC-10 (per-brand drafts) | PASS (unit + runtime corollary: draft cleared after submit; fresh wizard for venue #2) | A3 tests + wizard #2 opening clean |
| SC-11 (anon venue page; pending → not-found no leak) | **PASS (proven, local web vs LIVE prod)** | `SC11_anon_venue1_verified_web.png` (VERIFIED VENUE + name + reserve bar); pending URL → "This venue isn't on Mingla yet" + brand backlink; DOM grep: zero venue-2 data leaked (`SC11_anon_venue2_notfound_web.png`) |
| SC-12 (Locations lists verified only) | **PASS (proven)** | DOM: `LOCATIONS` + `aria-label="Open QA Test Bistro One"`; "Loft Two" ABSENT (pending filtered); `SC12_brand_locations_web.png` |
| SC-13 (per-venue approval walk, D-4) | **PASS at the RPC layer + full UI state proof; admin-web pixel walk BLOCKED (2FA)** | As impersonated admin (house SQL-claims pattern, `is_admin_user()=true`): bundle venue-keyed ("{venue}+{brand}" data); `mark_called`→`approve` venue #1 → **"Live on Mingla"** chip (`SC13_venue1_live_chip.png`) while venue #2 stayed pending (sibling isolation); `admin_add_venue_claim_feedback` on #2 → "In review + 2 to fix" card/banner (`SC13_venue2_needsfixes_isolation.png`, `SC13_cards_live_vs_needsfixes.png`); feedback sheet → Mark fixed ×2 → Re-submit → follow_up CLEARED, items `fixed` 2/2, back to `pending_review` (`SC13_venue2_feedback_sheet.png`). NOT exercised: the admin-review edge fn's approve side-effects (`runApproveGoLive`/email stamp/push) — needs an admin JWT; the only active admin is Seth's password+OTP account and NO admin test credentials exist in the repo/docs/`admin_users` (searched). Residual for CLOSE. |
| SC-14 (consumer reserve venue-keyed; per-venue split) | **PASS (live-fire)** | Anon REST: `pg_venue_reservable_for_place(place#1)` → `reservable:true, venue_id=<venue1>`; `pg_venue_available_slots(p_venue_id)` → REAL slot grid (engine end-to-end through table+settings+hours-derived periods); legacy `p_brand_id` on the 2-venue brand → `[]` (TRANSITIONAL-1 fail-soft); full anon guest reservation → `free_completed`, row `confirmed` keyed venue #1; venue #2 reservations = 0 (ops isolation in data). Consumer-app UI: N/A this session (OTA frozen; binary rides next build). |
| Ops isolation UI+DB | **PASS (proven)** | Venue #1: reservations ON + table "T1-Alpha · Active" (DB: settings+table rows keyed venue #1); venue #2 page simultaneously: "Turn on Reservations" CTA (OFF), no Tables/Availability pills; reservation exists only under venue #1 |
| Regression: creator sheet siblings | PASS | 4-row sheet shows event/experience/trip unchanged (screenshot); T-B1 sibling test green |
| ORCH-1256 band-6 | PASS | `orch1256` suites green post-supersession (incl. runtime: "Add a cover" todo → Edit brand; profile rows present on the QA brand) |

## R2.5 Fixture ledger + cleanup attestation (round 2)

Fixtures created (all under the disposable QA account `orch1255qa@web-library.net`): brand `ORCH-1255 QA 0702` (`d2c416ab-…`), venues `qatestbistroone` (`57ed9603-…`, walked to verified) + `qatestlofttwo` (`ba6a75d5-…`, needs-fixes→resubmitted), 1 table, reservation settings, 1 guest reservation, 2 feedback items, 2 authored place_pool rows. Verified-exposure window: venue #1 was publicly verified ~12:00→12:02 (used for the anon web proofs); its place was NEVER servable (approve ran at the RPC layer; no deck exposure).

Cleanup (every statement documented):
1. UI Danger Zone: Delete brand (type-to-confirm) → `brands.deleted_at` set; `venue_public_view` for the brand → 0 rows (public exposure closed).
2. `UPDATE place_pool SET deleted_at=now(), deleted_reason='META-ORCH-1255 tester QA fixture cleanup', is_claimed=false, claimed_by=NULL, is_servable=false, is_active=false WHERE id IN ('6bdbac4e-…','709f06a0-…');`
3. `DELETE FROM brands WHERE id='d2c416ab-…' AND name='ORCH-1255 QA 0702';` (FK CASCADE)
4. `DELETE FROM auth.users WHERE email='orch1255qa@web-library.net';`

**PROD RESIDUE: NONE.** Verifying SQL returned all zeros: brand_rows=0, venue_rows=0, pipeline_rows=0, settings_rows=0, table_rows=0, reservation_rows=0, feedback_rows=0, hours_rows=0, live_places=0, **venue_listings_total=0 (global)**, qa_auth_residue=0. (The 3 `orch-1255:%` M5 orphan rows are the implementor's applied migration work, not tester residue.) Tester Metro (port 8088) killed by PID; SE sim shut down; no other session's ports/devices touched.

## R2.6 Round-2 routing

**FAIL → REWORK (one targeted fix):** P1-NEW slug-availability re-key (`brandsService.ts` checkVenueSlugAvailable/suggestVenueSlugs/resolveAvailableVenueSlug → `venue_listings (brand_id, slug)`) + P2-R2-1 preview-URL fix in `VenueStep2NameSlug`. P2-R2-2 (deck-readiness exit) needs a Seth UX decision — recommend a "Do this later" affordance. Everything else in the META is runtime-proven working; after the slug fix + retest this is a PASS. Residual for CLOSE (not rework): admin-web pixel walk + admin-edge approve side-effects need an admin login (2FA) — a 2-minute Seth HITL, or CLOSE live-fire per SPEC §11.

---
---

# RETEST — Round 3 (targeted: round-2 P1 slug fix, 2026-07-02)

## R3.1 FINAL VERDICT (whole META): **CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 1 (accepted residual) · P3: 2 · P4: 1

The round-2 P1 (venue slug availability keyed to `brands` → same-name second venue looped Available/taken forever) is **DEAD at runtime, proven on the sim against live prod**, and the P2-R2-1 preview-URL fix rode along. Everything else in the META was proven in rounds 1–2 (backend/security/logic at `proven` via SQL+REST+edge live-fire; every UI SC live-fired in round 2). Two precisely-stated residuals remain — both pre-accepted in the round-3 dispatch — hence CONDITIONAL, not clean PASS.

**Fix under test:** `3cc6090b7` (checkVenueSlugAvailable / suggestVenueSlugs / resolveAvailableVenueSlug re-keyed to `venue_listings (brand_id, slug)`; wizard threads `currentBrand.id`; step-2 preview = `/b/{brandSlug}/v/{venueSlug}`; new suite `venueSlugPerBrand.metaOrch1255R.test.ts`) + `f0332f1a6` (REWORK report section).

## R3.2 Task 1 — runtime kill (iPhone 17 Pro Max sim, worktree Metro :8088 w/ pk_live env, LIVE prod)

Fresh disposable QA account `orch1255r3qa@web-library.net` (mail.tm OTP), fresh brand **ORCH-1255 R3 QA** (`orch1255r3qa`), per the round-2 recipe (real `npm ci` node_modules already in worktree; Maestro text + idb HID taps; latest bundle loaded — relaunch after Metro attach observed "Downloading 100%").

| Step | Round-2 behavior | Round-3 observed | Evidence |
|---|---|---|---|
| Venue #1 "QA Same Name Cafe" step-2 | preview showed pre-1255 `/b/{venueSlug}` | preview `business.usemingla.com/b/orch1255r3qa/v/qasamenamecafe` ✓ Available — auto-selected | `R3_venue1_step2_preview_brand_v_slug.png` |
| Venue #1 submit | n/a | clean → deck-readiness screen; home todo "Get your venue live" (singular) | `R3_home_todos_1venue.png` |
| Venue #2, SAME name, step-2 (the screen that looped) | "Available" then "taken" contradiction forever | **auto-advanced to `qasamenamecafe1`** ✓ Available — auto-selected, preview `/b/orch1255r3qa/v/qasamenamecafe1` | `R3_P1FIX_venue2_samename_suffixed_slug_available.png` |
| Venue #2 review + submit | bounced back to slug step | review shows SLUG `qasamenamecafe1`; **submit clean, no bounce, no loop** → post-create screen | `R3_venue2_review_suffixed_slug.png`, `R3_venue2_submit_clean_no_loop.png` |
| DB truth | 2 phantom-free rows | 2 rows under ONE brand: `qasamenamecafe` + `qasamenamecafe1`, both `pending_review`, names identical | live SQL (brand join) |

Bonus path exercised: the directory-dedup interstitial correctly surfaced venue #1 as a match for the same-name entry; "No, different business" proceeded to a fresh listing (the chain scenario end-to-end).

## R3.3 Task 2 — cross-brand DB layer (prod, rollback-wrapped DO block)

`ALL_PASS_ROLLBACK` raised (transaction aborted → zero commit): same slug `joescafe` under a **different** brand INSERTs fine (per-brand uniqueness); same-brand duplicate rejected by `unique_violation` (`venue_listings_brand_slug_uniq` backstop); suffixed `joescafe1` under the same brand fine; brands delta exactly the 2 fixtures. Service layer cross-brand half also pinned by the new suite ("DIFFERENT brand + same slug → AVAILABLE", "resolver keeps preferred when only ANOTHER brand holds it") — green.

## R3.4 Task 3 — regression sweep on the rebased branch (contains origin/main @ 710164431)

- **14 suites / 184 tests ALL GREEN** in one run: `venueSlugPerBrand.metaOrch1255R` (9) · `metaOrch1255.tester.adversarial` (21) · `metaOrch1255LegB.happy` · `metaOrch1255LegC.happy` · superseded pins `venueTab.contract` (12/12) + `brandEditView.section.orch1256` (12/12) · pre-existing slug suites `resolveAvailableVenueSlug` + `venueSlugAvailability` · `useHubTabs.venueGate.adversarial` + `useHubTabs.draftsCount` · `businessTodos` ×3 · `businessTodos.profile.orch1256.tester`.
- Old slug suites verified NON-vacuous post-re-key: their chain mock keys availability off the final `.eq` arg (slug) — behavioral assertions still bind (the fix deliberately ordered `brand_id` eq first).
- **All 5 orch-1255 strict-grep gates GREEN** (brandedit-no-physical-location-toggle · no-hidden-brand-on-venue-create · pipeline-no-brand-onconflict · public-venue-anon-safe · venue-approval-per-venue-row).
- **Fails-on-revert independently re-verified at `3cc6090b7`:** true-reverted the service query (`venue_listings` scoped chain → the old `.from("brands")` block) → `venueSlugPerBrand` failed 4/9 (SAME-brand-taken, resolver-suffix, suggestions-skip, table-target assertions — exactly the fix's surface); `git checkout` restore → 9/9. Preview-URL pins (3) stayed green through the service revert, correctly isolating the two halves of the fix.
- **Append-only gate:** currently RED at the pre-round-3 HEAD `f0332f1a6` (docs-only commit dropped the `[TEST-MOD-APPROVED …]` token the gate reads from the branch-tip commit body; the two approved supersessions therefore flag). Carried `[TEST-MOD-APPROVED META-ORCH-1255]` in THIS round-3 commit body → gate 12 passed / 0 failed at the new HEAD (verified post-commit). Finding P3-R3-1 below.

## R3.5 Tasks 4 — fixtures + attestation

Fixture ledger (all round-3): auth user `orch1255r3qa@web-library.net`, brand `ORCH-1255 R3 QA` (`4e2b2a31-…`), venues `qasamenamecafe` + `qasamenamecafe1` (both stayed `pending_review` — **never verified → zero public exposure**, view verified-only proven in R1/R2), 2 pipeline rows, 2 authored place_pool rows (`is_servable=false` throughout — never consumer-servable).

Cleanup (single transaction): place_pool ×2 soft-deleted (`deleted_reason='META-ORCH-1255 tester R3 QA fixture cleanup'`, unclaimed, inactive) → `DELETE brands` (FK cascade took venues/pipeline) → `DELETE auth.users`. **PROD RESIDUE: NONE** — verifying SQL returned all zeros: qa_brand_residue=0, **venue_listings_total=0 (global)**, pipeline_rows=0, qa_auth_residue=0 (both R2+R3 emails), live_qa_places=0, venue_public_view rows=0. Rollback DO-block (R3.3) committed nothing by construction. Tester Metro :8088 killed by PID (port verified free before start); Max sim was already booted on arrival and left booted; no other session's ports/devices touched; no deploy/merge/eas performed.

## R3.6 Findings

- **P2-R3-1 (accepted residual, carried from R2)** — deck-readiness screen still has no skip/exit after venue create (had to relaunch the app between venue #1 and #2, same as round 2). Pre-accepted in the dispatch: separate ORCH pending Seth's UX call.
- **P3-R3-1 (process)** — the append-only gate reads the override token from the branch-TIP commit body, so any token-less commit (like docs-only `f0332f1a6`) turns the branch red while the approved supersessions exist. Self-healed by this commit; for CLOSE, the squash-merge PR body/commit must carry `[TEST-MOD-APPROVED META-ORCH-1255]` or the gate re-reds on main. Worth a gate improvement note (token-in-any-branch-commit, not tip-only).
- **P3-R3-2 (carried)** — P3-R2-1 `location-outline` icon warning not re-audited this round (deck-readiness flow only entered, not exercised).
- **P4-R3-1 (praise)** — the resolver+preview split is cleanly testable: the service revert failed exactly the 4 service-layer tests while the 3 preview pins held; auto-advance UX ("Available — auto-selected" on the suffix, no error state shown to the operator) is the right "smart" behavior.

## R3.7 Accepted conditions (the CONDITIONAL in the verdict)

1. **Admin-web pixel walk + admin-edge approve side-effects** (`runApproveGoLive`/email stamp/push): requires Seth's 2FA admin account — the only active admin; no admin test credentials exist (R2 searched repo/docs/`admin_users`). RPC-layer approve walk + full UI state machine already proven in R2 (SC-13). → CLOSE-time live-fire or a 2-minute Seth HITL.
2. **Deck-readiness no-exit trap (P2-R2-2/P2-R3-1)**: separate ORCH pending Seth's UX decision (recommend a "Do this later" affordance).
Consumer-app venue-keyed reserve UI additionally rides the next binary (OTA frozen, COMMS-0051) — edge+REST layer already proven live (SC-14).

## R3.8 Routing

**CONDITIONAL PASS → CLOSE** (conditions above are dispatch-accepted). CLOSE checklist: squash-merge commit/PR body MUST carry `[TEST-MOD-APPROVED META-ORCH-1255]` (P3-R3-1); Vercel deploy rides the normal `[deploy]` gate; the two residuals route to their own follow-ups.
