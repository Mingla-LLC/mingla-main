# INVESTIGATION — ORCH-1058 [Collab deck empty-intersection replay]

**Mode:** INVESTIGATE (no fixes — SPEC is a later phase)
**Date:** 2026-06-02
**Skill:** mingla-forensics (Claude)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1058-[collab-deck-empty-intersection-replay]/` on branch `ORCH-1058-collab-deck-empty-intersection-replay`
**Session under replay:** `43f8e4c1-9cda-44f5-8c88-eb6295188dd4` ("TESTING CARDS", board `de5d51ba-f3ac-4169-8d3c-a4d537123e91`, `group_hangout`, created 2026-06-02 06:27:25Z)

---

## TL;DR (layman)

Two people opened a shared "TESTING CARDS" deck. For about two minutes one of them (the session creator) saw cards while the other (`b17e3e15`) repeatedly hit a **"No location overlap yet"** empty screen — and then it healed and both saw cards. The deck was never broken. The cause is **`b17e3e15`'s phone GPS kept flickering between Washington DC and Raleigh** (two readings ~374 km apart). Because that participant was in "use my GPS" mode, the app **faithfully wrote each GPS reading into the shared session** the instant it changed. When the GPS said DC, the two people's reachable travel circles (DC vs Raleigh) had **zero geographic overlap**, so the server correctly reported "no shared places" and minted an empty deck version. When the GPS snapped back to Raleigh, the circles overlapped again and cards appeared. The earlier "category-overlap" theory was wrong, and even "both at the same coordinates" is only true of the *final* saved state — the *per-version snapshots* prove `b17e3e15`'s circle center moved DC↔Raleigh four times.

The "one saw it, one didn't" is a real, explainable consequence of the **positional shared-deck freeze contract**: a participant requesting an *already-generated* card position always gets that frozen card (immune to the empty window), while a participant requesting the *next, not-yet-generated* position during an empty window gets the dead-end empty state. So the divergence is **transient churn of an otherwise-correct design driven by bad input GPS**, not a deck bug — with one genuine **product-grade UX flaw** (a flapping GPS device single-handedly thrashes the shared deck for everyone, and the 2-person empty copy under-explains the cause).

---

## Confidence

- **Root cause (geographic intersection went empty because `b17e3e15`'s GPS-resolved circle center oscillated DC↔Raleigh, written live to the session): `root cause PROVEN`.** Backed by the per-version `aggregated_params` snapshots in `session_deck_versions` (the circle centers are literally recorded), the live PostGIS distance computation (373.7 km), a replay of the exact intersection query for V2 and V6, and the client write path that fires `upsert_participant_prefs` on every `userLocation` change in GPS mode.
- **"One saw the deck, one didn't" mechanism (positional freeze vs frontier dead-end): `root cause PROVEN` from code + the `session_deck_cards` / version timeline.** I did **not** observe the two phones live (a 2-participant collab race is not solo-reproducible on one sim, and the dispatch explicitly authorizes DB+code reasoning where live repro is infeasible) — so the literal *frame-by-frame* "creator saw card X while b17e3e15 saw empty at wall-clock T" is reconstructed from timestamps, not eyeballed. The mechanism is dispositive; the exact per-frame pairing is `probable` only where it depends on sub-second client request interleaving I cannot replay.

---

## Phase 0 — Context ingested

- Read `COMMS_LEDGER.md`. No `BLOCK`/`WARN`/`FYI` entry is addressed to `mingla-forensics` or `ORCH-1058`. The OPEN WARN entries (COMMS-0003/0004/0012/0013/0015/0016) concern external-API doc-citation, INTAKE numbering, migration-apply gaps, and pricing — none touch collab deck geography. Nothing to ack. No new cross-ORCH discovery to write (this is a localized collab-deck replay).
- Migration-chain rule applied for every DB object in scope (see Five-Layer Cross-Check). The authoritative current definition of `pg_aggregate_collab_prefs`, `estimate_circle_radius_m`, `recompute_deck_version_after_prefs_change`, and `query_servable_places_by_signal_intersection` is `supabase/migrations/20260701000000_orch_0909_positional_shared_deck.sql` (verified latest by grep-all → sort → read-latest, AND verified live against the running DB).
- Determinism contract reference `feedback_collab_deck_determinism_contract` factored: deck = pure function of session state; location = union/intersection of per-participant reachable circles; each client finishes V_n before transitioning; pref changes mint V_{n+1} server-side. This investigation finds the implementation honors the freeze contract.

---

## Investigation Manifest (every file/query, in trace order)

| # | Artifact | Why |
|---|----------|-----|
| 1 | `COMMS_LEDGER.md` | Mandatory entry scan |
| 2 | `references/investigation-depth-protocol.md` | Method |
| 3 | `supabase/migrations/20260701000000_orch_0909_positional_shared_deck.sql` | `intersection_empty` definition, circle build, recompute trigger, accept RPC |
| 4 | `supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql` | `estimate_circle_radius_m` radius formula |
| 5 | grep across `supabase/migrations/` | Confirm #3 is the LATEST def of all four functions |
| 6 | LIVE DB: `collaboration_sessions` row + `participant_prefs` | Current prefs (re-verify seed) |
| 7 | LIVE DB: `session_participants` | Accept/positions |
| 8 | LIVE DB: `session_deck_versions` (full `aggregated_params`) | **Per-version circle centers — the smoking gun** |
| 9 | LIVE DB: `session_deck_cards` | Frozen positional cards + versions |
| 10 | LIVE DB: `pg_get_functiondef` for agg + radius fns | Confirm runtime = migration |
| 11 | LIVE DB: PostGIS `ST_Distance` + intersection replay for V2/V6 | Numerically prove empty-vs-not |
| 12 | LIVE DB: function list writing `participant_prefs` | Find mid-session write path |
| 13 | `app-mobile/src/contexts/RecommendationsContext.tsx` (1444-1466, 558-624, 1290-1317) | GPS→`upsert_participant_prefs` effect; positional cursor; dead-end consume |
| 14 | `app-mobile/src/hooks/useUserLocation.ts` (full) | Where `userLocation` comes from |
| 15 | `app-mobile/src/services/enhancedLocationService.ts` (55-157) | GPS / last-known resolution; confirm NO hardcoded DC default |
| 16 | `supabase/functions/discover-cards/index.ts` (771-1418) | `deadEnd`, existing-card-vs-generate, `generated_at_version` stamping, ON CONFLICT |
| 17 | `app-mobile/src/services/collabDeadEndBannerService.ts` (full) | Chat banner copy + outlier detect |
| 18 | `app-mobile/src/components/SwipeableCards.tsx` (1719-1804, render block) | What the client renders for `intersection_empty` |
| 19 | LIVE DB: `messages`/`conversations`, `boards.name` | Confirm board="TESTING CARDS", whether banners were posted |

---

## The proven replay — per-version circle centers (this is the whole case)

`session_deck_versions.aggregated_params` stores the EXACT circles used to mint each version. Reconstructed (lat/lng rounded to 4dp by the aggregation per `ROUND(...,4)` at migration line 195-196; radius = `estimate_circle_radius_m`):

| Version | minted_at (Z) | acceptedCount | `b17e3e15` circle | `c727d491` circle | intersection_empty | cards |
|---|---|---|---|---|---|---|
| V1 | 06:27:25.98 | **1** | — | — | false | 0 |
| V2 | 06:27:58.82 | 2 | **(38.8951, -77.0364) DC**, 18000 m (driving/30) | (35.7804, -78.6391) Raleigh, 9000 m (driving/15) | **TRUE** | 0 |
| V3 | 06:28:36.81 | 2 | **(35.7905, -78.7386) Raleigh-W**, 18000 m | (35.7804, -78.6391) Raleigh, 9000 m | false | 4 |
| V4 | 06:28:42.39 | 2 | **(38.8951, -77.0364) DC**, 18000 m | Raleigh, 9000 m | **TRUE** (params_hash == V2) | 0 |
| V5 | 06:29:14.54 | 2 | **(38.8951, -77.0364) DC**, 9000 m (driving/15) | Raleigh, 9000 m | **TRUE** | 0 |
| V6 | 06:30:14.46 | 2 | **(35.7804, -78.6391) Raleigh**, 9000 m | Raleigh, 9000 m | false | 9 |

`c727d491` (the creator) is anchored in Raleigh for every version — final prefs show `use_gps_location:false`, `custom_location:"Raleigh, Wake County, North Carolina, United States"`. **`b17e3e15`'s circle CENTER moved DC → Raleigh-W → DC → DC → Raleigh across the six versions** — final prefs show `use_gps_location:true`, so its center is device GPS.

**PostGIS proof of the geography (live query against the running DB):**
- `ST_Distance(DC(38.8951,-77.0364), Raleigh(35.7804,-78.6391))::geography` = **373702 m (373.7 km)**. A DC 18 km circle and a Raleigh 9 km circle (27 km combined reach) cannot intersect across 374 km — so V2/V4/V5 `intersection_empty=true` is **mathematically correct**, not a bug.
- Exact V2 intersection replay (servable place inside BOTH DC-18 km AND Raleigh-9 km): `has_place_in_both = false`. ✓
- V6 replay (place inside Raleigh-9 km): **876 servable places** → non-empty correct.
- Servable places within 18 km of DC: **2298**, within 9 km of Raleigh: **876**. **Both cities are independently well-populated**, so `place_pool.is_servable` is NOT the limiter at any version. The limiter is purely that the two circles were in different cities while the GPS was on DC.

This disproves the two non-causes:
- ❌ **Category overlap** (the prior wrong analysis): categories/intents are UNIONed, never intersected (migration lines 146-168), and were identical across V2-V6. They cannot drive `intersection_empty`, which is a pure geographic test (migration lines 221-251). Disproven.
- ❌ **"Both at the same coords, so why empty?"** (the seed's framing): true only of the FINAL `participant_prefs` snapshot. The per-version `aggregated_params` prove the center was DC at mint time for V2/V4/V5. Disproven.

---

## Q1 — Why did the geographic intersection go empty when (final) coords are identical? — PROVEN

**Root cause:** `b17e3e15` was in GPS mode (`use_gps_location:true`). The client effect at `RecommendationsContext.tsx:1444-1466` re-writes that participant's `custom_lat/custom_lng` into the shared session **on every change of `userLocation`**, via `supabase.rpc('upsert_participant_prefs', …)`. The `userLocation` value (`useUserLocation.ts` → `enhancedLocationService.getCurrentLocation()` / `getLastKnownLocation()`) was oscillating between a DC fix (38.8951, -77.0364) and a Raleigh fix (35.78, -78.64) — two genuine device GPS readings 374 km apart (classic iOS-Simulator/last-known-vs-fresh-fix flap; no hardcoded default is involved — `useUserLocation.ts:100-103` and `enhancedLocationService.ts` both return `null` rather than a default when GPS is unavailable, confirmed by reading both in full).

Each `upsert_participant_prefs` write updates `collaboration_sessions.participant_prefs`, which fires `recompute_deck_version_after_prefs_change` (migration 529-583). That trigger calls `pg_aggregate_collab_prefs`, re-hashes, and if the hash changed mints a new `session_deck_versions` row. When the new center was DC, the DC↔Raleigh circles did not intersect → `intersection_empty=true` → empty version (V2/V4/V5). When it snapped back to Raleigh → overlap → non-empty (V3/V6).

Secondary contributing detail: at V2/V3 `b17e3e15`'s `travel_constraint_value` was effectively 30 (radius 18 km) and later 15 (radius 9 km, matching final prefs `15`). The radius change is immaterial to the empty verdict — even an 18 km DC circle is 356 km short of overlapping Raleigh. The dominant variable is the **center**, not the radius. (Six-field evidence below.)

Six-field evidence — ROOT CAUSE:
- **File + line:** `app-mobile/src/contexts/RecommendationsContext.tsx:1444-1466` (GPS write effect); intersection definition `supabase/migrations/20260701000000_orch_0909_positional_shared_deck.sql:221-251`; radius `…20260625000000_orch_0902…sql:129-145`.
- **Exact code:** effect fires `supabase.rpc('upsert_participant_prefs', { p_session_id, p_user_id, p_prefs: { custom_lat: userLocation.lat, custom_lng: userLocation.lng } })` guarded only by `participantUseGps === true`; the SQL computes `intersection_empty` via `NOT EXISTS(... NOT ST_DWithin ...)` across every GPS circle.
- **What it does:** every GPS reading change for a GPS-mode participant rewrites the shared circle center and re-mints a deck version reflecting whatever city the GPS reported at that instant.
- **What it should do (direction only, not a fix):** a flapping single-device GPS should not be able to thrash the shared multi-party deck between cities; the write needs debounce/hysteresis/jump-rejection — deferred to SPEC.
- **Causal chain:** device GPS flaps DC↔Raleigh → effect writes DC center → trigger mints empty version → `discover-cards` serves dead-end for the next ungenerated position → `b17e3e15` sees "No location overlap yet" → GPS snaps to Raleigh → new non-empty version → cards return.
- **Verification step:** the `aggregated_params` per version record the literal centers (DC vs Raleigh); the live PostGIS `ST_Distance` = 373.7 km and the V2 replay `has_place_in_both=false` confirm the empty verdict is geographically correct for those centers.

---

## Q2 — What did EACH client actually render? — PROVEN (render states) / mechanism PROVEN

The serve path (`discover-cards/index.ts`) for a positional collab request is, in order:
1. `targetPosition = serverCurrentPosition + 1` (line 863; server position is authoritative, line 857-862 "server wins").
2. **If a `session_deck_cards` row EXISTS at `targetPosition` → serve that frozen card immediately (lines 1018-1039), BEFORE any `intersection_empty` check.** This is the V_n freeze contract.
3. Only if NO card exists at `targetPosition` is the LIVE `agg.intersection_empty` evaluated → `deadEnd({ reason:'intersection_empty' })` (lines 1050-1058), returning `success:false, dead_end:true, card:null, cards:[]`.

Client render of a dead-end (`SwipeableCards.tsx`): `getCollabDeadEndCopy()` (1719-1804) maps `intersection_empty` → `{ title:'No location overlap yet', subtitle:<each participant's location> }` (for a 2-person session, since `detectIntersectionOutlier` returns `'multi'` when `participants.length < 3`, line 193 of `collabDeadEndBannerService.ts`). The render block (~2003-2067) shows that title/subtitle plus a **"Notify group"** button and an **"Adjust preferences"** button. **It is an explicit empty-state card, NOT a blank screen and NOT a stale deck.**

So during the empty windows:
- The participant whose `current_position+1` pointed at an **already-generated position** (1-4 after V3; 1-13 after V6) got the **frozen card** — immune to the empty version. This is the "one COULD see the deck."
- The participant at the **frontier** requesting the **next, not-yet-generated position** during V2/V4/V5 got **"No location overlap yet."** This is the "one COULD NOT."

Concretely from the timeline: positions 1-4 were generated at V3 (06:28:38-43). Between V4 (empty, 06:28:42) and V6 (06:30:14) — a ~92-second window — **no position 5+ card could be generated** (every mint attempt during that window hit `intersection_empty=true` because the GPS was on DC). Any participant who had already swiped to position 4 and asked for position 5 in that window saw the empty state, while a participant still on positions 1-3 (asking for an existing card) saw cards. After V6 minted (Raleigh), positions 5-13 generated and both proceeded.

Note: `card_id IS NULL` rows (positions 2, 6, 8, 10) are **`card_type:'curated'` cards whose content is in `curated_payload`** (each has a real `pill_label` like "adventurous"/"group-fun"), **not** sentinels or dead-ends. All 13 positions are real servable/curated cards.

Mechanism is PROVEN from code+data; the exact wall-clock pairing of "creator card vs b17e3e15 empty" is reconstructed (not eyeballed) — capped at `probable` for the sub-second interleave, `proven` for the mechanism.

---

## Q3 — current_position 12 / 13 vs "max 9 cards" — RESOLVED (no contradiction)

`current_position` is the per-participant **cursor into the positional shared deck** (`session_participants.current_position`, migration lines 70-79; advanced server-side in `successResponse`, `discover-cards` lines 949-954 `UPDATE … current_position = position WHERE current_position < position`). It counts **distinct shared positions the participant has been served**, cumulative across ALL versions — NOT cards-swiped-this-version and NOT a scroll index.

There are **13 physical positions** in `session_deck_cards`: 4 generated at V3 (positions 1-4) + 9 generated at V6 (positions 5-13). The "9 cards" in the seed = V6's generated count only; it ignored the 4 V3 cards that remain frozen and live. 4 + 9 = 13 total positions.

So `c727d491` at 12 and `b17e3e15` at 13 simply means both swiped nearly the whole 13-position deck (b17e3e15 one ahead). **This directly contradicts any reading of "one permanently couldn't see the deck"** — both participants ultimately consumed essentially the entire shared deck. The visibility gap was **transient** (the ~92 s DC window), exactly as the timeline shows. No contradiction; the high cursors are evidence the session healed and both users got cards.

---

## Q4 — Is V1 minting at acceptedCount=1 a contract violation? — observation, NOT the cause

V1 minted at 06:27:25.98 with `acceptedCount=1` and empty arrays/circles (the creator's accept landed ~0.1 s before the invitee's). This is **expected, not a violation**: `pg_aggregate_collab_prefs` short-circuits when `acceptedCount < 2` and returns `intersection_empty:false` with empty circles (migration lines 132-144). The serve path then dead-ends any V1 request with `reason:'quorum_not_met'` ("Waiting for 1 more to accept", `discover-cards` 1008-1015) — NOT an empty/blank deck. The 2nd participant accepted 0.3 s later, immediately superseding V1 with V2. V1 caused at most a sub-second "waiting to accept" flash, unrelated to the reported DC/Raleigh empty windows. 🔵 Observation.

---

## Q5 — Classification, blast radius, platform parity

**Classification: primarily EXPECTED CHURN of a correct design, driven by bad input GPS — with ONE genuine product-grade UX flaw (🟠 contributing / hidden) and ZERO data-corruption or determinism bugs.**

- The geographic intersection logic is **correct**: it faithfully reported "no overlap" when the two circles were genuinely in different cities. 🔵
- The positional freeze + frontier-dead-end split is **working as designed** and is the honest explanation for "one saw it, one didn't." 🔵
- 🟠 **Contributing UX flaw (the real product bug):** a single GPS-mode participant whose device flaps between two cities **unilaterally thrashes the shared deck for everyone** — every spurious reading mints a new version and can flip the frontier participant into an empty state. There is no debounce, hysteresis, or "implausible jump" rejection on the `upsert_participant_prefs` GPS write (`RecommendationsContext.tsx:1451`), and no smoothing in `useUserLocation`/`enhancedLocationService`. This is the lever a SPEC should pull.
- 🟡 **Hidden flaw (copy):** for a 2-person session the empty copy is the generic "No location overlap yet" with both locations listed; `detectIntersectionOutlier` deliberately returns `'multi'` for `<3` participants (`collabDeadEndBannerService.ts:193`), so it never names "your GPS is bouncing to DC" — the user cannot tell WHY and is told "someone needs to widen travel," which is misleading when the true cause is a transient GPS glitch.
- 🔵 No dead-end banner messages were posted to the "TESTING CARDS" group chat (verified `messages` JOIN `conversations` = 0 rows), so neither user tapped "Notify group"; the empty state was purely the in-deck render.

**Blast radius:**
- **Collab decks only.** Solo mode does not use `pg_aggregate_collab_prefs`, `session_deck_versions`, or the shared-position freeze; solo location flap shows wrong-city cards but no cross-party thrash. The GPS-write effect (`RecommendationsContext.tsx:1444`) is gated on `isCollaborationMode`.
- Any collab session with ≥1 GPS-mode participant on a flaky/last-known-vs-fresh GPS device is exposed. The more participants in GPS mode, the more version churn.
- `session_deck_versions` row growth: this 3-minute session minted 6 versions; a sustained GPS flap would inflate version count (cosmetic/storage, not correctness — `ON CONFLICT DO NOTHING` keeps positions immutable).
- Admin dashboard: not affected (no admin surface renders this).
- Cache/query keys: collab deck query key is `['deck-cards','collab',sessionId,currentPosition]`; version churn does not corrupt it because positions are frozen.

**Platform parity:** the mechanism is platform-agnostic (shared RN code + shared SQL). The *trigger* (GPS flap) is more likely on iOS Simulator (custom-location vs last-known split) and on Android emulators / low-accuracy outdoor fixes. Both iOS and Android run the same `RecommendationsContext` effect and the same `enhancedLocationService` (`Location.getCurrentPositionAsync` / `getLastKnownPositionAsync`), so both are exposed. No platform-specific divergence in the code path. Web: consumer collab decks are app-mobile only; no web surface.

---

## Five-Layer Cross-Check

| Layer | Finding |
|---|---|
| **Docs / contract** | `feedback_collab_deck_determinism_contract`: deck = pure fn of session state, intersection of reachable circles, each client finishes V_n before transitioning, pref change mints V_{n+1}. The implementation HONORS this — the empty versions are a correct function of the (bad) GPS state, and frozen positions correctly survive version churn. No contract violation. |
| **Schema** | `session_deck_versions.aggregated_params` is the per-version snapshot of record; `session_deck_cards(session_id,position)` PK + version-≥1 / position-≥1 CHECKs; `session_participants.current_position` cursor (≥0). RLS on `session_deck_cards` = accepted-participants SELECT, service-only INSERT (migration 43-64). Latest defs confirmed = `20260701000000_orch_0909`. |
| **Code** | `RecommendationsContext.tsx:1444-1466` writes GPS on every change in GPS mode; `discover-cards` serves frozen card if position exists else evaluates LIVE `intersection_empty`; `generated_at_version = sessionRow.deck_version` (read at request entry, lines 1384/1565/1599) with first-writer-wins (`insert … code !== '23505'`). `enhancedLocationService` returns null (never a default) when GPS unavailable. |
| **Runtime** | Live `pg_get_functiondef` confirms the running `pg_aggregate_collab_prefs` contains the `v_gps_circle_count >= 2` gate + `ST_DWithin` + `estimate_circle_radius_m` (matches migration). Live `estimate_circle_radius_m` body byte-matches the 0902 migration (driving=600 m/min). |
| **Data** | `aggregated_params` per version: `b17e3e15` center = DC for V2/V4/V5, Raleigh for V3/V6. PostGIS `ST_Distance`=373.7 km. V2 replay `has_place_in_both=false`; V6 = 876 places. `session_deck_cards` = 4 (v3) + 9 (v6) = 13 positions. `current_position` 12/13. Zero dead-end banner messages. Board name = "TESTING CARDS". |

All five layers AGREE: empty versions were the correct output for the recorded (DC) circle centers. The defect is in the **input** (unfiltered flapping GPS thrashing the shared deck) and the **explanatory copy**, not in the geography, the freeze contract, or determinism.

---

## Outcome & journey step-back

**User goal:** two friends quickly converge on a place to meet, from a shared deck of options both can reach.

**Intended journey:** both accept → set location/travel → shared deck of mutually-reachable places appears → swipe → match.

**Where reality diverged:** `b17e3e15`'s phone reported DC for stretches of the session. The app treated each spurious DC reading as a real location change and rewrote the shared circle, repeatedly collapsing the geographic overlap to empty. The frontier participant saw "No location overlap yet" with copy implying *they* needed to widen travel or change location — when in fact nothing was wrong with either person's intent; the device just lied about where `b17e3e15` was. The journey self-healed only because the GPS eventually settled on Raleigh.

**Does fixing the reported node deliver the outcome?** The "reported node" (intersection empty) is not itself broken — fixing the SQL would be wrong. Delivering the outcome requires (a) stopping a single flapping GPS from thrashing the shared deck (debounce / hysteresis / implausible-jump rejection on the GPS write), and (b) honest 2-person copy that points at the real cause. Both are SPEC-phase decisions; this investigation proposes no fix.

---

## Discoveries for Orchestrator

1. 🟠 No debounce/hysteresis on the collab GPS write (`RecommendationsContext.tsx:1451`) — a single flapping device thrashes the shared multi-party deck. Strongest SPEC lever. (This ORCH.)
2. 🟡 2-person `intersection_empty` copy ("No location overlap yet" / "widen travel or change location") under-explains and can misattribute a GPS glitch to user error; `detectIntersectionOutlier` short-circuits to `'multi'` for `<3` participants. (This ORCH or a copy ORCH.)
3. 🔵 `session_deck_versions` can accumulate many near-duplicate versions under GPS flap (V2 and V4 share an identical `params_hash`); cosmetic/storage only, but worth noting for retention. (Register if it grows.)

---

## Regression-prevention direction (not a spec)

Whatever SPEC lands should be guarded by: a Deno/SQL test that feeds an oscillating GPS sequence and asserts the shared deck does not mint a new empty version for an implausible single-reading jump; and a test asserting that a frozen `session_deck_cards` position is still served during a live `intersection_empty=true` window (the freeze contract must not regress).

---

## No fix proposed

Per dispatch, this is INVESTIGATE only. SPEC is a later phase.
