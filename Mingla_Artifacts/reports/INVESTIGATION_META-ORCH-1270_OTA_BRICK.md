# INVESTIGATION — META-ORCH-1270 — mingla-business OTA bricks app on splash

**Surface:** `mingla-business/` native (iOS + Android), production EAS Update channel
**Symptom:** after an `eas update --branch production` carrying the full accumulated main JS bundle, the app is STUCK ON THE SPLASH SCREEN on relaunch (no red box, no crash-to-home). OTA has been rolled back to embedded.
**Method:** READ-ONLY static forensics — walked the `app/_layout.tsx` boot import graph, inspected every native-touching service/provider, read the installed `node_modules` of the suspect packages, and cross-checked git add-dates against the 2026-06-21 OTA freeze (COMMS-0052).
**Status:** Root mechanism proven from code. Exact single throwing module cannot be pinned by static analysis alone (see §2 caveat) — but the fix determination is independent of that and is unambiguous.

---

## TL;DR

1. **Root enabler:** `runtimeVersion.policy = "appVersion"` with `version = "1.0.0"` (both platforms). EVERY 1.0.0 binary in the wild — no matter how old, no matter which native modules it was compiled with — receives the SAME production OTA. The installed population is heterogeneous and includes binaries that predate native modules the current JS bundle references.

2. **The boot tree statically wires native RENDER surfaces ABOVE the splash-hide.** `SplashScreen.hideAsync()` is called ONLY inside `RootLayoutInner` (app/_layout.tsx:281). It sits BELOW the whole provider stack (Query → Auth → **KeyboardProvider** → **PostHogProvider**). `SplashScreen.preventAutoHideAsync()` runs at module top (line 125). **Therefore any throw between module-load and `RootLayoutInner` mounting leaves the native splash overlay up FOREVER** — because (a) a module-load throw is caught by no React boundary, and (b) a provider render throw IS caught by the outer `ErrorBoundary` (line 747) but its fallback NEVER calls `hideAsync()`. A caught boot error is visually identical to a hang: permanent splash. **This is the splash-hang mechanism.**

3. **The "posthog guard fix" is NOT on main.** `PostHogAnalyticsProvider.tsx:18` still has an UNGUARDED static `import { PostHogProvider } from "posthog-react-native"` and renders `<PostHogProvider autocapture>` in the boot tree. Git shows this file is unchanged since it was introduced (commit `b5ff3a5bd`, 2026-06-21). The lazy/guarded import the team believes they shipped lives only in `postHogService.ts` (which was ALWAYS lazy). The provider — the thing COMMS-0052 named as the freeze cause — was never guarded.

4. **Fresh native build is the ONLY reliable fix, and appVersion MUST bump.** Guarding can silence individual crashes but cannot make OTA reliable across an unknown/old binary population, and it leaves the native features dead. A fresh `eas build` compiling all current native deps + bumping `version` (1.0.0 → 1.0.1, so runtimeVersion changes) is required so old 1.0.0 binaries stop pulling the incompatible bundle.

---

## 1. Native-module audit — boot path (`app/_layout.tsx` import graph)

### 1a. Native deps added relative to the freeze

`git log -S` on `mingla-business/package.json`:

| Native dep | Added | Commit |
|---|---|---|
| `posthog-react-native` | **2026-06-21** | b5ff3a5bd (META-ORCH-1187 Leg 3) |
| `posthog-react-native-session-replay` | **2026-06-21** | b5ff3a5bd |
| `expo-tracking-transparency` | **2026-06-21** | b5ff3a5bd |
| `react-native-video-trim` | 2026-05-28 | 058fabd7d (ORCH-0978) |
| `react-native-compressor` | 2026-05-28 | 058fabd7d |
| `react-native-keyboard-controller` | 2026-05-20 | 8f23b81f5 (ORCH-0892-A) |
| `react-native-nfc-manager` | 2026-05-15 | c16fc04ff |
| `react-native-webview` | 2026-05-18 | 9d7dbd6fc |
| `@sentry/react-native` | 2026-04-29 | d39aa4fb2 |
| `expo-video`, reanimated, worklets, gesture-handler, safe-area | ≤ 2026-05-09 | (old — in every plausible binary) |

**`git diff b5ff3a5bd..HEAD -- package.json` adds NO new dependency** (only one test-script line). So relative to a binary built just before the 6-21 freeze, the accumulated OTA adds EXACTLY three native modules: **posthog-react-native, posthog-react-native-session-replay, expo-tracking-transparency.**

