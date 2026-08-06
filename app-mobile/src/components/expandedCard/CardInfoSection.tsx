import React from "react";
import { View, Text, StyleSheet, Linking } from "react-native";
import { Icon } from "../ui/Icon";
import { parseAndFormatDistance } from "../utils/formatters";
import { useTranslation } from "react-i18next";
import { getReadableCategoryName } from "../../utils/categoryUtils";
import {
  canonicalDiscoveryPriceDetail,
  type CanonicalDiscoveryPrice,
} from "../../utils/priceTiers";

interface CardInfoSectionProps {
  title: string;
  category: string;
  categoryIcon?: string;
  tags?: string[];
  rating?: number;
  distance?: string | null;
  travelTime?: string | null;
  travelMode?: string;
  measurementSystem?: "Metric" | "Imperial";
  discoveryPrice?: Partial<CanonicalDiscoveryPrice>;
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
  discoveryPrice,
  description,
  tip,
}: CardInfoSectionProps) {
  const { t } = useTranslation(['expanded_details', 'common']);
  const priceDetail = canonicalDiscoveryPriceDetail(
    discoveryPrice as CanonicalDiscoveryPrice | undefined,
  );
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

      {/* Metrics Row — compact pill chips */}
      <View style={styles.metricsRow}>
        {/* #1669: a POSITIVE rating only. `rating !== undefined` rendered the
            chip for an unrated place as `★ 0.0`, because `0` is not
            `undefined` — an invented zero reads as a real, terrible score,
            which is worse than the 4.5 it replaced. Constitution #9: missing
            data is HIDDEN. This is also the guard the curated stop list, the
            alternates row and the picnic grocery row already use, and it is
            what makes the hiding true regardless of which producer minted the
            card — including for the one servable pool place whose stored
            rating is literally 0. */}
        {rating != null && rating > 0 && (
          <View style={styles.metricPill}>
            <Icon name="star" size={12} color="#fbbf24" />
            <Text style={styles.metricPillText}>{rating.toFixed(1)}</Text>
          </View>
        )}
        {/* ORCH-0659: honest null propagation; no "nearby" fallback. */}
        {distance != null && (
          <View style={styles.metricPill}>
            <Icon name="location-outline" size={12} color="#eb7825" />
            <Text style={styles.metricPillText}>{parseAndFormatDistance(distance, measurementSystem)}</Text>
          </View>
        )}
        {/* ORCH-0660: travelMode prop now threaded; icon matches user's selected mode. */}
        {travelTime != null && (
          <View style={styles.metricPill}>
            <Icon name={getTravelModeIcon(travelMode)} size={12} color="#eb7825" />
            <Text style={styles.metricPillText}>{travelTime}</Text>
          </View>
        )}
        {priceDetail ? (
          <View style={styles.metricPill}>
            <Icon name="cash-outline" size={12} color="#eb7825" />
            <Text style={styles.metricPillText}>{priceDetail.source}</Text>
          </View>
        ) : null}
      </View>

      {priceDetail?.approximate ? (
        <View style={styles.priceProvenance}>
          <Text style={styles.priceApproximate}>
            Approx. {priceDetail.approximate}
            {priceDetail.ratesDate
              ? ` · rates from ${new Date(priceDetail.ratesDate).toLocaleDateString()}`
              : ""}
          </Text>
          {priceDetail.attributionUrl ? (
            <Text
              accessibilityRole="link"
              style={styles.priceAttribution}
              onPress={() => Linking.openURL(priceDetail.attributionUrl as string)}
            >
              Rates by ExchangeRate-API
            </Text>
          ) : null}
        </View>
      ) : null}

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
    gap: 8,
  },
  metricPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#fff7ed",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#fed7aa",
  },
  metricPillText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#92400e",
  },
  priceProvenance: {
    marginTop: -8,
    marginBottom: 16,
  },
  priceApproximate: {
    fontSize: 12,
    color: "#6b7280",
  },
  priceAttribution: {
    fontSize: 12,
    color: "#d97706",
    textDecorationLine: "underline",
    marginTop: 2,
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
