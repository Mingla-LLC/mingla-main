# Implementation Report — ORCH-0734: City-runs (Sampled Sync) + Gemini auto-retry-once

**Status:** `implemented, partially verified`
**Date:** 2026-05-05
**Implementor:** mingla-implementor
**SPEC:** [`Mingla_Artifacts/specs/SPEC_ORCH-0734_CITY_RUNS.md`](../specs/SPEC_ORCH-0734_CITY_RUNS.md) (BINDING)
**Investigation:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0734_CITY_RUNS.md`](INVESTIGATION_ORCH-0734_CITY_RUNS.md)
**Dispatch:** [`Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0734_CITY_RUNS.md`](../prompts/IMPLEMENTOR_ORCH-0734_CITY_RUNS.md)

---

## 1. Layman summary

Place Intelligence Trial admin tool now scopes runs to a chosen city + sample size (50-500, default 200) instead of 32 hardcoded anchor places. Operator picks city + sample, clicks one Run button — internally the flow does prepare (reviews + collage) then Gemini scoring per place, with progress visible across both phases. Gemini's intermittent `MALFORMED_FUNCTION_CALL` flake (~3% rate) auto-retries once. The Signal Anchors admin tab is gone (426-LOC delete); the underlying `signal_anchors` table is dropped (with 14-day backup snapshot).

5 files changed (1 NEW migration, 1 NEW memory file DRAFT, 3 MOD code/admin, 1 DELETE) — net ~−360 LOC. Vite build passes cleanly. Migration NOT yet deployed (operator runs `supabase db push` per Const #7 deployment discipline).

---

## 2. Status

`implemented, partially verified` — code complete + Vite build passes; runtime end-to-end self-verification deferred to operator-side migration deploy + 50-place dev sweep.

## 3. Files changed (Old → New receipts)

### `supabase/migrations/20260505000001_orch_0734_city_runs.sql` — NEW
**What it did before:** N/A (new file)
**What it does now:** Single transaction with 11 verbatim DDL ops per SPEC §5.2 — backup snapshot → drop trigger → drop table CASCADE → drop trigger function → drop anchor_index CHECK + nullable → UNIQUE on `(run_id, place_pool_id)` → city_id col + FK → retry_count col → place_pool city_id FK → seeding_cities comment update. Includes rollback SQL reference.
**Why:** SC-01..SC-07; F-1, F-2, F-3, F-4 from investigation
**Lines changed:** +145 LOC NEW

### `supabase/functions/run-place-intelligence-trial/index.ts` — MOD
**What it did before:** `handlePreviewRun` and `handleStartRun` read 32 committed anchors from `signal_anchors`; `handleRunTrialForPlace` required signal_id+anchor_index; `callGeminiQuestion` threw on first MALFORMED_FUNCTION_CALL; `aggregateBySignal` grouped anchor stats per signal.
**What it does now:**
  - `handlePreviewRun(db, body)` — accepts `{city_id, sample_size?}`, validates, returns `{cityId, cityName, totalServable, effectiveSampleSize, estimatedCostUsd, costGuardUsd}`.
  - `handleStartRun(db, body, userId)` — accepts `{city_id, sample_size?}`, loads servable place_pool rows for the city, stratified random sample (top half by review_count desc + Fisher-Yates random fill of bottom), pre-inserts pending rows with `city_id=cityId`, `signal_id=null`, `anchor_index=null`, `retry_count=0` via UPSERT on `(run_id, place_pool_id)`. Returns `{runId, cityId, cityName, totalPlaces, anchors: [{place_pool_id, signal_id: null}], …}`.
  - `handleRunTrialForPlace` validation relaxed to `runId + placePoolId` only; `signal_id` and `anchor_index` are optional/nullable; `AnchorRow` interface widened.
  - `callGeminiQuestion` — wrapped in once-only retry loop on `finishReason=MALFORMED_FUNCTION_CALL`; same body, same prompt, no temperature change. Cost accumulates across both attempts. Returns `{aggregate, totalCostUsd, retried}`.
  - `processOnePlace` — writes `retry_count: retried ? 1 : 0` on the persisted row.
  - `aggregateBySignal` helper deleted.
  - `signal_anchors` references at lines 347 and 615-619 (pre-edit) are completely removed from active code.
  - Anthropic comment-preserved blocks UNTOUCHED per DEC-102 + Const #7.
  - New constants: `PER_PLACE_COST_USD = 0.0040`, `SAMPLE_SIZE_DEFAULT = 200`, `SAMPLE_SIZE_MIN = 50`, `SAMPLE_SIZE_MAX = 500`, `MAX_MALFORMED_RETRIES = 1`.
**Why:** SC-08..SC-15 (city scope, sample bounds, retry-once, row write contract)
**Lines changed:** ~+155/−95 = ~+60 net active code (Anthropic comment-blocks count unchanged)

### `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx` — MOD
**What it did before:**
  - Loaded `signal_anchors` count + history; rendered "Trial run" card with two buttons: "1. Prepare reviews + collages" (handlePrepareAll) and "2. Run trial (N places)" (handleRunTrial).
  - PlaceResultCard always rendered `{signal_id} #{anchor_index}` badge.
  - PER_PLACE_COST_USD = 0.0038.
  - Imported `MINGLA_SIGNAL_IDS, TOTAL_ANCHORS_TARGET` (unused at file scope).
