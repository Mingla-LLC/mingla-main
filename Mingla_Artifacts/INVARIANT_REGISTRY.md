# Invariant Registry

> Rules that must ALWAYS hold in the Mingla codebase. Every invariant lists
> (a) the rule, (b) the enforcement mechanism, (c) the test that catches a
> regression. When a change breaks one of these, the severity is raised
> and a structural fix is required — not a patch.

---

## ACTIVE (post ORCH-0742 CLOSE 2026-05-06)

### I-PROPOSED-J — ZUSTAND-PERSIST-NO-SERVER-SNAPSHOTS

**Statement:** Persisted Zustand stores in `mingla-business/src/store/*Store.ts` (and any future `app-mobile/src/store/*Store.ts`) MUST NOT hold full server-derived objects (rows returned from Supabase, edge functions, or external APIs). They MAY hold:
- (a) IDs / pointers to server records (canonical pattern: persist the ID, fetch the live record via React Query)
- (b) Pure client UI state (modal open flags, drawer width, current page, ephemeral inputs)
- (c) User preferences (locale, theme, notification settings)

Forbidden: persisting `currentBrand: Brand`, `currentEvent: LiveEvent`, `currentOrder: Order`, `currentAccount: Account`, etc. — anything whose canonical authority is server-side.

**Authority:** `mingla-business/src/store/currentBrandStore.ts` (v14 persist) is the reference implementation post-ORCH-0742. `partialize: (state) => ({ currentBrandId: state.currentBrandId })` returns ID-only. `useCurrentBrand()` is re-exported from `currentBrandStore.ts` but defined in `mingla-business/src/hooks/useCurrentBrand.ts` as a wrapper around `useBrand(currentBrandId)`. The auto-clear `useEffect` at `useCurrentBrand.ts:41-45` clears `currentBrandId` when the server confirms the brand is gone, preventing cold-start replay of phantom selections. Outside-component contexts (Zustand actions, store converters, fire-and-forget submit handlers) use `getBrandFromCache(brandId)` exported from `mingla-business/src/hooks/useBrands.ts:86-101`.

**Rationale:** Pre-ORCH-0742, `currentBrandStore` persisted the full Brand record (`{ id, displayName, slug, kind, address, coverHue, role, stats, currentLiveEvent, ... }`). This produced three observed bug classes: (1) brand renamed on Device A keeps showing old name on Device B until force-quit, (2) brand deleted on Device A keeps appearing as selected on Device B with stale data, (3) cold-starting the app with a since-deleted brand replays the stale snapshot before any network call validates it. ORCH-0738's RC-C established the structural cause. ORCH-0742 Cycle 2 fixed it by removing the snapshot entirely — there is no Brand object left in persisted state to go stale. This invariant codifies the pattern so future maintenance can't accidentally regress.

**Enforcement (current 2 gates + 1 deferred):**
1. **Type-level** — `mingla-business/src/store/currentBrandStore.ts:357` declares `type PersistedState = Pick<CurrentBrandState, "currentBrandId">;`. The persist `PersistOptions<CurrentBrandState, PersistedState>` generic forces the partialize return type. Adding a server-derived field to `PersistedState` requires explicit type widening — visible in code review.
2. **Constitutional gates** — Constitution #5 (server state stays server-side) is the parent rule; this invariant is its concrete codification for persisted Zustand. Constitution #2 (one owner per truth) reinforces: server data has exactly one owner (React Query), client pointer has exactly one owner (Zustand).
3. **Strict-grep CI gate (DEFERRED)** — candidate gate over `partialize:` blocks in any file matching `**/store/*Store.ts` to flag persisted Brand/Event/Order/Account types. Tracked as deferred work — the invariant text codifies the rule; the gate ships in a future cycle when broad enough surface area exists to make it worthwhile (Cycle 4 per-store Zustand classification audit will inform whether the gate is needed or whether the existing TRANSITIONAL stores require carve-outs).

