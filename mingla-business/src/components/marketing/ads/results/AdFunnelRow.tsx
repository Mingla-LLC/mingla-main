/**
 * #4238 wave 2 — Shown, Clicks, Page visits, {result}: four tiles, each with
 * a thin bar sized as a share of the first step. Not a funnel shape (the
 * values may not decrease). A step with no data source is omitted.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../../../constants/designSystem";
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
  row: { flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[4] },
  tile: {
    flexGrow: 1,
    flexBasis: 72,
    minWidth: 72,
    padding: space[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.lineStrong,
    gap: space[1],
  },
  number: { ...type.stat, color: color.text1 },
  label: { ...type.caption, color: color.text2 },
  track: { height: 3, borderRadius: radius.full, backgroundColor: color.lineStrong, overflow: "hidden", marginTop: space[1] },
  fill: { height: 3, borderRadius: radius.full, backgroundColor: color.paper },
  note: { ...type.caption, color: color.text3, marginTop: space[1] },
});
