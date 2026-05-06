# SPEC — BIZ Cycle 16a (Quick Wins + Medium Polish)

**Cycle:** 16a (BIZ — first half of decomposed Cycle 16; OTA-able)
**Status:** **BINDING** (DEC-098 locked 2026-05-04)
**Date:** 2026-05-04
**Decision lock-in:** `DECISION_LOG.md` DEC-098 (D-16-1 split + D-16-2 separate Sentry project + 3 orchestrator-default-accept locks)
**Investigation:** [`reports/INVESTIGATION_BIZ_CYCLE_16_CROSS_CUTTING_POLISH.md`](../reports/INVESTIGATION_BIZ_CYCLE_16_CROSS_CUTTING_POLISH.md)
**Dispatch:** [`prompts/SPEC_BIZ_CYCLE_16A_QUICK_WINS.md`](../prompts/SPEC_BIZ_CYCLE_16A_QUICK_WINS.md)
**Estimated effort:** ~13-17 hrs
**Codebase:** `mingla-business/` (mobile + web; OTA-able)

---

## 1 — Layman summary

Cycle 16a closes Phase 5 polish via 4 OTA-able journeys: monitoring goes live (Sentry init + ErrorBoundary at root) · Mingla-branded 404 page · seamless splash transition · consolidated permission denial UX (camera + image-picker). NO new dependencies; NO schema changes; NO mutations to existing stores.

DSN provided 2026-05-04 (`https://ba27572315b964df6edce0a4eb31a60a@o4511136062701568.ingest.us.sentry.io/4511334517243904`); operator-side EAS Secrets setup happens in parallel with IMPL.

NEW invariant **I-36 ROOT-ERROR-BOUNDARY** ratifies post-CLOSE: `app/_layout.tsx` MUST wrap `<Stack>` with `<ErrorBoundary>`; CI grep gate enforces.

---

## 2 — Scope · Non-goals · Assumptions

### IN SCOPE
- **J-X3** — `Sentry.init()` at module top of `app/_layout.tsx` + wrap `<Stack>` with `<ErrorBoundary onError={Sentry.captureException}>` + ErrorBoundary "Get help" handler upgrade
- **J-X4** — NEW `app/+not-found.tsx` Mingla-branded 404 page
- **J-X5** — `SplashScreen.preventAutoHideAsync()` at module top + manual `SplashScreen.hideAsync()` after AuthContext loading=false AND ≥500ms elapsed
- **J-X6** — NEW `src/hooks/usePermissionWithFallback.ts` consolidated permission hook + refactor scanner camera + edit-profile image-picker to use it
- `eas.json` flip: `SENTRY_DISABLE_AUTO_UPLOAD: "true"` → `"false"` in **production env only** (development + preview stay `true` to avoid dev-noise)

### OUT OF SCOPE (DEC-098 split → Cycle 16b)
- J-X1 Offline detection + banner (new dep `@react-native-community/netinfo`)
- J-X2 Force-update prompt (new dep `expo-updates`)
- Notifications permission UX (no surface yet — depends on B-cycle OneSignal SDK)
- Location permission UX (no surface yet — speculative)
- Custom branded splash asset replacement (defer to follow-up if Expo default acceptable post-J-X5 timing fix)
- Sentry feedback widget integration ("Get help" wires to `mailto:` TRANSITIONAL until widget ships)

### Non-goals
- Cross-cutting analytics events on offline/error/404/permission-deny (D-16-9 DEFER to analytics ORCH)
- Force-update strictness policy (D-16-3 deferred to 16b)
- Min-supported-version policy (D-16-4 deferred to 16b)
- Multi-language i18n
- Onboarding flow polish
- `mingla-marketing/` (founder-owned per DEC-086)

### Assumptions
- A1: Operator provides DSN + creates EAS Secrets per DEC-098 §setup-steps. If operator delays, J-X3 ships with `Sentry.init` guarded by env-absent check (TRANSITIONAL no-op until DSN env set).
- A2: `EXPO_PUBLIC_SENTRY_DSN` is the canonical env var name. Operator may also set `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` for source map upload (deploy-time, not IMPL-blocking).
- A3: `expo-image-picker` `photosPermission` is already configured (D-CYCLE16-FOR-3 confirmed); D-CYCLE14-IMPL-3 closes via this SPEC.
- A4: Memory rule `feedback_rn_sub_sheet_must_render_inside_parent` constrains J-X6 — ConfirmDialog must render inside consumer's render tree, not as a sibling Sheet.

