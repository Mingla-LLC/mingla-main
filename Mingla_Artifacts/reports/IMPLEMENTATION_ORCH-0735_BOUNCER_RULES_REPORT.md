# Implementation Report — ORCH-0735: Bouncer fast-food + chain + cheap-snack exclusion (Path A)

**Status:** `implemented, partially verified`
**Date:** 2026-05-05
**Implementor:** mingla-implementor
**SPEC:** [`Mingla_Artifacts/specs/SPEC_ORCH-0735_BOUNCER_CHAIN_FAST_FOOD_RULES.md`](../specs/SPEC_ORCH-0735_BOUNCER_CHAIN_FAST_FOOD_RULES.md) (BINDING; §6.B amended 2026-05-05 — see §3 below)
**Investigation:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0735_BOUNCER_CHAIN_GAP.md`](INVESTIGATION_ORCH-0735_BOUNCER_CHAIN_GAP.md)
**Dispatch:** [`Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0735_BOUNCER_RULES.md`](../prompts/IMPLEMENTOR_ORCH-0735_BOUNCER_RULES.md)

---

## 1. Layman summary

Bouncer now has three new rules (B10/B11/B12) that reject fast-food, chain restaurants, cheap snack shops, and certain primary types. All chain lists live in a NEW module `bouncerChainRules.ts` (~190 entries across 4 lists). Two critical operator-flagged regression guards are baked into tests: **CAVA Mediterranean** and **Le Pain Quotidien** must STAY admitted — fixtures fail loudly if a future PR re-blacklists them. SPEC §6.B was struck per orchestrator approval (existing `run-bouncer` already does the re-bounce work). Deno test execution is UNVERIFIED locally (no Deno installed in this environment); static-trace verification done; operator should run `deno test` before commit.

**Status:** `implemented, partially verified` · 19/22 SCs verified by static analysis or build inspection · 3 SCs UNVERIFIED awaiting operator-side `deno test` + post-deploy SQL probe.

---

## 2. Files changed

### `supabase/functions/_shared/bouncerChainRules.ts` — NEW
**What it did before:** N/A (new file)
**What it does now:** Exports 4 read-only arrays — `EXCLUDED_FAST_FOOD_TYPES` (5 primary_types), `FAST_FOOD_NAME_PATTERNS` (~120 chain regex patterns covering US/global + coffee + sweets + International + UK + Belgium + France + Germany + Spain + Lagos), `CASUAL_CHAIN_NAME_PATTERNS` (~31 full-service casual chain regexes), `UPSCALE_CHAIN_ALLOWLIST` (~34 case-insensitive substring entries that bypass B11/B12). Header comment block documents Path A canonical-source-of-truth status, ORCH-0735→ORCH-0736 sequencing, and operator-review trail.
**Why:** SC-01 (file exists with correct entry counts); D-1 Path A code-constants; D-7 cheap-snack scope; D-11 Lagos chains; D-12 9 chain allowlist additions; D-13 Cava removal; D-14 Le Pain Quotidien rejection.
**Lines changed:** +260 LOC NEW

### `supabase/functions/_shared/bouncer.ts` — MOD
**What it did before:** Pure-logic bouncer with rules B1 (type blocklist), B2 (closed_permanently), B3 (data integrity), B4-B6 (website/social/hours), B7-B8 (photos), B9 (child venue). Did NOT have fast-food primary_type rule, did NOT match chain-name regex, did NOT have UPSCALE allowlist.
**What it does now:**
- Imports 4 constants from `bouncerChainRules.ts`
- Exports 3 NEW helper functions: `isUpscaleChainAllowlisted(name)`, `matchFastFoodPattern(name)`, `matchCasualChainPattern(name)`. Each mirrors the existing `matchChildVenuePattern` shape; allowlist check short-circuits in the Fast/Casual matchers.
- `bounce()` body: B10 → B11 → B12 inserted between B9 (child-venue) and B7 (Google photos). Each rule short-circuits on match (returns immediately with reason code).
  - B10: types include `EXCLUDED_FAST_FOOD_TYPES` → reason `B10:fast_food_type:<type>`
  - B11: name matches `FAST_FOOD_NAME_PATTERNS` AND not allowlisted → reason `B11:chain_brand:<label>`
  - B12: name matches `CASUAL_CHAIN_NAME_PATTERNS` AND not allowlisted → reason `B12:casual_chain:<label>`
- Header comment updated noting ORCH-0735 + I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS invariant + I-TWO-PASS-BOUNCER-RULE-PARITY preservation
**Why:** SC-02 (helpers exported), SC-03 (rule order correct), SC-04/05/06 (each rule's verdict shape), SC-07 (allowlist bypass), SC-17/18 (invariants preserved).
**Lines changed:** ~+85/−0 (additive only; no existing logic touched beyond comment block)

### `supabase/functions/_shared/__tests__/bouncer.test.ts` — MOD
**What it did before:** 318 LOC testing existing B1-B9 rules + cluster derivation + own-domain check + two-pass parity. Zero fast-food / chain fixtures (per investigation §F-6).
**What it does now:** Adds 47 new fixtures across 9 test groups:
- 5 B10 type-blocklist (T-B10-01..05)
- 18 B11 chain-name fixtures covering each region/category
- 8 B12 casual chain fixtures
- 8 negative independents (T-NEG-01..08) — including T-NEG-05 word-boundary regression for Lagos `the place` pattern
- 6 allowlist bypass (T-ALLOW-01..06) — Capital Grille, Ruth's Chris, Hawksmoor, Cipriani, Gordon Ramsay, Houston's
- **2 critical regression guards: T-CAVA-ADMIT, T-LPQ-ADMIT** — must STAY passing; fixture comments warn future implementors not to "fix" them by removing
- 2 word-boundary regression: T-CAVA-VARIANT (Cavalry Pub admits), T-LEON-INDEPENDENT (documented edge case — pattern `\bleon\b` is intentionally aggressive per D-15 default-accept)
- 2 pre-photo parity tests (T-PARITY-01/02) — B10/B11 fire identically with `opts.skipStoredPhotoCheck=true`
- 3 helper-function direct tests (`isUpscaleChainAllowlisted`, `matchFastFoodPattern`, `matchCasualChainPattern`)
- 2 edge cases (T-EDGE-01/02)
**Why:** SC-12 (45+ fixtures pass); SC-08 + SC-09 (Cava + LPQ regression guards); SC-10 (word-boundary protection); SC-11 (pre-photo parity).
**Lines changed:** ~+395 LOC NEW (appended to existing file)

### `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_bouncer_chain_rules_in_code.md` — NEW (DRAFT)
**What it did before:** N/A (new file)
**What it does now:** Decommission/Path-A workflow memory documenting: what's authoritative (`bouncerChainRules.ts`), what's NOT authoritative anymore (rule_sets DB tables), how to add/remove a chain (code PR + test fixture), what to do when encountering rule_sets references (active code = P0 flag; admin RPCs = decoupled; historical migrations = preserve), why this memory exists (stranded-rule-DB pattern). Frontmatter `status: DRAFT — flips to ACTIVE on ORCH-0735 CLOSE`.
**Why:** Per orchestrator CLOSE Step 5a; regression prevention via persistent memory.
**Lines changed:** +135 LOC NEW

### `supabase/functions/run-bouncer/index.ts` — UNTOUCHED
Per SPEC §6.B amendment 2026-05-05 (orchestrator-approved before any code written): SPEC §6.B was struck — existing function already does the re-bounce work via `{all_cities: true}` body. Adding a parallel `re_bounce_all_servable` action would be a Const #2 violation. Implementor verified existing function imports `bounce` from `_shared/bouncer.ts` at module load; redeploy after `bouncer.ts` changes ship picks up B10/B11/B12 automatically.

---

## 3. SPEC §6.B amendment receipt (orchestrator-approved)

Per OPEN_INVESTIGATIONS entry "2026-05-05 (latest+++++++++) — ORCH-0735 SPEC AMENDMENT — implementor pre-flight discovery APPROVED → §6.B STRUCK":

- **Original SPEC:** add `re_bounce_all_servable` action to `run-bouncer/index.ts` with NEW input/output schemas + paginated batch logic
- **Amendment:** existing function already does the work. Skip §6.B. Use existing endpoint with `{all_cities: true, dry_run?: true}` body
- **Effort impact:** dropped from ~9.3h → ~7h
- **Files-modified count:** dropped from 3 → 2 (`bouncer.ts` + `bouncer.test.ts` MOD only; `run-bouncer/index.ts` UNTOUCHED; `bouncerChainRules.ts` NEW)
- **SC-13/SC-14/SC-15 reinterpreted:** these now reference the existing endpoint shape (returns richer `{pass_count, reject_count, by_cluster, by_reason, written, duration_ms}`). Implementor confirms by inspection that existing function applies new B10/B11/B12 rules transparently after redeploy.

---

## 4. Spec traceability — Success criteria status (SC-01..SC-22)

| SC | Criterion | Verification | Status |
|---|---|---|---|
| SC-01 | `bouncerChainRules.ts` exists with 4 exports + correct entry counts | File created with 5 + ~120 + ~31 + ~34 entries (counts verified by inspection) | **PASS** (file exists, exports verified) |
| SC-02 | `bouncer.ts` imports + exports 3 new helpers | Grep + read-back confirms imports + 3 new exported helpers (`isUpscaleChainAllowlisted`, `matchFastFoodPattern`, `matchCasualChainPattern`) | **PASS** |
| SC-03 | `bounce()` rule order B10→B11→B12 between B3/B9 and B7-B9 | Direct read of edited `bounce()` body confirms order | **PASS** |
| SC-04 | B10 returns short-circuit verdict on EXCLUDED_FAST_FOOD_TYPES match | Code path confirmed by direct read; T-B10-01..05 fixtures assert this | **PASS** (code-level; test execution UNVERIFIED) |
| SC-05 | B11 returns short-circuit verdict on FAST_FOOD_NAME_PATTERNS match (allowlist short-circuits) | Code path confirmed; T-B11-01..18 + T-ALLOW-01..06 fixtures assert | **PASS** (code-level) |
| SC-06 | B12 returns short-circuit verdict on CASUAL_CHAIN_NAME_PATTERNS match (allowlist short-circuits) | Code path confirmed; T-B12-01..08 + T-ALLOW fixtures | **PASS** (code-level) |
| SC-07 | UPSCALE_CHAIN_ALLOWLIST short-circuits both B11 and B12 | Helper code confirmed (allowlist check before pattern iter); 6 allowlist fixtures assert | **PASS** (code-level) |
| **SC-08** | **Cava admitted regression guard (T-CAVA-ADMIT)** | Cava NOT in any blacklist (verified by grep `cava` in `bouncerChainRules.ts` returns only the comment removal note); T-CAVA-ADMIT fixture asserts admit | **PASS** (code-level) |
| **SC-09** | **Le Pain Quotidien admitted regression guard (T-LPQ-ADMIT)** | Le Pain Quotidien NOT in any blacklist (verified by grep returns only comment removal note); T-LPQ-ADMIT fixture asserts admit | **PASS** (code-level) |
| SC-10 | Word-boundary regex prevents false-positives | `FF_PATTERN` helper uses `\b` anchors; T-NEG-01..08 + T-CAVA-VARIANT fixtures assert independents survive | **PASS** (code-level) |
| SC-11 | Pre-photo pass parity — B10/B11/B12 photo-independent | Rules placed BEFORE B7/B8 in bounce(); T-PARITY-01/02 fixtures assert identical verdicts with `skipStoredPhotoCheck=true` | **PASS** (code-level) |
| **SC-12** | **All 45+ fixtures pass via `deno test`** | **UNVERIFIED — Deno not installed in this environment.** Static trace done; operator must install Deno + run before commit. | **UNVERIFIED** |
| SC-13 | re_bounce_all_servable action accepts input schema | **AMENDED** — uses existing `{all_cities, dry_run?}` endpoint shape | **PASS** (existing function unchanged; amendment §3) |
| SC-14 | Re-bounce sweep `dry_run=true` does NOT modify rows | **AMENDED** — existing function honors `dry_run=true` | **PASS** (existing function behavior verified by code-read of run-bouncer/index.ts) |
| SC-15 | Re-bounce sweep `dry_run=false` updates verdict-changed rows | **AMENDED** — existing function writes is_servable + bouncer_reason + bouncer_validated_at | **PASS** (existing behavior) |
| SC-16 | Post-sweep SQL probe returns 0 violations | **UNVERIFIED — depends on operator running live sweep post-deploy.** Probe SQL specified in SPEC §8.1 | **UNVERIFIED** |
| SC-17 | I-BOUNCER-DETERMINISTIC preserved | No AI/network calls in B10/B11/B12; pure type-list + regex matching; verified by code-read | **PASS** |
| SC-18 | I-TWO-PASS-BOUNCER-RULE-PARITY preserved | B10/B11/B12 are photo-independent; placed BEFORE B7/B8; T-PARITY fixtures verify | **PASS** (code-level) |
| SC-19 | DRAFT memory file exists | File created at `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_bouncer_chain_rules_in_code.md` with `status: DRAFT — flips to ACTIVE on ORCH-0735 CLOSE` frontmatter | **PASS** |
| SC-20 | No mobile files modified | Verified — zero `app-mobile/` files touched | **PASS** |
| SC-21 | No DB schema migration files | Verified — zero `supabase/migrations/` files touched | **PASS** |
| SC-22 | Implementation report saved | This document at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0735_BOUNCER_RULES_REPORT.md` | **PASS** |

