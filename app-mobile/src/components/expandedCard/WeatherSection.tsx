import React from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WeatherData } from '../../services/weatherService';

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
      '01d': 'sunny',
      '01n': 'moon',
      '02d': 'partly-sunny',
      '02n': 'cloudy-night',
      '03d': 'cloudy',
      '03n': 'cloudy',
      '04d': 'cloudy',
      '04n': 'cloudy',
      '09d': 'rainy',
      '09n': 'rainy',
      '10d': 'rainy',
      '10n': 'rainy',
      '11d': 'thunderstorm',
      '11n': 'thunderstorm',
      '13d': 'snow',
      '13n': 'snow',
      '50d': 'cloudy',
      '50n': 'cloudy',
    };
    return iconMap[iconCode] || 'partly-sunny';
  };

  // Check if activity is outdoor
  const isOutdoorActivity = [
    'Take a Stroll',
    'Picnics',
    'Play & Move',
    'Freestyle',
  ].includes(category || '');

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="partly-sunny" size={20} color="#eb7825" />
          <Text style={styles.title}>Weather Forecast</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color="#eb7825" />
          <Text style={styles.loadingText}>Loading weather...</Text>
        </View>
      </View>
    );
  }

  if (!weatherData) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="partly-sunny" size={20} color="#eb7825" />
          <Text style={styles.title}>Weather Forecast</Text>
        </View>
        <View style={styles.unavailableContainer}>
          <Text style={styles.unavailableText}>
            Weather information unavailable
          </Text>
        </View>
      </View>
    );
  }

  const weatherIcon = getWeatherIcon(weatherData.icon);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name={weatherIcon as any} size={20} color="#eb7825" />
        <Text style={styles.title}>Weather Forecast</Text>
        {selectedDateTime && (
          <Text style={styles.dateText}>
            {selectedDateTime.toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
          </Text>
        )}
      </View>

      {/* Current Weather */}
      <View style={styles.currentWeather}>
        <View style={styles.temperatureContainer}>
          <Ionicons name={weatherIcon as any} size={48} color="#eb7825" />
          <View style={styles.temperatureInfo}>
            <Text style={styles.temperature}>{weatherData.temperature}°F</Text>
            <Text style={styles.condition}>{weatherData.description}</Text>
            <Text style={styles.feelsLike}>
              Feels like {weatherData.feelsLike}°F
            </Text>
          </View>
        </View>

        {/* Weather Details */}
        <View style={styles.detailsGrid}>
          <View style={styles.detailItem}>
            <Ionicons name="water" size={16} color="#6b7280" />
            <Text style={styles.detailText}>{weatherData.humidity}%</Text>
            <Text style={styles.detailLabel}>Humidity</Text>
          </View>
          <View style={styles.detailItem}>
            <Ionicons name="leaf" size={16} color="#6b7280" />
            <Text style={styles.detailText}>{weatherData.windSpeed} mph</Text>
            <Text style={styles.detailLabel}>Wind</Text>
          </View>
          {weatherData.uvIndex !== undefined && (
            <View style={styles.detailItem}>
              <Ionicons name="sunny" size={16} color="#6b7280" />
              <Text style={styles.detailText}>{weatherData.uvIndex}</Text>
              <Text style={styles.detailLabel}>UV Index</Text>
            </View>
          )}
          {weatherData.precipitation !== undefined && (
            <View style={styles.detailItem}>
              <Ionicons name="rainy" size={16} color="#6b7280" />
              <Text style={styles.detailText}>
                {weatherData.precipitation.toFixed(1)}"
              </Text>
              <Text style={styles.detailLabel}>Precip</Text>
            </View>
          )}
        </View>
      </View>

      {/* Activity Recommendation */}
      <View
        style={[
          styles.recommendationBox,
          isOutdoorActivity &&
          weatherData.precipitation &&
          weatherData.precipitation > 0.1
            ? styles.recommendationCaution
            : styles.recommendationHighlight,
        ]}
      >
        <Ionicons
          name={
            isOutdoorActivity && weatherData.precipitation && weatherData.precipitation > 0.1
              ? 'warning'
              : 'checkmark-circle'
          }
          size={20}
          color={
            isOutdoorActivity && weatherData.precipitation && weatherData.precipitation > 0.1
              ? '#c24b0b'
              : '#eb7825'
          }
        />
        <Text
          style={[
            styles.recommendationText,
            isOutdoorActivity && weatherData.precipitation && weatherData.precipitation > 0.1
              ? styles.recommendationTextCaution
              : styles.recommendationTextHighlight,
          ]}
        >
          {weatherData.recommendation}
        </Text>
      </View>

      {/* Hourly Forecast */}
      {weatherData.hourlyForecast && weatherData.hourlyForecast.length > 0 && (
        <View style={styles.hourlyContainer}>
          <Text style={styles.hourlyTitle}>Hourly Forecast</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.hourlyScroll}
          >
            {weatherData.hourlyForecast.map((hour, index) => (
              <View key={index} style={styles.hourlyItem}>
                <Text style={styles.hourlyTime}>{hour.time}</Text>
                <Ionicons
                  name={getWeatherIcon(hour.icon) as any}
                  size={24}
                  color="#6b7280"
                />
                <Text style={styles.hourlyTemp}>{hour.temperature}°</Text>
                {hour.precipitation > 0 && (
                  <Text style={styles.hourlyPrecip}>
                    {hour.precipitation.toFixed(1)}"
                  </Text>
                )}
              </View>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 16,
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    flex: 1,
  },
  dateText: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    color: '#6b7280',
  },
  unavailableContainer: {
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  unavailableText: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },
  currentWeather: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  temperatureContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  temperatureInfo: {
    flex: 1,
  },
  temperature: {
    fontSize: 36,
    fontWeight: '700',
    color: '#111827',
  },
  condition: {
    fontSize: 16,
    color: '#6b7280',
    textTransform: 'capitalize',
    marginTop: 4,
  },
  feelsLike: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 2,
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 80,
  },
  detailText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  detailLabel: {
    fontSize: 12,
    color: '#6b7280',
  },
  recommendationBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 14,
    borderRadius: 12,
    gap: 10,
    borderWidth: 1,
  },
  recommendationHighlight: {
    backgroundColor: '#fff5ef',
    borderColor: '#ffd9c2',
  },
  recommendationCaution: {
    backgroundColor: '#fff0e6',
    borderColor: '#ffc9b3',
  },
  recommendationText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  recommendationTextHighlight: {
    color: '#a34000',
  },
  recommendationTextCaution: {
    color: '#d04f0c',
  },
  hourlyContainer: {
    marginTop: 8,
  },
  hourlyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  hourlyScroll: {
    paddingHorizontal: 16,
    gap: 12,
  },
  hourlyItem: {
    alignItems: 'center',
    minWidth: 60,
    gap: 4,
  },
  hourlyTime: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
  hourlyTemp: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  hourlyPrecip: {
    fontSize: 10,
    color: '#3b82f6',
  },
});

