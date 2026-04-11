import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import BusinessLandingScreen from "../src/components/landing/BusinessLandingScreen";
import AppRoutes from "../src/config/routes";
import { useAuth } from "../src/context/AuthContext";

export default function Index() {
  const router = useRouter();
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator size="large" color="#eb7825" />
      </View>
    );
  }

  if (user) {
    return <Redirect href={AppRoutes.home} />;
  }

  return (
    <BusinessLandingScreen
      onGetStarted={() => router.push(AppRoutes.auth.index)}
      onSignIn={() => router.push(AppRoutes.auth.index)}
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
