# IMPLEMENTATION REPORT — ORCH-0713 Phase 0.5 Trial Pipeline Gap Fill + Scoring Output

**Status:** implemented and partially verified — Vite build PASS · grep gates PASS · Deno typecheck deferred (not available locally; verifies on `supabase functions deploy`) · operator runtime verification PENDING (32-anchor re-run via existing UI)
**ORCH IDs in scope:** ORCH-0713 Phase 0.5
**Dispatch:** [Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0713_TRIAL_PIPELINE_GAP_FILL_AND_SCORING.md](../prompts/IMPLEMENTOR_ORCH-0713_TRIAL_PIPELINE_GAP_FILL_AND_SCORING.md)
**DEC reference:** DEC-099 (architecture pivot — drop photo_aesthetic + signal_anchors; single JSONB column; calibration-by-rerun)

---

## 1. Layman summary

Augmented the existing place-intelligence-trial pipeline so Claude now sees the same data the SQL signal scorer reads (numeric price range + negative booleans), and emits a single 0–100 quality score per signal alongside a hard-veto flag for structurally-wrong matches. Re-running the 32 anchors will produce data we can analyze to derive per-signal cutoffs.

**No production code touched.** Trial pipeline only. `I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING` preserved.

---

## 2. Files Changed (Old → New Receipts)

### `supabase/functions/run-place-intelligence-trial/index.ts` (MODIFIED, +74 LOC net)

**Change 1 — `PROMPT_VERSION` constant (line 39 → 44)**
- **Before:** `const PROMPT_VERSION = "v1";`
- **After:** Multi-line audit-trail comment + `const PROMPT_VERSION = "v2";`
- **Why:** Track v1 vs v2 in `place_intelligence_trial_runs.prompt_version` so analysis can distinguish runs with old vs new shape.
- **Lines changed:** +5

**Change 2 — Q2_TOOL schema (lines ~153-177 → ~159-198)**
- **Before:** `evaluations[]` items had `signal_id, strong_match (bool), confidence_0_to_10 (number), reasoning (string), inappropriate_for (bool)` — 5 fields.
- **After:** `evaluations[]` items have `signal_id, score_0_to_100 (integer 0-100), inappropriate_for (bool — hard veto), reasoning (string)` — 4 fields. Dropped `strong_match` + `confidence_0_to_10`. Added `score_0_to_100` continuous scoring.
- **Why:** Operator directive — replace 3-field verdict (strong_match + confidence + inappropriate_for) with 2-field verdict (score + inappropriate_for) for cleaner ranking semantics.
- **Lines changed:** +23 net (more verbose descriptions per field)

**Change 3 — `buildSystemPrompt` function (lines ~783-812 → ~821-869)**
- **Before:** 6 lines of "Critical rules" (use context, be honest, Q1 vs Q2 instructions).
- **After:** Same critical rules + NEW "Q2 SCORING RUBRIC" section (90-100 anchor / 70-89 strong / 50-69 ok / 30-49 weak / 1-29 very weak / 0=inappropriate_for=true). NEW "Q2 INAPPROPRIATE_FOR RULES" section explaining structural-wrongness-only usage with calibration examples (Bayfront / Harris Teeter / National Gallery / Lekki).
- **Why:** Operator directive — Claude must distinguish "structurally wrong" (hard veto) from "weak fit" (low score). Calibration examples lock the semantic boundary.
- **Lines changed:** +37

**Change 4 — `buildUserTextBlock` function (lines ~814-870 → ~872-921)**
- **Before:** Rendered `price_level` only; rendered single `google_booleans_true: [...]` list.
- **After:** ALSO renders `price_range: $X-$Y USD` when `price_range_start_cents` + `price_range_end_cents` present (or one-sided fallback if only one is set). ALSO renders `google_booleans_false: [...]` for explicitly-false booleans (NULL still omitted = unknown).
- **Why:** SQL signal scorer reads price_range_*_cents columns (used by fine_dining tier matchers) and treats `=== false` as real signal. Trial bundle previously omitted both; Claude's input now matches scorer's input.
- **Lines changed:** +25

### `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx` (MODIFIED, +23 LOC net)