**Summary:** 19/22 PASS at code-level + file inspection · 3/22 UNVERIFIED awaiting operator-side `deno test` (SC-12) + live sweep post-deploy (SC-16) + tester PASS verification.

---

## 5. Critical regression guard verification (D-13 / D-14)

Per operator markup 2026-05-05, two chains MUST stay admitted. Verified in code:

**Cava (D-13):**
```
$ grep -i "cava" supabase/functions/_shared/bouncerChainRules.ts
  // [D-13: cava REMOVED — explicit operator admit. Regression test T-CAVA-ADMIT.]
```
Only reference is the comment marker. NOT in any pattern array. T-CAVA-ADMIT fixture in `bouncer.test.ts` asserts `is_servable=true` for "CAVA Mediterranean".

**Le Pain Quotidien (D-14):**
```
$ grep -i "pain quotidien" supabase/functions/_shared/bouncerChainRules.ts
  // [D-14: Le Pain Quotidien REMOVED from blacklist — explicit operator admit. Regression test T-LPQ-ADMIT.]
```
Only reference is the comment marker. NOT in any pattern array. T-LPQ-ADMIT fixture asserts `is_servable=true` for "Le Pain Quotidien".

---

## 6. Operator-review markup confirmation (D-11 / D-12)

**D-11 Lagos chains** — 5 entries in `FAST_FOOD_NAME_PATTERNS` per operator confirmation:
- ✅ `chicken republic` → label `chicken_republic_ng`
- ✅ `mr bigg's` → label `mr_biggs_ng` (+ `mr biggs` ASCII variant)
- ✅ `tantalizers` → label `tantalizers_ng`
- ✅ `sweet sensation` → label `sweet_sensation_ng`
- ✅ `the place` → label `the_place_ng` (with T-NEG-05 word-boundary regression test verifying "The Placebo Bar" admits)