---

## 3 — Per-layer specification

### 3.1 — J-X3 — ErrorBoundary at root + Sentry init

#### 3.1.1 `mingla-business/app/_layout.tsx` (MOD)

**Verbatim shape (top of file):**
```tsx
import { Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";
import * as Sentry from "@sentry/react-native";
import * as SplashScreen from "expo-splash-screen";

import { AuthProvider, useAuth } from "../src/context/AuthContext";
import { queryClient } from "../src/config/queryClient";
import { ErrorBoundary } from "../src/components/ui/ErrorBoundary";

// J-X3 — Sentry init (DEC-098 D-16-2). Guarded by env-absent so dev without
// DSN env set is a no-op, not a runtime error. EXIT condition: operator
// provisions DSN + sets EXPO_PUBLIC_SENTRY_DSN in .env / EAS Secrets.
const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    enableAutoSessionTracking: true,
    debug: __DEV__,
    tracesSampleRate: __DEV__ ? 1.0 : 0.2,
  });
}

// J-X5 — splash polish (DEC-098 D-16-8). Prevent auto-hide so we control
// the transition AFTER AuthContext bootstrap completes + ≥500ms elapsed.
SplashScreen.preventAutoHideAsync().catch(() => {
  // preventAutoHideAsync rejects on web (expo-splash-screen no-op on web);
  // safe to swallow — Constitution #3 exemption (this is a no-op platform
  // case, not a hidden failure).
});

const SPLASH_MIN_VISIBLE_MS = 500;
```

**RootLayout component:**
```tsx
function RootLayoutInner() {
  // J-X5 — splash hide synchronized with AuthContext bootstrap.
  const { loading } = useAuth();
  const mountedAt = useRef(Date.now());
  const [splashHidden, setSplashHidden] = useState(false);

  useEffect(() => {
    if (loading || splashHidden) return;
    const elapsed = Date.now() - mountedAt.current;
    const remaining = Math.max(0, SPLASH_MIN_VISIBLE_MS - elapsed);
    const timer = setTimeout(() => {
      void SplashScreen.hideAsync().catch(() => {
        // Web no-op or already-hidden race — Constitution #3 exemption.
      });
      setSplashHidden(true);
    }, remaining);
    return () => clearTimeout(timer);
  }, [loading, splashHidden]);

  return (
    <ErrorBoundary
      onError={(error, info) => {
        // J-X3 — Sentry capture with React component-stack as hint.
        if (sentryDsn) {
          Sentry.captureException(error, {
            contexts: {
              react: { componentStack: info.componentStack ?? "" },
            },
          });
        }
      }}
    >
      <Stack screenOptions={{ headerShown: false }} />
    </ErrorBoundary>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RootLayoutInner />
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```

**Notes:**
- `RootLayoutInner` exists because `useAuth()` requires `<AuthProvider>` ancestor; the splash + ErrorBoundary live INSIDE the providers, not at the absolute root
- `ErrorBoundary` from `src/components/ui/ErrorBoundary.tsx` (Cycle 0a Sub-phase C.3); already accepts `onError` prop; no kit modification needed beyond §3.1.2
- `Sentry.captureException` second argument accepts `hint` with `contexts` for React component-stack — improves Sentry issue grouping + readability
- `tracesSampleRate: 0.2` in production = 20% sample for performance traces (industry default); adjust later via DEC if cost concerns
- Web: `SplashScreen.preventAutoHideAsync()` rejects (no-op on web); catch + swallow — only platform-no-op case where silent failure is acceptable

**Lines changed:** ~+50 / -5 net.

#### 3.1.2 `mingla-business/src/components/ui/ErrorBoundary.tsx` (MOD)

**Current `handleGetHelp` (verbatim from Cycle 0a Sub-phase C.3):**
```ts
const handleGetHelp = (): void => {
  if (__DEV__) {
    console.log("[ErrorBoundary] Get help tapped (Sentry / support wiring deferred to Cycle 14)");
  }
};
```

