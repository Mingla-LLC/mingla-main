import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Svg, { Circle, Path } from "react-native-svg";

import {
  accent,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useBrandFollowerSummary } from "../../hooks/useBrandFollowerSummary";
import type { BrandFollowerSummary } from "../../types/brandFollowers";
import { formatCount } from "../../utils/currency";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";

export function followerSourceLine(summary: BrandFollowerSummary): string | null {
  if (summary.newThisWeek === 0) return null;
  const sources = summary.sourcesThisWeek;
  const parts = [
    sources.checkout > 0 ? `${formatCount(sources.checkout)} from checkout` : null,
    sources.brandPage > 0
      ? `${formatCount(sources.brandPage)} from the brand page`
      : null,
    sources.emailInvite > 0
      ? `${formatCount(sources.emailInvite)} from email invites`
      : null,
    sources.other > 0 ? `${formatCount(sources.other)} from elsewhere` : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join(" · ");
}

export interface FollowersHomeTileProps {
  brandId: string;
}

const FollowerSparkline: React.FC<{
  trend: BrandFollowerSummary["trend"];
}> = ({ trend }) => {
  const geometry = useMemo(() => {
    const min = Math.min(...trend);
    const max = Math.max(...trend);
    const range = max - min;
    const divisor = Math.max(trend.length - 1, 1);
    const points = trend.map((value, index) => ({
      x: (index / divisor) * 300,
      y: range === 0 ? 23 : 40 - ((value - min) / range) * 34,
    }));
    const line = points
      .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
      .join(" ");
    return {
      line,
      last: points[points.length - 1] ?? { x: 0, y: 23 },
    };
  }, [trend]);

  return (
    <View accessible={false} style={styles.sparkline}>
      <Svg width="100%" height={46} viewBox="0 0 300 46">
        <Path
          d={geometry.line}
          fill="none"
          stroke={accent.warm}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle
          cx={geometry.last.x}
          cy={geometry.last.y}
          r="3"
          fill={accent.warm}
          stroke={textTokens.primary}
          strokeWidth="2"
        />
      </Svg>
    </View>
  );
};

export const FollowersHomeTile: React.FC<FollowersHomeTileProps> = ({
  brandId,
}) => {
  const router = useRouter();
  const summaryQuery = useBrandFollowerSummary(brandId);
  const summary = summaryQuery.data;
  const exact = summary === undefined ? "0" : formatCount(summary.total);
  const weekly = summary?.newThisWeek ?? 0;
  const sources = summary === undefined ? null : followerSourceLine(summary);
  const accessibilityLabel = summaryQuery.isLoading
    ? "Followers, loading"
    : summaryQuery.isError || summary === undefined
      ? "Followers, unavailable"
      : `Followers over 7 days, ${exact} now, +${formatCount(weekly)} this week`;

  return (
    <Pressable
      onPress={() => router.push("/(tabs)/marketing/people" as never)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => pressed && styles.pressed}
      testID="followers-home-tile"
    >
      <GlassCard variant="base" style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.label}>Followers</Text>
          <View accessible={false}>
            <Icon name="chevR" size={16} color={textTokens.tertiary} />
          </View>
        </View>
        {summaryQuery.isLoading ? (
          <View style={styles.loading} testID="followers-home-loading">
            <Skeleton width={92} height={34} />
            <Skeleton width="100%" height={46} />
            <Skeleton width="72%" height={14} />
          </View>
        ) : summaryQuery.isError || summary === undefined ? (
          <View style={styles.state}>
            <Text style={styles.value}>—</Text>
            <Text style={styles.sub}>Couldn&apos;t load</Text>
          </View>
        ) : (
          <View style={styles.body}>
            <View style={styles.valueRow}>
              <Text style={styles.value}>{exact}</Text>
              {weekly > 0 ? (
                <Text style={styles.delta}>
                  +{formatCount(weekly)} this week
                </Text>
              ) : null}
            </View>
            {summary.total === 0 ? (
              <Text style={styles.sub}>Share your page to get your first</Text>
            ) : (
              <>
                <FollowerSparkline trend={summary.trend} />
                {sources === null ? null : (
                  <Text style={styles.sources} numberOfLines={2}>
                    {sources}
                  </Text>
                )}
              </>
            )}
          </View>
        )}
      </GlassCard>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  pressed: { opacity: 0.82 },
  card: { minHeight: 188 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: {
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    color: textTokens.tertiary,
  },
  loading: { gap: spacing.sm, marginTop: spacing.md },
  state: { gap: spacing.xs, marginTop: spacing.md },
  body: { gap: spacing.sm, marginTop: spacing.md },
  valueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  value: {
    fontSize: typography.statValue.fontSize,
    lineHeight: typography.statValue.lineHeight,
    fontWeight: typography.statValue.fontWeight,
    color: textTokens.primary,
  },
  delta: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
    color: semantic.success,
  },
  sparkline: { minHeight: 46 },
  sub: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  sources: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
  },
});

export default FollowersHomeTile;
