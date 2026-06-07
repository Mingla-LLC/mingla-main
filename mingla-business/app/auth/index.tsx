// orch-strict-grep-allow safearea-on-fullscreen-routes — BusinessWelcomeScreen renders its own SafeAreaView internally (BusinessWelcomeScreen.tsx:463 with edges={["top", "left", "right"]}); wrapping at the route level would double-pad
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import BusinessWelcomeScreen from "../../src/components/auth/BusinessWelcomeScreen";
import AppRoutes from "../../src/config/routes";
import { useAuth } from "../../src/context/AuthContext";
import {
  isMobileBusinessWeb,
  redirectMobileBusinessWebToStaticHome,
} from "../../src/utils/mobileWebStaticHomeRedirect";

export default function AuthIndex() {
  const router = useRouter();
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
    if (!loading && user && !shouldUseStaticHome) {
      router.replace(AppRoutes.home);
    }
  }, [loading, user, router, shouldUseStaticHome]);

  useEffect(() => {
    if (shouldUseStaticHome) {
      redirectMobileBusinessWebToStaticHome();
    }
  }, [shouldUseStaticHome]);

  if (shouldUseStaticHome) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator size="large" color="#eb7825" />
      </View>
    );
  }

  return (
    <BusinessWelcomeScreen
      onBack={() => router.back()}
      onGoogleSignIn={async () => {
        await signInWithGoogle();
      }}
      onAppleSignIn={async () => {
        await signInWithApple();
      }}
      onEmailSignIn={signInWithEmail}
      onVerifyEmailOtp={verifyEmailOtp}
    />
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff9f5",
  },
});
