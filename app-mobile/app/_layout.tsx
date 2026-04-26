import '../src/i18n'  // Must be first — initializes i18next before any component renders
import { Stack } from "expo-router";
import * as Sentry from '@sentry/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

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
      <Stack screenOptions={{ headerShown: false }} />
    </GestureHandlerRootView>
  );
});
