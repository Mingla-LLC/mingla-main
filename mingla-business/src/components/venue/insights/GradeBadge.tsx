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
  color,
  type,
} from "../../../constants/designSystem";
import {
  gradeBand,
  type GradeBand,
} from "./insightsInstruments";

const BADGE_FILL_IOS: Record<GradeBand, string> = {
  good: color.successTint,
  mid: color.warningTint,
  poor: color.errorTint,
};
// #4420 — the opaque composites of the tints over the canvas (token file).
const BADGE_FILL_ANDROID: Record<GradeBand, string> = {
  good: color.solidTint.success,
  mid: color.solidTint.warning,
  poor: color.solidTint.error,
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
    ...type.h1,
    color: color.text1,
  },
});

export default GradeBadge;
