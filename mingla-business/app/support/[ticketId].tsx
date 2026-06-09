/**
 * Support thread route — META-ORCH-1104 Phase 1 (business requester).
 *
 * Mounts the platform-resolved <SupportThread> for the ticket id in the path.
 * Metro picks SupportThread.native.tsx on iOS/Android (the native-keyboard path)
 * and SupportThread.tsx on web (Fragment passthrough) — the web bundle never
 * pulls in any native keyboard primitive (I-1104-NO-KBC-ON-WEB, §2.10).
 *
 * The route inherits the route-agnostic signed-out web firewall + auth-resolving
 * gate from app/_layout.tsx (ORCH-1100/1102/1103): a signed-out web user is
 * redirected to sign-in, never dead-ended (SPEC §5.2). RLS hides foreign tickets,
 * so a deep-link to another user's ticket renders the not-found state, not a
 * crash (SPEC T-1.7).
 *
 * Per SPEC §5.1.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { SupportThread } from "../../src/components/support/SupportThread";
import { text as textTokens } from "../../src/constants/designSystem";

export default function SupportThreadRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ ticketId?: string | string[] }>();
  const raw = params.ticketId;
  const ticketId = Array.isArray(raw) ? raw[0] : raw;

  if (typeof ticketId !== "string" || ticketId.length === 0) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>
          We couldn&apos;t open this support chat.
        </Text>
      </View>
    );
  }

  return <SupportThread ticketId={ticketId} />;
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111318",
    padding: 24,
  },
  fallbackText: {
    color: textTokens.primary,
    textAlign: "center",
  },
});
