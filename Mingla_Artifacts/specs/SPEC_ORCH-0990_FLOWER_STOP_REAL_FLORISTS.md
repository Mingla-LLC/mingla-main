# SPEC — ORCH-0990 [Curated-card flower stop shows real florists]

**Author:** mingla-forensics (SPEC mode)
**Date:** 2026-05-29 (PASS-2 revision after orchestrator REVIEW `NEEDS WORK`)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0990-[flower-stop-real-florists]/` on branch `ORCH-0990-flower-stop-real-florists`
**Surface class:** Backend-only (Supabase RPC migration + edge `_shared` TS). **No client code change.** This revision ADDS a required `CREATE OR REPLACE FUNCTION fetch_local_signal_ranked` migration (the PASS-1 "no migration" boundary was proven WRONG — see §2.3 / Defect 1).
**Confidence:** root cause **proven** + the corrected mechanism **proven against live data** (Management API probes, project `gqnoajqerqhnvulmnyvv`, 2026-05-29, read-only).

> **PASS-2 changelog (what this revision changes vs. the `79addb01d` SPEC):**
> 1. Mechanism replaced: `types[] && {florist}` array-overlap → a **composite primary-type-aware gate** (`primary_type='florist' OR (primary_type IN ('grocery_store','supermarket') AND 'florist'=ANY(types))`). Proven necessary because Google over-applies the secondary `florist` tag in `types[]` to non-florists in Lagos.
> 2. A `fetch_local_signal_ranked` migration is now REQUIRED (the RPC cannot express the composite on the `types[]`-only clause). New optional params, existing callers unaffected.
> 3. `COMBO_SLUG_FILTER_MIN.flowers` set to **0** (order-only), not 40 — a 40 floor drops real Lagos florists scoring 33 and 0.
> 4. Per-city coverage recomputed with the composite gate (§5).
> 5. Strict-grep gate + Step-0.5 fails-on-revert test + `I-PROPOSED-FLOWER-STOP-FLORIST-VERIFIED` invariant rewritten to assert the COMPOSITE gate and fail on a revert to admitting `service`/`general_contractor` primary types.

---

## 0. Comms Ledger acknowledgements (read on entry 2026-05-29)

- **COMMS-0002 (WARN, ALL)** — ORCH-0863 strict-grep gate blocks PRs adding/touching `supabase/functions/*` OR `supabase/migrations/*` unless allowlisted. **Acknowledged + factored**: this revision now ships a NEW migration (`fetch_local_signal_ranked` re-create) AND edits `_shared/signalRankFetch.ts` AND adds a NEW Deno test file under `supabase/functions/_shared/`. **All three** MUST be added to a new `ORCH_0990_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` and spread into the `ALLOWLIST` union **in the same commit** (§10). The new strict-grep gate file lives under `.github/scripts/strict-grep/` (not `supabase/`) so it is not itself subject to C7.
- **COMMS-0003 (WARN, ALL)** — external-API params must cite provider docs URLs inline at SPEC. **Acknowledged + satisfied**: no new external API call is introduced. We read already-persisted Google Places fields (`place_pool.types`, `place_pool.primary_type`). Every `types[]` / `primaryType` / `florist` claim cites the Google Places v1 docs inline (§4.1).
- **COMMS-0004 (WARN, ALL)** — INTAKE ID-collision scan. **N/A** — this is SPEC, not INTAKE; ORCH-0990 already spawned.

---

## 1. Symptom (operator-reported 2026-05-29)

On curated experience cards, the "Flowers" stop ("pick up flowers") surfaces places where you **cannot actually buy a bouquet**. Flagged in **Lagos, Nigeria** and **Raleigh, NC**. The operator's bar: **100% of flower stops must resolve to a place that actually sells bouquets** — a real florist OR a grocery/supermarket with a verified floral department — or the stop must be honestly omitted.

---

## 2. Root cause — PROVEN (corrected mechanism)

Three layers, all verified against live DB (project `gqnoajqerqhnvulmnyvv`, 2026-05-29, read-only) + the latest migration + the persisted Google fields.

### 🔴 RC-1 — No serve-time type-gate for `flowers` (the direct cause)

| Field | Evidence |
|---|---|
| **File + line** | `supabase/functions/_shared/signalRankFetch.ts:105-108` (`COMBO_SLUG_TYPE_FILTER`) |
| **Exact code** | `export const COMBO_SLUG_TYPE_FILTER: Record<string, string[]> = { hiking: [...], museum: ['museum','art_museum'], };` — **no `flowers` entry.** |
| **What it does** | `generate-curated-experiences/index.ts:689` reads `COMBO_SLUG_TYPE_FILTER['flowers']` → `undefined` → `requiredTypes: undefined` into `fetchSinglesForSignalRank` (signalRankFetch.ts:240 sends `p_required_types: requiredTypes ?? null`). The RPC `fetch_local_signal_ranked` (baseline `20260505000000_baseline_squash_orch_0729.sql:4727`) evaluates `(p_required_types IS NULL OR pp.types && p_required_types)` → left side TRUE → the type clause passes unconditionally. ANY place with a `flowers` score ≥ `COMBO_SLUG_FILTER_MIN.flowers` (80) in the bbox is eligible, florist or not. |
| **What it should do** | A flower stop MUST gate on the **composite primary-type-aware predicate** in RC-3 — NOT on a `types[]`-only overlap (see RC-2). |
| **Causal chain** | symptom (non-florist at flower stop) ← card from `fetchForCombo('flowers')` ← RPC returned a high-popularity non-florist ← `p_required_types` was NULL ← `COMBO_SLUG_TYPE_FILTER` has no `flowers` key ← never added when `flowers` was introduced. |
| **Verification** | Live DB, Lagos: "Rukkies Decor" (`primary_type=general_contractor`) scores 99.5 on `flowers` and is serve-eligible today purely because the type clause is a no-op. |

### 🔴 RC-2 — Google over-applies the secondary `florist` tag in `types[]`, so a `types[]`-only gate re-admits noise (why the PASS-1 mechanism was wrong)

| Field | Evidence |
|---|---|
| **Column** | `place_pool.types text[]` (secondary tag set) vs `place_pool.primary_type text` (single canonical type). |
| **What it does** | In Lagos, Google attaches the secondary `florist` tag in `types[]` to businesses whose **primary_type is NOT florist** — event planners, decorators, contractors. A `pp.types && ARRAY['florist']` overlap therefore admits them. |
| **What it should do** | Eligibility must key off `primary_type` (the clean discriminator), with one explicit carve-out for verified-floral groceries (RC-3). |
| **Verification (live, Lagos `city_id=287cab01-…`, all `'florist'=ANY(types)` rows with a `flowers` score)** | <table><tr><th>name</th><th>primary_type</th><th>flowers score</th><th>composite admits?</th></tr><tr><td>Regal Flowers Lekki Branch</td><td>florist</td><td>143.85</td><td>✅</td></tr><tr><td>BusyBee Events LAGOS (event planner)</td><td>service</td><td>104.29</td><td>❌</td></tr><tr><td>Rukkies Decor Victoria Island</td><td>general_contractor</td><td>99.52</td><td>❌</td></tr><tr><td>LEE signTEC EMPIRE</td><td>service</td><td>98.01</td><td>❌</td></tr><tr><td>FRESH FLOWERS BY OLIVE DESIGNS</td><td>florist</td><td>32.72</td><td>✅</td></tr><tr><td>Sparkle Gardens</td><td>florist</td><td>0</td><td>✅</td></tr><tr><td>Just Weddings / JW Events NG</td><td>null</td><td>22.46</td><td>❌</td></tr><tr><td>Ottama Interiors</td><td>service</td><td>0</td><td>❌</td></tr></table> The PASS-1 gate (`types[] && {florist}` + floor 40) would have returned **Regal (144, real) + BusyBee (104) + Rukkies (99.5) + LEE signTEC (98)** = 1 real florist + 3 non-bouquet businesses — **the exact reported bug, unfixed.** |

### 🔴 RC-3 — `primary_type='florist'` ALONE excludes the verified-floral groceries the operator chose IN (why the composite is required)

| Field | Evidence |
|---|---|
| **Operator scope (LOCKED 2026-05-29)** | eligibility = **florist OR verified-floral grocery**. |
| **What primary-only does** | Raleigh has **ZERO** `primary_type='florist'` servable places. ALL its bouquet availability is Harris Teeter `primary_type='grocery_store'` carrying the `florist` tag in `types[]` (floral department). A `primary_type='florist'`-only gate would make Raleigh — an operator-flagged city — go honest-empty despite 13 real floral-dept groceries. |
| **What it should do** | Admit `primary_type='florist'` PLUS the carve-out `primary_type IN ('grocery_store','supermarket') AND 'florist'=ANY(types)`. The grocery carve-out is narrow (must ALSO carry the `florist` tag = Google-verified floral dept), so it does not re-open the RC-2 noise (event planners/contractors are never `grocery_store`/`supermarket`). |
| **Verification (live)** | Raleigh composite gate → 1 `florist`-primary + 13 grocery-floral = 14 fillable, 0 noise; Lagos composite gate → 3 `florist`-primary + 0 grocery-floral = 3 fillable, 0 noise (§5). |

### 🔴 RC-4 — the popularity-weighted `flowers` score must NOT be the eligibility decider (why the floor must be 0, not 40)

| Field | Evidence |
|---|---|
| **File + config** | `signal_definition_versions.config` for signal `flowers` (version `477e8a05-d401-4b86-af43-eace3fe087d5`, confirmed live `is_active=true`), consumed by `_shared/signalScorer.ts computeScore`. Rating ≤35 + reviews-log ≤25 + text-pattern ≤85 dominate over `types_includes_florist:+60`. |
| **What it does** | Real boutique florists score LOW. Live Lagos: **FRESH FLOWERS BY OLIVE DESIGNS = 32.72**, **Sparkle Gardens = 0** — both genuine `primary_type='florist'` shops. A floor of 40 (the PASS-1 proposal) drops BOTH. |
| **What it should do** | Once the composite type-gate (RC-3) is the **hard guarantee of bouquet availability**, the popularity score must only **ORDER** results, never **DROP** a verified florist. So `COMBO_SLUG_FILTER_MIN.flowers = 0`. |
| **Verification (live)** | With floor=0 + composite gate, every composite-fillable place already has a `flowers` score row (§5: scored counts == no-score-gate counts in all 9 covered cities), so floor=0 admits exactly the composite set and orders it by score DESC. Floor=40 would silently drop Lagos's 2 lowest real florists. |

**Conclusion (formalized):** RC-1 is the direct cause; RC-2 + RC-3 prove the gate must be the **composite primary-type-aware predicate** (not `types[]`-only, not `primary_type='florist'`-only); RC-4 proves the score floor must be **0**. The composite predicate **cannot** be expressed by the current RPC's single `pp.types && p_required_types` clause → a `fetch_local_signal_ranked` migration is **required** (§8.2). No client change.

---

## 3. Five-layer cross-check

| Layer | Finding |
|---|---|
| **Docs** | Google Places v1: `types[]` is "a set of type tags for this result" (multiple, includes loose secondary tags); `primaryType` is "the primary type… A place can only have a single primary type" and "when a primary type is present, it is always one of the types in the `types` field." `florist`, `grocery_store`, `supermarket` are Table-A types (§4.1 URLs). The secondary-vs-primary distinction is exactly why `primary_type` is the clean discriminator. |
| **Schema** | `place_pool.types text[]`, `place_pool.primary_type text`, `place_scores(place_id, signal_id, score)`. RPC latest def `20260505000000_baseline_squash_orch_0729.sql:4708-4730` (grep-all confirmed no later migration supersedes it; latest migration on disk is `20260731000000_orch_0964_…`, unrelated). |
| **Code** | `COMBO_SLUG_TYPE_FILTER` lacks `flowers`; the comment at signalRankFetch.ts:110-113 *claims* it keeps Harris-Teeter florist tags + filters noise — never wired. RPC clause is `types[]`-only and cannot express the composite. |
| **Runtime** | RPC returns non-florists for `flowers` because the type clause is NULL-bypassed; even a naïve `types[]={florist}` fix would still return Lagos event-planners/contractors (RC-2). |
| **Data** | Live Lagos proves `florist` is over-applied as a secondary tag to `service`/`general_contractor` primaries; `primary_type` cleanly separates the 3 real florists from the 4+ noise rows (RC-2 table). |

**Layer disagreement = the bug:** Docs say `primaryType` is the canonical single type; Code gates on the loose `types[]` set (or nothing); Runtime serves non-florists.

---

## 4. The gate — DECISION

**Operator scope (LOCKED 2026-05-29):** eligibility = **florist OR verified-floral grocery**.

### 4.1 The composite gate — 🔒 LOCKED

```
primary_type = 'florist'
  OR (primary_type IN ('grocery_store','supermarket') AND 'florist' = ANY(types))
```

**Google Places v1 docs (inline citations, COMMS-0003):**
- `types[]`: *"A set of type tags for this result."* — https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places (Place resource → `types[]`).
- `primaryType`: *"The primary type of the given result… A place can only have a single primary type"* and *"when a primary type is present, it is always one of the types in the `types` field."* — same reference.
- `florist`, `grocery_store`, `supermarket` are valid Table-A types — https://developers.google.com/maps/documentation/places/web-service/place-types (`florist` under Services; `grocery_store`/`supermarket` under Shopping).

**Why this is the honest gate:**
- `primary_type='florist'` = a business Google classifies *primarily* as a florist → guaranteed bouquet availability. Excludes the RC-2 noise (event planners, decorators, contractors carry `florist` only as a loose secondary tag, never as `primary_type`).
- The grocery carve-out (`primary_type IN ('grocery_store','supermarket') AND 'florist'=ANY(types)`) admits exactly the operator's "verified-floral grocery": a grocery/supermarket that Google *also* tags `florist` = it operates a floral department. A grocery WITHOUT a floral dept lacks the tag → excluded. Event planners/contractors are never `grocery_store`/`supermarket` → the carve-out cannot re-admit them.

**Null-safety:** rows with `primary_type IS NULL` (e.g. Lagos "Ottama Interiors", "Just Weddings") evaluate both branches to NULL/false → correctly excluded.

### 4.2 Rejected alternatives 🔵
- **`types[] && {florist}` (PASS-1 proposal)** — REJECTED (RC-2: re-admits Lagos event-planners/contractors). This is the defect being fixed.
- **`primary_type='florist'` alone** — REJECTED (RC-3: zeroes out Raleigh's 13 floral-dept groceries; operator chose them IN).
- **Text-pattern (reviews mention "flowers/bouquet")** — REJECTED as a gate (source of false positives); RETAINED only as a `flowers`-signal scorer input → it nudges *ranking*, never *eligibility*.

### 4.3 `seedingCategories.ts` / `categoryPlaceTypes.ts` — CONFIRMED CONSISTENT; not the serve gate 🔵
`seedingCategories.ts` Flowers seeding config (`includedTypes: ['florist','grocery_store','supermarket']`) governs SEEDING (Google Nearby Search to populate `place_pool`), not serving. The serve-time composite gate is *stricter* (a grocery only qualifies at serve time if it has the `florist` tag = verified floral dept). **No change to these files.**

### 4.4 Fallback
The composite gate is the only gate. If a city has no florist-primary and no verified-floral grocery, the stop goes honest-empty (it is `optional:true, dismissible:true`). No softer fallback — any softer signal re-admits non-florists, and the operator's 100% honesty bar dominates coverage.

---

## 5. Per-city coverage — RECOMPUTED with the COMPOSITE gate (live, all 17 served cities, 2026-05-29, read-only)

**Method:** `place_pool` filtered `is_active=true AND is_servable=true`, the real `stored_photo_urls` photo gate (G3) applied (drops null/empty/`__backfill_failed__`), scoped per city via `place_pool.city_id` joined to `seeding_cities (status='seeded')`. "Composite-fillable" = rows satisfying the §4.1 composite gate. Floor=0 → every composite-fillable row that has a `flowers` score row is serve-eligible; verified that the score-row-required count EQUALS the no-score-gate count in every covered city (so floor=0 admits the full composite set and merely orders it).

| City | `primary_type='florist'` | grocery/supermarket + `florist` tag | **Composite-fillable** | `types[]`-only noise the composite EXCLUDES |
|---|---|---|---|---|
| Washington | 1 | 27 | **28** | 1 |
| Raleigh ⚑ | 1 | 13 | **14** | 5 |
| Cary | 0 | 11 | **11** | 0 |
| Durham | 0 | 10 | **10** | 0 |
| Brussels | 1 | 5 | **6** | 0 |
| Baltimore | 0 | 6 | **6** | 0 |
| Lagos ⚑ | 3 | 0 | **3** | 4 |
| Fort Lauderdale | 1 | 0 | **1** | 0 |
| London | 1 | 0 | **1** | 7 |
| **Barcelona** | 0 | 0 | **0 — honest-empty** | 0 |
| **Berlin** | 0 | 0 | **0 — honest-empty** | 0 |
| **Chicago** | 0 | 0 | **0 — honest-empty** | 0 |
| **Dallas** | 0 | 0 | **0 — honest-empty** | 0 |
| **Miami** | 0 | 0 | **0 — honest-empty** | 0 |
| **New York** | 0 | 0 | **0 — honest-empty** | 0 |
| **Paris** | 0 | 0 | **0 — honest-empty** | 0 |
| **Toronto** | 0 | 0 | **0 — honest-empty** | 0 |

⚑ = operator-flagged city.

**Findings:**
1. **9 of 17 cities are covered** under the composite gate. **Both flagged cities are covered**: Lagos = 3 real florists (zero noise); Raleigh = 14 (1 florist + 13 floral-dept Harris Teeters, zero noise).
2. **8 cities are genuinely empty** (Barcelona, Berlin, Chicago, Dallas, Miami, New York, Paris, Toronto) → flower stop honestly omitted. **No city flips empty→covered or covered→empty vs. the PASS-1 table** — the composite gate produces the same covered/empty *partition*, but the *counts inside covered cities are now correct* (PASS-1's `types[]`-only counts were inflated by the noise the composite excludes: Raleigh −5, London −7, Lagos −4, Washington −1).
3. **The composite gate removes real noise** (rightmost column): without it, Lagos would serve 4 non-florists, London 7, Raleigh 5. These are exactly the businesses Google mis-tags with a secondary `florist`.
4. **Honest-empty is correct + safe:** the flower stop is `optional:true, dismissible:true` in all three experience types that use it (§6). The RPC's INNER JOINs return `[]`; `fetchForCombo` returns `[]`; the generator skips the optional stop (`generate-curated-experiences/index.ts` `if (available.length === 0 && stopDef.optional) continue;`). Card still builds. No crash, no non-florist substitution.

**Conclusion:** composite gate + floor 0 serves every verified-bouquet place in every city that has one and yields honest-empty in the 8 with none. **100% honesty bar met.** (D-1: the 8 empty cities are a SEEDING coverage gap, not this ORCH — register a seeding ORCH if the operator wants flower stops live there.)

---

## 6. Call chain (exact current line numbers, this worktree)

```
generate-curated-experiences/index.ts
  EXPERIENCE_TYPES:
    first-date  → stops[0] {role:'Flowers', optional:true, dismissible:true}; combos start 'flowers'
    romantic    → stops[0] {role:'Flowers', optional:true, dismissible:true}; combos 'flowers'
    picnic-dates→ stops[1] {role:'Flowers', optional:true, dismissible:true}; combo ['groceries','flowers','nature']
  → generateCardsForType()
    → fetchForCombo('flowers')  [index.ts:682]:
        filterSignal = COMBO_SLUG_TO_FILTER_SIGNAL['flowers'] = 'flowers'
        typeFilter   = COMBO_SLUG_TYPE_FILTER['flowers']      = undefined  ← RC-1 (index.ts:689)
        filterMin    = COMBO_SLUG_FILTER_MIN['flowers'] ?? 120 = 80         ← RC-4 (index.ts:690)
      → fetchSinglesForSignalRank(supabaseAdmin, { …, requiredTypes: typeFilter }) [index.ts:694]
        → RPC fetch_local_signal_ranked(p_required_types := null, …)
           clause: (p_required_types IS NULL OR pp.types && p_required_types) → NULL bypass ← RC-1 lands here
           (baseline_squash_orch_0729.sql:4727)

ALSO (same resolvers, swap flow):
replace-curated-stop/index.ts → _shared/stopAlternatives.ts:109-134
    filterMin    = resolveFilterMin('flowers')   = 80
    requiredTypes= resolveTypeFilter('flowers')  = undefined
  → fetchSinglesForSignalRank(… requiredTypes) [stopAlternatives.ts:125]
```

**Single-point fix surface:** both flows resolve through `COMBO_SLUG_TYPE_FILTER` + `COMBO_SLUG_FILTER_MIN` + `fetchSinglesForSignalRank` in `signalRankFetch.ts`, which calls the RPC. The fix = (a) new composite params in the RPC, (b) thread them through `SignalRankParams`/`fetchSinglesForSignalRank`, (c) populate them for `flowers` via a resolver, (d) floor 0. Both flows inherit it (Constitution #13 — generation and serving use the same gate).

---

## 7. Fix decision

- (i) `types[] && {florist}` gate + floor 40 — **REJECTED** (RC-2: re-admits Lagos noise; RC-4: drops real florists).
- (ii) **composite primary-type-aware gate (RPC migration) + floor 0** — **CHOSEN.** Honesty enforced by the composite type-gate; score orders only.
- (iii) re-score / data backfill (§8.4) — **OUT of scope** (not needed to meet the bar).

---

## 8. Change contract — layer by layer

### 8.1 DB / RPC migration — 🔒 LOCKED (NEW — this is the corrected boundary)

**New migration file:** `supabase/migrations/20260801000000_orch_0990_fetch_local_signal_ranked_primary_type_gate.sql`
(timestamp strictly greater than the latest on disk `20260731000000_orch_0964_…`; implementor MUST re-confirm at implement time that no newer migration landed and bump if needed — safe-migration protocol §8.5.)

**Current RPC definition being replaced (verbatim, this worktree, `20260505000000_baseline_squash_orch_0729.sql:4708-4730`):**
```sql
CREATE OR REPLACE FUNCTION "public"."fetch_local_signal_ranked"(
  "p_filter_signal" "text", "p_filter_min" numeric, "p_rank_signal" "text",
  "p_lat_min" numeric, "p_lat_max" numeric, "p_lng_min" numeric, "p_lng_max" numeric,
  "p_required_types" "text"[] DEFAULT NULL::"text"[], "p_limit" integer DEFAULT 100)
  RETURNS TABLE("place_id" "uuid", "rank_score" numeric)
  LANGUAGE "sql" STABLE SECURITY DEFINER SET "search_path" TO 'public'
  AS $$
  SELECT ps_rank.place_id, ps_rank.score AS rank_score
  FROM place_pool pp
  INNER JOIN place_scores ps_filter ON ps_filter.place_id = pp.id AND ps_filter.signal_id = p_filter_signal AND ps_filter.score >= p_filter_min
  INNER JOIN place_scores ps_rank   ON ps_rank.place_id   = pp.id AND ps_rank.signal_id   = p_rank_signal
  WHERE pp.is_active = true AND pp.is_servable = true
    AND pp.lat BETWEEN p_lat_min AND p_lat_max
    AND pp.lng BETWEEN p_lng_min AND p_lng_max
    AND (p_required_types IS NULL OR pp.types && p_required_types)
  ORDER BY ps_rank.score DESC
  LIMIT p_limit;
$$;
```

**Chosen new signature (least-invasive, non-regressing):** add TWO new trailing optional parameters AFTER `p_required_types`, BEFORE `p_limit` is impossible (Postgres positional defaults), so they go AFTER `p_limit` with their own defaults. To avoid reordering existing named-arg callers, append both at the end:

```sql
CREATE OR REPLACE FUNCTION "public"."fetch_local_signal_ranked"(
  "p_filter_signal" "text", "p_filter_min" numeric, "p_rank_signal" "text",
  "p_lat_min" numeric, "p_lat_max" numeric, "p_lng_min" numeric, "p_lng_max" numeric,
  "p_required_types" "text"[] DEFAULT NULL::"text"[],
  "p_limit" integer DEFAULT 100,
  "p_primary_type_required" "text"[] DEFAULT NULL::"text"[],
  "p_grocery_floral_tag" boolean DEFAULT false)
  RETURNS TABLE("place_id" "uuid", "rank_score" numeric)
  LANGUAGE "sql" STABLE SECURITY DEFINER SET "search_path" TO 'public'
  AS $$
  SELECT ps_rank.place_id, ps_rank.score AS rank_score
  FROM place_pool pp
  INNER JOIN place_scores ps_filter ON ps_filter.place_id = pp.id AND ps_filter.signal_id = p_filter_signal AND ps_filter.score >= p_filter_min
  INNER JOIN place_scores ps_rank   ON ps_rank.place_id   = pp.id AND ps_rank.signal_id   = p_rank_signal
  WHERE pp.is_active = true AND pp.is_servable = true
    AND pp.lat BETWEEN p_lat_min AND p_lat_max
    AND pp.lng BETWEEN p_lng_min AND p_lng_max
    -- Existing secondary-tag overlap path. UNCHANGED for all current callers
    -- (hiking, museum). When p_required_types IS NULL this is a no-op (TRUE).
    AND (p_required_types IS NULL OR pp.types && p_required_types)
    -- ORCH-0990: composite primary-type-aware gate. When p_primary_type_required
    -- IS NULL AND p_grocery_floral_tag = false this is a no-op (TRUE) → EVERY
    -- existing caller (which passes neither) is byte-for-byte unaffected.
    -- For flowers: p_primary_type_required := ARRAY['florist'],
    --              p_grocery_floral_tag    := true
    --   → admits primary_type='florist'
    --      OR (primary_type IN ('grocery_store','supermarket') AND 'florist'=ANY(types))
    AND (
      (p_primary_type_required IS NULL AND p_grocery_floral_tag = false)
      OR (p_primary_type_required IS NOT NULL AND pp.primary_type = ANY(p_primary_type_required))
      OR (p_grocery_floral_tag = true
          AND pp.primary_type = ANY(ARRAY['grocery_store','supermarket'])
          AND pp.types && ARRAY['florist'])
    )
  ORDER BY ps_rank.score DESC
  LIMIT p_limit;
$$;
```

Plus re-issue the existing `ALTER FUNCTION … OWNER TO "postgres";`, the 3 `GRANT ALL … TO anon/authenticated/service_role;`, and a refreshed `COMMENT ON FUNCTION … IS 'ORCH-0653 v3.2 + ORCH-0990: …composite primary-type gate (p_primary_type_required + p_grocery_floral_tag) for the flowers stop; existing types-overlap path unchanged.';` — **all keyed to the NEW full argument list** (the GRANTs/OWNER/COMMENT are signature-specific in Postgres; the old-signature grants remain on the old overload only if a stale overload survives — see §8.5 drop-old-overload note).

**Why this signature does NOT regress hiking/museum/all other callers (🔒 proof):**
- Every current caller passes only `p_required_types` (or nothing) — `generate-curated-experiences` and `stopAlternatives` invoke the RPC by NAMED args (`supabaseAdmin.rpc('fetch_local_signal_ranked', { p_filter_signal, …, p_required_types, p_limit })`) and **never name** `p_primary_type_required` or `p_grocery_floral_tag`.
- Both new params **default** (`NULL`, `false`). With those defaults, the new WHERE clause reduces to `(NULL IS NULL AND false = false) → TRUE` → an unconditional pass → **identical row set** to the pre-migration RPC for hiking, museum, and every non-flowers signal.
- The existing `p_required_types` overlap clause is **untouched** — hiking still narrows by `['hiking_area',…]`, museum by `['museum','art_museum']`, exactly as today.
- Result: only the `flowers` caller (which will newly pass the two params) changes behavior; all other callers are bit-identical. (T-09 asserts this.)

**Safe-migration protocol (§8.5):**
- `CREATE OR REPLACE FUNCTION` with a **changed argument list creates a NEW overload**; the old 9-arg overload would survive. To avoid an ambiguous-overload hazard, the migration MUST first `DROP FUNCTION IF EXISTS public.fetch_local_signal_ranked(text,numeric,text,numeric,numeric,numeric,numeric,text[],integer);` (the exact old signature) THEN `CREATE OR REPLACE` the new 11-arg version, THEN re-issue OWNER/GRANT/COMMENT. Document this ordering inline. This is forward-only and idempotent (the `IF EXISTS` guards re-runs).
- The RPC is `STABLE SECURITY DEFINER` read-only (SELECT only) — no data mutation, no lock risk, instant deploy.
- Operator applies via `supabase db push` at CLOSE (per autonomy posture: safe read-only migration, orchestrator may push; but this is operator's call at CLOSE). Edge functions re-deploy after (their bundled `_shared/signalRankFetch.ts` changed): `generate-curated-experiences` + `replace-curated-stop`.

### 8.2 `supabase/functions/_shared/signalRankFetch.ts` — 🔒 LOCKED

**Change A — add the composite gate resolver + maps.** Replace the `COMBO_SLUG_TYPE_FILTER` block (lines 105-108) region with the existing entries PLUS a new flowers-specific composite descriptor. Do NOT add `flowers` to `COMBO_SLUG_TYPE_FILTER` (that map drives the `types[]`-overlap param, which is the wrong mechanism). Instead add a new map for the primary-type gate:

```ts
// ORCH-0601 — Slugs that narrow a filter signal to a sub-category via the
// secondary types[] overlap (p_required_types). UNCHANGED by ORCH-0990.
export const COMBO_SLUG_TYPE_FILTER: Record<string, string[]> = {
  hiking: ['hiking_area', 'state_park', 'nature_preserve', 'national_park', 'wildlife_refuge', 'scenic_spot'],
  museum: ['museum', 'art_museum'],
};

// ORCH-0990 — Slugs that gate on the canonical primary_type (NOT the loose
// secondary types[] set). Google over-applies the secondary `florist` tag in
// types[] to event planners / decorators / contractors in some markets (proven
// in Lagos), so a types[]-overlap gate re-admits non-bouquet businesses. The
// clean discriminator is primary_type. `groceryFloralTag` additionally admits a
// grocery/supermarket that ALSO carries the `florist` tag (a verified floral
// department, e.g. Harris Teeter) — the operator's "verified-floral grocery".
// Google Places v1: primaryType is a single canonical type; types[] is a loose
// tag set. https://developers.google.com/maps/documentation/places/web-service/place-types
export interface PrimaryTypeGate { primaryTypes: string[]; groceryFloralTag: boolean; }
export const COMBO_SLUG_PRIMARY_TYPE_GATE: Record<string, PrimaryTypeGate> = {
  flowers: { primaryTypes: ['florist'], groceryFloralTag: true },
};
```

Add a resolver mirroring `resolveTypeFilter`:
```ts
/**
 * ORCH-0990: resolve the primary-type composite gate for a slug, or undefined.
 * Flowers gates on primary_type='florist' OR grocery/supermarket+florist-tag.
 */
