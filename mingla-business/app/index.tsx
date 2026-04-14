import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import AppRoutes from "../src/config/routes";
import { useAuth } from "../src/context/AuthContext";
import BusinessWelcomeScreen from "../src/components/auth/BusinessWelcomeScreen";

export default function Index() {
  const router = useRouter();
  const { user, loading, accountStatus, signInWithGoogle, signInWithApple } =
    useAuth();

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
      />
    );
  }

  // Signed in, onboarding not complete → onboarding flow
  if (!accountStatus?.onboardingCompleted) {
    return <Redirect href={AppRoutes.onboarding.index as never} />;
  }

  // Signed in, onboarding complete → dashboard
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
