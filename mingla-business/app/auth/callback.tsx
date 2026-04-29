/**
 * /auth/callback — OAuth redirect landing route (web only).
 *
 * Cycle 0b. After the user authorises with Google or Apple, the provider
 * redirects to Supabase's `/auth/v1/callback`, which then redirects the
 * browser HERE with `#access_token=…` in the URL fragment. The Supabase
 * client (with `detectSessionInUrl: true` on web — see services/supabase.ts)
 * auto-extracts the session, fires `onAuthStateChange(SIGNED_IN, ...)`,
 * and AuthProvider's listener flips `loading` to false + sets `user`.
 *
 * This screen renders a brief loader during the extraction, then redirects
 * to `/` (which routes signed-in users to `/(tabs)/home`).
 *
 * Native iOS/Android never hit this route — they use the native ID-token
 * flow without URL fragments.
 */

import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect } from "expo-router";

import { useAuth } from "../../src/context/AuthContext";

export default function AuthCallback(): React.ReactElement {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.host}>
        <ActivityIndicator size="large" color="#eb7825" />
      </View>
    );
  }

  // Once Supabase finalises the session, AuthProvider sets `user`.
  // If user is set OR null (sign-in failed / cancelled), route back to `/`.
  // Index then either renders WelcomeScreen (no user) or redirects to home (user).
  if (user) {
    return <Redirect href="/" />;
  }

  return <Redirect href="/" />;
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0c0e12",
  },
});
