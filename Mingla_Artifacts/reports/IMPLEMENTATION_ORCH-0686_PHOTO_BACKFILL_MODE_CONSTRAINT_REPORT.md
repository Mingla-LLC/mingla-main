---
ORCH-ID: ORCH-0686
Mode: IMPLEMENTATION
Status: implemented, partially verified — DB SCs awaiting `supabase db push` + admin live-fire
Spec: Mingla_Artifacts/specs/SPEC_ORCH-0686_PHOTO_BACKFILL_MODE_CONSTRAINT.md
Investigation: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0686_PHOTO_BACKFILL_CREATE_RUN_500.md
Implementor: mingla-implementor
Date: 2026-04-26
Wall time: ~30 min (under spec's 60-90 min estimate; live-fire steps deferred to user-driven `db push` + admin UI testing)
---

# IMPLEMENTATION REPORT — ORCH-0686

## 1. Executive Summary

Migration written, admin error helper created and wired into both affected pages, invariant registry updated with two entries, CI gate added with positive + negative control verified. **Zero edge function changes.** **Zero mobile changes.** Two-commit split per spec ready to ship.

**Verification status:**
- Code paths and structural changes: **verified** (admin build clean; CI gate positive + negative controls pass; helper file matches mobile reference; all 5 SignalLibraryPage sites + 1 PlacePoolManagementPage site wired).
- DB changes (SC-1, SC-2, SC-10) and live-fire (T-08, T-09, T-10): **awaiting user `supabase db push` + admin UI exercise.**
- Per implementor skill rule: I do NOT apply migrations via MCP. The migration file is on disk; the user runs `supabase db push` against project `gqnoajqerqhnvulmnyvv` (Mingla-dev) to apply.

## 2. Pre-Flight Gate Results

| Gate | Result |
|---|---|
| G-1 working tree clean of `supabase/functions/` | PASS — `git diff --name-only HEAD -- supabase/functions/` returns empty |
| G-2 `mingla-admin/src/lib/edgeFunctionError.js` does not exist | PASS — file did not exist; created fresh |
| G-3 `PlacePoolManagementPage.jsx:1377-1382` matches spec snippet | PASS — verbatim match; edit-by-symbol used regardless |
| G-4 SignalLibraryPage `invokeWithRefresh` consumer count | PASS — 5 sites confirmed at lines 169, 221, 263, 389, 628; ALL wired |
| G-5 `ci-check-invariants.sh` `errors`-counter pattern | ADAPT — file uses `FAIL=1` flag; gate adapted to that pattern, intent preserved |
| G-6 live constraint def matches investigation §E-1 | PASS — `mcp__supabase__execute_sql` returned `CHECK ((mode = ANY (ARRAY['initial'::text, 'refresh_servable'::text])))` verbatim; bug remains unfixed in DB |

## 3. Files Changed (Old → New Receipts)

### supabase/migrations/20260501000001_orch_0686_photo_backfill_mode_constraint.sql (NEW, 103 lines)

**What it did before:** N/A (new file).
**What it does now:** Drops the stale `photo_backfill_runs_mode_check` constraint, re-adds it with all three permitted values (`initial` legacy / `pre_photo_passed` new default / `refresh_servable`), flips the column DEFAULT from `initial` to `pre_photo_passed`, updates the column comment to reflect rewritten `I-PHOTO-FILTER-EXPLICIT`, and runs a post-condition DO block that fails loud if any of those three changes are missing post-apply.
**Why:** SC-1, SC-2, SC-3, SC-4, SC-5, SC-6, SC-10. Spec §3.1.
**Lines:** 103.

**Migration timestamp:** spec suggested `20260426000001`, but the latest existing migration is `20260430000001_orch_0678_pre_photo_bouncer.sql` (already applied per AH-212/AH-213). To preserve lexical ordering for `supabase db push`, I used `20260501000001`. This is a non-deviation — spec §3.1 says "Implementor: pick the next-available timestamp suffix if `20260426000001` is already taken when the file is created." The selected timestamp is the next available after the latest applied migration.

### mingla-admin/src/lib/edgeFunctionError.js (NEW, 66 lines)

**What it did before:** N/A (new file).
**What it does now:** Exports `extractFunctionError(error, fallback)` — a Promise-returning helper that unwraps Supabase `FunctionsHttpError` response bodies via duck-typed `Response.text()` + `JSON.parse`, with status-code-derived fallbacks and a final `error.message` fallback that filters out the generic SDK string. Never throws.
**Why:** SC-9, SC-7 follow-on. Spec §3.3. Mirrors `app-mobile/src/utils/edgeFunctionError.ts` semantically (port to JS).
**Lines:** 66.

### mingla-admin/src/pages/PlacePoolManagementPage.jsx (+6/-2)

**What it did before:** Local `invoke` helper (line 1377) called `supabase.functions.invoke("backfill-place-photos", { body })`, then on error threw `new Error(error.message || "Edge function error")` — surfacing the generic SDK string `"Edge Function returned a non-2xx status code"` to the toast description at line 1533.
**What it does now:** Imports `extractFunctionError` from `../lib/edgeFunctionError`. The `invoke` helper now `await`s `extractFunctionError(error, "Edge function error")` and throws the unwrapped message. Downstream `addToast({ description: err.message })` callsites (≥10) automatically benefit — the `err.message` they consume is now the real Postgres error text.
**Why:** SC-9. Spec §3.4.
**Lines changed:** 6 inserted, 2 removed (one import line + four-line invoke-helper rewrite).

### mingla-admin/src/pages/SignalLibraryPage.jsx (+22/-4)

**What it did before:** Five `invokeWithRefresh` consumers across the file. Each had the pattern `if (error) throw error;` (variable names: `error`, `runErr`, `batchErr`). On a non-2xx, the thrown `FunctionsHttpError` would carry only the generic SDK message into downstream `showToast(err.message, "error")` and `setProgress({ message: err.message })` calls.
**What it does now:** Imports `extractFunctionError`. All 5 sites (lines 169, 221, 263, 389, 628) now `await extractFunctionError(<localErrVar>, "Edge function error")` and throw `new Error(msg)` — surfacing the real edge-fn body to every downstream consumer.
**Why:** SC-9, SC-8 follow-on. Spec §3.5. The spec mandate is "every `invokeWithRefresh` consumer in `SignalLibraryPage.jsx`" — I wired all 5, including the 3 against `run-signal-scorer` and `edgeFn` (variable). The helper is harmless on errors that already carry meaningful messages.
**Lines changed:** 22 inserted, 4 removed.

### Mingla_Artifacts/INVARIANT_REGISTRY.md (+56/0)

**What it did before:** Held entries for ORCH-0664/0668/0669/0671/0675/0677/0678 invariants. The original `I-PHOTO-FILTER-EXPLICIT` was declared inline in the ORCH-0598.11 migration's comment block but never persisted as a registry entry — that's how it went stale through ORCH-0678 (per investigation §F-2).
**What it does now:** Prepends a new `## ORCH-0686 invariants (2026-04-26)` section ahead of the existing ORCH-0678 section with two entries:
- `I-PHOTO-FILTER-EXPLICIT` — rewritten 3-mode form (legacy `initial`, current default `pre_photo_passed`, maintenance `refresh_servable`), with persistence rationale (was previously only a migration comment).
- `I-DB-ENUM-CODE-PARITY` — new structural rule that any persisted TS union/enum value MUST be matched by the SQL CHECK constraint in the same change. CI-gated.
**Why:** SC-11. Spec §3.6 Action 1 + Action 2.
**Lines changed:** 56 inserted.

### scripts/ci-check-invariants.sh (+58/-5)

**What it did before:** 13 existing gates terminating with `if [ $FAIL -eq 1 ]; then exit 1; fi; echo "All ... pass"; exit 0`.
**What it does now:** Appended `I-DB-ENUM-CODE-PARITY` gate before the terminal block. Gate parses the `BackfillMode` TypeScript union literal values from `supabase/functions/backfill-place-photos/index.ts`, parses the latest non-ROLLBACK migration that defines `photo_backfill_runs_mode_check` and extracts the literal values from its actual `CHECK (mode IN (...))` clause (using `awk` to scope to the constraint clause only — early-iteration grep was too greedy and pulled values from `RAISE EXCEPTION` strings and `LIKE '%...%'` predicates). Asserts every TS value appears in the SQL value set (subset semantics — see Deviation 1). Updated terminal summary to include `ORCH-0686`.
**Why:** SC-12, SC-11. Spec §3.7.
**Lines changed:** 58 inserted, 5 removed.

## 4. Spec Traceability (each SC → verification)

| SC | Criterion | Verification | Status |
|---|---|---|---|
| SC-1 | `pg_get_constraintdef` returns CHECK with 3 permutation-equal values | DB query post-`supabase db push` | **awaiting user push** |
| SC-2 | `column_default` is `'pre_photo_passed'::text` | `information_schema.columns` query post-push | **awaiting user push** |
| SC-3 | INSERT mode='pre_photo_passed' succeeds | `BEGIN; INSERT…; ROLLBACK;` post-push | **awaiting user push** |
| SC-4 | INSERT mode='garbage' raises 23514 | `BEGIN; INSERT…; ROLLBACK;` post-push | **awaiting user push** |
| SC-5 | INSERT mode='initial' succeeds | `BEGIN; INSERT…; ROLLBACK;` post-push | **awaiting user push** |
| SC-6 | INSERT mode='refresh_servable' succeeds | `BEGIN; INSERT…; ROLLBACK;` post-push | **awaiting user push** |
| SC-7 | "Create photo download run" admin UI live-fire | Admin UI exercise post-deploy | **awaiting user push + admin live-fire** |
| SC-8 | Signal Library one-shot live-fire | Admin UI exercise post-deploy | **awaiting user push + admin live-fire** |
| SC-9 | Forced 500 surfaces real Postgres error in toast | Admin UI live-fire with synthetic injection | **awaiting user push + admin live-fire** (helper code-verified mirroring app-mobile pattern; mobile helper is identical-shape and proven in production) |
| SC-10 | 18 legacy `mode='initial'` rows unchanged | DB query post-push | **awaiting user push** (legacy preservation is structural — migration only changes constraint + default, no UPDATE statements touch existing rows) |
| SC-11 | INVARIANT_REGISTRY contains rewritten + new entries | Repo grep | **PASS** — both entries written; verified by `grep "^### I-PHOTO-FILTER-EXPLICIT$\|^### I-DB-ENUM-CODE-PARITY$" Mingla_Artifacts/INVARIANT_REGISTRY.md` returns 2 hits |
| SC-12 | CI gate negative-control fires + names file | Bash injection test | **PASS** — see §5 negative-control evidence |
| SC-13 | Zero edge function diffs | `git diff --name-only HEAD -- supabase/functions/` | **PASS** — returns empty (verified post-revert of the temporary T-11 injection) |
| SC-14 | Lagos / pre-bouncer-approved city run creates successfully | Admin UI live-fire post-deploy | **awaiting user push + admin live-fire** |

## 5. Negative-Control Evidence (T-11)

Verbatim CI gate output with `'fakemode'` injected into the `BackfillMode` TS union:

```
Checking I-DB-ENUM-CODE-PARITY...
FAIL: I-DB-ENUM-CODE-PARITY violated.
   BackfillMode TS values (supabase/functions/backfill-place-photos/index.ts): fakemode pre_photo_passed refresh_servable
   CHECK constraint SQL values (supabase/migrations/20260501000001_orch_0686_photo_backfill_mode_constraint.sql): initial pre_photo_passed refresh_servable
   Missing from SQL CHECK clause: fakemode
   Every TS BackfillMode value MUST be present in the SQL CHECK clause.
   Update the migration to include the missing value(s).

ORCH-0640 / ORCH-0649 / ORCH-0659 / ORCH-0660 / ORCH-0664 / ORCH-0666 / ORCH-0667 / ORCH-0668 / ORCH-0669 / ORCH-0671 / ORCH-0677 / ORCH-0678 / ORCH-0686 invariant check FAILED.
```

Process exit code: **1** (verified via `echo $?` after run).

After revert (`cp /tmp/orch0686_index.ts.bak supabase/functions/backfill-place-photos/index.ts`):

```
Checking I-DB-ENUM-CODE-PARITY...
  OK (TS=[pre_photo_passed refresh_servable] subset-of SQL=[initial pre_photo_passed refresh_servable])
```

`git status --short supabase/functions/backfill-place-photos/index.ts` post-revert: **empty** (zero residual diff against HEAD).

## 6. Positive-Control Evidence (T-12)

```
Checking I-DB-ENUM-CODE-PARITY...
  OK (TS=[pre_photo_passed refresh_servable] subset-of SQL=[initial pre_photo_passed refresh_servable])
```

Pre-existing `I-RPC-LANGUAGE-SQL-FOR-HOT-PATH` baseline failure on `fetch_local_signal_ranked` is unrelated to ORCH-0686 (tracked as ORCH-0683 per AH-208 / Wave 4 D-1) — exit 1 of the script as a whole is dominated by that pre-existing baseline, NOT by my new gate.

## 7. Admin Build Verification

```
> mingla-admin@0.0.0 build
> vite build
vite v7.3.1 building client environment for production...
transforming...
✓ 2923 modules transformed.
...
✓ built in 28.47s
```

The leaflet dynamic-vs-static import warning is pre-existing (unchanged from current main), not introduced by this ORCH.

## 8. Diff Summary

| File | Status | Lines |
|---|---|---|
| `supabase/migrations/20260501000001_orch_0686_photo_backfill_mode_constraint.sql` | NEW | 103 |
| `mingla-admin/src/lib/edgeFunctionError.js` | NEW | 66 |
| `mingla-admin/src/pages/PlacePoolManagementPage.jsx` | MOD | +6/-2 |
| `mingla-admin/src/pages/SignalLibraryPage.jsx` | MOD | +22/-4 |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | MOD | +56/0 |
| `scripts/ci-check-invariants.sh` | MOD | +58/-5 |
| `supabase/functions/**` | UNCHANGED | 0 |

`git diff --name-only HEAD -- supabase/functions/` returns empty → SC-13 PASS.

## 9. Constitutional & Invariant Compliance

| Reference | Status | Note |
|---|---|---|
| #2 — One owner per truth | strengthened | SQL CHECK is the structural source of truth for allowed modes; TS union is a strict subset; CI gate enforces. |
| #3 — No silent failures | improved | Admin toasts now surface real edge-fn body content; generic SDK string is filtered out. |
| #8 — Subtract before adding | honored | Migration drops stale 2-value constraint cleanly before adding 3-value one. |
| #9 — No fabricated data | unaffected | No data-rendering paths touched. |
| #14 — Persisted-state startup | unaffected | 18 legacy rows untouched; constraint widening preserves them. |
| `I-PHOTO-FILTER-EXPLICIT` | rewritten | Now permanent registry entry; 3-mode form. |
| `I-DB-ENUM-CODE-PARITY` | new | CI-gated structural prevention. |
| `I-PRE-PHOTO-BOUNCER-SOLE-WRITER` / `I-IS-SERVABLE-SINGLE-WRITER` / `I-PHOTO-DOWNLOAD-GATES-ON-PRE-PHOTO` | unaffected | No edge function code touched. |
| `I-COUPLED-DIFF-NEVER-PARTIAL-COMMIT` | honored | Two-commit split is structural (migration+invariant+CI is one cohesive unit; admin helper+wires is the other) — no half-shipped state at either commit boundary. |

## 10. Cache Safety / Parity / Regression Surface

- **Cache safety:** No React Query / Zustand / AsyncStorage shape changes. N/A.
- **Solo / collab parity:** Admin-only flow. N/A.
- **Regression surface to test (3-5 most likely to break from this change):**
  1. PlacePoolManagementPage Photos tab — every button that hits `backfill-place-photos` (Create Run, Run Next, Auto Run, Cancel, Pause, Resume, Retry Batch, Skip Batch). Helper change is at the local `invoke` callsite — error path only; success path unchanged.
  2. SignalLibraryPage RunBouncerButton — error toasts on a real `run-bouncer` failure should now show the actual error text, not the generic SDK string.
  3. SignalLibraryPage one-shot pipeline button — error path on either Step A (`create_run`) or Step B (`run_next_batch`) should surface real errors.
  4. SignalLibraryPage scorer error path — same.
  5. SignalLibraryPage scorer-all loop — error per signal should surface real errors.

## 11. Discoveries for Orchestrator

### D-1 — Spec contradiction surfaced (resolved by judgement, documented)

Spec §3.6 Action 1 + Action 2 say "the TypeScript value set and the SQL CHECK value set MUST be permutation-equal at all times." But spec §2 explicitly forbids modifying `BackfillMode` (it stays as `'pre_photo_passed' | 'refresh_servable'`), AND spec test case T-02 requires the SQL constraint to accept `'initial'` for legacy compat. These two are mathematically incompatible: TS has 2 values, SQL has 3 — not permutation-equal. Implementor judgement applied: the gate's actual intent (catch TS additions/renames that don't reach SQL — RC-0540 / RC-0686 class) is correctly enforced by **subset semantics** (`TS ⊆ SQL`), not strict equality. Subset semantics handle every test case correctly:
- T-11 negative (TS adds `'fakemode'` not in SQL) → fires.
- T-12 positive (TS={2}, SQL={3 with `'initial'` legacy}) → passes.
- Future negative (SQL drops `'pre_photo_passed'` while TS keeps it) → fires.

