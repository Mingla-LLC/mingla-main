# Signal Taxonomy — Active State

**Last calibration:** 2026-05-05 · run `1adf4842-1018-41a5-9262-e06396119f24` · prompt v2 · 32-anchor sweep · $0.66 (Anthropic Haiku 4.5 — DEPRECATED).
**Cutoffs locked:** DEC-100 (pending; locks at Phase 1 SPEC dispatch).

> ## ⚠ Cutoff status — RE-DERIVATION PENDING (post-ORCH-0733)
>
> Cutoffs in the table below were derived from **Anthropic Haiku 4.5 v3 calibration**.
>
> Per **DEC-101 (post-ORCH-0733, 2026-05-05)**, the trial pipeline is now **Gemini 2.5 Flash sole provider** + **prompt v4** (anti-VETO discipline + contradictory-evidence weighting fixes). Live evidence: comparison run `fe15cb99` showed Gemini scores 5–15 points HIGHER than Anthropic on positive matches and over-fires VETO ~3× more than Anthropic. v4 prompt fixes the VETO over-fire pattern.
>
> **Cutoffs need re-derivation** from a fresh Gemini v4 calibration sweep — pending operator-gated verification of v4 prompt behavior. Until re-derivation, the cutoffs below remain the spec writer's reference but should be assumed **+5–10 inflated** for Gemini matching. Treat all cutoff numbers as Anthropic-baseline UNTIL DEC-102 locks Gemini-specific cutoffs.

**Scoring scale:** `score_0_to_100` integer per [`run-place-intelligence-trial/index.ts`](../../supabase/functions/run-place-intelligence-trial/index.ts) system prompt rubric:
- 90-100 = anchor-quality / world-class
- 70-89 = strong fit
- 50-69 = ok / acceptable
- 30-49 = weak
- 1-29 = very weak
- 0 = `inappropriate_for=true` (hard veto for STRUCTURAL wrongness only)

---

## Live signals (16, status: LIVE)

### Type-grounded (11)