export function resolvePrimaryTypeGate(comboSlug: string): PrimaryTypeGate | undefined {
  return COMBO_SLUG_PRIMARY_TYPE_GATE[comboSlug];
}
```

**Change B — extend `SignalRankParams` + thread the params into the RPC call.** Add to the interface (after `requiredTypes`):
```ts
  primaryTypeRequired?: string[]; // ORCH-0990: composite primary-type gate (flowers)
  groceryFloralTag?: boolean;     // ORCH-0990: also admit grocery/supermarket + florist tag
```
In `fetchSinglesForSignalRank`, destructure both and pass them to the RPC (alongside the existing args):
```ts
      p_primary_type_required: primaryTypeRequired ?? null,
      p_grocery_floral_tag: groceryFloralTag ?? false,
```
(Existing `p_required_types: requiredTypes ?? null` line stays — for flowers it resolves to `null`, so the types-overlap path is the no-op TRUE and only the new composite clause gates.)

**Change C — set the floor to 0 + rewrite the stale comment** (lines 110-117):
```ts
// Per-stop filter_min override. Most signals use 120; movies is 80 (tiny universe).
// ORCH-0990: flowers is 0 (was 80). Honesty for flowers is enforced ENTIRELY by
// the COMBO_SLUG_PRIMARY_TYPE_GATE['flowers'] composite primary-type gate
// (primary_type='florist' OR grocery/supermarket+florist-tag), NOT by the score
// threshold. The flowers signal is rating/review-popularity weighted, so genuine
// boutique florists score 0-39 (e.g. Lagos "FRESH FLOWERS BY OLIVE DESIGNS" 33,
// "Sparkle Gardens" 0) and would be wrongly dropped by ANY positive floor. With
// the type-gate as the hard bouquet guarantee, the score must only ORDER results,
// never drop a verified florist → floor 0.
export const COMBO_SLUG_FILTER_MIN: Record<string, number> = {
  'movies': 80,
  'flowers': 0,
};
```
`resolveFilterMin` already returns the map value (`?? 120`) — flowers now returns 0.

**No other edit to this file.**

### 8.3 Edge function call sites — 🔒 LOCKED (thread the resolver; NO logic change)

- `generate-curated-experiences/index.ts` `fetchForCombo` (line ~682): import `resolvePrimaryTypeGate`, resolve it for `catId`, and pass `primaryTypeRequired: gate?.primaryTypes` + `groceryFloralTag: gate?.groceryFloralTag` into the `fetchSinglesForSignalRank` params object. (One resolver call + two new param lines.)
- `_shared/stopAlternatives.ts` (line ~115): identically resolve `resolvePrimaryTypeGate(categoryId)` and pass both params into its `fetchSinglesForSignalRank` call, so the swap flow inherits the same gate.

These two call-site edits are the ONLY edge-function-code changes. They are mechanical param threading (no branching). The functions re-deploy at CLOSE because `_shared/signalRankFetch.ts` changed.

> **Scope note:** §8.3 edits two edge `index.ts`/`_shared` files (param threading) — this is unavoidable because the resolver output must reach the RPC. This is still "no CLIENT code change" (no `app-mobile/`, no `mingla-business/`, no `mingla-admin/`). Both touched files go in the backend allowlist (§10).

### 8.4 🎨 OPEN follow-on — OUT of scope
A `flowers`-signal re-score (raise `types_includes_florist` weight) is a DATA op, **not** in ORCH-0990. The composite gate + floor 0 meets the bar without it. Do NOT ship unless the operator explicitly asks.

---

## 9. Regression prevention — strict-grep gate 🔒 LOCKED

**New file:** `.github/scripts/strict-grep/orch-0990-flower-stop-florist-gate.mjs`

Asserts, on `supabase/functions/_shared/signalRankFetch.ts`:
1. `COMBO_SLUG_PRIMARY_TYPE_GATE` exists and its `flowers` entry has `primaryTypes` including `'florist'` AND `groceryFloralTag: true`. (Fail if missing → catches a revert of Change A.)
2. `flowers` is NOT present in `COMBO_SLUG_TYPE_FILTER` (catches an accidental re-introduction of the rejected `types[]`-only mechanism, which would re-admit RC-2 noise).
3. `COMBO_SLUG_FILTER_MIN.flowers` is present and `=== 0` (catches a silent bump that would drop real florists).

Asserts, on the migration `supabase/migrations/20260801000000_orch_0990_*.sql`:
4. The new RPC body contains the composite predicate signature `p_primary_type_required` AND `p_grocery_floral_tag` AND the literal `'grocery_store'`/`'supermarket'` + `ARRAY['florist']` carve-out (catches a revert to the `types[]`-only RPC that would re-admit `service`/`general_contractor` primaries).

Exit 1 on any violation (model on `orch-0965-home-uses-upcoming-hook.mjs`). Register as a job in the same workflow that runs the other backend `_shared` strict-grep gates.

**Regression test (Deno):** `supabase/functions/_shared/signalRankFetch.flowers.test.ts` (new) — T-02 / T-06 / T-07 / T-09 below (pure assertions on the exported maps + resolver; no DB).

---

## 10. Invariant + backend allowlist 🔒 LOCKED

Add to `Mingla_Artifacts/INVARIANT_REGISTRY.md` (status DRAFT → ACTIVE on ORCH-0990 CLOSE):

> ### I-PROPOSED-FLOWER-STOP-FLORIST-VERIFIED
> **Rule:** A curated "Flowers" stop NEVER resolves to a place that is not a verified bouquet source. The ONLY serve-time gate for the `flowers` combo slug is the **composite primary-type gate** `COMBO_SLUG_PRIMARY_TYPE_GATE['flowers'] = { primaryTypes: ['florist'], groceryFloralTag: true }`, evaluated server-side in `fetch_local_signal_ranked` as `primary_type='florist' OR (primary_type IN ('grocery_store','supermarket') AND 'florist'=ANY(types))`. The gate MUST key off the canonical `primary_type` (NOT the loose secondary `types[]` set — Google over-applies the `florist` tag to `service`/`general_contractor`/event-planner primaries, proven in Lagos 2026-05-29). The popularity-weighted `flowers` score MUST NOT be the eligibility decider: `COMBO_SLUG_FILTER_MIN['flowers'] === 0`, so the score only ORDERS results and never drops a verified florist (real Lagos florists score 33 and 0). If no place satisfies the composite gate in range, the flower stop is OMITTED (`optional:true, dismissible:true`) — never substituted with a non-florist.
> **Forbidden reverts (gate FAILS the build if any occur):** (a) adding `flowers` to `COMBO_SLUG_TYPE_FILTER` (re-introduces the `types[]`-only mechanism → re-admits noise); (b) `COMBO_SLUG_FILTER_MIN.flowers` ≠ 0; (c) an RPC that admits flowers rows on a `types[]`-overlap alone without the `primary_type` check.
> **Applies to:** `generate-curated-experiences` (curated cards) + `replace-curated-stop` (stop swap), both via `_shared/signalRankFetch.ts` + `_shared/stopAlternatives.ts` + the `fetch_local_signal_ranked` RPC.
> **Enforcement:** strict-grep gate `orch-0990-flower-stop-florist-gate.mjs` + Deno test `signalRankFetch.flowers.test.ts` + live RPC probe (T-03/T-04/T-08).

**Backend allowlist (COMMS-0002):** in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`, add (same commit as gate/migration/edits) and spread into the `ALLOWLIST` union:
```js
const ORCH_0990_BACKEND_ALLOWLIST = [
  'supabase/migrations/20260801000000_orch_0990_fetch_local_signal_ranked_primary_type_gate.sql',
  'supabase/functions/_shared/signalRankFetch.ts',
  'supabase/functions/_shared/signalRankFetch.flowers.test.ts',
  'supabase/functions/_shared/stopAlternatives.ts',
  'supabase/functions/generate-curated-experiences/index.ts',
];
```
Then add `...ORCH_0990_BACKEND_ALLOWLIST,` to the `const ALLOWLIST = [ … ]` union (after `...ORCH_0978_BACKEND_ALLOWLIST,`).

