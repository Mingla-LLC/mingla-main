/**
 * #4111 — the card a new customer enquiry posts into its brand's Brand group.
 * It names no guest (20271223004111): staff and scanners can read Brand
 * groups, and Open goes through enquiry access, which refuses them (D8).
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { glass, radius, spacing, text as textTokens } from "../../constants/designSystem";
import { Button } from "../ui/Button";

export function BrandEnquiryCard({
  content,
  createdAt,
  onOpen,
}: {
  content: string;
  createdAt: string;
  onOpen: (() => void) | null;
}): React.ReactElement {
  const time = new Date(createdAt);
  return (
    <View style={styles.card} testID="brand-enquiry-card">
      <View style={styles.topLine}>
        <View style={styles.tag}><Text style={styles.tagText}>Customer enquiry</Text></View>
        {Number.isFinite(time.getTime()) ? (
          <Text style={styles.time}>{time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text>
        ) : null}
      </View>
      <Text style={styles.title}>{content || "New customer enquiry"}</Text>
      {onOpen ? (
        <View style={styles.action}>
          <Button label="Open enquiry" size="sm" onPress={onOpen} accessibilityLabel="Open enquiry" testID="brand-enquiry-card-open" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderStyle: "dashed", borderColor: glass.border.profileElevated, backgroundColor: glass.tint.profileBase },
  topLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  tag: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: "#4a3410" },
  tagText: { color: "#ffc66b", fontSize: 10, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  time: { color: textTokens.tertiary, fontSize: 11 },
  title: { color: textTokens.primary, fontSize: 14, fontWeight: "700" },
  action: { alignSelf: "flex-start" },
});
