/**
 * TripPreview — buyer-eye preview of a Trip. Used in:
 *   - Wizard Step 5 (review-before-publish)
 *   - Public buyer-anon route /t/{brandSlug}/{tripSlug}
 *
 * Tr2 (ORCH-0859). Per SPEC §4.8.
 *
 * Sections (top → bottom):
 *   1. Cover image hero (full-width)
 *   2. Title + brand byline
 *   3. Dates pill + destination line
 *   4. Day-by-day itinerary (stacked day cards)
 *   5. What's included / What's NOT included (parallel lists)
 *   6. Pricing card
 *   7. "Reserve my spot" CTA (sticky-bottom variant available via showCta prop)
 *
 * Anon-tolerant: this component does NOT call useAuth. Public-page caller
 * passes the Trip + Brand payload from usePublicTripBySlug; wizard caller
 * passes the in-flight draft Trip + currentBrand.
 */

import React from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { formatTripDateRange } from "@mingla/event-rendering";
import { Icon } from "../ui/Icon";
import type {
  Trip,
  TripDay,
  TripInclusion,
  TripPricingTier,
} from "../../services/tripsService";

export interface TripPreviewBrand {
  id: string;
  slug: string;
  name: string;
  bio?: string | null;
  coverMediaUrl?: string | null;
}

export interface TripPreviewProps {
  trip: Trip;
  brand: TripPreviewBrand;
  /** When true, render the "Reserve my spot" CTA. False for wizard preview. */
  showCta?: boolean;
  /** Optional body padding override for framed parent surfaces like the wizard. */
  contentPadding?: number;
  /** Fired when buyer taps the CTA. Required when showCta=true. */
  onReserveTap?: () => void;
  testID?: string;
}

// ORCH-1016 — date range now from the shared @mingla/event-rendering helper so
// the consumer card/detail and this preview/public page format identically.

function formatPrice(tier: TripPricingTier | undefined): string {
  if (tier === undefined) return "Pricing TBD";
  if (tier.priceCents === 0) return "Free";
  try {
    const major = tier.priceCents / 100;
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: tier.currency || "USD",
    }).format(major);
  } catch {
    return `${(tier.priceCents / 100).toFixed(2)} ${tier.currency}`;
  }
}