### 1b. What is unguarded vs guarded in the boot tree

Boot provider tree (app/_layout.tsx:738–790), outermost → in:
```
GestureHandlerRootView
 └ SafeAreaProvider
    └ ErrorBoundary (outer, line 747)          ← catches render throws below
       └ QueryClientProvider
          └ AuthProvider
             └ KeyboardRoot  → <KeyboardProvider>   [native: react-native-keyboard-controller]
                └ PostHogAnalyticsProvider → <PostHogProvider autocapture>  [native: posthog-react-native]
                   └ RootLayoutInner              ← SplashScreen.hideAsync() lives HERE (line 281)
                └ KeyboardToolbarRoot  → <KeyboardToolbar>  [native, gated null until keyboard visible]
                └ ConsentBanner        [web-only]
```

**UNGUARDED native RENDER surfaces sitting ABOVE `RootLayoutInner`:**

1. **`react-native-keyboard-controller` — `<KeyboardProvider>`** (`src/wrappers/KeyboardRoot.native.tsx`). The TurboModule is Proxy-guarded (`bindings.native.js:12-13` uses `TurboModuleRegistry.get("KeyboardController")` — nullable — then a `new Proxy({},…)` fallback), but the provider renders the native **Fabric view** `KeyboardControllerView` (`bindings.native.js:34`, `require("./specs/KeyboardControllerViewNativeComponent")`). On a binary that never compiled this view, rendering an unregistered Fabric component fails under the New Architecture (`newArchEnabled: true`). It is the FIRST native render wrapping the app and is ABOVE the splash-hide → a throw here = permanent splash. Added 2026-05-20.

2. **`posthog-react-native` — `<PostHogProvider autocapture>`** (`src/services/PostHogAnalyticsProvider.tsx:18` static import, mounted at `_layout.tsx:768`). The static import degrades gracefully (see §2), and the provider only mounts once `EXPO_PUBLIC_POSTHOG_KEY` is set AND the client constructs; but it is the ONLY truly unguarded static native import in the boot file, and per COMMS-0052 it is the documented freeze trigger. Added 2026-06-21.

**GUARDED / SAFE (do NOT brick even when the native module is absent):**

- `react-native-appsflyer`, `mixpanel-react-native`, `react-native-purchases`, `react-native-onesignal` — all loaded via `require()` inside a `Platform.OS !== "web"` + `try/catch` guard and every call site early-returns when the module is null (`appsFlyerService.ts:71-87`, `mixpanelService.ts:54-61`, `revenueCatService.ts:37-49`, `oneSignalService.ts:36-45`). Absent module → silent no-op.
- `expo-tracking-transparency` — guarded **dynamic** import inside `try/catch`, iOS-only, deferred behind `InteractionManager.runAfterInteractions` (`_layout.tsx:463-473`). Safe.
- `expo-apple-authentication` (AuthContext:16) — resolves via `requireOptionalNativeModule('ExpoAppleAuthentication') || {}` → returns `{}` if absent, never throws.
- `@sentry/react-native` — platform `.native/.web` split + init gated on `EXPO_PUBLIC_SENTRY_DSN` presence (`_layout.tsx:108-121`). Safe.
- `posthog-react-native` **at module-load** — see §2: posthog v4 loads every optional native peer through try/catch (`OptionalPlugin.js`, `OptionalExpo*.js`), so the import itself does not throw.

### RANKED list of boot-path native surfaces by brick/hang risk

| Rank | Module / surface | Where | Added | Guarding | Brick risk on a binary lacking it |
|---|---|---|---|---|---|
| **1** | `react-native-keyboard-controller` → `<KeyboardProvider>` native Fabric view | KeyboardRoot.native.tsx, _layout.tsx:764 | 5-20 | Module Proxy-guarded; **Fabric view UNGUARDED** | **HIGH** — renders above the splash-hide; unregistered Fabric view on new-arch → render throw → outer ErrorBoundary catches → `RootLayoutInner` never mounts → `hideAsync()` never runs → **permanent splash** |
| **2** | `posthog-react-native` → `<PostHogProvider autocapture>` | PostHogAnalyticsProvider.tsx:18 + _layout.tsx:768 | 6-21 | **Static import UNGUARDED**; render gated on key + client | **MED** — import degrades gracefully; only the render (key present + client resolves) is a risk. Documented freeze cause (COMMS-0052). Still unpatched on main. |
| **3** | `posthog-react-native-session-replay` (native) | loaded during `postHogService.initialize()` | 6-21 | try/catch in service (`postHogService.ts:120-144`) + posthog `OptionalPlugin` try/catch | **LOW** — construction is guarded; absent module just disables replay |
| — | `react-native-appsflyer / mixpanel / purchases / onesignal`, `expo-tracking-transparency`, `expo-apple-authentication`, `@sentry/react-native` | services / _layout | various | guarded require / dynamic import / optional native module | **NONE** — degrade to no-op |

