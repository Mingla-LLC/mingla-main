# IMPLEMENTATION REPORT — ORCH-0735 v3 PLURALIZATION + MISSING-PATTERN PATCH

**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0735_BOUNCER_CHAIN_FAST_FOOD_RULES.md` (binding, unchanged)
**Predecessors:** v1 (initial impl), v2 (4 false-positive patterns dropped)
**Trigger:** Post-v2-deploy SC-16 probe surfaced 12 admitted chain rows across 9 cities
**Status:** implemented, partially verified (deno test execution unverified — Deno not in environment)

---

## 1. v3 Rework Summary

5 surgical edits to `bouncerChainRules.ts` + 7 new test fixtures + 1 v2-cleanup test flip in `bouncer.test.ts`.

| # | Type | Target | Change |
|---|------|--------|--------|
| 1 | ADD | FAST_FOOD (B11) — B.3 sweet treats | `FF_PATTERN("dairy queen", 'dairy_queen')` |
| 2 | ADD | CASUAL_CHAIN (B12) — J.1-21 block | `FF_PATTERN("bob evans", 'bob_evans')` |
| 3 | WIDEN | FAST_FOOD (B11) — B.3 sweet treats | `"cold stone creamery"` → `"cold stone"` |
| 4 | WIDEN | FAST_FOOD (B11) — B.1 US fast food | `"papa john"` → `"papa johns"` + `"papa john's"` |
| 5 | WIDEN | FAST_FOOD (B11) — B.1 US fast food | `"firehouse sub"` → `"firehouse subs"` |

Plus test cleanup:

| # | Type | Target | Change |
|---|------|--------|--------|
| 6 | FLIP | bouncer.test.ts T-B11-18 | reject → admit (v2 dropped `quick` pattern; assertion was stale, blocking deno test) |

Plus 7 new test fixtures:

| Fixture | Type | Purpose |
|---------|------|---------|
| T-DAIRY-QUEEN-REJECT | reject | Verify Change 1 fires |
| T-PAPA-JOHNS-PLURAL-REJECT | reject | Verify Change 4 (plural form) fires |
| T-PERKINS-ORCHARD-ADMIT | admit | SC-16 probe false positive — orchard not Perkins diner |
| T-SALADELIA-DUKE-ADMIT | admit | SC-16 probe false positive — café in Duke's Perkins Library |
| T-WELLWITHWENDY-ADMIT | admit | SC-16 probe false positive — wellness clinic, not Wendy's |
| T-ROMANOS-PIZZERIA-INDIE-ADMIT | admit | SC-16 probe false positive — indie not Romano's chain |
| T-SONIC-ROOM-LAGOS-ADMIT | admit | SC-16 probe false positive — nightclub, not Sonic Drive-In |

---

## 2. Old → New Receipts

### `supabase/functions/_shared/bouncerChainRules.ts`

**What it did before (v2):**
- `FAST_FOOD_NAME_PATTERNS` had `cold stone creamery` (multi-word too narrow), `papa john` (matched apostrophe-form only), `firehouse sub` (singular only).
- Did NOT have `dairy queen` or `bob evans`.

**What it does now (v3):**
- `dairy queen` matches "Dairy Queen" + variants (case-insensitive, word-bounded)
- `cold stone` matches both "Cold Stone Creamery" AND international variants like "Cold Stone Bode Thomas, Surulere"
- `papa johns` matches the bare-plural form ("Papa Johns Pizza") AND `papa john's` matches the apostrophe form ("Papa John's")
- `firehouse subs` matches "Firehouse Subs" (the plural form Google data uses)
- `bob evans` matches "Bob Evans" — added to CASUAL_CHAIN_NAME_PATTERNS (B12), not FAST_FOOD_NAME_PATTERNS, because Bob Evans is a casual full-service chain, not fast food.

