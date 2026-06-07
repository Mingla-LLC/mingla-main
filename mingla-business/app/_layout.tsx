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

// ORCH-0896 [Stripe forwardRef RedBox under React 19.1]: side-effect import
// arms the LogBox filter before route-level checkout screens can pull
// @stripe/stripe-react-native. See src/diagnostics/silenceStripeForwardRef.ts
// for full rationale.
// ORCH-0964: chunk-load resilience — auto-reload once on a failed JS-chunk
// fetch (the "needs multiple reloads to load" symptom). Loop-guarded. Web-only
// side effect; must arm before any route chunk can fail. See the module header.
import "../src/diagnostics/chunkReloadGuard";
import "../src/diagnostics/silenceStripeForwardRef";
import React, { useEffect, useRef, useState } from "react";
import {
  AppState,
  InteractionManager,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AppStateStatus,
} from "react-native";
import { Stack, usePathname, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { focusManager, QueryClientProvider } from "@tanstack/react-query";
import * as Sentry from "../src/diagnostics/sentry";
import * as SplashScreen from "expo-splash-screen";

import { AuthProvider, useAuth } from "../src/context/AuthContext";
import { queryClient } from "../src/config/queryClient";
import { ErrorBoundary } from "../src/components/ui/ErrorBoundary";
import { useCurrentBrandRecovery } from "../src/hooks/useCurrentBrandRecovery";
import { useBrand } from "../src/hooks/useBrands";
import { useCurrentBrandId } from "../src/store/currentBrandStore";
// ORCH-0892-A: KeyboardRoot wraps every downstream surface so
// react-native-keyboard-controller primitives can subscribe to native
// keyboard events. Web variant is a passthrough Fragment (library has no
// web entry point). Per SPEC_ORCH-0892-A §7.3.
import { KeyboardRoot } from "../src/wrappers/KeyboardRoot";
import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../src/constants/designSystem";
import { initializeAppsFlyer } from "../src/services/appsFlyerService";
import { mixpanelService } from "../src/services/mixpanelService";
import { revenueCatService } from "../src/services/revenueCatService";
import {
  initializeOneSignal,
  onForegroundNotification,
  onNotificationClicked,
} from "../src/services/oneSignalService";
import {
  processBusinessNotification,
  type BusinessNavTarget,
} from "../src/services/businessNotificationRouting";
import { usePushPermissionMoment } from "../src/hooks/usePushPermissionMoment";
import { verifyStripeModeAlignment } from "../src/services/stripeModeHandshake";

// Sub-B: a tap that arrives before auth is stashed here + replayed post-login
// (mirrors the consumer deferred-deeplink pattern). Keyed in AsyncStorage so a
// cold-launch from a tap survives the auth gate.
const DEFERRED_PUSH_TARGET_KEY = "mingla-business.deferredPushTarget.v1";

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

const ORCH_1092_SIGNED_OUT_ROUTES = new Set([
  "/hub/events",
  "/marketing",
  "/marketing/campaigns/compose",
  "/account",
]);

const ORCH_1093_SIGNED_IN_ROUTE_STATUS = {
  "/hub/events": "pending-proof",
  "/marketing": "pending-proof",
  "/marketing/campaigns/compose": "pending-proof",
  "/account": "pending-proof",
  "/event/create": "approved",
  "/hub/trips": "pending-proof",
  "/hub/experiences": "blocked",
  "/ari": "blocked",
  "/connect-account-management": "blocked",
} as const;

type Orch1093RouteStatus =
  (typeof ORCH_1093_SIGNED_IN_ROUTE_STATUS)[keyof typeof ORCH_1093_SIGNED_IN_ROUTE_STATUS];

const SUPABASE_AUTH_STORAGE_KEY = /^sb-.+-auth-token$/;

function normalizeWebPathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function getCurrentWebPathname(): string {
  if (Platform.OS !== "web" || typeof window === "undefined") return "";
  return normalizeWebPathname(window.location.pathname);
}

function isMobileWebRouteEntry(): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  const nav = window.navigator;
  const ua = nav.userAgent.toLowerCase();
  const uaDataMobile =
    "userAgentData" in nav &&
    typeof nav.userAgentData === "object" &&
    nav.userAgentData !== null &&
    "mobile" in nav.userAgentData &&
    nav.userAgentData.mobile === true;
  return (
    uaDataMobile ||
    /android|iphone|ipad|ipod|mobile/.test(ua) ||
    window.matchMedia("(max-width: 767px), (pointer: coarse)").matches
  );
}