export const TripPreview: React.FC<TripPreviewProps> = ({
  trip,
  brand,
  showCta = false,
  contentPadding = spacing.lg,
  onReserveTap,
  testID,
}) => {
  const includedItems = trip.inclusions.filter((i) => i.kind === "included");
  const excludedItems = trip.inclusions.filter((i) => i.kind === "excluded");
  const tier = trip.pricingTiers[0];

  return (
    <View style={styles.host} testID={testID}>
      {/* Cover image */}
      {trip.coverMediaUrl !== null ? (
        <Image
          source={{ uri: trip.coverMediaUrl }}
          style={styles.cover}
          accessibilityLabel={`Cover image for ${trip.title}`}
        />
      ) : (
        <View style={[styles.cover, styles.coverPlaceholder]}>
          <Text style={styles.coverPlaceholderText}>No cover image</Text>
        </View>
      )}

      <View style={[styles.body, { padding: contentPadding }]}>
        {/* Title + brand byline */}
        <Text style={styles.title}>{trip.title}</Text>
        <Text style={styles.brandByline}>by {brand.name}</Text>

        {/* Dates + destination */}
        <View style={styles.metaRow}>
          <Icon name="calendar" size={16} color={accent.warm} />
          <Text style={styles.metaText}>
            {formatTripDateRange(
              trip.businessTrip.startAt,
              trip.businessTrip.endAt,
            )}
          </Text>
        </View>
        {/* ORCH-1016 — "Leaving from {city}" ABOVE destination ("leave here →
            go there"). Conditional: hidden when departure not set. Mirrors the
            consumer card + detail treatment (paper-plane icon, sentence case). */}
        {trip.businessTrip.departureLocationText !== null ? (
          <View style={styles.metaRow}>
            <Icon name="send" size={16} color={accent.warm} />
            <Text style={styles.metaText} numberOfLines={2}>
              Leaving from {trip.businessTrip.departureLocationText}
            </Text>
          </View>
        ) : null}
        {trip.businessTrip.destinationLocationText !== null ? (
          <View style={styles.metaRow}>
            <Icon name="location" size={16} color={accent.warm} />
            <Text style={styles.metaText} numberOfLines={2}>
              {trip.businessTrip.destinationLocationText}
            </Text>
          </View>
        ) : null}
        {trip.businessTrip.capacity !== null ? (
          <View style={styles.metaRow}>
            <Icon name="users" size={16} color={accent.warm} />
            <Text style={styles.metaText}>
              {trip.businessTrip.capacity} traveler
              {trip.businessTrip.capacity === 1 ? "" : "s"} max
            </Text>
          </View>
        ) : null}

        {/* Description */}
        {trip.description !== null && trip.description.trim().length > 0 ? (
          <Text style={styles.description}>{trip.description}</Text>
        ) : null}

        {/* Itinerary */}
        {trip.days.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Day by day</Text>
            <View style={styles.daysList}>
              {trip.days.map((day: TripDay) => (
                <View key={day.id} style={styles.dayCard}>
                  <Text style={styles.dayOrdinal}>DAY {day.ordinal}</Text>
                  <Text style={styles.dayTitle}>{day.title}</Text>
                  {day.narrative !== null && day.narrative.trim().length > 0 ? (
                    <Text style={styles.dayNarrative}>{day.narrative}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Included / Excluded */}
        {includedItems.length > 0 || excludedItems.length > 0 ? (
          <View style={styles.section}>
            {includedItems.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>What&rsquo;s included</Text>
                <View style={styles.itemsList}>
                  {includedItems.map((i: TripInclusion) => (
                    <View key={i.id} style={styles.itemRow}>
                      <Icon name="check" size={14} color={accent.warm} />
                      <Text style={styles.itemText}>{i.item}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
            {excludedItems.length > 0 ? (
              <>
                <Text style={[styles.sectionLabel, styles.excludedLabel]}>
                  What&rsquo;s NOT included
                </Text>
                <View style={styles.itemsList}>
                  {excludedItems.map((i: TripInclusion) => (
                    <View key={i.id} style={styles.itemRow}>
                      <Icon name="close" size={14} color={textTokens.tertiary} />
                      <Text style={styles.itemText}>{i.item}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </View>
        ) : null}

        {/* Pricing */}
        {tier !== undefined ? (
          <View style={styles.pricingCard}>
            <View>
              <Text style={styles.pricingTierName}>{tier.tierName}</Text>
              <Text style={styles.pricingPrice}>{formatPrice(tier)}</Text>
            </View>
            {showCta && onReserveTap !== undefined ? (
              <Pressable
                onPress={onReserveTap}
                accessibilityRole="button"
                accessibilityLabel={`Reserve your spot on ${trip.title}`}
                style={styles.reserveCta}
                testID="trip-preview-reserve-cta"
              >
                <Text style={styles.reserveCtaText}>Reserve my spot</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    backgroundColor: "transparent",
  },
  cover: {
    width: "100%",
    height: 220,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  coverPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  coverPlaceholderText: {
    color: textTokens.tertiary,
    fontSize: typography.caption.fontSize,
  },
  body: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    fontSize: typography.h1.fontSize,
    lineHeight: typography.h1.lineHeight,
    fontWeight: typography.h1.fontWeight,
    color: textTokens.primary,
  },
  brandByline: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  metaText: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
    flex: 1,
  },
  description: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    marginTop: spacing.md,
  },
  section: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  sectionLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: textTokens.secondary,
    textTransform: "uppercase",
  },
  excludedLabel: {
    marginTop: spacing.md,
  },
  daysList: {
    gap: spacing.sm,
  },
  dayCard: {
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    gap: spacing.xs,
  },
  dayOrdinal: {
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: accent.warm,
  },
  dayTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  dayNarrative: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  itemsList: {
    gap: spacing.xs,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  itemText: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
    flex: 1,
  },
  pricingCard: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radiusTokens.lg,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  pricingTierName: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  pricingPrice: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
    marginTop: 2,
  },
  reserveCta: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radiusTokens.md,
    backgroundColor: accent.warm,
  },
  reserveCtaText: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});

export default TripPreview;
