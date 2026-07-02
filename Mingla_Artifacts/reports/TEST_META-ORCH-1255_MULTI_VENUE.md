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
