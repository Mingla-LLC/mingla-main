import React from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BusynessData } from "../../services/busynessService";

interface BusynessSectionProps {
  busynessData: BusynessData | null;
  loading: boolean;
  travelTime?: string;
}

export default function BusynessSection({
  busynessData,
  loading,
  travelTime,
}: BusynessSectionProps) {
  // Get busyness level percentage range
  const getBusynessRange = (popularity: number): string => {
    if (popularity < 30) return "0-30%";
    if (popularity < 50) return "30-50%";
    if (popularity < 70) return "50-70%";
    if (popularity < 85) return "70-85%";
    return "85-100%";
  };

  // Get traffic condition text
  const getTrafficCondition = (
    condition?: "Light" | "Moderate" | "Heavy"
  ): string => {
    if (!condition) return "Clear Roads";
    switch (condition) {
      case "Light":
        return "Clear Roads";
      case "Moderate":
        return "Moderate Traffic";
      case "Heavy":
        return "Heavy Traffic";
      default:
        return "Clear Roads";
    }
  };

  // Get delay text
  const getDelayText = (condition?: "Light" | "Moderate" | "Heavy"): string => {
    if (!condition || condition === "Light") return "No delays";
    if (condition === "Moderate") return "Minor delays";
    return "Expect delays";
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <Ionicons name="car" size={20} color="#fed7aa" />
            </View>
            <Text style={styles.title}>Traffic Conditions</Text>
          </View>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#ea580c" />
            <Text style={styles.loadingText}>Loading traffic data...</Text>
          </View>
        </View>
      </View>
    );
  }

  if (!busynessData) {
    return null;
  }

  const trafficCondition =
    busynessData.trafficInfo?.trafficCondition || "Light";
  const currentTravelTime =
    busynessData.trafficInfo?.currentTravelTime || travelTime || "N/A";
  const busynessRange = getBusynessRange(busynessData.currentPopularity);

  return (
    <View style={styles.container}>
      {/* Traffic Conditions Card */}
      {(busynessData.trafficInfo || travelTime) && (
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <Ionicons name="car" size={20} color="#d6691f" />
            </View>
            <View style={styles.headerTextContainer}>
              <Text style={styles.title}>Traffic Conditions</Text>
              <Text style={styles.condition}>
                {busynessData.trafficInfo
                  ? getTrafficCondition(trafficCondition)
                  : "Clear Roads"}
              </Text>
            </View>
            <View style={styles.metrics}>
              <Text style={styles.time}>{currentTravelTime}</Text>
              {busynessData.trafficInfo && (
                <Text style={styles.delay}>
                  {getDelayText(trafficCondition)}
                </Text>
              )}
            </View>
          </View>

          <View style={styles.recommendationBox}>
            <Text style={styles.recommendationText}>
              Recommendation:{" "}
              {busynessData.trafficInfo
                ? trafficCondition === "Light"
                  ? "Excellent driving conditions - smooth journey ahead!"
                  : trafficCondition === "Moderate"
                  ? "Moderate traffic expected - plan for slight delays."
                  : "Heavy traffic conditions - consider alternative routes or timing."
                : "Good conditions for travel."}
            </Text>
          </View>
        </View>
      )}

      {/* Busy Level Card */}
      <View style={[styles.card, styles.busyCard]}>
        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <Ionicons name="stats-chart" size={20} color="#d6691f" />
          </View>
          <View style={styles.headerTextContainer}>
            <Text style={styles.title}>Busy Level</Text>
            <Text style={styles.busyLevel}>{busynessData.busynessLevel}</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.occupancy}>{busynessRange} occupancy</Text>
          </View>
        </View>

        {/* Progress Bar */}
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBarTrack}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${busynessData.currentPopularity}%` },
              ]}
            />
          </View>
        </View>

        <View style={styles.recommendationBox}>
          <Text style={styles.recommendationText}>
            Recommendation: {busynessData.message}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  card: {
    backgroundColor: "#eb78251a",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#eb782566",
  },
  busyCard: {
    marginTop: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
    gap: 8,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#ffffff",
    justifyContent: "center",
    alignItems: "center",
  },
  headerTextContainer: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: "#d6691f",
    marginBottom: 4,
  },
  condition: {
    fontSize: 16,
    fontWeight: "500",
    color: "#4a5565",
  },
  busyLevel: {
    fontSize: 16,
    fontWeight: "500",
    color: "#4a5565",
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 20,
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    color: "#ea580c",
  },
  metrics: {
    alignItems: "flex-end",
  },
  metric: {
    alignItems: "flex-end",
  },
  time: {
    fontSize: 16,
    fontWeight: "500",
    color: "#ea580c",
    marginBottom: 4,
  },
  delay: {
    fontSize: 14,
    color: "#ea580c",
  },
  occupancy: {
    fontSize: 14,
    fontWeight: "500",
    color: "#ea580c",
  },
  progressBarContainer: {
    marginBottom: 12,
  },
  progressBarTrack: {
    height: 8,
    backgroundColor: "#ebe6e7",
    borderRadius: 4,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: "#eb7825",
    borderRadius: 4,
  },
  recommendationBox: {
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#0a0a0a33",
  },
  recommendationText: {
    fontSize: 14,
    color: "#ea580c",
    lineHeight: 20,
  },
});
