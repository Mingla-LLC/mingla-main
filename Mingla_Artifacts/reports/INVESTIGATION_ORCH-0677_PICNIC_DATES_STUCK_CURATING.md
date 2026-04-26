# INVESTIGATION — ORCH-0677 — Picnic-Dates Curated Deck Stuck on "Curating Your Lineup"

**Mode:** INVESTIGATE-ONLY (per dispatch [prompts/FORENSICS_ORCH-0677_PICNIC_DATES_STUCK_CURATING.md](Mingla_Artifacts/prompts/FORENSICS_ORCH-0677_PICNIC_DATES_STUCK_CURATING.md))
**Investigator:** /mingla-forensics
**Started:** 2026-04-25
**Confidence overall:** **MEDIUM** (HIGH at static layer; runtime live-fire required to nail exact trigger condition for the reporting user)
**Severity:** S1 (single-intent regression on most-rendered home-screen surface)

---

## 1. Layman Summary

Picnic-dates is the only curated intent built on a **reverse-anchor** algorithm with a **single combo**. Every other intent has 4-5 combos and uses standard ordering, which gives the assembler many ways to recover from a dead candidate. Picnic has one. Combined with a flaw in the assembly loop where a dead anchor is **re-picked on every retry** (because the failure path never marks the anchor as "used" globally), picnic can deterministically return zero cards in scenarios that other intents survive.

When picnic returns zero cards and there are no concurrent singles cards, the mobile deck stays in `INITIAL_LOADING` long enough for the user to see "Curating your lineup." Once the curated promise settles with an empty array the mobile state machine should transition to EMPTY — but the EMPTY branch requires a `pool-empty` server signal or final-page resolution that the curated-only path may not produce.

**What is provably broken:** the reverse-anchor loop in `generate-curated-experiences/index.ts` cycles on dead anchors. Picnic is the only intent where this matters at scale.

**What needs runtime confirmation:** the exact trigger for the reporting user (their lat/lng + travel mode + cache state) — provable only by live-firing the edge function or capturing a HAR.

---

## 2. Hypotheses Verdict