---

## 11. Cross-Surface Impact (Phase 2.5 — MANDATORY)

| # | Surface | Covered? | Behavior / parity |
|---|---|---|---|
| 1 | **Consumer iOS** | ✅ COVERED (automatic) | Curated cards + paired-profile holidays consume `generate-curated-experiences`. Flower stops now resolve only to composite-gate-passing places (or omit). No client code change — parity automatic (shared backend). |
| 2 | **Consumer Android** | ✅ COVERED (automatic) | Identical mechanism, same backend response. Automatic parity. |
| 3 | **Buyer/anonymous Web** | ❌ NOT COVERED | Buyer-anon routes render no curated cards / flower stop — no analog. |
| 4 | **Business iOS** | ❌ NOT COVERED | No curated-card flower stop. |
| 5 | **Business Android** | ❌ NOT COVERED | No analog. |
| 6 | **Admin Web** | ❌ NOT COVERED | Admin renders no curated cards (it runs seeding/scoring; this fix touches neither). |
| 7 | **Business Web preview** | ❌ NOT COVERED | No curated-card surface. |

Parity across iOS + Android is automatic (single shared backend response). No per-surface success criteria needed; SC-1..SC-7 apply to both consumer platforms. **No UI surface is touched** → the Phase 3.6 visual/UX contract is N/A (stated explicitly per the granularity protocol; this is a backend serving-logic fix with zero pixel changes).

