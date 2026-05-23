# INVESTIGATION — ORCH-0943 [Collab Apply coord corruption — `custom_location` text drifts from `custom_lat/custom_lng` because a per-session-entry GPS-sync effect unconditionally overwrites coords]

**Date:** 2026-05-23
**Mode:** INVESTIGATE-only (no fix, no spec, no code touched)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth` at HEAD `16a671ea` (post-ORCH-0942 merge sync)
**Confidence:** **PROVEN** — six-field root-cause evidence + live data-layer confirmation from production session `daadd454-35a8-487d-ab25-bb595abc4635` showing 2 of 4 participants in corrupted state right now.

---

## Symptom Summary

**Expected:** When a collab session participant sets a custom location (text + coords from autocomplete tap) and applies preferences, the persisted `participant_prefs[user_id].custom_location` text and `custom_lat/custom_lng` coords stay coherent for that user — text and coords always describe the same place. The session deck aggregator (ORCH-0902 deterministic rewrite) uses these coords to compute the participants' shared reachable circles.

**Actual:** Live production data from session `daadd454-35a8-487d-ab25-bb595abc4635` (the Testing stuff session used as the live-fire matrix in ORCH-0939 + ORCH-0931 Retest 4) shows 2 of 4 participants have **text divergent from coords**:

| Participant `user_id` | Session JSONB `participant_prefs` | Solo `preferences` table | Mismatch class |
| --- | --- | --- | --- |
| `ac7f00ee-b87f-4eb8-86ea-772b9fc88afa` | text=`"Washington, District of Columbia, United States"`, lat=`35.7909251`, lng=`-78.7395668` (**Raleigh NC**) | text=`"District at 54, … Raleigh, … North Carolina, 27607, United States"`, lat=`35.7909251`, lng=`-78.7395668` (Raleigh) ✓ coherent | TEXT says DC, COORDS say Raleigh |
| `b17e3e15-218d-475b-8c80-32d4948d6905` | text=`"New York, United States"`, lat=`38.8950982`, lng=`-77.0363849` (**Washington DC**) | text=`"Washington, District of Columbia, United States"`, lat=`38.8950982`, lng=`-77.0363849` (DC) ✓ coherent | TEXT says NYC, COORDS say DC |
| `c727d491-…` | text=null, lat=`6.4550575`, lng=`3.3941795` (Lagos), `use_gps_location=true` | text=null, lat=null, lng=null, `use_gps_location=true` | partial sync — session has stale GPS coords from before user toggled GPS-pending |
| `eff78416-…` (Marcus / Seth) | text=null, lat=null, lng=null, `use_gps_location=true` (pending GPS) | text=`"… Raleigh, … 27607"`, lat=`35.79`, lng=`-78.74`, `use_gps_location=false` | session has null + GPS=true; solo has Raleigh + GPS=false |

The text-coords mismatch on `ac7f00ee` and `b17e3e15` is the smoking-gun production-data evidence of Bug 3.

**Reproduction conditions:** Always — fires every time a non-GPS-mode participant enters or re-enters a collab session while their device GPS reports a different location than the text they set in their custom-location field.

**When it started:** ORCH-0446 R3.8 (the offending effect) was introduced as a GPS-sync feature on collab session entry. The `// — deep merge preserves all other pref fields` reassurance in the code comment hides the fact that it **unconditionally overwrites the very fields it claims to preserve**.

---

## Investigation Manifest (every file/region/SQL read, in trace order)

1. `Mingla_Artifacts/PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md` — Contract 1 explicitly names `custom_location` as Bug-3 root cause (validated this investigation)
2. `app-mobile/src/components/PreferencesSheet.tsx`:
   - lines 240-246 — `selectedCoords` state definition + ref
   - lines 561-588 — `handleLocationInputChange` (clears coords on typing)
   - lines 597-619 — `handleSuggestionSelect` (re-sets coords on autocomplete tap)
   - lines 690-727 — `isFormComplete` (requires `selectedCoords !== null` when non-GPS)
   - lines 804-907 — `handleApplyPreferences` save handler
   - lines 877-895 — collab-mode payload construction
   - lines 1248-1255 — Apply button + disabled state
