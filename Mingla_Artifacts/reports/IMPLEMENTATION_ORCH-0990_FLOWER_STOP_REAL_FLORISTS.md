# IMPLEMENTATION — ORCH-0990 [Curated "Flowers" stop resolves to real florists]

**Implementor:** Claude `mingla-implementor` (parity mirror)
**Date:** 2026-05-29
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0990-[flower-stop-real-florists]/` on branch `ORCH-0990-flower-stop-real-florists`
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-0990_FLOWER_STOP_REAL_FLORISTS.md` (`ca3c3f291`) — APPROVED REVIEW Pass 2
**Surface class:** Backend-only (Supabase RPC migration + edge `_shared` TS + 2 edge call-sites). NO client code.
**Status:** implemented and verified (local gates + Deno tests + fails-on-revert). Live-data RPC probes (Lagos/Raleigh row sets) are tester-phase per SPEC §14 step 8 — the implement environment has no network egress (see §Verification).

---

## Comms Ledger acknowledgements (read on entry 2026-05-29)

- **COMMS-0002 (WARN, ALL)** — ORCH-0863 strict-grep C7 blocks backend PRs unless allowlisted. **Acknowledged + satisfied**: added `ORCH_0990_BACKEND_ALLOWLIST` (migration + `signalRankFetch.ts` + the new Deno test + `stopAlternatives.ts` + `generate-curated-experiences/index.ts`) to `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` and spread `...ORCH_0990_BACKEND_ALLOWLIST,` into the `ALLOWLIST` union, **in the same commit** as the backend files.
- **COMMS-0003 (WARN, ALL)** — external-API params cite provider docs inline at SPEC. **Acknowledged + satisfied**: no new external API call is introduced; we read already-persisted Google Places fields (`place_pool.primary_type`, `place_pool.types`). The Google Places v1 primaryType-vs-types semantics were cited inline in the SPEC (§4.1) and are mirrored in the code comment on `COMBO_SLUG_PRIMARY_TYPE_GATE`.
- **COMMS-0004 (WARN, ALL)** — INTAKE ID-collision scan. N/A (IMPLEMENT phase).

---

## What changed (layman)

The curated "Flowers" stop used to have no check that a place actually sells flowers — a popularity score alone could put a general contractor, an event planner, or a supermarket-with-no-floral-counter into the slot. This change adds a hard server-side gate: a flower stop now only resolves to a real florist OR a grocery/supermarket that Google has verified runs a floral department. Cities with none get an honest empty stop instead of a fake one. Every other curated stop (hiking, museum, food, etc.) is byte-for-byte unaffected.

---

## Old → New Receipts

