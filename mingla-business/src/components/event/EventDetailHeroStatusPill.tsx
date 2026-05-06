/**
 * Event-detail screen status pill — extracted from app/event/[id]/index.tsx
 * (Cycle 17d Stage 2 §F.4).
 *
 * Renders 3 states: live (animated pulse), upcoming (accent), past (muted).
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
}

export const EventDetailHeroStatusPill: React.FC<
  EventDetailHeroStatusPillProps
> = ({ status }) => {
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
