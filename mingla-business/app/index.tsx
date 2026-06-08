// orch-strict-grep-allow safearea-on-fullscreen-routes — Index renders BusinessWelcomeScreen (handles SafeArea internally via SafeAreaView at BusinessWelcomeScreen.tsx:463) or brief boot ActivityIndicator; intentional thin wrapper
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { Redirect } from "expo-router";
import AppRoutes from "../src/config/routes";
import { useAuth } from "../src/context/AuthContext";
import BusinessWelcomeScreen from "../src/components/auth/BusinessWelcomeScreen";
import { AUTH_RESOLUTION_CEILING_MS } from "../src/utils/coldLoadAuthGates";

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
  const [bootDeadlineExpired, setBootDeadlineExpired] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (!loading) {
      if (bootDeadlineExpired) setBootDeadlineExpired(false);
      return;
    }
    if (bootDeadlineExpired) return;
    const timer = setTimeout(() => {
      console.warn(
        `[index] boot-loading-deadline: still loading after ${AUTH_RESOLUTION_CEILING_MS}ms — showing sign-in (no infinite spinner)`,
      );
      setBootDeadlineExpired(true);
    }, AUTH_RESOLUTION_CEILING_MS);
    return () => clearTimeout(timer);
  }, [loading, bootDeadlineExpired]);

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
