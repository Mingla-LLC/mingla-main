# QA — ORCH-0990 [Curated flower stop resolves to real florists]

**Tester:** mingla-tester (Claude)
**Date:** 2026-05-29
**Commit under test:** `031b9a176` on branch `ORCH-0990-flower-stop-real-florists`
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0990-[flower-stop-real-florists]/`
**Mode:** TARGETED + SPEC-COMPLIANCE (backend-only)
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-0990_FLOWER_STOP_REAL_FLORISTS.md` (`ca3c3f291`)

---

## VERDICT: PASS

| Severity | Count |
|---|---|
| P0 | 0 |
| P1 | 0 |
| P2 | 0 |
| P3 | 0 |
| P4 | 2 (notes) |

**Sim evidence:** EXEMPT — backend-only (Supabase RPC migration + edge `_shared`/`index.ts` param threading + CI gate). Zero client/UI/runtime surface touched (SPEC §11 confirms no `app-mobile`/`mingla-business`/`mingla-admin` change). Live-fire sim gate does not apply; verification is via live-data Management API RPC-logic probes + Deno tests + strict-grep gates.

**Regression tests:**
- implementor = `supabase/functions/_shared/signalRankFetch.flowers.test.ts` — 8/8 pass; fails-on-revert independently re-verified @ `031b9a176` (see §4).
- tester (adversarial) = `supabase/functions/_shared/signalRankFetch.flowers.adversarial.test.ts` — 6/6 pass; attacks a DIFFERENT angle (predicate-evaluation, not SQL-text grep); fails-on-revert anchor verified (see §6).

---

## 1. Comms Ledger (read on entry)

No BLOCK entry targets `mingla-tester` or ORCH-0990. Factored:
- **COMMS-0002 (WARN, ALL)** — orch-0863 C7 backend allowlist. The commit adds `ORCH_0990_BACKEND_ALLOWLIST` (migration + `signalRankFetch.ts` + the Deno test + `stopAlternatives.ts` + `generate-curated-experiences/index.ts`) and spreads it into the `ALLOWLIST` union in the SAME commit. Verified: orch-0863 gate C7 passes (§3). NOTE: my new adversarial test file is NOT in that allowlist, but C7 evaluates the PR diff at PR time — flagged as P4-1.
- **COMMS-0003 (WARN, ALL)** — external-API docs. N/A: no new external API call; reads already-persisted Google Places fields. Google Places `types[]`/`primaryType` semantics cited inline in SPEC §4.1 and in `signalRankFetch.ts` comments.
- **COMMS-0004 (WARN, ALL)** — INTAKE ID-collision. N/A: this is TEST, not INTAKE.

---

## 2. Source review — every changed file (commit 031b9a176)

12 files. Reviewed:

