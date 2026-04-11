import React from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Icon } from "../ui/Icon";
import { WeatherData } from "../../services/weatherService";
import { formatTemperature } from "../utils/formatters";
import { useTranslation } from "react-i18next";

interface WeatherSectionProps {
  weatherData: WeatherData | null;
  loading: boolean;
  category?: string;
  selectedDateTime?: Date;
  measurementSystem?: 'Metric' | 'Imperial';
}

export default function WeatherSection({
  weatherData,
  loading,
  measurementSystem = 'Imperial',
}: WeatherSectionProps) {
  const { t } = useTranslation(['expanded_details', 'common']);

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

  const getConditionText = (description: string): string => {
    const desc = description.toLowerCase();
    if (desc.includes("clear") || desc.includes("sunny")) return t('expanded_details:weather.clear');
    if (desc.includes("cloud")) return t('expanded_details:weather.cloudy');
    if (desc.includes("rain")) return t('expanded_details:weather.rainy');
    if (desc.includes("snow")) return t('expanded_details:weather.snowy');
    if (desc.includes("storm")) return t('expanded_details:weather.stormy');
    return t('expanded_details:weather.cloudy');
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.row}>
          <View style={styles.iconBadge}>
            <Icon name="cloudy" size={14} color="#ea580c" />
          </View>
          <Text style={styles.label}>{t('expanded_details:weather.weather')}</Text>
          <ActivityIndicator size="small" color="#ea580c" />
        </View>
      </View>
    );
  }

  if (!weatherData) return null;

  const weatherIcon = getWeatherIcon(weatherData.icon);
  const conditionText = getConditionText(weatherData.description);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.iconBadge}>
          <Icon name={weatherIcon} size={14} color="#ea580c" />
        </View>
        <Text style={styles.label}>Weather</Text>
        <View style={styles.conditionBadge}>
          <Text style={styles.conditionText}>{conditionText}</Text>
        </View>
        <View style={styles.spacer} />
        <Text style={styles.temp}>
          {formatTemperature(weatherData.temperature, measurementSystem)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 6,
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
  temp: {
    fontSize: 15,
    fontWeight: "700",
    color: "#ea580c",
  },
});
