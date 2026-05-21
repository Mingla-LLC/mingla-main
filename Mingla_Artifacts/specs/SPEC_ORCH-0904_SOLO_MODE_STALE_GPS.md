# SPEC — ORCH-0904

**Title:** Consumer solo-mode deck uses stale GPS — mirror collab's GPS snapshot pattern into solo's `handleApplyPreferences` + write fresh coords to `useUserLocation` React Query cache via `setQueryData` before `preferencesRefreshKey` bump

**Author:** Claude `mingla-forensics` (SPEC mode), 2026-05-21
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0904_SOLO_MODE_STALE_GPS.md`](../reports/INVESTIGATION_ORCH-0904_SOLO_MODE_STALE_GPS.md) (`probable` confidence, source-proven mechanism, sim deferred to TEST per operator authorization 2026-05-21)
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_SPEC_ORCH-0904_SOLO_MODE_STALE_GPS.md`
**Status:** binding contract for implementor + tester; design operator-locked at intake 2026-05-21

The design is operator-locked at intake. The SPEC does NOT re-decide the option. SPEC locks the exact implementation contract.

---

## §0 — Cross-Surface Impact Declaration

| Surface | In scope | User-visible behavior demanded | Files touched on surface | Parity |
|---|---|---|---|---|
| **Consumer iOS** (`app-mobile/` on iOS) | YES | When user taps Apply on the preferences sheet in solo mode AND `use_gps_location=true`, the deck refetches with FRESH GPS coordinates (resolved synchronously at the Apply moment, not the cached value from up to 5 minutes ago). Custom-location users unchanged. | `app-mobile/src/components/PreferencesSheet.tsx`, `app-mobile/src/components/AppHandlers.tsx` | Automatic (shared RN code) |
| **Consumer Android** (`app-mobile/` on Android) | YES | Same as iOS. | Same files. | Automatic. |
| Buyer/anonymous Web | NO | — | — | No preferences sheet on anon checkout. |
| Business iOS / Android / web-preview | NO | — | — | No consumer preferences sheet in the business app. |
| Admin Web | NO | — | — | No consumer-side admin tooling for preferences. |

Parity model: **automatic** across iOS + Android. One mobile code path. The fix lives entirely in the RN layer that ships to both platforms simultaneously.

Tester MUST still run iOS Simulator + Android Emulator live-fire at TEST phase per parity-enforcement rule + Prime Directive 7. The dispatch's §5 + investigation §12 give the binding smoke baseline.

---

## §1 — Scope and non-goals

### In scope (exact change set)

1. **`PreferencesSheet.tsx` `handleApplyPreferences` solo branch (around lines 905-909):** insert a parallel GPS-snapshot block that mirrors the collab branch's existing pattern at lines 861-871. If `useGpsLocation=true` AND `selectedCoords` is null (custom coords NOT set), resolve GPS via `enhancedLocationService.getCurrentLocation()` synchronously with the existing timeout + last-known fallback. On success, pass the fresh coords into the `preferences` object via new fields `freshGpsLat` / `freshGpsLng`.
2. **`AppHandlers.handleSavePreferences`:** receive `preferences.freshGpsLat` / `freshGpsLng`. If both are present AND `preferences.useGpsLocation === true`, write them into the React Query `userLocation` cache via `queryClient.setQueryData(['userLocation', user.id, currentMode, null, null, null, true], { lat: freshGpsLat, lng: freshGpsLng })` BEFORE the `setPreferencesRefreshKey` bump (currently around line 502).
3. **Implementor regression test** at `app-mobile/scripts/ci/orch-0904-regression-check.mjs` (Node `.mjs` pattern per ORCH-0901 [getConversations 4N refactor] precedent) — structural grep tests asserting the snapshot block is present in PreferencesSheet solo branch + the `setQueryData` call is present in AppHandlers with the correct query key shape.

### Non-goals (explicitly out of scope)

