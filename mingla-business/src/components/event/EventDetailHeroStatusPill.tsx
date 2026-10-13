/**
 * Event-detail screen status pill — extracted from app/event/[id]/index.tsx
 * (Cycle 17d Stage 2 §F.4).
 *
 * Renders 3 states: live (animated pulse), upcoming (accent), past (muted).
 *
 * issue #3645 — a cancelled event says CANCELLED. It used to fall into the
 * "past" state and read ENDED, which is a different thing: an ended event took
 * place.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  radius as radiusTokens,
  text as textTokens,
} from "../../constants/designSystem";
import { Pill } from "../ui/Pill";

export type EventDetailStatus = "live" | "upcoming" | "past";

interface EventDetailHeroStatusPillProps {
  status: EventDetailStatus;
  /** #3645 — true when the event was cancelled. Wins over `status`. */
  cancelled?: boolean;
}

/** #3645 — the badge text for each state. */
export const eventDetailStatusLabel = (
  status: EventDetailStatus,
  cancelled: boolean,
): "CANCELLED" | "LIVE" | "UPCOMING" | "ENDED" => {
  if (cancelled) return "CANCELLED";
  if (status === "live") return "LIVE";
  if (status === "upcoming") return "UPCOMING";
  return "ENDED";
};

export const EventDetailHeroStatusPill: React.FC<
  EventDetailHeroStatusPillProps
> = ({ status, cancelled = false }) => {
  if (cancelled) {
    return (
      <View style={styles.pastPill} testID="event-detail-status-cancelled">
        <Text style={styles.pastText}>
          {eventDetailStatusLabel(status, true)}
        </Text>
      </View>
    );
  }
  if (status === "live") {
    return (
      <Pill variant="live" livePulse>
        <Text style={styles.text}>LIVE</Text>
      </Pill>
    );
  }
  if (status === "upcoming") {
    return (
      <Pill variant="accent">
        <Text style={styles.text}>UPCOMING</Text>
      </Pill>
    );
  }
  return (
    <View style={styles.pastPill}>
      <Text style={styles.pastText}>ENDED</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  text: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: textTokens.primary,
  },
  pastPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radiusTokens.full,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  pastText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: textTokens.tertiary,
  },
});
