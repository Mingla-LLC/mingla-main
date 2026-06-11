# IMPLEMENTATION — ORCH-1108 [delete 3 confirmed-dead AI edge functions]

**Branch:** `ORCH-1108-delete-dead-ai-functions`
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1108-[delete-dead-ai-functions]/`
**Commit:** `7103b2826`
**Status:** implemented and verified. Backend-only deletion. NOT deployed / merged / closed — routes back to orchestrator for REVIEW (orchestrator undeploys the 3 functions at close).

---

## 1. Summary

Deleted three dead AI edge-function directories that forensics proved have ZERO invokers anywhere (no client `functions.invoke`, no edge-to-edge call, no cron). Removed the single matching `[functions.ai-reason]` block from `supabase/config.toml`. Kept the shared helper `photoAestheticEnums.ts` — it is NOT orphaned (still imported by a live function). Added a Deno regression test (green, fails-on-revert proven). Touched nothing else; no functional code in other functions was rewritten.

---

## 2. SPEC success-criteria coverage

| # | Criterion | Result | Evidence (commit `7103b2826`) |
|---|-----------|--------|-------------------------------|
| SC-1 | `generate-ai-summary/`, `ai-reason/`, `score-place-photo-aesthetics/` dirs deleted entirely | ✓ | `ls supabase/functions/ \| grep -E '...'` → empty; `git diff origin/main...HEAD` shows the 3 `index.ts` as `D` |
| SC-2 | `[functions.ai-reason]` block removed from `config.toml`; no `generate-ai-summary` / `score-place-photo-aesthetics` blocks existed | ✓ | Only `[functions.ai-reason]` was present (lines 6–7); removed. `grep -nE 'functions\.(generate-ai-summary\|ai-reason\|score-place-photo-aesthetics)' supabase/config.toml` → NONE |
| SC-3 | `photoAestheticEnums.ts` handled correctly (delete-if-orphaned / keep-with-reason) | ✓ | KEPT — `run-place-intelligence-trial/index.ts:25` still imports `computeCostUsdGemini` + `MINGLA_SIGNAL_IDS` from it. See §3 verdict. |
| SC-4 | No functional code in other functions rewritten; historical comments left intact | ✓ | Only deletions + config block + new test staged. Comments in `admin-seed-places`, `run-place-intelligence-trial`, migration COMMENTs untouched. |
| SC-5 | Regression test green with fails-on-revert proof | ✓ | 3/3 pass; fails-on-revert verified at `7103b2826` (see §6) |
| SC-6 | Nothing else touched | ✓ | `git diff origin/main...HEAD --name-status` = exactly 5 paths (1 M config, 1 A test, 3 D index.ts) |

---

## 3. `photoAestheticEnums.ts` verdict: **KEEP** (NOT orphaned)

`grep -rnE "photoAestheticEnums" app-mobile mingla-business mingla-admin supabase` returned three hits:

1. `supabase/functions/score-place-photo-aesthetics/index.ts:29` — `import { ... } from "../_shared/photoAestheticEnums.ts"` → **this is the deleted file**.
2. `supabase/functions/run-place-intelligence-trial/index.ts:25` — `import { computeCostUsdGemini, MINGLA_SIGNAL_IDS } from "../_shared/photoAestheticEnums.ts"` → **a REMAINING, live function actively importing it**.
3. `mingla-admin/src/constants/placeIntelligenceTrial.js:4` — a code COMMENT referencing the path (`// supabase/functions/_shared/photoAestheticEnums.ts::MINGLA_SIGNAL_IDS`), not an import.

Because `run-place-intelligence-trial` still statically imports two symbols from it, the helper is NOT orphaned. Deleting it would break a live function. **Verdict: KEEP `photoAestheticEnums.ts`.**

---

## 4. Data-model changes applied

None. Backend-only deletion; no migration, no schema/RLS change.

---

## 5. Edge functions touched

| Function | Change | `verify_jwt` to preserve |
|----------|--------|--------------------------|
| `generate-ai-summary` | **DELETED** | n/a (was unconfigured in config.toml; default applied) |
| `ai-reason` | **DELETED** + config block removed | n/a (deleted) |
| `score-place-photo-aesthetics` | **DELETED** | n/a (was unconfigured in config.toml; default applied) |

**Orchestrator/operator action at close:** undeploy the 3 functions from the live project (the implementor does NOT deploy/undeploy). No remaining function's `verify_jwt` changed.

`ANTHROPIC_API_KEY`: the only active consumer was `score-place-photo-aesthetics`; deleting it removes the live ref. The remaining hit (`run-place-intelligence-trial/index.ts:652`) is a comment noting the key is no longer required.

---

## 6. Regression tests added

**Path:** `supabase/functions/__tests__/orch_1108_dead_functions_removed.test.ts`
**Cases (3):**
- (a) the 3 function directories do NOT exist on disk;
- (b) grep across `app-mobile` / `mingla-business` / `mingla-admin` / `supabase/functions` finds ZERO `functions.invoke("<name>")` (quote-flavor agnostic) and ZERO fetch/URL to `/functions/v1/<name>`;
- (c) guard: `config.toml` declares no `[functions.<dead>]` block.

Historical comments that merely mention the names are explicitly NOT matched (only `.invoke("<name>")` / `/functions/v1/<name>` patterns).