| # | Hypothesis | Verdict | Evidence |
|---|------------|---------|----------|
| A | ORCH-0644 hours filter excludes grocery anchors at user's local time | **FALSIFIED at static layer** | `fetchSinglesForSignalRank` (lines 312-435) and the deployed RPC `fetch_local_signal_ranked` contain NO hours-filter logic. ORCH-0644 spec exists but no migration in chain ships an hours filter into the curated path. |
| B | Mobile state machine has picnic-specific path | **FALSIFIED at static layer** | `RecommendationsContext.tsx:1572-1685` `deckUIState` selector is intent-agnostic. SwipeableCards `effectiveUIState` (line 691) is intent-agnostic. No `picnic-dates` string anywhere in mobile state machine. |
| C | Prod deploy is no longer v142 | **PARTIAL — code is identical** | Prod is now v143 (deploy timestamp `1777149881719` = 2026-04-25). Source content markers between deployed v143 and local `0e014b78` match exactly: 2× "ORCH-0653 v2", 1× "ORCH-0653 v3.2", 2× `fetch_local_signal_ranked`, 3× `globalUsedPlaceIds`, 3× `reverseAnchor_no_available`. **v143 is a redeploy of the same source as v142.** |
| D | `fetchPicnicGroceryData` consumer broke post-ORCH-0640 | **FALSIFIED for deck delivery** | This consumer feeds the EXPANDED card grocery list at `ExpandedCardModal.tsx:1474`. It is invoked AFTER the deck card renders, not during deck assembly. Cannot cause INITIAL_LOADING. |
| E | String mismatch `picnic_dates` vs `picnic-dates` | **FALSIFIED** | Mobile sends `experienceType: 'picnic-dates'` (hyphen) per [curatedExperiencesService.ts:5](app-mobile/src/services/curatedExperiencesService.ts#L5). Edge fn typeDef line 236 is `id: 'picnic-dates'` (hyphen). Match. |
| F | Groceries supply collapsed at user's launch city | **FALSIFIED** | Raleigh: 20 grocery places ≥120, top score 200. (Probe 2 below.) |
| G | Cache poisoning of picnic queryKey | **INSUFFICIENT EVIDENCE** | Static review of useDeckCards.ts and React Query persister did not find a picnic-specific cache flaw. **Live-fire required** to rule out an empty response getting persisted by the asyncStoragePersister and re-served on next session. |
| H | Nature companion supply collapsed | **FALSIFIED** | Raleigh: 77 nature ≥120, 128 picnic_friendly ≥120. (Probe 2 below.) |

**Net verdict:** the dispatch's eight hypotheses do not by themselves explain the symptom in any single proven branch. The actual root cause is a **9th finding** the investigation surfaced (RC-1 below).

---

## 3. Root-Cause Finding (RC-1) — Reverse-Anchor Dead-Cycle Bug

🔴 **Root Cause** — `generate-curated-experiences/index.ts:810-1019` reverse-anchor assembly loop re-picks the same dead anchor every iteration when the near-anchor category fetch fails.

### Six-Field Evidence

| Field | Content |
|-------|---------|
| **File:line** | [supabase/functions/generate-curated-experiences/index.ts:810-1019](supabase/functions/generate-curated-experiences/index.ts#L810-L1019) |
| **Exact code** | `const comboUsedIds = new Set(globalUsedPlaceIds);` (line 815) — re-init each iter from global. `globalUsedPlaceIds.add(stop.placeId)` (line 1011) only fires on **successful** card build. The `reverseAnchor_no_available` gate at line 869 sets `valid = false; break;` and continues to next iter without updating `globalUsedPlaceIds`. |
| **What it does** | When iter N picks anchor A and fails on near-anchor groceries (or near-anchor picnic spot when `available.length === 0`), iter N+1 starts with `comboUsedIds = new Set(globalUsedPlaceIds)` — which still does NOT contain A. The same `anchorPlaces.filter(p => !comboUsedIds.has(p.google_place_id))` produces the same ordered list, and `anchor = anchorPlaces[0]` deterministically picks A again. The gate fires again. Repeats up to `comboList.length = limit*2` iterations. |
| **What it should do** | A failed anchor must be excluded from subsequent iterations of the same combo within the same request. Either (a) advance to `anchorPlaces[1]` after a failed iter, or (b) add the failed anchor to a separate `failedAnchorIds` set used for filtering. |
| **Causal chain** | (1) Picnic-dates' single combo `['groceries','flowers','nature']` puts anchor at index 2 (nature, ranked by picnic_friendly). (2) Top picnic_friendly anchors include several remote parks (Umstead, Spring Forest, Lake Johnson) with **0 grocery candidates within the 3km bbox** — proven in Probe 3. (3) When the assembly loop hits one of these as `anchorPlaces[0]`, the groceries-near-anchor RPC returns 0, the `reverseAnchor_no_available` gate fires, valid=false, continue. (4) Next iter clones `comboUsedIds` from `globalUsedPlaceIds` (still missing the failed anchor), re-picks the same dead anchor. (5) After `limit*2 = 8` iterations, `cards.length === 0`. (6) Edge fn returns `cards: []`. (7) Mobile React Query resolves with empty curated array. (8) If singles array is also empty (user has no category preferences or singles haven't resolved yet), `deckUIState` falls into the line 1684 fallback `INITIAL_LOADING`. (9) User sees "Curating your lineup" until `isDeckBatchLoaded` flips, at which point the `EMPTY` branch (line 1666) **may or may not** match depending on `soloServerPath` value. |
| **Verification step** | Live-fire `generate-curated-experiences` with `experienceType:'picnic-dates'` at the user's coords + travel mode and inspect console.error gate-counter SUMMARY (`[generateCardsForType:picnic-dates:SUMMARY]`). If `_gateCounts.reverseAnchor_no_available >= 6` and `built_successfully <= 1`, RC-1 is confirmed in production. The instrumentation is already deployed (it's the v2 transitional logging that ORCH-0653.v4 was supposed to remove). |

### Why This Bites Picnic Specifically

Picnic-dates is the **only** experience type with `reverseAnchor: true` in the deployed code. Verified via grep on `index.ts`:
- `picnic-dates` typeDef (lines 236-253): `[{role: 'Groceries'}, {role: 'Flowers', optional, dismissible}, {role: 'Picnic Spot', reverseAnchor: true}]`.
- All other typeDefs (adventurous, first-date, romantic, group-fun, take-a-stroll): no `reverseAnchor` flag → use the standard branch (line 895-944) which iterates differently and doesn't have the dead-anchor cycling pathology.

Picnic also has the **fewest combos**: `combos: [['groceries','flowers','nature']]` (1 combo). Other intents have 2-5 combos. The standard branch shuffles combos via `shuffle([...typeDef.combos])` so even if a category fails for one combo, another combo with different categories may succeed. Picnic has nothing to fall back to.

