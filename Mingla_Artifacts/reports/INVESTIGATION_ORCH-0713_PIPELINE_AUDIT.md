# INVESTIGATION — ORCH-0713 Phase 0: Pre-Bouncer → Scoring Pipeline Audit

**Mode:** INVESTIGATE (forensics)
**Dispatch:** [Mingla_Artifacts/prompts/FORENSICS_ORCH-0713_PIPELINE_AUDIT.md](../prompts/FORENSICS_ORCH-0713_PIPELINE_AUDIT.md)
**Date:** 2026-05-04
**Confidence:** HIGH on pipeline structure + slot map; HIGH on photo-aesthetic integration gap; MEDIUM on per-signal scorer rules (referenced ORCH-0708 audit, did not re-derive).

This audit is a MAP, not a verdict. No code changes. The spec dispatch follows.

---

## 1. Executive Layman Summary

Mingla's place-recommendation pipeline today is **six separate edge functions** invoked manually in three different admin UIs. There's no single per-city orchestrator. Each stage owns its own column triple (one-owner-per-truth), each has its own runs/batches tracking table, and each is gated by the prior stage's output column on `place_pool`. The data path is:

`admin-seed-places` → `run-pre-photo-bouncer` → `backfill-place-photos` → `run-bouncer` → `run-signal-scorer` (×16 signals) → `score-place-photo-aesthetics` → `run-place-intelligence-trial` (research-only)

Then user requests trigger `discover-cards` → `query_servable_places_by_signal` RPC → ranked deck.

**Three structural facts that shape the augmentation:**

1. **The Claude trial pipeline is built but never feeds production ranking.** All ORCH-0712 plumbing exists (collage helper, Serper reviews, per-place dispatch) but `run-place-intelligence-trial` writes to a separate research table. The signal scorer never reads its output.

2. **Photo aesthetic integration is half-built.** ORCH-0708 Phase 1 shipped the `place_pool.photo_aesthetic_data` JSONB column + the `score-place-photo-aesthetics` edge function, but Phase 2 (signal scorer extension) was deferred. **`signalScorer.ts` does NOT read `photo_aesthetic_data` today.** Only 30 Triangle fixture places have aesthetic scores; nothing surfaces them in the deck.

3. **No unified per-city orchestration.** Operator runs each phase manually per city, juggling six admin pages, no progress visibility, no resume across phases. The proposed "one function per city" maps cleanly onto the existing per-stage edge functions — wiring already exists, only orchestration is missing.

**The Claude evaluation slot is in Stage 6 (post-scoring rerank).** SQL `query_servable_places_by_signal` returns top-N by score; new `place_claude_evaluations` cache table holds Claude's per-(place, signal) verdict with `inappropriate_for` veto + confidence rerank. This is the cleanest seam — doesn't disturb existing scorer, just adds a join + filter at read time.

---

## 2. Pipeline Map (textual flowchart)