Recommend orchestrator update spec §3.6 / §3.7 wording from "permutation-equal" to "TS subset of SQL (SQL may carry legacy values)" in any future re-spec or amendment.

### D-2 — `parseBackfillMode` legacy coercion is structurally invisible to the gate

The function `parseBackfillMode` ([backfill-place-photos/index.ts:121-126](supabase/functions/backfill-place-photos/index.ts#L121-L126)) coerces any non-`'refresh_servable'` value to `'pre_photo_passed'` — including the legacy `'initial'` value when read back from historical rows. The gate cannot detect this coercion (it only inspects the `BackfillMode` union declaration). If a future read path actually exercises the 18 historical `mode='initial'` rows, they will silently be re-classified as `'pre_photo_passed'` semantics. Investigation §F-3 already flagged this as latent. No action needed for ORCH-0686 (legacy rows are all terminal-state). Track as future awareness; if `'initial'` ever needs to be a distinct read-back semantic, the coercion needs to widen `BackfillMode` to include it.

### D-3 — Pre-existing CI baseline failure carried forward (not new)

`bash scripts/ci-check-invariants.sh` exit 1 is dominated by the pre-existing `I-RPC-LANGUAGE-SQL-FOR-HOT-PATH` failure on `fetch_local_signal_ranked` — already tracked as ORCH-0683 (S2, deferred). My new `I-DB-ENUM-CODE-PARITY` gate is independent and prints `OK` cleanly under positive control. No regression introduced.

### D-4 — Spec §13 "implementor report" path mismatch

Spec §13 says report goes to `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0686_PHOTO_BACKFILL_MODE_CONSTRAINT_REPORT.md`. IMPL prompt §"Required output" says the same. I wrote it there. Note for orchestrator: prior implementor reports use both `Mingla_Artifacts/reports/` and `Mingla_Artifacts/outputs/` — confirm the canonical location is `reports/` going forward.

## 12. Deviations from Spec

| # | Deviation | Justification |
|---|---|---|
| 1 | Migration timestamp `20260501000001` not `20260426000001` | Latest applied migration is `20260430000001`; the suggested timestamp would land before it lexically and break `supabase db push` ordering. Spec §3.1 explicitly authorizes "pick the next-available timestamp suffix." |
| 2 | CI gate uses subset semantics (`TS ⊆ SQL`) not strict permutation-equal | See D-1 above. Spec §2 forbidding TS modification + spec T-02 requiring SQL `'initial'` create a contradiction with §3.6 "permutation-equal" wording. Subset semantics honor all test cases and the structural intent. |
| 3 | CI gate uses `awk` to scope to the `CHECK (mode IN (...))` clause | Initial grep-based extraction matched values inside `RAISE EXCEPTION '...'` strings and `LIKE '%...%'` predicates elsewhere in the migration. Tightening to the actual CHECK clause is required for correctness; spec §3.7 says "Implementor: adapt to the exact loop / counter variable names already in the script. The shape — extract TS values, extract SQL values, sort-compare, fail with both sets named — is binding; the exact bash is illustrative." Adaptation is within spec authority. |

No other deviations.

## 13. User-Driven Steps to Complete the Cycle

The implementor (per `mingla-implementor` skill rule) does not apply migrations or push commits. Founder/user actions to complete the spec's success criteria:

1. **Apply the migration:**
   ```bash
   cd "C:/Users/user/Desktop/mingla-main"
   supabase db push
   ```
   Expected: migration `20260501000001_orch_0686_photo_backfill_mode_constraint.sql` applies cleanly. Post-condition DO block runs silently (no `RAISE EXCEPTION` fires).

2. **Verify SC-1, SC-2, SC-10 via direct DB query** (`mcp__supabase__execute_sql` against `gqnoajqerqhnvulmnyvv`):
   ```sql
   -- SC-1
   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'photo_backfill_runs_mode_check';
   -- Expect: CHECK ((mode = ANY (ARRAY['initial'::text, 'pre_photo_passed'::text, 'refresh_servable'::text])))

   -- SC-2
   SELECT column_default FROM information_schema.columns
   WHERE table_schema='public' AND table_name='photo_backfill_runs' AND column_name='mode';
   -- Expect: 'pre_photo_passed'::text

   -- SC-10
   SELECT mode, status, count(*) FROM public.photo_backfill_runs GROUP BY 1,2;
   -- Expect: same 18-row split as before — 16 mode='initial' status='completed', 2 mode='initial' status='cancelled'.
   ```

3. **Run T-01 through T-06 as `BEGIN; INSERT…; ROLLBACK;` probes** to verify the constraint accepts the 3 valid values and rejects garbage. Per investigation §E-3, the harness may deny direct production writes; if so, the constraint def alone (SC-1) is deterministic proof.

4. **Commit 1 (migration + invariant registry + CI gate):**
   ```bash
   git add supabase/migrations/20260501000001_orch_0686_photo_backfill_mode_constraint.sql \
           Mingla_Artifacts/INVARIANT_REGISTRY.md \
           scripts/ci-check-invariants.sh
   git commit -m "$(cat <<'EOF'
   fix(photo-backfill): ORCH-0686 align photo_backfill_runs.mode CHECK constraint with ORCH-0678 enum rename

   ORCH-0678 renamed BackfillMode 'initial' -> 'pre_photo_passed' in the edge function
   and admin UI but did not amend the photo_backfill_runs_mode_check constraint, which
   still rejects every value other than ('initial', 'refresh_servable'). Every create_run
   since ORCH-0678 deploy has hit SQLSTATE 23514 — 14,401 pre-bouncer-approved places
   stranded.

   This commit:
   - New migration drops + re-adds photo_backfill_runs_mode_check with all three
     permitted values: 'initial' (legacy alias for 18 historical terminal-state rows),
     'pre_photo_passed' (current default), 'refresh_servable' (Bouncer-approved
     maintenance).
   - Flips column default 'initial' -> 'pre_photo_passed'.
   - Updates column comment to reflect rewritten I-PHOTO-FILTER-EXPLICIT invariant.
   - Post-condition DO block fails loud if constraint or default is missing post-apply.
   - INVARIANT_REGISTRY.md: rewrite I-PHOTO-FILTER-EXPLICIT under three values; register
     new I-DB-ENUM-CODE-PARITY (CI-gated structural prevention of TS-rename-without-SQL
     drift; same class as ORCH-0540).
   - scripts/ci-check-invariants.sh: new I-DB-ENUM-CODE-PARITY gate asserts the
     BackfillMode TS union is a subset of the photo_backfill_runs.mode CHECK constraint
     value set (legacy SQL-only values like 'initial' permitted).

   Investigation: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0686_PHOTO_BACKFILL_CREATE_RUN_500.md
   Spec:          Mingla_Artifacts/specs/SPEC_ORCH-0686_PHOTO_BACKFILL_MODE_CONSTRAINT.md
   Unblocks:      ORCH-0682 Steps 2+3 (Lagos + 8-city operational recovery)

   Apply order: supabase db push BEFORE deploying any UI changes.
   No edge function changes. No EAS update required.
   EOF
   )"
   ```

5. **Commit 2 (admin error-body unwrapper + wires):**
   ```bash
   git add mingla-admin/src/lib/edgeFunctionError.js \
           mingla-admin/src/pages/PlacePoolManagementPage.jsx \
           mingla-admin/src/pages/SignalLibraryPage.jsx
   git commit -m "$(cat <<'EOF'
   fix(admin): ORCH-0686 surface real edge-function error bodies in admin toasts

   Constitution #3 sub-finding F-4 from ORCH-0686 investigation: the Supabase JS client
   wraps non-2xx responses in a FunctionsHttpError whose .message is the generic string
   "Edge Function returned a non-2xx status code". The actual body containing the real
   error (Postgres constraint name, edge fn diagnostic, etc.) lives in error.context as
   an unread Response. The admin's invoke helpers re-threw error.message verbatim, so
   operators saw a generic toast and could not diagnose without reading edge logs.

   This commit:
   - New helper mingla-admin/src/lib/edgeFunctionError.js mirrors
     app-mobile/src/utils/edgeFunctionError.ts (port to JS, same duck-type Response,
     text-first body read, never throws).
   - PlacePoolManagementPage.jsx local invoke helper unwraps the body before re-throwing.
   - SignalLibraryPage.jsx all 5 invokeWithRefresh consumers unwrap the body before
     re-throwing.

   Toast description on a forced 500 now contains the real Postgres error text instead
   of the generic SDK message. Future bugs of the same shape will be self-diagnosing.

   Spec: Mingla_Artifacts/specs/SPEC_ORCH-0686_PHOTO_BACKFILL_MODE_CONSTRAINT.md
   EOF
   )"
   ```

6. **Push:**
   ```bash
   git push origin Seth
   ```

7. **Live-fire T-08, T-09, T-10** in the admin UI:
   - T-08: Place Pool Photos tab → pick a city with `passes_pre_photo_check=true` rows (e.g., Lagos `287cab01-4430-4930-983a-435aa194f33a` with 14,401 stranded) → click "Create photo download run" → run row should be created with `status='ready'`, `mode='pre_photo_passed'`. Capture run_id.
   - T-09: Signal Library → pick Lagos → click the one-shot pipeline button → Step A (`create_run`) succeeds, Step B (`run_next_batch`) loop begins. Capture run_id.
   - T-10: Force a 500 by temporarily reverting the migration on a branch DB OR via dev console invoking `backfill-place-photos` with `body: { action: "create_run", mode: "garbage", ... }` — the toast description should contain text like `"violates check constraint"` or the edge-fn's `error` body, NOT the generic SDK message.

8. **No EAS update.** No `eas update` invocation needed (admin only; mobile unaffected).

9. **No edge function deploy.** Verify with `git diff --name-only HEAD~2..HEAD -- supabase/functions/` returns empty.

## 14. Status Label

**implemented, partially verified.**

- Code paths and structural changes: verified locally (build clean, CI gate positive + negative controls pass).
- DB-state SCs and admin-UI live-fire SCs: awaiting user `supabase db push` and admin UI exercise.
- The migration file is the authoritative artifact; once applied via `supabase db push`, all DB-state SCs become trivially verifiable via the SQL probes documented in §13.

## 15. Hand-Back

Two commits ready (templates in §13). Migration ready to apply. No edge function deploy. No EAS update. ORCH-0682 unblocks once this ships.

Hand back to orchestrator for REVIEW + tester dispatch.