| Signal | Cutoff | Definition | Admits | Excludes |
|---|---|---|---|---|
| `fine_dining` | **75** | Upscale occasion dining; tasting menus, sommelier, prix fixe, formal service | Calusso, Fairview Dining Room | Casual restaurants, fast food |
| `brunch` | **70** | Breakfast / brunch service with weekend brunch program emphasis | Mala Pata Molino + Cocina, Big Ed's | Restaurants without brunch service (Central Michel Richard `serves_breakfast=false` → 5) |
| `casual_food` | **70** | Everyday lunch/dinner restaurants; non-occasion dining | Taza Grill, Wang's Kitchen | Fine dining, fast food only |
| `drinks` | **80** | Bars, cocktail lounges, breweries, nightlife venues | DSSOLVR Durham, Arcana Bar | Restaurants where alcohol is incidental |
| `creative_arts` | **65** | Galleries, museums, art studios; cultural destinations | National Gallery, Guildhall, La Monnaie (overlap) | Restaurants, parks |
| `flowers` | **50** | Grab-and-go ready bouquet retail (5-min purchase) | Florists with display-case stock, grocery flower aisles (Harris Teeter, TJ's, Wegmans) | **Event-only-by-appointment florists (Bayfront → VETO)** |
| `groceries` | **60** | Grocery stores, supermarkets | Harris Teeter, Trader Joe's, Wegmans | Restaurants, convenience stores |
| `movies` | **50** | Cinemas, drive-ins, movie theaters | Regal Crossroads, Triangle Cinemas | Performance theaters (those go to `theatre`) |
| `theatre` | **70** | Performing arts, concert halls, opera, live performance | Royal Festival Hall, La Monnaie | Movie theaters |
| `nature` | **70** | Parks, gardens, trails, outdoor scenic destinations | Lekki Conservation, Domain Three Fountains | Indoor venues |
| `play` | **65** | Amusement, bowling, mini golf, arcades, escape rooms, family-fun activity venues | Babylon Park, ParTee Shack, Boxcar (overlap with lively) | Quiet venues |

### Quality-grounded (5)

| Signal | Cutoff | Definition | Admits | Excludes |
|---|---|---|---|---|
| `lively` | **70** | High-energy, social, music, dancing atmosphere | Boxcar Bar + Arcade, Backyard | Quiet, intimate venues |
| `picnic_friendly` | **65** | Parks/lawns suitable for picnics; bring-your-own-blanket destinations | William B. Umstead, Pullen Park | Closed indoor venues |
| `romantic` | **65** | Intimate, candle-lit, date-night atmosphere | TDQ Steaks, Anthony's Runway 84 | Loud arcades, sterile environments |
| `scenic` | **70** | Viewpoints, observation decks, photogenic outdoor | Hugh Taylor Birch, Lake Roland | Indoor-only venues |
| `icebreakers` | **65** | Light & fun first-meet venues — cafes, dessert, casual day | Big Ed's, Rosslyn Coffee | Loud nightclubs, formal restaurants |

---

## Cutoff distribution

| Cutoff | Signals | Count |
|---|---|---|
| 50 | `flowers`, `movies` | 2 |
| 60 | `groceries` | 1 |
| 65 | `creative_arts`, `play`, `picnic_friendly`, `romantic`, `icebreakers` | 5 |
| 70 | `brunch`, `casual_food`, `lively`, `theatre`, `nature`, `scenic` | 6 |
| 75 | `fine_dining` | 1 |
| 80 | `drinks` | 1 |

**Default = 70** (rubric "strong fit" tier). Exceptions justified per cutoff column above.

---

## Cross-cutting overlap (legitimate, not noise)

Many places fit multiple signals. Phase 1 production rerank lets a place surface in any deck where its score ≥ that signal's cutoff. Examples from v2 calibration:

| Place | Anchored for | Cross-signal scores |
|---|---|---|
| TDQ Steaks | `romantic` (88) | `fine_dining` 92 |
| Harris Teeter | `flowers` (55) | `groceries` 92 |
| Boxcar Bar + Arcade | `lively` (anchored) | `play` 92 |
| La Monnaie | `theatre` (98) | `creative_arts` 95 · `scenic` 80 |
| Pullen Park | `picnic_friendly` (anchored) | `play` 95 · `nature` 80 |
| Anthony's Runway 84 | `romantic` (72) | `fine_dining` 82 · `lively` 85 |

This is **feature, not bug**. Production rerank reads `place_pool.claude_signal_evaluations->signal_id->>'score_0_to_100'` for each deck request — same place can legitimately rank in multiple decks with different scores.

---

## Veto reservation (per DEC-099 + system prompt rubric)

`inappropriate_for=true` (hard veto, sets score to 0) is reserved for STRUCTURAL wrongness only:

| Place | Signal | Why VETO is correct |
|---|---|---|
| Bayfront Floral & Event Design | `flowers` | Event-only-by-appointment; weeks-ahead consultation; structurally mismatched with grab-and-go semantic |
| (any gym) | any food signal | No food service — structural |
| (any closed-permanent) | any signal | Not operational |
| (any hospital / funeral home) | `romantic`, `lively`, `play` | Not a date venue — structural |

VETO is NOT for "low quality" or "weak fit" — those get low scores 1-49 instead.

---

## Update protocol

When this file changes:
1. Locked cutoffs only ever come from a calibration trial run (recorded in [CALIBRATION_LOG.md](CALIBRATION_LOG.md)).
2. New signals only ever enter via DEC entry → migration to `signal_definitions` → calibration run → cutoff lock here.
3. Definition tweaks (e.g., `flowers` admitting grocery aisles) go in operator decision (DEC entry) and reflect here.
4. Status changes (`LIVE` → deprecated) require ORCH closure + cleanup migration.
