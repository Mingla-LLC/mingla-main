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
            <View style={styles.iconCircle}>
              <Ionicons name="cloudy" size={20} color="#fed7aa" />
            </View>
            <Text style={styles.title}>Weather Forecast</Text>
          </View>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#ea580c" />
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
            <Ionicons name={weatherIcon as any} size={20} color="#d6691f" />
          </View>
          <View style={styles.headerTextContainer}>
            <Text style={styles.title}>Weather Forecast</Text>
            <Text style={styles.condition}>{conditionText}</Text>
          </View>
          <View style={styles.metric}>
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
    backgroundColor: "#eb78251a",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#eb782566",
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
  metric: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  temperature: {
    fontSize: 16,
    fontWeight: "500",
    color: "#ea580c",
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
