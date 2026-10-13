/**
 * PayoutCountryTriggerRow — the tappable row that shows a payout country and
 * opens the country list.
 *
 * Split out of BrandStripeCountryPicker (#3645) so a host can show the row
 * without loading the country sheet until it is opened. Deliberately free of
 * animation and sheet imports.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export interface PayoutCountryTriggerRowProps {
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel: string;
  /** Small label above the value. */
  label: string;
  /** The chosen country (or the "nothing chosen" text). */
  valueText: string;
  /** Trailing affordance text. */
  actionText: string;
  /** "link" = underlined word; "chevron" = large glyph. */
  actionKind: "link" | "chevron";
  helperText?: string | null;
  warningText?: string | null;
  testID?: string;
}

export function PayoutCountryTriggerRow({
  onPress,
  disabled = false,
  accessibilityLabel,
  label,
  valueText,
  actionText,
  actionKind,
  helperText = null,
  warningText = null,
  testID,
}: PayoutCountryTriggerRowProps): React.ReactElement {
  return (
    <>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        testID={testID}
        style={({ pressed }) => [
          styles.trigger,
          pressed && !disabled ? styles.triggerPressed : null,
          disabled ? styles.triggerDisabled : null,
        ]}
      >
        <View style={styles.triggerRow}>
          <Text style={styles.triggerLabel}>{label}</Text>
          <Text style={styles.triggerValue}>{valueText}</Text>
        </View>
        <Text
          style={
            actionKind === "link" ? styles.triggerChange : styles.triggerChevron
          }
        >
          {actionText}
        </Text>
      </Pressable>

      {helperText !== null ? (
        <Text style={styles.helperText}>{helperText}</Text>
      ) : null}

      {warningText !== null ? (
        <Text style={styles.warningText}>{warningText}</Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    minHeight: 56,
  },
  triggerPressed: {
    opacity: 0.85,
  },
  triggerDisabled: {
    opacity: 0.5,
  },
  triggerRow: {
    flex: 1,
    flexDirection: "column",
    gap: 2,
  },
  triggerLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    fontWeight: "600",
    letterSpacing: 0.6,
  },
  triggerValue: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
    fontWeight: "600",
  },
  triggerChevron: {
    fontSize: 24,
    color: textTokens.tertiary,
    paddingLeft: spacing.sm,
  },
  triggerChange: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    paddingLeft: spacing.sm,
    textDecorationLine: "underline",
  },
  helperText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
  },
  warningText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
  },
});

export default PayoutCountryTriggerRow;
