# IMPLEMENTATION REPORT — ORCH-0708 Phase 1 Photo Aesthetic Scorer

**Status:** implemented and partially verified — Vite build PASS, edge function code-complete + syntax-clean (no Deno typecheck available locally; will verify on first `supabase functions deploy`).
**ORCH IDs in scope:** ORCH-0708 Phase 1
**Spec:** `Mingla_Artifacts/reports/SPEC_ORCH-0708_PHOTO_AESTHETIC_SCORING_INTEGRATION.md` §3, §4, §5
**Dispatch:** `Mingla_Artifacts/prompts/IMPL_ORCH-0708_PHASE_1_PHOTO_AESTHETIC_SCORER.md`

---

## 1. Summary

Built the Phase 1 production wiring for photo-aesthetic scoring:

- **DB:** `place_pool.photo_aesthetic_data JSONB` column + `photo_aesthetic_runs` + `photo_aesthetic_batches` tables (all with RLS).
- **Shared enum source:** `_shared/photoAestheticEnums.ts` — canonical 5 enums + 16 signal IDs + tool schema + cost calculation. Edge function imports from here for sanitization.
- **Edge function:** `score-place-photo-aesthetics` — action-based dispatch (mirrors `backfill-place-photos`). Reads operator anchors at create_run time, builds calibration system prompt, calls Claude Haiku 4.5 vision per place, sanitizes output, fingerprints by photo URLs (idempotent), persists to `place_pool.photo_aesthetic_data`. 9 actions: preview_run / create_run / run_next_batch / run_status / active_runs / cancel_run / pause_run / resume_run / retry_batch.
- **admin-seed-places carve-out:** protective comment added to BOTH per-row UPDATE blocks (line 1041 + 1484). Verified `photo_aesthetic_data` only appears in comments, never in the actual UPDATE field set.
- **Admin trigger UI:** new dedicated page `PhotoScorerPage.jsx` at `#/photo-scorer`. Three city cards (R/C/D), each with preview (eligible / skipped / batches / cost), force-rescore + use-batch-API toggles, Run/Cancel buttons, live progress with per-batch breakdown (status + counts + cost + errors). Auto-detects active runs on mount.

Sync mode (per-place vision call) is the **default** for first runs — gets results in 3–5 min vs hours for Batch API. Batch API path is built (use_batch_api toggle) but defaults off.

---

## 2. Old → New Receipts

### `supabase/migrations/20260504000001_orch_0708_phase1_place_pool_photo_aesthetic_data.sql` (NEW)
**What it did before:** N/A.
**What it does now:** `ALTER TABLE place_pool ADD COLUMN photo_aesthetic_data JSONB DEFAULT NULL`. Adds COMMENT declaring `I-PHOTO-AESTHETIC-DATA-SOLE-OWNER`. Adds partial index `WHERE photo_aesthetic_data IS NULL AND is_servable AND is_active` to optimize batch-selection queries.
**Why:** Spec §3.1.
**Lines:** 35.

### `supabase/migrations/20260504000002_orch_0708_phase1_photo_aesthetic_runs_table.sql` (NEW)
**What it did before:** N/A.
**What it does now:** Creates `photo_aesthetic_runs` table (mirrors `photo_backfill_runs`). Tracks one row per scorer invocation with status lifecycle `ready → running → completed | cancelled | failed`. Has scope_type CHECK, status CHECK, RLS service_role+admin gates.
**Why:** Spec §3.2.
**Lines:** 80.

### `supabase/migrations/20260504000003_orch_0708_phase1_photo_aesthetic_batches_table.sql` (NEW)
**What it did before:** N/A.
**What it does now:** Creates `photo_aesthetic_batches` with FK→runs ON DELETE CASCADE. Per-batch state, anthropic_batch_id (Batch API), cost_usd, error_message, failed_places JSONB.
**Why:** Spec §3.3.
**Lines:** 75.

### `supabase/functions/_shared/photoAestheticEnums.ts` (NEW)
**What it did before:** N/A.
**What it does now:** Single source of truth for the 5 form-field enums (LIGHTING_OPTIONS, COMPOSITION_OPTIONS, etc.), MINGLA_SIGNAL_IDS, SAFETY_FLAG_OPTIONS, the PHOTO_AESTHETIC_TOOL Anthropic tool schema, and 4 sanitizer helpers (sanitizeEnum / sanitizeScalarEnum / sanitizeAestheticScore / sanitizePhotoQualityNotes). Exports PRICING constants + computeCostUsd() helper. Admin-side `mingla-admin/src/constants/photoLabeling.js` mirrors these values; if either side is updated the other must be synced (no Vite import path from JSX → TS).
**Why:** Spec §5 — Claude output sanitization needs canonical enum lists.
**Lines:** 207.

