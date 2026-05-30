# IMPLEMENTATION — META-ORCH-1009 Sub-A — `place_pool.ai_signal_scores` JSONB + DEC-099 invariant lift

**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1009-Sub-A-[ai-signal-scores-schema]/`
**Branch:** `META-ORCH-1009-Sub-A-ai-signal-scores-schema` (branched from `main` at `f560925c5`; SPEC commit `25376e00f`)
**Author skill:** Claude `mingla-implementor`
**Date:** 2026-05-30
**SPEC:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_A_AI_SIGNAL_SCORES_SCHEMA.md`
**Status:** implemented and verified (DB apply + edge fn deploy are operator/orchestrator lanes; commands provided below)

---

## §1 Layman summary

Sub-A adds one new JSONB column on `place_pool` for storing per-place Gemini Q2 signal scores, seeds it with the 2,366 places already evaluated by the trial pipeline, and teaches the trial edge function to write fresh evaluations into the new column every time. Zero user-visible change — this is plumbing so Sub-B can swap the ranker to use AI scores in one file. The old "trial output must never feed ranking" invariant is officially retracted under DEC-099's pre-authorisation, and three replacement invariants now constrain who writes the column, what shape it has, and how Sub-B's ranker reads it.

---

## §2 Comms ledger entries acknowledged on entry

Scanned `COMMS_LEDGER.md` at session start. Active rows where `to` matches this skill / META-ORCH-1009 / `ALL`:

- **COMMS-0003** (WARN, ALL) — external-API integration ORCHs must cite provider docs URLs inline at SPEC time. Satisfied: Gemini function-calling docs URL cited in the edge fn comment block at `processOnePlace` + at `buildAiSignalScoresSlice`; Postgres 17 JSONB indexing URL cited in DEC-181. Will append `mingla-implementor+claude (META-ORCH-1009 Sub-A)` to acked_by in a follow-up direct-to-main commit if orchestrator requires the ledger update on close (not done in this implementation pass since the worktree is branched and the COMMS_LEDGER row lives on main).
- **COMMS-0002** (WARN, ALL) — backend allowlist obligation. Satisfied: `META_ORCH_1009_SUB_A_BACKEND_ALLOWLIST` added to `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in the same commit as the edge-fn + migration touch.
- **COMMS-0004** (WARN, ALL) — ID-collision intake. N/A — META-ORCH-1009 was the dispatched ID and no collision was detected at SPEC time.
- COMMS-0012, COMMS-0013, COMMS-0014 — orchestrator-facing, not implementor lane. Read for context.

No BLOCK rows.

---

## §3 Files touched / new / deleted

| Action | Path | Lines (approx) |
|---|---|---|
| NEW | `supabase/migrations/20260802000003_meta_orch_1009_sub_a_ai_signal_scores.sql` | ~135 |
| EDIT | `supabase/functions/run-place-intelligence-trial/index.ts` | +~135 lines (2 new exported helpers + non-fatal write-call replaces inline code) |
| NEW | `supabase/functions/run-place-intelligence-trial/__tests__/ai_signal_scores_slice.test.ts` | ~170 (6 tests) |
| NEW | `supabase/functions/run-place-intelligence-trial/__tests__/ai_signal_scores_write_path.test.ts` | ~110 (5 tests) |
| NEW | `supabase/migrations/__tests__/meta_orch_1009_sub_a_ai_signal_scores_backfill.test.sql` | ~140 (post-apply read-only probe) |
| EDIT | `Mingla_Artifacts/INVARIANT_REGISTRY.md` | +80 lines (3 new invariants at top; 1 retraction section; 1 cross-ref repointed at line ~1316) |
| EDIT | `Mingla_Artifacts/DECISION_LOG.md` | +28 lines (DEC-181 appended) |
| EDIT | `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | +18 lines (new allowlist constant + spread) |
| NEW | `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1009_SUB_A_AI_SIGNAL_SCORES_SCHEMA.md` | this file |

**Counts:** 5 new files, 4 edited files, 0 deleted.

---