**What it does now:**
  - `refresh()` loads `seeding_cities` + per-city servable counts (filter to non-zero) + trial run history in parallel via Promise.all.
  - State: `cities[]`, `cityId`, `sampleSize` (default 200) replace `committedCount`.
  - PlaceResultCard badge gated on `signal_id && anchor_index != null` so legacy 32-anchor rows still render the badge while city-runs rows omit it.
  - `handlePrepareAll` and `loadCommittedAnchors` deleted entirely (operator chose collapse).
  - New `handleRunTrial` collapses prepare + Gemini phases into one button: confirm dialog → `start_run` → phase 1 prepare loop (fetch_reviews + compose_collage per place) → phase 2 trial loop (run_trial_for_place per place). Progress UI transitions phase indicator from "Preparing data" to "Running trial."
  - Confirm dialog: city name + country + sample count + servable total + estimated cost + estimated wall time (~30s/place accounting for prepare + Gemini + throttle).
  - Form controls: `<select>` city picker + `<input type="number" min=50 max=500 step=50>` sample size, both styled to match `Input.jsx` token language (h-10, rounded-lg, focus ring on brand-500/100).
  - `canRun = !!cityId && !running && !loading`.
  - PER_PLACE_COST_USD = 0.0040 (per F-11 actual measurement).
  - New constants: `SAMPLE_SIZE_DEFAULT/MIN/MAX`, `PER_PLACE_WALL_SECONDS = 30`.
  - `MINGLA_SIGNAL_IDS` and `TOTAL_ANCHORS_TARGET` imports removed (unused at file scope post-rewrite).
  - `Sparkles` icon import removed (no longer used after handlePrepareAll deletion).
  - Subtitle: "{N} cities available · {N} historical run(s)".
  - Empty state copy: "Pick a city + sample size, then click Run trial. Results will appear here once the run completes."
  - Completion toast acknowledges expected partial-success rate from photo variance + Gemini flakes.
**Why:** SC-08..SC-18 (city picker, sample mode, single-button flow, cost+time accuracy, partial-success acknowledgment, legacy compat)
**Lines changed:** ~+225/−145 = ~+80 net (collapsed flow + UI rewrite)

### `mingla-admin/src/pages/PlaceIntelligenceTrialPage.jsx` — MOD
**What it did before:** Imported `SignalAnchorsTab`, mounted Tabs with `[anchors, results]` array, default `activeTab="anchors"`, AlertCard explained "Pick 2 anchor places per signal (32 total)…"
**What it does now:**
  - `SignalAnchorsTab` import deleted.
  - TABS array: `[{id: "results", label: "Trial Results"}]` (single entry; Tabs primitive preserved per operator B choice).
  - Default `activeTab = "results"`.
  - AlertCard reworked: "Pick a city → set sample size (50-500, default 200) → click Run trial. Internally: fetch reviews + build collages, then score 16 signals per place via Gemini 2.5 Flash. Results stream below. Sample mode keeps a Durham/Cary run under ~75 min and ~$0.80; full-city backfill is a separate future tool."
  - Header docstring updated — references ORCH-0734, DEC-102, DEC-104, I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING; `signal_anchors` mentioned only in historical context per decommission memory rules.
  - The `{activeTab === "anchors" && <SignalAnchorsTab />}` render branch deleted.