**Route-level (NOT boot — would crash on NAVIGATION, not on splash):** `react-native-video-trim`, `react-native-compressor` (5-28), `expo-video`, `expo-camera`, `react-native-nfc-manager`, `react-native-webview`, `react-native-qrcode-svg`. These are pulled by specific screens (cover-video editor, ticket scanner, marketing composer). On a binary lacking them, opening those screens crashes — but that is not the splash symptom.

---

## 2. Splash-hang specific cause

**The hang is not an auth-loading stall.** `AuthContext` releases `loading` on native via a universal bootstrap timeout (`AUTH_BOOTSTRAP_TIMEOUT_MS`, resolved through the getSession Promise.race at `AuthContext.tsx:276-303`); the 7 s hard ceiling at line 248 is web-only but is not needed on native. `RootLayoutInner`'s brand gate also has a 2 s timeout (`_layout.tsx:261-274`). So if `RootLayoutInner` mounts, the splash WILL hide within ~2 s. **A permanent splash therefore means `RootLayoutInner` never mounted** — i.e. a throw higher in the tree.

**Mechanism (the architectural defect):**
- `SplashScreen.preventAutoHideAsync()` — module top, `_layout.tsx:125`. Runs on every launch, before React mounts.
- `SplashScreen.hideAsync()` — ONLY inside `RootLayoutInner`'s effect, `_layout.tsx:281`. There is exactly one call site in the whole boot path.
- The outer `ErrorBoundary` (`_layout.tsx:747`) wraps `QueryClientProvider → AuthProvider → KeyboardRoot → PostHogAnalyticsProvider → RootLayoutInner`. When any of those provider renders throws (e.g. `<KeyboardProvider>` mounting a missing native view, or `<PostHogProvider>` on a posthog-less binary), the boundary renders its fallback **but the fallback contains no `SplashScreen.hideAsync()`**. `RootLayoutInner` is never reached.
- A module-LOAD throw (an unguarded top-level `import` of an absent native module) is even worse: React never mounts at all, no ErrorBoundary exists yet, and the splash — already pinned up by `preventAutoHideAsync()` — stays forever.

Either way the result is identical to what the operator sees: **the app renders (or fails to render) beneath a native splash overlay that is never dismissed.**

**Sanity-check of the shipped posthog "guard":** `postHogService.initialize()` (`postHogService.ts:113-145`) is correctly lazy (`await import("posthog-react-native")`) and fully try/catch-wrapped; `new PostHog(key, {enableSessionReplay:true})` is inside that try/catch, and posthog loads the session-replay native plugin via try/catch (`node_modules/posthog-react-native/dist/optional/OptionalPlugin.js` — `try{require('@posthog/react-native-plugin')}catch{}` then `try{require('posthog-react-native-session-replay')}catch{}`). **No defect in the service.** The defect is that the SEPARATE provider file (`PostHogAnalyticsProvider.tsx:18`) still statically imports `PostHogProvider` and renders it in the boot tree — this was never converted to a guarded/lazy mount. COMMS-0052 named exactly this line; it is unchanged.

