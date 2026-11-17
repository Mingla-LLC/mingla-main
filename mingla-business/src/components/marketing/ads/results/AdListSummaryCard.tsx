/**
 * #4238 wave 2 — the Host Ads list summary: this month's spend against the
 * budgets of the ads running in it, results, and a 30-day spend sparkline
 * (the CompactSparkline geometry). Hidden when there are no ads. A day whose
 * spend can't be shown in the brand's currency is a gap, never a 0.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { color, space, type } from "../../../../constants/designSystem";
import type { HostAdListSummary } from "../../../../services/hostAdCampaignService";
import { GlassCard } from "../../../ui/GlassCard";
import { hostAdPayFromCredit } from "../hostAdBuilderModel";
import { hm } from "../hostAdManageCopy";
import { formatHostAdMoneyCents } from "../hostAdMoney";

/**
 * #4238 rework 1 (tester P2-2): every amount is what the Host PAYS (the
 * server sends Ads credit: spent and budgets are grossed up by the 15% fee
 * through hostAdPayFromCredit, the same as the detail page), in the Host's
 * language (hostAds.manage.summary.* in all 29 Host locales).
 */
export function hostAdListSummaryLine(summary: HostAdListSummary): string {
  const spent =
    summary.spent_cents !== null
      ? formatHostAdMoneyCents(hostAdPayFromCredit(summary.spent_cents), summary.currency)
      : null;
  const budget =
    summary.budget_cents > 0 ? formatHostAdMoneyCents(hostAdPayFromCredit(summary.budget_cents), summary.currency) : null;
  const results = hm(summary.results === 1 ? "summary.resultOne" : "summary.results", {
    count: summary.results.toLocaleString(),
  });
  if (spent === null) return hm("summary.lineNoSpend", { results });
  return budget
    ? hm("summary.line", { spent, budget, results })
    : hm("summary.lineNoBudget", { spent, results });
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
    <GlassCard variant="base" padding={space[6]} testID="ads-list-summary">
      <Text style={styles.line}>{line}</Text>
      {hasSpend ? (
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={hm("summary.chartLabel", { line })}
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
              stroke={color.text1}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </Svg>
          <Text style={styles.caption}>{hm("summary.last30")}</Text>
        </View>
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  line: { ...type.body, color: color.text1 },
  spark: { marginTop: space[2] },
  caption: { ...type.caption, color: color.text3, marginTop: space[1] },
});
