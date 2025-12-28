import React from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WeatherData } from "../../services/weatherService";

interface WeatherSectionProps {
  weatherData: WeatherData | null;
  loading: boolean;
  category?: string;
  selectedDateTime?: Date;
}

export default function WeatherSection({
  weatherData,
  loading,
  category,
  selectedDateTime,
}: WeatherSectionProps) {
  // Get weather icon name from OpenWeatherMap icon code
  const getWeatherIcon = (iconCode: string): string => {
    const iconMap: { [key: string]: string } = {
      "01d": "sunny",
      "01n": "moon",
      "02d": "partly-sunny",
      "02n": "cloudy-night",
      "03d": "cloudy",
      "03n": "cloudy",
      "04d": "cloudy",
      "04n": "cloudy",
      "09d": "rainy",
      "09n": "rainy",
      "10d": "rainy",
      "10n": "rainy",
      "11d": "thunderstorm",
      "11n": "thunderstorm",
      "13d": "snow",
      "13n": "snow",
      "50d": "cloudy",
      "50n": "cloudy",
    };
    return iconMap[iconCode] || "cloudy";
  };

  // Get simplified condition text
  const getConditionText = (description: string): string => {
    const desc = description.toLowerCase();
    if (desc.includes("clear") || desc.includes("sunny")) return "Clear";
    if (desc.includes("cloud")) return "Cloudy";
    if (desc.includes("rain")) return "Rainy";
    if (desc.includes("snow")) return "Snowy";
    if (desc.includes("storm")) return "Stormy";
    return "Cloudy";
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Ionicons name="cloudy" size={20} color="#9ca3af" />
            <Text style={styles.title}>Weather Forecast</Text>
          </View>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#6b7280" />
            <Text style={styles.loadingText}>Loading weather...</Text>
          </View>
        </View>
      </View>
    );
  }

  if (!weatherData) {
    return null;
  }

  const weatherIcon = getWeatherIcon(weatherData.icon);
  const conditionText = getConditionText(weatherData.description);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <Ionicons name={weatherIcon as any} size={20} color="#9ca3af" />
          </View>
          <View style={styles.headerTextContainer}>
            <Text style={styles.title}>Weather Forecast</Text>
            <Text style={styles.condition}>{conditionText}</Text>
          </View>
          <View style={styles.metric}>
            <Ionicons name="thermometer" size={16} color="#374151" />
            <Text style={styles.temperature}>
              {Math.round(weatherData.temperature)}°F
            </Text>
          </View>
        </View>

        {/* Recommendation Box */}
        <View style={styles.recommendationBox}>
          <Text style={styles.recommendationText}>
            Recommendation: {weatherData.recommendation}
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
  },
  card: {
    backgroundColor: "#fbf9fa",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#d1d5dc",
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
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  headerTextContainer: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 4,
  },
  condition: {
    fontSize: 16,
    fontWeight: "500",
    color: "#374151",
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
    color: "#6b7280",
  },
  metric: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "white",
    borderRadius: 16,
    padding: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  temperature: {
    fontSize: 16,
    fontWeight: "500",
    color: "#374151",
  },
  recommendationBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d1d5dc",
    padding: 12,
  },
  recommendationText: {
    fontSize: 14,
    color: "#374151",
    lineHeight: 20,
  },
});
