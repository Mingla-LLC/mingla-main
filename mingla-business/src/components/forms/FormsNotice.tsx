/**
 * #4514 — the small inline notice on the Forms screens (stale draft, closed
 * form). A local, light stand-in for the shared Banner so the Forms chunk
 * adds nothing to the eager Host web bundle (a module two lazy chunks share
 * is hoisted into it).
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";

export interface FormsNoticeProps {
  tone: "warning" | "info";
  title: string;
  action?: { label: string; onPress: () => void };
  testID?: string;
}

export const FormsNotice: React.FC<FormsNoticeProps> = ({ tone, title, action, testID }) => (
  <View
    style={[styles.root, { borderLeftColor: tone === "warning" ? color.warning : color.info }]}
    accessibilityRole={tone === "warning" ? "alert" : undefined}
    testID={testID}
  >
    <Text style={styles.title}>{title}</Text>
    {action !== undefined ? (
      <Pressable
        onPress={action.onPress}
        accessibilityRole="button"
        accessibilityLabel={action.label}
        style={styles.action}
        hitSlop={8}
      >
        <Text style={styles.actionLabel}>{action.label}</Text>
      </Pressable>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    borderLeftWidth: 4,
    backgroundColor: color.fill.inset,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
  },
  title: { ...type.small, color: color.text1, flex: 1, minWidth: 0 },
  action: { minHeight: 36, justifyContent: "center", paddingHorizontal: space[2] },
  actionLabel: { ...type.small, color: color.accent, fontWeight: "600" },
});
