# Implementation Report v2 — ORCH-0735 rework: drop 4 high-collision patterns

**Status:** `implemented, partially verified` (Deno test execution UNVERIFIED — implementor environment lacks Deno; operator must run locally before redeploy)
**Date:** 2026-05-05
**Implementor:** mingla-implementor (rework mode)
**Parent v1 report:** [`IMPLEMENTATION_ORCH-0735_BOUNCER_RULES_REPORT.md`](IMPLEMENTATION_ORCH-0735_BOUNCER_RULES_REPORT.md) (historical record; remains unchanged)
**Rework dispatch:** [`prompts/IMPLEMENTOR_ORCH-0735_REWORK_DROP_4_PATTERNS.md`](../prompts/IMPLEMENTOR_ORCH-0735_REWORK_DROP_4_PATTERNS.md)
**SPEC:** [`specs/SPEC_ORCH-0735_BOUNCER_CHAIN_FAST_FOOD_RULES.md`](../specs/SPEC_ORCH-0735_BOUNCER_CHAIN_FAST_FOOD_RULES.md) (BINDING; §6.B amended)

---

## 1. Layman summary

Durham dry-run sweep on the v1 deploy surfaced false positives on 4 high-collision chain-name patterns. Dropped those 4 patterns (`paul`, `leon`, `wasabi`, `quick`) from `FAST_FOOD_NAME_PATTERNS`, replaced each with an audit-trail comment, added 4 new admit-regression-guard test fixtures, flipped 1 existing fixture (T-LEON-INDEPENDENT) to assert admit. ~5-7 chain rows lost across all cities (UK Leon + Belgian Quick + French Paul + UK Wasabi locations stay in pool); ~95 independent restaurants saved from false rejection.

---

## 2. Rework — what failed and what changed

### What failed at v1

Operator deployed both edge functions (run-bouncer + run-pre-photo-bouncer) post-v1 commit (`f35e5424`). Orchestrator ran Durham (city_id=`a9e110dd-c26c-4141-9fee-165fad1fd455`) dry-run via `run-bouncer` endpoint with `{city_id: durham, dry_run: true}`. Result: 651 rejects of 1300 active rows in 1.56s. Reasons distribution mostly clean, but `B11:chain_brand:leon_uk`×1 fired on **"Pupuseria Maria de Leon Bus"** — an independent Mexican pupuseria, not the UK Leon chain. Pool-wide audit confirmed precision disaster on 4 patterns:

| Pattern | Pool hits (active=true) | Real chain matches | False positives | Verdict |
|---|---|---|---|---|
| `paul` | 74 | ~2 (Brussels Paul bakery) | ~72 (parks named after Paul, "Old St. Paul's Episcopal Church", "Paul and Jack" bakery, "Paul Tucker Personal Training", "Garden Center Paul Coquette", etc.) | 🚨 DROP |
| `leon` | 17 | ~1 | ~16 (Pupuseria Maria de Leon Bus, Spanish/Mexican places with surname Leon) | 🚨 DROP |
| `wasabi` | 6 | ~1-2 | ~4-5 (independent Asian/sushi places) | 🚨 DROP |
| `quick` | 7 | ~2 (Belgian Quick chain) | ~5 (restaurants/services with "Quick" in name) | 🚨 DROP |
| `subway` | 149 | 148 | 1 (a sculpture; B1+B2+B3 catches anyway) | ✅ KEEP |
| `kfc` | 74 | all | 0 | ✅ KEEP |

The implementor v1 report flagged this risk in Discovery #1 ("operator default-accept per D-15; refine in future ORCH if collisions surface"). Collisions surfaced at first dry-run; dry-run-as-safety-net pattern worked exactly as designed — caught false positives BEFORE any DB writes happened.

### What changed in v2 (operator approved option A)

**Drop the 4 patterns. Lose ~5-7 chain rows; save ~95 independents.**

5 file edits across 2 files:

