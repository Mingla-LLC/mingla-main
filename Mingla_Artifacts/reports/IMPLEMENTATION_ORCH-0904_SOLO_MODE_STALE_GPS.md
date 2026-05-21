# IMPLEMENTATION REPORT — ORCH-0904

**Title:** Consumer solo-mode preferences-apply snapshots fresh GPS + `setQueryData(userLocation)` write before `preferencesRefreshKey` bump

**Implementor:** Claude `mingla-implementor` (parity mirror, operator-redirected), 2026-05-21
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**SPEC:** [`Mingla_Artifacts/specs/SPEC_ORCH-0904_SOLO_MODE_STALE_GPS.md`](../specs/SPEC_ORCH-0904_SOLO_MODE_STALE_GPS.md)
**Investigation:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0904_SOLO_MODE_STALE_GPS.md`](INVESTIGATION_ORCH-0904_SOLO_MODE_STALE_GPS.md)
**Status:** `implemented and verified` — all 8 happy-path regression tests GREEN, both `[FAILS-ON-REVERT KEY]` anchors verified.

---

## §1 — Cross-Surface Impact Inspection

| Surface | Affected | What changes for an end user | Files touched on surface | Parity |
|---|---|---|---|---|
| **Consumer iOS** (`app-mobile/` on iOS) | **YES** | Once EAS OTA ships: when a GPS-mode user taps Apply on the preferences sheet, the deck refetches with fresh GPS coordinates (resolved synchronously at the Apply moment) instead of cached coordinates up to 5 minutes old. Custom-location users unchanged. | `app-mobile/src/components/PreferencesSheet.tsx`, `app-mobile/src/components/AppHandlers.tsx` | Automatic (shared RN code) |
| **Consumer Android** (`app-mobile/` on Android) | **YES** | Same as iOS. | Same files. | Automatic. |
| Buyer-anon-web | NO | — | — | No consumer preferences sheet on anon checkout. |
| Business iOS / Android / web-preview | NO | — | — | No consumer preferences sheet in business app. |
| Admin Web | NO | — | — | No consumer-side admin tooling for preferences. |

---

## §2 — Old → New Receipts

### `app-mobile/src/components/PreferencesSheet.tsx`

**What it did before:** Solo branch of `handleApplyPreferences` (lines 905-909 pre-fix) called `onSave(preferences)` directly without resolving fresh GPS. The `preferences` object did not contain any fresh GPS coordinates — only `useGpsLocation` flag + `custom_lat/lng` (which are null in GPS mode).

**What it does now:** Solo branch resolves fresh GPS synchronously via `enhancedLocationService.getCurrentLocation()` when `useGpsLocation === true` AND `selectedCoords?.lat == null` (mirrors the collab branch guard at lines 861-871). Fresh coords are threaded into the `onSave` call as new `freshGpsLat` / `freshGpsLng` fields. GPS resolve failure is caught silently — `onSave` still fires.

**Why:** Per SPEC §2 File 1 Change 1A + SC-01 + SC-02. Restores solo/collab parity per `feedback_solo_collab_parity.md`.

**Lines changed:** ~25 (insertion of new GPS-snapshot block + modification of `onSave` call to thread fresh fields).

### `app-mobile/src/components/AppHandlers.tsx`

**What it did before:** `handleSavePreferences` (line 419-548) set optimistic prefs cache + bumped `preferencesRefreshKey` to trigger deck refetch. Did not touch the `userLocation` React Query cache; deck refetch read whatever `useUserLocation` had cached (5-minute stale).

**What it does now:** When `preferences.useGpsLocation === true` AND `freshGpsLat`/`freshGpsLng` are typeof `'number'`, writes `{ lat, lng }` to `queryClient.setQueryData(['userLocation', user.id, 'solo', null, null, null, true], ...)` BEFORE the `preferencesRefreshKey` bump. Deck refetch (triggered by the bump) reads the just-written fresh coords from cache.

**Why:** Per SPEC §2 File 2 Change 2A + SC-03 + SC-04 + SC-05. `setQueryData` chosen over `invalidateQueries` for race-free synchronous semantics (SPEC §9 design rationale).

**Lines changed:** ~17 (insertion of new conditional block + ORCH-0904 protective comment).

### NEW FILE: `app-mobile/scripts/ci/orch-0904-regression-check.mjs`

**What it did before:** Did not exist.

**What it does now:** 8 happy-path structural regression tests covering SCs from SPEC §3. T-01..T-08 per SPEC §5.1 with `[FAILS-ON-REVERT KEY]` anchors at T-01 (solo GPS-snapshot block) and T-03 (setQueryData ordering before refresh-key bump). Run via `node scripts/ci/orch-0904-regression-check.mjs` (exit 0 = PASS; exit 1 = FAIL).

**Why:** ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5 gate. Adapts the `.mjs` structural-check pattern from `orch-0901-regression-check.mjs` precedent (jest unavailable in app-mobile).

**Lines:** ~210 (new file).

### `app-mobile/package.json`

**What it did before:** Did not have a `test:orch-0904` script entry.

**What it does now:** Added `"test:orch-0904": "node ./scripts/ci/orch-0904-regression-check.mjs"` entry to `scripts` object (placed after `test:orch-0898-adv` mirroring the existing per-ORCH script pattern).

**Lines changed:** +1.

---

## §3 — Spec Traceability (SC mapping)

| SC | Spec requirement | How implemented | Verified by |
|---|---|---|---|
| SC-01 | Solo branch resolves fresh GPS when GPS-mode + no custom coords | PreferencesSheet.tsx solo branch with `useGpsLocation && selectedCoords?.lat == null` guard + `await enhancedLocationService.getCurrentLocation()` call | T-01 GREEN |
| SC-02 | Solo branch threads `freshGpsLat`/`freshGpsLng` into onSave | PreferencesSheet.tsx solo branch `onSave({ ...preferences, freshGpsLat, freshGpsLng })` | T-01 GREEN |
| SC-03 | AppHandlers writes setQueryData with correct key tuple BEFORE refresh-key bump | AppHandlers.tsx conditional block immediately before the existing `setPreferencesRefreshKey` block | T-02 + T-03 GREEN (T-03 verifies ordering) |
| SC-04 | Custom-location users (`useGpsLocation=false`) skipped | Strict `=== true` guard on `preferences.useGpsLocation` | T-08 GREEN |
| SC-05 | Zero-coord edge case (equator/prime meridian) triggers cache write | `typeof X === 'number'` type guards (not truthy) | T-07 GREEN |
| SC-06 | GPS resolve failure does not block save | `try { ... } catch {}` block in solo branch; onSave still fires with null fresh coords | Source-inspected; T-01's revert verified the GPS-resolve guard is part of the block structure |
| SC-07 | Collab branch byte-identical pre-fix and post-fix | Collab branch at lines 861-871 untouched (no diff in that region) | T-06 GREEN |
| SC-08 | No global staleTime change on useUserLocation | `useUserLocation.ts:155` untouched | T-04 GREEN |
| SC-09 | No query-key discriminator added to useUserLocation | `useUserLocation.ts:152` untouched | T-05 GREEN |
| SC-10 | Deck refetch reads fresh coords post-Apply (live-fire) | Deferred to TEST phase — tester runs the 8-step Simulate-Location switch per SPEC §5.4 | Tester smoke at TEST phase |
| SC-11 | Solo + collab parity restored | Solo now mirrors collab's GPS-snapshot pattern | T-01 + T-06 together verify parity |

10 of 11 SCs verified at implementor phase via structural regression tests + code inspection. SC-10 deferred to tester phase per Prime Directive 7 parity rule.

---

## §4 — Invariant Verification

| Invariant | Preserved? | Evidence |
|---|---|---|
| `feedback_solo_collab_parity.md` | YES — RESTORED | Solo now mirrors collab's GPS-snapshot pattern; both branches resolve fresh GPS when in GPS mode. T-01 + T-06 verify both branches have the required pattern. |
| I-LOCATION-INVALIDATE-ON-LOCATION-ONLY (ORCH-0485 + ORCH-0490 Phase 2.1) | YES | `useUserLocation.ts:152` query key + `:155` staleTime untouched. Fix writes fresh coords via `setQueryData` at user's explicit Apply intent moment, NOT by adding a refresh signal to the query key. T-04 + T-05 verify. |
| Constitution #2 (One owner per truth) | YES | `useUserLocation` remains the single source of truth for location reads. Fix populates that source synchronously at Apply; does NOT create a parallel location store. |
| Constitution #3 (No silent failures) | YES | GPS resolve failure caught silently AT THE SOLO-BRANCH LAYER (matches collab's silent catch); falls through to existing 13s timeout + last-known fallback chain in `useUserLocation`. Documented graceful degradation, not silent failure. |
| Constitution #8 (Subtract before adding) | YES | Existing 5-min staleTime stays for non-Apply consumers; fix adds explicit Apply-time cache writes without removing or weakening working code. |

Zero violations. One invariant (`feedback_solo_collab_parity.md`) was VIOLATED pre-fix and is now RESTORED.

---

## §5 — Parity Check

- **Solo + collab:** post-fix, solo branch mirrors collab branch's GPS-snapshot pattern. Both resolve fresh GPS via `enhancedLocationService.getCurrentLocation()` when GPS mode is on AND no custom coords are set. Solo writes fresh coords to React Query cache via `setQueryData`; collab writes to DB via `updateBoardPreferences` (different downstream because collab needs server-side aggregation). Both achieve the same user-facing outcome: deck anchored to current location.
- **iOS + Android:** automatic (shared RN code path in PreferencesSheet + AppHandlers). No platform-specific files.
- **Custom-location preservation:** verified by T-08 strict-equality guard on `preferences.useGpsLocation === true`. Custom-location users (`useGpsLocation=false`) never trigger the setQueryData write.

---

## §6 — Cache Safety

- **Query key match:** `setQueryData` tuple `['userLocation', user.id, 'solo', null, null, null, true]` matches `useUserLocation.ts:152` exactly for solo + GPS-mode users (`customLat=null, customLng=null, customLocation=null, useGpsFlag=true`). T-05 verifies useUserLocation.ts:152 unchanged in lockstep.
- **No new query keys.** No new React Query factory keys introduced.
- **Persisted AsyncStorage:** unchanged. `useUserLocation`'s existing `useEffect` at lines 167-174 persists resolved coords to `@mingla/lastLocation` — fix benefits from this for free (next cold start reads fresh coords).

---

## §7 — Regression Surface

The 4 adjacent features most likely to be touched by the cache write — tester should check post-fix:

1. **Deck cold-load behavior** — fresh `setQueryData` write should not cause unintended deck re-renders mid-typing.
2. **Friend profile distance display** — `ViewFriendProfileScreen.tsx:133` consumes `useUserLocation`. If user is viewing a friend profile when they tap Apply on preferences (unlikely flow but possible), the friend-distance display picks up the fresh coords. Side-effect, not regression.
3. **Map screen distance/region** — if a map screen reads `useUserLocation`, it picks up fresh coords. Inspected via grep — no map screen consumer found.
4. **Custom-location users** — must NOT see GPS coords overwriting their saved address. SC-04 + T-08 strict-equality guard verified.

---

## §8 — Regression Test (per ORCH-0840 Step 0.5)

**Test file:** `app-mobile/scripts/ci/orch-0904-regression-check.mjs` (NEW)

**Run command:** `cd app-mobile && node scripts/ci/orch-0904-regression-check.mjs`

**Final run output (post-fix):**

```
PASS T-01 [FAILS-ON-REVERT KEY] PreferencesSheet solo branch: GPS resolve + freshGpsLat/Lng threaded into onSave
PASS T-02 AppHandlers setQueryData with [userLocation, user.id, solo, null, null, null, true] + {lat,lng} value
PASS T-03 [FAILS-ON-REVERT KEY] AppHandlers setQueryData(userLocation) call appears BEFORE setPreferencesRefreshKey bump
PASS T-04 useUserLocation.ts staleTime line preserved (no global staleTime change per SC-08)
PASS T-05 useUserLocation.ts query key preserved (no key discriminator added per SC-09)
PASS T-06 PreferencesSheet collab branch GPS-snapshot block preserved (parity reference per SC-07)
PASS T-07 AppHandlers type guards use `typeof === "number"` (zero-coord edge case per SC-05)
PASS T-08 AppHandlers gates setQueryData on `preferences.useGpsLocation === true` strict equality (per SC-04)