**Test that catches a regression:** any code path that adds a `Brand`, `LiveEvent`, `Order`, or `Account` field (or similar server-row type) to a `partialize` return shape will fail the type check at the persist generic boundary. First runtime symptom of an unguarded regression: cross-device staleness reappears (rename/delete on Device A doesn't reflect on Device B until force-quit). The 5 existing `getBrandFromCache(` callers are pinned by the QA report's grep gate to exactly 5 — adding a 6th caller without going through the helper would trip the gate.

**Established:** 2026-05-06 by ORCH-0742 Phase 2 CLOSE (commit `80c15297`). Memory file `feedback_zustand_persist_no_server_snapshots.md` ACTIVE; MEMORY.md index updated. Predecessor evidence: `Mingla_Artifacts/reports/INVESTIGATION_ORCH_0738_CROSS_DEVICE_SYNC_AUDIT.md` (RC-C). DEC-119 + DEC-120 logged.

**Caveats / fragility:**
- **TRANSITIONAL stores currently exempted:** `events`, `draftEvent`, `liveEvent`, `doorSales`, `scannerInvitations` stores in `mingla-business/src/store/` currently hold full event/order records by design (per ORCH-0739 — these are pre-backend cycles). They are TRANSITIONAL with documented exit conditions. Cycle 4 (queued) audits each against this invariant; until Cycle 4, they are exempted but tracked.
- **Wrapper hook loading window:** the post-ORCH-0742 `useCurrentBrand()` wrapper returns `null` during the React Query fetch window on cold-start (~100ms-1s, network-dependent). This is a UX trade-off, not an invariant violation — the persisted state is correct (just an ID), the network roundtrip just hasn't returned yet. ORCH-0743 (queued) addresses via splash-gate extension OR React Query persistence wiring.
- **Cache miss returns null, not undefined:** `getBrandFromCache` always returns `Brand | null`. Callers use `?? ""` fallback safely. Future helpers added under this invariant should follow the same null-returning pattern.

**Cross-references:**
- DEC-119 (Decision Log) — currentBrandStore architectural rebuild rationale
- DEC-120 (Decision Log) — I-PROPOSED-J activation
- ORCH-0742 SPEC: `Mingla_Artifacts/specs/SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md` (binding contract; I-PROPOSED-J specced as DRAFT in §6.2)
- ORCH-0742 IMPLEMENTATION REPORT: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH_0742_REPORT.md`
- ORCH-0742 QA REPORT: `Mingla_Artifacts/reports/QA_ORCH_0742_PHASE_2_REPORT.md`
- Memory file: `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_zustand_persist_no_server_snapshots.md` (status: ACTIVE)
- ORCH-0743 (queued) — addresses cold-start UX trade-off (loading-window flash); does NOT relax the invariant
- Cycle 4 (queued) — per-store Zustand audit against I-PROPOSED-J for the 5 TRANSITIONAL stores

---

## ACTIVE (post ORCH-0734 CLOSE 2026-05-05)

### I-TRIAL-CITY-RUNS-CANONICAL — Place-intelligence trial pipeline operates city-scoped, sampled-sync via place_intelligence_city_runs

**Statement:** Every place-intelligence trial run MUST scope to a single `city_id` (one of the 9 servable cities) AND use a stratified random sample drawn from `place_pool` rows where `is_servable=true` AND `city_id=:cityId`. Results write to `place_intelligence_city_runs` rows (one per trial). Direct invocation paths bypassing this scoping are violations.

**Authority:** `supabase/functions/run-place-intelligence-trial/index.ts` is the canonical source. Admin UI at `mingla-admin/src/pages/PlaceIntelligenceTrial.jsx` is the canonical caller. The dropped `signal_anchors` table + admin tab + RLS + trigger function ARE NOT authoritative anymore — see `feedback_signal_anchors_decommissioned.md`.

**Rationale:** The 32-anchor calibration scaffold (ORCH-0707/0713) was a fixed-set evaluation harness for prompt-version regression testing. Real production traffic needs city-by-city sweeps over the actual servable pool, not a frozen 32-place subset. ORCH-0734 replaced the scaffold with `place_intelligence_city_runs` (one row per trial run) + stratified random sampling (top half by `review_count` + Fisher-Yates random fill) + Gemini auto-retry-once on `MALFORMED_FUNCTION_CALL`.

**Enforcement (3 gates):**
1. **Schema constraint** — `place_intelligence_city_runs.city_id NOT NULL` references `seeding_cities(id)`; pipeline writer cannot insert null city_id.
2. **Edge function structure** — `run-place-intelligence-trial/index.ts` requires `{city_id, sample_size}` body; rejects without city_id with 400 status.
3. **Admin UI structure** — city picker + sample-size picker required; "Run Trial" disabled until both selected.

**Test that catches a regression:** any new code path calling `run-place-intelligence-trial` without a `city_id` body field fails edge function input validation and returns 400. Schema-level NOT NULL prevents direct DB inserts from bypassing the contract.

**Established:** 2026-05-05 by ORCH-0734 (forensics → SPEC → IMPL → Cary 50 smoke PASS in 19 min for $0.21 with 3 Gemini retries fired+succeeded). DEC-110 logs the decision.

**Related invariants:**
- `I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING` (preserved) — trial pipeline output is PM-evaluation only; never feeds production rerank
- `I-TRIAL-RUN-SCOPED-TO-CITY` (pre-cursor — DEC-105; ORCH-0734 strengthens via schema + UI gates)
- `I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS` (ORCH-0735) — upstream pool-quality gate; trial output validity depends on this

**Cross-references:**
- DEC-110 (Decision Log) — ORCH-0734 CLOSE rationale + tradeoffs + signal_anchors decommission
- ORCH-0734 SPEC (`Mingla_Artifacts/specs/SPEC_ORCH-0734_CITY_RUNS.md`)
- ORCH-0734 INVESTIGATION (`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0734_CITY_RUNS.md`)
- ORCH-0734 IMPL report (`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0734_CITY_RUNS_REPORT.md`)
- Memory `feedback_signal_anchors_decommissioned.md` (ACTIVE)
- Backup snapshot `_archive_orch_0734_signal_anchors` retained 14 days from 2026-05-05 → DROP on 2026-05-19 if no rollback signal
- ORCH-0737 v6 + v6.1 (CLOSED 2026-05-06 PASS via DEC-118) — added full-city-async trial mode + URL-transform photo pipeline + budget-loop worker; preserves this invariant; spawned new I-COLLAGE-PHOTO-URL-AT-TILE-RESOLUTION (below)
- ORCH-0737 v7 (queued) — London-scale follow-up; Gemini File API + cache hit-rate + parallel-tuning; intake-only

---

## ACTIVE (post ORCH-0737 v6 + v6.1 CLOSE 2026-05-06)

### I-COLLAGE-PHOTO-URL-AT-TILE-RESOLUTION — Photo URLs into compose path MUST be transformed to tile-target resolution before download

**Statement:** Every photo URL passed into `composeCollage()` (and therefore through `fetchAndDecode()`) MUST be transformed to its tile-target resolution before the HTTP fetch fires. Two transforms are canonical:
1. **Supabase Storage own-domain** (`*.supabase.co/storage/v1/object/...`) → rewritten to `*.supabase.co/storage/v1/render/image/...?width=N&height=N&resize=cover` where N is the tile size (default 192 px for 6-up collages). Existing query params on the input URL are stripped (otherwise they'd duplicate or collide with the resize params).
2. **Google CDN reviewer photos** (`https://lh3.googleusercontent.com/...`, plus `lh4`/`lh5`/`lh6` variants) → rewritten to append the `=wN-hN` size suffix; existing `=k-no` / `=sN` / similar suffixes are replaced; no suffix at all → suffix appended.

Unknown URLs (non-Supabase, non-Google CDN) pass through unchanged — graceful fallback so the pipeline never breaks on a new photo source, but tile-resolution discipline is best-effort for those. Empty / null / non-string inputs pass through unchanged (defensive).

**Authority:** `supabase/functions/_shared/imageCollage.ts` exports `transformPhotoUrlForTile(url, tileSize)` as the single canonical helper. `fetchAndDecode(url, tileSize, timeoutMs?)` calls it before every HTTP fetch. `composeCollage()` for-loop intentionally stays SERIAL inside compose — outer parallelism (parallel-12 places) lives in `runPrepIteration`; inner serial bounds memory at ~5 MB/place × 12 = ~60 MB, well below the 150 MB Edge Runtime cap.

**Rationale:** Pre-v6 (pre-2026-05-06), `fetchAndDecode` downloaded photos at native resolution. Live experiment E1 (per `INVESTIGATION_ORCH-0737_V6_PIPELINE_TRACE.md`) measured Supabase Storage marketing photos at 173 KB native JPEG and Google CDN reviewer photos at 59 KB native. Decoded to RGBA + held in memory across 6-up parallel compose, peaks hit ~50 MB per call which stacked dangerously close to the 150 MB Deno Edge Runtime cap on parallel workers — `WORKER_RESOURCE_LIMIT 546` errors fired regularly during Cary, FortLauderdale, Washington runs. Live experiment E2 proved both transform paths viable: Supabase `/render/image/?width=192&height=192&resize=cover` returns ~10.7 KB (94% byte reduction); Google CDN `=w192-h192` returns ~11.8 KB (80% reduction). v6 wired both transforms in. Post-deploy verification: zero `WORKER_RESOURCE_LIMIT 546` errors during Cary 761 full-city run + 78 min sustained (PROBE 2 count=0). The invariant codifies the pattern so future maintenance can't accidentally regress.

**Enforcement (3 gates):**
1. **Type-level** — `fetchAndDecode(url, tileSize, timeoutMs?)` requires `tileSize: number` parameter (no default). TypeScript compile error if a caller forgets to pass it. This forces the upstream caller to know the tile size, which means they either pass it through `transformPhotoUrlForTile` themselves or rely on `fetchAndDecode` to do so internally.
2. **Unit tests** — `supabase/functions/_shared/imageCollage.test.ts` pins behavior across 8 deterministic cases (Supabase Storage with/without query params; Google `lh3`/`lh4`/`lh5`/`lh6` with `=k-no` suffix / no suffix / different tile sizes; unknown CDN passthrough; empty/null/non-string input passthrough). Test run on Mac post-deploy: 8/8 PASS.
3. **Kill-switch** — `DISABLE_PHOTO_URL_TRANSFORM=true` env var disables both transforms (passthrough mode), enabling hot revert if a Supabase or Google API change ever breaks transform URLs without code change. Operators document the variable in the deploy runbook; default unset = transforms ON.

**Test that catches a regression:** any code path that calls `fetchAndDecode` without `tileSize` parameter fails TypeScript compile. Any code path that builds a Supabase Storage URL via string concat without going through `transformPhotoUrlForTile` will download native-resolution bytes; first symptom is `WORKER_RESOURCE_LIMIT 546` returning during full-city runs (>200 places). The 8 unit tests catch silent transform-logic regressions independent of live infrastructure.

**Established:** 2026-05-06 by ORCH-0737 v6 (forensics → SPEC → IMPL → Cary 761 full-city PASS in 78 min post-deploy + 0 mem errors). DEC-118 logs the decision. Memory file: NONE created (the implementation file + this invariant + the unit tests are sufficient documentation; future skill sessions can grep `transformPhotoUrlForTile` to find the canonical helper).

**Caveats / fragility:**
- **Existing fingerprint cache survives this change** (favorable D-1 deviation observed in v6 IMPL). The collage cache key is `sha256(stored_photo_urls.slice(0,5))` — URLs themselves aren't part of the key, so transformed downloads produce the same cache hits as native downloads. BUT if URL transforms ever change structurally (e.g., Supabase Storage migrates to a new render-image endpoint, or Google CDN deprecates `=wN-hN`), ALL existing fingerprints invalidate. Document at the kill-switch site.
- **Parallel-12 is the prep tier (memory-light); score tier is parallel-6** (per v6.1, DEC-118). Don't conflate the two limits — the score `.limit()` is rate-limit-bound by Gemini (parallel-12 → 429 storms); the prep `.limit()` is memory-bound by collage compose (parallel-12 inside the URL-transform regime is safe; without URL transforms, parallel-12 OOMs).
- **Unknown-CDN passthrough is intentional graceful fallback**, not a feature. If a future signal-source produces photos from a fourth domain (e.g., a Yelp-style content-delivery network), a new transform branch should be added, not relied on the passthrough.

**Cross-references:**
- DEC-118 (Decision Log) — ORCH-0737 v6 + v6.1 CLOSE rationale
- ORCH-0737 v6 SPEC: `Mingla_Artifacts/specs/SPEC_ORCH-0737_PATCH_V6_PIPELINE_REDESIGN.md` (binding contract; URL transform pattern at §3.1, §4.4)
- ORCH-0737 v6 INVESTIGATION: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0737_V6_PIPELINE_TRACE.md` (E1 + E2 photo-size + transform-viability evidence)
- ORCH-0737 v6 IMPLEMENTATION REPORT: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0737_V6_REPORT.md` (3-file change manifest; 5 IMPL discoveries)
- I-TRIAL-CITY-RUNS-CANONICAL (preserved) — upstream pool-quality + city-scoping invariant; trial pipeline depends on
- I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS (preserved) — upstream pool-quality gate
- ORCH-0737 v7 (queued) — London-scale forensics; will revisit transform pattern if Gemini File API replaces inline_data + introduces new caching pattern

---

## ACTIVE (post ORCH-0735 CLOSE 2026-05-05)

### I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS — Bouncer must reject fast-food + chain restaurants

**Statement:** Every `place_pool` row with `is_servable=true` post-bouncer-pass MUST satisfy ALL of:
1. `primary_type` is NOT in `EXCLUDED_FAST_FOOD_TYPES` (5 types: `fast_food_restaurant`, `snack_bar`, `food_court`, `cafeteria`, `convenience_store`) — enforced by B10
2. `name` does NOT match any `FAST_FOOD_NAME_PATTERNS` regex UNLESS allowlisted by `UPSCALE_CHAIN_ALLOWLIST` substring match — enforced by B11
3. `name` does NOT match any `CASUAL_CHAIN_NAME_PATTERNS` regex UNLESS allowlisted — enforced by B12

All four arrays live in `supabase/functions/_shared/bouncerChainRules.ts` (Path A per DEC-107). Bouncer applies them deterministically (no AI) in both pre-photo and final passes (per `I-TWO-PASS-BOUNCER-RULE-PARITY`).

**Authority:** `supabase/functions/_shared/bouncerChainRules.ts` is the canonical source. The parallel `rule_sets` / `rule_set_versions` / `rule_entries` Postgres tables are decoupled and scheduled for ORCH-0736 decommission. Editing rule_sets via the admin UI does NOT affect production.

**Rationale:** ORCH-0735 surfaced the gap when an ORCH-0734 Cary 50-place sweep admitted Chick-fil-A with `casual_food=95` Gemini score. Fast-food and casual-chain admission contradicts Mingla's positioning as a date / experience app. Pre-ORCH-0735 the bouncer had no fast-food rule; the rules-engine database that would have provided the data had no production consumer (~600-1000 rows that should have been excluded across 9 cities). Path A code-constants chosen over Path B "wire DB consumer" because (1) data lives + ships together; (2) admin UI changes were already silently ineffective (Const #1 dead-tap); (3) rules-engine schema is overhead without production use.

**Enforcement (4 gates):**
1. **Test fixtures** — 58 fixtures in `supabase/functions/_shared/__tests__/bouncer.test.ts` covering positive matches (B10/B11/B12), negative matches (independents survive), allowlist bypass, two-pass parity, and 9 explicit admit-regression-guards (T-CAVA-ADMIT, T-LPQ-ADMIT, T-LEON-PUPUSERIA-ADMIT, T-PAUL-INDEPENDENT-ADMIT, T-WASABI-INDEPENDENT-ADMIT, T-QUICK-INDEPENDENT-ADMIT, T-PERKINS-ORCHARD-ADMIT, T-SALADELIA-DUKE-ADMIT, T-WELLWITHWENDY-ADMIT, T-ROMANOS-PIZZERIA-INDIE-ADMIT, T-SONIC-ROOM-LAGOS-ADMIT) preventing regression of operator-locked admit decisions.
2. **Pre-photo / final pass parity** — both invocations of `bounce()` consume the same arrays via `matchFastFoodPattern()` / `matchCasualChainPattern()` / `isUpscaleChainAllowlisted()` helpers. Two-pass parity preserved.
3. **Word-boundary discipline** — `FF_PATTERN(substr, label)` builder anchors every pattern with `\b...\b` (case-insensitive). Subset / substring false-matches blocked at the regex layer. v2 dropped 4 high-collision patterns (paul/leon/wasabi/quick — false-positive rate 70-95%) where word-boundary alone was insufficient.
4. **Post-deploy SC-16 probe** — operator-runnable SQL probe across all servable cities returns admitted-chain count. Verified zero real chain leakage 2026-05-05 across Durham/Cary/FortLauderdale/Baltimore/Raleigh/Lagos/Brussels/Washington/London (5 remaining hits in probe regex are documented false positives, each protected by an explicit admit-regression-guard fixture).

**Test that catches a regression:** any new PR that (a) silently removes a chain pattern → the corresponding T-B11-* / T-B12-* fixture asserts reject, will fail; (b) silently adds a too-greedy pattern → the corresponding admit-regression-guard fixture (T-CAVA-ADMIT etc.) will fail. Plus the live SC-16 probe catches data-side drift.

**Established:** 2026-05-05 by ORCH-0735 (forensics → SPEC → IMPL v1 → IMPL v2 false-positive rework → IMPL v3 pluralization + missing-pattern patch → 9-city live sweep + SC-16 probe PASS). DEC-107 logs the decision. Memory `feedback_bouncer_chain_rules_in_code.md` (ACTIVE) documents the Path A workflow + decommission guidance.

**Cross-references:**
- DEC-107 (Decision Log) — Path A code-constants + I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS ratification
- ORCH-0735 SPEC (`Mingla_Artifacts/specs/SPEC_ORCH-0735_BOUNCER_CHAIN_FAST_FOOD_RULES.md`)
- ORCH-0735 INVESTIGATION (`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0735_BOUNCER_CHAIN_GAP.md`)
- ORCH-0735 IMPL reports v1 / v2 / v3 (`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0735_BOUNCER_RULES_REPORT*.md`)
- I-BOUNCER-DETERMINISTIC (preserved)
- I-TWO-PASS-BOUNCER-RULE-PARITY (preserved)
- ORCH-0736 (queued) — decommissions parallel rule_sets DB tables + admin RPCs
- ORCH-0738 (queued) — refactors `run-bouncer/index.ts` to streaming write-as-you-go (Washington partial-write side-discovery from v3 sweep)

---

## ACTIVE (post ORCH-0700 Phase 3B CLOSE 2026-05-03)

### I-CATEGORY-SLUG-CANONICAL — Every category slug producer must emit canonical 10

**Statement:** Any helper function (SQL, TypeScript, or other) that produces a category slug for a `place_pool` row MUST return a value within the canonical 10-slug set defined by `Object.values(DISPLAY_TO_SLUG)` in `supabase/functions/_shared/categoryPlaceTypes.ts:473-484`. NULL is acceptable (Constitution #9 — never fabricate). Any other value is a violation.

**Canonical 10:** `nature, icebreakers, drinks_and_music, brunch_lunch_casual, upscale_fine_dining, movies_theatre, creative_arts, play, flowers, groceries`.

**Rationale:** ORCH-0700 Phase 1 helper `pg_map_primary_type_to_mingla_category` shipped with an invented 11-slug taxonomy (`brunch`+`casual_food` split; `movies`+`theatre` split; no `groceries` — grocery types absorbed into `flowers`). Admin Place Pool dashboard reads matview `primary_category` expecting canonical display slugs; mismatch caused 3 cells to render 0 globally for ~6 hours until Phase 3B (Migration 7) corrected the helper. The bug class: a helper that produces values no consumer can resolve.

**Enforcement (3 gates):**
1. **SQL self-verify probes** in helper migration: 16 input/output assertions inside DO block; CREATE OR REPLACE migration aborts via RAISE EXCEPTION on regression.
2. **Matview post-refresh probe** in helper migration: scans `admin_place_pool_mv` for any `primary_category` value not in canonical set ∪ {`uncategorized`}; aborts on offending row.
3. **TS unit test** `supabase/functions/_shared/__tests__/derivePoolCategory_canonical.test.ts`: 21 Deno tests. Critical assertion: `for slug in ALL_DERIVED_CATEGORY_SLUGS: assert(Object.values(DISPLAY_TO_SLUG).includes(slug))`.

**Test that catches a regression:** any new PR that adds a bucket to `derivePoolCategory.ts` `ORDERED_BUCKETS` whose slug isn't in `DISPLAY_TO_SLUG` fails the unit test immediately at deno test time. Any new SQL helper that emits a non-canonical slug fails its self-verify probe at migration apply time.

**Established:** 2026-05-03 by ORCH-0700 Phase 3B forensics + spec + implementor. Operator-confirmed Path A (display-label semantic for matview `primary_category`).

---

## ACTIVE (post ORCH-0707 CLOSE 2026-05-02)

### I-CURATED-LABEL-SOURCE — Curated stop label authority

**Status:** ACTIVE (registered 2026-05-02 by ORCH-0707 implementor; flipped DRAFT → ACTIVE 2026-05-03 alongside ORCH-0700 Phase 3B CLOSE since ORCH-0707 work is live + verified)

**Statement:** The `placeType` field on every curated stop (response of `generate-curated-experiences`) AND every alternative (response of `replace-curated-stop`) MUST be the comboCategory slug — i.e., the slug of the combo slot the place was selected to fill. It MUST NEVER be derived from `place_pool.ai_categories`, `place_pool.ai_primary_identity`, or any other deprecated AI-derived per-place column.

**Rationale:** A place can score high on multiple signals (e.g., Alamo Drafthouse on both `movies` and `drinks`). The "best signal" of a place is not the same question as "which slot did this place fill." The combo defines the slot; the slot defines the label.

**Enforcement:**
1. **Structural (TypeScript):** `buildCardStop` opts.comboCategory is required — compilation fails if any call site omits it.
2. **CI test:** `supabase/functions/_shared/__tests__/no_ai_categories_in_curated.test.ts` asserts zero non-comment `ai_categories` references in `generate-curated-experiences/index.ts`, `_shared/stopAlternatives.ts`, `_shared/signalRankFetch.ts`.
3. **Runtime:** `resolveFilterSignal(categoryId)` throws if the slug is not registered in `COMBO_SLUG_TO_FILTER_SIGNAL` — no silent empty-result fallback.

**Tests:** T-01, T-02, T-04, T-05, T-07 (see SPEC_ORCH-0707).

**Related invariants:** I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME (single owner for distance/time math), I-CURATED-SELECTION-3-GATE (G1/G2/G3 serving gates).

**Established:** 2026-05-02 by ORCH-0707 forensics investigation §C3 (the comboCategory authority architectural finding) and operator's OQ-6 affirmation.

---

## ACTIVE-FULL (post ORCH-0700 Phase 3B CLOSE 2026-05-03)

### I-CATEGORY-DERIVED-ON-DROP — No stored interpretation columns on place_pool

**Rule:** Mingla category for any place is derived from `pg_map_primary_type_to_mingla_category(primary_type, types)` (admin-display contexts via matview `admin_place_pool_mv.primary_category`) OR from `place_scores.signal_id` (curated/serving contexts). Never from a stored interpretation column on `place_pool`.

**Status:** ACTIVE-FULL as of 2026-05-03. Migration 6 atomically dropped all 6 stored interpretation columns: `seeding_category, ai_categories, ai_reason, ai_primary_identity, ai_confidence, ai_web_evidence`. Archive table `_archive_orch_0700_doomed_columns` retains 69,599-row backup until 2026-06-02.

**Why:** Constitution #2 (one-owner-per-truth) — Google's raw type data is the owner; interpretation layers are derivations not stored facts. Constitution #8 (subtract-before-adding) — drop the interpretation columns once derivation function is canonical.

**Enforcement mechanism:** schema check (no AI/seeding interpretation columns physically exist on place_pool post-Migration-6); the 3 regression gates of I-CATEGORY-SLUG-CANONICAL also enforce this transitively.

**Test that catches a regression:** any new PR that adds an interpretation column to place_pool would surface immediately on schema review (no automated CI gate yet — flag for future).

**Established:** 2026-05-02 by ORCH-0700 cycle-3 audit (the 4-system architectural mapping: seeding pipeline / scoring pipeline / serving / rules engine). Flipped DRAFT → ACTIVE-FULL 2026-05-03 by ORCH-0700 Phase 3B CLOSE.

---

## Queued for ORCH-0708 CLOSE — Wave 2 Phase 1 photo-aesthetic scoring (DRAFT until tester PASS)

These two invariants are queued for codification when ORCH-0708 closes (operator smoke PASS on Raleigh/Cary/Durham). Status: **DRAFT**. Orchestrator promotes to ACTIVE in CLOSE protocol. Spec contract: [reports/SPEC_ORCH-0708_PHOTO_AESTHETIC_SCORING_INTEGRATION.md](reports/SPEC_ORCH-0708_PHOTO_AESTHETIC_SCORING_INTEGRATION.md) §12.

### I-PHOTO-AESTHETIC-DATA-SOLE-OWNER (DRAFT, ORCH-0708)

**Rule:** `place_pool.photo_aesthetic_data jsonb` is written ONLY by the `score-place-photo-aesthetics` edge function. NO other writer — bouncer, signal scorer, admin-seed-places, backfill-place-photos, run-pre-photo-bouncer, run-bouncer, any future edge function, or any direct admin SQL — may insert or update this column. Service-role direct edits (e.g., emergency operator SQL) require an explicit DEC entry citing the override.

**Why:** Constitution #2 (one owner per truth). The photo-aesthetic-data column has a single owner so its semantics + idempotency fingerprint stay consistent. If admin-seed-places re-seeded a place and accidentally wrote `photo_aesthetic_data` from Google's photo metadata (different shape entirely), or if the bouncer started embedding aesthetic data, the JSONB contract would silently drift and the scorer would compute against unstable inputs.

**Enforcement mechanism:**
1. Code-level — `score-place-photo-aesthetics/index.ts` is the only file that writes the column via service_role client; CI grep gate on every PR (a PR that adds `photo_aesthetic_data` as a target of `.update()` or `INSERT INTO place_pool` outside that one edge function fails review unless explicitly overridden in the PR description).
2. Schema-level — `admin-seed-places/index.ts` per-row UPDATE block (lines 1023-1099) has a protective comment block citing this invariant + ORCH-0708. CI gate on every admin-seed-places PR confirms the comment + the absence of `photo_aesthetic_data` from the UPDATE column list.
3. Documentation-level — `place_pool.photo_aesthetic_data` `COMMENT ON COLUMN` SQL string explicitly names this invariant.

**Test that catches regression:** post-deploy SQL probe `SELECT COUNT(*) FROM information_schema.column_privileges WHERE table_name='place_pool' AND column_name='photo_aesthetic_data' AND grantee != 'service_role';` should return zero. Any other consumer that gets write access on this column = invariant violation.

### I-PHOTO-AESTHETIC-CACHE-FINGERPRINT (DRAFT, ORCH-0708)

**Rule:** Every `photo_aesthetic_data` JSONB blob persisted by `score-place-photo-aesthetics` MUST contain a `photos_fingerprint` field equal to `sha256(stored_photo_urls.slice(0,5).join('|'))` computed at scoring time. The edge function MUST skip places where the live `place_pool.stored_photo_urls` produces the same fingerprint as the persisted `photo_aesthetic_data->>'photos_fingerprint'` (idempotent skip), unless the run was started with `force_rescore: true`.

**Why:** photo backfill is expensive (~$0.0035 per place at Haiku batch+cache). Re-running scoring on places whose photos haven't changed wastes budget and produces non-deterministic re-scoring (Claude vision is mildly stochastic). Fingerprint comparison guarantees idempotency at the data layer. When Google detail-refresh changes `stored_photo_urls` (which happens on re-seed per ORCH-0550.1), the fingerprint changes and the place re-enters scoring naturally.

**Enforcement mechanism:**
1. Edge function self-test — `score-place-photo-aesthetics/index.ts` includes a Deno test asserting that two consecutive runs against the same place (with unchanged photos, no force_rescore) result in exactly one Anthropic API call.
2. Cost telemetry — `photo_aesthetic_runs.actual_cost_usd` after a no-op re-run should be near $0 (only the eligibility query, no Claude calls). Operator runs the same test scope twice during smoke; second run cost <$0.10 = invariant holds.
3. Schema-level — `photo_aesthetic_data` JSONB schema documented in `COMMENT ON COLUMN` includes `photos_fingerprint` as REQUIRED.

**Test that catches regression:** post-deploy SQL probe — for any place with `photo_aesthetic_data IS NOT NULL`, assert `photo_aesthetic_data ? 'photos_fingerprint'` returns true for 100% of rows. Any row missing the fingerprint = invariant violation (likely a buggy edge-function path that wrote the JSON without computing the fingerprint).

---

## Mingla Business invariants (2026-05-03) — ORCH-0706 close-cycle DB-enforced hardening

### I-22 Event slug FROZEN (mingla-business — DB-enforced)

**Rule:** `events.slug` is immutable after row creation. Any UPDATE that changes `slug` is rejected by trigger `trg_events_immutable_slug` (function `biz_prevent_event_slug_change`) with error: `events.slug is immutable (Cycle 7 share URLs depend on permanence; create a new event instead of renaming)`.

**Why:** Cycle 7 public-event URLs at `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` resolve events by `(brandSlug, eventSlug)` tuple. Renaming the slug 404s every previously-shared event link (operator share modal, social embeds, email blasts, IG bios). Buyers who saved the link or have it in their email confirmation lose access.

**Established by:** ORCH-0706 close (2026-05-03). Migration: `supabase/migrations/20260503100000_b1_5_pr_59_hardening.sql`.

**Enforcement:**
- DB trigger: `trg_events_immutable_slug BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.biz_prevent_event_slug_change()` — verified live via metadata query.
- Function body: raises EXCEPTION when `NEW.slug IS DISTINCT FROM OLD.slug`.
- Even role-based bypass impossible: trigger fires for all roles including service_role.

**Test that catches a regression:** `UPDATE public.events SET slug = 'forbidden' WHERE id = (...);` MUST raise the immutability error. (See SC-2 in [`specs/SPEC_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING.md`](specs/SPEC_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING.md) §5.)

---

### I-23 events.created_by FROZEN (mingla-business — DB-enforced)

**Rule:** `events.created_by` (the `auth.users.id` of whoever created the event) is immutable after row creation. Any UPDATE that changes `created_by` is rejected by trigger `trg_events_immutable_created_by` (function `biz_prevent_event_created_by_change`) with error: `events.created_by is immutable (audit-trail integrity)`. Even `event_manager+` role-holders cannot rewrite the field.

**Why:** Audit-trail integrity. Without this, an event manager added to an event after creation could silently rewrite the `created_by` field to themselves, corrupting the original-creator audit signal. If something goes wrong six months later — refund disputes, legal questions, attribution arguments — the database evidence stays clean.

**Established by:** ORCH-0706 close (2026-05-03). Migration: `supabase/migrations/20260503100000_b1_5_pr_59_hardening.sql`.

**Enforcement:**
- DB trigger: `trg_events_immutable_created_by BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.biz_prevent_event_created_by_change()`.
- Function body: raises EXCEPTION when `NEW.created_by IS DISTINCT FROM OLD.created_by`.

**Test that catches a regression:** `UPDATE public.events SET created_by = (different uuid) WHERE id = (...);` MUST raise the immutability error. (See SC-3 in SPEC §5.)

---

### I-24 audit_log + scan_events Option B append-only carve-out (mingla-business — documented)

**Rule:** `audit_log` and `scan_events` tables are append-only for non-service-role callers. Service role (`auth.uid() IS NULL`) MAY mutate (UPDATE/DELETE) for reconciliation jobs and migration scripts. Application code MUST NOT mutate; new entries via INSERT only. The carve-out is documented verbatim in `COMMENT ON TABLE` for both tables — no future investigator should see "append-only" in the schema and assume it means strict-no-mutations-ever.

**Why:** Reconciliation jobs are an operational reality (partial scanner sync repair, double-charged refund recovery, mis-attributed door sale). Strict-no-mutations-ever (Option A) creates real on-call pain the first time bad data lands and we cannot fix it without dropping and recreating triggers. The cost of Option B (this carve-out) is one paragraph of comment text; the cost of Option A is a midnight-emergency migration.

**Established by:** ORCH-0706 close (2026-05-03). DEC-089. Migration: `supabase/migrations/20260503100000_b1_5_pr_59_hardening.sql`.

**Enforcement:**
- DB triggers `trg_audit_log_block_update` + `trg_scan_events_block_update` (PR #59 — UNCHANGED by ORCH-0706): raise EXCEPTION on UPDATE/DELETE if `auth.uid() IS NOT NULL`. Service role calls (auth.uid() = NULL) silently RETURN COALESCE(NEW, OLD) without raising.
- COMMENT ON TABLE for both tables disclose the carve-out: *"Append-only for non-service-role callers. Service role (auth.uid() IS NULL) may UPDATE/DELETE for reconciliation jobs and migration scripts. Application code MUST NOT mutate; new entries via INSERT only. (B1.5 — ORCH-0706 SF-4)"*

**Test that catches a regression:** `SELECT obj_description('public.audit_log'::regclass)` MUST include the carve-out language. Authenticated UPDATE on either table MUST raise; service-role UPDATE MUST succeed. (See SC-4a/b/c/d in SPEC §5.)

**Forward path (if SOC2 Type II audit demands strict append-only):** Drop the `IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;` short-circuit in both trigger functions (~8 LOC per function). Then RAISE EXCEPTION fires for all roles. Update I-24 statement + COMMENT ON TABLE to reflect strict mode.

> **Cycle 13b amendment (2026-05-04):** a new SELECT policy `"Brand admin plus reads brand audit_log"` was added (PostgreSQL multi-policy OR-merge). Brand admins now see ALL `audit_log` rows for brands where `biz_is_brand_admin_plus_for_caller(brand_id)` returns true; sub-rank users (event_manager+ on brands but below brand_admin) still see only their own rows via the original `"Users can read own audit_log rows"` policy. Append-only INSERT carve-out unchanged — service-role retains UPDATE/DELETE per Option B; non-service callers are still blocked from mutations via the existing trigger. Migration: `supabase/migrations/20260504100001_b1_phase7_audit_log_brand_admin_select.sql`.

---

## Mingla Business invariants (2026-05-02) — Cycle 10 guest list (BACKFILLED 2026-05-03)

> **Backfill note:** Cycle 10 closed Grade A on commit `dc75b5dd` and SPEC §8.2 locked I-25 + I-26 IDs, but the formal registry entries below were omitted from CLOSE Step 1 SYNC. Cycle 11 implementor surfaced this as a discovery in [`reports/IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT.md`](reports/IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT.md) §12 D1. Backfilled here 2026-05-03 to keep registry truthful.

### I-25 Comp guests in `useGuestStore.entries` ONLY (mingla-business)

**Rule:** Comp guests live in `useGuestStore.entries` only — NEVER as phantom OrderRecord rows. `CheckoutPaymentMethod` union NEVER includes `"comp"`. Future cycles that introduce manual-add features MUST extend `useGuestStore` (or its B-cycle backend equivalent), NEVER fabricate orders.

**Why:** I-19 requires write-once order financials. Comp guests are operator-created and don't pay — calling them orders is a category error that cascades into checkout-flow type checks that don't make sense for a non-purchase. Cycle 10's separate-`useGuestStore` strategy keeps semantics clean.

**Established by:** Cycle 10 close (2026-05-02). Commit `dc75b5dd`. SPEC: [`specs/SPEC_BIZ_CYCLE_10_GUEST_LIST.md`](specs/SPEC_BIZ_CYCLE_10_GUEST_LIST.md) §8.2.

**Enforcement:** Convention + static check (T-26 + SC-21). Cycle 11 honors: comp manual check-ins write to `useScanStore` with `orderId === ""` + `via: "manual"` + ticketId starting with `cg_`; never round-trip back to `useGuestStore` as a phantom order.

**Test that catches a regression:** `grep -rEn "CheckoutPaymentMethod.*comp" mingla-business/` MUST return 0 hits. Any new code that adds `"comp"` to the payment-method union or constructs an OrderRecord with `paymentMethod: "comp"` violates this invariant.

---

### I-26 `LiveEvent.privateGuestList` operator-only flag (mingla-business — Cycle 10)

**Rule:** `LiveEvent.privateGuestList` is a UI flag introduced in Cycle 10 that affects NO buyer-facing surface in Cycle 10. Future cycles that add buyer surfaces (e.g., guest-list preview on `/o/[orderId]`) MUST honor this flag — when `true`, hide attendee count or show only "you're confirmed" — but Cycle 10 SPEC + IMPL did NOT preempt that surface.

**Why:** Buyer-side guest-list-preview is its own cycle decision (Cycle 10 locked decision #7 — operator-only). Pre-implementing the buyer surface from Cycle 10 would couple two design decisions that should remain independent.

**Established by:** Cycle 10 close (2026-05-02). Commit `dc75b5dd`. SPEC: [`specs/SPEC_BIZ_CYCLE_10_GUEST_LIST.md`](specs/SPEC_BIZ_CYCLE_10_GUEST_LIST.md) §8.2.

**Enforcement:** Static check (T-27 + SC-22). `grep -rn "privateGuestList\|useGuestStore" mingla-business/app/o/ mingla-business/app/e/` MUST return 0 hits. Cycle 11 preserved: J-S8 modifications to `/o/[orderId]` for QR carousel did NOT introduce `useGuestStore` or `privateGuestList` references.

**Test that catches a regression:** Same grep test above. Any new buyer-route code that reads either symbol violates this invariant.

---

## Mingla Business invariants (2026-05-03) — Cycle 11 QR scanner + check-in

### I-27 Single successful scan per ticketId (mingla-business — client-enforced; B-cycle DB-enforced)

**Rule:** For each unique `ticketId` in the system, there is AT MOST ONE `ScanRecord` with `scanResult === "success"`. Cycle 11 enforces single-device via `useScanStore.getSuccessfulScanByTicketId(ticketId)` lookup before recording new success scans. Subsequent scans of the same ticket return the duplicate-overlay state (J-S2 duplicate kind) with relative-time of the original check-in.

**Why:** Door integrity. Two-tap re-entry would either let one person in twice with the same ticket (cost: lost revenue, capacity over-count) OR show a stale "already used" without proof of when (cost: door-staff confusion, buyer dispute). Single-scan-per-ticket is the contract that lets door staff trust the duplicate signal.

**Established by:** Cycle 11 close (2026-05-03). Code: `mingla-business/src/store/scanStore.ts` + `mingla-business/app/event/[id]/scanner/index.tsx` J-S1 handler.

**Enforcement (Cycle 11 — single-device):**
- `useScanStore.getSuccessfulScanByTicketId(ticketId)` lookup before recordScan(success) on every camera scan.
- Duplicate guard fires duplicate-overlay state + Warning haptic; ScanRecord NOT recorded for the duplicate attempt.
- Cross-device dedup is NOT enforced — two operators on two devices can both record success for the same ticketId. Behaviour documented in §10 forward backend handoff.

**Enforcement (B-cycle — DB-enforced):**
- Either `CREATE UNIQUE INDEX ON scan_events (ticket_id) WHERE scan_result = 'success';` (partial UNIQUE) OR edge-function `scan-ticket` does pre-insert lookup. Recommend partial index for atomicity.
- Cross-device + offline-replay dedup falls out naturally from the DB constraint.

**Test that catches a regression:** Scan the same valid QR twice on the same device → first scan: success overlay; second scan: duplicate overlay with timestamp of first. (See SC-4 + T-06 in [`specs/SPEC_BIZ_CYCLE_11_QR_SCANNER.md`](specs/SPEC_BIZ_CYCLE_11_QR_SCANNER.md) §6/§7.)

---

### I-28 Scanner-invitation UI without functional flow until B-cycle (mingla-business — TRANSITIONAL)

**Rule:** Cycle 11's `useScannerInvitationsStore.recordInvitation` creates a pending invitation in client-side store ONLY. NO email is sent. NO acceptance flow exists. NO auth gate is enforced for non-operator users (operator-as-scanner is the only working identity model). Invitation rows MAY remain `status: "pending"` indefinitely until B-cycle wires backend functional flow. The `permissions.canAcceptPayments` field is type-locked to `false` for the entire cycle (visible toggle is disabled).

**Why:** Door staff need to be visible in the operator's organiser ledger BEFORE the email + acceptance backend exists, so the operator can plan staffing without losing the data when B-cycle ships. Building the UI now + a client-side store + TRANSITIONAL banner is honest state — Const #1 No dead taps says the tap creates a visible pending entry, which it does. The `[TRANSITIONAL]` markers + EXIT CONDITION ensure no future investigator mistakes the UI scaffolding for a working invite-flow.

**Established by:** Cycle 11 close (2026-05-03). Code: `mingla-business/src/store/scannerInvitationsStore.ts` + `mingla-business/src/components/scanners/InviteScannerSheet.tsx` + `mingla-business/app/event/[id]/scanners/index.tsx`.

**Enforcement (Cycle 11):**
- `[TRANSITIONAL]` headers on store + sheet with EXIT CONDITION.
- Visible TRANSITIONAL banner on `/event/{id}/scanners` route at top of content (always rendered, not dismissible) with copy: *"Scanner emails ship in B-cycle. Invitations are stored locally for now."*
- Confirm-success toast: *"Invitation pending — emails ship in B-cycle."*
- `canAcceptPayments` toggle visually disabled with copy: *"Door payments coming in B-cycle."*

**EXIT CONDITION (B-cycle):**
- Edge function `invite-scanner` (writes to `scanner_invitations` + sends Resend email)
- Edge function `accept-scanner-invitation` (writes to `event_scanners` on token-gated route)
- `/event/{id}/scanner` route auth gate checks `event_scanners` membership for non-operator users
- When backend lands, `useScannerInvitationsStore` contracts to a cache (or removes entirely if backend is sole authority).

**Test that catches a regression:** SC-19 + SC-20 + T-21: TRANSITIONAL banner visible always; canAcceptPayments toggle DISABLED + always false; toast on confirm matches the deferred-email copy.

> **Cycle 12 amendment:** the `canAcceptPayments` type-lock was FLIPPED per Cycle 12 Decision #4 — operator can now toggle the permission per scanner. Semantics: "can take cash + manual payments at the door". Card reader + NFC tap-to-pay remain TRANSITIONAL until B-cycle Stripe Terminal SDK + platform NFC integrations land. The flip is a permission-shape change, NOT a functional-flow change — the rest of I-28 (UI-only invitation, no email, no acceptance flow, no auth gate) stays in force. Reference: `mingla-business/src/components/scanners/InviteScannerSheet.tsx` post-Cycle-12 commit.

---

### I-29 Door sales NEVER fabricated as phantom OrderRecord rows (mingla-business — Cycle 12)

**Rule:** Door sales live in `useDoorSalesStore.entries` ONLY. NEVER as phantom `OrderRecord` rows in `useOrderStore`. The `CheckoutPaymentMethod` union extension (Cycle 12 §4.8) adds `"cash" | "card_reader" | "nfc" | "manual"` values, but online checkout flow (`app/checkout/[eventId]/payment.tsx`) MUST filter to `"card" | "apple_pay" | "google_pay" | "free"` ONLY when constructing OrderResult — door payment methods MUST NEVER appear in buyer flow. The anon-tolerant buyer routes (`app/o/`, `app/e/`, `app/checkout/`) MUST NOT import `useDoorSalesStore`.

**Why:** Mirrors I-25 (comp guests in `useGuestStore` only) — same architectural rule applied to a different surface. I-19 (immutable order financials) requires write-once snapshot fields on `OrderRecord`; door sales have parallel write-once snapshot fields on `DoorSaleRecord`. Calling them "orders" is a category error that would cascade into checkout-flow type checks that don't make sense for in-person walk-ups (e.g., `paymentIntentId`, `stripeFee`). Operators want a separate ledger; auditors need a clear separation between the online (Stripe-mediated) and in-person (manual cash/card-reader) financial event streams.

**Established by:** Cycle 12 close (2026-05-03). Code: `mingla-business/src/store/doorSalesStore.ts` + `mingla-business/app/event/[id]/door/`. Anon-route safety enforced by 0-hit grep across `app/o/`, `app/e/`, `app/checkout/`.

**Enforcement (Cycle 12):**
- Convention + grep test (T-39 + T-41): `useDoorSalesStore` MUST NOT appear in `app/o/`, `app/e/`, `app/checkout/` (anon-tolerant routes per I-21).
- `CheckoutPaymentMethod` union extension is type-only; runtime filter at the buyer-flow boundary (Cycle 8 J-C3 payment screen).
- Door payment methods are never persisted to `OrderRecord.paymentMethod` (the type union union allows door values for forward-compat with the merged `CheckoutPaymentMethod` shape, but the store mutation layer rejects them).

**EXIT CONDITION:** None — this is a permanent architectural separation. B-cycle wires backend writes to `door_sales_ledger` (PR #59 schema), keeping door sales separate from the `orders` table forever.

**Test that catches a regression:** T-39 + T-41 grep; SC-31 banned-subscription pattern; visual check that the J-G1 list distinguishes ONLINE / COMP / DOOR row kinds.

---

### I-30 Door-tier vs online-tier separation enforced via `availableAt` (mingla-business — Cycle 12)

**Rule:** `TicketStub.availableAt: "online" | "door" | "both"` is the source of truth for which surface a tier appears on. Online checkout (Cycle 8 J-C1 picker at `app/checkout/[eventId]/index.tsx`) MUST filter `availableAt !== "door"` — surfaces only `"online"` + `"both"`. Door sale flow (Cycle 12 J-D3 picker in `DoorSaleNewSheet.tsx`) MUST filter `availableAt !== "online"` — surfaces only `"door"` + `"both"`. Comp guest flow (Cycle 10 `AddCompGuestSheet`) MUST filter `availableAt === "both"` ONLY — comps stay tied to "both" tiers; door-only AND online-only tiers DO NOT surface for comps (use case is unclear; deferred per investigation OBS-3).

**Why:** Operators want pricing flexibility — charge £25 advance / £30 at door is a common pattern. Without enforcement, an operator could accidentally make door-only tiers show up online (and vice versa), creating customer confusion + revenue loss. The `availableAt` field is additive (default `"both"` for migrated tiers) — no operator action needed for backward-compat. Persist v5→v6 migrate function defaults `"both"` for all pre-Cycle-12 tier rows.

**Established by:** Cycle 12 close (2026-05-03). Code: `mingla-business/src/store/draftEventStore.ts` (TicketStub.availableAt + persist v5→v6 migrate); `mingla-business/app/checkout/[eventId]/index.tsx` (J-C1 filter); `mingla-business/src/components/door/DoorSaleNewSheet.tsx` (J-D3 filter); `mingla-business/src/components/guests/AddCompGuestSheet.tsx` (comp filter).

**Enforcement (Cycle 12):**
- Convention + 3 grep tests:
  - T-42 J-C1: `availableAt !== "door"` filter present in `app/checkout/[eventId]/index.tsx`
  - T-43 J-D3: `availableAt !== "online"` filter present in `DoorSaleNewSheet.tsx`
  - T-44 AddCompGuestSheet: `availableAt === "both"` filter present
- Persist v5→v6 migrate ships safe default `availableAt: "both"` for all pre-Cycle-12 tiers (verified by tsc + cold-start hydration test).

**EXIT CONDITION:** None — this is a permanent separation. B-cycle backend wire reuses the same field on the `tickets` table (no migration drift).

**Test that catches a regression:** T-42 + T-43 + T-44 grep; SC-26 + SC-27 + SC-29 manual smoke (door-only tier hidden in online checkout; door-only tier hidden in comp picker; cold-start hydration preserves `availableAt: "both"` for all migrated tiers).

---

### I-19 Immutable order financials (mingla-business)

**Rule:** An order's `totalGbpAtPurchase`, `lines[i].unitPriceGbpAtPurchase`, `lines[i].ticketNameAtPurchase`, `lines[i].isFreeAtPurchase`, `lines[i].quantity`, `currency`, and `buyer` snapshot are write-once at order insertion to `useOrderStore`. No subsequent operator action — including event edit, tier rename, tier reprice, refund, cancel — mutates these fields. Refund/cancel mutations create NEW records (`RefundRecord`) and update `status` + `refundedAmountGbp` + `refunds[]` aggregates only; original snapshots are NEVER overwritten.

**Why:** Buyer protection. Operator edits to a published event apply to displayable info (name, date, venue) but MUST NOT retroactively change what the buyer paid for. If the operator renames a tier "VIP" → "VIP+ Lounge" or changes the price, the buyer's order and ticket still show "VIP" at the price they paid. This invariant is the load-bearing contract for the full-edit-after-publish capability shipped in DEC-087.

**Established by:** ORCH-0704 v2 close (2026-05-02). Order shape spec'd in [SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_v2.md](specs/SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_v2.md) §3.1.5 as forward-looking schema; Cycle 9c implementor builds `useOrderStore` honouring this contract.

**Enforcement:**
- TypeScript: order line snapshot fields will be `Readonly<...>` at the type level when returned from selectors (Cycle 9c implementation rule).
- Runtime: `useOrderStore` exposes ONLY `recordOrder` (write-once on confirmation entry), `recordRefund` (creates RefundRecord, updates aggregates), `cancelOrder` (sets status=cancelled, cancelledAt). NO `updateLine`, NO `updateBuyer`, NO `updatePrice` mutations.
- CI gate (post-Stripe, B-cycle): SQL CHECK or trigger on `order_line_items` preventing UPDATE to `unit_price_gbp_at_purchase`, `ticket_name_at_purchase`, `is_free_at_purchase`, `quantity` columns once non-null.

**Test that catches a regression:** Build a stub `OrderRecord`, run operator edit on the LiveEvent (rename tier + change price), assert `OrderRecord.lines[i].ticketNameAtPurchase` and `unitPriceGbpAtPurchase` are unchanged. (Cannot test in ORCH-0704 stub mode — `useOrderStore` doesn't exist yet. Test ships in Cycle 9c.)

---

### I-20 Edit reason mandatory + audit log permanence (mingla-business)

**Rule:** Every successful `useLiveEventStore.updateLiveEventFields` call MUST:
1. Receive a non-empty `reason: string` (10 ≤ trimmed-length ≤ 200) from the caller.
2. Append exactly one entry to `useEventEditLogStore` BEFORE returning success.
3. Fire the notification stack via `eventChangeNotifier.notifyEventChanged` BEFORE returning success.

The audit log entry, once written, is immutable. `useEventEditLogStore` exposes ONLY `recordEdit` (append) + reads (`getEditsForEvent`, `getLatestEditForEvent`, `getEditsForEventSince`) + `reset` (logout). There is NO `updateEdit` and NO `deleteEdit`. Logout clears the store entirely (Const #6 owns the data lifetime).

**Why:** Buyer trust + operator accountability + dispute audit trail. Every edit to a published event has a reason recorded — buyers see it in their notification copy ("Reason: Venue change due to weather") + the buyer order detail page (Cycle 9c) renders the edit history. The append-only log is the source of truth for the material-change banner; mutating or deleting entries would break buyer confidence in the audit trail.

**Established by:** ORCH-0704 v2 close (2026-05-02). Implemented in `mingla-business/src/store/eventEditLogStore.ts` + `mingla-business/src/store/liveEventStore.ts:updateLiveEventFields`.

**Enforcement:**
- Compile-time: `updateLiveEventFields(id, patch, context, reason: string)` requires `reason` parameter; passing missing argument is a TS error.
- Runtime: store mutation rejects with `{ok: false, reason: "missing_edit_reason"}` (empty trimmed) or `{ok: false, reason: "invalid_edit_reason"}` (length < 10 or > 200) BEFORE applying patch — no edit log entry, no notification fires.
- API surface: `useEventEditLogStore` mutation surface is `recordEdit` + `reset` only. Adding any update / delete API is a violation.
- UI: `ChangeSummaryModal` v2 disables Save until reason length valid; live char counter `{N} / 200`.
- Logout: `clearAllStores.ts` calls `useEventEditLogStore.getState().reset()`.

**Test that catches a regression:** Unit test calling `updateLiveEventFields(id, {description: "x"}, ctx, "")` returns `{ok: false, reason: "missing_edit_reason"}`. Unit test calling with `reason: "abc"` (3 chars) returns `{ok: false, reason: "invalid_edit_reason"}`. Manual: edit a published event → ChangeSummaryModal opens → Save button disabled until reason ≥10 chars. After save, `useEventEditLogStore.getEditsForEvent(eventId)` returns the new entry with the typed reason. After logout, `useEventEditLogStore.getState().entries` is `[]`.

---

## Mingla Business invariants (2026-04-30) — Cycle 2 + Cycle 3 close-cycle promotions

### I-11 Format-agnostic ID resolver (mingla-business)

**Rule:** Every dynamic-segment Expo Router route in `mingla-business/` (e.g. `/brand/[id]/`, `/event/[id]/edit`, `/event/[id]/preview`) resolves the dynamic-segment value to a domain object via `find((b) => b.id === idParam)` against the Zustand store list — with NO normalization (no lowercasing, no trimming, no prefix stripping). Stub-data IDs (`lm`, `b_<ts36>`, `d_<ts36>`, `e_<ts36>`), backend UUIDs, and any future ID shapes all flow through the same resolver unchanged.

**Why:** ID format may evolve as backend cycles land. Normalization in the route handler creates a translation layer that drifts under pressure. The store is the single source of truth for IDs.

**Established by:** Cycle 2 J-A7 (`brand/[id]/index.tsx`), Cycle 3 (`event/[id]/edit.tsx`, `event/[id]/preview.tsx`).

**Enforcement:** Code review during implementor dispatch. Verification via grep for `idParam.toLowerCase()` / `.replace(...)` / `.trim()` inside route handlers — should return zero hits.

**Test:** Any consumer with a stub `lm` brand id can resolve through the route. Manually navigate to `/brand/lm/` → BrandProfileView renders. Same pattern for drafts: `/event/d_<ts36>/edit` → wizard renders.

---

### I-12 Host-bg cascade (mingla-business)

**Rule:** Every non-tab Expo Router route in `mingla-business/` MUST set `backgroundColor: canvas.discover` on its host View, applied via the safe-area-inset+host pattern: `<View style={{ flex: 1, paddingTop: insets.top, backgroundColor: canvas.discover }}>`. Tab routes (`(tabs)/home`, `(tabs)/account`, `(tabs)/events`) inherit the canvas via the parent layout.

**Why:** Without canvas.discover, dark-mode glass primitives (GlassCard, GlassChrome) render against the native bg colour (often white on iOS), breaking the dark-glass aesthetic and causing contrast failures.

**Established by:** Cycle 2 J-A7..J-A12 (every brand-side dynamic-segment route).

**Enforcement:** Code review. Grep `app/**/*.tsx` (excluding tabs) for `backgroundColor: canvas.discover` — every dynamic-segment route should match.

**Documented exception:** `app/event/[id]/preview.tsx` uses designer's `#0c0e12` for the hero treatment instead of canvas.discover — flagged in route docstring; deliberate per Cycle 3 spec §3.10.

**Test:** Cold-start the app and navigate to any deep route — background reads dark glass, never light/native.

---

### I-13 Overlay-portal contract (mingla-business)

**Rule:** Every kit primitive that mounts an overlay (Sheet, Modal, ConfirmDialog, TopSheet) MUST wrap its render tree in React Native's native `Modal` component (aliased as `RNModal`) with `transparent: true` so the overlay portals to the OS-level root window. Without portal wrapping, `StyleSheet.absoluteFill` resolves to the nearest positioned ancestor (e.g., a parent ScrollView's content rect), causing scrim + panel to mis-anchor when the consumer is mounted inside ScrollViews / nested layouts.

**Why:** Cycle 2 J-A8 polish RC-1 caught the bug on Sheet (BrandEditView's discard sheet centered within the form ScrollView, not the screen). Cycle 3 close caught the same bug on Modal (delete-ticket ConfirmDialog centered within Step 5's body, not the screen). Portal wrapping is the structural fix; both Sheet and Modal now satisfy.

**Established by:** Sheet — Cycle 2 J-A8 polish RC-1 (DEC-080 era). Modal — Cycle 3 close (DEC-085, this cycle).

**Enforcement:** Code review during implementor dispatch — any new overlay primitive must use the RNModal portal pattern. Header docstring on Sheet (lines 30-44) and Modal (lines 13-30 post-DEC-085) explains the contract.

**Test:** Mount a ConfirmDialog inside a ScrollView nested inside a parent View → tap to open → dialog must center on screen, scrim must cover the entire viewport. If dialog appears mis-centered, the portal wrapping is missing.

---

### I-14 Date-display single source (mingla-business)

**Rule:** All event date/time display formatting MUST flow through `mingla-business/src/utils/eventDateDisplay.ts`. No component implements its own ISO-to-label formatter. Helpers exported: `formatShortDate`, `formatLongDate`, `formatSingleDateLine`, `formatRecurringSummary`, `formatMultiDateSummary`, `formatRecurringDatesList`, `formatMultiDateList`, `formatDraftDateLine`, `formatDraftDateSubline`, `formatDraftDatesList`.

**Why:** Cycle 4 found 3 duplicated `formatDateLine` / `formatDateLabel` implementations across `CreatorStep2When`, `CreatorStep7Preview`, and `PreviewEventView` (HIDDEN-2 in investigation). Three copies of the same formatter drifting independently is a Constitution #2 violation waiting to happen — when recurring/multi-date support landed in Cycle 4, ANY missed copy would have rendered stale single-date strings.

**Established by:** Cycle 4 — ORCH-BIZ-CYCLE-4-RECURRING-MULTIDATE close (2026-04-30, commit `7d3d61ba`).

**Enforcement:** Header docstring at `eventDateDisplay.ts:1-12` declares the rule. Code review during forensics + implementor dispatch — any local ISO-to-label formatter introduced in an event component must be flagged and lifted into the helper.

**Test that catches a regression:** `grep -rn "toLocaleDateString\|formatDateLabel\|formatDateLine" mingla-business/src/components/event/` → only hits should be inside `eventDateDisplay.ts`'s own implementation. Anywhere else is a violation.

---

### I-15 Ticket-display single source (mingla-business)

**Rule:** All ticket modifier display formatting MUST flow through `mingla-business/src/utils/ticketDisplay.ts`. No component implements its own ticket-modifier formatter. Helpers exported: `formatTicketSubline`, `formatTicketCapacity`, `formatTicketBadges`, `formatTicketButtonLabel`, `formatEventLevelTicketBadges`, `sortTicketsByDisplayOrder`, `renormalizeDisplayOrder`, `moveTicketUp`, `moveTicketDown`, `nextDisplayOrder`.

**Sub-rule:** `displayOrder` is OWNED by this helper. NEVER mutate it inline in components. Reorder operations always go through `moveTicketUp` / `moveTicketDown` / `renormalizeDisplayOrder`. New tickets get their position via `nextDisplayOrder`.

**Why:** Cycle 5 added 9 modifier fields to `TicketStub`. Without a single source for display logic, the same modifiers would render inconsistently across Step 5 TicketCard, Step 7 mini-card, and PreviewEventView's PublicTicketRow — and a bug in `renormalizeDisplayOrder` (re-sorting before renumbering) silently undid reorder operations until centralised + fixed.

**Established by:** Cycle 5 — ORCH-BIZ-CYCLE-5-TICKET-TYPES close (2026-04-30).

**Enforcement:** Header docstring at `ticketDisplay.ts:1-15` declares the rule. The displayOrder ownership note is repeated as a code comment at the top of every reorder/duplicate/delete handler in `CreatorStep5Tickets.tsx`.

**Test that catches a regression:** `grep -rn "displayOrder" mingla-business/src/components/event/CreatorStep5Tickets.tsx` should show `displayOrder` only in (a) helper-call sites or (b) `nextDisplayOrder()` invocations. Direct assignment outside the helper = violation.

---

### I-16 Live-event ownership separation (mingla-business)

**Rule:** Published live events live ONLY in `liveEventStore`. They are NEVER created, mutated, or deleted from any other path. `publishDraft` in `draftEventStore` is the SINGLE atomic ownership-transfer point: find draft → call `convertDraftToLiveEvent` (the I-16 chokepoint) → push to `liveEventStore.addLiveEvent` → AND ONLY THEN delete the draft. If conversion fails (e.g., brand deleted), the draft is preserved so the user can retry.

**Sub-rule:** `addLiveEvent` MUST have exactly ONE caller — `liveEventConverter.convertDraftToLiveEvent`. No component, no other store, no edge function may push to `liveEventStore` directly. Grep-verifiable: `grep -rn "addLiveEvent" mingla-business/src` should return ONE match outside `liveEventStore.ts` (the converter call site).

**Why:** Cycle 6 introduced `liveEventStore` as a sibling to `draftEventStore`. Without a single chokepoint, either (a) drafts and live events could co-exist for the same logical event (which is canonical?) or (b) a publish flow that fails mid-way could orphan data in the live store while the draft survives. Constitution #2 (one owner per truth) demands the atomic transfer pattern.

**Established by:** Cycle 6 — ORCH-BIZ-CYCLE-6-PUBLIC-EVENT-PAGE close (2026-05-01).

**Enforcement:** Inline `[I-16 GUARD]` comment at the `addLiveEvent` declaration in `liveEventStore.ts` documents the chokepoint rule. Header docstring on `liveEventConverter.ts` reiterates the contract.

**Test that catches a regression:** `grep -rn "addLiveEvent\|liveEventStore.getState" mingla-business/src` — every match outside `liveEventStore.ts` itself + `liveEventConverter.ts` (one call site) is a violation. Also: `grep -rn "publishDraft" mingla-business/src` to verify that publish is the ONLY mutation that creates a LiveEvent.

---

### I-17 Brand-slug stability (mingla-business)

**Rule:** `brand.slug` is FROZEN at brand creation. NO edit path may EVER be added in `BrandEditView`, settings, or any other UI surface. Shared brand URLs (IG bio, WhatsApp status, email signature, business cards) depend on this slug being immutable.

**Sub-rule:** If a future cycle needs brand renaming for typo correction or rebrand, ship a slug-redirect table (`oldSlug → newSlug`) + a 301-style redirect handler in the route layer. NEVER mutate `brand.slug` directly. Old links MUST continue resolving for a generous grace period (recommend ≥12 months).

**Why:** Cycle 7 ships `/b/{brandSlug}` as the IG-bio-link surface. Founders treat the URL as permanent. If slug ever becomes editable without a redirect path, every shared link breaks instantly — the founder loses every visitor who ever bookmarked, screenshotted, or shared the URL. Mirrors Cycle 6 event-slug freeze (`liveEvent.brandSlug` and `liveEvent.eventSlug` are both frozen at publish).

**Established by:** Cycle 7 — ORCH-BIZ-CYCLE-7 close (2026-05-01).

**Enforcement:**
- **DB trigger (PROMOTED 2026-05-03 — ORCH-0706 close):** `trg_brands_immutable_slug BEFORE UPDATE ON public.brands FOR EACH ROW EXECUTE FUNCTION public.biz_prevent_brand_slug_change()` raises EXCEPTION on any UPDATE that changes `slug`. Even service_role mutations are rejected. Verified live via behavioral test (ORCH-0706 close 2026-05-03).
- Inline LOCK comment in `currentBrandStore.ts` Brand type at the `slug` field declaration documents the rule.
- `BrandEditView.tsx:20` header docstring already notes slug is read-only — Cycle 7 spec re-affirmed.
- `BrandEditView.tsx:368-369` renders `slug` as plain `<Text>` (NOT TextInput) — verified at investigation phase (forensics §3 OBS-1).

**Test that catches a regression:** `UPDATE public.brands SET slug = 'forbidden' WHERE id = ...;` MUST raise the immutability error (see SC-1 in ORCH-0706 SPEC §5). Also: `grep -rn "setBrand.*slug\|brand\.slug\s*=\s*" mingla-business/src` — any direct mutation outside `currentBrandStore.setBrands` initialization is a violation. Also: any new `<TextInput>` or `<Input variant="text">` in any `Brand*View.tsx` whose `value={...slug...}` and `onChangeText={...slug...}` is a violation.

**ORCH-0706 promotion (2026-05-03):** I-17 was originally consumer-side convention only (TypeScript LOCK comment). DB-side enforcement was missing — operator could in theory directly UPDATE the column via Supabase dashboard SQL. ORCH-0706 added `trg_brands_immutable_slug` to make the rule structurally enforceable across all access paths (service_role calls included).

---

## ORCH-0686 invariants (2026-04-26) — Photo backfill mode CHECK alignment + TS/SQL parity

### I-PHOTO-FILTER-EXPLICIT

**Rule:** `photo_backfill_runs.mode` is one of three values:

- `'pre_photo_passed'` — current default; first-pass after pre-photo Bouncer; gates eligibility on `place_pool.passes_pre_photo_check`.
- `'refresh_servable'` — Bouncer-approved maintenance; gates on `place_pool.is_servable`.
- `'initial'` — LEGACY alias for historical terminal-state rows; not written from new code.

The TypeScript `BackfillMode` union in `supabase/functions/backfill-place-photos/index.ts` and the SQL CHECK constraint `photo_backfill_runs_mode_check` MUST stay in sync.

**Established by:** ORCH-0598.11 (initial 2-mode form, declared inline in migration `20260424200002_orch_0598_11_launch_city_pipeline.sql:8`), rewritten by ORCH-0686 (3-mode form, persisted as a registry entry — was previously only a migration comment, which let it go stale through ORCH-0678).

**Enforcement:** CI gate `I-DB-ENUM-CODE-PARITY` in `scripts/ci-check-invariants.sh` (see below).

**Test that catches a regression:**

```bash
# Positive control — tree consistent.
bash scripts/ci-check-invariants.sh
# Expect: gate prints "I-DB-ENUM-CODE-PARITY ... OK"

# Verify the live constraint matches.
psql "$DATABASE_URL" -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'photo_backfill_runs_mode_check';"
# Expect a CHECK whose ARRAY contains 'initial', 'pre_photo_passed', 'refresh_servable'.
```

---

### I-DB-ENUM-CODE-PARITY

**Rule:** Whenever a TypeScript union or enum value is renamed, added, or removed, and its values are persisted into a column governed by a SQL CHECK constraint, the migration MUST update the constraint in the same change. The TypeScript value set and the SQL CHECK value set MUST be permutation-equal at all times.

**Established by:** ORCH-0686 (root-cause register entry RC-0686). Same class of failure as ORCH-0540 (PL/pgSQL type-resolution drift after flag flip — code change without schema/RPC alignment). Two occurrences was enough; the gate exists so a third cannot ship.

**Enforcement:** CI gate `I-DB-ENUM-CODE-PARITY` block in `scripts/ci-check-invariants.sh`. Currently scoped to the `BackfillMode` ↔ `photo_backfill_runs.mode` pair; future renames append additional checks under the same gate. The gate parses the TS union literal values from `supabase/functions/backfill-place-photos/index.ts`, parses the latest CHECK constraint definition for `photo_backfill_runs_mode_check` from the most recent migration that references it, and asserts the two value sets are permutation-equal. Fails loud naming both sets and the offending file paths.

**Test that catches a regression:**

```bash
# Negative control: add a fake value to the BackfillMode TS union without updating SQL.
sed -i.bak "s/type BackfillMode = 'pre_photo_passed' | 'refresh_servable';/type BackfillMode = 'pre_photo_passed' | 'refresh_servable' | 'fakemode';/" \
  supabase/functions/backfill-place-photos/index.ts
bash scripts/ci-check-invariants.sh
# Expect: exit 1, "FAIL: I-DB-ENUM-CODE-PARITY violated", names BOTH value sets,
#         names the offending TS file path.
mv supabase/functions/backfill-place-photos/index.ts.bak supabase/functions/backfill-place-photos/index.ts

# Positive control: tree consistent.
bash scripts/ci-check-invariants.sh
# Expect: gate prints OK.
```

---

## ORCH-0678 invariants (2026-04-25) — Two-Pass Bouncer (pre-photo + final)

### I-PRE-PHOTO-BOUNCER-SOLE-WRITER

**Rule:** Only `supabase/functions/run-pre-photo-bouncer/index.ts` writes to
`place_pool.passes_pre_photo_check`, `place_pool.pre_photo_bouncer_reason`, and
`place_pool.pre_photo_bouncer_validated_at`. The one-time backfill UPDATE in the
ORCH-0678 migration (`20260430000001_orch_0678_pre_photo_bouncer.sql`) is the
only other writer (and it runs exactly once when the migration is applied).
`backfill-place-photos` READS `passes_pre_photo_check` for its eligibility gate
but never writes it.

**Enforcement:** CI gate `I-PRE-PHOTO-BOUNCER-SOLE-WRITER` block in
`scripts/ci-check-invariants.sh` — greps for `passes_pre_photo_check` write
sites (`.update(...)` containing the column, or column literal in object
construction) outside `run-pre-photo-bouncer/`. Returns 0 hits when clean.

**Test that catches a regression:**

```bash
# Negative control: inject a synthetic write — gate exits 1 naming the file.
cat > supabase/functions/discover-cards/__test_gate.ts <<'EOF'
// __test_gate
await db.from('place_pool').update({ passes_pre_photo_check: true }).eq('id', '...');
EOF
bash scripts/ci-check-invariants.sh   # expect exit 1, names discover-cards
rm supabase/functions/discover-cards/__test_gate.ts
bash scripts/ci-check-invariants.sh   # expect exit 0
```

**Why it exists:** Constitutional #2 (one owner per truth). Mirrors
I-IS-SERVABLE-SINGLE-WRITER. If a second writer of `passes_pre_photo_check`
appears, the column's correctness drifts from the deterministic rule logic
in `_shared/bouncer.ts`. ORCH-0678 forensics proved the cost of this class of
drift: ORCH-0640 ch06 conflated `is_servable` writes by changing the eligibility
gate, creating a literal deadlock.

**Severity if violated:** S1 (single-writer column ownership is a structural
correctness invariant; violations cause silent column drift).

**Origin:** Registered 2026-04-25 after ORCH-0678 implementation. Investigation:
`reports/INVESTIGATION_ORCH-0678_LAGOS_BOUNCER_MASS_REJECT.md`. Spec:
`specs/SPEC_ORCH-0678_TWO_PASS_BOUNCER.md` §Invariants.

---

### I-PHOTO-DOWNLOAD-GATES-ON-PRE-PHOTO

**Rule:** `backfill-place-photos` action-based modes gate eligibility on
`passes_pre_photo_check=true` (mode `'pre_photo_passed'`) or `is_servable=true`
(mode `'refresh_servable'`). NEVER on raw `is_servable IS NULL` or any other
ad-hoc predicate. The legacy non-action `handleLegacy` route is forbidden —
POSTing without an `action` field returns HTTP 400. The two RPCs
`get_places_needing_photos` and `count_places_needing_photos` were dropped in
the ORCH-0678 migration; resurrecting them as callers is forbidden.

**Enforcement:** CI gate `I-PHOTO-DOWNLOAD-GATES-ON-PRE-PHOTO` block in
`scripts/ci-check-invariants.sh` — (a) forbids `function handleLegacy(` or
`return handleLegacy(` in `backfill-place-photos/index.ts`; (b) forbids
`rpc('get_places_needing_photos')` or `rpc('count_places_needing_photos')`
anywhere under `supabase/functions/`.

**Test that catches a regression:**

```bash
# Negative control 1: re-introduce handleLegacy.
cat >> supabase/functions/backfill-place-photos/index.ts <<'EOF'
// __test_gate
async function handleLegacy() { return new Response('ok'); }
EOF
bash scripts/ci-check-invariants.sh   # expect exit 1, names handleLegacy
git checkout -- supabase/functions/backfill-place-photos/index.ts
bash scripts/ci-check-invariants.sh   # expect exit 0

# Negative control 2: re-introduce the RPC call.
cat > supabase/functions/backfill-place-photos/__test_gate.ts <<'EOF'
// __test_gate
await db.rpc('get_places_needing_photos', { p_batch_size: 50 });
EOF
bash scripts/ci-check-invariants.sh   # expect exit 1
rm supabase/functions/backfill-place-photos/__test_gate.ts
bash scripts/ci-check-invariants.sh   # expect exit 0
```

**Why it exists:** prevents recurrence of the ORCH-0640 ch06 deadlock. The
gate column for first-pass photo download must be one that's set BEFORE photos
exist (`passes_pre_photo_check`). The legacy no-action route was the only working
escape from the prior deadlock — preserving it would create a documented vs
undocumented drift; retiring it forces operators through the correct flow.

**Severity if violated:** S1 (re-introduces the deadlock class that blocked
Lagos and 8 other cities).

**Origin:** Registered 2026-04-25 after ORCH-0678 implementation. Investigation:
`reports/INVESTIGATION_ORCH-0678_LAGOS_BOUNCER_MASS_REJECT.md`. Spec:
`specs/SPEC_ORCH-0678_TWO_PASS_BOUNCER.md` §Invariants.

---

### I-TWO-PASS-BOUNCER-RULE-PARITY

**Rule:** The rule body in `_shared/bouncer.ts` is the single source of truth
for both Bouncer passes. The only difference between `bounce(place)` and
`bounce(place, { skipStoredPhotoCheck: true })` is whether B8
(`B8:no_stored_photos`) appears in `reasons`. No other rule may differ between
passes. Bouncer rule keywords (B5:social_only, B7:no_google_photos,
B8:no_stored_photos, etc.) must NOT appear hand-rolled in any source file
outside `_shared/bouncer.ts` (the bouncer module + its tests + the two runner
edge fns that pass verdicts through + `backfill-place-photos` which may log
reasons received from the verdicts).

**Enforcement:** CI gate `I-TWO-PASS-BOUNCER-RULE-PARITY` block in
`scripts/ci-check-invariants.sh` — greps for the rule keywords across
`supabase/functions/` excluding the canonical-author files. Returns 0 hits when
clean.

**Test that catches a regression:**

```bash
# Negative control: introduce a hand-rolled rule check.
cat > supabase/functions/discover-cards/__test_gate.ts <<'EOF'
// __test_gate
if (!hasGooglePhotos(place)) reasons.push('B7:no_google_photos');
EOF
bash scripts/ci-check-invariants.sh   # expect exit 1, names discover-cards
rm supabase/functions/discover-cards/__test_gate.ts
bash scripts/ci-check-invariants.sh   # expect exit 0
```

**Why it exists:** prevents rule drift between the two passes. If pre-photo
and final ever diverge in any rule other than B8, places could pass pre-photo,
get their photos downloaded ($), then fail final for a NEW reason — silent
breakage with cost waste. Also prevents a class of bug where someone hand-rolls
a "lightweight" Bouncer check elsewhere and lets it diverge from the canonical
rules over time.

**Severity if violated:** S2 (rule drift class; correctness depends on which
rule diverged and where).

**Origin:** Registered 2026-04-25 after ORCH-0678 implementation. Spec:
`specs/SPEC_ORCH-0678_TWO_PASS_BOUNCER.md` §Invariants.

---

## ORCH-0671 invariants (2026-04-25) — Photo Pool admin surface deletion + label/owner/filter discipline

### I-LABEL-MATCHES-PREDICATE

**Rule:** Every UI label of the form `"X Approved"` / `"X Validated"` / `"X-approved"`
/ `"X-validated"` MUST cite the actual approval predicate it counts. In the admin
frontend specifically, `"AI Approved"` and `"AI Validated"` are BANNED — the
underlying data is the bouncer signal (`is_servable`); the legacy `ai_approved`
column was dropped by ORCH-0640. Inverse-naming = Constitution #9 violation
(operator-trust framing).

**Enforcement:** CI gate `I-LABEL-MATCHES-PREDICATE` block in
`scripts/ci-check-invariants.sh` —
`git grep -lE "AI[ -]?(Approved|Validated)" mingla-admin/src/` returns 0 hits
(excluding `*.md` documentation matches).

**Test that catches a regression:**

```bash
# Negative control: inject a banned label — gate exits 1.
echo '<StatCard label="AI Approved" />' > mingla-admin/src/__test_gate.jsx
bash scripts/ci-check-invariants.sh   # expect exit 1, names the file
rm mingla-admin/src/__test_gate.jsx
bash scripts/ci-check-invariants.sh   # expect exit 0
```

**Why it exists:** ORCH-0671 investigation §4 documented 5 places where
bouncer-aware data (post-ORCH-0640) was still labeled "AI Approved" — operator-trust
violation (Constitution #9 fabricated framing) and pattern-repeat of ORCH-0640 +
ORCH-0646 cleanup misses.

**Severity if violated:** S2 (operator-trust framing for admin tooling; not
end-user-visible but undermines admin reliability).

**Origin:** Registered 2026-04-25 after ORCH-0671 implementation. Investigation:
`reports/INVESTIGATION_ORCH-0671_PHOTO_TAB_BOUNCER_AWARENESS.md`. Spec:
`specs/SPEC_ORCH-0671_PHOTO_POOL_DELETE_AND_RELABEL.md` §6 + §3.7 Gate 1.

---

### I-OWNER-PER-OPERATION-TYPE

**Rule:** Every value allowed by `admin_backfill_log.operation_type` CHECK
constraint MUST have at least one consumer in `supabase/functions/` that
processes rows of that type. New operation_type values without a consumer create
zombie pending rows (per ORCH-0671's 17 zombies, $3,283.98 estimated, $0 actual
API spend — pending since 2026-04-02 with no edge fn ever scheduled to consume them).

**Enforcement:** CI gate `I-OWNER-PER-OPERATION-TYPE` block in
`scripts/ci-check-invariants.sh` — parses the latest non-ROLLBACK migration
defining `admin_backfill_log_operation_type_check` constraint, extracts allowed
values from the CHECK clause, and for each value requires ≥1 grep hit on
`operation_type ... 'value'` in `supabase/functions/`.

**Test that catches a regression:**

```bash
# Negative control: write a temp migration adding 'photo_backfill' back to the
# constraint without a consumer — gate exits 1 naming 'photo_backfill'.
cat > supabase/migrations/99999999999999_test_gate.sql <<'EOF'
ALTER TABLE public.admin_backfill_log
  DROP CONSTRAINT IF EXISTS admin_backfill_log_operation_type_check;
ALTER TABLE public.admin_backfill_log
  ADD CONSTRAINT admin_backfill_log_operation_type_check
  CHECK (operation_type IN ('place_refresh', 'photo_backfill'));
EOF
bash scripts/ci-check-invariants.sh   # expect exit 1, names photo_backfill
rm supabase/migrations/99999999999999_test_gate.sql
bash scripts/ci-check-invariants.sh   # expect exit 0
```

**Why it exists:** ORCH-0671 investigation §6 (HF-D) — the standalone Photo Pool
admin page's trigger button INSERTed `operation_type='photo_backfill'` rows but
no edge fn was ever wired to process them. Result: 17 pending rows accumulated
across 23 days with $3,283.98 estimated cost (Constitution #9 phantom data) and
zero actual API spend (Constitution #2 ownership gap — the operation_type was
"owned" by no consumer).

**Severity if violated:** S2-S3 (creates phantom cost data + zombie operational
state; not end-user-visible but degrades admin operator trust + observability).

**Origin:** Registered 2026-04-25 after ORCH-0671 implementation. Spec:
`specs/SPEC_ORCH-0671_PHOTO_POOL_DELETE_AND_RELABEL.md` §6 + §3.7 Gate 2.

---

### I-PHOTO-FILTER-EXPLICIT-EXTENSION

**Rule:** Every Postgres function named `admin_*photo*` MUST gate aggregations
and projections on `is_servable IS TRUE`. Exception: a function that intentionally
surfaces the unfiltered pool MUST contain a comment with the literal string
`"RAW POOL VIEW"` justifying the unfiltered aggregation.

**Enforcement:** CI gate `I-PHOTO-FILTER-EXPLICIT-EXTENSION` block in
`scripts/ci-check-invariants.sh` — for each `admin_*photo*` function defined in
the LATEST non-ROLLBACK migration that touches it, body must contain
`is_servable` OR `RAW POOL VIEW`. Functions that have been dropped by a later
migration are skipped (DROP-aware enhancement).

**Test that catches a regression:**

```bash
# Negative control: add a temp migration with a bouncer-blind photo RPC.
cat > supabase/migrations/99999999999999_test_gate.sql <<'EOF'
CREATE OR REPLACE FUNCTION public.admin_photo_test_v2()
RETURNS BIGINT
LANGUAGE sql STABLE
AS $$ SELECT COUNT(*) FROM place_pool WHERE is_active = true $$;
EOF
bash scripts/ci-check-invariants.sh   # expect exit 1, names admin_photo_test_v2
# Recovery via comment:
sed -i '1i -- RAW POOL VIEW: test fixture' supabase/migrations/99999999999999_test_gate.sql
bash scripts/ci-check-invariants.sh   # expect exit 0
rm supabase/migrations/99999999999999_test_gate.sql
```

**Why it exists:** ORCH-0671 investigation §3 measured 65-95% noise in the
deleted Photo Pool page's category counts because all 5 RPCs filtered only on
`is_active`. Bouncer-rejected places (those failing `is_servable`) were counted
as "missing photos to backfill" — operator saw a wildly inflated $695.63/mo
phantom cost vs $0 real. This invariant prevents recurrence on any future admin
photo aggregation. Note: spec §3.7 gate text was enhanced in implementation to
handle DROP migrations + ROLLBACK files (see implementor report Discoveries D-1,
D-2).

**Severity if violated:** S2 (cost framing + operator-trust; not user-visible
but materially affects admin decision-making).

**Origin:** Registered 2026-04-25 after ORCH-0671 implementation. Spec:
`specs/SPEC_ORCH-0671_PHOTO_POOL_DELETE_AND_RELABEL.md` §6 + §3.7 Gate 3.

---

## ORCH-0677 invariants (2026-04-25) — Curated reverse-anchor + empty-verdict + lint gate

### I-CURATED-FAILED-ANCHOR-IS-USED

**Rule:** When a reverse-anchor experience type's near-anchor companion fetch fails
(any gate fires: `reverseAnchor_no_available`, `reverseAnchor_no_place`,
`required_stops_short`, `travel_constraint`, `duplicate_place_ids`), the failing
anchor's `google_place_id` MUST be added to a per-request `failedAnchorIds: Set<string>`
**before** the iteration's `valid = false` / `continue`. Subsequent iterations of the
same combo must filter `anchorPlaces` against this set so they advance to the next
candidate instead of re-picking the dead one.

**Why:** picnic-dates is the only `reverseAnchor: true` typedef AND the only intent
with a single combo. Without per-request failure tracking, when the top-ranked
picnic_friendly anchor (e.g., Spring Forest Road Park) had zero qualifying groceries
within 3 km, the assembly loop deterministically re-picked the same anchor 8 times
and returned 0 cards. ORCH-0677 RC-1.

**Enforcement:** [supabase/functions/generate-curated-experiences/index.ts:815](supabase/functions/generate-curated-experiences/index.ts#L815)
declares `failedAnchorIds`; filter clause + 5 add-sites at the gate-fail branches.

**Test:** spec T-04 (unit) — with 5 anchor candidates and only the 5th viable,
the loop reaches it within ≤5 iterations. T-02 (live-fire) — picnic at Umstead
returns either ≥1 card or explicit `summary.emptyReason='no_viable_anchor'` with
`failedAnchorCount >= 2`.

---

### I-CURATED-EMPTY-IS-EXPLICIT-VERDICT

**Rule:** Every curated edge-function response with `cards.length === 0` MUST include
a `summary` object carrying `emptyReason: 'pool_empty' | 'no_viable_anchor' | 'pipeline_error'`.
The mobile `RecommendationsContext.deckUIState` EMPTY branch MUST fire whenever
`curatedEmptyReason !== undefined`. Without an explicit verdict, curated-only empty
results fall through to the INITIAL_LOADING fallback and the user sees "Curating your
lineup" indefinitely.

**Why:** Constitution #3 (no silent failures). Pre-fix, a curated-only empty response
was indistinguishable from "still loading" on the mobile side because `hasMoreFromEdge`
defaulted to `true`. ORCH-0677 RC-2.

**Enforcement:**
- Edge fn: [supabase/functions/generate-curated-experiences/index.ts](supabase/functions/generate-curated-experiences/index.ts)
  function-end summary computation + HTTP response shape conditional spread.
- Mobile: [app-mobile/src/services/deckService.ts](app-mobile/src/services/deckService.ts)
  aggregates per-pill `pillEmptyReasons` → emits `curatedEmptyReason` on `DeckResponse`;
  [app-mobile/src/contexts/RecommendationsContext.tsx:1666](app-mobile/src/contexts/RecommendationsContext.tsx#L1666)
  EMPTY branch reads `soloCuratedEmptyReason !== undefined`.

**Test:** spec T-05 (mocked stuck-EMPTY routing) + T-11 (device live-fire — picnic
at Umstead never shows "Curating your lineup" beyond cold-fetch window).

---

### I-CURATED-REVERSEANCHOR-NEEDS-COMBOS

**Rule:** Any `EXPERIENCE_TYPES` typedef in `generate-curated-experiences/index.ts`
where `stops.some(s => s.reverseAnchor)` MUST have `combos.length >= 2`.
Single-combo + reverseAnchor produces no fallback variety when an anchor fails the
near-anchor companion fetch — this exact shape was the cause of ORCH-0677.

**Enforcement:** Deno lint script [supabase/functions/generate-curated-experiences/_lint_invariants.ts](supabase/functions/generate-curated-experiences/_lint_invariants.ts)
imports `EXPERIENCE_TYPES` and asserts the rule. Wired into
[scripts/ci-check-invariants.sh](scripts/ci-check-invariants.sh) with graceful skip
when `deno` is not on PATH.

**Test:** spec T-08 (CI inject + revert negative-control) — adding a synthetic typedef
with `reverseAnchor: true` and `combos.length === 1` causes `bash scripts/ci-check-invariants.sh`
to exit 1 with the invariant name in stderr; removing it returns to exit 0.

---

## ORCH-0672 invariant (2026-04-25) — Coupled-diff partial commit prevention

### I-COUPLED-DIFF-NEVER-PARTIAL-COMMIT

**Rule:** Any working-tree diff that touches ≥2 files where one file *defines* a
symbol and another file *consumes* that symbol (token, type, function, prop, RPC,
RLS policy, migration, edge fn handler, etc.) is **COUPLED**. A coupled diff MUST
be committed atomically — either all halves in one commit, or none at all. Partial
commits of coupled diffs are forbidden.

**Concrete examples of coupling:**
- `designSystem.ts` token block + `Component.tsx` consumer reads (this incident)
- `migration.sql` schema add + `service.ts` query against new column
- `edge-fn/index.ts` handler + mobile service call against new payload shape
- `types.ts` interface change + every component that reads/writes the type
- New RPC + caller that invokes it
- New CHECK constraint + service that produces values matching the constraint

**Enforcement:**

1. **Forensics + orchestrator capture step (process):** when an in-flight diff is
   captured (e.g., during investigation of a different issue), each file in the
   diff MUST be classified as either `single-half` (safe to commit alone or revert
   alone) or `coupled-with: <other-file-list>` (must move together). Capture
   without classification is incomplete.
2. **Commit-time guard (process):** before any partial-stage commit (e.g.,
   `git commit -- <pathspec>` or `git add -p` followed by commit), the developer
   MUST grep for outbound symbol references from the staged half to confirm the
   consumer half is either also staged in the same commit OR already on HEAD.
3. **CI-time guard (deferred — separate work):** future CI gate could grep for
   newly-introduced token reads in committed files where the token is undefined
   in the same commit's tree state. Tracked as a future improvement; manual
   discipline holds until then.

**Test that catches a regression:**

```bash
# Negative control: simulate the ORCH-0672 regression by removing the pending
# block from designSystem.ts while leaving the consumer reads in
# GlassSessionSwitcher.tsx — Metro bundle must fail with module-load TypeError.
# Positive control: with both halves present, Metro bundle succeeds.
cd app-mobile && npx expo export --platform ios 2>&1 | grep -E "(TypeError|Cannot read property)"
# Expected: empty (positive) or specific error pointing at the missing definition (negative).
```

**Origin:** Registered 2026-04-25 after ORCH-0672 S0 emergency — commit
`3911b696 fix(home): pin Solo + create pills` shipped only the consumer half
(`GlassSessionSwitcher.tsx +226/-66` reading `glass.chrome.pending.*` tokens at
17 sites) without the matching token-definition half (`designSystem.ts` +39-line
`pending` sub-namespace). Module-load crash bricked dev build for ~hours until
ORCH-0672 hotfix landed at commit `d566dab7`. ORCH-0669 forensics had captured
the in-flight diff but did not classify it as coupled — orchestrator + forensics
both missed the partial-commit risk. This invariant closes the regression class.

**Severity if violated:** S0 (module-load build brick), S1 (runtime call into
undefined function), or data-integrity (missing migration before service that
queries new column) depending on which symbol class is incomplete.

---

## ORCH-0669 invariant (2026-04-25) — Home + chat chrome hairline sub-perceptible

### I-CHROME-HAIRLINE-SUB-PERCEPTIBLE

**Rule:** The shared `glass.chrome.border.hairline` token defines the perimeter
edge of every Home + bottom-nav chrome surface AND the chat input capsule
(which by original-author intent shares the home-chrome design language per the
inline comment at `MessageInterface.tsx` capsule styles, "matching the
home-chrome capsule language"). Its white alpha MUST be `≤ 0.08`. Any consumer
of chrome edge styling — chrome surface (`Glass*.tsx`, `ui/Glass*.tsx`) OR
chat input chrome (`MessageInterface.tsx` capsule + reply preview + separator)
— MUST consume this token by reference; inline `rgba(255, 255, 255, X)`
literals with white alpha ≥ 0.09 on these files are forbidden.

**Cross-property note:** The token is consumed by both `borderColor` (perimeter
strokes — surfaces 1-7) and `backgroundColor` (1px-wide chat input separator —
surface 8). The invariant binds the token VALUE; the property choice is at the
consumer's discretion. Future consumers using this token as a `backgroundColor`
for a thin filled element should expect that element to be sub-perceptible at
the locked alpha — by design (Option A locked by founder 2026-04-25).

**Excluded scope (DOES NOT apply to):**
- `glass.chrome.pending.borderColor` — ORCH-0661 dashed pending-pill state,
  intentionally higher visibility (28%).
- `glass.chrome.active.border` — orange active-state border, separate token
  (`'rgba(235, 120, 37, 0.55)'`, no white-alpha concern).
- Non-chrome surfaces (`Card*.tsx`, `Badge*.tsx`, modals, sheets, profile,
  discover) — different design languages, separate token systems.
- Sibling `topHighlight` tokens in `glass.badge.border.*`, `glass.profile.card.*`,
  `glass.profile.cardElevated.*` namespaces — governed by their own design specs.

**Why it exists:** Two prior incidents created visible white-line artifacts on
Home chrome:
1. ORCH-0589 V5 deleted the L3 top-highlight overlay because it produced a
   visible white line at chrome scale.
2. ORCH-0669 (this work) lowered the L4 hairline alpha from 0.12 to 0.06
   because at 0.12 it produced a visible white seam.

The pattern: edge-definition layers on Home chrome must remain *sub-perceptible*
— the chrome should feel "edge-defined" without anyone consciously seeing an
edge. This invariant locks that bar going forward. Any new chrome element added
later (e.g., `GlassFloatingActionButton`) must consume
`glass.chrome.border.hairline` and not exceed the alpha cap.

**Enforcement:**
1. **Token value cap (in code):** the token at `app-mobile/src/constants/designSystem.ts`
   `glass.chrome.border.hairline` is locked at `'rgba(255, 255, 255, 0.06)'`
   with a justification comment block warning future readers.
2. **CI grep gate** in `scripts/ci-check-invariants.sh` block
   `I-CHROME-HAIRLINE-SUB-PERCEPTIBLE` — fails if any chrome consumer file
   (`Glass*.tsx` in `components/`, `Glass*.tsx` in `components/ui/`, or
   `MessageInterface.tsx`) inlines a `borderColor: 'rgba(255, 255, 255, 0.X)'`
   literal with white alpha ≥ 0.09.

**Test that catches a regression:**

```bash
# Negative control: simulate the regression by adding an inline borderColor
# at 0.10 alpha to a chrome consumer — gate exits 1.
sed -i 's|borderColor: glass.chrome.border.hairline,|borderColor: '\''rgba(255, 255, 255, 0.10)'\'',|' app-mobile/src/components/ui/GlassIconButton.tsx
bash scripts/ci-check-invariants.sh   # expect exit 1 with descriptive error
git checkout -- app-mobile/src/components/ui/GlassIconButton.tsx
bash scripts/ci-check-invariants.sh   # expect exit 0
```

**Severity if violated:** S2 (cosmetic; first-impression damage on every Home
render — chrome reads as a hard white seam against dark blur backdrop, breaks
the "premium glass" intent of SPEC_ORCH-0589 V5).

**Origin:** Registered 2026-04-25 after ORCH-0669 cycle 2 implementation.
Investigation: `reports/INVESTIGATION_ORCH-0669_HOME_HEADER_GLASS_EDGES.md`.
Spec: `specs/SPEC_ORCH-0669_HOME_CHROME_HAIRLINE.md` (v2 — Option A locked
2026-04-25 to share lower alpha across all 7 consumers, accept chat-separator
near-invisibility).

---

## ORCH-0664 invariant (2026-04-25) — DM realtime dedup ordering

### I-DEDUP-AFTER-DELIVERY

**Rule:** Dedup tracking sets (e.g., `broadcastSeenIds`, idempotency keys,
request-id sets, "already-processed" caches) MUST be populated INSIDE the
success path of the delivery they are deduping, AFTER the user-visible state
has been mutated. Pre-emptive population (before delegation) creates a class
of bug where the secondary delivery path silently skips because the dedup set
falsely reports "already delivered" when the primary path was a no-op.

**Why:** Pre-fix root cause RC-0664 — `useBroadcastReceiver.ts:51` marked
`broadcastSeenIds.add(msg.id)` BEFORE the delegate ran, the delegate was a
no-op, then `subscribeToConversation`'s postgres_changes backup saw the
seen flag and silently skipped its `setMessages` add. Result: every DM
receiver dropped every incoming message until close+reopen reload.

**Enforcement:**
1. **Code review checklist:** any `*.add(id)` adjacent to a delegate call
   must come AFTER the delegate, not before.
2. **CI grep gate** in `scripts/ci-check-invariants.sh` —
   `useBroadcastReceiver.ts` MUST NOT contain `broadcastSeenIds.current.add(`
   inside the broadcast event handler. Population is the
   `ConnectionsPage.addIncomingMessageToUI` handler's responsibility.
3. **Required-prop contract** — `MessageInterface.tsx`'s
   `onBroadcastReceive` is REQUIRED (non-optional) so TypeScript catches
   any caller that forgets to wire the callback. "No-op fallback" was the
   exact pre-fix shape that caused the bug.
4. **Protective comment blocks** at three sites (useBroadcastReceiver.ts
   handler body, ConnectionsPage.tsx `addIncomingMessageToUI` JSDoc,
   MessageInterface.tsx header comment above `useBroadcastReceiver` call).

**Test that catches a regression:**

```bash
# Negative control: re-introduce the pre-emptive add — gate exits 1.
sed -i 's|// Deliver — delegate is responsible|broadcastSeenIds.current.add(msg.id);\n        // Deliver — delegate is responsible|' app-mobile/src/hooks/useBroadcastReceiver.ts
bash scripts/ci-check-invariants.sh   # expect exit 1 with descriptive error
git checkout -- app-mobile/src/hooks/useBroadcastReceiver.ts
bash scripts/ci-check-invariants.sh   # expect exit 0
```

**Exception (legitimate pre-emptive add permitted):** when the caller has
ALREADY mutated state in another way and is ITSELF the producer of the work
the dedup set protects against. The canonical example is the SENDER's own
add at `ConnectionsPage.tsx` L1936-area (was L1907 pre-helper-insertion):
sender has already shown the message via optimistic-replace; the seen-set
add is correct because the UI mutation is local-side, not delegate-side.
The CDC echo of the sender's own write must not re-add the message.

**Severity if violated:** S1 (every receiver of every message silently
drops from UI; user sees empty chat until close+reopen reload).

**Origin:** Registered 2026-04-25 after ORCH-0664 root cause proof.
Spec: `specs/SPEC_ORCH-0664_DM_REALTIME_DEDUP.md`. Investigation:
`reports/INVESTIGATION_ORCH-0663_0664_0665_CHAT_TRIPLE.md`.

---

## ORCH-0558 invariants (2026-04-21) — Collab match promotion

### I-MATCH-PROMOTION-DETERMINISTIC

**Rule:** Meeting the collab quorum threshold (≥2 right-swipes on the same
experience in the same session) MUST produce exactly one
`board_saved_cards` row, regardless of concurrency or timing.

**Enforcement:**
- Advisory lock on `(session_id, experience_id)` at check_mutual_like
  trigger entry (migration `20260421000003_orch_0558_trigger_v3.sql`)
- Unique index `board_saved_cards_session_experience_unique` on
  `(session_id, experience_id)` (migration `20260421000002`)
- `INSERT … ON CONFLICT (session_id, experience_id) DO NOTHING` in the
  promotion path — losers fall into attach-vote branch

**Test:** `supabase/tests/concurrency/collab_match_race.sql` — 100-run
harness with dblink-spawned concurrent transactions; exactly 1 saved_card
and exactly N votes per run. Orchestrator Close gate.

### I-BOARD-SAVED-CARDS-EXPERIENCE-ID-NOT-NULL

**Rule:** No row in `board_saved_cards` may have `experience_id = NULL`.
Historical ghosts were cleaned up in migration `20260421000001`.

**Enforcement:** `ALTER TABLE board_saved_cards ALTER COLUMN experience_id
SET NOT NULL` (migration `20260421000002`).

**Test:** `SELECT count(*) FROM board_saved_cards WHERE experience_id IS
NULL` must always return 0. Any INSERT with NULL fails with `23502`.

### I-CHECK-FOR-MATCH-COLUMN-ALIGNED

**Rule:** Any code that determines "was this card promoted in this
session?" must use the same semantics as the trigger's existence check.
Post-ORCH-0558 the single server authority is
`rpc_record_swipe_and_check_match`; no client-side `board_saved_cards`
query determines match state.

**Enforcement:**
- `BoardCardService.checkForMatch` removed
- Client-side match detection goes through the RPC only

**Test:** `git grep -n "'experience_id'" app-mobile/src/services/boardCardService.ts`
must return zero lines within 20 lines of a `.from('board_saved_cards')`
match-intent read. Enforced during code review.

### I-MATCH-NOTIFICATION-FAILS-OPEN

**Rule:** If push delivery fails or is disabled, in-app notification
still fires. If in-app fails, the match toast still fires (client-local,
no external dependency).

**Enforcement:**
- `notify-dispatch` INSERTs the `notifications` row BEFORE attempting
  push (existing behavior verified 2026-04-21). The
  `useNotifications` hook subscribes via Supabase Realtime and surfaces
  new matches in-app instantly.
- `notify-session-match` emits `collab_match_notification_delivered`
  per successful in-app insert and `collab_match_notification_failed`
  per dispatch error.
- `collabSaveCard` match toast is client-local — fires from local RPC
  response, independent of push/edge-fn availability.

**Test:** Device test with airplane mode toggled after the RPC returns
matched=true — match toast still fires on the matcher's device. Non-matcher
participants see the `notifications` row via Realtime INSERT as soon as
network returns.

### I-REALTIME-COLD-FETCH-PARITY

**Rule:** Session Cards tab shows the same set of saved cards whether
reached via realtime INSERT event or via cold-open fetch.

**Enforcement:**
- `SessionViewModal.loadSavedCards` runs on modal open (cold fetch)
- `onCardSaved` realtime subscription updates on board_saved_cards INSERT
- `onMatchPromoted` (board_votes INSERT) belt catches missed INSERT
  events with a 1s debounced refetch
- Ghost rows eliminated by migration 000001, so saved_at DESC ordering
  stops hiding fresh matches behind stale entries

**Test:** Device test — match occurs while user is on Home tab, then
opens Cards tab cold — card must be present.

### I-COLLAB-MATCH-OBSERVABLE

**Rule:** Every attempted match promotion emits a telemetry event with a
machine-readable reason — engineering sees failures in production without
waiting for user reports.

**Enforcement:**
- `match_telemetry_events` table (migration 000004) receives events from:
  - `check_mutual_like` trigger (every decision path)
  - `rpc_record_swipe_and_check_match` RPC (attempt events)
  - `notify-session-match` edge fn (delivered / failed)
- Mobile `collabSaveCard` mirrors outcomes to Mixpanel
  (`Collab Match Attempt`, `Collab Match Promotion Success`,
  `Collab Match Promotion Skipped`, `Collab Match RPC Error`)

**Test:** After a successful match,
`SELECT count(*) FROM match_telemetry_events WHERE session_id = X AND
event_type = 'collab_match_promotion_success'` returns exactly 1.
Mixpanel shows the mirror events in the product funnel.

---

## Carried invariants (preserved from prior ORCH work)

- **I-02 One owner per truth** — no two systems authoritatively describe
  the same state. ORCH-0558: RPC is the single server authority for
  match state; client has no independent match-detection query path.
- **I-03 No silent failures** — every catch block surfaces the error via
  toast, telemetry, or console.warn. ORCH-0558 preserves this across the
  new RPC call, the rewired `collabSaveCard`, and the edge fn telemetry.
- **I-08 Subtract before adding** — `saveCardToBoard` and `checkForMatch`
  were removed entirely, not deprecated and left in place. No dead code
  paths left behind.
- **I-11 One auth instance** — RPC uses `auth.uid()` and validates
  against `session_participants.has_accepted`. No separate auth layer.
- **I-TRIGGER-READS-CURRENT-SCHEMA** — `check_mutual_like` must never
  reference a dropped table (ORCH-0556 origin). Enforced by the periodic
  `supabase/tests/concurrency/collab_match_race.sql` run, which would
  fail on 42P01.

---

## ORCH-0646 invariants (2026-04-23) — Column-drop cleanup discipline

### I-COLUMN-DROP-CLEANUP-EXHAUSTIVE

**Rule:** Any migration that drops a column (or renames a materialized-view
projection) MUST be paired with grep gates before its cutover migration is
considered ready:

1. Grep `mingla-admin/src/` for the dropped column name — ZERO matches.
2. Grep `app-mobile/src/` for the dropped column name — ZERO matches.
3. Grep `supabase/functions/` for the dropped column name — ZERO matches
   (allowing deletion-proving comments like `// ORCH-XXXX ch13: COLUMN dropped`).
4. Inspect every function body in `public` schema via
   `SELECT pg_get_functiondef(oid) FROM pg_proc` grep for the column name —
   ZERO matches (or only in functions scheduled for drop in the same cutover).

**Enforcement:** CI script `scripts/ci-check-invariants.sh` covers gates
(1)-(3) at the source-tree level. Gate (4) is a manual pre-cutover check
until there's automation against live DB.

**Origin:** ORCH-0640 dropped `place_pool.ai_approved` on 2026-04-23 with
mobile cleanup verified and 14 admin RPCs rewritten, but six other RPCs and
23 admin JSX sites were missed. Admin Place Pool + Signal Library broke in
prod for hours until the user surfaced it. CLOSE Grade A was awarded without
admin smoke because the tester matrix was mobile-only. ORCH-0646 completed
the cleanup and registered this invariant so column drops never again ship
with missing surface coverage.

**Regression test:** The CI script runs on every push. Any new
`ai_approved` / `ai_override` / `ai_validated` reference introduced in
`mingla-admin/src/`, `app-mobile/src/`, or the four serving edge functions
fails the gate (exit 1).

**Manual pre-cutover check (example template):**
```bash
COLUMN="ai_approved"
for DIR in mingla-admin/src/ app-mobile/src/ supabase/functions/; do
  MATCHES=$(grep -rn "$COLUMN" "$DIR" | grep -vE '\.md$' || true)
  if [ -n "$MATCHES" ]; then
    echo "FAIL: $COLUMN still referenced in $DIR:"
    echo "$MATCHES"
    exit 1
  fi
done
```

---

## ORCH-0668 invariants (2026-04-25) — RPC language discipline for hot paths

### I-RPC-LANGUAGE-SQL-FOR-HOT-PATH

**Definition:** Any PostgreSQL RPC called from a Supabase Edge Function on a
user-facing hot path with array (`text[]`, `uuid[]`) or composite parameters
MUST be `LANGUAGE sql STABLE`, OR `LANGUAGE plpgsql` with both:
  (a) `SET plan_cache_mode = force_custom_plan` in `proconfig`, AND
  (b) a `[CRITICAL — I-RPC-LANGUAGE-SQL-FOR-HOT-PATH]` justification block
      in the migration body explaining why plpgsql is required.

**Rationale:** Plpgsql functions cache query plans per session. After ≥5
invocations, plpgsql switches from custom (per-call optimized) plans to a
generic (parameter-blind) plan. For RPCs with variable-cardinality array
parameters and cost-sensitive joins (cardinality of `text[]` × table scan),
the generic plan is catastrophic — observed 100× slowdown vs equivalent
inline SQL. Combined with the 8 s `authenticator.statement_timeout` ceiling,
this turns a soft perf regression into universal hard failure (ORCH-0668).

**Hot-path RPCs subject to this invariant** (allowlist — additions require review):
- `public.query_person_hero_places_by_signal`
- `public.query_servable_places_by_signal`
- `public.fetch_local_signal_ranked`

**Exempt RPCs** (admin / cron / batch — not user-facing hot paths):
- `public.cron_refresh_admin_place_pool_mv` (has 15 min `statement_timeout`
  override; plpgsql for control flow)

**Why we re-introduce risk:** Re-introducing `LANGUAGE plpgsql` for any of
the listed hot-path RPCs without `plan_cache_mode = force_custom_plan` AND
the justification comment will:
1. Pass headless tests (raw-SQL probes don't exercise plpgsql plan caching).
2. Pass for the first 5 invocations after every connection re-use.
3. Then silently start hitting the 8 s `authenticator.statement_timeout` for
   any caller passing ≥6 array elements, returning HTTP 500 to mobile,
   surfacing as universal "Couldn't load recommendations" with no diagnostic.

**Owner:** Backend RPC layer.
**Gate:** `scripts/ci-check-invariants.sh` block I-RPC-LANGUAGE-SQL-FOR-HOT-PATH.
**Established:** ORCH-0668 (2026-04-25). Investigation:
`reports/INVESTIGATION_ORCH-0668_PAIRED_PROFILE_RECOMMENDATIONS_FAIL.md`.
Spec: `specs/SPEC_ORCH-0668_PAIRED_PROFILE_RPC_FIX.md`.
**Related:** I-THREE-GATE-SERVING (DEC-053), ORCH-0540 plpgsql wrapper precedent,
`feedback_headless_qa_rpc_gap.md` (mandatory live-fire for SQL RPCs before CLOSE).

---

### I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME

**Rule:** Every card emitted by any deck-serving edge function MUST carry
haversine-computed `distanceKm` (km) AND per-mode `travelTimeMin` (min). If
user location OR place lat/lng is missing, BOTH fields drop to `null` together.
Mobile UI branches on `null` to hide the badge. Never `0` sentinel; never
`|| t(...nearby)` fallback; never return literal `'Nearby'` from
`parseAndFormatDistance` on missing input (lines 223/230/238 for
genuinely-tiny distances deferred to ORCH-0673 i18n).

**Enforcement:** Single owner `_shared/distanceMath.ts` exports
`haversineKm`/`estimateTravelMinutes`/`TravelMode`; `_shared/stopAlternatives.ts`
re-exports. CI gate `scripts/ci-check-invariants.sh` blocks 4 patterns:
edge-fn zero literals, mobile `|| t(...nearby)`, formatters
`if (!distanceString...return 'Nearby'`, `timeAway` field assignments. Type:
`Recommendation.distance/travelTime` and `CardInfoSectionProps.distance/travelTime`
are `string | null`; `ExpandedCardData` widened + new `travelMode?: string`.

**Test:** Live `discover-cards` × 4 travel modes returns non-zero distanceKm +
travelTimeMin. Negative controls NC-1..NC-4 fire `exit 1` on regression
injection and recover `exit 0` on revert.

**Established:** ORCH-0659 + ORCH-0660 (2026-04-25, rework v2 bundles tester
F-1 fix). Artifacts:
`reports/INVESTIGATION_ORCH-0659_0660_DECK_DISTANCE_TRAVELTIME.md`,
`specs/SPEC_ORCH-0659_0660_DECK_DISTANCE_TRAVELTIME.md`,
`outputs/IMPLEMENTATION_ORCH-0659_0660_DECK_DISTANCE_TRAVELTIME_REPORT.md`,
`outputs/QA_ORCH-0659_0660_DECK_DISTANCE_TRAVELTIME_REPORT.md`.

---

## ORCH-0675 Wave 1 invariants (2026-04-25) — Android performance surgical fixes

### I-ANIMATIONS-NATIVE-DRIVER-DEFAULT

**Rule:** All `Animated.timing` and `Animated.spring` calls in the SwipeableCards
PanResponder swipe-handler region (`app-mobile/src/components/SwipeableCards.tsx`
lines 1216-1380) AND the DiscoverScreen LoadingGridSkeleton block
(`app-mobile/src/components/DiscoverScreen.tsx` lines 575-620) MUST use
`useNativeDriver: true`. Width/height animations are exempt only with explicit
`// useNativeDriver:false JUSTIFIED: <reason>` inline comment.

**Why:** JS-thread animation drops frames on mid-tier Android (Snapdragon
600-class). Native driver delegates frame interpolation to the UI thread,
restoring 60 fps gesture response. ORCH-0675 cycle-1 forensics RC-1 (swipe
deck) + RC-3 (loading skeleton).

**Enforcement:** CI gate `app-mobile/scripts/ci/check-no-native-driver-false.sh`
— greps for `useNativeDriver: false` in the two scoped regions, ignores lines
with `JUSTIFIED:` whitelist comment.

**Test that catches a regression:**

```bash
# Negative control: inject violation in SwipeableCards swipe handler
sed -i 's/useNativeDriver: true,/useNativeDriver: false,/' \
  app-mobile/src/components/SwipeableCards.tsx
bash app-mobile/scripts/ci/check-no-native-driver-false.sh
# Expected: exit 1 with "I-ANIMATIONS-NATIVE-DRIVER-DEFAULT violation"
git checkout app-mobile/src/components/SwipeableCards.tsx
bash app-mobile/scripts/ci/check-no-native-driver-false.sh
# Expected: exit 0 with "I-ANIMATIONS-NATIVE-DRIVER-DEFAULT: PASS"
```

**Related artifacts:**
`Mingla_Artifacts/specs/SPEC_ORCH-0675_WAVE1_ANDROID_PERF.md`,
`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0675_ANDROID_PERFORMANCE_PARITY.md`.

---

### I-LOCALES-LAZY-LOAD

**Rule:** Only the `en` locale's 23 namespaces may be statically imported in
`app-mobile/src/i18n/index.ts`. All other 28 languages MUST be loaded
on-demand via the `localeLoaders` map using dynamic `import()`. The
`localeLoaders` map MUST contain exactly 28 entries (one per non-en language).

**Why:** Static eager-load of all 667 locale JSONs (29 langs × 23 namespaces)
adds ~200-500 ms to cold-start parse on lower-tier ARM CPUs. Lazy-load defers
the cost to language-switch event (rare). ORCH-0675 cycle-1 forensics RC-2
(i18n eager-loads 667 JSONs).

**Enforcement:** CI gate `app-mobile/scripts/ci/check-i18n-lazy-load.sh` —
counts static `import .* from './locales/<lang>/'` lines (must equal en count
of 23) and counts `<lang>: async () =>` loader entries (must be ≥28).

**Test that catches a regression:**

```bash
# Negative control: inject a non-en static import
echo "import fr_common from './locales/fr/common.json'" >> \
  app-mobile/src/i18n/index.ts
bash app-mobile/scripts/ci/check-i18n-lazy-load.sh
# Expected: exit 1 with "non-en static locale import" violation
git checkout app-mobile/src/i18n/index.ts
bash app-mobile/scripts/ci/check-i18n-lazy-load.sh
# Expected: exit 0 with "PASS (23 static en imports, 28 lazy loaders)"
```

**Related artifacts:**
`Mingla_Artifacts/specs/SPEC_ORCH-0675_WAVE1_ANDROID_PERF.md`.

---

### I-ZUSTAND-PERSIST-DEBOUNCED

**Rule:** Zustand `persist` middleware storage MUST use the
`debouncedAsyncStorage` wrapper defined in `app-mobile/src/store/appStore.ts`,
NOT raw `AsyncStorage`. The wrapper MUST include:
1. A trailing debounce ≥250 ms on `setItem` calls
2. A `pendingWrites` Map for queued values
3. A `getItem` that reads pending values first to avoid hydration race
4. An AppState `'background'`/`'inactive'` listener that calls
   `flushPendingWrites` synchronously enough to survive process kill

**Why:** Android SQLite-backed AsyncStorage takes 20-200 ms per write on
mid-tier devices. Heavy swipe sessions write per-swipe, blocking the JS
thread. Debouncing coalesces to ~1 write per 250 ms window. AppState flush
prevents data loss on process kill. ORCH-0675 cycle-1 forensics RC-6.

**Enforcement:** CI gate
`app-mobile/scripts/ci/check-zustand-persist-debounced.sh` — verifies all 5
required elements present and that raw `createJSONStorage(() => AsyncStorage)`
is NOT used.

**Test that catches a regression:**

```bash
# Negative control: revert the wrapper to raw AsyncStorage
sed -i 's/createJSONStorage(() => debouncedAsyncStorage)/createJSONStorage(() => AsyncStorage)/' \
  app-mobile/src/store/appStore.ts
bash app-mobile/scripts/ci/check-zustand-persist-debounced.sh
# Expected: exit 1 with "raw AsyncStorage adapter still present (bypasses debounce)"
git checkout app-mobile/src/store/appStore.ts
bash app-mobile/scripts/ci/check-zustand-persist-debounced.sh
# Expected: exit 0 with "PASS"
```

**Related artifacts:**
`Mingla_Artifacts/specs/SPEC_ORCH-0675_WAVE1_ANDROID_PERF.md`.

---

## ORCH-0684 invariants (2026-04-26) — Paired-person view signal-system rewire

### I-PERSON-HERO-RPC-USES-USER-PARAMS

**Rule:** `query_person_hero_places_by_signal` MUST consume both `p_user_id` AND `p_person_id` parameters in its body — not just declare them. Specifically, the body must contain LEFT JOINs to `saved_card` (filtered by `profile_id IN (p_user_id, p_person_id)`) AND `user_visits` (filtered by `user_id IN (p_user_id, p_person_id)`) so the per-place ranking can apply joint-pair-history boosts (D-Q2 Option B).

**Why it exists:** ORCH-0684 RC-3 — the RPC declared both parameters but used neither in its body. Two different users in the same city querying the same friend got identical top-9 results. Personalization was structurally impossible at the ranking layer. Reverting to a personalization-blind body (e.g., dropping the JOINs in the saves/visits CTEs) re-introduces the regression.

**Enforcement:** CI gate `I-PERSON-HERO-RPC-USES-USER-PARAMS` in `scripts/ci-check-invariants.sh`. The gate requires structural matches:

- `saved_card sc` JOIN with `profile_id IN (p_user_id, p_person_id)` predicate present
- `user_visits uv` JOIN with `user_id IN (p_user_id, p_person_id)` predicate present

**Test that catches a regression:**

```bash
# Negative control — comment out the saves OR visits CTE JOIN body
# (replace BOOL_OR(...) computation with `false AS viewer_saved` etc.).
bash scripts/ci-check-invariants.sh
# Expected: FAIL: missing structural personalization JOINs.
```

**Established by:** ORCH-0684.

**Related artifacts:** [`Mingla_Artifacts/specs/SPEC_ORCH-0684_PAIRED_VIEW_REWIRE.md`](Mingla_Artifacts/specs/SPEC_ORCH-0684_PAIRED_VIEW_REWIRE.md), `supabase/migrations/20260501000001_orch_0684_person_hero_personalized.sql`.

---

### I-RPC-RETURN-SHAPE-MATCHES-CONSUMER

**Rule:** Edge fn mappers consuming a JSONB blob from an RPC MUST NOT reference field names that don't exist on the source schema. Specifically, `mapPlacePoolRowToCard` in `supabase/functions/get-person-hero-cards/index.ts` reads from a `place_pool` row (snake_case Google shape: `name`, `stored_photo_urls`, `primary_type`, `opening_hours`, `price_level`, `address`, etc.) and MUST NOT reference legacy `card_pool` ghost field names (`raw.title`, `raw.image_url`, `raw.category_slug`, `raw.price_tier`, `raw.tagline`, `raw.total_price_min/max`, `raw.estimated_duration_minutes`, `raw.experience_type`, `raw.shopping_list`, `raw.card_type`).

**Why it exists:** ORCH-0684 RC-1 — the legacy `mapPoolCardToCard` was forked from the deleted `card_pool` shape and never rewired when ORCH-0640 ch06 repointed the RPC source to `place_pool`. Mapper read 17 ghost fields that don't exist on `place_pool` → every card defaulted to `title:"Unknown"`, `imageUrl:null`, `category:""`, `priceTier:"chill"` (fabricated). Bug shipped through ORCH-0668's perf-only QA gate because the QA didn't include "captured cards display real content."

**Enforcement:** CI gate `I-RPC-RETURN-SHAPE-MATCHES-CONSUMER` in `scripts/ci-check-invariants.sh`. The gate isolates the `mapPlacePoolRowToCard` function body via awk extraction (start at `^function mapPlacePoolRowToCard`, end at first `^}`) and greps for `raw\.(title|image_url|category_slug|price_tier|price_tiers|tagline|total_price_min|total_price_max|estimated_duration_minutes|experience_type|shopping_list|card_type)\b`. Function-scope extraction excludes the legitimate `curatedCardToCard` helper which reads similarly-named fields from the curated-experiences edge fn output (not from `place_pool`).

**Test that catches a regression:**

```bash
# Negative control — inject `raw.tagline` (or any other ghost field) inside
# mapPlacePoolRowToCard.
bash scripts/ci-check-invariants.sh
# Expected: FAIL: mapPlacePoolRowToCard reads card_pool ghost fields: <line>
```

**Established by:** ORCH-0684.

**Related artifacts:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0684_PAIRED_VIEW_CARDS_NOT_REAL.md`](Mingla_Artifacts/reports/INVESTIGATION_ORCH-0684_PAIRED_VIEW_CARDS_NOT_REAL.md), [`Mingla_Artifacts/specs/SPEC_ORCH-0684_PAIRED_VIEW_REWIRE.md`](Mingla_Artifacts/specs/SPEC_ORCH-0684_PAIRED_VIEW_REWIRE.md).

---

### I-PERSON-HERO-CARDS-HAVE-CONTENT

**Rule:** Every card returned by `get-person-hero-cards` MUST satisfy:

- `title !== "Unknown"` AND `title !== ""` — derived from `place_pool.name`
- `imageUrl !== null` — derived from `place_pool.stored_photo_urls[0]` (non-sentinel)
- `category !== ""` — derived from `place_pool.primary_type` via `mapPrimaryTypeToMinglaCategory`
- `priceTier IN {null, 'chill', 'comfy', 'bougie', 'lavish'}` — `null` when `price_level IS NULL`, NEVER fabricated
- `isOpenNow IN {true, false, null}` — `null` when `opening_hours.openNow` is undefined, NEVER fabricated `true`

The first three are guaranteed by the three-gate filter at the RPC layer (place_pool rows that pass have populated name + stored_photo_urls + primary_type). The last two are Constitution #9 fabrication guards.

**Why it exists:** D-8 meta-discovery from ORCH-0684 investigation. ORCH-0668 closed Grade A on perf-only QA (8s → 215ms) and missed the mapper shape bug because the QA didn't visually inspect cards. Adding a CI smoke test that asserts cards-have-content catches this entire class of regression pre-merge.

**Enforcement:** Documentary contract at `supabase/functions/get-person-hero-cards/mapper.test.ts`. A live HTTP smoke test (`_smoke.test.ts`) was specified per spec §3.8 but not wired into CI in this implementation cycle — full wiring requires CI test JWTs which are not yet in the repo. Filed as ORCH-0684.D-fu-test for follow-up.

**Test that catches a regression:**

```bash
# Manual probe via real JWT — author's responsibility post-deploy:
curl -X POST https://<project>.supabase.co/functions/v1/get-person-hero-cards \
  -H "Authorization: Bearer <jwt>" \
  -d '{"pairedUserId":"<uuid>","holidayKey":"birthday","categorySlugs":["romantic","play","upscale_fine_dining"],"curatedExperienceType":"romantic","location":{"latitude":35.7796,"longitude":-78.6382},"mode":"default","excludeCardIds":[]}'
# Expected: every card.title is a real venue name; every card.imageUrl is a
# Supabase storage URL; every card.category is one of the 13 Mingla canonical
# categories.
```

**Established by:** ORCH-0684.

**Related artifacts:** [`Mingla_Artifacts/specs/SPEC_ORCH-0684_PAIRED_VIEW_REWIRE.md`](Mingla_Artifacts/specs/SPEC_ORCH-0684_PAIRED_VIEW_REWIRE.md) §3.8.

---

## I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS

**Statement:** `trimCardPayload` (in [`app-mobile/src/services/messagingService.ts`](app-mobile/src/services/messagingService.ts)) MUST NEVER extract or persist any of the following fields into the trimmed `CardPayload`: `travelTime`, `travelTimeMin`, `distance`, `distanceKm`, `distance_km`. These are recipient-relative — sender's value would fabricate for the recipient.

**Why it exists:** Constitution #9 (no fabricated data). Codifies the ORCH-0659/0660 distance/travel-time lesson at the chat-share trim boundary. A shared card opens for the recipient on a device with their own location and travel mode; the sender's distance/travel-time value would not reflect the recipient's reality and would surface as silent fabrication.

**Enforcement:** CI gate in [`scripts/ci-check-invariants.sh`](scripts/ci-check-invariants.sh) extracts the body of `trimCardPayload` via `awk` and greps for the forbidden field names. FAILS the build with file:line + invariant ID + cross-ref ORCH-0659/0660 if any match. Negative-control tested.

**Test that catches a regression:**

```bash
# In trimCardPayload body — both must return zero:
awk '/export function trimCardPayload/,/^\}/' app-mobile/src/services/messagingService.ts \
  | grep -cE '(travelTime|travelTimeMin|distance|distanceKm|distance_km)'
```

**Established by:** ORCH-0685.

**Related artifacts:** [`Mingla_Artifacts/specs/SPEC_ORCH-0685_EXPANDED_CARD_MODAL.md`](Mingla_Artifacts/specs/SPEC_ORCH-0685_EXPANDED_CARD_MODAL.md) §6.3 + §12.1, [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0685_v2_EXPANDED_CARD_MODAL.md`](Mingla_Artifacts/reports/INVESTIGATION_ORCH-0685_v2_EXPANDED_CARD_MODAL.md) §RC-2.

---

## I-LOCALE-CATEGORY-PARITY

**Statement:** Every locale's `common.json` (under `app-mobile/src/i18n/locales/<locale>/common.json`) MUST contain ALL 12 required `category_*` keys: `category_nature`, `category_icebreakers`, `category_drinks_and_music`, `category_brunch`, `category_casual_food`, `category_upscale_fine_dining`, `category_movies`, `category_theatre`, `category_creative_arts`, `category_play`, `category_brunch_lunch_casual` (legacy), `category_movies_theatre` (legacy).

**Why it exists:** `getReadableCategoryName` ([`app-mobile/src/utils/categoryUtils.ts:50`](app-mobile/src/utils/categoryUtils.ts#L50)) calls `i18n.t('common:category_${slug}')`. When the key is missing, it falls back to title-cased English. This produces mixed-language UI for non-English locales (e.g., a French user sees "Casual Food" instead of "Décontracté"). Constitution #3 — silent translation failure.

**Enforcement:** CI gate in [`scripts/ci-check-invariants.sh`](scripts/ci-check-invariants.sh) iterates 29 locales × 12 keys, FAILS with named missing key + locale.

**Test that catches a regression:**

```bash
# All 29 × 12 = 348 grep checks must pass:
REQUIRED='category_nature category_icebreakers category_drinks_and_music category_brunch category_casual_food category_upscale_fine_dining category_movies category_theatre category_creative_arts category_play category_brunch_lunch_casual category_movies_theatre'
for loc in $(ls app-mobile/src/i18n/locales/); do
  for k in $REQUIRED; do
    grep -q "\"$k\"" "app-mobile/src/i18n/locales/$loc/common.json" || echo "MISSING: $loc/$k"
  done
done
# Expected output: empty.
```

**Established by:** ORCH-0685.

**Related artifacts:** [`Mingla_Artifacts/specs/SPEC_ORCH-0685_EXPANDED_CARD_MODAL.md`](Mingla_Artifacts/specs/SPEC_ORCH-0685_EXPANDED_CARD_MODAL.md) §11.1.

---

## I-MODAL-CATEGORY-SUBCOMPONENT-WRAPS

**Statement:** Sub-component category props in `ExpandedCardModal.tsx` (specifically `<WeatherSection category={…}>` and `<TimelineSection category={…}>` — both Stroll and Picnic variants) MUST pass the result of `getReadableCategoryName(card.category)`, NOT the raw `card.category`. The CardInfoSection prop site at line 1780 is exempt — that component translates internally.

**Why it exists:** `card.category` is a canonical slug (`casual_food`, `nature`, etc.). Sub-components that receive raw slugs are latent slug-leak surfaces — any future maintainer who adds a `<Text>{category}</Text>` render in those components ships a slug to the user. Defense-in-depth at the prop boundary protects against this entire class of future leak.

**Enforcement:** CI gate greps line range 1860-2020 of `ExpandedCardModal.tsx` for any `category={card.category}` (raw) and FAILS if found. The CardInfoSection block (lines 1778-1794) is outside this range and unaffected.

**Test that catches a regression:**

```bash
# Must return zero matches:
sed -n '1860,2020p' app-mobile/src/components/ExpandedCardModal.tsx | grep -cE 'category=\{card\.category\}'
```

**Established by:** ORCH-0685.

**Related artifacts:** [`Mingla_Artifacts/specs/SPEC_ORCH-0685_EXPANDED_CARD_MODAL.md`](Mingla_Artifacts/specs/SPEC_ORCH-0685_EXPANDED_CARD_MODAL.md) §10.2.

---

### I-31 Brand-team-member invitation UI is TRANSITIONAL until B-cycle (mingla-business — Cycle 13a)

**Statement:** `useBrandTeamStore.recordInvitation` creates a pending invitation in client-side persisted store ONLY. NO email is sent. NO acceptance flow exists. NO functional sync to `brand_team_members` DB table. Mirrors I-28 verbatim for brand-level (not event-level) invitations. EXIT condition: B-cycle wires `invite-brand-member` + `accept-brand-invitation` edge functions per BUSINESS_PRD §16.4.

**Why:** Cycle 13a ships the operator-facing UI for team management ahead of the backend write path. Without I-31, future skills could mistake the local-only invitation flow for a fully wired feature. The `[TRANSITIONAL]` header on `brandTeamStore.ts` + the visible TRANSITIONAL banner on the team list route + on `InviteBrandMemberSheet` + on the audit log route are all part of the I-31 surface.

**Established by:** Cycle 13a close (2026-05-04 / DEC-092). Code: `mingla-business/src/store/brandTeamStore.ts` + `mingla-business/src/components/team/InviteBrandMemberSheet.tsx` + `mingla-business/app/brand/[id]/team.tsx` + `mingla-business/app/brand/[id]/audit-log.tsx`.

**Enforcement (Cycle 13a):**
- Convention + grep test: `brandTeamStore.ts` MUST NOT call any edge function (no `supabase.functions.invoke`). Implementor verifies in IMPL report §verification matrix.
- TRANSITIONAL banner copy verbatim: "Testing mode — invitations are stored locally for now. Emails ship in B-cycle."

**EXIT CONDITION:** B-cycle wires the two edge functions. When backend lands, `useBrandTeamStore` either contracts to a cache (Cycle 9c orderStore pattern) or is removed entirely if React Query becomes sole authority.

**Test that catches a regression:** T-38 grep for `supabase.functions.invoke` inside `brandTeamStore.ts` returns 0 hits. TRANSITIONAL banner present on team list + invite sheet + audit log routes.

---

### I-32 Mobile UI gates MUST mirror RLS role-rank semantics (mingla-business — Cycle 13a)

**Statement:** Mobile-side rank thresholds for action gates MUST match the SQL `biz_role_rank()` function values verbatim. Mobile reads `useCurrentBrandRole()` + compares against `BRAND_ROLE_RANK` constants in `src/utils/brandRole.ts` (which mirror SQL exactly: `scanner: 10, marketing_manager: 20, finance_manager: 30, event_manager: 40, brand_admin: 50, account_owner: 60`). RLS server-side is the safety net; mobile is the UX convenience layer; both MUST agree on rank thresholds.

**Why:** A mismatch between mobile gate thresholds and RLS server-side enforcement creates UX dishonesty (Const #1 dead taps) — mobile shows an action enabled, then RLS denies the underlying write. Or worse: mobile hides an action that RLS would have allowed, blocking valid operator workflows. Single source of truth (SQL `biz_role_rank`) prevents the drift.

**Established by:** Cycle 13a close (2026-05-04 / DEC-092). Source of truth: `supabase/migrations/20260502100000_b1_business_schema_rls.sql:11-30`. Mobile mirror: `mingla-business/src/utils/brandRole.ts` (header comment cites the source line numbers).

**Enforcement (Cycle 13a):** Convention + CI grep test. Both outputs below MUST agree on the 6 (role, rank) pairs:

```bash
# Mobile-side
grep -E "(scanner|marketing_manager|finance_manager|event_manager|brand_admin|account_owner): \d+" \
  mingla-business/src/utils/brandRole.ts

# SQL source of truth
grep -E "WHEN .(scanner|marketing_manager|finance_manager|event_manager|brand_admin|account_owner). THEN \d+" \
  supabase/migrations/20260502100000_b1_business_schema_rls.sql
```

**Test that catches a regression:** T-34 SQL parity grep — values disagree → CI fails.

**Cycle 13 amendment (2026-05-04 / DEC-095):** NEW `MIN_RANK.VIEW_RECONCILIATION = finance_manager (30)` declared client-side (D-13-3). **Forward-compat note:** because Cycle 13 reconciliation is reads-only over local Zustand stores (no server reads), there is NO server RLS counterpart yet — the gate is mobile-UX only. When B-cycle ships server-side reconciliation RPC (e.g., `compute_event_reconciliation` SECURITY DEFINER wrapper backed by `biz_is_finance_manager_plus_for_caller` or equivalent), the RLS policy MUST mirror the finance_manager+ rank gate to preserve I-32. Until then, the mobile gate is the sole enforcement point for VIEW_RECONCILIATION (acceptable since the data being gated is already operator-side and reads-only over local persisted state — sub-rank operator hitting `/event/{id}/reconciliation` directly via deep-link sees a friendly NotAuthorizedShell, never a 404). Established by Cycle 13 SPEC §4.4 + DEC-095.

---

### I-33 `permissions_override` jsonb shape MUST be deny-list (mingla-business — Cycle 13a/13b — ACTIVE post-Cycle-13b CLOSE)

**Statement (DRAFT):** When `brand_team_members.permissions_override` jsonb gets a downstream consumer (UI editor + interpreter), the shape MUST be a deny-list against existing `MIN_RANK` action constants from `mingla-business/src/utils/permissionGates.ts`:

```json
{ "DENIED": ["EDIT_TICKET_PRICE", "REFUND_ORDER", "..."] }
```

Other shapes (allow-list / parameterized restrictions / `event_scope` arrays) are explicitly REJECTED. See DEC-093 + Cycle 13b forensics §4.

**Why:** Cycle 13a shipped the column unconsumed (returned by `useCurrentBrandRole.permissionsOverride` but never interpreted downstream). Cycle 13b forensics found no validated operator use case for an editor (DEFER per Q2 lock). Locking the SHAPE now means when operator surfaces a real "restrict X without changing role Y" ask, the editor ships in <1 day on top of stable contracts.

**Why deny-list (not allow-list):** Allow-list would let operators GRANT actions above the role's natural rank — that is role escalation, which `permissions_override` should never enable. Deny-list ONLY restricts; role hierarchy stays intact; semantically safer + simpler.

**Established by (DRAFT):** Cycle 13b forensics 2026-05-04 + operator lock ("Q2 — Agreed (defer + lock shape)").

**Enforcement (when ACTIVE post-13b CLOSE):** Convention. The first downstream consumer (Cycle 13c override editor or B-cycle backend interpreter) MUST follow this shape. CI gate optional — gate the consumer-side parser to reject non-deny-list shapes.

**EXIT CONDITION:** None — this is a permanent forward-compat invariant. The deny-list shape is the locked contract for `permissions_override` jsonb across all future cycles.

**Test that catches a regression (when ACTIVE):** First downstream consumer ships with a parser that rejects shapes with keys other than `DENIED`. Invariant violation = parser accepts an `ALLOWED` or `event_scope` key.

**Status:** ACTIVE post-Cycle-13b CLOSE 2026-05-04.

---

### I-34 `permissions_matrix` table DECOMMISSIONED (post Cycle 13b CLOSE)

**Statement:** The `permissions_matrix` table is dropped post-Cycle-13b. Mobile-side authority for role→action allowance is `MIN_RANK` constants in `mingla-business/src/utils/permissionGates.ts`. Backend-side authority is `biz_role_rank(p_role text)` SQL function (PR #59 lines 11-30) plus the SECURITY DEFINER helpers built on it (`biz_is_brand_admin_plus_for_caller`, `biz_is_event_manager_plus_for_caller`, etc.). NO future migration may re-create `permissions_matrix` without an explicit DEC entry overriding this invariant.

**Why:** PR #59 author shipped the table as scaffolding for runtime role→action checks. Cycle 13a chose role-rank thresholds in `permissionGates.ts` instead — proving the matrix was never load-bearing. Verified by Cycle 13b forensics: 0 mobile reads, 0 backend RLS reads, only 5 sentinel seed rows. Const #2 (one owner per truth) + Const #8 (subtract before adding) demand the drop.

**Established by:** Cycle 13b CLOSE 2026-05-04 + DEC-093 (operator-locked Q4 = Path B drop).

**Enforcement:** Convention. Optional CI gate: any future migration containing `CREATE TABLE ... permissions_matrix` requires DEC review. Mobile grep gate: `grep -rn "permissions_matrix" mingla-business/` returns 0 hits (verified post-Cycle-13b).

**EXIT CONDITION:** None — permanent decommission. Re-creation requires explicit DEC override (e.g., if operator validates a runtime-mutable permissions matrix use case in a future cycle, that cycle's spec adds a DEC + a new migration with full justification).

**Related artifacts:**
- Memory: `feedback_permissions_matrix_decommissioned.md` (flips DRAFT → ACTIVE on 13b CLOSE)
- DEC-093 (DECISION_LOG)
- Cycle 13b forensics §6 Thread 4 + Path B recommendation
- Drop migration: `supabase/migrations/20260504100000_b1_phase7_drop_permissions_matrix.sql`

**Test that catches a regression:** Migration grep — any future `supabase/migrations/*.sql` file containing `CREATE TABLE` and `permissions_matrix` should fail review unless paired with a DEC override entry.

---

### I-35 `creator_accounts.deleted_at` is the soft-delete marker (mingla-business — Cycle 14)

**Statement:** Account soft-deletion semantics are encoded in `public.creator_accounts.deleted_at` (timestamptz, nullable). Mobile UPDATEs the column via existing self-write UPDATE RLS policy (origin migration `20260404000001_creator_accounts.sql` lines 42-50). Recovery-on-sign-in auto-clears the marker if the user signs in within the 30-day window. After the 30-day window, B-cycle cron service-role flips `account_deletion_requests.status = 'completed'` + calls `auth.admin.deleteUser` → CASCADE through ~80 tables (mirrors consumer-app `delete-user` edge fn pattern at `supabase/functions/delete-user/index.ts`).

**Rules:**
- Mobile MAY UPDATE `deleted_at` to `now()` (request soft-delete) OR `null` (recovery).
- Mobile MUST NOT UPDATE `deleted_at` to any other value (no future-dated soft-deletes; no past-dated retroactive marks).
- Mobile MUST NOT INSERT into `account_deletion_requests` directly — that table is service-role-only (B-cycle edge fn writes audit rows; PR #59 RLS line 70 confirms).
- Auto-recovery fires in `AuthContext` bootstrap + onAuthStateChange after `ensureCreatorAccount(user)` — mobile does NOT prompt the user explicitly; signing in IS the recovery action (per D-CYCLE14-FOR-6 lock).

**Why:** GDPR R4 critical-path mandates a 30-day recovery window. The schema-level marker pattern (instead of a separate `is_deleted` boolean) lets B-cycle cron compute "elapsed days" trivially via `now() - deleted_at`. Recovery-as-sign-in matches industry standard (Apple ID, Google Account, Stripe).

**Established by:** Cycle 14 SPEC §4.9 + DEC-096 D-14-12/13/14 (operator-locked 2026-05-04).

**Enforcement:** Convention. Optional CI gate: grep mobile codebase for `deleted_at:` and verify the only RHS values are `new Date().toISOString()` OR `null`. Future tightening: B-cycle adds DB CHECK constraint `(deleted_at IS NULL OR deleted_at <= now())`.

**EXIT CONDITION:** None — permanent invariant. The 30-day window is a permanent product semantics; B-cycle hard-delete cron honors it.

**Test that catches a regression:** grep `\.update\({ deleted_at:` in mobile code returns ONLY `new Date().toISOString()` and `null` literals. If any future code writes a different value, the invariant is violated.

---

### I-36 ROOT-ERROR-BOUNDARY — `app/_layout.tsx` MUST wrap `<Stack>` with `<ErrorBoundary>` (mingla-business — Cycle 16a — ACTIVE post-Cycle-16a CLOSE 2026-05-04)

**Statement:** `mingla-business/app/_layout.tsx` MUST wrap the Expo Router `<Stack>` with `<ErrorBoundary>` (the kit primitive at `src/components/ui/ErrorBoundary.tsx`). Component throws anywhere in the route tree MUST hit the kit's branded fallback (`DefaultFallback`: "Something broke. We're on it." + Try again + Get help) — NOT Expo Router's generic crash UI.

**Rules:**
- The wrap MUST live inside `RootLayoutInner` (or equivalent component that consumes `useAuth()`) so the splash + AuthContext loading state can synchronize with it.
- The `onError` prop SHOULD pass `Sentry.captureException` (gated by `if (sentryDsn)` env-absent guard for TRANSITIONAL ship per DEC-098 D-16-2).
- `Sentry.captureException` MUST receive React component-stack as a `contexts.react.componentStack` hint for stack-trace readability.
- The "Get help" button MUST open `mailto:support@mingla.app` via `Linking.openURL` (or, post-Sentry-feedback-widget integration, `Sentry.captureUserFeedback`).

**Why:** Cycle 0a Sub-phase C.3 shipped the ErrorBoundary primitive (`react-error-boundary v6` wrapper with Mingla DefaultFallback) but never wired it at root in `app/_layout.tsx`. For 7+ months, component crashes have hit Expo Router's generic crash UI instead of the branded fallback — silent monitoring failure. Cycle 16a J-X3 closes this gap permanently. The invariant prevents the regression where a future refactor removes the wrap.

**Established by:** Cycle 16a SPEC §3.1.1 + DEC-098 (D-16-2 separate Sentry project locked 2026-05-04).

**Enforcement:** CI grep gate. `grep -c "<ErrorBoundary" mingla-business/app/_layout.tsx` MUST return ≥1. Recommended addition to local pre-commit hook (or `.github/workflows/` lint check when CI ships).

**EXIT CONDITION:** None — permanent invariant. The branded fallback IS the production crash UX; Sentry capture + Get help mailto are the load-bearing recovery paths.

**Test that catches a regression:** Grep gate above. Additionally: any rendered component that throws synchronously inside a tab MUST surface the DefaultFallback render path (manual smoke or RTL test).

---

### I-37 TOPBAR-DEFAULT-CLUSTER-ON-PRIMARY-TABS — `<TopBar leftKind="brand">` consumers MUST render the default `[search, bell]` cluster (mingla-business — Cycle 17b — ACTIVE post-Cycle-17b CLOSE 2026-05-05)

**Statement:** Every `mingla-business` `<TopBar>` consumer with `leftKind="brand"` (primary tab routes — currently `app/(tabs)/home.tsx`, `app/(tabs)/events.tsx`, `app/(tabs)/account.tsx`, plus dev `app/__styleguide.tsx` brand fixture) MUST render the default `[search, bell]` cluster on the right side of the top bar. Page-specific extras (e.g., the `+` icon on events tab) MUST compose via the NEW `extraRightSlot` prop, NOT replace via `rightSlot`.

**Scope:** `leftKind="brand"` consumers ONLY. `leftKind="back"` consumers (sub-route pages: Edit Brand, Audit Log, Brand Payments, Brand Profile, Brand Finance Reports, Event Detail, Team list, etc.) are OUT of scope — they intentionally suppress the default cluster via `rightSlot={null}` or `rightSlot={<View />}` for focused-task UX.

**Why this exists:** Pre-17a, `events.tsx` replaced the default cluster with a single `+` icon, removing search + bell from that tab — operator-flagged as broken founder UX (founder feedback 2026-05-04). Cycle 17a tactical fix was an inline cluster within `rightSlot={<View>...</View>}`. Cycle 17b structural fix introduces `extraRightSlot` prop and codifies the rule. Founder feedback: search + bell + `+` should all be present together on the events tab.

**CI enforcement:** `.github/workflows/strict-grep-mingla-business.yml` job `i37-topbar-default-cluster` running `.github/scripts/strict-grep/i37-topbar-cluster.mjs` — fails CI on PR if any `<TopBar leftKind="brand">` consumer passes `rightSlot=` (instead of `extraRightSlot=`). Allowlist via inline comment `// orch-strict-grep-allow leftKind-brand-rightSlot — <reason>` immediately above the offending JSX block.

**Established by:** Cycle 17b SPEC binding contract; D-CYCLE17A-FOR-3 anchor; DEC-101 lock entry.

**EXIT condition:** None — permanent invariant. If the design system ever pivots to per-tab top-bar variations, supersede via NEW invariant; do not silently relax.

**Cross-reference:** Cycle 17a §A.1 tactical fix (`events.tsx:393-417`) deleted at 17b CLOSE; Cycle 17b SPEC §A-§D; founder feedback `Mingla_Artifacts/FOUNDER_FEEDBACK.md` 2026-05-04 sub-item 2; `.github/scripts/strict-grep/README.md` registry pattern.

**Test that catches a regression:** CI grep gate above. Synthetic violation fixture: `<TopBar leftKind="brand" rightSlot={<View />} />` → exit 1 with rich error. Allowlist fixture: same JSX with `// orch-strict-grep-allow leftKind-brand-rightSlot — <reason>` comment immediately above → exit 0.

---

### I-38 ICONCHROME-TOUCH-TARGET-AA-COMPLIANT — Every `<IconChrome>` consumer MUST have effective touch area ≥ 44×44pt (mingla-business — Cycle 17c — ACTIVE post-Cycle-17c CLOSE 2026-05-05)

**Statement:** Every `mingla-business` `<IconChrome>` JSX consumer (in `mingla-business/app/` + `mingla-business/src/`) MUST resolve to an effective touchable area of ≥ 44×44pt. The primitive's baked-in default `hitSlop={{top:4,bottom:4,left:4,right:4}}` (Cycle 17c §A.1) plus `DEFAULT_SIZE = 36` yields effective `36 + 4 + 4 = 44` per dimension, satisfying WCAG AA / Apple HIG. Consumers MAY override `size=` and/or `hitSlop=`; combined effective dimensions must remain ≥ 44 OR carry an allowlist comment.

**Scope:** `mingla-business` only. `app-mobile/` + `mingla-admin/` accessibility audits are separate cycles.

**Why this exists:** Pre-17c, every IconChrome consumer rendered a 36×36 touch surface (kit-wide), below WCAG AA. Forensics report `INVESTIGATION_BIZ_CYCLE_17C_WCAG_AUDIT.md` §A documented 58 occurrences across 28 files. Motor-impaired or older users mis-tap small icons; App/Play Store reviewers flag this in automated scans. Cycle 17c bakes default `hitSlop` into the primitive (visual size unchanged) and codifies the rule with this invariant.

**CI enforcement:** `.github/workflows/strict-grep-mingla-business.yml` job `i38-icon-chrome-touch-target` running `.github/scripts/strict-grep/i38-icon-chrome-touch-target.mjs` (Babel AST traversal). Fails CI on PR if any `<IconChrome>` consumer's effective dimensions (`size + slop_left + slop_right` × `size + slop_top + slop_bottom`) fall below 44 without an allowlist comment.

**Established by:** Cycle 17c SPEC §A + §G; D-CYCLE17A-IMPL-5 + D-CYCLE17B-QA-5 forensics anchors; DEC-103 lock entry [DEC ID confirmed at CLOSE — may bump to DEC-104 if ORCH-0733 closes first].

**EXIT condition:** None — permanent invariant. If the design system ever pivots away from `IconChrome` as the canonical glass icon button, supersede via NEW invariant; do not silently relax.

**Cross-reference:** Forensics report `INVESTIGATION_BIZ_CYCLE_17C_WCAG_AUDIT.md`; SPEC `SPEC_BIZ_CYCLE_17C_WCAG_AUDIT.md` §A; `.github/scripts/strict-grep/README.md` registry pattern.

**Test that catches a regression:** CI grep gate above. Synthetic violation fixture: `<IconChrome icon="search" size={20} hitSlop={{top:0,bottom:0,left:0,right:0}} accessibilityLabel="..." />` → exit 1 with rich error showing 20×20 effective. Allowlist fixture: same JSX with `// orch-strict-grep-allow icon-chrome-touch-target — <reason>` comment immediately above → exit 0.

---

### I-39 INTERACTIVE-PRESSABLE-ACCESSIBILITY-LABEL — Every interactive `<Pressable>` / `<TouchableOpacity>` MUST have explicit `accessibilityLabel=` (mingla-business — Cycle 17c — ACTIVE post-Cycle-17c CLOSE 2026-05-05)

**Statement:** Every `<Pressable>` or `<TouchableOpacity>` JSX element in `mingla-business/app/` + `mingla-business/src/` that has an `onPress=` attribute (i.e., is interactive) MUST set an explicit `accessibilityLabel=` attribute on the same element OR carry an allowlist comment. An inner `<Text>{string-literal}</Text>` or `<Text>{template-literal}</Text>` child is permitted as P2 implicit-label fallback (logged as INFO by the gate) but explicit labels are preferred for cross-platform consistency (RN VoiceOver/TalkBack derivation is platform-version-dependent).

**Scope:** `mingla-business` only. Internal UI primitives in `mingla-business/src/components/ui/` may use allowlist comments more liberally — they expose label props to consumers; the consumers are gate-enforced.

**Why this exists:** Pre-17c, ~88 raw missing-label occurrences existed per master inventory (count later refined to ~8-10 actual gaps post-17a/17b primitive auto-pass-through). Screen-reader users (VoiceOver, TalkBack) need explicit labels to navigate confidently; implicit-Text fallback is platform-version-dependent. Cycle 17c removes the IconChrome `?? icon` silent fallback (Cycle 17c §A.1), closes the explicit gaps (§B + §C + §D), and codifies the rule with this invariant.

**CI enforcement:** `.github/workflows/strict-grep-mingla-business.yml` job `i39-pressable-label` running `.github/scripts/strict-grep/i39-pressable-label.mjs` (Babel AST traversal). Fails CI on PR if any interactive `<Pressable>` / `<TouchableOpacity>` without `accessibilityLabel=` AND without inner `<Text>` literal child AND without allowlist comment.

**Established by:** Cycle 17c SPEC §B + §C + §D + §H; forensics report §B; DEC-103 lock entry [DEC ID confirmed at CLOSE].

**EXIT condition:** None — permanent invariant.

**Cross-reference:** Forensics report `INVESTIGATION_BIZ_CYCLE_17C_WCAG_AUDIT.md`; SPEC `SPEC_BIZ_CYCLE_17C_WCAG_AUDIT.md` §B/§C/§D/§H; `.github/scripts/strict-grep/README.md`.

**Test that catches a regression:** CI grep gate above. Three fixtures verified Cycle 17c §H.3:
- Violation: `<Pressable onPress={() => {}}><View /></Pressable>` → exit 1 with rich error.
- Implicit-Text pass: `<Pressable onPress={() => {}}><Text>Save</Text></Pressable>` → exit 0 with INFO log.
- Allowlist pass: violation JSX with `// orch-strict-grep-allow pressable-no-label — <reason>` immediately above → exit 0.

---

### I-PROPOSED-A BRAND-LIST-FILTERS-DELETED — Every read of `brands` MUST filter `deleted_at IS NULL` (mingla-business — Cycle 17e-A — status: DRAFT — flips ACTIVE on Cycle 17e-A CLOSE)

**Statement:** Every code path in `mingla-business/src/services/` + `mingla-business/src/hooks/` that reads from the `brands` Supabase table MUST filter `deleted_at IS NULL` (either via `.is("deleted_at", null)` chain at the service layer OR via a JOIN with `deleted_at IS NULL` predicate when joined from another table). Unfiltered reads risk surfacing soft-deleted brands to the operator UI, breaking the soft-delete contract codified by Decision D-17d-FOUNDER-1A (DEC-105 + DEC-109).

**Scope:** `mingla-business/src/services/` + `mingla-business/src/hooks/` only. `mingla-business/app/` is presumption-allowed since it consumes services/hooks only (not raw Supabase). `app-mobile/` and `mingla-admin/` are out of scope (different products with different brand semantics).

**Why this exists:** Cycle 17e-A wires brand soft-delete via `deleted_at = now()` UPDATE. Forensics §B verified `idx_brands_account_id` and `idx_brands_slug_active` both filter `WHERE deleted_at IS NULL` so the indexes won't serve soft-deleted rows — but service code calling `.from("brands").select()` without the chain would still see them via sequential scan or via the unique-on-active-only constraint not blocking re-reads. Per `feedback_supabase_neq_null` precedent, soft-delete filters MUST use `.is("deleted_at", null)` (NEVER `.neq()` — Postgres treats `NULL != value` as NULL/falsy). Without enforcement, future engineers may add raw queries that surface ghost brands.

**CI enforcement:** NEW `.github/workflows/strict-grep-mingla-business.yml` job `i-proposed-a-brand-list-filters-deleted` running `.github/scripts/strict-grep/i-proposed-a-brand-list-filters-deleted.mjs` (Babel AST traversal mirroring i37/i38/i39 registry pattern). Fails CI on PR if any `from("brands")` call expression in scope path lacks `is("deleted_at", null)` chain AND lacks allowlist comment. Allowlist via `// orch-strict-grep-allow brands-deleted-filter — <reason>` immediately above the call expression.

**Established by:** Cycle 17e-A SPEC §5.2 + §F service contracts; forensics anchor F-A + F-B; DEC-109 lock entry [DEC ID confirmed at CLOSE — DEC-107 reserved by ORCH-0735, DEC-108 by ORCH-0736].

**EXIT condition:** None — permanent invariant. If hard-delete pattern ever supersedes soft-delete (per a future GDPR ORCH), supersede via NEW invariant; do not silently relax.

**Cross-reference:** Cycle 17e-A SPEC `SPEC_BIZ_CYCLE_17E_A_BRAND_CRUD_WIRING.md` §3.2.4-§3.2.7; forensics report `INVESTIGATION_BIZ_CYCLE_17E_A_BRAND_CRUD_WIRING.md` F-A + F-B; `.github/scripts/strict-grep/README.md` registry pattern; `feedback_supabase_neq_null` memory rule.

**Test that catches a regression:** CI grep gate. Synthetic fixtures (verified at IMPL pre-flight):
- Violation: `await supabase.from("brands").select("*").eq("account_id", id)` (no `.is("deleted_at", null)`) → exit 1 with rich error.
- Pass: `await supabase.from("brands").select("*").eq("account_id", id).is("deleted_at", null)` → exit 0.
- Allowlist pass: violation expression with `// orch-strict-grep-allow brands-deleted-filter — <reason>` comment immediately above → exit 0.

---

### I-PROPOSED-B BRAND-SOFT-DELETE-CASCADES-DEFAULT — Soft-deleting a brand MUST clear the matching `creator_accounts.default_brand_id` pointer (mingla-business — Cycle 17e-A — status: DRAFT — flips ACTIVE on Cycle 17e-A CLOSE)

**Statement:** Every soft-delete of a brand row (i.e., `UPDATE brands SET deleted_at = <ts> WHERE id = ?`) MUST be paired with `UPDATE creator_accounts SET default_brand_id = NULL WHERE default_brand_id = ?`. Without this cleanup, the operator's `default_brand_id` pointer becomes stale (pointing at a soft-deleted brand); on cold-start, the app tries to default to a brand the SELECT chain filters out, leaving the operator stuck in a "select a brand" empty state.

**Scope:** mingla-business service layer (`brandsService.ts:softDeleteBrand`). The default_brand_id cleanup is service-layer responsibility, not implicitly cascaded by FK (`creator_accounts.default_brand_id` FK uses `ON DELETE SET NULL` which fires only on hard-delete, not soft-delete UPDATE).

**Why this exists:** Forensics finding F-H surfaced this as S2-medium hidden flaw. Real-world scenario: operator soft-deletes their default brand → next cold-start hydrates `useCreatorAccount().data.default_brand_id` to the now-soft-deleted brand id → `useBrand(id)` returns null (RLS + .is filter) → UI lands on "select a brand" prompt with no obvious next step. The fix is service-layer paired UPDATE, not schema-level cascade.

**Test enforcement:** SC-SVC-8 + T-12 in Cycle 17e-A SPEC enforce functionally. No structural CI gate (logic-level constraint not grep-able as a single pattern). Tester verifies via service-level test: soft-delete a brand that IS the user's default; assert `creator_accounts.default_brand_id` becomes NULL post-call.

**Established by:** Cycle 17e-A SPEC §3.2.7 Step 3 + §5.2 + T-12 + R-3 mitigation; forensics anchor F-H; DEC-109 lock entry.

**EXIT condition:** None — permanent invariant unless hard-delete pattern ever supersedes soft-delete (FK SET NULL would fire automatically and obviate this). Then supersede via NEW invariant.

**Cross-reference:** Cycle 17e-A SPEC §3.2.7 (verbatim Step 3 in `softDeleteBrand`); forensics report F-H; baseline migration line 13266 (`creator_accounts.default_brand_id` FK with `ON DELETE SET NULL`).

**Test that catches a regression:** Service-layer test T-12 in SPEC §6. Future regression risk: if the paired UPDATE is removed from `softDeleteBrand`, T-12 fails immediately. No CI gate — relies on tester rigor + SPEC §3.2.7 verbatim contract.

---

### I-PROPOSED-C BRAND-CRUD-VIA-REACT-QUERY — Brand list state lives in React Query, NOT Zustand (mingla-business — Cycle 17e-A — status: DRAFT — flips ACTIVE on Cycle 17e-A CLOSE)

**Statement:** The `mingla-business` brand list (post-Cycle-17e-A) is server state owned by the React Query hook `useBrands(accountId)` per Const #5 (server state stays server-side). The Zustand `currentBrandStore` keeps ONLY selection state (`currentBrand: Brand | null`). The legacy `setBrands(brands: Brand[])` action and `brands: Brand[]` array MUST NOT exist post-17e-A. CI gate enforces zero `setBrands\(` references in `mingla-business/src/`.

**Scope:** `mingla-business/src/` only. App/route layer (`mingla-business/app/`) is presumption-allowed since it consumes hooks/store only (post-IMPL it imports `useBrands` instead of `useBrandList`).

**Why this exists:** Pre-17e-A, `currentBrandStore` held a `brands: Brand[]` array as TRANSITIONAL local cache, with 5 setBrands callers writing phone-only state (forensics F-A). Cycle 17e-A wires real DB CRUD; brands becomes server state per Const #5; `setBrands` becomes vestigial. The CI gate prevents future engineers from re-introducing a parallel Zustand-side cache that diverges from React Query truth.

**CI enforcement:** NEW `.github/workflows/strict-grep-mingla-business.yml` job `i-proposed-c-brand-crud-via-react-query` running `.github/scripts/strict-grep/i-proposed-c-brand-crud-via-react-query.mjs`. Fails CI on PR if any line in `mingla-business/src/` matches `\bsetBrands\s*\(` (regex; both call expression and method definition). Allowlist via `// orch-strict-grep-allow setBrands-call — <reason>` (none expected post-17e-A).

**Established by:** Cycle 17e-A SPEC §3.6 + §5.2 + Const #5 enforcement; forensics anchor F-A + F-E + §8.3 architecture proposal; DEC-109 lock entry.

**EXIT condition:** None — permanent invariant. If a future architecture pivot returns brand list to Zustand (unlikely; Const #5 is constitutional), supersede via NEW invariant + Const amendment.

**Cross-reference:** Cycle 17e-A SPEC §3.6 (v12→v13 migrate function); forensics §F + §8.3; Constitution Rule #5 (server state server-side).

**Test that catches a regression:** CI grep gate above. Synthetic violation fixture: `setBrands([newBrand]);` line in any `.ts`/`.tsx` under `mingla-business/src/` → exit 1 with rich error. Allowlist pass: same line with `// orch-strict-grep-allow setBrands-call — <reason>` immediately above → exit 0.

---

### I-PROPOSED-D MB-ERROR-COVERAGE — Every catch in mingla-business MUST call `logError` (mingla-business — ORCH-0728 — status: DRAFT — flips ACTIVE on ORCH-0728 CLOSE)

**Statement:** Every catch block in `mingla-business/src/` + `mingla-business/app/` MUST call `logError(error, { surface, extra? })` within the first 5 lines of the catch body. The `logError` primitive lives at `mingla-business/src/utils/logError.ts` and writes structured `[mb-error]`/`[mb-warn]`/`[mb-info]` lines to console with a stable surface tag (`ComponentName#methodName` / `hookName#phase` / `serviceName#functionName`). Allowlist comment for intentional swallows (e.g., `Linking.openURL().catch(() => {})`). CI gate enforces.

**Migration discipline addendum (DOCUMENTED, NOT CI-enforced this cycle):** Every Supabase migration file that contains `ALTER TABLE ... ADD COLUMN` MUST end with `NOTIFY pgrst, 'reload schema';` so PostgREST's schema cache picks up new columns immediately. Without this, INSERTs with new columns return `PGRST204` "column not found in schema cache" until the cache organically reloads (minutes-to-hours).

**Scope:** `mingla-business/src/` + `mingla-business/app/` only. `app-mobile/` and `mingla-admin/` are out of scope (separate products with their own logging strategies — `app-mobile` already has `edgeFunctionError.ts` duck-typing pattern).

**Why this exists:** ORCH-0728 root cause investigation surfaced ~50 catch sites across mingla-business that swallow `error.message` without logging. The brand-create "glitch" symptom was undiagnosable because the actual PGRST204 / 42501 / 23505 error never reached terminal — it was swallowed by `catch (error) { setSlugError("Couldn't create brand…") }`. Const #3 (no silent failures) was violated repeatedly. The structural fix is a logging primitive + CI gate so future engineers cannot re-introduce silent catches. The migration discipline rule prevents the precipitating PostgREST cache lag from recurring on future ADD COLUMN migrations (closes ORCH-0728's F-1 root-cause class structurally).

**CI enforcement:** NEW `.github/workflows/strict-grep-mingla-business.yml` job `i-proposed-d-mb-error-coverage` running `.github/scripts/strict-grep/i-proposed-d-mb-error-coverage.mjs` (regex-based per registry pattern — `setBrands\(`-style precedent). Fails CI on PR if any catch block in scope path lacks a `logError(...)` call within first 5 lines AND lacks allowlist comment. Allowlist via `// orch-strict-grep-allow mb-error-coverage — <reason>` immediately above the `catch` keyword.

**Established by:** ORCH-0728 SPEC §3.3 + §7 + I-PROPOSED-D; forensics anchor F-4 (catch-swallows-error) + §6 logging-site survey (~50 sites); DEC-110 lock entry [DEC ID confirmed at CLOSE].

**EXIT condition:** None — permanent invariant. If a future cycle introduces a remote sink (Sentry/DataDog), the primitive's signature is forward-compatible (§3.2.3 `LogErrorRemoteSink` interface reserved); the invariant + CI gate remain unchanged.

**Cross-reference:** ORCH-0728 SPEC `SPEC_ORCH_0728_BRAND_CREATE_FIX_AND_MB_ERROR_LOGGING.md` §3.2 (primitive) + §3.3 (gate) + §3.6 (12-site first-cycle migration) + §3.7 (migration discipline rule); investigation report `INVESTIGATION_ORCH_0728_BRAND_CREATE_GLITCH_AND_LOGGING.md` F-4 + §6 + §10 regression prevention; `.github/scripts/strict-grep/README.md` registry pattern; Constitution Rule #3 (no silent failures); `app-mobile/src/utils/edgeFunctionError.ts` duck-typing precedent.

**Test that catches a regression:** CI grep gate. Synthetic fixtures (verified at IMPL pre-flight per SPEC T-03 + T-04):
- Violation: `try { x() } catch (e) { console.log(e); }` (no logError call) → exit 1 with rich error.
- Pass: `try { x() } catch (e) { logError(e, { surface: "Test#fn" }); }` → exit 0.
- Allowlist pass: violation block with `// orch-strict-grep-allow mb-error-coverage — <reason>` comment immediately above the `catch` keyword → exit 0.

**Site migration phasing:** ORCH-0728 IMPL ships first 14 high-priority sites (per PASS-3 spec H-1 to H-14 catalog: BrandSwitcherSheet × 2, useBrands × 4, BrandEditView, BrandDeleteSheet, creatorAccount, AuthContext × 4, account.tsx, currentBrandStore migrate). Remaining ~40 sites migrate piecemeal via subsequent cycles tracked as `ORCH-0728-followup` until the gate is structurally clean across the full scope path. **PASS-3 update (2026-05-05):** site count revised from 12 to 14 after PASS-3 brutal forensic audit identified 2 additional sites (`useSoftDeleteBrand#onError` previously missing entirely; `useBrandCascadePreview#parallelQueries` throws without log).

---

### I-PROPOSED-E STUB-BRAND-PURGED — Stub brand IDs (`lm`/`tll`/`sl`/`hr`) MUST NOT survive in any persisted state post-17e-A (mingla-business — ORCH-0728 PASS-3 — status: DRAFT — flips ACTIVE on ORCH-0728 CLOSE)

**Statement:** The stub brand IDs `lm`, `tll`, `sl`, `hr` (defined pre-17e-A in `mingla-business/src/store/brandList.ts` as `STUB_BRANDS`) MUST NOT survive in any persisted Zustand state post-17e-A. The `currentBrandStore` persist migrate function MUST nuke any `currentBrand` whose `id` matches a stub ID (set `currentBrand = null` on detection). The orphan `brandList.ts` file MUST be deleted (zero live importers per PASS-3 §3.1 file 4).

**Scope:** `mingla-business/src/` only. App-mobile and mingla-admin do not have brand stubs.

**Why this exists:** Pre-17e-A, the dev-seed button populated `currentBrand = STUB_BRANDS[i]` (e.g., Lonely Moth with `id="lm"`). Cycle 17e-A IMPL removed the seed button + dropped the `brands` array from store v12→v13 — but the persist migrate at `currentBrandStore.ts:379-385` PRESERVED the stub `currentBrand` selection as-is, regardless of whether that stub `id` corresponded to a real `brands` row. PASS-3 forensics F-6 confirmed this is the cause of the "Lonely Moth stays connected" regression: TopBar renders the persisted stub-brand currentBrand, but `useBrand("lm")` returns null (no DB row). Cascading effect at PASS-3 F-7: `useCurrentBrandRole` stub-mode synthesis fallback (lines 158-164) granted `account_owner` rank=60 to the non-existent brand. Without I-PROPOSED-E, future ORCH cycles that interact with `currentBrand.id` will hit this same ghost-brand failure mode.

**CI enforcement:** No CI gate (logic-level constraint not grep-able as a single pattern). Tester verifies via SC-D-2 unit test in SPEC §4: cold-start with v13 cache containing `currentBrand={id:"lm",...}` → after migrate runs → `currentBrand=null`.

**Established by:** ORCH-0728 PASS-3 brutal investigation §3.1 file 3 + F-6 + F-7; SPEC `SPEC_ORCH_0728_FULL_FIX.md` §3.8 (persist migrate v13→v14) + §3.9 (delete brandList.ts) + Scope D; DEC-110 lock entry [DEC ID confirmed at CLOSE].

**EXIT condition:** None — permanent invariant. If stub brand IDs are ever re-introduced for a different testing purpose, supersede with new IDs that don't collide with `lm`/`tll`/`sl`/`hr` AND amend this invariant with the new set + supersede note.

**Cross-reference:** ORCH-0728 PASS-3 SPEC `SPEC_ORCH_0728_FULL_FIX.md` §3.8 + §3.9 (delete `brandList.ts`); investigation report `INVESTIGATION_ORCH_0728_PASS_3_BRUTAL.md` F-6 + F-7; Constitution Rule #9 (no fabricated data — stub-brand currentBrand pointing at non-existent row IS fabricated UI state); `currentBrandStore.ts` v13→v14 migrate semantic.

**Test that catches a regression:** SC-D-2 unit test (per SPEC §4):
- Setup: AsyncStorage cache contains `mingla-business.currentBrand.v13 = { state: { currentBrand: { id: "lm", displayName: "Lonely Moth", ... } }, version: 13 }`
- Action: app cold-start → store hydrates → migrate function runs (v13 → v14)
- Assertion: post-hydrate `useCurrentBrandStore.getState().currentBrand === null`
- Inverse test (preservation): same cache shape with `currentBrand.id = "<real-uuid>"` → post-hydrate currentBrand preserved verbatim

### I-PROPOSED-H — RLS-RETURNING-OWNER-GAP-PREVENTED (ACTIVE)

**Status:** ACTIVE post-ORCH-0734 CLOSE 2026-05-06 (operator-attested CONDITIONAL PASS via successful brand-create UI smoke after migration applied)

**Statement:** Every authenticated mutation policy (`CREATE POLICY ... FOR INSERT|UPDATE|DELETE`) on a `public.*` schema table MUST be paired with at least one SELECT policy whose USING clause uses `auth.uid()` directly (not via a SECURITY DEFINER helper function), AND every UPDATE policy whose WITH CHECK uses a helper function MUST also be paired with a direct-predicate fallback policy if the mutation can change a column referenced in the helper's predicate.

**Why:** SECURITY DEFINER + STABLE helper functions called from RLS policies have two failure modes:
(1) In INSERT...RETURNING context, the helper may not see the just-inserted row (snapshot quirk); SELECT-for-RETURNING fails; mutation rolls back with 42501 even though WITH CHECK passed.
(2) When UPDATE sets a column the helper gates on (e.g., `deleted_at`), the helper's evaluation against the post-mutation row excludes it; WITH CHECK fails; mutation rolls back with 42501.

Direct-predicate policies (`account_id = auth.uid()`-style) bypass both failure modes.

**Enforcement:** CI gate at `.github/workflows/strict-grep-mingla-business.yml` job `i-proposed-h-rls-returning-owner-gap` running `.github/scripts/strict-grep/i-proposed-h-rls-returning-owner-gap.mjs`. Going-forward enforcement only — migrations whose 14-digit timestamp prefix is `>= 20260507000000` are scanned. Earlier migrations (the squash baseline) are exempt because they encode pre-fix historical state where this bug class was discovered but not yet fixed across the entire schema. Future ORCH cycles audit and remediate the legacy violations (~35 found in the squash baseline at the time of ORCH-0734 — registered as discoveries D-IMPL-0734-1).

**Waiver mechanism:** A migration can opt out for genuinely service-role-only tables (e.g., `audit_log`) by adding the magic comment `-- I-RLS-OWNER-GAP-WAIVER: <ORCH-ID> <reason>` immediately above the violating CREATE POLICY statement. The waiver tag must include an ORCH-ID and a human-readable reason.

**Confirmed bug class:** RC-0728 (RLS-RETURNING-OWNER-GAP) — see ROOT_CAUSE_REGISTER.md.

**Source:** ORCH-0734 (audit 2026-05-06) — investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH_0734_RLS_RETURNING_OWNER_GAP_AUDIT.md`; spec `Mingla_Artifacts/specs/SPEC_ORCH_0734_RLS_RETURNING_OWNER_GAP_FIX.md`.

**Cross-reference:** Memory file `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_rls_returning_owner_gap.md` (DRAFT until ORCH-0734 CLOSE).

**Test that catches a regression:** CI gate self-test (`node .github/scripts/strict-grep/i-proposed-h-rls-returning-owner-gap.mjs --self-test`) creates synthetic violating + passing + waivered fixture migrations, asserts the gate FAILS on violation and PASSES on compliance/waiver.

**EXIT condition:** None — permanent invariant. If a future Postgres release fixes the SECURITY DEFINER + STABLE snapshot quirk in INSERT...RETURNING context AND a future Postgres release adds a way for soft-delete-flag UPDATE WITH CHECK to evaluate against pre-update row state, the underlying mechanism for both failure modes would be eliminated and this invariant could be reconsidered. Until then: permanent.

### I-PROPOSED-I — MUTATION-ROWCOUNT-VERIFIED (ACTIVE)

**Status:** ACTIVE post-ORCH-0734-RW CLOSE 2026-05-06 (operator-attested CONDITIONAL PASS via successful brand-delete UI smoke; CI gate `i-proposed-i-mutation-rowcount-verified.mjs` enforcing going-forward)

**Statement:** Every supabase-js mutation in `mingla-business/src/services/*.ts` that targets a specific row(s) by ID (`.eq("id", X)` / `.eq("brand_id", X)` / similar) MUST verify rowcount via `.select(...)` chain (or equivalent) AND throw a structured error if rowcount is 0. Exempt: UPSERT on PK (idempotent by design — destructuring only `error` is acceptable), and explicitly-documented "fire-and-forget cleanup" mutations marked with `// I-MUTATION-ROWCOUNT-WAIVER: <ORCH-ID> <reason>` magic comment within 3 lines above the mutation.

**Why:** When supabase-js executes UPDATE/DELETE without `.select()` chain, PostgREST returns `204 No Content` on success — including when 0 rows match the WHERE clause + RLS. supabase-js returns no error. If the service code only destructures `error`, it silently treats 0-row updates as success. The user sees a green Toast / sheet close / navigation, believes the mutation happened, but DB state is unchanged. This is a worse failure mode than 42501 because it provides false-positive confirmation.

**Confirmed instances (closed by this fix):**
- `softDeleteBrand` in `brandsService.ts` — was destructuring only `error`; now chains `.select("id")` + throws on 0 rows.

**Enforcement:** CI gate at `.github/workflows/strict-grep-mingla-business.yml` job `i-proposed-i-mutation-rowcount-verified` running `.github/scripts/strict-grep/i-proposed-i-mutation-rowcount-verified.mjs`. Scans `mingla-business/src/services/*.ts` for `.update(`/`.delete(` patterns and asserts they are followed (within reasonable proximity in the same statement chain) by either `.select(`, `.maybeSingle(`, or the magic waiver comment.

**Source:** ORCH-0734 REWORK (audit + spec 2026-05-06) — investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH_0734_REWORK_DELETE_PATH_BRUTAL.md`; spec `Mingla_Artifacts/specs/SPEC_ORCH_0734_REWORK_DELETE_FIX.md`.

**Cross-reference:** Memory file `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_rls_returning_owner_gap.md` extended (DRAFT) with rowcount-verification appendix at ORCH-0734-RW IMPL.

**Active waivers (post-IMPL):**
- `brandsService.ts` step 3 clear-default_brand_id — permanent waiver, fire-and-forget cleanup idempotent by design
- `creatorAccount.ts` updateCreatorAccount — TEMPORARY waiver pending follow-up cycle (D-IMPL-0734-RW-1 side discovery)

**EXIT condition:** Permanent invariant. The PostgREST + supabase-js contract that produces silent 0-row success is unlikely to change.

### I-PROPOSED-O — STRIPE-EMBEDDED-COMPONENTS-VIA-OFFICIAL-SDK-ONLY (DRAFT — flips ACTIVE on B2a CLOSE)

**Status:** DRAFT (pre-written at B2a SPEC dispatch authoring; flips to ACTIVE on B2a CLOSE per orchestrator standard close protocol).

**Statement:** Mingla MUST NOT DIY-wrap `@stripe/connect-js` in `react-native-webview` / `WKWebView` / Android WebView. Connect Embedded Components are exposed via either: (a) Stripe's prescribed native preview SDK component (`@stripe/stripe-react-native` `<ConnectAccountOnboarding>` once GA — Path A future upgrade), OR (b) Mingla-hosted web page rendering web SDK (`@stripe/connect-js` + `@stripe/react-connect-js`) opened via `expo-web-browser` (system browser, sandboxed, NOT host-app-controlled — Path B current).

**Why:** Stripe explicitly prohibits embedded WebView wrapping per [docs.stripe.com/connect/get-started-connect-embedded-components](https://docs.stripe.com/connect/get-started-connect-embedded-components). Verbatim: *"You can't use Connect embedded components in embedded web views inside mobile or desktop applications."* Violations risk technical disable (Stripe iframes can detect WebView contexts and refuse to render) + Connect Platform Agreement breach.

**Enforcement:** CI gate at `.github/workflows/strict-grep-mingla-business.yml` job `i-proposed-o-stripe-no-webview-wrap` running `.github/scripts/strict-grep/i-proposed-o-stripe-no-webview-wrap.mjs`. Scans `mingla-business/src/` + `mingla-business/app/` for files importing BOTH `@stripe/connect-js` (or `@stripe/react-connect-js`) AND `react-native-webview`. Allowlist tag (file-level): `// orch-strict-grep-allow stripe-connect-js-with-webview — <reason>`.

**Source:** B2a SPEC §8.2 + spike report `Mingla_Artifacts/reports/SPIKE_CYCLE_B2_STRIPE_CONNECT_SDK.md` §6 G-1.

**EXIT condition:** Permanent invariant. Stripe's prohibition is documented public policy; reversal would require Stripe to publicly endorse WebView wrapping (no precedent).

### I-PROPOSED-P — STRIPE-STATE-CANONICAL-IS-CONNECT-ACCOUNTS (DRAFT — flips ACTIVE on B2a CLOSE)

**Status:** DRAFT (pre-written at B2a SPEC dispatch authoring; flips to ACTIVE on B2a CLOSE).

**Statement:** `stripe_connect_accounts` is the SINGLE canonical source of truth for Stripe Connect state. `brands.stripe_charges_enabled`, `brands.stripe_payouts_enabled`, `brands.stripe_connect_id` are denormalized cache columns mirrored ONLY by the DB trigger `tg_sync_brand_stripe_cache` (introduced in B2a migration `20260508000000`). Direct UPDATE/INSERT of `brands.stripe_*` by application code is FORBIDDEN — only the DB trigger writes them.

**Why:** Constitutional #2 (one owner per truth). Without this gate, app code could update `brands.stripe_charges_enabled=true` without a corresponding `stripe_connect_accounts` update, producing drift between cache and canonical state. The fast-list-rendering optimization (mapBrandRowToUi reads cache to avoid joining stripe_connect_accounts on every brand list query) is fragile if cache drifts.

**Enforcement:** CI gate at `.github/workflows/strict-grep-mingla-business.yml` job `i-proposed-p-stripe-state-canonical` running `.github/scripts/strict-grep/i-proposed-p-stripe-state-canonical.mjs`. Scans `mingla-business/src/` + `mingla-business/app/` + `supabase/functions/` for `.update()` / `.upsert()` / `.insert()` calls on `from("brands")` that include any of `stripe_connect_id` / `stripe_charges_enabled` / `stripe_payouts_enabled` in the payload, AND for SQL `UPDATE brands SET ... stripe_*` patterns. Allowlist tag (line above the violating line): `// orch-strict-grep-allow brands-stripe-direct-write — <reason>`. The trigger function itself in the SQL migration is exempt (different file, not in scan dirs).

**Allowed reads:** `mapBrandRowToUi` reads `brands.stripe_*` to derive `Brand.stripeStatus` for fast list rendering (R-3 fix in B2a). The gate detects WRITES only — reads are unaffected.

**Source:** B2a SPEC §8.2 + forensics report `Mingla_Artifacts/reports/INVESTIGATION_CYCLE_B2_STRIPE_STUB.md` R-4 (Constitutional #2 candidate).

**EXIT condition:** Permanent invariant. Reversal would require schema cleanup (drop `brands.stripe_*` cache columns; force every read to join `stripe_connect_accounts`) which is a separate ORCH cycle.

### I-PROPOSED-Q — STRIPE-API-VERSION-PINNED-VIA-SHARED-CLIENT-ONLY (DRAFT — flips ACTIVE on B2a Path C CLOSE)

**Status:** DRAFT (added 2026-05-06 with B2a Path C SPEC amendment per DEC-121; flips ACTIVE on B2a CLOSE).

**Statement:** Every Stripe SDK instantiation in `supabase/functions/` MUST source the API version from `_shared/stripe.ts`'s `STRIPE_API_VERSION` constant. Inline overrides (e.g., `new Stripe(key, { apiVersion: "..." })` with a literal date string in any file other than `_shared/stripe.ts`) are FORBIDDEN. The single source of truth for the API version pin is `_shared/stripe.ts` line 23: `STRIPE_API_VERSION = "2026-04-30.preview"` (per D-B2-5 — Accounts v2 public preview).

**Why:** Two API versions in the same Mingla edge fn surface produce unpredictable behavior. The Stripe Accounts v2 endpoint (`/v2/core/accounts`) — which carries the marketplace controller properties (DEC-114) — only exists in `.preview` API versions. A function pinned to `2024-11-20.acacia` (production v1) cannot create accounts with controller properties; payouts won't split, charges won't transfer, the marketplace charge model is silently misconfigured. The B2a Path C reconciliation (`outputs/B2_RECONCILIATION_REPORT.md`) caught Taofeek's branch using `2024-11-20.acacia` inline across all 6 of his Stripe edge functions — a clean illustration of the failure mode this gate prevents.

**Enforcement:** CI gate at `.github/workflows/strict-grep-mingla-business.yml` job `i-proposed-q-stripe-api-version` running `.github/scripts/strict-grep/i-proposed-q-stripe-api-version.mjs`. Scans `supabase/functions/` for any `apiVersion: "20YY-MM-DD..."` literal outside `_shared/stripe.ts`. Allowlist tag (file-level): `// orch-strict-grep-allow stripe-inline-api-version — <reason>`.

**Source:** B2a Path C SPEC `outputs/SPEC_B2_PATH_C_AMENDMENT.md` §5 + reconciliation report `outputs/B2_RECONCILIATION_REPORT.md` §1.

**EXIT condition:** Permanent invariant within the current Stripe SDK paradigm. Would only retire if Stripe's SDK API contract removes the `apiVersion:` constructor option, OR if a future Mingla architecture splits Connect work across multiple isolated runtimes (separate microservice repos). Neither is foreseen.

### I-PROPOSED-R — STRIPE-IDEMPOTENCY-KEY-ON-EVERY-CALL (DRAFT — flips ACTIVE on B2a Path C CLOSE)

**Status:** DRAFT (added 2026-05-06 with B2a Path C SPEC amendment per DEC-121; flips ACTIVE on B2a CLOSE).

**Statement:** Every `stripe.<resource>.<method>(...)` call in `supabase/functions/` MUST pass `{ idempotencyKey: generateIdempotencyKey(brand_id, op) }` (from `_shared/idempotency.ts`) in the call's options argument. The `stripe.webhooks.*` namespace is exempt — those are local signature-verification helpers, not Stripe API calls. Test files (`*.test.ts`, `__tests__/`) are exempt by convention.

**Why:** Stripe's Idempotency-Key is the only safe-retry token. A dropped HTTPS connection mid-create leaves the caller unsure whether the resource was created. Without idempotency, the retry creates a duplicate Connect account / payout / transfer — and Stripe doesn't expose an API to delete a Connect account, so cleanup is operationally painful (manual support contact). With idempotency, retrying the same call returns the cached response, and the caller treats the second attempt as a no-op. The B2a Path C reconciliation caught Taofeek's branch with ZERO idempotency keys across 6 Stripe edge functions — concurrent calls (mobile + cron + webhook all triggering at once) would have produced duplicate-account incidents.

**Enforcement:** CI gate at `.github/workflows/strict-grep-mingla-business.yml` job `i-proposed-r-stripe-idempotency-key` running `.github/scripts/strict-grep/i-proposed-r-stripe-idempotency-key.mjs`. Scans `supabase/functions/` for every `stripe.X.Y(` call site (excluding `stripe.webhooks.*`); requires `idempotencyKey:` within 40 lines after the call open-paren. Allowlist tag (5-line above): `// orch-strict-grep-allow stripe-no-idempotency-key — <reason>`.

**Format:** `_shared/idempotency.ts` exports `generateIdempotencyKey(brandId, operation)` returning `{brand_id}:{operation}:{epoch_ms}`. Operation type is restricted to a TS union — extend the union when adding new operations.

**Source:** B2a Path C SPEC `outputs/SPEC_B2_PATH_C_AMENDMENT.md` §5 + reconciliation report `outputs/B2_RECONCILIATION_REPORT.md` §3 + B2a SPEC §4.2.1 + D-B2-22.

**EXIT condition:** Permanent invariant. Stripe's idempotency model is well-established and unlikely to change.

### I-PROPOSED-S — STRIPE-AUDIT-LOG-ON-EVERY-EDGE-FN (DRAFT — flips ACTIVE on B2a Path C CLOSE)

**Status:** DRAFT (added 2026-05-06 with B2a Path C SPEC amendment per DEC-121; flips ACTIVE on B2a CLOSE).

**Statement:** Every edge function under `supabase/functions/{brand-stripe-*,stripe-*}/` MUST import `writeAudit` from `../_shared/audit.ts` AND call `writeAudit(...)` at least once per invocation. The `audit_log` table is the tamper-evident record of Stripe state transitions (account create, status update, balance read, detach, KYC reminder send) for Constitutional #3 compliance, dispute investigation, and operator forensics.

**Why:** Stripe Connect actions move real money and create real legal records. Every state transition needs to be traceable. Without this gate, an engineer could ship a new `brand-stripe-foo/index.ts` that mutates Stripe state without a single audit row — silent action invisible to operators. The B2a Path C reconciliation caught Taofeek's branch with ZERO `writeAudit` calls across 6 Stripe edge functions. The same gap was found in Seth's existing `brand-stripe-refresh-status/index.ts` during Phase 0 of Path C and fixed inline (added writeAudit on the success path with before/after diff of charges_enabled / payouts_enabled / derived_status).

**Enforcement:** CI gate at `.github/workflows/strict-grep-mingla-business.yml` job `i-proposed-s-stripe-audit-log` running `.github/scripts/strict-grep/i-proposed-s-stripe-audit-log.mjs`. Walks `supabase/functions/` for directory names matching `^(brand-stripe-|stripe-)`. For each, the canonical entry `index.ts` is checked for: (1) an import statement bringing in `writeAudit` from `../_shared/audit.ts`, AND (2) at least one `writeAudit(` call. Both must be present. Allowlist tag (file-level): `// orch-strict-grep-allow stripe-fn-no-audit — <reason>`.

**Audit row contract:** `writeAudit({ user_id, brand_id, action: "stripe_connect.X", target_type: "stripe_connect_account", target_id: stripe_account_id, before, after })`. Action namespacing convention: `stripe_connect.{operation}` (e.g., `stripe_connect.onboard_initiated`, `stripe_connect.account_updated`, `stripe_connect.detach`, `stripe_connect.kyc_reminder_sent`, `stripe_connect.status_refreshed`).

**Sampling note for high-frequency callers:** `brand-stripe-refresh-status` is a 30s poll fallback — every refresh writing an audit row would be costly. Phase 0 implementation logs only the success path with state-change diff. If the row count proves too noisy in production, an explicit sampling rule (e.g., 1-in-N or "only when state changed") may be added with an allowlist comment + memo, but the import + at-least-one-call requirement remains.

**Source:** B2a Path C SPEC `outputs/SPEC_B2_PATH_C_AMENDMENT.md` §5 + reconciliation report `outputs/B2_RECONCILIATION_REPORT.md` §3 + B2a SPEC §4.2.1 (Const #3) + BUSINESS_PROJECT_PLAN §B.7.

**EXIT condition:** Permanent invariant. Audit logging is a Constitutional principle (#3 — no silent failures); reversal would require revising the constitution.

### I-PROPOSED-K — REQUIRE-CYCLES-BASELINED (DRAFT — flips ACTIVE on META-ORCH-0744-PROCESS CLOSE)

**Status:** DRAFT (added during META-ORCH-0744-PROCESS IMPL; flips ACTIVE on META-ORCH-0744-PROCESS CLOSE).

**Statement:** every require-cycle in `mingla-business/src/ + app/` is either (a) listed in `mingla-business/.metro-cycle-baseline.txt` (legacy cycle, awaiting structural refactor in a future ORCH) OR (b) a NEW cycle that fails CI before merge.

**Authority:** `.github/scripts/strict-grep/i-proposed-k-require-cycles.mjs` runs `madge --circular` against `mingla-business/src/ + app/` and compares to baseline. Workflow job in `.github/workflows/strict-grep-mingla-business.yml`.

**Why:** ORCH-0742 introduced a require-cycle that the SPEC §4.2 explicitly tried to prevent; nobody caught it. ORCH-0744 forensics surfaced 14 pre-existing cycles. New cycles MUST be justified or eliminated before merge, not allowed to pile up silently.

**Enforcement (3 gates):**
1. **CI script** — `i-proposed-k-require-cycles.mjs`. Fails on any new cycle vs baseline.
2. **Baseline file** — `mingla-business/.metro-cycle-baseline.txt`. Operator-owned. Lines added (new cycle accepted) or removed (cycle fixed) ALWAYS in the same PR as the import-graph change.
3. **PR review discipline** — when baseline is modified, reviewer MUST inspect why (cycle added or fixed) and verify rationale.

**Test catches a regression:** any code change introducing a NEW cycle (not in baseline) fails CI. Operator must either fix the cycle OR add it to baseline with PR-comment justification.

**Established:** META-ORCH-0744-PROCESS / 2026-05-06 (DRAFT — flips ACTIVE on CLOSE).

**Caveats:**
- Baseline format change requires bumping the script's normalization function. Tracked in script header.
- madge could miss dynamic `require()` cycles (script catches static `import` cycles only). Mingla-business uses ESM imports exclusively post-ORCH-0743 RC-1, so this is acceptable.
- The 14-cycle baseline is operationally large. ORCH-0746 (queued) will start shrinking it.

**Cross-references:** SPEC §3.1, ORCH-0744 forensics §3 RC-1 + CF-1, ORCH-0746 (queued).

### I-PROPOSED-L — DIAG-MARKERS-REAPED-AT-CLOSE (DRAFT — flips ACTIVE on META-ORCH-0744-PROCESS CLOSE)

**Status:** DRAFT (added during META-ORCH-0744-PROCESS IMPL; flips ACTIVE on META-ORCH-0744-PROCESS CLOSE).

**Statement:** `[ORCH-XXXX-DIAG]` markers introduced by an ORCH MUST be removed in the same CLOSE that closes that ORCH. Markers from PRIOR closed ORCHs (residue) require a separate dedicated cleanup cycle.

**Authority:** `.claude/skills/mingla-orchestrator/SKILL.md` Mode: CLOSE Step 1.5 (NEW per SPEC §3.2).

**Why:** ORCH-0728/0729/0730/0733/0734-RW all closed PASS while leaving 15 `[ORCH-XXXX-DIAG]` console.error blocks in production code. Each had a comment saying "removed at full IMPL CLOSE" but no CLOSE step enforced this. ORCH-0743 had to mass-delete them after the fact.

**Enforcement:** PROCESS-time (orchestrator at CLOSE), NOT CI-time. CI can't know which ORCH is closing — only the orchestrator (mid-CLOSE) has that context. Step 1.5 grep must return zero matches before CLOSE proceeds to Step 2.

**Test catches a regression:** any future CLOSE where the orchestrator skips Step 1.5 results in DIAG markers persisting. The check is in the skill prompt itself; future orchestrator sessions that follow the skill will execute Step 1.5 unconditionally.

**Established:** META-ORCH-0744-PROCESS / 2026-05-06 (DRAFT — flips ACTIVE on CLOSE).

**Caveats:**
- This is a process invariant, not a CI invariant. No automated enforcement at PR-time. Requires orchestrator skill discipline.
- Pre-cycle DIAG residue (markers from prior CLOSED ORCHs) is OUT OF SCOPE for this invariant — those need a one-time cleanup cycle (already happened in ORCH-0743 for the 15 markers from 5 ORCHs).

**Cross-references:** SPEC §3.2, ORCH-0744 forensics §M-2, ORCH-0743 CF-3 mass-delete.

### I-PROPOSED-M — PERSIST-KEY-WHITELIST-SYNC (DRAFT — flips ACTIVE on META-ORCH-0744-PROCESS CLOSE)

**Status:** DRAFT (added during META-ORCH-0744-PROCESS IMPL; flips ACTIVE on META-ORCH-0744-PROCESS CLOSE).

**Statement:** every Zustand persist `name: "mingla-business.<store>.v<N>"` literal in `mingla-business/src/store/*.ts` MUST appear as a string literal in `KNOWN_MINGLA_KEYS` set inside `mingla-business/src/utils/reapOrphanStorageKeys.ts`. No drift permitted in either direction (missing-from-whitelist OR stale-in-whitelist).

**Authority:** `.github/scripts/strict-grep/i-proposed-m-persist-key-whitelist.mjs`. Workflow job in strict-grep-mingla-business.yml.

**Why:** ORCH-0742 bumped `currentBrand.v13 → v14` but didn't update the reaper whitelist. Result: ORCH-0742's live `v14` blob reported as ORPHAN every cold-start. If anyone ever promoted the reaper from log-only to delete-mode (Cycle 17d §D explicitly plans this), it would silently wipe the live blob on every cold-start, undoing ORCH-0742 entirely. **Latent destruction risk.**

**Enforcement (2 gates):**
1. **CI script** — `i-proposed-m-persist-key-whitelist.mjs`. Fails on any persist-name not in whitelist OR any whitelist entry not matching a live persist.
2. **Per-store unit test (already shipped in ORCH-0743)** — `src/utils/__tests__/reapOrphanStorageKeys.test.ts` pins the v14 entry specifically; broader test would be added per-store as new persists are introduced.

**Test catches a regression:** any persist-key bump (e.g., `currentBrand.v14 → v15` in a future cycle) that forgets to update the whitelist fails CI on the same PR.

**Established:** META-ORCH-0744-PROCESS / 2026-05-06 (DRAFT — flips ACTIVE on CLOSE).

**Caveats:**
- Pure literal `name:` matching only. Template strings or dynamic composition not supported (none currently used; future SPEC required if pattern emerges).
- Comment-stripping pre-pass required to prevent docblock false-positives.
- Cross-domain: this gate only checks mingla-business stores. App-mobile + other domains require their own gates (future cycle).

**Cross-references:** SPEC §3.3, ORCH-0744 forensics RC-2 (the latent destruction surface), ORCH-0743 RC-2 fix + unit test.

### I-PROPOSED-N — TRANSITIONAL-EXIT-CONDITIONED (DRAFT — flips ACTIVE on META-ORCH-0744-PROCESS CLOSE)

**Status:** DRAFT (added during META-ORCH-0744-PROCESS IMPL; flips ACTIVE on META-ORCH-0744-PROCESS CLOSE).

**Statement:** every `[TRANSITIONAL]` marker in `mingla-business/src/ + app/` MUST have an exit-condition keyword (`EXIT`, `exits when`, `exit condition`, `Cycle X`, `B-cycle`, `B<N>`, `ORCH-NNNN`) within 5 lines of the marker. Const #7 enforcement (label temporary fixes — tracked, owned, exit-conditioned).

**Authority:** `.github/scripts/strict-grep/i-proposed-n-transitional-exit-condition.mjs`. Workflow job in strict-grep-mingla-business.yml.

**Why:** ORCH-0744 forensics §HF-4 found 9 of 29 `[TRANSITIONAL]` markers without exit conditions. Const #7 is honor-system without enforcement; markers become permanent quietly.

**Enforcement (2 phases):**
1. **Phase 1 (THIS CYCLE) — WARN-MODE:** `Mingla_Artifacts/.transitional-baseline.txt` lists the known violators; gate WARNS on each existing violator + FAILS on any NEW violator added vs baseline. Existing violators don't break CI.
2. **Phase 2 (post-ORCH-0748):** ORCH-0748 fixes the violators; baseline file becomes empty; gate promotes to FAIL-MODE on any TRANSITIONAL without exit condition.

**Test catches a regression:** new `[TRANSITIONAL]` marker added without an exit keyword fails CI immediately. Existing violators logged but don't block (until Phase 2 promotion).

**Established:** META-ORCH-0744-PROCESS / 2026-05-06 (DRAFT WARN-MODE — flips ACTIVE on CLOSE; flips FAIL-MODE on ORCH-0748 CLOSE).

**Caveats:**
- 5-line window is a heuristic. A marker followed by an exit-condition 6 lines later spuriously triggers; operator works around with re-formatting OR an explicit allowlist comment.
- Baseline format `file:line` requires line-number stability. Heavy refactors (cycle 17d-class) shift line numbers; baseline needs simultaneous update in those PRs.

**Cross-references:** SPEC §3.4, ORCH-0744 forensics §HF-4, ORCH-0748 (queued — TRANSITIONAL audit cycle).

### I-PROPOSED-X — WEB-EXPORT-CLEAN (DRAFT — flips ACTIVE on META-ORCH-0744-PROCESS CLOSE)

**Status:** DRAFT (added during META-ORCH-0744-PROCESS IMPL; flips ACTIVE on META-ORCH-0744-PROCESS CLOSE).

**Statement:** `expo export -p web` stderr from `mingla-business/` MUST contain ZERO `"shadow*" / "textShadow*" / "elevation"` deprecation warnings AND ZERO `Property '<X>' doesn't exist` errors traceable to mingla-business sources (admin, supabase, app-mobile out of scope; dependency-source warnings allowed).

**Authority:** `.github/scripts/strict-grep/i-proposed-x-web-deprecation.mjs`. Workflow job runs `expo export -p web` AND the parser.

**Why:** ORCH-0744 forensics §CF-2 found `textShadow*` props on `event/[id]/index.tsx` hero — RN-only props that react-native-web silently strips, making the shadow invisible on web. The Metro deprecation warning had been printed for who-knows-how-long without anyone reading it. ORCH-0743 fixed the one site; this gate prevents new instances.

**Enforcement (1 gate):**
1. **CI script + parser** — `i-proposed-x-web-deprecation.mjs`. Pipes captured stderr from `expo export -p web` through pattern matchers. Fails on any of the 4 violation classes.

**Test catches a regression:** any new RN-only style prop added to mingla-business code fails CI on the same PR. The parser also catches `Property doesn't exist` errors specifically when traced to mingla-business sources (filters out Stripe SDK / Sentry SSR / other dependency-source noise).

**Established:** META-ORCH-0744-PROCESS / 2026-05-06 (DRAFT — flips ACTIVE on CLOSE).

**Caveats:**
- `expo export -p web` is the slowest gate (~2 min on CI). Acceptable trade-off; can be moved to a slower-cadence workflow if PR cycle time becomes an issue.
- ESLint rule banning inline `elevation:` outside designSystem is deferred to a future cycle (would catch BEFORE export). For now: parser-on-stderr is the catch.
- Stub Supabase env vars required for export to complete; these are CI-only and never leak production credentials.

**Cross-references:** SPEC §3.5, ORCH-0744 forensics §CF-2, ORCH-0743 CF-2 fix.

### I-PROPOSED-T — STRIPE-COUNTRY-FROM-CANONICAL-ALLOWLIST-ONLY (DRAFT — flips ACTIVE on B2a Path C V3 CLOSE)

**Status:** DRAFT (added 2026-05-06 with B2a Path C V3 SPEC per DEC-121; flips ACTIVE on V3 CLOSE).

**Statement:** Every `country` value passed to `stripe.accounts.create()` MUST be from the canonical 34-country allowlist defined in `mingla-business/src/constants/stripeSupportedCountries.ts` (US/UK/CA/CH + 30 EEA member states). The edge function `brand-stripe-onboard` MUST validate the request body's `country` param against this allowlist before any Stripe API call. The DB CHECK constraint on `stripe_connect_accounts.country` (added in migration `20260511000001`) enforces at storage layer.

**Why:** Stripe Connect's documented self-serve cross-border payouts are limited to US, UK, EEA, Canada, and Switzerland per [https://docs.stripe.com/connect/cross-border-payouts](https://docs.stripe.com/connect/cross-border-payouts). Verbatim: *"Stripe doesn't support self-serve cross-border payouts to countries outside the listed regions."* Accepting an out-of-list country produces a Stripe account that cannot actually pay out; the brand admin completes onboarding only to find their account permanently restricted at first payout attempt. Australia + Latin America + Asia require separate Stripe platform entities (B2c/B2d/B2e future cycles); they are out of V3 scope.

**Enforcement:** Three layers:
1. **Frontend:** `BrandStripeCountryPicker` component (Sub-dispatch C) renders ONLY the 34 allowed countries from `stripeSupportedCountries.ts`.
2. **Edge function:** `brand-stripe-onboard/index.ts` (Sub-dispatch B) imports the allowlist constant + validates the request body's country param; returns 400 `validation_error` if country is not in the allowlist.
3. **Database:** CHECK constraint on `stripe_connect_accounts.country` (migration `20260511000001`) — rejects any INSERT/UPDATE with a country code outside the 34-country list.
4. **CI gate:** `i-proposed-t-stripe-country-allowlist.mjs` (Sub-dispatch C Phase 14) — strict-grep scans `mingla-business/` + `supabase/functions/` for hardcoded 2-letter country code literals; flags any not in the allowlist (with allowlist tag exemption pattern).

**Source:** B2a Path C V3 SPEC `outputs/SPEC_B2_PATH_C_V3.md` §3 + investigation Thread 17 + Stripe cross-border-payouts doc.

**EXIT condition:** Conditional. List expands when Mingla adds separate Stripe platform entities for AU + LatAm + Asia (B2c/B2d/B2e cycles). Each expansion is a separate ORCH cycle that updates the allowlist constant, the DB CHECK constraint, the strict-grep gate, and the country picker UI together.

### I-PROPOSED-U — MINGLA-TOS-ACCEPTED-BEFORE-STRIPE-CONNECT (DRAFT — flips ACTIVE on B2a Path C V3 CLOSE)

**Status:** DRAFT (added 2026-05-06 with B2a Path C V3 SPEC per DEC-121; flips ACTIVE on V3 CLOSE).

**Statement:** Every brand admin MUST have `brand_team_members.mingla_tos_accepted_at IS NOT NULL` for the brand they are managing before any Stripe Connect operation can proceed. The edge function `brand-stripe-onboard` (and any future Stripe Connect edge fn that creates platform-side state) MUST verify this gate before calling Stripe APIs. Violations return HTTP 403 with `error: "tos_not_accepted"`.

**Why:** Stripe's Connect Platform Agreement requires platforms to surface specific T&Cs disclosures to connected accounts (brand admins). Stripe's own ToS is captured automatically by Embedded Components onboarding, but Mingla's separate platform-level ToS (covering Mingla-specific terms, fee disclosures, dispute responsibility, data handling under marketplace charge model per DEC-114) must be acknowledged separately. This invariant codifies the gate so the ToS acknowledgment is structurally enforced, not merely a UI convention.

**Enforcement:**
1. **Frontend:** `MinglaToSAcceptanceGate` component (Sub-dispatch C Phase 12) renders before the country picker; "Continue" is disabled until checkbox + version are recorded; on accept, calls a new RPC or edge fn to set `brand_team_members.mingla_tos_accepted_at = now()` + `mingla_tos_version_accepted = <current_version>`.
2. **Edge function:** `brand-stripe-onboard/index.ts` (Sub-dispatch B Phase 7) `SELECT mingla_tos_accepted_at FROM brand_team_members WHERE user_id = $1 AND brand_id = $2`; if NULL, return 403.
3. **CI gate:** `i-proposed-u-mingla-tos-gate.mjs` (Sub-dispatch C Phase 14) — scans `supabase/functions/{brand-stripe-*,stripe-*}/index.ts` for direct Stripe API calls (`accounts.create`, `accountSessions.create`); verifies the function reads `mingla_tos_accepted_at` before the call.

**Grandfather clause:** Existing brand_team_members rows pre-V3 are backfilled with `mingla_tos_accepted_at = now()` + `mingla_tos_version_accepted = 'pre-v3-grandfathered'` in migration `20260511000005`. Operator-side flow at first post-V3 login prompts re-acceptance for current ToS version.

**Source:** B2a Path C V3 SPEC `outputs/SPEC_B2_PATH_C_V3.md` §3 + investigation Thread 29 + Stripe Connect Platform Agreement.

**EXIT condition:** Permanent invariant. Marketplace platforms must always have an acknowledged ToS gate; Stripe's compliance posture requires it.

### I-PROPOSED-V — STRIPE-NOTIFICATIONS-VIA-SHARED-DISPATCHER (DRAFT — flips ACTIVE on B2a Path C V3 CLOSE)

**Status:** DRAFT (added 2026-05-06 with B2a Path C V3 SPEC per DEC-121; flips ACTIVE on V3 CLOSE).

**Statement:** Every Stripe-triggered user notification (deadline warnings, bank verification failures, payout failures, account deauthorization, KYC stall reminders, account restriction, reactivation completion — 9 types total per V3) MUST go through `supabase/functions/notify-dispatch/index.ts` using a `type` value from the `STRIPE_NOTIFICATION_TYPES` constants. Direct calls to `sendPush` (push-utils.ts) or Resend email API from Stripe edge functions are FORBIDDEN.

**Why:** Centralized notification dispatch ensures: (a) consistent multi-channel delivery (email + push + in-app), (b) respects user preferences (`notification_preferences` table), (c) provides a single surface for analytics + quiet-hours + unsubscribe flows, (d) all notifications get an `audit_log` row + a persisted `notifications` table row for in-app inbox surfacing, (e) future channels (e.g., SMS) can be added in one place. Direct sendPush/Resend bypasses all of this and creates fragmentation.

**Enforcement:**
1. **Frontend:** Stripe edge functions invoke notify-dispatch via `supabase.functions.invoke('notify-dispatch', { body: { type: 'stripe.X', user_id, brand_id, title, body, ... } })`.
2. **Backend:** `notify-dispatch/index.ts` (extended in Sub-dispatch B Phase 6) routes to email (Resend) + push (push-utils.ts sendPush) + in-app (INSERT into `notifications` table). Respects `notification_preferences`.
3. **CI gate:** `i-proposed-v-stripe-notification-via-shared.mjs` (Sub-dispatch C Phase 14) — scans `supabase/functions/{brand-stripe-*,stripe-*}/index.ts` for direct calls to `sendPush`, Resend API URLs (e.g., `https://api.resend.com`), or imports from `_shared/push-utils.ts` outside notify-dispatch. Flags as violation unless wrapped via notify-dispatch.

**Source:** B2a Path C V3 SPEC `outputs/SPEC_B2_PATH_C_V3.md` §3 + investigation Thread 28 (notification subsystem reuse).

**EXIT condition:** Permanent invariant within the current Mingla notification architecture. Reversal would require re-architecting the notification subsystem (separate ORCH cycle).

### I-PROPOSED-W — NOTIFICATIONS-FILTERED-BY-APP-TYPE-PREFIX (DRAFT — flips ACTIVE on B2a Path C V3 CLOSE)

**Status:** DRAFT (added 2026-05-06 with B2a Path C V3 Sub-dispatch A hotfix per DEC-121; flips ACTIVE on V3 CLOSE).

**Statement:** The `public.notifications` table is shared across all Mingla frontends (consumer mobile app, Mingla Business mobile, admin). Each app's UI MUST filter `notifications.type` by app-specific prefix when reading the inbox. Consumer app reads MUST exclude rows where `type` matches `stripe.%` or `business.%`. Mingla Business app reads MUST include only rows where `type` matches `stripe.%` or `business.%`. Cross-app reads (e.g., admin viewing all) require explicit allowlist exception.

**Why:** Mingla's architecture uses one Supabase backend across all frontends, with one `notifications` table keyed by `auth.users.id`. A user who is both a consumer and a brand admin = same auth.users.id row = one notification inbox at the data layer. UI scoping is achieved by type prefix filtering, not separate tables. Without this filter, a consumer scrolling their inbox would see "Your KYC deadline is in 3 days" (a Stripe-business notification) alongside "Sarah liked your event" (a consumer notification) — confusing UX. Mixing concerns at the table layer is the right architectural choice (single source of truth, single notify-dispatch fn) PROVIDED apps consistently filter at the read layer.

**Naming convention:**
- `stripe.*` — Mingla Business app only (B2 cycle types: deadline warnings, bank verification, payout failed, deauthorize, etc.)
- `business.*` — Mingla Business app only (future B2/B3/B5 types)
- Everything else (no prefix or other prefix) — Mingla consumer app only (e.g., `session_match`, `friend_request_received`, `match_invite_received`, etc.)
- Admin app (mingla-admin) reads cross-app for support/observability — exempt via allowlist comment

**Enforcement:**
1. **Frontend:** consumer app's `useNotifications` hook (and equivalent) appends `.not('type', 'like', 'stripe.%').not('type', 'like', 'business.%')` to its query. Mingla Business app's `useNotifications` hook appends `.or('type.like.stripe.%,type.like.business.%')`.
2. **CI gate:** `i-proposed-w-notifications-app-type-prefix.mjs` (Sub-dispatch C Phase 14) — strict-grep scans:
   - `app-mobile/src/` for `.from("notifications")` SELECT calls without exclusion of `stripe.%` and `business.%` patterns
   - `mingla-business/src/` for `.from("notifications")` SELECT calls without inclusion of `stripe.%` or `business.%` patterns
   - Allowlist tag (line above): `// orch-strict-grep-allow notifications-cross-app-read — <reason>` (rare; only for admin/observability surfaces)
3. **Index support:** migration `20260511000003_b2a_v3_notifications.sql` adds `idx_notifications_type_btree` with `text_pattern_ops` for efficient LIKE prefix queries.

**Source:** B2a Path C V3 Sub-dispatch A hotfix 2026-05-06 (operator caught architectural collision: shared notifications table across consumer + business apps requires UI-side type-prefix filtering). Per `outputs/SPEC_B2_PATH_C_V3.md` §6 + V3 IMPL report hotfix.

**EXIT condition:** Permanent within the current single-Supabase-backend architecture. Reversal would require splitting the notifications table per app (a separate ORCH cycle that also splits notify-dispatch + push-utils) — not foreseen.

### I-PROPOSED-Y — PLATFORM-WEB-URL-FROM-ENV-ONLY (DRAFT — flips ACTIVE on B2a Path C V3 CLOSE)

**Status:** DRAFT (added 2026-05-07 with B2a Path C V3 config-drift forensics fix; flips ACTIVE on V3 CLOSE).

**Statement:** Every cross-domain web URL referenced in `mingla-business/`, `supabase/functions/`, or `app-mobile/` MUST be sourced from a single env-var-backed constant — never hardcoded. Specifically, hardcoded literals matching `business.mingla.com`, `https://mingla.com` (when used as a URL — slug-prefix UI placeholder strings like `mingla.com/{brandSlug}` in BrandEditView are exempt), or any other non-canonical Mingla domain in active code paths are FORBIDDEN.

**Why:** The B2a Path C V3 forensics audit (2026-05-07) found `business.mingla.com` and `mingla.com` referenced 19+ times across edge fns, services, components, app config, and Universal Links. Both domains are not Mingla-owned (`business.mingla.com` is NXDOMAIN; `mingla.com` resolves to a non-Mingla third-party site). The drift caused the entire Phase 16 in-app onboarding flow to fail because `brand-stripe-onboard` returned an `onboarding_url` pointing to a non-resolvable host. Without a structural rule + CI enforcement, the drift returns the moment a future implementor adds another hardcoded domain string.

**Enforcement:**
1. **Frontend constant:** `mingla-business/src/constants/platformUrl.ts` reads `EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL` (set in `app.config.ts` extra block + Vercel env vars) and exports `MINGLA_BUSINESS_WEB_URL` + `MINGLA_BUSINESS_WEB_HOST`. All consumers read this constant.
2. **Edge fn pattern:** `brand-stripe-onboard/index.ts` reads `Deno.env.get("MINGLA_BUSINESS_WEB_URL")` and throws at module load if unset (no silent fallback).
3. **CI gate:** `.github/scripts/strict-grep/i-proposed-y-platform-web-url-from-env.mjs` scans `mingla-business/src/`, `mingla-business/app/`, `supabase/functions/` for hardcoded `business.mingla.com`, `https://mingla.com`, or non-canonical platform URL literals. Exempt: `mingla-business/src/constants/platformUrl.ts`, allowlist tag `// orch-strict-grep-allow platform-web-url-historical — <reason>`, test fixtures.

**Source:** B2a Path C V3 forensics report `Mingla_Artifacts/reports/INVESTIGATION_B2A_PATH_C_V3_CONFIG_DRIFT.md` finding §3 + recommended fix §9.

**EXIT condition:** Permanent invariant. Reversal would require Mingla owning multiple production web domains for the Business product (highly unlikely; even multi-region deploys would use a single canonical apex with regional CDN routing).