---

## 12. Success criteria (observable / testable / unambiguous)

The bar: **100% of flower stops resolve to a place satisfying `primary_type='florist' OR (primary_type IN ('grocery_store','supermarket') AND 'florist'=ANY(types))`, in every served city, or honest-empty if none.**

- **SC-1 🔒** — For the `flowers` slug, `fetchSinglesForSignalRank` is called with `primaryTypeRequired: ['florist']` and `groceryFloralTag: true` and `requiredTypes: undefined`. (Verify: assert `resolvePrimaryTypeGate('flowers')` deep-equals `{ primaryTypes:['florist'], groceryFloralTag:true }` and `resolveTypeFilter('flowers') === undefined`.)
- **SC-2 🔒** — Every place returned for a flower stop satisfies the §4.1 composite gate. No `service`/`general_contractor`/null-primary place (even if `'florist'∈types`) is ever served. (Verify: T-01 + T-08 + live RPC probe.)
- **SC-3 🔒** — `resolveFilterMin('flowers') === 0`. Genuine florists scoring 0-39 ARE eligible. (Verify: T-02.)
- **SC-4 🔒** — In Lagos, the flower stop returns ONLY {Regal Flowers, Fresh Flowers by Olive Designs, Sparkle Gardens} (the 3 `primary_type='florist'`) and NEVER BusyBee/Rukkies/LEE signTEC. In Raleigh, it returns the 1 florist + 13 floral-dept Harris Teeters, no noise. (Verify: T-03 live RPC.)
- **SC-5 🔒** — In a composite-empty city (Paris, Chicago, …), the flower stop is OMITTED, the card still builds, no crash, no non-florist substitution. (Verify: T-04.)
- **SC-6 🔒** — The swap flow (`replace-curated-stop`) returns only composite-gate-passing alternatives for a flower stop. (Verify: T-05.)
- **SC-7 🔒** — Strict-grep gate fails on any forbidden revert (§9 / §10). (Verify: T-06/T-07.)
- **SC-8 🔒 (no-regression)** — For a non-flowers slug (e.g. `hiking`, `museum`, `casual_food`), the RPC returns the IDENTICAL row set pre- and post-migration (the new params default to no-op). (Verify: T-09.)

