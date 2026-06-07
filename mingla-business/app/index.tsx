// orch-strict-grep-allow safearea-on-fullscreen-routes — Index renders BusinessWelcomeScreen (handles SafeArea internally via SafeAreaView at BusinessWelcomeScreen.tsx:463) or brief boot ActivityIndicator; intentional thin wrapper
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect } from "expo-router";
import AppRoutes from "../src/config/routes";
import { useAuth } from "../src/context/AuthContext";
import BusinessWelcomeScreen from "../src/components/auth/BusinessWelcomeScreen";

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

  if (loading) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator size="large" color="#eb7825" />
      </View>
    );
  }

  // Not signed in → show sign-in screen directly (no landing page split)
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