function orch1093RouteStatus(pathname: string): Orch1093RouteStatus {
  return (
    ORCH_1093_SIGNED_IN_ROUTE_STATUS[
      pathname as keyof typeof ORCH_1093_SIGNED_IN_ROUTE_STATUS
    ] ?? "approved"
  );
}

function hasStoredSupabaseWebSession(): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  try {
    const { localStorage } = window;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key === null || !SUPABASE_AUTH_STORAGE_KEY.test(key)) continue;
      const value = localStorage.getItem(key);
      if (value !== null && value.includes("access_token")) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function shouldBlockOrch1093BeforeAuth(status: Orch1093RouteStatus): boolean {
  return status === "blocked" || (status === "pending-proof" && hasStoredSupabaseWebSession());
}

function Orch1093MobileRouteRecovery({
  pathname,
  status,
  onReturnHome,
}: {
  pathname: string;
  status: Exclude<Orch1093RouteStatus, "approved">;
  onReturnHome: () => void;
}): React.ReactElement {
  const routeLabel =
    pathname === "/hub/trips"
      ? "Hub Trips"
      : pathname === "/hub/experiences"
        ? "Hub Experiences"
        : pathname === "/ari"
          ? "Ari"
          : pathname === "/connect-account-management"
            ? "Payout account"
            : "this route";
  return (
    <View style={orch1092Styles.host}>
      <View style={orch1092Styles.card}>
        <Text style={orch1092Styles.eyebrow}>Mingla Business</Text>
        <Text style={orch1092Styles.title}>{routeLabel} is staying protected.</Text>
        <Text style={orch1092Styles.body}>
          {status === "pending-proof"
            ? "This phone-browser route is being slimmed down and still needs physical Android Chrome and mobile Safari proof before direct entry opens."
            : "This phone-browser route is not ready for direct entry yet, so Mingla is sending you back to the stable Home launcher."}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Return to Business Home"
          onPress={onReturnHome}
          style={({ pressed }) => [
            orch1092Styles.button,
            pressed && orch1092Styles.buttonPressed,
          ]}
        >
          <Text style={orch1092Styles.buttonText}>Return to Home</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Orch1092SignedOutRecovery({
  pathname,
  onReturnHome,
}: {
  pathname: string;
  onReturnHome: () => void;
}): React.ReactElement {
  const routeLabel =
    pathname === "/hub/events"
      ? "Hub Events"
      : pathname === "/marketing"
        ? "Marketing overview"
        : pathname === "/marketing/campaigns/compose"
          ? "Compose blast"
          : "Account settings";
  return (
    <View style={orch1092Styles.host}>
      <View style={orch1092Styles.card}>
        <Text style={orch1092Styles.eyebrow}>Mingla Business</Text>
        <Text style={orch1092Styles.title}>Sign in to open {routeLabel}.</Text>
        <Text style={orch1092Styles.body}>
          This phone-browser route is ready, but it needs a business session
          before it can load your brand data.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Return to Business Home"
          onPress={onReturnHome}
          style={({ pressed }) => [
            orch1092Styles.button,
            pressed && orch1092Styles.buttonPressed,
          ]}
        >
          <Text style={orch1092Styles.buttonText}>Return to Home</Text>
        </Pressable>
      </View>
    </View>
  );
}

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
  const { loading, user } = useAuth();
  const router = useRouter();
  const pathname = normalizeWebPathname(usePathname());
  const currentBrandId = useCurrentBrandId();
  const { isFetched: brandFetched, fetchStatus: brandFetchStatus } =
    useBrand(currentBrandId);
  const { isResolving: brandRecoveryResolving } = useCurrentBrandRecovery();
  const mountedAt = useRef<number | null>(null);
  const [splashHidden, setSplashHidden] = useState(false);
  const [brandFetchTimedOut, setBrandFetchTimedOut] = useState(false);

  useEffect(() => {
    mountedAt.current = Date.now();
  }, []);

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
    (currentBrandId === null && !brandRecoveryResolving) ||
    brandFetched ||
    (brandFetchStatus === "idle" && !brandRecoveryResolving) ||
    brandFetchTimedOut;

  useEffect(() => {
    if (loading || !brandReady || splashHidden) return;
    const elapsed = Date.now() - (mountedAt.current ?? Date.now());
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

  // ORCH-1056 — Stripe mode boot handshake. Verifies the bundled Stripe
  // publishable key prefix matches the Supabase backend's MINGLA_STRIPE_MODE.
  // Mismatch (e.g. pk_live_ on Vercel + rk_test_ on Supabase) silently
  // collapses the Stripe Connect embedded iframe; rather than letting users
  // hit that, we surface the mismatch as a fatal boundary error at boot.
  // Soft-warns (returns null) on transport failure so offline boot still
  // works. See src/services/stripeModeHandshake.ts.
  const [stripeModeError, setStripeModeError] = useState<Error | null>(null);
  useEffect(() => {
    let cancelled = false;
    void verifyStripeModeAlignment().catch((err) => {
      if (cancelled) return;
      setStripeModeError(err instanceof Error ? err : new Error(String(err)));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (stripeModeError) {
    // Re-throw during render so the surrounding ErrorBoundary catches it
    // and Sentry captures the mismatch context.
    throw stripeModeError;
  }

  if (
    Platform.OS === "web" &&
    !loading &&
    user === null &&
    ORCH_1092_SIGNED_OUT_ROUTES.has(pathname)
  ) {
    return (
      <Orch1092SignedOutRecovery
        pathname={pathname}
        onReturnHome={() => router.replace("/home" as never)}
      />
    );
  }

  const orch1093Status = orch1093RouteStatus(pathname);
  if (
    Platform.OS === "web" &&
    isMobileWebRouteEntry() &&
    orch1093Status !== "approved"
  ) {
    return (
      <Orch1093MobileRouteRecovery
        pathname={pathname}
        status={orch1093Status}
        onReturnHome={() => router.replace("/home" as never)}
      />
    );
  }

  // ORCH-0808 — optional install/analytics SDK init runs after first paint.
  // Auth identity binding + first-event fire happen in AuthContext on
  // SIGNED_IN; env-missing cases are no-op + logged warn. Deferring keeps
  // Android Home/Hub startup free of optional native SDK work.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const task = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => {
        initializeAppsFlyer();
        void mixpanelService.initialize();
        revenueCatService.initialize();
        initializeOneSignal();
      }, 0);
    });

    return () => {
      task.cancel();
      if (timer !== null) clearTimeout(timer);
    };
  }, []); // intentionally once

  // META-ORCH-1074 Sub-B — OS push-permission prompt at the value moment
  // (authenticated + a brand exists), one-shot, never on boot/account-only.
  usePushPermissionMoment(user !== null, currentBrandId);

  // META-ORCH-1074 Sub-B — foreground display + click handlers. Registered
  // after initializeOneSignal() (above). On web these are guarded no-ops
  // (the service never initializes the native module). Re-registers when the
  // signed-in user changes so the auth gate + deferred replay see fresh state.
  const userId = user?.id ?? null;
  useEffect(() => {
    // Foreground: show the system banner for every business push (consumer
    // chose "app feels alive"; SDK v5 needs an explicit display()).
    const removeForeground = onForegroundNotification((_data, _prevent, display) => {
      display();
    });

    // Tap (tray / lock screen / banner): mark read + track + navigate. When
    // unauthenticated, stash the resolved target for post-login replay.
    const removeClicked = onNotificationClicked((data) => {
      if (typeof data.type !== "string") return;
      processBusinessNotification(data, {
        router,
        isAuthenticated: userId !== null,
        stashDeferred: (target: BusinessNavTarget) => {
          void AsyncStorage.setItem(
            DEFERRED_PUSH_TARGET_KEY,
            JSON.stringify({ target, ts: Date.now() }),
          );
        },
      });
    });

    return () => {
      removeForeground();
      removeClicked();
    };
  }, [router, userId]);

  // META-ORCH-1074 Sub-B — replay a deferred push target once auth is ready.
  // A tap while logged out stashed a path; navigate to it after sign-in, then
  // clear the stash so it fires at most once.
  useEffect(() => {
    if (userId === null) return;
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const raw = await AsyncStorage.getItem(DEFERRED_PUSH_TARGET_KEY);
        if (raw === null || cancelled) return;
        await AsyncStorage.removeItem(DEFERRED_PUSH_TARGET_KEY);
        const parsed = JSON.parse(raw) as { target?: string };
        if (typeof parsed.target === "string" && parsed.target.length > 0) {
          router.push(parsed.target as never);
        }
      } catch (err) {
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.warn("[_layout] deferred push replay failed:", err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, router]);

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
    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange,
    );
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
        const { evictEndedEvents } =
          await import("../src/utils/evictEndedEvents");
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
        const { reapOrphanStorageKeys } =
          await import("../src/utils/reapOrphanStorageKeys");
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

const orch1092Styles = StyleSheet.create({
  host: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.xl,
    backgroundColor: canvas.discover,
  },
  card: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    borderRadius: radiusTokens.lg,
    padding: spacing.xl,
    backgroundColor: glass.tint.profileElevated,
  },
  eyebrow: {
    color: accent.warm,
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: spacing.sm,
  },
  title: {
    color: textTokens.primary,
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    marginBottom: spacing.md,
  },
  body: {
    color: textTokens.secondary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    marginBottom: spacing.lg,
  },
  button: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radiusTokens.md,
    backgroundColor: accent.warm,
    paddingHorizontal: spacing.lg,
  },
  buttonPressed: {
    opacity: 0.86,
  },
  buttonText: {
    color: textTokens.inverse,
    fontSize: typography.buttonLg.fontSize,
    lineHeight: typography.buttonLg.lineHeight,
    fontWeight: typography.buttonLg.fontWeight,
  },
});