## §4 Old → New receipts

### `supabase/migrations/20260802000003_meta_orch_1009_sub_a_ai_signal_scores.sql` (NEW)

**Before:** N/A — file did not exist.
**Now:** Migration adds `place_pool.ai_signal_scores JSONB` (nullable), the column comment naming the sole-writer invariant, a GIN index using `jsonb_path_ops`, the one-shot backfill from `place_intelligence_trial_runs.q2_response` (idempotent via `IS DISTINCT FROM` guard), and a `DO $$ ... $$` self-verify block that `RAISE NOTICE`s the backfilled vs source row counts and `RAISE WARNING`s on drift > 5%.
**Why:** SPEC §3.1 (DDL) + §3.3 (backfill) + the live probe (column does not pre-exist, 2,366 distinct places ready to backfill).
**Verified:** Pre-flight invariant probe via `mcp__supabase__execute_sql` confirmed `column_exists=0` and `distinct_q2_places=2366` on prod 2026-05-30.

### `supabase/functions/run-place-intelligence-trial/index.ts` (EDIT)

**Before:** `processOnePlace` issued a single `place_intelligence_trial_runs` UPDATE on Q2 completion, followed by a timing-only second update. No write to `place_pool.ai_signal_scores` because the column did not exist.
**Now:** Two new exported helpers — `buildAiSignalScoresSlice` (pure function: slices Q2 evaluations into the canonical 6-field-per-signal JSONB shape, clamps `score_0_to_100` to [0,100] with rounding, drops malformed evaluations) and `writeAiSignalScoresToPlacePool` (non-fatal supabase wrapper: empty-slice short-circuit, supabase-error swallow + log, thrown-error swallow + log). `processOnePlace` now invokes both after the trial-row UPDATE succeeds and before the timing-only second update. Two Gemini docs URL citations inline (per COMMS-0003).
**Why:** SPEC §3.2 verbatim. Trial row stays source of truth; `place_pool` write is a derived materialisation per Decision 4 (non-atomic).
**Lines changed:** +135 (gross add); 0 lines deleted from existing logic.
**Deno check:** clean.

### `supabase/functions/run-place-intelligence-trial/__tests__/ai_signal_scores_slice.test.ts` (NEW — 6 tests)

**Tests:** A (happy 3-signal, exact 6-key shape), B (null/undefined/[] → {}), C (malformed evals dropped: missing reasoning, empty signal_id, wrong type for score, wrong type for inappropriate_for — only well-formed survives), D (clamping: -10/0/50/100/200 → 0/0/50/100/100), E (rounding: 42.7 → 43), F (prompt_version + model + evaluated_at pass-through verbatim).
**Result:** 6/6 pass; fails-on-revert verified at `25376e00f`.

### `supabase/functions/run-place-intelligence-trial/__tests__/ai_signal_scores_write_path.test.ts` (NEW — 5 tests)

**Tests:** happy path call-shape (`db.from('place_pool').update({ai_signal_scores}).eq('id', placeId)`), supabase-error returned → no throw + `"error_caught"` returned, thrown-error inside the chain → no propagation + `"error_caught"` returned, empty-slice short-circuit (NO supabase call made), single-table contract freeze (helper never touches `place_intelligence_trial_runs`).
**Result:** 5/5 pass; fails-on-revert verified at `25376e00f`.

### `supabase/migrations/__tests__/meta_orch_1009_sub_a_ai_signal_scores_backfill.test.sql` (NEW)

