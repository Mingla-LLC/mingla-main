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

import {
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.xs,
  },
  fill: { flexGrow: 1 },
  icon: { marginBottom: spacing.sm },
  title: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
    textAlign: CENTERED_STATE_LAYOUT.textAlign,
  },
  titleCompact: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
    textAlign: CENTERED_STATE_LAYOUT.textAlign,
  },
  titleError: { color: semantic.error },
  body: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    textAlign: CENTERED_STATE_LAYOUT.textAlign,
  },
  actions: {
    marginTop: spacing.sm,
    alignItems: CENTERED_STATE_LAYOUT.alignItems,
    gap: spacing.sm,
  },
});

export default CenteredState;
