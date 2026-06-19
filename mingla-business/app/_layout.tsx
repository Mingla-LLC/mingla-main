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
  ActivityIndicator,
  AppState,
  InteractionManager,
  Platform,
  StyleSheet,
  View,
  type AppStateStatus,
} from "react-native";
import { Redirect, Stack, useRouter, usePathname } from "expo-router";
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
import { canvas } from "../src/constants/designSystem";
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
// ORCH-1102 — route-agnostic auth routing with no dead-ends. Pure, unit-tested
// predicates: an unauthenticated user on ANY web route redirects to the real
// sign-in screen; while auth is still resolving we show a LOADING state. These
// supersede the ORCH-1092 `shouldShowSignedOutRecovery` route-list gate.
import {
  AUTH_RESOLUTION_CEILING_MS,
  isAuthResolutionExpired,
  isPublicBuyerRoute,
  isSelfAuthenticatedExemptRoute,
  isSignInRoute,
  isWebAuthResolving,
  shouldRedirectToSignInFromRoute,
} from "../src/utils/coldLoadAuthGates";

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
    environment: __DEV__
      ? "development"
      : (process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? "production"),
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

// ORCH-1102 — ALL route-stub gates removed.
//
// History: ORCH-1092 added a signed-out RECOVERY card (a per-route dead-end
// landing) for 5 web routes, and ORCH-1093 added a mobile-web route FIREWALL
// stub. ORCH-1100 emptied the firewall block-list (so it never fired — dormant
// dead code). Both were route-stub gates that left users hanging: the signed-out
// card dead-ended back to Home, redundant with the real sign-in screen.
//
// Operator intent (ORCH-1102): remove all of it. If a user becomes
// unauthenticated — on ANY route — route them back to the real sign-in screen
// (`BusinessWelcomeScreen`, via `/`). If a user cancels an authentication
// mid-process, route them back too. Users are never left hanging. The decision
// is route-agnostic (no route list, no firewall, no per-route card): see
// `shouldRedirectToSignIn` + `isWebAuthResolving` in coldLoadAuthGates.ts.
//
// ORCH-1115 [anon-buyer web funnel restored]: the ONE intentional exception to
// "route-agnostic" is the PUBLIC BUYER allowlist (`PUBLIC_BUYER_ROUTE_PREFIXES`
// in coldLoadAuthGates.ts). A genuinely logged-out guest on a share-link /
// guest-checkout / receipt route (`/e/ /t/ /b/ /exp/ /checkout* /o/ /booking/`)
// must NOT be bounced to the sign-in wall — `shouldRedirectToSignInFromRoute`
// (web) and `nativeRedirectToSignIn` (native) both consult `isPublicBuyerRoute`
// so the exemption lives in exactly one place. The exemption can ONLY suppress a
// redirect on a public route; every authed-only route still redirects.

// ORCH-1102 Wave 2 — REMOUNT-IMMUNE auth-resolution deadline anchor.
//
// A deadlock can remount the layout tree faster than the ceiling, which would
// reset any per-mount timer forever. We anchor the resolving-start in a
// MODULE-LEVEL timestamp (the module stays loaded across React remounts) and
// poll elapsed wall-clock against the ceiling. `markAuthResolveStart` stamps
// once (idempotent), `clearAuthResolveStart` resets the window when auth
// resolves, and `hasAuthResolutionDeadlinePassed` is the pure elapsed check.
const AUTH_RESOLUTION_DEADLINE_POLL_MS = 500;
let authResolveStartedAt: number | null = null;
function markAuthResolveStart(): void {
  if (authResolveStartedAt === null) authResolveStartedAt = Date.now();
}
function clearAuthResolveStart(): void {
  authResolveStartedAt = null;
}
function hasAuthResolutionDeadlinePassed(): boolean {
  if (authResolveStartedAt === null) return false;
  return Date.now() - authResolveStartedAt >= AUTH_RESOLUTION_CEILING_MS;
}

const SUPABASE_AUTH_STORAGE_KEY = /^sb-.+-auth-token$/;

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

