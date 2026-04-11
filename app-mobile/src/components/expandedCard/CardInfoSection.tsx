import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Icon } from "../ui/Icon";
import { parseAndFormatDistance } from "../utils/formatters";
import { PriceTierSlug, tierLabel, tierRangeLabel, googleLevelToTierSlug, TIER_BY_SLUG } from "../../constants/priceTiers";
import { getCurrencySymbol, getCurrencyRate } from "../utils/formatters";
import { useTranslation } from "react-i18next";
import { getReadableCategoryName } from "../../utils/categoryUtils";

interface CardInfoSectionProps {
  title: string;
  category: string;
  categoryIcon?: string;
  tags?: string[];
  rating?: number;
  distance?: string;
  travelTime?: string;
  travelMode?: string;
  measurementSystem?: "Metric" | "Imperial";
  priceRange?: string;
  priceTier?: PriceTierSlug;
  priceLevel?: string | number | null;
  description?: string;
  tip?: string | null;
  currency?: string;
}

/** Map travel mode preference to an icon name */
function getTravelModeIcon(mode?: string): string {
  switch (mode) {
    case 'driving': return 'car-outline';
    case 'transit': return 'bus-outline';
    case 'bicycling':
    case 'biking': return 'bicycle-outline';
    case 'walking': return 'walk-outline';
    default: return 'navigate-outline';
  }
}

export default function CardInfoSection({
  title,
  category,
  categoryIcon,
  tags = [],
  rating,
  distance,
  travelTime,
  travelMode,
  measurementSystem,
  priceRange,
  priceTier,
  priceLevel,
  description,
  tip,
  currency = 'USD',
}: CardInfoSectionProps) {
  const { t } = useTranslation(['expanded_details', 'common']);
  const resolvedTier = priceTier ?? googleLevelToTierSlug(priceLevel);
  const tierData = TIER_BY_SLUG[resolvedTier];
  const currencySymbol = getCurrencySymbol(currency || 'USD');
  const currencyRate = getCurrencyRate(currency || 'USD');
  const tierDisplayText = `${tierLabel(resolvedTier)} · ${tierRangeLabel(resolvedTier, currencySymbol, currencyRate)}`;
  const tierColor = tierData?.color ?? '#d97706';
  // Get category icon component
  const getCategoryIcon = () => {
    if (categoryIcon) {
      return categoryIcon;
    }
    // Default icons based on category
    const categoryLower = category.toLowerCase();
    if (categoryLower.includes("stroll") || categoryLower.includes("walk")) {
      return "cafe";
    }
    if (categoryLower.includes("sip") || categoryLower.includes("chill")) {
      return "wine";
    }
    if (
      categoryLower.includes("dining") ||
      categoryLower.includes("restaurant")
    ) {
      return "restaurant";
    }
    if (categoryLower.includes("picnic")) {
      return "basket";
    }
    if (categoryLower.includes("wellness")) {
      return "leaf";
    }
    if (
      categoryLower.includes("creative") ||
      categoryLower.includes("hands-on")
    ) {
      return "color-palette";
    }
    if (categoryLower.includes("play") || categoryLower.includes("move")) {
      return "game-controller";
    }
    return "star";
  };

  // Format a raw tag into a user-friendly label (e.g. "state_park" → "State Park")
  const formatTag = (tag: string): string =>
    tag
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

  // Find "Romantic" tag or use first tag
  const romanticTag =
    tags.find((tag) => tag.toLowerCase().includes("romantic")) || tags[0];

  return (
    <View style={styles.container}>
      {/* Title */}
      <Text style={styles.title}>{title}</Text>

      {/* Tags Row */}
      <View style={styles.tagsRow}>
        <View style={styles.categoryTag}>
          <Icon name={getCategoryIcon()} size={14} color="#d97706" />
          <Text style={styles.categoryText}>{getReadableCategoryName(category)}</Text>
        </View>
        {romanticTag && (
          <>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.tagText}>{formatTag(romanticTag)}</Text>
          </>
        )}
      </View>

      {/* Metrics Row */}
      <View style={styles.metricsRow}>
        {rating !== undefined && (
          <View style={styles.metricItem}>
            <Icon name="star" size={14} color="#fbbf24" />
            <Text style={styles.metricText}>{rating.toFixed(1)}</Text>
          </View>
        )}
        {distance && (
          <>
            {rating !== undefined && <View style={styles.metricDivider} />}
            <View style={styles.metricItem}>
              <Icon name="location" size={14} color="#d97706" />
              <Text style={styles.metricText}>{parseAndFormatDistance(distance, measurementSystem) || t('expanded_details:card_info.nearby')}</Text>
            </View>
          </>
        )}
        {travelTime && travelTime !== '0 min' && (
          <>
            {(rating !== undefined || distance) && <View style={styles.metricDivider} />}
            <View style={styles.metricItem}>
              <Icon name={getTravelModeIcon(travelMode)} size={14} color="#d97706" />
              <Text style={styles.metricText}>{travelTime}</Text>
            </View>
          </>
        )}
        {resolvedTier && (
          <>
            {(rating !== undefined || distance || (travelTime && travelTime !== '0 min')) && (
              <View style={styles.metricDivider} />
            )}
            <Text style={[styles.priceText, { color: tierColor }]}>{tierDisplayText}</Text>
          </>
        )}
      </View>

      {/* Description */}
      {description && <Text style={styles.description}>{description}</Text>}
      {tip && <Text style={styles.tip}>{tip}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 12,
    lineHeight: 32,
  },
  tagsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    flexWrap: "wrap",
  },
  categoryTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  categoryText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#d97706",
  },
  bullet: {
    fontSize: 14,
    color: "#6b7280",
    marginHorizontal: 8,
  },
  tagText: {
    fontSize: 14,
    color: "#6b7280",
    fontWeight: 600,
  },
  metricsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    flexWrap: "wrap",
  },
  metricItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metricText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#d97706",
  },
  metricDivider: {
    width: 1,
    height: 16,
    backgroundColor: "#e5e7eb",
    marginHorizontal: 12,
  },
  priceText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#d97706",
  },
  description: {
    fontSize: 15,
    color: "#374151",
    lineHeight: 22,
    marginBottom: 8,
  },
  tip: {
    fontSize: 13,
    fontStyle: "italic",
    color: "#9CA3AF",
    marginTop: 2,
  },
});
