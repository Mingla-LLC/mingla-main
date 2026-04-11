import React from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Icon } from "../ui/Icon";
import { BusynessData } from "../../services/busynessService";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation(['expanded_details', 'common']);

  const getBusynessRange = (popularity: number): string => {
    if (popularity < 30) return "0-30%";
    if (popularity < 50) return "30-50%";
    if (popularity < 70) return "50-70%";
    if (popularity < 85) return "70-85%";
    return "85-100%";
  };

  const getTrafficCondition = (
    condition?: "Light" | "Moderate" | "Heavy"
  ): string => {
    if (!condition) return t('expanded_details:busyness.clear_roads');
    switch (condition) {
      case "Light":
        return t('expanded_details:busyness.clear');
      case "Moderate":
        return t('expanded_details:busyness.moderate');
      case "Heavy":
        return t('expanded_details:busyness.heavy');
      default:
        return t('expanded_details:busyness.clear');
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.row}>
          <View style={styles.iconBadge}>
            <Icon name="car" size={14} color="#ea580c" />
          </View>
          <Text style={styles.label}>{t('expanded_details:busyness.traffic')}</Text>
          <ActivityIndicator size="small" color="#ea580c" />
        </View>
        <View style={styles.row}>
          <View style={styles.iconBadge}>
            <Icon name="stats-chart" size={14} color="#ea580c" />
          </View>
          <Text style={styles.label}>{t('expanded_details:busyness.busy_level')}</Text>
          <ActivityIndicator size="small" color="#ea580c" />
        </View>
      </View>
    );
  }

  if (!busynessData) return null;

  const trafficCondition =
    busynessData.trafficInfo?.trafficCondition || "Light";
  const currentTravelTime =
    busynessData.trafficInfo?.currentTravelTime || travelTime || "N/A";

  return (
    <View style={styles.container}>
      {/* Traffic Row */}
      {(busynessData.trafficInfo || travelTime) && (
        <View style={styles.row}>
          <View style={styles.iconBadge}>
            <Icon name="car" size={14} color="#ea580c" />
          </View>
          <Text style={styles.label}>{t('expanded_details:busyness.traffic')}</Text>
          <View style={styles.conditionBadge}>
            <Text style={styles.conditionText}>
              {getTrafficCondition(trafficCondition)}
            </Text>
          </View>
          <View style={styles.spacer} />
          <Text style={styles.value}>{currentTravelTime}</Text>
        </View>
      )}

      {/* Busy Level Row */}
      <View style={styles.row}>
        <View style={styles.iconBadge}>
          <Icon name="stats-chart" size={14} color="#ea580c" />
        </View>
        <Text style={styles.label}>{t('expanded_details:busyness.busy')}</Text>
        <View style={styles.conditionBadge}>
          <Text style={styles.conditionText}>
            {busynessData.busynessLevel}
          </Text>
        </View>
        <View style={styles.spacer} />
        <View style={styles.miniBarContainer}>
          <View style={styles.miniBarTrack}>
            <View
              style={[
                styles.miniBarFill,
                { width: `${busynessData.currentPopularity}%` },
              ]}
            />
          </View>
          <Text style={styles.occupancy}>
            {getBusynessRange(busynessData.currentPopularity)}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 2,
    gap: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fef7f0",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#eb782533",
    gap: 8,
  },
  iconBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#fff7ed",
    borderWidth: 1,
    borderColor: "#eb782544",
    justifyContent: "center",
    alignItems: "center",
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#78350f",
  },
  conditionBadge: {
    backgroundColor: "#eb78251a",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  conditionText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#c2410c",
  },
  spacer: {
    flex: 1,
  },
  value: {
    fontSize: 14,
    fontWeight: "700",
    color: "#ea580c",
  },
  miniBarContainer: {
    alignItems: "flex-end",
    gap: 3,
  },
  miniBarTrack: {
    width: 48,
    height: 5,
    backgroundColor: "#ebe6e7",
    borderRadius: 3,
    overflow: "hidden",
  },
  miniBarFill: {
    height: "100%",
    backgroundColor: "#eb7825",
    borderRadius: 3,
  },
  occupancy: {
    fontSize: 10,
    fontWeight: "600",
    color: "#c2410c",
  },
});
