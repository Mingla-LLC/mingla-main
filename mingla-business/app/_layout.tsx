/**
 * Root layout — Cycle 16a J-X3 + J-X5 (DEC-098).
 *
 * J-X3: Sentry.init at module top (env-absent-guarded for TRANSITIONAL ship
 *   when EXPO_PUBLIC_SENTRY_DSN unset). ErrorBoundary wraps Stack so all
 *   component throws hit the Mingla-branded fallback + Sentry capture.
 *   Codifies NEW invariant I-36 ROOT-ERROR-BOUNDARY.
 *
 * J-X5: SplashScreen.preventAutoHideAsync at module top + manual hideAsync
 *   gated by AuthContext loading=false AND ≥500ms elapsed (DEC-098 D-16-8).
 *   Eliminates 3-state visual flash on cold-launch.
 *
 * RootLayoutInner exists because useAuth() requires AuthProvider ancestor;
 * splash + ErrorBoundary live INSIDE the providers, not at absolute root.
 *
 * Per Cycle 16a SPEC §3.1.1.
 */

import React, { useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { focusManager, QueryClientProvider } from "@tanstack/react-query";
import * as Sentry from "@sentry/react-native";
import * as SplashScreen from "expo-splash-screen";

import { AuthProvider, useAuth } from "../src/context/AuthContext";
import { queryClient } from "../src/config/queryClient";
import { ErrorBoundary } from "../src/components/ui/ErrorBoundary";
import { useBrand } from "../src/hooks/useBrands";
import { useCurrentBrandId } from "../src/store/currentBrandStore";

// J-X3 — Sentry init (DEC-098 D-16-2). Guarded by env-absent so dev/build
// without DSN is a no-op, not a runtime error. EXIT condition: operator
// provisions DSN + sets EXPO_PUBLIC_SENTRY_DSN in .env / EAS Secrets.
const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    enableAutoSessionTracking: true,
    debug: __DEV__,
    // 100% trace sample in dev for visibility; 20% in production to balance
    // cost vs visibility. Adjust via DEC if production volume changes.
    tracesSampleRate: __DEV__ ? 1.0 : 0.2,
  });
}

// J-X5 — splash polish (DEC-098 D-16-8). Prevent auto-hide so we control
// the transition AFTER AuthContext bootstrap completes + ≥500ms elapsed.
SplashScreen.preventAutoHideAsync().catch(() => {
  // preventAutoHideAsync rejects on web (expo-splash-screen no-op on web).
  // Constitution #3 documented exemption: this is a no-op platform case,
  // not a hidden failure. Native iOS/Android resolve normally.
});

const SPLASH_MIN_VISIBLE_MS = 500;
// ORCH-0743 / C1: 2s hard timeout for the brand-fetch gate. If the network
// hasn't responded by then, release the splash anyway — flash falls back
// to ORCH-0742 baseline behavior. Prevents indefinite splash on bad networks.
const BRAND_FETCH_TIMEOUT_MS = 2000;

