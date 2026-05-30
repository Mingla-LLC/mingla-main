/**
 * ORCH-0965 [Home dashboard intelligent KPIs + tri-kind upcoming]
 *
 * HomeTripRow — visual mirror of the home Upcoming event row for trip
 * items. Reuses `EventCoverMedia` + `Pill` + `glass.tint.profileBase`
 * background so trips visually integrate with events/experiences in
 * the same list. Trip-typed routing (via `routeForEventRowDefensive`)
 * is wired by the home screen, not here.
 *
 * Established by SPEC §4.5.2.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { Trip } from "../../services/tripsService";
import {
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { Pill } from "../ui/Pill";

interface HomeTripRowProps {
  trip: Trip;
  /** From the upcomingBuilder normalisation: 'live' or 'upcoming'. */
  status: "live" | "upcoming";
  onPress: () => void;
}

function formatTripDateLine(trip: Trip): string {
  const startStr = trip.businessTrip.startAt;
  const endStr = trip.businessTrip.endAt;
  if (startStr === null) return "Dates to be confirmed";
  const start = new Date(startStr);
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
  };
  const startLabel = start.toLocaleDateString("en-GB", opts);
  if (endStr === null) return startLabel;
  const end = new Date(endStr);
  const endLabel = end.toLocaleDateString("en-GB", opts);
  if (startLabel === endLabel) return startLabel;
  return `${startLabel} – ${endLabel}`;
}

export const HomeTripRow: React.FC<HomeTripRowProps> = ({ trip, status, onPress }) => {
  const isLive = status === "live";
  const title = trip.title.trim().length > 0 ? trip.title : "Untitled trip";
  const dateLine = formatTripDateLine(trip);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open trip: ${title}. ${dateLine}.`}
      style={styles.row}
    >
      <View style={styles.coverWrap}>
        <EventCoverMedia
          hue={25}
          mediaUrl={trip.coverMediaUrl}
          mediaType={
            (trip.coverMediaType as "image" | "video" | "gif" | null) ?? null
          }
          radius={12}
          label=""
          height={56}
          width={56}
        />
      </View>
      <View style={styles.textCol}>
        <View style={styles.pillRow}>
          <Pill variant={isLive ? "live" : "accent"} livePulse={isLive}>
            {isLive ? "Live" : "Upcoming"}
          </Pill>
        </View>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.when} numberOfLines={1}>
          Trip · {dateLine}
        </Text>
      </View>
      <View style={styles.soldCol}>
        <Text style={styles.soldValue}>
          {trip.ticketsSoldCount > 0
            ? trip.ticketsSoldCount.toLocaleString("en-GB")
            : "—"}
        </Text>
        <Text style={styles.soldLabel}>sold</Text>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radiusTokens.lg,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  coverWrap: {
    width: 56,
    height: 56,
    flexShrink: 0,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  pillRow: {
    flexDirection: "row",
    marginBottom: 2,
  },
  title: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: 2,
  },
  when: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
  },
  soldCol: {
    alignItems: "flex-end",
    paddingRight: 2,
    minWidth: 74,
  },
  soldValue: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  soldLabel: {
    fontSize: 10,
    color: textTokens.tertiary,
  },
});

export default HomeTripRow;