**Replace with:**
```ts
const handleGetHelp = (): void => {
  // J-X3 — Cycle 16a wiring (DEC-098). Open mail-to support link as
  // TRANSITIONAL until Sentry feedback widget integration ships in a
  // future polish cycle. EXIT condition: Sentry feedback widget configured.
  void Linking.openURL("mailto:support@mingla.app").catch(() => {
    // No-op — operator's device may not have a mail client. Constitution
    // #3 exemption: this is a fallback help action, not a primary flow.
  });
};
```

Add import: `import { Linking } from "react-native";`

**Lines changed:** ~+10 / -3 net.

#### 3.1.3 `mingla-business/eas.json` (MOD)

**Current production env:**
```json
"production": {
  "autoIncrement": true,
  "env": {
    "SENTRY_DISABLE_AUTO_UPLOAD": "true"
  }
}
```

**Replace with:**
```json
"production": {
  "autoIncrement": true,
  "env": {
    "SENTRY_DISABLE_AUTO_UPLOAD": "false"
  }
}
```

**Development + preview envs:** unchanged (`SENTRY_DISABLE_AUTO_UPLOAD: "true"` stays — avoids dev-noise upload flooding the project).

**Lines changed:** 1 char (true → false in production block only).

### 3.2 — J-X4 — Mingla-branded 404 page

#### 3.2.1 `mingla-business/app/+not-found.tsx` (NEW)

**Effort:** ~30 LOC. **Pre-IMPL:** `/ui-ux-pro-max` query at IMPL Step 5.

**Verbatim shape:**
```tsx
import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "../src/components/ui/Button";
import {
  backgroundWarmGlow,
  colors,
  fontWeights,
  spacing,
  typography,
} from "../src/constants/designSystem";
import { HapticFeedback } from "../src/utils/hapticFeedback";

const logo = require("../assets/mingla_official_logo.png");

export default function NotFoundScreen(): React.ReactElement {
  const router = useRouter();

  const handleGoHome = (): void => {
    HapticFeedback.buttonPress();
    router.replace("/");
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false, title: "Not found" }} />
      <LinearGradient
        colors={[colors.background.primary, backgroundWarmGlow]}
        style={styles.gradient}
      >
        <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
          <View style={styles.content}>
            <Image
              source={logo}
              style={styles.logo}
              resizeMode="contain"
              accessibilityLabel="Mingla logo"
              accessibilityRole="image"
            />
            <Text style={styles.heading} accessibilityRole="header">
              Hmm, that&apos;s not a real page.
            </Text>
            <Text style={styles.subtext}>Maybe a typo? Or it moved?</Text>
            <View style={styles.cta}>
              <Button
                label="Go home"
                onPress={handleGoHome}
                variant="primary"
                size="md"
                accessibilityLabel="Go home"
              />
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>
    </>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  logo: {
    width: 140,
    aspectRatio: 1356 / 480,
    marginBottom: spacing.lg,
  },
  heading: {
    fontSize: 22,
    lineHeight: 30,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    textAlign: "center",
  },
  subtext: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: fontWeights.regular,
    color: colors.text.secondary,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  cta: {
    width: "100%",
    maxWidth: 320,
  },
});
```

**Notes:**
- `Stack.Screen` element overrides Expo Router defaults for this route — hides header (matches mingla-business pattern)
- `router.replace("/")` (NOT push) — back button can't return to the 404
- Reuses `LinearGradient` warm gradient from BusinessWelcomeScreen for brand consistency
- Mingla logo + accessibility labels per kit conventions

**Lines changed:** +95 LOC (NEW).

### 3.3 — J-X5 — Splash + AuthContext loading sync

Implementation lives entirely in `app/_layout.tsx` per §3.1.1 (`SplashScreen.preventAutoHideAsync()` + `RootLayoutInner` useEffect with 500ms minimum).

**No additional file changes for J-X5.** The kit and AuthContext are unchanged.

### 3.4 — J-X6 — Permission consolidation hook

#### 3.4.1 `mingla-business/src/hooks/usePermissionWithFallback.ts` (NEW)

