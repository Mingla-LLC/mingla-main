# REVIEW — ORCH-0990 SPEC (Pass 2)

**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-29
**Artifact:** `Mingla_Artifacts/specs/SPEC_ORCH-0990_FLOWER_STOP_REAL_FLORISTS.md` (revision `ca3c3f291`)
**Verdict: APPROVED** — Pass-1 defects fully resolved; mechanism validated against live data.

## Commit-hash verification

- SPEC revision committed on branch `ORCH-0990-flower-stop-real-florists` at `ca3c3f291` ("SPEC PASS-2: composite primary-type florist gate + RPC migration + floor 0"). Not uncommitted. ✓
- REVIEW Pass-1 report `REVIEW_ORCH-0990_SPEC_PASS1.md` present in worktree (orchestrator artifact). ✓
- No product code this phase (SPEC only). ✓

## Dependency walk (config/DB-layer change — RPC migration)

The SPEC re-creates the shared RPC `fetch_local_signal_ranked` and edits `_shared/signalRankFetch.ts`. Every consumer enumerated and assessed:

| Consumer | Reaches change via | Compatibility |
|---|---|---|
| `_shared/signalRankFetch.ts` | the ONLY caller of the RPC; invokes by **named args**, never naming the two new params | No-op: new params default `NULL`/`false` → composite clause reduces to `TRUE`. Byte-identical rows for hiking/museum/all non-flowers signals. Only the flowers resolver newly passes the params. ✓ |
| `generate-curated-experiences/index.ts` | imports `signalRankFetch.ts` (curated-card generation flow) | Inherits the flowers gate; **must redeploy** (bundled `_shared` changed). ✓ named for redeploy in §8.5 |
| `replace-curated-stop/index.ts` (+ `_shared/stopAlternatives.ts`) | imports `signalRankFetch.ts` (stop-swap flow) | Same gate via Constitution #13 generation/serving parity; **must redeploy**. ✓ named in §8.5 |

No other RPC caller exists (`grep` confirms single chokepoint). The migration's `DROP FUNCTION IF EXISTS <exact old 9-arg signature>` → `CREATE OR REPLACE` (11-arg) → re-GRANT/OWNER/COMMENT ordering correctly avoids the ambiguous-overload hazard; STABLE SECURITY DEFINER read-only (no lock/mutation risk).

## Defect resolution

- **Defect 1 (P0) RESOLVED** — gate is now the composite `primary_type='florist' OR (primary_type IN ('grocery_store','supermarket') AND 'florist'=ANY(types))`, expressed via two new RPC params; flowers is NOT added to `COMBO_SLUG_TYPE_FILTER` (correctly avoids the wrong `types[]`-overlap path). Independently re-validated by orchestrator live probe: Lagos → 3 real florists, 0 noise; Raleigh → Harris Teeter floral-dept groceries only.
- **Defect 2 (P1) RESOLVED** — `COMBO_SLUG_FILTER_MIN.flowers = 0` (order-only); justified by Lagos Fresh Flowers (33) + Sparkle Gardens (0).
- **Defect 3 (P1) RESOLVED** — per-city coverage recomputed with the composite gate: 9 covered (incl. both flagged cities), 8 honest-empty (registered as a separate seeding gap D-1, not this ORCH).

Strict-grep gate, Step-0.5 fails-on-revert test, and `I-PROPOSED-FLOWER-STOP-FLORIST-VERIFIED` invariant all updated to assert the composite gate + floor 0 + no-regression (T-09). Scope confirmed backend-only, no client change. COMMS-0002 (allowlist same-commit) + COMMS-0003 (Google Places field semantics cited, no new external API) satisfied.

**→ Proceed to IMPLEMENT.**
