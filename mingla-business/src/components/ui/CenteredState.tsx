/**
 * #4389 (Seth 2026-11-11) — the one layout for an empty, error or no-match
 * state: the whole block (icon, title, body, buttons) is centred
 * horizontally and, with `fill`, vertically in the space left; text is
 * centre-aligned and buttons keep their natural width.
 *
 * Deliberately light (React Native only, no ui/Button, no icon runtime) so
 * boot-path screens can use it: the caller passes its own icon and actions.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { AccessibilityRole, StyleProp, ViewStyle } from "react-native";

import { color, space, type } from "../../constants/designSystem";

export interface CenteredStateProps {
  /** Optional icon node, shown above the title. */
  icon?: React.ReactNode;
  title: string;
  body?: string | null;
  /** Buttons or links; each keeps its natural width, centred. */
  children?: React.ReactNode;
  /** Grow into the remaining space and centre vertically in it. */
  fill?: boolean;
  /** Smaller title for states inside a card or a list. */
  compact?: boolean;
  /** "error" colours the title as an error. */
  tone?: "default" | "error";
  accessibilityRole?: AccessibilityRole;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const CenteredState: React.FC<CenteredStateProps> = ({
  icon,
  title,
  body,
  children,
  fill = false,
  compact = false,
  tone = "default",
  accessibilityRole,
  testID,
  style,
}) => (
  <View
    style={[styles.container, fill ? styles.fill : null, style]}
    accessibilityRole={accessibilityRole}
    accessibilityLiveRegion="polite"
    testID={testID}
  >
    {icon !== undefined ? <View style={styles.icon}>{icon}</View> : null}
    <Text style={[compact ? styles.titleCompact : styles.title, tone === "error" ? styles.titleError : null]}>
      {title}
    </Text>
    {body !== undefined && body !== null && body.length > 0 ? (
      <Text style={styles.body}>{body}</Text>
    ) : null}
    {children !== undefined && children !== null ? (
      <View style={styles.actions}>{children}</View>
    ) : null}
  </View>
);

export const CENTERED_STATE_LAYOUT = {
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
} as const;

const styles = StyleSheet.create({
  container: {
    alignItems: CENTERED_STATE_LAYOUT.alignItems,
    justifyContent: CENTERED_STATE_LAYOUT.justifyContent,
    alignSelf: "stretch",
    paddingHorizontal: space[6],
    paddingVertical: space[6],
    gap: space[1],
  },
  fill: { flexGrow: 1 },
  icon: { marginBottom: space[2] },
  title: {
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    fontWeight: "600",
    color: color.text1,
    textAlign: CENTERED_STATE_LAYOUT.textAlign,
  },
  titleCompact: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: "600",
    color: color.text1,
    textAlign: CENTERED_STATE_LAYOUT.textAlign,
  },
  titleError: { color: color.errorText },
  body: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text2,
    textAlign: CENTERED_STATE_LAYOUT.textAlign,
  },
  actions: {
    marginTop: space[2],
    alignItems: CENTERED_STATE_LAYOUT.alignItems,
    gap: space[2],
  },
});

export default CenteredState;