---

## 13. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| **T-01 (fails-on-revert, Step 0.5)** | Composite gate honored | Call the RPC for the **Lagos** bbox with `p_primary_type_required:=['florist']`, `p_grocery_floral_tag:=true`, `p_filter_signal:='flowers'`, `p_filter_min:=0`, `p_rank_signal:='flowers'` | Result INCLUDES Regal/Fresh Flowers/Sparkle Gardens; EXCLUDES BusyBee (service,104), Rukkies (general_contractor,99.5), LEE signTEC (service,98). Reverting to the `types[]`-only RPC (or dropping the primary check) re-admits the 3 noise rows → test fails. | RPC (live) |
| **T-02** | Floor + gate resolvers | `resolveFilterMin('flowers')`, `resolvePrimaryTypeGate('flowers')`, `resolveTypeFilter('flowers')` | `0`, `{primaryTypes:['florist'],groceryFloralTag:true}`, `undefined` | unit (Deno) |
| **T-03** | Flagged cities served correctly | RPC for Lagos bbox + Raleigh bbox (params as T-01) | Lagos → exactly the 3 florist-primary rows; Raleigh → 1 florist + 13 grocery+florist-tag rows; every returned `place_id` satisfies the composite gate (verified by re-querying `primary_type`/`types`). | RPC (live) |
| **T-04** | Honest-empty city | RPC for Paris bbox (params as T-01) | Returns `[]`; generator skips optional flower stop; card still built; no exception. | edge |
| **T-05** | Swap flow gated | `replace-curated-stop` for a flowers stop | All alternatives satisfy the composite gate. | edge |
| **T-06 (gate)** | Strict-grep catches gate revert | Remove `COMBO_SLUG_PRIMARY_TYPE_GATE.flowers` OR add `flowers` to `COMBO_SLUG_TYPE_FILTER` | gate exits 1 | CI |
| **T-07 (gate)** | Strict-grep catches floor bump | Set `COMBO_SLUG_FILTER_MIN.flowers = 40` | gate exits 1 | CI |
| **T-08 (adversarial)** | Secondary tag can't beat primary | Identify a `service`/`general_contractor` place carrying `'florist'` in `types[]` with a high `flowers` score (BusyBee/Rukkies in Lagos) | NEVER returned for a flower stop; only composite-gate-passing places appear. Confirms `primary_type`, not `types[]`, decides eligibility. | RPC + edge (live) |
| **T-09 (no-regression)** | Existing callers unchanged | Run the new RPC for `hiking` (`p_required_types:=['hiking_area',…]`, new params default) and diff the returned `place_id` set against the same query on the pre-migration RPC (captured before db push) | IDENTICAL set + order. Proves the migration doesn't regress hiking/museum/all other callers. | RPC (live) |

