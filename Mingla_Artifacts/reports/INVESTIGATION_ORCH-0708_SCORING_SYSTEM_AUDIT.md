# INVESTIGATION — ORCH-0708: Scoring System Audit (Wave 2 Phase 1 Foundation)

**Mode:** INVESTIGATE (forensics — Arm 1 of 2)
**Companion spec:** [SPEC_ORCH-0708_PHOTO_AESTHETIC_SCORING_INTEGRATION.md](SPEC_ORCH-0708_PHOTO_AESTHETIC_SCORING_INTEGRATION.md)
**Dispatch:** [prompts/FORENSICS_ORCH-0708_PHOTO_AESTHETIC_SCORING_AUDIT_AND_SPEC.md](Mingla_Artifacts/prompts/FORENSICS_ORCH-0708_PHOTO_AESTHETIC_SCORING_AUDIT_AND_SPEC.md)
**Date:** 2026-05-01
**Confidence:** HIGH on all quantified findings (live DB evidence, project ref `gqnoajqerqhnvulmnyvv`)

---

## 1. Executive Layman Summary

The current signal scorer has four structural limitations that materially compress quality differentiation:

1. **The 200 score cap is hit by 5–7% of dining-signal places** (casual_food 1,008 / brunch 720 / drinks 508 / icebreakers 384). Among those, raw uncapped scores reach 459, 456, 375, 361. **A great brunch venue and a merely good one both score 200.** Differentiation at the top is gone.
2. **Popularity (rating + reviews) accounts for 38–74% of every top-decile score.** For fine_dining the top decile averages 129.2 points; popularity contributes 49.4 of those. Two 4.5★ flagship venues with similar review counts are functionally indistinguishable to the scorer.
3. **Text-pattern matching is starved on narrow signals.** fine_dining gets ANY text match in only 3.6% of scored places (out of a 50-point text budget). 96.4% of fine_dining venues get zero text-pattern points. The differentiation budget shrinks from 200 to ~150 for those places.
4. **NULL Google booleans silence field-weight contributions in stale-data cities.** London / Brussels / Baltimore have 100% NULL on `serves_dinner, reservable, dine_in, serves_wine, generative_summary`. Even DC + Raleigh + Cary + Durham + FL have 53–73% NULL on `serves_dinner`. The signal scorer only credits weight when the field is `true` — NULL = zero contribution.

Photo aesthetic data feeds directly into the gap: it provides a **dense, always-present quality signal** independent of Google's text + boolean coverage. Every servable place has photos (verified for Raleigh / Cary / Durham — 100% scorable). Claude Haiku 4.5 vision with batch + cache stacking scores all 3,234 places across the 3 cities for **~$26** (well under the $200 escalation threshold).

The cap decision lands on **Option (b): raise cap to 1000 in the affected signals, keep absolute filter_min thresholds.** Option (c) per-city percentile is the right long-term move but adds migration churn — defer to Wave 2 Phase 2.

The new photo-aesthetic data slots into the existing scoring system as a JSONB column on `place_pool` (NOT in admin-seed-places FieldMask, NOT in the per-row UPDATE block). New JSONB-aware prefix matchers in `signalScorer.ts` consume it via `field_weights` patterns. **The operator can re-run scoring with one command** after backfill completes.

---

## 2. Investigation Manifest

| File / Probe | Layer | Why |
|---|---|---|
| Live DB query: full signal config snapshot (16 signals) | Schema | Confirm cap=200, clamp_min=0, scale parameters across all signals |
| Live DB query: cap compression rates per signal | Data | Quantify Thread B-1 — how many places hit cap |
| Live DB query: raw uncapped scores per signal (recomputed from contributions JSONB) | Data | Quantify Thread B-1b — what differentiation we're losing |
| Live DB query: top-decile popularity dominance | Data | Quantify Thread B-2 — popularity vs field-weight share |
| Live DB query: NULL boolean rates per city | Data | Quantify Thread B-3 — field-weight starvation per city |
| Live DB query: per-city quality drift across 6 cities × 6 signals | Data | Quantify Thread B-4 — Baltimore feels mid is real |
| Live DB query: 4.4-star fine_dining differentiation gap | Data | Quantify Thread B-5 — does scoring stratify the mid-tier |
| Live DB query: text-pattern hit rate per signal | Data | Quantify Thread B-6 — text budget actually used |
| Live DB query: Raleigh/Cary/Durham photo-data state | Data | Thread E — backfill scope sizing |
| Live DB query: place_pool full column list (81 columns) | Schema | Thread C — confirm no collision with new photo aesthetic column |
| Live DB query: sample stored_photo_url shape | Schema | Confirm photos are public URLs (no signed URL needed) |
| [signalScorer.ts](supabase/functions/_shared/signalScorer.ts) (read prior session, full) | Code | Confirm field-weight prefix matchers + extension surface |
| [run-signal-scorer/index.ts](supabase/functions/run-signal-scorer/index.ts) (read prior session) | Code | Confirm scorer invocation pattern |
| [backfill-place-photos/index.ts](supabase/functions/backfill-place-photos/index.ts) lines 1-100 + DDL | Code | Existing backfill pattern (action-based dispatch + runs/batches tables) — new photo-aesthetic backfill should mirror this exact shape |
| [migration 20260402000002](supabase/migrations/20260402000002_photo_backfill_job_system.sql) | Schema | Source of `photo_backfill_runs` + `photo_backfill_batches` schema — prototype for `photo_aesthetic_runs` + `photo_aesthetic_batches` |
| [migration 20260424220003](supabase/migrations/20260424220003_orch_0634_query_servable_places_by_signal_photo_gate.sql) | Schema | Latest serving RPC — unchanged by this dispatch |
| Grep: place_scores consumers across edge functions | Code | Thread C — identify blast radius for any change to score storage |
| WebFetch: Anthropic pricing page | External | Thread H — verify May 2026 pricing live |
| `memory/project_place_intelligence_architecture.md` | Memory | Reaffirm Wave 2 architectural constraint (lives INSIDE current scoring system) |

