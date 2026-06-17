/**
 * ReservationCalendarRow — META-ORCH-1148 sub-ORCH 2.2b + 2.2f.
 * ---------------------------------------------------------------------------
 * Renders one of the signed-in user's venue reservations inside the consumer
 * Calendar tab, alongside calendar entries + business orders.
 *
 * 2.2f [open the existing expanded card]: the row is a compact, tappable card
 * (venue cover thumbnail · venue · day/time · party · status/fee chips). Tapping
 * it opens the SAME ExpandedCardModal the app already uses for venues — which
 * carries the weather / directions / gallery — and that modal renders the
 * injected "Confirmed" reservation pass (banner + details + check-in QR). The
 * row no longer expands in place; we don't reinvent the expanded design.
 *
 * Mirrors BusinessEventCalendarRow's prop/animation shape so it participates in
 * the same staggered Active/Archive entrance.
 */

import React from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "../ui/Icon";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import type { MyReservationRow } from "../../hooks/useMyReservations";

interface ReservationCalendarRowProps {
  reservation: MyReservationRow;
  animation?: {
    opacity: Animated.Value;
    slide: Animated.Value;
  };
  onPress: (reservation: MyReservationRow) => void;
}

function formatReservedFor(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Date TBA";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFee(cents: number | null, currency: string | null): string {
  if (!cents || cents <= 0) return "Free";
  const code = (currency || "USD").toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${code}`;
  }
}

const STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  confirmed: "Confirmed",
  seated: "Seated",
  completed: "Completed",
  no_show: "No-show",
  cancelled_by_guest: "Cancelled",
  cancelled_by_venue: "Cancelled by venue",
  waitlisted: "Waitlisted",
};

function hueColor(hue: string | null): string {
  const n = Number(hue);
  if (!Number.isFinite(n)) return "#ea580c";
  return `hsl(${((n % 360) + 360) % 360}, 55%, 42%)`;
}

const ReservationCalendarRow: React.FC<ReservationCalendarRowProps> = ({
  reservation,
  animation,
  onPress,
}) => {
  const feeText = formatFee(reservation.fee_cents, reservation.fee_currency);
  const statusText = STATUS_LABEL[reservation.status] ?? reservation.status;

  // Cover thumbnail: a real image cover / profile photo when available,
  // otherwise a hue-tinted placeholder (e.g. when the brand cover is a video,
  // which we don't play in a list thumbnail — fall back to the brand hue).
  const imageUri =
    reservation.brand_cover_type === "image" && reservation.brand_cover_url
      ? reservation.brand_cover_url
      : reservation.brand_photo_url ?? null;

  const content = (
    <Pressable
      onPress={() => onPress(reservation)}
      accessibilityRole="button"
      accessibilityLabel={`Open reservation at ${reservation.brand_name ?? "venue"}`}
      style={styles.card}
    >
      <View style={styles.thumb}>
        {imageUri ? (
          <ImageWithFallback
            source={{ uri: imageUri }}
            alt={reservation.brand_name ?? "Venue"}
            style={{ width: "100%", height: "100%" }}
          />
        ) : (
          <View
            style={[
              styles.thumbFallback,
              { backgroundColor: hueColor(reservation.brand_cover_hue) },
            ]}
          >
            <Icon name="restaurant-outline" size={22} color="#ffffff" />
          </View>
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {reservation.brand_name ?? "Reservation"}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {formatReservedFor(reservation.reserved_for)} · Party of{" "}
          {reservation.party_size}
        </Text>
        <View style={styles.chipRow}>
          <Text style={styles.statusChip}>{statusText}</Text>
          <Text
            style={[
              styles.feeChip,
              feeText === "Free" ? styles.feeChipFree : styles.feeChipPaid,
            ]}
          >
            {feeText === "Free" ? "Free" : `${feeText} deposit`}
          </Text>
        </View>
      </View>

      <Icon name="chevron-forward" size={20} color="#9ca3af" />
    </Pressable>
  );

  if (animation) {
    return (
      <Animated.View
        style={{
          opacity: animation.opacity,
          transform: [{ translateY: animation.slide }],
        }}
      >
        {content}
      </Animated.View>
    );
  }
  return content;
};

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 14,
    marginHorizontal: 16,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: "#f3f4f6",
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#fff1e7",
  },
  thumbFallback: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
  },
  meta: {
    fontSize: 13,
    color: "#6b7280",
  },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  statusChip: {
    fontSize: 11,
    fontWeight: "600",
    color: "#374151",
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: "hidden",
  },
  feeChip: {
    fontSize: 11,
    fontWeight: "600",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: "hidden",
  },
  feeChipFree: {
    color: "#047857",
    backgroundColor: "#d1fae5",
  },
  feeChipPaid: {
    color: "#b45309",
    backgroundColor: "#fef3c7",
  },
});

export default ReservationCalendarRow;