**Verbatim shape:**
```ts
/**
 * usePermissionWithFallback — Cycle 16a (DEC-098 D-16-2 + I-36 sibling).
 *
 * Consolidates permission request + denial-fallback UX for camera +
 * image-picker (notifications + location DEFERRED per DEC-098 — speculative
 * without surfaces). Replaces one-off scanner pattern + Cycle 14 image-picker
 * inline error handling.
 *
 * Memory rule: ConfirmDialog renders inside consumer's component tree per
 * feedback_rn_sub_sheet_must_render_inside_parent.
 */

import { useCallback, useState } from "react";
import { Linking } from "react-native";

export type PermissionStatus = "undetermined" | "granted" | "denied" | "blocked";

export interface PermissionRequestResult {
  granted: boolean;
  canAskAgain: boolean;
}

export interface UsePermissionWithFallbackOpts {
  /**
   * Caller's permission request fn (e.g. camera's requestPermission OR
   * image-picker's requestMediaLibraryPermissionsAsync). MUST return
   * { granted, canAskAgain } shape.
   */
  request: () => Promise<PermissionRequestResult>;
  /** Human-readable label for ConfirmDialog title (e.g. "Camera"). */
  permissionLabel: string;
  /** Why we need it — appears in ConfirmDialog body. */
  permissionRationale: string;
}

export interface UsePermissionWithFallbackReturn {
  /** Current dialog visibility state — render ConfirmDialog with this. */
  settingsDialogVisible: boolean;
  /**
   * Request permission. If granted → returns true. If denied with
   * canAskAgain=false → opens settings dialog + returns false.
   * If denied with canAskAgain=true → returns false (caller may retry).
   */
  requestWithFallback: () => Promise<boolean>;
  /** Confirm action of settings dialog — opens OS Settings. */
  openSettings: () => void;
  /** Cancel action of settings dialog. */
  dismissSettingsDialog: () => void;
  /** ConfirmDialog title text. */
  dialogTitle: string;
  /** ConfirmDialog body text. */
  dialogBody: string;
}

export const usePermissionWithFallback = (
  opts: UsePermissionWithFallbackOpts,
): UsePermissionWithFallbackReturn => {
  const [settingsDialogVisible, setSettingsDialogVisible] = useState(false);

  const requestWithFallback = useCallback(async (): Promise<boolean> => {
    const result = await opts.request();
    if (result.granted) return true;
    // Denied path: if can't ask again → show settings dialog (deeplink path)
    if (!result.canAskAgain) {
      setSettingsDialogVisible(true);
    }
    return false;
  }, [opts]);

  const openSettings = useCallback((): void => {
    setSettingsDialogVisible(false);
    void Linking.openSettings().catch(() => {
      // No-op — Settings app unavailable (extremely rare); Constitution #3
      // exemption since this is a fallback path, not a primary flow.
    });
  }, []);

  const dismissSettingsDialog = useCallback((): void => {
    setSettingsDialogVisible(false);
  }, []);

  const dialogTitle = `${opts.permissionLabel} access needed`;
  const dialogBody = `${opts.permissionRationale} Open Settings to enable ${opts.permissionLabel.toLowerCase()} access.`;

  return {
    settingsDialogVisible,
    requestWithFallback,
    openSettings,
    dismissSettingsDialog,
    dialogTitle,
    dialogBody,
  };
};
```

**Lines changed:** +95 LOC (NEW).

#### 3.4.2 `mingla-business/app/event/[id]/scanner/index.tsx` (MOD)

**Current pattern (verbatim from forensics §3 J-X6):**
```ts
const [permission, requestPermission] = useCameraPermissions();
// ... later in component:
await requestPermission();
// ... if denied:
void Linking.openSettings();
```

**Refactor to use new hook:**
```ts
import { usePermissionWithFallback } from "../../../../src/hooks/usePermissionWithFallback";
import { ConfirmDialog } from "../../../../src/components/ui/ConfirmDialog";

// Inside component:
const [permission, requestPermission] = useCameraPermissions();

const cameraGate = usePermissionWithFallback({
  request: async () => {
    const result = await requestPermission();
    return {
      granted: result.granted,
      canAskAgain: result.canAskAgain ?? true,
    };
  },
  permissionLabel: "Camera",
  permissionRationale: "Mingla needs camera access to scan ticket QR codes at the door.",
});

// On scanner-open intent:
const handleOpenScanner = useCallback(async () => {
  const granted = await cameraGate.requestWithFallback();
  if (granted) {
    // proceed to scanner
  }
  // else: settings dialog handled by hook automatically
}, [cameraGate]);

// In JSX (inside parent render tree per memory rule):
<ConfirmDialog
  visible={cameraGate.settingsDialogVisible}
  title={cameraGate.dialogTitle}
  body={cameraGate.dialogBody}
  confirmLabel="Open Settings"
  cancelLabel="Not now"
  onConfirm={cameraGate.openSettings}
  onCancel={cameraGate.dismissSettingsDialog}
/>
```

