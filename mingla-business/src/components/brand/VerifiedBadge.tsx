/**
 * Ve4 — subtle verified-venue badge for public physical venue pages.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";

export const VerifiedBadge: React.FC = () => (
  <View style={styles.host} accessibilityRole="text">
    <Icon name="check" size={14} color={accent.warm} />
    <Text style={styles.label}>Verified</Text>
    <Text style={styles.sub}>Claimed by venue</Text>
  </View>
);

const styles = StyleSheet.create({
  host: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "center",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radiusTokens.full,
    backgroundColor: "rgba(59, 130, 246, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.35)",
    marginTop: spacing.xs,
  },
  label: {
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    color: accent.warm,
  },
  sub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
  },
});

export default VerifiedBadge;
