import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "../src/context/AuthContext";

export default function HomeScreen() {
  const { user, loading, signOut } = useAuth();

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#eb7825" />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/" />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Mingla Business</Text>
      <Text style={styles.subtitle}>
        Signed in as {user.email ?? (user.user_metadata?.email as string) ?? "creator"}
      </Text>
      <TouchableOpacity style={styles.signOut} onPress={() => signOut()} activeOpacity={0.85}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#ffffff",
  },
  container: {
    flex: 1,
    padding: 24,
    paddingTop: 64,
    backgroundColor: "#ffffff",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: "#6b7280",
    marginBottom: 32,
  },
  signOut: {
    backgroundColor: "#eb7825",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  signOutText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