- **No global staleTime change on `useUserLocation`.** The 5-min staleTime stays for non-Apply consumers (RecommendationsContext browsing, DiscoverScreen, ViewFriendProfileScreen distance display). The fix is targeted at the Apply intent moment.
- **No new `useUserLocation` query-key discriminator.** Comment at `useUserLocation.ts:145-150` explicitly forbids adding a refresh-key. Preserved.
- **No background-location watcher.** Apple/Google review-risk + battery + privacy. Out of scope.
- **No new RN permission scope.** `expo-location` foreground permission already granted; the synchronous `getCurrentLocation()` call uses existing permission state.
- **No `app-mobile/src/utils/travelTime.ts` change.** Out of scope (sister ORCH-0903 [How far filter and displayed travel time disagree] left this alone too).
- **No custom-location-path change.** `use_gps_location=false` users keep their saved address; no fresh GPS is injected over a saved address.
- **No edge function change.** The fix is 100% client-side.
- **No SQL migration.** No schema change.
- **No collab-side change.** Collab already does this correctly at lines 861-871 — preserved.
- **No fix for the D-4 collab-side edge case** (force-refresh GPS in collab when `collabLat != null` — out of scope unless operator widens).
- **No EAS native build.** Pure JS swap.

### Assumptions (locked, not re-verified during implementation)

- `enhancedLocationService.getCurrentLocation()` has the 10s GPS timeout + 3s last-known fallback contract documented at `enhancedLocationService.ts:70-135` (verified by investigation §6). The implementor relies on this contract — the call returns within ~13s worst case OR `null`.
- React Query `setQueryData` with the exact key tuple `['userLocation', user.id, currentMode, null, null, null, true]` correctly writes to the cache that `useUserLocation` reads from on next subscriber render (verified by investigation §3 + line 151-155 of useUserLocation.ts).
- `preferencesRefreshKey` bump triggers a deck refetch that reads `useUserLocation` synchronously (verified by investigation chain in §6 step 9-13).
- The 4 `useUserLocation` consumers in §10 below all benefit from the fresh cache write; none rely on the 5-min staleTime for correctness (only for performance optimization).

---

## §2 — Exact code changes (file-by-file)

### File 1 of 2: `app-mobile/src/components/PreferencesSheet.tsx`

**Change 1A — Insert solo GPS snapshot block in `handleApplyPreferences`.**

Current code (lines 901-909 of pre-fix file):

```ts
          await updateBoardPreferences(dbPrefs);
          // ORCH-0446: Collab save succeeded — close sheet now
          if (isCollaborationMode) {
            onClose?.();
          }
        } else {
          if (onSave) {
            await Promise.resolve(onSave(preferences));
          }
```

Required state (insert solo GPS-snapshot block + thread fresh coords into the `onSave` call):

```ts
          await updateBoardPreferences(dbPrefs);
          // ORCH-0446: Collab save succeeded — close sheet now
          if (isCollaborationMode) {
            onClose?.();
          }
        } else {
          // ORCH-0904 (2026-05-21): solo-mode GPS snapshot at Apply — mirrors the
          // collab branch's pattern at lines 861-871. Without this, the deck refetch
          // reads useUserLocation's 5-min-stale React Query cache and anchors to
          // pre-move coordinates while user is mobile (e.g. driving). See
          // Mingla_Artifacts/reports/INVESTIGATION_ORCH-0904_SOLO_MODE_STALE_GPS.md.
          let soloFreshGpsLat: number | null = null;
          let soloFreshGpsLng: number | null = null;
          if (useGpsLocation && selectedCoords?.lat == null) {
            try {
              const gps = await enhancedLocationService.getCurrentLocation();
              if (gps) {
                soloFreshGpsLat = gps.latitude;
                soloFreshGpsLng = gps.longitude;
              }
            } catch {
              // GPS failed — proceed without fresh coords. `useUserLocation` will
              // fall through to its existing 13s timeout + last-known fallback chain.
            }
          }
          if (onSave) {
            await Promise.resolve(
              onSave({
                ...preferences,
                freshGpsLat: soloFreshGpsLat,
                freshGpsLng: soloFreshGpsLng,
              }),
            );
          }
```

Notes for the implementor:
- The condition `useGpsLocation && selectedCoords?.lat == null` mirrors the collab branch's `useGpsLocation && collabLat == null` guard. Both: only resolve fresh GPS when in GPS mode AND no custom coords are provided.
- The try/catch + silent fallback mirrors the collab branch's `catch {}`. Failure path: pass `null`/`null` through; `useUserLocation`'s fallback chain still applies downstream.
- The fresh coords are added as NEW fields `freshGpsLat` / `freshGpsLng` on the `preferences` object passed to `onSave`. Do NOT mutate `preferences.custom_lat` / `custom_lng` — those are CUSTOM-LOCATION coordinates with different semantic meaning.
- No change to the collab branch (lines 850-904). The collab branch already does this correctly.