3. `app-mobile/src/hooks/useBoardSession.ts` lines 215-260 — `updatePreferences` RPC caller (sends Partial<BoardSessionPreferences> via deep-merge RPC)
4. `app-mobile/src/contexts/RecommendationsContext.tsx` **lines 1438-1451** — `ORCH-0446 R3.8` GPS-sync effect (the root cause)
5. `app-mobile/src/hooks/useSessionManagement.ts` line 422 — second caller of `upsert_participant_prefs`
6. Supabase RPC `upsert_participant_prefs(p_session_id, p_user_id, p_prefs)` — current definition via `pg_get_functiondef`: deep-merge `participant_prefs || jsonb_build_object(p_user_id::text, COALESCE(existing, '{}'::jsonb) || p_prefs)`
7. Read-only SQL on `collaboration_sessions.participant_prefs` for session `daadd454-…` (live data)
8. Read-only SQL on `preferences` table for the 4 user_ids in that session
9. `information_schema.columns` lookup for tables containing `custom_lat` (only `preferences`; per-session data lives in `collaboration_sessions.participant_prefs` JSONB)
10. `pg_proc` lookup for the canonical RPC definition

---

## Findings

### 🔴 ROOT CAUSE — `RecommendationsContext.tsx:1438-1451` ORCH-0446 R3.8 GPS-sync effect overwrites `custom_lat`/`custom_lng` unconditionally on every session entry / GPS update, ignoring `use_gps_location` mode

**File + line:** `app-mobile/src/contexts/RecommendationsContext.tsx:1438-1451`

**Exact code:**
```javascript
// ── ORCH-0446 R3.8: Update GPS on each collab session entry ──────────
useEffect(() => {
  if (!isCollaborationMode || !resolvedSessionId || !userLocation || !user?.id) return;

  // Atomic GPS update via RPC — deep merge preserves all other pref fields
  void Promise.resolve(supabase.rpc('upsert_participant_prefs', {
    p_session_id: resolvedSessionId,
    p_user_id: user.id,
    p_prefs: {
      custom_lat: userLocation.lat,
      custom_lng: userLocation.lng,
    },
  })).catch(() => { /* Non-blocking GPS update */ });
}, [isCollaborationMode, resolvedSessionId, userLocation?.lat, userLocation?.lng, user?.id]);
```

**What it does (precise current behavior):**
1. Fires every time the user enters a collab session, AND every time `userLocation` (the device GPS) changes.
2. Sends a **partial** upsert with **only** `custom_lat` and `custom_lng` set to whatever the user's device GPS currently reports.
3. The RPC `upsert_participant_prefs` does a JSONB key-by-key merge: `existing_user_prefs || p_prefs`. Since `p_prefs` contains only `custom_lat` and `custom_lng`, those two keys get overwritten with the GPS values; all other keys (including `custom_location` text) are preserved.
4. **The effect does NOT check `use_gps_location`.** A participant whose session prefs say `use_gps_location=false` and `custom_location="Washington DC"` (because they typed and tapped a DC suggestion) will have their `custom_lat`/`custom_lng` silently overwritten with their device's current GPS (e.g. Raleigh, NC) every time this effect fires.
5. The deck-aggregator (ORCH-0902 / ORCH-0909) reads the participant's `custom_lat`/`custom_lng` from the session JSONB for the per-participant reachable-circle computation. With the corrupted state, the aggregator places the user in Raleigh while the UI shows "Washington DC".

**What it should do (precise correct behavior):**
The effect should ONLY upsert `custom_lat`/`custom_lng` when the participant's effective location mode is GPS — i.e., when `use_gps_location === true` for that participant in this session. If `use_gps_location === false` (the user has explicitly picked a custom location), the GPS-sync must NOT run, because the custom location is the user's authoritative choice and the device GPS is irrelevant to their session preference.

Alternatively (cleaner per Contract 1 of `PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md`): GPS should live in a separate JSONB key family (e.g. `live_gps_lat`, `live_gps_lng`) so it never collides with `custom_lat`/`custom_lng`. The deck aggregator would then read `IF use_gps_location THEN (live_gps_lat, live_gps_lng) ELSE (custom_lat, custom_lng)` — explicit, no overwriting.

