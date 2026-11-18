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
  radius as radiusTokens,
  color,
  space,
  type,
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
      {/* ORCH-1193 [sheet-cutoff]: flex:1 bounds the scroll viewport to the
          fixed-height panel so a long error list scrolls instead of overflowing
          past overflow:hidden. Read-only (no inputs) → plain RN ScrollView is
          intentional; SmartScrollView would add no value here. */}
      <ScrollView style={styles.scrollFlex} contentContainerStyle={styles.content}>
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
                <Icon name="flag" size={14} color={color.text1} />
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
  // ORCH-1193: bound the scroll viewport to the fixed-height panel so a long
  // error list scrolls into view instead of overflowing past overflow:hidden.
  scrollFlex: {
    flex: 1,
  },
  content: {
    paddingTop: space[4],
    paddingBottom: space[7],
  },
  title: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    letterSpacing: type.h1.letterSpacing,
    color: color.text1,
  },
  sub: {
    fontSize: type.caption.fontSize,
    color: color.text2,
    marginTop: 4,
    marginBottom: space[4],
  },
  list: {
    gap: space[1],
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
  },
  errorIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: color.fill.tabOn,
    alignItems: "center",
    justifyContent: "center",
  },
  errorTextCol: {
    flex: 1,
  },
  errorMessage: {
    fontSize: type.small.fontSize,
    color: color.text1,
  },
  errorStep: {
    fontSize: type.caption.fontSize,
    color: color.text3,
    marginTop: 2,
  },
  fixButton: {
    paddingHorizontal: space[2],
    paddingVertical: 4,
  },
  fixLabel: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
});

