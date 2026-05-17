/**
 * /trip/coming-soon — legacy stub from ORCH-0826 [Hub Foundation + universal-plus
 * creator] M0, now a redirect to /trip/create (Tr2 ORCH-0859).
 *
 * Why a redirect and not a delete: operators may have shared deep links to
 * this URL (M0 was live for ~3 days before Tr2 shipped). Replacing with a
 * redirect preserves those links + automatically routes the operator to
 * the real trip wizard. Safe to delete in a future cleanup ORCH once link
 * shares from that 3-day window have aged out.
 *
 * Per SPEC §4.10 file 27.
 */

import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";
import { SafeScreen } from "../../src/components/ui/SafeScreen";

export default function TripComingSoonRedirectRoute(): React.ReactElement {
  const router = useRouter();

  useEffect(() => {
    // router.replace so /trip/coming-soon isn't in the back-stack.
    router.replace("/trip/create" as never);
  }, [router]);

  return (
    <SafeScreen style={styles.host}>
      <ActivityIndicator />
      <Text style={styles.body}>Redirecting to the new trip wizard…</Text>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: "#0c0e12",
  },
  body: {
    fontSize: typography.body.fontSize,
    color: textTokens.secondary,
    textAlign: "center",
  },
});
