# QA — META-ORCH-1009 Sub-A — `place_pool.ai_signal_scores` schema foundation

**Mode:** mingla-tester (adversarial)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1009-Sub-A-[ai-signal-scores-schema]/`
**Branch:** `META-ORCH-1009-Sub-A-ai-signal-scores-schema`
**PR:** #275
**SPEC:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_A_AI_SIGNAL_SCORES_SCHEMA.md`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1009_SUB_A_AI_SIGNAL_SCORES_SCHEMA.md`
**QA commit:** `abe6e6eb5` (adversarial test suite + allowlist update)
**Migration applied:** 2026-05-30 (operator pre-apply)
**Date:** 2026-05-30

---

## Verdict

**CONDITIONAL PASS** — schema + backfill + edge-fn helpers + 16 unit tests (11 implementor + 5 adversarial) all PASS; live DB sample probes confirm byte-faithful slice vs source on all 5 sampled places; SOLE-OWNER invariant holds today via code-grep proof; the legacy `I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING` retraction is constitutionally clean (zero production reads exist). The CONDITIONAL is driven by ONE P1 spec-compliance gap (F-01 below) — a CI gate file mandated by the SPEC is missing, so SOLE-OWNER has documentation + code-review enforcement only, not automated CI enforcement.

Once F-01 is remediated (a follow-up dispatch can ship the missing `.github/scripts/strict-grep/meta-orch-1009-sub-a-ai-signal-scores-sole-owner.mjs` gate), this PR is full PASS — none of the other findings block merge.

---

## Findings table

| ID | Severity | Finding | Evidence | Remediation |
|---|---|---|---|---|
| F-01 | **P1** | SPEC §3.4 invariant-1 enforcement gate, §4.4 acceptance tests I-02/I-03, §9 step 5, and §10 regression-prevention row all mandate a NEW dedicated strict-grep gate file `.github/scripts/strict-grep/meta-orch-1009-sub-a-ai-signal-scores-sole-owner.mjs` that greps for any `.update({` containing `ai_signal_scores` outside the allowed paths. **The file does not exist.** Implementor only added a backend-file ALLOWLIST entry to the unrelated `orch-0863-marketing-hub-phase-b.mjs` (file-existence gate, not column-write gate). Acceptance test I-02 cannot pass; SOLE-OWNER is enforced today by code review + the column comment ONLY. | `ls .github/scripts/strict-grep/ \| grep ai-signal` returns empty; full repo grep `grep -rn "ai_signal_scores\|AI-SIGNAL-SCORES" .github/scripts/strict-grep/ .github/workflows/` returns only the ALLOWLIST entry, not a column-write gate. Implementor §11 of IMPL report makes no mention of the dedicated gate file. | Follow-up dispatch: implement the gate per SPEC §3.4 enforcement (greps `\.update\(\s*\{[^}]*ai_signal_scores` across the repo, allowlists `supabase/functions/run-place-intelligence-trial/index.ts` + `supabase/migrations/20260802000003_*.sql`, exits 1 on any other hit). Wire into `.github/workflows/strict-grep.yml`. Self-test with a temporary violation. ~80 lines. |
| F-02 | P3 | The `signal_definitions` table has 16 canonical signal IDs in the SPEC; live data shows 68 of 2,366 backfilled rows have FEWER than 16 keys (min observed = 1). This is consistent with the migration filter `AND (ev ->> 'signal_id') <> '' AND (ev ->> 'reasoning') <> ''` legitimately dropping malformed evaluations, NOT a bug. SPEC §3.1 explicitly permits "if a signal was not evaluated for this place, the KEY is absent entirely". Distribution: `min=1, max=16, avg=15.75, rows<16=68, rows=16=2298, rows>16=0`. | Live MCP probe (see "Distribution check" section below). | No action — distribution within expected range. Sub-B's ranker must treat missing keys as null per `I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED` DRAFT contract. |
| F-03 | P3 | `IMPL §3` reports 5 new files + 4 edited; actual present in worktree as of QA: 4 new + 4 edited (the SQL probe `supabase/migrations/__tests__/meta_orch_1009_sub_a_ai_signal_scores_backfill.test.sql` is listed in the allowlist and IMPL report but the file is in the worktree — verified present). Cosmetic only; the file IS present. | `ls supabase/migrations/__tests__/` shows the probe file present. | No action. |

No P0. No additional P1. F-02 and F-03 are observational.

---

## Adversarial test count + paths + fails-on-revert hash

**Count:** 5 new adversarial Deno tests, all PASS.
**Path:** `supabase/functions/run-place-intelligence-trial/__tests__/ai_signal_scores_adversarial.test.ts`
**QA commit hash:** `abe6e6eb5`
**Fails-on-revert verified at:** SPEC commit `afd734bcf` (where neither `buildAiSignalScoresSlice` nor `writeAiSignalScoresToPlacePool` is exported from `index.ts`; the adversarial tests therefore fail at import-time with `SyntaxError: ... does not provide an export named '...'`).

| Test | Probe | Result |
|---|---|---|
| ADV-01 | Duplicate `signal_id` in source array: last entry wins (deterministic) | PASS |
| ADV-02 | Array of `[null, undefined, null]` entries: returns `{}` (no throw) | PASS |
| ADV-03 | Non-finite scores (`NaN` / `+Infinity` / `-Infinity`): dropped, not stored as NaN JSONB. Validates the implementor's defensive `Number.isFinite` check (an upgrade beyond the SPEC's basic `typeof === "number"` guard). | PASS |
| ADV-04 | Writer issues EXACTLY one supabase call per invocation (no shadow second write / no retry loop). | PASS |
| ADV-05 | Writer treats `UPDATE`-affects-zero-rows as `"ok"` (per supabase-js: returns `{error: null}` even if `.eq()` matches zero rows). Pins Sub-D's contract. | PASS |

---

## Implementor test verification

All 11 implementor tests run + PASS (443ms wall clock):

```
running 6 tests from ai_signal_scores_slice.test.ts
  Test A — happy path ... ok
  Test B — empty input ... ok
  Test C — malformed evals skipped ... ok
  Test D — clamping ... ok
  Test E — rounding ... ok
  Test F — prompt_version + model + evaluated_at pass-through ... ok

running 5 tests from ai_signal_scores_write_path.test.ts
  happy path — call shape ... ok
  supabase-error returned → no throw ... ok
  thrown-error → no propagation ... ok
  empty slice — no supabase calls ... ok
  call sequence freeze ... ok

ok | 11 passed | 0 failed
```

**Tautology check:** none of the 11 are tautological. Each asserts a distinct contract atom:
- Tests A/F pin the 6-key shape + value-passthrough → SHAPE-CONTRACT invariant.
- Test B pins the empty-input contract (`{}` not null, not throw) → caller can always destructure.
- Test C pins per-entry defensive validation (5 distinct malformed shapes, only well-formed survives).
- Test D pins clamping (5 boundary cases including outside-range).
- Test E pins rounding semantics.
- Write-path tests 1-4 pin the supabase call SHAPE (table, patch, eqCol, eqVal), the supabase-error non-throw contract (D4 invariant), the thrown-error non-propagation contract (D4 invariant), and the empty-slice short-circuit (no wasted RTT).
- Write-path test 5 freezes the single-table contract (the helper must never touch `place_intelligence_trial_runs`).

---

## Live-DB probe results (read-only)

### Schema state (post-apply)

| Probe | Result |
|---|---|
| `place_pool.ai_signal_scores` column exists | YES (1) |
| Data type | `jsonb` |
| Nullable | `YES` |
| GIN index `idx_place_pool_ai_signal_scores` exists | YES; `USING gin (ai_signal_scores jsonb_path_ops)` — matches SPEC §3.1 / Decision 2 |
| Column comment | Present, contains `I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER`, `DEC-099`, `DEC-181`, `RETRACTED at Sub-A close` — matches SPEC §3.1 verbatim |

### Backfill row counts

| Probe | Result |
|---|---|
| `place_pool` rows with `ai_signal_scores IS NOT NULL` | **2,366** |
| Distinct `place_pool_id` with completed Q2 in trial log | **2,366** |
| Total completed Q2 trial rows | 2,663 |
| Drift | **0.00%** (exact parity — well within the 5% WARNING threshold) |
| Rows backfilled with NO completed trial run | **0** (proves backfill predicate filtered to status='completed' AND `q2_response ? 'evaluations'` correctly) |

### Shape verification — 5 sample places (alphabetical-by-uuid)

| Place ID | Name | Keys | All-6-keys | No-nulls | All-required-keys |
|---|---|---|---|---|---|
| `0024b08a-…` | Bear Hands | 13 | true | true | true |
| `002f7da9-…` | ROOM 5280 (Raleigh Live Escape Games) | 16 | true | true | true |
| `003393e4-…` | Naga's South Indian Cuisine | 16 | true | true | true |
| `00775777-…` | Central Michel Richard | 16 | true | true | true |
| `00864ab4-…` | Cocoon Gallery | 16 | true | true | true |

Every per-signal value across all 5 samples carries EXACTLY the 6 keys `{score_0_to_100, inappropriate_for, reasoning, evaluated_at, prompt_version, model}` with no nulls — SHAPE-CONTRACT invariant holds at-rest.

### Cross-verification vs source `q2_response`

For each of the 5 samples, the slice's `prompt_version` (all v4), `model` (all gemini-2.5-flash), and `evaluated_at` (down to millisecond) match the source trial row's columns exactly. Bear Hands' 13 keys = its source `q2_response.evaluations` array length of 13 (legit partial coverage; not malformed-skip).

### Byte-faithful value check (first sample, all 13 signals)

For place `0024b08a-…` (Bear Hands), every signal's `score_0_to_100`, `inappropriate_for`, and `reasoning` slice value is byte-faithful to the source `q2_response.evaluations` entry. All 13/13 `reasoning_match=true`. No clamping/rounding observed because all source scores are already integers in [0, 100].

### Distribution check (key count per backfilled row)

| Metric | Value |
|---|---|
| min keys | 1 |
| max keys | 16 |
| avg keys | 15.75 |
| rows with <16 keys | 68 (2.87%) |
| rows with =16 keys | 2,298 (97.13%) |
| rows with >16 keys | 0 |

The 68 sub-16-key rows are legit per SPEC §3.1 ("if a signal was not evaluated for this place, the KEY is absent entirely"). The migration's `WHERE ev ? 'signal_id' AND (ev ->> 'signal_id') <> '' AND (ev ->> 'reasoning') <> ''` predicate correctly drops malformed entries.

### Multi-run / mixed-version edge case

| Metric | Value |
|---|---|
| Places with >1 completed trial run | 111 |
| Places with mixed prompt versions across runs (e.g., v1 + v4) | 32 |
| For 3 sampled mixed-version places (all had v1+v2+v3+v4 in their log) | Each stored only **v4** values in `ai_signal_scores` (the LATEST `completed_at`) — confirms `DISTINCT ON (place_pool_id) ORDER BY ... completed_at DESC` works |

### `evaluated_at` provenance

| Probe | Result |
|---|---|
| Global min `evaluated_at` across all per-signal entries | 2026-05-05 05:33:55.008+00 (oldest source trial) |
| Global max `evaluated_at` | 2026-05-30 05:56:09.556+00 — **BEFORE** migration apply time |
| Rows whose evaluated_at is post-2026-05-29 | 40 (all legitimately late-source trial runs, NOT migration-time) |

Confirms `evaluated_at = source completed_at`, NOT migration time. SPEC contract honored.

---

## Invariant verification

### `I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER`

Code grep across `supabase/`, `mingla-admin/src/`, `mingla-business/src/`, `app-mobile/src/`:

| Path | Reference type |
|---|---|
| `supabase/migrations/20260802000003_meta_orch_1009_sub_a_ai_signal_scores.sql` | WRITE (allowed — backfill) |
| `supabase/functions/run-place-intelligence-trial/index.ts:203` | WRITE (allowed — `processOnePlace`'s mirror call via `writeAiSignalScoresToPlacePool`) |
| All other hits | Comments / column-name strings only — zero writes |

**Verdict:** SOLE-OWNER holds today. Going-forward enforcement is the F-01 P1 gap (documentation + code review only, no CI gate).

### Retracted invariant — `I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING`

Grep across `app-mobile/src/`, `supabase/functions/discover-cards/`, `supabase/functions/generate-curated-experiences/`, `supabase/functions/_shared/`:

Only 1 hit — `supabase/functions/_shared/placeIntelRetryCoverage.test.ts:20` — and it is a TEST error-message STRING (not a read of the table). Retraction is constitutionally clean (zero production reads ever existed; the retraction codifies the de-facto state and adds the new column as the constitutionally-blessed exception).

---

## Cross-layer gates

| Gate | Result |
|---|---|
| `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | ALL PASS (C1-C7 green; C7 reports 11 files changed, all allowlisted) |
| DIAG marker grep `grep -rn "\[META-ORCH-1009-Sub-A-DIAG\]" supabase/ mingla-admin/src/ Mingla_Artifacts/` | empty (PASS) |
| Conflict-marker grep `grep -rn "^<<<<<<<\|^=======$\|^>>>>>>>" ...` | empty (PASS) |
| `cd mingla-admin && npm run build` | exits 0 (`built in 2.02s`, 2940 modules) |
| `[TEST-MOD-APPROVED]` token | N/A — no existing tests modified |
| Backend allowlist contains migration + edge fn + 3 test paths (including new adversarial) | YES — `META_ORCH_1009_SUB_A_BACKEND_ALLOWLIST` at `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs:1056` lists all 6 paths, spread into master `ALLOWLIST` at line 1121 |

---

## Backfill integrity summary

- **Row counts:** 2,366 backfilled = 2,366 source distinct-Q2 places. Drift 0.00%.
- **Shape coverage:** 100% of sampled rows have 6 required keys per signal, no extras, no nulls inside per-signal entry.
- **Edge cases handled correctly:**
  - Multi-version places (32 with mixed versions): latest-by-`completed_at` wins. Verified across 3 sampled v1+v2+v3+v4 places — all stored v4.
  - Partial-signal places (68 with <16 keys): legitimately dropped malformed source evals via migration `WHERE` predicate.
  - Zero rows backfilled from non-completed trial runs.
  - `evaluated_at` derived from source `completed_at`, not migration time.
- **Idempotency:** SPEC §3.3 `IS DISTINCT FROM` guard means re-running the UPDATE produces zero changes; not re-verified live (would require destructive write authority + would not actually mutate). Source rows are immutable, so logic guarantees idempotency.
- **Index quality:** GIN with `jsonb_path_ops` per SPEC Decision 2 — supports the `?` and `@>` operators Sub-B will use at materially better performance than `jsonb_ops`.

---

## Discoveries for orchestrator (none new)

1. F-01 (P1) above — missing SOLE-OWNER strict-grep gate file. Recommend single-line dispatch to mingla-implementor: "create `.github/scripts/strict-grep/meta-orch-1009-sub-a-ai-signal-scores-sole-owner.mjs` per SPEC §3.4 enforcement gate 1 + wire into `.github/workflows/strict-grep.yml`".
2. The 3 discoveries in implementor §18 (photo_aesthetic_data still present, dispatch count discrepancy already reconciled, signal_definitions schema path for Sub-B) are noted and require no QA action.
3. Edge-fn deployment is orchestrator's lane (per dispatch); live edge-fn behavior testing (test E-01 from SPEC §4.2) will fire AFTER `supabase functions deploy run-place-intelligence-trial` on post-merge.

---

## PASS criteria reconciliation

| Criterion | Result |
|---|---|
| No P0/P1 | **FAIL — 1 P1 (F-01: missing CI gate per SPEC mandate)** |
| All tests pass | PASS — 16/16 (11 implementor + 5 adversarial) |
| Live-DB JSONB shape matches SPEC byte-for-byte on samples | PASS — 5/5 samples shape-perfect, 13/13 byte-faithful values on first sample |

**Verdict:** CONDITIONAL PASS. F-01 is a SPEC-compliance gap, not a runtime defect — the column, backfill, edge-fn helpers, and invariant docs are all production-correct. The gap is the going-forward CI enforcement surface for SOLE-OWNER. Merge-readiness is operator's call (one-line dispatch can remediate post-merge or pre-merge).

---

**End of QA report.**
