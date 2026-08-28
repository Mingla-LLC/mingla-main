import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  androidOpaque,
  glass,
  radius,
  reservationCalendarLayout,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { AlertTriangle, ChevronRight } from "lucide-react-native";
import { GlassCard } from "../ui/GlassCard";
import { STATUS_PRESENTATION } from "./reservationViews";
import {
  formatReservationDateTime,
  formatReservationTime,
} from "./reservationCalendarModel";
import type { Reservation } from "../../types/venueReservation";

export interface FocusableReservationEntry {
  focus?: () => void;
}

export type ReservationCardDensity = "agenda" | "calendar" | "month";

const TONE_COLOR: Record<string, string> = {
  neutral: textTokens.secondary,
  success: semantic.success,
  warm: accent.warm,
  muted: textTokens.tertiary,
  error: semantic.error,
  faded: textTokens.tertiary,
};

const TONE_BACKGROUND: Record<string, string> = {
  neutral: glass.tint.profileElevated,
  success:
    Platform.OS === "android" ? androidOpaque.successFill : semantic.successTint,
  warm: Platform.OS === "android" ? androidOpaque.accentFill : accent.tint,
  muted: glass.tint.profileBase,
  error: Platform.OS === "android" ? androidOpaque.errorFill : semantic.errorTint,
  faded: glass.tint.profileBase,
};

export interface ReservationCardProps {
  reservation: Reservation;
  tableDisplay: string | null;
  timeZone: string;
  onPress: (reservation: Reservation) => void;
  density?: ReservationCardDensity;
  testID?: string;
  entryRef?: (node: FocusableReservationEntry | null) => void;
}

export function ReservationCard({
  reservation,
  tableDisplay,
  timeZone,
  onPress,
  density = "agenda",
  testID,
  entryRef,
}: ReservationCardProps): React.ReactElement {
  const [focused, setFocused] = useState(false);
  const presentation = STATUS_PRESENTATION[reservation.status];
  const toneColor = TONE_COLOR[presentation.tone] ?? textTokens.secondary;
  const toneBackground =
    TONE_BACKGROUND[presentation.tone] ?? glass.tint.profileElevated;
  const guest = reservation.guestName?.trim() || "Guest";
  const metadata = [`Party of ${reservation.partySize}`];
  if (tableDisplay !== null) metadata.push(tableDisplay);
  const refundNeedsAttention =
    reservation.refund?.financialState === "needs_attention" ||
    reservation.refund?.financialState === "failed_terminal";
  const dateTimeLabel = formatReservationDateTime(
    reservation.reservedFor,
    timeZone,
  );
  const accessibilityLabel = `${dateTimeLabel}, ${guest}, party of ${reservation.partySize}${
    tableDisplay === null ? "" : `, ${tableDisplay}`
  }, ${presentation.label}${refundNeedsAttention ? ", refund needs attention" : ""}.`;
  const compact = density !== "agenda";

  return (
    <GlassCard
      variant="base"
      radius={density === "agenda" ? "md" : "sm"}
      padding={0}
      style={[
        styles.card,
        density === "agenda" ? styles.agendaCard : styles.calendarCard,
      ]}
    >
      <Pressable
        ref={(node) => entryRef?.(node as unknown as FocusableReservationEntry | null)}
        onPress={() => onPress(reservation)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [
          styles.pressable,
          density === "agenda" ? styles.agendaPressable : styles.calendarPressable,
          density === "month" ? styles.monthPressable : null,
          focused && Platform.OS === "web" ? webFocusOutline : null,
          pressed ? styles.pressed : null,
        ]}
        testID={testID ?? `reservation-card-${reservation.id}`}
      >
        {compact ? (
          <View style={styles.compactContent}>
            <View style={styles.compactLeadRow}>
              <Text style={styles.compactTime}>
                {formatReservationTime(reservation.reservedFor, timeZone)}
              </Text>
              <View style={[styles.pill, { backgroundColor: toneBackground }]}>
                <View style={[styles.pillDot, { backgroundColor: toneColor }]} />
                <Text style={[styles.pillLabel, { color: toneColor }]}>
                  {presentation.label}
                </Text>
              </View>
            </View>
            <Text style={styles.compactGuest} numberOfLines={2}>
              {guest}
            </Text>
            <Text style={styles.compactMetadata}>{metadata.join(" · ")}</Text>
          </View>
        ) : (
          <>
            <View style={styles.timeColumn}>
              <Text style={styles.time}>
                {formatReservationTime(reservation.reservedFor, timeZone)}
              </Text>
            </View>
            <View style={styles.mainColumn}>
              <Text style={styles.guest} numberOfLines={2}>
                {guest}
              </Text>
              <Text style={styles.metadata}>{metadata.join(" · ")}</Text>
            </View>
            <View style={styles.trailingColumn}>
              <View style={[styles.pill, { backgroundColor: toneBackground }]}>
                <View style={[styles.pillDot, { backgroundColor: toneColor }]} />
                <Text style={[styles.pillLabel, { color: toneColor }]}>
                  {presentation.label}
                </Text>
              </View>
              {refundNeedsAttention ? (
                <AlertTriangle
                  size={14}
                  color={semantic.warning}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                />
              ) : null}
              <ChevronRight
                size={18}
                color={textTokens.tertiary}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
            </View>
          </>
        )}
      </Pressable>
    </GlassCard>
  );
}

const webFocusOutline = {
  outlineColor: accent.warm,
  outlineOffset: 2,
  outlineStyle: "solid",
  outlineWidth: 2,
} as const;

const styles = StyleSheet.create({
  card: {
    width: "100%",
    alignSelf: "stretch",
    overflow: "hidden",
  },
  agendaCard: {
    minHeight: reservationCalendarLayout.agendaRowMinHeight,
  },
  calendarCard: {
    minHeight: reservationCalendarLayout.entryMinTarget,
  },
  pressable: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
  },
  agendaPressable: {
    minHeight: reservationCalendarLayout.agendaRowMinHeight,
    paddingHorizontal: 12,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  calendarPressable: {
    minHeight: reservationCalendarLayout.entryMinTarget,
    padding: spacing.sm,
  },
  monthPressable: {
    padding: spacing.xs,
  },
  pressed: {
    opacity: 0.72,
  },
  timeColumn: {
    width: 64,
    alignSelf: "flex-start",
  },
  time: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  mainColumn: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  guest: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "600",
  },
  metadata: {
    ...typography.bodySm,
    color: textTokens.secondary,
    flexShrink: 1,
  },
  trailingColumn: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.xs,
    maxWidth: "42%",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
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
  compactContent: {
    flex: 1,
    gap: spacing.xxs,
  },
  compactLeadRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xs,
  },
  compactTime: {
    ...typography.caption,
    color: textTokens.primary,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  compactGuest: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "600",
  },
  compactMetadata: {
    ...typography.micro,
    color: textTokens.secondary,
  },
});

export default ReservationCard;
