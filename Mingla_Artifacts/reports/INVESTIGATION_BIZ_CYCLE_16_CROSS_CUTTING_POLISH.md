# INVESTIGATION REPORT — BIZ Cycle 16 (Cross-Cutting Polish)

**Mode:** INVESTIGATE (decomposition recommendation requested)
**Cycle:** 16 (BIZ — closes Phase 5 alongside Cycles 14 + 15)
**Date:** 2026-05-04
**Confidence overall:** H
**Phase 0 ingest:** ✅ complete (cycle-16.md epic + Cycle 0a Sub-phase C.3 ErrorBoundary + Cycle 14 IMPL §12 + AGENT_HANDOFFS:503 + memory work-history)
**Phase 1 mission:** survey 6 journeys (offline / force-update / error-boundary / 404 / splash / permission-denied) + recommend decomposition strategy.
**Phase 2 manifest:** 12+ files read across `mingla-business/` (package.json + app.config.ts + eas.json + app/_layout.tsx + app/index.tsx + ErrorBoundary.tsx + scanner permission usage + 27-component kit inventory).
**Threads scoped:** 7 (J-X1..J-X6 + cross-cutting decomposition).
**Operator decisions queued:** 10 (D-16-1..D-16-10) for batched DEC-098 lock-in.

---

## 1 — Layman summary

Cycle 16 is the polish cycle that closes Phase 5 by handling the cross-cutting states every screen needs but no single screen owns. **6 journeys, very different sizes** — some are 1-hour patches (404 page, splash polish), others are multi-day (offline detection, force-update). The epic's "decompose carefully" guidance is correct.

**Phase 0 surfaced 3 important findings that reshape the work:**

1. **Sentry SDK is INSTALLED but DORMANT.** `@sentry/react-native ~7.2.0` is in package.json + plugin in app.config.ts, but **zero `Sentry.init()` calls anywhere in the codebase.** ErrorBoundary's `onError` prop is undefined. Component crashes get silently swallowed. The original D-IMPL-37 framing ("Sentry org/project not provisioned") was correct but understated — even WITH a provisioned project, the SDK doesn't fire.

2. **app/_layout.tsx has NO ErrorBoundary at root.** The primitive exists in the kit (`src/components/ui/ErrorBoundary.tsx`), but app entry doesn't wrap children with it. So component crashes hit Expo Router's default error screen, not the Mingla-branded "Something broke. We're on it." fallback.

3. **D-CYCLE14-IMPL-3 was a FALSE ALARM.** Cycle 14 IMPL flagged `expo-image-picker` first-use NSPhotoLibraryUsageDescription as unverified. Forensics confirmed `photosPermission` IS already configured in `app.config.ts` plugins block ("Mingla Business uses your photo library to upload brand and event imagery."). **Discovery closes at this CLOSE.**

**Recommendation: split into Cycle 16a (~10-12h quick wins + medium) + Cycle 16b (~24-28h infrastructure)**. Reasoning in §7.

---

## 2 — Investigation manifest (12+ files read)

