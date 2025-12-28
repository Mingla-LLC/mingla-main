import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TimelineData } from '../../types/expandedCardTypes';
import { generateTimeline } from '../../utils/timelineGenerator';

interface TimelineSectionProps {
  category: string;
  title: string;
  address?: string;
  priceRange?: string;
  travelTime?: string;
  strollTimeline?: Array<{
    step: number;
    type: string;
    title: string;
    location: any;
    description: string;
    duration: number;
  }>;
  routeDuration?: number;
}

export default function TimelineSection({
  category,
  title,
  address,
  priceRange,
  travelTime,
  strollTimeline,
  routeDuration,
}: TimelineSectionProps) {
  // Use stroll timeline if available, otherwise generate default timeline
  let timeline: TimelineData;
  
  if (strollTimeline && strollTimeline.length > 0) {
    // Convert stroll timeline to TimelineData format
    const totalDuration = routeDuration 
      ? `${routeDuration} min`
      : strollTimeline.reduce((sum, step) => sum + step.duration, 0) + ' min';
    
    timeline = {
      category,
      totalDuration,
      costPerPerson: priceRange || 'Free',
      steps: strollTimeline.map((step) => ({
        id: `step-${step.step}`,
        title: step.title,
        description: step.description,
        duration: step.duration > 0 ? `${step.duration} min` : undefined,
        icon: step.type === 'start' ? 'cafe' 
          : step.type === 'walk' ? 'walk'
          : step.type === 'pause' ? 'happy'
          : 'checkmark',
        location: step.location?.name || step.location?.address || address,
      })),
    };
  } else {
    timeline = generateTimeline({
      category,
      title,
      address,
      priceRange,
      travelTime,
    });
  }

  // Get icon name from string
  const getIconName = (icon: string | undefined): string => {
    if (!icon) return 'ellipse';
    const iconMap: { [key: string]: string } = {
      cafe: 'cafe',
      walk: 'walk',
      eye: 'eye',
      location: 'location',
      happy: 'happy',
      checkmark: 'checkmark-circle',
      restaurant: 'restaurant',
      film: 'film',
      brush: 'brush',
      camera: 'camera',
      storefront: 'storefront',
      car: 'car',
      leaf: 'leaf',
      'game-controller': 'game-controller',
      basketball: 'basketball',
      trophy: 'trophy',
      wine: 'wine',
      sparkles: 'sparkles',
      compass: 'compass',
      'add-circle': 'add-circle',
      star: 'star',
    };
    return iconMap[icon] || 'ellipse';
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="time" size={20} color="#eb7825" />
        <Text style={styles.title}>Timeline</Text>
      </View>

      {/* Timeline Summary */}
      <View style={styles.summaryContainer}>
        <View style={styles.summaryItem}>
          <Ionicons name="hourglass" size={16} color="#6b7280" />
          <Text style={styles.summaryLabel}>Duration</Text>
          <Text style={styles.summaryValue}>{timeline.totalDuration}</Text>
        </View>
        <View style={styles.summaryItem}>
          <Ionicons name="cash" size={16} color="#6b7280" />
          <Text style={styles.summaryLabel}>Cost</Text>
          <Text style={styles.summaryValue}>{timeline.costPerPerson}</Text>
        </View>
      </View>

      {/* Timeline Steps */}
      <View style={styles.stepsContainer}>
        {timeline.steps.map((step, index) => (
          <View key={step.id} style={styles.stepRow}>
            {/* Timeline Line */}
            {index < timeline.steps.length - 1 && (
              <View style={styles.timelineLine} />
            )}

            {/* Step Icon */}
            <View style={styles.stepIconContainer}>
              <View style={styles.stepIconCircle}>
                <Ionicons
                  name={getIconName(step.icon) as any}
                  size={20}
                  color="#eb7825"
                />
              </View>
            </View>

            {/* Step Content */}
            <View style={styles.stepContent}>
              <View style={styles.stepHeader}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                {step.duration && (
                  <View style={styles.durationBadge}>
                    <Ionicons name="time-outline" size={12} color="#6b7280" />
                    <Text style={styles.durationText}>{step.duration}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.stepDescription}>{step.description}</Text>
              {step.location && (
                <View style={styles.locationContainer}>
                  <Ionicons name="location-outline" size={12} color="#9ca3af" />
                  <Text style={styles.locationText}>{step.location}</Text>
                </View>
              )}
            </View>
          </View>
        ))}
      </View>
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
  summaryContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 20,
    gap: 16,
  },
  summaryItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  summaryLabel: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
    marginRight: 'auto',
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  stepsContainer: {
    paddingHorizontal: 16,
    position: 'relative',
  },
  stepRow: {
    flexDirection: 'row',
    marginBottom: 24,
    position: 'relative',
  },
  timelineLine: {
    position: 'absolute',
    left: 20,
    top: 40,
    width: 2,
    height: '100%',
    backgroundColor: '#e5e7eb',
    zIndex: 0,
  },
  stepIconContainer: {
    width: 40,
    alignItems: 'center',
    zIndex: 1,
  },
  stepIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fef3e2',
    borderWidth: 2,
    borderColor: '#eb7825',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepContent: {
    flex: 1,
    marginLeft: 12,
    paddingBottom: 8,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    flex: 1,
  },
  durationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  durationText: {
    fontSize: 11,
    color: '#6b7280',
    fontWeight: '500',
  },
  stepDescription: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 20,
    marginBottom: 4,
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  locationText: {
    fontSize: 12,
    color: '#9ca3af',
    fontStyle: 'italic',
  },
});