### File 2 of 2: `app-mobile/src/components/AppHandlers.tsx`

**Change 2A — Receive fresh GPS coords in `handleSavePreferences` and write to `userLocation` cache before `preferencesRefreshKey` bump.**

Current code (lines 495-503 of pre-fix file):

```ts
      // Deck history reset
      const newHashStr = computePrefsHash(dbPreferences);
      const { deckPrefsHash, resetDeckHistory } = useAppStore.getState();
      if (newHashStr !== deckPrefsHash) {
        resetDeckHistory(newHashStr);
      }

      // Preferences refresh key
      if (setPreferencesRefreshKey) {
        setPreferencesRefreshKey((prev: number) => prev + 1);
      }
```

Required state (insert ORCH-0904 cache write between the deck history reset and the preferencesRefreshKey bump):

```ts
      // Deck history reset
      const newHashStr = computePrefsHash(dbPreferences);
      const { deckPrefsHash, resetDeckHistory } = useAppStore.getState();
      if (newHashStr !== deckPrefsHash) {
        resetDeckHistory(newHashStr);
      }

      // ORCH-0904 (2026-05-21): if the solo Apply path snapshotted fresh GPS coords
      // (via PreferencesSheet.handleApplyPreferences mirror of collab's lines 861-871),
      // write them into the userLocation React Query cache BEFORE bumping the refresh
      // key. The deck refetch fires after the bump and reads useUserLocation; without
      // this synchronous cache write, the 5-min staleTime serves cached pre-Apply
      // coordinates, anchoring the deck to where the user WAS. setQueryData is
      // synchronous; race-free vs invalidateQueries. See
      // Mingla_Artifacts/reports/INVESTIGATION_ORCH-0904_SOLO_MODE_STALE_GPS.md §9.
      if (
        preferences.useGpsLocation === true &&
        typeof preferences.freshGpsLat === 'number' &&
        typeof preferences.freshGpsLng === 'number'
      ) {
        queryClient.setQueryData(
          ['userLocation', user.id, 'solo', null, null, null, true],
          { lat: preferences.freshGpsLat, lng: preferences.freshGpsLng },
        );
      }

      // Preferences refresh key
      if (setPreferencesRefreshKey) {
        setPreferencesRefreshKey((prev: number) => prev + 1);
      }
```

Notes for the implementor:
- The query key tuple `['userLocation', user.id, 'solo', null, null, null, true]` MUST match the exact tuple `useUserLocation` builds on line 152 of `useUserLocation.ts`. In solo + GPS mode, `customLat`, `customLng`, `customLocation` are all null and `useGpsFlag` is true; the `currentMode` argument is the literal string `'solo'`. If `useUserLocation`'s key construction logic changes in a future ORCH, this `setQueryData` call's key MUST be updated in lockstep — call this out in a `// [TRANSITIONAL]` comment if the key construction becomes shared with another hook.
- Use the existing `queryClient` import already at top of `AppHandlers.tsx` (from `@tanstack/react-query`).
- Type guards on `freshGpsLat` / `freshGpsLng` are `typeof X === 'number'` (not truthy check) because a valid latitude can be `0` (equator) which is falsy. Same for longitude (prime meridian).
- Conditional gating on `preferences.useGpsLocation === true` is defense-in-depth: should never receive non-null fresh coords with `useGpsLocation === false`, but if a future refactor passes them through unexpectedly, this guard prevents overwriting a custom-location cache.

---

## §3 — Success criteria

Numbered, observable, testable. Tester validates each at TEST phase.

