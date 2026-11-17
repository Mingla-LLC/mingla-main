/**
 * #4420 (round-3 item 18, R8 P18; mockups reserve-index__payment-cancelled-host-r8
 * and public-order-venue__placed-host-r8) — the "Guest view · Back to Mingla
 * Host" bar on the guest pages a host can land on (the reservation
 * payment-cancelled return and the venue order page). Those routes render
 * outside the app shell, so a host who opened one had no way back into the
 * app: a full-screen takeover.
 *
 * Chrome only. The guest pages are ANON-TOLERANT and must never call an auth
 * hook (I-anon-buyer-routes, #1793 R1): this reads the stored session once,
 * without AuthContext, and shows the bar only when someone is signed in to
 * Mingla Host on this device. A guest (no session) sees exactly the page they
 * saw before.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { color, radius, space, type } from "../../constants/designSystem";
import { Icon } from "../ui/Icon";

export function GuestViewHostBar({ testID }: { testID?: string }): React.ReactElement {
  const router = useRouter();
  return (
    <View style={styles.bar} testID={testID ?? "guest-view-host-bar"}>
      <Text style={styles.caption}>Guest view</Text>
      <Pressable
        onPress={() => router.replace("/(tabs)/home" as never)}
        accessibilityRole="button"
        accessibilityLabel="Back to Mingla Host"
        style={({ pressed }) => [styles.back, pressed ? styles.pressed : null]}
        testID="guest-view-back-to-host"
      >
        <Icon name="chevL" size={16} color={color.text1} />
        <Text style={styles.backLabel}>Back to Mingla Host</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    minHeight: 52,
    paddingLeft: space[4],
    paddingRight: space[2],
    paddingVertical: space[2],
    borderRadius: radius.full,
    backgroundColor: color.fill.tile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  caption: { ...type.caption, color: color.text3 },
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    height: 36,
    paddingHorizontal: space[3],
    borderRadius: radius.full,
    backgroundColor: color.fill.inset,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  pressed: { opacity: 0.7 },
  backLabel: { ...type.btnSm, color: color.text1 },
});