**Why:** Live SC-16 probe across 9 cities post-v2 deploy found 12 chain rows admitted incorrectly. Root causes split: 2 missing patterns + 2 pluralization gaps + 1 too-narrow multi-word pattern + 4 partial-write rows on Washington (function memory bug, separate ORCH).

**Lines changed:** +18 / -3 (5 edits, all additions or widenings; no deletions of working patterns)

### `supabase/functions/_shared/__tests__/bouncer.test.ts`

**What it did before (v2):**
- 51 fixtures total.
- T-B11-18 ("Quick Belgian fast food blocked") asserted `is_servable=false` and `reasons=['B11:chain_brand:quick_belgium']` — but v2 dropped the `quick` pattern (and the `quick_belgium` label never existed in the file). Stale assertion; would fail any deno test execution.
- No fixtures verified `dairy queen`, `papa johns` (plural), `firehouse subs` (plural), `cold stone` (widened), or `bob evans` patterns.
- No admit-regression-guards for SC-16 probe false positives.

**What it does now (v3):**
- T-B11-18 flipped to assert `is_servable=true` (mirrors v2's T-LEON-INDEPENDENT pattern). Comment links the flip to v2's drop of `quick`.
- 2 new reject-confirmation fixtures (T-DAIRY-QUEEN-REJECT, T-PAPA-JOHNS-PLURAL-REJECT) verify v3 patches actually fire.
- 5 new admit-regression-guards (T-PERKINS-ORCHARD-ADMIT, T-SALADELIA-DUKE-ADMIT, T-WELLWITHWENDY-ADMIT, T-ROMANOS-PIZZERIA-INDIE-ADMIT, T-SONIC-ROOM-LAGOS-ADMIT) prevent future regressions if someone adds a too-greedy pattern.
- Total fixtures: 58 (was 51).

**Why:** Verify the 5 lib changes work; prevent SC-16 probe false-positives from being mistaken for real chains in future patches.

**Lines changed:** ~+95 / -3 (1 flip + 7 new fixtures with full comment headers)

---

## 3. Spec Traceability

The v3 prompt's 5 prescribed changes:

| Change | Status | Verification |
|--------|--------|--------------|
| Change 1: ADD `dairy queen` | ✅ Applied (line 117) | T-DAIRY-QUEEN-REJECT (static-trace PASS — see §4) |
| Change 2: ADD `bob evans` to CASUAL_CHAIN | ✅ Applied (line 232) | Static-trace: `\bbob evans\b` matches "Bob Evans"; reason will be `B12:casual_chain:bob_evans`. No reject-confirmation fixture added (deferred per scope, see §10) |
| Change 3: WIDEN cold stone | ✅ Applied (line 116) | Static-trace: `\bcold stone\b` matches "Cold Stone Bode Thomas, Surulere" (whitespace boundary after `stone`). No reject-confirmation fixture added (deferred per scope, see §10) |
| Change 4: WIDEN papa john | ✅ Applied (lines 64-65) | T-PAPA-JOHNS-PLURAL-REJECT (static-trace PASS) |
| Change 5: WIDEN firehouse sub | ✅ Applied (line 94) | Static-trace: `\bfirehouse subs\b` matches "Firehouse Subs Bent Tree" (whitespace boundary). No reject-confirmation fixture added (deferred per scope, see §10) |

The v3 prompt's 7 prescribed test fixtures: ✅ all 7 applied. Plus 1 v2-cleanup flip (T-B11-18).

---

## 4. Verification Matrix

For each of the 8 test changes, verification status:

| Test | Verification method | Result |
|------|---------------------|--------|
| T-B11-18 (flipped) | Static-trace: `quick` pattern absent → bounce("Quick", `restaurant`) returns cluster A_COMMERCIAL, no B-rule fires (basePlace defaults satisfy B4/B5/B6/B7/B8) → admits | PASS (static-trace) |
| T-DAIRY-QUEEN-REJECT | Static-trace: `\bdairy queen\b` matches "Dairy Queen" → matchFastFoodPattern returns 'dairy_queen' → B11 fires before B10 (ice_cream_shop not in EXCLUDED_FAST_FOOD_TYPES) | PASS (static-trace) |
| T-PAPA-JOHNS-PLURAL-REJECT | Static-trace: `\bpapa johns\b` matches "Papa Johns Pizza" via space boundary after `s` → label `papa_johns` | PASS (static-trace) |
| T-PERKINS-ORCHARD-ADMIT | Static-trace: types=['tourist_attraction','farm','park'] → cluster=C_NATURAL (NATURAL_TYPES wins; B4/B5/B6 skipped). No `perkins` pattern in any list. basePlace photos satisfy B7/B8 | PASS (static-trace) |
| T-SALADELIA-DUKE-ADMIT | Static-trace: cluster=A_COMMERCIAL (coffee_shop). own-domain saladelia.com → B5 no fire. basePlace hours+photos. No saladelia/duke/perkins/library pattern | PASS (static-trace) |
| T-WELLWITHWENDY-ADMIT | Static-trace: `wellness_center` NOT in EXCLUDED_TYPES (verified §3 of bouncer.ts: list is gym/fitness/school/medical/etc). Cluster=A_COMMERCIAL. `\bwendy's\b` requires apostrophe-s — absent in name → no match | PASS (static-trace) |
| T-ROMANOS-PIZZERIA-INDIE-ADMIT | Static-trace: cluster=A_COMMERCIAL. No `romanos` pattern (only `maggiano's little italy`). own-domain → B5 OK | PASS (static-trace) |
| T-SONIC-ROOM-LAGOS-ADMIT | Static-trace: cluster=A_COMMERCIAL. `\bsonic drive\b` requires "drive" word — absent ("Sonic Room") → no match. No bare `sonic` pattern | PASS (static-trace) |

**Deno test execution (`cd supabase && deno test --allow-all functions/_shared/__tests__/bouncer.test.ts`):** UNVERIFIED — Deno not installed in implementor environment (`deno: command not found` confirmed). Operator must install Deno (`winget install DenoLand.Deno`) and run before redeploy.

**TypeScript compile:** UNVERIFIED — `tsc` not in implementor environment. Static-read of edits confirms syntax matches sibling FF_PATTERN entries; no new types or function signatures introduced.

---

## 5. Invariant Preservation Check

| Invariant | Preserved? | Notes |
|-----------|------------|-------|
| I-BOUNCER-DETERMINISTIC | YES | Pure type/regex matching. No AI added. All v3 edits are static patterns. |
| I-TWO-PASS-BOUNCER-RULE-PARITY | YES | Same FAST_FOOD_NAME_PATTERNS / CASUAL_CHAIN_NAME_PATTERNS arrays consumed by both pre-photo and final passes via shared `bounce()`. |
| I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS (v2 NEW) | STRENGTHENED | v3 closes 3 gaps that allowed chain leakage post-v2: (a) bare-plural pluralization, (b) too-narrow multi-word patterns, (c) missing chain entries for Dairy Queen + Bob Evans. |

No invariant violations introduced. No new invariants to register.

---

## 6. Parity Check

Two-pass bouncer (pre-photo + final): both passes consume the same `FAST_FOOD_NAME_PATTERNS` / `CASUAL_CHAIN_NAME_PATTERNS` arrays via shared `matchFastFoodPattern()` / `matchCasualChainPattern()` helpers in `bouncer.ts`. v3 edits to the arrays propagate identically to both passes. No parity check needed for solo/collab — bouncer rules are pool-wide, not per-mode.

---

## 7. Cache Safety

No query keys changed. No mutations changed. No data shape changes. The bouncer writes `is_servable` + `bouncer_reason` columns — same shape as v1/v2. Existing admin/mobile consumers of `place_pool` see only fewer admitted rows after re-sweep (which is the intended product effect).

---

## 8. Regression Surface

3 adjacent areas to check post-deploy:

1. **`run-place-intelligence-trial`** — uses pool of `is_servable=true` rows for sampling. After v3 sweep, sample size shrinks slightly (12 fewer rows across 9 cities). Trial runs should remain functional; only the sample composition changes.
2. **Admin Place Pool page** — reads `place_pool` rows with bouncer_reason. New reasons in dropdown filter: `B11:chain_brand:dairy_queen`, `B12:casual_chain:bob_evans`. UI should render these as new filter options without code change (dropdown is built from distinct reasons).
3. **Pre-photo bouncer (`run-pre-photo-bouncer`)** — same shared rule body. Rerun on cities will mark some additional rows as `passes_pre_photo_check=false`. Should be benign — those rows already shouldn't have been seeded.

---

## 9. Constitutional Compliance

Quick scan against the 14 principles:

- ✅ No dead taps — N/A (backend rule change)
- ✅ One owner per truth — bouncerChainRules.ts remains canonical source per DEC-107
- ✅ No silent failures — pattern matches return labeled reasons; admits return null
- ✅ One query key per entity — N/A
- ✅ Server state stays server-side — N/A
- ✅ Logout clears everything — N/A
- ✅ Label temporary fixes — comments tag every v3 edit with `[ORCH-0735 v3: ...]`
- ✅ Subtract before adding — `papa john` REMOVED, then split into 2 explicit patterns. `firehouse sub` REMOVED, then replaced with plural. Not layered.
- ✅ No fabricated data — bouncer is a filter, not a data producer
- ✅ Currency-aware UI — N/A
- ✅ One auth instance — N/A
- ✅ Validate at the right time — bouncer runs at place-pool ingest + on-demand sweep, both correct
- ✅ Exclusion consistency — same FAST_FOOD/CASUAL_CHAIN arrays consumed by pre-photo and final passes
- ✅ Persisted-state startup — N/A

No compliance violations.

---

## 10. Discoveries for Orchestrator

### D-1 (deferred, scoped): Reject-confirmation coverage gap

The v3 prompt prescribed exactly 2 reject-confirmation fixtures (Dairy Queen + Papa Johns plural). For full verification rigor, 3 more would be valuable:

- **T-BOB-EVANS-REJECT** — verify Change 2 fires (`B12:casual_chain:bob_evans`)
- **T-COLD-STONE-LAGOS-REJECT** — verify Change 3 widening fires on `"Cold Stone Bode Thomas, Surulere"` (`B11:chain_brand:cold_stone_creamery`)
- **T-FIREHOUSE-SUBS-PLURAL-REJECT** — verify Change 5 plural fires on `"Firehouse Subs Bent Tree"` (`B11:chain_brand:firehouse_subs`)

Static-trace covers these in §4, but explicit fixtures would catch a regex-builder bug if FF_PATTERN itself were ever modified. **Recommend:** ORCH-0735 follow-up adds these 3 fixtures.

### D-2 (NEW critical, surfaced during pre-flight): T-B11-18 stale since v2 deploy

T-B11-18 ("Quick Belgian fast food blocked") was added in v1 expecting label `quick_belgium`. v2 dropped the `quick` pattern from FAST_FOOD_NAME_PATTERNS but did NOT flip T-B11-18 — leaving an assertion that would fail any deno test run since v2 deploy. v3 flips it (mirrors v2's T-LEON-INDEPENDENT cleanup pattern).

**Process gap surfaced:** v2 implementor missed the chained test cleanup when dropping a pattern. Future "drop pattern" edits should grep for the label or pattern string in `__tests__/` before deploy. Worth codifying as an implementor checklist item.

### D-3 (NEW, deploy operational): Washington WORKER_RESOURCE_LIMIT during sweep

During v2 sweep verification, `run-bouncer` returned HTTP 546 (`WORKER_RESOURCE_LIMIT`) on Washington (5,542 active rows in pool) for 3 consecutive attempts. Investigation showed `bouncer_validated_at` got updated (writes succeeded for some/all rows), but the response-serialize phase OOM'd — orchestrator suspects up-to-N partial writes. London (5,893 rows) succeeded on a single attempt; the boundary is data-shape-dependent, not pure row count.

The `run-bouncer/index.ts` design accumulates ALL `writes` into in-memory array before bulk-applying via `Promise.all` of 500 concurrent UPDATEs per chunk. For pools >5K rows with rich `types` arrays, this approaches the Deno edge function memory limit. **Recommend:** new ORCH (proposed: ORCH-0738) — refactor `run-bouncer` to streaming write-as-you-go (read 500, write 500, accumulate summary only). Out of scope for ORCH-0735 v3.

### D-4 (NEW, light): SC-16 probe regex was overly greedy

The orchestrator's SC-16 probe regex caught 5 false positives (Perkins Orchard, Saladelia café, Wellness clinic, Romanos indie pizzeria, Sonic Room nightclub). For future SC-16 verification work, the probe regex should mirror the actual `FF_PATTERN` substrings + word boundaries — anything broader is unreliable. Worth attaching the canonical SC-16 probe SQL to the spec template for future bouncer-rule ORCHs.

---

## 11. Transition Items

None. v3 is a permanent fix in the same shape as v1/v2 (code-constants in `bouncerChainRules.ts`).

---

## 12. Out-of-scope Items NOT touched

- B10 EXCLUDED_FAST_FOOD_TYPES — unchanged
- UPSCALE_CHAIN_ALLOWLIST — unchanged
- run-bouncer/index.ts — unchanged (memory bug deferred per D-3)
- run-pre-photo-bouncer — unchanged
- rule_sets DB tables (deferred to ORCH-0736)

---

## 13. Deploy Checklist (orchestrator + operator)

1. ✅ Code edits applied to `bouncerChainRules.ts` (5 edits)
2. ✅ Test edits applied to `bouncer.test.ts` (8 edits: 7 new + 1 flip)
3. ⏭ Operator: `winget install DenoLand.Deno` + `cd supabase && deno test --allow-all functions/_shared/__tests__/bouncer.test.ts` — expect 58 PASS
4. ⏭ Operator: `git add` + commit (commit message offered separately by orchestrator post-CLOSE)
5. ⏭ Operator: redeploy `run-bouncer` AND `run-pre-photo-bouncer` (both share the file)
6. ⏭ Orchestrator: re-run Durham dry-run via curl — verify `B11:chain_brand:dairy_queen`, `B12:casual_chain:bob_evans`, `B11:chain_brand:papa_johns`, `B11:chain_brand:firehouse_subs` now appear in by_reason (where pool contains those venues)
7. ⏭ Orchestrator: re-sweep Washington (recovers v2 partial-write) + spot-checks Raleigh + Lagos + Baltimore
8. ⏭ Orchestrator: re-run SC-16 probe — expect `bad_servable=0` per city (after subtracting the 5 confirmed admit-regression false positives)
9. ⏭ Operator: admin smoke test (Cary sample 50 → eyeball for chains)
10. ⏭ Orchestrator: full CLOSE protocol (artifacts + invariant + memory + commit message + EAS reminder)

---

## 14. Files Modified

| File | Lines | Type |
|------|-------|------|
| `supabase/functions/_shared/bouncerChainRules.ts` | +18 / -3 | Lib |
| `supabase/functions/_shared/__tests__/bouncer.test.ts` | ~+95 / -3 | Test |

Total: 2 files. No new files. No file deletions.

---

## 15. Sign-off

**Status:** implemented, partially verified
**Verification:** static-trace PASS for all 8 test changes; deno-test execution UNVERIFIED (env limitation)
**Blocker for CLOSE:** none structurally — operator must run deno test + redeploy + orchestrator must re-run SC-16 probe