- **SC-01 (mechanism):** `PreferencesSheet.tsx` `handleApplyPreferences` solo branch resolves fresh GPS via `enhancedLocationService.getCurrentLocation()` when `useGpsLocation=true` AND `selectedCoords?.lat == null`. Pattern mirrors collab branch at lines 861-871.
- **SC-02 (data threading):** Solo branch passes `freshGpsLat` / `freshGpsLng` as new fields on the `preferences` object to the `onSave` callback. Custom-location users (`useGpsLocation=false`) get `null` / `null` for both fields.
- **SC-03 (cache write):** `AppHandlers.handleSavePreferences` writes `{ lat: freshGpsLat, lng: freshGpsLng }` to `queryClient.setQueryData` with key `['userLocation', user.id, 'solo', null, null, null, true]` BEFORE bumping `setPreferencesRefreshKey`.
- **SC-04 (custom-location preservation):** When `preferences.useGpsLocation === false`, the `setQueryData` write is SKIPPED. Custom-location cache key (different from the GPS-mode key) is unaffected.
- **SC-05 (zero-coord edge case):** `freshGpsLat === 0` or `freshGpsLng === 0` (equator / prime meridian users) still trigger the cache write because the type guard is `typeof X === 'number'`, not a truthy check.
- **SC-06 (failure resilience):** If `enhancedLocationService.getCurrentLocation()` throws or returns null, solo branch sets `soloFreshGpsLat = null` / `soloFreshGpsLng = null` and PROCEEDS with the `onSave` call. No exception bubbles up. The downstream `setQueryData` is skipped (type guards fail). `useUserLocation` retains its existing 13s-timeout + last-known fallback chain.
- **SC-07 (collab unchanged):** Collab branch at PreferencesSheet.tsx:861-871 is byte-identical pre-fix and post-fix. Verified by `git diff` showing zero changes in that range.
- **SC-08 (no global staleTime change):** `useUserLocation.ts:155` remains `staleTime: useGpsFlag ? 5 * 60 * 1000 : Infinity`. Verified by `git diff` showing zero changes in `useUserLocation.ts`.
- **SC-09 (no query key change):** `useUserLocation.ts:152` query key remains `['userLocation', userId, currentMode, customLat, customLng, customLocation, useGpsFlag]`. No new discriminator added.
- **SC-10 (deck refetch reads fresh):** After solo Apply with fresh GPS resolve + `setQueryData` write, the subsequent deck refetch (triggered by `preferencesRefreshKey` bump) reads `useUserLocation` and receives the just-written fresh coords. Verified at TEST phase via Xcode Simulate Location switch within the 5-min window.
- **SC-11 (solo + collab parity restored):** A driving user applying solo preferences and a driving user applying collab preferences see equivalent deck behavior — both anchored to the current location, not 5-min-stale cache. `feedback_solo_collab_parity.md` invariant satisfied.

---

## §4 — Invariants

### Preserve

- **`feedback_solo_collab_parity.md`** — the fix RESTORES parity. Solo now behaves identically to collab on the GPS-snapshot front.
- **`I-LOCATION-INVALIDATE-ON-LOCATION-ONLY`** (referenced at `useUserLocation.ts:146`, ORCH-0485 [Eager server-draft] + ORCH-0490 Phase 2.1) — preserved by NOT adding a refresh signal to the query key. The fix writes fresh coords via `setQueryData` at the user's explicit Apply intent moment, not by invalidating every preference change.
- **Constitution #2 (One owner per truth):** `useUserLocation` remains the single source of truth for location reads. The fix populates that source with fresh data at Apply; it does NOT create a parallel location store.
- **Constitution #3 (No silent failures):** GPS resolve failure path catches the error silently AT THE SOLO-BRANCH LAYER (matching collab's silent catch), then degrades to the existing 13s timeout + last-known fallback chain in `useUserLocation`. The user's Apply tap still succeeds; the deck just uses the staler value. Not a silent failure — a documented graceful degradation.
- **Constitution #8 (Subtract before adding):** No layering. The existing 5-min staleTime stays for non-Apply consumers; the fix adds explicit Apply-time cache writes without removing any working code.

### Establish (none)

This SPEC does not introduce a new invariant. The fix restores existing-but-violated parity.

---

## §5 — Test cases

ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5 gate requires BOTH:

### §5.1 — Implementor happy-path test

**Path:** `app-mobile/scripts/ci/orch-0904-regression-check.mjs` (Node `.mjs` structural-check pattern per ORCH-0901 precedent — verified existing pattern in `app-mobile/scripts/ci/orch-0901-regression-check.mjs`).

**Test framework:** plain Node `.mjs` script that reads source files via `fs.readFileSync` and asserts grep-style structural patterns. Run via `node app-mobile/scripts/ci/orch-0904-regression-check.mjs`. Exit 0 = PASS; exit 1 = FAIL with descriptive console.error.

**Required test cases:**