| # | File | Journey | Key finding |
|---|------|---------|-------------|
| 1 | `mingla-business/package.json` | All | Sentry installed; no expo-updates; no netinfo; no expo-notifications; no expo-location |
| 2 | `mingla-business/app.config.ts` | J-X3 + J-X5 + J-X6 | Sentry plugin configured + photosPermission set + camera plugin set; no notification permission strings |
| 3 | `mingla-business/eas.json` | J-X2 | `appVersionSource: remote` + autoIncrement; SENTRY_DISABLE_AUTO_UPLOAD: true in ALL envs |
| 4 | `mingla-business/app/_layout.tsx` | J-X3 + J-X5 | NO ErrorBoundary wrap at root; NO SplashScreen.preventAutoHideAsync; bare Stack inside providers |
| 5 | `mingla-business/app/index.tsx` | J-X5 | Custom ActivityIndicator at loading state — flashes between native splash and BusinessWelcomeScreen |
| 6 | `mingla-business/src/components/ui/ErrorBoundary.tsx` | J-X3 | DefaultFallback present; "Get help" handler is `console.log` no-op (TRANSITIONAL since Cycle 0a); `onError` accepts external Sentry hook but no caller wires it |
| 7 | `mingla-business/src/components/ui/` (full kit listing) | All | 27 primitives — Toast, Modal, Sheet, ConfirmDialog, EmptyState, Spinner, etc. ALL J-X journeys can reuse without new primitives |
| 8 | `mingla-business/app/event/[id]/scanner/index.tsx:155-202` | J-X6 | One-off camera permission pattern with `useCameraPermissions` + `Linking.openSettings()` — proven working but not abstracted |
| 9 | `mingla-business/app/auth/index.tsx` | All (parity) | Second BusinessWelcomeScreen consumer wired via Cycle 15 v2 — confirms _layout-level changes propagate to BOTH signed-out routes |
| 10 | grep `Sentry.init` across src/ + app/ | J-X3 | **0 hits** — SDK never initialized |
| 11 | grep `Updates.check\|expo-updates` across src/ + app/ | J-X2 | **0 hits** — no version-check infrastructure |
| 12 | grep `NetInfo\|isConnected\|navigator.onLine` across src/ + app/ | J-X1 | **0 hits** (only datetimepicker false-positive) — no offline detection |
| — | grep `Linking.openSettings\|requestPermission` across src/ + app/ | J-X6 | 4 hits, all in scanner — confirms one-off pattern; not consolidated |

**Migration chain rule check:** N/A — Cycle 16 is pure UI/code; no schema changes.

---

## 3 — Per-journey 5-truth-layer cross-check + findings

### J-X1 — Offline detection + banner + retry pattern

| Layer | Finding |
|-------|---------|
| **Docs** | Constitution #3 (no silent failures) demands offline UX; #14 (persisted-state startup) demands graceful degradation on cold-start when offline. cycle-16.md notes "offline" is multi-day. |
| **Schema** | N/A |
| **Code** | Zero offline detection. Supabase calls fail with `Network request failed` → React Query retries default 3× with exponential backoff → final error surfaces to caller's onError handler. NO global banner; per-screen Alert.alert / inline error message. |
| **Runtime** | Operator on subway, sign-in attempt → 3-retry wait → "Couldn't sign you in" Alert (Cycle 0b copy). No "you're offline" hint. Operator on airplane → app loads (Welcome cached) but tap any button → silent retry loop → eventual error. |
| **Data** | React Query persists with `@tanstack/query-async-storage-persister` — stale data shows on cold offline. |

**Implementation shape:**
- Install `@react-native-community/netinfo` (~1h)
- NEW kit primitive `OfflineBanner` (yellow strip + "You're offline" copy + auto-hide on reconnect; ~50 LOC; reuses Toast wrap absolute pattern per memory rule)
- NEW hook `useNetworkStatus` reading NetInfo (native) / `navigator.onLine` (web) (~30 LOC)
- Mount `OfflineBanner` at `app/_layout.tsx` root (above Stack, below SafeAreaProvider)
- React Query: configure `networkMode: "offlineFirst"` to skip retries when offline (avoids battery drain)
- Web parity: `window.online`/`offline` events handled in `useNetworkStatus`

**Effort: ~12-15h** (multi-day per epic). Dependency add + new primitive + new hook + integration testing across native/web/transition states.

### J-X2 — Force-update prompt

| Layer | Finding |
|-------|---------|
| **Docs** | App Store policy: must respect user's choice not to update unless security-critical. Play Store: similar. EAS Update channel/branch flow is the OTA mechanism (used in Cycles 14 + 15 close protocols via `eas update --branch production`). |
| **Schema** | N/A |
| **Code** | Zero version-check infrastructure. Cycle 0b SDK install includes `expo-constants` (gives `Constants.expoConfig.version`) but no comparison-vs-latest logic. |
| **Runtime** | Operator on v1.0.0 (TestFlight build); we ship v1.1.0 with new schema requirement; v1.0.0 user signs in → Supabase RPC fails because mobile expects new column shape → error surfaces but no "please update" prompt. |
| **Data** | EAS Update branch state stored locally via `expo-updates`'s manifest cache — but only IF `expo-updates` is installed. Forensics confirms it's NOT installed. |