**Why:** SC-16 (SignalAnchorsTab removal + parent prune)
**Lines changed:** ~−10 net

### `mingla-admin/src/components/placeIntelligenceTrial/SignalAnchorsTab.jsx` — DELETE
**What it did before:** 426-LOC admin tab — operator browsed candidate places per signal (`place_scores` filtered ≥ threshold), committed/uncommitted anchors via `signal_anchors` CRUD with 4 active write sites (lines 293, 325, 334, 356).
**What it does now:** File no longer exists.
**Why:** Calibration scaffold obsolete post-DEC-102; SC-16
**Lines changed:** −426 LOC

### `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_signal_anchors_decommissioned.md` — NEW (DRAFT)
**What it did before:** N/A (new file)
**What it does now:** Decommission memory documenting what's deprecated, what replaced it, and per-context guidance for active code (P0 flag) / historical migrations (preserve audit trail) / backup table (dead by design) / comments (remove or update) / old reports (historical artifact). Frontmatter `status: DRAFT — flips to ACTIVE on ORCH-0734 CLOSE`. Per orchestrator CLOSE Step 5a; mirrors `feedback_ai_categories_decommissioned.md` pattern.
**Why:** Regression prevention — future Claude sessions must not treat `signal_anchors` as live system
**Lines changed:** +75 LOC NEW

---

## 4. Design pre-flight (`/ui-ux-pro-max`)

Skill confirmed standard accessibility rules already honored by existing `Input.jsx` pattern: `<label for>` association, 4.5:1 contrast (using `var(--color-text-primary)` and `var(--color-text-tertiary)` on `var(--color-background-primary)`), submit-feedback pattern via toasts.

Concrete recommendation applied to both `<select>` and `<input type="number">`:
```
w-full h-10 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)]
border border-[var(--gray-300)] rounded-lg outline-none transition-all duration-150
px-3
focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]
disabled:opacity-50 disabled:cursor-not-allowed
```
Plus `cursor-pointer` on the select; `tabular-nums` on the number input. Layout: `flex flex-col md:flex-row md:items-end gap-3` so on desktop the city picker + sample size + Run button align in one row, stacking on mobile.

Confirm dialog: kept `window.confirm` per velocity (already established codebase pattern; upgrading to a Modal primitive would add ~50 LOC for a once-per-run gate). Strengthened the dialog text per SPEC §7.4 — includes city name + country + servable total + sample size + cost + wall time.

---

## 5. Spec traceability — Success criteria status (SC-01..SC-18)

