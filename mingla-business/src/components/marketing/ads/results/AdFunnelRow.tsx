/**
 * #4238 wave 2 — Shown, Clicks, Page visits, {result}: four tiles, each with
 * a thin bar sized as a share of the first step. Not a funnel shape (the
 * values may not decrease). A step with no data source is omitted.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../../../constants/designSystem";
import { HOST_AD_RESULTS_COPY, hostAdResultLabel } from "../hostAdCopy";
import type { FunnelStep } from "./adResultsSeries";

function stepLabel(key: FunnelStep["key"], resultLabel: string): string {
  if (key === "shown") return "Shown";
  if (key === "clicks") return "Clicks";
  if (key === "visits") return "Page visits";
  const label = hostAdResultLabel(resultLabel);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function AdFunnelRow(props: {
  steps: readonly FunnelStep[];
  resultLabel: string;
}): React.ReactElement | null {
  if (props.steps.length === 0) return null;
  const hasVisits = props.steps.some((step) => step.key === "visits");
  return (
    <View testID="ad-funnel-row">
      <View style={styles.row}>
        {props.steps.map((step) => (
          <View
            key={step.key}
            style={styles.tile}
            accessible
            accessibilityLabel={`${stepLabel(step.key, props.resultLabel)}: ${step.value.toLocaleString("en-US")}`}
            testID={`ad-funnel-${step.key}`}
          >
            <Text style={styles.number}>{step.value.toLocaleString("en-US")}</Text>
            <Text style={styles.label}>{stepLabel(step.key, props.resultLabel)}</Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.round(step.share * 100)}%` }]} />
            </View>
          </View>
        ))}
      </View>
      {hasVisits ? <Text style={styles.note}>{HOST_AD_RESULTS_COPY.visitsNote}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  tile: {
    flexGrow: 1,
    flexBasis: 72,
    minWidth: 72,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    gap: spacing.xxs,
  },
  number: { ...typography.statValue, color: textTokens.primary },
  label: { ...typography.caption, color: textTokens.secondary },
  track: { height: 3, borderRadius: radius.full, backgroundColor: glass.border.profileElevated, overflow: "hidden", marginTop: spacing.xs },
  fill: { height: 3, borderRadius: radius.full, backgroundColor: accent.warm },
  note: { ...typography.caption, color: textTokens.tertiary, marginTop: spacing.xs },
});
