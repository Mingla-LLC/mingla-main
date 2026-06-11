# QA — ORCH-1108 [delete 3 dead AI edge functions]

**Mode:** TARGETED (backend-only, source-exempt from sim gate)
**Branch:** `ORCH-1108-delete-dead-ai-functions`
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1108-[delete-dead-ai-functions]/`
**Commit under test:** `7103b2826` (implementor) → tester adversarial test added at `5bee87700`
**origin/main base:** verified via `git fetch origin` before diffing.

---

## 1. Verdict

**PASS** — 0 P0 · 0 P1 · 0 P2 · 0 P3 · 2 P4 (informational).

A pure backend deletion of three forensics-confirmed-dead AI edge functions plus their one config block. Independently re-derived: the 3 dirs are gone, the config blocks are gone, the diff is exactly the expected set, no migration is touched, and — adversarially — there is no dangling import into the deleted dirs, no raw fetch/URL call path, and no migration/cron/net.http executable reference to the dead names. The KEEP verdict on `photoAestheticEnums.ts` is correct (a live function still imports it). Both regression tests run green with independently-proven fails-on-revert.

**Sim gate:** EXEMPT — backend-only / edge-function deletion / config-only, zero UI/runtime surface. No `app-mobile`, `mingla-business`, or `mingla-admin` code touched; nothing renders. Exemption stated per Phase 0.A.

**Routing:** → CLOSE (orchestrator). One operator action remains at close: undeploy the 3 still-ACTIVE live functions (see P4-1).

---

## 2. SC-by-SC matrix

| SC | Criterion | Result | Independent evidence |
|----|-----------|--------|----------------------|
| SC-1 | `generate-ai-summary/`, `ai-reason/`, `score-place-photo-aesthetics/` dirs deleted entirely | **PASS** | `ls supabase/functions/ \| grep -E '...'` → NONE; `git diff --name-status origin/main...HEAD` shows all 3 `index.ts` as `D` (−87 / −274 / −1040 lines) |
| SC-2 | `[functions.ai-reason]` block removed from `config.toml`; the other 2 never had blocks | **PASS** | `grep -nE 'functions\.(generate-ai-summary\|ai-reason\|score-place-photo-aesthetics)' supabase/config.toml` → NONE. config.toml diff = exactly `-[functions.ai-reason]` + its `verify_jwt=true` + blank line (−3); nothing else in the file changed |
| SC-3 | `photoAestheticEnums.ts` handled correctly (KEEP, not orphaned) | **PASS** | Helper still exists on disk; sole importer = LIVE `run-place-intelligence-trial/index.ts:25` `from "../_shared/photoAestheticEnums.ts"`. Deleting it would have orphan-broken a live fn. See §3 + adversarial (d). |
| SC-4 | No functional code in other functions rewritten; comments intact | **PASS** | Diff touches only the 3 deleted dirs + config + 2 test files. Remaining textual refs are inert: SQL `COMMENT ON` strings (migration baseline) + source comments in `admin-seed-places`, `run-place-intelligence-trial`. None executable. |
| SC-5 | Regression test green with fails-on-revert | **PASS** | Implementor test re-run 3/0 on clean HEAD; fails-on-revert independently re-proven (§4). Tester adversarial test 4/0 with its own fails-on-revert (§5). |
| SC-6 | Nothing else touched | **PASS** | `git diff --name-status origin/main...HEAD` = exactly 6 paths (1 M config, 2 A tests, 3 D index.ts). NO migration in diff. |

---

## 3. KEEP verdict on `photoAestheticEnums.ts` — CONFIRMED CORRECT

```
$ ls -la supabase/functions/_shared/photoAestheticEnums.ts   → exists (7110 bytes)
$ grep -rnE 'from .*photoAestheticEnums' <code roots>
  supabase/functions/run-place-intelligence-trial/index.ts:25:} from "../_shared/photoAestheticEnums.ts";   ← LIVE, surviving fn
```

Only ONE importer remains, and it is a function that was NOT deleted. The other historical importer was the now-deleted `score-place-photo-aesthetics`. Had the implementor deleted the helper, `run-place-intelligence-trial` would fail to bundle. **KEEP is correct.** (`mingla-admin/src/constants/placeIntelligenceTrial.js:4` carries only a path COMMENT, not an import.)

---

## 4. Step 0.5 — independent re-run of the IMPLEMENTOR's fails-on-revert proof

Re-ran on a clean checkout at HEAD `7103b2826` with `/Users/sethogieva/.deno/bin/deno` (deno 2.7.14).

**Clean HEAD (`7103b2826`):**
```
ORCH-1108 (a): the 3 dead function directories are deleted ... ok
ORCH-1108 (b): zero invoke/fetch callers across the four roots ... ok
ORCH-1108 (c): config.toml has no block for any deleted function ... ok
ok | 3 passed | 0 failed
```

**Revert (`git checkout origin/main -- supabase/functions/ai-reason` → dir restored):**
```
ORCH-1108 (a): the 3 dead function directories are deleted ... FAILED
  AssertionError: ... (assertEquals at test:59) Dead function dir still exists