**D-12 9 borderline-upscale chains** — all on `UPSCALE_CHAIN_ALLOWLIST` per operator confirmation:
- ✅ `cote brasserie` (+ `côte brasserie` accent variant)
- ✅ `hawksmoor`
- ✅ `cipriani`
- ✅ `carbone`
- ✅ `gordon ramsay`
- ✅ `the ivy`
- ✅ `daniel boulud` (+ `db bistro` sibling)
- ✅ `j. alexander` (+ `j alexander` ASCII variant)
- ✅ `houston's` (+ `hillstone` sibling)

J. Alexander's and Houston's were originally proposed for CASUAL_CHAIN_BLACKLIST per SPEC §J.26-27; operator markup moved both to UPSCALE_CHAIN_ALLOWLIST. Verified that they are NOT in `CASUAL_CHAIN_NAME_PATTERNS` (the entry has comment markers `[D-12: J. Alexander's REMOVED — moved to UPSCALE_CHAIN_ALLOWLIST]` + `[D-12: Houston's / Hillstone REMOVED — moved to UPSCALE_CHAIN_ALLOWLIST]`). T-ALLOW-06 fixture asserts Houston's admits.

---

## 7. Word-boundary regex audit

The `FF_PATTERN` helper builds `\b<escaped>\b` with case-insensitive flag. High-collision patterns flagged + verified:

