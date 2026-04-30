/**
 * PublishErrorsSheet — J-E12 publish-with-validation-errors UX.
 *
 * Sheet snap=half. Renders scrollable list of errors. Each error row
 * has a "Fix" link → tapping closes sheet + jumps to that step.
 *
 * Per Cycle 3 spec §3.4 + AC#30/AC#31.
 */

import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { ValidationError } from "../../utils/draftEventValidation";

import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";

interface PublishErrorsSheetProps {
  visible: boolean;
  errors: ValidationError[];
  onClose: () => void;
  onFix: (step: number) => void;
}

const STEP_LABELS: ReadonlyArray<string> = [
  "Basics",
  "When",
  "Where",
  "Cover",
  "Tickets",
  "Settings",
  "Preview",
];

export const PublishErrorsSheet: React.FC<PublishErrorsSheetProps> = ({
  visible,
  errors,
  onClose,
  onFix,
}) => {
  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="half">
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>
          {errors.length === 1
            ? "1 thing to fix before you can publish"
            : `${errors.length} things to fix before you can publish`}
        </Text>
        <Text style={styles.sub}>
          Tap Fix to jump back to the right step.
        </Text>
        <View style={styles.list}>
          {errors.map((err, i) => (
            <View key={`${err.fieldKey}-${i}`} style={styles.errorRow}>
              <View style={styles.errorIconWrap}>
                <Icon name="flag" size={14} color={accent.warm} />
              </View>
              <View style={styles.errorTextCol}>
                <Text style={styles.errorMessage}>{err.message}</Text>
                <Text style={styles.errorStep}>
                  Step {err.step + 1} · {STEP_LABELS[err.step]}
                </Text>
              </View>
              <Pressable
                onPress={() => onFix(err.step)}
                accessibilityRole="button"
                accessibilityLabel={`Fix in step ${err.step + 1}`}
                style={styles.fixButton}
                hitSlop={6}
              >
                <Text style={styles.fixLabel}>Fix</Text>
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    letterSpacing: typography.h3.letterSpacing,
    color: textTokens.primary,
  },
  sub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    marginTop: 4,
    marginBottom: spacing.md,
  },
  list: {
    gap: spacing.xs,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  errorIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: accent.tint,
    alignItems: "center",
    justifyContent: "center",
  },
  errorTextCol: {
    flex: 1,
  },
  errorMessage: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.primary,
  },
  errorStep: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  fixButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  fixLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
});

// suppress unused-import for semantic (kept for future error-tier styling)
void semantic;
