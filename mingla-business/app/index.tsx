import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect } from "expo-router";
import AppRoutes from "../src/config/routes";
import { useAuth } from "../src/context/AuthContext";
import BusinessWelcomeScreen from "../src/components/auth/BusinessWelcomeScreen";

export default function Index() {
  const { user, loading, signInWithGoogle, signInWithApple } = useAuth();

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