function RootLayoutInner(): React.ReactElement {
  // J-X5 — splash hide synchronized with TWO gates:
  //   1. AuthContext bootstrap completes (loading: false)
  //   2. useBrand(currentBrandId) has fetched OR currentBrandId is null
  //      OR the 2s hard-timeout fired
  //
  // ORCH-0743 / Cycle 2 polish: gate 2 is NEW post-ORCH-0742. It closes the
  // Const #14 gap where the wrapper hook returned null during the fetch
  // window, causing TopBar/home/events to render empty-state during cold-start
  // with persisted brand. The 2s hard-timeout prevents indefinite splash on
  // bad networks (graceful fallback to ORCH-0742 baseline — flash, not hang).
  //
  // Note on `fetchStatus === "idle"`: when `enabled: false` (currentBrandId
  // === null), React Query reports `fetchStatus: "idle"` and `isFetched: false`
  // indefinitely. We accept "idle" as ready because there's no fetch to wait
  // for. The `currentBrandId === null` short-circuit also handles this case;
  // both paths converge on `brandReady=true` (defensive belt-and-suspenders).
  const { loading } = useAuth();
  const currentBrandId = useCurrentBrandId();
  const { isFetched: brandFetched, fetchStatus: brandFetchStatus } = useBrand(currentBrandId);
  const mountedAt = useRef(Date.now());
  const [splashHidden, setSplashHidden] = useState(false);
  const [brandFetchTimedOut, setBrandFetchTimedOut] = useState(false);

  // 2s hard-timeout: if useBrand hasn't resolved within 2s of auth bootstrap
  // completing, release the splash anyway.
  useEffect(() => {
    if (loading) return; // auth still bootstrapping; no timeout yet
    if (brandFetchTimedOut) return;
    const timer = setTimeout(() => {
      setBrandFetchTimedOut(true);
    }, BRAND_FETCH_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loading, brandFetchTimedOut]);

  const brandReady =
    currentBrandId === null ||
    brandFetched ||
    brandFetchStatus === "idle" ||
    brandFetchTimedOut;

  useEffect(() => {
    if (loading || !brandReady || splashHidden) return;
    const elapsed = Date.now() - mountedAt.current;
    const remaining = Math.max(0, SPLASH_MIN_VISIBLE_MS - elapsed);
    const timer = setTimeout(() => {
      void SplashScreen.hideAsync().catch(() => {
        // Web no-op or already-hidden race. Constitution #3 exemption:
        // hideAsync is idempotent + platform-no-op on web; not a real failure.
      });
      setSplashHidden(true);
    }, remaining);
    return () => clearTimeout(timer);
  }, [loading, brandReady, splashHidden]);

  // ORCH-0740 Cycle 1: AppState → React Query focusManager wiring.
  // When the app comes back to foreground, tell React Query to refetch
  // stale queries that have refetchOnWindowFocus enabled (the default).
  // Cross-platform: react-native-web 0.21.0 shims AppState 'change' events
  // to document.visibilitychange + window.focus/blur, so this single code
  // path works identically on iOS, Android, and Expo Web.
  useEffect(() => {
    const handleAppStateChange = (status: AppStateStatus): void => {
      focusManager.setFocused(status === "active");
    };
    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return (): void => {
      subscription.remove();
    };
  }, []);

  // Cycle 17d §C — TTL evict ended-event entries from phone stores (30d post end_at).
  // Runs once after auth bootstrap completes (signal that Zustand persist hydration is done).
  const [evictionRan, setEvictionRan] = useState(false);
  useEffect(() => {
    if (loading || evictionRan) return;
    void (async () => {
      try {
        const { evictEndedEvents } = await import(
          "../src/utils/evictEndedEvents"
        );
        const result = evictEndedEvents();
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log(
            `[Cycle17d §C] Evicted ${result.evictedEntryCount} entries from ${result.evictedEventCount} ended events.`,
          );
        }
      } catch (error) {
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.error("[Cycle17d §C] evictEndedEvents threw:", error);
        }
      }
      setEvictionRan(true);
    })();
  }, [loading, evictionRan]);

  // Cycle 17d §D — orphan-key safety net (log-only; operator promotes to auto-clear in future cycle).
  const [reapRan, setReapRan] = useState(false);
  useEffect(() => {
    if (loading || reapRan) return;
    void (async () => {
      try {
        const { reapOrphanStorageKeys } = await import(
          "../src/utils/reapOrphanStorageKeys"
        );
        await reapOrphanStorageKeys();
      } catch (error) {
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.error("[Cycle17d §D] reapOrphanStorageKeys threw:", error);
        }
      }
      setReapRan(true);
    })();
  }, [loading, reapRan]);

  return (
    <ErrorBoundary
      onError={(error, info) => {
        // J-X3 — Sentry capture with React component-stack hint. Sentry SDK
        // tolerates uninit case gracefully (no-op if Sentry.init never ran).
        if (sentryDsn) {
          Sentry.captureException(error, {
            contexts: {
              react: {
                componentStack: info.componentStack ?? "",
              },
            },
          });
        }
      }}
    >
      <Stack screenOptions={{ headerShown: false }} />
    </ErrorBoundary>
  );
}

export default function RootLayout(): React.ReactElement {
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
