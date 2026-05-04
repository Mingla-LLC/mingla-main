# INVESTIGATION — ORCH-0712 Place Intelligence Trial Run

**Confidence:** H · root cause not applicable (this is a build dispatch, not a bug) · all design decisions backed by evidence from migrations, MCP probes, and file reads.

---

## 1. Mission

The operator wants a one-shot exploratory trial where Claude receives EVERY data point we have for 32 places (2 anchors per Mingla signal × 16 signals) and answers two open-ended questions about each place. Output is operator-readable analysis, NOT scoring data wired into card ranking.

## 2. Key findings

### F1 — `place_scores` is a dense matrix, NOT sparse 🔵 OBSERVATION

**Verified via MCP probe:** every active+servable place has a `place_scores` row for every Mingla signal (~14,400 places × 16 signals = ~230K rows). Filter "places that have a score for signal X" matches every place — useless as a candidate filter.

**Corrected approach:** filter by **score threshold**. Each signal has its own score distribution.

| Signal | R+C+D places ≥100 | ≥200 (max) |
|---|---|---|
| brunch | 744 | 227 |
| casual_food | 1,338 | 609 |
| icebreakers | 1,060 | 134 |
| lively | 810 | 19 |
| picnic_friendly | 473 | 4 |
| drinks | 431 | 125 |
| fine_dining | 251 | 32 |
| nature | 252 | 1 |
| romantic | 153 | 21 |
| scenic | 152 | 1 |
| theatre | 146 | 2 |
| creative_arts | 82 | 5 |
| play | 43 | 8 |
| **groceries** | **22** | 7 |
| **flowers** | **15** | 0 |
| **movies** | **7** | 0 |

**Implication:** `movies` (7), `flowers` (15), `groceries` (22) are thin. Spec MUST allow operator to dip below the 100-score threshold for these signals, OR widen geographic scope. Recommendation: candidate filter starts at `score >= 100`, but operator can lower threshold via UI control if a signal has too few candidates.

### F2 — `place_pool` is rich enough to bundle 🔵 OBSERVATION

`place_pool` already stores everything we need for the bundled prompt — verified from `admin-seed-places/index.ts:1036-1093`:

```
name, address, lat, lng, types, primary_type, primary_type_display_name,
rating, review_count, price_level, price_range_currency, price_range_start_cents,
price_range_end_cents, opening_hours, secondary_opening_hours, photos, website,
google_maps_uri, national_phone_number, business_status, editorial_summary,
generative_summary, reviews (5 from Google), utc_offset_minutes,
serves_brunch, serves_lunch, serves_dinner, serves_breakfast, serves_beer,
serves_wine, serves_cocktails, serves_coffee, serves_dessert, serves_vegetarian_food,
outdoor_seating, live_music, good_for_groups, good_for_children,
good_for_watching_sports, allows_dogs, has_restroom, reservable, menu_for_children,
dine_in, takeout, delivery, curbside_pickup, accessibility_options, parking_options,
payment_options, raw_google_data, last_detail_refresh, refresh_failures,
stored_photo_urls, photo_aesthetic_data, is_active, is_servable
```

No new place_pool columns needed for the bundling step. We add ONE optional column for the cached collage URL.

### F3 — Serper Reviews API verified end-to-end 🔵 OBSERVATION

Validated via `supabase/functions/test-serper-reviews/index.ts` probe (still deployed). For Dame's Chicken & Waffles (Durham fixture):
- 12 calls returned 240 reviews (20 per page, not 10 as initially documented)
- 175/240 (73%) reviews have `snippet` text
- **Snippet length up to 2,136 chars** — NOT truncated at 280 as originally feared (only 2/175 ended in `...`)
- Date range: 2024-07 to 2026-05 (~22 months)
- 49/240 reviews carried `media[]` (~20%) → 98 reviewer photos total
- 12/98 photos had `caption` (text labels like "Waffle and turkey bacon breakfast platter")
- Rate limit: 500/period (we used 12 of 500 → 488 remaining)
- Cost: ~$0.001 per call → **5 calls × 32 places = 160 calls = ~$0.16** for full trial

**Implication:** Serper Reviews delivers production-grade data. No alternative scraper or DIY browser needed.

### F4 — Phase 0 + Phase 1 surface analysis 🔵 OBSERVATION