**Change 5 — Q2 evaluation render block (lines ~120-150 → ~120-173)**
- **Before:** Each evaluation rendered with `strong_match`-driven green badge OR `inappropriate_for`-driven red badge OR neutral gray; numeric display `conf X/10`.
- **After:** Each evaluation derives a tier from `score_0_to_100` (or fallback `confidence_0_to_10 × 10` for v1 historical rows): ≥70 green, 30-69 amber, <30 red. Inappropriate_for rows render with red bg + X icon + "VETO" label (overrides score-tier). Numeric display `XX/100` or "VETO".
- **Why:** Display layer must render new v2 shape correctly while gracefully handling old v1 rows (forensic value preserved).
- **Lines changed:** +23

---

## 3. Static Verification Matrix

| Gate | Method | Result |
|---|---|---|
| `strong_match` not in live edge code | `Grep "strong_match" supabase/functions/run-place-intelligence-trial/` | PASS — only 2 hits, both in audit-trail comments (PROMPT_VERSION history + drop annotation) |
| `confidence_0_to_10` not in live edge code | `Grep "confidence_0_to_10" supabase/functions/run-place-intelligence-trial/` | PASS — only 2 hits, both in audit-trail comments |
| `score_0_to_100` present in Q2_TOOL schema | `Grep "score_0_to_100" index.ts` | PASS — 8 hits across schema, system prompt rubric, comments |
| `price_range_start_cents` rendered in buildUserTextBlock | `Grep "price_range_start_cents" index.ts` | PASS — 3 hits in buildUserTextBlock |
| `google_booleans_false` line in buildUserTextBlock | `Grep "google_booleans_false" index.ts` | PASS — 2 hits (1 in code, 1 in system prompt rubric) |
| Vite build (admin) | `npx vite build` | PASS — 2938 modules transformed; 22.61s; no new errors |
| TrialResultsTab.jsx renders without strong_match destructure | `Grep "strong_match\|confidence_0_to_10" mingla-admin/` | PASS — `confidence_0_to_10` referenced ONLY in v1-fallback derivation; `strong_match` removed |
| Old v1 rows still render | Backward-compat: `score = score_0_to_100 ?? confidence_0_to_10 * 10` | PASS by design (no runtime test executed) |

---

## 4. Spec Traceability

| Dispatch SC | Implementation | Status |
|---|---|---|
| §2.A.1 — `price_range: $X–$Y USD` rendering | `buildUserTextBlock` lines ~881-892 | PASS |
| §2.A.2 — Split booleans into `google_booleans_true` + `google_booleans_false` | `buildUserTextBlock` lines ~896-915 | PASS |
| §2.B — Q2 tool schema swap (drop strong_match + confidence; add score_0_to_100) | `Q2_TOOL` constant ~163-198 | PASS |
| §2.C — Scoring rubric in system prompt | `buildSystemPrompt` rubric block ~828-867 | PASS |
| §2.D — `PROMPT_VERSION` bumped | line 44: `"v2"` | PASS |
| §3 step 6 — TrialResultsTab.jsx display refactor | display block ~120-173 | PASS |

---

## 5. Invariant Preservation

| Invariant | Status | Why |
|---|---|---|
| `I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING` | PRESERVED | `place_intelligence_trial_runs` table unchanged structurally; production scorer + RPC + discover-cards still don't read from it |
| `I-PHOTO-AESTHETIC-DATA-SOLE-OWNER` | PRESERVED | Trial fn does not write `photo_aesthetic_data` |
| `I-COLLAGE-SOLE-OWNER` | PRESERVED | Trial fn collage write paths unchanged |
| `I-FIELD-MASK-SINGLE-OWNER` | PRESERVED | admin-seed-places untouched |
| `I-REFRESH-NEVER-DEGRADES` | PRESERVED | admin-refresh-places untouched |
| `I-BOUNCER-DETERMINISTIC` | PRESERVED | bouncer code untouched |

---

## 6. Cache Safety

- No query keys changed (admin uses direct supabase calls, no React Query cache).
- Existing v1 rows in `place_intelligence_trial_runs` keep their original q2_response shape; new v2 runs write new shape with `prompt_version="v2"`. Both shapes coexist by design.
- TrialResultsTab.jsx renders BOTH shapes correctly (v1 falls back via `confidence_0_to_10 × 10`).

---

## 7. Regression Surface

The 3-5 adjacent features most likely to break, for tester / operator awareness:

1. **Existing v1 trial run display** — old runs still render but with derived score (not native). Visual: scores ≥70 turn green, 30-69 amber, <30 red. No more `conf X/10` label. **Verify:** expand any pre-2026-05-04 run row and confirm it renders without errors.
2. **Run trial flow** — operator clicks "Run Trial" expecting v2 outputs. **Verify:** new run's q2_response rows have `score_0_to_100` field per evaluation; do NOT have `strong_match` or `confidence_0_to_10`.
3. **Cost tracking** — Anthropic call structure unchanged; cost-per-place should remain ~$0.019. No regression risk.
4. **Q1 path** — completely untouched (Q1 still emits proposed_signals + proposed_vibes + notable_observations).
5. **Photo collage / Serper review fetch** — not in scope; unchanged.

