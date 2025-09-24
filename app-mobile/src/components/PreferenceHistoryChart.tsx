import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { spacing, colors, typography, fontWeights, radius, shadows } from '../constants/designSystem';

interface PreferenceDataPoint {
  date: string;
  budget: number;
  travelTime: number;
  groupSize: number;
  categories: string[];
}

interface PreferenceHistoryChartProps {
  data: PreferenceDataPoint[];
  selectedMetric: 'budget' | 'travelTime' | 'groupSize';
  onMetricChange: (metric: 'budget' | 'travelTime' | 'groupSize') => void;
}

export const PreferenceHistoryChart: React.FC<PreferenceHistoryChartProps> = ({
  data,
  selectedMetric,
  onMetricChange,
}) => {
  const { width } = Dimensions.get('window');
  const chartWidth = width - (spacing.lg * 2);
  const chartHeight = 200;
  
  const animatedValues = useRef(
    data.map(() => ({
      height: useSharedValue(0),
      opacity: useSharedValue(0),
    }))
  ).current;

  useEffect(() => {
    // Animate bars in sequence
    animatedValues.forEach((value, index) => {
      const delay = index * 100;
      value.height.value = withSpring(1, {
        damping: 15,
        stiffness: 150,
        delay,
      });
      value.opacity.value = withTiming(1, {
        duration: 300,
        delay,
      });
    });
  }, [data, selectedMetric]);

  const getMaxValue = () => {
    switch (selectedMetric) {
      case 'budget':
        return Math.max(...data.map(d => d.budget), 200);
      case 'travelTime':
        return Math.max(...data.map(d => d.travelTime), 120);
      case 'groupSize':
        return Math.max(...data.map(d => d.groupSize), 8);
      default:
        return 100;
    }
  };

  const getValue = (dataPoint: PreferenceDataPoint) => {
    switch (selectedMetric) {
      case 'budget':
        return dataPoint.budget;
      case 'travelTime':
        return dataPoint.travelTime;
      case 'groupSize':
        return dataPoint.groupSize;
      default:
        return 0;
    }
  };

  const getMetricConfig = () => {
    switch (selectedMetric) {
      case 'budget':
        return {
          label: 'Budget',
          unit: '$',
          color: colors.success[500],
          icon: 'cash' as const,
        };
      case 'travelTime':
        return {
          label: 'Travel Time',
          unit: 'min',
          color: colors.primary[500],
          icon: 'time' as const,
        };
      case 'groupSize':
        return {
          label: 'Group Size',
          unit: 'people',
          color: colors.warning[500],
          icon: 'people' as const,
        };
      default:
        return {
          label: 'Metric',
          unit: '',
          color: colors.gray[500],
          icon: 'bar-chart' as const,
        };
    }
  };

  const maxValue = getMaxValue();
  const metricConfig = getMetricConfig();

  const BarChart = () => {
    const barWidth = (chartWidth - spacing.md * (data.length - 1)) / data.length;

    return (
      <View style={styles.chartContainer}>
        {data.map((dataPoint, index) => {
          const value = getValue(dataPoint);
          const percentage = value / maxValue;
          const animatedValue = animatedValues[index];

          const barStyle = useAnimatedStyle(() => {
            const height = interpolate(
              animatedValue.height.value,
              [0, 1],
              [0, percentage * chartHeight],
              Extrapolate.CLAMP
            );

            return {
              height,
              opacity: animatedValue.opacity.value,
            };
          });

          return (
            <View key={index} style={styles.barContainer}>
              <Animated.View
                style={[
                  styles.bar,
                  {
                    width: barWidth,
                    backgroundColor: metricConfig.color,
                  },
                  barStyle,
                ]}
              />
              <Text style={styles.barLabel}>
                {new Date(dataPoint.date).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </Text>
              <Text style={styles.barValue}>
                {value}{metricConfig.unit}
              </Text>
            </View>
          );
        })}
      </View>
    );
  };

  const MetricSelector = () => (
    <View style={styles.metricSelector}>
      {(['budget', 'travelTime', 'groupSize'] as const).map((metric) => {
        const config = getMetricConfig();
        const isSelected = selectedMetric === metric;
        
        return (
          <Animated.View
            key={metric}
            style={[
              styles.metricButton,
              isSelected && {
                backgroundColor: config.color,
                transform: [{ scale: 1.05 }],
              },
            ]}
          >
            <TouchableOpacity
              style={styles.metricButtonContent}
              onPress={() => onMetricChange(metric)}
              activeOpacity={0.8}
            >
              <Ionicons
                name={config.icon}
                size={16}
                color={isSelected ? colors.text.inverse : colors.text.secondary}
              />
              <Text
                style={[
                  styles.metricButtonText,
                  isSelected && { color: colors.text.inverse },
                ]}
              >
                {config.label}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        );
      })}
    </View>
  );

  if (data.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="bar-chart-outline" size={48} color={colors.gray[400]} />
        <Text style={styles.emptyTitle}>No History Yet</Text>
        <Text style={styles.emptyDescription}>
          Your preference history will appear here as you use the app
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleContainer}>
          <Ionicons name="trending-up" size={20} color={colors.primary[500]} />
          <Text style={styles.title}>Preference Trends</Text>
        </View>
        <Text style={styles.subtitle}>
          See how your preferences change over time
        </Text>
      </View>

      <MetricSelector />

      <View style={styles.chartWrapper}>
        <BarChart />
      </View>

      <View style={styles.statsContainer}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>
            {data.length} {data.length === 1 ? 'session' : 'sessions'}
          </Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>
            {Math.round(data.reduce((sum, d) => sum + getValue(d), 0) / data.length)}
            {metricConfig.unit}
          </Text>
          <Text style={styles.statLabel}>Average</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>
            {Math.max(...data.map(d => getValue(d)))}
            {metricConfig.unit}
          </Text>
          <Text style={styles.statLabel}>Peak</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background.primary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    margin: spacing.md,
    ...shadows.md,
  },
  header: {
    marginBottom: spacing.lg,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  title: {
    ...typography.lg,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginLeft: spacing.sm,
  },
  subtitle: {
    ...typography.sm,
    color: colors.text.secondary,
  },
  metricSelector: {
    flexDirection: 'row',
    marginBottom: spacing.lg,
    backgroundColor: colors.gray[100],
    borderRadius: radius.md,
    padding: spacing.xs,
  },
  metricButton: {
    flex: 1,
    borderRadius: radius.sm,
    marginHorizontal: spacing.xs,
  },
  metricButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  metricButtonText: {
    ...typography.sm,
    fontWeight: fontWeights.medium,
    color: colors.text.secondary,
    marginLeft: spacing.xs,
  },
  chartWrapper: {
    height: 200,
    marginBottom: spacing.lg,
  },
  chartContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: '100%',
  },
  barContainer: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: '100%',
  },
  bar: {
    borderRadius: radius.sm,
    marginBottom: spacing.sm,
  },
  barLabel: {
    ...typography.xs,
    color: colors.text.tertiary,
    marginBottom: spacing.xs,
  },
  barValue: {
    ...typography.xs,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.gray[200],
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    ...typography.lg,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
  },
  statLabel: {
    ...typography.xs,
    color: colors.text.secondary,
    marginTop: spacing.xs,
  },
  emptyContainer: {
    alignItems: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background.primary,
    borderRadius: radius.lg,
    margin: spacing.md,
  },
  emptyTitle: {
    ...typography.lg,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  emptyDescription: {
    ...typography.sm,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