| ID | Scenario | Source location checked | Assertion | Layer |
|---|---|---|---|---|
| **T-01** [FAILS-ON-REVERT KEY] | SC-01 + SC-02 — solo branch resolves fresh GPS + threads `freshGpsLat` / `freshGpsLng` into onSave | `PreferencesSheet.tsx` lines ~905-940 (post-fix) | Source contains BOTH the literal `await enhancedLocationService.getCurrentLocation()` AND `freshGpsLat: soloFreshGpsLat,` AND `freshGpsLng: soloFreshGpsLng,` within the same handleApplyPreferences solo branch | Structural |
| **T-02** | SC-03 — `setQueryData` write with correct key tuple | `AppHandlers.tsx` around `handleSavePreferences` body | Source contains the literal sequence `queryClient.setQueryData(\n          ['userLocation', user.id, 'solo', null, null, null, true]` (allowing whitespace variance) followed within 5 lines by `{ lat: preferences.freshGpsLat, lng: preferences.freshGpsLng }` | Structural |
| **T-03** [FAILS-ON-REVERT KEY] | SC-03 — `setQueryData` call is positioned BEFORE `setPreferencesRefreshKey` | `AppHandlers.tsx` | Source index of `queryClient.setQueryData(\n          ['userLocation'` is LESS THAN source index of the FIRST `setPreferencesRefreshKey((prev` after it. If positions reverse (setQueryData after setPreferencesRefreshKey), T-03 RED. | Structural ordering |
| **T-04** | SC-08 — `useUserLocation.ts:155` staleTime unchanged | `useUserLocation.ts` line ~155 | Source contains the literal `staleTime: useGpsFlag ? 5 * 60 * 1000 : Infinity,` | Structural negative — no global staleTime change |
| **T-05** | SC-09 — `useUserLocation.ts:152` query key unchanged | `useUserLocation.ts` line ~152 | Source contains the literal `queryKey: ['userLocation', userId, currentMode, customLat, customLng, customLocation, useGpsFlag],` | Structural negative — no key discriminator added |
| **T-06** | SC-07 — collab GPS snapshot block at PreferencesSheet.tsx:861-871 byte-identical | `PreferencesSheet.tsx` lines ~861-871 | Source contains `if (useGpsLocation && collabLat == null) {` followed within 5 lines by `const gps = await enhancedLocationService.getCurrentLocation();` followed within 5 lines by `collabLat = gps.latitude;` | Structural — collab branch preserved exactly |
| **T-07** | SC-05 — type guard on freshGpsLat/Lng uses `typeof === 'number'` not truthy check | `AppHandlers.tsx` | Source contains `typeof preferences.freshGpsLat === 'number'` (literal string match) | Structural — equator/prime-meridian edge-case guard present |
| **T-08** | SC-04 — gating on `preferences.useGpsLocation === true` is strict equality not truthy | `AppHandlers.tsx` | Source contains `preferences.useGpsLocation === true` (literal string match) within the setQueryData block guard | Structural |

**`[FAILS-ON-REVERT KEY]` anchors:**
- T-01 designated. Must FAIL when the solo GPS-snapshot block is reverted (deleted from PreferencesSheet.tsx); restored fix → PASS.
- T-03 designated. Must FAIL when the `setQueryData` call is moved BELOW (after) the `setPreferencesRefreshKey` bump in AppHandlers.tsx; restored fix → PASS.

**Implementor MUST verify both fails-on-revert anchors at the closing commit.** Document in `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0904_SOLO_MODE_STALE_GPS.md`:
- Commit hash at which fail-on-revert was tested.
- For T-01: temporary diff that reverts the snapshot block, test output showing T-01 RED, diff restoration, test output showing T-01 GREEN.
- For T-03: temporary diff that moves the `setQueryData` to AFTER the refresh-key bump, test output showing T-03 RED, restoration, GREEN.

### §5.2 — Tester adversarial test (NON-NEGOTIABLE per ORCH-0840 Step 0.5 gate)

**Path:** `app-mobile/scripts/ci/orch-0904-adversarial-check.mjs` (NEW file, separate from the happy-path script).

**Test framework:** same plain Node `.mjs` structural pattern. Attacks DIFFERENT angles than happy-path.

**Required test cases:**