### `supabase/functions/score-place-photo-aesthetics/index.ts` (NEW)
**What it did before:** N/A.
**What it does now:** Action-based edge function. Eligibility query enforces is_active + is_servable + photos exist + (force_rescore OR no existing data OR fingerprint mismatch). Anchors load + system-prompt build per batch (not per place) for prompt-cache reuse. One Anthropic vision call per place with the 5 photos as image content blocks + structured tool_use output. Sanitizes output, computes cost from usage tokens, writes fingerprinted `place_pool.photo_aesthetic_data`. Per-place permanent failures persist a sentinel `__scoring_failed__: true` (so they're visible + skipped on next run unless force_rescore). $5 cost guard at create_run time.
**Why:** Spec §4 (full behavior).
**Lines:** 993.

### `supabase/functions/admin-seed-places/index.ts` (MODIFIED — protective comments only)
**What it did before:** Two per-row UPDATE blocks (lines 1023+, 1467+) writing every column the seeder owns; no documentation that `photo_aesthetic_data` should be excluded.
**What it does now:** Both blocks now have a multi-line comment declaring `I-PHOTO-AESTHETIC-DATA-SOLE-OWNER (ORCH-0708)` and that `photo_aesthetic_data` is intentionally excluded. Verified by grep that the column appears ONLY in comments, never in the UPDATE field set.
**Why:** Spec §3.4 carve-out — preserves I-FIELD-MASK-SINGLE-OWNER + I-REFRESH-NEVER-DEGRADES.
**Lines added:** ~12 across both spots (comments only, no logic change).

### `mingla-admin/src/pages/PhotoScorerPage.jsx` (NEW)
**What it did before:** N/A.
**What it does now:** New top-level admin page at `#/photo-scorer`. Renders 3 `CityScorerCard`s for Raleigh / Cary / Durham. Each card: auto-loads a preview on mount, shows eligible/skipped/batches/cost stats, has force-rescore + use-batch-API toggles, Run button that calls create_run then loops run_next_batch with live progress + per-batch breakdown, Cancel button. Auto-detects pre-existing active runs and resumes monitoring them on page mount.
**Why:** Spec §4 acceptance — operator needs a UI to trigger and monitor.
**Lines:** 402.

### `mingla-admin/src/App.jsx` (MODIFIED)
**What it did before:** PAGES object had 16 routes including `photo-labeling`.
**What it does now:** Added `import { PhotoScorerPage }` + registered `"photo-scorer": PhotoScorerPage`.
**Why:** Spec §4 — UI registration.
**Lines:** +2.

### `mingla-admin/src/lib/constants.js` (MODIFIED)
**What it did before:** Quality Gates nav had Signal Library + Photo Labeling.
**What it does now:** Added `{ id: "photo-scorer", label: "Photo Scorer", icon: "Sparkles" }` to Quality Gates group. Sidebar shows it under Photo Labeling.
**Why:** Spec §4 — sidebar nav entry.
**Lines:** +1.

### `mingla-admin/src/components/layout/Sidebar.jsx` (MODIFIED)
**What it did before:** ICON_MAP had Activity + Camera (added in Phase 0).
**What it does now:** Added `Sparkles` to lucide imports + ICON_MAP whitelist.
**Why:** New nav entry needs the icon registered or it falls back to LayoutDashboard.
**Lines:** +2.

---

## 3. Spec Traceability

| AC | Criterion | Verification | Result |
|---|---|---|---|
| AC-1 | `photo_aesthetic_data` column exists on `place_pool`, default NULL | Migration A1 written; not yet applied | ⚠ ready, awaiting `supabase db push` |
| AC-2 | `photo_aesthetic_runs` + `photo_aesthetic_batches` tables exist with FK + RLS | Migrations A2 + A3 written; not yet applied | ⚠ ready |
| AC-3 | Edge function deployed | Code complete, deployment is operator's step | ⚠ ready, awaiting `supabase functions deploy` |
| AC-4 | `create_run` for Raleigh selects ~94 servable+active places | Code review of `loadEligiblePlaces` matches spec §4.2 query semantics | ✅ structurally correct, runtime UNVERIFIED |
| AC-5 | run_next_batch end-to-end works for one batch | Code review confirms full flow: load anchors → build prompt → call vision → sanitize → fingerprint → persist | ✅ structurally correct, runtime UNVERIFIED |
| AC-6 | Idempotency: re-run = no-op for same fingerprint | `loadEligiblePlaces` filter B4 + per-place double-check inside `handleRunNextBatch` (defensive) | ✅ |
| AC-7 | force_rescore=true overrides idempotency | `force_rescore` parameter threaded through scope → eligibility filter | ✅ |
| AC-8 | Anchors text block injected into system prompt | `buildSystemPrompt(anchors)` called per batch with the 5 committed anchors loaded via `loadCommittedAnchors`. Each anchor's `expected_aggregate` JSON + operator notes embedded. | ✅ |
| AC-9 | Admin trigger UI runs scorer for selected city, shows progress, surfaces errors | PhotoScorerPage.jsx with 3 city cards, preview/run/cancel buttons, per-batch progress display, toast feedback on success/error | ✅ structurally; runtime UNVERIFIED |
| AC-10 | Compare-with-Claude tab populates after run | No code change — existing tab queries `photo_aesthetic_data` via place_pool join. Pre-backfill placeholder branch handles absent data. | ✅ pass-through |
| AC-11 | admin-seed-places carve-out verified | Grep confirms `photo_aesthetic_data` appears only in comments at lines 1041 + 1484, never in UPDATE field set | ✅ |
| AC-12 | Vite build EXIT=0 | `npx vite build` → 17.03s, EXIT=0, 2937 modules | ✅ |
| AC-13 | RLS: non-admin authenticated user CANNOT call create_run | Edge function checks admin_users gate at lines 95-104 (mirrors backfill-place-photos pattern) | ✅ structurally |

---

## 4. Invariant Verification

| Invariant | Preserved? |
|---|---|
| **I-PHOTO-AESTHETIC-DATA-SOLE-OWNER** (DRAFT, flips to ACTIVE on Phase 1 close) | ✅ Established: edge function is the only writer; admin-seed-places carve-out comment + grep verify; column comment declares the invariant. |
| **I-PHOTO-AESTHETIC-CACHE-FINGERPRINT** (DRAFT, flips to ACTIVE on Phase 1 close) | ✅ Established: SHA256 of `stored_photo_urls.slice(0,5).join('|')` written to `photos_fingerprint`. Eligibility query skips matching fingerprints. force_rescore is the only override. |
| **I-FIELD-MASK-SINGLE-OWNER** | ✅ admin-seed-places UPDATE field list unchanged (only comment added). |
| **I-REFRESH-NEVER-DEGRADES** | ✅ Re-seed via admin-seed-places does not touch photo_aesthetic_data. |
| **No silent failures (Constitution #3)** | ✅ Every API call wrapped in try/catch with `console.error` + per-place sentinel + run-level error_message + UI toasts. |
| **One owner per truth (Constitution #2)** | ✅ photo_aesthetic_data has one writer. Operator labels (photo_aesthetic_labels) and Claude scores (place_pool.photo_aesthetic_data) live in separate tables/columns. |
| **No fabricated data (Constitution #9)** | ✅ Sanitizers DROP unknown enum values (don't substitute fake ones); failure sentinel persists honest error message. |

---

## 5. Parity Check

N/A — admin-only feature.

---

## 6. Cache Safety

No React Query / Zustand cache changes. Compare-with-Claude tab refetches via Supabase JS client; no stale-cache risk. Anthropic prompt cache is opt-in (`use_cache=true` default at create_run, sent as `cache_control: ephemeral` on system prompt). Cache invalidates on system-prompt-content change, so editing anchors then re-running with `force_rescore` correctly reuses (or invalidates) the cache.

---

## 7. Regression Surface (what tester should check)

1. **Existing seed flow** — verify `admin-seed-places` re-seed of an already-scored place does NOT clobber `photo_aesthetic_data`. (Spec §3.4 carve-out + grep verify.)
2. **Bouncer pipeline** — verify `run-bouncer` and `run-pre-photo-bouncer` continue to work (they don't touch the new column or tables).
3. **Place Pool admin page** — verify rendering still works (the new column is `JSONB DEFAULT NULL`, won't break any existing SELECTs).
4. **Photo Labeling page** — verify Compare-with-Claude tab still shows pre-backfill placeholder when no places are scored, then activates correctly after the first scorer run.
5. **Sidebar navigation** — verify Sparkles icon renders for Photo Scorer, Activity for Signal Library, Camera for Photo Labeling.

---

## 8. Constitutional Compliance

All 14 principles scanned against changes; quick-check passes:

| # | Principle | Status |
|---|---|---|
| 1 | No dead taps | ✅ All buttons wired (Run / Cancel / Refresh / toggles) |
| 2 | One owner per truth | ✅ photo_aesthetic_data has single writer |
| 3 | No silent failures | ✅ Every Supabase + Anthropic call has explicit error handling |
| 4 | One query key per entity | N/A — admin uses direct Supabase, not React Query |
| 5 | Server state stays server-side | ✅ No Zustand server-data caching |
| 7 | Label temporary fixes | ✅ No `[TRANSITIONAL]` markers in shipped code |
| 8 | Subtract before adding | ✅ Mirrored backfill-place-photos pattern; no parallel/duplicate state machines |
| 9 | No fabricated data | ✅ Sanitizers drop unknown values; failure sentinel honest |

---

## 9. Discoveries for Orchestrator

**None new this dispatch.** Existing open discoveries from Phase 0 still pending:
- ORCH-0710 (SignalLibraryPage broken toasts) — unchanged
- Pre-existing eslint motion-unused-but-used and Sidebar use-memo errors — unchanged

---

## 10. Cost Guard

Per-place cost estimate (sync mode, no batch discount): **~$0.008/place** based on:
- ~7.5K input tokens (5 photos × ~1.5K each)
- ~5K cached system prompt tokens × 0.10 read multiplier ≈ effective 500 tokens
- ~500 output tokens

**Estimated total for full R+C+D run (~184 places): ~$1.50** (sync mode). With Batch API toggled on: ~$0.74.

`COST_GUARD_USD = 5.0` enforced at `create_run` — request rejected with explicit error if estimated cost exceeds. Operator can narrow scope or raise the guard.

---

## 11. Deployment Steps (operator)

1. Apply migrations:
   ```
   cd /c/Users/user/Desktop/mingla-main && supabase db push
   ```
   (Will apply 3 files: photo_aesthetic_data column, photo_aesthetic_runs table, photo_aesthetic_batches table.)

2. Set Anthropic API key as Supabase secret:
   ```
   supabase secrets set ANTHROPIC_API_KEY=<key> --project-ref gqnoajqerqhnvulmnyvv
   ```

3. Deploy the edge function:
   ```
   supabase functions deploy score-place-photo-aesthetics --project-ref gqnoajqerqhnvulmnyvv
   ```

4. Open admin → Quality Gates → Photo Scorer → click "Run scorer for Raleigh"

5. Monitor progress in the page UI; verify a few places get `photo_aesthetic_data` populated by inspecting the table

6. Open Photo Labeling → Compare with Claude tab → verify it activates with per-fixture diffs

---

## 12. What's Next

After operator runs the scorer for R/C/D and reads the Compare diff:
- **If diffs look good (≥80% fixtures pass)**: dispatch Phase 2 (signal scorer extensions + signal config v_next migrations + cap raise 200→1000)
- **If diffs are bad on specific signals**: tune anchors (re-label that anchor, re-run scorer with `force_rescore=true`), iterate before Phase 2
- **If diffs are bad on output sanitization**: orchestrator refines the system prompt rules; redeploy edge function

---

## 13. Files Changed Summary

**New files (7):**
- `supabase/migrations/20260504000001_orch_0708_phase1_place_pool_photo_aesthetic_data.sql`
- `supabase/migrations/20260504000002_orch_0708_phase1_photo_aesthetic_runs_table.sql`
- `supabase/migrations/20260504000003_orch_0708_phase1_photo_aesthetic_batches_table.sql`
- `supabase/functions/_shared/photoAestheticEnums.ts`
- `supabase/functions/score-place-photo-aesthetics/index.ts`
- `mingla-admin/src/pages/PhotoScorerPage.jsx`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0708_PHASE_1_PHOTO_AESTHETIC_SCORER_REPORT.md` (this report)

**Modified files (4):**
- `supabase/functions/admin-seed-places/index.ts` (+12 lines, comments only)
- `mingla-admin/src/App.jsx` (+2 lines)
- `mingla-admin/src/lib/constants.js` (+1 line)
- `mingla-admin/src/components/layout/Sidebar.jsx` (+2 lines)

**Total lines added:** ~2,000 (migrations + 1 edge function + 1 shared TS + 1 admin page + nav wiring + carve-out comments).

---

## 14. Sign-off

- **Status:** implemented and partially verified (Vite build PASS; runtime + Deno typecheck require deploy)
- **Risk:** Low for the wiring; primary unknowns are Claude vision output quality (which is exactly what Compare-with-Claude tab is built to surface)
- **Ready for:** orchestrator REVIEW + commit + 3-step deploy (migrations, secret, function) + operator runtime test