**Lines changed:** ~+25 / -15 net (replaces inline pattern with hook + dialog).

#### 3.4.3 `mingla-business/app/account/edit-profile.tsx` (MOD)

Apply same pattern to image-picker permission flow (Cycle 14 J-A1 surface).

**Current pattern:** likely `await ImagePicker.requestMediaLibraryPermissionsAsync()` followed by `Alert.alert` on deny.

**Refactor:**
```ts
import { usePermissionWithFallback } from "../../src/hooks/usePermissionWithFallback";
import { ConfirmDialog } from "../../src/components/ui/ConfirmDialog";
import * as ImagePicker from "expo-image-picker";

// Inside component:
const photoGate = usePermissionWithFallback({
  request: async () => {
    const result = await ImagePicker.requestMediaLibraryPermissionsAsync();
    return {
      granted: result.granted,
      canAskAgain: result.canAskAgain ?? true,
    };
  },
  permissionLabel: "Photo library",
  permissionRationale: "Mingla needs photo access to upload your profile picture.",
});

// On photo-picker intent:
const handlePickPhoto = useCallback(async () => {
  const granted = await photoGate.requestWithFallback();
  if (!granted) return;
  const result = await ImagePicker.launchImageLibraryAsync({...});
  // ...
}, [photoGate]);

// JSX:
<ConfirmDialog
  visible={photoGate.settingsDialogVisible}
  title={photoGate.dialogTitle}
  body={photoGate.dialogBody}
  confirmLabel="Open Settings"
  cancelLabel="Not now"
  onConfirm={photoGate.openSettings}
  onCancel={photoGate.dismissSettingsDialog}
/>
```

**Lines changed:** ~+20 / -8 net.

---

## 4 — Numbered success criteria (16 SC)

| SC | Criterion | Test |
|----|-----------|------|
| SC-1 | `app/_layout.tsx` wraps `<Stack>` with `<ErrorBoundary>` | T-G1 grep |
| SC-2 | `Sentry.init()` called when `EXPO_PUBLIC_SENTRY_DSN` env set; no-op when env absent | T-G2 grep + T-01 |
| SC-3 | Component throw inside any tab → ErrorBoundary fallback renders ("Something broke. We're on it.") | T-02 manual |
| SC-4 | When DSN active, `Sentry.captureException` receives error event with React component-stack hint | T-03 manual (Sentry dashboard verification) |
| SC-5 | "Get help" button on ErrorBoundary fallback opens `mailto:support@mingla.app` | T-04 manual |
| SC-6 | NEW `app/+not-found.tsx` exists | T-G3 file presence |
| SC-7 | Navigate to unknown route (native deep link or web direct URL) → 404 page renders with logo + heading + "Go home" CTA | T-05 manual (web + native) |
| SC-8 | Tap "Go home" on 404 → `router.replace("/")` → Index gate routes per signed-in/signed-out state | T-06 manual |
| SC-9 | Cold launch: native splash visible → ≥500ms elapsed AND AuthContext loading=false → splash hides → Welcome animation continues seamlessly (no spinner flash) | T-07 manual |
| SC-10 | If AuthContext bootstrap finishes faster than 500ms, splash stays visible until 500ms minimum hit | T-08 manual (fast network) |
| SC-11 | If AuthContext bootstrap takes longer than 500ms (slow network), splash stays visible until bootstrap completes | T-09 manual (throttled network) |
| SC-12 | NEW `src/hooks/usePermissionWithFallback.ts` exports the typed hook | T-G4 grep |
| SC-13 | Camera permission denied with `canAskAgain=false` → ConfirmDialog "Camera access needed" shows; "Open Settings" → `Linking.openSettings()` | T-10 manual |
| SC-14 | Image-picker permission denied with `canAskAgain=false` → ConfirmDialog "Photo library access needed" shows | T-11 manual |
| SC-15 | tsc clean (only D-CYCLE12-IMPL-1/2 pre-existing errors persist) | T-G5 |
| SC-16 | `eas.json` production env has `SENTRY_DISABLE_AUTO_UPLOAD: "false"` (flipped from `"true"`); development + preview unchanged | T-G6 grep |

---

## 5 — Test cases (T-01..T-11 manual + T-G1..T-G6 grep + 4 regression)