### supabase/migrations/20260801000001_orch_0990_fetch_local_signal_ranked_primary_type_gate.sql (NEW)
**What it did before:** the RPC `fetch_local_signal_ranked` (baseline `20260505000000_baseline_squash_orch_0729.sql:4708-4730`) gated only on `(p_required_types IS NULL OR pp.types && p_required_types)` — a secondary-tag overlap. It could not express a primary-type-aware predicate.
**What it does now:** DROPs the exact old 9-arg overload, then `CREATE OR REPLACE`s an 11-arg version adding two trailing optional params `p_primary_type_required text[] DEFAULT NULL` + `p_grocery_floral_tag boolean DEFAULT false`, with a composite WHERE clause: `(p_primary_type_required IS NULL AND p_grocery_floral_tag = false)` (no-op TRUE) `OR (p_primary_type_required IS NOT NULL AND pp.primary_type = ANY(p_primary_type_required))` `OR (p_grocery_floral_tag = true AND pp.primary_type = ANY(ARRAY['grocery_store','supermarket']) AND pp.types && ARRAY['florist'])`. Re-issues OWNER / 3×GRANT / COMMENT keyed to the new full signature. STABLE SECURITY DEFINER read-only.
**Why:** SPEC §8.1 / REVIEW Pass-2 Defect 1 — the composite primary-type gate cannot be expressed by the single types-overlap clause; `primary_type` is the clean discriminator (Google over-applies the secondary `florist` tag in `types[]`).
**No-regression:** both new params default to no-op; every current caller invokes by named args and never names them → identical row set for hiking/museum/all non-flowers signals.
**Lines:** ~110 (new file).
**Filename deviation (monotonicity rule #10):** SPEC §8.1 named this `20260801000000`, but sibling worktree ORCH-0989 already holds `20260801000000_orch_0989_brand_cover_video_target.sql`. Bumped to `20260801000001` to stay strictly greater across all branches/remote/sibling worktrees. Behavior unchanged; the allowlist entry and the strict-grep migration-glob both match the actual filename.

### supabase/functions/_shared/signalRankFetch.ts (MODIFIED)
**What it did before:** `COMBO_SLUG_TYPE_FILTER` had only hiking/museum; `COMBO_SLUG_FILTER_MIN.flowers = 80`; no primary-type gate concept; `SignalRankParams` had `requiredTypes` only; the RPC call passed `p_required_types` + `p_limit`.
**What it does now:** adds `PrimaryTypeGate` interface + `COMBO_SLUG_PRIMARY_TYPE_GATE = { flowers: { primaryTypes:['florist'], groceryFloralTag:true } }` + `resolvePrimaryTypeGate()`; sets `COMBO_SLUG_FILTER_MIN.flowers = 0`; extends `SignalRankParams` with `primaryTypeRequired?: string[]` + `groceryFloralTag?: boolean`; threads `p_primary_type_required: primaryTypeRequired ?? null` + `p_grocery_floral_tag: groceryFloralTag ?? false` into the `.rpc()` call. `flowers` is deliberately NOT added to `COMBO_SLUG_TYPE_FILTER` (the rejected mechanism); the stale 80-floor comment is rewritten.
**Why:** SPEC §8.2.
**Lines:** ~35 added/changed.

### supabase/functions/generate-curated-experiences/index.ts (MODIFIED)
**What it did before:** `fetchForCombo` resolved `typeFilter = COMBO_SLUG_TYPE_FILTER[catId]` and passed `requiredTypes: typeFilter`.
**What it does now:** also imports + calls `resolvePrimaryTypeGate(catId)` and passes `primaryTypeRequired: primaryTypeGate?.primaryTypes` + `groceryFloralTag: primaryTypeGate?.groceryFloralTag`. Mechanical param threading; no branching.
**Why:** SPEC §8.3 — the curated-card generation flow inherits the gate.
**Lines:** ~5.

### supabase/functions/_shared/stopAlternatives.ts (MODIFIED)
**What it did before:** resolved `requiredTypes = resolveTypeFilter(categoryId)` and passed it into `fetchSinglesForSignalRank`.
**What it does now:** also calls `resolvePrimaryTypeGate(categoryId)` and threads `primaryTypeRequired` + `groceryFloralTag` into the same call so the stop-swap flow inherits the gate (Constitution #13 generation/serving parity).
**Why:** SPEC §8.3.
**Lines:** ~9.

### supabase/functions/_shared/signalRankFetch.flowers.test.ts (NEW)
**What it does:** T-02 (resolver/floor mechanism), T-06 (rejected types[]-only mechanism not re-introduced), T-07 (floor === 0), T-01 fails-on-revert (migration RPC body carries the composite `primary_type` predicate + grocery carve-out) + an adversarial assertion proving a types[]-only revert body lacks the marker. 8 tests.
**Why:** SPEC §9 / §13 T-01/T-02/T-06/T-07; implementor regression-test gate.
**Lines:** ~150 (new file).

### .github/scripts/strict-grep/orch-0990-flower-stop-florist-gate.mjs (NEW)
**What it does:** asserts on `signalRankFetch.ts` — (1) `COMBO_SLUG_PRIMARY_TYPE_GATE.flowers` gates on `florist` + `groceryFloralTag:true`; (2) `flowers` NOT in `COMBO_SLUG_TYPE_FILTER`; (3) `COMBO_SLUG_FILTER_MIN.flowers === 0`; and on the migration — (4) the RPC body contains `p_primary_type_required` + `p_grocery_floral_tag` + the `pp.primary_type` predicate + the `'grocery_store'/'supermarket'` + `ARRAY['florist']` carve-out. Exit 1 on any violation.
**Why:** SPEC §9.
**Lines:** ~165 (new file).

### .github/workflows/strict-grep-mingla-business.yml (MODIFIED)
**What it does now:** registers a new `orch-0990-flower-stop-florist-gate` job (node 20, runs the gate script). Modeled on `orch-0965-home-uses-upcoming-hook`. No untrusted input in any `run:` step.
**Why:** SPEC §9.
**Lines:** ~12.

### .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs (MODIFIED)
**What it does now:** adds `ORCH_0990_BACKEND_ALLOWLIST` (5 backend files, actual `20260801000001` migration filename) and spreads `...ORCH_0990_BACKEND_ALLOWLIST,` into the `ALLOWLIST` union — same commit (COMMS-0002).
**Why:** SPEC §10 / COMMS-0002.
**Lines:** ~14.

### Mingla_Artifacts/INVARIANT_REGISTRY.md (MODIFIED)
**What it does now:** adds `I-PROPOSED-FLOWER-STOP-FLORIST-VERIFIED` (DRAFT → ACTIVE on CLOSE) with the rule, forbidden-reverts, applies-to, and enforcement.
**Why:** SPEC §10.
**Lines:** ~13.

---

## Spec Traceability (success criteria)

| SC | Criterion | How verified | Verdict |
|---|---|---|---|
| SC-1 | flowers called with `primaryTypeRequired:['florist']`, `groceryFloralTag:true`, `requiredTypes:undefined` | T-02 asserts `resolvePrimaryTypeGate('flowers')` deep-equals `{primaryTypes:['florist'],groceryFloralTag:true}` + `resolveTypeFilter('flowers')===undefined` | PASS |
| SC-2 | every returned place satisfies the composite gate; no service/general_contractor/null-primary served | RPC composite clause keys on `pp.primary_type`; T-01 fails-on-revert + adversarial; live row-set is tester-phase | PASS (mechanism) / live UNVERIFIED-here |
| SC-3 | `resolveFilterMin('flowers') === 0` | T-02 / T-07 | PASS |
| SC-4 | Lagos → 3 florist-primary only; Raleigh → 1 florist + 13 floral groceries | live RPC probe — tester-phase (no network here) | UNVERIFIED-here (tester T-03) |
| SC-5 | composite-empty city → stop omitted, card still builds | generator skips optional stop on `[]`; live edge — tester-phase | UNVERIFIED-here (tester T-04) |
| SC-6 | swap flow returns only composite-gate-passing alternatives | `stopAlternatives.ts` threads the same params; live — tester-phase | PASS (mechanism) / live UNVERIFIED-here (tester T-05) |
| SC-7 | strict-grep fails on any forbidden revert | gate run + fails-on-revert proof below | PASS |
| SC-8 | non-flowers slug returns identical row set pre/post migration | both new params no-op at defaults; existing slug-parity Deno test still green (9 passed); live diff — tester-phase | PASS (mechanism) / live UNVERIFIED-here (tester T-09) |

Live-data criteria (SC-2 row set, SC-4, SC-5, SC-9/T-09 live diff) require a DB connection. This environment has zero network egress (curl to api.supabase.com + api.github.com both returned 000). Per SPEC §14 step 8 these are explicitly the tester's live RPC probes after `db push`. All mechanism-level guarantees they depend on are verified here.

---

## Regression Test

- **Path:** `supabase/functions/_shared/signalRankFetch.flowers.test.ts`
- **Passing run (restored fix):** `deno test --allow-read` → `ok | 8 passed | 0 failed`.
- **fails-on-revert verified at `ca3c3f291`** (the pre-fix HEAD; the SPEC commit, fix uncommitted at proof time): reverting the migration composite predicate (`pp.primary_type = ANY(p_primary_type_required)` → `TRUE`) AND the floor (`flowers: 0` → `80`) AND widening the gate map to admit `service`/`general_contractor` flipped **4 tests red** (T-01 migration-body, T-02 floor, T-02 gate, T-07) → `FAILED | 4 passed | 4 failed`, `deno test` exit non-zero. Restoring the fix returned `8 passed | 0 failed`.
- The strict-grep gate independently flips to exit 1 on the same reverts.

---

## Verification Matrix (captured output)

- `node orch-0990-flower-stop-florist-gate.mjs` → `OK — flowers composite primary-type gate present; floor 0; no types[]-only revert.` exit 0.
- `deno test --allow-read signalRankFetch.flowers.test.ts` → `8 passed | 0 failed`.
- `deno check` on `signalRankFetch.ts`, `stopAlternatives.ts`, `generate-curated-experiences/index.ts`, `signalRankFetch.flowers.test.ts` → all rc=0 (clean).
- Existing `replaceCuratedStopSlugParity.test.ts` → `9 passed | 0 failed` (no-regression on the shared helper).
- `orch-0863-marketing-hub-phase-b.mjs` module loads + runs clean against the working tree.

---

## Invariant Preservation

- **I-PROPOSED-FLOWER-STOP-FLORIST-VERIFIED** (new, DRAFT) — established by this ORCH; gate + Deno test enforce it. Y.
- **I-CURATED-LABEL-SOURCE** — untouched; `categoryId`/`comboCategory` remains the label authority. Y.
- RPC no-regression (hiking/museum) — both new params no-op at defaults; existing slug-parity test green. Y.

## Parity Check

Both serve paths covered: `generate-curated-experiences` (generation) + `replace-curated-stop` via `stopAlternatives.ts` (swap) thread the identical gate. Constitution #13 satisfied.

## Cross-Surface Impact

Consumer iOS + Consumer Android: COVERED (automatic — single shared backend). Buyer-anon web, Business iOS/Android, Admin web, Business web preview: NOT COVERED (no curated-card flower stop on those surfaces). No client code touched → no manual parity surface.

## Cache Safety

No query keys, no client cache, no AsyncStorage shape changed (backend-only).

## Regression Surface (for tester)

1. Hiking/museum curated stops (must return identical rows — T-09 live).
2. Other curated stops via `fetch_local_signal_ranked` (food, nature, etc.).
3. The stop-swap flow for non-flowers categories.
4. Honest-empty flower stop in a composite-empty city (card still builds, no crash).

## Constitutional Compliance

- #3 (no silent fallback): RPC throws on error preserved; gate is explicit. PASS.
- #6 (single source of truth): the gate lives once in `signalRankFetch.ts`, both flows resolve through it. PASS.
- #9 (no fabrication): honest-empty, never a non-florist substitution. PASS.
- #13 (generation/serving parity): both flows inherit the gate. PASS.
- All others N/A (no UI, no auth, no analytics, no money).

## Discoveries for Orchestrator

- **D-1 (FYI):** 8 of 17 seeded cities have zero composite-gate-passing servable places (per SPEC §15 D-1) → flower stop honestly omitted there. SEEDING coverage gap, not this ORCH.
- **D-2 (migration filename deviation):** used `20260801000001` not the SPEC's `20260801000000` to avoid collision with ORCH-0989's sibling-worktree migration. Allowlist + strict-grep glob match the actual filename. Operator/orchestrator should note this when reconciling migration order.
- **D-3 (rule #9a not runnable here):** `supabase migration list --linked` requires network, which this environment lacks. Operator must confirm no remote-only migration version exists before `db push` (standard pre-push check).

## Migrations awaiting `supabase db push`

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0990-[flower-stop-real-florists]" && /Users/sethogieva/bin/supabase db push --linked
```
(Read-only `CREATE OR REPLACE FUNCTION` — STABLE SECURITY DEFINER, no data mutation, no lock risk. Confirm `supabase migration list --linked` shows no remote-only version first.)

## Edge functions to redeploy (orchestrator, after db push)

Both bundle the changed `_shared/signalRankFetch.ts`:
```bash
supabase functions deploy generate-curated-experiences --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy replace-curated-stop --project-ref gqnoajqerqhnvulmnyvv
```

## Transition Items

None.
