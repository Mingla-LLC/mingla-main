# RESEARCH — Experience Pipeline → Consumer Deck Wiring

**Mode:** Forensics INVESTIGATE + RESEARCH (no SPEC, no solutions; matrix only, operator picks the winner)
**Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_BRAINSTORM_EXPERIENCE_PIPELINE_TO_CONSUMER_DECK.md` (2026-05-26)
**Status:** Brainstorm — no ORCH-ID yet
**Author skill:** Claude `mingla-forensics`
**Date:** 2026-05-26
**Single question answered:** *How do we use the business-app experience pipeline to generate cards on the swipeable deck that match the intent and single categories users select on the consumer app, in such a way that users are delighted and feel like the deck understands them?*

---

## §1 — Executive answer (read this first)

**The architecture in plain English.** Mingla already has the data and the AI evaluations needed to make the deck feel hand-picked — they just aren't wired to the deck yet. The current deck ranks places using a hand-authored rule book (regex on Google reviews, weighted Google fields like `serves_brunch`, `live_music`, `outdoor_seating`); that engine produced today's signal scores. In parallel, the "experience pipeline" running in the admin tooling has already (a) scraped 172,262 fresh reviews covering 2,266 servable places from outside Google's 5-review cap, (b) stitched a 3×3 photo collage per place, and (c) asked Gemini 2.5 Flash to score each of those places against all 16 Mingla signals on a 0-to-100 scale with a short human-readable reasoning paragraph. The wiring is one new JSONB column on `place_pool`, one DEC entry to lift the `I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING` guardrail (already foreseen in DEC-099), one update to the signal scorer to blend the AI score with the rule score, and a coverage backfill to take the AI evaluations from 2,327 places to all 13,671 currently-servable ones — about $85 in Gemini batch spend. The result: every card the user sees is backed by either a multi-paragraph AI vibe assessment of real reviews and photos, or (until backfill completes) the existing rule engine — never a regression on quality, often a leap forward.

**The delight mechanism.** Users feel a deck "understands them" when three things are simultaneously true: the right kinds of places appear (intent match), the wrong kinds are silently filtered out (anti-match), and what shows up has a one-line reason that makes the user nod (legible match). Today Mingla does (1) only via rule-based proxies, does not do (2) at all (an upscale lounge can still appear under "icebreakers" if its keywords accidentally match), and does (3) with hand-written tagline templates that don't reference the actual place. The Gemini Q2 evaluations already in `place_intelligence_trial_runs.q2_response` deliver all three: the `score_0_to_100` field powers ranking, the `inappropriate_for: true` field provides hard vetoes ("don't ever show this rooftop cocktail bar for picnic_friendly"), and the `reasoning` field is one or two sentences a card can quote on its back. The delight isn't the AI — it's that the AI is finally reading the same reviews and looking at the same photos the user would look at, and saying out loud why this place matches what they asked for.

**The top 3 risks.** First, **stale or wrong AI evaluations.** Reviews drift, ownership changes, restaurants close — any AI score older than 90 days for a venue with recent ownership change is a liability. Mitigation: trigger re-evaluation when `place_pool.last_detail_refresh` advances or when Google `business_status` changes. Second, **the 5.9× coverage backfill creates a two-tier deck.** Until all 13,671 servable places are AI-evaluated, the deck will mix AI-scored and rule-scored cards; if the AI scorer is stricter than the rule scorer (Gemini's `inappropriate_for` vetoes will exclude places the regex matched), the deck will visibly thin out in some cities first. Mitigation: ship the backfill BEFORE flipping the ranker, OR ship a gradient blend that down-weights rather than vetoes for non-evaluated places. Third, **the trial pipeline is `place_intelligence_trial_runs` — its schema and freshness are not bound by any production contract.** A future change to `q2_response` shape, prompt version, or signal taxonomy could silently break the deck. Mitigation: move the contract into a versioned production column (`ai_signal_scores` JSONB) with a `prompt_version` discriminant the ranker checks at read-time, not just at write.

---

## §2 — Phase 0 evidence (one-line cite per source)

### Codebase reads (consumer)
- [`app-mobile/src/services/deckService.ts`](app-mobile/src/services/deckService.ts):399-806 — `fetchDeck()` solo path: parallel race between `discover-cards` (singles via categories) and `generate-curated-experiences` (curated via intents), then 1:1 interleave with dedupe by placeId.
- [`app-mobile/src/services/deckService.ts`](app-mobile/src/services/deckService.ts):820-925 — `fetchCollabDeckV2()` collab path: single `discover-cards` call with `{session_id, current_position}`, server reads aggregated session prefs.
- [`app-mobile/src/services/deckService.ts`](app-mobile/src/services/deckService.ts):288-347 — `CATEGORY_PILL_MAP` legacy-slug-aware mapping (transitional aliases through 2026-05-13 still active).
- [`app-mobile/src/types/expandedCardTypes.ts`](app-mobile/src/types/expandedCardTypes.ts) — `ExpandedCardData` discriminated union (single / curated `cardType:'curated'` / stroll / picnic).
- [`app-mobile/src/components/SwipeableCards.tsx`](app-mobile/src/components/SwipeableCards.tsx) — mount + `RecommendationsProvider`; solo only. [`app-mobile/src/components/connections/CollabDeckSheet.tsx`](app-mobile/src/components/connections/CollabDeckSheet.tsx) — collab mount in group chat (post-META-ORCH-0929 [collab decks in group chat]).

### Codebase reads (backend — current ranker)
- [`supabase/functions/discover-cards/index.ts`](supabase/functions/discover-cards/index.ts):44-98 — `CATEGORY_TO_SIGNAL` map: every consumer-visible chip routes to 1–2 signal IDs out of 16; `filterMin` thresholds (100–120) gate the bottom of the pool.
- [`supabase/functions/discover-cards/index.ts`](supabase/functions/discover-cards/index.ts):126-133 — `SESSION_INTENT_IDS` set = `adventurous, first-date, romantic, group-fun, picnic-dates, take-a-stroll`.
- [`supabase/functions/_shared/signalScorer.ts`](supabase/functions/_shared/signalScorer.ts) — rule-based scorer reading `signal_definitions.config` JSONB (sampled at probe time — see §3).
- [`supabase/functions/generate-curated-experiences/index.ts`](supabase/functions/generate-curated-experiences/index.ts):206-260 — `EXPERIENCE_TYPES` table: 6 intents × 2-3-stop combos (e.g., `first-date` = `[flowers?, brunch|theatre|movies, creative_arts|fine_dining|theatre]`).
- [`supabase/functions/_shared/categoryPlaceTypes.ts`](supabase/functions/_shared/categoryPlaceTypes.ts) — `DISPLAY_TO_SLUG` (canonical 10 slugs) + `pg_map_primary_type_to_mingla_category` mapping.

### Codebase reads (experience pipeline — already built)
- `supabase/functions/run-place-intelligence-trial/index.ts:716-834` — `handleFetchReviews`: Serper API → `place_external_reviews` upsert, 5-page pagination, 30-day freshness guard, dedupe on `(place_pool_id, source, source_review_id)`.
- `supabase/functions/run-place-intelligence-trial/index.ts:840-954` — `handleComposeCollage`: merges `place_pool.stored_photo_urls[0:5]` + reviewer media; uploads to Storage `place-collages`; writes `place_pool.photo_collage_url` + `photo_collage_fingerprint`.
- `supabase/functions/run-place-intelligence-trial/index.ts:1-95` — Gemini 2.5 Flash via Q1 (reasoning) + Q2 (per-signal evaluation) prompts.
- `supabase/functions/score-place-photo-aesthetics/index.ts:1-152` — Claude Haiku 4.5 vision aesthetic scoring (ORCH-0708; DECOMMISSIONED in plan per DEC-099 Cut 1; column still physically present).
- [`mingla-business/src/services/experiencesService.ts`](mingla-business/src/services/experiencesService.ts) + [`experienceGenerationService.ts`](mingla-business/src/services/experienceGenerationService.ts) — admin/business UI for orchestrating menu/activity uploads (ORCH-0881 Ve5 area); does NOT trigger the AI pipeline against `place_pool` rows.

### Prior artifact reads (constraints)
- `Mingla_Artifacts/specs/SPEC_ORCH-0712_*.md` §3.3 — establishes `I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING`: "trial output stored in `place_intelligence_trial_runs` MUST NOT be read by production scoring/ranking surfaces."
- `Mingla_Artifacts/DECISION_LOG.md` DEC-099 (2026-05-04) — pre-authorises `place_pool.claude_signal_evaluations` JSONB keyed by signal_id as a "constitutionally blessed exception" to the no-stored-interpretations rule; current `photo_aesthetic_data` column is slated for drop.
- `Mingla_Artifacts/DECISION_LOG.md` DEC-090 (2026-05-03) — `ai_categories` family physically dropped from `place_pool`; the lesson is that stored-interpretation columns CAN return if a DEC blesses them, but they need an unambiguous owner.
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-CATEGORY-DERIVED-ON-DROP + I-CATEGORY-SLUG-CANONICAL — categories live as live computation; signal IDs are a separate 16-element axis (DEC-091).
- `Mingla_Artifacts/WORLD_MAP.md` ORCH-0734 CLOSE (2026-05-05) — trial pipeline scaled from 32-anchor calibration to city-scoped Gemini sweeps; production-trustworthy for admin use.
- Memory rules in operator's `~/.claude/projects/.../memory/`: [[collab-deck-determinism-contract]], [[collab-deck-lives-in-group-chat]], [[ai-categories-decommissioned]].

### Schema layer (live DB probes via Supabase Management API, 2026-05-26)
- `place_pool` columns (78 total) — includes `photo_aesthetic_data jsonb`, `photo_collage_url text`, `photo_collage_fingerprint text`, `reviews jsonb`, `editorial_summary text`, `generative_summary text`, `is_servable bool`, `is_claimed bool`, plus 30 Google-derived boolean facets (`serves_brunch`, `outdoor_seating`, `live_music`, `good_for_groups`, etc.).
- `place_scores` columns: `place_id uuid, signal_id text, score numeric, contributions jsonb, scored_at timestamptz, signal_version_id uuid`.
- `place_external_reviews` columns confirmed against `mingla-tester+codex` ORCH-0712 spec; admin-read RLS only (consumer cannot SELECT).
- `place_intelligence_trial_runs` columns include `q1_response jsonb`, `q2_response jsonb`, `model text` (`gemini-2.5-flash`), `prompt_version text` (`v4`), `cost_usd numeric`, `status text`.
- `signal_definitions` and `signal_definition_versions.config` JSONB shape sampled (full structure in §3).

### Data layer (live row counts, 2026-05-26)
| Metric | Value | Implication |
|---|---|---|
| Total places in pool | **69,599** | Long tail of ingested-but-not-servable places. |
| Servable places (`is_servable=true`) | **13,671** | Pool that the deck actually draws from. 19.6% bouncer pass rate. |
| Places with `photo_aesthetic_data` | **30** | Calibration leftovers from ORCH-0708; effectively decommissioned per DEC-099. |
| Places with `photo_collage_url` | **2,327** | Trial pipeline coverage. 17% of servable. |
| Places with Google `reviews` populated | **15,505** | But ≤5 reviews each (Google v1 cap — see §7). |
| Places with `editorial_summary` | **17,100** | Google-authored short description. Free signal. |
| Places with `generative_summary` | **6,683** | Google-AI-authored description. Free signal. |
| Places claimed by a brand | **0** | No business-app brand ownership lives in `place_pool` yet. |
| `place_scores` rows | **225,924** | = 14,412 places × ~15.7 signals each. Existing ranking corpus. |
| Distinct signals in `place_scores` | **16** | Matches the 16 active `signal_definitions`. |
| Active signal IDs | `brunch, casual_food, creative_arts, drinks, fine_dining, flowers, groceries, icebreakers, lively, movies, nature, picnic_friendly, play, romantic, scenic, theatre` | Note `lively`, `picnic_friendly`, `scenic`, `romantic` are signal-only — not user-visible categories. |
| `place_external_reviews` total | **172,262** | Across 2,266 places ≈ 76 reviews/place avg (vs. Google's 5/place ceiling). |
| Trial Q2 evaluations | **4,431 runs × 2,327 places × 16 signals fully covered** | THIS IS THE WIRING TARGET. |

### External research (cited)
- pgvector index choice for 10K–100K rows: HNSW is the safe default (`m=16, ef_construction=200`), per [Severalnines deep dive](https://severalnines.com/blog/vector-similarity-search-with-postgresqls-pgvector-a-deep-dive/) and [AWS RDS recommendations](https://aws.amazon.com/blogs/database/optimize-generative-ai-applications-with-pgvector-indexing-a-deep-dive-into-ivfflat-and-hnsw-techniques/).
- OpenAI `text-embedding-3-small`: $0.02/M input tokens standard; $0.01/M batch; 1536 dimensions; 8,191-token cap per request, per [OpenAI model docs](https://developers.openai.com/api/docs/models/text-embedding-3-small) and [TokenMix pricing analysis](https://tokenmix.ai/blog/openai-embedding-pricing).
- Claude Haiku 4.5: $1/M input, $5/M output; supports vision; up to 90% prompt-cache savings + 50% batch savings, per [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) and the [Haiku 4.5 launch post](https://www.anthropic.com/news/claude-haiku-4-5).
- Google Places API v1: HARD limit of 5 reviews per place per request; same limit at the `places.reviews` field-mask level, per [Google Places choose-fields docs](https://developers.google.com/maps/documentation/places/web-service/choose-fields) and [Featurable's analysis](https://featurable.com/blog/google-places-more-than-5-reviews).
- Yelp Fusion API: 3 reviews/business, 5,000 calls/day, scraping is an explicit ToS violation + potential CFAA risk, per [Octoparse's legal review](https://www.octoparse.com/blog/is-scraping-yelp-legal).
- Foursquare Places API: $200/mo developer credit + 10K free Pro calls; Premium endpoints (photos, tips, hours, ratings) at $18.75/1K calls, with rates changing 2026-06-01, per [Foursquare pricing](https://foursquare.com/pricing/) and the [API changes notice](https://docs.foursquare.com/developer/reference/upcoming-changes).
- NIMA (Neural Image Assessment) outputs a 1–10 aesthetic score correlating with human perception; reference implementations: [Google Research blog](https://research.google/blog/introducing-nima-neural-image-assessment/), [idealo/image-quality-assessment](https://github.com/idealo/image-quality-assessment), and the [NIMA paper](https://arxiv.org/abs/1709.05424).
- Two-tower recommendation models are the modern default for cold-start + small catalogs; [Allegro's production write-up](https://arxiv.org/html/2508.03702v1), [Red Hat's primer](https://developers.redhat.com/articles/2026/01/26/understanding-recommender-systems-two-tower-model), [Shaped's deep dive](https://www.shaped.ai/blog/the-two-tower-model-for-recommendation-systems-a-deep-dive).
- Supabase pg_cron + Edge Functions for batched enrichment: max 8 concurrent jobs at 10 min each, prefer polling over webhooks at scale, per [Supabase Cron docs](https://supabase.com/docs/guides/cron) and the [large-jobs blog](https://supabase.com/blog/processing-large-jobs-with-edge-functions).
- Cloudinary AI auto-tagging: add-on at $200–$1,000+/mo; included in Advanced ($224/mo) and Enterprise plans, per [Cloudinary pricing](https://cloudinary.com/pricing) and the [AI Content Analysis docs](https://cloudinary.com/documentation/cloudinary_ai_content_analysis_addon).
- React Query key-factory pattern (critical given the combinatorial 6 intents × 10 categories × N cities deck-key explosion): [TanStack docs on query keys](https://tanstack.com/query/latest/docs/react/guides/query-keys).
- Supabase automatic embeddings pattern (relevant if §7 chooses the embedding option): [Supabase AI docs](https://supabase.com/docs/guides/ai/automatic-embeddings).

---

## §3 — Current state truth table (5 layers, by subsystem)

| Subsystem | Docs | Schema | Code | Runtime | Data |
|---|---|---|---|---|---|
| **Deck content source** | "Pool-only; no Google API at request time" (`discover-cards` header comment) | `place_pool` + `place_scores` join | `discover-cards/index.ts` + `generate-curated-experiences/index.ts` | Active in production (every consumer card) | 14,412 places have scores; 13,671 are servable; 999 mismatch = scored-but-not-servable |
| **Category derivation** | Constitution #2 (Google raw type is owner); I-CATEGORY-DERIVED-ON-DROP | `pg_map_primary_type_to_mingla_category(primary_type, types)` + matview `admin_place_pool_mv.primary_category` | `categoryPlaceTypes.ts` | Live | 10 canonical slugs; no stored interpretation column |
| **Intent matching** | 6 intents defined in `categoryPlaceTypes.ts:443` | No DB representation (intents are query-time only) | Maps intent → `EXPERIENCE_TYPES[i].combos` of category slugs → fan-out fetch per stop | Live (curated path) | Intents do NOT influence singles path today (only categories do) |
| **Photo source for cards** | `image` field on Recommendation type | `place_pool.stored_photo_urls[]` (Google photo CDN URLs) | `unifiedCardToRecommendation` reads first photo as hero | Live | 13,671/13,671 servable have stored_photo_urls (bouncer requires it) — but only 2,327 have a `photo_collage_url` |
| **Review surfacing on cards** | No card field for reviews currently | `place_pool.reviews` JSONB + `place_external_reviews` table | Neither is read by `discover-cards` or `generate-curated-experiences` | NOT WIRED | 15,505 + 2,266 places have review data, but consumer never sees it |
| **Scoring** | Hand-authored rule book per signal | `signal_definitions` + `signal_definition_versions.config` JSONB | `signalScorer.ts` reads config, applies (`min_rating`, `field_weights`, `text_patterns regex on reviews + editorial_summary + atmosphere`, `cap`, `clamp_min`) | Live; v1.0.0–v1.4.0 versions in flight | 225,924 score rows; per-place per-signal numeric score |
| **AI vibe evaluation** | Trial pipeline spec ORCH-0712 §3.3 | `place_intelligence_trial_runs.q2_response` JSONB | `run-place-intelligence-trial` writes; nothing reads in production | BUILT, NOT WIRED to ranker (I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING) | 2,327 places fully evaluated (16 signals each, score_0_to_100 + inappropriate_for + reasoning) |
| **Cold-start data acquisition** | ORCH-0550.1 FieldMask | `admin-seed-places` calls Google v1 `places:searchNearby` | Admin-triggered city seeding | Live but slated for sunset per operator goal | 69,599 cumulative ingestion |

**Contradictions detected.**

1. **Schema vs. plan:** `place_pool.photo_aesthetic_data` still physically exists (78 columns include it) despite DEC-099 Cut 1 saying drop. The 30 rows that have it are calibration residue. Not a blocker, but a cleanup ORCH the orchestrator should register.
2. **Code vs. data:** The rule-based signal scorer reads `place_pool.reviews` (Google's ≤5 reviews) via `text_patterns.reviews_regex`, but `place_external_reviews` (172K rich reviews from Serper) is NEVER read by the scorer. The richest review corpus is sitting unused at the ranker level.
3. **Docs vs. runtime:** `I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING` says trial output is research-only; DEC-099 in the same artifact tree pre-authorises the path to make it production. The two coexist because the bridging ORCH (was provisionally ORCH-0713) hasn't been dispatched.

---

## §4 — Experience pipeline inventory

### What exists today, by file path

| Piece | Path | Status | Output target |
|---|---|---|---|
| Place ingestion (Google) | `supabase/functions/admin-seed-places/index.ts` | Live, slated for sunset per operator goal | `place_pool` rows + raw fields |
| Bouncer | `supabase/functions/_shared/bouncer.ts` + `bouncerChainRules.ts` | Live | `place_pool.is_servable` boolean |
| Rule-based signal scorer | `supabase/functions/_shared/signalScorer.ts` + `run-signal-scorer/index.ts` | Live | `place_scores` rows (16 signals × ~14K places) |
| External review scraper | `supabase/functions/run-place-intelligence-trial/index.ts:716-834` (action `fetchReviews`) | Live (admin-only) | `place_external_reviews` table |
| Photo collage composer | `supabase/functions/run-place-intelligence-trial/index.ts:840-954` (action `composeCollage`) | Live (admin-only) | `place_pool.photo_collage_url` + `photo_collage_fingerprint` |
| Gemini Q1 (reasoning) + Q2 (per-signal evaluation) | `run-place-intelligence-trial/index.ts` (action `runEvaluation`) | Live (admin-only) | `place_intelligence_trial_runs.q1_response` + `q2_response` |
| Claude Haiku 4.5 aesthetic scorer | `score-place-photo-aesthetics/index.ts` | DECOMMISSIONED in plan (DEC-099 Cut 1); column physically present with 30 rows | `place_pool.photo_aesthetic_data` (slated for drop) |
| Curated card generator | `supabase/functions/generate-curated-experiences/index.ts` | Live | Returns multi-stop itinerary JSON to mobile |
| Singles card generator | `supabase/functions/discover-cards/index.ts` | Live | Returns flat card array to mobile (both solo + collab) |

### What's missing to compose into a feeder

1. **A production-readable storage column for AI evaluations.** `place_intelligence_trial_runs` is the research lab; `place_pool.ai_signal_scores` (proposed name) is the production table the ranker would read.
2. **A blender in the signal scorer.** Today's scorer takes facets + rule patterns; it needs a branch that, when `ai_signal_scores` is present, blends the AI's `score_0_to_100` with the rule output and applies the `inappropriate_for` veto.
3. **A coverage backfill.** 11,344 servable places need to be evaluated by Gemini to bring the AI corpus to parity with the rule corpus. Cost estimate in §5.
4. **A refresh trigger.** When `place_pool.last_detail_refresh` advances OR `business_status` changes OR `editorial_summary` updates, re-evaluate.
5. **An admin re-eval button.** When operators dispute a Gemini call, they should be able to re-run Q2 with a newer prompt version.
6. **A consumer-facing reasoning surface.** The `reasoning` field on each evaluation is the delight payload — but no card primitive renders it today.

---

## §5 — The wiring options matrix

Five options enumerated. Each has the same data sources available; what differs is HOW the AI evaluations are stored, ranked, and surfaced.

### Option A — "Promote the JSON, blend the score" (lowest-cost, fastest to ship)

**What it is.** Add `place_pool.ai_signal_scores JSONB` (keyed by signal_id, value = `{score_0_to_100, inappropriate_for, reasoning, evaluated_at, prompt_version, model}`). On every trial completion, COPY the relevant slice out of `q2_response` into `place_pool.ai_signal_scores`. Update `signalScorer.ts` to read both `signal_definitions.config` (rule) AND `place_pool.ai_signal_scores[signal_id]` (AI), blend via `0.4 * rule_normalized + 0.6 * ai_score` (configurable), and apply `inappropriate_for: true` as a hard veto. `place_scores` continues to store the final blended score — the table contract doesn't change.

```
trial_runs.q2_response[signal_id]  ─┐
                                    ├─► place_pool.ai_signal_scores (new JSONB)
                                    │      │
                                    │      └─► signalScorer.ts (read at score time)