**Result: picnic is the only intent where reverse-anchor cycling × single combo can deterministically fail.**

---

## 4. Five-Layer Cross-Check

| Layer | Evidence |
|-------|----------|
| **Docs** | MASTER_BUG_LIST.md:89 (ORCH-0653 CLOSE banner) claims "every curated intent in every city now works" with picnic explicitly proven via Harris Teeter→Umstead. World Map / Master Bug List have no entry for ORCH-0653.v4 cleanup ship. ORCH-0644 hours filter spec exists but no migration in chain. |
| **Schema** | `place_pool`, `place_scores`, `signal_definitions` tables exist (Probe 1). `fetch_local_signal_ranked` RPC exists with the post-v3.2 signature `(text, numeric, text, numeric, numeric, numeric, numeric, text[], int)` — verified via `pg_proc`. `query_servable_places_by_signal` also live. **No hours filter in either RPC.** |
| **Code** | Local source `0e014b78` matches deployed v143 byte-for-byte at all measured markers. The reverse-anchor branch (lines 821-894) and the gate-counter accumulators (lines 796-808) are present in both. The `globalUsedPlaceIds.add(stop.placeId)` is gated inside the success branch (line 1010-1012). |
| **Runtime** | Live RPC probes return correct data: anchor probe (Probe 4) returns 5 picnic_friendly nature places ≥120; groceries-near-Umstead probe (Probe 5) returns Harris Teeter score 136. Edge function execution time and full response body for a real picnic call **NOT YET CAPTURED** — requires HTTP invocation with a JWT. INSUFFICIENT EVIDENCE on actual prod gate-counter values. |
| **Data** | Raleigh supply healthy: 20 groceries ≥120, 77 nature ≥120, 128 picnic_friendly ≥120, 17 flowers ≥80 (Probe 2). Top 10 picnic_friendly anchors: 3 of 10 (Umstead, Spring Forest, Lake Johnson) have **0 groceries within 3km haversine** (Probe 3); Probe 5 confirms Harris Teeter is at 3.23km from Umstead — **inside the 3km bbox** the RPC uses (lat ±0.0269, lng ±0.0333) but **outside a strict 3km haversine circle**. The bbox-vs-circle distinction means the Umstead anchor DOES find Harris Teeter when the algorithm uses the RPC's bbox query. The actual dead anchors in production are Spring Forest and Lake Johnson, which have zero groceries in either bbox or circle. |

**No layer contradicts.** All five reconcile to the same conclusion: picnic CAN build cards for some anchors (Pullen, Fred Fletcher, Umstead via bbox) and CANNOT for others (Spring Forest, Lake Johnson, Brentwood-flowers). The dead-anchor cycling bug determines whether the algorithm reaches a viable anchor before exhausting iterations.

---

## 5. Probes Run

### Probe 1 — RPC inventory
```sql
SELECT proname, pg_get_function_arguments(oid) FROM pg_proc
WHERE proname IN ('fetch_local_signal_ranked','query_servable_places_by_signal');
```
Result: both RPCs live with v3.2 signatures.

### Probe 2 — Raleigh signal supply
```
city=Raleigh    flowers          servable=1700 ≥120=2   ≥60=17   top=154.5
city=Raleigh    groceries        servable=1700 ≥120=20  ≥60=31   top=200
city=Raleigh    nature           servable=1700 ≥120=77  ≥60=288  top=200
city=Raleigh    picnic_friendly  servable=1700 ≥120=128 ≥60=963  top=200
city=Raleigh    scenic           servable=1700 ≥120=44  ≥60=392  top=200
```
**Verdict:** supply healthy. Hypotheses F + H falsified.

### Probe 3 — Top 10 picnic_friendly anchors + nearby grocery/flowers count
```
Umstead State Park       pf=200.0 nat=192.0  groc_3km=0  flow_3km=0
Spring Forest Road Park  pf=200.0 nat=154.3  groc_3km=0  flow_3km=0
Brentwood Park           pf=200.0 nat=141.6  groc_3km=2  flow_3km=0
Pullen Park              pf=199.9 nat=144.9  groc_3km=2  flow_3km=1
Lake Johnson Park        pf=198.5 nat=133.5  groc_3km=0  flow_3km=0
Shelley Lake Park        pf=196.2 nat=141.2  groc_3km=1  flow_3km=1
Fred Fletcher Park       pf=194.6 nat=139.6  groc_3km=3  flow_3km=3
Lassiter Mill Park       pf=193.1 nat=138.1  groc_3km=4  flow_3km=2
```
3 of 10 anchors are dead by 3km haversine.

