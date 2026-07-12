# INVESTIGATION — ORCH-1363: "Take a Stroll" curated deck returns "No spots match right now" (empty deck)

- **Phase:** INVESTIGATE (read-only; no SPEC, no product-code change)
- **Date:** 2026-07-12
- **Investigator:** mingla-forensics
- **Confidence:** PROVEN / CONFIRMED (live-fire against the deployed PROD edge function + PROD DB, code trace, all five truth layers reconciled)
- **Prod project:** `gqnoajqerqhnvulmnyvv` (READ-ONLY throughout — SELECTs + public-anon edge-function reads only; zero writes)

---

## 1. Symptom summary (expected vs actual)

- **Expected:** Selecting the **Take a Stroll** curated vibe in the consumer app (app-mobile) returns a deck of curated 2-stop cards (a scenic nature stop paired with a nearby food stop).
- **Actual:** Zero cards; empty-state copy **"No spots match right now."**
- **Reproduction:** Deterministic for a user near several live-city centers on the default preference (**walking, 30-min** travel constraint). Confirmed live against the deployed edge function.

---

## 2. Verdict up front

**Root cause is a CODE BUG in the curated card assembler, NOT a supply/seeding gap.**

`generate-curated-experiences` (the actual take-a-stroll deck generator) pins the **first stop** of every combo to `available[0]` — the single **highest-`scenic`-ranked** nature place. For take-a-stroll the nature stop is the **constant anchor** across all three combos, so *every* combo picks the *same* top place. When that one place fails the post-assembly **travel-time gate** (`travelTimeFromUserMin > travelConstraintValue × 1.5`), the standard (non-reverse-anchor) branch has **no mechanism to advance to the next candidate** — so it re-picks the same failing place on every iteration and builds **0 cards**, emitting `emptyReason: 'pool_empty'` → "No spots match right now."

This is the **same failure mode** that ORCH-0677 fixed for *reverse-anchor* types via `failedAnchorIds` (invariant `I-CURATED-FAILED-ANCHOR-IS-USED`). That fix was **never applied to the standard branch**, and take-a-stroll is the one standard type whose stop-1 category is constant, so it is uniquely exposed.

- **Classification:** CODE BUG (**cause c** — a selection/gate interaction that drops otherwise-valid scenic places). **Not** a seeding/ops action.
- **Cause (a) supply/seeding gap — REFUTED** (supply is healthy in every live market).
- **Cause (b) `get-companion-stops` `strollData:null` — NOT THE DECK** (that is a different feature — the expanded-card stroll route — see §7).
- **Cause (d) `pipeline_error` — REFUTED** (the function returns a graceful `pool_empty`, no exception).

---

## 3. Investigation manifest (files read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `app-mobile/src/types/onboarding.ts:161` | `take-a-stroll` interest definition |
| 2 | `app-mobile/src/utils/categoryUtils.ts:219` | 'Take a Stroll' → `nature` mapping |
| 3 | `app-mobile/src/services/curatedExperiencesService.ts` | Client request builder → `generate-curated-experiences` |
| 4 | `app-mobile/src/components/SwipeableCards.tsx:2470-2540` | Empty-state copy mapping (`no_matches_title`) |
| 5 | `app-mobile/src/types/curatedExperience.ts:62-72` | `CuratedEmptyReason` union + copy contract |
| 6 | `supabase/functions/generate-curated-experiences/index.ts` (full, 1994 lines) | The actual deck generator: type defs, standard vs reverse-anchor assembly, gates, summary |
| 7 | `supabase/functions/_shared/signalRankFetch.ts` | `fetchSinglesForSignalRank` + RPC params + G3 photo gate |
| 8 | `supabase/functions/_shared/distanceMath.ts` | `radiusKmForConstraint` (radius) + `estimateTravelMinutes` (gate) |
| 9 | `supabase/migrations/20260801000001_orch_0990_fetch_local_signal_ranked_primary_type_gate.sql` | Latest `fetch_local_signal_ranked` RPC (the INNER-JOIN-on-rank-signal question) |
| 10 | `supabase/functions/get-companion-stops/index.ts` | Confirm it is the stroll-route feature, not the deck |
| 11 | `supabase/functions/check-launch-city/index.ts` | Live-city gate = `seeding_cities.is_live_for_consumers` |
| 12 | `Mingla_Artifacts/INVARIANT_REGISTRY.md:3291-3335` | `I-CURATED-FAILED-ANCHOR-IS-USED` (ORCH-0677, reverse-anchor-scoped) |

