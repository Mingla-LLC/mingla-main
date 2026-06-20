/**
 * TripCard — single-column Discover > Trips feed card (ORCH-1016).
 *
 * DESIGN Item 2: full-bleed cover (shared EventCoverMedia) + bottom glass
 * info-stack, one-per-row, aspect 1.45:1. Same card family as BusinessEventCard
 * but taller/single-column because a trip is a considered decision.
 *
 * Conditional render rules (🔒 SPEC §E.2, NEVER fabricate): departure / verified
 * badge / destination / price / spots all hide when their data is null.
 *
 * Android opaque-glass: the bottom chip uses the opaque fallback fill; the card
 * has overflow:'hidden' and NO Android shadow under the rounded fill
 * (ANDROID_GLASS_USES_OPAQUE_FALLBACK).
 */

import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { EventCoverMedia, formatTripDateRange } from "@mingla/offering-rendering";

import { Icon } from "../ui/Icon";
import {
  glass,
  ANDROID_GLASS_USES_OPAQUE_FALLBACK,
} from "../../constants/designSystem";
import { hueFromId } from "../../utils/hueFromId";
import type { DiscoverTripRow } from "../../services/tripsDiscoveryService";

const g = glass.discover;
const CARD_RADIUS = g.card.radius; // 24
const CARD_ASPECT = 1.45; // width : height (DESIGN Item 2.2)
const SCARCITY_THRESHOLD = 8; // "{n} left" only when spots_left <= this
const CLOSING_SOON_MS = 72 * 60 * 60 * 1000; // "Closing soon" within 72h

const WARNING_AMBER = "#FF9500";

interface TripCardProps {
  trip: DiscoverTripRow;
  onPress: (trip: DiscoverTripRow) => void;
}

function formatPrice(minPriceCents: number | null, currency: string | null): string | null {
  if (minPriceCents === null) return null;
  const code = currency ?? "USD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    }).format(minPriceCents / 100);
  } catch {
    return `${(minPriceCents / 100).toFixed(0)} ${code}`;
  }
}

const TripCardImpl: React.FC<TripCardProps> = ({ trip, onPress }) => {
  const handlePress = React.useCallback((): void => {
    Haptics.selectionAsync().catch(() => {});
    onPress(trip);
  }, [trip, onPress]);

  // RNGH Tap tolerant of small finger drift (mirrors BusinessEventCard Bug 3a).
  const tapGesture = React.useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(16)
        .maxDuration(500)
        .runOnJS(true)
        .onEnd(() => {
          handlePress();
        }),
    [handlePress],
  );

  const hue = hueFromId(trip.tripId);
  const dateLabel =
    trip.startAt !== null && trip.endAt !== null
      ? formatTripDateRange(trip.startAt, trip.endAt, { fallback: "" })
      : "";
  const priceLabel = formatPrice(trip.minPriceCents, trip.currency);
  const showFree = priceLabel === null && trip.hasFreeTier;
  const showScarcity =
    trip.spotsLeft !== null && trip.spotsLeft <= SCARCITY_THRESHOLD && trip.spotsLeft >= 0;

  // "Closing soon" when a deadline is within 72h and still future.
  const closingSoon = (() => {
    if (trip.bookingDeadline === null) return false;
    const ms = new Date(trip.bookingDeadline).getTime() - Date.now();
    return ms > 0 && ms <= CLOSING_SOON_MS;
  })();

  return (
    <GestureDetector gesture={tapGesture}>
      <View
        accessibilityRole="button"
        accessibilityLabel={`${trip.title}${
          trip.destinationText !== null ? `, to ${trip.destinationText}` : ""
        }`}
        style={styles.card}
      >
        {/* Cover — pointerEvents none so the card tap fires over video covers. */}
        <View style={styles.coverFill} pointerEvents="none">
          <EventCoverMedia
            hue={hue}
            mediaUrl={trip.coverMediaUrl}
            mediaType={trip.coverMediaType}
            radius={CARD_RADIUS}
            videoContentFit="cover"
            label={trip.title}
            style={StyleSheet.absoluteFill}
          />
          {/* Photo-legibility gradient (allowed — not decoration). */}
          <LinearGradient
            colors={[g.card.gradient.from, g.card.gradient.to]}
            locations={[g.card.gradient.startY, g.card.gradient.endY]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </View>

        {/* Top-left "Closing soon" badge (only state possible — feed excludes past). */}
        {closingSoon ? (
          <View style={styles.topBadge} pointerEvents="none">
            <Text style={styles.topBadgeText}>Closing soon</Text>
          </View>
        ) : null}

        {/* Bottom glass info-stack */}
        <View style={styles.infoChip} pointerEvents="none">
          <Text style={styles.title} numberOfLines={2}>
            {trip.title}
          </Text>

          {/* When + where line */}
          {dateLabel.length > 0 || trip.destinationText !== null ? (
            <View style={styles.metaRow}>
              {dateLabel.length > 0 ? (
                <>
                  <Icon name="calendar-outline" size={13} color={g.card.bottomChip.metaColor} />
                  <Text style={styles.metaText} numberOfLines={1}>
                    {dateLabel}
                  </Text>
                </>
              ) : null}
              {dateLabel.length > 0 && trip.destinationText !== null ? (
                <Text style={styles.metaSep}> · </Text>
              ) : null}
              {trip.destinationText !== null ? (
                <>
                  <Icon name="navigate-outline" size={13} color={g.card.bottomChip.metaColor} />
                  <Text style={styles.metaText} numberOfLines={1}>
                    to {trip.destinationText}
                  </Text>
                </>
              ) : null}
            </View>
          ) : null}

          {/* "Leaving from {city}" — own line, conditional, NEVER empty. */}
          {trip.departureText !== null ? (
            <View style={styles.metaRow}>
              <Icon name="paper-plane-outline" size={12} color={g.card.bottomChip.metaColor} />
              <Text style={styles.metaText} numberOfLines={1}>
                Leaving from {trip.departureText}
              </Text>
            </View>
          ) : null}

          {/* Planner + price row */}
          <View style={styles.plannerPriceRow}>
            <View style={styles.plannerCluster}>
              <Text style={styles.plannerName} numberOfLines={1}>
                {trip.brandName}
              </Text>
              {trip.brandVerified ? (
                <Icon
                  name="shield-checkmark"
                  size={12}
                  color="#FF6B35"
                  accessibilityLabel="Verified planner"
                />
              ) : null}
            </View>
            {priceLabel !== null || showFree ? (
              <View style={styles.priceCluster}>
                <Text style={styles.priceText}>
                  {showFree ? "Free" : `From ${priceLabel}`}
                </Text>
                {showScarcity ? (
                  <Text style={styles.scarcityText}> · {trip.spotsLeft} left</Text>
                ) : null}
              </View>
            ) : showScarcity ? (
              <Text style={styles.scarcityText}>{trip.spotsLeft} left</Text>
            ) : null}
          </View>
        </View>
      </View>
    </GestureDetector>
  );
};

