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
  color,
  space,
  type,
} from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";
import type { ExperienceStopRow } from "../../services/experienceDetailService";
// #3372 — naira stop prices show "₦", not "NGN" (#3341 rule).
import { withCurrencyGlyph } from "@mingla/offering-rendering/currencyGlyph";

export interface ExperienceStopsGalleryTileProps {
  stops: ExperienceStopRow[];
  /** ISO-4217; used to render per-stop prices when pricingMode === per_stop. */
  currency: string;
  /** When true, render each stop's price (per-stop pricing experiences). */
  showStopPrices: boolean;
}

function formatPrice(cents: number, currency: string): string {
  try {
    return withCurrencyGlyph(
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "USD",
      }).format(cents / 100),
      currency,
    );
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export const ExperienceStopsGalleryTile: React.FC<
  ExperienceStopsGalleryTileProps
> = ({ stops, currency, showStopPrices }) => {
  if (stops.length === 0) {
    return (
      <GlassCard variant="base" radius="md" padding={space[4]}>
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
            padding={space[4]}
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
  list: { gap: space[1] },
  headRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space[2],
  },
  name: {
    flex: 1,
    fontSize: type.body.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  metaRow: { flexDirection: "row", gap: space[2] },
  meta: {
    fontSize: type.caption.fontSize,
    fontWeight: "600",
    color: color.text3,
  },
  address: {
    marginTop: 2,
    fontSize: type.caption.fontSize,
    color: color.text2,
  },
  description: {
    marginTop: 4,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text2,
  },
  gallery: {
    marginTop: space[2],
  },
  galleryContent: {
    gap: space[1],
  },
  galleryImage: {
    width: 132,
    height: 96,
    borderRadius: radiusTokens.md,
    backgroundColor: color.fill.tile,
  },
  galleryEmpty: {
    height: 96,
    borderRadius: radiusTokens.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  galleryEmptyText: {
    fontSize: type.caption.fontSize,
    color: color.text3,
  },
  emptyText: {
    fontSize: 13,
    color: color.text3,
    textAlign: "center",
    paddingVertical: space[2],
  },
});

export default ExperienceStopsGalleryTile;
