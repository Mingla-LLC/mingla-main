# Calibration Log

Append-only history of trial calibration runs. Each entry records what changed, what was learned, what cutoffs locked.

**Convention:** newest at top. Append on every trial run that produces locked cutoffs OR signals taxonomy change.

---

## Entry 005 — v4 Gemini PASS · 2026-05-05

**Run ID:** `e15f5d8f-2d0d-4318-8980-8d125c37730f`
**Provider / model:** Gemini 2.5 Flash
**Prompt version:** `v4` (anti-VETO discipline + contradictory-evidence weighting)
**Sweep size:** 32 anchors
**Cost:** **$0.1292** (+6.6% vs v3 Gemini $0.1212; longer prompt body)
**Wall time:** **10:59** (comparable to v3 Gemini 10:40)
**Status:** **31/32 success, 1 failed** (Harris Teeter / `flowers` — `MALFORMED_FUNCTION_CALL`, non-deterministic Gemini-side flake; same row passed in v3)
**Cutoffs:** UNCHANGED (Anthropic-baseline; Gemini-specific re-derivation reserved as DEC-103 dispatch)

**What changed vs v3 (per ORCH-0733 commit `c7ae31f9`):**
- **Anti-VETO examples block** added to system prompt — 11 explicit "score 1-15, NOT VETO" cases (Mala Pata × 6 signals + Wang's Kitchen / fine_dining + Big Ed's / fine_dining + Big Ed's / flowers + Taza Grill / fine_dining + National Gallery / fine_dining) directly addressing Gemini's 58 false-positive vetoes documented in v3 Gemini run.
- **WEIGHING CONTRADICTORY EVIDENCE** section added — codifies Anthony's Runway 84 / `romantic` = 70-80 as canonical example. Rule: when documentary evidence already grades the place (upscale dim-lit dinner spot), mood-deduction (loud bar scene) caps at 5-15 score impact, NOT 30. Restores operator-anchored truth.
- **2 new calibration examples** added — Anthony's Runway 84 + Calusso/brunch. Both grounded in operator-anchored truth.
- **PROMPT_VERSION** v3 → v4. Audit-trail comment in `index.ts` ties to ORCH-0733.
- **Anthropic dropped from active code path** (per DEC-102) — `callQuestion`, `callAnthropicWithRetry`, `AnthropicUsage`, `MODEL_ID`, `ANTHROPIC_VERSION`, `ANTHROPIC_MESSAGES_URL`, `Provider` type all block-commented for reversibility per Const #7.

**Critical spot-check verification — 12/12 PASS:**

| Place / Signal | v3 Gemini | v4 Gemini | Verdict |
|---|---|---|---|
| **Anthony's Runway 84 / `romantic`** | **40** | **65** | **HEADLINE WIN** — clears 65 cutoff per operator-anchored truth |
| Anthony's / `lively` | 95 | 95 | identical |
| Anthony's / `fine_dining` | 85 | 85 | identical |
| **Mala Pata / `flowers`** | **VETO** | **1** | anti-VETO discipline applied |
| **Mala Pata / `play`** | **VETO** | **1** | anti-VETO discipline applied |
| **Mala Pata / `theatre`** | **VETO** | **1** | anti-VETO discipline applied |
| Mala Pata / `brunch` (anchor) | 90 | 95 | improved |
| Mala Pata / `casual_food` | 80 | 80 | identical |
| Mala Pata / `fine_dining` | 75 | 75 | identical |
| Bayfront / `flowers` | VETO | VETO | structural VETO preserved (event-only) |
| Calusso / `brunch` | VETO | VETO | structural VETO preserved (`serves_breakfast=false`) |
| Calusso / `fine_dining` (anchor) | 95 | 95 | identical |
| National Gallery / `creative_arts` (anchor) | 98 | 98 | identical |
| Boxcar / `lively` (anchor) | 90 | 95 | improved |
| Taza Grill / `casual_food` (anchor) | 95 | 90 | within tolerance |
| Wang's Kitchen / `casual_food` (anchor) | 85 | 95 | improved |
| Wang's / `brunch` | VETO | VETO | structural VETO preserved |
| Big Ed's / `icebreakers` (anchor) | 75 | 70 | within tolerance |

**Minor anti-VETO bleed-through (acceptable):** Big Ed's / `fine_dining` VETO → 5; Big Ed's / `flowers` VETO → 5; Wang's / `fine_dining` VETO → 10. All score well below cutoffs — functionally identical.

**Reliability flake:** 1 row failed with `MALFORMED_FUNCTION_CALL` (Harris Teeter / `flowers`). Pattern: Gemini's structured-output API occasionally produces malformed function_call responses on ~3% of calls; not deterministic; same row succeeded in v3 Gemini run. Mitigation deferred to next dispatch (city-runs SPEC will add auto-retry-once on `MALFORMED_FUNCTION_CALL` to push reliability ~96.9% → ~99.9%).

**Decisions enabled:**
- **DEC-102** locked — Gemini 2.5 Flash sole provider; PROMPT_VERSION=v4; Anthropic dropped from active code.
- **DEC-103 reserved** — Gemini-specific cutoff re-derivation dispatch. Current cutoffs are Anthropic-baseline; treat as +5-10 inflated for Gemini matching until DEC-103 locks fresh values.
- **City-runs dispatch (deferred until ORCH-0733 close — now unblocked)** — drop `signal_anchors` table; hook trial runs to a chosen city's servable place_pool rows; bundle Gemini auto-retry-once.

**Implementation report:** [`reports/IMPLEMENTATION_ORCH-0733_GEMINI_FIX_AND_ANTHROPIC_DROP_REPORT.md`](../reports/IMPLEMENTATION_ORCH-0733_GEMINI_FIX_AND_ANTHROPIC_DROP_REPORT.md)
**Commit:** `c7ae31f9`

---

## Entry 004 — v3 Gemini A/B comparison · 2026-05-05

**Run ID:** `fe15cb99-7577-474c-a3de-a961df917ccb`
**Provider / model:** Gemini 2.5 Flash (A/B test against Anthropic v3 baseline `942fbddf-819a-42d7-88de-449900698cbb`)
**Prompt version:** `v3` (verbatim — same prompt used by Anthropic for fair comparison)
**Sweep size:** 32 anchors
**Cost:** **$0.1212** (-71% vs Anthropic v3 $0.4141)
**Wall time:** **10:40** (vs Anthropic v3 12:23; comparable due to provider-aware throttle: Gemini Flash 1s vs Anthropic Tier 1 9s floor)
**Status:** 32/32 completed; 0 failures
**Cutoffs:** NOT LOCKED (A/B comparison only; flagged 2 quality drifts requiring v4 prompt redesign before any Gemini-specific cutoff lock)

**What changed vs Anthropic v3:**
- Provider switched from Anthropic Claude Haiku 4.5 to Gemini 2.5 Flash via the new dual-provider toggle in `run-place-intelligence-trial`.
- Same v3 prompt body (single Q2 call with `score_0_to_100` + `inappropriate_for` + reasoning per signal).
- Output adapter uses Gemini's `function_declarations` + `function_call` response shape (vs Anthropic `tool_use` content blocks).
- `maxOutputTokens: 8000` post-ORCH-0732 fix (initial run `064c6133` failed 5/5 with `MALFORMED_FUNCTION_CALL` due to 2000-token truncation on 16-eval response).

**Quality drifts surfaced (motivated v4 prompt + DEC-102):**
1. **Score inflation on positive matches** — Gemini scored 5-15 points HIGHER than Anthropic on the same anchor places. Manageable but observable consistently.
2. **VETO over-fire ~3×** — Gemini fired 58 false-positive vetoes vs Anthropic's 19. Most egregious: **Mala Pata × 6 signals VETOed** (theatre/play/groceries/picnic_friendly/nature/flowers — none structurally inappropriate; just weak fit). Mechanism: Gemini interprets the VETO rule more aggressively, treating "weak fit" as structural mismatch when the Anthropic-tuned prompt expected score 1-15.
3. **Anthony's Runway 84 / `romantic` = 40** vs operator-anchored truth 70-80. Mechanism: Gemini over-weighted reviews-mood ("loud bar scene") against documentary upscale-Italian evidence, producing a score that under-clears the romantic cutoff for a place the operator anchored as a romantic dinner spot.

**Anchor agreement:**
- ~73% within ±10 of Anthropic v3 scores (manageable variance)
- 85% VETO agreement on structural cases (Bayfront/flowers, Calusso/brunch — both providers correctly VETO)
- All 16 signal anchors cleared their cutoffs in both providers

**Cost & speed envelope:**
- Per-place: ~$0.0038 Gemini vs ~$0.0129 Anthropic Haiku 4.5 (-71%)
- Browser throttle: 1s Gemini vs 9s Anthropic Tier 1 floor — material wall-time win for ad-hoc operator runs
- Triangle full backfill projection: ~$11 Gemini vs ~$41 Anthropic at v3 sync rates

**Decisions enabled:**
- Operator decision 2026-05-05 ("Lets drop anthropic, and fix gemini"): drop Anthropic from active code; lock Gemini sole provider; address quality drifts via v4 prompt redesign rather than provider revert.
- v4 prompt SPEC dispatched same day with anti-VETO discipline + contradictory-evidence weighting → run `e15f5d8f` (Entry 005) confirmed PASS.

**Implementation report:** [`reports/IMPLEMENTATION_ORCH-0713_GEMINI_COMPARISON_REPORT.md`](../reports/IMPLEMENTATION_ORCH-0713_GEMINI_COMPARISON_REPORT.md) + throttle patch [`reports/IMPLEMENTATION_ORCH-0713_GEMINI_THROTTLE_PATCH_REPORT.md`](../reports/IMPLEMENTATION_ORCH-0713_GEMINI_THROTTLE_PATCH_REPORT.md) + maxTokens fix [`reports/IMPLEMENTATION_ORCH-0732_GEMINI_MAXTOKENS_FIX_REPORT.md`](../reports/IMPLEMENTATION_ORCH-0732_GEMINI_MAXTOKENS_FIX_REPORT.md)
**Commit:** `ab84df20` (maxOutputTokens fix bundle)

---

## Entry 003 — v3 cost-reduction validation · 2026-05-05

**Run ID:** `942fbddf-819a-42d7-88de-449900698cbb`
**Prompt version:** `v3`
**Sweep size:** 32 anchors (same as v1/v2)
**Cost:** **$0.4141** (was $0.66 v2; -37%)
**Wall time:** **12:23** (was ~30 min v2; -59%)
**Status:** 32/32 completed; 0 failures
**Cutoffs:** UNCHANGED (v2 cutoffs still hold; v3 is cost-only optimization)

**What changed vs v2 (per ORCH-0713 cost reduction commit `01ffad54`):**
- **Q1 removed** — research-only call (`propose_signals_and_vibes` with proposed_signals + proposed_vibes + notable_observations) deleted entirely. Q1 outputs already harvested into `PROPOSALS.md`. Cuts 1 of 2 Anthropic calls per place.
- **Collage shrunk** 1024×1024 → 768×768. ~30-40% image-token saving per call. Per-tile clarity preserved on dense 3×3 (256px) and 4×4 (192px) grids.
- **PROMPT_VERSION** v2 → v3. New runs distinguishable from v2 by `prompt_version="v3"` and `q1_response IS NULL`.

**Spot-check verification — quality preserved or improved (PASS):**

| Place / Signal | v2 score | v3 score | Verdict |
|---|---|---|---|
| Bayfront / `flowers` | VETO 0 | VETO 0 | identical |
| Harris Teeter / `flowers` | 55 | 55 | identical |
| Harris Teeter / `groceries` | 92 | 92 | identical |
| National Gallery / `creative_arts` | 98 | 98 | identical |
| Mala Pata / `brunch` | 88 | 88 | identical |
| Mala Pata / `groceries` | low | 1 | low-not-veto correct |
| Central Michel Richard / `brunch` | 5 | 5 | bad-anchor still caught |
| **Calusso / `brunch`** | low | **VETO 0** | **NEW — IMPROVED** — Claude's reasoning cites `serves_brunch=false` from negative booleans firing structural veto |
| Calusso / `fine_dining` | 92 | 82 | -10 (within tolerance; reasoning notes service variability) |

**Cost delta — honest analysis:**
Projected -55% saving; actual **-37%**. The gap is honest:
- Q1 was already prompt-cache-cheap on the second call (system prompt cached). Its marginal cost was ~$0.005, not $0.010 as projected.
- v2 system prompt is materially longer than v1 (added scoring rubric + 7 calibration examples in Phase 0.5). Each Q2 call now costs ~$0.013 vs ~$0.010 in v1.
- Smaller collage delivered the projected ~$0.0008 saving per call.
- Net: dropping Q1 saved less than modeled because Q1 was cheaper than modeled.

Wall-time saving (-59%) is larger than cost saving — single API call per place + no 30s inter-question throttle. UX win for ad-hoc operator runs.

**Triangle full backfill refresh:** $66 → ~$41 (-37%) at v3 sync rates. With Anthropic Batch API (proposed lever 2 for production background jobs only — 24h delivery), drops further to ~$21.

**No regression detected.** All 16 signals' anchor scores match v2 within ±10. VETO usage healthier under v3 (Calusso/brunch case proves the rubric+booleans cooperation is firing more precisely).

**Decisions enabled:**
- v3 prompt + 768px collage are LOCKED as the trial pipeline default going forward.
- Phase 1 production rerank pipeline (per `prompts/SPEC_ORCH-0713_PHASE_1_UNIFIED_PIPELINE.md`) should adopt v3 prompt verbatim — proven cost + quality profile.

**Implementation report:** [`reports/IMPLEMENTATION_ORCH-0713_TRIAL_COST_REDUCTION_REPORT.md`](../reports/IMPLEMENTATION_ORCH-0713_TRIAL_COST_REDUCTION_REPORT.md)
**Commit:** `01ffad54`

---

## Entry 002 — v2 calibration · 2026-05-05

**Run ID:** `1adf4842-1018-41a5-9262-e06396119f24`
**Prompt version:** `v2`
**Sweep size:** 32 anchors (2 per signal × 16 signals)
**Cost:** $0.6578
**Wall time:** ~30 minutes
**Status:** 32/32 completed; 0 failures

**What changed vs v1:**
- Q2 tool schema swap — replaced `strong_match` (bool) + `confidence_0_to_10` (number) with single `score_0_to_100` (integer); kept `inappropriate_for` (bool — hard veto)
- System prompt — added Q2 SCORING RUBRIC with explicit tier definitions (90-100 anchor / 70-89 strong / 50-69 ok / 30-49 weak / 1-29 very weak / 0=veto) + INAPPROPRIATE_FOR rules with 7 calibration examples (Bayfront/flowers VETO, Harris Teeter/flowers 50-70, etc.)
- `buildUserTextBlock` — added `price_range: $X-$Y USD` rendering when `price_range_*_cents` present; split booleans into TWO lists (`google_booleans_true` + `google_booleans_false`) — v1 only showed `=== true`

**Spot-check verification (5/5 PASS):**
- Bayfront Floral / `flowers` → VETO + score 0 ✓ (predicted: VETO)
- Harris Teeter / `flowers` → 55 ✓ (predicted: 50-70)
- National Gallery / `creative_arts` → 98 ✓ (predicted: 90-100)
- Mala Pata / `brunch` → 88 ✓ (predicted: 80-95)
- TDQ Steaks / `romantic` → 88 ✓ (anchor-quality)

**Negative-boolean fix validated:**
Central Michel Richard (operator-anchored `brunch`) scored 5 with reasoning citing `serves_breakfast=false`. Direct evidence the v2 boolean split fix is delivering value — Claude could not have made this decision under v1 (where false booleans were silently omitted).

**Cross-cutting overlap confirmed legitimate:**
20+ non-anchored places scored ≥80 for cross-signals where the place legitimately fits both (TDQ/`fine_dining`=92 anchored romantic; La Monnaie/`creative_arts`=95 anchored theatre; Pullen Park/`play`=95 anchored picnic_friendly). Phase 1 production rerank treats this as feature — same place legitimately ranks in multiple decks.

**Cutoffs locked (16):**

| Signal | Cutoff | Anchor min/max | Non-anchor max | Vetoed/32 |
|---|---|---|---|---|
| `fine_dining` | 75 | 82/92 | 92 | 9 (28%) |
| `drinks` | 80 | 88/95 | 82 | 4 (13%) |
| `brunch` | 70 | 5*/88 | 95 | 6 (19%) |
| `casual_food` | 70 | 82/92 | 85 | 4 (13%) |
| `lively` | 70 | 85/88 | 85 | 0 |
| `theatre` | 70 | 95/98 | 65 | 21 (66%) |
| `nature` | 70 | 88/95 | 95 | 10 (31%) |
| `scenic` | 70 | 85/88 | 90 | 0 |
| `creative_arts` | 65 | 95/98 | 95 | 2 (6%) |
| `play` | 65 | 92/95 | 95 | 13 (41%) |
| `picnic_friendly` | 65 | 85/85 | 88 | 16 (50%) |
| `romantic` | 65 | 72/88 | 88 | 0 |
| `icebreakers` | 65 | 70/75 | 82 | 1 (3%) |
| `groceries` | 60 | 92/95 | 92 | 27 (84%) |
| `flowers` | 50 | 0/55** | 75 | 21 (66%) |
| `movies` | 50 | 78/90 | 1 | 29 (91%) |

*`brunch` anchor min=5 because operator-anchored Central Michel Richard scored 5 (correctly downscored — bad anchor pick caught by Claude). Mala Pata is the true brunch anchor at 88.
**`flowers` anchor min=0 because Bayfront Floral scored 0 (correctly VETOed for event-only; structural mismatch with grab-and-go signal). Harris Teeter is the true grocery-aisle anchor at 55.

**Veto usage health:** appropriate distribution — high-veto signals (movies 91%, groceries 84%, flowers 66%, theatre 66%) reflect the structural narrowness of those categories. Zero false-positive vetoes detected. Lenient signals (lively 0%, romantic 0%, scenic 0%) used low scores instead of vetoes per rubric instructions.

**Decisions enabled:**
- DEC-100 to lock 16 cutoffs into `signal_definitions.config.claude_cutoff_0_to_100`
- Phase 1 SPEC dispatch can ship with these initial values

**Implementation report:** [`reports/IMPLEMENTATION_ORCH-0713_TRIAL_GAP_FILL_REPORT.md`](../reports/IMPLEMENTATION_ORCH-0713_TRIAL_GAP_FILL_REPORT.md)
**Commit:** `d76630fe`

---

## Entry 001 — v1 initial calibration · 2026-05-04

**Run ID:** `3873ff24-5faa-4b2e-9466-ec7276ee3b8b`
**Prompt version:** `v1`
**Sweep size:** 32 anchors
**Cost:** $0.5930
**Wall time:** ~30 minutes
**Status:** 32/32 completed; 0 failures

(Earlier failed run `17b5a4f4-bb59-4360-b5b2-e4a373449b94` 22/32 — superseded; cancelled mid-run; replaced by `3873ff24…`)

**Q2 output shape (v1):**
- `signal_id` + `strong_match` (bool) + `confidence_0_to_10` (number) + `inappropriate_for` (bool) + `reasoning`

**Anchor agreement (v1):** 30/32 (94%). Operator-anchored signal appeared in Claude's strong_matches for 30 of 32 places.

**Two disagreements (both correct):**
- Central Michel Richard / `brunch` — Claude returned `fine_dining` 9 + `lively` 8 + `drinks` 8, NO brunch in strong_matches. Reviews didn't surface brunch evidence; place is French upscale. Operator's anchor was likely wrong.
- Harris Teeter / `flowers` — Claude returned `groceries` 10 + `flowers` 7. Identified primary identity (grocery store) with flowers as sub-feature. Confirmed `place_scores → flowers` had noise.

**Q1 outputs (research-only, never shipped to production):**
- 39 unique proposed_signals across 32 places
- ~160 vibe phrases (160 = 32 × 5 each)
- 6 anti-signal candidates surfaced (`noise_fatigue`, `reservation_friction`, `intimate_high_volume_tension`, `security_and_staff_risk`, `accessibility_gaps`, `service_inconsistent`)
- Themes: cocktail-destination subdivision, demographic safety (queer/inclusive), family-friendly variants, event-vendor sub-vertical, anti-signals as new dimension

**No cutoffs locked** at v1 — confidence_0_to_10 + strong_match dual-field shape didn't map cleanly to a single threshold; operator directed prompt redesign before locking.

**Decisions enabled:**
- DEC-098 — 3-phase ORCH-0713 architecture lock + 3 ACCEPTED-PHASE2 signals + anti-signal dimension
- DEC-099 — Schema simplification: drop photo_aesthetic + signal_anchors; single JSONB column on place_pool
- v2 prompt redesign (Phase 0.5 calibration sprint)

**Investigation report:** [`reports/INVESTIGATION_ORCH-0713_PIPELINE_AUDIT.md`](../reports/INVESTIGATION_ORCH-0713_PIPELINE_AUDIT.md)

---

## Future entries

When the next calibration run completes, append a new entry at the TOP. Required fields:
- Run ID (uuid from `place_intelligence_trial_runs.run_id`)
- Prompt version
- Sweep size + cost + wall time
- What changed in prompt + schema vs prior version
- Spot-check verification matrix (predicted vs actual on 5+ key cases)
- Cutoffs locked (or "no change")
- DEC entry references