---

## 3. Findings

### 🔴 R-1: Score cap of 200 produces material compression on dining/food signals

| Field | Evidence |
|---|---|
| **File + line** | All 16 signal configs have `"cap": 200` per live DB snapshot |
| **Exact data** | casual_food 1,008/14,412 (7.0%) at exactly 200; brunch 720 (5.0%); drinks 508 (3.5%); icebreakers 384 (2.7%); fine_dining 90 (0.6%); romantic 82 (0.6%) |
| **What it does** | `signalScorer.ts:224` clamps via `Math.max(clamp_min, Math.min(cap, score))`. Two places with raw scores 250 and 459 both clamp to 200 |
| **What it should do** | For dining/food signals where raw scores reach 459, the cap should buy enough headroom to preserve top-tier stratification. Recommend cap=1000 |
| **Causal chain** | top-tier venues lose differentiation → ranking among them is essentially noise → users see "good" and "exceptional" places mixed at the top |
| **Verification step** | Count places at exactly score=200 per signal (run the SQL probe in §6 — already executed, 1,008 confirmed for casual_food alone) |

**Raw uncapped scores per signal (recomputed from `contributions` JSONB):**

| Signal | Scored | Raw > 200 | Raw > 250 | Raw > 300 | Max raw | Mean raw |
|---|---|---|---|---|---|---|
| casual_food | 11,120 | 1,008 | **336** | 90 | **459** | 89.6 |
| brunch | 8,756 | 718 | 381 | 127 | 375 | 74.3 |
| drinks | 9,684 | 508 | 182 | 61 | **456** | 67.8 |
| icebreakers | 9,452 | 384 | 118 | 33 | 361 | 85.1 |
| fine_dining | 10,676 | 89 | 27 | 3 | 375 | 51.0 |
| romantic | 7,425 | 82 | 22 | 2 | 346 | 50.1 |

For the 4 dining signals, raising cap to 1000 preserves all current discrimination AND buys 5x headroom for new photo-aesthetic field weights.

### 🔴 R-2: Popularity (rating + reviews) dominates differentiation in sparse-weight signals