**Implementation shape:**
- Install `expo-updates` (transitively present? check) — verify via grep + package-lock
- NEW hook `useForceUpdateCheck` calling `Updates.checkForUpdateAsync()` on app foreground; compare runtime version
- NEW component `ForceUpdateModal` (full-screen blocking modal with "Update now" CTA → `Updates.fetchUpdateAsync()` + `Updates.reloadAsync()`)
- App.config.ts: configure `runtimeVersion` policy (semver vs build number)
- Web parity: web has no equivalent; check local timestamp vs deployment timestamp; soft-warn ("New version available — refresh?")

**Effort: ~12-15h** (multi-day). Dependency add + version logic + modal + EAS Update channel integration + test cross-platform + Apple/Play policy compliance review.

### J-X3 — Error boundary + Sentry wiring

| Layer | Finding |
|-------|---------|
| **Docs** | Cycle 0a Sub-phase C.3 IMPL report: "Sentry feedback link or in-app support flow" deferred to Cycle 14. AGENT_HANDOFFS:503 D-IMPL-37: "Sentry org/project not provisioned, Cycle 14." Cycle 14 closed without addressing this. |
| **Schema** | N/A (Sentry is external) |
| **Code** | `@sentry/react-native ~7.2.0` installed; expo plugin configured; **`Sentry.init({ dsn })` never called.** ErrorBoundary primitive exists but `app/_layout.tsx` doesn't wrap with it. **Two distinct gaps:** (a) Sentry never initialized → no crash capture; (b) ErrorBoundary not at root → component throws hit Expo Router default, not branded fallback. |
| **Runtime** | Component crash today: red-screen Expo dev / generic crash production. Sentry dashboard remains empty regardless. |
| **Data** | N/A |

**Implementation shape (split A + B):**

**A — ErrorBoundary at root (~5 LOC, ~30 min):**
```tsx
// app/_layout.tsx — wrap Stack
<ErrorBoundary>
  <Stack screenOptions={{ headerShown: false }} />
</ErrorBoundary>
```

**B — Sentry init + onError wire (~30 LOC, ~2h pending operator gate):**
```tsx
// app/_layout.tsx — top of file
import * as Sentry from "@sentry/react-native";
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enableAutoSessionTracking: true,
  // ...
});
// ErrorBoundary onError={Sentry.captureException}
```

**Operator pre-flight gates (D-16-2):**
- Sentry org/project provisioned? Get DSN.
- `EXPO_PUBLIC_SENTRY_DSN` env var set in `.env` + EAS secrets?
- `eas.json` SENTRY_DISABLE_AUTO_UPLOAD currently TRUE in all envs — should flip to false post-provisioning so source maps upload (without source maps, stack traces are unreadable).

**"Get help" CTA (deferred to Cycle 17 or Sentry Feedback widget):** ErrorBoundary's "Get help" button is currently `console.log` — Cycle 16a wires `Sentry.captureUserFeedback` if Sentry provisioned, OR opens `Linking.openURL("mailto:support@mingla.app")` as a TRANSITIONAL fallback.

**Effort: ~3-4h** (quick win if Sentry provisioned; ~6h if provisioning included).

### J-X4 — 404 / unknown-route

| Layer | Finding |
|-------|---------|
| **Docs** | Expo Router 6 supports `app/+not-found.tsx` for unknown routes. |
| **Schema** | N/A |
| **Code** | **No `+not-found.tsx`** in `app/`. Default Expo Router 404 screen renders (generic, off-brand). |
| **Runtime** | Web: navigate to `/garbage-route` → Expo Router default. Native: deep link to `mingla-business://garbage-route` → same. |
| **Data** | N/A |

**Implementation shape:**
- NEW `app/+not-found.tsx` (~30 LOC)
- Mingla-branded design: logo + "Hmm, that's not a real page." + "Go home" CTA → `router.replace("/")` → Index gate routes to Welcome (signed-out) or `/(tabs)/home` (signed-in)
- ui-ux-pro-max pre-flight at SPEC time per memory rule