PASS — ORCH-0904 happy-path regression check: 8/8 GREEN.
exit=0
```

### Fails-on-revert verification at HEAD = `9d20c643` ("PR #152 cycle 2 gate fixes (ORCH-0902/0903 bundled into Seth)")

**T-01 [FAILS-ON-REVERT KEY]:**

- **Revert:** removed the entire ORCH-0904 solo GPS-snapshot block from `PreferencesSheet.tsx` solo branch (deleted ~25 lines + restored the original 3-line `if (onSave) { await Promise.resolve(onSave(preferences)); }` block).
- **Test output (post-revert):**
  ```
  FAIL T-01 [FAILS-ON-REVERT KEY] PreferencesSheet solo branch: GPS resolve + freshGpsLat/Lng threaded into onSave
       ↳ Expected solo branch with `let soloFreshGpsLat`/`Lng` decls, `soloFreshGpsLat = gps.latitude` + `soloFreshGpsLng = gps.longitude` assignments, AND `freshGpsLat: soloFreshGpsLat,` + `freshGpsLng: soloFreshGpsLng,` fields threaded into onSave — all within the same handleApplyPreferences solo branch (<2000 chars). Missing the ORCH-0904 snapshot mirror of collab's lines 861-871.
  ...
  FAIL — ORCH-0904 happy-path regression check: 7/8 GREEN, 1 RED.
  ```
- **Restore:** put the ORCH-0904 solo GPS-snapshot block back.
- **Test output (post-restore):** 8/8 GREEN (verified above).
- **Verdict:** T-01 [FAILS-ON-REVERT KEY] confirmed exercises the bug — deletion of the solo GPS-snapshot block makes T-01 RED; restoration → GREEN.

**T-03 [FAILS-ON-REVERT KEY]:**

- **Revert:** moved the `setQueryData` block in `AppHandlers.tsx` to AFTER the `setPreferencesRefreshKey` call (race-prone ordering).
- **Test output (post-revert):**
  ```
  PASS T-02 AppHandlers setQueryData with [userLocation, user.id, solo, null, null, null, true] + {lat,lng} value
  FAIL T-03 [FAILS-ON-REVERT KEY] AppHandlers setQueryData(userLocation) call appears BEFORE setPreferencesRefreshKey bump
       ↳ setQueryData idx=18690, refresh-key bump idx=18341. Race-free semantics require setQueryData FIRST so the deck refetch (triggered by refresh-key bump) reads the just-written fresh coords.
  ...
  FAIL — ORCH-0904 happy-path regression check: 7/8 GREEN, 1 RED.
  ```
- **Restore:** moved the `setQueryData` block back BEFORE the `setPreferencesRefreshKey` call.
- **Test output (post-restore):** 8/8 GREEN.
- **Verdict:** T-03 [FAILS-ON-REVERT KEY] confirmed exercises the bug — race-prone ordering makes T-03 RED; correct ordering → GREEN.

### TypeScript check

Per-file `tsc` invocation fails due to missing JSX/esModuleInterop flags (config inheritance issue when individual paths are passed). Full project `tsc --noEmit` shows zero errors in the modified files (`PreferencesSheet.tsx`, `AppHandlers.tsx`). Pre-existing errors in `packages/phone-input/*.tsx` are unrelated to ORCH-0904 — they predate this implementation and were not introduced by the change.

**ORCH-0904 TypeScript verdict:** zero new type errors introduced; the 2 modified files compile cleanly under the project's tsconfig.

---

## §9 — Constitutional Compliance

| Principle | Status | Evidence |
|---|---|---|
| #2 One owner per truth | **PASS** | `useUserLocation` remains the single location source. |
| #3 No silent failures | **PASS** | GPS-resolve failure caught with documented graceful degradation; falls through to existing fallback chain. |
| #5 Server state server-side | **PASS** | `setQueryData` updates React Query cache (server-derived state staying in the server-state layer); no Zustand involved. |
| #8 Subtract before adding | **PASS** | No mechanism removed; the existing staleTime + query key behavior preserved exactly. Additive change. |
| Others (#1, #4, #6, #7, #9-14) | **N/A** | Not touched. |

Zero violations. Constitution #2 + #3 + #5 + #8 actively verified.

---

## §10 — Transition Items

None.

---

## §11 — Discoveries for Orchestrator

Carried forward from investigation report §10 (no new discoveries surfaced during implementation):

| ID | Discovery | Severity | Recommended action |
|---|---|---|---|
| D-1 | `app-mobile/src/components/DiscoverScreen.tsx:863` consumes `useUserLocation(user?.id, "solo")` with a hardcoded `"solo"` mode argument. Latent — doesn't affect ORCH-0904 fix but would bite if multi-mode DiscoverScreen ever ships. | 🟡 Hidden Flaw | P3 cleanup. Register if multi-mode ever appears. |
| D-2 | `ViewFriendProfileScreen.tsx:133` reads `useUserLocation(currentUserId, currentMode as string)` with an unsafe cast. Brittle type pattern. | 🔵 Observation | Informational. |
| D-3 | The `useUserLocation` staleTime + query-key design has a structural seam where the only way to bypass the cache cleanly is `setQueryData`. ORCH-0904's fix uses exactly this seam — preserves the design but documents the workaround. Future investigators should know this is intentional. | 🔵 Observation | Informational — surfaces the seam for future fix attempts. |
| D-4 | The collab branch at PreferencesSheet.tsx:861-871 only resolves GPS when `collabLat == null`. Edge case for an in-motion collab user with cached `selectedCoords` from a prior Apply — they could see staleness similar to ORCH-0904's bug for the duration of one Apply. P3 follow-up. | 🟡 Hidden Flaw | Could be addressed in a future widening of ORCH-0904 OR a separate ORCH. Out of scope here. |

---

## §12 — Commit + Deploy Plan

**Files staged (5):**
1. `app-mobile/src/components/PreferencesSheet.tsx` (modified — solo GPS-snapshot block added)
2. `app-mobile/src/components/AppHandlers.tsx` (modified — setQueryData write added)
3. `app-mobile/scripts/ci/orch-0904-regression-check.mjs` (NEW)
4. `app-mobile/package.json` (+1 script entry)
5. `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0904_SOLO_MODE_STALE_GPS.md` (this file)

**Files NOT to stage:** any other dirty files in the worktree (none expected — pre-flight tree was clean).

**Proposed commit message:**

```
ORCH-0904: solo-mode preferences-apply snapshots fresh GPS + setQueryData(userLocation) before refresh-key bump

Mirrors the collab branch's existing GPS-snapshot pattern (PreferencesSheet.tsx:861-871)
into the solo branch. When useGpsLocation=true AND no custom coords are set, solo's
handleApplyPreferences synchronously resolves GPS via enhancedLocationService.getCurrentLocation()
(13s timeout + last-known fallback). Fresh coords are threaded through preferences.onSave
as new freshGpsLat / freshGpsLng fields. AppHandlers.handleSavePreferences writes them
to the userLocation React Query cache via setQueryData with the exact key tuple matching
useUserLocation.ts:152, BEFORE the setPreferencesRefreshKey bump triggers the deck refetch.

Closes the 5-min stale-GPS bug class for solo + GPS-mode users (driving scenario from
operator question 2026-05-21). Custom-location users unchanged (useGpsLocation=false guard).
Collab branch byte-identical (already correct).

Test gate (ORCH-0840 Step 0.5): app-mobile/scripts/ci/orch-0904-regression-check.mjs
8/8 GREEN. Fails-on-revert verified at HEAD 9d20c643 for both [FAILS-ON-REVERT KEY]
anchors T-01 (solo GPS-snapshot block) + T-03 (setQueryData ordering before refresh-key).

EAS OTA eligible. No edge function deploy. No migration.
```

**EAS OTA command (Seth-direct post-tester-PASS):**

```bash
cd app-mobile && eas update --branch production --platform ios,android --message "ORCH-0904: solo-mode deck uses fresh GPS at preferences apply"
```

No edge function deploy. No `supabase db push` (no migration).

---

**End of implementation report.**
