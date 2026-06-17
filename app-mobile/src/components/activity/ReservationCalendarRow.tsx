/**
 * ReservationCalendarRow — META-ORCH-1148 sub-ORCH 2.2b.
 * ---------------------------------------------------------------------------
 * Renders one of the signed-in user's venue reservations inside the consumer
 * Calendar tab, alongside calendar entries + business orders (the third
 * UnifiedRow kind). Shows venue · day/time · party · free/deposit, and a Cancel
 * action (honored server-side against cancel_cutoff_hours). Cancellable rows
 * are upcoming + not already cancelled/completed.
 *
 * Mirrors BusinessEventCalendarRow's prop/animation shape so it participates in
 * the same staggered Active/Archive entrance.
 */

import React from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "../ui/Icon";
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

const ReservationCalendarRow: React.FC<ReservationCalendarRowProps> = ({
  reservation,
  animation,
  onCancel,
}) => {
  const startMs = Date.parse(reservation.reserved_for);
  const isUpcoming = Number.isFinite(startMs) && startMs > Date.now();
  const isCancellable =
    isUpcoming &&
    (reservation.status === "confirmed" ||
      reservation.status === "requested");

  const feeText = formatFee(reservation.fee_cents, reservation.fee_currency);
  const statusText =
    STATUS_LABEL[reservation.status] ?? reservation.status;

  const content = (
    <View style={styles.card}>
      <View style={styles.iconBadge}>
        <Icon name="restaurant-outline" size={20} color="#ea580c" />
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
            {feeText}
          </Text>
        </View>
      </View>
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
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      ) : null}
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
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff1e7",
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
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  cancelBtnPressed: {
    backgroundColor: "#fef2f2",
  },
  cancelText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#dc2626",
  },
});

export default ReservationCalendarRow;