| ID | Scenario (DIFFERENT angle than happy-path) | Assertion | Angle attacked |
|---|---|---|---|
| **TA-01** | Collab branch is NOT mistakenly modified (parity-preservation safety) | `PreferencesSheet.tsx` lines 850-905 (the collab branch) contain exactly the same code pre-fix and post-fix. Use git-show against a reference commit OR snapshot the expected literal. If anyone "consolidates" the two branches into a shared helper without operator sign-off, TA-01 RED. | Parity preservation against drift-via-consolidation |
| **TA-02** [FAILS-ON-REVERT KEY] | Custom-location path is NOT polluted | `AppHandlers.tsx` setQueryData block is GATED by `preferences.useGpsLocation === true`. If anyone changes the guard to truthy (`preferences.useGpsLocation`) or removes the guard entirely, the cache would be written for custom-location users too, breaking their saved address. TA-02 must FAIL when guard is weakened. | Defense-in-depth on the custom-location boundary |
| **TA-03** | Zero-coord users (equator / prime meridian) trigger the cache write | The type guard MUST use `typeof X === 'number'`, NOT a truthy check. Adversarial: search source for the patterns `preferences.freshGpsLat && preferences.freshGpsLng`, `!!preferences.freshGpsLat`, `preferences.freshGpsLat > 0`. Any of these patterns RED. Only `typeof preferences.freshGpsLat === 'number'` accepted. | Boundary — equator/prime-meridian |
| **TA-04** [FAILS-ON-REVERT KEY] | Solo branch GPS-resolve failure does NOT block the save | `PreferencesSheet.tsx` solo branch has a `try { ... } catch {}` around the `enhancedLocationService.getCurrentLocation()` call. If anyone removes the catch (letting the exception bubble), the Apply tap silently fails for users with bad GPS state. Adversarial assertion: solo branch contains the literal pattern `} catch {` AND immediately after the catch block contains the `onSave({` call (proof that onSave still runs even after GPS failure). | Error path resilience |
| **TA-05** | Query key tuple matches `useUserLocation.ts:152` exactly | Read both files. Extract the query-key tuple from each. Assert they MATCH element-for-element on the GPS-mode keying (`[, , 'solo', null, null, null, true]` shape). If `useUserLocation.ts` ever changes its key construction, TA-05 RED — flags the keys-in-lockstep contract. | Cross-file contract |
| **TA-06** | The fresh-GPS resolve happens BEFORE the onSave call (snapshot semantics) | `PreferencesSheet.tsx` solo branch: the `await enhancedLocationService.getCurrentLocation()` line must appear BEFORE the `await Promise.resolve(onSave(` line. If they reverse (onSave then GPS resolve), the deck refetch fires with stale cache while GPS resolves later — race condition. Source-position-order assertion. | Sequencing |
| **TA-07** | The setQueryData write happens BEFORE the refresh-key bump (race-free semantics) | Same as T-03 but enforced as a separate adversarial: search for any code path where `setPreferencesRefreshKey` is called inside `handleSavePreferences` and assert the closest preceding `queryClient.setQueryData(['userLocation'` reference is on a LOWER line number. If `handleSavePreferences` ever grows multiple refresh-key bumps, EACH one must be preceded by a setQueryData (or a guard explaining why not). | Sequencing |
| **TA-08** | The solo branch GPS-snapshot guard mirrors collab's: `useGpsLocation && X?.lat == null` | Solo branch: `useGpsLocation && selectedCoords?.lat == null`. Collab branch: `useGpsLocation && collabLat == null`. Both expressions are present in their respective branches with the equivalent structure. If solo's guard ever drops the null-check (forcing GPS resolve even when custom coords are provided), TA-08 RED. | Guard parity |

**`[FAILS-ON-REVERT KEY]` anchors:**
- TA-02 designated. Must FAIL when `useGpsLocation === true` guard in AppHandlers is weakened to `preferences.useGpsLocation` (truthy) or removed.
- TA-04 designated. Must FAIL when the solo-branch try/catch is removed.

**Tester MUST verify both adversarial fails-on-revert anchors and document in the QA report.**

### §5.3 — Append-only token requirement

Both regression test files are NEW (no `app-mobile/scripts/ci/orch-0904-*` files exist pre-fix). Closing commit body does NOT need `[TEST-MOD-APPROVED ORCH-0904]` token.

IF during implementation the implementor discovers a pre-existing test that conflicts with the new fields on the `preferences` object (e.g., a `serverDraftLifecycleGuards.test.ts`-style strict-shape test), surface to operator before modifying. Standard ORCH-0840 escape valve applies: `[TEST-MOD-APPROVED ORCH-0904]` token in commit body if a modification is required.

