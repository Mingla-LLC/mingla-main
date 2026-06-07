// orch-strict-grep-allow safearea-on-fullscreen-routes — Index renders BusinessWelcomeScreen (handles SafeArea internally via SafeAreaView at BusinessWelcomeScreen.tsx:463) or brief boot ActivityIndicator; intentional thin wrapper
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect } from "expo-router";
import AppRoutes from "../src/config/routes";
import { useAuth } from "../src/context/AuthContext";
import BusinessWelcomeScreen from "../src/components/auth/BusinessWelcomeScreen";
import {
  isMobileBusinessWeb,
  redirectMobileBusinessWebToStaticHome,
} from "../src/utils/mobileWebStaticHomeRedirect";

export default function Index() {
  const {
    user,
    loading,
    signInWithGoogle,
    signInWithApple,
    signInWithEmail,
    verifyEmailOtp,
  } = useAuth();
  const shouldUseStaticHome = !loading && Boolean(user) && isMobileBusinessWeb();

  useEffect(() => {
    if (shouldUseStaticHome) {
      redirectMobileBusinessWebToStaticHome();
    }
  }, [shouldUseStaticHome]);

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

  if (shouldUseStaticHome) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator size="large" color="#eb7825" />
      </View>
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