**Forensic caveat (honesty):** static analysis shows every boot-path IMPORT is individually guarded well enough not to throw at module-load (posthog via OptionalPlugin try/catch; keyboard-controller via TurboModuleRegistry.get + Proxy). The remaining unguarded surfaces are the two RENDERs (KeyboardProvider's Fabric view; PostHogProvider). Which one actually throws first depends on the operator's exact installed binary build-date and whether it was an Old- or New-Architecture build — both unknown from the repo. Pinning the single culprit requires a runtime repro on the operator's precise binary. **This does not change the fix**: the boot path has unguarded native renders above the splash-hide, so any native mismatch on an old binary produces this exact permanent-splash, and the reliable remedy is the same regardless of which module trips first.

---

## 3. Reliable-fix determination

**Can guarding N more imports make the backlog OTA-safe? — NO, not reliably.**

- You could convert `PostHogAnalyticsProvider`'s static import + provider mount to the guarded/lazy pattern used by the sibling services, and wrap `KeyboardRoot.native`'s provider defensively. That would likely stop THIS brick. But:
  1. It only makes those native features **no-op** on old binaries — posthog (the entire point of META-ORCH-1187), the keyboard accessory bar, session replay, and ATT would not actually function until compiled in.
  2. The **route-level** native modules (video-trim, compressor, expo-video, nfc, webview) added since older binaries would still crash on navigation — guarding the boot path does not cover them.
  3. Most importantly, with `runtimeVersion = appVersion = 1.0.0` and an unknown/heterogeneous installed-binary population, OTA-guarding is whack-a-mole: you must chase EVERY native module ever added, forever, for every binary vintage still in the field. That is not a reliable posture.

**A FRESH NATIVE BUILD is the only reliable fix — YES.** `eas build` (business iOS + Android, production profile) compiles all current native deps (posthog + session-replay + expo-tracking-transparency + keyboard-controller + video-trim + compressor + everything) into one binary whose embedded JS matches the current bundle. That binary neither bricks nor no-ops the features.

**appVersion MUST bump — YES.**
- `app.json`: `version: "1.0.0"`, `runtimeVersion.policy: "appVersion"` (iOS block line 33-35, Android line 83-85).
- `eas.json`: `appVersionSource: "remote"`, production `channel: "production"`, `autoIncrement: true` (that increments the BUILD number, not the marketing version).
- Consequence: a new build left at version 1.0.0 still resolves to **runtime 1.0.0** — the SAME OTA channel/runtime as the already-bricked binaries. Old binaries would keep pulling the incompatible bundle and keep bricking; and a future OTA would again target both populations.
- Bumping `version` to `1.0.1` changes the derived runtimeVersion → (a) the old 1.0.0 binaries no longer match new-runtime updates and stay safely on their embedded bundle, and (b) the new build + its future OTAs live on runtime 1.0.1 with all native modules present. **Bump version, build, submit; only then resume business OTAs** — exactly the ACTION COMMS-0052 already prescribed.

---

## 4. Cross-check of the two other operator-reported bugs

**(a) Cover-video upload "Cloud upload failed 404" on native — CONFIRMED: pre-TUS embedded build; fixed only by a native build.**
The resumable/multipart upload client `createMultipartUploadTask` (`src/utils/platformFileSystem.native.ts`, consumed by `src/services/eventCoverVideoProcessingService.ts:807`) and the trim→upload→render pipeline landed **2026-05-28 (ORCH-0978, commit 058fabd7d)**. This is JS, but it has been trapped in the OTA-frozen bundle since 6-21, so the operator's native binary is still running the OLDER embedded upload path (the one that returns the 404). Because business OTA is frozen (posthog), the fix cannot reach the device via `eas update` — it is delivered only when a fresh native build re-embeds the current JS. → fixed by the same native build.

**(b) `react-native-video-trim` long-video trim window can't be repositioned — CONFIRMED: native-component UX limitation.**
The trimmer is invoked via `showEditor(uri, { maxDuration, … })` (`src/components/ui/coverPickerVideoTrimEditor.ts:50,69`, a guarded `require("react-native-video-trim")` behind a `.web.ts` split). `showEditor` presents the library's full-screen NATIVE trim UI, whose selection handles span the whole clip with no timeline zoom/scrub-window reposition — so on a long source the selectable window is coarse and cannot be finely moved. This is a limitation of the native component itself, not app JS; changing it means a different/upgraded trimmer library — which is a native dependency change and therefore requires a native rebuild anyway.

---

## Bottom line

The OTA brick is not one rogue import — it is `runtimeVersion=appVersion=1.0.0` shipping an accumulated bundle to old binaries, plus a boot architecture that pins the splash up and only ever removes it deep inside `RootLayoutInner`, below unguarded native renders (`<KeyboardProvider>`, `<PostHogProvider>`). The posthog "fix" was applied to the service, not to the provider that COMMS-0052 flagged, so the unguarded provider import is still on main. Guarding could stop this specific hang but cannot make OTA reliable and leaves the native features dead. Cut a fresh business native build compiling all current native deps, **bump `version` to change the runtimeVersion**, submit, and only then resume business `eas update`. The cover-video 404 and the trim-window limitation both ride that same native build.