---

## 4. Q-scorecard

**Q1 — Which pipeline actually generates the Take-a-Stroll deck?**
`generate-curated-experiences` with `experienceType:'take-a-stroll'` (client → `curatedExperiencesService.generateCuratedExperiences`). The RPC it uses for stops is `fetch_local_signal_ranked`, NOT `query_servable_places_by_signal`.
**Verdict:** `generate-curated-experiences`. The WORLD_MAP hypothesis attributing the deck to `get-companion-stops` → `query_servable_places_by_signal` is **wrong** (Docs↔Code contradiction, F-5). *proven.*

**Q2 — Is there a `scenic`-anchor supply/seeding gap in the live markets (cause a)?**
No. `place_scores` holds **34,219 `scenic` score rows** (2,710 ≥120) globally. Per live city, the scenic INNER-JOIN drops **zero** nature≥120 places; every live city has hundreds of servable+photo scenic nature anchors (London 384, NYC 1,345, smallest Brussels 18) plus thousands of food places.
**Verdict:** REFUTED. Supply is healthy. *proven.*

**Q3 — Does the RPC's INNER JOIN on the rank signal (`scenic`) starve the pool?**
No. `nature_ge120_photo == nature_stop_supply` in **every** live city — the `scenic` existence join removes nothing.
**Verdict:** REFUTED. *proven.*

**Q4 — Does the deployed edge function reproduce the empty deck, and with what reason?**
Yes. London (walking/30) → `cards:0, emptyReason:'pool_empty', totalCardsBuilt:0`. Reproduced exactly.
**Verdict:** Reproduced; `pool_empty` at build stage. *proven.*

**Q5 — Why are 0 cards built when the RPC returns 23 nature + 100 food candidates for London?**
The #1 `scenic`-ranked nature place (Queen Mary's Rose Gardens, scenic 173.8) is **2.811 km → 48.7-min walk**, just past the **45-min** travel gate (30×1.5). Stop-1 is hard-pinned to `available[0]`; nature is the constant anchor; the standard branch never advances past a gate-failing top place → all combos fail → 0 cards.
**Verdict:** CONFIRMED ROOT CAUSE (F-1). *proven* (loosening gate → cards appear; see F-1 evidence).

**Q6 — Is take-a-stroll uniquely affected, or do other curated types share it (collateral)?**
Unique among the empty-to-zero types. At London walking/30: adventurous 3, picnic-dates 2, first-date 6, romantic 1, group-fun 6 — only take-a-stroll = 0.
**Verdict:** take-a-stroll-specific; others degrade gracefully. *proven* (F-4).

**Q7 — Is `all_closed_at_time` a second, distinct empty path?**
Yes, secondary and time-of-day dependent. Lagos & Brussels built cards then the ORCH-1113 open-hours filter dropped all → `all_closed_at_time` (different copy: "Everything's closed"). Not the "No spots match" symptom.
**Verdict:** Secondary co-occurring path, working as designed (F-3). *proven.*

---

## 5. Findings (six-field evidence)

### F-1 — CONFIRMED ROOT CAUSE: standard-branch stop-1 pinning + no failed-place advance ⇒ constant scenic anchor that fails the travel gate empties the whole deck

1. **Symptom:** Take-a-Stroll deck returns 0 cards, `emptyReason:'pool_empty'`, "No spots match right now."
2. **Layer:** Code (edge function) ↔ Data (place geography) ↔ Runtime (deployed fn).
3. **Probe:**
   - Deployed edge fn, London center, walking/30 (baseline), then gate loosened, then driving:
     ```
     POST /functions/v1/generate-curated-experiences
     {experienceType:'take-a-stroll', location:{lat:51.5072178,lng:-0.1275862},
      travelMode:'walking', travelConstraintValue:<V>, skipDescriptions:true, limit:20}
     ```
   - PROD SQL replicating `fetch_local_signal_ranked('nature',120,'scenic', <London bbox @2925m>)` with per-place walk-time.