**Step-0.5 fails-on-revert test the implementor MUST write:** T-01 — assert the Lagos RPC call with the composite params EXCLUDES the 3 named `service`/`general_contractor` noise rows and INCLUDES the 3 florist-primary rows, and that reverting the RPC to the `types[]`-only predicate (or removing the `primary_type` clause) flips the assertion red. Capture before/after in the implementation report.

---

## 14. Implementation order

1. Write migration `20260801000000_orch_0990_fetch_local_signal_ranked_primary_type_gate.sql` (DROP old overload → CREATE OR REPLACE new 11-arg → OWNER/GRANT/COMMENT). (🔒 §8.1)
2. Edit `signalRankFetch.ts`: add `COMBO_SLUG_PRIMARY_TYPE_GATE` + `PrimaryTypeGate` + `resolvePrimaryTypeGate`; extend `SignalRankParams` + thread `p_primary_type_required`/`p_grocery_floral_tag` into the RPC call; set `COMBO_SLUG_FILTER_MIN.flowers = 0`; rewrite the stale comment. (🔒 §8.2)
3. Edit `generate-curated-experiences/index.ts` + `stopAlternatives.ts` call sites to resolve + pass the two new params for flowers. (🔒 §8.3)
4. Add Deno test `signalRankFetch.flowers.test.ts` (T-02 + T-06/T-07 mechanism assertions). (🔒)
5. Add strict-grep gate `orch-0990-flower-stop-florist-gate.mjs` + register the workflow job. (🔒 §9)
6. Add `ORCH_0990_BACKEND_ALLOWLIST` to `orch-0863-marketing-hub-phase-b.mjs` + spread into the union — SAME commit as steps 1-5 (COMMS-0002). (🔒 §10)
7. Add `I-PROPOSED-FLOWER-STOP-FLORIST-VERIFIED` (DRAFT) to `INVARIANT_REGISTRY.md`. (🔒)
8. Local Deno test + strict-grep green → PR. CLOSE: operator `supabase db push` (read-only RPC, safe) → orchestrator deploys `generate-curated-experiences` + `replace-curated-stop`. Tester runs T-01/T-03/T-04/T-08/T-09 live. (🔒)
9. 🎨 §8.4 re-score is OUT of required scope — do not ship unless the operator asks.