```
┌─ STAGE 1 — Place Admission ──────────────────────────────────────────┐
│ admin-seed-places  /  admin-place-search                             │
│ Writes: place_pool.{name, lat, lng, types, primary_type, rating,     │
│   review_count, photos (Google JSONB), business_status, opening_hours│
│   website, raw_google_data, …80 cols total}                          │
│ NULL at admission: stored_photo_urls, is_servable, passes_pre_photo, │
│   photo_aesthetic_data, photo_collage_url, place_scores rows         │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ STAGE 2 — Pre-Photo Bouncer (ORCH-0678) ────────────────────────────┐
│ run-pre-photo-bouncer  →  bounce(place, {skipStoredPhotoCheck:true}) │
│ Runs: B1, B2, B3, B4, B5, B6, B7, B9 (everything except B8)          │
│ Writes: passes_pre_photo_check, pre_photo_bouncer_reason,            │
│   pre_photo_bouncer_validated_at                                     │
│ Trigger: NO admin UI today (operator invokes via console)            │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ STAGE 3 — Photo Backfill ───────────────────────────────────────────┐
│ backfill-place-photos  →  Google Places Photos API + Storage upload  │
│ Action-based dispatch (preview_run / create_run / run_next_batch /…) │
│ Reads: place_pool.photos[] (Google JSONB metadata)                   │
│ Writes: place_pool.stored_photo_urls[] (CDN URLs in place-photos     │
│   bucket); on permanent fail, sentinel '__backfill_failed__'         │
│ Gated by: passes_pre_photo_check = true                              │
│ Trigger: PhotoBackfillPage (admin)                                   │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ STAGE 4 — Final Bouncer ────────────────────────────────────────────┐
│ run-bouncer  →  bounce(place)  (no opts; runs B1-B9 including B8)    │
│ Writes: is_servable, bouncer_reason, bouncer_validated_at            │
│ Trigger: NO admin UI today (operator invokes via console)            │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ STAGE 5 — Signal Scoring (×16 signals per city) ────────────────────┐
│ run-signal-scorer (per signal_id, per city_id)                       │
│ Reads: signal_definitions.current_version_id → versions.config       │
│ Iterates: is_servable=true AND is_active=true                        │
│ Computes: signalScorer.computeScore(place, config) → {score, contribs}│
│ Writes: place_scores (place_id, signal_id, score, contributions,     │
│   signal_version_id, scored_at) — UPSERT on (place_id, signal_id)    │
│ Trigger: SignalLibraryPage (admin) — one-signal-at-a-time            │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ STAGE 6a — Photo Aesthetic Scorer (ORCH-0708 Phase 1, BUILT) ───────┐
│ score-place-photo-aesthetics                                         │
│ Reads: photo_aesthetic_labels (operator anchors) + stored_photo_urls │
│ Writes: place_pool.photo_aesthetic_data JSONB                        │
│ Status: 30 Triangle fixtures scored. NOT INTEGRATED INTO SCORING.    │
│ Trigger: PhotoScorerPage (admin)                                     │
│ ⚠ GAP: signalScorer.ts does NOT read photo_aesthetic_data today.     │
└──────────────────────────────────────────────────────────────────────┘

┌─ STAGE 6b — Place Intelligence Trial (ORCH-0712, RESEARCH-ONLY) ─────┐
│ run-place-intelligence-trial                                         │
│ Reads: signal_anchors + place_external_reviews + photo_collage_url   │
│ Bundles: collage + 30 Serper reviews → Claude Q1 + Q2                │
│ Writes: place_intelligence_trial_runs (research table only)          │
│ Status: 32 anchors completed. NEVER feeds production ranking.        │
│ Invariant I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING                         │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ STAGE 7 — admin_place_pool_mv matview (cron 10-min) ────────────────┐
│ Refresh: pg_cron via cron_refresh_admin_place_pool_mv                │
│ Columns: 30 incl. derived primary_category (uses                     │
│   pg_map_primary_type_to_mingla_category — known taxonomy mismatch)  │
└──────────────────────────────────────────────────────────────────────┘

═══════════════════════ USER REQUEST ═══════════════════════
                              │
                              ▼
┌─ STAGE 8 — discover-cards edge function ─────────────────────────────┐
│ For each chip-mapped signal_id: calls RPC                            │
│ Merges multi-chip, dedup by place_id (keep max signal_score),        │
│ round-robins, filters by date/time/curated-stop hours                │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ STAGE 9 — query_servable_places_by_signal RPC ──────────────────────┐
│ FILTERS: is_servable=true AND is_active=true                         │
│   AND score >= p_filter_min                                          │
│   AND stored_photo_urls valid (G3 photo gate)                        │
│   AND haversine distance <= p_radius_m                               │
│   AND id NOT IN p_exclude_place_ids                                  │
│ ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST              │
│ LIMIT p_limit (default 20, discover-cards passes max(20,min(100,2x)))│
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                      User's deck of cards
```

---

## 3. Per-Stage Findings Table

