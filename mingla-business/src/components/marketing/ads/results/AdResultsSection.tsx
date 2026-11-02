/**
 * #4238 wave 2 — the Host ad detail "Results" card: the answer first ("Is my
 * money working?"), then spend against budget, results and cost per result,
 * the shown → results row, and the per-app split (two or more apps). The
 * placement rows sit under "Where results came from". Missing data is
 * hidden, never drawn as zero.
 */

import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../../../constants/designSystem";
import type {
  HostAdDailyPoint,
  HostAdPlatformSpend,
} from "../../../../services/hostAdCampaignService";
import { formatHostAdMoneyCents } from "../hostAdMoney";
import { HOST_AD_RESULTS_COPY, hostAdResultLabel, humanize, platformName } from "../hostAdCopy";
import { AdFunnelRow } from "./AdFunnelRow";
import { AdPlatformSplit } from "./AdPlatformSplit";
import { AdResultsChart } from "./AdResultsChart";
import { AdSpendChart } from "./AdSpendChart";
import {
  buildFunnel,
  buildPlatformBars,
  buildResultsSeries,
  buildSpendSeries,
} from "./adResultsSeries";

/** "You've spent NGN 42,000.00 of NGN 100,000.00 over 6 days." */
export function hostAdResultsSentence(input: {
  spentCents: number | null;
  budgetCents: number | null;
  currency: string | null;
  days: number;
}): string {
  if (input.days === 0 || input.spentCents === null) {
    return HOST_AD_RESULTS_COPY.noSpend;
  }
  const spent = formatHostAdMoneyCents(input.spentCents, input.currency) ?? "";
  const budget = input.budgetCents !== null && input.budgetCents > 0
    ? ` of ${formatHostAdMoneyCents(input.budgetCents, input.currency) ?? ""}`
    : "";
  return `You've spent ${spent}${budget} over ${input.days} ${input.days === 1 ? "day" : "days"}.`;
}

export function AdResultsSection(props: {
  daily: readonly HostAdDailyPoint[];
  byPlatformSpend: readonly HostAdPlatformSpend[];
  dailyError: boolean;
  hostCurrency: string | null;
  budgetCents: number | null;
  resultKind: string;
  /** wave-1 lines kept: how results are counted and shared */
  notes: readonly string[];
  placements: readonly { platform: string; placement: string; conversions: number }[];
  onRetry: () => void;
}): React.ReactElement {
  const { width } = useWindowDimensions();
  const [placesOpen, setPlacesOpen] = useState(false);
  const spend = buildSpendSeries({
    daily: props.daily,
    hostCurrency: props.hostCurrency,
    budgetCents: props.budgetCents,
  });
  const results = buildResultsSeries({ daily: props.daily, inHostCurrency: spend.inHostCurrency });
  const funnel = buildFunnel(props.daily);
  const bars = buildPlatformBars(props.byPlatformSpend);
  const label = hostAdResultLabel(props.resultKind);
  const wide = width >= 768;
  return (
    <View testID="ads-detail-results">
      <Text style={styles.sentence} testID="ads-detail-results-sentence">
        {hostAdResultsSentence({
          spentCents: spend.total,
          budgetCents: spend.budget,
          currency: spend.currency,
          days: spend.points.length,
        })}
      </Text>
      {props.dailyError ? (
        <View style={styles.errorBox}>
          <Text style={styles.muted} testID="ads-detail-chart-error">
            {HOST_AD_RESULTS_COPY.chartError}
          </Text>
          <Pressable
            style={styles.retry}
            onPress={props.onRetry}
            accessibilityRole="button"
            accessibilityLabel="Retry loading the chart"
            testID="ads-detail-chart-retry"
          >
            <Text style={styles.retryLabel}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={[styles.charts, wide && styles.chartsWide]}>
            <View style={[styles.chart, wide && styles.chartWide]}>
              <AdSpendChart series={spend} />
            </View>
            {spend.points.length > 0 ? (
              <View style={[styles.chart, wide && styles.chartWide]}>
                <AdResultsChart series={results} resultLabel={label} currency={spend.currency} />
              </View>
            ) : null}
          </View>
          <AdFunnelRow steps={funnel} resultLabel={label} />
          <AdPlatformSplit bars={bars} resultLabel={label} />
        </>
      )}
      {props.notes.map((line) => (
        <Text key={line} style={styles.muted}>
          {line}
        </Text>
      ))}
      {props.placements.length > 0 ? (
        <>
          <Pressable
            style={styles.expand}
            onPress={() => setPlacesOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: placesOpen }}
            accessibilityLabel={HOST_AD_RESULTS_COPY.whereFrom}
            testID="ads-detail-where-from"
          >
            <Text style={styles.expandLabel}>{HOST_AD_RESULTS_COPY.whereFrom}</Text>
            <Text style={styles.expandLabel}>{placesOpen ? "Hide" : "Show"}</Text>
          </Pressable>
          {placesOpen
            ? props.placements.map((row) => (
                <View key={`${row.platform}:${row.placement}`} style={styles.row}>
                  <Text style={styles.body}>
                    {`${platformName(row.platform)} · ${humanize(String(row.placement))}`}
                  </Text>
                  <Text style={styles.body}>{`${row.conversions} ${label}`}</Text>
                </View>
              ))
            : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sentence: { ...typography.body, color: textTokens.primary, marginTop: spacing.sm },
  muted: { ...typography.bodySm, color: textTokens.secondary, marginTop: spacing.sm },
  body: { ...typography.bodySm, color: textTokens.primary, flexShrink: 1 },
  charts: { gap: spacing.md, marginTop: spacing.md },
  chartsWide: { flexDirection: "row" },
  chart: { minHeight: 132 },
  chartWide: { flex: 1, minHeight: 160 },
  errorBox: { marginTop: spacing.md, gap: spacing.sm },
  retry: { minHeight: 44, minWidth: 88, justifyContent: "center", alignItems: "center", alignSelf: "flex-start" },
  retryLabel: { ...typography.buttonMd, color: textTokens.primary },
  expand: { minHeight: 44, flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.sm },
  expandLabel: { ...typography.bodySm, color: textTokens.primary },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm, marginTop: spacing.xs },
});
