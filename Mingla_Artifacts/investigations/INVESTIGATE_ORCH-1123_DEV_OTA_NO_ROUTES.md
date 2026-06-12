# INVESTIGATE — ORCH-1123 dev OTA crash: `Error: No routes found`

**Skill:** mingla-forensics (INVESTIGATE)
**Date:** 2026-06-12
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1123-[hub-multiselect-draft-delete]/mingla-business`
**Branch / HEAD:** `ORCH-1123-hub-multiselect-draft-delete` @ `5fc87087e`
**Symptom:** physical iPhone business DEV build, after pulling the ORCH-1123 OTA (`development` channel, runtime 1.0.0), crashes at boot:
`Error: No routes found` (ExpoRoot → ContextNavigator → useStore). expo-router's `require.context("./app")` route manifest is EMPTY at runtime.

---

## VERDICT (confidence: PROVEN)

**Root cause = (b/c hybrid) — a POISONED, SHARED Metro/Haste cache during the export `eas update` ran, NOT ORCH-1123's code and NOT the symlink by itself.**

The `eas update` export read a **corrupted, truncated bundle from the shared Metro cache** in which expo-router's `require.context("./app")` resolved to **ZERO route modules**. The published OTA bundle therefore had the expo-router runtime but no routes → `No routes found` at boot. ORCH-1123's diff is innocent; a clean (cache-cleared) export of the exact same worktree is fully healthy.

The cache got poisoned because **the symlinked `node_modules` makes every concurrent worktree share the anchor's Metro file-map / transform cache in the OS TMPDIR.** Several sessions (ORCH-1122 GIF key, ORCH-1118 trip mapbox) published to the SAME `development` channel within ~15 minutes; their concurrent Metro runs collided on the shared Haste/transform cache and left a route-less manifest that the ORCH-1123 publish then baked in.

---

## EVIDENCE (driven, not theorized)

All exports run from the worktree AS-IS (symlinked `node_modules` → anchor). `node_modules` confirmed symlink: `node_modules -> /Users/sethogieva/Desktop/mingla-main/mingla-business/node_modules`.

| Export | Cache | Modules | Bundle size | Route modules in bundle |
|---|---|---|---|---|
| dev export, as-is | warm shared | — | 14.4 MB | **48 routes present** (incl. `(tabs)/hub/{events,trips,experiences}.tsx`) |
| **prod export #1** | **warm shared (POISONED)** | **951** | **2.4 MB** | **0 — BROKEN (reproduces the crash)** |
| prod export #2 | `--clear` | 5055 | 14 MB | all present |
| dev export #2 | warm (rebuilt) | 5055 | — | all present |

### 1. The route-less bundle was reproduced (the crash)
`NODE_ENV=production npx expo export --platform ios` against the warm shared cache produced a **951-module, 2.4 MB** bundle (vs the healthy 5055-module, 14 MB).
- `strings` on that `.hbc`: contains `ExpoRoot`, `ContextNavigator`, `No routes found` (the expo-router runtime) but **0** occurrences of any app route key (`(tabs)/hub/events`, `accept-brand-invitation`, …) and **0** of any app screen (`EventsTab`, `HubTripsRoute`, `HubExperiencesRoute`, `DraftSelectBar`, `useDraftMultiSelect`).
- This is exactly `require.context("./app")` → empty → ExpoRoot throws `No routes found`. **The runtime stack in the symptom is byte-for-byte explained.**

### 2. The same worktree, cache-cleared, is healthy
`npx expo export --platform ios --clear` → **5055 modules, 14 MB**, and the bundle contains all route keys: `(tabs)/hub/events`, `(tabs)/hub/trips`, `(tabs)/hub/experiences`, `(tabs)/hub/getstarted`, `(tabs)/hub/index`, `accept-brand-invitation`, `connect-tax-registrations`, … plus the ORCH-1123 screens `EventsTab` / `HubTripsRoute` / `HubExperiencesRoute` and modules `DraftSelectBar` / `useDraftMultiSelect`.

### 3. The symlink env alone does NOT break routes
The first dev export from the symlinked worktree (warm cache) baked **48 route modules** including all three edited hub routes. So the symlinked-node_modules export environment is NOT inherently route-empty (rules out a pure "(b) symlink → empty require.context" theory). The symlink's role is to **share the cache** across worktrees (poisoning vector), not to misresolve the app root.
- Note: Metro DID resolve node_modules through the symlink to the anchor real path (asset paths emitted as `../../../mingla-main/mingla-business/node_modules/...`), but the `./app` route root resolved correctly off the project root in every cache-clean run.

### 4. ORCH-1123 code is exonerated
- Diff touches NO `_layout`, `app/index`, entry, nav/expo-router/metro/babel config, package.json, or app.json/app.config (confirmed `git diff --stat origin/main...HEAD`).
- All three hub routes keep a clean top-level `export default` (`events.tsx:153 EventsTab`, `trips.tsx:106 HubTripsRoute`, `experiences.tsx:494 HubExperiencesRoute`). `events.tsx:136` adds a harmless named `export const bulkToastMessage` (expo-router ignores non-route named exports).
- No module-level `throw` in any new module (`DraftSelectBar/Checkbox/Overlay`, `useDraftMultiSelect`, `useDiscardOfferingDrafts`, `hapticFeedback`).
- The cache-clean export includes all ORCH-1123 code AND all routes → code is healthy.

### 5. Shared-channel / runtime collision corroborated
`eas update:list --branch development` shows three sessions published to the SAME branch + SAME `Runtime Version 1.0.0` within ~15 min: ORCH-1123 (7 min ago), ORCH-1122 GIF key (12 min ago), ORCH-1118 trip mapbox (15 min ago). `runtimeVersion.policy = "appVersion"` (app.json L33/L83) = `1.0.0` → every session's update is eligible to serve the same dev build; concurrent Metro runs shared the TMPDIR cache.
- Shared cache location confirmed: `/var/folders/3r/.../T/metro-cache` + many `metro-file-map-*` Haste maps in the shared OS TMPDIR (anchor has no local `node_modules/.cache`). Concurrent worktree exports through the symlink collide here.

---

## THE FIX (for the orchestrator, before re-publishing to dev)

**Re-publish ORCH-1123 to the `development` channel from a CLEARED cache. This is mandatory and sufficient.**

1. In `mingla-business/` of this worktree, force a clean Metro build on the publish:
   - `npx eas-cli update --branch development --platform ios --clear-cache` (and again `--platform android`), **or**
   - clear the shared cache first — `rm -rf "$TMPDIR"/metro-* "$TMPDIR"/haste-map-*` — then publish as before.
   - Proven locally: `expo export ... --clear` yields the healthy 5055-module / 14 MB bundle with all 48 routes.
2. **Verify the published bundle is non-empty before handing to Seth:** `eas update:list --branch development` and confirm the new iOS+Android groups; ideally `expo export --platform ios --clear` locally first and confirm `strings *.hbc | grep -c "(tabs)/hub/events"` ≥ 1 and module count ≈ 5000 (NOT ~950).
3. Reinstall/relaunch on Seth's device to pull the corrected update ([[edge-deploy hazard rule: consumer/dev deck/bundle persists — reinstall to refresh]]).

**Removing the symlink + `npm ci` is NOT required to fix this incident** (the as-is symlinked export is route-healthy once the cache is clean). However, per memory worktree rule 4, a real `npm ci` in the worktree also resolves it by giving the worktree its OWN cache key — it works because it stops sharing the poisoned cache, which is the same lever as `--clear`.

### Prevent recurrence (process / orchestrator)
- **Never publish OTA from a worktree concurrently with other sessions while sharing the symlinked cache without `--clear-cache`.** The shared TMPDIR Metro/Haste cache is a cross-session corruption vector when `node_modules` is symlinked to the anchor.
- Stagger or serialize OTA publishes to the SHARED `development` channel; with `runtimeVersion.policy=appVersion` every publish targets the same 1.0.0 dev build, so the last writer wins and a poisoned bundle can clobber a good one.
- Consider a publish-time guard: assert the exported iOS/Android bundle contains ≥1 known route key (e.g. `(tabs)/hub/events`) before `eas update` uploads — a route-empty manifest must fail the publish.

---

## Confidence: PROVEN
The crash was reproduced locally (route-empty 951-module bundle with `ExpoRoot`/`No routes found` and zero app routes), and the fix was proven locally (cache-clear → 5055-module bundle with all routes incl. ORCH-1123 code). The symptom stack is fully explained by an empty `require.context("./app")` manifest.
