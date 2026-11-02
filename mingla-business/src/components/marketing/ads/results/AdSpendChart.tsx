/**
 * #4238 wave 2 — spend over time against the budget. A cumulative spend line
 * (accent.warm), a dashed budget line (text.tertiary) and the 98% pause
 * point. One or two days draw labelled dots, not a line. No animation.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";

import {
  accent,
  glass,
  spacing,
  text as textTokens,
  typography,
} from "../../../../constants/designSystem";
import { formatHostAdMoneyCents } from "../hostAdMoney";
import { HOST_AD_RESULTS_COPY } from "../hostAdCopy";
import {
  AXIS_ROW_INSET,
  HiddenWebTable,
  RIGHT_GUTTER,
  usePlotHeight,
  usePlotWidth,
} from "./chartParts";
import { linePath, shortDay, type SpendSeries } from "./adResultsSeries";

function money(cents: number | null, currency: string | null): string {
  return formatHostAdMoneyCents(cents, currency) ?? "—";
}

/** The sentence the chart's accessibility label carries. */
export function spendChartLabel(series: SpendSeries): string {
  if (series.points.length === 0 || series.total === null) {
    return HOST_AD_RESULTS_COPY.noSpend;
  }
  const days = series.spendDays;
  const budget = series.budget !== null
    ? ` of ${money(series.budget, series.currency)} budget`
    : "";
  const highest = series.highest
    ? `, highest ${money(series.highest.cents, series.currency)} on ${shortDay(series.highest.day)}`
    : "";
  return `Spend over ${days} ${days === 1 ? "day" : "days"}: ${money(series.total, series.currency)}${budget}${highest}.`;
}

export function AdSpendChart({ series }: { series: SpendSeries }): React.ReactElement {
  const height = usePlotHeight();
  const { plotWidth, onLayout } = usePlotWidth();
  if (series.points.length === 0 || series.total === null) {
    return (
      <Text style={styles.empty} testID="ad-spend-chart-empty">
        {HOST_AD_RESULTS_COPY.noSpend}
      </Text>
    );
  }
  const width = plotWidth - RIGHT_GUTTER;
  const max = Math.max(series.total, series.budget ?? 0, 1);
  const values = series.points.map((point) => point.cumulative);
  const path = linePath(values, width, height, max);
  const y = (value: number) => height - (value / max) * (height - 8);
  const few = series.points.length <= 2;
  const label = spendChartLabel(series);
  return (
    <View testID="ad-spend-chart">
      <View accessible accessibilityRole="image" accessibilityLabel={label} onLayout={onLayout}>
        <Svg
          width="100%"
          height={height}
          viewBox={`0 0 ${plotWidth} ${height}`}
          testID="ad-spend-chart-svg"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Line x1="0" x2={width} y1={height} y2={height} stroke={glass.border.profileElevated} />
          {series.budget !== null ? (
            <>
              <Line
                x1="0"
                x2={width}
                y1={y(series.budget)}
                y2={y(series.budget)}
                stroke={textTokens.tertiary}
                strokeDasharray="4 5"
              />
              <SvgText x={width + 4} y={y(series.budget) + 4} fill={textTokens.tertiary} fontSize="11">
                Budget
              </SvgText>
              {series.pauseAt !== null ? (
                <SvgText x={width + 4} y={Math.min(height - 2, y(series.pauseAt) + 16)} fill={textTokens.tertiary} fontSize="11">
                  98%
                </SvgText>
              ) : null}
            </>
          ) : null}
          {few ? null : (
            <Path
              d={path.d}
              fill="none"
              stroke={accent.warm}
              strokeWidth="3"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {(few ? path.points : path.points.slice(-1)).map((point, index) => (
            <Circle
              key={`${point.x}-${index}`}
              cx={point.x}
              cy={point.y}
              r="5"
              fill={accent.warm}
              stroke={textTokens.primary}
              strokeWidth="2"
            />
          ))}
        </Svg>
      </View>
      {few ? (
        <View style={styles.fewRow}>
          {series.points.map((point, index) => {
            const previous = index === 0 ? 0 : series.points[index - 1].cumulative;
            return (
              <Text key={point.day} style={styles.axisText}>
                {`${shortDay(point.day)}: ${money(point.cumulative - previous, series.currency)}`}
              </Text>
            );
          })}
        </View>
      ) : (
        <View style={[styles.axisRow, AXIS_ROW_INSET]} testID="ad-spend-chart-axis">
          <Text style={styles.axisText}>{shortDay(series.points[0].day)}</Text>
          <Text style={styles.axisText}>{shortDay(series.points[series.points.length - 1].day)}</Text>
        </View>
      )}
      {!series.inHostCurrency ? (
        <Text style={styles.note} testID="ad-spend-chart-usd">
          {HOST_AD_RESULTS_COPY.usdOnly}
        </Text>
      ) : null}
      <HiddenWebTable
        caption="Spend by day"
        rows={series.points.map((point) => `${shortDay(point.day)}: ${money(point.cumulative, series.currency)} so far`)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { ...typography.bodySm, color: textTokens.secondary, marginTop: spacing.md },
  axisRow: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.xs },
  fewRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.xs },
  axisText: { ...typography.caption, color: textTokens.tertiary },
  note: { ...typography.caption, color: textTokens.tertiary, marginTop: spacing.xs },
});
