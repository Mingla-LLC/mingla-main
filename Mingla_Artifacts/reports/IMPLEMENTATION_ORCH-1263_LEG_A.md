# IMPLEMENTATION — ORCH-1263 [claim-adoption] LEG A (server) + Leg C server test groups

- **Phase:** IMPLEMENT (Leg A only — server; plus Leg C's server-side tests/gates)
- **Date:** 2026-07-02 · **Branch:** `orch-1263-claim-adoption` · **Worktree:** `~/Desktop/mingla-orchs/orch-1263-[claim-adoption]/`
- **Binding contract:** `Mingla_Artifacts/specs/SPEC_ORCH-1263_CLAIM_ADOPTION.md` v2 (commit `338e2fca0`) §Leg A + server rows of §Leg C
- **Status label:** implemented and verified at the DB + unit layer (SQL suites live-fired on a full local prod-chain Postgres; edge fns `deno check` green + 75/75 Deno tests; NO live edge invocation from this session — live-fire at CLOSE per §11)
- **Rebased on** `origin/main` before work (Pre-Flight step 1). NO prod writes, NO deploys, NO migration applies, NO client code.

## 1. Summary (plain English)

Claiming a seeded venue no longer damages the live listing before an admin ever looks at it. The three pre-approval hazards are dead on the server: submitting the claim wizard no longer overwrites the live deck's opening hours, picking a hero cover no longer wipes the seeded photo gallery to a single image, and the operator no longer gets raw ownership over the live place at submit. Everything the operator authors is STAGED; it lands on the live place in one archived, reversible patch only when an admin approves. The claim search now tells the app up-front whether a place is available / pending / already claimed and which facts we hold (hours/phone/website/rating-presence/photo count), and a new locked-down single-place RPC returns the full adoption payload only when an operator explicitly says "Yes, this is me."

## 2. SPEC success-criteria coverage (server-side halves only — Leg B + tester own the rest)

| SC | Server-side obligation | Status | Evidence | Commit |
|---|---|---|---|---|
| SC-1 (server) | `claim_state` correct for verified / pending(incl. rejected) / none | ✓ live-proven | SQL T-D1a–d PASS on local prod chain | `90a70c8d0` |
| SC-2 (server) | detail fetched only on YES; zero server writes on fetch (`STABLE`, pure read) | ✓ live-proven | T-D2g (`provolatile='s'`) + T-E2 guards | `90a70c8d0`, `12b6e10e7` |
| SC-4 (server) | overnight hours round-trip (`businessHoursToGoogle` already emits close.day+1) | ✓ tested | T-C1 overnight period assert (DO-NOT-TOUCH file unchanged) | `c254a5fdc` |
| SC-6 | tier-1 claim writes staging keys ONLY; serving columns + ownership byte-identical | ✓ tested | T-A1 exact key-set + G-1(d) + fails-on-revert | `1a3d0c856` |
| SC-7 | hero/tier-2/confirm stage-mode payload key-sets EXACT per §A3.1–A3.4 | ✓ tested | T-A3/T-A5/T-A6 exact key-sets | `1a3d0c856` |
| SC-8 (server) | approve applies authored patch + archive FIRST, then re-bounce/scoring; failure blocks go-live | ✓ tested | T-C3a/b ordering + fail-close | `6adb1f8a6` |
| SC-9 | apply-mode hero ⊇ gallery ∪ {hero}; clear never empties non-empty set | ✓ tested | T-A4 pure law + T-A3 apply arm + G-1(b)(c) | `1a3d0c856` |
| SC-11 | no forbidden key in either response; detail zero-rows for claimed/pending/inactive; search booleans/counts only | ✓ live-proven | T-D1e/T-D2a–f (SQL, live) + T-E1 (mappers) | `90a70c8d0`, `12b6e10e7` |
| SC-12 (server) | create-from-scratch writes unchanged; pinned suites green untouched | ✓ | 24/24 pipeline + 32/32 admin pre-existing tests pass UNMODIFIED | all |
| SC-3 / SC-5 / SC-10 / SC-13 | client behavior | Leg B | `venueCategoryConfident` server-computed & shipped for SC-3 | `9dd26e258` |

## 3. Files changed (all commits prefixed `ORCH-1263(A):`)

| File | Δ | Commit |
|---|---|---|
| `supabase/migrations/20261202000000_orch_1263_claim_adoption.sql` (new) | +239 | `90a70c8d0` |
| `supabase/migrations/__tests__/orch_1263_claim_adoption.test.sql` (new) | +233 | `90a70c8d0` |
| `supabase/functions/_shared/authoredApply.ts` (new) | +237 | `9dd26e258` |
| `supabase/functions/_shared/poolMatchResponse.ts` | 90 → 258 | `9dd26e258` |
| `supabase/functions/_shared/mapMinglaSlugToVenueCategory.ts` (ADDITIVE only) | +25 | `9dd26e258` |
| `supabase/functions/run-business-place-authoring-pipeline/index.ts` | ~+180/−60 | `1a3d0c856` |
| `supabase/functions/admin-review-venue-claim/index.ts` | ~+150 | `6adb1f8a6` |
| `supabase/functions/claim-search-pool/index.ts` | ~+70 | `12b6e10e7` |
| `supabase/functions/claim-search-pool/__tests__/orch_1263_claim_detail.test.ts` (new) | +268 | `12b6e10e7` |
| `supabase/functions/run-business-place-authoring-pipeline/__tests__/orch_1263_stage_only_claim.test.ts` (new) | +432 | `c254a5fdc` |
| `supabase/functions/_shared/__tests__/authoredApply.test.ts` (new) | +214 | `c254a5fdc` |
| `supabase/functions/admin-review-venue-claim/__tests__/orch_1263_authored_apply_on_approve.test.ts` (new) | +233 | `c254a5fdc` |
| `.github/scripts/strict-grep/orch-1263-claim-stage-only-preapprove.mjs` (new) | +189 | `ce220e4da` |
| `.github/scripts/strict-grep/orch-1263-claim-front-load-and-overnight.mjs` (new) | +196 | `ce220e4da` |
| `.github/workflows/strict-grep-mingla-business.yml` (APPEND 2 jobs only) | +28 | `ce220e4da` |

Prefix re-scan (COMMS-0051, at build time): origin/main max = `20261130000005`; every worktree under `~/Desktop/mingla-orchs/*/supabase/migrations` scanned; zero `202612*` anywhere → spec's `20261202000000` confirmed free and used.

## 4. Data-model changes (migration `20261202000000`)

- **`biz_search_place_pool_for_claim(text,int)`** — `DROP FUNCTION IF EXISTS` (RETURNS TABLE widens) + re-CREATE with the `20260809000000` body verbatim PLUS: `has_hours, has_phone, has_website, has_rating` (booleans), `photo_count` (full count; search `photoUrls` stay capped 6), `claim_state` (`claimed` = verified venue row; `pending` = ANY venue row incl. rejected/needs-fixes; else `available`). WHERE/ordering/escape/`SECURITY DEFINER`/pinned `search_path` preserved byte-for-byte. `rating`/`review_count` VALUES stay banned (T-D1e proargnames probe).
- **NEW `biz_get_place_adoption_detail(uuid)`** — single row: identity + `opening_hours` + FULL `stored_photo_urls` + phone/website/price_tiers/price_level/generative+editorial summaries + the 23 `FACET_COLUMNS`. Body: `WHERE id = $1 AND is_active AND NOT EXISTS(venue_listings row)` — fail-close zero rows. `STABLE SECURITY DEFINER`, pinned path, COMMENT names the whitelist rule + forbidden set.
- **Grants hardening (found by T-D2f live):** Supabase default privileges auto-grant EXECUTE to `anon`/`authenticated` on new functions — `REVOKE FROM PUBLIC` alone left the detail RPC anon-executable on first apply. Both fns now `REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role;`. (A direct authenticated grant would have bypassed the edge fn's shared 10/min bucket.)
- **No other DDL** (§A1.3). `place_pool_business_owner_update` RLS untouched; `claimed_by` now first written at approve, so the operator's direct place-UPDATE grant activates at approve, not submit.

## 5. Edge functions touched (deploy list for CLOSE, from MERGED main)

| Function | Change | verify_jwt to preserve |
|---|---|---|
| `run-business-place-authoring-pipeline` | D-A stage/apply model | **true** (not in config.toml → CLI default) |
| `admin-review-venue-claim` | approve-time authored application | **true** (default) |
| `claim-search-pool` | facts fields + `{place_id}` detail mode | **true** (explicit `[functions.claim-search-pool] verify_jwt = true` in config.toml) |

CORS: all three carry `x-client-info` in Allow-Headers (orch-1205 gate) — pipeline via `_shared/cors.ts`, the other two via local headers; unchanged.

## 6. Regression tests added + fails-on-revert

**New tests (all append-only, all in this branch):** 19 Deno tests across 4 files (T-A1, T-A3–A7 · T-C1–C3 · T-E1×4, T-E2×4) + 1 SQL file carrying the 2 suites (T-D1 a–e, T-D2 a–g). Full-directory results: pipeline 30/30 · admin 35/35 · claim-search `__tests__` 8/8 · authoredApply 2/2. Pinned pre-existing suites pass UNMODIFIED (see §12.2 for one PRE-EXISTING broken pinned file, not touched).

**`fails-on-revert verified at ce220e4da`** — true LINE DELETION of the D-A boundary (restored the pre-1263 tier-1 payload: `is_claimed`/`claimed_by`/`opening_hours:` writes, deleting the §A3.1 stage payload) →
- `T-A1 … FAILED | 5 passed | 1 failed`
- G-1 gate FAILED on 2 arms (`opening_hours: normalizeBusinessHoursForPool appears 2x`, `claim branch writes claimed_by/is_claimed`)
- restore → 30/30 pass + gate passes.

**SQL fails-on-revert (live, local chain):** re-created the pre-1263 12-column search RPC → suite errors `record "r" has no field "has_hours"`; re-applied `20261202000000` → `T-D1 PASS (a–e)` + `T-D2 PASS (a–g)`.

**Gates:** G-1 + G-2 both `--self-test` PASS (GOOD/BAD fixtures, G-1 BAD trips all 4 arms). G-1 passes live. **G-2 is INTENTIONALLY RED on the current tree** — arm (c) catches the real `(o >= c)` predicate still in `venueWizardValidation.ts` + `VenueSettingsModule.tsx` (Leg B fixes both; that red IS the enforcement working; goes green when Leg B lands in this same branch). Arm (a) skips while `ClaimMatchCard.tsx` doesn't exist (missing-file-skip, 1255 gate precedent).

## 7. Old → New receipts

### `supabase/migrations/20261202000000_orch_1263_claim_adoption.sql`
**Before:** search RPC returned 12 identity columns; no way to know claimed-ness or data richness without submitting; no adoption payload existed. **Now:** presence facts + `claim_state` on every search row; new fail-close single-place detail RPC, service_role-only. **Why:** §A1.1/§A1.2, SC-1/SC-11. **Lines:** +239.

### `_shared/authoredApply.ts` (new)
**Before:** authored content reached the live place piecemeal pre-approval (confirm overwrote summary/price/photos/facets; tier-1 overwrote hours); hours/photos/price/summary/facets had NO archive/restore path. **Now:** ONE pure approve-time patch builder from authored truth (venue cover + venue-keyed `brand_hours` + `business_authoring_inputs` + `business_gallery_urls`); omits any key with no authored source (never blanks a live value); archives every pre-application value under `business_claim_diff.archived_google` FIRST-ARCHIVE-WINS; `PRICE_TIER_*`/`priceTiersFromTier2`/`priceLevelFromTiers`/`FACET_COLUMNS` moved here verbatim (one owner), pipeline re-imports + re-exports. **Why:** §A4, SC-8, Raleigh revert §13. **Lines:** +237.

### `run-business-place-authoring-pipeline/index.ts`
**Before:** tier-1 claim wrote `is_claimed/claimed_by/opening_hours` onto the LIVE place at submit (`:575–581`); hero pick wiped `stored_photo_urls` to `[hero]` (`:1662`); confirm published summary/price/photos/facets pre-approval; `get_authoring_context` faked the cover as `stored_photo_urls[0]`. **Now:** exported `placeWriteMode(claimStatus, authorBrandId)`; tier-1 claim payload EXACTLY §A3.1 (staging cols + tier2 seed {website, price_tiers, vibe_chips:[]} + adoption provenance + `business_gallery_urls` cleaned like sync_gallery); confirm stage payload EXACTLY §A3.3; tier-2 stage omits `website`/`is_servable` (§A3.4); hero: stage = video flag only, apply = exported `nextStoredPhotosForHero` (⊇ gallery, never `[]` from non-empty, first-non-gallery-prior = the swapped hero, mirror of `storedPhotosForDeck`); cover truth from the venue row (§A3.5); handlers exported for tests (precedent: `runApproveGoLive`); killed sites carry `I-1263-…` protective comments. Create-new branch byte-unchanged. **Why:** §A3, D-A/D-E, Q-1. **Lines:** ~+180/−60.

### `admin-review-venue-claim/index.ts`
**Before:** approve = review RPC → `runApproveGoLive` over whatever the place happened to hold. **Now:** exported `applyAuthoredContentOnApprove(admin, venueId)` (venue row + brand `account_id` + venue `brand_hours` + place row → `buildAuthoredApplyPatch` → ONE place UPDATE, idempotent) + exported `approveGoLiveWithAuthoredApply` enforcing the binding order: apply AFTER the review RPC, BEFORE `runApproveGoLive` — re-bounce + per-signal scoring run over AUTHORED content; application failure → `authored_apply_failed` 500, go-live NOT attempted. Response adds `authored_applied_keys` receipt. `runApproveGoLive` itself byte-unchanged. **Why:** §A5, SC-8. **Lines:** ~+150.

### `_shared/poolMatchResponse.ts` + `_shared/mapMinglaSlugToVenueCategory.ts` + `claim-search-pool/index.ts`
**Before:** search-only mapper; whitelist enforced only at the serve call site; no confidence signal; no detail mode. **Now:** `PoolMatchRow/Result` grow facts + `claimState` + `venueCategoryConfident` (old-RPC-tolerant defaults false/0/available); NEW `PoolAdoptionDetailRow/Detail` + `rowToAdoptionDetail` (camelCase, 23-facet fold, FULL http(s) gallery, uncapped); BOTH mappers self-assert via `assertNoForbiddenKeys` (top level + facets); ADDITIVE `isConfidentVenueCategory` (confident ⇔ derived slug ∈ {play, creative_arts, brunch_lunch_casual, upscale_fine_dining}); edge fn routes body `{place_id}` → detail mode (same `requireUser` + shared `checkRateLimit` bucket; non-uuid → 400 `invalid_place_id`; zero rows → 404 `place_not_available`; ok → `{detail}`), `{query}` → search unchanged. `FORBIDDEN_RESPONSE_KEYS` untouched. **Why:** §A2, SC-11. **Lines:** +168 / +25 / ~+70.

## 8. Cross-surface impact (Leg A alone)

| Surface | Effect | Parity |
|---|---|---|
| Consumer iOS / Android | none until deploy; post-deploy the deck passively STOPS being corrupted by pre-approval claims (hours/gallery survive) | automatic (server-side) |
| Buyer/anon Web | no-op — `venue_public_view` + verified gates untouched | automatic |
| Business iOS / Android / Web preview | NO behavior change until Leg B (old-fn tolerance keeps the current shipped wizard working against the new RPC shape: extra columns are additive; the edge mapper defaults absent fields) | Leg B |
| Admin Web | approve now applies authored content first (server-side only; admin UI byte-identical) — surfaced via `authored_applied_keys` in the response | manual — edge only |

## 9. Verification — local-proof vs static-only (honest split)

**Proven LIVE (local Postgres `public.ecr.aws/supabase/postgres:17.6.1.106`, container `orch1263-pg`, port 55446, full 302-migration prod chain applied via psql — CI-identical method; storage-api tables shimmed as `supabase_admin` since the bare image lacks them):**
- The full chain INCLUDING `20261202000000` applies clean, and the new migration RE-APPLIES idempotently.
- SQL suites: `T-D1 PASS (a–e)` + `T-D2 PASS (a–g)` (facts, claim_state, fail-close rows, functiondef whitelist, grants, STABLE).
- SQL fails-on-revert drill (§6).
- The T-D2f grants catch → migration hardened (anon/authenticated revoked) → re-proven live.
- The container is LEFT RUNNING for the tester (`docker exec -i orch1263-pg psql -U postgres -d postgres …`); remove with `docker rm -f orch1263-pg` when done.

**Proven at unit level (Deno):** `deno check` green on all 6 touched TS files; 75/75 tests across the four directories (56 pre-existing UNMODIFIED + 19 new); Gemini stubbed via fetch for T-A6 (no network); fake-client key-set assertions at the exact `.update()` boundary; deno fails-on-revert drill (§6).

**Static-only (orchestrator MUST live-fire at CLOSE):** no live edge invocation from this session (no deploys allowed). The three fns need the §11 one-curl verifies after deploy. The 404/`place_not_available` HTTP arm is unit-proven via `detailResponseForRows` + SQL-proven at the RPC layer, but the full authed HTTP path is untested until the CLOSE curls.

**Not run:** `supabase migration list --linked` (worktree not linked; CLI rejects `--project-ref` for this command). Irrelevant to the apply path: per standing rule the migration is applied via Management API from merged main (blind `db push` UNSAFE — `project_migration_history_drift_db_push_unsafe`). No remote probe needed: the migration has no guards/backfills/data predicates — it only (re)creates two functions.

## 10. Deviations from the SPEC (none silent)

- **D1 — SQL test file path:** allowlist said `supabase/migrations/orch_1263_claim_adoption.test.sql`; shipped at `supabase/migrations/__tests__/…` (1255 D8 house pattern — a bare `.sql` in `migrations/` would be EXECUTED by the CI apply-from-baseline job's `ls supabase/migrations/*.sql` glob).
- **D2 — grants hardened beyond spec text:** `REVOKE … FROM anon, authenticated` added on BOTH fns (spec said `REVOKE ALL FROM PUBLIC` + service_role grant; that literal form left the detail RPC anon-executable via Supabase default privileges — live-proven by T-D2f, fixed fail-close).
- **D3 — tier-1 "single-column place read"** widened to 3 columns once (`business_author_brand_id, stored_photo_urls, business_gallery_urls`) in `handleSyncHeroMedia` (one round-trip supplies mode input + apply-mode prior/gallery). Tier-1's claim read adds `business_author_brand_id` per plumbing; `tier1Mode` is computed-and-voided there — the claim branch payload is mode-invariant because G-1 statically bans apply-only keys in that region (spec's own gate).
- **D4 — `nextStoredPhotosForHero` degenerate-clear rule:** when clearing the hero would produce `[]` from a non-empty prior (no gallery, prior = hero only), prior is kept — reconciles §A3.2's "never `[]`" with T-A4's "`[]` only when all empty" (they conflict in exactly this edge).
- **D5 — T-E1 "mappers throw" realized as belt-and-braces:** the mappers construct explicitly (a polluted ROW cannot leak), and each self-asserts its OUTPUT via `assertNoForbiddenKeys` (a future leaking edit throws at runtime); T-E1 proves both the non-leak and that the guard bites.
- **D6 — `approveGoLiveWithAuthoredApply` added** (not named in spec) inside the allowlisted admin file — the exported orchestration seam T-C3 needs to prove "runApproveGoLive NOT invoked" behaviorally.
- **D7 — "true-restaurant-family" bound strictly** to `brunch_lunch_casual` + `upscale_fine_dining` (DESIGN §6.1's wording); `drinks_and_music`/`icebreakers` are mixed buckets → NOT confident. One-line set change if Seth wants bars confident (OQ registered in §12).

## 11. Operator action required — ORDERED apply plan (orchestrator, at CLOSE, from MERGED main)

Do NOT `db push`. Management API against `gqnoajqerqhnvulmnyvv`, then deploy, then curl:

1. **Apply `supabase/migrations/20261202000000_orch_1263_claim_adoption.sql`** (single statement batch is fine; idempotent). Read-backs:
   - `SELECT proargnames FROM pg_proc WHERE oid='public.biz_search_place_pool_for_claim(text,int)'::regprocedure;` → contains `has_hours…claim_state`, NOT `rating`/`review_count` as outputs.
   - `SELECT has_function_privilege('anon','public.biz_get_place_adoption_detail(uuid)','EXECUTE');` → **f**; same for `authenticated` → **f**; `service_role` → **t**.
   - `SELECT provolatile FROM pg_proc WHERE oid='public.biz_get_place_adoption_detail(uuid)'::regprocedure;` → `s`.
2. **Deploy 3 fns** (verify_jwt per §5 — all true): `run-business-place-authoring-pipeline`, `admin-review-venue-claim`, `claim-search-pool`.
3. **Cheapest live curls** (one each):
   - `claim-search-pool` search: `curl -s -X POST "$SUPABASE_URL/functions/v1/claim-search-pool" -H "Authorization: Bearer <user-jwt>" -H "apikey: $ANON" -H "Content-Type: application/json" -d '{"query":"lantern"}'` → matches carry `claimState`/`hasHours`/`photoCount`.
   - detail mode, same fn: `-d '{"place_id":"<any ACTIVE UNCLAIMED place uuid>"}'` → `{detail:{photoUrls:[…full…], facets:{…23…}}}`; then with a claimed/pending id → `404 {"error":"place_not_available"}`.
   - `run-business-place-authoring-pipeline`: `-d '{"action":"get_authoring_context","brand_id":"<b>","venue_id":"<v>"}'` → 200, `cover_media_url` equals the VENUE row's cover (null if none) — proves the Q-1 fix live.
   - `admin-review-venue-claim`: next real approve returns `authored_applied_keys` (non-null array) — no synthetic curl needed pre-launch; or drive the Raleigh script step 7.
4. Business app ships NATIVE BUILD ONLY (COMMS-0052/0063) — nothing here OTAs.

## 12. Known issues / deferred / Discoveries for Orchestrator

1. **G-2 red until Leg B** — arm (c) correctly fails on the still-unfixed `(o >= c)` in `venueWizardValidation.ts` + `VenueSettingsModule.tsx`. Merge order: Leg B must land in this branch before the PR can go green.
2. **PRE-EXISTING broken pinned suite (NOT mine, NOT touched):** `supabase/functions/claim-search-pool/index.test.ts` fails 2/5 on origin/main byte-identical (`clamps limit`→ expects 5, the fetch_all change made p_limit uncapped; `bowling→play` → ORCH-0700 moved bowling_alley to icebreakers→restaurant). Verified by extracting origin/main's files to scratch and re-running. Needs its own ORCH (append-only rules block fixing it here).
3. **Search RPC was already authenticated-executable on prod** (same default-privileges hole as D2, present since `20260809000000`) — bypassing the edge rate-limit was possible for any authed user. The re-CREATE in this migration closes it as a side effect; flagging because other `REVOKE FROM PUBLIC`-only RPCs likely share the pattern (candidate sweep ORCH).
4. **OQ for Seth (D7):** should `drinks_and_music` (bars — 4,211 servable) count as a CONFIDENT "restaurant" for c0 preselect? Currently NO (honest picker). One-line set change.
5. **Local-stack note (echo of 1255 discovery):** bare `supabase/postgres` images lack storage-api tables; the shim in §9 unblocks the full-chain apply. Container `orch1263-pg` (port 55446) left running for the tester.

## 13. Invariant preservation check

I-NO-CLAIM-DEMOTION **strengthened** (stage mode never writes `is_servable` at all) · I-NET-NEW-HOLD ✓ (create-new + apply arms byte-unchanged) · I-PROPOSED-1255-VENUE-APPROVAL-PER-VENUE-ROW ✓ (machine untouched; §A5 is content application) · I-PROPOSED-1255-NO-HIDDEN-BRAND-ON-VENUE-CREATE ✓ (gate re-run green) · I-CLAIM-REBOUNCE-ON-APPROVE ✓ (`runApproveGoLive` byte-identical, still invoked on the same conditions) · I-SCORER-INVOKE-HAS-SIGNAL-ID ✓ · ORCH-1079 googlePlaceId lock ✓ (no client files) · I-CATEGORY-SLUG-CANONICAL ✓ (`derivePoolCategory` untouched). New DRAFT invariants 1–6: server-enforceable arms shipped (T-A*, T-C*, T-D*, T-E*, G-1, G-2); orchestrator flips DRAFT→ACTIVE at CLOSE.
