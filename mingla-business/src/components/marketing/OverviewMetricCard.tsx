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
  /**
   * #2510 — `null` means NOT TRACKED and renders an em-dash, never 0.
   * A campaign sent before the Resend webhook existed has no delivery events;
   * drawing "OPENED 0" would tell the organiser nobody read it, which is a
   * claim we have no evidence for. Constitution rule 9.
   */
  value: number | null;
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
  const applyWarning = tone === "warning" && value !== null && value > 0;
  const shownValue = value === null ? "—" : value.toLocaleString();
  const a11yValue = value === null ? "not tracked" : String(value);
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
          ? `${label}: ${a11yValue}, ${pctLabel}${applyWarning ? ", warning" : ""}`
          : `${label}: ${a11yValue}${applyWarning ? ", warning" : ""}`
      }
    >
      <Text style={styles.label}>{label}</Text>
      <View style={styles.valueRow}>
        <Text style={[styles.value, { color: valueColor }]}>
          {shownValue}
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