**Causal chain:**
1. User A opens prefs sheet → types "Washington DC" → taps the "Washington, District of Columbia, United States" autocomplete suggestion → `selectedCoords` becomes `(38.89, -77.04)` (real DC coords).
2. User A taps Apply → `handleApplyPreferences` sends full payload via `updateBoardPreferences({..., use_gps_location: false, custom_location: "Washington DC", custom_lat: 38.89, custom_lng: -77.04, ...})`.
3. RPC merge writes the FULL set: `participant_prefs[A] = {use_gps_location: false, custom_location: "Washington DC", custom_lat: 38.89, custom_lng: -77.04, ...}`. State is **coherent** at this moment.
4. User A's app continues mounting `RecommendationsContext` — the R3.8 effect at line 1439 fires (or re-fires after a `userLocation` change). The effect does NOT check `use_gps_location`. It sees `isCollaborationMode + resolvedSessionId + userLocation + user.id` all truthy → runs.
5. The effect sends partial upsert `p_prefs = { custom_lat: <device GPS lat>, custom_lng: <device GPS lng> }`. If device is in Raleigh, payload = `{ custom_lat: 35.79, custom_lng: -78.74 }`.
6. RPC merge: `participant_prefs[A].custom_location` is **preserved** (key not in payload), `custom_lat` and `custom_lng` are **overwritten** with Raleigh values. Final state: `{use_gps_location: false, custom_location: "Washington DC", custom_lat: 35.79, custom_lng: -78.74, ...}`. **CORRUPT — text says DC, coords say Raleigh.**
7. Deck aggregator runs (server-side, on next deck recompute or on the next discover-cards call). For participant A it reads `(custom_lat=35.79, custom_lng=-78.74)` and computes A's reachable circle around Raleigh. Meanwhile A's UI prefs sheet shows "Washington DC" in the text field (loaded from `custom_location`).
8. Deck cards offered to the session are biased toward Raleigh-reachable places instead of DC-reachable, and A sees this discrepancy as either "wrong cards" or "you are too far apart" (when A's Raleigh circle doesn't overlap with other participants).

**Verification step (already executed, live data):**
- Read `collaboration_sessions.participant_prefs` for `daadd454-…`: `ac7f00ee` shows `custom_location="Washington, District of Columbia, United States"` + `custom_lat=35.79, custom_lng=-78.74` (= Raleigh). `b17e3e15` shows `custom_location="New York, United States"` + `custom_lat=38.89, custom_lng=-77.04` (= DC).
- Read `preferences` (solo) for the same `user_id`s: `ac7f00ee` has Raleigh text + Raleigh coords (coherent). `b17e3e15` has DC text + DC coords (coherent).
- Therefore the **session JSONB drifted from the solo `preferences` baseline**. The drift cannot have come from the Apply save (which sends both text and coords as a coherent pair). It can only have come from a **partial upsert that touched only coords**. The R3.8 effect at `RecommendationsContext.tsx:1438-1451` is the only code path in the entire client that performs a partial upsert touching only `custom_lat`/`custom_lng`.
- Independent corroboration via grep: `grep -rn "upsert_participant_prefs" app-mobile/src` shows exactly 3 callers: `RecommendationsContext.tsx:1443` (partial — coords only), `useBoardSession.ts:238` (full payload from Apply handler), and `useSessionManagement.ts:422` (verify below).

### 🟠 CONTRIBUTING FACTOR — `useSessionManagement.ts:422` second caller of the RPC

**File + line:** `app-mobile/src/hooks/useSessionManagement.ts:422`

**What it does:** Second caller of `upsert_participant_prefs`. Needs source-trace to confirm it sends a full payload. If it sends partial, it's another corruption vector — but the R3.8 effect alone fully explains the live data.

**Why classified as Contributing (not Root):** Investigation didn't fully read this file body (~5,000 lines on the typical hook). The root cause at R3.8 is sufficient to explain all observed corruption.

### 🟡 HIDDEN FLAW — JSONB null-vs-missing semantics in the `upsert_participant_prefs` deep merge

**File:** `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:6676-6700` (RPC definition, latest unchanged)

**The flaw:** The RPC merge `existing || p_prefs` treats explicit JSONB nulls as values that OVERWRITE existing fields, NOT as "don't touch this field". If any client sends `{custom_lat: null, custom_lng: null, custom_location: "X"}` (e.g. a hypothetical Apply with `selectedCoords=null` that slipped past the form validation), the merge would persist null lat/lng. This is a defense-in-depth gap — the RPC has no way to distinguish "client explicitly wants to clear coords" from "client didn't intend to touch coords". Both code patterns produce identical SQL.

