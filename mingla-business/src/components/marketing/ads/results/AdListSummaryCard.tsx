/**
 * #4238 wave 2 — the Host Ads list summary: this month's spend against the
 * budgets of the ads running in it, results, and a 30-day spend sparkline
 * (the CompactSparkline geometry). Hidden when there are no ads. A day whose
 * spend can't be shown in the brand's currency is a gap, never a 0.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import {
  accent,
  spacing,
  text as textTokens,
  typography,
} from "../../../../constants/designSystem";
import type { HostAdListSummary } from "../../../../services/hostAdCampaignService";
import { GlassCard } from "../../../ui/GlassCard";
import { formatHostAdMoneyCents } from "../hostAdMoney";

export function hostAdListSummaryLine(summary: HostAdListSummary): string {
  const spent =
    summary.spent_cents !== null
      ? formatHostAdMoneyCents(summary.spent_cents, summary.currency)
      : null;
  const budget = formatHostAdMoneyCents(summary.budget_cents, summary.currency);
  const results = `${summary.results.toLocaleString("en-US")} ${summary.results === 1 ? "result" : "results"}`;
  if (spent === null) return `This month: ${results}`;
  return `This month: ${spent}${budget && summary.budget_cents > 0 ? ` of ${budget}` : ""} · ${results}`;
}

/** Segments between gaps: a null day breaks the line instead of dropping to 0. */
export function sparklinePath(points: readonly { cents: number | null }[]): string {
  const values = points.map((point) => point.cents);
  const max = Math.max(1, ...values.filter((v): v is number => v !== null));
  const divisor = Math.max(values.length - 1, 1);
  let d = "";
  let pen = false;
  values.forEach((value, index) => {
    if (value === null) {
      pen = false;
      return;
    }
    const x = (index / divisor) * 300;
    const y = 58 - (value / max) * 50;
    d += `${pen ? "L" : "M"}${x},${y} `;
    pen = true;
  });
  return d.trim();
}

export function AdListSummaryCard({
  summary,
}: {
  summary: HostAdListSummary | null;
}): React.ReactElement | null {
  if (!summary) return null;
  const line = hostAdListSummaryLine(summary);
  const hasSpend = summary.daily_spend.some((day) => (day.cents ?? 0) > 0);
  return (
    <GlassCard variant="base" padding={spacing.lg} testID="ads-list-summary">
      <Text style={styles.line}>{line}</Text>
      {hasSpend ? (
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={`Spend over the last 30 days. ${line}.`}
          style={styles.spark}
        >
          <Svg
            width="100%"
            height={62}
            viewBox="0 0 300 62"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Path
              d={sparklinePath(summary.daily_spend)}
              fill="none"
              stroke={accent.warm}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </Svg>
          <Text style={styles.caption}>Last 30 days</Text>
        </View>
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  line: { ...typography.body, color: textTokens.primary },
  spark: { marginTop: spacing.sm },
  caption: { ...typography.caption, color: textTokens.tertiary, marginTop: spacing.xs },
});