signal_definitions.config (rules) ──┴───────┘    │
                                                  └─► place_scores (existing) ─► discover-cards ─► deck
```

**Constitutional fit.** PASSES per DEC-099 (`ai_signal_scores` is the column DEC-099 pre-authorised, just renamed from `claude_signal_evaluations`).
**Cost @ 1K / 10K / 100K places.** AI re-eval cost using Claude Haiku 4.5 batch (~$0.0075/place per the per-place token estimate in §7): **$7.50 / $75 / $750 one-time**, plus ~25% quarterly refresh = $2 / $19 / $187/month ongoing. (Mingla currently spends $0 on this because trial runs are admin-triggered ad-hoc.)
**Latency.** Zero added latency at request time — the JSONB read is colocated with the place row. Score recompute via `run-signal-scorer` continues to happen offline.
**Delight 4/5.** Vibe-veto + AI-tuned scoring + `reasoning` becomes available for card backs. The 5th point is held back because the matching contract still operates over discrete category/intent buckets, not over a continuous semantic space.
**Cold-start strategy.** New city: run admin-seed-places + bouncer + rule scorer immediately (deck works on rule scores from minute one); queue Gemini Q2 batch overnight to upgrade the city to AI coverage within 24h.
**Collab compatibility.** Yes — `place_scores` is the only table the collab pipeline reads; if the score is correct, both solo and collab inherit the upgrade. Determinism preserved (pure function of session state + a per-place stored score).
**Top failure mode + mitigation.** Stale evaluations. Mitigation: trigger refresh on `place_pool.last_detail_refresh` advance OR `business_status != 'OPERATIONAL'` transition; show `evaluated_at` to admins in the inspector.

### Option B — "Read trial table directly, lift the invariant" (lowest engineering effort, highest invariant cost)

**What it is.** Update `signalScorer.ts` to LEFT JOIN `place_intelligence_trial_runs` (filtered to `status='completed'` + latest per place) at score time and use Q2 directly. No new column.

**Constitutional fit.** REQUIRES amendment — directly violates `I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING`. DEC entry + invariant retraction needed; the original invariant was protective for a reason (trial schema isn't bound by a production contract).
**Cost.** Same AI re-eval cost as Option A. No new storage.
**Latency.** Adds one JOIN to the score-recompute path; negligible.
**Delight 3/5.** Same outputs as Option A, but more brittle.
**Cold-start.** Same as Option A.
**Collab compatibility.** Same as Option A.
**Top failure mode + mitigation.** Trial schema drift breaks the deck. Mitigation: contract `q2_response` shape via a CHECK constraint. This essentially recreates Option A's column at higher complexity — recommend against.

### Option C — "Add embeddings, semantic match on intent vector ↔ place vibe vector" (highest-delight, highest-novelty)

**What it is.** Embed every place's reasoning corpus (Q2 reasonings concatenated + editorial_summary + top-3 external_reviews) into a 1536-dim vector via OpenAI `text-embedding-3-small`. Embed each of the 6 intents into the same space using hand-curated 200-token "intent definition" strings (e.g., for `romantic`: "an intimate evening together — soft lighting, small tables, time enough to talk, ideally a view or something memorable, where dropping the volume on the day feels natural"). Store both as `vector(1536)` columns with an HNSW index (`m=16, ef_construction=200`). At deck-fetch time, rank candidates by cosine similarity to the user's selected intent vector(s); fuse with `ai_signal_scores` via weighted ensemble.

```
Q2.reasoning + editorial_summary + top external_reviews
   │
   └─► place_pool.vibe_embedding vector(1536) ── HNSW idx
                                                    │
                                                    └─► cosine(intent_vector, place.vibe_embedding) ─► rank