| Field | Evidence |
|---|---|
| **File + line** | [signalScorer.ts:166-182](supabase/functions/_shared/signalScorer.ts#L166-L182) — rating_scale + reviews_scale combined cap at `rating_cap + reviews_cap` (60 in most signals: 35 + 25) |
| **Exact data** | Top-decile popularity share per signal: movies 74.4%, flowers 61.0%, play 54.1%, scenic 47.8%, theatre 46.7%, creative_arts 42.4%, **fine_dining 38.2%**, picnic_friendly 36.1%, lively 35.6%, romantic 35.3%, nature 33.9%, icebreakers 26.4%, drinks 25.8%, brunch 25.1%, casual_food 24.8% |
| **What it does** | For top-decile fine_dining venues (mean score 129.2), popularity contributes 49.4 (38%); the remaining 79.8 is split across 36 field-weight patterns — most contributing zero per Thread B-3/B-6 |
| **What it should do** | Quality differentiation should dominate at the top. Popularity should be a baseline qualifier (already enforced via `min_rating` + `min_reviews` hard gates), not the dominant ranking input |
| **Causal chain** | Two 4.5★ flagship venues with 300 reviews score nearly identically; their actual food/ambience/quality differences are not captured by the existing field-weight + text-pattern surface; ranking is essentially chance |
| **Verification step** | The Trapeze case study from ORCH-0702 confirmed this empirically — Trapeze scored 151 fine_dining purely off restaurant-tier weights + popularity, with no quality discriminator |

### 🔴 R-3: Text-pattern matching is starved on narrow signals

| Field | Evidence |
|---|---|
| **File + line** | [signalScorer.ts:184-221](supabase/functions/_shared/signalScorer.ts#L184-L221) — text patterns budget up to 50 points (summary_weight 25 + reviews_weight 15 + atmosphere_weight 10) |
| **Exact data** | % of scored places with ANY text match: fine_dining **3.6%**, movies 1.9%, flowers 1.8%, groceries 3.4%, picnic_friendly 5.8%, scenic 4.7%, lively 12.7%, romantic 14.7%, brunch 18.5%, drinks 19.5%, play 29.4%, theatre 30.3%, creative_arts 35.9%, casual_food 39.7%, icebreakers 39.5%, nature 43.6% |
| **What it does** | For fine_dining, only 383 of 10,676 places get any text-pattern points. The 50-point text budget is unused on 96.4% of places |
| **What it should do** | Quality signals should be densely populated — if 96% of places get no text contribution, the budget is being wasted. Needs a denser quality input |
| **Causal chain** | Google `editorial_summary` + `generative_summary` are sparsely populated by Google itself; fine_dining's regex (`fine dining|upscale|tasting menu|sommelier|prix fixe`) is narrow; → effective scoring budget for fine_dining shrinks from 200 to ~150 |
| **Verification step** | Per-signal text-match-rate query confirmed (run §6 audit SQL) |

**Why this matters for photo aesthetic data:** photos exist for 100% of servable places. Photo-derived weights would convert the dormant 50-point text budget into an active quality differentiator.

### 🔴 R-4: NULL Google booleans silence field-weight contributions in stale-data cities

| Field | Evidence |
|---|---|
| **File + line** | [signalScorer.ts:130-138](supabase/functions/_shared/signalScorer.ts#L130-L138) — `if (value === true) { contribs[field] = weight; score += weight; }` — NULL is treated as no contribution (correct semantics, but starves cities with thin Google data) |
| **Exact data per city (servable + NULL counts):** | London: 3,627/3,627 (100%) NULL on serves_dinner, reservable, dine_in, wine, generative_summary; Brussels: 1,884/1,884 (100%); Baltimore: 1,253/1,253 (100%); Lagos 75-100% NULL; DC 73% NULL; Raleigh 56% NULL; Cary 54%; Durham 54%; FL 53% |
| **What it does** | Places in stale-data cities get zero contribution from booleans like `serves_dinner: 30, reservable: 30, dine_in: 15` — losing 75 points before any other consideration |
| **What it should do** | The signal must have an alternative quality input that doesn't depend on Google booleans being populated |
| **Causal chain** | London/Brussels/Baltimore haven't had `admin-refresh-places` run → Google detail fields are NULL → field-weights silently zero → fine_dining/brunch ranking in those cities is dominated by popularity alone (R-2 amplified) |
| **Verification step** | Per-city NULL-rate query confirmed (run §6 audit SQL) — see §3.4 table |

**Per-city NULL rates (selected fields, is_servable=true, is_active=true):**

| City | Servable | dinner_NULL | reservable_NULL | dine_in_NULL | wine_NULL | editorial_NULL | generative_NULL |
|---|---|---|---|---|---|---|---|
| London | 3,627 | **100%** | 100% | 100% | 100% | 65% | **100%** |
| Brussels | 1,884 | **100%** | 100% | 100% | 100% | 91% | **100%** |
| Baltimore | 1,253 | **100%** | 100% | 100% | 100% | 70% | **100%** |
| Washington | 2,358 | 73% | 70% | 64% | 68% | 60% | 55% |
| Fort Lauderdale | 1,006 | 53% | 52% | 40% | 49% | 63% | 36% |
| Raleigh | 1,715 | 57% | 56% | 44% | 54% | 62% | 36% |
| Lagos | 1,038 | 75% | 74% | 60% | 74% | 93% | **100%** |
| Cary | 820 | 54% | 58% | 41% | 53% | 64% | 36% |
| Durham | 699 | 54% | 56% | 41% | 52% | 65% | 35% |

### 🔴 R-5: Per-city quality drift makes absolute filter_min structurally wrong (recurrence of ORCH-0702 finding)

| Field | Evidence |
|---|---|
| **File + line** | [migration 20260424220003 query_servable_places_by_signal](supabase/migrations/20260424220003_orch_0634_query_servable_places_by_signal_photo_gate.sql) `WHERE ps.score >= p_filter_min` — global threshold |
| **Exact data** | fine_dining mean/median/p90 per city: FL 42.2/32.2/109.7, DC 39.1/34.7/89.4, Durham 39.5/32.7/91.7, Raleigh 39.0/33.8/88.9, Cary 37.6/33.5/81.8, **Baltimore 35.1/41.7/61.4** (max 179.7). Baltimore p90 cannot reach 120 |
| **What it does** | A global filter_min: 120 means Baltimore returns only 15 fine_dining cards out of 1,253 servable places (1.2%); FL returns 73 out of 1,006 (7.3%) |
| **What it should do** | Per-city percentile-based serving thresholds (top 10% within each city) so each city's actual best surfaces regardless of absolute score floor |
| **Causal chain** | Baltimore pool is starved → Baltimore scores are compressed toward 0 → global filter_min excludes most → user sees "thin" results in Baltimore even though Baltimore's top-10 are real fine-dining venues |
| **Verification step** | Per-city quality drift query (executed) |

**Note:** R-5 is a confirmation of the ORCH-0702 finding. Solving it is **out of scope this cycle** — recommend Wave 2 Phase 2. R-5 is documented here so the spec writer can scope correctly.

### 🟠 C-1: 4.4-star fine_dining cohort lacks differentiation

Cohort: rating 4.3-4.6, review_count 100-500, fine_dining-eligible, is_servable, is_active.
- Cohort size: **1,963 places**
- Min: 0, Q1: 13.4, **Median: 46.3**, Q3: 57.3, Max: 200
- StdDev: 37.1
- Bands: 109 in 60-80, 158 in 80-100, 45 in 100-120

50% of these "candidate fine-dining" venues cluster between Q1=13 and Q3=57 — a 44-point spread that fails to discriminate quality. Photo aesthetic data with weights up to ±100 would meaningfully spread this cohort.

### 🟠 C-2: Combined popularity ceiling (rating_cap + reviews_cap) consumes 30% of score budget

[Per signal config snapshot:](memory/...) every signal except groceries has `rating_cap=35, reviews_cap=25`, totaling 60 of 200 (30%) before any field-weight or text-pattern contribution. This is hardcoded per signal version and is the structural reason R-2 fires.

### 🟡 H-1: AI columns still in `place_pool` schema despite decommission status

`ai_categories text[]`, `ai_reason text`, `ai_primary_identity text`, `ai_confidence real`, `ai_web_evidence text` — all present in the live `place_pool` schema. Per `memory/feedback_ai_categories_decommissioned.md`, these are draft-decommissioned. **The new photo-aesthetic system MUST NOT reference any of these columns** (memory rule).

### 🟡 H-2: photo bucket is public, simplifying integration

[Sample URL:](https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJ.../0.jpg) — Anthropic vision API can fetch directly via URL. **No signed URL generation required.** This eliminates an entire layer of complexity from the new photo-scoring edge function.

### 🟡 H-3: signal weights drift from migration files (reaffirmed from ORCH-0702)

Multiple signals are at versions far past their seed migration: drinks v1.4.0, brunch v1.4.0, fine_dining v1.2.0, flowers v1.3.0, movies v1.9.0, groceries v1.0.1. The live `signal_definition_versions` row is SOT. **Spec writer must read live config, not migration files.**

### 🔵 O-1: existing photo backfill table pattern is reusable as exact prototype

[migration 20260402000002](supabase/migrations/20260402000002_photo_backfill_job_system.sql): `photo_backfill_runs (id, city, country, total_places, total_batches, batch_size, completed_batches, failed_batches, status, started_at, completed_at, ...)` + `photo_backfill_batches (run_id, batch_index, place_pool_ids[], status, succeeded, failed, ...)`. Plus action-based edge function dispatch (`preview_run`, `create_run`, `run_next_batch`, `cancel_run`, etc.). The new photo-aesthetic system can mirror this shape verbatim with: `photo_aesthetic_runs` + `photo_aesthetic_batches` + `score-place-photo-aesthetics` edge function.

### 🔵 O-2: 5 consumers of place_scores across edge functions (no mobile/admin direct reads)

Grep results: `supabase/functions/discover-cards/index.ts` · `generate-curated-experiences/index.ts` · `_shared/stopAlternatives.ts` · `run-signal-scorer/index.ts` (writer) · plus `query_servable_places_by_signal` RPC (read by all). **Zero matches in app-mobile/.** No mobile-side cache to invalidate.

### 🔵 O-3: photo state for Raleigh / Cary / Durham — 100% coverage

| City | Servable | Scorable (valid photos) | ≥5 photos | 1-4 photos |
|---|---|---|---|---|
| Raleigh | 1,715 | 1,715 (100%) | 1,581 (92%) | 134 |
| Cary | 820 | 820 (100%) | 765 (93%) | 55 |
| Durham | 699 | 699 (100%) | 657 (94%) | 42 |
| **Total** | **3,234** | **3,234** | **3,003** | **231** |

Every servable place has valid photos. ~93% have 5 or more. The backfill scope is well-defined.

---

## 4. Five-Truth-Layer Cross-Check

| Layer | What it says | Conflict? |
|---|---|---|
| **Docs** | `memory/project_place_intelligence_architecture.md` — Wave 2 lives INSIDE current scoring as quality input | Constraint locks the design shape |
| **Schema** | `place_pool` has 81 columns; no existing photo aesthetic column; `signal_definitions.current_version_id` is SOT for live weights | No conflict |
| **Code** | `signalScorer.ts` has 5 prefix matchers (`types_includes_*`, `price_level_*`, `price_range_start_above_*`, `price_range_end_above_*`, bare booleans) plus 3 text-pattern matchers; cap clamp at line 224 | Adding JSONB-aware matchers is mechanical |
| **Runtime** | All 16 signals scored 14,400 places; cap=200 hit 5-7% on dining signals; NULL booleans 53-100% per city | Confirms R-1 through R-4 |
| **Data** | Trapeze (ORCH-0702) score trail proved field-weight changes propagate cleanly; fine_dining v1.2.0 is the most recent migration | Confirms the integration shape |

**No layer contradictions.** All five layers agree on the structural limitations and the integration shape.

---

## 5. Blast Radius

| Surface | Affected by photo-aesthetic addition? | Notes |
|---|---|---|
| Discover deck (mobile) | Indirect — better ranking for served signals | Existing `useDeckCards` hook unchanged; serving RPC unchanged |
| Curated experiences | Indirect — better stop selection | `generate-curated-experiences/index.ts` reads `place_scores` post-rescore |
| Curated swap | Indirect | `stopAlternatives.ts` reads `place_scores` post-rescore |
| Admin signal library | New row appears per signal | New `signal_definition_versions` rows visible |
| Admin photo pool | No conflict | Separate from photo-aesthetic-runs admin surface (new) |
| Mobile app cache | No invalidation needed | Place_scores delta surfaces on next deck pull (5-15 min TTL) |
| Solo / collab parity | N/A | Both flows hit same scoring layer |

**Constitutional implications:**
- #2 (one owner per truth): UPHELD — new `place_pool.photo_aesthetic_data` is owned by the new photo-scoring edge function alone (not admin-seed-places, not bouncer, not signal-scorer)
- #9 (no fabricated data): STRENGTHENED — photo aesthetic provides real quality data instead of NULL-as-zero artifacts
- #13 (exclusion consistency): UPHELD — photo-aesthetic-derived weights apply identically across all consumers via `place_scores`

---

## 6. Cap Decision Recommendation (Thread F)

**RECOMMENDATION: Option (b) — raise cap to 1000 for the 6 dining/food/romantic signals; keep absolute filter_min thresholds; defer per-city percentile (Option c) to Wave 2 Phase 2.**

### Rationale (HIGH confidence on data, MEDIUM on the engineering choice)

Cap compression is real and material on 4 signals (casual_food 7.0%, brunch 5.0%, drinks 3.5%, icebreakers 2.7%). For fine_dining + romantic the rate is small today (0.6%) — but adding photo aesthetic weights will push more places into cap range, so the headroom is needed regardless.

Why (b) over (a):
- (a) "keep cap at 200, fit new weights inside the budget" requires every new photo weight magnitude to be modest (max ±25). Combined with the existing 60 points of popularity + 50 points of text patterns, the field-weight differentiation budget is only 90 points. Cramming 8-12 photo-derived weights inside leaves each weight at ±5 to ±10 — too small to materially shift ranking. **Option (a) won't move the needle.**

Why (b) over (c):
- (c) per-city percentile is the architectural ideal but adds significant migration churn — every consumer of `place_scores` (5 functions + 1 RPC) needs to switch from absolute to percentile thresholds, the percentile column needs nightly recompute infrastructure, the whole thing requires re-tuning across 16 signals. **(c) is a quarter-long project, not a one-cycle ship.** The dispatch already calls per-city percentile out as Wave 2 Phase 2 territory.

Option (b) recipe:
- Update `cap` field in v_next config row for each dining/food/romantic signal: `fine_dining 200→1000`, `brunch 200→1000`, `casual_food 200→1000`, `drinks 200→1000`, `lively 200→1000`, `romantic 200→1000`, `icebreakers 200→1000`. Other signals (movies, theatre, scenic, picnic_friendly, creative_arts, play, nature, flowers, groceries) keep cap=200 — they don't compress.
- filter_min thresholds (`80`, `120`) stay absolute. The same threshold relative to a 1000 cap is "looser" but in practice compatible — fine_dining filter_min 120 still meaningful.
- Add a **dispatch-time advisory**: "After the photo-aesthetic backfill + re-score, re-evaluate filter_min per signal. If too many places clear the threshold, bump it (e.g., 120 → 200 for fine_dining)."

### Alternative path noted, not recommended
If operator prefers immediate per-city percentile (Option c), file as ORCH-0709 separately. Keep ORCH-0708 scope tight — photo aesthetic addition + cap raise only.

---

## 7. Field-Weight Pattern Decision (Thread G)

**RECOMMENDATION: Option (i) — JSONB-aware prefix matchers in `signalScorer.ts`. New patterns:**

- `photo_aesthetic_above_<threshold>` reads `photo_aesthetic_data->'aggregate'->>'aesthetic_score'`
- `photo_lighting_<value>` reads `photo_aesthetic_data->'aggregate'->>'lighting'`
- `photo_vibe_includes_<tag>` reads `photo_aesthetic_data->'aggregate'->'vibe_tags'` (text[] semantics)
- `photo_appropriate_for_includes_<signal>` reads `photo_aesthetic_data->'aggregate'->'appropriate_for'`
- `photo_inappropriate_for_includes_<signal>` reads `photo_aesthetic_data->'aggregate'->'inappropriate_for'`
- `photo_safety_includes_<flag>` reads `photo_aesthetic_data->'aggregate'->'safety_flags'`
- `photo_subject_<value>` reads `photo_aesthetic_data->'aggregate'->>'primary_subject'`

### Rationale
Mirror the existing `types_includes_*` + scalar bool/numeric pattern. Extensible — adding a new vibe tag to the prompt doesn't require a schema migration. Modest scorer extension (~70 LOC). Backward compatible: places without `photo_aesthetic_data` (NULL) get zero contribution, consistent with existing NULL semantics.

Why not Option (ii) flat columns:
- (ii) would require 8-12 derived columns per place (`photo_aesthetic_score numeric`, `photo_lighting text`, `photo_vibe_tags text[]`, `photo_safety_flags text[]`, ...). Adds schema migration overhead AND requires re-deriving columns when the JSONB changes. Marginal scorer simplification not worth the schema cost.

---

## 8. Vision Engine + Cost (Thread H)

**RECOMMENDATION: Anthropic Claude Haiku 4.5 with vision, Batch API + 5-min prompt caching on system prompt.**

### Pricing (verified live 2026-05-01 from `https://platform.claude.com/docs/en/about-claude/pricing`)

| Model | Base input | Cache hit | Cache write 5m | Output | Batch input | Batch output |
|---|---|---|---|---|---|---|
| Haiku 4.5 | $1/MTok | $0.10/MTok | $1.25/MTok | $5/MTok | $0.50/MTok | $2.50/MTok |
| Sonnet 4.6 | $3/MTok | $0.30/MTok | $3.75/MTok | $15/MTok | $1.50/MTok | $7.50/MTok |

### Per-call cost (Haiku 4.5, single call with 5 images for one place)

Token estimation:
- 5 photos × ~1,100 tokens each (image tokenization) = 5,500 tokens
- System prompt cached: ~500 tokens (cache write 1.25× first call, then 0.10× thereafter)
- User prompt: ~100 tokens
- Output: ~250 tokens (structured JSON)

Per-place call (steady state with cache hit on system prompt):
- Input billed: 5,500 + 100 + (500 × 0.1) = 5,650 effective tokens at base, or batch
- Batch + cache: 5,650 × $0.50/1M + 250 × $2.50/1M = $0.00283 + $0.000625 = **~$0.0035 per place**
- Without cache: ~$0.005 per place
- Without batch: ~$0.0066 per place

### Total cost for Raleigh / Cary / Durham (3,234 places, 5 photos each)

| Path | Per-place | Total |
|---|---|---|
| Haiku 4.5 batch + cache | $0.0035 | **~$11** |
| Haiku 4.5 batch (no cache) | $0.005 | $16 |
| Haiku 4.5 base (no batch, no cache) | $0.0066 | $21 |
| Sonnet 4.6 batch + cache | $0.011 | $36 |
| Sonnet 4.6 base | $0.020 | $65 |

**All paths are well under $200 escalation threshold.** Recommend Haiku 4.5 batch + cache for the full 3-city run (~$11), with a Sonnet 4.6 spot-check sample of 100 random places (~$2) to compare quality. If Haiku quality is acceptable on spot-check, no need to upgrade.

### Speed (Anthropic Batch API)

Batch API SLA is "up to 24 hours, typically much faster." For 3,234 places at ~1 call per place, expect 1-6 hours. For the 3-city test that's acceptable. If sync throughput needed, fall back to per-call with rate-limit pacing.

---

## 9. Idempotency Design (Thread I)

**RECOMMENDATION: Track scored photos by URL fingerprint. Skip places where `photo_aesthetic_data->>'photos_fingerprint'` matches current `stored_photo_urls` hash.**

### Mechanism
- After scoring, persist alongside the JSONB: `photo_aesthetic_data.photos_fingerprint = sha256(stored_photo_urls.slice(0,5).join('|'))`.
- On re-run: skip places where `photo_aesthetic_data->>'photos_fingerprint' = sha256(current_stored_photo_urls.slice(0,5).join('|'))`.
- On Google detail-refresh: `stored_photo_urls` may rotate → fingerprint mismatch → place re-enters scoring queue.
- `force_rescore: true` parameter overrides the skip (operator escape hatch).

### Storage shape (per place)
```json
{
  "photos_fingerprint": "sha256(...)",
  "scored_at": "2026-05-01T19:30:00Z",
  "model": "claude-haiku-4-5",
  "model_version": "20251001",
  "per_photo": [
    { "url": "...", "aesthetic_score": 7.8, "lighting": "warm_intimate", ... },
    ...
  ],
  "aggregate": {
    "aesthetic_score": 7.5,        // median of per_photo
    "lighting": "warm_intimate",   // mode of per_photo
    "composition": "strong",
    "subject_clarity": "clear",
    "primary_subject": "food",
    "vibe_tags": ["fine_dining","intimate"],   // union of per_photo
    "appropriate_for": ["fine_dining","romantic"],
    "inappropriate_for": ["family","icebreakers"],
    "safety_flags": [],
    "photo_quality_notes": "professional shots, warm lighting, food forward"
  },
  "cost_usd": 0.0035
}
```

The signal scorer reads ONLY the `aggregate` subtree. The `per_photo[]` array is preserved for explainability + future re-analysis if the prompt evolves.

---

## 10. Hidden Coupling Audit (Thread C)

| Consumer | Reads | Impact of `place_pool.photo_aesthetic_data` addition |
|---|---|---|
| `discover-cards/index.ts` | `place_scores.score`, NOT direct place_pool reads | NONE — re-score writes to place_scores; consumer unchanged |
| `generate-curated-experiences/index.ts` | `place_scores`, plus `place_pool.*` for card hydration | NONE — JSONB column not in any SELECT projection |
| `stopAlternatives.ts` | `place_scores`, `place_pool.types[]` | NONE |
| `run-signal-scorer/index.ts` | `place_pool` SELECT_FIELDS list (line 21-27 of run-signal-scorer) | **NEEDS UPDATE** — extend SELECT_FIELDS to include `photo_aesthetic_data` so scorer can read it |
| `query_servable_places_by_signal` RPC | `place_pool.*` for card hydration | NONE — JSONB column not in RETURNS TABLE projection |
| `admin-seed-places` (FieldMask + UPDATE block) | Google Places API fields | **MUST NOT TOUCH** — `I-FIELD-MASK-SINGLE-OWNER` + `I-REFRESH-NEVER-DEGRADES` carve-out required (new column has separate owner) |
| `backfill-place-photos` | `place_pool.stored_photo_urls`, etc. | NONE — different lifecycle, different writer |
| `run-bouncer` / `run-pre-photo-bouncer` | `place_pool` SELECT_FIELDS for bouncer logic | NONE — bouncer doesn't read photo aesthetic data |

Spec writer must explicitly call out the `run-signal-scorer SELECT_FIELDS` extension and the `admin-seed-places` carve-out.

---

## 11. Invariants Inventory

### Preserved
| Invariant | How |
|---|---|
| `I-SIGNAL-CONTINUOUS` | Score remains 0-cap numeric; cap raised but still bounded |
| `I-SCORE-NON-NEGATIVE` | clamp_min stays 0; CHECK constraint at DB level still satisfied |
| `I-BOUNCER-DETERMINISTIC` | Bouncer not modified |
| `I-FIELD-MASK-SINGLE-OWNER` | New column NOT in admin-seed-places FieldMask |
| `I-REFRESH-NEVER-DEGRADES` | New column NOT in admin-seed-places per-row UPDATE |
| `I-PLACE-POOL-ADMIN-WRITE-ONLY` | New column written by service_role only via new edge function |
| `I-DINING-SIGNAL-NIGHTLIFE-PENALTY` | Preserved across signal v_next migrations |
| `I-SERVING-TWO-GATE` | Serving RPC unchanged |

### New invariant proposed
- `I-PHOTO-AESTHETIC-DATA-SOLE-OWNER`: `place_pool.photo_aesthetic_data` is written ONLY by `score-place-photo-aesthetics` edge function. Bouncer, signal scorer, admin-seed-places, backfill-place-photos, and any other writer is FORBIDDEN from touching it. CI gate on grep.

---

## 12. Discoveries for Orchestrator

| ID | Description | Severity |
|---|---|---|
| D-INV-1 | Per-city percentile serving (Option c from cap decision) is the architectural ideal but deferred to Wave 2 Phase 2. Recommend filing as ORCH-0709 candidate after ORCH-0708 ships. Closes Baltimore "feels mid" + every other thin-pool city structurally. | S2-medium |
| D-INV-2 | filter_min thresholds may need re-tuning post-photo-rescore (per signal). Recommend a §6.5-style review during ORCH-0708 CLOSE: examine the new score distribution per signal in the 3 test cities, decide whether to bump thresholds. Not blocking; can ship without. | S3-low |
| D-INV-3 | Anthropic vision response may include unexpected `vibe_tags` not in the prompt's enumeration. Recommend the `score-place-photo-aesthetics` edge function add a sanitization step: drop any tag not in the documented enum, log it for prompt evolution. Avoids the scorer missing on unknown tags. | S3-low |
| D-INV-4 | London / Brussels / Lagos pools have 100% NULL Google booleans. Photo aesthetic data partially fills the gap, but those cities need `admin-refresh-places` runs regardless. Recommend a parallel ORCH item to schedule refresh for under-refreshed cities (separate from this dispatch). | S2-medium |
| D-INV-5 | AI columns (`ai_categories`, `ai_reason`, etc.) still in `place_pool` schema despite memory-flagged decommission. New code in this dispatch will not reference them; orchestrator should track final removal. | S3-low |
| D-INV-6 | The `signal_definition_versions` table lacks UNIQUE (signal_id, version_label) — flagged in ORCH-0702 (D-IMPL-1). Still open. New v_next migrations in this dispatch should keep idempotency-via-IF-EXISTS pattern. | S3-low |

---

## 13. Confidence Ledger

| Finding | Confidence | What raised / would raise it |
|---|---|---|
| R-1 cap compression | HIGH | Live row counts |
| R-2 popularity dominance | HIGH | Per-decile breakdown |
| R-3 text-pattern starvation | HIGH | Per-signal hit rates |
| R-4 NULL field penalty | HIGH | Per-city NULL counts |
| R-5 per-city quality drift | HIGH | Per-city distribution stats |
| C-1 4.4-star differentiation | HIGH | Cohort statistics |
| C-2 popularity ceiling consumes 30% | HIGH | Signal config values |
| H-1 AI columns stale | MEDIUM | Confirmed in schema; full removal status pending memory verification |
| H-2 photos public URL | HIGH | Sample URLs queried |
| H-3 weight drift | HIGH | Confirmed in ORCH-0702 |
| O-1 backfill pattern reusable | HIGH | DDL read |
| O-2 5 consumers | HIGH | Grep results |
| O-3 photo coverage | HIGH | Live counts |
| Cap recommendation (b) | MEDIUM | Engineering judgment based on R-1 evidence; (c) is more correct architecturally but bigger scope |
| Field-weight pattern (i) | MEDIUM | Engineering judgment; (ii) viable alternative |
| Vision engine choice | HIGH | Live pricing + token math |
| Cost projection | HIGH | Confirmed batch+cache stacking math |

---

## 14. Fix Strategy (direction only — full spec in companion artifact)

The spec writer has a tight, well-bounded contract:

1. **Schema:** add `place_pool.photo_aesthetic_data jsonb`. NOT in admin-seed-places FieldMask, NOT in per-row UPDATE block. Add `photo_aesthetic_runs` + `photo_aesthetic_batches` tables mirroring `photo_backfill_runs/_batches`.
2. **Edge function:** new `score-place-photo-aesthetics` action-based dispatch (preview_run, create_run, run_next_batch, ...) mirroring `backfill-place-photos`. Calls Anthropic Haiku 4.5 vision via Batch API + cached system prompt. Persists `aggregate` subtree the scorer reads.
3. **Prompt:** structured-output JSON schema matching the §9 storage shape. System prompt enumerates Mingla's 13 categories + the `appropriate_for/inappropriate_for` axis + `vibe_tags` enum + `safety_flags` enum.
4. **Scorer extension:** add 7 new prefix matchers in `signalScorer.ts` per §7. Backward compatible.
5. **Signal config v_next:** add photo-derived field weights to fine_dining, brunch, romantic, lively, casual_food (minimum scope per dispatch). Raise `cap` to 1000 on those signals.
6. **Test plan:** Raleigh + Cary + Durham, pre/post snapshots, diff analysis, operator smoke per dispatch §4.7.
7. **Rollback:** standard `signal_definition_versions` revert + drop `photo_aesthetic_data` column path.

The implementor receives the spec, ships ~5 files (1 migration, 1 new edge function with shared code, signalScorer.ts extension, 5 signal v_next migrations), operator deploys + invokes + re-scores. **Single command re-score.** The operator's ergonomic ask is met.