1. `bouncerChainRules.ts` — DELETE 4 entries from `FAST_FOOD_NAME_PATTERNS` (`paul`, `leon`, `wasabi`, `quick`); replace each with audit-trail comment block explaining drop rationale + future re-add guidance.
2. `bouncer.test.ts` — FLIP existing T-LEON-INDEPENDENT fixture from "asserts REJECT" (v1, intentional false-positive documentation) to "asserts ADMIT" (v2, post-drop behavior).
3. `bouncer.test.ts` — ADD 4 new v2 regression-guard fixtures with verbose comments explaining DO NOT REMOVE.

### What did NOT change

- `EXCLUDED_FAST_FOOD_TYPES` (B10) — unchanged
- `CASUAL_CHAIN_NAME_PATTERNS` (B12) — unchanged
- `UPSCALE_CHAIN_ALLOWLIST` — unchanged
- Multi-word `léon de bruxelles` / `leon de bruxelles` patterns — KEPT (those are precise enough; `\bleon de bruxelles\b` won't false-match anything because the 3-word phrase is specific to the Belgian/French chain)
- `bouncer.ts` (B10/B11/B12 logic + helpers) — unchanged
- `run-bouncer/index.ts` — unchanged (per orchestrator-approved §6.B amendment from v1)
- DRAFT memory file `feedback_bouncer_chain_rules_in_code.md` — unchanged (still DRAFT until CLOSE)

---

## 3. Files changed (v2)

### `supabase/functions/_shared/bouncerChainRules.ts` — MOD
**What it did before (v1):** `FAST_FOOD_NAME_PATTERNS` array contained ~120 entries including `quick` (line 116), `leon` (line 149), `wasabi` (line 151), `paul` (line 174).
**What it does now (v2):** 4 entries deleted; each replaced by an audit-trail comment block explaining drop rationale + re-add guidance for future ORCH. Other ~116 entries preserved verbatim. Multi-word `léon de bruxelles` / `leon de bruxelles` kept (precise; not impacted by the standalone `leon` removal).
**Why:** Dry-run surfaced ~95 false positives on these 4 patterns; operator-approved option A 2026-05-05.
**Lines changed:** -4 deletions / +4 audit-trail comment blocks = net 0 LOC, but ~120 → ~116 active patterns.

### `supabase/functions/_shared/__tests__/bouncer.test.ts` — MOD
**What it did before (v1):** T-LEON-INDEPENDENT fixture asserted "Leon Restaurant" REJECTS with `B11:chain_brand:leon_uk` (intentional false-positive documentation).
**What it does now (v2):**
- T-LEON-INDEPENDENT fixture FLIPPED — now asserts "Leon Restaurant" ADMITS (with comment explaining v2 rework rationale)
- 4 NEW fixtures appended at end of file: T-LEON-PUPUSERIA-ADMIT, T-PAUL-INDEPENDENT-ADMIT, T-WASABI-INDEPENDENT-ADMIT, T-QUICK-INDEPENDENT-ADMIT — each asserts a specific independent place name from the dry-run-evidence false-positive set must admit.
**Why:** SC-12 + post-rework regression prevention. Future PR can't accidentally re-add the dropped patterns without breaking these fixtures loudly.
**Lines changed:** ~+85 LOC NEW (4 new fixtures + flipped fixture comment update); -16 LOC (old T-LEON-INDEPENDENT body); net +69 LOC.

---

## 4. Static-trace verification (Deno not installed)

Per implementor SKILL Failure Honesty: Deno is NOT installed in the implementor's environment. SC-12 (deno test execution) remains UNVERIFIED. **Operator must run deno test locally before redeploying.**

Static trace done for all 5 v2 changes:

| Test | Expected | Code path verified |
|---|---|---|
| **T-LEON-PUPUSERIA-ADMIT** | admits | `paul`/`leon`/`wasabi`/`quick` removed; multi-word `\bleon de bruxelles\b` doesn't match "Pupuseria Maria de Leon Bus"; no other pattern matches → null → B12 no match → admits |
| **T-PAUL-INDEPENDENT-ADMIT** | admits | `paul` removed → "Paul and Jack" no FAST_FOOD pattern matches → admits |
| **T-WASABI-INDEPENDENT-ADMIT** | admits | `wasabi` removed → "Wasabi Sushi Lounge" no match → admits |
| **T-QUICK-INDEPENDENT-ADMIT** | admits | `quick` removed → "Quick Bites Cafe" no match → admits |
| **T-LEON-INDEPENDENT (flipped)** | admits | `leon` removed → "Leon Restaurant" no match → admits (matches new assertion) |

All 5 fixtures should pass when Deno runs them. Existing v1 fixtures unaffected (none of them depended on the dropped 4 patterns; the `leon` pattern was only referenced in T-LEON-INDEPENDENT which we flipped).

---

## 5. Spec traceability — Success criteria status (v2 update)

| SC | Criterion | v1 status | v2 status |
|---|---|---|---|
| SC-01 | `bouncerChainRules.ts` exists with 4 exports + correct entry counts | PASS | **PASS** (still 4 exports; FAST_FOOD count drops from ~120 → ~116) |
| SC-02 | `bouncer.ts` exports 3 helpers | PASS | **PASS** (unchanged) |
| SC-03 | `bounce()` rule order B10→B11→B12 | PASS | **PASS** (unchanged) |
| SC-04 | B10 returns short-circuit verdict | PASS | **PASS** (unchanged) |
| SC-05 | B11 returns short-circuit verdict (allowlist short-circuits) | PASS | **PASS** (unchanged; just 4 fewer patterns) |
| SC-06 | B12 returns short-circuit verdict (allowlist short-circuits) | PASS | **PASS** (unchanged) |
| SC-07 | UPSCALE_CHAIN_ALLOWLIST short-circuits both B11 + B12 | PASS | **PASS** (unchanged) |
| **SC-08** | **Cava admitted regression guard (T-CAVA-ADMIT)** | PASS | **PASS** (unchanged) |
| **SC-09** | **Le Pain Quotidien admitted regression guard (T-LPQ-ADMIT)** | PASS | **PASS** (unchanged) |
| SC-10 | Word-boundary regex prevents false-positives | PASS code-level | **STRENGTHENED** — v2 explicitly drops the 4 patterns where word-boundary alone wasn't enough; T-NEG fixtures + 4 NEW v2 fixtures verify |
| SC-11 | Pre-photo pass parity | PASS | **PASS** (unchanged) |
| **SC-12** | **All 45+ fixtures pass via `deno test`** | UNVERIFIED | **UNVERIFIED** — Deno still not installed in implementor environment. Operator must run before redeploy. Now 51 fixtures total (47 v1 + 4 v2 + 1 flipped). |
| SC-13 | re_bounce_all_servable action accepts input schema | PASS (amended) | **PASS** (unchanged; existing `run-bouncer` endpoint with `{city_id, dry_run}`) |
| SC-14 | Re-bounce sweep `dry_run=true` does NOT modify rows | PASS | **PASS** (verified live by Durham dry-run 2026-05-05 — no DB writes) |
| SC-15 | Re-bounce sweep `dry_run=false` updates verdict-changed rows | PASS (existing) | **PASS** (existing function behavior unchanged) |
| SC-16 | Post-sweep SQL probe returns 0 violations | UNVERIFIED | **UNVERIFIED** (depends on operator running live sweep post-rework redeploy) |
| SC-17 | I-BOUNCER-DETERMINISTIC preserved | PASS | **PASS** (unchanged) |
| SC-18 | I-TWO-PASS-BOUNCER-RULE-PARITY preserved | PASS | **PASS** (unchanged) |
| SC-19 | DRAFT memory file exists | PASS | **PASS** (unchanged; still DRAFT) |
| SC-20 | No mobile files modified | PASS | **PASS** (unchanged) |
| SC-21 | No DB schema migration files | PASS | **PASS** (unchanged) |
| SC-22 | Implementation report saved | PASS (v1) | **PASS** (this v2 file) |

**v2 Summary:** 19/22 PASS at code-level + file inspection · 3/22 UNVERIFIED awaiting operator-side `deno test` (SC-12) + post-deploy live sweep + SQL probe (SC-16).

---

## 6. Old → New Receipts (v2 only)

### `supabase/functions/_shared/bouncerChainRules.ts`
**Before:** 4 standalone patterns `paul`/`leon`/`wasabi`/`quick` in FAST_FOOD_NAME_PATTERNS triggering false positives on independent restaurants.
**After:** 4 patterns removed; replaced with audit-trail comment blocks; multi-word `léon de bruxelles` / `leon de bruxelles` kept.
**Why:** SC-10 strengthened; ~95 false positives eliminated.
**Lines changed:** -4 deletions / +4 comment blocks (net 0 LOC).

### `supabase/functions/_shared/__tests__/bouncer.test.ts`
**Before:** T-LEON-INDEPENDENT fixture asserted REJECT for "Leon Restaurant" with documented intentional-false-positive comment.
**After:** T-LEON-INDEPENDENT fixture FLIPPED to assert ADMIT (post-drop behavior). 4 NEW fixtures appended (T-LEON-PUPUSERIA-ADMIT, T-PAUL-INDEPENDENT-ADMIT, T-WASABI-INDEPENDENT-ADMIT, T-QUICK-INDEPENDENT-ADMIT) — each asserts a specific independent place name from the live dry-run false-positive set must admit.
**Why:** SC-10 + regression prevention against future re-adds.
**Lines changed:** ~+85/-16 = net +69 LOC.

---

## 7. Invariant verification (v2)

| Invariant | Preserved? | Evidence |
|---|---|---|
| `I-BOUNCER-DETERMINISTIC` | Y | Dropped patterns; behavior remains pure type+regex matching with stricter (smaller) pattern set. No AI/network. |
| `I-TWO-PASS-BOUNCER-RULE-PARITY` | Y | No change to rule order or photo-dependence. |
| `I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING` | Y | Unchanged. |
| `I-TRIAL-RUN-SCOPED-TO-CITY` | Y | Unchanged. |
| `I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS` (NEW; ratifies at CLOSE) | Y | Still satisfied — bouncer still rejects fast food + chains via primary_type + remaining ~116 chain patterns + casual chain patterns + UPSCALE allowlist. The 4 dropped patterns lose ~5-7 chain rows; invariant still holds for the dominant chain set. |

---

## 8. Cache safety + parity

N/A — no React Query / Zustand / cache state touched. Mobile/admin frontends unaffected.

---

## 9. Regression surface (for tester)

Same as v1, plus:

1. **The 4 dropped chains stay in pool now.** UK Leon (~1 row), Belgian Quick (~2), UK Wasabi (~1-2), French Paul (~2 in Brussels) all admit via default. **Acceptable per operator decision option A.**

2. **T-LEON-INDEPENDENT fixture assertion FLIPPED.** Tester verifies that when running deno test, this fixture passes with the new ADMIT assertion (not the old REJECT).

3. **T-LEON-PUPUSERIA-ADMIT regression guard new.** Tester verifies "Pupuseria Maria de Leon Bus" admits — this was the canary that caught the v1 false positive.

---

## 10. Constitutional compliance (v2)

| # | Principle | Status |
|---|---|---|
| 2 | One owner per truth | **PASS** — `bouncerChainRules.ts` still canonical. |
| 3 | No silent failures | **PASS** — every rejection still returns explicit reason. |
| 7 | Label temporary fixes | **PASS** — comment markers explicitly mark the 4 dropped patterns as "v2 rework" with future re-add guidance. |
| 8 | Subtract before adding | **PASS** — drops 4 patterns, adds 4 admit-regression-guards (subtract before testing-add). |
| 12 | Validate at the right time | **PASS** — chain checks at admission, unchanged. |
| 13 | Exclusion consistency | **PASS** — same rules in both pre-photo and final passes (dropped patterns not present in either). |

Other constitutional principles N/A (backend; no UI; no auth; no currency).

---

## 11. Transition items

None. The 4 dropped patterns are not transitional — they are permanent v2 removals per operator decision. Future precision-add ORCH (if/when warranted by city-specific chain pain) would re-add with stricter chain-context anchoring.

---

## 12. Discoveries for orchestrator (v2)

1. **Dry-run-as-safety-net pattern validated.** The v1 implementation deliberately used `dry_run: true` to preview rejection distribution before touching DB. This caught the false positives BEFORE any data was corrupted. This is a strong pattern worth codifying as a memory file or invariant for future bouncer/scoring rule changes. (Possible future memory: `feedback_dry_run_safety_net.md`.)

2. **Multi-word patterns are inherently safer.** `léon de bruxelles` (3 words) has near-zero false-positive risk. `leon` (1 word) has 16:1 false-positive ratio. Future chain pattern PRs should prefer multi-word/full-name matches over single-word matches whenever possible.

3. **`subway` and `kfc` are special cases worth noting.** `subway` (149 hits / 148 chain) and `kfc` (74 / all chain) have unique enough single-word names that false-positive risk is near-zero. The pattern length isn't the issue — it's how often the word appears as a non-chain proper noun.

4. **Operator should run `deno test` after every chainRules change.** SC-12 was UNVERIFIED in v1 because Deno wasn't available locally; in v2 it's still UNVERIFIED for the same reason. Operator install of Deno (`winget install DenoLand.Deno`) is a one-time setup that unblocks all future bouncer rule iterations.

5. **No further patterns surfaced in pool-wide collision audit.** Beyond the 4 dropped + the 2 verified-clean (`subway`, `kfc`), pool-wide grep for the remaining ~116 patterns wasn't comprehensive. Operator may want a follow-up audit at a quieter time to verify other patterns aren't producing false positives in less-sampled cities (Lagos, Brussels, etc.).

---

## 13. What needs operator-side runtime verification (v2)

Same as v1 but with v2-specific changes:

1. **Run deno test locally** (must install Deno first):
   ```powershell
   winget install DenoLand.Deno  # one-time
   cd c:\Users\user\Desktop\mingla-main\supabase
   deno test --allow-all functions/_shared/__tests__/bouncer.test.ts
   ```
   Expected: all 51 fixtures pass (47 v1 + 4 v2 + 1 flipped).

2. **Commit + push v2:**
   ```bash
   git add supabase/functions/_shared/bouncerChainRules.ts supabase/functions/_shared/__tests__/bouncer.test.ts Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0735_BOUNCER_RULES_REPORT_v2.md Mingla_Artifacts/OPEN_INVESTIGATIONS.md
   git commit -m "fix(bouncer): ORCH-0735 v2 — drop 4 high-collision chain patterns (paul/leon/wasabi/quick)"
   git push origin Seth
   ```

3. **Redeploy BOTH edge functions** (two-pass parity):
   ```bash
   supabase functions deploy run-bouncer --project-ref gqnoajqerqhnvulmnyvv
   supabase functions deploy run-pre-photo-bouncer --project-ref gqnoajqerqhnvulmnyvv
   ```

4. **Orchestrator re-runs Durham dry-run** to verify the 4 dropped reasons are gone:
   - Expected `by_reason` distribution: NO `B11:chain_brand:leon_uk`, NO `B11:chain_brand:paul_france_bakery`, NO `B11:chain_brand:wasabi`, NO `B11:chain_brand:quick_belgium`
   - All other rejections (Pizza Hut, Starbucks, Cinnabon, Domino's, etc.) preserved.

5. **Live sweep city-by-city** (Durham → Cary → Fort Lauderdale → Baltimore → Raleigh → Lagos → Brussels → Washington → London).

6. **Post-sweep SQL probe** to verify SC-16.

7. **Smoke test in admin** (Cary sample 50 → verify ZERO chain rows).

If any of those fail → tester returns NEEDS REWORK with specific failure detail.

---

## 14. Status label

**`implemented, partially verified`** — same as v1 status. Code complete; 4 patterns dropped + 5 fixtures (1 flipped + 4 added); static-trace verified. Deno test execution UNVERIFIED in implementor environment; operator must run locally + verify all 51 fixtures pass before redeploying.

If operator runs deno test and ALL pass → status flips to `implemented and verified`. If any fail → NEEDS REWORK.

---

**End of v2 implementation report.**