| Pattern | Risk | Test fixture | Behavior |
|---|---|---|---|
| `\bthe place\b` (Lagos) | "the placebo", "the placement" false-positive risk | T-NEG-05 ("The Placebo Bar") | Word boundary AFTER 'place' requires non-word char. 'b' (in placebo) IS a word char → no match. **Safe.** |
| `\bpaul\b` (France bakery) | Restaurants named "Paul's", "Saint Paul's", etc. | None explicit | Will match "Paul's" because `'` is non-word → word boundary. False-positive risk **accepted** per D-15 default-accept. Operator may refine if collisions surface. |
| `\bleon\b` (UK) | Independent restaurants with "Leon" or "Léon" in name | T-LEON-INDEPENDENT (documented as known edge) | Will match "Leon Restaurant" because space is non-word → word boundary. **Intentional per operator** — UK Leon chain in scope. Independent admits would require pattern refinement (e.g., `leon @ liverpool street`) or ALLOWLIST entry. Logged as known limitation. |
| `\bwasabi\b` (UK) | "Wasabi Sushi" independents | None explicit | Same risk profile as Leon. Operator may need to refine if pain surfaces. |
| `\beat\.\b` (UK) | "Eat." chain (defunct?) — `\.` literal dot | None explicit | Pattern is `\beat\.\b` (escaped dot). Matches "Eat." literally with word boundaries. Low collision risk. |
| `\bquick\b` (Belgium) | Common adjective "Quick"; restaurant names like "Quick Bites" | None explicit | Matches "Quick" anywhere. False-positive risk **accepted** per default-accept; operator may refine. |
| `\bsubway\b` (US) | Transit station names like "Subway Sandwich Shop near Subway Station" | None explicit | Subway is the US chain; transit references typically don't have `\bsubway\b` as a place name. Low risk. |

