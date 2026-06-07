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

// orch-strict-grep-allow safearea-on-fullscreen-routes — web-only OAuth-callback brief loader before Redirect to "/"; not user-visible on iOS/Android (native uses ID-token flow)
import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect } from "expo-router";

import { useAuth } from "../../src/context/AuthContext";

// ORCH-1098 Stage 3: the mobile→static-home redirect is GONE. Phones now boot
// the real Expo app, so the callback simply routes everyone back to "/" once
// the session is finalised (signed-in → real home, signed-out → welcome).
export default function AuthCallback(): React.ReactElement {
  const { loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.host}>
        <ActivityIndicator size="large" color="#eb7825" />
      </View>
    );
  }

  // Once Supabase finalises the session, AuthProvider sets `user`. Whether the
  // user is set (success) or null (sign-in failed / cancelled), route back to
  // "/"; Index renders WelcomeScreen (no user) or redirects to home (user).
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