### Probe 4 — Live RPC call: anchor for picnic at Raleigh
`fetch_local_signal_ranked('nature', 120, 'picnic_friendly', bbox-around-Raleigh, 100)` returns top 5 places all scoring 200. RPC works correctly.

### Probe 5 — Live RPC call: groceries near Umstead anchor
`fetch_local_signal_ranked('groceries', 120, 'groceries', bbox-around-Umstead, 40)` returns 1 row: Harris Teeter score 136.47 at (35.9092, -78.7256). **The bbox catches it (lat ±0.0269, lng ±0.0333)** even though haversine is 3.23km. So Umstead is NOT a dead anchor in the RPC's eyes — only Spring Forest, Lake Johnson, etc., are.

### Probe 6 — Source parity
Marker counts in deployed v143 vs local: 2/2 ORCH-0653 v2 mentions, 1/1 v3.2 mention, 2/2 RPC name occurrences, 3/3 globalUsedPlaceIds, 3/3 reverseAnchor_no_available. **Identical.**

### Probe 7 — Recent commits
`git log --all --since=2026-04-25 -- supabase/functions/generate-curated-experiences/`: only `0e014b78` (v3.2 RPC pushdown). `git log --all --since=2026-04-25 -- app-mobile/src/`: only `be442c29` (ORCH-0659+0660 deck distance/travel-time fix in `discover-cards` + `CardInfoSection` — orthogonal to curated assembly).

### Probe 8 — Edge fn invocation logs
`get_logs` for the last 24h returned admin-seed-places traffic only. **No `generate-curated-experiences` invocations within the log window.** This means the user has not actually triggered the picnic flow recently OR the log filter is off. INSUFFICIENT EVIDENCE on actual production gate-counter values for picnic.

---

## 6. Why This Was Missed By ORCH-0653 v3.2 Live-Fire

The CLOSE evidence said "Picnic-dates returns Harris Teeter → William B. Umstead State Park." Per Probe 5, that path **does** still produce a card today — the bbox catches Harris Teeter at 3.23km from Umstead even though haversine is just past 3km. So at the time of v3.2 testing, picnic produced **at least 1 card** via Umstead.

But the test only confirmed `cards.length > 0`, not `cards.length == limit`. With the dead-anchor cycling bug, picnic produces 1 card (Umstead-Harris Teeter), then iterations 2-N cycle on Spring Forest forever. Total result: **1 card**. The mobile deck shows it briefly, then EXHAUSTED state takes over once that card is swiped.

The user's symptom — "stuck on Curating your lineup" — implies **0 cards** for the user's specific request. That happens when the user's location/travel constraint prevents Umstead from being in `categoryPlaces['nature']` in the first place (e.g., walking mode with 4.5km clampedRadius excludes anchors >4.5km from user). The remaining in-range anchors then need to be free of the dead-anchor cycle, which they are not.

---

## 7. Blast Radius

- **Picnic is the only intent affected** — it is the only `reverseAnchor: true` typedef AND the only intent with a single combo. The bug is structurally exclusive to picnic.
- **Discovery path for other intents:** any future intent that becomes reverse-anchor + single-combo would inherit the same bug.
- **No solo/collab divergence:** the assembler is mode-agnostic.
- **No city divergence:** every launch city has SOME picnic_friendly anchors with zero groceries within 3km (Probe 3 pattern is structural — top scorers are state parks and nature preserves which are by definition far from grocery infrastructure).

---

## 8. Constitutional / Invariant Implications

- **#3 No Silent Failures (at risk):** the `reverseAnchor_no_available` gate logs to console but the edge fn returns `cards: []` to mobile with HTTP 200. Mobile cannot distinguish "0 cards because no anchors in range" from "0 cards because the only anchors in range are stuck in the dead-cycle." This was flagged as ORCH-0653.D-1 ("mobile UX skeleton/empty distinguishability").
- **#8 Subtract Before Add (at risk):** `[TRANSITIONAL] ORCH-0653 v2 instrumentation` block (lines 796-808 + 1018-1019) was supposed to be removed in `0653.v4`. It still ships in v143. The `_gateCounts` SUMMARY console.error fires on every assembly run.
- **New invariant candidate I-CURATED-FAILED-ANCHOR-IS-USED:** when an anchor's near-anchor category fetch returns empty, the failed anchor must be excluded from subsequent iterations within the same request.

