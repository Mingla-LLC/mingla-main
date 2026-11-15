/**
 * #4420 (R8 P19, mockup venue-detail__module-reviews-r8) — the Reviews summary
 * row at the top of venue Overview. It reads the same scoped list the Reviews
 * module reads (lazily, so the program service stays out of the eager chunk)
 * and opens the Reviews module. Hidden while loading, on a failed read, and
 * when the place has no reviews: an optional row, never an error.
 */
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import {
  summarizeVenueReviews,
  venueReviewsSummaryLine,
  type VenueReviewsSummary,
} from "./venueReviewsSummary";

export interface VenueReviewsSummaryRowProps {
  brandId: string;
  placePoolId: string;
  onOpen: () => void;
}

export function VenueReviewsSummaryRow({
  brandId,
  placePoolId,
  onOpen,
}: VenueReviewsSummaryRowProps): React.ReactElement | null {
  const [summary, setSummary] = useState<VenueReviewsSummary | null>(null);

  useEffect(() => {
    let active = true;
    void import("../../services/localReviewsService")
      .then(({ localReviewsService }) =>
        localReviewsService.forClaimedPlace(brandId, placePoolId),
      )
      .then((reviews) => {
        if (active) setSummary(summarizeVenueReviews(reviews, Date.now()));
      })
      .catch(() => {
        // Optional row: a failed read leaves it out (the Reviews module shows its own state).
        if (active) setSummary(null);
      });
    return () => {
      active = false;
    };
  }, [brandId, placePoolId]);

  if (summary === null || summary.count === 0) return null;
  const line = venueReviewsSummaryLine(summary);
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Reviews: ${line}. Open Reviews`}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
      testID="venue-overview-reviews-summary"
    >
      <View style={styles.iconWell}>
        <Icon name="star" size={16} color={color.text1} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>Reviews</Text>
        <Text style={styles.line} numberOfLines={1}>
          {line}
        </Text>
      </View>
      <Icon name="chevR" size={16} color={color.text3} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    minHeight: 56,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    marginBottom: space[4],
    borderRadius: radius.lg,
    backgroundColor: color.fill.tile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  pressed: { opacity: 0.7 },
  iconWell: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.fill.inset,
  },
  text: { flex: 1, minWidth: 0 },
  title: { ...type.row, color: color.text1 },
  line: { ...type.caption, color: color.text2 },
});