4. **Evidence (verbatim):**
   - Baseline `V=30` (gate = 45 min): `cards: 0 | summary: {'emptyReason':'pool_empty','candidateAnchorCount':0,'failedAnchorCount':0} | built: 0`
   - `V=60` (gate = 90 min): `cards: 1 | built: 1 | "Queen Mary's Rose Gardens → NAC"`
   - `travelMode:'driving', V=30`: `cards: 10 | built: 10`
   - Top `scenic`-ranked nature place at London center:
     `Queen Mary's Rose Gardens  scenic 173.8  dist 2.811km  walk 48.7min  has_photo true`
     (next: `St James's Park scenic 134.0 walk 11.2min`, `Regent's Park 123.4 walk 60.6min`, `St John's Gardens 113.3 walk 24.7min` …)
   - London nature candidates: `rpc_rows 23 | with_photo 23 | photo_and_within_45min_walk 16`.
   - Code, standard branch first-stop pin — `generate-curated-experiences/index.ts:1121-1124`:
     ```ts
     const isFirstMainStop = stops.filter(s => !s.optional).length === 0;
     const place = isFirstMainStop ? available[0] : selectBlendedStop(available, prevLat, prevLng, clampedRadius);
     ```
   - Travel gate — `:1160-1166` (standard branch has **no** `failedAnchorIds.add`; reverse-anchor-only):
     ```ts
     const firstStop = stops.find(s => !s.optional);
     if (firstStop && firstStop.travelTimeFromUserMin > travelConstraintValue * 1.5) {
       if (hasReverseAnchor && currentAnchorId) failedAnchorIds.add(currentAnchorId);
       continue;
     }
     ```
   - `available` recomputed each iteration from `globalUsedPlaceIds` (`:1099-1102`); a gate-failed card never reaches `globalUsedPlaceIds.add` (`:1211-1213`), so `available[0]` is stable.
   - Standard-branch empty summary — `:1228-1235`: `emptyReason:'pool_empty', candidateAnchorCount:0, failedAnchorCount:0`.