### §5.4 — Sim live-fire (TEST phase, NON-NEGOTIABLE)

Investigation deferred sim repro per Prime Directive 7 + operator authorization (2026-05-21). **TEST phase does NOT inherit this exemption.** Tester MUST run the 8-step smoke from investigation §12:

1. Boot consumer-app iOS dev build per `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` (NOT `npx expo run:ios`).
2. Sign in with `use_gps_location=true`.
3. Xcode → Debug → Simulate Location → set to `(6.5244, 3.3792)` Lagos. Open preferences sheet. Tap Apply. Note deck contents (Lagos-anchored).
4. Within 5 minutes, WITHOUT reloading the app, switch Simulate Location to `(6.6, 3.5)` (~30 km away).
5. Open preferences sheet. Tap Apply (NO preference changes).
6. **Pre-fix:** deck remains Lagos-anchored (bug).
7. **Post-fix:** deck re-anchors to `(6.6, 3.5)` (Places shown reflect the new ~30 km offset).
8. Repeat on Android emulator with equivalent GPS-spoofing (Extended Controls → Location → custom coords).

Screenshots required in `Mingla_Artifacts/evidence/orch-0904/` showing pre-fix bug AND post-fix re-anchoring on both platforms.

Sim attempt must be made on BOTH iOS Simulator AND Android Emulator. If blocked on either platform, tester STOPS and asks operator with specific unblock request per the parity-enforcement rule + `feedback_tester_canonical_and_platform_parity.md`.

---

## §6 — Implementation order

Strict sequence. Implementor follows in order, marks each step done before proceeding.

1. **Read all 4 source files end-to-end** (PreferencesSheet.tsx, AppHandlers.tsx, useUserLocation.ts, enhancedLocationService.ts). Confirm the line ranges + collab-branch pattern at lines 861-871 are still as documented. If anything has drifted since 2026-05-21, surface to operator before changing scope.
2. **Edit `PreferencesSheet.tsx`** per §2 File 1 Change 1A. Insert solo GPS-snapshot block + thread `freshGpsLat`/`freshGpsLng` into `onSave` call.
3. **Edit `AppHandlers.tsx`** per §2 File 2 Change 2A. Add `setQueryData` write before `setPreferencesRefreshKey` bump.
4. **Write happy-path regression test** at `app-mobile/scripts/ci/orch-0904-regression-check.mjs` per §5.1 with T-01..T-08. Each test is a structural grep against `app-mobile/src/components/PreferencesSheet.tsx`, `app-mobile/src/components/AppHandlers.tsx`, `app-mobile/src/hooks/useUserLocation.ts`. Add `package.json` script entry `"test:orch-0904": "node scripts/ci/orch-0904-regression-check.mjs"` mirroring the ORCH-0901 pattern.
5. **Run happy-path test:** `cd app-mobile && node scripts/ci/orch-0904-regression-check.mjs`. Expect all 8 tests PASS.
6. **Fails-on-revert verification (MANDATORY per §5.1):**
   - Temporarily revert the solo GPS-snapshot block in `PreferencesSheet.tsx` (delete the 15-line block + restore the original 3-line solo branch). Re-run. T-01 MUST go RED. Restore. T-01 GREEN.
   - Temporarily move the `setQueryData` block in `AppHandlers.tsx` to AFTER the `setPreferencesRefreshKey` call. Re-run. T-03 MUST go RED. Restore. T-03 GREEN.
   - Document both revert tests in the implementation report with temporary diffs + test outputs.
7. **TypeScript check:** `cd app-mobile && npx tsc --noEmit` on the 2 modified files. Zero errors expected.
8. **Stage, write implementation report, commit.** Stage exactly:
   - `app-mobile/src/components/PreferencesSheet.tsx`
   - `app-mobile/src/components/AppHandlers.tsx`
   - `app-mobile/scripts/ci/orch-0904-regression-check.mjs` (NEW)
   - `app-mobile/package.json` (+1 script entry)
   - `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0904_SOLO_MODE_STALE_GPS.md`
   
   Do NOT stage any other dirty file. Commit message: `ORCH-0904: solo-mode preferences-apply snapshots fresh GPS + setQueryData(userLocation) before refresh-key bump`. Push to `Seth`.

