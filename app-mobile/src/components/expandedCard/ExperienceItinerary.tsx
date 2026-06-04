/**
 * ExperienceItinerary — ORCH-1072 [experience-detail-cover-availability].
 *
 * Renders a brand experience's multi-stop itinerary (route) beneath the cover +
 * description in the detail sheet. Read-only; pure presentation of the stops the
 * card already carries (no fetch, no money). Hidden when the experience has no
 * stops (an event/trip never passes any → nothing renders).
 *
 * Dark-mode vocabulary matches the consumer sheet (#0c0e12 canvas).
 */

import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

export interface ItineraryStop {
  stopNumber: number;
  placeName: string | null;
  address: string | null;
  imageUrl: string | null;
  aiDescription: string | null;
}

export interface ExperienceItineraryProps {
  stops: ReadonlyArray<ItineraryStop>;
}

export const ExperienceItinerary: React.FC<ExperienceItineraryProps> = ({
  stops,
}) => {
  if (!stops || stops.length === 0) return null;
  return (
    <View style={styles.wrap} accessibilityLabel="Experience itinerary">
      <Text style={styles.sectionLabel}>THE ITINERARY</Text>
      {stops.map((stop, idx) => (
        <View key={`${stop.stopNumber}_${idx}`} style={styles.stopRow}>
          <View style={styles.numberCol}>
            <View style={styles.numberDisc}>
              <Text style={styles.numberText}>{idx + 1}</Text>
            </View>
            {idx < stops.length - 1 ? <View style={styles.connector} /> : null}
          </View>
          <View style={styles.stopBody}>
            {stop.imageUrl ? (
              <Image
                source={{ uri: stop.imageUrl }}
                style={styles.stopImage}
                resizeMode="cover"
              />
            ) : null}
            <Text style={styles.stopName} numberOfLines={2}>
              {stop.placeName ?? `Stop ${idx + 1}`}
            </Text>
            {stop.address ? (
              <Text style={styles.stopAddress} numberOfLines={2}>
                {stop.address}
              </Text>
            ) : null}
            {stop.aiDescription ? (
              <Text style={styles.stopDescription} numberOfLines={4}>
                {stop.aiDescription}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.52)",
    letterSpacing: 1.4,
    marginBottom: 16,
  },
  stopRow: {
    flexDirection: "row",
    gap: 14,
  },
  numberCol: {
    alignItems: "center",
    width: 28,
  },
  numberDisc: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
  },
  numberText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#ffffff",
  },
  connector: {
    flex: 1,
    width: 2,
    marginTop: 4,
    marginBottom: 4,
    backgroundColor: "rgba(255, 255, 255, 0.14)",
  },
  stopBody: {
    flex: 1,
    paddingBottom: 20,
  },
  stopImage: {
    width: "100%",
    height: 150,
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: "#1C1C1E",
  },
  stopName: {
    fontSize: 16,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.96)",
    marginBottom: 4,
  },
  stopAddress: {
    fontSize: 13,
    color: "rgba(255, 255, 255, 0.55)",
    marginBottom: 6,
  },
  stopDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: "rgba(255, 255, 255, 0.72)",
  },
});

export default ExperienceItinerary;