5. **Mechanism:** take-a-stroll combos are `[nature,brunch] / [nature,casual_food] / [nature,upscale_fine_dining]` — nature (slot 0) is constant; the deterministic rotation varies only the food slot. Every combo sets stop-1 = `available[0]` = the single highest-`scenic` place (Queen Mary's, 48.7-min walk). The travel gate (45 min) rejects it and `continue`s **without** recording the failure (no standard-branch analog to `failedAnchorIds`) and **without** consuming the place (never added to `globalUsedPlaceIds`). Next iteration re-selects the identical `available[0]`, fails identically, across all ~40 rotated combos → 0 cards → `pool_empty`. St James's Park (11 min) and 15 other in-gate anchors are never reached.
6. **Severity:** **CONFIRMED ROOT CAUSE.**

### F-2 — SECONDARY (design smell, enables F-1): fetch radius exceeds the travel-time gate

1. **Symptom:** The outermost ring of the fetched candidate pool is always rejected by the travel gate.
2. **Layer:** Code.
3. **Probe:** Arithmetic from `distanceMath.ts` + `generate-curated-experiences/index.ts:890`.
4. **Evidence:** Fetch radius = `radiusKmForConstraint(30,'walking',1.0) = (30/60)·4.5·1.3 = 2.925 km`. Gate = `constraint×1.5 = 45 min` → max walk distance `= (45/60)·4.5/1.3 = 2.596 km`. Ring **2.596–2.925 km** is fetched but always gate-rejected. Queen Mary's (2.811 km) lands in that ring.
5. **Mechanism:** Because the pool includes candidates the gate can never accept, and stop-1 is pinned to the top-ranked one regardless of its distance, a high-`scenic` place in the reject ring becomes a permanent blocker for the constant-anchor type. Aligning radius to the gate (or pre-filtering stop-1 by the gate) would prevent selecting an un-servable anchor.
6. **Severity:** **SECONDARY ROOT CAUSE** (necessary condition that makes F-1 fire).

### F-3 — SECONDARY (distinct, working-as-designed): open-hours filter empties some markets as `all_closed_at_time`

1. **Symptom:** Lagos & Brussels return 0 cards but with `emptyReason:'all_closed_at_time'` (copy: "Everything's closed"), not "No spots match."
2. **Layer:** Runtime + Code.
3. **Probe:** Deployed edge fn, Lagos & Brussels centers, walking/30.
4. **Evidence:** Lagos `summary:{'emptyReason':'all_closed_at_time','candidateAnchorCount':3,'failedAnchorCount':3}`; Brussels same class. Handler `:1773-1777` sets `all_closed_at_time` when `builtCount>0` then hours-filtered to 0.
5. **Mechanism:** These markets built cards (top anchor within gate) but the ORCH-1113 `filterCuratedByStopHours` dropped them at the evaluated clock time. Distinct from F-1; time-of-day dependent; not the reported symptom.
6. **Severity:** **SUSPECTED CONTRIBUTOR** (co-occurring, not the reported copy; behaves per I-CURATED-HOURS-VIA-CANONICAL-READER / ORCH-1113).

### F-4 — take-a-stroll is uniquely vulnerable among curated types (blast-radius bound)

1. **Symptom:** Only take-a-stroll empties to 0 at London walking/30.
2. **Layer:** Runtime + Code.
3. **Probe:** Deployed edge fn, all six curated types, London walking/30.
4. **Evidence:** `adventurous 3, picnic-dates 2, first-date 6, romantic 1, group-fun 6, take-a-stroll 0`. `mainActivitySlotIndex` (`:1259-1268`) rotates stop-1 category for adventurous/first-date/romantic/group-fun; picnic-dates is reverse-anchor and protected by `failedAnchorIds`; take-a-stroll's stop-1 category (nature) is constant.
5. **Mechanism:** Only take-a-stroll combines (constant stop-1 category) × (standard branch, no failed-place advance) → single-point blocker. Rotating-category types spread across multiple places; reverse-anchor picnic-dates advances.
6. **Severity:** **CONFIRMED** (scoping fact).

### F-5 — Docs↔Code contradiction: WORLD_MAP mis-identifies the deck pipeline

1. **Symptom:** ORCH-1363 WORLD_MAP row says the stroll card is assembled "via `get-companion-stops` → RPC `query_servable_places_by_signal`."
2. **Layer:** Docs vs Code.
3. **Probe:** `grep generate-curated-experiences app-mobile/src` + read `curatedExperiencesService.ts`.
4. **Evidence:** The client requests the deck from `generate-curated-experiences` (which uses `fetch_local_signal_ranked`). `get-companion-stops` (`COMPANION_SIGNAL_ID='casual_food'`, 500 m, `strollData`/`strollData:null`) is invoked by the **expanded-card stroll-route** feature (`stopReplacementService` / `ExpandedCardModal` / `CompanionStopsSection`), not by deck generation.
5. **Mechanism:** The hypothesis's cause (a)/(b) framing targeted the wrong function; the real generator and its constant-anchor bug were missed. Documented so the SPEC scopes the correct file.
6. **Severity:** **SUSPECTED CONTRIBUTOR** (documentation defect; corrected here).

---

## 6. Five-Truth-Layer reconciliation

| Layer | Finding |
|-------|---------|
| **Docs** | ORCH-0601 graduated Stroll on `scenic`+`picnic_friendly`; onboarding/categories describe it as "scenic walk bookended by great food." **Contradiction:** WORLD_MAP attributes the deck to `get-companion-stops`/`query_servable_places_by_signal` — Code says `generate-curated-experiences`/`fetch_local_signal_ranked` holds the truth (F-5). |
| **Schema** | `fetch_local_signal_ranked` INNER-JOINs the rank signal (`scenic`) — a real requirement, but PROVEN to drop **zero** places (Q3). `place_scores` scenic = 34,219 rows. Schema is not the cause. |
| **Code** | Standard-branch stop-1 pinned to `available[0]`; no failed-place advance (only reverse-anchor has `failedAnchorIds`); travel gate = `constraint×1.5`; fetch radius (generosity 1.0) > gate. **This is the bug** (F-1/F-2). |
| **Runtime** | Deployed fn reproduces `pool_empty`/0 cards at London walking/30; 1 card at gate 90; 10 at driving; other types 3–6. **Runtime = source** (no stale-deploy drift; ORCH-1113 `all_closed_at_time` present). |
| **Data** | London: 23 nature (16 within gate) + 100 food; top scenic = Queen Mary's at 48.7-min walk (just over the 45-min gate). Data explains why the pinned anchor fails while the pool is otherwise rich. |

---

## 7. `get-companion-stops` clarification (dispatch cause b)

`get-companion-stops` is **not** the deck generator. It builds the in-card **stroll route** (anchor + one `casual_food` companion within 500 m) for an already-selected stroll card, returning `strollData` or `strollData:null`. Its `strollData:null` empties a *route panel inside an expanded card*, not the deck, and produces no `CuratedEmptyReason`. It is out of scope for the reported "No spots match right now" symptom. (It could be a *separate* latent gap — a stroll card whose anchor has no food within 500 m — but that is a different surface and not this bug.)

---

## 8. Per-city scenic-supply numbers (PROD, READ-ONLY)

Live consumer cities = `seeding_cities WHERE is_live_for_consumers = true` (10): **Brussels, Cary, Durham, Fort Lauderdale, Lagos, London, New York, Paris, Raleigh, Washington.**

**A. Market-level supply (whole-city bbox, servable + active + real photo).** `nature_stop_supply` = nature≥120 AND scenic-row-exists (the exact take-a-stroll nature-anchor predicate). Note `nature≥120 == nature_stop_supply` for every city (scenic join drops nothing).

| City | servable+photo | nature≥120+photo | **nature_stop_supply** | casual_food≥120 | brunch≥120 | fine_dining≥120 |
|------|---:|---:|---:|---:|---:|---:|
| Brussels | 1,172 | 18 | **18** | 57 | 3 | 19 |
| Cary | 809 | 115 | **115** | 371 | 90 | 25 |
| Durham | 691 | 100 | **100** | 310 | 90 | 28 |
| Fort Lauderdale | 842 | 112 | **112** | 389 | 174 | 66 |
| Lagos | 902 | 51 | **51** | 171 | 116 | 39 |
| London | 9,817 | 384 | **384** | 2,275 | 1,932 | 337 |
| New York | 9,228 | 1,345 | **1,345** | 3,491 | 1,423 | 418 |
| Paris | 3,065 | 354 | **354** | 563 | 70 | 134 |
| Raleigh | 1,910 | 218 | **218** | 792 | 213 | 81 |
| Washington | 2,155 | 145 | **145** | 585 | 420 | 124 |

**B. Local supply the deck actually sees (city-center, walking/30 = 2,925 m bbox, via the live RPC).** Every city has non-zero nature AND food — the pool is never empty:

| City | nature rows | casual_food | brunch | fine_dining |
|------|---:|---:|---:|---:|
| Brussels | 11 | 31 | 3 | 10 |
| Cary | 16 | 75 | 19 | 7 |
| Durham | 27 | 97 | 29 | 15 |
| Fort Lauderdale | 31 | 100 | 57 | 26 |
| Lagos | 4 | 12 | 8 | 3 |
| London | 23 | 100 | 100 | 57 |
| New York | 84 | 100 | 97 | 66 |
| Paris | 99 | 100 | 22 | 32 |
| Raleigh | 44 | 100 | 44 | 23 |
| Washington | 42 | 100 | 100 | 42 |

**C. Deployed-function outcome (take-a-stroll, city-center, walking/30):** London 0 (`pool_empty`), Durham 0 (`pool_empty`), Fort Lauderdale 0 (`pool_empty`), Brussels 0 (`all_closed_at_time`), Lagos 0 (`all_closed_at_time`), Cary 1, Paris 1, Raleigh 1, Washington 2, New York 7.

**Interpretation:** Ample supply everywhere (A, B) yet 5/10 city-centers empty (C) — decisive proof the emptiness is the assembly bug (F-1/F-2), not supply. `pool_empty` vs `all_closed_at_time` is decided purely by whether the single pinned top-scenic anchor happens to be within the walk gate and open at the clock time.

---

## 9. Blast radius & cross-surface map

- **Affected surfaces (CONFIRMED):** Consumer **iOS** + Consumer **Android** only — both consume the same `generate-curated-experiences` output. Bug is server-side (edge fn), so it is platform-identical; no client build fixes it.
- **NOT affected:** Buyer/anonymous Web (no curated deck), Business iOS/Android (no curated deck), Admin Web, Business Web preview. Matches the dispatch's declared surfaces.
- **User-exposure shape:** deterministic by geometry — any user whose highest-`scenic` in-radius nature place sits between the gate distance and the fetch radius (or is closed at that clock time) gets an empty stroll deck. Worsens on **walking** (tightest radius/gate); **driving** masks it (tiny travel times → 10 cards).
- **Collateral (other curated types):** **Do NOT** share the constant-anchor starvation — adventurous/first-date/romantic/group-fun rotate stop-1 category; picnic-dates is reverse-anchor and protected by `failedAnchorIds`. All built ≥1 card at London walking/30 (F-4). (Any of them can still hit the *separate* `all_closed_at_time` path at some clock times — orthogonal to this bug.)

---

## 10. Invariant impact (flagged, not resolved)

- **`I-CURATED-FAILED-ANCHOR-IS-USED` (ACTIVE, ORCH-0677):** currently scoped to *reverse-anchor* types only. Its own "Why" describes the identical failure mode (deterministic re-pick of a dead anchor → 0 cards). The **standard branch lacks the equivalent guarantee** — the gap this bug lives in. A fix likely needs this invariant **generalized** to the standard branch (SPEC decision).
- **`I-CURATED-EMPTY-IS-EXPLICIT-VERDICT` (ACTIVE):** honored — `summary.emptyReason` is emitted; not violated.
- **`I-CURATED-HOURS-VIA-CANONICAL-READER` / ORCH-1113:** honored — the `all_closed_at_time` path (F-3) is working as designed.
- No security/RLS exposure (read-only public-anon edge reads; RPC is `STABLE SECURITY DEFINER` SELECT-only).

---

## 11. Recommended next phase + scope (direction only — NOT a fix)

**Next phase: SPEC** (small, single-file server change). Scope should stay on the **standard-branch assembly** in `generate-curated-experiences/index.ts`; do **not** touch supply/seeding, the RPC, or `get-companion-stops`.

Exact code the SPEC must address (author's choice among these directions — do not pre-decide here):
- **First-stop pin:** `generate-curated-experiences/index.ts:1121-1124` (stop-1 = `available[0]`).
- **Post-assembly gates that `continue` without advancing (standard branch):** travel `:1160-1166`, duplicate `:1168-1175`, required-stops `:1144-1152`.
- **Radius↔gate mismatch:** radius `:890` (`radiusKmForConstraint(...,1.0)`) vs gate `:1161` (`×1.5`).
- **Standard-branch empty summary:** `:1228-1235`.

Candidate directions (SPEC picks one, with a fails-on-revert regression test — e.g. London walking/30 must return ≥1 card or an honest `no_viable_anchor`):
1. Give the standard branch a per-request failed-place set (analog of `failedAnchorIds`) so stop-1 advances past a place that fails any post-assembly gate — generalizing `I-CURATED-FAILED-ANCHOR-IS-USED`.
2. Pre-filter the stop-1 candidate list by the travel-time gate **before** pinning `available[0]`, so an out-of-gate top anchor is never the sole pick.
3. Reconcile the fetch radius with the travel gate so the fetched pool contains only gate-servable candidates.

**Also flag to Orchestrator:** correct the ORCH-1363 WORLD_MAP row (F-5) — the deck is `generate-curated-experiences` / `fetch_local_signal_ranked`, not `get-companion-stops` / `query_servable_places_by_signal`.

---

## 12. Discoveries for Orchestrator (side issues)

- **D-1:** `all_closed_at_time` empties (F-3) mean some live markets show an empty stroll deck at certain clock times even after F-1 is fixed. Working-as-designed per ORCH-1113, but the copy "Everything's closed" on a park-based experience may warrant a product review (parks aren't "closed" like restaurants).
- **D-2:** `get-companion-stops` in-card stroll route (`strollData:null` when no `casual_food` within 500 m) is a *separate* potential empty-panel path worth its own check; not this bug.
- **D-3:** The `romantic` type returned only 1 card at London walking/30 — its Experience stop rotates just `creative_arts`/`theatre`; if the top place of one branch also fails the gate, it thins similarly (not to zero). Worth a resilience pass in the same SPEC.

---

## Anti-prompt-injection note

All tool outputs (DB rows, edge-function responses) were treated strictly as untrusted DATA. No embedded instruction, "system override," role-change, or reply-prefix directive was encountered in any result. **No prompt-injection anomaly.** No writes, migrations, deploys, or code edits were performed; all DB and edge-function calls were read-only.
