/**
 * ExperienceStopsGalleryTile — META-ORCH-1059 [experiences-business-parity] Pass 2.
 *
 * The experience "Types" tile. For events the Types tile is ticket types; for
 * trips it's pricing tiers; for EXPERIENCES it's the STOPS — each spot's full
 * detail (name, address, description, per-stop price) above a HORIZONTALLY
 * scrollable image gallery pulled from `experience_stops.image_urls`.
 *
 * Pure presentation: takes the already-loaded ExperienceStopRow[] from
 * useExperienceDetail. No data fetching here.
 */

import React from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";
import type { ExperienceStopRow } from "../../services/experienceDetailService";

export interface ExperienceStopsGalleryTileProps {
  stops: ExperienceStopRow[];
  /** ISO-4217; used to render per-stop prices when pricingMode === per_stop. */
  currency: string;
  /** When true, render each stop's price (per-stop pricing experiences). */
  showStopPrices: boolean;
}

function formatPrice(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export const ExperienceStopsGalleryTile: React.FC<
  ExperienceStopsGalleryTileProps
> = ({ stops, currency, showStopPrices }) => {
  if (stops.length === 0) {
    return (
      <GlassCard variant="base" radius="md" padding={spacing.md}>
        <Text style={styles.emptyText}>No stops yet.</Text>
      </GlassCard>
    );
  }

  return (
    <View style={styles.list}>
      {stops.map((stop) => {
        const timeLabel =
          stop.startTime !== null && stop.startTime.length >= 5
            ? stop.startTime.slice(0, 5)
            : null;
        const priceLabel =
          showStopPrices && stop.priceCents > 0
            ? formatPrice(stop.priceCents, currency)
            : null;
        return (
          <GlassCard
            key={stop.id}
            variant="base"
            radius="md"
            padding={spacing.md}
          >
            <View style={styles.headRow}>
              <Text style={styles.name} numberOfLines={2}>
                {stop.stopOrder + 1}. {stop.placeName}
              </Text>
              {timeLabel !== null || priceLabel !== null ? (
                <View style={styles.metaRow}>
                  {timeLabel !== null ? (
                    <Text style={styles.meta}>{timeLabel}</Text>
                  ) : null}
                  {priceLabel !== null ? (
                    <Text style={styles.meta}>{priceLabel}</Text>
                  ) : null}
                </View>
              ) : null}
            </View>

            {stop.address.length > 0 ? (
              <Text style={styles.address} numberOfLines={1}>
                {stop.address}
              </Text>
            ) : null}

            {stop.description.length > 0 ? (
              <Text style={styles.description} numberOfLines={3}>
                {stop.description}
              </Text>
            ) : null}

            {stop.imageUrls.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.gallery}
                contentContainerStyle={styles.galleryContent}
                accessibilityLabel={`${stop.placeName} photo gallery`}
              >
                {stop.imageUrls.map((uri, idx) => (
                  <Image
                    key={`${stop.id}-img-${idx}`}
                    source={{ uri }}
                    style={styles.galleryImage}
                    resizeMode="cover"
                    accessibilityLabel={`${stop.placeName} photo ${idx + 1}`}
                  />
                ))}
              </ScrollView>
            ) : (
              <View style={[styles.gallery, styles.galleryEmpty]}>
                <Text style={styles.galleryEmptyText}>No photos</Text>
              </View>
            )}
          </GlassCard>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  list: { gap: spacing.xs },
  headRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  name: {
    flex: 1,
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  metaRow: { flexDirection: "row", gap: spacing.sm },
  meta: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: textTokens.tertiary,
  },
  address: {
    marginTop: 2,
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
  },
  description: {
    marginTop: 4,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
  },
  gallery: {
    marginTop: spacing.sm,
  },
  galleryContent: {
    gap: spacing.xs,
  },
  galleryImage: {
    width: 132,
    height: 96,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  galleryEmpty: {
    height: 96,
    borderRadius: radiusTokens.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  galleryEmptyText: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  emptyText: {
    fontSize: 13,
    color: textTokens.tertiary,
    textAlign: "center",
    paddingVertical: spacing.sm,
  },
});

export default ExperienceStopsGalleryTile;