**Discoveries for orchestrator:** §10 #1 below documents word-boundary edge cases the operator may want to refine in a future cycle.

---

## 8. Decommission memory pre-write confirmation

File at `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_bouncer_chain_rules_in_code.md`:
- Frontmatter: `status: DRAFT — flips to ACTIVE on ORCH-0735 CLOSE` ✅
- Body covers: what's authoritative (`bouncerChainRules.ts`); what's NOT (rule_sets tables); per-context guidance (active code P0 / admin RPCs decoupled / historical migrations preserve); how to add/remove a chain (code PR + test fixture); regression guards documented (T-CAVA-ADMIT + T-LPQ-ADMIT must STAY)
- Cross-references: DEC-107 reservation, ORCH-0735 SPEC, ORCH-0735 INVESTIGATION, operator-review markup, sibling decommission memories, ORCH-0736 future cleanup
- Status flips DRAFT→ACTIVE at orchestrator CLOSE per Step 5a — implementor did NOT flip unilaterally.

---

## 9. Migration deployment confirmation

**No migration in this implementation.** Zero `supabase/migrations/` files touched. Operator deploy commands:
```bash
# After operator commits the changes
supabase functions deploy run-bouncer --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy run-pre-photo-bouncer --project-ref gqnoajqerqhnvulmnyvv
```
**Both** functions must redeploy because both import `bounce` from `_shared/bouncer.ts` at module load (per `I-TWO-PASS-BOUNCER-RULE-PARITY`).

---

## 10. Discoveries for orchestrator

1. **Word-boundary edge cases (informational; not a blocker).** Patterns `paul`, `leon`, `wasabi`, `quick` are common enough words that they may match independent restaurants in ways operator might not intend. Operator confirmed default-accept on these (D-15) but may want to refine in a future ORCH if false positives surface in production data. Specific candidates for refinement: `paul` → require trailing space + bakery context; `leon` → require chain location pattern. Logged for ORCH-0735 close-time follow-up consideration.