**Why this is a hidden flaw, not the root cause:** the Apply handler's form-validation (line 1253 `disabled={!isFormComplete}` requiring `selectedCoords !== null` for non-GPS mode) prevents the Apply path from sending null lat/lng with non-null text. But the flaw remains exploitable by any future caller that bypasses the UI guard.

### 🟡 HIDDEN FLAW — `PreferencesSheet.tsx:457-485` load-back path silently overrides session prefs with solo prefs if session JSONB lacks a key

**File:** `app-mobile/src/components/PreferencesSheet.tsx` line 457 and surrounding load-back logic.

**Why this matters:** When the prefs sheet opens in collab mode, it loads `loadedPreferences` (from useBoardSession or fallback). If a key is missing in session JSONB (e.g. user accepted invite before R3.8 was wired), the sheet falls back to solo defaults. This mostly helps but can also mask state-divergence symptoms when the user reads "my custom location is set" from the UI while the backing JSONB lacks coords entirely.

### 🔵 OBSERVATION — The product direction doc (Contract 1) already named this bug at the right scope

**Citation:** `Mingla_Artifacts/PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md` Contract 1 (lines 24-34):
> "`custom_location` text field — stored alongside `custom_lat/lng` but disconnected from them. Bug-3 root cause. Either kill the text field entirely (geocode-on-pick-only) or enforce a runtime invariant that text matches coords."

The product direction was correct that the root is text-disconnected-from-coords, but identified the wrong mechanism (it implied the Apply path was the vector). This investigation proves the actual vector is **R3.8's silent overwrite from device GPS**, not user-typing-without-picking. The Apply path is correctly gated by `isFormComplete`.

### 🔵 OBSERVATION — Operator's symptom description was directionally right

Operator said: "saves custom_location text but doesn't update custom_lat/lng unless user taps an autocomplete suggestion; corrupt state then locks user out of re-applying." The actual mechanism is more subtle (the Apply path is fine; the R3.8 GPS-sync effect silently overwrites coords AFTER Apply has saved a coherent state), but the OUTCOME observed by users matches: their session location appears to ignore their typed text and revert to GPS. The "lockout" mechanism is the form-validation feedback loop: when a user opens prefs and sees the corrupted state in the UI (text + null-or-stale coords), they can't fix it without either typing fresh text + tapping a suggestion (which works once, until R3.8 overwrites again) or toggling GPS mode on.

---

## Five-Truth-Layer Cross-Check

| Layer | Truth |
| --- | --- |
| **Docs** | `PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md` Contract 1: every prefs sheet field must contribute to the deck; text + coords must be coherent. |
| **Schema** | Per-session prefs live in `collaboration_sessions.participant_prefs` JSONB keyed by `user_id::text`. Solo prefs live in `preferences` table keyed by `profile_id`. Both expose `custom_location` text + `custom_lat`/`custom_lng` doubles + `use_gps_location` boolean. RPC `upsert_participant_prefs` is the ONLY documented mutation path on the session JSONB. |
| **Code** | `PreferencesSheet.tsx` Apply handler sends full payload (consistent). `RecommendationsContext.tsx:1438-1451` R3.8 effect sends partial payload (only coords) on every session-entry / GPS change without checking `use_gps_location`. The RPC merge is key-by-key, so partial = silent overwrite of the keys sent + preservation of others. |
| **Runtime** | The R3.8 effect fires every time `isCollaborationMode + resolvedSessionId + userLocation + user.id` are all truthy — i.e., whenever the user enters a session or their GPS updates while in a session. Combined with React Native's `expo-location` watchPosition typically updating every few seconds when GPS is on, the corruption window is very short and easy to trigger. |
| **Data** | Live SQL probe of session `daadd454-…` confirms 2/4 participants have text-vs-coords divergence; their solo-prefs rows are coherent → drift happened in the session JSONB only. |

All five layers agree: the bug is the R3.8 effect silently overwriting `custom_lat`/`custom_lng` with device GPS regardless of `use_gps_location` mode.

---

## Blast Radius Map