---

## 15. Discoveries for orchestrator

- **D-1 (FYI):** 8 of 17 seeded cities (Barcelona, Berlin, Chicago, Dallas, Miami, New York, Paris, Toronto) have ZERO composite-gate-passing servable places — flower stop honestly omitted there. This is a SEEDING coverage gap (Google Nearby Search by the Flowers seeding config), NOT this ORCH. Register a separate seeding ORCH if the operator wants flower stops live in those markets.
- **D-2 (FYI):** The composite gate exposes that the `flowers` signal scorer's `types_includes_florist:+60` weight is too weak relative to rating/review popularity — real florists score 0-33 in Lagos. Floor 0 + type-gate sidesteps this for serving, but if flower stops ever need to rank *above* other stop types in a shared list, an §8.4 re-score would help. Not needed now.
- **D-3 (FYI):** The same `primary_type` vs `types[]` over-tagging pattern likely affects OTHER signals that gate on secondary tags (e.g. a future "groceries shows non-grocery" report). The new `p_primary_type_required` RPC param is now available for any slug that needs a primary-type gate — reuse it rather than re-introducing `types[]`-only gates.
- **D-4 (FYI):** `replace-curated-stop`/`stopAlternatives.ts` is in the backend allowlist for this ORCH even though its only change is param threading — flagged so the orchestrator expects it in the diff.

---

## 16. Recommended implementor for next phase

**Codex `implementor-mingla`.** Backend-only: 1 read-only RPC migration + mechanical TS map/param threading + a Deno test + a strict-grep gate + an allowlist line + an invariant stanza — spec-bounded work Codex executes cleanly. No UI, no design pass. Tester verifies via live RPC probe (T-01/T-03/T-04/T-08/T-09). External-API context: no new external calls; Google Places field semantics cited inline (COMMS-0003 satisfied).
