/**
 * Issue #1735 — the grade badge (28×28 `radius.sm` square, letter in `h3`,
 * fill by A–B / C / D–F band; Android opaque composites — design v1 §3.1).
 *
 * Lives in its OWN module (CI rework) so the LIGHT eager consumers — the
 * Overview cross-link tile and the to-do plumbing — can render a badge
 * without pulling the full Site check instrument (report renderers, sheets,
 * analytics chain) into the boot path. The heavy tree loads only behind the
 * shell's lazy Insights boundary (ORCH-1083 bundle budget).
 */

import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import {
  radius,
  semantic,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import {
  INSIGHTS_ANDROID_OPAQUE,
  gradeBand,
  type GradeBand,
} from "./insightsInstruments";

const BADGE_FILL_IOS: Record<GradeBand, string> = {
  good: semantic.successTint,
  mid: semantic.warningTint,
  poor: semantic.errorTint,
};
const BADGE_FILL_ANDROID: Record<GradeBand, string> = {
  good: INSIGHTS_ANDROID_OPAQUE.successFill,
  mid: INSIGHTS_ANDROID_OPAQUE.warningFill,
  poor: INSIGHTS_ANDROID_OPAQUE.errorFill,
};

export function GradeBadge({
  grade,
  size = 28,
}: {
  grade: string | null;
  size?: number;
}): React.ReactElement {
  const band = gradeBand(grade);
  const fill = Platform.OS === "android"
    ? BADGE_FILL_ANDROID[band]
    : BADGE_FILL_IOS[band];
  return (
    <View
      style={[
        styles.gradeBadge,
        { width: size, height: size, backgroundColor: fill },
      ]}
      accessibilityLabel={grade !== null ? `Grade ${grade}` : "Not graded yet"}
    >
      <Text style={styles.gradeBadgeLetter}>{grade ?? "—"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  gradeBadge: {
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  gradeBadgeLetter: {
    ...typography.h3,
    color: textTokens.primary,
  },
});

export default GradeBadge;