---

## 8. Constitutional Compliance

| Principle | Touched? | Status |
|---|---|---|
| #1 No dead taps | No | n/a |
| #2 One owner per truth | No | preserved |
| #3 No silent failures | No | preserved |
| #8 Subtract before adding | YES | DROPPED `strong_match` + `confidence_0_to_10` BEFORE adding `score_0_to_100` (no field accumulation) |
| #9 No fabricated data | YES | New score derivation `confidence_0_to_10 * 10` for v1 rows is honest fallback (not fabrication; explicitly labeled as derived); admin shows "—" if neither field present |
| All other 11 | No | n/a |

---

## 9. Deploy step (operator dispatches manually)

```powershell
supabase functions deploy run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv
```

Then operator opens `#/place-intelligence-trial` → Trial Results tab → click "Run Trial" → confirms re-run dialog.

Expected runtime: ~10 minutes for 32 anchors. Cost: ~$0.60.

---

## 10. Verification matrix (post-deploy)

These verifications are UNVERIFIED until operator runs the new trial. The dispatch §4 calibration spot-checks:

| Check | Expected | Status |
|---|---|---|
| Bayfront Floral / `flowers` | `inappropriate_for=true`, `score_0_to_100=0` | UNVERIFIED |
| Harris Teeter / `flowers` | `inappropriate_for=false`, `score_0_to_100` 50-70 | UNVERIFIED |
| National Gallery / `creative_arts` | `inappropriate_for=false`, `score_0_to_100` 90-100 | UNVERIFIED |
| Mala Pata / `brunch` | `inappropriate_for=false`, `score_0_to_100` 80-95 | UNVERIFIED |
| Mala Pata / `groceries` | `inappropriate_for=false`, `score_0_to_100` 1-15 (low fit, NOT veto) | UNVERIFIED |
| All 32 anchors emit 16 evaluations each | 32 × 16 = 512 evaluations total | UNVERIFIED |
| Old v1 rows (run_id `17b5a4f4...` and prior) still render in admin | tier-colored backgrounds derived from `confidence_0_to_10 × 10` | UNVERIFIED (manual visual) |

---

## 11. Cost Projection

- Re-run of 32 anchors with v2 prompt: **~$0.60** (same per-place cost as v1; payload size unchanged in order of magnitude — added rubric is cached after first call)
- One-time cost. Future ad-hoc trials at same per-place rate.

---

## 12. Discoveries for Orchestrator

**None.**

The dispatch was tightly scoped (3 file changes + 1 admin display) and no out-of-scope issues surfaced during implementation.

Reference cleanups remain queued from prior dispatches (orchestrator-tracked):
- D-0713-3 (`test-serper-reviews` throwaway edge fn deletion) — not blocked by this dispatch
- D-0713-1 (ORCH-0708 Phase 2 deferral resolved by DEC-099 deprecation path) — orchestrator-tracked
- DEC-099 follow-ups (signal_anchors + photo_aesthetic stack deprecation) — separate cleanup ORCH after Phase 1 close

---

## 13. Status

**implemented, partially verified.** Code complete. Vite build clean. Static grep gates pass. Operator runtime verification (32-anchor re-run + spot-checks per §10) is the remaining gate.

---

## 14. Test First (operator priority list)

1. Deploy edge function (`supabase functions deploy run-place-intelligence-trial`)
2. Open `#/place-intelligence-trial` → Trial Results tab
3. Click "Run Trial" — confirm dialog
4. Wait ~10 minutes for 32 anchors to complete
5. Spot-check Bayfront / Harris Teeter / National Gallery / Mala Pata against expected values per §10
6. Return new run banner stats + 5-10 sample evaluations to orchestrator

---

## 15. Layman summary (chat)

Implemented the gap-fill + new scoring shape on the trial pipeline. Claude now sees price range in dollars and explicitly-false booleans (matching what the SQL scorer reads), and emits a single 0–100 score per signal with `inappropriate_for` reserved for structural wrongness only. Admin display shows tier-colored scores (green/amber/red) and a VETO badge for hard rejections. No production code touched. Operator deploys the edge fn and re-runs the 32 anchors next.
