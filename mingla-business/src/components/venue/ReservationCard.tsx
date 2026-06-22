/**
 * META-ORCH-1148 sub-ORCH 2.1b — reservation list card.
 *
 * The Design IA §4.4 exemplar: time (lead) · guest · status pill · party ·
 * table · occasion · source/tags row. Reuses the OfferingListCard structural DNA
 * (status pill → title → subline → metric), recolored — NOT a parallel card.
 * Color is never the only signal (pill pairs label + tone). a11y label on the
 * pressable. Android glass via GlassCard (opaque fallback automatic).
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { ChevronRight } from "lucide-react-native";
import { GlassCard } from "../ui/GlassCard";
import { STATUS_PRESENTATION } from "./reservationViews";
import type { Reservation } from "../../types/venueReservation";

const SOURCE_LABEL: Record<Reservation["source"], string> = {
  mingla: "From Mingla",
  phone: "Phone",
  walk_in: "Walk-in",
  website: "Website",
  instagram: "Instagram",
};

const TAG_LABEL: Record<string, string> = {
  vip: "VIP",
  birthday: "Birthday",
  first_time: "First-time",
  regular: "Regular",
  high_risk_no_show: "High no-show risk",
};

const TONE_COLOR: Record<string, string> = {
  neutral: textTokens.secondary,
  success: semantic.success,
  warm: "#eb7825",
  muted: textTokens.tertiary,
  error: semantic.error,
  faded: textTokens.tertiary,
};

function localTimeLabel(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

export interface ReservationCardProps {
  reservation: Reservation;
  tableName: string | null;
  onPress: (r: Reservation) => void;
  testID?: string;
}

export function ReservationCard({
  reservation,
  tableName,
  onPress,
  testID,
}: ReservationCardProps): React.ReactElement {
  const pres = STATUS_PRESENTATION[reservation.status];
  const toneColor = TONE_COLOR[pres.tone] ?? textTokens.secondary;
  const subParts: string[] = [`Party of ${reservation.partySize}`];
  if (tableName != null) subParts.push(`Table ${tableName}`);
  if (reservation.occasion != null) subParts.push(reservation.occasion);

  return (
    <GlassCard variant="base" style={styles.card}>
      <Pressable
        onPress={() => onPress(reservation)}
        accessibilityRole="button"
        accessibilityLabel={`Reservation for ${reservation.guestName ?? "guest"}, ${pres.label}, party of ${reservation.partySize}`}
        style={styles.pressable}
        testID={testID ?? `reservation-card-${reservation.id}`}
      >
        <View style={styles.topRow}>
          <Text style={styles.time}>{localTimeLabel(reservation.reservedFor)}</Text>
          <Text style={styles.guest} numberOfLines={1}>
            {reservation.guestName ?? "Guest"}
          </Text>
          <View style={styles.pill}>
            <View style={[styles.pillDot, { backgroundColor: toneColor }]} />
            <Text style={[styles.pillLabel, { color: toneColor }]}>
              {pres.label}
            </Text>
          </View>
        </View>
        <Text style={styles.subline} numberOfLines={1}>
          {subParts.join(" · ")}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.source}>{SOURCE_LABEL[reservation.source]}</Text>
          {reservation.paymentStatus === "paid" ? (
            <Text style={styles.metaChip}>Deposit paid</Text>
          ) : null}
          {reservation.tags.map((t) => (
            <Text key={t} style={styles.tagChip}>
              {TAG_LABEL[t] ?? t}
            </Text>
          ))}
        </View>
      </Pressable>
      <ChevronRight size={18} color={textTokens.tertiary} />
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  pressable: {
    flex: 1,
    gap: spacing.xxs,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  time: {
    ...typography.bodyLg,
    color: textTokens.primary,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  guest: {
    ...typography.body,
    color: textTokens.primary,
    flex: 1,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  pillDot: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
  },
  pillLabel: {
    ...typography.caption,
    fontWeight: "700",
  },
  subline: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.xxs,
  },
  source: {
    ...typography.caption,
    color: textTokens.tertiary,
    fontWeight: "600",
  },
  metaChip: {
    ...typography.caption,
    color: semantic.success,
    fontWeight: "600",
  },
  tagChip: {
    ...typography.caption,
    color: textTokens.secondary,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: radius.sm,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
});

export default ReservationCard;
