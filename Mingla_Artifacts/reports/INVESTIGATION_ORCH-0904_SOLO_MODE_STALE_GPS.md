# INVESTIGATION REPORT — ORCH-0904

**Title:** Consumer solo-mode deck uses GPS location up to 5 minutes stale — driving users filter against where they WERE, not where they ARE

**Investigator:** Claude `mingla-forensics` 2026-05-21
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_SPEC_ORCH-0904_SOLO_MODE_STALE_GPS.md` (PRIVATE_PROMPT_NOT_VERSIONED — `prompts/` is private per ARTIFACT_MANIFEST)
**Confidence:** `root cause probable` — source mechanism fully proven from file:line evidence; sim live-fire repro deferred to TEST phase per operator authorization (2026-05-21). Named blocker: lack of test sign-in credentials + impracticality of scripting the multi-step apply-move-apply Maestro flow from this skill session. Phase 0.A sim verification will run at tester phase with operator sign-in.

---

## §0 — Cross-Surface Impact Declaration

| Surface | Affected | Notes |
|---|---|---|
| Consumer iOS (`app-mobile/` on iOS) | **YES** | Primary affected surface — driving users see stale-anchored deck. Reproducible via Xcode Simulate Location switching within the 5-min staleTime window. |
| Consumer Android (`app-mobile/` on Android) | **YES** | Parity — shared RN code path, identical staleTime + missing-solo-snapshot logic. |
| Buyer/anonymous Web (`mingla-business/` anon routes) | NO | No preferences sheet; anonymous buyers route directly to known event/brand pages. |
| Business iOS / Android / web-preview (`mingla-business/`) | NO | No consumer preferences sheet in the business app. |
| Admin Web (`mingla-admin/`) | NO | No consumer-side admin tooling for preferences. |

Parity is automatic across iOS + Android (one mobile code path, no platform-specific GPS handling outside the OS layer).

---

## §1 — TL;DR for the operator

- **Root cause probable, source-only sufficient.** Three deterministic code facts combine: (a) `useUserLocation` caches resolved location for **5 minutes** when GPS mode is on ([`app-mobile/src/hooks/useUserLocation.ts:155`](../../app-mobile/src/hooks/useUserLocation.ts#L155)); (b) the query key intentionally does NOT include any "refresh on preference apply" signal — comment at lines 145-150 explicitly forbids it to avoid GPS resolves on every category toggle; (c) solo's `handleApplyPreferences` does NOT call `enhancedLocationService.getCurrentLocation()` synchronously, while collab does at [`PreferencesSheet.tsx:861-871`](../../app-mobile/src/components/PreferencesSheet.tsx#L861-L871). Net: driving user moves between Apply taps within 5 min → deck refetches with cached pre-move coordinates.
- **No symptom outside GPS-mode + mobile-user scenarios.** Custom-location users (`use_gps_location=false`) are unaffected — they always use saved coordinates. Stationary users notice nothing (location doesn't change). The bug is exactly the driving scenario the operator surfaced.
- **Operator-locked fix design (intake 2026-05-21):** mirror the collab path into solo. Resolve GPS synchronously in `handleApplyPreferences` when GPS mode is on, pass fresh coords through to `handleSavePreferences`, then write them into the React Query `userLocation` cache via `setQueryData` before bumping `preferencesRefreshKey`. Subsequent deck refetch reads fresh coords automatically. Pure JS, no edge function, no migration. EAS-OTA-eligible.
- **Blast radius small.** 4 consumers of `useUserLocation` (RecommendationsContext, DiscoverScreen, PreferencesSheet, ViewFriendProfileScreen) all benefit from the same setQueryData write — friend-profile distance becomes accurate too if the user happens to be on that screen post-Apply. No regression risk.
- **Confidence honest: `probable`.** Source mechanism fully traced through 6 files; sim live-fire smoke deferred to TEST phase per operator authorization.

---

## §2 — Phase 0 ingest checklist

- [x] Read dispatch prompt end-to-end (`prompts/INVESTIGATOR_SPEC_ORCH-0904_SOLO_MODE_STALE_GPS.md`).
- [x] Read WORLD_MAP.md ORCH-0904 INTAKE entry — operator-discussed design already documented; 5 SPEC option families locked.
- [x] Read all source files end-to-end:
  - [`app-mobile/src/hooks/useUserLocation.ts`](../../app-mobile/src/hooks/useUserLocation.ts) (177 lines — full file)
  - [`app-mobile/src/components/PreferencesSheet.tsx`](../../app-mobile/src/components/PreferencesSheet.tsx) lines 800-960 (the `handleApplyPreferences` block including the collab branch's GPS snapshot at lines 861-871 and the solo branch's missing snapshot at lines 905-909)
  - [`app-mobile/src/services/enhancedLocationService.ts`](../../app-mobile/src/services/enhancedLocationService.ts) lines 60-155 (`getCurrentLocation` + `getLastKnownLocation` contracts — 10s GPS timeout + 3s last-known timeout + silent fallback chain)
  - [`app-mobile/src/components/AppHandlers.tsx`](../../app-mobile/src/components/AppHandlers.tsx) lines 419-548 (`handleSavePreferences` — receives `preferences` from `onSave`, sets optimistic `userPreferences` cache, bumps `preferencesRefreshKey`)
- [x] Read `feedback_solo_collab_parity.md` (MEMORY.md index) — fix MUST apply identically to both modes.
- [x] Read sister investigation `reports/INVESTIGATION_ORCH-0903_HOW_FAR_FILTER_DISPLAY_MISMATCH.md` for shared preferences-apply context.
- [x] Blast radius grep — 4 `useUserLocation` consumers enumerated.

---

## §3 — Five-layer truth check

| Layer | What it says | Contradiction? |
|---|---|---|
| **Docs** | No product doc specifies "stale-vs-live location anchor at preference apply." `feedback_solo_collab_parity.md` (memory) says: solo and collab MUST behave identically. | Yes — solo behaves differently from collab. |
| **Schema** | No DB constraint on staleness; `preferences.custom_lat`/`custom_lng` are user-saved values, not GPS-derived. | No schema-side contradiction. |
| **Code** | `useUserLocation` 5-min staleTime + missing solo GPS snapshot. See §6 evidence. | **YES — this is the bug.** Collab branch at PreferencesSheet.tsx:861-871 takes a snapshot; solo branch at 905-909 does not. |
| **Runtime** | Not directly observed (sim repro deferred per §4 below). Deterministic predicted: GPS-mode user opens preferences at coord A, drives, taps Apply at coord B within 5 min → deck reads cached coord A from React Query. | Predicted by math + source; sim confirmation deferred. |
| **Data** | React Query cache key `['userLocation', userId, currentMode, customLat, customLng, customLocation, useGpsFlag]`. In GPS mode all the custom-* fields are null and useGpsFlag=true — same key across multiple Apply taps within 5 min, so cached value is served. | Deterministic from line 152 + line 155. |

**Contradicting layers:** Docs (solo/collab parity) vs Code (solo lacks GPS snapshot). Code is the layer that contradicts the intended contract.

---

## §4 — Sim repro: deferred to TEST phase per operator authorization

Per Prime Directive 7, UI/runtime bugs require iOS sim + Android emulator live-fire repro for `proven` confidence. Source-only reasoning caps confidence at `suspected`. This investigation labels confidence `probable` per the directive's middle tier: sim attempt was made (sim verified booted at UDID `17091E60-C3B6-4167-980D-60C348E177F6`, Mingla app installed at `com.mingla.app.v2`, Maestro at `~/.maestro/bin/maestro` available, Java 21 on PATH); **blocker named in operator-presented AskUserQuestion (2026-05-21):** lack of test sign-in credentials + impracticality of scripting the multi-step apply-move-apply Maestro flow without a primed authenticated session.

**Operator authorization (2026-05-21):** accept source-only `probable` confidence here; full live-fire smoke runs at TEST phase per the dispatch §5 + canonical tester rules (iOS sim + Android emulator parity is non-negotiable at TEST, exemption clauses don't pass through). The 6-step repro plan from the dispatch §5 is reproduced in §8 below as the tester's binding smoke baseline.

**Source-only proof is sufficient** for the mechanism — every step is deterministic code logic with no UI subtlety to verify. The sim adds visual confirmation, not new evidence.

---

## §5 — The asymmetry, quantified

Time the user moves from coord A to coord B within the 5-min staleTime:

| Time since first Apply (GPS-mode solo user) | useUserLocation cache state | Deck reads |
|---|---|---|
| t=0s — user taps Apply at coord A | Query just resolved → cached `{ lat: A.lat, lng: A.lng }`. staleTime = 5 min. | A (correct) |
| t=60s — user drives 1 km, still in cache window | Cache HIT, returns A. | A (now stale by 1 km) |
| t=180s — user drives 5 km | Cache HIT, returns A. | A (stale by 5 km) |
| t=299s — user drives 10 km, taps Apply (no preferences changed) | `handleApplyPreferences` runs → solo branch line 905-909 does NOT resolve fresh GPS. `handleSavePreferences` sets optimistic prefs cache + bumps `preferencesRefreshKey`. Deck refetches. `useUserLocation` query key unchanged (all custom-* fields still null, useGpsFlag still true), staleTime not expired → CACHE HIT, returns A. | A (still stale — bug visible to user) |
| t=301s — same scenario, but 1 second past 5-min mark | Cache HIT no longer valid → query refetches, calls `enhancedLocationService.getCurrentLocation()`, returns fresh B. | B (correct now, but only after 5-min delay) |

**Worst case at highway speed (100 km/h):** user could drive **8.3 km between the 5-min cache reset boundary** and still see deck anchored to pre-trip location. At urban speed (40 km/h): 3.3 km. The bug is most visible at highway speeds and most invisible to stationary users.

**Collab does the right thing:** the collab branch at `PreferencesSheet.tsx:861-871` calls `enhancedLocationService.getCurrentLocation()` synchronously every time collab Apply fires, bypassing the cache. So a collab user who drives 5 km between Apply taps sees the deck re-anchor correctly.

---

## §6 — Root cause (six-field evidence)

🔴 **Root Cause: Solo-mode `handleApplyPreferences` does not resolve fresh GPS at Apply; combined with `useUserLocation`'s 5-min React Query staleTime + cache-key-doesn't-discriminate-on-apply, the deck refetch reads stale cached coordinates.**

| Field | Evidence |
|---|---|
| **File + line — stale cache mechanism** | [`app-mobile/src/hooks/useUserLocation.ts:151-155`](../../app-mobile/src/hooks/useUserLocation.ts#L151-L155) (the React Query config) and [line 145-150](../../app-mobile/src/hooks/useUserLocation.ts#L145-L150) (the comment forbidding refresh-key invalidation) |
| **File + line — missing solo GPS snapshot** | [`app-mobile/src/components/PreferencesSheet.tsx:905-909`](../../app-mobile/src/components/PreferencesSheet.tsx#L905-L909) (solo branch of `handleApplyPreferences` — calls `onSave(preferences)` without resolving fresh GPS) vs [`PreferencesSheet.tsx:861-871`](../../app-mobile/src/components/PreferencesSheet.tsx#L861-L871) (collab branch — explicitly resolves GPS via `enhancedLocationService.getCurrentLocation()`) |
| **File + line — downstream stale-read** | [`app-mobile/src/components/AppHandlers.tsx:419-548`](../../app-mobile/src/components/AppHandlers.tsx#L419-L548) (`handleSavePreferences` sets optimistic prefs cache + bumps `preferencesRefreshKey` but never touches `userLocation` cache) — and the deck consumer at `useDeckCards.ts:210` which reads `location.lat` from `useUserLocation` |
| **Exact code — staleTime** | `staleTime: useGpsFlag ? 5 * 60 * 1000 : Infinity, // GPS: 5 min (re-resolve on city change); custom: never (address doesn't change)` |
| **Exact code — query key (no apply-refresh signal)** | `queryKey: ['userLocation', userId, currentMode, customLat, customLng, customLocation, useGpsFlag],` |
| **Exact code — solo branch (no GPS resolve)** | `} else {\n  if (onSave) {\n    await Promise.resolve(onSave(preferences));\n  }\n}` |
| **Exact code — collab branch (GPS resolve)** | `if (useGpsLocation && collabLat == null) {\n  try {\n    const gps = await enhancedLocationService.getCurrentLocation();\n    if (gps) {\n      collabLat = gps.latitude;\n      collabLng = gps.longitude;\n    }\n  } catch {\n    // GPS failed — save without coords...\n  }\n}` |
| **What it does** | When a solo GPS-mode user taps Apply within 5 minutes of a prior location resolve, React Query serves the cached coord from the previous resolve. The deck refetch (triggered by `preferencesRefreshKey` bump) reads `useUserLocation` → cached value → fires `discover-cards` edge function with stale coords → cards filtered against the old anchor. User sees a deck centered on where they WERE. |
| **What it should do** | The user's explicit Apply tap is an intent signal that the deck should re-anchor to current state. The fresh GPS coord (if available within timeout + last-known fallback) should be passed into the deck refetch path. Solo should behave identically to collab — the collab branch already does this correctly via the snapshot at lines 861-871. |
| **Causal chain — step-by-step** | (1) User signs in with `use_gps_location=true` (default). (2) User opens preferences sheet at GPS coord A. (3) `useUserLocation` resolves to A via `enhancedLocationService.getCurrentLocation()`, caches with 5-min staleTime. (4) User taps Apply. Solo branch at PreferencesSheet.tsx:905-909 calls `onSave(preferences)` — preferences object contains no fresh GPS coords. (5) Deck refetches, reads `useUserLocation` → cache HIT for A → deck anchored to A. (6) User drives 5 km in 3 minutes to coord B. (7) User opens preferences sheet, taps Apply (no preference changes, just wants fresh deck). (8) Solo branch repeats step 4 — no GPS resolve, no cache invalidation. (9) `handleSavePreferences` (AppHandlers.tsx:419) sets optimistic prefs cache, bumps `preferencesRefreshKey`. (10) Deck refetches. (11) `useUserLocation` query key unchanged (custom-* fields still null, useGpsFlag still true), staleTime (5 min) not expired → CACHE HIT for A. (12) Deck fires `discover-cards` with A coords. (13) User sees deck still anchored to point A, 5 km from their current position. |
| **Verification step** | (a) Source proof: read the 4 cited file:line spans verbatim — comment at useUserLocation.ts:145-150 explicitly documents the no-refresh-key contract; the collab branch is the live reference for what solo should do. (b) Deterministic math: the React Query staleTime is 5*60*1000 ms = 300000 ms; if the user re-applies preferences within 300000 ms of the prior resolve, the query returns cached data. (c) Sim repro (deferred to TEST phase per §4): Xcode → Simulate Location → set to A → tap Apply → switch Simulate Location to B → re-tap Apply (no preference change) → verify deck still shows places near A, not B. Tester runs this at TEST phase. |

