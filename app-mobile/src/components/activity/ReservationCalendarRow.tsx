/**
 * ReservationCalendarRow — META-ORCH-1148 sub-ORCH 2.2b + 2.2d.
 * ---------------------------------------------------------------------------
 * Renders one of the signed-in user's venue reservations inside the consumer
 * Calendar tab, alongside calendar entries + business orders.
 *
 * 2.2d [locked-in confirmation card]: the reservation now presents like the
 * scheduled-experience cards already in the Calendar tab — a tappable card
 * (venue cover thumbnail · venue · day/time · party · status/fee chips). When
 * EXPANDED it reveals a prominent "Confirmed — you're locked in" banner plus
 * the full confirmation: when, party, deposit/payment, occasion, confirmation
 * reference, and a Cancel action (honored server-side against
 * cancel_cutoff_hours). Cancellable = upcoming + confirmed/requested.
 *
 * Mirrors BusinessEventCalendarRow's prop/animation shape so it participates in
 * the same staggered Active/Archive entrance.
 */

import React, { useState } from "react";
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
  onCancel: (reservation: MyReservationRow) => void;
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

function formatReservedForLong(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Date to be confirmed";
  return d.toLocaleString(undefined, {
    weekday: "long",
    month: "long",
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

// Deposit/payment line for the expanded confirmation.
function formatDeposit(reservation: MyReservationRow): string {
  const fee = formatFee(reservation.fee_cents, reservation.fee_currency);
  if (fee === "Free") return "No deposit — free reservation";
  if (reservation.payment_status === "paid") return `${fee} deposit · Paid`;
  if (reservation.payment_status === "refunded") return `${fee} deposit · Refunded`;
  return `${fee} deposit`;
}

// Short, human confirmation reference from the reservation id.
function confirmationRef(id: string): string {
  return `RES-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
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

// The expanded banner copy/treatment per status.
function bannerFor(status: string): {
  label: string;
  icon: string;
  tone: "confirmed" | "pending" | "ended" | "cancelled";
} {
  switch (status) {
    case "confirmed":
      return { label: "Confirmed — you're locked in", icon: "checkmark-circle", tone: "confirmed" };
    case "seated":
      return { label: "Seated — enjoy your visit", icon: "checkmark-circle", tone: "confirmed" };
    case "requested":
      return { label: "Requested — awaiting the venue", icon: "time", tone: "pending" };
    case "waitlisted":
      return { label: "On the waitlist", icon: "time", tone: "pending" };
    case "completed":
      return { label: "Completed", icon: "checkmark-done-circle", tone: "ended" };
    case "no_show":
      return { label: "Marked no-show", icon: "close-circle", tone: "cancelled" };
    case "cancelled_by_guest":
    case "cancelled_by_venue":
      return { label: "Reservation cancelled", icon: "close-circle", tone: "cancelled" };
    default:
      return { label: STATUS_LABEL[status] ?? status, icon: "information-circle", tone: "pending" };
  }
}

function hueColor(hue: string | null): string {
  const n = Number(hue);
  if (!Number.isFinite(n)) return "#ea580c";
  return `hsl(${((n % 360) + 360) % 360}, 55%, 42%)`;
}

const ReservationCalendarRow: React.FC<ReservationCalendarRowProps> = ({
  reservation,
  animation,
  onCancel,
}) => {
  const [expanded, setExpanded] = useState(false);

  const startMs = Date.parse(reservation.reserved_for);
  const isUpcoming = Number.isFinite(startMs) && startMs > Date.now();
  const isCancellable =
    isUpcoming &&
    (reservation.status === "confirmed" ||
      reservation.status === "requested");

  const feeText = formatFee(reservation.fee_cents, reservation.fee_currency);
  const statusText = STATUS_LABEL[reservation.status] ?? reservation.status;
  const banner = bannerFor(reservation.status);

  // Cover thumbnail: a real image cover / profile photo when available,
  // otherwise a hue-tinted placeholder (e.g. when the brand cover is a video,
  // which we don't play in a list thumbnail — fall back to the brand hue).
  const imageUri =
    reservation.brand_cover_type === "image" && reservation.brand_cover_url
      ? reservation.brand_cover_url
      : reservation.brand_photo_url ?? null;

  const bannerIconColor =
    banner.tone === "cancelled"
      ? "#b91c1c"
      : banner.tone === "pending"
      ? "#b45309"
      : "#047857";

  const bannerToneStyle =
    banner.tone === "confirmed"
      ? styles.banner_confirmed
      : banner.tone === "pending"
      ? styles.banner_pending
      : banner.tone === "ended"
      ? styles.banner_ended
      : styles.banner_cancelled;

  const content = (
    <View style={styles.card}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? "Collapse" : "Expand"} reservation at ${reservation.brand_name ?? "venue"}`}
        style={styles.header}
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

        <Icon
          name={expanded ? "chevron-up" : "chevron-down"}
          size={20}
          color="#9ca3af"
        />
      </Pressable>

      {expanded && (
        <View style={styles.expanded}>
          {/* Confirmed banner — the "locked in" confirmation. */}
          <View style={[styles.banner, bannerToneStyle]}>
            <Icon name={banner.icon} size={18} color={bannerIconColor} />
            <Text
              style={[
                styles.bannerText,
                banner.tone === "cancelled"
                  ? styles.bannerTextCancelled
                  : banner.tone === "pending"
                  ? styles.bannerTextPending
                  : styles.bannerTextConfirmed,
              ]}
            >
              {banner.label}
            </Text>
          </View>

          <DetailRow icon="calendar-outline" label="When" value={formatReservedForLong(reservation.reserved_for)} />
          <DetailRow icon="people-outline" label="Party" value={`${reservation.party_size} ${reservation.party_size === 1 ? "guest" : "guests"}`} />
          <DetailRow icon="card-outline" label="Deposit" value={formatDeposit(reservation)} />
          {reservation.occasion ? (
            <DetailRow icon="sparkles-outline" label="Occasion" value={reservation.occasion} />
          ) : null}
          {reservation.guest_notes ? (
            <DetailRow icon="chatbubble-ellipses-outline" label="Notes" value={reservation.guest_notes} />
          ) : null}
          <DetailRow icon="pricetag-outline" label="Confirmation" value={confirmationRef(reservation.id)} />
          <DetailRow icon="storefront-outline" label="Venue" value={reservation.brand_name ?? "Venue"} />

          {isCancellable ? (
            <Pressable
              onPress={() => onCancel(reservation)}
              accessibilityRole="button"
              accessibilityLabel={`Cancel reservation at ${reservation.brand_name ?? "venue"}`}
              hitSlop={8}
              style={({ pressed }) => [
                styles.cancelBtn,
                pressed && styles.cancelBtnPressed,
              ]}
            >
              <Text style={styles.cancelText}>Cancel reservation</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
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

const DetailRow: React.FC<{ icon: string; label: string; value: string }> = ({
  icon,
  label,
  value,
}) => (
  <View style={styles.detailRow}>
    <Icon name={icon} size={16} color="#9ca3af" />
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue} numberOfLines={2}>
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    marginHorizontal: 16,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
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
  expanded: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 2,
    gap: 10,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  banner_confirmed: { backgroundColor: "#ecfdf5", borderWidth: 1, borderColor: "#a7f3d0" },
  banner_pending: { backgroundColor: "#fffbeb", borderWidth: 1, borderColor: "#fde68a" },
  banner_ended: { backgroundColor: "#f3f4f6", borderWidth: 1, borderColor: "#e5e7eb" },
  banner_cancelled: { backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca" },
  bannerText: {
    fontSize: 13.5,
    fontWeight: "700",
    flex: 1,
  },
  bannerTextConfirmed: { color: "#047857" },
  bannerTextPending: { color: "#b45309" },
  bannerTextCancelled: { color: "#b91c1c" },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  detailLabel: {
    fontSize: 12.5,
    fontWeight: "600",
    color: "#9ca3af",
    width: 92,
  },
  detailValue: {
    fontSize: 13.5,
    color: "#111827",
    fontWeight: "500",
    flex: 1,
  },
  cancelBtn: {
    marginTop: 4,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#fecaca",
    alignItems: "center",
  },
  cancelBtnPressed: {
    backgroundColor: "#fef2f2",
  },
  cancelText: {
    fontSize: 13.5,
    fontWeight: "700",
    color: "#dc2626",
  },
});

export default ReservationCalendarRow;