FAILED | 2 passed | 1 failed
```

**Restore (force-removed the restored dir):**
```
ok | 3 passed | 0 failed   (green restored)
```

Implementor's fails-on-revert proof **independently re-verified at `7103b2826`** — true file restoration, real failing assertion (case a, line 59), green on re-deletion. Worktree returned clean (HEAD unchanged).

---

## 5. Tester adversarial test added (different angle: no-dangling-refs / orphan-break)

**Path:** `supabase/functions/__tests__/orch_1108_no_dangling_refs.test.ts`
**Commit (append-only, in-diff):** `5bee87700`
**Angle vs implementor:** implementor checked *dirs absent + `.invoke`/`/functions/v1` callers absent + config block absent*. This test attacks the **orphan-break surface the implementor did not cover**:

- **(a)** no source file anywhere `import`s/`require`s FROM a deleted directory (a dangling import = build break) — implementor never checked imports.
- **(b)** no `supabase/migrations` `.sql` names a dead function in an EXECUTABLE position (`cron.schedule` / `pg_cron` / `net.http` / `http_post`); inert `COMMENT ON` strings explicitly allowed — implementor only grepped config.toml, not migrations.
- **(c)** no non-`.invoke` programmatic path remains (`/functions/v1/<dead>` URL or `fetch(".../<dead>")`).
- **(d)** POSITIVE guard: the KEPT helper `photoAestheticEnums.ts` still exists AND `run-place-intelligence-trial` still imports it (proves the KEEP verdict).

**Clean HEAD run:** `4 passed | 0 failed`; `deno check` clean.

**fails-on-revert verified at `5bee87700`** (each case proven hermetically, then restored):
- (d): removed `photoAestheticEnums.ts` from disk → `(d) FAILED (0 passed/1 failed)`; restored → green. (Simulates the wrong KEEP verdict.)
- (a): injected `run-place-intelligence-trial/__dangling_probe.ts` importing `"../ai-reason/index.ts"` → `(a) FAILED`; removed → green.
- (b): injected `migrations/__orch1108_probe.sql` with `cron.schedule(... net.http_post('.../functions/v1/ai-reason'))` → `(b) FAILED`; removed → green.

**Both test files appear in the closing diff** (`git diff --name-status origin/main...HEAD`):
```
A supabase/functions/__tests__/orch_1108_dead_functions_removed.test.ts   (implementor happy-path)
A supabase/functions/__tests__/orch_1108_no_dangling_refs.test.ts          (tester adversarial)
```
Final joint run: **7 passed | 0 failed.**

---

## 6. Dangling-ref / migration / cron sweep — CLEAN

| Check | Command (re-derived) | Result |
|-------|----------------------|--------|
| Raw fetch/URL to `/functions/v1/<dead>` | grep across app-mobile/business/admin/supabase | **NONE** |
| `.invoke("<dead>")` (re-derived implementor angle) | grep across 4 roots | **NONE** |
| Import FROM a deleted dir | `from "…/<dead>/…"` across all roots | **NONE** (no dangling import) |
| Cross-dead import (deleted dir → another deleted dir) | `git show origin/main:<dir>/index.ts` | **NONE** (each imported only `_shared`) |
| Migration executable ref (cron/pg_cron/net.http) | grep `supabase/migrations` | **NONE** |
| Migration textual refs | grep `supabase/migrations` | 2 hits — both `COMMENT ON COLUMN/TABLE` strings (baseline squash, ORCH-0708 doc). Inert. |
| Remaining textual refs (broad repo, ex-artifacts) | grep whole repo | source COMMENTS only (`admin-seed-places`, `run-place-intelligence-trial`, `photoAestheticEnums.ts` header). No call path. |
| Migration in the diff | `git diff --name-only \| grep migrations` | **NONE** — no migration touched (confirmed). |

---

## 7. Constitution 14-rule matrix (independently re-checked against the diff)

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | N/A | No UI surface. |
| 2 | One owner per truth | **PASS** | Deletion removes the only writer of `photo_aesthetic_data`/`photo_aesthetic_runs` invocation; no new writer introduced. The `I-PHOTO-AESTHETIC-DATA-SOLE-OWNER` COMMENT now documents a fn that no longer exists — harmless doc-drift, not an ownership conflict (P4-2). |
| 3 | No silent failures | N/A | No error path added; code only removed. |
| 4 | One query key per entity | N/A | No client query keys touched. |
| 5 | Server state stays server-side | N/A | No Zustand/state touched. |
| 6 | Logout clears everything | N/A | No auth/session code. |
| 7 | Label `[TRANSITIONAL]` + exit | **PASS** | None introduced. |
| 8 | Subtract before adding | **PASS** | This ORCH IS subtraction — dead code removed, nothing re-added. |
| 9 | No fabricated data | N/A | No data paths. |
| 10 | Currency-aware | N/A | No money code. |
| 11 | One auth instance | N/A | No auth client touched. |
| 12 | Validate at right time | N/A | No validation logic. |
| 13 | Exclusion consistency | N/A | No filter logic. |
| 14 | Persisted-state startup gate | N/A | No hydration code. |

No violation. No automatic-P0 trigger fired.

---

## 8. Device / parity matrix

| Surface | Status | Reason |
|---------|--------|--------|
| Consumer iOS | N/A (skip) | Zero callers in `app-mobile`; nothing renders. |
| Consumer Android | N/A (skip) | Same RN codebase; zero callers. |
| Buyer/anonymous Web | N/A (skip) | No invoke/fetch/import refs in `mingla-business`. |
| Business iOS | N/A (skip) | No refs in `mingla-business`. |
| Business Android | N/A (skip) | Same. |
| Admin Web (adjacent) | N/A (skip) | `mingla-admin` carries only a path COMMENT; no import/caller. |
| Business Web preview (adjacent) | N/A (skip) | Same `mingla-business`; zero callers. |
| Edge-fn live deploy state | **NOTE** | All 3 functions still **ACTIVE** in the live project (generate-ai-summary v280, ai-reason v418, score-place-photo-aesthetics v182) — EXPECTED; the implementor does not undeploy. Orchestrator/operator must undeploy at close (P4-1). |

Backend-only source deletion → no end-user surface changes → parity is automatic.

---

## 9. Findings (P-numbered)

**P4-1 (NOTE) — 3 deleted functions are still deployed-ACTIVE live; undeploy is owed at close.**
- Evidence: `mcp__supabase__list_edge_functions` shows `generate-ai-summary` (v280), `ai-reason` (v418), `score-place-photo-aesthetics` (v182) all `status:"ACTIVE"`.
- Impact: none functional (they have zero callers); but the live project still hosts dead functions until torn down. This is the documented hand-off (impl report §11), NOT a defect.
- Required action (orchestrator/operator, NOT implementor): undeploy the 3 functions from MERGED main at close.
- Retest: re-run `list_edge_functions`; confirm the 3 slugs are absent post-close.

**P4-2 (NOTE) — doc-drift: a migration COMMENT + a few source comments still name the deleted functions.**
- Evidence: `20260505000000_baseline_squash_orch_0729.sql:7248,8834` (`COMMENT ON ... 'Owned EXCLUSIVELY by score-place-photo-aesthetics'`); comments in `admin-seed-places/index.ts:1043,1491`, `run-place-intelligence-trial/index.ts:229,652`, `photoAestheticEnums.ts:4`, `mingla-admin/.../placeIntelligenceTrial.js:4`.
- Impact: zero runtime effect (comments / SQL doc-strings only). Left intact per SC-4 (do not rewrite other functions). Worth a future doc-sweep but out of ORCH-1108 scope.
- Required action: none for this ORCH. Optional orchestrator cleanup later.
- Retest: n/a.

No P0 / P1 / P2 / P3.

---

## 10. Discoveries for Orchestrator

- `ANTHROPIC_API_KEY` now has zero active edge-fn consumers (sole consumer `score-place-photo-aesthetics` deleted; only a comment remains in `run-place-intelligence-trial/index.ts:652`). Secret teardown is a separate operator decision — correctly NOT done here.
- At close: (1) undeploy the 3 ACTIVE functions from merged main; (2) optionally sweep the doc-drift comments in P4-2; (3) optionally remove `ANTHROPIC_API_KEY`.
- Comms ledger: no OPEN BLOCK/WARN entry addressed to `tester`, `ORCH-1108`, or `ALL` required action this turn. No new COMMS entry written (no cross-ORCH discovery).

---

## 11. Test environment

- deno 2.7.14 (`/Users/sethogieva/.deno/bin/deno`), `--allow-all`.
- Repo-only hermetic tests (filesystem walks of repo roots + migrations; no network, no live project).
- HEAD verified `7103b2826` (impl) then `5bee87700` (after appending the adversarial test). Worktree left clean (only the untracked IMPLEMENTATION report remains, which is the implementor's working copy — not committed by QA).
