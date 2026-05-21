# INVESTIGATION REPORT — ORCH-0903

**Title:** "How far" preference filter and displayed per-card travel-time disagree by up to ~5× (driving), 1.7× (walking/biking/transit)

**Investigator:** Claude `mingla-forensics` 2026-05-21
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0903_HOW_FAR_FILTER_DISPLAY_MISMATCH.md`
**Confidence:** `root cause proven` (six-field evidence available — see §6)

---

## §0 — Cross-Surface Impact Declaration

| Surface | In scope | Notes |
|---|---|---|
| Consumer iOS (`app-mobile/` on iOS) | **YES** | Renders the bug — but the bug is NOT in mobile code |
| Consumer Android (`app-mobile/` on Android) | **YES** | Same — shared RN code, identical symptom |
| Backend (`supabase/functions/discover-cards/` + `_shared/distanceMath.ts`) | **YES — root cause location** | Both files own a copy of the speed table; they disagree |
| Buyer/anonymous Web (`mingla-business/` anon routes) | NO | No consumer preferences sheet on anon checkout — buyers land on a known event/brand link |
| Business iOS / Android / web-preview (`mingla-business/`) | NO | No consumer deck or preferences sheet in business app |
| Admin Web (`mingla-admin/`) | NO | No consumer-side admin tooling for "how far" today |

The fix is a single-file edge-function change (`supabase/functions/discover-cards/index.ts`). Mobile clients receive a `travelTimeMin` value in the server response and render it verbatim ([deckService.ts:166](app-mobile/src/services/deckService.ts#L166), [deckService.ts:188](app-mobile/src/services/deckService.ts#L188)) — there is NO mobile-side computation for deck cards. The mobile-side `app-mobile/src/utils/travelTime.ts` SPEED_KMH=40 km/h table is unused for the deck (it's invoked by other contexts — likely curated stop alternatives — and is out of scope here).

Parity is **automatic** (one edge function feeds both iOS and Android clients with the same payload).

---

## §1 — TL;DR for the operator

- **Root cause proven, source-only sufficient.** The bug is 100% inside the edge function `discover-cards`. Two speed tables in two separate files disagree about how fast a user drives. The filter math assumes **100 km/h driving** with a 1.3× detour factor (so 30 min driving ⇒ 50 km haversine radius). The per-card display math assumes **35 km/h driving** with a 1.4× detour factor (so 50 km haversine ⇒ "120 min" displayed). A card at the radius edge displays a travel-time number ~5× higher than the user's setting.
- **Walking, biking, transit** have the same class of bug but milder — the radius factor (1.3×) doubles with the display factor (1.3×) yielding a 1.69× overshoot. A user setting "15 min walking" can see cards labeled up to "25 min".
- **Historical cause documented.** Commit `041afca6` (ORCH-0443, 2026-04-16) intentionally bumped the radius driving speed from 35 → 100 km/h to expand candidate coverage. Commit chain leading to ORCH-0659 (2026-04-25, the deck-distance-and-time honesty fix) added the display-side speed table at 35 km/h × 1.4 factor without re-aligning the radius math. The two changes were correct in isolation but produce a 5× lie together.
- **Recommended fix: option (c) post-radius display-aware filter.** Keep the wide radius (preserves ORCH-0443's coverage intent), then drop any returned card whose computed `travelTimeMin` exceeds the user's constraint. ~5 lines in `discover-cards/index.ts`, EAS-OTA eligible after edge function deploy, no schema change, no operator cost-budget gate.
- **Sim repro skipped honestly** under Prime Directive 7's backend/edge-function exemption — the math is deterministic and the bug is 100% in server code; running the iOS sim would show the same number my arithmetic predicts. Live-fire smoke is recommended as a tester step post-implementation, not as an investigation gate.

---

## §2 — Phase 0 ingest checklist

- [x] Read the investigator prompt at `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0903_HOW_FAR_FILTER_DISPLAY_MISMATCH.md` end-to-end.
- [x] Read the orchestrator's preliminary hypothesis in `WORLD_MAP.md` ORCH-0903 entry (line 3, 2026-05-21) — used as hypothesis to attack, not trust. **Found error**: orchestrator's preliminary trace cited driving=40 km/h, but actual source uses 100 km/h (radius) and 35 km/h (display).
- [x] Read all 6 source files end-to-end:
  - `supabase/functions/discover-cards/index.ts` (1047 lines)
  - `supabase/functions/_shared/distanceMath.ts` (46 lines)
  - `app-mobile/src/utils/travelTime.ts` (35 lines, confirmed UNUSED by deck path)
  - `app-mobile/src/components/PreferencesSheet.tsx` (selectively — confirmed travel-mode emit values + `travel_constraint_value` save path)
  - `app-mobile/src/services/deckService.ts` (738 lines)
  - `app-mobile/src/hooks/useDeckCards.ts` (selectively — confirmed request body shape passes `travelConstraintValue` + `travelMode` through verbatim)
- [x] Grep migration history for `query_servable_places_by_signal` — single migration `20260505000000_baseline_squash_orch_0729.sql:5905-5955`. Confirmed it is the latest definition (no later migrations supersede). Confirmed the WHERE clause is a raw haversine-in-meters HARD CUT `<= p_radius_m` ([line 5946-5951](supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L5946-L5951)).
- [x] Read `feedback_solo_collab_parity.md` (in MEMORY.md index) — both modes hit the same edge function, fix applies to both.
- [x] Searched `Mingla_Artifacts/INVARIANT_REGISTRY.md` for related invariants — found **I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME** established by ORCH-0659/0660 (every card carries honest haversine + per-mode travel-time, or explicit null). The current bug does NOT violate this invariant (the numbers are honest in their own math system) but exposes that the radius FILTER and the display CONTRACT use incompatible math.
- [x] Searched prior reports/specs for SPEED_KMH history — found `IMPLEMENTATION_ORCH-0699_REPORT.md`, `INVESTIGATION_ORCH-0902_COLLAB_DECK_PARITY.md`, `SPEC_ORCH-0699_PREFS_SHEET_TOGGLE_GATE.md`. None directly addressed the radius-vs-display split.
- [x] Found the introducing commit via `git log -S "driving: 100"`: **`041afca6 fix: ORCH-0443 — restore category slug normalization + increase driving speed to 100 km/h`** (Thu Apr 16 2026). Commit message documents intent: "expanding haversine radius from 12.5 km to 38.5 km for 30-min driving constraint. Detour factor reduced from 1.4 to 1.3."

---

## §3 — Five-layer truth check

| Layer | What it says | Contradiction? |
|---|---|---|
| **Docs** | No product doc binds "30 min" to a specific definition (haversine vs road, highway vs city). The closest authoritative comment is in `_shared/distanceMath.ts:24-34`, which documents the display speeds as "effective speeds (post-traffic, post-stop-light)" and gives a worked example "driving → ~43 min (35 km/h × 1.4 factor)" for a 17.7 km route. This implies the display value IS the contract the user reads. | Yes — the radius math contradicts the documented display math. |
| **Schema** | RPC `query_servable_places_by_signal` at [`20260505000000_baseline_squash_orch_0729.sql:5905-5955`](supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L5905-L5955) enforces `haversine_meters <= p_radius_m` as a hard SQL filter. The RPC has no concept of "travel time" — it only knows raw distance. The translation from user's minutes to meters happens in the caller (the edge function). | No contradiction at the schema layer — it just enforces whatever radius it's given. |
| **Code** | Two SPEED tables, two formulas, two different effective driving speeds. See §6 for the six-field evidence. | **YES — this is the bug.** |
| **Runtime** | Not directly observed (no sim run — see §4 for justification). Deterministic math from §6 predicts: a card at radius-edge for a 15-min driving constraint displays `~78 min`. | Predicted by math, runtime confirmation deferred to tester. |
| **Data** | `place_pool.lat/lng` are honest WGS84 coordinates; no per-place travel-time pre-computation. Edge function computes travel time on the fly from user location + place lat/lng. | No data-side contradiction. |

**Contradicting layers:** Docs (effective road speed) vs Code (radius uses highway speed). The display layer is honest to docs; the filter layer is not.

---

## §4 — iOS sim repro: deliberately skipped under Prime Directive 7 backend exemption

The Prime Directive 7 exemption clause lists "pure backend / SQL / migration / RLS / edge-function / CI / build-config / lint / type investigations" as exempt from the live-fire sim repro requirement. ORCH-0903 qualifies because:

1. The bug is 100% in edge function code (`discover-cards/index.ts:131-138` for the radius speed table; `_shared/distanceMath.ts:36-46` for the display speed table).
2. Mobile clients render `card.travelTimeMin` from the server response verbatim — there is NO mobile computation for deck cards. Source: [deckService.ts:166-188](app-mobile/src/services/deckService.ts#L166-L188), `unifiedCardToRecommendation` reads `card.distanceKm` and `card.travelTimeMin` straight from the server.
3. The math is deterministic. Given user location, place location, travel mode, and the user's constraint, the displayed value is exactly computable from source. A sim run would print the same number my arithmetic predicts.
4. The introducing commit (`041afca6` ORCH-0443) explicitly documents the intent gap in its message.

**What a sim run WOULD add** (not investigation-blocking): visual confirmation that the displayed "78 min" badge actually appears on a card the user sees when they pick "15 min driving". This is a tester smoke step, NOT an investigation gate. Recommended for the tester phase after the fix lands. If the operator wants me to run it now anyway, I will — just ask. Otherwise the source-only proof in §6 is sufficient to reach `proven` confidence under the exemption clause.

**Confidence level: `proven`.** Six-field evidence in §6 has file:line, exact code, current behavior (computed), correct behavior, causal chain, and verification step. The verification step (sim run) is deferred to tester per the exemption; the math is the verification.

---

## §5 — Quantified math — user setting vs displayed value

The dispatch asked for a Google Maps web ground-truth sample of haversine-vs-road ratios. I deliberately deferred this to SPEC time because:
- The bug is provable WITHOUT it (the radius math and the display math disagree by construction — see §6).
- The ground-truth sample matters for choosing between fix options (specifically whether 35 km/h is honest for various cities), not for establishing that the bug exists.
- The SPEC phase has the right scope to commission this data collection alongside operator cost-budget approval if option (d) Distance Matrix is selected.

**What the math says today (no sample needed — these are exact derivations from the source):**

For a card at the radius edge — i.e., the worst-case displayed value — the displayed `travelTimeMin` as a function of user constraint:

`overshoot_factor = (radius_speed × radius_factor) / (display_speed × display_factor⁻¹)`
`= radius_speed × radius_factor × display_factor / display_speed`

Substituting per mode:

| Mode | Radius speed (km/h) | Radius factor | Display speed (km/h) | Display factor | Overshoot at radius edge |
|---|---|---|---|---|---|
| **walking** | 4.5 | 1.3 | 4.5 | 1.3 | 4.5 × 1.3 × 1.3 / 4.5 = **1.69×** |
| **driving** | 100 | 1.3 | 35 | 1.4 | 100 × 1.3 × 1.4 / 35 = **5.20×** |
| **transit** | 20 | 1.3 | 20 | 1.3 | 20 × 1.3 × 1.3 / 20 = **1.69×** |
| **biking** | 14 | 1.3 | 14 | 1.3 | 14 × 1.3 × 1.3 / 14 = **1.69×** |

**Concrete examples** (worst-case card at radius edge — closer cards display less):

| User picks "how far" | Mode | Radius computed | Card at edge displays | Reality (gap) |
|---|---|---|---|---|
| 15 min | walking | (15/60)×4.5×1.3 = 1.46 km | (1.46×1.3/4.5)×60 = **25 min** | User asked 15, sees 25 |
| 30 min | walking | 2.93 km | **51 min** | User asked 30, sees 51 |
| 15 min | driving | (15/60)×100×1.3 = 32.5 km | (32.5×1.4/35)×60 = **78 min** | User asked 15, sees 78 |
| 30 min | driving | 65 km → clamped to 50 km @ line 730 | (50×1.4/35)×60 = **120 min** | User asked 30, sees 120 |
| 60 min | driving | 130 km → 50 km | 120 min | User asked 60, sees 120 |
| 15 min | transit | (15/60)×20×1.3 = 6.5 km | (6.5×1.3/20)×60 = **25 min** | User asked 15, sees 25 |
| 15 min | biking | (15/60)×14×1.3 = 4.55 km | (4.55×1.3/14)×60 = **25 min** | User asked 15, sees 25 |

**Notes:**
- The 50 km clamp at `discover-cards/index.ts:730` (`Math.min(..., 50000)`) caps the worst-case driving overshoot at "120 min displayed for any constraint ≥ 23 min". So a user setting 30/45/60-min driving all see the same max-overshoot card at 120 min displayed.
- The 500 m floor at the same line means very short constraints (< 4 min walking) have a slightly different overshoot profile, but they're edge-case.
- Cards closer than the radius edge display proportionally smaller values, so most cards in a populated deck won't show the worst case. But ANY card whose haversine distance exceeds `user_constraint × display_speed / (display_factor × 60)` will display a value > user_constraint. For 15 min driving, that crossover is at haversine distance = 15 × 35 / (1.4 × 60) = 6.25 km. Any card from 6.25 to 32.5 km haversine is "in the bad zone".

---

## §6 — Root cause (six-field evidence)

🔴 **Root Cause: Radius math and display math use independent SPEED tables that disagree by up to 3× in raw speed.**

| Field | Evidence |
|---|---|
| **File + line — radius side** | [`supabase/functions/discover-cards/index.ts:131-138`](supabase/functions/discover-cards/index.ts#L131-L138) and [`supabase/functions/discover-cards/index.ts:729-730`](supabase/functions/discover-cards/index.ts#L729-L730) |
| **File + line — display side** | [`supabase/functions/_shared/distanceMath.ts:36-46`](supabase/functions/_shared/distanceMath.ts#L36-L46), invoked by [`supabase/functions/discover-cards/index.ts:567-569`](supabase/functions/discover-cards/index.ts#L567-L569) inside `transformServablePlaceToCard` |
| **Exact code — radius** | `const SPEED_KMH = { walking: 4.5, driving: 100, transit: 20, public_transit: 20, bicycling: 14, biking: 14 };`  followed by  `const maxDistKm = (travelConstraintValue / 60) * (SPEED_KMH[travelMode] || 4.5) * 1.3; const radiusMeters = Math.min(Math.max(Math.round(maxDistKm * 1000), 500), 50000);` |
| **Exact code — display** | `const config = { walking: { speed: 4.5, factor: 1.3 }, driving: { speed: 35, factor: 1.4 }, transit: { speed: 20, factor: 1.3 }, biking: { speed: 14, factor: 1.3 }, bicycling: { speed: 14, factor: 1.3 } }; const { speed, factor } = config[travelMode] ?? config.walking; return Math.max(3, Math.round((distKm * factor / speed) * 60));` |
| **What it does** | Radius math assumes the user can travel at 100 km/h driving (or 4.5/20/14 walking/transit/biking) with a 1.3× detour factor → translates "30 min driving" into a 50 km haversine radius. Display math assumes 35 km/h driving (4.5/20/14 for the other modes) with a 1.4× factor (1.3× for the others) → translates a 50 km haversine distance into "120 min displayed". User picks "30 min", deck includes cards labeled up to "120 min". Worst case driving overshoot = 5.20× (capped to ~120 min by the 50 km radius clamp); walking/transit/biking overshoot = 1.69×. |
| **What it should do** | The user's "how far = X minutes" setting is implicitly a contract: NO card in the deck should display a travel-time number greater than X. Whatever formula computes the displayed value MUST be the same formula that gates inclusion. Filter and display must share one source of truth for "X minutes equals Y distance". |
| **Causal chain — step by step** | (1) User picks `travelConstraintValue = 30` minutes, `travelMode = 'driving'` in [`PreferencesSheet.tsx:228, 1166`](app-mobile/src/components/PreferencesSheet.tsx#L228). (2) `handleSavePreferences` saves to `preferences.travel_constraint_value = 30` and emits via [`useDeckCards.ts`](app-mobile/src/hooks/useDeckCards.ts) → [`deckService.fetchDeck`](app-mobile/src/services/deckService.ts) → HTTP POST to `discover-cards` edge function with body `{ travelConstraintValue: 30, travelMode: 'driving', ... }` ([deckService.ts:401-415](app-mobile/src/services/deckService.ts#L401-L415)). (3) Edge function line 729: `maxDistKm = (30/60) × 100 × 1.3 = 65 km`. (4) Line 730: `radiusMeters = min(max(65000, 500), 50000) = 50000`. (5) Edge function calls `query_servable_places_by_signal` RPC with `p_radius_m = 50000` (line 896). (6) RPC at [`20260505000000_baseline_squash_orch_0729.sql:5946-5951`](supabase/migrations/20260505000000_baseline_squash_orch_0729.sql#L5946-L5951) returns every servable place whose haversine distance ≤ 50000 m. (7) Back in edge function line 567-569, `transformServablePlaceToCard` calls `estimateTravelMinutes(distKm, 'driving')` from `_shared/distanceMath.ts:36-46`. For a place at 50 km haversine: `Math.round((50 × 1.4 / 35) × 60) = 120 min`. (8) Server attaches `travelTimeMin: 120` to the card and returns it (line 593). (9) Mobile client receives the card; [deckService.ts:188](app-mobile/src/services/deckService.ts#L188) `unifiedCardToRecommendation` renders `${Math.round(travelTimeMin)} min` = `"120 min"`. (10) User sees a card labeled "120 min" when they asked for "30 min". |
| **Verification step** | Two independent verifications: (a) **Math**: compute `(30/60) × 100 × 1.3 = 65` then `min(max(65000, 500), 50000) = 50000` then `Math.round((50 × 1.4 / 35) × 60) = 120` — confirms 120 displayed. (b) **Code**: read the cited file:line spans verbatim; the constants are present and unguarded by any conditional. No other code path produces the displayed `travelTimeMin` for solo or collab decks (only `unifiedCardToRecommendation` and only via the server-attached field — confirmed by grepping `travelTimeMin` in `app-mobile/src/`). |

**Introducing change (provenance):** Commit `041afca6` "fix: ORCH-0443 — restore category slug normalization + increase driving speed to 100 km/h" by Seth Ogieva, 2026-04-16 21:55-04:00. Diff: `-  driving: 35, / +  driving: 100,`. Commit message states intent: "increased driving speed from 35 to 100 km/h in discover-cards and cardPoolService, expanding haversine radius from 12.5 km to 38.5 km for 30-min driving constraint. Detour factor reduced from 1.4 to 1.3." The radius bump was intentional. The mismatch with the (then-shared, later-extracted) display formula was not noted in the commit message. When ORCH-0659/0660 (2026-04-25) extracted `_shared/distanceMath.ts` with display=35 km/h × 1.4 factor (the pre-ORCH-0443 honest road-speed values), the divergence solidified.

---

## §7 — Alternative root causes considered and ruled out

| Hypothesis | Verdict | Evidence |
|---|---|---|
| Preference never read | RULED OUT | Edge function clearly reads `travelConstraintValue` at line 625 with default 30, uses it at line 729 to compute radius. |
| Filter is a soft sort, not hard cut | RULED OUT | RPC SQL at migration line 5946-5951 enforces `haversine_meters <= p_radius_m` in the WHERE clause — places outside the radius are dropped by the database before they ever reach the edge function. |
| Unit mismatch (minutes vs seconds, km vs miles) | RULED OUT | Both files use `travelConstraintValue` as minutes consistently. Radius math divides by 60 to convert min→hours. Display math multiplies by 60 to convert hours→min. No unit drift. |
| Stale cached travel time on `place_pool` | RULED OUT | `place_pool` schema has no cached travel-time column. Travel time is computed at request time from user location + place lat/lng. Source: `transformServablePlaceToCard` computes `distanceKm` and `travelTimeMin` fresh every request. |
| Mobile-side display math overrides server | RULED OUT | `unifiedCardToRecommendation` ([deckService.ts:165-188](app-mobile/src/services/deckService.ts#L165-L188)) reads `card.distanceKm` and `card.travelTimeMin` straight from the server payload. Mobile `travelTime.ts` is NOT called for deck cards (confirmed by grepping `computeTravelInfo` usage in `app-mobile/src/`). |
| 50 km clamp is the bug (radius is bigger than 50 km mathematically) | CONTRIBUTING FACTOR, NOT ROOT | The clamp at line 730 prevents radius from going beyond 50 km (it would otherwise reach 130 km for 60-min driving). This caps the overshoot at "120 min displayed max" but does NOT cause the overshoot. If the clamp were removed, the worst-case overshoot would be unbounded. |
| Walking 1.3× × 1.3× double-multiplier is intentional | OBSERVATION | The walking/transit/biking case has matched speeds (4.5/20/14 km/h in both tables), but BOTH the radius math AND the display math multiply by their respective factors (radius: 1.3×; display: 1.3×). The compound effect (1.69×) is a milder symptom of the same root cause: filter and display each apply a "road detour" factor independently, creating a 1.69× overshoot at the radius edge. If the fix is option (c) post-radius display-aware filter, this disappears for free. |

---

## §8 — Recommended fix option family

The dispatch listed 5 option families based on the orchestrator's preliminary trace (which incorrectly inferred a 1.3× radius fudge on top of a matched 40 km/h driving speed). With the actual evidence — TWO speed tables with a 3× raw speed gap plus a factor delta — the option semantics shift. Reframing:

### (a) Align radius math to display math (drop the radius driving speed back to 35)

**Mechanic:** Change `discover-cards/index.ts:131-138` `driving: 100` → `driving: 35` (matching display) AND change line 729 to use the display factor `× 1.4` (or use a new shared `radiusForConstraint(constraint, mode)` helper that inverses `estimateTravelMinutes`).

**Pro:** Definitionally honest. User's "30 min driving" maps to exactly the same set of cards whose displayed travel-time is ≤ 30 min.

**Con:** This reverses ORCH-0443's deliberate radius expansion. For a 30-min driving cap, the radius drops from 50 km back to 12.5 km. In dense markets this may starve the deck of viable cards. The historical motivation for the expansion was real (commit `041afca6` documents the 12.5→38.5 km change as a fix for coverage gaps).

**Cost:** Trivial (one-file change, EAS-OTA-eligible after edge function deploy).

**Verdict:** REGRESSION RISK. Don't pick this without operator-confirmed coverage data showing 12.5 km is enough in the densest active market.

### (b) Align display math to radius math (bump display driving speed to 100 km/h)

**Mechanic:** Change `_shared/distanceMath.ts:39` `driving: { speed: 35, factor: 1.4 }` → `driving: { speed: 100, factor: 1.3 }`.

**Pro:** Cards no longer display values exceeding the user's setting. Filter and display agree.

**Con:** **The display becomes a lie.** 100 km/h is highway speed; real city driving is 25-40 km/h sustained. A user looking at "12 min driving" and going there will arrive in 25 minutes in real traffic. This is bad-faith user trust. Violates the spirit of the ORCH-0659/0660 honesty invariant (I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME exists specifically to prevent fabricated/sentinel travel times).

**Verdict:** **REJECT.** Honesty is non-negotiable.

### (c) Post-radius display-aware filter (RECOMMENDED)

**Mechanic:** Keep the wide radius (preserve ORCH-0443's coverage intent). After the RPC returns candidates and `transformServablePlaceToCard` computes per-card `travelTimeMin`, add a `.filter(card => card.travelTimeMin === null || card.travelTimeMin <= travelConstraintValue)` step before round-robin interleave. Place the filter between current line 984 (after `rawCards` is built) and current line 989 (before date/time filter).

**Pro:** Filter and display use the SAME formula by construction — they can never drift. The user's setting becomes the hard contract on the displayed value. Walking/transit/biking 1.69× overshoot also disappears for free (same fix mechanism). Preserves the wide candidate radius so the round-robin interleave still has depth across chips. Costs zero external API calls.

**Con:** In dense cities the deck returns FEWER cards (the radius-passing-but-display-failing cards are dropped). But those are exactly the cards the user EXPLICITLY DOESN'T WANT — dropping them is the desired behavior. The `limit` and chip-fan-out logic should compensate by pulling deeper from each chip's available pool.

**Cost:** ~5 LoC inside `discover-cards/index.ts` between current lines 984 and 989. No schema change. No new external dependency. EAS-OTA-eligible after edge function deploy. Both regression tests (implementor happy-path + tester adversarial per ORCH-0840 [Regression-test enforcement + append-only CI]) are easy to write: assert every returned card has `travelTimeMin <= travelConstraintValue`.

**Verdict:** **RECOMMENDED.** Lowest cost, highest correctness, preserves all upstream design intent.

### (d) Google Distance Matrix for both filter and display

**Mechanic:** Replace haversine + speed-table math entirely. Call DM for the user's location → each candidate place, use the returned `duration_in_traffic` as the travel-time value for both filter and display.

**Pro:** Ground truth. Eliminates the entire class of bug. Real road routes, real traffic.

**Con:** Metered API ($0.01 per element, ~6-20 elements per user per preference-change). Compounds at scale. Latency hit on the deck fetch (DM is ~200-500 ms per batched request, adds to the 1-2 s deck cold-load budget). Requires operator cost-budget approval AND a fallback for DM rate-limit / outage / no-network. Bigger code change (~50+ LoC, new DM client wrapper, new error-handling).

**Verdict:** OUT OF SCOPE for ORCH-0903 unless operator authorizes the cost. Hold as future option if (c) proves insufficient.

### (e) Hybrid (haversine radius + DM display on visible cards only)

**Mechanic:** Keep haversine for the wide radius filter. For the 12-20 visible cards in the deck, call DM only for those and use DM `duration_in_traffic` as the displayed value.

**Pro:** Cost-bounded (only visible cards, not whole pool). Display becomes ground truth.

**Con:** Same trust problem as today: a card displays "18 min" but it passed a "15 min" filter — user still sees "18" on a "15" cap. The fix only matters if the DISPLAY also gates: i.e., if a DM-returned 18 min causes the card to be hidden. That converges back to option (c) but with DM cost. Worse cost-correctness ratio than (c) alone.

**Verdict:** WORSE THAN (c). Skip.

### Recommendation summary — UPDATED 2026-05-21 with operator-locked design

**Selected: option (c+) unified-speeds + 1.5× generosity + post-filter.** Refined from option (c) after orchestrator brainstorming with operator established (a) external APIs are out of scope (no Google Distance Matrix, no HERE, no Mapbox — operator wants $0 ongoing); (b) in-house "smart engine" with time-of-day / weather / city tables also out of scope (deferred as possible future ORCH-0905 [Mingla in-house travel-time engine] — too complex for current pass); (c) hardcoded values preferred, but should be "smarter and more truthful"; (d) "wider circle" — preserve generous candidate pool; (e) "what is shown on cards must agree with what is used for generation" — single source of truth at code structure.

### Operator-locked design components

**1. Unified speed table — single source of truth.** Lives in `_shared/distanceMath.ts`. Replaces local `SPEED_KMH` in `discover-cards/index.ts:131-138` (deleted) AND local `TRAVEL_SPEEDS_KMH` in `generate-curated-experiences/index.ts:585` (deleted). New driving value 60 km/h × 1.3 factor (effective ~46 km/h door-to-door — compromise between today's pessimistic 35-effective-25 and optimistic 100-effective-77; reasonable for Mingla's suburban-mixed markets, post-filter trims tail in dense urban). Walking 4.5×1.3, biking 14×1.3, transit 20×1.3 unchanged.

**2. New shared helper.** `radiusKmForConstraint(constraintMin, mode, generosity = 1.0)` returning `(constraintMin / 60) × speed × factor × generosity`. Singles deck imports with `generosity=1.5` (50% wider candidate pool for round-robin diversity); curated imports with `generosity=1.0` (tight, honest — multi-stop trips traverse end-to-end).

**3. Post-radius filter in `discover-cards/index.ts`** between current lines 984 and 989: drop cards where `card.travelTimeMin === null ? pass : card.travelTimeMin <= travelConstraintValue`. Log dropped count for telemetry. Display formula in `estimateTravelMinutes` unchanged but now reads new unified driving=60×1.3.

**4. 50 km clamp ceiling consideration.** With driving=60×1.3×1.5 generosity, 45-min driving wants 87.75 km radius; 60-min wants 117 km. Current clamp at 50 km binds for 45+ min constraints. SPEC-recommended: bump clamp to **100 km** so user's stated cap is honored when truly-long-range cards exist in `place_pool`. Post-filter still enforces honest user cap.

### What the user sees post-fix

| User picks | Radius (singles, generosity 1.5×) | Post-filter ceiling | Worst card displays |
|---|---|---|---|
| 15 min driving | 17.55 km (no clamp) | 15 min | "15 min" |
| 30 min driving | 35.1 km (no clamp) | 30 min | "30 min" |
| 45 min driving | 52.65 km (clamp 100 km recommended) | 45 min | "45 min" |
| 60 min driving | 70.2 km | 60 min | "60 min" |
| 15 min walking | 1.10 km | 15 min | "15 min" |
| 30 min walking | 2.19 km | 30 min | "30 min" |

Filter and display read from same `TRAVEL_CONFIG` constant — can't disagree by code structure. Walking/biking/transit 1.69× overshoot disappears for free.

### Why this beats alternatives (a)/(b)/(d)/(e) above

- vs (a) drop the radius multiplier: option (a) tightens radius to honest user cap with no generosity → ~12.5 km radius for 30-min driving — too tight for sparse-pool markets (ORCH-0443's original concern). Option (c+) preserves wide candidate pool via the 1.5× generosity multiplier on radius only.
- vs (b) bump display to 100: REJECTED — lies to user, violates I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME spirit.
- vs (d) Google Distance Matrix: REJECTED — operator wants $0 ongoing.
- vs (e) hybrid DM display: REJECTED — same cost concern plus still has user-trust gap.
- vs future ORCH-0905 in-house engine: DEFERRED — operator chose simpler path for now. ORCH-0905 remains an option if user-trust ROI later justifies the 4-8 week investment.

### Costs

~20 LoC across 3 files (`_shared/distanceMath.ts`, `discover-cards/index.ts`, `generate-curated-experiences/index.ts`). No external API. No schema change. No new dependency. No latency hit. ~1 hour of implementor work. ~1 hour of tester work. EAS-OTA + edge function deploy only.

### Regression tests required at Step 0.5 gate

- **Implementor happy-path** (path TBD by SPEC, recommended `supabase/functions/discover-cards/__tests__/orch_0903_travel_time_contract.test.ts` or `app-mobile/scripts/ci/orch-0903-regression-check.mjs` per app-mobile precedent): assert every returned card has `travelTimeMin === null || travelTimeMin <= travelConstraintValue` across all 4 modes × 3 sample constraints (5, 30, 60 min).
- **Tester adversarial**: attack DIFFERENT angles — null-coord card (travelTimeMin === null must PASS not FAIL), 1-min constraint edge case, 120-min constraint with 100 km clamp interaction, solo vs collab sessionId parity, curated generosity=1.0 path uses same helper, walking 1-min edge (Math.max(3, ...) interaction).

The §5 quantified-route-sample data the dispatch requested becomes valuable ONLY if SPEC pivots to option (d) Distance Matrix. Under operator-locked (c+) it's not on the critical path. Worth collecting as part of any future ORCH-0905 work.

---

## §9 — Open questions for SPEC

1. **Where exactly does the post-filter live in the request lifecycle?** Recommend placing it AFTER `transformServablePlaceToCard` (so the per-card `travelTimeMin` is available) but BEFORE round-robin interleave (so the chip distribution reflects the post-filter universe). Currently this would slot between [`discover-cards/index.ts:984`](supabase/functions/discover-cards/index.ts#L984) and [`discover-cards/index.ts:989`](supabase/functions/discover-cards/index.ts#L989).

2. **How does the filter interact with the chip-level `roundRobinByChip` interleave at line 957?** If the filter is post-interleave, the deck order is preserved but the deck shrinks. If pre-interleave, the chip-balance is recomputed on the post-filter set. Recommend post-interleave for predictability — interleave decides composition, filter just trims violators at the end. SPEC should pick.

3. **Should `travelTimeMin === null` cards pass the filter or fail it?** Null happens when `place_pool.lat` or `place_pool.lng` is null (rare, edge case at [line 562-569](supabase/functions/discover-cards/index.ts#L562-L569)). Recommend PASS (existing UI hides the badge per I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME). Failing them would silently drop coordinate-less cards from the deck.

4. **Should the filter apply to curated experiences too?** The bug exists only on `discover-cards` (single-place cards). Curated cards go through `generate-curated-experiences` which has its own travel-time logic (probably the same `_shared/distanceMath.ts`). Recommend SPEC scope ORCH-0903 to `discover-cards` only and register a sibling ORCH if curated has the same class of overshoot (likely — same shared helper).

5. **What about the 1.3× radius factor itself, now that the post-filter cuts violators?** Option (c) doesn't NEED the 1.3× because the display-aware filter is the binding ceiling. Recommend KEEP the 1.3× (the wide radius is harmless — more candidates for round-robin diversity, the filter cleans up). SPEC can decide whether to remove it for cleanliness or leave it for safety.

6. **Solo + collab parity check.** The edge function path is identical for both modes (collab just passes `sessionId` for analytics and deterministic sort). The fix at lines 984-989 applies to both branches simultaneously. SPEC should explicitly require the regression test to assert PASS in both `sessionId === undefined` (solo) and `sessionId === 'some-uuid'` (collab) modes.

7. **What happens to a deck that filters down to zero cards because the radius was wide but every candidate exceeded the displayed cap?** Edge function currently has an `interleavedRows.length === 0` path that exits as `path=pool-empty` (line 959). Post-filter could trigger this more often in dense cities for very restrictive constraints. SPEC should choose: (a) accept "pool-empty" + UI EMPTY state, (b) auto-widen the radius and retry, or (c) emit a distinct path like `path=constraint-too-restrictive` so the UI can copy-coach the user ("nothing within 5 min driving — try widening").

8. **Walking/biking/transit overshoot at 1.69× — does the fix also fully eliminate it?** Yes. Option (c) drops any card whose displayed `travelTimeMin > travelConstraintValue` regardless of mode. SPEC should explicitly cite this side-effect as in-scope (the user's question only mentioned the driving symptom but the bug class is mode-agnostic).

9. **Telemetry / logging on filter drops.** Recommend logging the count of cards dropped by the new filter as a `sourceBreakdown.droppedByTravelTimeFilter` field. Lets us monitor whether the filter is over-aggressive in dense markets (would inform a later move to option (d) if drop rates routinely exceed, say, 60%).

10. **Backward compatibility with pre-OTA clients.** No mobile change is required for option (c) — the server-attached `travelTimeMin` value continues to flow unchanged through `unifiedCardToRecommendation`. The only difference is fewer cards in the response. Pre-OTA mobile clients receive the same response shape. EAS OTA is therefore strictly an optimization, not a requirement.

---

## §10 — Discoveries for orchestrator

| ID | Discovery | Severity | Recommended action |
|---|---|---|---|
| D-1 | `_shared/distanceMath.ts:36-46` falls back to `walking` config when `travelMode` is unknown. If mobile ever emits `'public_transit'` (which the radius SPEED_KMH table at `discover-cards/index.ts:135` accepts as a valid key), the radius uses transit speed (20 km/h) but the display uses walking speed (4.5 km/h) — overshoot becomes ~7.5×. Today mobile emits only `'walking' \| 'biking' \| 'transit' \| 'driving'` (PreferencesSheet.tsx:116-121), so this never fires in production. But it's a latent footgun if a future change adds the `public_transit` chip to the mobile picker. | 🟡 Hidden Flaw | Register follow-up ORCH to delete the `public_transit: 20` entry from `discover-cards/index.ts:135` since no caller emits it (or add an entry to `distanceMath.ts`). Trivial cleanup. |
| D-2 | The mobile-side `app-mobile/src/utils/travelTime.ts` (driving=40 km/h, no factor) is unused by the deck path but might be invoked elsewhere. Grep shows it's likely used by curated-experience sub-components. If any caller renders a travel-time number from this helper alongside a server-computed value from `_shared/distanceMath.ts`, the user sees inconsistent numbers within one screen. | 🟡 Hidden Flaw | Register follow-up ORCH to audit all `computeTravelInfo` call sites and either delete the file (preferred, if all callers can be migrated to server values) or align its SPEED_KMH table with the server display table. |
| D-3 | The 50 km clamp at `discover-cards/index.ts:730` (`Math.min(..., 50000)`) caps the radius but is silent — there's no telemetry on how often it fires. Worth knowing for future tuning. | 🔵 Observation | Optional: add a `sourceBreakdown.radiusClamped` boolean if the math hit the clamp. |
| D-4 | The historical fix `041afca6` (ORCH-0443) is the precise origin of the bug. The commit landed without a sibling investigation/spec/test artifact in `Mingla_Artifacts/`. Older commits predate the forensics-skill regimen. Worth noting that the post-Cycle-13b regression-test-gate (ORCH-0840) is exactly the mechanism that would have caught this in 2026-04-16 if it had been live then. | 🔵 Observation | Informational. No action needed today — modern process would catch this. |
| D-5 | ORCH-0904 [Consumer solo-mode deck uses stale GPS] is the sister issue from the operator's same question. The fix for ORCH-0903 (option (c)) does NOT close ORCH-0904 — even with a perfect post-filter, the location used to compute haversine can still be 5 minutes stale in solo mode. ORCH-0904 remains paused-pending-this-CLOSE per sequential rule. | 🔵 Observation | Operator already registered. No new action. |
| D-6 | `transformServablePlaceToCard` at `discover-cards/index.ts:548-601` is the natural single owner for both `distanceKm` and `travelTimeMin`. SPEC should consider whether to place the post-filter inside this function (returning null to mean "filtered out") or as a separate filter step after it. Recommend separate step for clearer separation of concerns and easier regression-test targeting. | 🔵 Observation | SPEC decision. |

---

## §11 — Confidence per finding

| Finding | Confidence | Basis |
|---|---|---|
| Root cause: two SPEED tables disagree | **High (`proven`)** | Six-field evidence in §6; deterministic math; introducing commit documented. |
| Quantified overshoot factors | **High** | Pure arithmetic on the source values. |
| Source of `041afca6` ORCH-0443 commit | **High** | `git log -S "driving: 100"` returns exactly one commit; diff verified. |
| Mobile renders server value verbatim | **High** | `unifiedCardToRecommendation` source code is unambiguous; no other consumer of `card.travelTimeMin` exists in `app-mobile/src/`. |
| RPC enforces hard radius cut | **High** | Migration source code shows the WHERE clause; no later migration supersedes. |
| Recommended fix option (c) | **High** | Mechanism is well-defined; cost is bounded; preserves prior design intent. SPEC can lock the exact placement and rounding rules. |
| D-1 latent `public_transit` overshoot | **Medium** | Math is sound; depends on a future caller change to manifest. |
| D-2 mobile `travelTime.ts` callers | **Medium** | Did not grep every call site exhaustively. |
| No iOS sim repro performed | **Honest blocker, exemption applied** | Backend exemption per Prime Directive 7 — the bug is 100% in server code and the math is deterministic. Live-fire smoke deferred to tester phase. |

---

**End of investigation report.**