**Effort: ~30 min** (quickest win). Reuses existing kit (LinearGradient, Button).

### J-X5 — Splash screen polish

| Layer | Finding |
|-------|---------|
| **Docs** | `expo-splash-screen ~31.0.13` installed. Default behavior: splash hides automatically after first frame renders. |
| **Schema** | N/A |
| **Code** | `app/_layout.tsx` doesn't call `SplashScreen.preventAutoHideAsync()` or `hideAsync()`. AuthContext bootstrap (`getSession()` + ensureCreatorAccount) runs on mount — during this, `app/index.tsx` shows custom `ActivityIndicator size="large"` with `#eb7825` color. **Two-step flash:** native splash (instant) → ActivityIndicator (~200-800ms while bootstrap completes) → BusinessWelcomeScreen logo entrance animation. Visually jarring. |
| **Runtime** | Cold launch: see splash → blank/spinner blink → Welcome animation. Total ~1-2s with visible transition. |
| **Data** | N/A |

**Implementation shape:**
- Wrap `_layout.tsx` with `SplashScreen.preventAutoHideAsync()` (top-level await) + `SplashScreen.hideAsync()` after AuthContext loading flips false
- Custom branded native splash asset (logo + warm-gradient background matching BusinessWelcomeScreen's `LinearGradient`) — currently uses default Expo splash placeholder
- Synchronize hide-timing with Welcome logo entrance animation so transition is seamless
- Minimum splash visible time (~500ms) to avoid hard blink on fast networks

**Effort: ~3-4h** (quick-medium). Asset prep + timing logic + cross-platform polish.

### J-X6 — Permission-denied (camera + image-picker; defer location + notifications)

| Layer | Finding |
|-------|---------|
| **Docs** | Apple HIG + Google policy: graceful permission denial with deeplink to Settings is industry-standard. |
| **Schema** | N/A |
| **Code** | Camera permission: `app/event/[id]/scanner/index.tsx:155-202` uses `useCameraPermissions` + `Linking.openSettings()` — works but is one-off, NOT consolidated. Image-picker: Cycle 14 `app/account/edit-profile.tsx` calls `requestMediaLibraryPermissionsAsync` — error path likely Alert.alert, not consolidated pattern. **Per-permission consolidation needed.** |
| **Runtime** | Camera denied → graceful "Open Settings" works. Image-picker denied → likely silent fail or generic Alert. |
| **Data** | N/A |

**SCOPE COLLAPSE for J-X6:**
- **IN scope:** camera (consolidate scanner pattern) + image-picker (Cycle 14 polish)
- **DEFER notifications:** `expo-notifications` NOT installed; depends on B-cycle OneSignal SDK + `user_notification_prefs` infra. No current surface to attach the pattern to.
- **DEFER location:** `expo-location` NOT installed; no current location-using surface in mingla-business. Speculative work.

**Implementation shape:**
- NEW utility `usePermissionWithFallback(permission, requester, openSettingsLabel)` in `src/hooks/` (~80 LOC)
- Consolidates: request → handle granted/denied → if denied with "never ask again" flag → show ConfirmDialog "Permission needed. Open Settings?" → `Linking.openSettings()`
- Refactor scanner camera flow to use new hook (preserves existing UX; reduces inline code)
- Add image-picker flow at `account/edit-profile.tsx` to use new hook

**Effort: ~6-8h** (medium). New hook + scanner refactor + image-picker consolidation + test denial paths.

### Thread 7 — Cross-cutting decomposition recommendation

See §7.

---

## 4 — Findings (classified)

### 🔴 D-CYCLE16-FOR-1 — Sentry SDK installed but DORMANT (root cause, ErrorBoundary contract broken)

**File + line:** `mingla-business/app/_layout.tsx` (entire file — `Sentry.init` never called) + `mingla-business/src/components/ui/ErrorBoundary.tsx:36` (`onError` accepts `ReactErrorBoundaryProps["onError"]` but no caller wires it).

**Exact code (root layout):**
```tsx
import { Stack } from "expo-router";
// ... NO Sentry import, NO Sentry.init() ...
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <Stack screenOptions={{ headerShown: false }} />
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```

**What it does today:** Component throws → React Error Boundary in `react-error-boundary` would catch IF wrapped, but no `<ErrorBoundary>` at root → Expo Router default crash screen renders. Sentry never receives the exception.

**What it should do:** Wrap `<Stack>` with `<ErrorBoundary onError={Sentry.captureException}>`. Initialize Sentry at module top of `_layout.tsx` with DSN from env.

**Causal chain:** SDK installed (Cycle 0a planning) → expo plugin configured → BUT `Sentry.init()` step never executed (D-IMPL-37 was about Dashboard provisioning; the missing init call is a separate gap not previously catalogued) → all error capture silently swallowed.

**Verification step:** Force a `throw new Error("test")` in any component; observe (a) red-screen in dev, (b) Sentry dashboard receives 0 events.

**Severity:** S1-high (silent failure of monitoring; product invisibility on production crashes).

### 🟠 D-CYCLE16-FOR-2 — `app/_layout.tsx` lacks ErrorBoundary at root (contributing factor to D-CYCLE16-FOR-1)

**File + line:** `mingla-business/app/_layout.tsx:8-20`.

**What it does:** Root renders `<Stack>` directly inside `<AuthProvider>`. Any component crash bubbles past AuthProvider's render boundary to Expo Router's default error UI.

**What it should do:** Wrap `<Stack>` with `<ErrorBoundary>` so the kit's branded fallback shows.

**Severity:** S1-high (UX silent failure — operator sees generic Expo crash, not Mingla-branded "We're on it").

### 🔵 D-CYCLE16-FOR-3 — D-CYCLE14-IMPL-3 false alarm CLOSED

**File + line:** `mingla-business/app.config.ts:48-52` (expo-image-picker plugin block).

**Exact code:**
```ts
[
  "expo-image-picker",
  {
    photosPermission:
      "Mingla Business uses your photo library to upload brand and event imagery.",
  },
],
```

**Finding:** Cycle 14 IMPL §12 D-CYCLE14-IMPL-3 flagged NSPhotoLibraryUsageDescription verification as pending. **It IS already configured** via the expo-image-picker plugin's `photosPermission` config (Expo auto-injects into iOS Info.plist at build time).

**Action:** Discovery CLOSED at Cycle 16 forensics. Update Cycle 14 IMPL report § discoveries to mark D-CYCLE14-IMPL-3 RESOLVED if not already.

### 🟠 D-CYCLE16-FOR-4 — Sentry source maps disabled in eas.json (contributing factor)

**File + line:** `mingla-business/eas.json:8, 13, 18` (3 envs).

**Exact code:** `"SENTRY_DISABLE_AUTO_UPLOAD": "true"` in all 3 build profiles (development, preview, production).

**What it does:** EAS Build skips Sentry source map upload → if/when Sentry init lands, stack traces will be unreadable (minified bundle line numbers only).

**What it should do:** Flip to `"false"` (or remove) in `production` profile once Sentry org/project provisioned + env DSN set.

**Severity:** S2-medium (Cycle 16 J-X3 must include eas.json flip as part of operator pre-deploy checklist).

### 🟡 D-CYCLE16-FOR-5 — Splash + AuthContext loading state unsynchronized (hidden flaw)

**File + line:** `mingla-business/app/_layout.tsx` (no `SplashScreen.preventAutoHideAsync`) + `mingla-business/app/index.tsx:10-16` (custom ActivityIndicator).

**What it does:** Native splash hides at first render → AuthContext still loading → custom spinner shows for ~200-800ms → Welcome screen entrance animation runs. **3-state visual flash** instead of seamless transition.

**What it should do:** `SplashScreen.preventAutoHideAsync()` at module load → hide manually after AuthContext loading flips to false → BusinessWelcomeScreen entrance animation continues from there.

**Severity:** S3-low (cosmetic; observable but not breaking).

### 🔵 D-CYCLE16-FOR-6 — J-X6 sub-journeys speculative without surfaces

**Finding:** `expo-notifications` + `expo-location` NOT installed in mingla-business. No current surface requests these permissions. Building a permission-denied UX without a surface to attach it to is speculative.

**Recommendation:** J-X6 scope reduces to camera + image-picker only. Notifications defer to B-cycle (alongside OneSignal SDK). Location defers indefinitely until a location-using surface emerges.

### 🟡 D-CYCLE16-FOR-7 — `expo-updates` not installed (J-X2 dependency)

**Finding:** `eas update --branch production` works at deploy-time via EAS CLI tooling. But CLIENT-SIDE `expo-updates` package needed for in-app `Updates.checkForUpdateAsync()` is NOT installed. Two different mechanisms. J-X2 IMPL needs new dep.

**Severity:** S2-medium (J-X2 blocker; new dep + native re-build required, not OTA-able).

---

## 5 — Reusable infrastructure inventory

| Need | Existing kit / hook | Reuse confidence |
|------|---------------------|------------------|
| Banner UI (offline + force-update + permission-denied) | `Toast.tsx` (with absolute wrap memory rule) | HIGH |
| Modal UI (force-update blocking) | `Modal.tsx` (Cycle 0a Sub-phase C.3) | HIGH |
| Confirm dialog UI (permission deeplink) | `ConfirmDialog.tsx` | HIGH |
| Empty state UI (404) | `EmptyState.tsx` | HIGH |
| Spinner | `Spinner.tsx` | HIGH |
| Error fallback | `ErrorBoundary.tsx` (DefaultFallback) | HIGH |
| Auth context | `AuthContext.tsx` (loading state for splash sync) | HIGH |
| Settings deeplink | `Linking.openSettings()` (RN core) | HIGH |
| App version | `Constants.expoConfig.version` | HIGH |
| EAS Update | `expo-updates` package | NEEDS INSTALL |
| Network status | `@react-native-community/netinfo` | NEEDS INSTALL |
| Permission consolidation | NEW `usePermissionWithFallback` hook | NEW |
| Offline banner | NEW `OfflineBanner` (or extend Toast) | NEW |
| Force-update modal | NEW `ForceUpdateModal` (or extend Modal) | NEW |

**Net new dependencies:** 2 (`@react-native-community/netinfo` + `expo-updates`). Both J-X1 + J-X2 require native rebuild via `eas build`, NOT OTA-able.

---

## 6 — Cross-platform parity matrix

| Journey | iOS native | Android native | Web bundle |
|---------|-----------|----------------|------------|
| J-X1 Offline | NetInfo | NetInfo | `navigator.onLine` + window events |
| J-X2 Force-update | expo-updates + native version | expo-updates + native version | Local timestamp vs deployment manifest fetch |
| J-X3 ErrorBoundary + Sentry | identical | identical | identical (Sentry has web SDK; check it's the universal package or web requires separate wire) |
| J-X4 404 | deep-link garbage | deep-link garbage | URL navigation to garbage path |
| J-X5 Splash | expo-splash-screen native | expo-splash-screen native | static index.html background color (no expo-splash-screen on web) |
| J-X6 Permission | iOS Settings deeplink | Android Settings deeplink | N/A (no permission prompts on web for mingla-business surfaces) |

**Web bundle has 4 journeys with platform-specific wrinkles.** SPEC must address per-platform shape explicitly.

---

## 7 — Decomposition recommendation: Cycle 16a + Cycle 16b

**Recommended split:**

### Cycle 16a (~10-12h) — Quick wins + medium polish
- **J-X3** (ErrorBoundary at root + Sentry init) — closes silent monitoring failure (S1) — ~3-4h
- **J-X4** (404 page) — quickest win — ~30 min
- **J-X5** (splash + AuthContext sync) — medium — ~3-4h
- **J-X6** (camera + image-picker permission consolidation) — medium — ~6-8h. **Scope-collapsed:** notifications + location DEFER.

**Effort total: ~13-17h.** Ships with NO new dependencies (Sentry already installed + permission helpers use RN core).

**Why bundle these:** All UI/code-only changes. Same deploy path. Each journey closes a silent-failure or polish gap. No native dependencies that block OTA.

### Cycle 16b (~24-28h) — Infrastructure resilience
- **J-X1** (offline detection + banner + retry) — ~12-15h. NEW dep `@react-native-community/netinfo`. Native rebuild via `eas build`.
- **J-X2** (force-update prompt) — ~12-15h. NEW dep `expo-updates`. Native rebuild + EAS Update channel integration.

**Why bundle these together:** Both require new native deps + `eas build` + cross-platform infra work. Bundling avoids 2 separate native rebuilds.

### Sequencing reasoning

- Cycle 16a ships immediately (OTA-able after `eas update`)
- Cycle 16b ships when operator commits to native rebuild window (typically batch with other native changes)
- Operator can defer 16b indefinitely if MVP traffic doesn't yet justify offline/force-update infra (low-traffic family-and-friends MVP per DEC-086 framing)

### Alternative (rejected): per-journey micro-cycles

6 separate cycles = 6 separate forensics + SPEC + IMPL + tester rounds. Coordination overhead exceeds the work. Operator's batch-decision pattern (DEC-095 / 096 / 097 "all agreed") favors fewer, larger decision rounds.

### Alternative (rejected): single Cycle 16

Mixing OTA-able quick wins with native-rebuild-required infrastructure forces all of 16a to wait for 16b's native rebuild. Loses the fast-feedback advantage of 16a.

---

## 8 — Operator decisions queued (10)

| ID | Question | Recommendation |
|----|----------|----------------|
| **D-16-1** | Decomposition strategy — single / 16a+16b split / per-journey? | **16a + 16b split** (forensics §7) |
| **D-16-2** | Sentry org/project provisioned + DSN ready? | If YES — J-X3 ships fully wired. If NO — J-X3 ships ErrorBoundary at root + `Sentry.init` placeholder TRANSITIONAL with EXIT condition "operator provisions DSN + flips eas.json SENTRY_DISABLE_AUTO_UPLOAD to false." |
| **D-16-3** | Force-update strictness (blocking modal vs dismissible banner)? | Blocking modal for major version bumps + breaking schema changes; soft banner for minor. Configurable via runtimeVersion policy. |
| **D-16-4** | Min-supported-version floor? | Latest published native version (downgrade pre-1.0.0 blocked by App Store/Play Store anyway). Cycle 16b SPEC defines exact policy. |
| **D-16-5** | Offline UX — banner + retry (graceful) OR full-screen blocker? | **Banner + retry** (graceful degradation; matches Constitution #3 honesty without paternalism). |
| **D-16-6** | Permission-denied UX consistency across types | **Consolidated pattern via `usePermissionWithFallback` hook** — applies to camera + image-picker in 16a; deferred surfaces (notifications + location) inherit when surfaces exist. |
| **D-16-7** | 404 brand voice — playful or terse? | Playful: "Hmm, that's not a real page." + "Go home" CTA. Matches Mingla Business friendly-and-direct tone. |
| **D-16-8** | Splash min-visible-time | 500ms minimum to avoid blink on fast networks. Hide on AuthContext loading=false (whichever is later). |
| **D-16-9** | Cross-cutting analytics — fire events on offline/error/404/permission-deny? | DEFER to analytics ORCH (Cycle 17 or B-cycle); Cycle 16 ships UX only. |
| **D-16-10** | If 16a+16b split confirmed, which ships first? | **16a first** (immediate OTA value); 16b when operator commits to native rebuild. |

---

## 9 — Memory rule deference matrix

| Rule | Per-journey relevance |
|------|----------------------|
| `feedback_implementor_uses_ui_ux_pro_max` | J-X1 banner + J-X4 404 + J-X5 splash + J-X6 dialog UX (mandatory pre-flight) |
| `feedback_keyboard_never_blocks_input` | N/A (no TextInputs in any J-X journey) |
| `feedback_rn_color_formats` | All journeys (any new colors must be hex/rgb/hsl/hwb) |
| `feedback_toast_needs_absolute_wrap` | J-X1 OfflineBanner + J-X3 ErrorBoundary toast + J-X6 permission toast |
| `feedback_rn_sub_sheet_must_render_inside_parent` | J-X2 ForceUpdateModal (if uses Sheet) |
| `feedback_diagnose_first_workflow` | This forensics report — orchestrator confirms decomposition before SPEC dispatch |
| `feedback_sequential_one_step_at_a_time` | 16a = 4 sequential journeys with tsc checkpoints; 16b = 2 sequential journeys with tsc checkpoints |
| `feedback_orchestrator_never_executes` | Orchestrator writes prompts only |
| `feedback_no_coauthored_by` | Commit messages omit AI attribution |
| `feedback_layman_first` | Every artifact entry leads with plain-English |

---

## 10 — Invariants

**Preserved across Cycle 16:**
- I-35 (Cycle 14 NEW soft-delete contract) — Cycle 16 doesn't touch creator_accounts; preserved by non-touch
- Constitution #1 No dead taps — every new error/offline/permission surface must respond
- Constitution #3 No silent failures — Cycle 16 specifically closes silent-failure gaps (Sentry dormant, ErrorBoundary not at root, offline silent retries)
- Constitution #14 Persisted-state startup — splash sync with cold-start auth bootstrap

**NEW invariant proposal (Cycle 16a SPEC time):**
- **I-36 ROOT-ERROR-BOUNDARY** — `app/_layout.tsx` MUST wrap `<Stack>` with `<ErrorBoundary>`; CI grep gate enforces. Reason: prevents the regression where Expo Router default crash UI bypasses the kit's branded fallback. Codifies what should have been there since Cycle 0a Sub-phase C.3.

---

## 11 — Confidence per thread

| Thread | Confidence | Rationale |
|--------|-----------|-----------|
| J-X1 Offline | H | Clear gap; standard library; well-known UX pattern |
| J-X2 Force-update | H | Clear gap; Apple/Play policy guidance well-documented; expo-updates is canonical |
| J-X3 ErrorBoundary + Sentry | H | Two distinct gaps fully traced (init + root wrap); operator gate on DSN provisioning surfaced |
| J-X4 404 | H | Trivial; Expo Router idiom |
| J-X5 Splash | H | Pattern documented; existing kit foundation |
| J-X6 Permission | M-H | Scope reduction needed (notifications + location speculative); camera + image-picker portions clear |
| Decomposition | H | Clean 2-cycle split with rationale |

**Overall: H** — proceed to operator decision lock-in then SPEC dispatches per chosen decomposition.

---

## 12 — Recommendation: lock decisions then dispatch SPEC for chosen cycle structure

All 7 threads H confidence. 10 D-16-N decisions queued with recommendations. Decomposition recommendation: **Cycle 16a + Cycle 16b split** with Cycle 16a first (immediate OTA value) and 16b when operator commits to native rebuild.

**Hand back to orchestrator for:**
1. REVIEW investigation
2. Surface 10 D-16-N decisions in plain English for batched lock-in (DEC-098)
3. Author SPEC dispatch(es) per chosen decomposition

If operator confirms 16a-first per recommendation → SPEC dispatch focuses on 4 journeys (J-X3 + J-X4 + J-X5 + J-X6 collapsed).

If operator wants single Cycle 16 instead → SPEC dispatch covers all 6 with extended timeline.

---

## 13 — Cross-references

- Dispatch: `Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_16_CROSS_CUTTING_POLISH.md`
- Epic: `Mingla_Artifacts/github/epics/cycle-16.md`
- Cycle 0a Sub-phase C.3 IMPL (ErrorBoundary contract): `Mingla_Artifacts/AGENT_HANDOFFS.md` line 503
- Cycle 14 IMPL §12 (D-CYCLE14-IMPL-3 false alarm closed at this CLOSE): `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_14_ACCOUNT_REPORT.md`
- Cycle 15 IMPL (paste-debris cleanup precedent for orchestrator-bundle commit pattern): `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_15_ORGANISER_LOGIN_REPORT.md`
- DEC-086 (founder-owned-workstream split — `mingla-marketing/` separate; orchestrator pipeline = mingla-business polish only): `Mingla_Artifacts/DECISION_LOG.md`
- BUSINESS_STRATEGIC_PLAN §6 (R12)
- Memory rules: 10 entries (per §9 matrix)
