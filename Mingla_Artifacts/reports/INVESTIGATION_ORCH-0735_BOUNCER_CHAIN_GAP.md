# Investigation Report — ORCH-0735: Bouncer fast-food / chain-restaurant policy gap

**Mode:** INVESTIGATE (forensics-only; NO spec, NO code changes)
**Date:** 2026-05-05
**Investigator:** mingla-forensics
**Severity:** S1-high (production rerank blocker)
**Confidence:** H (high) on root cause + design-intent reconciliation. M-H on the chain-scope ambiguity (Phase 2.E) — that's a SPEC-phase operator decision, not an investigation gap.

---

## 1. Symptom summary

**Operator-stated design intent (binding):** "the bouncer is supposed to bounce all fast food, and chains like Chick-fil-A, McDonald's etc."

**Live evidence (run `f0fe3823-aedf-42ac-af86-a1cbabaeeeae`, Cary 50-place sample, 2026-05-05):**
- Chick-fil-A row in `place_pool` has `is_servable=true`
- `bouncer_validated_at` is set (bouncer ran)
- `bouncer_reason` is NULL (bouncer found no rejection reason)
- Gemini scored: `casual_food=95`, `brunch=80`, `icebreakers=65`
- Under Phase 1 production rerank, would surface in 3 decks

**Layers contradicted:** operator design intent (Docs layer) vs the code (Bouncer layer) vs the data (live `is_servable=true`). Three layers disagreeing.

**The cleanest framing:** the design intent IS implemented in the rules-engine database (FAST_FOOD_BLACKLIST has 66 entries including `chick-fil-a`), but ZERO production code consumes that database. The rule database is "stranded" — populated with intent, never wired to a consumer.

---

## 2. Investigation manifest