### Manual smoke

| Test | Scenario | Layer | Steps |
|------|----------|-------|-------|
| T-01 | Sentry init runs when env set | Code | Set `EXPO_PUBLIC_SENTRY_DSN` in `.env`; cold launch; check console for Sentry init log (`debug: __DEV__` shows confirmation) |
| T-02 | ErrorBoundary renders fallback on component throw | Code | Add temporary `throw new Error("test")` to any rendered component; reload app; expect "Something broke. We're on it." |
| T-03 | Sentry captures component throw with component-stack | Runtime | Same as T-02 with DSN set; check Sentry dashboard issue feed for new event with React component stack visible |
| T-04 | Get help opens mailto | Component | After triggering ErrorBoundary fallback, tap "Get help"; expect mail client to open with `support@mingla.app` recipient |
| T-05 | 404 renders for unknown route | Component | Web: navigate to `localhost:8081/garbage-route`. Native: deep link to `mingla-business://garbage`. Both: expect Mingla-branded 404 |
| T-06 | 404 "Go home" navigates correctly | Component | On 404 page, tap "Go home". Signed out → BusinessWelcomeScreen. Signed in → /(tabs)/home |
| T-07 | Splash transition seamless | Runtime | Cold launch on iOS device; expect native splash → smooth transition to Welcome (no spinner flash visible) |
| T-08 | Splash min-visible 500ms | Runtime | Cold launch on Wi-Fi (fast network); time splash with stopwatch; expect ≥500ms before transition |
| T-09 | Splash respects bootstrap delay | Runtime | Throttle network to 3G in iOS Simulator; cold launch; expect splash stays visible until AuthContext loading flips false (>500ms) |
| T-10 | Camera permission deny → settings dialog | Component | Open scanner; deny camera permission at OS prompt; deny again until iOS marks `canAskAgain=false`; expect ConfirmDialog "Camera access needed"; tap Open Settings; expect iOS Settings app opens to Mingla Business permissions |
| T-11 | Image-picker permission deny → settings dialog | Component | Open Edit Profile (Cycle 14 J-A1); tap avatar; deny photo permission; deny again; expect ConfirmDialog "Photo library access needed" |

### Grep gates (static)

| Test | Command | Expected |
|------|---------|----------|
| T-G1 | `grep -cE "<ErrorBoundary" mingla-business/app/_layout.tsx` | **1** (the wrap around `<Stack>`) |
| T-G2 | `grep -cE "Sentry\.init" mingla-business/app/_layout.tsx` | **1** |
| T-G3 | `ls mingla-business/app/+not-found.tsx` | file exists |
| T-G4 | `grep -cE "export const usePermissionWithFallback" mingla-business/src/hooks/usePermissionWithFallback.ts` | **1** |
| T-G5 | `cd mingla-business && npx tsc --noEmit` | only D-CYCLE12-IMPL-1/2 pre-existing |
| T-G6 | `grep -A1 "production" mingla-business/eas.json \| grep "SENTRY_DISABLE_AUTO_UPLOAD"` | shows `"false"` in production env block |

### Regression spot-checks

| Test | Scenario | Layer |
|------|----------|-------|
| T-Reg-1 | Cycle 14 delete + recovery flow unchanged | Full stack manual |
| T-Reg-2 | Cycle 15 email-OTP sign-in unchanged | Full stack manual |
| T-Reg-3 | Google + Apple OAuth web flow unchanged (Cycle 0b) | Full stack manual |
| T-Reg-4 | Scanner camera permission UX still works post-refactor (existing operator unaffected) | Component manual |

---

## 6 — Implementation order (9 sequential steps with tsc checkpoints)

