import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BusynessData } from '../../services/busynessService';

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
  // Get busyness level color
  const getBusynessColor = (
    level: 'Not Busy' | 'Moderate' | 'Busy' | 'Very Busy'
  ): string => {
    switch (level) {
      case 'Not Busy':
        return '#10b981'; // Green
      case 'Moderate':
        return '#f59e0b'; // Amber
      case 'Busy':
        return '#ef4444'; // Red
      case 'Very Busy':
        return '#dc2626'; // Dark red
      default:
        return '#6b7280';
    }
  };

  // Get busyness icon
  const getBusynessIcon = (
    level: 'Not Busy' | 'Moderate' | 'Busy' | 'Very Busy'
  ): string => {
    switch (level) {
      case 'Not Busy':
        return 'checkmark-circle';
      case 'Moderate':
        return 'time';
      case 'Busy':
        return 'warning';
      case 'Very Busy':
        return 'alert-circle';
      default:
        return 'information-circle';
    }
  };

  // Get traffic condition color
  const getTrafficColor = (condition: 'Light' | 'Moderate' | 'Heavy'): string => {
    switch (condition) {
      case 'Light':
        return '#10b981';
      case 'Moderate':
        return '#f59e0b';
      case 'Heavy':
        return '#ef4444';
      default:
        return '#6b7280';
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="people" size={20} color="#eb7825" />
          <Text style={styles.title}>Traffic & Busyness</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color="#eb7825" />
          <Text style={styles.loadingText}>Loading busyness data...</Text>
        </View>
      </View>
    );
  }

  if (!busynessData) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="people" size={20} color="#eb7825" />
          <Text style={styles.title}>Traffic & Busyness</Text>
        </View>
        <View style={styles.unavailableContainer}>
          <Text style={styles.unavailableText}>
            Busyness information unavailable
          </Text>
        </View>
      </View>
    );
  }

  const busynessColor = getBusynessColor(busynessData.busynessLevel);
  const busynessIcon = getBusynessIcon(busynessData.busynessLevel);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="people" size={20} color="#eb7825" />
        <Text style={styles.title}>Traffic & Busyness</Text>
      </View>

      {/* Current Busyness Status */}
      <View style={styles.statusContainer}>
        <View style={styles.busynessCard}>
          <View style={styles.busynessHeader}>
            <Ionicons name={busynessIcon as any} size={24} color={busynessColor} />
            <View style={styles.busynessInfo}>
              <Text style={styles.busynessLabel}>Current Status</Text>
              <Text
                style={[styles.busynessLevel, { color: busynessColor }]}
              >
                {busynessData.busynessLevel}
              </Text>
            </View>
            <View style={styles.popularityBadge}>
              <Text style={styles.popularityText}>
                {busynessData.currentPopularity}%
              </Text>
            </View>
          </View>
          <Text style={styles.busynessMessage}>
            {busynessData.message}
          </Text>
        </View>

        {/* Traffic Information */}
        {busynessData.trafficInfo && (
          <View style={styles.trafficCard}>
            <View style={styles.trafficHeader}>
              <Ionicons name="car" size={20} color="#6b7280" />
              <Text style={styles.trafficLabel}>Travel Time</Text>
            </View>
            <Text style={styles.trafficTime}>
              {busynessData.trafficInfo.currentTravelTime}
            </Text>
            <View style={styles.trafficCondition}>
              <View
                style={[
                  styles.trafficIndicator,
                  {
                    backgroundColor: getTrafficColor(
                      busynessData.trafficInfo.trafficCondition
                    ),
                  },
                ]}
              />
              <Text style={styles.trafficConditionText}>
                {busynessData.trafficInfo.trafficCondition} Traffic
              </Text>
            </View>
          </View>
        )}

        {/* Travel Time from card data if traffic info not available */}
        {!busynessData.trafficInfo && travelTime && (
          <View style={styles.trafficCard}>
            <View style={styles.trafficHeader}>
              <Ionicons name="time" size={20} color="#6b7280" />
              <Text style={styles.trafficLabel}>Estimated Travel Time</Text>
            </View>
            <Text style={styles.trafficTime}>{travelTime}</Text>
          </View>
        )}
      </View>

      {/* Popular Times Chart */}
      {busynessData.popularTimes && busynessData.popularTimes.length > 0 && (
        <View style={styles.popularTimesContainer}>
          <Text style={styles.popularTimesTitle}>Popular Times</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.popularTimesScroll}
          >
            {busynessData.popularTimes.map((dayData, dayIndex) => {
              const today = new Date().getDay();
              const isToday = dayIndex === (today === 0 ? 6 : today - 1); // Adjust for Sunday = 0

              return (
                <View
                  key={dayIndex}
                  style={[
                    styles.dayColumn,
                    isToday && styles.dayColumnToday,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayLabel,
                      isToday && styles.dayLabelToday,
                    ]}
                  >
                    {dayData.day.slice(0, 3)}
                  </Text>
                  <View style={styles.barsContainer}>
                    {dayData.times.map((timeSlot, timeIndex) => {
                      const barHeight = (timeSlot.popularity / 100) * 60;
                      const isPeak = timeSlot.popularity > 70;
                      const isModerate = timeSlot.popularity > 40 && timeSlot.popularity <= 70;

                      return (
                        <View
                          key={timeIndex}
                          style={[
                            styles.bar,
                            {
                              height: Math.max(barHeight, 4),
                              backgroundColor: isPeak
                                ? '#ef4444'
                                : isModerate
                                ? '#f59e0b'
                                : '#10b981',
                            },
                          ]}
                        />
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </ScrollView>
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendColor, { backgroundColor: '#10b981' }]} />
              <Text style={styles.legendText}>Not Busy</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendColor, { backgroundColor: '#f59e0b' }]} />
              <Text style={styles.legendText}>Moderate</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendColor, { backgroundColor: '#ef4444' }]} />
              <Text style={styles.legendText}>Peak</Text>
            </View>
          </View>
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
  statusContainer: {
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 16,
  },
  busynessCard: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  busynessHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  busynessInfo: {
    flex: 1,
  },
  busynessLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4,
  },
  busynessLevel: {
    fontSize: 20,
    fontWeight: '700',
  },
  popularityBadge: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  popularityText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  busynessMessage: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  trafficCard: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  trafficHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  trafficLabel: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
  },
  trafficTime: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  trafficCondition: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  trafficIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  trafficConditionText: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
  popularTimesContainer: {
    marginTop: 8,
  },
  popularTimesTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  popularTimesScroll: {
    paddingHorizontal: 16,
    gap: 12,
    paddingBottom: 8,
  },
  dayColumn: {
    alignItems: 'center',
    minWidth: 50,
    gap: 8,
  },
  dayColumnToday: {
    backgroundColor: '#fef3e2',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  dayLabel: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
  dayLabelToday: {
    color: '#eb7825',
    fontWeight: '600',
  },
  barsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 70,
    gap: 2,
  },
  bar: {
    width: 4,
    borderRadius: 2,
    minHeight: 4,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 12,
    paddingHorizontal: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendColor: {
    width: 12,
    height: 12,
    borderRadius: 2,
  },
  legendText: {
    fontSize: 12,
    color: '#6b7280',
  },
});

