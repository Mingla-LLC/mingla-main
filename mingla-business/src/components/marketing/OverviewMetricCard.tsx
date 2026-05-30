/**
 * OverviewMetricCard — single funnel-metric tile on the Marketing → Overview
 * tab (ORCH-0863). Per DESIGN §3.3.
 *
 * Container mirrors the Campaigns report `statCell` pattern at
 * campaigns/[id].tsx:436-446 — flexBasis 47% lets 4 tiles wrap into a
 * 2x2 grid on phone widths.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export type OverviewMetricTone = "default" | "warning";

export interface OverviewMetricCardProps {
  label: string;
  value: number;
  /** Optional percentage (0-100). Omitted when undefined; rendered as integer "12%". */
  percent?: number;
  /** Warning tone tints value + percentage when value > 0. */
  tone?: OverviewMetricTone;
  testID?: string;
}

export const OverviewMetricCard: React.FC<OverviewMetricCardProps> = ({
  label,
  value,
  percent,
  tone = "default",
  testID,
}) => {
  const applyWarning = tone === "warning" && value > 0;
  const valueColor = applyWarning ? semantic.warning : textTokens.primary;
  const percentColor = applyWarning ? semantic.warning : textTokens.tertiary;

  const pctLabel =
    typeof percent === "number" && Number.isFinite(percent)
      ? `${Math.round(percent)}%`
      : null;

  return (
    <View
      style={styles.host}
      testID={testID}
      accessibilityLabel={
        pctLabel !== null
          ? `${label}: ${value}, ${pctLabel}${applyWarning ? ", warning" : ""}`
          : `${label}: ${value}${applyWarning ? ", warning" : ""}`
      }
    >
      <Text style={styles.label}>{label}</Text>
      <View style={styles.valueRow}>
        <Text style={[styles.value, { color: valueColor }]}>
          {value.toLocaleString()}
        </Text>
        {pctLabel !== null ? (
          <Text style={[styles.percent, { color: percentColor }]}>{pctLabel}</Text>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flexBasis: "47%",
    flexGrow: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    gap: 2,
  },
  label: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.xs,
  },
  value: {
    ...typography.h3,
  },
  percent: {
    ...typography.bodySm,
  },
});