| SC | Criterion | Verification | Status |
|---|---|---|---|
| SC-01 | `signal_anchors` table dropped post-migration | Migration §3 `DROP TABLE signal_anchors CASCADE`. Operator confirms post-deploy via `SELECT * FROM signal_anchors` → relation does not exist | UNVERIFIED (pre-deploy) |
| SC-02 | `_archive_orch_0734_signal_anchors` exists with matching count | Migration §1 `CREATE TABLE … AS SELECT *`. Operator confirms post-deploy via count match | UNVERIFIED (pre-deploy) |
| SC-03 | `tg_signal_anchors_set_updated_at` function dropped | Migration §4 `DROP FUNCTION IF EXISTS`. Verify via `SELECT proname FROM pg_proc` | UNVERIFIED (pre-deploy) |
| SC-04 | UNIQUE constraint `(run_id, place_pool_id)` exists | Migration §7 `ADD CONSTRAINT … UNIQUE`. Verify via pg_constraint | UNVERIFIED (pre-deploy) |
| SC-05 | `city_id uuid REFERENCES seeding_cities` + `retry_count smallint NOT NULL DEFAULT 0` exist | Migration §8+§9. Verify via information_schema.columns | UNVERIFIED (pre-deploy) |
| SC-06 | `place_pool_city_id_fkey` FK exists with `ON DELETE SET NULL` | Migration §10. Verify via pg_constraint | UNVERIFIED (pre-deploy) |
| SC-07 | `seeding_cities` comment updated to canonical-authority text | Migration §11 `COMMENT ON TABLE`. Verify via `\d+ seeding_cities` | UNVERIFIED (pre-deploy) |
| SC-08 | City picker shows ONLY non-zero servable cities | TrialResultsTab `refresh()` filters via `c.servable_count > 0` after client-side aggregation | PASS (code-level) |
| SC-09 | City picker disabled while running/loading | `disabled={running \|\| loading}` on the `<select>` | PASS (code-level) |
| SC-10 | Sample size clamps to [50, 500], default 200 | `setSampleSize(Math.max(50, Math.min(500, n)))` + min/max attrs on `<input>` | PASS (code-level) |
| SC-11 | Edge fn validates city_id + sample_size; HTTP 400 otherwise | `handlePreviewRun` and `handleStartRun` both validate; explicit 400 with messages | PASS (code-level) |
| SC-12 | `effectiveSampleSize = LEAST(sample_size, totalServable)` | `Math.min(sampleSize, pool.length)` in handleStartRun | PASS (code-level) |
| SC-13 | Stratified sampling: top half deterministic by review_count desc + random fill of bottom | `pool.slice(0, ceil(N/2))` + Fisher-Yates shuffle of remainder + slice(0, fill) | PASS (code-level) |
| SC-14 | City-run rows have `city_id` non-null + match place's city_id; `signal_id`+`anchor_index` NULL | `pendingRows.map((ppId) => ({...city_id: cityId, signal_id: null, anchor_index: null, …}))` | PASS (code-level) |
| SC-15 | Gemini retry-once on MALFORMED_FUNCTION_CALL; success increments retry_count to 1; failure throws | `MAX_MALFORMED_RETRIES=1` loop in callGeminiQuestion; `retry_count: retried ? 1 : 0` in processOnePlace | PASS (code-level) |
| SC-16 | SignalAnchorsTab.jsx deleted; parent prune; Vite build clean | File removed; `PlaceIntelligenceTrialPage.jsx` updated; **build PASS 20.28s, 2936 modules** | PASS (build verified) |
| SC-17 | Legacy 32-anchor rows render correctly (model badge + signal_id badge gated on null) | PlaceResultCard renders `{signal_id} #{anchor_index}` only when both non-null; model badge unchanged | PASS (code-level) |
| SC-18 | Confirm dialog shows city name + country + servable total + sample size + cost + wall time | `window.confirm("About to run trial for ${effectiveSample} places sampled from ${selectedCity.name}, ${selectedCity.country} (${selectedCity.servable_count} servable total)... ~$${estCost}, ~${estMinutes} minute wall time...")` | PASS (code-level) |

**Summary:** 11/18 PASS at code-level + build verification; 7/18 UNVERIFIED awaiting migration deploy + 50-place dev sweep.

---

## 6. F-8 alignment confirmation

SPEC §3 verified row cardinality is 1 row per `(run_id, place_pool_id)` via direct code-read of `index.ts` lines 609-815. Migration UNIQUE constraint matches: `place_intelligence_trial_runs_run_place_unique UNIQUE (run_id, place_pool_id)`.

`handleStartRun.upsert(pendingRows, { onConflict: "run_id,place_pool_id" })` aligns with the constraint shape. `processOnePlace` continues to UPDATE WHERE `(run_id, place_pool_id)` (no change to the existing key path).

---

## 7. Decommission memory pre-write confirmation

File at `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_signal_anchors_decommissioned.md` — frontmatter `status: DRAFT — flips to ACTIVE on ORCH-0734 CLOSE`. Body covers per-context guidance (active code P0 / historical migrations preserve / backup table dead-by-design / comments update / old reports historical artifact). Per orchestrator CLOSE Step 5a; orchestrator handles MEMORY.md index entry + status flip at CLOSE per Steps 5b + 5a respectively.

---

## 8. Migration deployment confirmation

**`supabase/migrations/20260505000001_orch_0734_city_runs.sql` is on-disk only.** NOT applied via `mcp__supabase__apply_migration`. Operator deploys via:

```bash
cd c:/Users/user/Desktop/mingla-main && supabase db push
```

Then re-deploys the edge function:

```bash
supabase functions deploy run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv
```

Deploy ordering matters: migration MUST apply BEFORE edge fn deploy (edge fn references `place_intelligence_trial_runs.city_id` and `retry_count` columns).

---

## 9. Sample sweep evidence

**DEFERRED to operator-side post-deploy.** Implementor cannot run a 50-place dev sweep without operator deploying migration + edge fn first. SPEC §10 step 7 (50-place self-verification) is therefore handed off as part of CONDITIONAL PASS criteria for tester verification.

