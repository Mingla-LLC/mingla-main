import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { accent, spacing, text as textTokens } from "../../constants/designSystem";
import { useBrandFollowerSummary } from "../../hooks/useBrandFollowerSummary";
import { Icon } from "../ui/Icon";
import { KpiTile } from "../ui/KpiTile";
import { formatCount } from "../../utils/currency";
import type { BrandFollowerSummary } from "../../types/brandFollowers";

export type FollowerKpiPresentation = {
  value: string;
  delta?: string;
  deltaUp?: true;
  sub?: string;
};

export function followerKpiPresentation(
  summary: BrandFollowerSummary | undefined,
  failed: boolean,
): FollowerKpiPresentation {
  if (failed || summary === undefined) {
    return { value: "—", sub: "Couldn't load" };
  }
  if (summary.total === 0) {
    return { value: "0", sub: "Share your page to get your first" };
  }
  return {
    value: formatCount(summary.total),
    delta:
      summary.newThisWeek > 0
        ? `+${formatCount(summary.newThisWeek)} this week`
        : undefined,
    deltaUp: summary.newThisWeek > 0 ? true : undefined,
  };
}

export interface FollowersKpiTileProps {
  brandId: string;
  onOpenPeople?: () => void;
}

export const FollowersKpiTile: React.FC<FollowersKpiTileProps> = ({
  brandId,
  onOpenPeople,
}) => {
  const summaryQuery = useBrandFollowerSummary(brandId);
  const summary = summaryQuery.data;
  const failed = summaryQuery.isError;
  const total = summary?.total ?? 0;
  const newThisWeek = summary?.newThisWeek ?? 0;
  const exact = formatCount(total);
  const presentation = followerKpiPresentation(summary, failed);

  const tile = (
    <View>
      <KpiTile
        label="Followers"
        value={presentation.value}
        delta={presentation.delta}
        deltaUp={presentation.deltaUp}
        sub={presentation.sub}
        loading={summaryQuery.isLoading}
        testID="followers-kpi-tile"
        style={styles.highlightedTile}
      />
      {onOpenPeople !== undefined ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.chevron}
        >
          <Icon name="chevR" size={14} color={textTokens.tertiary} />
        </View>
      ) : null}
    </View>
  );

  if (onOpenPeople === undefined) return tile;

  return (
    <Pressable
      onPress={onOpenPeople}
      accessibilityRole="button"
      accessibilityLabel={
        summaryQuery.isLoading
          ? "Followers, loading"
          : failed
            ? "Followers, unavailable. Open People"
            : `Followers, ${exact}. ${newThisWeek > 0 ? `+${formatCount(newThisWeek)} this week. ` : ""}Open People`
      }
      style={({ pressed }) => pressed && styles.pressed}
    >
      {tile}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  highlightedTile: {
    backgroundColor: "rgba(235, 120, 37, 0.12)",
    borderColor: accent.border,
    borderWidth: 1,
  },
  chevron: {
    position: "absolute",
    top: spacing.md,
    right: spacing.md,
  },
  pressed: {
    opacity: 0.82,
  },
});

export default FollowersKpiTile;