export default function RootLayout(): React.ReactElement {
  // ORCH-1083: the 14 theme fonts are NO LONGER loaded here. They render only on
  // the 3 themed surfaces (PublicBrandPage/PublicEventPage/ThemeEditorSection),
  // which load the needed family on demand via `useThemeFont`. Do NOT re-add a
  // root `useFonts(...)` — it pulls all 14 @expo-google-fonts/* modules into the
  // boot bundle + fires 14 boot-time fetches on the login path. See SPEC §C-2.
  const webPathname = getCurrentWebPathname();
  const orch1093WebStatus = orch1093RouteStatus(webPathname);
  const shouldShowOuterOrch1093Recovery =
    Platform.OS === "web" &&
    isMobileWebRouteEntry() &&
    shouldBlockOrch1093BeforeAuth(orch1093WebStatus);
  const shouldShowOuterOrch1092Recovery =
    Platform.OS === "web" &&
    ORCH_1092_SIGNED_OUT_ROUTES.has(webPathname) &&
    !hasStoredSupabaseWebSession();

  if (shouldShowOuterOrch1093Recovery) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <Orch1093MobileRouteRecovery
            pathname={webPathname}
            status={orch1093WebStatus}
            onReturnHome={() => {
              window.location.assign("/home");
            }}
          />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  if (shouldShowOuterOrch1092Recovery) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <Orch1092SignedOutRecovery
            pathname={webPathname}
            onReturnHome={() => {
              window.location.assign("/home");
            }}
          />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/* ORCH-0964: top-level ErrorBoundary ABOVE the provider tree. A throw
            in QueryClientProvider / AuthProvider / KeyboardRoot init previously
            escaped RootLayoutInner's (inner) boundary and blanked the whole app
            white. This outer boundary catches it and shows the recoverable
            fallback. Kept inside Gesture/SafeArea so the fallback has its
            required context. */}
        <ErrorBoundary
          onError={(error, info) => {
            if (sentryDsn) {
              Sentry.captureException(error, {
                contexts: {
                  react: { componentStack: info.componentStack ?? "" },
                },
              });
            }
          }}
        >
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              {/* ORCH-0892-A: KeyboardRoot wraps the app shell and stays OUTSIDE
                  RootLayoutInner's ErrorBoundary. Stripe's native provider is
                  intentionally route-scoped to checkout payment screens so Home
                  startup does not initialize the payment SDK. */}
              <KeyboardRoot>
                <RootLayoutInner />
              </KeyboardRoot>
            </AuthProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