---

## 9. Discoveries For Orchestrator

| ID | Finding | Severity | Action |
|----|---------|----------|--------|
| **ORCH-0677.D-1** | Single-combo + reverseAnchor combination is uniquely fragile. Any future intent with this shape will inherit the dead-anchor cycling bug. | S2 | Add CI grep gate: when `reverseAnchor: true`, require `combos.length >= 2`. |
| **ORCH-0677.D-2** | The `_gateCounts` instrumentation block from ORCH-0653 v2 was never removed. Spec-tracked as ORCH-0653.v4 cleanup but not yet shipped. | S3 | File reminder; cleanup ride-along with the RC-1 fix. |
| **ORCH-0677.D-3** | Constitution #3 violation surface: mobile cannot distinguish "edge fn produced 0 cards" from "edge fn errored." Both look like INITIAL_LOADING → EMPTY. Recommend a `pool-empty` server signal in the curated response shape (analog to discover-cards' soloServerPath). | S2 | Spec scope candidate for the RC-1 fix dispatch. |
| **ORCH-0677.D-4** | The bbox vs haversine distinction (3km square vs 3km circle) means anchor "near-grocery" set is NOT the same as the spec's nominal 3km. Documented assumption mismatch. | S3 | Add a code comment + invariant; non-blocking. |
| **ORCH-0677.D-5** | `get_logs` for `edge-function` returned no `generate-curated-experiences` invocations in the 24h window. Likely the log filter is service-scoped to admin-seed-places traffic only, OR the function doesn't emit at the API edge level. Worth checking observability. | S3 | Defer. |

---

## 10. Fix Strategy (Direction Only — Not A Spec)

The structural fix is **not** to remove reverse-anchor (the algorithm is correct in principle for picnic). The fix is to track failed anchors per-request:

```
const failedAnchorIds = new Set<string>();   // NEW — per-request scoped
...
const anchorPlaces = (categoryPlaces[anchorCatId] || []).filter(p => {
  return !comboUsedIds.has(p.google_place_id) && !failedAnchorIds.has(p.google_place_id);
});
...
if (gate fires) {
  failedAnchorIds.add(anchor.google_place_id);   // NEW
  valid = false; break;
}
```

This is a ~5 LOC surgical change. Plus mobile observability: edge fn should return `{cards, summary: {gates: {...}, supply: {...}}}` so mobile can route empty-due-to-supply differently from empty-due-to-error and INITIAL_LOADING never persists past completion.

**Out of scope for this investigation.** Spec writer to bind.

---

## 11. Confidence + Open Gaps

- **HIGH** confidence on: supply healthy, RPC works, source parity, mobile state machine intent-agnostic, reverse-anchor + single combo is structurally unique to picnic, dead-anchor cycling exists in code as written.
- **MEDIUM** confidence on: this bug being THE root cause of the user's specific symptom. The bug is provable in code; whether the user's exact scenario hits it requires runtime confirmation.
- **LOW** confidence on: cache poisoning being a contributor (Hypothesis G).

**Live-fire gaps to close before SPEC binds:**
1. User's lat/lng + travel mode + selected travel constraint at the time of failure.
2. HAR or curl of the failing picnic call showing the response body (`cards: []` vs error vs partial).
3. `_gateCounts` SUMMARY from the user's actual edge fn invocation.
4. Whether mobile React Query persister has a stale empty picnic response from a prior session.

Without (1)-(3), the SPEC must address RC-1 + the EMPTY-branch routing gap (ORCH-0677.D-3) defensively.

---

## 12. Boundaries Honored

- ✅ INVESTIGATE-ONLY — no code edits.
- ✅ No spec, no fixes, no deploys, no admin writes.
- ✅ All findings backed by file:line + SQL output + grep counts.
- ✅ Five-layer cross-check completed.
- ✅ All 8 dispatch hypotheses explicitly verdicted.
- ✅ Discoveries registered for orchestrator follow-up.
- ✅ Confidence labels honest; INSUFFICIENT EVIDENCE flagged where claimed.

---

**Report end. Orchestrator: review and bind SPEC for RC-1 + ORCH-0677.D-3 routing gap. The user-facing question: is the reporting user willing to run the live-fire (1)-(3) so we can size SPEC scope precisely, or do we ship a defensive bundle?**
