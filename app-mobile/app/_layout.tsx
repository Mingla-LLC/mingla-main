import '../src/i18n'  // Must be first — initializes i18next before any component renders
import { Stack } from "expo-router";
import * as Sentry from '@sentry/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { LogBox } from "react-native";
import { StripeNativeProvider } from "@mingla/payments-native";

// ORCH-0836: silence the Stripe RN 0.65.1 forwardRef warning emitted at module
// load by PaymentMethodMessagingElement.js — that file uses
// `forwardRef(function(_ref){...})` (one parameter) which React 19.1.0's
// stricter dev-mode arity check rejects. The component is NEVER rendered in
// Mingla code (verified by grep across packages/, app-mobile/src/,
// app-mobile/app/). The warning is informational noise that crowds out real
// diagnostic logs during development. This filter is third-party-warning
// specific and does NOT mask Mingla-side errors (the regex is anchored to
// the exact Stripe message). Remove once Stripe ships 0.66+ with the
// malformed forwardRef call fixed.
// See INVESTIGATION_ORCH-0836_STRIPE_FORWARDREF_REACT19_INCOMPAT.md.
LogBox.ignoreLogs([
  /forwardRef render functions accept exactly two parameters/,
]);

// ORCH-0679 Wave 2B-2: SINGLE source of truth for Sentry init.
// I-SENTRY-SINGLE-INIT — duplicate Sentry.init in app/index.tsx was deleted as
// part of this wave. Configs from both files are merged here.
//
// CI gate: scripts/ci/check-single-sentry-init.sh — fails if more than one
// Sentry.init call exists in app-mobile/.
Sentry.init({
  dsn: 'https://5bb11663dddc2efc612498d7a14b70f4@o4511136062701568.ingest.us.sentry.io/4511136064012288',

  // ── From original _layout.tsx config ──
  // TODO ORCH-0679-D3: privacy review — confirm sendDefaultPii intent.
  sendDefaultPii: true,
  enableLogs: true,

  // ── ORCH-0679 Wave 2B-2: Replay sample dropped 0.1 → 0.01 (10% → 1%).
  // 10% session-replay coverage caused ~5-15% sustained CPU on Snapdragon 6xx
  // Android during scroll. 1% is plenty for diagnostic sampling pre-launch.
  // DO NOT raise without ORCH approval — Android perf cost.
  replaysSessionSampleRate: 0.01,
  replaysOnErrorSampleRate: 1,
  integrations: [Sentry.mobileReplayIntegration()],

  // ── Merged from app/index.tsx (deleted in this wave) ──
  enableNativeFramesTracking: true,
  enableAutoSessionTracking: true,
  // Capture 100% of errors — we need every crash right now (no perf trace sampling).
  tracesSampleRate: 0,
  maxBreadcrumbs: 50,

  // CRITICAL: Sentry disabled in dev. Preserved from the deleted app/index.tsx
  // init so collection only fires in production builds.
  enabled: !__DEV__,
});

export default Sentry.wrap(function RootLayout() {
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
        <Stack screenOptions={{ headerShown: false }} />
      </StripeNativeProvider>
    </GestureHandlerRootView>
  );
});