| Existing artifact | Decision for ORCH-0712 |
|---|---|
| `photo_aesthetic_labels` table (Phase 0 anchors + fixtures) | **Don't extend.** New `signal_anchors` table — different semantics (per-signal vs per-category), cleaner separation. |
| `place_pool.photo_aesthetic_data` JSONB (Phase 1) | **Preserve invariant.** Trial output goes to NEW `place_intelligence_trial_runs` table. **DO NOT WRITE to photo_aesthetic_data** (I-PHOTO-AESTHETIC-DATA-SOLE-OWNER). |
| `score-place-photo-aesthetics` edge function (Phase 1) | **Don't extend.** New `run-place-intelligence-trial` edge function — different prompt design (Q1+Q2 vs single tool), different input bundle (collage vs 5 image blocks), different output table. **Reuse:** auth pattern + retry + throttle constants from this function. |
| `_shared/photoAestheticEnums.ts` | **Reuse.** `MINGLA_SIGNAL_IDS` constant + `sanitize*` helpers + `computeCostUsd()` carry forward. |
| `Photo Labeling` page (3-tab) | **Don't extend.** New top-level page `Place Intelligence Trial` at `#/place-intelligence-trial`. Photo Labeling already has Anchors / Fixtures / Compare — adding 2 more tabs (Signal Anchors + Trial Results) makes it crowded and confuses concepts (PHOTO labeling vs PLACE INTELLIGENCE). |
| `Photo Scorer` page | **Reuse.** Add a new bucket "Trial run" or keep separate. (Implementor's micro-call.) |

### F5 — Photo collage approach 🔵 OBSERVATION

**Recommend `imagescript`** (Deno-compatible, pure-JS image library):
- Package: `https://deno.land/x/imagescript@1.2.17/mod.ts` (or latest)
- API: `Image.decode()`, `Image.resize()`, composite via `image.composite(other, x, y)`
- Existing Mingla edge functions don't currently use it — first introduction. Stable lib, well-maintained.

**Alternative considered + rejected:** browser-side Canvas API composition. Pros: no Deno dependency. Cons: requires admin UI to be open during run, CORS issues fetching some external image hosts, harder to debug, harder to make idempotent. **Rejected for the trial because we want a server-side, idempotent, replay-safe pipeline.**

**Adaptive grid sizing:**
- 1 photo → 1×1 (just resize to 1024×1024)
- 2–4 photos → 2×2 grid (512×512 cells)
- 5–9 photos → 3×3 grid (~341×341 cells)
- 10–16 photos → 4×4 grid (256×256 cells)
- More than 16 → top 16 by ranking (5 from `stored_photo_urls`, top 11 review media by recency × likes)

**Output:** PNG, 1024×1024, ~200–400KB. Stored in NEW `place-collages` Supabase Storage bucket (public, 5MB limit, mirrors `place-photos` config).

**No empty cells with black fill** — adapt grid down to the next size that fits.

### F6 — Q1 + Q2 prompt design: TWO sequential Claude calls, not one 🔵 OBSERVATION

**Recommend two calls per place:** one for Q1 (open exploration, free-form + structured proposed-lists), one for Q2 (deterministic per-signal evaluation).

**Reasoning:**
- Q1 needs creative-discovery mode where Claude proposes signals/vibes that may not exist. Wide latitude.
- Q2 needs disciplined per-signal verdict with reasoning. 16-element array output.
- A single call mixing both dilutes Claude's focus — it may give thinner answers to one to satisfy the other.
- Cost difference: ~$0.015 vs $0.030 per place. For 32 places, that's $0.48 vs $0.96. Pennies.

**System prompt** can be cached across both calls (same place context: collage + reviews + place_pool data), so the second call hits cache for ~10% multiplier on the system tokens.

**Q1 tool schema** (open exploration):
```typescript
{
  proposed_vibes: string[],   // Free-form short tags Claude generates
  proposed_signals: Array<{
    name: string,             // snake_case proposed signal id
    definition: string,       // 1-sentence what this signal captures
    rationale: string,        // Why the data demands this signal
    overlaps_existing: string[] // Which existing signals it overlaps
  }>,
  notable_observations: string  // Free-text narrative observations
}
```

**Q2 tool schema** (closed evaluation):
```typescript
{
  evaluations: Array<{
    signal_id: string,        // One of the 16 Mingla signals
    strong_match: boolean,    // Is this place a strong fit for this signal?
    confidence_0_to_10: number,
    reasoning: string,        // 1-2 sentence rationale
    inappropriate_for: boolean  // Is this place actively wrong for this signal?
  }>  // Length: exactly 16
}
```

### F7 — Photo collage column on `place_pool` vs separate table 🟡 HIDDEN FLAW (preempted)

**Recommend NEW column** `place_pool.photo_collage_url TEXT` + `place_pool.photo_collage_fingerprint TEXT`. Reasoning:
- One collage per place (not multiple over time)
- Fingerprinted by source photos to detect rotation
- Naturally co-located with the photos it's built from
- Avoids extra JOIN

This DOES touch `place_pool` schema — verify it doesn't conflict with `I-FIELD-MASK-SINGLE-OWNER` from admin-seed-places. **Conclusion: safe.** admin-seed-places writes Google's data + photos. The collage is a derived asset owned by `compose_collage` action. Same carve-out pattern as photo_aesthetic_data: protective comment in admin-seed-places UPDATE block, single-owner enforcement.

### F8 — Reviews fetch idempotency 🔵 OBSERVATION

Per-place review fetch is independent. Idempotency rule:
- If `place_external_reviews` has rows for `place_pool_id` AND most-recent `fetched_at < 30 days ago` → skip
- `force_refresh=true` parameter override
- One Serper call returns 20 reviews with optional `nextPageToken`. Loop until 100 collected OR no more pages.

### F9 — Rate limits 🔵 OBSERVATION

| API | Limit | Throttle needed? |
|---|---|---|
| Serper Reviews | 500/period (period unclear — assume per-day; 160 calls << 500) | Probably no, but spec adds 200ms inter-call sleep as safety |
| Anthropic Haiku 4.5 | 50K input tokens/min on tier 1 | YES — bigger payloads (15-25K tokens per call) → 2-3 calls/min max. Spec uses 30s throttle between Q1/Q2 calls + 9s throttle between places (similar to Phase 1) |

### F10 — Cost projection 🔵 OBSERVATION

Bundled trial run for 32 places:

| Component | Cost |
|---|---|
| Serper Reviews fetch (32 places × 5 calls) | ~$0.16 |
| Photo collage build (no API cost, just CPU) | $0 |
| Storage (32 × ~300KB collage) | $0 (well under bucket free tier) |
| Anthropic Q1 calls (32 × ~25K input + ~1.5K output) | ~$0.85 |
| Anthropic Q2 calls (32 × ~25K input + ~3K output, system cached) | ~$0.50 |
| **Total** | **~$1.50** |

Wall time estimate: 32 places × ~60s per place (collage + Q1 + Q2 + throttle) = ~32 minutes.

## 3. Five-Layer Cross-Check

| Layer | Status |
|---|---|
| **Docs** | Spec §24 of ORCH-0708 spec describes photo-aesthetic but explicitly OUT-OF-SCOPE for trial design. Trial is a new direction. |
| **Schema** | `place_scores` confirmed dense; `place_pool` columns confirmed sufficient. No schema conflicts. |
| **Code** | Phase 0 + Phase 1 code reviewed. Reuse decisions made (see F4). |
| **Runtime** | Serper test probe verified (`test-serper-reviews`); Phase 1 runs verified (last successful: 30/30 fixtures). |
| **Data** | 30 photo-aesthetic fixtures committed; per-signal candidate pool sizes verified via MCP. |

No layer contradictions.

## 4. Blast Radius

**Touches:**
- `place_pool` schema: 2 new columns (`photo_collage_url`, `photo_collage_fingerprint`) — additive, no existing reads/writes break
- `admin-seed-places` edge function: needs new protective comment for the 2 new columns (single-owner carve-out)
- Photo Labeling page: untouched
- Photo Scorer page: untouched
- Compare-with-Claude tab: untouched
- Card ranking / scoring engine: **completely untouched** — trial does NOT feed into production scoring

**Does NOT touch:**
- Solo / collab flows (admin-only feature)
- Mobile app
- run-bouncer / run-signal-scorer
- Any production ranking surface

## 5. Invariant Considerations

| Invariant | Preserved? |
|---|---|
| **I-PHOTO-AESTHETIC-DATA-SOLE-OWNER** | ✅ Trial writes to NEW `place_intelligence_trial_runs` table, not `photo_aesthetic_data` |
| **I-FIELD-MASK-SINGLE-OWNER** | ✅ New `photo_collage_url` + `photo_collage_fingerprint` columns owned by `compose_collage` action; admin-seed-places carve-out comment added |
| **I-REFRESH-NEVER-DEGRADES** | ✅ Re-seed never clobbers trial data or collage (carve-out enforces) |
| No silent failures (Const #3) | ✅ Spec requires try/catch + sentinel + toast on every Anthropic + Serper call |
| One owner per truth (Const #2) | ✅ Each new table has one writer |

**NEW invariants the spec will declare (DRAFT, flip ACTIVE on CLOSE):**
- `I-COLLAGE-SOLE-OWNER` — `place_pool.photo_collage_url` written ONLY by `compose_collage` action of `run-place-intelligence-trial` edge function
- `I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING` — `place_intelligence_trial_runs` rows MUST NOT be read by any production scoring or ranking surface. Trial is research-only.

## 6. Fix Strategy (direction only — spec is separate)

The spec defines 5 build phases (sequential, gated):
1. **DB layer** — 4 migrations (signal_anchors, place_external_reviews, place_intelligence_trial_runs, place_pool collage columns)
2. **Edge functions** — `fetch-place-reviews-serper` + `compose-photo-collage` (or merge into `run-place-intelligence-trial` as actions) + `run-place-intelligence-trial`
3. **Reuse `_shared/photoAestheticEnums.ts`** + carry forward Anthropic auth/retry pattern from `score-place-photo-aesthetics`
4. **Admin UI** — new `PlaceIntelligenceTrialPage.jsx` at `#/place-intelligence-trial` with two tabs: Signal Anchors + Trial Results
5. **One-shot trial run** — operator picks 32 anchors → clicks "Run trial" → 5–10 min wait → reviews output

## 7. Discoveries for Orchestrator

**D1 (S3 cosmetic) — `test-serper-reviews` throwaway endpoint should be deleted post-trial.**
Currently deployed at `supabase/functions/test-serper-reviews/index.ts`. After ORCH-0712 lands and the production reviews fetcher works, this throwaway should be deleted. Post-CLOSE cleanup ticket.

**D2 (S3 process) — Phase 0 + Phase 1 + ORCH-0712 share the "anchor" concept but mean different things:**
- Phase 0 anchor = 1 of 6 calibration categories (upscale_steakhouse, etc.) for photo-aesthetic system prompt
- ORCH-0712 anchor = 1 of 32 picks (2 per signal) for trial run

Different schemas (`photo_aesthetic_labels` vs new `signal_anchors`), different purposes. Spec uses distinct terminology — "photo anchor" vs "signal anchor" — to avoid confusion.

**D3 (S2 medium) — `place_scores` density is high but not all places are scored equally well.**
Some places have score 0 for many signals (correct — not all places are appropriate for every signal). The "score >= 100" filter is a sensible default but operator may want a per-signal toggle to lower the threshold for thin signals (movies/flowers/groceries). Spec recommends UI-side threshold control with `score >= 100` as the default.

**D4 (S2 medium) — Adult content gap.**
The 16 Mingla signals do NOT include an "adult_venue" or "nightlife_explicit" category. Trial Q1 may surface this gap (Claude may propose adding it). Operator decides post-trial whether to act.

## 8. Confidence: H

All design decisions backed by:
- Migration file reads (Phase 0 + Phase 1)
- Edge function file reads (score-place-photo-aesthetics + admin-seed-places)
- MCP probes (place_scores schema + per-signal score distribution + storage buckets list)
- Live Serper API probe (test-serper-reviews 240-review pull)
- Existing UI file reads (Photo Labeling page tab pattern + sibling components)

No layer is unverified.

## 9. Recommended next step

Spec is being written in parallel: `Mingla_Artifacts/specs/SPEC_ORCH-0712_TRIAL_INTELLIGENCE.md`.
After spec lands → orchestrator REVIEW → implementor dispatch.