| # | File / artifact | Layer | Why | Result |
|---|---|---|---|---|
| 1 | `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0735_BOUNCER_CHAIN_GAP.md` | Dispatch | Take the report | 8 question blocks A-H mapped |
| 2 | `Mingla_Artifacts/DECISION_LOG.md` (grep bouncer/fast_food/chain) | Docs | Find prior policy decisions | Multiple matches; DEC-098 (ORCH-0713) describes Claude rerank GATING via SQL place_scores; no DEC explicitly addresses fast-food exclusion as a bouncer rule |
| 3 | `Mingla_Artifacts/reports/INVESTIGATION_CATEGORY_PIPELINE_END_TO_END.md` | Prior report | Locate FAST_FOOD_BLACKLIST authority | **Critical breadcrumb** at line 161: identifies 5 global rules as `BLOCKED_PRIMARY_TYPES, FAST_FOOD_BLACKLIST, MIN_DATA_GUARD, RESTAURANT_TYPES, SOCIAL_DOMAINS, EXCLUSION_KEYWORDS, UPSCALE_CHAIN_PROTECTION`. C.4 describes bouncer as quality-only ("does NOT derive a category — operates on category-agnostic quality criteria") |
| 4 | Memory directory grep (bouncer/chain/fast) | Memory | Prior context | Zero matches in MEMORY.md feedback memories |
| 5 | `supabase/functions/_shared/bouncer.ts` lines 1-271 (full file) | Code (pure logic) | Authoritative bouncer rules | EXCLUDED_TYPES = gym/school/dog_park/funeral_home/cemetery/hospital/gas_station/bank/police/fire_station/storage/real_estate_agency/etc. **No fast_food_restaurant.** B9 child-venue patterns target sub-counters inside big-box retailers (Walmart Bakery / Sam's Club Cafe) not chain restaurants. Full ruleset: B1 type-blocklist, B2 closed-permanently, B3 missing-name/lat/lng, B4 no-website, B5 social-only, B6 no-hours, B7 no-google-photos, B8 no-stored-photos, B9 child-venue. |
| 6 | `supabase/functions/run-bouncer/index.ts` | Code (driver) | Verify driver doesn't post-process | Grep `rule_set\|FAST_FOOD\|fast_food\|chain.restaurant` → zero matches |
| 7 | `supabase/functions/run-pre-photo-bouncer/index.ts` | Code (two-pass) | Verify two-pass parity | Same grep → zero matches |
| 8 | `supabase/functions/_shared/__tests__/bouncer.test.ts` | Test fixtures | Reveal intent | `fast.food\|chick\|mcdonald\|chain\|FAST_FOOD` → zero matches. **No test asserts fast-food rejection.** |
| 9 | `supabase/functions/_shared/categoryPlaceTypes.ts` lines 110-138 | Code (helper) | Type categorization | Has comment "ORCH-0460: real restaurants only — removed 'fast_food_restaurant'" — applies to category mapping (display surface), not bouncer admission |
| 10 | `supabase/functions/_shared/seedingCategories.ts` lines 60-83 | Code (seeding policy) | Pre-bouncer admission | `BRUNCH_LUNCH_CASUAL_EXCLUDED` includes `'fast_food_restaurant'` — filters fast food OUT of seeding queries TO Google Places API for `brunch_lunch_casual` SEEDING category. Does NOT prevent fast food from entering pool via OTHER seeding categories or other admission paths. |
| 11 | `supabase/functions/_shared/__tests__/scorer.test.ts` | Test fixtures (signal scorer) | Verify scorer treatment | `types_includes_fast_food_restaurant: -40` — signal scorer DEMOTES fast food via field weight. But demotion ≠ exclusion; surfaces with lower score, still surfaces. |
| 12 | Repo-wide grep on `rule_set\|FAST_FOOD\|rule_entries` in `supabase/functions/` | Code (consumer audit) | Find rule consumer | **Zero hits in active code.** Only references are in admin RPCs in `migrations/20260505000000_baseline_squash_orch_0729.sql` (managing the rule editor UI) |
| 13 | Live DB query: `rule_sets` table | Schema (live) | Confirm rule schema state | 7 rule sets active: BLOCKED_PRIMARY_TYPES (23 entries), FAST_FOOD_BLACKLIST (66), EXCLUSION_KEYWORDS (192), RESTAURANT_TYPES (whitelist), UPSCALE_CHAIN_PROTECTION (24), CASUAL_CHAIN_DEMOTION (21), FLOWERS_BLOCKED_PRIMARY_TYPES |
| 14 | Live DB query: FAST_FOOD_BLACKLIST entries | Data | Verify what's in it | 66 entries, including verbatim `chick-fil-a`, `mcdonald`, `burger king`, `kfc`, `wendy's`, `subway`, `taco bell`, `popeyes`, `chipotle`, `shake shack`, `panera bread`, `sweetgreen`, `starbucks`, `dunkin`, `tim horton`, `pret a manger`, `bojangles`, `zaxby`, `domino's`, `papa john`, `pizza hut`, plus regional + ice-cream chains |
| 15 | Live DB query: Chick-fil-A bouncer state | Data (runtime) | Verify the bouncer ran | Multiple Chick-fil-A rows: some `is_servable=true` `bouncer_ran=true` `bouncer_reason=null` (passed); some `is_servable=null` `bouncer_ran=false` (not yet judged). McDonald's + Burger King mostly fail B8:no_stored_photos (no photos → fails). Chick-fil-A passes because it has photos. |
| 16 | Live DB query: blast radius per city | Data | Quantify the gap | Raleigh 56 servable / 159 chain rows; Lagos 23/30 (77%); Cary 15/117; London 7/49; Durham 3/79. Across all seeded cities: ~107 known-chain rows servable. Plus 556 servable rows under fast-food-adjacent `primary_type` (`pizza_restaurant`=382, `hamburger_restaurant`=70, `sandwich_shop`=56, `donut_shop`=24, `fast_food_restaurant`=24). |
| 17 | Git log on `bouncer.ts` (S "FAST_FOOD") | History | Was the rule ever in code? | No commit added or removed FAST_FOOD from bouncer.ts. Git log on `S "FAST_FOOD"` shows the constant existed in code originally per ORCH-0460 era → migrated to DB rule_sets per ORCH-0526 M1+M2 ("DB-backed rules engine schema + seed + RPCs") + ORCH-0526 M2 ("edge function reads rules from DB"). Subsequent ORCH-0640 "Great Demolition and Rebuild" + ORCH-0700 (ai_categories decommission) appear to have removed the consumer code WITHOUT decommissioning the data tables. |

---

## 3. Findings

### 🔴 F-1 — Stranded rule database: FAST_FOOD_BLACKLIST + 6 sibling rule_sets populated in DB but ZERO production code consumes them

**File + line:**
- `supabase/functions/_shared/bouncer.ts:45-55` — `EXCLUDED_TYPES` array (does NOT include `fast_food_restaurant`)
- `supabase/functions/_shared/bouncer.ts:200-270` — `bounce()` function (rules B1-B9; no name-pattern check; no rule_set load)
- `supabase/functions/run-bouncer/index.ts` — bouncer driver (no `rule_set` / `rule_entries` import)
- Repo-wide: zero edge functions or shared modules reference `rule_set`, `rule_entries`, `FAST_FOOD_BLACKLIST`, `BLOCKED_PRIMARY_TYPES`, or `EXCLUSION_KEYWORDS` outside the admin RPCs that manage the editor UI

**Exact code (relevant excerpts):**
```ts
// bouncer.ts line 45 — only structural exclusions, no chain/fast-food rule
export const EXCLUDED_TYPES: ReadonlyArray<string> = [
  'gym', 'fitness_center',
  'school', 'primary_school', 'secondary_school', 'university', 'preschool',
  'dog_park',
  'funeral_home', 'cemetery',
  'hospital', 'doctor', 'dentist', 'pharmacy', 'medical',
  'gas_station', 'car_repair', 'car_wash', 'car_dealer', 'car_rental',
  'bank', 'atm', 'post_office',
  'police', 'fire_station', 'local_government_office',
  'veterinary_care', 'storage', 'real_estate_agency',
];

// bouncer.ts line 200 — bounce() applies B1-B9; no rule-engine load
export function bounce(place: PlaceRow, opts?: { skipStoredPhotoCheck?: boolean }): BouncerVerdict {
  // ... B1: type blocklist (EXCLUDED_TYPES)
  // ... B2: business_status === 'CLOSED_PERMANENTLY'
  // ... B3: missing name/lat/lng
  // ... B7: no Google photos
  // ... B8: no stored photos
  // ... B9: child venue (sub-counters inside big-box retailers)
  // (Cluster A_COMMERCIAL also runs B4 no-website, B5 social-only, B6 no-hours.)
  // No B10/B11 rule applies fast-food/chain logic.
}
```

**What it does:**
- Bouncer admits any place whose Google primary type is `fast_food_restaurant` (or `hamburger_restaurant`, `pizza_restaurant`, etc.) AS LONG AS the place has photos + website + hours + Google photo metadata. Result: Chick-fil-A passes; McDonald's mostly fails (because their listings often lack downloaded photos → B8 catches them indirectly).

**What it should do (per operator design intent):**
- Bouncer must reject:
  - All rows with `primary_type` in a fast-food-restaurant type list (`fast_food_restaurant`, plus any chain-aligned subtypes like `hamburger_restaurant`, `donut_shop` chains, `sandwich_shop` chains).
  - All rows whose `name` matches the FAST_FOOD_BLACKLIST patterns (66 entries currently in the DB rule).
- Verdict: `is_servable=false`, `bouncer_reason='B10:fast_food'` or `'B11:chain_brand:<pattern>'`.

**Causal chain:**
1. Place_pool admission inserts Chick-fil-A with `is_servable=null`, `bouncer_validated_at=null`.
2. `run-bouncer` edge function runs `bounce(place)`. Place has cluster=A_COMMERCIAL (default — none of EXCLUDED_TYPES match), business_status=OPERATIONAL, name+lat+lng present, has Google photos + stored photos + website + hours.
3. B1-B9 all pass because none of them check `primary_type='fast_food_restaurant'` or name patterns.
4. `bounce()` returns `{is_servable: true, cluster: 'A_COMMERCIAL', reasons: []}`.
5. Driver writes `is_servable=true`, `bouncer_reason=null`.
6. Place enters servable pool → eligible for trial scoring + future production rerank.
7. Trial sweep finds Chick-fil-A in `place_pool WHERE is_servable=true AND city_id=Cary` → Gemini scores it casual_food=95 / brunch=80 / icebreakers=65 (correctly identifying what it IS).
8. Operator sees Chick-fil-A in trial results, surfaces ORCH-0735.

**Verification step (proven, not coincidence):**
- `SELECT name, primary_type, is_servable, bouncer_reason FROM place_pool WHERE name='Chick-fil-A' LIMIT 5` → multiple rows with `is_servable=true`, `bouncer_reason=null`. Reproducible.
- `SELECT * FROM rule_entries WHERE rule_set_version_id='81c1f0c9-...'` → 66 entries including `chick-fil-a` verbatim. The intent is encoded in DB.
- `git grep -E "rule_set|FAST_FOOD" supabase/functions/` → zero hits in active code paths. Consumer is missing.
- Three-layer cross-check: design intent (DB rule_set) says exclude → code (bouncer.ts) doesn't read DB → live data shows admission. Reconciliation: code is the broken layer.

**Classification:** ROOT CAUSE PROVEN.

---

### 🟠 F-2 — ORCH-0526 wired the rules-engine consumer; ORCH-0640 / ORCH-0700 likely removed it without decommissioning the DB

**File + line:** Git log on `S "FAST_FOOD"` for the supabase/ tree shows commits:
- `26dc7727 feat(admin): ORCH-0526 M2 — edge function reads rules from DB + 5 bundled fixes` (consumer ADDED)
- `2b10b7c2 feat(orch-0640): Great Demolition and Rebuild — cutover applied + R-01 fix` (likely removed consumer along with card_pool decommission)
- `aad289ee feat(admin): ORCH-0526 M1 — DB-backed rules engine schema + seed + RPCs`
- `6b91c3ec fix(supabase): ORCH-0729 — squash 493 historical migrations into single production-schema baseline` (preserved schema in baseline; consumer not in current code)

**What it does:** Database tables `rule_sets`, `rule_set_versions`, `rule_entries` exist and are actively populated (5 active rule_sets, 326 entries). Admin RPCs (`admin_rule_set_versions`, list/compare/audit) exist for an editor UI. But production paths (bouncer, signal scorer, place admission, RPC views) do not consume them.

**What it should do:** Either (a) consumer code reactivated to read from rule_sets, OR (b) rule_sets decommissioned and rules moved back into code constants.

**Causal chain:** Without consumer code, the rules engine is data-without-effect. Admin operator can edit rules (UI exists) but edits never affect production behavior. Mingla program memory carries forward the assumption that "FAST_FOOD_BLACKLIST is enforced" because the data exists, but reality has been disconnected from intent for the time between ORCH-0640 and now.

**Classification:** CONTRIBUTING FACTOR (architectural drift; explains the root cause's origin but is not the direct cause itself).

---

### 🟠 F-3 — `seedingCategories.ts` filters fast food at SEEDING TIME for one category but not at admission; rows enter via other paths

**File + line:** `supabase/functions/_shared/seedingCategories.ts` lines 60-83

**Exact code:**
```ts
const BRUNCH_LUNCH_CASUAL_EXCLUDED: string[] = [
  // Drink-primary (not food-focused)
  'bar', 'cocktail_bar', ...,
  // Fast food (not date-worthy)
  'fast_food_restaurant',
  // Non-restaurant food
  'food_court', 'cafeteria', 'snack_bar',
  ...
];
```

**What it does:** When the seeder calls Google Places API for the `brunch_lunch_casual` seeding category, it includes a `primary_type:!=fast_food_restaurant` filter. Fast-food rows are NOT seeded INTO that category's results.

**What it should do (per operator intent):** Either (a) extend this exclusion to ALL seeding categories that touch food, OR (b) handle the exclusion ONCE in the bouncer (single source of truth — Const #2). Path (b) is cleaner.

**Causal chain:** Fast food rows enter `place_pool` via:
- Other seeding categories that don't have this exclusion (some categories don't filter primary_type)
- Free-tile / discovery seeding paths that bypass category-aware filtering
- Manual operator additions
Once admitted, the bouncer doesn't re-filter on primary_type — only on B1 EXCLUDED_TYPES (which is gym/school/etc., not fast food).

**Classification:** CONTRIBUTING FACTOR (a partial filter exists, but it's the wrong shape — per-category seeding policy instead of pool-wide bouncer policy).

---

### 🟡 F-4 — Photo-availability rule (B8) ACCIDENTALLY catches most fast food, providing false confidence

**File + line:** `bouncer.ts:240` — `B8:no_stored_photos`

**Exact code:**
```ts
if (!opts?.skipStoredPhotoCheck && !hasStoredPhotos(place)) {
  reasons.push('B8:no_stored_photos');
}
```

**What it does:** Most McDonald's / Burger King locations have minimal Google Photos coverage and don't pass photo download → B8 fires → `is_servable=false`. This is INCIDENTAL behavior, not designed fast-food filtering.

**What it should do:** B8 should remain a quality gate (no photos = not date-worthy). Fast-food exclusion should be a separate, NAMED rule (B10/B11) — operator-readable and not dependent on Google's photo coverage of any individual chain.

**Causal chain:** Chick-fil-A's branded marketing collateral means their locations DO have photos → photos download cleanly → B8 passes → place becomes servable. Without B10/B11, photo-rich chains slip through.

**Classification:** HIDDEN FLAW (works today by accident; will become a regression for any chain with strong photo presence).

---

### 🟡 F-5 — `signal_scorer` field weight `types_includes_fast_food_restaurant: -40` DEMOTES but does NOT EXCLUDE fast food

**File + line:** `supabase/functions/_shared/__tests__/scorer.test.ts:49` (test fixture documents production behavior)

**Exact code:**
```ts
types_includes_fast_food_restaurant: -40,
```

**What it does:** Signal scorer subtracts 40 from any signal's score for places typed `fast_food_restaurant`. A place that would otherwise score 95 in `casual_food` ends up at 55 — still above the 70 cutoff for "strong fit"? No, 55 is below 70. So scorer-side demotion alone WOULD prevent fast food from clearing `casual_food` cutoff in the SQL scorer path... BUT the trial pipeline doesn't use the SQL scorer; it uses Gemini.

**What it should do:** N/A — this is a different system (SQL signal_scorer) from the trial pipeline. The demotion is the right behavior for the SQL path. But it's irrelevant once Phase 1 production rerank goes live (operator's path forward is Gemini-based). The fix MUST be at the bouncer (admission gate), not at the scorer (post-admission demotion).

**Classification:** OBSERVATION (existing scorer-side mitigation that won't help once Phase 1 ships Gemini rerank).

---

### 🟡 F-6 — `bouncer.test.ts` has zero fast-food rejection assertions

**File + line:** `supabase/functions/_shared/__tests__/bouncer.test.ts` (entire file; verified via grep `fast.food|chick|mcdonald|chain|FAST_FOOD` → zero matches)

**What it does:** Tests assert B1-B9 behavior on gym/school/cemetery/etc. type fixtures + photo+website+hours edge cases. No fixture asserts "Chick-fil-A is rejected" or "fast_food_restaurant is excluded."

**What it should do:** When SPEC ships the B10/B11 rules, tests must assert rejection across the canonical fast-food types AND a sample of FAST_FOOD_BLACKLIST chain names (positive + negative cases — e.g., "Pizzeria Roma" should NOT match a "Pizza Hut" pattern).

**Classification:** HIDDEN FLAW (regression risk if rule reverts in future refactor without test coverage).

---

### 🔵 F-7 — Blast radius across seeded cities

**Live data (2026-05-05):**

Known-chain name matches (`Chick-fil-A`, `McDonald`, `Burger King`, `Starbucks`, `Subway`, `Taco Bell`, `KFC`, `Popeyes`, `Wendy`, `Dunkin`, `Chipotle`, `Panera`, `Domino's`, `Pizza Hut`, `Five Guys`, `Shake Shack`, `Sweetgreen`, `Pret`, `Bojangles`, `Zaxby`):

| City | Chain rows servable | Chain rows total | Pass-through rate |
|---|---|---|---|
| Raleigh | **56** | 159 | 35% |
| Lagos | **23** | 30 | **77%** |
| Cary | **15** | 117 | 13% |
| London | **7** | 49 | 14% |
| Durham | **3** | 79 | 4% |
| Baltimore | 1 | 123 | <1% |
| Brussels | 1 | 46 | 2% |
| Washington | 1 | 241 | <1% |
| Fort Lauderdale | 0 | 82 | 0% (mostly unbounced) |
| (Other 9 cities) | 0 | varies | unbounced |

By Google primary_type:

| primary_type | servable | total |
|---|---|---|
| pizza_restaurant | **382** | 1208 |
| hamburger_restaurant | **70** | 255 |
| sandwich_shop | **56** | 342 |
| donut_shop | **24** | 132 |
| fast_food_restaurant | **24** | 42 |
| **TOTAL fast-food-adjacent** | **~556** | **~1979** |

**Combined estimate:** 600-1000 places currently `is_servable=true` that should be excluded under operator's intent. Independent local pizzerias + sandwich shops + donut shops are mixed in — the fix needs to differentiate (chain-name patterns) so legitimate independents survive.

**Classification:** OBSERVATION (impact metric).

---

### 🔵 F-8 — UPSCALE_CHAIN_PROTECTION rule_set exists with 24 entries — operator already designed differentiation

**Live data:** `rule_set_versions` for `UPSCALE_CHAIN_PROTECTION` has 24 entries. Per the prior `INVESTIGATION_CATEGORY_PIPELINE_END_TO_END.md` line 161 + line 158 ("CASUAL_CHAIN_DEMOTION = 21 entries scope=upscale_fine_dining"), the operator's DESIGN MODEL already distinguishes:
- Fast-food chains → exclude (FAST_FOOD_BLACKLIST, 66 entries)
- Casual chains → demote in upscale categories (CASUAL_CHAIN_DEMOTION, 21 entries)
- Upscale chains → protect from casual-chain demotion (UPSCALE_CHAIN_PROTECTION, 24 entries — likely Capital Grille, Ruth's Chris, Eleven Madison Park, etc.)

This is sophisticated three-tier policy design that lives in the rules engine database. The fix should respect this design — not re-invent.

**Classification:** OBSERVATION (positive — the architecture intent is better than I initially feared; just needs consumer wired).

---

## 4. Five-layer cross-check

| Layer | What it says | Contradiction? |
|---|---|---|
| **Docs** | Operator design intent: "bouncer is supposed to bounce all fast food + chains." Prior investigation `INVESTIGATION_CATEGORY_PIPELINE_END_TO_END.md` lines 160-161 confirms FAST_FOOD_BLACKLIST exists as a global rule. ORCH-0526 M2 commit message: "edge function reads rules from DB." | Aligned with operator intent. |
| **Schema** | `rule_sets` + `rule_set_versions` + `rule_entries` populated and active (5 active rule_sets, 326 active entries including 66 fast-food chain names). RLS + service role grants in place. | Aligned with operator intent (data layer correctly stores the policy). |
| **Code** | `bouncer.ts` has no fast_food rule. Bouncer driver `run-bouncer/index.ts` doesn't load from rule_sets. No edge function references rule_set / rule_entries / FAST_FOOD_BLACKLIST. | **CONTRADICTION** — code does not enforce the design intent encoded in the data. |
| **Runtime** | Bouncer ran on Chick-fil-A and produced `bouncer_reason=null` (no rejection reason). | Aligned with code-layer behavior (consistent with the broken state). |
| **Data** | Live `place_pool` shows ~107 known-chain rows + ~556 fast-food-adjacent primary_type rows with `is_servable=true`. Chick-fil-A specifically present in Cary, Raleigh, Durham. | Aligned with code-layer behavior (consistent with the broken state). |

**Layer-disagreement diagnosis:** Docs + Schema (intent layer) vs Code + Runtime + Data (implementation layer). The TRUTH is split — intent says exclude, implementation admits. This is a classic "wire gap" between data layer and code layer; the data was preserved through ORCH-0640 / ORCH-0700 refactors but the consumer was removed.

---

## 5. Blast radius map

| Affected surface | Today | Phase 1 production rerank (planned) |
|---|---|---|
| Trial pipeline (`run-place-intelligence-trial`) | Surfaces fast-food chains in test sweeps; operator-visible quality issue (today's ORCH-0735 surfacing) | Same |
| `place_pool.is_servable=true` filter (consumed by city-runs sample, future Phase 1 rerank, admin dashboards) | ~600-1000 fast-food rows admitted | Same |
| Mobile card decks (post-Phase 1 ship) | N/A — Phase 1 not shipped yet | **Material credibility damage** — Mingla shows fast-food chains as date destinations |
| Admin dashboard (Place Pool Management page) | Operator can browse but no filter UI surfaces "fast food" badge | Operator confusion — pool stats include fast food |
| Signal scorer (`run-signal-scorer`) | -40 demotion on `types_includes_fast_food_restaurant` mostly catches at score level (cutoff 70) | Bypassed once Phase 1 ships Gemini rerank |
| `place_scores` table | Fast food has scores (most below cutoff after demotion) | Bypassed |

**Cross-cutting impact:** the bouncer is the SINGLE source of truth for `is_servable`. Fixing it once cascades to every downstream consumer. This is GOOD architecture — just hasn't been exercised correctly for fast food.

---

## 6. Hidden flaws (Phase 2.F findings)

**F-4 (above)** — B8 photo-availability catches some fast food incidentally; will regress for photo-rich chains.

**F-6 (above)** — No bouncer test asserts fast-food rejection.

**F-9 (NEW):** **Stale-bouncer-data trap.** Many fast-food rows have `bouncer_validated_at IS NULL` (never bounced — they predate or post-date the most recent bouncer sweep). The fix needs a re-bounce campaign to re-judge all existing rows. Without that, the new B10/B11 rules apply only to NEW entries.

```sql
SELECT COUNT(*) FILTER (WHERE bouncer_validated_at IS NULL) AS unbounced,
       COUNT(*) FILTER (WHERE bouncer_validated_at IS NOT NULL) AS bounced
FROM place_pool;
```

**F-10 (NEW):** **`UPSCALE_CHAIN_PROTECTION` is a positive list.** The operator's three-tier design (fast-food blacklist + casual-chain demotion + upscale-chain protection) implies that some chain restaurants ARE date-worthy. Capital Grille / Ruth's Chris / Morton's are likely there. The SPEC must avoid blanket-rejecting all chains by name; the design is FAST_FOOD list (exclude) + CASUAL list (demote) + UPSCALE list (protect from casual demotion) — three separate tiers.

**F-11 (NEW):** **Chain-name matching ambiguity.** FAST_FOOD_BLACKLIST entries are lowercase substrings (`mcdonald`, `chick-fil-a`, `pizza hut`, `cava ` with trailing space, etc.). A naive `name ILIKE '%pizza hut%'` won't catch "Pizzaria Hut" if such a place exists; conversely, `ILIKE '%pizza%'` would over-match. The current entries are mostly safe (rare collisions), but SPEC must specify exact matching semantics — case-insensitive substring match probably with word-boundary on edges.

---

## 7. Pre-bouncer admission analysis (Phase 2.C)

**Q:** Does any code path between Google Places API response and `place_pool` insert filter on fast food / chains?

**A:** Partial. `seedingCategories.ts` line 60-83 has `BRUNCH_LUNCH_CASUAL_EXCLUDED` containing `'fast_food_restaurant'` — applies ONLY to the `brunch_lunch_casual` SEEDING category's Google Places query. Other seeding categories may not have similar exclusion. Free-tile / discovery / pool-from-search-results paths likely don't filter at all.

**Q:** Where do most fast-food rows enter the pool from?

**A:** Need git-log analysis of seeder code for the seeded_via column — which doesn't exist on `place_pool` per our prior schema check. Without provenance tracking, we can't trace each fast-food row to its admission path. **DISCOVERY for orchestrator:** consider adding a `seeded_via` audit column in a separate ORCH if seeder-side filtering ever needs differential debugging.

---

## 8. Chain-restaurant scope flags (Phase 2.E) — for orchestrator → operator decision

The FAST_FOOD_BLACKLIST has 66 entries. Some operator decisions are needed before SPEC:

### Q-A — Coffee chains (already in FAST_FOOD_BLACKLIST)
Currently in the list: `starbucks`, `dunkin`, `tim horton`, `costa coffee`, `pret a manger`, `greggs`, `krispy kreme`. Mingla's `drinks` signal definition explicitly says "coffee/cafes too" — direct conflict. Operator must clarify:
- (i) Coffee chains stay excluded (from EVERY signal); local independent cafes only.
- (ii) Coffee chains admitted for `drinks`/`icebreakers` only (not for `casual_food`/`brunch`); requires per-signal exclusion logic — more complex.
- (iii) Coffee chains admitted always (remove from blacklist); chain-coffee is fine for date use cases.
**Recommendation:** (i) for Mingla credibility — Starbucks isn't a date destination.

### Q-B — Full-service casual chains NOT in current blacklist
Olive Garden, Applebee's, Cheesecake Factory, Outback Steakhouse, Red Lobster, Buffalo Wild Wings, TGI Fridays, Chili's, Texas Roadhouse, Cracker Barrel, IHOP, Denny's, Waffle House. Currently NOT in FAST_FOOD_BLACKLIST. Operator decision: blanket-exclude or evaluate per chain?
**Recommendation:** add to FAST_FOOD_BLACKLIST OR create a NEW rule_set `CASUAL_CHAIN_BLACKLIST` for differentiation. The CASUAL_CHAIN_DEMOTION (21 entries, scope=upscale_fine_dining) doesn't cover this case — it demotes from `upscale_fine_dining` deck only, not from all decks.

### Q-C — Pizza chains vs local pizzerias
FAST_FOOD_BLACKLIST has `domino's`, `papa john`, `pizza hut`, `little caesar`, `papa murphy`. Local independent pizzerias (`Pizzeria Toro`, `Lilly's Pizza`, etc.) should NOT match. Verify the matching logic doesn't false-positive on substring like `pizza`. SPEC must specify word-boundary or exact-prefix matching.

### Q-D — Regional chain coverage gaps
FAST_FOOD_BLACKLIST has US-centric coverage (Bojangles, Zaxby, Cook Out, Whataburger). Other markets:
- UK: Greggs (in list), Pret (in list), Costa (in list). Missing: Wagamama? Itsu?
- Lagos: in-list shows nothing Nigeria-specific. Operator should review for Lagos chains.
- Brussels: `quick ` (with trailing space — Belgian fast-food chain). Looks correct.
- Paris: missing Flunch, Buffalo Grill (French chains).
**Recommendation:** SPEC includes "operator reviews and adds regional chains" as a dispatch step before rule_set is locked.

### Q-E — Mid-tier chain ambiguity
California Pizza Kitchen, P.F. Chang's, Bonefish Grill, Carrabba's, J. Alexander's, Houston's. Some are arguably date-worthy. Operator decides per-chain OR uses heuristic (price level, atmosphere review patterns).

### Q-F — Coffee chain preserves grocery aisles
Wholesalers like Trader Joe's / Whole Foods / Wegmans have in-store coffee bars — should those count as Starbucks-equivalent? They're within a `grocery_store` primary_type place, not a separate `cafe` listing. Most likely fine — they don't exist as separate `place_pool` rows; B9 child-venue catches them as sub-counters.

---

## 9. Invariant impact

### 9.1 NEW invariant proposal (orchestrator-owned; SPEC author refines)

**`I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS`** — `place_pool.is_servable=true` MUST exclude:
- All rows where `primary_type` is in `FAST_FOOD_PRIMARY_TYPES` (canonical type list including `fast_food_restaurant` plus chain-aligned subtypes per operator decision).
- All rows whose `name` matches the `FAST_FOOD_BLACKLIST` patterns (canonical chain-name list).
- All rows whose `name` matches `CASUAL_CHAIN_BLACKLIST` patterns (if operator approves Q-B).

Exception: rows whose `name` matches `UPSCALE_CHAIN_PROTECTION` (prevents accidental over-rejection for upscale chains intentionally admitted).

CI-gate enforceable via SQL post-bouncer-sweep:
```sql
SELECT COUNT(*) FROM place_pool 
WHERE is_servable=true 
  AND (primary_type IN (...fast_food_types...)
       OR name ILIKE ANY (...patterns...));
-- Expected: 0
```

### 9.2 Preserved invariants

- **`I-BOUNCER-DETERMINISTIC`** (per `bouncer.ts:12`) — "NO AI, NO keyword matching for category judgment. Type lists + data-integrity rules + cluster-aware website/hours requirements." NEW B10/B11 rules MUST preserve this: they're deterministic type-list + name-pattern rules, NOT AI-based. Compatible.
- **`I-TWO-PASS-BOUNCER-RULE-PARITY`** (per `bouncer.ts:15-19`) — pre-photo + final-photo passes share rule body except B8. NEW B10/B11 must be identical across both passes. Trivially compatible (no photo dependency).
- **`I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING`** (DEC-099) — preserved (this fix is upstream of trial; no trial output is consumed).

### 9.3 Const compliance

- **Const #2 (one owner per truth)** — bouncer becomes THE canonical source of `is_servable`. Currently the rules engine has the data but no enforcement; that's a one-owner violation. Fix consolidates ownership.
- **Const #3 (no silent failures)** — B10/B11 rejection emits a named reason (`B10:fast_food_primary_type` / `B11:chain_brand:<pattern>`). Visible to operators in admin.
- **Const #7 (label temporary fixes)** — if rules engine consumer gets wired (Path B per F-2), document any transitional comments.
- **Const #8 (subtract before adding)** — when adding fast-food types to bouncer, also decommission the orphan `BRUNCH_LUNCH_CASUAL_EXCLUDED` partial filter in seedingCategories.ts (it's now redundant).

---

## 10. Fix strategy (direction only — NOT a spec)

Two viable paths. Operator decides at SPEC dispatch time.

### Path A — Code-constant approach (RECOMMENDED for first ship)

**Approach:**
1. Add new `EXCLUDED_FAST_FOOD_TYPES` array to `bouncer.ts` (mirror current FAST_FOOD_BLACKLIST type-grounded entries: `fast_food_restaurant`, plus operator-confirmed subset of `hamburger_restaurant`, `donut_shop`, `sandwich_shop`).
2. Add new `FAST_FOOD_NAME_PATTERNS` array (case-insensitive name pattern list, mirroring current 66 FAST_FOOD_BLACKLIST entries).
3. Add B10 rule: cluster='EXCLUDED_FAST_FOOD' if `types ∩ EXCLUDED_FAST_FOOD_TYPES`.
4. Add B11 rule: name-pattern match; reason `B11:chain_brand:<pattern>`.
5. Add UPSCALE_CHAIN_ALLOWLIST (operator-curated 24 chain names that bypass B11).
6. Re-bounce sweep on existing `place_pool` rows.
7. Tests: `bouncer.test.ts` adds positive + negative fixtures for B10/B11.

**Pros:** Fast to ship (~3-4 hour SPEC + 1 day IMPL); easy to test; preserves I-BOUNCER-DETERMINISTIC; operator-readable in code.
**Cons:** Adding chains requires a code commit + deploy. Operator can't self-serve via admin UI.

### Path B — Wire the rules engine consumer

**Approach:**
1. In `bouncer.ts` (or a new `bouncerRules.ts`), import a runtime loader that fetches `rule_entries` for FAST_FOOD_BLACKLIST + UPSCALE_CHAIN_PROTECTION (via Supabase admin client).
2. Cache rules in-memory per edge function invocation (acceptable; rules change rarely).
3. Apply B10/B11 using the loaded patterns.
4. Decommission the data-without-effect side effect — admin RPCs become live editor for production behavior.

**Pros:** Operator self-serve via admin UI; consistent with original ORCH-0526 design intent; expansion is data-only (no PR).
**Cons:** More code (~2-3 day SPEC + 2-3 day IMPL); needs caching + load timing handling; admin UI may need polish to be operator-trusted; per memory rule `feedback_admin_ui_trust.md` operator already shipped distrust signal.

### Hybrid (defer)

Path A first, Path B in a follow-up ORCH after Path A proves stable. Code-constants are the source of truth for now; rules engine becomes documentation/queue-of-edits for the next consolidation.

**Recommendation: Path A first.** Path B is correct architecture but premature given operator's reservation about admin UI trust. Ship the fix; revisit consolidation later.

---

## 11. Regression prevention

| Class | Safeguard |
|---|---|
| Future code path admits fast food | NEW invariant `I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS` ratified at CLOSE; CI gate via post-bouncer-sweep SQL probe |
| Pattern false-positive (independent pizzeria caught by chain pattern) | Tests asserting `Pizzeria Toro` etc. survive B11 |
| Stale data not re-bounced | SPEC includes mandatory re-bounce sweep step + tester verification "all rows have `bouncer_validated_at >= deploy_date`" |
| Operator adds new chain via admin UI but rule doesn't fire | Path A: doc on the admin UI says "rules engine display-only post-ORCH-0735; edits require code PR." Path B: CI test verifies admin-edit propagates. |
| Photo-rich chains (today: Chick-fil-A) sneak past B8 | B10/B11 now NAMED rules; B8 stays a quality gate but no longer the only fast-food filter |

---

## 12. Discoveries for orchestrator

1. **Rules engine is partially-decommissioned (data without consumer).** 5 active rule_sets / 326 entries / admin RPCs / no production consumer. **Recommendation:** after ORCH-0735 ships Path A, file follow-up ORCH-0736 to either (a) wire consumer (Path B) OR (b) decommission tables + admin UI + admin RPCs (matching the de-facto state). Stranded data is technical debt that confuses future investigations.

2. **No `seeded_via` provenance column on `place_pool`.** Can't trace which seeding category admitted any specific row. Future ORCH may need this for differential audit. Low priority.

3. **Existing FAST_FOOD_BLACKLIST is US-centric.** Operator must review/extend for Lagos / Paris / Brussels markets. SPEC includes operator-review step.

4. **`UPSCALE_CHAIN_PROTECTION` exists in DB (24 entries).** Suggests operator's mental model is more nuanced than "all chains bad." Path A SPEC should extract these and code-constant them in `bouncer.ts` to preserve protection.

5. **`CASUAL_CHAIN_DEMOTION` exists scope=upscale_fine_dining (21 entries).** Behavior: scorer-side demotion within `upscale_fine_dining` only. Out of scope for ORCH-0735 (bouncer fix), but should be noted — operator's three-tier model (fast-food / casual / upscale) is more complete than ORCH-0735 alone solves.

6. **Pizzeria pattern collision risk.** SPEC must carefully test that "Pizza Hut" pattern doesn't match independent pizzerias with "Pizza" in the name. Word-boundary matching recommended.

7. **`bouncer.test.ts` has zero fast-food fixtures.** SPEC must require comprehensive fixture coverage to prevent regression.

8. **DEC-105 reservation.** ORCH-0734 has DEC-105 reserved for `signal_anchors` decommission + `seeding_cities` canonical authority. ORCH-0735 may need DEC-106 (Path A: code-constant fast-food bouncer rules + I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS invariant ratification) at its CLOSE. Track at orchestrator level.

9. **ORCH-0734 CLOSE timing.** Per the OPEN_INVESTIGATIONS entry I added at intake, ORCH-0734 is implementation-verified-pre-CLOSE because closing it with this known production blocker would be irresponsible. Two options at orchestrator's discretion: (a) close ORCH-0734 with explicit known-blocker reference to ORCH-0735 in CLOSE protocol Step 4 + don't ship Phase 1 rerank until ORCH-0735 closes; (b) hold ORCH-0734 until ORCH-0735 closes, then dual-close. Recommend (a) — ORCH-0734 redesign is structurally sound; the bouncer gap is a separate-but-blocking concern for the next cycle.

---

## 13. Confidence level

| Finding | Confidence | Reasoning |
|---|---|---|
| F-1 root cause (stranded rule database) | **H (proven)** | Six-field evidence: code path verified by direct read of bouncer.ts + run-bouncer + grep. Live data confirms admission. Live SQL confirms rule_set populated but unconsumed. Reproducible. |
| F-2 ORCH-0640 / ORCH-0700 removed consumer | **M-H (probable)** | Git log evidence + commit message inference. Would require reading those ORCH closures verbatim to lock — SPEC author can verify. |
| F-3 seeding-category partial filter | **H** | Direct code read of seedingCategories.ts. |
| F-4 B8 incidental catch | **H** | Direct code read + live data showing McDonald's failing B8. |
| F-5 scorer demotion (-40) | **H** | Direct test fixture read. |
| F-6 no fast-food test fixtures | **H** | Direct grep. |
| F-7 blast radius | **H** | Live SQL queries. Numbers are exact. |
| F-8 three-tier design | **H** | Live rule_sets + count of entries. |
| F-9/F-10/F-11 hidden flaws | **M-H** | Inferred from data + code patterns; SPEC author should verify edge cases before locking. |
| Phase 2.E ambiguities (Q-A through Q-F) | **N/A** — operator decisions, not investigator findings | Surfaced for operator steering. |

**Overall:** H confidence on root cause + remediation direction. Operator steering needed on chain-scope boundaries (Q-A through Q-F) before SPEC.

---

**End of investigation. SPEC dispatch deferred until orchestrator surfaces Phase 2.E ambiguities to operator for chain-scope decisions.**