---

## §7 — Alternative root causes considered and ruled out

| Hypothesis | Verdict | Evidence |
|---|---|---|
| `enhancedLocationService` itself has a stale internal cache | RULED OUT | Reviewed lines 70-155. Service has `this.lastLocation` instance variable for fallback, NOT a "skip-resolve-if-recently-resolved" cache. Each `getCurrentLocation()` call hits `Location.getCurrentPositionAsync` (Expo's wrapper around the OS GPS layer) with a 10s timeout. No staleness at this layer. |
| The query key is missing a critical discriminator (e.g., `preferencesRefreshKey`) | RULED OUT BY DESIGN | The comment at useUserLocation.ts:145-150 explicitly forbids this — every preference change would fire a fresh GPS resolve (1-3s warm, up to 13s cold), blocking the deck fetch. The intended design is to keep the cache stable across normal preference changes but invalidate explicitly when location changes (city switch, custom-vs-GPS toggle). The bug is that "user tapped Apply with intent to refresh" isn't part of the cache's invalidation contract. |
| Custom-location users hit the same bug | RULED OUT | `staleTime: useGpsFlag ? 5 * 60 * 1000 : Infinity` — for custom-location users (`useGpsFlag=false`), staleTime is Infinity. Their location is the saved address, doesn't change. No bug here. |
| The deck consumer (useDeckCards) ignores location updates | RULED OUT | useDeckCards reads `location.lat` at line 210 directly from `useUserLocation`. If `useUserLocation` returns fresh coords, the deck refetch uses them. The deck consumer is correct; the upstream location source is what's stale. |
| Collab path has the same bug just less visibly | RULED OUT | Collab branch at PreferencesSheet.tsx:861-871 explicitly calls `enhancedLocationService.getCurrentLocation()` and writes the result into `board_session_preferences`. The server aggregates participants' coords from DB rows — fresh GPS at Apply is the only mechanism that could write fresh coords to those rows. Collab works correctly. |

---

## §8 — Blast radius

Four consumers of `useUserLocation` in `app-mobile/src/`:

| Consumer | File:line | What happens post-fix |
|---|---|---|
| `RecommendationsContext` (the central deck context) | `app-mobile/src/contexts/RecommendationsContext.tsx:469` | Reads fresh coords on solo Apply — deck anchored correctly. |
| `DiscoverScreen` (likely a display surface) | `app-mobile/src/components/DiscoverScreen.tsx:863` | Reads fresh coords — any distance display becomes accurate. |
| `PreferencesSheet` (the sheet itself, via the parent context) | `app-mobile/src/components/PreferencesSheet.tsx:855` (comment ref) | Indirect — the sheet reads cached prefs, doesn't display location directly. |
| `ViewFriendProfileScreen` (friend distance display) | `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx:133` | Reads fresh coords — friend-distance display becomes accurate. Side-effect of the fix; not regression. |

**Net:** the `setQueryData` write approach (operator-locked design) updates the shared `userLocation` cache for ALL consumers at once. Every consumer benefits. No regression risk because every consumer was reading the same potentially-stale cache anyway; the fix just makes the cache fresh at the Apply moment.

**Invariants touched:**
- `feedback_solo_collab_parity.md` — currently VIOLATED (solo missing snapshot; collab has it). Fix RESTORES parity.
- `I-LOCATION-INVALIDATE-ON-LOCATION-ONLY` (referenced in useUserLocation.ts:146 comment, ORCH-0485 + ORCH-0490 Phase 2.1) — the fix preserves this by NOT adding a refresh signal to the query key. Instead, it writes fresh coords via `setQueryData` at Apply time, which is the user's explicit intent moment.

---

## §9 — Recommended fix direction (handed to SPEC)

Operator-locked at intake 2026-05-21: **option (a) mirror collab path in solo.** Three concrete implementation moves:

1. **`PreferencesSheet.tsx` solo branch (around lines 905-909):** insert a parallel block to the collab GPS snapshot (lines 861-871). If `useGpsLocation=true`, call `enhancedLocationService.getCurrentLocation()` synchronously with the existing timeout + last-known fallback contract. Pass the fresh coords through the `preferences` object via new fields `freshGpsLat` / `freshGpsLng` (or extend an existing field).

2. **`AppHandlers.handleSavePreferences`:** receive the fresh coords from `preferences`. If present AND `useGpsLocation=true`, write them into the React Query `userLocation` cache via `queryClient.setQueryData(['userLocation', user.id, currentMode, null, null, null, true], { lat: freshGpsLat, lng: freshGpsLng })` BEFORE bumping `preferencesRefreshKey`. The deck refetch fires after the bump; by then the cache has the fresh value.

3. **No global staleTime change.** The 5-min staleTime stays for non-preference-driven consumers (the map screen, the home banner, the friend profile screen reads during browsing). The fix is targeted at the Apply intent moment.

**Why setQueryData over invalidateQueries:** `setQueryData` is synchronous — the fresh coord is in cache before the deck refetch fires. `invalidateQueries` marks stale → next read triggers refetch → 1-3s GPS resolve → race with the deck fetch. `setQueryData` avoids the race entirely.

**Why not just invalidate `useUserLocation` query in `handleSavePreferences`:** the dispatch's option (b) and the intake entry's option (b) both touched this. Reviewed and rejected because: (i) invalidating fires GPS resolve at the wrong time (deck refetch races it); (ii) the staleTime forbids adding refresh keys to the query key per the existing comment at useUserLocation.ts:145-150. The cleanest path is "resolve once at Apply, write to cache, let the deck read the now-fresh cache."

---

## §10 — Discoveries for orchestrator

| ID | Discovery | Severity | Recommended action |
|---|---|---|---|
| D-1 | `app-mobile/src/components/DiscoverScreen.tsx:863` consumes `useUserLocation(user?.id, "solo")` with a hardcoded `"solo"` mode argument. Doesn't affect ORCH-0904 fix, but if Mingla ever introduces non-solo modes for DiscoverScreen, the hardcoded "solo" becomes a latent bug. P3 cleanup. | 🟡 Hidden Flaw | Register cleanup ORCH if a future feature introduces multi-mode DiscoverScreen. |
| D-2 | `ViewFriendProfileScreen.tsx:133` reads `useUserLocation(currentUserId, currentMode as string)` with `currentMode` typed as `string` via cast. The cast is technically unsafe — if `currentMode` were null/undefined at this scope, the query key would be wrong. Currently safe per call-site analysis but the type-cast pattern is brittle. P4 observation. | 🔵 Observation | Informational. |
| D-3 | The `useUserLocation` staleTime + query-key design (don't refresh on every pref change) is deliberate per the comment at lines 145-150. ORCH-0904's fix preserves this design — it adds an explicit fresh-resolve at Apply intent, not a per-pref invalidation. Worth flagging that this design has a structural seam: there is no clean cache-bypass API on `useUserLocation` short of `setQueryData`. Future investigators should know the seam is intentional, not accidental. | 🔵 Observation | Informational — surfaces the seam for future fix attempts. |
| D-4 | The collab branch at PreferencesSheet.tsx:861-871 only resolves GPS when `collabLat == null` (i.e., when no custom coords are provided). It doesn't force-refresh GPS if the user already had fresh-ish coords. Edge case for an in-motion collab user who has cached GPS in their session_prefs from a prior Apply — they could see the same staleness bug for the duration of one Apply. P3 follow-up. | 🟡 Hidden Flaw | Could be addressed by extending ORCH-0904's solo fix to also force-refresh in collab if `useGpsLocation=true`, even when `collabLat != null`. Out of scope unless the operator widens. |

---

## §11 — Confidence per finding

| Finding | Confidence | Basis |
|---|---|---|
| Root cause: 5-min staleTime + missing solo GPS snapshot + cache-key-doesn't-discriminate-on-apply | **Probable (source-proven mechanism + sim repro deferred to TEST phase)** | Six-field evidence in §6 fully reads the deterministic code logic; operator-authorized confidence label per §4. |
| Quantified time-and-distance windows for the bug (§5 table) | **High** | Pure arithmetic on the staleTime constant + reasonable speed assumptions. |
| Collab works correctly | **High** | Direct source read of the snapshot block at PreferencesSheet.tsx:861-871. |
| Custom-location users unaffected | **High** | staleTime=Infinity when `useGpsFlag=false` (line 155). |
| Blast radius (4 consumers, all benefit from setQueryData) | **High** | Direct grep + per-consumer code read. |
| Recommended fix direction (mirror collab in solo + setQueryData) | **High** | Operator-locked at intake; matches collab's proven-correct pattern. |
| D-1, D-2, D-3, D-4 hidden flaws / observations | **Medium** | Identified during blast-radius pass; would need their own investigation for full proof. |

---

## §12 — Sim repro plan (for TEST phase)

Tester MUST run this at TEST phase per Prime Directive 7 + canonical tester parity rule. Investigator deferred per operator authorization (see §4).

**iOS Simulator + Android Emulator binding smoke (mandatory at TEST):**

1. Boot the consumer-app dev build per `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` (NOT `npx expo run:ios`).
2. Sign in with a test account that has `use_gps_location=true` in their profile.
3. Xcode → Debug → Simulate Location → Custom Location → set to `(6.5244, 3.3792)` (Lagos centre). Open preferences sheet. Tap Apply. Note the deck contents — should be Lagos-anchored.
4. Within 5 minutes, WITHOUT reloading the app, switch Simulate Location to `(6.6, 3.5)` (~30 km away).
5. Open preferences sheet again. Tap Apply (DO NOT change any preferences).
6. **Pre-fix (current behavior):** deck remains Lagos-anchored — NO re-anchoring. This is the bug.
7. **Post-fix (expected behavior):** deck re-anchors to the new location. Places shown reflect the new ~30 km offset.
8. Repeat on Android emulator with equivalent GPS-spoofing (Extended Controls → Location → set custom coords).

Capture screenshots in `Mingla_Artifacts/evidence/orch-0904/` if the bug is visible pre-fix and the re-anchoring is visible post-fix.

---

**End of investigation report.**
