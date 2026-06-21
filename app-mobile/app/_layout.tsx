import '../src/i18n'  // Must be first — initializes i18next before any component renders
// ORCH-0896 [Stripe forwardRef RedBox under React 19.1]: this side-effect file
// MUST import BEFORE @mingla/payments-native (and any other module that pulls
// @stripe/stripe-react-native). ES module imports hoist — the previous
// `LogBox.ignoreLogs([...])` at this file's top level (post-imports) fired
// AFTER the Stripe module had already emitted its forwardRef error, so the
// dev-menu Console Error overlay still surfaced on every launch. Moving the
// filter into a side-effect file imported at the FIRST import position arms
// the filter before the Stripe import evaluates.
// Originally tracked as DISC-QA-0892-A-RETEST-2-2 from ORCH-0892-A close.
// See app-mobile/src/diagnostics/silenceStripeForwardRef.ts for full rationale.
import '../src/diagnostics/silenceStripeForwardRef'
import React, { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import * as Sentry from '@sentry/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StripeNativeProvider } from "@mingla/payments-native";
import { MINGLA_THEME_FONTS } from "../src/theme/themeFonts";
import { verifyStripeModeAlignment } from "../src/services/stripeModeHandshake";

// ORCH-1125 [cold deep-link "No QueryClient set" crash]: the React Query
// provider was previously mounted inside the `/` (Home) route in app/index.tsx,
// making it a SIBLING of public deep-link routes (/t/, /b/, /brand/). A cold
// deep-link opened in a fresh process routed straight to one of those siblings
// before Home ever mounted, so its first useQuery ran with no QueryClient in
// context and crashed. The provider (+ its cacheReady cache-size gate, persist
// options, and the AnimatedSplashScreen overlay) is hoisted here to the root
// layout so it wraps <Stack/> and therefore EVERY route — cold or warm.
// Invariant: I-PROPOSED-RQ-PROVIDER-AT-ROOT-LAYOUT.
// CI gate: scripts/ci/check-rq-provider-at-root-layout.sh.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { queryClient, asyncStoragePersister } from "../src/config/queryClient";
import { shouldDehydrateMinglaQuery } from "../src/utils/queryPersistence";
import { useAppStore } from "../src/store/appStore";
import AnimatedSplashScreen from "../src/components/AnimatedSplashScreen";
// ORCH-1171: Done-only keyboard accessory bar + native keyboard frame provider.
import { KeyboardRoot } from "../src/wrappers/KeyboardRoot";
import { KeyboardToolbarRoot } from "../src/wrappers/KeyboardToolbarRoot";

// ORCH-0679 Wave 2B-2: SINGLE source of truth for Sentry init.
// I-SENTRY-SINGLE-INIT — duplicate Sentry.init in app/index.tsx was deleted as
// part of this wave. Configs from both files are merged here.
//
// CI gate: scripts/ci/check-single-sentry-init.sh — fails if more than one
// Sentry.init call exists in app-mobile/.
Sentry.init({
  dsn: 'https://5bb11663dddc2efc612498d7a14b70f4@o4511136062701568.ingest.us.sentry.io/4511136064012288',

  // ── From original _layout.tsx config ──
  // ORCH-0977 (2026-05-26) — privacy review complete; operator chose to keep
  // sendDefaultPii: true. Sentry receives IP, cookies, user-agent, and the
  // identified user ID. Both stores' privacy disclosures (Play Data Safety,
  // Apple Privacy Nutrition Labels) MUST list: Approximate Location (IP),
  // User ID, Diagnostics.
  sendDefaultPii: true,
  enableLogs: true,

  // ── ORCH-0679 Wave 2B-2: Replay sample dropped 0.1 → 0.01 (10% → 1%).
  // 10% session-replay coverage caused ~5-15% sustained CPU on Snapdragon 6xx
  // Android during scroll. 1% is plenty for diagnostic sampling pre-launch.
  // DO NOT raise without ORCH approval — Android perf cost.
  // ORCH-1064: 100% session-replay diagnostic was used to capture the device-only
  // input-capture freeze (no crash/hang/error to surface it otherwise). Freeze
  // root-caused (BaseBottomSheet half-open stall) + fixed (double-drive removal +
  // deterministic timing animation) + operator-confirmed on device 2026-06-03.
  // Reverted to 0.01 per the Android-perf rule above.
  replaysSessionSampleRate: 0.01,
  replaysOnErrorSampleRate: 1,
  integrations: [Sentry.mobileReplayIntegration()],

  // ── Merged from app/index.tsx (deleted in this wave) ──
  enableNativeFramesTracking: true,
  enableAutoSessionTracking: true,
  // Capture 100% of errors — we need every crash right now (no perf trace sampling).
  tracesSampleRate: 0,
  maxBreadcrumbs: 50,

  // ORCH-1064: capture main-thread freezes (app hangs / ANRs) with a stack trace.
  // The intermittent expanded-sheet freeze leaves no fatal crash, so without this
  // we get no diagnostics. iOS app-hang fires after the main thread stalls >2s;
  // the event flushes on recovery or the next launch.
  enableAppHangTracking: true,
  appHangTimeoutInterval: 2,

  // CRITICAL: Sentry disabled in dev. Preserved from the deleted app/index.tsx
  // init so collection only fires in production builds.
  enabled: !__DEV__,
});

export default Sentry.wrap(function RootLayout() {
  useFonts(MINGLA_THEME_FONTS);

  // ORCH-1056 — Stripe mode boot handshake. Verifies bundled pk prefix
  // matches the Supabase backend's MINGLA_STRIPE_MODE. Mismatch silently
  // breaks PaymentSheet; throwing at render lets Sentry capture the
  // misconfiguration before users hit a checkout dead-end.
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
    throw stripeModeError;
  }

  // ORCH-1125: hoisted from app/index.tsx's App(). Gate: clear oversized React
  // Query persisted cache BEFORE the provider mounts. PersistQueryClientProvider
  // crashes on mount if the cache exceeds Android's 2MB CursorWindow. Only clear
  // if the cache actually exceeds the safety threshold (1.5MB). The
  // shouldDehydrateQuery filter already excludes heavy queries, so the cache
  // should stay small. Preserving it enables instant startup with cached
  // prefs/location. This effect MUST resolve (cacheReady=true) before the
  // provider below mounts — load-bearing for Android.
  const [cacheReady, setCacheReady] = React.useState(false);
  const [splashDone, setSplashDone] = React.useState(false);

  React.useEffect(() => {
    const MAX_CACHE_BYTES = 1_500_000; // 1.5MB — below Android's 2MB CursorWindow limit
    AsyncStorage.getItem('REACT_QUERY_OFFLINE_CACHE')
      .then((cached) => {
        if (cached && cached.length > MAX_CACHE_BYTES) {
          return AsyncStorage.removeItem('REACT_QUERY_OFFLINE_CACHE');
        }
      })
      .catch(() => {})
      .finally(() => setCacheReady(true));
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* META-ORCH-0827 Pass 2 — Stripe PaymentSheet provider for native
          checkout from the consumer expanded sheet. Publishable key comes
          from EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY (same Mingla Connect
          platform key mingla-business uses). Requires native rebuild via
          EAS Build — see implementation report for the exact command. */}
      {/* ORCH-0834-rescoped (2026-05-14): merchantIdentifier + urlScheme
          props added per Stripe RN documented requirements (Apple Pay +
          3DS return). Values match app.json `scheme` (com.mingla.app.v2)
          and the Apple Merchant ID registered in Stripe Dashboard
          (merchant.com.mingla.app.v2). Env-var fallbacks
          EXPO_PUBLIC_STRIPE_MERCHANT_ID + EXPO_PUBLIC_STRIPE_URL_SCHEME
          are also supported via the StripeNativeProvider wrapper. */}
      <StripeNativeProvider
        merchantIdentifier="merchant.com.mingla.app.v2"
        urlScheme="com.mingla.app.v2"
      >
        {/* ORCH-0828 REWORK: portal provider deleted (Sub-A2 reverted).
            The business-event sheet now uses the inline `<BottomSheet>`
            pattern matching the proven TM/place sheet at
            ExpandedCardModal.tsx:1602-2066. Inline pattern does NOT need
            a provider — `<BottomSheet>` mounts in-tree and floats
            absolutely. New invariant:
            I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS. */}
        {/* ORCH-1125: the PersistQueryClientProvider wraps <Stack/> here at the
            root layout so EVERY route (cold deep-link or warm in-app nav) is a
            descendant and can call useQuery. It stays INSIDE StripeNativeProvider
            so route-level + AppContent useStripe() usage stays valid, and is
            gated by `cacheReady` so the Android 2MB-CursorWindow pre-clear above
            resolves before the provider mounts. Exactly ONE provider app-wide —
            do NOT re-add one in any route file (index.tsx). */}
        {cacheReady && (
          <KeyboardRoot>
            <PersistQueryClientProvider
              client={queryClient}
              persistOptions={{
                persister: asyncStoragePersister,
                maxAge: 24 * 60 * 60 * 1000, // 24 hours

                dehydrateOptions: {
                  // Exclude large/transient queries from persistence to prevent
                  // Android CursorWindow overflow (2MB SQLite row limit)
                  shouldDehydrateQuery: (query) => {
                    return shouldDehydrateMinglaQuery(query, useAppStore.getState().user?.id ?? null);
                  },
                },
              }}
            >
              <Stack screenOptions={{ headerShown: false }} />
            </PersistQueryClientProvider>
            {/* Sibling so the toolbar stays visually above the keyboard. */}
            <KeyboardToolbarRoot />
          </KeyboardRoot>
        )}
        {/* ORCH-1125: AnimatedSplashScreen renders immediately (independent of
            cacheReady) so its own useEffect fires as soon as it's painted — that's
            when it calls SplashScreen.hideAsync(). This guarantees the native
            splash is never dismissed before the React replacement is committed.
            Moved to root so the splash plays on EVERY cold launch, including cold
            deep-links (which never mount Home). */}
        {!splashDone && (
          <AnimatedSplashScreen onDone={() => setSplashDone(true)} />
        )}
      </StripeNativeProvider>
    </GestureHandlerRootView>
  );
});