| Step | Action | tsc checkpoint? |
|------|--------|-----------------|
| 0 | **Operator pre-IMPL Step 0:** confirm `EXPO_PUBLIC_SENTRY_DSN` set in `.env` (or accept TRANSITIONAL ship — see §11). Ideally also: `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` in EAS Secrets for source map upload. | N/A |
| 1 | NEW `src/hooks/usePermissionWithFallback.ts` per §3.4.1 verbatim | ✅ |
| 2 | Refactor `app/event/[id]/scanner/index.tsx` to use new hook (J-X6 part 2) | ✅ |
| 3 | Refactor `app/account/edit-profile.tsx` to use new hook (J-X6 part 3) | ✅ |
| 4 | NEW `app/+not-found.tsx` per §3.2.1 verbatim (J-X4) | ✅ |
| 5 | **`/ui-ux-pro-max` pre-flight** — query "saas mobile cross-cutting polish error 404 splash brand reveal minimal trust" --domain product. Apply returned guidance to J-X4 + J-X5 visuals. | N/A |
| 6 | MOD `app/_layout.tsx` — Sentry init + ErrorBoundary wrap + SplashScreen prevent/hide per §3.1.1 verbatim (J-X3 + J-X5) | ✅ |
| 7 | MOD `eas.json` — flip `SENTRY_DISABLE_AUTO_UPLOAD` to `"false"` in production env per §3.1.3 (J-X3) | ✅ (no-op for tsc; verify JSON valid) |
| 8 | MOD `src/components/ui/ErrorBoundary.tsx` — update `handleGetHelp` per §3.1.2 (J-X3) | ✅ |
| 9 | Final tsc + 6 grep gates + IMPL report writing (15-section template) | ✅ |

**Each code-touching step gets tsc checkpoint** per memory rule `feedback_sequential_one_step_at_a_time`.

---

## 7 — Invariants

### Preserved
- **I-35** (Cycle 14 NEW soft-delete contract) — Cycle 16a doesn't touch `creator_accounts` or auth flow; preserved by non-touch
- **Constitution #1 No dead taps** — all new buttons (404 "Go home" + ConfirmDialog "Open Settings" + ErrorBoundary "Get help" + "Try again") wired with `onPress` handlers
- **Constitution #2 One owner per truth** — `ErrorBoundary` is the canonical fallback; no duplicate
- **Constitution #3 No silent failures** — Sentry captures all uncaught component errors; permission denials surface ConfirmDialog; 404 surfaces branded screen. Three explicit Constitution #3 exemptions documented in §3 (web platform-no-op for SplashScreen + mailto fallback for Get help + openSettings unavailability) — all are platform/fallback edge cases, not silent swallows of real errors
- **Constitution #14 Persisted-state startup** — splash + AuthContext synced ensures AuthContext bootstrap completes before transition; no rendering on stale cache

### NEW — I-36 ROOT-ERROR-BOUNDARY (ratifies post-CLOSE)

**Definition:** `mingla-business/app/_layout.tsx` MUST wrap `<Stack>` with `<ErrorBoundary>` (the kit primitive at `src/components/ui/ErrorBoundary.tsx`).

**Why:** Cycle 0a Sub-phase C.3 shipped the ErrorBoundary primitive but never wired it at root — Cycle 16a closes this gap permanently. Codifies the structural pattern so future regressions (someone removing the wrap during a refactor) get caught.

**Enforcement:** CI grep gate `grep -c "<ErrorBoundary" mingla-business/app/_layout.tsx` MUST return ≥1. Add to `.github/workflows/` lint check (or local pre-commit hook if no CI yet).

**Status:** DRAFT pre-Cycle-16a CLOSE. Operator flips DRAFT → ACTIVE on close.

---

## 8 — Memory rule deference matrix

| Rule | Compliance plan |
|------|-----------------|
| `feedback_implementor_uses_ui_ux_pro_max` | Step 5 mandatory pre-flight before J-X4 + J-X5 visual work |
| `feedback_keyboard_never_blocks_input` | N/A — no TextInputs in 16a |
| `feedback_rn_color_formats` | All new styles use hex/rgb/hsl/hwb (verified at IMPL Step 9 grep) |
| `feedback_toast_needs_absolute_wrap` | N/A — Cycle 16a uses ConfirmDialog (kit primitive), not Toast |
| `feedback_rn_sub_sheet_must_render_inside_parent` | J-X6 ConfirmDialog renders inside scanner + edit-profile component trees (NOT as sibling Sheet) — verified at §3.4.2 + §3.4.3 |
| `feedback_diagnose_first_workflow` | Investigation + SPEC + DEC-098 already complete |
| `feedback_sequential_one_step_at_a_time` | 9-step impl order with tsc checkpoint after each code-touching step |
| `feedback_orchestrator_never_executes` | Orchestrator wrote SPEC dispatch; this SPEC; operator dispatches IMPL |
| `feedback_no_coauthored_by` | Commit messages omit AI attribution |

---

## 9 — Regression prevention

