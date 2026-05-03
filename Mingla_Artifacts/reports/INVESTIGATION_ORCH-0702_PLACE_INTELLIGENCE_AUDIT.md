# INVESTIGATION — ORCH-0702: Place Intelligence Audit

**Mode:** INVESTIGATE (forensics)
**Dispatched by:** Mingla Orchestrator
**Date:** 2026-05-01
**Confidence summary:** Q1 = HIGH on "is Baltimore on new system" (PARTIAL runtime evidence received 2026-05-01, see §2.5); Q1-bbox-extent = MEDIUM pending second probe; Q2 = HIGH (chain fully proven via static evidence); Q3 = HIGH on root-cause classification + on Baltimore-sparsity (runtime evidence confirms).

**Schema correction (2026-05-01):** Original draft of this report cited `place_pool.ai_approved` as a current column. **It is not.** Migration `20260425000004_orch_0640_drop_ai_approved_columns.sql` and `20260426000001_orch_0646_ai_approved_cleanup.sql` removed the column ~2026-04-25. References in §3 (Q2) and probe Q2-A have been corrected. This is a migration-chain rule violation in the original draft — I read `20260424200002_orch_0598_11_launch_city_pipeline.sql` which referenced `ai_approved` as belt-and-suspenders during a 14-day soak window, and failed to grep forward for migrations that dropped it. Cited per the forensics skill's stale-schema rule.

---

## Executive Layman Summary

The bouncer + signal-scoring system we shipped (ORCH-0588 lineage) has **three independent structural gaps** that explain all three user complaints:

1. **Baltimore "not enough fine dining"** is most likely a **seed-coverage** problem, not a scoring problem. Seeding is now driven by Google's **geocoding viewport bounding box** (column `seeding_cities.bbox_*`), not the old 10 km radius. Whether Baltimore's bbox is the *city of Baltimore* or *metro Baltimore* depends entirely on what Google's geocoder returned when the city was registered. The code path is correct; the data inside `seeding_cities` is what we don't know without a runtime probe (provided below). Separately, ORCH-0598.11 retired client-side type filtering at seed time ("AI is the sole quality gate"), so the pool depends on what Google chooses to return per city.

2. **Fort Lauderdale sex club appearing as a dinner spot** is fully proven by static evidence. The bouncer has **zero rules for adult/sexually-oriented venues** (no name pattern, no type exclusion). The `drink` seed config explicitly includes `night_club` as an included type, which is exactly how Google often classifies an upscale strip/sex club. Once seeded, the place is admitted by the bouncer (Cluster A_COMMERCIAL — has website + hours + photos), then **scored against every signal, including `fine_dining`**, with no penalty for being a night-club. The serving RPC `query_servable_places_by_signal` is purely score-based and has no category-membership gate. The complaint is a fully predictable consequence of the current architecture.

3. **"Mid" fine dining + brunch quality** has two independent root causes that need to be separated:
   - **Seed coverage**: post-fetch type filtering was removed (ORCH-0598.11), so whatever Google returns enters the pool. Pool composition is opaque.
   - **Score quality**: signal scoring depends heavily on Google-provided booleans (`serves_dinner`, `reservable`, etc.) and Google's own `editorial_summary` text — both of which Google fills inconsistently per city. NULL = no contribution to score. Cities where Google has thinner content metadata produce systematically weaker rankings, irrespective of pool quality.

The deeper problem the user named — **"we keep getting surprised when we seed a new city"** — is correctly diagnosed. The system has no continuous self-audit, no per-city distribution calibration, no name-based safety blocklist, no acknowledgment of inappropriate-content categories, and no synthetic-user QA. Every new city is a roll of the dice.

---

## 1. Investigation Manifest (files actually read)

| File | Why |
|------|-----|
| [supabase/functions/admin-seed-places/index.ts](supabase/functions/admin-seed-places/index.ts) (1957 lines, read 1-650) | Seeding entry point + post-fetch filter logic |
| [supabase/functions/run-bouncer/index.ts](supabase/functions/run-bouncer/index.ts) | Final-pass bouncer driver |
| [supabase/functions/run-pre-photo-bouncer/index.ts](supabase/functions/run-pre-photo-bouncer/index.ts) | Two-pass bouncer (ORCH-0678) |
| [supabase/functions/run-signal-scorer/index.ts](supabase/functions/run-signal-scorer/index.ts) | Per-signal scoring driver |
| [supabase/functions/_shared/bouncer.ts](supabase/functions/_shared/bouncer.ts) | Pure bouncer rules (B1-B9) |
| [supabase/functions/_shared/signalScorer.ts](supabase/functions/_shared/signalScorer.ts) | Pure scoring logic |
| [supabase/functions/_shared/seedingCategories.ts](supabase/functions/_shared/seedingCategories.ts) (read 1-200, lines 296+ for fine_dining config) | Seed includedTypes / excludedPrimaryTypes per category |
| [supabase/functions/_shared/categoryPlaceTypes.ts](supabase/functions/_shared/categoryPlaceTypes.ts) (read 1-150, plus isExcludedVenueName ref at 806) | On-demand type lists + name-based child-venue check |
| [supabase/migrations/20260407000000_city_seeding_bounding_box.sql](supabase/migrations/20260407000000_city_seeding_bounding_box.sql) | Current bbox model (deprecates `coverage_radius_km`) |
| [supabase/migrations/20260421200004_orch_0588_seed_fine_dining_signal.sql](supabase/migrations/20260421200004_orch_0588_seed_fine_dining_signal.sql) | fine_dining v1.0.0 weights |
| [supabase/migrations/20260423000001_orch_0595_seed_brunch_signal.sql](supabase/migrations/20260423000001_orch_0595_seed_brunch_signal.sql) | brunch v1.0.0 weights |
| [supabase/migrations/20260424220003_orch_0634_query_servable_places_by_signal_photo_gate.sql](supabase/migrations/20260424220003_orch_0634_query_servable_places_by_signal_photo_gate.sql) | New signal-based serving RPC |
| [supabase/migrations/20260424200002_orch_0598_11_launch_city_pipeline.sql](supabase/migrations/20260424200002_orch_0598_11_launch_city_pipeline.sql) | Launch-city pipeline + legacy `query_pool_cards` two-gate predicate |
| [supabase/migrations/20260424210001_orch_0633_admin_city_pipeline_status_rpc.sql](supabase/migrations/20260424210001_orch_0633_admin_city_pipeline_status_rpc.sql) | Per-city pipeline status RPC |
| Repo-wide grep for `sex|strip|adult|escort|gentlemen.club|adult_entertainment` | Confirm no name-based or type-based safety blocklist exists |

