/**
 * TripDetailHeroStatusPill — ORCH-0913 lifecycle-aware trip hero pill.
 *
 * Trips keep cancellation distinct from past because operators need to
 * identify cancelled itineraries at a glance.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  radius as radiusTokens,
  text as textTokens,
} from "../../constants/designSystem";
import { Pill } from "../ui/Pill";

export type TripLifecycleStatus = "live" | "upcoming" | "past" | "cancelled";

export interface TripLifecycleInput {
  status: "draft" | "scheduled" | "live" | "ended" | "cancelled";
  startAt: string | null;
  endAt: string | null;
}

export function deriveTripLifecycleStatus(
  input: TripLifecycleInput,
  nowMs: number = Date.now(),
): TripLifecycleStatus {
  if (input.status === "cancelled") return "cancelled";
  if (input.status === "ended") return "past";
  if (input.endAt !== null) {
    const endMs = Date.parse(input.endAt);
    if (Number.isFinite(endMs) && nowMs > endMs) return "past";
  }
  if (input.startAt !== null) {
    const startMs = Date.parse(input.startAt);
    if (Number.isFinite(startMs) && nowMs < startMs) return "upcoming";
    if (Number.isFinite(startMs)) return "live";
  }
  return input.status === "live" ? "live" : "upcoming";
}

interface TripDetailHeroStatusPillProps {
  status: TripLifecycleStatus;
}

export const TripDetailHeroStatusPill: React.FC<
  TripDetailHeroStatusPillProps
> = ({ status }) => {
  if (status === "live") {
    return (
      <Pill variant="live" livePulse>
        Live
      </Pill>
    );
  }
  if (status === "upcoming") {
    return (
      <Pill variant="accent">
        Upcoming
      </Pill>
    );
  }
  if (status === "cancelled") {
    return (
      <Pill variant="error">
        Cancelled
      </Pill>
    );
  }
  return (
    <View style={styles.pastPill}>
      <Text style={styles.pastText}>Past</Text>
    </View>
  );
};

const styles = StyleSheet.create({
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

export default TripDetailHeroStatusPill;