For **I-36** (NEW root ErrorBoundary):
- Grep gate at IMPL final + ratifies in CI
- Protective comment in `app/_layout.tsx`: "Cycle 16a (DEC-098 + I-36): ErrorBoundary at root is REQUIRED — do not remove without orchestrator approval."

For **Sentry init** (J-X3):
- Env-absent guard means SDK ships in TRANSITIONAL mode if DSN unset; explicit comment documents EXIT condition
- `tracesSampleRate` value documented in code comment (rationale: 20% production sample to balance cost vs visibility)

For **Splash + AuthContext sync** (J-X5):
- `SPLASH_MIN_VISIBLE_MS` constant at top of file (single source of truth for the 500ms lock from DEC-098 D-16-8)

For **Permission consolidation** (J-X6):
- Hook is generic — any future permission surface uses same pattern; reduces drift
- Test coverage at IMPL: T-10 + T-11 manual smoke (camera + image-picker) verifies the hook works for both consumers

---

## 10 — Operator pre-IMPL gates

1. **Sentry DSN already provided** (2026-05-04): `https://ba27572315b964df6edce0a4eb31a60a@o4511136062701568.ingest.us.sentry.io/4511334517243904`. Operator adds to `mingla-business/.env` as `EXPO_PUBLIC_SENTRY_DSN=<value>` BEFORE IMPL Step 1 (or accept TRANSITIONAL ship — Sentry init no-ops without env).
2. **`SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT`** to EAS Secrets via `eas secret:create` — required for source map upload during EAS Update post-IMPL deploy. NOT IMPL-blocking; can complete in parallel.
3. **eas.json flip** is performed by IMPL Step 7 (no operator action needed — implementor change).

If operator hasn't completed (1) by IMPL start, J-X3 ships with the env-absent guard and documents TRANSITIONAL state in IMPL report. EXIT condition: operator sets env post-deploy + next OTA picks up the active SDK.

---

## 11 — Verification commands template

```bash
cd mingla-business

# 1. T-G1 — ErrorBoundary at root
grep -cE "<ErrorBoundary" app/_layout.tsx
# Expected: 1

# 2. T-G2 — Sentry.init present
grep -cE "Sentry\.init" app/_layout.tsx
# Expected: 1

# 3. T-G3 — 404 file present
ls app/+not-found.tsx
# Expected: file exists

# 4. T-G4 — Permission hook exported
grep -cE "export const usePermissionWithFallback" src/hooks/usePermissionWithFallback.ts
# Expected: 1

# 5. T-G5 — tsc clean
npx tsc --noEmit | grep -v "\.expo[/\\]types[/\\]router\.d\.ts"
# Expected: only D-CYCLE12-IMPL-1 (events.tsx:720) + D-CYCLE12-IMPL-2 (brandMapping.ts:180) pre-existing

# 6. T-G6 — eas.json production flip
grep -A1 '"production"' eas.json | grep "SENTRY_DISABLE_AUTO_UPLOAD"
# Expected: "SENTRY_DISABLE_AUTO_UPLOAD": "false"
```

---

## 12 — Cross-references

- Investigation: [`reports/INVESTIGATION_BIZ_CYCLE_16_CROSS_CUTTING_POLISH.md`](../reports/INVESTIGATION_BIZ_CYCLE_16_CROSS_CUTTING_POLISH.md)
- Decision lock-in: `DECISION_LOG.md` DEC-098 (D-16-1 split + D-16-2 separate Sentry project + 3 orchestrator-default-accept locks)
- SPEC dispatch: `prompts/SPEC_BIZ_CYCLE_16A_QUICK_WINS.md`
- Cycle 0a Sub-phase C.3 ErrorBoundary contract: `Mingla_Artifacts/AGENT_HANDOFFS.md` line 503
- Cycle 14 IMPL D-CYCLE14-IMPL-3: status now CLOSED via D-CYCLE16-FOR-3 false-alarm verification (this SPEC)
- Cycle 15 IMPL: precedent for orchestrator-bundle commit pattern (line-238 hotfix + v2 rework + IMPL bundled)
- I-36 NEW invariant: ratifies post-Cycle-16a CLOSE
- Memory rules: 8 entries per §8 matrix
- Sentry React Native v7 docs: https://docs.sentry.io/platforms/react-native/

---

**End of SPEC. Status BINDING per DEC-098 lock 2026-05-04.**