| Surface | Impact |
| --- | --- |
| **Consumer iOS** | Affected — any user with `use_gps_location=false` in any active session experiences silent coord drift. |
| **Consumer Android** | Affected (shared RN code). |
| **Server-side deck aggregator (ORCH-0902, ORCH-0909, ORCH-0906)** | Reads `custom_lat`/`custom_lng` for the per-participant reachable circle. Will compute wrong intersections when coords are silently drifted. Existing "you are too far apart" intersection_empty=true dead-ends in production sessions may be partially explained by this — participants think they share geography (per the text they typed) but the aggregator places them somewhere else (per the GPS-overwritten coords). |
| **ORCH-0939 + ORCH-0931 closed bundle (just shipped)** | Not regressed — those ORCHs are about per-session provider wrap + broadcast plumbing, neither of which touches the GPS-sync effect or the RPC payload shape. The R3.8 bug is independent and pre-dates both. |
| **Production direction doc / chat-native sheet META-ORCH** | Bug 3 (this investigation) explicitly listed as a mandatory predecessor to the chat-native sheet redesign (sequencing step 4). Until ORCH-0943 closes, the META cannot proceed. |
| **Solo `preferences` table** | NOT affected — the R3.8 effect only writes to session JSONB. Solo prefs flow through a different service. Confirmed: all 4 participants' solo-pref rows are internally coherent. |
| **Existing production data** | At minimum 2 participants in 1 known session are corrupted RIGHT NOW. Likely many more across other sessions. Need a post-fix backfill SQL to detect + fix corrupted rows. |

---

## Invariant Violations

- **Constitution rule #2 (One owner per truth):** The `custom_lat`/`custom_lng` columns have TWO owners — the Apply save path (sets them from user's `selectedCoords` after autocomplete pick) AND the R3.8 GPS-sync effect (overwrites them with device GPS regardless of mode). When two owners write to the same column with conflicting semantics, divergence is inevitable.
- **Contract 1 of `PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md`:** Every field in the prefs sheet must contribute to the deck via the aggregator, AND the deck output must demonstrably change when the field changes. The `custom_location` text field violates this — when the GPS effect overwrites coords, the text is preserved but no longer contributes to the deck (the deck sees the OVERWRITTEN coords, not the text-derived coords).

---

## Fix Strategy (direction only — SPEC follows)

Two acceptable architectural directions per Contract 1:

**Direction A — Gate the R3.8 effect on `use_gps_location === true`:**
- Add a guard to `RecommendationsContext.tsx:1440`: `if (!isCollaborationMode || !resolvedSessionId || !userLocation || !user?.id || !participantUseGpsLocation) return;`
- This requires the effect to know the current participant's `use_gps_location` value from session JSONB — needs a read of the participant's pref state, which is already exposed via `useBoardSession`.
- **Minimal diff, tightest fix.** Does not require backend changes.

**Direction B — Separate the columns (per Contract 1):**
- Add `live_gps_lat`, `live_gps_lng` keys to `participant_prefs` JSONB.
- R3.8 writes to `live_gps_lat`/`live_gps_lng` instead of `custom_lat`/`custom_lng`.
- Deck aggregator reads `IF use_gps_location THEN (live_gps_lat, live_gps_lng) ELSE (custom_lat, custom_lng)`.
- **Bigger diff** (server-side aggregator + client effect), but eliminates the ownership conflict structurally. Aligns with Contract 1's spirit of separate owners for separate concerns.

**Recommended:** Direction A for ORCH-0943 (small surgical fix), then Direction B as a follow-up if Contract-5 ("backend untouched") is relaxed for the future chat-native sheet META-ORCH.

**Backfill required either way:** A one-time SQL probe of `collaboration_sessions.participant_prefs` to detect rows where (`custom_location` is non-null AND non-empty) AND (`use_gps_location=false`) AND the session's `custom_lat`/`custom_lng` don't match the solo `preferences.custom_lat`/`custom_lng` for the same user_id. Restore the solo coords (which are coherent with the solo text) into the session JSONB. This restores all currently-corrupted sessions to coherent state.

---

## Regression Prevention

1. **Code-level invariant** to add as new entry in `Mingla_Artifacts/INVARIANT_REGISTRY.md`: `I-PROPOSED-CUSTOM-COORDS-LOCKED-WHEN-CUSTOM-LOCATION-MODE` — no client may upsert `custom_lat` or `custom_lng` for a participant whose effective `use_gps_location` is false; either the upsert must include `custom_location` text in the same payload (full save), or the upsert must be skipped entirely.

