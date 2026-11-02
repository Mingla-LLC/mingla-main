/**
 * #4238 wave 2 — results per day (bars) with cost per result (a line on its
 * own right-axis label). Hidden entirely when nothing has been counted; the
 * card then says so plainly.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Line, Path, Rect, Text as SvgText } from "react-native-svg";

import {
  glass,
  hostAdCharts,
  spacing,
  text as textTokens,
  typography,
} from "../../../../constants/designSystem";
import { formatHostAdMoneyCents } from "../hostAdMoney";
import { hostAdCostPerLabel, hostAdNoResultsLine, hostAdResultLabel } from "../hostAdCopy";
import {
  AXIS_ROW_INSET,
  HiddenWebTable,
  RIGHT_GUTTER,
  usePlotHeight,
  usePlotWidth,
} from "./chartParts";
import { linePath, shortDay, type ResultsSeries } from "./adResultsSeries";

export function resultsChartLabel(
  series: ResultsSeries,
  resultLabel: string,
  currency: string | null,
): string {
  const label = hostAdResultLabel(resultLabel);
  const best = series.points.reduce<{ day: string; results: number } | null>(
    (top, point) => (!top || point.results > top.results ? point : top),
    null,
  );
  // Total spend ÷ total results: an average of daily figures overweights
  // quiet days (one sale on a ₦100 day counts as much as ten on a ₦10,000 day).
  const average = series.costPerResult !== null
    ? `; ${hostAdCostPerLabel(resultLabel).toLowerCase()} ${formatHostAdMoneyCents(series.costPerResult, currency) ?? ""} on average`
    : "";
  return `${series.total} ${label} over ${series.points.length} ${series.points.length === 1 ? "day" : "days"}${best ? `, most on ${shortDay(best.day)} (${best.results})` : ""}${average}.`;
}

export function AdResultsChart(props: {
  series: ResultsSeries;
  resultLabel: string;
  currency: string | null;
}): React.ReactElement {
  const height = usePlotHeight();
  const { plotWidth, onLayout } = usePlotWidth();
  if (!props.series.show) {
    return (
      <Text style={styles.empty} testID="ad-results-chart-empty">
        {hostAdNoResultsLine(props.resultLabel)}
      </Text>
    );
  }
  const width = plotWidth - RIGHT_GUTTER;
  const points = props.series.points;
  const maxResults = Math.max(1, ...points.map((p) => p.results));
  const costs = points.map((p) => p.costPerResult);
  const maxCost = Math.max(1, ...costs.filter((v): v is number => v !== null));
  const slot = width / Math.max(points.length, 1);
  const barWidth = Math.max(4, Math.min(24, slot * 0.6));
  const costPoints = points
    .map((p, index) => ({ index, cost: p.costPerResult }))
    .filter((p): p is { index: number; cost: number } => p.cost !== null);
  const costLine = linePath(costPoints.map((p) => p.cost), width, height, maxCost);
  const costD = costPoints.length >= 2
    ? costPoints.map((p, i) => `${i === 0 ? "M" : "L"}${slot * p.index + slot / 2},${costLine.points[i].y}`).join(" ")
    : null;
  const label = resultsChartLabel(props.series, props.resultLabel, props.currency);
  return (
    <View testID="ad-results-chart">
      <View accessible accessibilityRole="image" accessibilityLabel={label} onLayout={onLayout}>
        <Svg
          width="100%"
          height={height}
          viewBox={`0 0 ${plotWidth} ${height}`}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Line x1="0" x2={width} y1={height} y2={height} stroke={glass.border.profileElevated} />
          {points.map((point, index) => {
            const h = (point.results / maxResults) * (height - 8);
            return (
              <Rect
                key={point.day}
                x={slot * index + (slot - barWidth) / 2}
                y={height - h}
                width={barWidth}
                height={h}
                rx="3"
                fill={hostAdCharts.results}
              />
            );
          })}
          {costD ? (
            <Path d={costD} fill="none" stroke={hostAdCharts.costPerResult} strokeWidth="2" />
          ) : null}
          {costPoints.length > 0 ? (
            <SvgText x={width + 4} y={12} fill={textTokens.tertiary} fontSize="11">
              {formatHostAdMoneyCents(maxCost, props.currency)?.split(" ").pop() ?? ""}
            </SvgText>
          ) : null}
        </Svg>
      </View>
      <View style={[styles.axisRow, AXIS_ROW_INSET]}>
        <Text style={styles.axisText}>{shortDay(points[0].day)}</Text>
        <Text style={styles.axisText}>{shortDay(points[points.length - 1].day)}</Text>
      </View>
      <View style={styles.legend}>
        <Text style={styles.legendText}>{`Bars: ${hostAdResultLabel(props.resultLabel)} per day`}</Text>
        {costPoints.length > 0 ? (
          <Text style={styles.legendText}>{`Line: ${hostAdCostPerLabel(props.resultLabel).toLowerCase()}`}</Text>
        ) : null}
      </View>
      <HiddenWebTable
        caption="Results by day"
        rows={points.map((p) => `${shortDay(p.day)}: ${p.results}${p.costPerResult !== null ? `, ${formatHostAdMoneyCents(p.costPerResult, props.currency)} each` : ""}`)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { ...typography.bodySm, color: textTokens.secondary, marginTop: spacing.md },
  axisRow: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.xs },
  axisText: { ...typography.caption, color: textTokens.tertiary },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.xs },
  legendText: { ...typography.caption, color: textTokens.secondary },
});