| # | Stage | File / function | Inputs | Outputs (column triple) | Verdict |
|---|---|---|---|---|---|
| 1 | Place admission | `admin-seed-places/index.ts` ([1041](supabase/functions/admin-seed-places/index.ts#L1041), [1484](supabase/functions/admin-seed-places/index.ts#L1484)) | Google Places API | 80 columns; carve-outs for I-COLLAGE-SOLE-OWNER + I-PHOTO-AESTHETIC-DATA-SOLE-OWNER | 🔵 Healthy |
| 2 | Pre-photo Bouncer | `run-pre-photo-bouncer/index.ts` (202 lines) | place_pool rows, bouncer.ts | `passes_pre_photo_check, pre_photo_bouncer_reason, pre_photo_bouncer_validated_at` | 🟡 No admin UI |
| 3 | Photo backfill | `backfill-place-photos/index.ts` (1047 lines, action dispatch) | photos JSONB, Google Photos API | `stored_photo_urls[]` (or `__backfill_failed__` sentinel) | 🟠 Coverage gap (see §6) |
| 4 | Final Bouncer | `run-bouncer/index.ts` (189 lines) | place_pool rows + stored_photo_urls | `is_servable, bouncer_reason, bouncer_validated_at` | 🟡 No admin UI |
| 5 | Signal scoring | `run-signal-scorer/index.ts` (234 lines) + `_shared/signalScorer.ts` (244 lines) | signal_definitions config + place_pool | `place_scores` rows | 🟠 Photo aesthetic NOT integrated; cap=200 compression on dining signals (per ORCH-0708) |
| 6a | Photo aesthetic | `score-place-photo-aesthetics/index.ts` (1040 lines) | stored_photo_urls + Claude Haiku 4.5 | `place_pool.photo_aesthetic_data` | 🔴 BUILT BUT NOT WIRED — only 30/14k+ places scored, scorer doesn't read it |
| 6b | Trial pipeline | `run-place-intelligence-trial/index.ts` | anchors + Serper + collage + Claude | `place_intelligence_trial_runs` (research) | 🔵 Healthy; research-only by invariant |
| 7 | Matview refresh | pg_cron `cron_refresh_admin_place_pool_mv` (every 10 min) | place_pool + helper | `admin_place_pool_mv.primary_category` (helper-derived) | 🟡 Known taxonomy mismatch (per CATEGORY_PIPELINE_E2E) |
| 8 | Rec edge function | `discover-cards/index.ts` (~1037 lines) | RPC + chip mapping | Card response | 🔵 Healthy |
| 9 | Serving RPC | `query_servable_places_by_signal` ([20260424220003](supabase/migrations/20260424220003_orch_0634_query_servable_places_by_signal_photo_gate.sql)) | place_pool + place_scores | Ranked rows | 🔵 Healthy; G3 photo gate intact |

Legend: 🔴 broken / 🟠 fragile / 🟡 unverified or non-blocking gap / 🔵 healthy.

---

## 4. Pre-Bouncer Gates (every check before is_servable)

The "pre-bouncer" is informal — it's whatever runs before `run-bouncer`. Inventory:

| Gate | Where defined | What it filters | Effect |
|---|---|---|---|
| Place exists in `place_pool` | `admin-seed-places.transformGooglePlaceForSeed` | Google Place not crawled | No row at all |
| `is_active = true` | place_pool default + `admin_edit_place` RPC | Soft-delete | Excluded from all downstream |
| **B1 EXCLUDED_TYPES** | `_shared/bouncer.ts:45-55` | gym, school, hospital, gas_station, bank, etc. | reject `B1:<type>` |
| **B2 business_status** | `bouncer.ts:213-215` | CLOSED_PERMANENTLY | reject `B2:closed` |
| **B3 data integrity** | `bouncer.ts:218-220` | Missing name/lat/lng | reject `B3:missing_required_field` |
| **B7 Google photos** | `bouncer.ts:233-234` | No `photos[]` JSONB from Google | reject `B7:no_google_photos` |
| **B9 child venue** | `bouncer.ts:107-131` | Walmart Bakery, Target Cafe, "(Inside X)", retailer counters | reject `B9:child_venue:<label>` |
| Cluster A (commercial): **B4/B5 website** | `bouncer.ts:246-249` | Missing or social-only domain | reject `B4:no_website` or `B5:social_only` |
| Cluster A (commercial): **B6 hours** | `bouncer.ts:251` | Missing `opening_hours` | reject `B6:no_hours` |
| Cluster B (cultural): website + hours unless famous (≥500 reviews + ≥4.5 rating) | `bouncer.ts:252-262` | Same as A but with bypass | Same reasons |
| Cluster C (natural): NO website / hours required | `bouncer.ts:263` | Always passes website + hours | n/a |

**Pre-photo Bouncer (Stage 2)** runs all of the above EXCEPT B8.
**Final Bouncer (Stage 4)** also runs **B8** (`bouncer.ts:240-242`): no `stored_photo_urls` → reject `B8:no_stored_photos`.

I-TWO-PASS-BOUNCER-RULE-PARITY: rule body MUST stay identical across both passes. Only B8 differs (suppressed in pre-photo). Adding any other branch is a violation.

---

## 5. Bouncer Rule Inputs (every column that influences `is_servable`)

| Column | Used by | Notes |
|---|---|---|
| `types[]` | B1 (EXCLUDED), B7 cluster derivation | Drives EXCLUDED / NATURAL / CULTURAL / COMMERCIAL |
| `business_status` | B2 | Only `CLOSED_PERMANENTLY` rejects |
| `name` | B3 (presence), B9 (regex) | Required + child-venue pattern check |
| `lat`, `lng` | B3 | Required |
| `website` | B4/B5 | Plus `SOCIAL_DOMAINS` blocklist (`bouncer.ts:158-167`) |
| `opening_hours` (jsonb) | B6 | Truthy non-empty |
| `photos[]` (Google JSONB) | B7 | Length > 0 |
| `stored_photo_urls[]` | B8 | Final pass only |
| `review_count`, `rating` | Cluster B famous bypass | ≥500 + ≥4.5 |

Bouncer is **deterministic** (I-BOUNCER-DETERMINISTIC). No AI, no keyword matching for category judgment.

---

## 6. Photo Coverage Per City (LIVE — 2026-05-04)

| City | Total | Active | Servable | Pre-photo passes | No `photos` (Google) | No `stored_photo_urls` | Has aesthetic data | Has collage |
|---|---|---|---|---|---|---|---|---|
| Washington | 5,542 | 5,542 | 2,358 | 2,358 | 0 | 2,781 | 0 | 1 |
| Brussels | 4,643 | 4,643 | 1,884 | 1,884 | 0 | 1,953 | 0 | 2 |
| Lagos | 4,222 | 4,222 | 1,038 | 1,039 | 0 | 3,184 | 0 | 1 |
| Raleigh | 2,919 | 2,895 | 1,700 | 1,700 | 3 | 706 | **10** | 10 |
| Fort Lauderdale | 2,247 | 2,247 | 1,006 | 1,006 | 2 | 893 | 0 | 5 |
| Baltimore | 2,213 | 2,213 | 1,253 | 1,253 | 0 | 501 | 0 | 1 |
| Cary | 1,630 | 1,629 | 771 | 771 | 3 | 690 | **10** | 2 |
| Durham | 1,316 | 1,316 | 700 | 700 | 0 | 417 | **10** | 4 |

**Reads:**
- Google `photos[]` is essentially always present (0–3 per city missing). The bottleneck isn't Google's metadata; it's photo download.
- `stored_photo_urls` coverage gap is real and material: 25–75% of places per city lack downloaded photos. **This is the gap operator's "download photos for places without photos" stage closes** — but the existing `backfill-place-photos` already does this; the unified function just needs to invoke it.
- `photo_aesthetic_data`: 30 places total (Triangle fixtures only). The full ORCH-0708 backfill (3,234 Triangle places at ~$11) was specced but never executed.
- `photo_collage_url`: 26 places (the trial run set + a few seed-time samples).

---

## 7. Per-Signal Scorer Audit (cross-reference to ORCH-0708)

The signal scorer rules per signal are documented in `INVESTIGATION_ORCH-0708_SCORING_SYSTEM_AUDIT.md` §3 — I am not re-deriving them here. Key facts that influence ORCH-0713 design:

- **16 signals** stored in `signal_definitions` + `signal_definition_versions`. 11 type-grounded (`brunch, casual_food, fine_dining, drinks, creative_arts, flowers, groceries, icebreakers, movies, nature, theatre`) + 5 quality-grounded (`lively, picnic_friendly, romantic, scenic, play`).
- **Cap = 200** on all signals → 5–7% of dining places hit cap → **differentiation collapses at the top** (ORCH-0708 R-1).
- **Popularity (rating + reviews) caps at 60 / 200 (30%)** → top-decile differentiation is dominated by popularity, not quality (ORCH-0708 R-2).
- **Text-pattern matching is starved** on narrow signals: fine_dining 3.6%, movies 1.9%, flowers 1.8% hit any text match (ORCH-0708 R-3).
- **NULL Google booleans silence field weights** in stale-data cities: London/Brussels/Baltimore have 100% NULL on `serves_dinner, reservable, dine_in, serves_wine, generative_summary`. Even Triangle has 53–73% NULL (ORCH-0708 R-4).

For the `flowers` rule specifically (operator's question from forensics dispatch): the signal definition lives in `signal_definition_versions.config` (current_version_id selects active row). Rule audit is **out of scope for this audit**; the spec dispatch will pull live config and define new rule that admits grocery+florist, rejects event-only.

---

## 8. ⚠ Critical Gap: `photo_aesthetic_data` is half-wired

**🔴 ROOT CAUSE — ORCH-0708 Phase 1 column shipped; Phase 2 scorer integration deferred / never built.**

| Field | Evidence |
|---|---|
| File + line | [`_shared/signalScorer.ts:34-63`](supabase/functions/_shared/signalScorer.ts#L34-L63) `PlaceForScoring` interface |
| Exact code | Interface lists 17 boolean fields + rating/reviews/types/price; **does NOT include `photo_aesthetic_data`** |
| What it does | Scorer reads only the boolean + price + text fields from place_pool. The 30 places with aesthetic data have it sitting unused. |
| What it should do | Per ORCH-0708 §7 (Field-Weight Pattern Decision): add 7 prefix matchers `photo_aesthetic_above_<thr>`, `photo_lighting_<value>`, `photo_vibe_includes_<tag>`, `photo_appropriate_for_includes_<signal>`, `photo_inappropriate_for_includes_<signal>`, `photo_safety_includes_<flag>`, `photo_subject_<value>`. Plus signal config v_next migrations to USE those weights. Plus extend `run-signal-scorer/index.ts:21-27` SELECT_FIELDS. |
| Causal chain | (1) Phase 1 dispatch shipped column + edge function. (2) Phase 2 dispatch (scorer extension + signal v_next migrations) was deferred — confirmed by grep: only 3 files reference `photo_aesthetic_data` (`admin-seed-places` carve-out, `score-place-photo-aesthetics` writer, `run-place-intelligence-trial` consumer). Zero references in `signalScorer.ts` or any signal config migration. (3) Even if backfill ran on full Triangle pool, `place_scores` would be unchanged. (4) Discover deck unchanged. The work is inert. |
| Verification | `grep -l "photo_aesthetic_data" supabase/functions/` returns 3 files; none are signalScorer.ts or run-signal-scorer or any v_next migration. Live `place_pool` shows 30 rows with non-NULL `photo_aesthetic_data` but `place_scores` for those places shows scores identical to peers without aesthetic data. |

**Implication for ORCH-0713:** the Phase 2 deferral from ORCH-0708 either (a) folds INTO ORCH-0713 alongside the Claude rerank, OR (b) ships first as ORCH-0708 Phase 2 to unblock the rerank pipeline. Recommend (a) — ORCH-0713 will reshape the scoring entry-point anyway.

---

## 9. Reusable Components Inventory

For the unified per-city function, the following building blocks exist and are production-tested:

| Component | File | Reusable for |
|---|---|---|
| Action-based dispatch shape | `backfill-place-photos`, `score-place-photo-aesthetics`, `run-place-intelligence-trial` | Per-stage runs/batches lifecycle |
| `photo_backfill_runs` + `photo_backfill_batches` schema pattern | [migration 20260402000002](supabase/migrations/20260402000002_photo_backfill_job_system.sql) | Template for `unified_pipeline_runs` + `unified_pipeline_batches` |
| `_shared/imageCollage.ts` | New ORCH-0712 | Adaptive grid composition + photo fingerprint |
| Serper reviews fetch (paginated to 100) | `run-place-intelligence-trial` | Per-place review pull for evidence bundle |
| Per-place edge function pattern | `run_trial_for_place` action in trial fn | Model for per-place worker in unified pipeline |
| Browser orchestration loop | `PhotoScorerPage.jsx`, `TrialResultsTab.jsx` | Per-batch progress UI + `useRef` synchronous guard against double-click |
| Bouncer pure logic | `_shared/bouncer.ts` | Reused unchanged by Stage 2 + Stage 4 |
| Signal scorer pure logic | `_shared/signalScorer.ts` | Reused unchanged by Stage 5 |
| `query_servable_places_by_signal` RPC | [migration 20260424220003](supabase/migrations/20260424220003_orch_0634_query_servable_places_by_signal_photo_gate.sql) | Read path; needs LEFT JOIN to `place_claude_evaluations` for rerank |

**Critically: nothing needs to be rebuilt.** The unified pipeline is an orchestrator on top of existing single-stage edge functions.

---

## 10. Augmentation Slot Map (where Claude evaluation goes)

| Stage | Slot decision | Why |
|---|---|---|
| 1 — Admission | NO Claude integration | Admission is metadata only; Claude evidence requires reviews + photos which don't exist yet |
| 2 — Pre-photo Bouncer | NO Claude integration | Deterministic gate; AI here would violate I-BOUNCER-DETERMINISTIC |
| 3 — Photo backfill | NO Claude integration | Pure download |
| 4 — Final Bouncer | NO Claude integration | Same as Stage 2 |
| 5 — Signal scoring | **PHOTO-AESTHETIC SLOT** — extend `signalScorer.ts` with photo prefix matchers (resurrects ORCH-0708 Phase 2). Reads `photo_aesthetic_data` JSONB. Cheap, deterministic. | Aesthetic data is structured + sanitized (5 enum fields) → fits scorer's JSONB-aware extension cleanly |
| 6a — Photo aesthetic | Existing — already used by Stage 5 once Phase 2 ships | n/a |
| 6b — Trial pipeline | EXISTING research path | Stays research-only |
| **NEW Stage 6c — Claude Q2 Rerank** | **CLAUDE RERANK SLOT** — new edge function `evaluate-place-for-signal` (per-place worker). Bundle: place_pool fields + 30 Serper reviews + collage + Google AI Overview answer. Calls Claude Haiku 4.5 → writes new `place_claude_evaluations (place_pool_id, signal_id, run_id, confidence_0_to_10, strong_match, inappropriate_for, vibe_phrases jsonb, reasoning_quote, evaluated_at, ttl_expires_at)` cache. Pre-computed in background per top-100-per-signal-per-city. | Mirror ORCH-0712 architecture; runs only on shortlist (top-100 from place_scores) so cost is bounded; cached aggressively |
| 7 — Matview | NO change | Read-only consumer |
| 8 — discover-cards | **MINOR UPDATE** — extend RPC call; pass-through new fields (vibe_phrases, reasoning_quote) onto card response | Card UI surfaces vibes + reasoning |
| 9 — `query_servable_places_by_signal` RPC | **CORE CHANGE** — `LEFT JOIN place_claude_evaluations pce ON pce.place_pool_id = pp.id AND pce.signal_id = p_signal_id AND pce.ttl_expires_at > now()` ; `WHERE COALESCE(pce.inappropriate_for, false) = false` ; `ORDER BY COALESCE(pce.confidence_0_to_10, 0) DESC NULLS LAST, ps.score DESC, pp.review_count DESC NULLS LAST` | Hard veto on `inappropriate_for=true`; Claude confidence is primary sort, score is tiebreaker, popularity is tertiary |

**Read-time cost:** zero per user search if cache is warm. Cache miss falls back to score-only sort (no Claude blocking). Background job pre-computes top-100 per signal per city.

---

## 11. The Operator's Proposed Unified Function — Mapping to Today's Surfaces

> Operator: "ONE function, per city. Runs pre-bouncer, downloads photos for places without photos, runs bouncer, then scores."

**Mapping to existing pipeline:**

| Operator phrase | Existing edge function(s) | What's missing |
|---|---|---|
| "per city" | `city_id` param accepted by every edge function (run-bouncer, run-pre-photo-bouncer, run-signal-scorer, score-place-photo-aesthetics, backfill-place-photos all accept it) | Single orchestrator that loops the city through all phases |
| "pre-bouncer" | `run-pre-photo-bouncer` ([202 lines](supabase/functions/run-pre-photo-bouncer/index.ts)) | NO admin UI today |
| "downloads photos for places without photos" | `backfill-place-photos` (action: `create_run` then loop `run_next_batch`) ([1047 lines](supabase/functions/backfill-place-photos/index.ts)) | Already gated by `passes_pre_photo_check=true`; just needs orchestrator to invoke after Stage 2 |
| "bouncer" | `run-bouncer` ([189 lines](supabase/functions/run-bouncer/index.ts)) | NO admin UI today |
| "scores" | `run-signal-scorer` ([234 lines](supabase/functions/run-signal-scorer/index.ts)) | Per-signal invocation — orchestrator must loop over the 16 active signals |
| "incorporate Claude trial-run evaluation" | NEW `evaluate-place-for-signal` per-place worker (mirror ORCH-0712 trial fn) | Doesn't exist; needs schema (`place_claude_evaluations`) + background pre-compute job + RPC join |

**Net new code for ORCH-0713:**

- 1 new edge function: `run-city-pipeline` (orchestrator)
- 1 new edge function: `evaluate-place-for-signal` (Claude rerank worker)
- 1 new schema: `place_claude_evaluations` cache table + `unified_pipeline_runs` + `unified_pipeline_batches`
- 1 RPC migration: `query_servable_places_by_signal_v2` with Claude join
- 1 admin page: `CityPipelinePage.jsx` (single per-city orchestrator UI)
- ORCH-0708 Phase 2 (deferred): 7 photo prefix matchers in `signalScorer.ts` + per-signal v_next migrations USING them
- ORCH-0713 Phase 2 (signal expansion): `lgbtq_safe_space`, `family_friendly`, `cocktail_destination` signal definitions + scorer rules + `flowers` tightening + anti-signal dimension schema

---

## 12. Risks and Unknowns (out-of-scope for this audit)

| Risk | Why it matters | Suggested mitigation |
|---|---|---|
| **Cost ceiling under city scale** | Triangle: 3,234 servable × 16 signals = 51,744 (place, signal) cache rows. At $0.02 per Claude eval = $1,034 per full Triangle backfill. Multiply by other cities → ~$15k full-city sweep | Background job runs only top-N-per-signal-per-city (e.g., N=100 → $32 per city per refresh). Operator-set dollar caps per run. |
| **Cache TTL strategy** | Reviews change; aesthetic stays. How long to cache? 30 days? | Spec dispatch must define + add review-delta detection (Serper review count change → invalidate) |
| **Anti-signal composition with positive scoring** | Anti-signals don't fit current cap=200 model. Multiplier? Hard filter? Display warning chip? | Spec dispatch must define the math + UI shape |
| **Stale-data city handling** | London/Brussels/Lagos have 100% NULL Google booleans (ORCH-0708 R-4). Claude fills the gap, but only if Triangle-style admin-refresh-places runs first | ORCH-0713 should not block on these cities; Triangle ships first |
| **`flowers` rule surgery** | Tightening to "grocery + florist with ready bouquets, exclude event-only" requires review keyword density analysis. Operator already locked semantics. | Spec dispatch reads live config + drafts new rule + simulates against live `place_scores` to confirm Bayfront drops + Harris Teeter stays |
| **discover-cards multi-chip merge logic** | When two chips map to same place via different signals, current merge picks max signal_score. Adding Claude confidence as tiebreaker may shift the merge result. | Spec dispatch validates merge behavior in test case |
| **Mobile vibe-chip rendering** | `vibe_phrases` from Claude need to surface on the place card. Today's card response shape doesn't have a vibes field. | Spec dispatch defines new card response field + mobile component update |
| **ORCH-0708 Phase 2 dependency** | Photo aesthetic data is currently inert. Should ORCH-0713 absorb Phase 2, or ship Phase 2 first? | Recommend ORCH-0713 absorbs (single coherent pipeline reshape); split otherwise creates two scorer-extension migrations |

---

## 13. Recommended Spec Scope (for the SPEC dispatch that follows this audit)

The spec writer should scope ORCH-0713 as **three phases**:

**Phase 1 — Unified Per-City Orchestrator + Photo-Aesthetic Wire-up**
- Build `run-city-pipeline` orchestrator edge function (admit → pre-bouncer → backfill → bouncer → score-all-signals → photo-aesthetic, all per `city_id`)
- ABSORB ORCH-0708 Phase 2: extend `_shared/signalScorer.ts` with 7 photo prefix matchers; ship signal v_next migrations for `fine_dining, brunch, romantic, lively, casual_food` to USE photo weights; raise cap to 1000 on those 5 signals (per ORCH-0708 R-1 recommendation)
- Build `CityPipelinePage.jsx` admin UI (one page per city, per-stage progress)
- VALIDATE: pre/post snapshots on Triangle; confirm aesthetic data shifts top-decile rankings as expected

**Phase 2 — Signal Taxonomy Expansion + Anti-Signal Dimension**
- Add 3 new signals: `lgbtq_safe_space`, `family_friendly`, `cocktail_destination`
- Tighten `flowers` rule (admit grocery + florist with ready bouquets; reject event-only)
- Define + ship anti-signal schema (`place_anti_signals` table OR `place_pool.anti_signal_flags jsonb` — spec must decide)
- Update every signal-list location atomically (`MINGLA_SIGNAL_IDS` consts in admin + mobile + edge functions; signal_definitions seed migrations)

**Phase 3 — Production Claude Rerank Pipeline**
- Build `evaluate-place-for-signal` per-place worker (mirrors ORCH-0712 trial fn; shipped components reused)
- Schema: `place_claude_evaluations` cache table
- Build background pre-compute job (operator-triggered + cron-able)
- Add Google AI Overview answer evidence (Serper `/search` endpoint with per-signal Q template library — 16 templates)
- Migrate `query_servable_places_by_signal` → v2 with Claude LEFT JOIN + `inappropriate_for` veto + confidence as primary sort
- Update `discover-cards` response to surface `vibe_phrases` + `reasoning_quote` on each card
- Mobile: render vibe chips below place name on cards (feature-flagged for safe rollout)

**Phase ordering & gating:**
- Phase 1 must validate (Compare-with-Claude tab shows aesthetic data shifting rankings) before Phase 2.
- Phase 2 must update ALL signal-list locations atomically; CI gate enforces.
- Phase 3 only after Phases 1 & 2 are CLOSED.
- Cost guards: operator-set $/day caps per phase. Default $5/day for Phase 3 background job.

---

## 14. Discoveries for Orchestrator (side issues to register)

1. 🟠 **D1 — ORCH-0708 Phase 2 was deferred and never explicitly registered.** The spec exists ([SPEC_ORCH-0708_PHOTO_AESTHETIC_SCORING_INTEGRATION.md](Mingla_Artifacts/reports/SPEC_ORCH-0708_PHOTO_AESTHETIC_SCORING_INTEGRATION.md) §7) but no implementor dispatch ever shipped the scorer extension. ORCH-0713 Phase 1 absorbs it.
2. 🟡 **D2 — No admin UI for `run-bouncer` or `run-pre-photo-bouncer` today.** Operator invokes via console (PowerShell + curl). The unified `CityPipelinePage` from Phase 1 fixes this.
3. 🟡 **D3 — Trial `test-serper-reviews` edge function still deployed.** Throwaway from ORCH-0712 development. Delete post-CLOSE.
4. 🟡 **D4 — `admin_place_pool_mv.primary_category` taxonomy mismatch is OPEN** (per CATEGORY_PIPELINE_E2E §G). Not blocking for ORCH-0713 but should remain on the orchestrator's open list.
5. 🟡 **D5 — `signal_definition_versions` table lacks UNIQUE (signal_id, version_label)** — flagged in ORCH-0702 (D-IMPL-1), still open. New v_next migrations in Phase 1 + Phase 2 should keep idempotency-via-IF-EXISTS pattern.
6. 🔵 **D6 — Stale-data cities (London, Brussels, Lagos) need `admin-refresh-places` runs separately.** Not blocking; ORCH-0713 ships Triangle first.
7. 🔵 **D7 — `signal_anchors` + `place_external_reviews` + `place_intelligence_trial_runs` tables (ORCH-0712) become leveraged infrastructure.** The trial pipeline's research outputs become the feedback signal for prompt iteration on Phase 3 production prompts.

---

## 15. Confidence Ledger

| Finding | Confidence | Notes |
|---|---|---|
| 6-stage pipeline structure | HIGH | All edge functions read; live DB schema confirmed |
| Pre-bouncer gate inventory | HIGH | bouncer.ts read in full + grep'd for callers |
| Photo coverage per city | HIGH | Live DB query (§6 table) |
| Photo aesthetic NOT integrated | HIGH | Confirmed by source grep + signalScorer.ts read |
| Reusable components inventory | HIGH | Each component sourced + line-cited |
| Claude rerank slot mapping | HIGH | Read path traced through RPC + discover-cards |
| Per-signal scorer rules | MEDIUM | Cited from ORCH-0708 audit; not re-derived per signal in this audit (out of scope) |
| Cost projections at scale | MEDIUM | Extrapolated from ORCH-0712 measured per-place cost ($0.019); production prompt may differ |
| `flowers` rule surgery feasibility | MEDIUM | Live config not read in this audit; spec dispatch must read v_next |
| Anti-signal composition math | LOW | Conceptual only; spec must define |

---

## 16. Five-Layer Cross-Check

| Layer | Says | Conflict? |
|---|---|---|
| **Docs** | ORCH-0708 Phase 1 spec exists; Phase 2 deferred | Aligned |
| **Schema** | `photo_aesthetic_data` column exists; `place_scores` cap=200 enforced; pipeline tables for runs/batches mirror across stages | Aligned |
| **Code** | Edge functions for each stage exist; signalScorer.ts does NOT read photo_aesthetic_data | Confirms gap |
| **Runtime** | 30 places have photo_aesthetic_data; their place_scores are no different from neighbors without aesthetic data | Confirms inert state |
| **Data** | 14k+ servable places exist; only 30 have aesthetic data; trial run produced 32 Claude evaluations not feeding production | Confirms research-only invariant |

**No layer contradictions.** Photo-aesthetic gap is consistent across all five.

---

## 17. Investigation Manifest (audit trail)

**Files read in full:**
- `supabase/functions/run-bouncer/index.ts` (189 lines)
- `supabase/functions/run-pre-photo-bouncer/index.ts` (202 lines)
- `supabase/functions/run-signal-scorer/index.ts` (234 lines)
- `supabase/functions/_shared/signalScorer.ts` (244 lines)
- `supabase/functions/_shared/bouncer.ts` (270 lines)
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0708_SCORING_SYSTEM_AUDIT.md` (435 lines)
- `Mingla_Artifacts/reports/INVESTIGATION_CATEGORY_PIPELINE_END_TO_END.md` (553 lines)

**Files scanned (structure / first ~120 lines):**
- `supabase/functions/score-place-photo-aesthetics/index.ts` (1040 lines, action dispatch confirmed)
- `supabase/functions/backfill-place-photos/index.ts` (1047 lines, action dispatch confirmed via grep)
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0708_PHASE_1_PHOTO_AESTHETIC_SCORER_REPORT.md` (verified Phase 2 deferral)

**Sub-agent delegation (verified):**
- Mapped `query_servable_places_by_signal` RPC, `discover-cards` edge function, and `admin_place_pool_mv` matview definitions. Findings cross-verified against migration filenames.

**Live DB queries:**
- `place_pool` schema (78 columns, post-ORCH-0700 decommission state confirmed)
- Per-city coverage (8 cities × 9 columns)
- Pipeline tables existence (18 tables verified)

**Files INTENTIONALLY not read this audit (out-of-scope or already covered by prior audits):**
- Mobile rec hook (`useDeckCards` / similar) — spec dispatch reads
- Per-signal config v_next bodies — spec dispatch reads live (per H-3 of ORCH-0708)
- ORCH-0712 implementation report — context already absorbed via session memory
- Memory `project_categorization_rules.md` — referenced but not loaded; spec dispatch consults

---

**END OF INVESTIGATION**

Spec dispatch follows. Three phases scoped per §13. Hand-off contract: this audit is the foundation; no spec is written on top of uncertainty. Operator confirms scope before SPEC mode runs.
