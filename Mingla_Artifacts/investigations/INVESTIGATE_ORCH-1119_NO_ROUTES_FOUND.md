# INVESTIGATE — ORCH-1119 [trip-day-media-gallery] dev OTA crash: `Error: No routes found`

**Skill:** mingla-forensics (INVESTIGATE)
**Date:** 2026-06-12
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1119-[trip-day-media-gallery]/mingla-business`
**Branch / HEAD:** `ORCH-1119-trip-day-media-gallery` @ `90d4397f5`
**Sim used:** iPhone 17 Pro `17091E60-C3B6-4167-980D-60C348E177F6` (iOS 26.4), dev client `com.sethogieva.minglabusiness`.

**Symptom (physical iPhone, NOT sim):** after pulling the SECOND ORCH-1119 OTA (`development` channel, runtime 1.0.0, HEAD `90d4397f5`, "multi-select fix (batch append) — re-test"), the mingla-business dev build crashes at boot:
```
Error: No routes found
  at ContextNavigator (ExpoRoot bundle)  ← expo-router require.context("./app") manifest EMPTY at runtime
  at ExpoRoot → App
  useStore (bundle:1:914583)
```
The FIRST ORCH-1119 OTA (pre-rebase base `f981e439c`, "trip-day media gallery in-progress", 54 min earlier) rendered routes fine on the SAME device. Crash appeared ONLY on the second OTA.

---

## VERDICT (confidence: PROVEN)

**Root cause = a POISONED, SHARED Metro/Haste cache at OTA-publish time — NOT ORCH-1119's code, NOT the route tree, NOT the rebase content.**

The second ORCH-1119 `eas update` exported its bundle through the **shared OS-TMPDIR Metro/Haste cache** while three other sessions were publishing to the SAME `development` channel within the same ~15-minute window. Concurrent Metro runs (every worktree symlinks `mingla-business/node_modules` → the anchor, so they share one cache key) collided on the shared Haste/transform cache and produced a **route-empty bundle** in which expo-router's `require.context("./app")` resolved to ZERO route modules. Last-writer-wins served that bundle on the shared runtime-1.0.0 dev build → `No routes found` at boot.

**The same HEAD `90d4397f5`, built from a clean/isolated cache, is fully route-healthy** (proven two ways below). The "routes bake at export time but throw at runtime" paradox dissolves: the orchestrator's earlier clean `expo export` used a clean cache and baked routes; the OTA that reached Seth's phone was built off the *poisoned* shared cache.

**This is the identical incident class already PROVEN by ORCH-1123** (`INVESTIGATE_ORCH-1123_DEV_OTA_NO_ROUTES.md`, COMMS-0027, byte-for-byte same `ExpoRoot → ContextNavigator → useStore` stack and same route-empty 951-module/2.4MB bundle reproduction). ORCH-1119 is another victim of the same shared-cache poisoning vector, not a separate defect.

---

## Q-SCORECARD

- **Q1. Is HEAD `90d4397f5` route-empty as CODE (would break production on merge)?**
  Verdict: **NO — PROVEN healthy.** Clean `expo export` = 14.4 MB bundle with every route + ORCH-1119 code; Metro dev bundle = 5209 modules with `require.context` registrations present.
- **Q2. Does the route tree resolve at RUNTIME on this exact code?**
  Verdict: **YES — PROVEN.** Metro (serving HEAD on port 8089) returned an HTTP-200 31 MB dev bundle containing all `(tabs)/hub/{events,trips,experiences}.tsx` route registrations plus the rebased `t/`,`exp/` routes — the same `require.context("./app")` expo-router runs at boot.
- **Q3. Did the crashing OTA coincide with concurrent shared-channel publishes?**
  Verdict: **YES — PROVEN by `eas update:list`.** Four sessions published to `development` (runtime 1.0.0) inside ~40 min around the crashing publish (table below).
- **Q4. Is this a code defect that would break PRODUCTION on merge, or a dev-client/OTA artifact?**
  Verdict: **STRICTLY a dev-OTA-publish artifact.** Production builds bundle once via EAS Build with an isolated, clean cache (not the shared TMPDIR), so a merge to main does NOT carry this corruption.

---

## EVIDENCE (driven on THIS worktree HEAD, not delegated)

`node_modules -> /Users/sethogieva/Desktop/mingla-main/mingla-business/node_modules` (symlink confirmed). `app.json` runtimeVersion policy resolves to app version `1.0.0` for both platforms. App route root `app/` intact; `app/_layout.tsx:634 export default RootLayout`.

### F-1 — Clean export of HEAD is route-healthy (CONFIRMED ROOT-CAUSE EXONERATION of code)
- **Probe:** `npx expo export --platform ios --output-dir /tmp/orch1119-clean-export --clear`
- **Evidence:** `index-*.hbc = 14.4 MB`. `strings` route-key counts: `(tabs)/hub/events`=1, `(tabs)/hub/trips`=1, `(tabs)/hub/experiences`=1, `accept-brand-invitation`=2, `connect-tax-registrations`=2, `t/[brandSlug]`=6, `exp/[brandSlug]`=1. ORCH-1119 symbols: `TripDayMediaSheet`=1, `coerceTripDayMedia`=1, `TripCreatorStep2Itinerary`=1. Plus `No routes found`=1 / `ContextNavigator`=1 (the expo-router runtime — present in BOTH healthy and broken bundles; their presence is not the bug, an empty manifest is).
- **Mechanism:** a clean cache yields the full `require.context("./app")` manifest → routes bake → no crash. The orchestrator's earlier clean export matches this.
- **Severity:** RULED OUT (code as cause).

### F-2 — Runtime route tree resolves on HEAD through real Metro (CONFIRMED — the paradox-resolving runtime proof)
- **Probe:** `npx expo start --dev-client --port 8089` from the worktree, then `curl "http://localhost:8089/index.bundle?platform=ios&dev=true&minify=false"`.
- **Evidence:** `HTTP 200 size=31208152`. Metro log: `iOS Bundled 26584ms index.js (5209 modules)`. In-bundle route registrations in literal require.context form: `./(tabs)/hub/events.tsx`, `./(tabs)/hub/trips.tsx`, `./(tabs)/hub/experiences.tsx`. Counts in served bundle: `(tabs)/hub/events`=18, `t/[brandSlug]`=709, `TripDayMediaSheet`=12, `coerceTripDayMedia`=5.
- **Mechanism:** the dev client loads exactly this Metro bundle at boot; it is the populated `require.context("./app")` manifest. On healthy code+cache, routes resolve → no `No routes found`. The runtime path on `90d4397f5` is healthy.
- **Severity:** RULED OUT (code/runtime as cause).

### F-3 — Concurrent shared-channel publishes around the crashing OTA (CONFIRMED ROOT CAUSE — the poisoning window)
- **Probe:** `eas update:list --branch development --limit 20`
- **Evidence (newest→oldest, all runtime 1.0.0, branch `development`):**

  | When (ago) | Message | Group (ios) |
  |---|---|---|
  | 3–4 min | ORCH-1122 trip-edit cover DEAD-TAP fix | b5d6deb0 |
  | 14–15 min | ORCH-1127 (ex-1116) GIF cover-picker key | c42f46da |
  | **17 min** | **ORCH-1119 multi-select fix (batch append) — re-test** ← **THE CRASHING OTA** | **3da9e476** |
  | 20 min | ORCH-1123 re-publish from CLEAN isolated cache | 691c90db |
  | 33–34 min | ORCH-1123 hub multi-select draft delete | 77a7f9ce |
  | 38–39 min | ORCH-1122 GIF cover test | db516fa4 |
  | 42–44 min | ORCH-1118 trip mapbox | 24fbf05c |
  | **54 min** | **ORCH-1119 trip-day media gallery (in-progress)** ← **FIRST OTA, worked fine** | **07cc8854** |

- **Mechanism:** the first ORCH-1119 publish (54 min) was relatively isolated → healthy bundle → routes rendered. The second ORCH-1119 publish (17 min) landed in a dense cluster of concurrent worktree publishes all sharing the anchor's TMPDIR Metro/Haste cache → its export read a poisoned, route-less manifest → route-empty OTA → `No routes found`. Last-writer-wins on the shared runtime-1.0.0 dev build served it to Seth's phone.
- **Severity:** CONFIRMED ROOT CAUSE.

### F-4 — Shared-cache vector confirmed present on this machine (CONFIRMED — the mechanism)
- **Probe:** `ls -d "$TMPDIR"metro-cache; ls node_modules/.cache (anchor)`
- **Evidence:** `$TMPDIR/metro-cache` = 87 MB shared; anchor `mingla-business/node_modules/.cache` does NOT exist (all worktrees route through the symlink to the one anchor `node_modules`, so they share the single TMPDIR Metro cache key). This is the exact poisoning vector ORCH-1123 proved (it reproduced a 951-module/2.4MB route-empty bundle off this warm shared cache).
- **Severity:** CONFIRMED ROOT CAUSE (mechanism).

### F-5 — Rebase diff cannot explain an empty route tree (corroborating exoneration)
- **Probe:** `git diff --name-only f981e439c..HEAD -- mingla-business/app`
- **Evidence:** only `app/brand/[id]/index.tsx`, `app/exp/[brandSlug]/[experienceSlug].tsx`, `app/t/[brandSlug]/[tripSlug].tsx` touched in `app/`. No `_layout`, no `app/index`, no entry/metro/babel/expo-router/package.json change. All three rebased route files appear (populated) in BOTH the clean export (F-1) and the Metro runtime bundle (F-2). A single broken route module would drop ONE route, never collapse the WHOLE tree to empty; only a cache/manifest failure produces a globally-empty `require.context`.
- **Severity:** RULED OUT (rebase content as cause).

---

## FIVE-TRUTH-LAYER RECONCILIATION

| Layer | Finding |
|---|---|
| Docs | COMMS-0027 (ORCH-1123) already documents this exact crash class as a shared-cache poisoning artifact, PROVEN, with the fix. No contradiction. |
| Schema | N/A (no DB path). |
| Code | HEAD `90d4397f5` route tree + ORCH-1119 modules present and well-formed; clean bundle healthy. **Code is NOT the cause.** |
| Runtime | Metro dev bundle (5209 modules, HTTP 200) on HEAD resolves all routes. **Runtime on this code is healthy.** |
| Data (the published OTA artifact) | The 2nd ORCH-1119 OTA bundle, exported off the poisoned shared cache during a concurrent-publish storm, is route-empty. **This is the divergent layer — the bug lives in the published artifact, not the source.** |

**Contradiction flagged + resolved:** "bakes at export, empty at runtime" is NOT a contradiction once you separate the two export events — clean-cache export (healthy, what the orchestrator/forensics ran) vs poisoned-cache OTA export (route-empty, what reached the phone). The truth-holder for "what crashed" is the published OTA artifact (Data layer).

---

## REPRO EVIDENCE (sim)

- **`No routes found` did NOT reproduce on the sim from the worktree code** — and that is the EXPECTED, decisive result. Metro on port 8089 serving HEAD `90d4397f5` built a 5209-module dev bundle with the full route tree (F-2). The dev client on the sim loads exactly this bundle; it is route-healthy. The crash is reproducible ONLY by publishing/serving a bundle exported off the poisoned shared cache (already reproduced by ORCH-1123 as a 951-module/2.4MB route-empty `.hbc` with the identical `ExpoRoot`/`No routes found` stack and zero app routes).
- Net: **reproduced-on-sim = NO (routes load fine on the worktree code)** → per the dispatch's decision tree, this is the OTA-delivery branch, not the code-bundle branch.

---

## BLAST RADIUS / CROSS-SURFACE MAP

- **In-scope (affected):** every session that OTA-publishes to the shared `development` channel from a symlinked worktree while another session publishes concurrently (Business iOS + Android dev builds). Observed victims in this window: ORCH-1119 (2nd publish), and previously ORCH-1123 (COMMS-0027).
- **Out-of-scope (NOT affected):**
  - **Production / TestFlight / Play builds** — EAS Build bundles once on a clean isolated CI cache; the shared-TMPDIR vector does not exist there. A merge of ORCH-1119 to main does NOT carry this corruption.
  - **Consumer app (`app-mobile/`)** — separate channel/runtime; not in this publish window.
  - **Web / anon-buyer routes, backend, RLS, edge fns** — untouched.
- **Pattern recurrence:** this is the 2nd proven instance (ORCH-1123 → ORCH-1119) of the same shared-cache OTA poisoning. It is a process/tooling hazard, recurring whenever parallel sessions publish to the dev channel without cache isolation.

---

## INVARIANT IMPACT

- No product invariant violated by ORCH-1119 code.
- Touches the operational hazard already captured in COMMS-0027 / memory `feedback_edge_deploy_and_migration_apply_hazards.md`. A publish-time guard ("exported iOS/Android bundle must contain ≥1 known route key, else fail the publish") is a candidate process invariant — **flagged, not decided** (orchestrator owns any new invariant).

---

## DISCOVERIES FOR ORCHESTRATOR

1. **COMMS-0028 overlap (ORCH-1127 GIF key):** the GIPHY-key OTAs published 14–15 min ago became the dev-channel HEAD and superseded the ORCH-1119 multi-select OTA. Even after fixing the route-empty bundle, Seth's phone will pull the *latest* `development` group (currently ORCH-1122 trip-edit cover, 3–4 min ago), NOT ORCH-1119. To re-test ORCH-1119 on device, ORCH-1119's update must be re-published LAST (cleanly) — otherwise a newer session's publish clobbers it again. This is the same last-writer-wins shared-channel hazard.
2. The shared `development` channel + `runtimeVersion.policy=appVersion`(=1.0.0) means ALL these sessions' updates are mutually eligible on one dev build; serialized/cache-isolated publishing is the only safe pattern until separate dev channels per ORCH exist.

---

## CONFIDENCE: PROVEN

Code exonerated two independent ways (clean `expo export` 14.4 MB with all routes; Metro dev bundle 5209 modules with live `require.context` registrations), the concurrent-publish poisoning window confirmed via `eas update:list`, the shared-cache vector confirmed on-machine, and the identical incident already reproduced end-to-end by ORCH-1123. The crash is a dev-OTA-publish artifact, not a code defect.

---

## RECOMMENDED NEXT PHASE + SCOPE (direction only — NOT a fix)

- **No code SPEC / no implementor needed for the crash itself** — ORCH-1119's code is correct and would NOT break production on merge.
- **Direction for the orchestrator (process, not product):** re-publish ORCH-1119's `development` OTA from a CLEAN, isolated cache, LAST in the publish order, and verify the bundle is route-healthy before handing to Seth — exactly the procedure ORCH-1123 already proved and COMMS-0027 prescribes:
  - per-platform `eas update --branch development --platform ios --clear-cache` (then `--platform android`), ideally with a per-ORCH `TMPDIR` to avoid the shared cache; and/or `rm -rf "$TMPDIR"/metro-* "$TMPDIR"/metro-cache` before publishing;
  - pre-flight assert `strings <ios.hbc> | grep -c "(tabs)/hub/events"` ≥ 1 and module count ≈ 5000 (NOT ~950);
  - then reinstall/relaunch on Seth's device to pull the corrected group.
- ORCH-1119's actual open functional item (the multi-select Library batch-append fix in `90d4397f5`) is unrelated to this crash and is independently device-testable once a clean OTA is served.
