/** Full-bleed Discover > Stays property card. Issue #1423. */

import { EventCoverMedia } from "@mingla/offering-rendering";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import type {
  DiscoverStayRow,
  StayPropertyKind,
} from "../../services/staysDiscoveryService";
import {
  ANDROID_GLASS_USES_OPAQUE_FALLBACK,
  glass,
} from "../../constants/designSystem";
import { hueFromId } from "../../utils/hueFromId";
import { Icon } from "../ui/Icon";

const PROPERTY_LABEL: Record<StayPropertyKind, string> = {
  hotel: "Hotel",
  resort: "Resort",
  guest_house: "Guest house",
  lodge: "Lodge",
  serviced_apartment: "Serviced apartment",
  short_stay_apartment: "Short-stay apartment",
  other: "Stay",
};

function formatPrice(amountMinor: string, currencyCode: string): string {
  if (!/^\d+$/.test(amountMinor)) return `${currencyCode} ${amountMinor}`;
  const amount = Number(amountMinor);
  if (!Number.isSafeInteger(amount)) return `${currencyCode} ${amountMinor}`;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 0,
    }).format(amount / 100);
  } catch {
    return `${currencyCode} ${(amount / 100).toFixed(0)}`;
  }
}

function locationLabel(stay: DiscoverStayRow): string | null {
  if (stay.city && stay.countryCode) return `${stay.city}, ${stay.countryCode}`;
  return stay.city ?? stay.address ?? stay.countryCode;
}

interface Props {
  stay: DiscoverStayRow;
  reduceTransparency: boolean;
  onPress: (stay: DiscoverStayRow) => void;
}

const StayCardImpl: React.FC<Props> = ({ stay, reduceTransparency, onPress }) => {
  const propertyLabel = PROPERTY_LABEL[stay.propertyKind];
  const location = locationLabel(stay);
  const price = formatPrice(stay.amountMinor, stay.currencyCode);
  const confirmation = stay.confirmationModes.length === 1
    ? stay.confirmationModes[0] === "instant"
      ? "Instant booking"
      : "Request to book"
    : stay.confirmationModes.length > 1
      ? "Instant or request"
      : null;
  const availability = stay.availabilityState === "available"
    ? "Available for your dates"
    : "Choose dates to check availability";
  const meta = [confirmation, ...stay.amenities.slice(0, 2)].filter(Boolean).join(" · ");
  const opaque = reduceTransparency || ANDROID_GLASS_USES_OPAQUE_FALLBACK;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${stay.venueName}, ${propertyLabel}${location ? `, ${location}` : ""}, from ${price} per night, ${availability}`}
      accessibilityHint="Opens rooms, places, and reservation options"
      onPress={() => {
        if (Platform.OS === "ios") {
          void Haptics.selectionAsync();
        }
        onPress(stay);
      }}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <EventCoverMedia
        hue={hueFromId(stay.venueId)}
        mediaUrl={stay.coverMediaUrl}
        mediaType={stay.coverMediaType}
        radius={24}
        autoplay={false}
        playbackActive={false}
        label={stay.coverAlt ?? stay.venueName}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(7,9,13,0.04)", "rgba(7,9,13,0.90)"]}
        locations={[0.28, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.kindBadge, opaque && styles.opaqueBadge]} pointerEvents="none">
        <Text style={styles.kindText}>{propertyLabel}</Text>
      </View>
      <View style={[styles.info, opaque && styles.opaqueInfo]} pointerEvents="none">
        <Text style={styles.title} numberOfLines={2}>{stay.venueName}</Text>
        {location ? (
          <View style={styles.row}>
            <Icon name="location-outline" size={13} color="rgba(255,255,255,0.72)" />
            <Text style={styles.meta} numberOfLines={1}>{location}</Text>
          </View>
        ) : null}
        <View style={styles.priceRow}>
          <Text style={styles.price} numberOfLines={1}>From {price} / night</Text>
          <Text
            style={[
              styles.availability,
              stay.availabilityState === "available" && styles.available,
            ]}
            numberOfLines={1}
          >
            {stay.availabilityState === "available" ? "Available" : "Check dates"}
          </Text>
        </View>
        {meta.length > 0 ? <Text style={styles.meta} numberOfLines={1}>{meta}</Text> : null}
      </View>
    </Pressable>
  );
};

export const StayCard = React.memo(StayCardImpl);

const styles = StyleSheet.create({
  card: {
    width: "100%",
    aspectRatio: 1.32,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.06)",
    ...Platform.select({
      ios: {
        shadowColor: glass.discover.card.shadow.color,
        shadowOffset: glass.discover.card.shadow.offset,
        shadowOpacity: glass.discover.card.shadow.opacity,
        shadowRadius: glass.discover.card.shadow.radius,
      },
      android: { elevation: 0 },
      default: {},
    }),
  },
  pressed: { opacity: 0.82, transform: [{ scale: 0.992 }] },
  kindBadge: {
    position: "absolute",
    top: 14,
    left: 14,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(9,11,15,0.56)",
  },
  opaqueBadge: { backgroundColor: "#202329" },
  kindText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  info: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 5,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
    backgroundColor: "rgba(13,15,20,0.62)",
  },
  opaqueInfo: { backgroundColor: "#202329" },
  title: { color: "#FFFFFF", fontSize: 20, fontWeight: "800", lineHeight: 24 },
  row: { flexDirection: "row", alignItems: "center", gap: 5 },
  meta: { flexShrink: 1, color: "rgba(255,255,255,0.68)", fontSize: 12, fontWeight: "500" },
  priceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  price: { flex: 1, color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  availability: { color: "rgba(255,255,255,0.62)", fontSize: 11, fontWeight: "700" },
  available: { color: "#74E6A5" },
});