intent_definition_strings ─► intents.embedding vector(1536) ──┘
```

**Constitutional fit.** PASSES — embeddings are derived, not authored interpretation.
**Cost @ 1K / 10K / 100K places.** Embedding (one-time): 1K × 1500 tokens × $0.01/M batch = **$0.015 / $0.15 / $1.50 — trivial.** pgvector storage: 1536 × 4 bytes × 100K = 600 MB (fits easily on standard Supabase plan). Ongoing refresh on text update: same scale.
**Latency.** HNSW ANN ~5 ms for 100K rows on a single node ([pgvector docs](https://github.com/pgvector/pgvector)); fits within the existing 15s deck timeout with massive margin.
**Delight 5/5.** Intents now match places not by signal_id token bucketing but by actual semantic similarity. "Take a stroll" finds places with a stroll *vibe* even if the rule scorer never tagged them for it. This is what gives the deck the "it gets me" feeling.
**Cold-start.** New place gets embedded as soon as it has ≥1 text source. Newly-added city is searchable as soon as its bouncer-passed places have any text.
**Collab compatibility.** Yes — embeddings are immutable inputs to the per-session rank function; determinism preserved.
**Top failure mode + mitigation.** Intent definition strings are now part of the product. A bad rewrite of the `romantic` definition string can degrade the entire deck silently. Mitigation: lock intent definitions behind a DEC entry, version them, run A/B every time they change.

### Option D — "Two-tower with user behavior tower" (highest ceiling, most engineering, multi-month)

**What it is.** Train a two-tower model: user tower (input = user's intent + category history + swipe-right history + saved cards) and place tower (input = embedding from Option C + facets + signal scores). Train on swipe-right as positive, swipe-left as negative, with hard-negative mining ([Allegro write-up](https://arxiv.org/html/2508.03702v1)). Serve via approximate nearest-neighbour against the place-tower index.

**Constitutional fit.** PASSES — derived representations.
**Cost.** Training infra (~$200–500/mo for a small GPU instance or managed service); embeddings as Option C; inference via existing Postgres + HNSW.
**Latency.** Same as Option C.
**Delight 5/5 long-term, 3/5 day-one** — needs swipe data to start being good. Until the model has ~50K labeled events, falls back to Option C as the cold-start baseline.
**Cold-start (user side).** Severe. New users have no swipe history; the user tower outputs a uniform prior until ~5–10 swipes. Mitigation: use Option C as the day-zero baseline; gate the two-tower into the deck only when the user crosses a swipe threshold.
**Collab compatibility.** Requires fresh thinking — the user tower has to absorb multiple users' histories. Determinism contract becomes "pure function of all participants' swipe histories at session-mint time."
**Top failure mode + mitigation.** Filter bubble — the model learns "this user likes brunch" and stops showing them anything else. Mitigation: explore/exploit ratio (15–20% exploration cards) and per-session category diversity floor.

### Option E — "Pre-render curated cards into a table, serve via index" (operationally cheapest, conceptually constrained)

**What it is.** Run `generate-curated-experiences` for every (city, intent) pair nightly via pg_cron; persist results into a new `curated_card_inventory` table; deck-fetch becomes a `SELECT … ORDER BY random_seed`. No request-time AI.

**Constitutional fit.** PASSES with caution — server stores "interpretations" (the cards) but they are output of the deterministic pipeline, not authored truth. Same status as `place_scores`.
**Cost.** Pre-render = N cities × 6 intents = ~6,000 cards/night for 1,000 cities. AI evaluation cost subsumed by Options A or C running upstream.
**Latency.** Deck fetch becomes a single indexed read. Under 50ms.
**Delight 3/5.** Same scoring quality as the upstream option; loses freshness vs. live (a card pre-rendered yesterday won't reflect today's review). Wins on cold-start latency.
**Cold-start.** Excellent — the table is pre-populated; new user opens app, deck is instant.
**Collab compatibility.** Tricky — the table is keyed by (city, intent), but collab decks need union/intersection of multiple users' circles. Probably needs request-time filtering of pre-rendered cards.
**Top failure mode + mitigation.** Stale cards (closed restaurants, changed hours). Mitigation: nightly rebuild + `place_pool.business_status` join at serve time.

### Matrix summary

| Option | Constitutional fit | Cost/yr @ 100K places | Latency | Delight 1-5 | Cold-start | Collab compat | Time to ship |
|---|---|---|---|---|---|---|---|
| A — Promote JSON, blend score | PASSES (DEC-099 bless) | ~$2,250 | None added | 4 | Strong (rule fallback) | Yes | 1–2 weeks |
| B — Direct trial-table read | REQUIRES invariant retraction | Same as A | +1 JOIN | 3 | Same as A | Yes | 3–5 days (small code) but invariant cost makes this NEGATIVE |
| C — Vibe embeddings | PASSES | ~$2,250 + ~$1.50 embeddings | +5 ms HNSW | 5 | Strong | Yes | 2–3 weeks |
| D — Two-tower | PASSES | ~$2,250 + ~$3K infra | +5 ms HNSW | 5 (long-term) | Weak (user-side) | Requires re-thinking | 6–10 weeks |
| E — Pre-render | PASSES with caveat | Same as A | <50 ms | 3 | Excellent | Tricky | 2–3 weeks |

**Combinations worth considering** (not new options — composed from the above):
- **A then C** — ship A first (production AI scoring), embeddings second (semantic match). Cumulative delight ceiling. This is the natural sequencing.
- **A then E** — production AI scoring + pre-render. Best for operational simplicity once stable.
- **C then D** — embeddings now, two-tower when swipe data is dense enough. The two-tower's user side learns on top of the place-tower vibe embedding.

---

## §6 — The matching contract (6 intents × 10 categories × 2 mounts)

Whatever option wins, the deck must give a clear answer to: "user selected intent X and categories [Y, Z]; what cards appear in what order?" Today's contract is opaque (rule-scored signals + interleave); the new contract must be legible.

### Single-card path (singles via `discover-cards`)

**Inputs from user:** `categories: string[]` (one or more of 10), optionally `intents: string[]` (one or more of 6), location, travel constraints, datetime.
**Routing:** Each category routes to 1-2 signal IDs via `CATEGORY_TO_SIGNAL`. Each intent does NOT influence singles today (curated only).

**Proposed contract (post-wiring, Option A or A+C):**
1. **Filter pool to servable + within travel radius + open in datetime window** (unchanged).
2. **Score per requested signal** = blend of `rule_score_normalized * (1-w)` + `ai_score * w`, where `w` is a `signal_definition_versions.config.ai_blend_weight` per signal (default 0.6, lower for high-confidence rule signals like `flowers` where the rule book is very precise; higher for `romantic`/`scenic` where AI judgment beats regex).
3. **Apply vetoes**: any place with `ai_signal_scores[signal_id].inappropriate_for === true` is removed for that signal.
4. **(Option C only)** Apply intent semantic match if user selected intents on singles: rerank top-K by cosine(intent_vector, place.vibe_embedding) blended at `0.3` weight.
5. **Diversity guard**: round-robin by category and by `primary_type` so the user doesn't see 8 Italian restaurants in a row. (Existing `roundRobinInterleave` already does the first half of this.)
6. **Freshness guard**: down-weight any place served to this user in the last 7 days by 0.7×; veto if served in the last 24h.
7. **Explore/exploit**: 15% of the deck is random places that passed bouncer but didn't make the top-K — surfaces new gems and prevents filter bubble.

### Curated-card path (`generate-curated-experiences`)

**Inputs:** `experienceType: intent_id` (one), location, travel constraints.
**Current routing:** Per intent's combos table, fan out per stop, each stop ranked by `COMBO_SLUG_TO_FILTER_SIGNAL[slug]`.
**Proposed contract:** Replace each stop's filter signal score with the blended (rule + AI) score from Option A; if Option C is on, ALSO rerank candidate combos by intent semantic similarity of the *combination* (sum of stop vibe embeddings cosine-similarity to intent vector). The combo with the highest combined match wins.

### Collab mount

The collab path's only difference is that `discover-cards` reads aggregated session prefs via `pg_aggregate_collab_prefs`. The matching contract above applies unchanged — it's a pure function of (intent set, category set, location set, travel constraints). [[collab-deck-determinism-contract]] is satisfied because all inputs to the score are deterministic per V_n.

### Test cases (informal — formal test matrix lives in eventual SPEC)

| User input | Expected first card | Expected veto example |
|---|---|---|
| Intent `romantic`, no category | Place with rule score 70 + AI `romantic` score 90 → blended ≈ 84 | Place with AI `romantic.inappropriate_for=true` (e.g. arcade) — does NOT appear even if rule says it might |
| Category `drinks_and_music`, intent `group-fun` | Place with `drinks` rule score 80 + AI `drinks` 85 + AI `lively` 90 (group-fun proxy) | Place with AI `lively.inappropriate_for=true` (silent wine bar) — does NOT appear |
| Category `nature`, no intent, late evening | Place with `nature` rule score 80 + AI `scenic` 75, open after 8pm | Closed park — opening-hours filter (existing) |
| Collab session: 3 users, mixed intents (`first-date`, `romantic`, `adventurous`) | First card high on aggregate of `icebreakers + romantic + lively` | Place vetoed by ANY of the 3 inappropriate_for vectors |

---

## §7 — Vibe + review + photo subsystems

### Vibe extraction — cheapest viable and best-quality options

**Cheapest viable.** Use the Gemini Q2 evaluations that already exist. Cost is sunk for 2,327 places; $85 backfills to all 13,671 servable.

**Maximum quality.** Add a Claude Haiku 4.5 second-opinion pass for high-confidence vetoes only (when Gemini's `inappropriate_for: true` would remove a place from a major signal). Two-model agreement reduces false vetoes. Cost: ~$0.0075 per place × 2,327 = $17.50; cheap. See [Claude Haiku 4.5 launch post](https://www.anthropic.com/news/claude-haiku-4-5).

**Recommended starting point.** Gemini Q2 alone, backfilled to full coverage. Add Claude second opinion only after observing false-veto rate on real swipe data.

### Review surfacing — cheapest viable and best-quality options

**Cheapest viable.** Use what's already there: `place_pool.reviews` (Google, 5 max) + `place_external_reviews` (Serper, 172K rows across 2,266 places). For unsurfaced places, the rule-based `text_patterns.reviews_regex` continues to work against Google's 5 reviews.

**Maximum quality.** Continue Serper expansion to all 13,671 servable places — needs roughly (13,671 − 2,266) × 5 pages × 1 Serper credit/page = 57,025 Serper credits as a one-time cost. Per Serper's pricing (~$50 for 50K queries, current pricing as of 2026 — verify against [Serper.dev pricing](https://serper.dev/pricing) before commit), about $55–$75 one-time. Verify recency by re-fetching every 90 days for places with high traffic.

**Recommended.** Backfill Serper to full servable coverage. Schedule 90-day refresh via pg_cron on a 10-jobs/8-concurrent cap per [Supabase docs](https://supabase.com/docs/guides/cron). Show 1-2 quoted review excerpts on card-back as the delight surface (the Gemini `reasoning` is good but a real human's words is better — use Gemini-extracted "best representative review excerpt" as a Q3 prompt addition).

### Photo curation — cheapest viable and best-quality options

**Cheapest viable.** Continue Google-photo-first hero, no AI ranking. (Current state.)

**Maximum quality.** The `photo_collage_url` already-built composite is a 3×3 grid. Two upgrades:
1. **Aesthetic ranking** before composing the grid. NIMA via [`idealo/image-quality-assessment`](https://github.com/idealo/image-quality-assessment) (CPU-runnable; can be packaged into an edge function) scores each photo 1–10; keep top 9 instead of first-9. Cost: trivial compute; one-time per place.
2. **Perceptual-hash deduplication** to drop near-duplicates from a venue's photo pool (chains often have 5 identical exterior shots). Library: any pHash implementation (Python `imagehash`, Node `phash-image`); free.
3. **Cloudinary AI auto-tagging** (already a Mingla dependency per ORCH-0978) can extract scene tags (`indoors`, `outdoors`, `crowd`, `intimate`) and inform per-card photo selection. Cost: $200/mo add-on per [Cloudinary pricing](https://cloudinary.com/pricing) — material; not recommended unless ORCH-0978's existing budget covers it.

**Recommended starting point.** NIMA ranking + pHash dedupe on the existing collage compose path. No new external service. Card UI exposes a swipeable photo carousel rather than the static collage — let the user see the AI-curated sequence rather than 9 thumbnails at once.

---

## §8 — Cold-start + ongoing data acquisition

If Mingla stops feeding `place_pool` from Google, new place data must come from somewhere. Options:

| Source | Legality | Completeness | Cost | Freshness | Delight impact |
|---|---|---|---|---|---|
| **Business operators self-add via `mingla-business` claim flow** | Clean — operators consent to inclusion | Sparse early — depends on brand acquisition curve | Free | Operator-controlled (high) | Strong — these places have first-party photos, hours, menu. The "delight" floor is highest here. |
| **Google Places v1 (current)** | Compliant (paid API + ToS) | 100% coverage in supported markets | ~$17/1K Place Details lookups; new ingestion = new cost | Refreshed on `last_detail_refresh`; reviews capped at 5 each | Baseline today. |
| **Foursquare Places API** | Compliant — paid API | ~100M POIs in 200+ countries, fewer than Google in US suburbs | $200/mo credit + $18.75/1K premium calls per [Foursquare pricing](https://foursquare.com/pricing/). Hits a small overage at scale. | Good | Comparable to Google but with attribution requirements. |
| **Yelp Fusion API** | Compliant — paid API; **scraping forbidden** per [Yelp ToS analysis](https://www.octoparse.com/blog/is-scraping-yelp-legal) | US-centric, restaurants/services dominant | Free tier 5K/day; review surface limited to 3/business | Good | Useful as a review-source supplement, not as primary place feeder. |
| **OpenStreetMap (Overpass / Geofabrik)** | Free, ODbL attribution required | High geometry coverage; poor venue metadata (hours, photos) | Free | Volunteer-edited; freshness varies wildly | Weak for consumer-facing — metadata sparsity ≠ delight |
| **TripAdvisor / Resy / OpenTable** | Each has its own ToS; most allow API at enterprise tier only | Strong on restaurants + attractions | Enterprise contracts — not realistic for indie | Good | Useful as inspirational reference only |
| **Web scraping** | Often violates ToS; ORCH-0978 cleanly avoids this for Cloudinary; same posture for other sources | Variable | Variable | Variable | Legal exposure usually > delight gain |

**Recommended cold-start strategy.** Run a **hybrid** in priority order: (1) business-operator-self-added (highest delight, free); (2) Google Places v1 (current baseline, keep on a budget cap of e.g. $200/mo); (3) Foursquare for supplemental data on places Google missed (e.g. small markets or specific neighborhoods). Do not phase out Google entirely until business-operator coverage in a city crosses a threshold (e.g. 50% of servable places have a claimed brand). The "stop feeding from Google" goal is best read as "reduce dependence on Google as the SOLE feeder" not "kill Google ingestion immediately."

For ongoing refresh: pg_cron jobs to (a) run `run-signal-scorer` after any signal_definitions update; (b) refresh Serper reviews for places hit ≥10 times last week; (c) re-run Gemini Q2 for places whose Google `business_status` changed; (d) regenerate photo collage when `stored_photo_urls` fingerprint changes.

---

## §9 — Open questions for operator (8)

1. **Which option (A / A+C / C / D / E) is the intended starting point?** Three plausible answers: (i) Option A — fastest to ship, biggest immediate delight bump, blesses DEC-099 properly; (ii) Option A+C in two sequenced ORCHs — A first, C as a delight follow-up once we have real swipe data; (iii) Option E with A as the upstream — if operational simplicity matters more than freshness. **Recommendation if forced: A first, C as a follow-up ORCH after 2-4 weeks of swipe telemetry from A.**
2. **Should the AI score apply to the singles path immediately, or only to curated?** The trial Q2 covers all 16 signals → singles ranking improvement is one-line code. Curated is more value but more invariant surface. **Recommendation: both at once, gated by the same `ai_signal_scores` column.**
3. **What's the right blend weight `w` between rule and AI scores?** Three plausible answers: (i) 0.6 AI / 0.4 rule globally; (ii) per-signal weights stored in `signal_definition_versions.config.ai_blend_weight` (rules tight for `flowers`/`groceries`, AI heavier for `romantic`/`scenic`); (iii) 1.0 AI for places that have AI evaluation, fall back to rule for places that don't. **Recommendation: option (ii) — per-signal-version, default 0.6, lower for facet-tight signals like flowers.**
4. **Should `inappropriate_for: true` be a hard veto or a soft penalty?** Hard veto means an obviously-wrong place never appears. Soft penalty (e.g. score × 0.1) allows weird matches if nothing better exists. **Recommendation: hard veto — false vetoes are recoverable by ops; false matches are why decks feel "generic."**
5. **Where does the `reasoning` text surface to the user?** Three plausible answers: (i) tucked inside the expand card modal as a "Why we picked this for you" line; (ii) visible on card front as a 1-line subtitle; (iii) not surfaced — internal use only. **Recommendation: (i) — start subtle, validate that users read it via card-expand telemetry, then promote to (ii) if it lands.**
6. **What's the refresh cadence for AI evaluations?** Three plausible answers: (i) every 30 days for every place; (ii) only on triggers (`last_detail_refresh` advance OR `business_status` change OR `editorial_summary` update); (iii) prioritised by swipe traffic — refresh more often for highly-swiped places. **Recommendation: (ii) with a backstop quarterly full sweep.**
7. **Should we stop feeding `place_pool` from Google now, or after AI coverage hits 100% of servable?** The current 2,327/13,671 = 17% AI coverage is enough to ship Option A as a blended ranker, but stopping Google ingestion now means the AI pipeline alone has to keep the pool fresh — which it doesn't (the pipeline ranks places that already exist; it doesn't discover new ones). **Recommendation: keep Google ingestion until business-operator self-add coverage in each city crosses an operator-chosen threshold (e.g. 50% of servable places have `is_claimed=true`).**
8. **Do we register the new pipeline as a single ORCH or a META-ORCH with subs?** The wiring touches: schema (new column), edge function (signalScorer), DEC (lift the invariant), CI gate (strict-grep for any direct trial-table read in production code), backfill job (one-time Gemini sweep), refresh cron. **Recommendation: META-ORCH with 4 subs: Sub-A schema + invariant DEC; Sub-B signalScorer blend; Sub-C Gemini coverage backfill; Sub-D refresh cron + admin re-eval button.**

---

## §10 — Anti-patterns observed (external research)

| Anti-pattern | Where observed | How Mingla's recommended path avoids it |
|---|---|---|
| **Listicle fatigue** ("Top 10 Italian restaurants in your area" decks where every card looks the same) | TripAdvisor's "Things to Do" deck, Yelp's main feed | Mingla's per-card AI reasoning + diversity guard (round-robin by `primary_type`) ensures the user sees variety. |
| **Filter bubble** (collaborative filtering converges to "user likes brunch → only brunch") | Tinder profile shallow-pool effect | Option C's intent-vector matching cuts across categories; Option D includes explicit 15-20% exploration; recommended single-card contract §6 step 7 enforces explore/exploit. |
| **Cold-start tower collapse** (two-tower model fails on first 5 swipes) | Allegro's [two-tower production write-up](https://arxiv.org/html/2508.03702v1) warns about this | We do NOT start with Option D; Option A or A+C is the day-zero ranker. |
| **Stale signal drift** (rule book trained on 2024 reviews, content has evolved) | Common pitfall in regex-based scoring | The Gemini Q2 re-evaluates the actual current reviews on each refresh; rule scorer's regex is only one input. |
| **Silent veto** (an algorithm hides places without explanation; ops can't debug why) | Common in opaque ranking | `ai_signal_scores[signal_id].inappropriate_for` + `reasoning` is auditable per-place per-signal in the admin inspector. |
| **Single-mount divergence** (solo logic ≠ collab logic; bugs hide in the gap) | Mingla's own META-ORCH-0929 had to solve this | The wiring puts the score in `place_scores` (one place, both paths read it); collab determinism is preserved by design. |
| **Authored vibe vocabulary** (PM picks 20 "vibes" → AI tries to match → no room for novelty) | Many AI-discovery apps make this mistake | Mingla's Gemini Q2 outputs free-text `reasoning` AND structured `score_0_to_100` against the EXISTING 16 signals — no new vocabulary to govern. The signal taxonomy stays the same; the scoring engine gets smarter. |
| **Pre-render staleness** (cached recommendation tables outlive the underlying data) | Option E's main risk | Option E is recommended ONLY as a downstream cache, not as a replacement for live scoring. |

---

## §11 — Phase 0 evidence index (cross-reference to §2)

All citations are inline in the relevant sections above. This index lists the file/source set for re-verification:

**Repo files cited:** `app-mobile/src/services/deckService.ts`, `app-mobile/src/components/SwipeableCards.tsx`, `app-mobile/src/components/connections/CollabDeckSheet.tsx`, `app-mobile/src/types/expandedCardTypes.ts`, `supabase/functions/discover-cards/index.ts`, `supabase/functions/generate-curated-experiences/index.ts`, `supabase/functions/_shared/categoryPlaceTypes.ts`, `supabase/functions/_shared/signalScorer.ts`, `supabase/functions/run-place-intelligence-trial/index.ts`, `supabase/functions/score-place-photo-aesthetics/index.ts`, `mingla-business/src/services/experiencesService.ts`, `mingla-business/src/services/experienceGenerationService.ts`.

**Artifact files cited:** `Mingla_Artifacts/WORLD_MAP.md`, `Mingla_Artifacts/DECISION_LOG.md` (DEC-090, DEC-091, DEC-099), `Mingla_Artifacts/INVARIANT_REGISTRY.md` (I-CATEGORY-DERIVED-ON-DROP, I-CATEGORY-SLUG-CANONICAL, I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING, I-COLLAB-DECK-DETERMINISM family), `Mingla_Artifacts/specs/SPEC_ORCH-0712_*`.

**Memory rules cited:** [[collab-deck-determinism-contract]], [[collab-deck-lives-in-group-chat]], [[ai-categories-decommissioned]], [[brand-kind-decommissioned]].

**Live DB probes (2026-05-26):** information_schema column lists for `place_pool`, `place_scores`, `signal_definitions`, `signal_definition_versions`, `place_external_reviews`, `place_intelligence_trial_runs`; row counts and Q2-response samples per §0f probes.

**External URLs cited:**
- pgvector: https://github.com/pgvector/pgvector ; https://severalnines.com/blog/vector-similarity-search-with-postgresqls-pgvector-a-deep-dive/ ; https://aws.amazon.com/blogs/database/optimize-generative-ai-applications-with-pgvector-indexing-a-deep-dive-into-ivfflat-and-hnsw-techniques/
- OpenAI embeddings: https://developers.openai.com/api/docs/models/text-embedding-3-small ; https://tokenmix.ai/blog/openai-embedding-pricing
- Claude Haiku 4.5: https://platform.claude.com/docs/en/about-claude/pricing ; https://www.anthropic.com/news/claude-haiku-4-5
- Google Places v1 fields: https://developers.google.com/maps/documentation/places/web-service/choose-fields ; https://featurable.com/blog/google-places-more-than-5-reviews ; https://developers.google.com/maps/documentation/places/web-service/usage-and-billing
- Yelp Fusion API: https://github.com/Yelp/yelp-fusion ; https://www.octoparse.com/blog/is-scraping-yelp-legal
- Foursquare API: https://foursquare.com/pricing/ ; https://docs.foursquare.com/developer/reference/upcoming-changes
- NIMA + image quality: https://research.google/blog/introducing-nima-neural-image-assessment/ ; https://github.com/idealo/image-quality-assessment ; https://arxiv.org/abs/1709.05424
- Two-tower architectures: https://arxiv.org/html/2508.03702v1 ; https://developers.redhat.com/articles/2026/01/26/understanding-recommender-systems-two-tower-model ; https://www.shaped.ai/blog/the-two-tower-model-for-recommendation-systems-a-deep-dive
- Cloudinary AI tagging: https://cloudinary.com/documentation/cloudinary_ai_content_analysis_addon ; https://cloudinary.com/pricing
- Supabase Cron + Edge Functions: https://supabase.com/docs/guides/cron ; https://supabase.com/blog/processing-large-jobs-with-edge-functions ; https://supabase.com/docs/guides/ai/automatic-embeddings
- React Query keys: https://tanstack.com/query/latest/docs/react/guides/query-keys

---

## Confidence note

- **Codebase claims:** `proven` for the consumer deck files (read in full), `proven` for `discover-cards` and `generate-curated-experiences` (read), `probable` for `signalScorer.ts` (sampled config but not full code), `proven` for the experience pipeline structure (Explore agent read + my own targeted probes).
- **DB data claims:** `proven` — all counts came from live `mcp__supabase__execute_sql` against production.
- **Prior artifact claims:** `probable` — relied on Explore agent's deep-read; spot-verified DEC-099 and I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING citations are paraphrases, not exact-text reads.
- **External research claims:** `probable` — all citations are URLs that I retrieved via WebSearch in this session; pricing and quotas are as of 2026-05-26 and may shift.
- **Cost estimates:** `probable` for AI evaluation (well-grounded in published pricing); `suspected` for end-to-end ongoing costs (depends on operational tempo decisions in §9 Q6).

No `proven` claim is contradicted by a `probable` or `suspected` claim. Where uncertainty matters for decision-making, it's called out inline.