// ORCH-1102 — the shared LOADING screen shown while web auth is still resolving
// (cold direct-load / bookmark / refresh of an authed route, session warming).
// NOT a dead-end card and NOT a flash of sign-in — a plain spinner that gives
// way to the real screen once the session warms or to sign-in once it is clear
// the user is logged out. Native never renders this (the splash covers boot).
function AuthResolvingScreen(): React.ReactElement {
  return (
    <View style={authRoutingStyles.host}>
      <ActivityIndicator size="large" color="#eb7825" />
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
  // ORCH-1103 — the current route, so the unauthenticated redirect never targets
  // the route it is already on (the `/` → `/` self-redirect loop that produced
  // React #185 + the sign-out white screen). Read unconditionally before any
  // deferred return (Rules-of-Hooks; preserves the ORCH-1098 all-hooks-run fix).
  const pathname = usePathname();
  const currentBrandId = useCurrentBrandId();
  const { isFetched: brandFetched, fetchStatus: brandFetchStatus } =
    useBrand(currentBrandId);
  // ORCH-1133 — SOLE authoritative owner of the global current-brand WRITE.
  // RootLayoutInner is the highest always-mounted node for any authenticated
  // business session, so this single mount fully covers brand recovery; the 4
  // other useCurrentBrandRecovery() mounts ((tabs)/_layout, home, event/create,
  // useBusinessTodos) are read-only consumers (no authoritative flag). This
  // collapses the prior 5+ concurrent writers to one, killing the
  // "Maximum update depth exceeded" store-write ping-pong. Do NOT pass
  // authoritative:true anywhere else.
  const { isResolving: brandRecoveryResolving } = useCurrentBrandRecovery({
    authoritative: true,
  });
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

  // ORCH-1102 — route-agnostic auth routing with NO dead-ends.
  //
  // Two decisions, both decoupled from the pathname (no route list, no
  // firewall, no per-route card). Computed here with NO hooks; the actual
  // returns are DEFERRED to after every hook runs (Rules-of-Hooks — preserves
  // the ORCH-1098 Stage 5 React #300 fix: all hooks call unconditionally).
  //
  //   1. RESOLVING — auth is still warming (bootstrap in flight, OR finished
  //      but a stored web session is restoring a beat later via a late
  //      SIGNED_IN / TOKEN_REFRESHED). Show a LOADING spinner — never a flash
  //      of sign-in, never a dead-end. (Native: false; the splash covers boot.)
  //   2. REDIRECT — auth has RESOLVED and there is genuinely no user (logout,
  //      token expiry, session loss, RLS 401). On ANY web route, send the user
  //      to `/`, which renders the real BusinessWelcomeScreen. No card, no
  //      blank screen, no infinite spinner.
  //
  // `hasStoredSupabaseWebSession()` is false for real logged-out users, so they
  // redirect immediately (no spinner trap); true during the warming window, so
  // a warming session shows LOADING (no false-logged-out flash).
  const isWeb = Platform.OS === "web";
  const hasStoredWebSession = hasStoredSupabaseWebSession();
  const authResolving = isWebAuthResolving({
    isWeb,
    loading,
    hasUser: user !== null,
    hasStoredWebSession,
  });
  // ORCH-1103 — loop-safe: do NOT redirect to `/` when already on `/`. A layout
  // that redirects to the route it governs re-triggers navigation every render
  // → React #185 → torn-down tree → white screen. When already at sign-in we
  // render the Stack so `index.tsx` shows BusinessWelcomeScreen instead.
  const redirectToSignIn = shouldRedirectToSignInFromRoute({
    isWeb,
    loading,
    hasUser: user !== null,
    hasStoredWebSession,
    pathname,
  });

  // ORCH-1106 [native authenticated, no-brand degraded shell] — NATIVE
  // unauth → sign-in route guard. On web, `shouldRedirectToSignInFromRoute`
  // (above) already bounces a no-user session on a non-sign-in route back to
  // `/`. Native had NO such guard: when AuthContext signs the user out AFTER
  // boot (e.g. the ORCH-1106 boot-session-probe detecting a server-revoked
  // stale session, or any server-fired SIGNED_OUT) while the user is mounted
  // inside `(tabs)`, nothing navigated away — the user was stranded on the
  // brand-less degraded shell ("Create brand" + Home/Account-only nav). This
  // redirect closes that gap on native, mirroring the web behaviour.
  //
  // GUARDS: only when bootstrap has FINISHED (`!loading`) — never redirect
  // mid-bootstrap (would race the splash / cause a sign-in flash on a warming
  // session). Only when there is genuinely NO user. Loop-safe: never redirect
  // to `/` while already at `/` (same React-#185 protection as the web path).
  //
  // ORCH-1115 [anon-buyer web funnel restored]: ALSO exempt the PUBLIC BUYER
  // routes (`isPublicBuyerRoute` / `PUBLIC_BUYER_ROUTE_PREFIXES` — the SINGLE
  // source of truth shared with the web path above). This is a NO-OP on native
  // today (business native serves none of these routes), but routing the
  // public-route exemption through the one shared helper keeps the allowlist in
  // exactly one place and hardens against a future native public route.
  //
  // ORCH-1139 [stripe-connect-route-gate]: ALSO exempt the SELF-AUTHENTICATING
  // routes (`isSelfAuthenticatedExemptRoute` — Stripe-Connect seller routes +
  // invite-accept routes). A no-op on native today (business native serves none
  // of these), but keeping the exemption in the one shared helper hardens against
  // a future native connect/invite route — same rationale as the ORCH-1115 note.
  const nativeRedirectToSignIn =
    !isWeb &&
    !loading &&
    user === null &&
    !isSignInRoute(pathname) &&
    !isPublicBuyerRoute(pathname) &&
    !isSelfAuthenticatedExemptRoute(pathname);

  // ORCH-1102 Wave 2 — BOUNDED-LOADING backstop at the UI gate. The AuthContext
  // hard ceiling (AUTH_RESOLUTION_HARD_CEILING_MS) releases `loading` if the
  // GoTrue web-lock deadlocks; this is the belt-and-suspenders companion for the
  // residual case where a stale stored web session lingers (so `authResolving`
  // would otherwise keep the spinner up even after `loading` flips). Once auth
  // has been RESOLVING past the ceiling with no user, we stop spinning and treat
  // it as logged-out → redirect to the real sign-in screen. Seth's hard rule: a
  // user is NEVER left on an infinite spinner. The ceiling is well above the
  // normal warm + race + lock-self-heal budget, so a genuinely slow-but-valid
  // session resolves (user appears → app renders) BEFORE this ever fires — no
  // false logged-out flash. Web-only; native never reaches the resolving gate.
  //
  // REMOUNT- AND RENDER-LOOP-IMMUNE: a deadlock can remount the tree AND spin a
  // tight re-render loop (observed on the offline static build: ~66 renders/sec,
  // which clears any per-mount setTimeout/setInterval before it can fire). So the
  // deadline is anchored in a MODULE-LEVEL monotonic timestamp (survives
  // remounts) and EVALUATED AT RENDER TIME — every render re-reads the anchor, so
  // even a render loop converges on the deadline within milliseconds of the
  // ceiling. The interval below is only a wakeup for the OPPOSITE case (a quiet
  // deadlock with NO render loop) so a re-render is forced once near the ceiling.
  // Stamp the resolving-start once it begins; clear ONLY when a real user
  // appears. We deliberately do NOT clear on a transient non-resolving render:
  // under the deadlock render loop `authResolving` can flicker, and clearing on
  // every flicker would reset the window forever (the window must accumulate to
  // the ceiling). A genuinely logged-out resolved state hides the spinner via
  // `authResolving === false` anyway, so a lingering anchor is harmless and is
  // reset on the next real sign-in.
  if (isWeb && authResolving && user === null) {
    markAuthResolveStart(); // idempotent: stamps once, persists across remounts
  } else if (isWeb && user !== null) {
    clearAuthResolveStart(); // real session → fresh window for a later cold load
  }
  // Pure, unit-tested predicate (fails-on-revert). `elapsedMs` is the live
  // wall-clock since the persistent anchor, read at render time.
  const authResolutionExpired = isAuthResolutionExpired({
    isWeb,
    hasUser: user !== null,
    stillResolving: authResolving,
    elapsedMs: authResolveStartedAt === null ? 0 : Date.now() - authResolveStartedAt,
  });

  // Wakeup interval for a QUIET deadlock (no render loop to re-evaluate the
  // anchor): forces a single re-render shortly after the ceiling so the
  // render-time check above runs. Harmless under a render loop (the check
  // already runs every render). Cleared once expired or no longer resolving.
  const [, forceDeadlineTick] = useState(0);
  useEffect(() => {
    if (!isWeb) return;
    if (!authResolving || user !== null || authResolutionExpired) return;
    const interval = setInterval(() => {
      if (hasAuthResolutionDeadlinePassed()) {
        console.warn(
          `[_layout] auth-resolution-deadline: still resolving after ${AUTH_RESOLUTION_CEILING_MS}ms — routing to sign-in (no infinite spinner)`,
        );
        forceDeadlineTick((n) => n + 1);
      }
    }, AUTH_RESOLUTION_DEADLINE_POLL_MS);
    return () => clearInterval(interval);
  }, [isWeb, authResolving, user, authResolutionExpired]);

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

  // ORCH-1102 — auth-routing returns DEFERRED to here so every hook above runs
  // unconditionally on every render (Rules-of-Hooks / React #300 fix, ORCH-1098
  // Stage 5). Order matters: RESOLVING (spinner) is checked before REDIRECT so
  // a warming session never flashes sign-in.
  // ORCH-1102 Wave 2 — BOUNDED LOADING: if auth has been resolving past the
  // hard ceiling (deadlock), stop spinning and route to sign-in. Checked BEFORE
  // the spinner so a deadlocked session never traps the user on an infinite
  // spinner — it lands them somewhere actionable (the real sign-in screen).
  // ORCH-1103 — the ceiling-expired redirect ALSO targets `/`; guard it with the
  // same already-at-sign-in check so a deadlocked session that resolves to "no
  // user" while sitting on `/` does not enter the `/` → `/` self-redirect loop.
  // When already at `/`, fall through to render the Stack (welcome screen).
  const atSignInRoute = isSignInRoute(pathname);
  if (authResolutionExpired && !atSignInRoute) {
    return <Redirect href="/" />;
  }
  // ORCH-1103 — never spin (or self-redirect) ON the sign-in route once the
  // resolution ceiling has passed with no user: render the Stack so
  // BusinessWelcomeScreen shows. A genuinely warming session before the ceiling
  // still shows the spinner (no false sign-in flash); this only fires after the
  // deadlock backstop, honoring Seth's "never an infinite spinner" rule at `/`.
  if (authResolving && !(atSignInRoute && authResolutionExpired)) {
    return <AuthResolvingScreen />;
  }
  if (redirectToSignIn) {
    // Genuinely logged out on a NON-sign-in web route → the real sign-in screen.
    // `/` renders BusinessWelcomeScreen for a no-user session. `redirectToSignIn`
    // is already false when at `/` (ORCH-1103 loop guard), so this never targets
    // the route it is on.
    return <Redirect href="/" />;
  }
  if (nativeRedirectToSignIn) {
    // ORCH-1106 — NATIVE: bootstrap finished with no user (signed out post-boot,
    // including the boot-session-probe self-heal) while NOT on the sign-in route
    // → route to `/` so index.tsx renders BusinessWelcomeScreen. Loop-safe:
    // `nativeRedirectToSignIn` is false when already at `/`.
    return <Redirect href="/" />;
  }

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

const authRoutingStyles = StyleSheet.create({
  host: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: canvas.discover,
  },
});

export default function RootLayout(): React.ReactElement {
  // ORCH-1083: the 14 theme fonts are NO LONGER loaded here. They render only on
  // the 3 themed surfaces (PublicBrandPage/PublicEventPage/ThemeEditorSection),
  // which load the needed family on demand via `useThemeFont`. Do NOT re-add a
  // root `useFonts(...)` — it pulls all 14 @expo-google-fonts/* modules into the
  // boot bundle + fires 14 boot-time fetches on the login path. See SPEC §C-2.
  //
  // ORCH-1102: the OUTER pre-provider route-stub recovery checks are GONE. All
  // auth routing now lives INSIDE the provider tree in RootLayoutInner, where
  // AuthContext is the source of truth — an unauthenticated user on any web
  // route redirects to the real sign-in screen, and a warming session shows a
  // loading spinner (no dead-end card, ever).
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