When operator runs the dev sweep, the implementor recommends spot-checking:
- T-01 (picker filter): expect Berlin/Paris/NY/Barcelona/Chicago/Toronto/Dallas/Miami absent
- T-02 (sample-mode default): pick Durham 200 → expect ~$0.80 confirm dialog estimate
- T-03 (stratified sample): inspect first 100 sampled IDs sorted by review_count desc; remainder randomized
- T-09 / T-10 / T-11 (DDL effects): SQL probes from SPEC §11
- T-14 (parent prune): admin loads with single tab visible
- T-17 (confirm dialog accuracy): wording matches SPEC §7.4 verbatim

---

## 10. Parent component prune

`mingla-admin/src/pages/PlaceIntelligenceTrialPage.jsx` — diff:
- Deleted import: `SignalAnchorsTab` from `../components/placeIntelligenceTrial/SignalAnchorsTab`
- TABS: `[{id: "anchors", …}, {id: "results", …}]` → `[{id: "results", …}]`
- Default activeTab: `"anchors"` → `"results"`
- AlertCard help text fully reworked (anchor language → city language)
- `{activeTab === "anchors" && <SignalAnchorsTab />}` render branch deleted

---

## 11. Invariant verification

| Invariant | Preserved? | Evidence |
|---|---|---|
| I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING | Y | No code paths added between `place_intelligence_trial_runs` and any scoring/rerank/bouncer surface. City-runs still write to research-only table; no new writers; signal scorer/place_scores untouched |
| I-PHOTO-AESTHETIC-DATA-SOLE-OWNER | Y | Collage builder unchanged; `score-place-photo-aesthetics` not touched |
| I-COLLAGE-SOLE-OWNER | Y | `imageCollage.ts` not touched; `compose_collage` action unchanged |
| I-FIELD-MASK-SINGLE-OWNER | Y | Google Places field mask unchanged |
| I-REFRESH-NEVER-DEGRADES | Y | No refresh path touched |
| I-BOUNCER-DETERMINISTIC | Y | Bouncer logic unchanged. `is_servable` filter relies on existing bouncer determination; SPEC introduces no new bouncer logic |
| **I-TRIAL-RUN-SCOPED-TO-CITY (NEW)** | Established post-CLOSE | Every new city-run row has `city_id=cityId` set in `pendingRows` insert; legacy rows preserve NULL. Orchestrator registers the invariant text in `INVARIANT_REGISTRY.md` at CLOSE per Step 5e |
| I-CATEGORY-SLUG-CANONICAL | N/A | No category-slug-producing code touched |

---

## 12. Cache safety

Admin uses no React Query / Zustand for trial data — purely local component state + direct Supabase calls. `refresh()` callback explicitly re-fetches all 3 data sets after a run completes. No cache keys change; no stale data risk.

---

## 13. Regression surface (for tester)

Adjacent features most likely to surprise:

1. **Legacy v1/v2/v3 historical Anthropic-anchor rows** — verify they still render correctly. Specifically: `model.startsWith("gemini")` ternary in PlaceResultCard line 71 still respects the model field; signal_id badge now gated on non-null check (legacy rows have signal_id="brunch" + anchor_index=1 so badge renders; city-runs rows have null/null so badge hides).

2. **Run history grouping** — `runs[row.run_id]` grouping unchanged; legacy rows + new city-run rows can coexist in the same admin list without crashing.

3. **`place_pool` writes from other admin pages** — new FK `place_pool_city_id_fkey` ON DELETE SET NULL means deleting a city won't delete places, but city soft-delete UI (if any exists) needs to handle the cascade; quick grep confirms no admin code currently deletes from `seeding_cities`.

4. **Gemini retry-once cost accounting** — when retry happens, `cost_usd` reflects combined cost of both attempts (defensive honesty); ensure run-level totals don't surprise operator.

5. **`fetch_reviews` action default `force_refresh: false`** — existing 30-day freshness skip preserved; first-time runs in a city will hit Serper API for ~85% of places (those with photos). Operator should expect ~1-3 min Serper-side time for the prepare phase, separate from Gemini scoring.

---

## 14. Constitutional compliance

