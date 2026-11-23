/**
 * #4579 — the Mingla mark on Team & permissions: an ink circle with an orange
 * "M" (the Brand group People list's Mingla avatar), for the one "Mingla Team"
 * entry and its detail sheet. Only the team route imports it; the messages
 * chunk has its own copy (messages/BrandGroupMinglaMark) so neither is hoisted
 * into the eager web __common chunk. Decorative: hidden from screen readers.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { color } from "../../constants/designSystem";

export const MINGLA_TEAM_NAME = "Mingla Team";

export function MinglaTeamMark({
  size,
  dimmed = false,
  testID,
}: {
  size: number;
  dimmed?: boolean;
  testID?: string;
}): React.ReactElement {
  return (
    <View
      style={[
        styles.mark,
        { width: size, height: size, borderRadius: size / 2 },
        dimmed && styles.dimmed,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID ?? "mingla-team-mark"}
    >
      <Text style={[styles.letter, { fontSize: Math.max(8, Math.round(size * 0.36)) }]}>M</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.ink,
    borderWidth: 1,
    borderColor: color.lineStrong,
  },
  dimmed: { opacity: 0.45 },
  letter: { color: color.accentText, fontWeight: "700" },
});

export default MinglaTeamMark;