| File | Finding |
|---|---|
| `supabase/migrations/20260801000001_orch_0990_…sql` | ✅ DROP-old-9-arg overload (exact signature, `IF EXISTS`) → `CREATE OR REPLACE` 11-arg → re-issue OWNER + 3× GRANT + COMMENT, all keyed to the NEW 11-arg signature. Composite WHERE clause is a TRUE no-op at defaults (see §2.1). `STABLE SECURITY DEFINER`, read-only SELECT. Filename `…000001` (not SPEC's `…000000`) to dodge sibling ORCH-0989 collision — documented inline; allowlist + test + gate all reference `…000001` consistently. |
| `_shared/signalRankFetch.ts` | ✅ `COMBO_SLUG_PRIMARY_TYPE_GATE = { flowers: { primaryTypes:['florist'], groceryFloralTag:true } }`; `resolvePrimaryTypeGate`; `SignalRankParams` extended; both params threaded into `.rpc()` with `?? null` / `?? false` defaults; `COMBO_SLUG_FILTER_MIN.flowers = 0`; `flowers` NOT in `COMBO_SLUG_TYPE_FILTER`. |
| `generate-curated-experiences/index.ts` | ✅ imports `resolvePrimaryTypeGate`, resolves per `catId`, passes both params. Pure threading, no branching. |
| `_shared/stopAlternatives.ts` | ✅ identical threading for the swap flow (SC-6 / Constitution #13 gen-vs-serve parity). |
| `signalRankFetch.flowers.test.ts` | ✅ 8 tests (T-01/02/06/07). |
| `orch-0990-flower-stop-florist-gate.mjs` | ✅ 4 rules on `signalRankFetch.ts` + migration. |
| `orch-0863-…mjs` (allowlist) | ✅ ORCH_0990 list + spread into union. |
| `INVARIANT_REGISTRY.md` | ✅ I-PROPOSED-FLOWER-STOP-FLORIST-VERIFIED (DRAFT). |
| REVIEW reports | informational. |

### 2.1 No-op-at-defaults proof (migration WHERE clause)

The new clause:
```
(p_primary_type_required IS NULL AND p_grocery_floral_tag = false)
OR (p_primary_type_required IS NOT NULL AND pp.primary_type = ANY(p_primary_type_required))
OR (p_grocery_floral_tag = true AND pp.primary_type = ANY(ARRAY['grocery_store','supermarket']) AND pp.types && ARRAY['florist'])
```
At defaults (`p_primary_type_required = NULL`, `p_grocery_floral_tag = false`): branch 1 = `(NULL IS NULL AND false = false)` = `(TRUE AND TRUE)` = **TRUE** → the OR short-circuits TRUE → unconditional pass. Every existing caller (which passes neither new param by named-arg) is byte-identical. **Independently proven against live data in §5 (T-09).**

### 2.2 DROP/GRANT ordering — correct

Old 9-arg overload dropped FIRST (`DROP FUNCTION IF EXISTS …(text,numeric,text,numeric,numeric,numeric,numeric,text[],integer)`), then `CREATE OR REPLACE` the 11-arg, then OWNER/GRANT/COMMENT keyed to the new full signature. This avoids the ambiguous-overload hazard a bare `CREATE OR REPLACE` with a changed arg list would leave. Forward-only + idempotent (`IF EXISTS`).

### 2.3 COMBO_SLUG_TYPE_FILTER / floor — correct

`flowers` is NOT in `COMBO_SLUG_TYPE_FILTER` (rejected `types[]`-only mechanism). It IS in `COMBO_SLUG_PRIMARY_TYPE_GATE` with floor 0 in `COMBO_SLUG_FILTER_MIN`. Matches SPEC §8.2 / §4.1.

---

## 3. Independent gate + test runs (captured)

```
$ deno test --allow-read supabase/functions/_shared/signalRankFetch.flowers.test.ts
ok | 8 passed | 0 failed

$ node .github/scripts/strict-grep/orch-0990-flower-stop-florist-gate.mjs
[ORCH-0990] OK — flowers composite primary-type gate present; floor 0; no types[]-only revert.  EXIT=0

$ node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
OK [C7: no-new-backend-files] zero touches … (13 files changed total)  → All checks PASS

$ deno check signalRankFetch.flowers.adversarial.test.ts   → clean
$ deno test (both flowers tests together)                  → ok | 14 passed | 0 failed
```

---

## 4. Implementor fails-on-revert — independently re-verified

Reverted the migration's `primary_type` predicate to a `types[]`-overlap in a scratch copy:
`OR (p_primary_type_required IS NOT NULL AND pp.types && p_primary_type_required)`

Result:
```
T-01 (fails-on-revert) — migration RPC body contains the composite primary_type gate  => FAILED
FAILED | 7 passed | 1 failed
orch-0990 strict-grep gate: [ORCH-0990] FAIL — 1 violation(s)  EXIT=1
```
Restored → 8/8 green, gate EXIT=0, `git diff` clean. The implementor's fails-on-revert claim holds.

---

## 5. Live-data RPC-logic verification (READ-ONLY, no migration apply)

Migration is NOT applied to remote (live `pg_proc` shows only the 9-arg overload — correct; HARD GUARD honored). I applied the migrated composite predicate INLINE as read-only SELECTs against live `place_pool`+`place_scores` (project `gqnoajqerqhnvulmnyvv`), replicating the RPC's filter-signal join, bbox, G1 (`is_servable`), and G3 (real `stored_photo_urls`) gates. 6 cities (≥5 required).

### 5a — NEW composite gate: every returned place is a verified bouquet source (SC-2/SC-4)

| City (bbox) | florist-primary | grocery/supermkt + floral tag | total returned | service/contractor/null noise | verdict |
|---|---|---|---|---|---|
| **Lagos** ⚑ (6.3–6.7, 3.2–3.6) | 3 (Regal 143.85, Fresh Flowers 32.72, Sparkle Gardens 0.00) | 0 | **3** | **0** | ✅ |
| **Raleigh** ⚑ (35.7–35.9, −78.75…−78.55) | 0 | 8 (Harris Teeter) | **8** | **0** | ✅ |
| **Washington** (38.8–39.0, −77.12…−76.91) | — | — | **24** | **0** | ✅ |
| **Brussels** (50.78–50.92, 4.25–4.45) | 1 (Pollen Atelier 0.00) | 5 (Intermarché supermkt + floral) | **6** | **0** | ✅ |
| **London** (51.3–51.7, −0.5…0.3) | 1 (Urban Flower Co 0.00) | 0 | **1** | **0** | ✅ |
| **Paris** (48.75–48.95, 2.2–2.5) | 0 | 0 | **0 — honest-empty** | 0 | ✅ |

⚑ operator-flagged. (London's florist sits at lat 51.5812, just above the SPEC's narrower 51.45–51.56 window; the wider correct metro bbox surfaces it. Counts differ slightly from the SPEC's 2026-05-29 snapshot due to data drift, but the INVARIANT — zero noise — holds in all cities.)

### 5b — Pre-fix gap is REAL (OLD logic returns non-florists) — T-08

**Lagos OLD** (current live RPC, no type-gate, floor 80) returned:
- Regal Flowers (florist, 143.85) ✅ + **BusyBee Events (service, 104.29)** ❌ + **Rukkies Decor (general_contractor, 99.52)** ❌ + **LEE signTEC (service, 98.01)** ❌

**Raleigh OLD** (no gate, floor 80) returned:
- **Mio Kreations (service, 154.52)** ❌ at the TOP + Harris Teeter ×8 (grocery, ✅) + **Petal & Oak (service, 102.31)** ❌

The 4 Lagos and 2 Raleigh `service`/`general_contractor` rows are exactly the SPEC-named noise (RC-1/RC-2). The NEW composite gate excludes every one. **Bug reproduced live; fix proven to close it.**

### 5c — Global invariant (strongest proof)

Across the ENTIRE production `place_pool`, places passing the composite gate break down as: `grocery_store` 67, `florist` 8, `supermarket` 5. A query for any gate-passer whose `primary_type` is NULL or NOT IN (florist/grocery_store/supermarket) returned **`[]` (zero)**. The gate cannot admit a service/general_contractor/event-planner/null-primary anywhere.

### 5d — Honest-empty (SC-5 / T-04)

Paris has **0** flowers-scored servable places in-bbox (`total_flowers_scored = 0`) → the RPC INNER JOINs return `[]` → `fetchForCombo` returns `[]` → generator `if (available.length === 0 && stopDef.optional) continue;` skips the stop. Card still builds; no crash; no non-florist substitution. Confirmed for the 8 SPEC-listed empty cities by extension.

---

## 6. No-regression (T-09) — PROVEN against live data

I ran the hiking and museum gates two ways against live data: (OLD) the current `types[]`-overlap-only RPC logic, and (NEW) the same logic PLUS the new composite clause with the two new params at their defaults (NULL/false). Identical `p_required_types` on both sides; the ONLY difference is the presence of the new default-param clause.

| Slug | old rows | new rows | only-in-old | only-in-new |
|---|---|---|---|---|
| hiking (Raleigh metro, `nature` + `['hiking_area',…]`) | 33 | 33 | 0 | 0 |
| museum (Washington, `creative_arts` + `['museum','art_museum']`) | 60 | 60 | 0 | 0 |

**Identical row sets, zero divergence.** The new composite clause at defaults is a perfect no-op. SC-8 met: no non-flowers caller is altered.

---

## 7. Tester adversarial test (Step 0.5(b))

**Path:** `supabase/functions/_shared/signalRankFetch.flowers.adversarial.test.ts` — 6 tests, all pass.

**Different angle vs. implementor:** the implementor's test only GREPS the migration SQL string and the exported TS maps for structural markers — it never EVALUATES the gate predicate against place rows. My test transcribes the migrated composite WHERE predicate (all 3 OR-branches, with SQL `= ANY()` NULL-semantics faithfully mirrored) into a TS function parameterised by the live resolver output, then runs adversarial rows through it:

- **(ii) carve-out is narrow** — grocery/supermarket WITHOUT the florist tag → EXCLUDED (matches live 0-leak).
- **(iv) NULL primary_type** + florist tag → EXCLUDED (live universe 9, 0 leak).
- **noise** — service/general_contractor (BusyBee, Rukkies, Mio Kreations) + florist tag → EXCLUDED (the exact reported bug).
- **(iii) floor-0** keeps score-0 florists (Sparkle Gardens, Pollen Atelier), preserves score-DESC order, and demonstrates floor-40 would drop the real florists.
- **fails-on-revert anchor** — proves the composite gate EXCLUDES the four noise rows that the rejected `types[]`-only mechanism would ADMIT.

**Fails-on-revert verified:** removing the `flowers` entry from `COMBO_SLUG_PRIMARY_TYPE_GATE` (a representative revert) flipped all 6 adversarial tests RED (`0 passed | 6 failed`); restoring → 6/6 green. Captured.

---

## 8. Constitution (relevant rules)

| Rule | Verdict |
|---|---|
| #3 No silent failures | PASS — RPC error throws; empty result is legitimate honest-omit. |
| #9 No fabricated data | PASS — honest-omit, never a non-florist substitution. |
| #13 Exclusion consistency (gen == serve) | PASS — both `generate-curated-experiences` and `replace-curated-stop`/`stopAlternatives` thread the same gate via the shared resolver. |
| #6 One owner per truth | PASS — `COMBO_SLUG_PRIMARY_TYPE_GATE` + `resolvePrimaryTypeGate` are the single source. |

---

## 9. Findings

- **P4-1 (NOTE, not blocking):** the new adversarial test `signalRankFetch.flowers.adversarial.test.ts` is under `supabase/functions/_shared/` and is therefore subject to the orch-0863 C7 `no-new-backend-files` gate at PR time. It is NOT in `ORCH_0990_BACKEND_ALLOWLIST`. The implementor's allowlist must gain this one path before the close PR runs C7, or C7 will fail on the tester commit. Recommended: orchestrator/implementor append `'supabase/functions/_shared/signalRankFetch.flowers.adversarial.test.ts'` to `ORCH_0990_BACKEND_ALLOWLIST` (one line, same C7 rationale as the sibling test). Flagged per COMMS-0002. Not a code defect; a CI-bookkeeping follow-up owned by the closing PR.
- **P4-2 (NOTE):** D-1 stands — 8 seeded cities have zero composite-gate-passing places (Paris/Chicago/Dallas/Miami/NY/Toronto/Berlin/Barcelona). This is a SEEDING coverage gap, not this ORCH; honest-omit is correct behavior. Register a seeding ORCH if flower stops are wanted there.

## 10. Discoveries for orchestrator

- The new `p_primary_type_required` RPC param is now a reusable primitive for any future signal that needs a primary-type gate (SPEC D-3). Reuse it rather than re-introducing `types[]`-only gates.
- Live data has drifted slightly from the SPEC's 2026-05-29 per-city snapshot (Raleigh 8 vs 14 grocery; counts move as scoring/seeding refresh). The INVARIANT (zero noise, honest-omit) is data-independent and holds — the ORCH does not depend on exact counts.

---

## Completion condition (machine-verified)

1. Every independent test green — 8/8 implementor + 6/6 adversarial = 14/14 captured (§3, §7). ✅
2. `deno check` clean on touched test file (Deno backend; no package tsc/lint applies) — captured. ✅
3. Both regression tests in the close PR diff: implementor test already in `git diff origin/main...HEAD`; adversarial test committed on this branch by this QA pass (P4-1 allowlist follow-up noted). ✅
4. UI/runtime legs — EXEMPT (backend-only). ✅
5. Zero open P0/P1. ✅

All clauses hold → **PASS**.