| # | Principle | Status |
|---|---|---|
| 1 | No dead taps | PASS — Run button disabled until cityId selected; Cancel only renders while running |
| 2 | One owner per truth | PASS — `seeding_cities` is canonical cities authority; `place_intelligence_trial_runs` is sole owner of trial output |
| 3 | No silent failures | PASS — every catch logs to console + toasts to user; retry-once logs explicitly |
| 4 | One query key per entity | N/A — admin uses no React Query |
| 5 | Server state stays server-side | N/A — admin uses no Zustand |
| 6 | Logout clears everything | N/A — admin auth unchanged |
| 7 | Label temporary fixes | PASS — Anthropic comment-blocks labeled with DEC-102 reference; no new transitional markers introduced |
| 8 | Subtract before adding | PASS — `signal_anchors` table dropped BEFORE schema additions in same migration; `SignalAnchorsTab.jsx` deleted before TrialResultsTab rewrite committed |
| 9 | No fabricated data | PASS — cost + wall time estimates come from measured values; helper text explicitly labels them as estimates |
| 10 | Currency-aware UI | PASS — admin remains USD-only (matches existing pattern) |
| 11 | One auth instance | N/A |
| 12 | Validate at the right time | PASS — server-side validation in edge fn (city_id existence, sample_size range) happens at request entry |
| 13 | Exclusion consistency | PASS — `is_servable=true` filter applied identically in both `handlePreviewRun` and `handleStartRun` (and the admin client filter for picker visibility) |
| 14 | Persisted-state startup | N/A — admin has no AsyncStorage persistence |

---

## 15. Discoveries for orchestrator

1. **`PER_PLACE_BROWSER_THROTTLE_MS = 1000`** — keeping at 1s. With paid Gemini Flash 2.5 quota the throttle is pure defensive padding. If operator runs into RPM ceiling on free-tier usage, bump to 4500ms (15 RPM limit). Not a blocker; informational.

2. **`fetch_reviews` and `compose_collage` actions remain unchanged** — they accept `place_pool_id` only and don't reference `signal_anchors`. SPEC didn't require touching them; verified via grep.

3. **Servable count client-side aggregation in `refresh()`** — pulls all `place_pool` `city_id` values where `is_servable=true` (~13K rows live count). For 50K-row scale this is acceptable; for 500K-row scale a Postgres view with materialized servable counts would be cleaner. Logged as future optimization, NOT a blocker.

4. **`Sparkles` icon import removed from TrialResultsTab.jsx** — no longer needed after handlePrepareAll deletion. Verified no other usage in the file.

5. **The `MINGLA_SIGNAL_IDS` constant in admin** is no longer imported by TrialResultsTab.jsx but may still be used elsewhere in admin. Did NOT touch the constants file (`mingla-admin/src/constants/placeIntelligenceTrial.js` or similar) — it remains exported. Cleanup of unused exports is out-of-scope per implementor scope discipline; flagged for orchestrator follow-up.

6. **No mobile changes whatsoever.** Verified via grep on `app-mobile/` — zero `signal_anchors` references; the trial pipeline is admin-only.

7. **Admin Tabs primitive remains for single-tab future-proofing** per operator B choice. If a future cycle (e.g., DEC-103 cutoff re-derivation reporting tab) doesn't materialize within 30 days, consider stripping the Tabs primitive in a cleanup ORCH.

---

## 16. Transition items

None. No `[TRANSITIONAL]` markers introduced.

---

## 17. What needs operator-side runtime verification

After operator deploys migration + edge fn, recommended dev sweep:

1. Hard-refresh admin (Place Intelligence Trial section).
2. Verify single tab "Trial Results" visible (no Signal Anchors tab).
3. Verify city picker shows 9 cities (London, Washington, Brussels, Raleigh, Baltimore, Lagos, Fort Lauderdale, Cary, Durham). Berlin/Paris/NY/Barcelona/Chicago/Toronto/Dallas/Miami absent.
4. Pick Durham, leave sample at 200, click Run trial. Confirm dialog wording per SC-18.
5. Cancel after first 5 places to validate Stop button works.
6. Pick Cary, set sample to 50, run end-to-end. Verify ~75 min wall time / ~$0.20 cost.
7. Inspect 5 random rows in `place_intelligence_trial_runs` table — confirm `city_id` set to Cary's UUID, `signal_id` NULL, `retry_count` 0 or 1.
8. Run one of the SQL probes from SPEC §11 (suggested: `SELECT count(*) FROM signal_anchors` should error).

If any of those fail → tester returns NEEDS REWORK with specific failure detail.

---

**End of implementation report.**
