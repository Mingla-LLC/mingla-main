import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  accent,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { formatCurrency } from "../../utils/currency";
import type { BrandMinglaDroveRollup } from "../../services/brandAnalyticsService";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";

interface AnalyticsHomeTileProps {
  data: BrandMinglaDroveRollup | undefined;
  isLoading: boolean;
  isError: boolean;
  onPress: () => void;
}

const customerLabel = (count: number): string =>
  `${count.toLocaleString("en-GB")} ${count === 1 ? "customer" : "customers"}`;

const valueLabels = (values: Record<string, number>): string[] =>
  Object.entries(values).map(
    ([currency, cents]) => `${formatCurrency(cents, currency, true)} booking value`,
  );

export const AnalyticsHomeTile: React.FC<AnalyticsHomeTileProps> = ({
  data,
  isLoading,
  isError,
  onPress,
}) => {
  const valid = data?.authorized === true && !isError;
  const values = valid ? valueLabels(data.valueCents30d) : [];
  const count = valid ? data.minglaDrove30d : 0;
  const loadedLines = [
    customerLabel(count),
    ...(values.length > 0 ? values : ["No paid booking value yet"]),
  ];
  const accessibilityLabel = valid
    ? `Open Analytics, ${loadedLines.join(", ")}`
    : isLoading
      ? "Open Analytics, loading 30-day snapshot"
      : "Open Analytics, couldn't load your 30-day snapshot";

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
      testID="analytics-home-tile"
    >
      <GlassCard variant="base" style={styles.card}>
        <View style={styles.header}>
          <View style={styles.iconWrap} accessible={false}>
            <Icon name="chart" size={20} color={accent.warm} />
          </View>
          <Text style={styles.eyebrow}>ANALYTICS</Text>
        </View>
        <Text style={styles.title} accessibilityRole="header">
          Customers Mingla drove you
        </Text>
        <Text style={styles.window}>Last 30 days</Text>
        {isLoading ? (
          <View style={styles.skeletons} testID="analytics-home-loading">
            <Skeleton width="46%" height={20} />
            <Skeleton width="72%" height={16} />
          </View>
        ) : valid ? (
          <View style={styles.values}>
            <Text style={styles.customer}>{customerLabel(count)}</Text>
            {(values.length > 0 ? values : ["No paid booking value yet"]).map(
              (line) => (
                <Text key={line} style={styles.value}>
                  {line}
                </Text>
              ),
            )}
          </View>
        ) : (
          <Text style={styles.error}>Couldn&apos;t load your 30-day snapshot</Text>
        )}
        <View style={styles.action}>
          <Text style={styles.actionText}>Open</Text>
          <View accessible={false}>
            <Icon name="chevR" size={16} color={accent.warm} />
          </View>
        </View>
      </GlassCard>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  pressable: { minHeight: 44 },
  pressed: { opacity: 0.72 },
  card: { minHeight: 188 },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconWrap: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  eyebrow: {
    color: textTokens.tertiary,
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
  },
  title: {
    color: textTokens.primary,
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    fontWeight: "700",
    marginTop: spacing.sm,
  },
  window: {
    color: textTokens.tertiary,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
  },
  skeletons: { gap: spacing.sm, marginTop: spacing.md },
  values: { gap: spacing.xs, marginTop: spacing.md },
  customer: {
    color: textTokens.primary,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
  },
  value: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
  },
  error: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    marginTop: spacing.md,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  actionText: {
    color: accent.warm,
    fontSize: typography.buttonMd.fontSize,
    lineHeight: typography.buttonMd.lineHeight,
    fontWeight: typography.buttonMd.fontWeight,
  },
});

export default AnalyticsHomeTile;