**Passing run (committed state, `7103b2826`):**
```
ORCH-1108 (a): the 3 dead function directories are deleted ... ok (0ms)
ORCH-1108 (b): zero invoke/fetch callers across the four roots ... ok (236ms)
ORCH-1108 (c): config.toml has no block for any deleted function ... ok (0ms)
ok | 3 passed | 0 failed (240ms)
```

**fails-on-revert verified at `7103b2826`:** restored one deleted dir via
`git checkout origin/main -- supabase/functions/ai-reason`, re-ran →
```
ORCH-1108 (a): ... FAILED
AssertionError: Dead function dir still exists: supabase/functions/ai-reason
FAILED | 2 passed | 1 failed
```
Then `git rm -r supabase/functions/ai-reason` and re-ran → 3 passed / 0 failed (green restored). This is a true file restoration (not a comment-out), so the proof is real.

Test command:
```
/Users/sethogieva/.deno/bin/deno test --allow-read --allow-env \
  supabase/functions/__tests__/orch_1108_dead_functions_removed.test.ts
```

---

## 7. Old → New receipts

### supabase/functions/generate-ai-summary/index.ts (DELETED)
**Before:** dead edge function (zero invokers). **Now:** removed. **Why:** SC-1, forensics-confirmed dead. **Lines:** whole dir removed.

### supabase/functions/ai-reason/index.ts (DELETED)
**Before:** dead edge function (zero invokers). **Now:** removed. **Why:** SC-1. **Lines:** whole dir removed.

### supabase/functions/score-place-photo-aesthetics/index.ts (DELETED)
**Before:** dead edge function, superseded by the Gemini intelligence-trial; sole live consumer of `ANTHROPIC_API_KEY`. **Now:** removed. **Why:** SC-1. **Lines:** whole dir removed.

### supabase/config.toml (MODIFIED)
**Before:** declared `[functions.ai-reason] verify_jwt = true` (lines 6–7). **Now:** that block removed; rest of the file intact. **Why:** SC-2 (config for a deleted function). **Lines:** −4 (block + surrounding blank line).

### supabase/functions/__tests__/orch_1108_dead_functions_removed.test.ts (ADDED)
**Before:** n/a. **Now:** Deno regression test (3 cases). **Why:** SC-5, implementor-owned happy-path regression. **Lines:** +~210.

---

## 8. Cross-surface impact table

| Surface | Affected? | Reason |
|---------|-----------|--------|
| Consumer iOS | No | The 3 functions had zero callers in `app-mobile`. |
| Consumer Android | No | Same shared RN codebase; zero callers. |
| Buyer/anonymous Web | No | No invoke/fetch refs in `mingla-business`. |
| Business iOS | No | No invoke/fetch refs in `mingla-business`. |
| Business Android | No | Same. |
| Admin Web (adjacent) | No | `mingla-admin` has only a path COMMENT, no import/caller. |
| Business Web preview (adjacent) | No | Same `mingla-business` codebase; zero callers. |

Pure backend deletion of unused functions — no end-user surface changes. Parity is automatic (nothing rendered).

---

## 9. Smoke result

No sim/device smoke — backend-only, no user-touchable change. Verification was via Deno test + greps:
- `ls supabase/functions/ | grep -E 'generate-ai-summary|ai-reason|score-place-photo-aesthetics'` → empty.
- `grep -rnE "generate-ai-summary|ai-reason|score-place-photo-aesthetics" app-mobile mingla-business mingla-admin supabase/functions | grep -iE "invoke|functions/v1|fetch"` → NONE.
- `grep -rlE "generate-ai-summary|ai-reason|score-place-photo-aesthetics" .github/` → NONE (no CI gate/workflow references them; deletion won't break CI).
- Relevant strict-grep gates run green: `regression-test-backfill-warning.mjs` (no in-scope source modified), `i-ai-signal-scores-column-sole-owner.mjs` (OK, 1494 files), `i-consumer-reads-ai-signal-scores-not-trial-table.mjs` (OK).
- `deno check` on the new test → clean.

---

## 10. Known issues / deferred

None. No `[TRANSITIONAL]` code introduced.

---

## 11. Operator action required

- **No migration** (none written).
- **Undeploy (orchestrator/operator, from MERGED main at close):** `generate-ai-summary`, `ai-reason`, `score-place-photo-aesthetics`. The implementor does not deploy/undeploy.
- **Do NOT remove `ANTHROPIC_API_KEY` blindly here** — out of ORCH-1108 scope; the live consumer is now gone, but key teardown (if desired) is a separate decision. Flagged only for awareness.

---

## 12. Discoveries for Orchestrator

- `ANTHROPIC_API_KEY` now has zero active consumers in `supabase/functions/` (only a comment remains in `run-place-intelligence-trial/index.ts:652`). If the orchestrator wants the secret removed from the project env, that's a separate small task — NOT done here (out of scope).
- `mingla-admin/src/constants/placeIntelligenceTrial.js:4` carries a doc-comment path reference to `_shared/photoAestheticEnums.ts`; harmless, left intact.
- Comms ledger: no OPEN BLOCK/WARN entry addressed to `implementor`, `ORCH-1108`, or `ALL` required action this turn. No new COMMS entry written (no cross-ORCH discovery).