export const TripCard = React.memo(TripCardImpl);

const isAndroidOpaque = ANDROID_GLASS_USES_OPAQUE_FALLBACK;

const styles = StyleSheet.create({
  card: {
    width: "100%",
    aspectRatio: CARD_ASPECT,
    borderRadius: CARD_RADIUS,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.04)",
    position: "relative",
    // iOS-only shadow; Android relies on the opaque card fill (no shadow under
    // the rounded fill — ANDROID_GLASS_USES_OPAQUE_FALLBACK).
    ...Platform.select({
      ios: {
        shadowColor: g.card.shadow.color,
        shadowOffset: g.card.shadow.offset,
        shadowOpacity: g.card.shadow.opacity,
        shadowRadius: g.card.shadow.radius,
      },
      android: { elevation: 0 },
      default: {},
    }),
  },
  coverFill: {
    ...StyleSheet.absoluteFillObject,
  },
  topBadge: {
    position: "absolute",
    top: g.card.topBadge.topInset,
    left: g.card.topBadge.leftInset,
    height: g.card.topBadge.height,
    paddingHorizontal: g.card.topBadge.paddingHorizontal,
    borderRadius: g.card.topBadge.radius,
    justifyContent: "center",
    backgroundColor: g.card.topBadge.fallbackSolid,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: g.card.topBadge.border,
  },
  topBadgeText: {
    fontSize: g.card.topBadge.labelFontSize,
    fontWeight: g.card.topBadge.labelFontWeight,
    letterSpacing: g.card.topBadge.labelLetterSpacing,
    color: WARNING_AMBER,
  },
  infoChip: {
    position: "absolute",
    left: g.card.bottomChip.leftInset,
    right: g.card.bottomChip.rightInset,
    bottom: g.card.bottomChip.bottomInset,
    paddingHorizontal: g.card.bottomChip.paddingHorizontal,
    paddingVertical: g.card.bottomChip.paddingVertical,
    borderRadius: g.card.bottomChip.radius,
    overflow: "hidden",
    // Opaque fill on Android; the iOS chip sits over the gradient. Per
    // ANDROID_GLASS_USES_OPAQUE_FALLBACK we use the opaque token everywhere
    // here (no BlurView under text — keeps the bottom stack legible + cheap).
    backgroundColor: isAndroidOpaque
      ? g.card.bottomChip.fallbackSolid
      : g.card.bottomChip.tint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: g.card.bottomChip.border,
    gap: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 20,
    color: "#FFFFFF",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    fontSize: g.card.bottomChip.metaFontSize,
    fontWeight: g.card.bottomChip.metaFontWeight,
    lineHeight: g.card.bottomChip.metaLineHeight,
    color: g.card.bottomChip.metaColor,
    flexShrink: 1,
  },
  metaSep: {
    fontSize: g.card.bottomChip.metaFontSize,
    color: "rgba(255,255,255,0.55)",
  },
  plannerPriceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 2,
  },
  plannerCluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 1,
  },
  plannerName: {
    fontSize: 11,
    fontWeight: "500",
    color: "rgba(255,255,255,0.72)",
    flexShrink: 1,
  },
  priceCluster: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
  },
  priceText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  scarcityText: {
    fontSize: 12,
    fontWeight: "600",
    color: WARNING_AMBER,
  },
});

export default TripCard;
