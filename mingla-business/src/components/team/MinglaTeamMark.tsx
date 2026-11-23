/**
 * #4579 — the Mingla mark: an ink circle with an orange "M" (lifted from the
 * Brand group People list's Mingla avatar). Two forms:
 *   - MinglaTeamMark: the whole avatar (the "Mingla Team" entry, or a sender
 *     whose public name is the "Mingla Team" fallback);
 *   - MinglaMarkBadge: a small corner badge on a person's own avatar, ringed in
 *     the canvas colour, for a Mingla admin shown by their first name.
 * Decorative: hidden from screen readers (the label says "from Mingla").
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

/** Badge size for a 40pt avatar is 16; for a 28pt avatar, 13. */
export function minglaBadgeSizeFor(avatarSize: number): number {
  return avatarSize >= 36 ? 16 : 13;
}

export function MinglaMarkBadge({ avatarSize }: { avatarSize: number }): React.ReactElement {
  const size = minglaBadgeSizeFor(avatarSize);
  return (
    <View
      style={[styles.badge, { width: size, height: size, borderRadius: size / 2 }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="mingla-mark-badge"
    >
      <Text style={[styles.letter, { fontSize: Math.round(size * 0.55) }]}>M</Text>
    </View>
  );
}

/** A person's avatar with the Mingla badge on its corner. */
export function WithMinglaBadge({
  avatarSize,
  children,
}: {
  avatarSize: number;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <View style={{ width: avatarSize, height: avatarSize }}>
      {children}
      <View style={styles.badgeSlot}>
        <MinglaMarkBadge avatarSize={avatarSize} />
      </View>
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
  badge: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.ink,
    borderWidth: 1.5,
    borderColor: color.canvas,
  },
  badgeSlot: { position: "absolute", right: -2, bottom: -2 },
});

export default MinglaTeamMark;