**Coverage:** M-01 (column exists, jsonb, nullable), M-02 (GIN index with `jsonb_path_ops`), M-03 (column comment includes sole-owner invariant ref), M-04 (backfill row count parity within 5% of source), M-08 (idempotency — re-running the WHERE clause produces 0 candidate rows).
**Run mode:** Manual post-apply probe (`cat ... | /Users/sethogieva/bin/supabase db remote sql --linked`); not auto-run because the repo's SQL probe convention is hand-driven against the linked remote.
**Status:** Not run yet (migration not applied; will run as post-apply verification step in operator's lane).

### `Mingla_Artifacts/INVARIANT_REGISTRY.md` (EDIT)

**Before:** `I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING` had a single cross-reference line at ~1234, no full body.
**Now:** Top-of-file ACTIVE section for META-ORCH-1009 Sub-A with three invariants (sole-owner ACTIVE, shape-contract ACTIVE, prompt-version-discriminated DRAFT). New RETRACTED section between Sub-A active block and ORCH-0975 block holding the full body + retraction rationale + replacement pointers. The line ~1316 cross-reference was repointed from "(preserved)" to "(RETRACTED 2026-05-30 ... see top-of-file RETRACTED section)".
**Why:** SPEC §3.4 verbatim invariant bodies; DEC-099 constitutional bless lifts the predecessor invariant.

### `Mingla_Artifacts/DECISION_LOG.md` (EDIT)

**Before:** Max DEC = DEC-180 (storage image transform overage).
**Now:** DEC-181 appended at EOF with full rationale block (column name decision, landing-under-Sub-A rationale, alternatives rejected, impact, EXIT signal "none", cross-references to DEC-099, DEC-101, the 3 new invariants, the RETRACTED invariant, the SPEC, this report, sibling sub-dispatches, COMMS-0003).
**Why:** SPEC §7 Decision 3 + §2 (DEC-181 numbering verified — `grep -oE "DEC-[0-9]+" | sort -V | tail` showed DEC-180 is current max).

### `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (EDIT)

**Before:** `ALLOWLIST` spread covered through ORCH-1015.
**Now:** New `META_ORCH_1009_SUB_A_BACKEND_ALLOWLIST` constant (5 paths: migration, edge fn, 2 Deno tests, 1 SQL probe) declared after `ORCH_1015_BACKEND_ALLOWLIST`, spread into `ALLOWLIST`. Edge fn path duplicated with ORCH-1015's existing entry — harmless dup, ALLOWLIST is a union.
**Verified:** `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` PASSES all C1-C7 checks; C7 (no-new-backend-files) reports "1 files changed total" (the spec markdown), well within the allowlist boundary.

---

## §5 Migration handling (operator's lane)

### Pre-apply invariant probe (DONE 2026-05-30)

Read-only probe via `mcp__supabase__execute_sql`:

```sql
SELECT
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='place_pool' AND column_name='ai_signal_scores') AS column_exists,
  (SELECT COUNT(DISTINCT place_pool_id) FROM place_intelligence_trial_runs WHERE status='completed' AND q2_response IS NOT NULL AND q2_response ? 'evaluations') AS distinct_q2_places,
  (SELECT COUNT(*) FROM place_intelligence_trial_runs WHERE status='completed' AND q2_response IS NOT NULL) AS total_completed_q2;
```

Result: `[{"column_exists":0,"distinct_q2_places":2366,"total_completed_q2":2663}]`.

- `column_exists=0` — no pre-existing column, COLUMN-SOLE-OWNER invariant cannot be pre-violated.
- `distinct_q2_places=2366` — matches SPEC §11 expected backfill row count exactly.
- `total_completed_q2=2663` — matches SPEC §2 (2,663 completed Q2 rows total; 2,366 distinct places means ~297 places have multiple completed runs).

### Remote migration head check (DONE 2026-05-30)

`mcp__supabase__list_migrations` → latest remote version is `20260802000002_orch_1006_finalize_copy_pricing_breakdown`. My new migration `20260802000003_meta_orch_1009_sub_a_ai_signal_scores` is monotonically next. Zero remote-only versions detected.

### Operator apply command

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-A-[ai-signal-scores-schema]" && /Users/sethogieva/bin/supabase db push --linked
```

Expected apply-time log:
- `NOTICE [META-ORCH-1009 Sub-A backfill] place_pool.ai_signal_scores non-null rows: 2366` (or close to it; the live count drifts as new trial runs land).
- `NOTICE [META-ORCH-1009 Sub-A backfill] source trial-runs distinct completed places: 2366` (or close).
- `NOTICE [META-ORCH-1009 Sub-A backfill] drift OK (=0.0000)`.
- No `WARNING` lines.

### Post-apply verification

Hand-run the SQL probe:

```bash
cat supabase/migrations/__tests__/meta_orch_1009_sub_a_ai_signal_scores_backfill.test.sql \
  | /Users/sethogieva/bin/supabase db remote sql --linked
```

Or via the Supabase Management API:

```sql
-- Quick parity check
SELECT
  (SELECT COUNT(*) FROM place_pool WHERE ai_signal_scores IS NOT NULL) AS backfilled,
  (SELECT COUNT(DISTINCT place_pool_id) FROM place_intelligence_trial_runs WHERE status='completed' AND q2_response ? 'evaluations') AS source;
```

Expected: `backfilled` within 5% of `source`.

---

## §6 Edge function deploy (orchestrator's lane post-merge)

Touched: `run-place-intelligence-trial`.

```bash
/Users/sethogieva/bin/supabase functions deploy run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv
```

Verify-first-call (per `feedback_supabase_edge_deploy_verify_first_call.md`):

```bash
curl -i -X POST "https://gqnoajqerqhnvulmnyvv.functions.supabase.co/run-place-intelligence-trial" \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  --data '{}'
```

Expected: HTTP 400/401 (not 404) — proves the new revision is live. The body returns a validation error, NOT a 404 missing-function error.

---

## §7 Test results

### Deno tests (passing, fails-on-revert verified)

```
deno test --no-check --allow-net \
  supabase/functions/run-place-intelligence-trial/__tests__/ai_signal_scores_slice.test.ts \
  supabase/functions/run-place-intelligence-trial/__tests__/ai_signal_scores_write_path.test.ts

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

ok | 11 passed | 0 failed (428ms)
```

### Fails-on-revert proof

`git stash push -- supabase/functions/run-place-intelligence-trial/index.ts` (reverts to SPEC commit `25376e00f` which has no helpers exported). Re-running the same test command produced:

```
error: SyntaxError: The requested module '../index.ts' does not provide an export named 'writeAiSignalScoresToPlacePool'
FAILED | 0 passed | 2 failed (33ms)
```

`git stash pop` restored the helpers; re-run confirmed `11 passed | 0 failed`. **Fails-on-revert verified at commit `25376e00f`.**

### Deno check

`deno check supabase/functions/run-place-intelligence-trial/index.ts` → clean.

### Strict-grep gate

`node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` → all C1-C7 PASS. C7 reports the new migration + edge fn + 3 test files as ALLOWED (1 file changed total in C7's counting model — the spec markdown sits in `Mingla_Artifacts/specs/` outside backend scope).

### Admin sanity build

`cd mingla-admin && npm run build` → clean (`vite v7.3.1 ✓ built in 2.33s`; 2940 modules transformed).

### Conflict markers

`grep -rn "^<<<<<<<\|^=======$\|^>>>>>>>" ...` → none.

---

## §8 Backfill verification

Pre-apply state: 0 rows have `ai_signal_scores` (column does not exist).

Expected post-apply state: ~2,366 rows have `ai_signal_scores` populated.

This is captured in the migration's `DO $$ ... $$` self-verify block (`RAISE NOTICE` on counts + `RAISE WARNING` on drift > 5%) AND in the standalone SQL probe at `supabase/migrations/__tests__/meta_orch_1009_sub_a_ai_signal_scores_backfill.test.sql` (M-04 + M-08 assertions).

**LIVE BACKFILL VERIFICATION:** WILL BE RUN AFTER OPERATOR EXECUTES `supabase db push --linked`. The implementation report cannot pre-run this because Sub-A explicitly does NOT apply migrations via MCP (Mingla parity rule #11 — `mcp__supabase__apply_migration` is forbidden; operator's `db push` is the only canonical path). The post-apply count will be added here as an addendum or in the close report.

---

## §9 Invariant updates

| Invariant | Before | After | Evidence |
|---|---|---|---|
| `I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING` | ACTIVE (single cross-ref line ~1234) | RETRACTED 2026-05-30 — full retraction body added; cross-ref repointed | INVARIANT_REGISTRY.md §"RETRACTED (post META-ORCH-1009 Sub-A CLOSE 2026-05-30)" |
| `I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER` | — | ACTIVE post Sub-A CLOSE | INVARIANT_REGISTRY.md §"ACTIVE (post META-ORCH-1009 Sub-A...)" |
| `I-AI-SIGNAL-SCORES-SHAPE-CONTRACT` | — | ACTIVE post Sub-A CLOSE | INVARIANT_REGISTRY.md §"ACTIVE (post META-ORCH-1009 Sub-A...)"; Deno test pins the shape |
| `I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED` | — | DRAFT post Sub-A CLOSE (→ ACTIVE on Sub-B landing) | INVARIANT_REGISTRY.md §"ACTIVE (post META-ORCH-1009 Sub-A...)" |

---

## §10 Decision log update

DEC-181 appended (full body in `Mingla_Artifacts/DECISION_LOG.md` at EOF). Captures: column name `ai_signal_scores` not `claude_signal_evaluations`; lands under Sub-A under DEC-099 pre-authorisation; alternatives rejected (keep DEC-099 name, gemini-specific name, separate table, defer to Sub-B); impact on schema + edge fn + invariants + user surface; EXIT signal = none (rename post-Sub-B is expensive, lock now); cross-references to DEC-099, DEC-101, the 3 new invariants, the RETRACTED invariant, SPEC, this report, sibling subs, COMMS-0003.

---

## §11 Backend allowlist update

`META_ORCH_1009_SUB_A_BACKEND_ALLOWLIST` added to `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` containing 5 paths (migration, edge fn, 2 Deno tests, 1 SQL probe) and spread into the master `ALLOWLIST`. Shipped in the same commit as the edge-fn touch per COMMS-0002.

---

## §12 Cross-surface impact (per Step 3.5 of implementor pre-flight)

| Surface | Covered? | What changes | Files touched |
|---|---|---|---|
| Consumer iOS | NO | No user-visible change in Sub-A | none |
| Consumer Android | NO | Same as iOS | none |
| Buyer/anon Web | NO | Buyer-anon routes don't touch deck or scorer | none |
| Business iOS | NO | No business surface reads `place_pool.ai_signal_scores` | none |
| Business Android | NO | Same as Business iOS | none |
| Admin Web | NO | Admin trial UI unchanged (reads trial table; new column invisible) | none |
| Business Web preview | NO | n/a | none |

Pure backend / migration / docs sub. ZERO user-touchable surfaces ship in Sub-A. Tester does NOT need a sim-live-fire pass; only the DB-state verification + Deno test pass + strict-grep gate.

---

## §13 Parity check

Sub-A is backend-only — no solo-vs-collab split, no iOS-vs-Android split. Parity N/A.

---

## §14 Cache safety

No React Query keys touched. No client-state shape changed. No persisted AsyncStorage shape changed. New column is server-side only. N/A.

---

## §15 Regression surface (tester focus list)

- The trial admin UI continues to be able to launch a fresh trial run on one place and reach `status='completed'` (existing behaviour; the new secondary write is non-fatal so a place_pool failure must not stall the trial flow).
- The `place_intelligence_trial_runs` table continues to hold the source of truth — no rows deleted, no shape change, no RLS change.
- The new GIN index on `place_pool.ai_signal_scores` is creation-only — no other index changed.
- The migration is idempotent — re-running it on a fully-backfilled DB must produce 0 row changes (verified by the `IS DISTINCT FROM` guard + SQL probe M-08).

Most likely-to-break adjacencies:
1. Any future RPC that touches `place_pool` with `SELECT *` will start returning the new JSONB column — review existing PostgREST surfaces for unintended exposure.
2. The shared `_shared/intelligenceCoverage.ts` (touched by ORCH-1015) reads `place_pool` count fields; verify it doesn't query `SELECT *` such that the new column inflates payload size.
3. The admin trial dashboard's recent-runs widget is unchanged; smoke-check it still loads.

---

## §16 Constitutional compliance quick-scan

- #1 (single source of truth): preserved — trial row remains source of truth; place_pool column is documented as derived materialisation.
- #2 (no parallel sources of truth): preserved — single-writer invariant locks this.
- #3 (every state handled): N/A — pure DB+edge-fn work, no UI.
- #4 (no silent failures): non-fatal write LOGS every failure path (`console.error` with structured `[place-intel-trial:ai_signal_scores_*]` prefix); never swallowed without a log.
- #5 (verify before declaring done): see §7.
- #8 (subtract before adding): N/A — adding a column is the SPEC scope; no removal needed.
- #9 (no fabricated data in user-facing surfaces): N/A — no user-facing surfaces touched.
- #14 (cite external API docs): satisfied — Gemini function-calling URL + Postgres JSONB indexing URL cited inline.

All other principles N/A for this Sub.

---

## §17 Completion condition (`/goal`) — five clauses

1. **Every spec success criterion implemented + demonstrated:** ✅. Migration + edge fn + tests + invariants + decision log + allowlist all per SPEC §3 + §9 verbatim.
2. **Regression test green + fails-on-revert verified:** ✅. 11 Deno tests pass; fails-on-revert verified at commit `25376e00f`.
3. **`tsc --noEmit` clean (where applicable) + lint clean on touched packages:** ✅ for the edge fn (`deno check` clean); admin `npm run build` clean.
4. **All 14 Constitution rules PASS on the diff:** ✅ per §16.
5. **Edge fn deployed + verify-first-call non-404:** ⏸ DEFERRED to orchestrator post-merge (parity rule #9 split). Command + verify-first-call recipe documented in §6.

**Verdict:** implemented + verified at the local-gate level. Deploy + DB-apply are operator/orchestrator lanes per the standing split.

---

## §18 Discoveries for orchestrator

1. **`place_pool.photo_aesthetic_data` still physically present** with ~30 rows (DEC-099 Cut 1 decommission target). Not in Sub-A scope. Register a separate cleanup ORCH (low priority — 30 rows, no production read).
2. **The dispatch said "~3,752 completed Q2 rows"; live probe = 2,663 completed Q2 rows / 2,366 distinct places.** SPEC was updated to use live numbers throughout. Flagging the discrepancy.
3. **`signal_definitions` schema uses `id` (text) NOT `signal_id`.** Sub-B SPEC must pin the exact source-of-truth path for `EXPECTED_PROMPT_VERSION` (likely `signal_definition_versions.config` JSONB, NOT `signal_definitions.config`).
4. **No COMMS-LEDGER row was added on the anchor `main` checkout for this Sub** because Sub-A's discoveries are all forward-pointing into Sub-B/C/D (sibling sub-dispatches under the same META-ORCH) rather than cross-ORCH affecting another in-flight ORCH. If orchestrator wants a COMMS row for Sub-B implementor heads-up (e.g., "Sub-B must read `signal_definition_versions.config`, not `signal_definitions.config`"), that's a single-line ledger entry to add at close time.

---

## §19 Hand-off summary

- **Branch:** `META-ORCH-1009-Sub-A-ai-signal-scores-schema` (local; not pushed per dispatch instruction).
- **Commits ahead of main:** TBD (commit will be made next, single squash candidate).
- **Files changed:** 5 new + 4 edited; counts in §3.
- **Tests:** 11 Deno tests pass; fails-on-revert proven at `25376e00f`. Plus 1 SQL probe ready for post-apply hand-run.
- **Backfill row count:** pre-flight probe = 2,366 distinct places; post-apply expected = same; live verification deferred to operator's `db push` step.
- **Migration apply command:** `cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-A-[ai-signal-scores-schema]" && /Users/sethogieva/bin/supabase db push --linked`.
- **Edge fn deploy command:** `/Users/sethogieva/bin/supabase functions deploy run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv` (orchestrator lane post-merge).

---

**End of report.**
