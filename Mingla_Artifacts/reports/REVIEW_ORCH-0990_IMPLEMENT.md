# REVIEW — ORCH-0990 IMPLEMENT

**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-29
**Implementation commit:** `031b9a176` on `ORCH-0990-flower-stop-real-florists`
**Verdict: APPROVED** — proceed to TEST (Step 0.5 tester-adversarial test required before CLOSE).

## Commit-hash verification

All 12 claimed-changed files present in commit `031b9a176` (single commit; `git show --stat` confirms). Working tree clean (only symlinked `node_modules` untracked). Backend files + `ORCH_0990_BACKEND_ALLOWLIST` landed in the SAME commit (COMMS-0002 satisfied). No file modified-but-uncommitted.

| File | Verified |
|---|---|
| `supabase/migrations/20260801000001_orch_0990_fetch_local_signal_ranked_primary_type_gate.sql` | ✓ matches SPEC §8.1 (DROP old 9-arg → CREATE 11-arg → re-GRANT/OWNER/COMMENT) |
| `supabase/functions/_shared/signalRankFetch.ts` | ✓ flowers NOT in `COMBO_SLUG_TYPE_FILTER`; new `COMBO_SLUG_PRIMARY_TYPE_GATE.flowers={primaryTypes:['florist'],groceryFloralTag:true}`; `COMBO_SLUG_FILTER_MIN.flowers=0`; params threaded with `?? null`/`?? false` defaults |
| `supabase/functions/_shared/stopAlternatives.ts` + `generate-curated-experiences/index.ts` | ✓ both edge flows thread the new params (Constitution #13 parity) |
| `_shared/signalRankFetch.flowers.test.ts` | ✓ 8/8 pass |
| `.github/scripts/strict-grep/orch-0990-flower-stop-florist-gate.mjs` + workflow job | ✓ gate passes |
| `orch-0863-marketing-hub-phase-b.mjs` (allowlist) | ✓ C7 passes |
| `INVARIANT_REGISTRY.md` (`I-PROPOSED-FLOWER-STOP-FLORIST-VERIFIED`) | ✓ DRAFT stanza |

**Migration version safety:** `...000001` correctly avoids collision with sibling worktree ORCH-0989's `...000000` (orchestrator confirmed across all `~/Desktop/mingla-orchs/*/supabase/migrations/`). Implementor's documented `000000→000001` bump is correct per monotonicity rule.

## Dependency walk (RPC migration + signalRankFetch.ts)

- RPC `fetch_local_signal_ranked` has exactly ONE call site (`_shared/signalRankFetch.ts`), invoked by named args; new params default → composite clause is a no-op for every existing caller. No regression surface beyond flowers.
- `signalRankFetch.ts` consumers: `generate-curated-experiences/index.ts` + `replace-curated-stop/index.ts` (via `stopAlternatives.ts`). Both must redeploy post-migration (their bundled `_shared` changed). Named for redeploy.
- No client-side (`app-mobile`/`mingla-business`/`mingla-admin`) consumer — server-generated cards, no client change. ✓

## Independent verification (orchestrator-run, this environment has DB + network)

- **Deno tests:** `8 passed | 0 failed` incl. T-01 fails-on-revert + T-07 floor-0 + T-01 adversarial.
- **strict-grep:** `orch-0990-flower-stop-florist-gate.mjs` PASS; `orch-0863` C7 allowlist PASS.
- **Live RPC-logic probe** (composite gate applied inline against production `place_pool`/`place_scores`, read-only):
  - Lagos → 3 rows, all `primary_type='florist'` (zero service/general_contractor noise).
  - Raleigh → 8 rows, all `grocery_store` floral-dept (Harris Teeter); no true florist exists there, carve-out is load-bearing.
  - Paris → 0 rows → honest-omit.
  - Confirms the operator's "100% bouquet" bar is met empirically, including the two flagged cities.

## Minor (non-blocking, P4)

`signalRankFetch.ts` JSDoc near the `comboFilterMin` resolver still reads "movies/flowers = 80" — stale (flowers is now 0; logic at the const is correct). Cosmetic; tester or a follow-up may tidy. Not a blocker.

## Next

Route to `mingla-tester`. Step 0.5 (b) requires a **tester-written adversarial regression test** at a real path, different angle from the implementor's revert-detection test (e.g., no-regression no-op for hiking/museum, or floor-0 ordering, or grocery-without-floral-tag exclusion). Live-deployed end-to-end (apply migration → deploy → call `generate-curated-experiences`) is the CLOSE-time smoke, after PR merge.
