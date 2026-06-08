// orch-strict-grep-allow safearea-on-fullscreen-routes — Index renders BusinessWelcomeScreen (handles SafeArea internally via SafeAreaView at BusinessWelcomeScreen.tsx:463) or brief boot ActivityIndicator; intentional thin wrapper
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { Redirect } from "expo-router";
import AppRoutes from "../src/config/routes";
import { useAuth } from "../src/context/AuthContext";
import BusinessWelcomeScreen from "../src/components/auth/BusinessWelcomeScreen";
import { AUTH_RESOLUTION_CEILING_MS } from "../src/utils/coldLoadAuthGates";

// ORCH-1102 Wave 2 — REMOUNT-IMMUNE boot-loading deadline anchor (mirrors the
// _layout backstop). A deadlock can remount this route faster than the ceiling,
// resetting a per-mount timer forever; a module-level timestamp survives
// remounts. Stamped once while loading, cleared when loading resolves, polled
// against the ceiling. Web-only.
const BOOT_DEADLINE_POLL_MS = 500;
let bootLoadingStartedAt: number | null = null;
function markBootLoadingStart(): void {
  if (bootLoadingStartedAt === null) bootLoadingStartedAt = Date.now();
}
function clearBootLoadingStart(): void {
  bootLoadingStartedAt = null;
}
function hasBootDeadlinePassed(): boolean {
  if (bootLoadingStartedAt === null) return false;
  return Date.now() - bootLoadingStartedAt >= AUTH_RESOLUTION_CEILING_MS;
}

// ORCH-1098 Stage 3: the mobile→static-home redirect is GONE. The BottomNav
// reanimated OOM (the reason phones could not boot the real app) is fixed in
// BottomNav.web.tsx, so signed-in phones now run the real Expo app exactly like
// desktop — no static safety-page detour.
export default function Index() {
  const {
    user,
    loading,
    signInWithGoogle,
    signInWithApple,
    signInWithEmail,
    verifyEmailOtp,
  } = useAuth();

  // ORCH-1102 Wave 2 — BOUNDED LOADING backstop (web only). The AuthContext
  // hard ceiling normally releases `loading`, but this is the local guarantee
  // that the boot spinner here can never be permanent: if `loading` is still
  // true past the ceiling (a GoTrue web-lock deadlock), stop spinning and fall
  // through to the sign-in screen (an unresolvable session is treated as
  // logged-out — somewhere actionable, never an infinite spinner). The ceiling
  // is well above the normal warm + 3s race so a slow-but-valid session
  // resolves first (no false sign-in flash). Native never arms this.
  // ORCH-1102 Wave 2 — render-time deadline read against the persistent anchor
  // (remount- AND render-loop-immune; see _layout for the full rationale).
  const isWeb = Platform.OS === "web";
  // Stamp once loading begins; clear ONLY when a real user appears (see _layout:
  // do not reset the window on a transient non-loading render under a deadlock
  // render loop, or it never accumulates to the ceiling).
  if (isWeb && loading) {
    markBootLoadingStart(); // idempotent: persists across remounts
  } else if (isWeb && user !== null) {
    clearBootLoadingStart();
  }
  const bootDeadlineExpired = isWeb && hasBootDeadlinePassed();

  // Wakeup interval for a QUIET deadlock with no render loop — forces a single
  // re-render near the ceiling so the render-time check runs.
  const [, forceBootTick] = useState(0);
  useEffect(() => {
    if (!isWeb || !loading || bootDeadlineExpired) return;
    const interval = setInterval(() => {
      if (hasBootDeadlinePassed()) {
        console.warn(
          `[index] boot-loading-deadline: still loading after ${AUTH_RESOLUTION_CEILING_MS}ms — showing sign-in (no infinite spinner)`,
        );
        forceBootTick((n) => n + 1);
      }
    }, BOOT_DEADLINE_POLL_MS);
    return () => clearInterval(interval);
  }, [isWeb, loading, bootDeadlineExpired]);

  if (loading && !bootDeadlineExpired) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator size="large" color="#eb7825" />
      </View>
    );
  }

  // Not signed in (or the loading gate hit its hard ceiling) → show sign-in
  // screen directly (no landing page split). A deadlocked-but-no-user state is
  // treated as logged-out so the user always lands somewhere actionable.
  if (!user) {
    return (
      <BusinessWelcomeScreen
        onGoogleSignIn={async () => { await signInWithGoogle(); }}
        onAppleSignIn={async () => { await signInWithApple(); }}
        onEmailSignIn={signInWithEmail}
        onVerifyEmailOtp={verifyEmailOtp}
      />
    );
  }

  // Signed in → dashboard (onboarding skipped to reduce testing friction)
  return <Redirect href={AppRoutes.home} />;
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff9f5",
  },
});