**Migration chain rule:** I confirmed no later migration overrides the current `query_servable_places_by_signal` (latest definition is the ORCH-0634 G3-photo-gate version) or the bouncer's `EXCLUDED_TYPES` list (defined in `bouncer.ts`, no DB-level overlay).

---

## 2. Q1 — Baltimore reseeding status

### What the code shows (HIGH confidence)
The seeding boundary is **not** a 10 km radius in current code. [supabase/migrations/20260407000000_city_seeding_bounding_box.sql:1-35](supabase/migrations/20260407000000_city_seeding_bounding_box.sql#L1-L35) added `bbox_sw_lat / bbox_sw_lng / bbox_ne_lat / bbox_ne_lng` columns to `seeding_cities` (NOT NULL) and deprecated `coverage_radius_km` (`COMMENT: 'DEPRECATED: replaced by bbox_sw/ne columns. Retained for rollback.'`).

[admin-seed-places/index.ts:165-208](supabase/functions/admin-seed-places/index.ts#L165-L208) generates the tile grid from `bbox_sw_*` / `bbox_ne_*`. [admin-seed-places/index.ts:438-501 (handleGenerateTiles)](supabase/functions/admin-seed-places/index.ts#L438-L501) explicitly throws `"City has no bounding box. Re-register with geocoding."` if the bbox columns are null. The 10 km radius mental model is therefore **stale**; the user's question needs to be reframed.

### What the code does NOT determine
**Whether Baltimore's stored bbox = Baltimore-CITY limits or Baltimore-METRO viewport** depends entirely on what Google's geocoder returned for the registration query. The geocoder returns a `viewport` field whose extents vary based on the input string ("Baltimore" vs "Baltimore, MD" vs "Baltimore City, Maryland"). Baltimore is an *independent city* (not part of Baltimore County), so a tight geocoder query SHOULD bound to city limits — but there is no defensive normalization in the code path I read.

### Pipeline coverage (depends on runtime data)
[admin_city_pipeline_status RPC](supabase/migrations/20260424210001_orch_0633_admin_city_pipeline_status_rpc.sql) provides per-stage counts: `total_active`, `seeded_count`, `bouncer_judged_count`, `is_servable_count`, `has_real_photos_count`, `scored_count`. This is the canonical source of truth for "is Baltimore on the new system end-to-end." Cannot answer without running it.

### Verdict
**`yes-on-new-system`** (HIGH confidence as of 2026-05-01 runtime probe). See §2.5 below for the runtime evidence. The bbox-extent question (city-only vs metro) is **still pending** — second runtime probe required.

### 2.5 — Runtime evidence received 2026-05-01 (admin_city_pipeline_status())

| Metric | Washington DC | Baltimore | Fort Lauderdale |
|---|---|---|---|
| city_status | seeded | seeded | seeded |
| created_at | 2026-04-01 | 2026-04-02 | 2026-04-12 |
| **total_active places** | **5,542** | **2,213** | **2,247** |
| bouncer_judged_count | 5,542 (100%) | 2,213 (100%) | 2,247 (100%) |
| is_servable_count | 2,358 (43%) | **1,253 (57%)** | 1,006 (45%) |
| has_real_photos_count | 2,761 (50%) | 1,712 (77%) | 1,354 (60%) |
| scored_count | 2,358 | 1,253 | 1,006 |
| refreshed_count | 2,873 (52%) | **503 (23%)** | 2,243 (99.8%) |
| last_refresh | 2026-04-22 | **2026-04-02** | 2026-04-22 |
| last_bouncer_run | 2026-04-25 | 2026-04-22 | 2026-04-24 |

**Concrete findings (HIGH confidence):**
1. **Baltimore IS on the new bouncer + scoring system end-to-end.** 100% bouncer-judged, 1,253 places scored. The user's "10 km old system" hypothesis is decisively ruled out.
2. **Baltimore's pool is 60% smaller than DC's** (2,213 vs 5,542). This is the **seed coverage gap** the user perceived as "not enough fine dining." It's real.
3. **Per-capita-of-pool comparison:** DC (~700k pop) = 7.9 places/1k residents. Baltimore (~570k pop) = 3.9 places/1k. FL city (~180k pop) = 12.5 places/1k. **Baltimore has ~50% the per-capita pool density of DC, and ~30% of FL.** Even controlling for tourism (FL is a tourist hub, DC is a govt+tourist hub), Baltimore is materially under-seeded.
4. **Baltimore is the most stale on detail refresh** — only 503/2,213 = 23% of rows have ever been detail-refreshed since seeding, vs FL's 99.8% and DC's 52%. `last_refresh` for Baltimore is 2026-04-02, the day the city was registered. **Google's per-place metadata (the booleans + editorial summary that drive signal scoring) has effectively never been refreshed for Baltimore.** This is a directly actionable gap — running `admin-refresh-places` against Baltimore would materially improve `serves_dinner`/`reservable`/`editorial_summary` coverage and lift fine-dining + brunch scores by surfacing currently-NULL boolean fields.
5. **Bouncer pass rate is highest in Baltimore** (57% vs DC 43%, FL 45%). Baltimore's per-place quality post-bouncer is fine; the issue is volume + metadata staleness.
6. **The detail-refresh staleness explains a chunk of the "mid" scoring complaint by itself.** The fine_dining and brunch signal scorers depend heavily on `serves_dinner`, `reservable`, `dine_in`, `serves_wine`, `editorial_summary`. Without detail refresh, these fields are NULL → no contribution to score → flagship venues rank below their true tier.

### 2.6 — bbox runtime evidence received 2026-05-01 (Q1-A.1) — SMOKING GUN

| City | lat_extent | lng_extent | deprecated_radius | Geocode status |
|---|---|---|---|---|
| Washington DC | 22.7 km | 18.3 km | **0** | Proper Google viewport (post-bbox-migration) |
| **Baltimore** | **20.0 km** | **20.0 km** | **10** | **AUTO-BACKFILLED FROM 10 km RADIUS** — never re-geocoded |
| Fort Lauderdale | 15.7 km | 10.8 km | **0** | Proper Google viewport (post-bbox-migration) |

**🔴 Root cause R-Q1-1 PROVEN: Baltimore's bbox is the deprecated 10 km radius mechanically converted to a 20×20 km square.**

The square shape (perfectly round 20.0 × 20.0 km) and `deprecated_radius = 10` are the giveaways. Migration `20260407000000_city_seeding_bounding_box.sql` lines 17-23 backfills bboxes from `coverage_radius_km` using:
- `lat_offset = radius_km / 111.32`
- `lng_offset = radius_km / (111.32 * cos(center_lat))`

For Baltimore at lat 39.29, that yields exactly the 20×20 km box we observe. **Baltimore was registered BEFORE the bbox model went live, has `deprecated_radius=10`, and was never re-registered with a proper Google viewport.** DC and FL show `deprecated_radius=0` — they were registered fresh after the migration and have geographically-shaped (asymmetric) viewports.

**The user's original mental model was correct.** Baltimore IS still working with the old 10 km seeding boundary, just dressed up as a square bbox.

**Geographic implication:** Baltimore CITY proper is a long thin shape, ~38 km N-S × ~20 km E-W. A 20×20 km square centered on downtown captures only the central core (Inner Harbor, Federal Hill, downtown, Fells Point) and **misses major chunks of the city** — Hampden, Mount Washington, NE Baltimore, much of West Baltimore — while bleeding slightly into Baltimore County in some directions. This is a hybrid worst-case: under-covers the city AND mis-overlaps the county.

**Actionable:** re-register Baltimore in admin to fetch the proper Google viewport, verify `deprecated_radius` flips to 0 and bbox becomes asymmetric, then re-seed the missing tiles. Independent of the safety bouncer work — can ship as a separate cheap dispatch.

### What the user should be aware of (Five-Truth-Layer disagreement)
- **Docs**: user mental model says "10 km radius" — STALE.
- **Schema**: `bbox_*` columns NOT NULL since 2026-04-07.
- **Code**: bbox-driven, throws if missing.
- **Runtime**: unknown — needs probe.
- **Data**: unknown — needs probe.

The "10 km" in the user's question is the contradiction. The system uses Google viewports, not a fixed radius.

---

## 3. Q2 — Fort Lauderdale sex club as dinner spot (root cause PROVEN)

### Runtime proof received 2026-05-01 — the offending row is "Trapeze"

Probe Q2-A returned the smoking gun. Two rows surfaced:

**Row 1 — Trapeze (the actual user-reported venue)**
| Field | Value |
|---|---|
| id | `89e190a8-0ab4-485e-b839-9d1d657d5b2d` |
| name | **Trapeze** (publicly known Fort Lauderdale-area swingers club) |
| address | 5213 FL-7, Tamarac, FL 33319, USA |
| primary_type | `night_club` |
| types[] | `[night_club, bar, restaurant, food, association_or_organization, point_of_interest, establishment]` |
| business_status | OPERATIONAL |
| **is_servable** | **true** |
| **bouncer_reason** | **null** (admitted clean — bouncer found no rejection reason) |
| rating | 4.2 |
| review_count | 314 |
| serves_dinner | null |
| reservable | **true** |
| dine_in | **true** |
| **seeding_category** | **drinks_and_music** (entered via the `drink` seed config — exactly as static trace predicted) |

Every prediction from the static causal chain is verified on the row. Note `types[]` includes `restaurant` — that's worth +30 in the fine_dining `field_weights` (`types_includes_restaurant: 30`). Combined with `reservable: 30` + `dine_in: 15` + rating-scale `4.2 × 10 = 42` (capped at 50, contributes ~42) + reviews-log `log10(315) × 5 ≈ 12.4` (capped at 25) → **estimated fine_dining score ≈ 129** even without `serves_dinner`. That clears the typical `filter_min: 120` and explains why it surfaced as a dinner card.

**Row 2 — false positive in the v1 regex** (`Exotic Aquatic, Inc.`, an actual aquarium/pet store with `primary_type: aquarium`). Implementor note: the safety regex needs prefix-aware word boundaries — `\bexotic\s+(?:club|dancer|entertainment|lounge)` rather than bare `\bexotic\b`. Same applies to `bare` and `nude` matches.

### Trapeze score trail (Q2-B runtime evidence) — the structural leak quantified

Trapeze (`place_id 89e190a8-0ab4-485e-b839-9d1d657d5b2d`) scored on every active signal. Sorted by score:

| Signal | Score | Verdict | Why |
|---|---|---|---|
| **drinks** | **192.49** | Correctly highest. Bouncer didn't catch but scorer ranks it #1 in drinks where it actually belongs. `types_includes_night_club: +25`, `types_includes_bar: +40`, `_summary_match: +35`, `_reviews_match: +20`. |
| **fine_dining** | **🔴 151.09** | **THE LEAK.** Above the typical `filter_min: 120`. Contributors: `types_includes_restaurant: +10` (because `types[]` includes `restaurant`), `reservable: +25`, `dine_in: +10`, `_summary_match: +25`, `price_range_start_above_2500/4500/7000: +40 total`, `_rating_scale: +33.6`, `_reviews_scale: +12.5`, `serves_cocktails: +5`, `good_for_groups: -10`. **Zero penalty for `types_includes_night_club`.** This is the gap. |
| brunch | 137.49 | Should be lower. `types_includes_night_club: -50` correctly applied, but offset by other contributors (`reservable: +40`, `serves_cocktails: +35`, `_summary_match: +35`). NB: live in-DB version of brunch differs from migration v1.0.0 — `serves_cocktails: 35` is in current weights but not in migration `20260423000001`. **Signal weights have evolved post-migration; live config is the source of truth, not migration files.** |
| lively | 122.49 | Defensible. `types_includes_night_club: +20` correct — Trapeze IS a lively venue. |
| theatre | 47.49 | Correctly excluded. `types_includes_bar: -40`, `types_includes_restaurant: -40`. |
| romantic | 39.49 | Correctly excluded — **`types_includes_night_club: -60`**. (Romantic signal does the right thing where fine_dining doesn't.) |
| casual_food | 35.49 | Correctly excluded — `types_includes_night_club: -50`. |
| creative_arts | 17.49 | Correctly excluded. |
| icebreakers | 0 | Correctly excluded — `types_includes_night_club: -80`. |
| flowers / play / nature / movies / groceries | 0 | All correctly excluded via penalty stacks. |

**Pattern:** **every single dining/family/romantic signal except `fine_dining` correctly penalizes `types_includes_night_club`.** Brunch -50, casual_food -50, romantic -60, icebreakers -80, movies -60. fine_dining alone has no entry. This is a v1.0.0 omission, not a design choice — every comparable signal got the rule. The fix is mechanical.

**Quantified fix preview:** adding `types_includes_night_club: -80` and `types_includes_bar: -50` to fine_dining v1.1.0 reduces Trapeze's fine_dining score from 151.09 → ~21. Below filter_min. Problem solved at the scoring layer.

**But the bouncer fix is still required** — even with -130 penalty in fine_dining, Trapeze still legitimately scores 192 on drinks. For drinks chips that's debatable (it IS a bar), but the system has zero structural defense against an adult venue surfacing on ANY dining/date chip. The bouncer needs a hard safety blocklist regardless.

### The full causal chain (HIGH confidence — fully traceable in code AND now proven against the real row)

**Stage 1 — Seeding admits the place.** The `drink` seeding config at [seedingCategories.ts:189-218 (id: 'drink')](supabase/functions/_shared/seedingCategories.ts#L189-L218) lists `night_club` in `includedTypes`. Google often classifies upscale strip/sex clubs as `night_club`. Google's `excludedPrimaryTypes` filter on the seed call doesn't help here — `night_club` is INCLUDED for the drink config. Place enters `place_pool`.

**Stage 2 — Post-fetch type filter is a no-op.** [admin-seed-places/index.ts:387-410 (`applyPostFetchFilters`)](supabase/functions/admin-seed-places/index.ts#L387-L410) **explicitly removed type exclusions**:
```
// Phase 2: Type exclusions removed — AI is the sole quality gate.
// All place types now enter the pool. AI validates quality post-seeding.
```
Only filters: `CLOSED_PERMANENTLY` and no-photos. So even if the seed config had said "exclude this," nothing client-side would catch it.

**Stage 3 — Bouncer admits the place.** [_shared/bouncer.ts:45-55 (`EXCLUDED_TYPES`)](supabase/functions/_shared/bouncer.ts#L45-L55) lists `gym`, `school`, `hospital`, `gas_station`, `bank`, `car_*`, `dog_park`, `funeral_home`, etc. — **NO entry for any adult/sexual venue type**. Google's Places v1 type catalog does include entries that can apply to adult venues (e.g., `adult_entertainment_store` exists for retail; strip clubs are typically `night_club` + `bar`). None of these are in `EXCLUDED_TYPES`.

The `deriveCluster` function at [bouncer.ts:169-175](supabase/functions/_shared/bouncer.ts#L169-L175) returns `A_COMMERCIAL` for `night_club` (since it's not in EXCLUDED, NATURAL, or CULTURAL). Cluster A's requirements: name + lat/lng (B3), business not closed (B2), Google photos (B7), stored photos (B8), website on own domain (B4/B5), opening hours (B6). Upscale FL adult venues clear all of these. The B9 child-venue regex only matches retailer sub-counters ("Walmart Bakery", "Sam's Club Cafe") — it does not match "* Sex Club" or "* Gentleman's Club".

Bouncer writes `is_servable = true`. **Repo-wide grep for `sex|strip|adult|escort|gentlemen.?club|adult_entertainment` against `supabase/` returned zero hits in any rules file.** Confirmed: no name-based safety guard anywhere in the codebase.

**Stage 4 — Signal scorer scores it on `fine_dining`.** [run-signal-scorer/index.ts:138-178](supabase/functions/run-signal-scorer/index.ts#L138-L178) iterates all `is_servable=true` places (no category filter — it scores every servable place against the requested signal regardless of which seed config introduced it).

[signalScorer.ts:141-159 (`computeScore`)](supabase/functions/_shared/signalScorer.ts#L141-L159): only hard gates are `min_rating` (4.0 for fine_dining) and `min_reviews` (50, with bypass at rating ≥ 4.6). FL adult venues with even modest popularity clear these.

[fine_dining v1.0.0 config](supabase/migrations/20260421200004_orch_0588_seed_fine_dining_signal.sql) field weights — **no penalty for `types_includes_night_club` or `types_includes_bar`**. Brunch's config DOES penalize (`types_includes_night_club: -50`, `types_includes_bar: -15`), but fine_dining missed this. With `serves_dinner=true (+30)`, `reservable=true (+30)`, `dine_in=true (+15)`, `serves_wine=true (+10)`, `serves_cocktails=true (+5)`, `price_level_expensive (+25)`, `rating × 10` (~45), `reviews log scale` (~15), the score easily exceeds the 120 threshold typically used for `filter_min`.

**Stage 5 — Serving RPC has no category gate.** [query_servable_places_by_signal](supabase/migrations/20260424220003_orch_0634_query_servable_places_by_signal_photo_gate.sql#L51-L96) filters on:
- `is_servable = true` ✓
- `is_active = true` ✓
- `score >= filter_min` ✓
- photo gate ✓
- haversine radius ✓
- exclude list ✓

It does **not** filter on `seeding_category`, on `place_pool.types`, on a name pattern, on a category-membership check, or on anything else that could catch the venue. The legacy `query_pool_cards` RPC at least applies `category_type_exclusions` and a hardcoded `v_excluded_types` (`gym, fitness_center, dog_park, school...`) — neither of which contains adult-venue rules either, but at least *that* path has the structure for it.

### Root cause classification (six-field evidence)

🔴 **Root cause R-Q2-1: Bouncer EXCLUDED_TYPES has no adult/sexually-oriented venue rules.**
| Field | Evidence |
|---|---|
| File + line | [_shared/bouncer.ts:45-55](supabase/functions/_shared/bouncer.ts#L45-L55) |
| Exact code | `EXCLUDED_TYPES = ['gym', 'fitness_center', 'school', ..., 'real_estate_agency']` (no adult venues) |
| What it does | Treats `night_club`/`bar`-typed adult venues as legitimate Cluster A_COMMERCIAL; admits them if other rules pass |
| What it should do | Explicitly exclude `adult_entertainment_store` and apply a name-pattern blocklist for adult/sexually-oriented businesses |
| Causal chain | adult venue typed `night_club` → not in EXCLUDED → A_COMMERCIAL → has website/hours/photos → `is_servable=true` |
| Verification step | Run SQL probe Q2-A (Section 7) — locate any FL place whose name regex matches adult-venue patterns and confirm `is_servable=true` |

🔴 **Root cause R-Q2-2: `query_servable_places_by_signal` has no category-membership gate.**
| Field | Evidence |
|---|---|
| File + line | [migration 20260424220003](supabase/migrations/20260424220003_orch_0634_query_servable_places_by_signal_photo_gate.sql#L51-L96) |
| Exact code | `WHERE pp.is_servable AND pp.is_active AND ps.score >= p_filter_min AND <photo gate> AND <haversine>` |
| What it does | Returns any servable place with a high enough score for the signal, regardless of whether the place's primary category matches the user-facing category that signal represents |
| What it should do | Reject places whose `place_pool.seeding_category` (or computed category set) does not include the dining category for `fine_dining`/`brunch` signals; or apply category-type-exclusion table |
| Causal chain | adult venue scored on fine_dining (no penalty for night_club type) → score ≥ filter_min → no category gate → returned as dinner candidate |
| Verification step | Run SQL probe Q2-B — for any flagged FL adult venue, query its `place_scores.fine_dining` row and confirm score ≥ 120 |

🟠 **Contributing factor C-Q2-1: `fine_dining` signal config has no penalty for `night_club` / `bar` / `adult_entertainment_store` types.**
| Field | Evidence |
|---|---|
| File + line | [migration 20260421200004:14-67](supabase/migrations/20260421200004_orch_0588_seed_fine_dining_signal.sql#L14-L67) `field_weights` |
| Exact code | No `types_includes_night_club`, `types_includes_bar`, `types_includes_adult_entertainment_store` keys in `field_weights` |
| What it does | Allows non-restaurant nightlife venues to accumulate score from positive features (serves_dinner, reservable, etc.) without offsetting penalty |
| What it should do | Add hard-negative weights: `types_includes_night_club: -80`, `types_includes_bar: -50`, `types_includes_adult_entertainment_store: -200` (effectively excluding) |
| Causal chain | Without negative weights, FL adult venue with restaurant-like booleans easily scores above filter_min |
| Verification step | Re-run the v1.0.0 paper sim with hypothetical adult-venue place data; observe score > 120 |

🟠 **Contributing factor C-Q2-2: post-fetch type filter at seed time is a no-op.**
| Field | Evidence |
|---|---|
| File + line | [admin-seed-places/index.ts:387-410](supabase/functions/admin-seed-places/index.ts#L387-L410) |
| Exact code | Comment "Phase 2: Type exclusions removed — AI is the sole quality gate." Only filters CLOSED_PERMANENTLY and no-photos |
| What it does | Lets Google return whatever Google chooses, regardless of seed config's `excludedPrimaryTypes` (which is only used in the API request body — Google may still return rows whose secondary types include excluded values) |
| What it should do | Either restore client-side type post-filter, OR ensure the bouncer + scorer downstream are sufficient (they are not — see R-Q2-1, R-Q2-2) |
| Causal chain | Defense-in-depth principle violated: only one layer of filtering, and that layer is downstream and incomplete |
| Verification step | Confirm that AI validation (`ai_approved`) catches adult venues — see open question in Section 7 |

🟡 **Hidden flaw H-Q2-1: Two parallel serving RPCs (`query_pool_cards` legacy vs `query_servable_places_by_signal` new) with divergent safety predicates.**
The legacy path includes `category_type_exclusions` and a hardcoded gym/school/dog_park exclusion list. The new path does not. Any future safety rule must be added to BOTH or the gap will widen.

### Five-Truth-Layer reconciliation
- **Docs**: SPEC_ORCH-0588 says bouncer is "deterministic, no AI, no keyword matching for category judgment." Comment is exact: name-based safety filters are out of scope by design.
- **Schema**: `place_pool.types` is `text[]` — fully capable of holding adult-content type tags. Schema is not the limit.
- **Code**: All defenses (bouncer, scorer, serving) lack adult-venue rules. Confirmed by repo grep.
- **Runtime**: Cannot verify the specific FL place without DB access. SQL probes provided.
- **Data**: Cannot verify. SQL probes provided.

**The contradiction:** code is internally consistent — it does exactly what it was designed to do. The bug is in the *design*: invariant `I-BOUNCER-DETERMINISTIC` was written to forbid AI/keyword classification but did not carve out an exception for **safety blocklists**, which are deterministic and cheap. Safety filtering was never specified.

---

## 4. Q3 — "Mid" fine dining + brunch quality

### Two distinct root causes — must be separated

🔴 **Root cause R-Q3-1: Seed coverage is whatever Google decides per city.**
[admin-seed-places/index.ts:387-410](supabase/functions/admin-seed-places/index.ts#L387-L410) removed all client-side type filtering. The pool composition for any given category is: (Google's response to the `searchNearby` call with `includedTypes` × tile grid) − `CLOSED_PERMANENTLY` − no-photos − bouncer rejections. There is no positive coverage assertion (e.g., "this city must have ≥ 30 places matching `fine_dining_restaurant`"). The `coverage_check` action in admin-seed-places does count per-category, but the `hasGap` flag is a single threshold (count < 10) — too coarse to detect "Baltimore has fine-dining sparsity relative to its population."

🔴 **Root cause R-Q3-2: Signal scoring depends heavily on Google's inconsistently-populated booleans + text fields.**
[signalScorer.ts:130-138](supabase/functions/_shared/signalScorer.ts#L130-L138): boolean field weights apply only when `value === true`. NULL = no contribution. Google's API populates `serves_dinner`, `reservable`, `dine_in`, `serves_wine`, `serves_cocktails` etc. inconsistently — better-known venues get full metadata, lesser-known venues get null. The ordering depends on Google's metadata coverage, not actual venue quality.

[signalScorer.ts:184-221](supabase/functions/_shared/signalScorer.ts#L184-L221): text-pattern matching against `editorial_summary` + `generative_summary` + first 5 reviews. Google fills `editorialSummary` for a small fraction of places (typically <10%) and `generativeSummary` is also sparse. ORCH-0598.12 fix at line 186-204 confirms reviews-text extraction was previously broken (returning "[object Object]") — review text was completely silent across all signals before that fix. Today text-pattern matching works, but the *coverage* of editorial/generative summary is what limits ceiling-tier scoring.

🟠 **Contributing factor C-Q3-1: No per-city distribution calibration.**
[admin_city_pipeline_status RPC](supabase/migrations/20260424210001_orch_0633_admin_city_pipeline_status_rpc.sql) gives raw counts. There is no comparison to a reference distribution (e.g., "Cities of population ≥ 600k typically have ≥ N fine_dining-eligible places; Baltimore has X% of expected"). Sparsity surfaces only as user complaints.

🟠 **Contributing factor C-Q3-2: No continuous canary self-audit.**
No agent simulates "I'm a user in Baltimore looking for fine dining" and checks whether the top 10 results pass an LLM-based "is this actually fine dining?" verification. The system has no automated way to detect quality regressions before users hit them.

🟡 **Hidden flaw H-Q3-1: `min_rating` and `min_reviews` are global constants, not per-city.**
[fine_dining config](supabase/migrations/20260421200004_orch_0588_seed_fine_dining_signal.sql#L17-L18): `min_rating: 4.0`, `min_reviews: 50`. In a sparse market, this excludes the only viable fine-dining options that happen to have 35 reviews. In a dense market, it admits too many.

🟡 **Hidden flaw H-Q3-2: No editorial/curatorial layer.**
Mature platforms (Resy, Eater, Time Out, Tock) layer editorial designations on top of algorithmic ranking. Mingla has none. The signal score IS the ranking, with no human-curated tier flag.

### Five-Truth-Layer reconciliation
- **Docs**: SPEC_ORCH-0595 says brunch v1.0.0 weights "paper-sim validated against 8 Raleigh anchors." It was tuned for one city — Raleigh. There is no per-city retuning for DC, Baltimore, FL.
- **Schema**: `place_scores` is per-place, not per-city-tuned.
- **Code**: scorer applies the same config to every city.
- **Runtime**: User reports "mid" results — consistent with single-city-tuned config applied to 3 different markets.
- **Data**: Per-city top-20 + ground-truth check requires runtime probe (Section 7).

---

## 5. Q4 — Why we keep getting surprised by every new city

This question is answered in detail in the companion artifact:
[RESEARCH_ORCH-0702_PLACE_INTELLIGENCE_AGENT_REFERENCE_ARCHITECTURE.md](RESEARCH_ORCH-0702_PLACE_INTELLIGENCE_AGENT_REFERENCE_ARCHITECTURE.md)

In summary: the system has no continuous self-audit, no inappropriate-content blocklist, no per-city calibration, no editorial layer, no multi-source fusion. Every city is a fresh roll of the dice on (a) Google's coverage in that geography, (b) Google's metadata completeness for that city, (c) whether someone manually noticed a sparsity gap. The companion artifact proposes a Place Intelligence Agent (PIA) reference architecture and phased migration path.

---

## 6. Blast Radius

### Surfaces affected by the missing safety blocklist (R-Q2-1)
- **Discover deck (single-card serving)** — anywhere `query_servable_places_by_signal` is called without category restriction
- **Curated experiences** — `generate-curated-experiences` calls `fetchSinglesForSignalRank` which uses the same RPC
- **Per-chip multi-fan-out serving** — if dinner chip maps to fine_dining signal, chip serves adult venues
- **Holiday categories** — `generate-holiday-categories` likely shares the same predicate

### Surfaces affected by per-city quality drift (R-Q3-1, R-Q3-2)
- Every city we launch — Charlotte, Baltimore, Fort Lauderdale, DC, plus any future city
- Mobile Discover, mobile Curated, mobile Holiday, future Mingla Business event-venue picker (when launched)

### Invariants potentially violated
- **I-BOUNCER-DETERMINISTIC** is fine; the gap is that it was written without a safety carve-out. Recommend adding `I-BOUNCER-SAFETY-BLOCKLIST` as a sibling invariant.
- **Constitutional #13 (exclusion consistency)** — already partially closed by ORCH-0634 photo gate; reopened by category-membership gap between two serving paths (H-Q2-1).

---

## 7. Open Runtime Probes (Orchestrator/User must run)

The following SQL probes provide the runtime evidence this static investigation cannot. Run via Supabase SQL Editor or `supabase db query`.

### Q1-A — Baltimore bbox + pipeline coverage
```sql
-- Baltimore's stored bounding box vs Baltimore-CITY reference (~39.20–39.37 N, 76.71–76.53 W per OSM)
SELECT id, name, country, status,
       bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng,
       (bbox_ne_lat - bbox_sw_lat) * 111.32                        AS lat_extent_km,
       (bbox_ne_lng - bbox_sw_lng) * 111.32 * COS(RADIANS((bbox_sw_lat + bbox_ne_lat)/2)) AS lng_extent_km,
       coverage_radius_km AS deprecated_radius,
       created_at, updated_at
FROM seeding_cities
WHERE name ILIKE '%baltimore%';
```
Expected if "Baltimore city only": ~17 km × ~13 km extent. If much larger, bbox is metro.

### Q1-B — Baltimore pipeline coverage
```sql
SELECT * FROM admin_city_pipeline_status()
WHERE city_name ILIKE '%baltimore%';
```
Verifies `bouncer_judged_count`, `is_servable_count`, `scored_count` percentages.

### Q1-C — Baltimore signal coverage (fine_dining specifically)
```sql
SELECT
  ps.signal_id,
  COUNT(*) FILTER (WHERE ps.score >= 120)                    AS placements_above_filter_min,
  COUNT(*) FILTER (WHERE ps.score >= 150)                    AS strong_placements,
  COUNT(*)                                                    AS total_scored,
  ROUND(AVG(ps.score)::numeric, 1)                           AS avg_score,
  ROUND(MAX(ps.score)::numeric, 1)                           AS max_score
FROM place_scores ps
JOIN place_pool pp ON pp.id = ps.place_id
JOIN seeding_cities sc ON sc.id = pp.city_id
WHERE sc.name ILIKE '%baltimore%'
  AND ps.signal_id IN ('fine_dining', 'brunch')
  AND pp.is_servable AND pp.is_active
GROUP BY ps.signal_id;
```

### Q2-A — Find FL adult venues admitted to pool (CORRECTED — `ai_approved` removed)
```sql
SELECT pp.id, pp.name, pp.primary_type, pp.types, pp.business_status,
       pp.is_servable, pp.bouncer_reason,
       pp.rating, pp.review_count, pp.address,
       pp.serves_dinner, pp.reservable, pp.dine_in,
       pp.seeding_category
FROM place_pool pp
JOIN seeding_cities sc ON sc.id = pp.city_id
WHERE sc.name ILIKE '%fort lauderdale%'
  AND (
    pp.name ~* '\m(sex|strip|adult|gentleman|gentlemens|gentlemen''?s|escort|burlesque|exotic|nude|topless|bare|cabaret\s+club|swinger|trapeze|fetish)\M'
    OR 'adult_entertainment_store' = ANY(pp.types)
    OR 'strip_club' = ANY(pp.types)
  )
  AND pp.is_active = true
ORDER BY pp.is_servable DESC, pp.rating DESC NULLS LAST;
```

### Q2-B — For any flagged venue, pull its scoring trail
```sql
-- Replace <id> with the place_pool.id from Q2-A
SELECT ps.signal_id, ps.score, ps.signal_version_id, ps.contributions, ps.scored_at
FROM place_scores ps
WHERE ps.place_id = '<id>'
ORDER BY ps.score DESC;
```

### Q2-C — Confirm safety predicate is absent
```sql
-- Search all RPC bodies for any name-based safety predicate
SELECT n.nspname, p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (pg_get_functiondef(p.oid) ~* '\m(sex|strip|adult|escort|gentlemen)' OR
       pg_get_functiondef(p.oid) ~* 'adult_entertainment')
LIMIT 20;
```
Expected result: **0 rows**, confirming the gap.

### Q3-A — Per-city top 20 for fine_dining
```sql
SELECT pp.name, pp.primary_type, pp.rating, pp.review_count,
       ps.score, pp.address
FROM place_scores ps
JOIN place_pool pp ON pp.id = ps.place_id
JOIN seeding_cities sc ON sc.id = pp.city_id
WHERE sc.name ILIKE ANY (ARRAY['%washington%dc%', '%baltimore%', '%fort lauderdale%'])
  AND ps.signal_id = 'fine_dining'
  AND pp.is_servable AND pp.is_active
ORDER BY sc.name, ps.score DESC
LIMIT 60;  -- 20 per city
```
Repeat for `signal_id = 'brunch'`. Spot-check the lists against Google Maps reviews / Resy / Eater to assess accuracy.

### Q3-B — Per-city ineligibility breakdown
```sql
SELECT sc.name, ps.contributions->>'_reason' AS ineligibility_reason, COUNT(*)
FROM place_scores ps
JOIN place_pool pp ON pp.id = ps.place_id
JOIN seeding_cities sc ON sc.id = pp.city_id
WHERE ps.signal_id = 'fine_dining'
  AND ps.contributions ? '_ineligible'
GROUP BY sc.name, ps.contributions->>'_reason'
ORDER BY sc.name;
```
Tells us how many places are being rejected by min_rating vs min_reviews per city — useful to assess whether the global gates are wrong for sparse markets.

---

## 8. Discoveries for Orchestrator (side issues — register separately)

| ID candidate | Finding | Severity |
|---|---|---|
| ORCH-XXXX-1 | Two parallel serving RPCs (`query_pool_cards` vs `query_servable_places_by_signal`) with divergent safety predicates. New path lacks `category_type_exclusions` join. | S2-medium |
| ORCH-XXXX-2 | `fine_dining` signal lacks negative weights for `night_club`/`bar`/`adult_entertainment_store`; brunch has them. | S1-high |
| ORCH-XXXX-3 | `coverage_radius_km` deprecated 2026-04-07 but column still exists. Schedule drop migration. | S3-low |
| ORCH-XXXX-4 | Post-fetch type filter is a no-op (`applyPostFetchFilters`); the seed config's `excludedPrimaryTypes` is sent only to Google API, not enforced client-side. Defense-in-depth gap. | S2-medium |
| ORCH-XXXX-5 | `coverage_check` `hasGap = count < 10` is a single absolute threshold, not population-relative. Will not detect "Baltimore has 30% of expected fine-dining for its population." | S2-medium |
| ORCH-XXXX-6 | `min_rating`/`min_reviews` global constants per signal, not per-city. Sparse markets penalized. | S2-medium |
| ORCH-XXXX-7 | No editorial / curatorial overlay on top of algorithmic ranking. Industry standard for date-experience apps. | S2-medium (product) |

---

## 9. Fix Strategy (direction only — orchestrator dispatches specs)

### Tactical (close the visible bugs)
1. **Add safety blocklist to bouncer.** Extend `EXCLUDED_TYPES` with all known Google adult-content type strings. Add a name-pattern allowlist+denylist analogous to B9, gated by `B10:adult_content`. (Sibling invariant `I-BOUNCER-SAFETY-BLOCKLIST` codified.)
2. **Add negative weights to `fine_dining` signal config v1.1.0.** Match brunch's pattern: `types_includes_night_club: -80`, `types_includes_bar: -50`, `types_includes_adult_entertainment_store: -200`. Apply same to `casual_food`, `lively`, etc.
3. **Add category-membership gate to `query_servable_places_by_signal`.** Accept a `p_required_seeding_categories text[]` parameter; restrict to places whose `seeding_category` (or computed category set) intersects.
4. **Restore client-side post-fetch type filter** in `applyPostFetchFilters` for safety types specifically (not as a quality gate, just as a safety belt-and-suspenders).
5. **Re-run bouncer + scorers across all cities** after rules update so the back catalog is corrected, not just new seedings.

### Strategic (close the structural gap)
See [RESEARCH_ORCH-0702_PLACE_INTELLIGENCE_AGENT_REFERENCE_ARCHITECTURE.md](RESEARCH_ORCH-0702_PLACE_INTELLIGENCE_AGENT_REFERENCE_ARCHITECTURE.md) — phased migration toward the Place Intelligence Agent, with continuous canary self-audit and per-city calibration so we stop being surprised.

---

## 10. Confidence Ledger

| Finding | Confidence | What would raise it |
|---|---|---|
| Q1: code uses bbox not radius | HIGH | – |
| Q1: Baltimore bbox is/isn't city-only | UNKNOWN | Run probe Q1-A |
| Q1: Baltimore pipeline coverage | UNKNOWN | Run probe Q1-B/C |
| Q2: chain proven via static evidence | HIGH | – |
| Q2: specific FL row exists in pool | UNKNOWN | Run probe Q2-A |
| Q3-1: seed coverage gap exists | HIGH | – |
| Q3-2: scoring depends on inconsistent Google metadata | HIGH | – |
| Q3: per-city quality is "mid" everywhere | MEDIUM (user-reported) | Run probe Q3-A and spot-check |

---

## 11. Out of Scope

- Writing migrations or code to implement fixes — orchestrator dispatches a spec.
- Re-seeding Baltimore — separate dispatch after probe Q1-A confirms boundary issue (or rules it out).
- Re-classifying any places — separate dispatch after R-Q2-1 spec lands.
- Defining the full Place Intelligence Agent — that is the deliverable in Artifact B.
