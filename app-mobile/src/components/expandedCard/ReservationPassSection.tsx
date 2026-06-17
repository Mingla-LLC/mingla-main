/**
 * ReservationPassSection — META-ORCH-1148 sub-ORCH 2.2f.
 * ---------------------------------------------------------------------------
 * The "Confirmed reservation pass" injected at the TOP of the existing
 * ExpandedCardModal when it is opened from a booked reservation. Renders the
 * status banner, a check-in QR code (the digital pass the venue scans), the
 * full confirmation details, and a Cancel action. The rest of the expanded
 * card (weather / directions / gallery) is the modal's own existing design —
 * this is purely the additive reservation overlay.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";

import { Icon } from "../ui/Icon";
import type { ReservationPass } from "../../types/expandedCardTypes";

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

function formatDeposit(pass: ReservationPass): string {
  const fee = formatFee(pass.feeCents, pass.feeCurrency);
  if (fee === "Free") return "No deposit — free reservation";
  if (pass.paymentStatus === "paid") return `${fee} deposit · Paid`;
  if (pass.paymentStatus === "refunded") return `${fee} deposit · Refunded`;
  return `${fee} deposit`;
}

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
      return { label: status, icon: "information-circle", tone: "pending" };
  }
}

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

const ReservationPassSection: React.FC<{ pass: ReservationPass }> = ({ pass }) => {
  const banner = bannerFor(pass.status);
  const isLive = banner.tone === "confirmed" || banner.tone === "pending";

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

  return (
    <View style={styles.wrap}>
      {/* Status banner */}
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

      {/* Check-in QR — the digital reservation pass (scan at the venue). */}
      {isLive && (
        <View style={styles.qrCard}>
          <View style={styles.qrBox}>
            <QRCode
              value={`mingla://reservation/${pass.reservationId}`}
              size={140}
              backgroundColor="#ffffff"
              color="#0c0e12"
            />
          </View>
          <Text style={styles.qrRef}>{pass.confirmationRef}</Text>
          <Text style={styles.qrHint}>Show this at the venue to check in</Text>
        </View>
      )}

      {/* Full confirmation details */}
      <DetailRow icon="calendar-outline" label="When" value={formatReservedForLong(pass.reservedForUtc)} />
      <DetailRow icon="people-outline" label="Party" value={`${pass.partySize} ${pass.partySize === 1 ? "guest" : "guests"}`} />
      <DetailRow icon="card-outline" label="Deposit" value={formatDeposit(pass)} />
      {pass.occasion ? (
        <DetailRow icon="sparkles-outline" label="Occasion" value={pass.occasion} />
      ) : null}
      {pass.guestNotes ? (
        <DetailRow icon="chatbubble-ellipses-outline" label="Notes" value={pass.guestNotes} />
      ) : null}
      <DetailRow icon="pricetag-outline" label="Confirmation" value={pass.confirmationRef} />
      <DetailRow icon="storefront-outline" label="Venue" value={pass.venueName ?? "Venue"} />

      {pass.cancellable && pass.onCancel ? (
        <Pressable
          onPress={pass.onCancel}
          accessibilityRole="button"
          accessibilityLabel={`Cancel reservation at ${pass.venueName ?? "venue"}`}
          hitSlop={8}
          style={({ pressed }) => [styles.cancelBtn, pressed && styles.cancelBtnPressed]}
        >
          <Text style={styles.cancelText}>Cancel reservation</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
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
  bannerText: { fontSize: 14, fontWeight: "700", flex: 1 },
  bannerTextConfirmed: { color: "#047857" },
  bannerTextPending: { color: "#b45309" },
  bannerTextCancelled: { color: "#b91c1c" },
  qrCard: {
    alignItems: "center",
    gap: 6,
    paddingVertical: 16,
    backgroundColor: "#f9fafb",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#eef2f7",
  },
  qrBox: { padding: 12, backgroundColor: "#ffffff", borderRadius: 12 },
  qrRef: { fontSize: 14, fontWeight: "800", color: "#111827", letterSpacing: 1, marginTop: 4 },
  qrHint: { fontSize: 12, color: "#6b7280" },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  detailLabel: { fontSize: 12.5, fontWeight: "600", color: "#9ca3af", width: 92 },
  detailValue: { fontSize: 13.5, color: "#111827", fontWeight: "500", flex: 1 },
  cancelBtn: {
    marginTop: 4,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#fecaca",
    alignItems: "center",
  },
  cancelBtnPressed: { backgroundColor: "#fef2f2" },
  cancelText: { fontSize: 13.5, fontWeight: "700", color: "#dc2626" },
});

export default ReservationPassSection;
