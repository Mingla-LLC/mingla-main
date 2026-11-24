/**
 * #4579 — the Mingla mark for Brand-group messages and the People list: an ink
 * circle with an orange "M" (the people list's Mingla avatar), whole or as a
 * corner badge on a person's avatar. Kept inside the messages chunk on
 * purpose: the Team & permissions screen has its own copy
 * (components/team/MinglaTeamMark), so neither is hoisted into the eager web
 * __common chunk. Decorative: hidden from screen readers.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { color } from "../../constants/designSystem";

export const BRAND_GROUP_MINGLA_TEAM_NAME = "Mingla Team";

export function BrandGroupMinglaMark({ size, testID }: { size: number; testID?: string }): React.ReactElement {
  return (
    <View
      style={[styles.mark, { width: size, height: size, borderRadius: size / 2 }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID ?? "brand-group-mingla-mark"}
    >
      <Text style={[styles.letter, { fontSize: Math.max(8, Math.round(size * 0.36)) }]}>M</Text>
    </View>
  );
}

/** A person's avatar with the Mingla badge (16pt on 40, 13pt on 28) on its corner. */
export function WithBrandGroupMinglaBadge({ avatarSize, children }: { avatarSize: number; children: React.ReactNode }): React.ReactElement {
  const size = avatarSize >= 36 ? 16 : 13;
  return (
    <View style={{ width: avatarSize, height: avatarSize }}>
      {children}
      <View
        style={[styles.badge, { width: size, height: size, borderRadius: size / 2 }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID="mingla-mark-badge"
      >
        <Text style={[styles.letter, { fontSize: Math.round(size * 0.55) }]}>M</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: "center", justifyContent: "center", backgroundColor: color.ink, borderWidth: 1, borderColor: color.lineStrong },
  letter: { color: color.accentText, fontWeight: "700" },
  badge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.ink,
    borderWidth: 1.5,
    borderColor: color.canvas,
  },
});