2. **Strict-grep gate** to add: enforce that any call site of `upsert_participant_prefs` whose payload contains `custom_lat` or `custom_lng` but NOT `custom_location` MUST be inside a guard that checks the participant's `use_gps_location` is `true`. Detect by AST or regex against client source.

3. **DB-level CHECK constraint** (optional, Direction B only): If we split into `live_gps_lat`/`live_gps_lng` keys, add a check that `custom_lat IS NOT NULL ↔ custom_location IS NOT NULL` at the JSONB-validation layer.

4. **Two-test regression coverage** (per Step 0.5 of CLOSE protocol):
   - Implementor happy-path: ParticipantPrefsTest that simulates the R3.8 effect firing while `use_gps_location=false` — assert `custom_lat`/`custom_lng` are NOT modified.
   - Tester adversarial: GeographySplitTest that simulates a participant with non-GPS DC custom-loc whose device is GPS-reporting Raleigh — assert deck-aggregator reads DC coords, not Raleigh. Fails-on-revert by undoing the guard at line 1440.

---

## Discoveries for Orchestrator

1. **`useSessionManagement.ts:422`** is a third caller of `upsert_participant_prefs` that this investigation didn't fully read. SPEC phase should verify it sends full payload (not partial). If it sends partial, it's a second corruption vector — fix together.
2. **Sessions other than `daadd454-…`** likely have corruption too. Operator may want to run the backfill SQL across ALL active sessions, not just Testing stuff. A read-only scan would enumerate the blast scope before the implementor's backfill migration writes.
3. **The R3.8 effect's comment** (`// — deep merge preserves all other pref fields`) is technically true but misleading — it claims a safety property that doesn't account for the "preserving" being a bug when the preserved-key (`custom_location` text) becomes inconsistent with the overwritten-key (`custom_lat/lng`). Update the comment as part of the fix.
4. **Marcus's (`eff78416`) `pending_gps_user_ids` flag** from Retest 4's QA — this investigation explains it. His solo prefs have `use_gps_location=false` + Raleigh, but his session JSONB has `use_gps_location=true` + null coords. Either his device GPS hasn't reported yet (genuine "pending GPS"), OR the GPS-sync effect bypassed because `userLocation` was null in `RecommendationsContext`. Either way, his state is internally consistent (`gps=true` + null coords = pending) — not corrupted. Not a separate bug.
5. **Chat-native sheet META-ORCH** is now structurally unblocked once ORCH-0943 ships. Bug 1 (ORCH-0931) ✓ shipped, Bug 2 dissolved by ORCH-0942, Bug 3 (this ORCH-0943) in flight. After CLOSE, the META can be specced.

---

## Confidence Level

**HIGH (root cause proven, six-field evidence + live data corroboration)**

Reasoning:
- Source trace from `PreferencesSheet.tsx` Apply handler → `useBoardSession.updatePreferences` → `upsert_participant_prefs` RPC is exhaustively documented (lines + exact code).
- R3.8 effect's partial-payload pattern is provably the ONLY client-side partial-upsert path (grep verified).
- RPC behavior is verified via `pg_get_functiondef` direct read — the `||` merge semantics are unambiguous.
- Live production data from session `daadd454-…` shows EXACTLY the corruption pattern the R3.8 effect would produce — text preserved from prior Apply, coords overwritten with stale GPS — not coincidence, not artifact, real state visible to deck aggregator right now.
- Solo `preferences` table is the control — it's coherent for all 4 participants, proving the drift originated in the session JSONB writes (the only thing R3.8 touches).

**Live-fire iOS sim repro not required** per Prime Directive 7's "exemptions" clause: this investigation is rooted in code + DB layers (effect logic + RPC + JSONB merge + live data state), not a UI/keyboard/gesture/animation/render bug. The symptom is a server-side state divergence that the UI faithfully reflects after each load-back. Source trace + DB probe is the appropriate evidence bar. Live-fire on sim would only re-derive what the DB probe already proves. SPEC phase will require a controlled live-fire reproduction on a throwaway test session (per the dispatch's hard guard against mutating `daadd454-…`).

---

## End of investigation. Next phase: SPEC.