2. **`leon de bruxelles` pattern redundancy.** Both `\bleon\b` and `\bleon de bruxelles\b` exist in FAST_FOOD_NAME_PATTERNS. The shorter `\bleon\b` will match first (it's earlier in the array). The `leon de bruxelles` entry would only be reached if `leon` was removed. This is technically redundant but harmless. Documented for clarity.

3. **`einstein bagel` collision with `einstein bros` proper-noun matching.** Both patterns exist; `einstein bros` matches "Einstein Bros Bagels" (the actual chain name) via word-boundary on `bros`. The `einstein bagel` pattern is a fallback for variant brand text. Both labels are distinct (`einstein_bros` vs `einstein_bagels_alt`). Acceptable.

4. **Test for "Léon Restaurant" T-LEON-INDEPENDENT documented as INTENTIONAL false-positive.** Per D-15 default-accept on UK chain Leon, the test asserts `is_servable=false` for any "Leon" + Restaurant pattern. This is the documented behavior — operator-aware limitation, not a regression. Future ORCH may add allowlist entries for specific independents named "Leon" if business need surfaces.

5. **SC-12 UNVERIFIED in this implementor turn.** Deno is not installed in the implementor's environment. Operator must install Deno (`winget install DenoLand.Deno` or scoop equivalent) and run `cd supabase && deno test --allow-all functions/_shared/__tests__/bouncer.test.ts` before commit. Static trace verification of fixtures is documented in §4 above. If `deno test` reveals a fixture failure, that's NEEDS REWORK territory.

6. **SPEC §6.B amendment (already orchestrator-approved 2026-05-05).** Implementor surfaced this in pre-flight before writing any code; orchestrator approved skip; implementation proceeded with reduced scope. Documented in §3 above for completeness.

7. **Existing `run-bouncer/index.ts` parallelism note.** The existing function uses `Promise.all` parallelization within batches of 500 for the UPDATE writes. After deploy + sweep, this should comfortably handle the full pool (per existing comment "<10s for Raleigh's 2,912 rows per SC-01"). Operator should expect ~30-60s for full re-sweep across all servable cities.

---

## 11. Invariant verification

| Invariant | Preserved? | Evidence |
|---|---|---|
| **`I-BOUNCER-DETERMINISTIC`** | **Y** | B10/B11/B12 are pure type-list + regex matching. No AI calls, no network I/O, no external dependencies. Helper functions (`matchFastFoodPattern`, `matchCasualChainPattern`, `isUpscaleChainAllowlisted`) are pure functions returning labels or null. |
| **`I-TWO-PASS-BOUNCER-RULE-PARITY`** | **Y** | New rules are photo-independent. Placed BEFORE B7/B8 (which are the only photo-dependent rules). Pre-photo pass returns identical verdicts. T-PARITY-01/02 fixtures explicitly verify. |
| **`I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING`** (DEC-099) | **Y** | ORCH-0735 is upstream of trial pipeline; touches no trial code. |
| **`I-TRIAL-RUN-SCOPED-TO-CITY`** (DEC-105) | **Y** | ORCH-0735 doesn't modify trial pipeline; city scoping unchanged. |
| **NEW `I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS`** (proposed; ratifies at CLOSE) | Established | Code implements the rule; orchestrator ratifies in INVARIANT_REGISTRY at CLOSE per Step 5e. Post-deploy SQL probe (SPEC §8.1) verifies. |

---

## 12. Cache safety

N/A — no React Query / Zustand / cache state touched. Bouncer is pure backend; admin/mobile cache unaffected.

---

## 13. Regression surface (for tester)

Adjacent features most likely to surprise:

1. **Existing 32-anchor trial rows** (legacy, pre-ORCH-0734) — verify they still display correctly in admin Trial Results tab. They have `signal_id != NULL`, `anchor_index != NULL`, model badge logic per ORCH-0733. Bouncer changes don't affect display.

2. **`run-pre-photo-bouncer/index.ts` two-pass parity** — must redeploy alongside `run-bouncer`. If only one redeploys, pre-photo pass uses old `bouncer.ts` (no B10/B11/B12) while final pass uses new — places could pass pre-photo and then fail final, causing photo-download cycles to waste effort. Tester verifies BOTH functions are redeployed.

3. **Admin pages reading `place_pool.is_servable`** — Place Pool Management page, Place Intelligence Trial city counts. Numbers shrink by ~600-1000 after live sweep. Tester verifies admin pages don't break or show stale counts.

4. **City-runs trial pipeline (ORCH-0734)** — `start_run` queries `place_pool WHERE is_servable=true AND city_id=X`. After sweep, fewer places per city. Tester runs a sample-50 Cary trial and verifies no Chick-fil-A / Olive Garden / Starbucks in the results.

5. **Seeder edge functions** — they invoke `run-bouncer` indirectly via `is_active=true` insertions. Verify any active seeder runs apply new rules to NEW places (not just the bulk re-sweep).

---

## 14. Constitutional compliance

| # | Principle | Status |
|---|---|---|
| 1 | No dead taps | N/A (backend) |
| 2 | One owner per truth | **PASS** — `bouncerChainRules.ts` is canonical source; rule_sets DB tables decoupled per memory; existing `run-bouncer` retained as single sweep authority (per §6.B amendment). |
| 3 | No silent failures | **PASS** — every rejection returns explicit reason code; no swallowed errors. |
| 4 | One query key per entity | N/A (backend) |
| 5 | Server state stays server-side | N/A |
| 6 | Logout clears everything | N/A |
| 7 | Label temporary fixes | **PASS** — no `[TRANSITIONAL]` markers introduced. Path A is permanent per DEC-107. |
| 8 | Subtract before adding | **PASS** — Cava removed from blacklist (D-13); Le Pain Quotidien NOT added (D-14); J. Alexander's + Houston's moved out of blacklist into allowlist (D-12). |
| 9 | No fabricated data | N/A |
| 10 | Currency-aware UI | N/A |
| 11 | One auth instance | N/A |
| 12 | Validate at the right time | **PASS** — chain checks happen at admission (bouncer), not per-request. |
| 13 | Exclusion consistency | **PASS** — same `bounce()` rules apply identically in pre-photo and final passes (I-TWO-PASS-BOUNCER-RULE-PARITY). |
| 14 | Persisted-state startup | N/A |

---

## 15. Transition items

None. No `[TRANSITIONAL]` markers introduced. Path A is the permanent solution per DEC-107.

---

## 16. What needs operator-side runtime verification

After operator commits + deploys both edge functions:

1. **Operator runs `deno test` locally** (must install Deno first):
   ```bash
   winget install DenoLand.Deno  # or scoop install deno
   cd supabase
   deno test --allow-all functions/_shared/__tests__/bouncer.test.ts
   ```
   Expected: all 47 new fixtures pass + all existing fixtures pass.

2. **Operator deploys edge functions** (BOTH required for two-pass parity):
   ```bash
   supabase functions deploy run-bouncer --project-ref gqnoajqerqhnvulmnyvv
   supabase functions deploy run-pre-photo-bouncer --project-ref gqnoajqerqhnvulmnyvv
   ```

3. **Operator runs DRY-RUN sweep first** to preview reasons_summary:
   ```bash
   curl -X POST 'https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/run-bouncer' \
     -H 'Authorization: Bearer <admin_token>' \
     -H 'Content-Type: application/json' \
     -d '{"all_cities": true, "dry_run": true}'
   ```
   Verify `by_reason` distribution shows ~600-1000 chain rejections (B10/B11/B12 codes).

4. **Operator runs LIVE sweep** (no dry_run):
   ```bash
   curl -X POST '...' -d '{"all_cities": true, "dry_run": false}'
   ```
   Returns `written` count = number of rows whose verdict changed.

5. **Post-sweep SQL probe** (SC-16):
   ```sql
   SELECT count(*) FROM place_pool
   WHERE is_servable=true 
     AND name IN ('Chick-fil-A', 'McDonald''s', 'Starbucks', 'Olive Garden', '7-Eleven');
   -- Expected: 0
   ```

6. **Smoke test:** click Run trial in admin Place Intelligence Trial → pick Cary → sample 50. Verify trial sweep results contain ZERO chain rows.

If any of those fail → tester returns NEEDS REWORK with specific failure detail.

---

**End of implementation report.**