9. **Hand back to orchestrator for REVIEW.** Do NOT open a PR. Do NOT publish EAS OTA. Those are orchestrator + operator steps post-tester-PASS.

---

## §7 — Regression prevention

### Structural safeguard

The fix mirrors the collab branch's existing-and-proven-correct pattern. The solo branch becomes a near-clone of lines 861-871 — making it harder for a future contributor to "fix" solo without also touching collab (since the patterns are visually identical).

### Tests that catch recurrence

- **T-01 + TA-04** detect: removal or weakening of the solo GPS-snapshot block.
- **T-03 + TA-07** detect: reordering of `setQueryData` vs `setPreferencesRefreshKey` (the race-condition trap).
- **TA-02** detects: weakening the `useGpsLocation === true` guard (the custom-location-pollution trap).
- **TA-03** detects: truthy guard on `freshGpsLat / freshGpsLng` (the zero-coord trap).
- **TA-05** detects: drift between the query-key tuples in PreferencesSheet/AppHandlers vs `useUserLocation.ts:152`.

### Protective comment

Implementor adds the ORCH-0904 comment block above the solo GPS-snapshot in PreferencesSheet.tsx (per §2 File 1) AND above the `setQueryData` block in AppHandlers.tsx (per §2 File 2). Both reference the investigation report for the "why" so future readers see the context.

### CI gate consideration (out of scope)

Could be elevated to a strict-grep CI gate per `feedback_strict_grep_registry_pattern.md`. Not in scope for ORCH-0904; the `.mjs` regression check + tester adversarial cover the contract. If operator wants the gate, register ORCH-0904-B follow-up after CLOSE.

---

## §8 — DIAG-marker plan

Implementor should NOT add `[ORCH-0904-DIAG]` marker lines during normal implementation — no production telemetry needed beyond existing `enhancedLocationService.ts` console paths.

IF during fails-on-revert verification (§6 step 6) the implementor adds temporary `[ORCH-0904-DIAG]` lines for debugging the React Query cache write, those MUST be reaped before CLOSE per Step 1.5 of the orchestrator's CLOSE protocol:

```bash
grep -rn "\[ORCH-0904-DIAG\]" \
  mingla-business/src/ mingla-business/app/ \
  app-mobile/src/ \
  supabase/functions/ \
  mingla-admin/src/ 2>/dev/null
```

Required outcome before CLOSE: ZERO matches.

---

## §9 — Open questions

None. The design is operator-locked (intake 2026-05-21 + orchestrator brainstorming during ORCH-0903). SPEC has resolved every dispatch-level open question:

- Mirror collab pattern: ✓ confirmed.
- `setQueryData` vs `invalidateQueries`: ✓ `setQueryData` chosen (synchronous, race-free).
- Where to thread fresh coords: ✓ new `freshGpsLat`/`freshGpsLng` fields on the `preferences` payload.
- Custom-location preservation: ✓ guard `useGpsLocation === true`.
- Zero-coord edge case: ✓ `typeof === 'number'` type guard.
- 5-min staleTime: ✓ stays global; fix targets Apply-intent moment only.
- Query key discrimination: ✓ no new discriminator; cache write uses literal key tuple.
- Collab branch: ✓ untouched (already correct).
- EAS OTA: ✓ eligible (pure JS, no native, no migration, no edge fn).

If implementation uncovers a NEW open question (e.g., the `setQueryData` key tuple needs to handle a non-`'solo'` mode value), implementor surfaces to operator before changing scope.

---

## §10 — Cross-Surface success criteria summary

| Surface | Success criterion | How verified |
|---|---|---|
| consumer-iOS | SC-01 through SC-11 satisfied; iOS Simulator live-fire at TEST phase shows deck re-anchors when Simulate Location switches within 5-min window | Tester iOS Simulator + screenshots + Metro log of `[discover-cards]` request bodies showing fresh coords + place IDs reflect new anchor |
| consumer-Android | SC-01 through SC-11 satisfied; Android Emulator live-fire same as iOS | Tester Android Emulator + screenshots |
| Backend | N/A | No edge function or migration change. |
| buyer-anon-web | N/A | Not in scope (no preferences sheet). |
| business-iOS / Android / web-preview | N/A | Not in scope (no consumer preferences sheet in business app). |
| admin-web | N/A | Not in scope. |

---

**End of SPEC.**
