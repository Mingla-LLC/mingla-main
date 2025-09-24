import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { spacing, colors, typography, fontWeights, radius, shadows } from '../constants/designSystem';

interface RouteInfo {
  distance: number; // in km
  duration: number; // in minutes
  mode: 'driving' | 'walking' | 'transit' | 'cycling';
  traffic?: 'light' | 'moderate' | 'heavy';
}

interface DistanceTimeEstimatesProps {
  routes: RouteInfo[];
  selectedRoute?: number;
  onRouteSelect?: (index: number) => void;
  showAlternatives?: boolean;
}

export const DistanceTimeEstimates: React.FC<DistanceTimeEstimatesProps> = ({
  routes,
  selectedRoute = 0,
  onRouteSelect,
  showAlternatives = true,
}) => {
  const animatedValues = useRef(
    routes.map(() => ({
      scale: useSharedValue(0.8),
      opacity: useSharedValue(0),
    }))
  ).current;

  useEffect(() => {
    animatedValues.forEach((value, index) => {
      const delay = index * 100;
      value.scale.value = withSpring(1, {
        damping: 15,
        stiffness: 150,
        delay,
      });
      value.opacity.value = withTiming(1, {
        duration: 300,
        delay,
      });
    });
  }, [routes]);

  const getModeConfig = (mode: string) => {
    switch (mode) {
      case 'driving':
        return {
          icon: 'car' as const,
          color: colors.primary[500],
          label: 'Drive',
        };
      case 'walking':
        return {
          icon: 'walk' as const,
          color: colors.success[500],
          label: 'Walk',
        };
      case 'transit':
        return {
          icon: 'bus' as const,
          color: colors.warning[500],
          label: 'Transit',
        };
      case 'cycling':
        return {
          icon: 'bicycle' as const,
          color: colors.error[500],
          label: 'Bike',
        };
      default:
        return {
          icon: 'ellipse' as const,
          color: colors.gray[500],
          label: 'Route',
        };
    }
  };

  const getTrafficColor = (traffic?: string) => {
    switch (traffic) {
      case 'light':
        return colors.success[500];
      case 'moderate':
        return colors.warning[500];
      case 'heavy':
        return colors.error[500];
      default:
        return colors.gray[400];
    }
  };

  const formatDistance = (distance: number) => {
    if (distance < 1) {
      return `${Math.round(distance * 1000)}m`;
    }
    return `${distance.toFixed(1)}km`;
  };

  const formatDuration = (duration: number) => {
    if (duration < 60) {
      return `${Math.round(duration)}min`;
    }
    const hours = Math.floor(duration / 60);
    const minutes = Math.round(duration % 60);
    return `${hours}h ${minutes}m`;
  };

  const RouteCard = ({ route, index, isSelected }: { route: RouteInfo; index: number; isSelected: boolean }) => {
    const modeConfig = getModeConfig(route.mode);
    const animatedValue = animatedValues[index];

    const animatedStyle = useAnimatedStyle(() => {
      const scale = interpolate(
        animatedValue.scale.value,
        [0.8, 1],
        [0.8, isSelected ? 1.05 : 1],
        Extrapolate.CLAMP
      );

      return {
        transform: [{ scale }],
        opacity: animatedValue.opacity.value,
      };
    });

    return (
      <Animated.View style={[animatedStyle]}>
        <TouchableOpacity
          style={[
            styles.routeCard,
            isSelected && styles.routeCardSelected,
            { borderColor: modeConfig.color },
          ]}
          onPress={() => onRouteSelect?.(index)}
          activeOpacity={0.8}
        >
          <View style={styles.routeHeader}>
            <View style={[styles.modeIcon, { backgroundColor: modeConfig.color }]}>
              <Ionicons
                name={modeConfig.icon}
                size={20}
                color={colors.text.inverse}
              />
            </View>
            
            <View style={styles.routeInfo}>
              <Text style={styles.modeLabel}>{modeConfig.label}</Text>
              {route.traffic && (
                <View style={styles.trafficIndicator}>
                  <View
                    style={[
                      styles.trafficDot,
                      { backgroundColor: getTrafficColor(route.traffic) },
                    ]}
                  />
                  <Text style={styles.trafficText}>
                    {route.traffic.charAt(0).toUpperCase() + route.traffic.slice(1)} traffic
                  </Text>
                </View>
              )}
            </View>
            
            {isSelected && (
              <Ionicons
                name="checkmark-circle"
                size={20}
                color={modeConfig.color}
              />
            )}
          </View>
          
          <View style={styles.routeMetrics}>
            <View style={styles.metric}>
              <Ionicons name="time" size={16} color={colors.text.secondary} />
              <Text style={styles.metricValue}>{formatDuration(route.duration)}</Text>
              <Text style={styles.metricLabel}>Duration</Text>
            </View>
            
            <View style={styles.metric}>
              <Ionicons name="location" size={16} color={colors.text.secondary} />
              <Text style={styles.metricValue}>{formatDistance(route.distance)}</Text>
              <Text style={styles.metricLabel}>Distance</Text>
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const RouteMap = () => {
    const primaryRoute = routes[selectedRoute];
    if (!primaryRoute) return null;

    const modeConfig = getModeConfig(primaryRoute.mode);

    return (
      <View style={styles.mapContainer}>
        <View style={styles.mapHeader}>
          <Ionicons name="map" size={20} color={colors.primary[500]} />
          <Text style={styles.mapTitle}>Route Overview</Text>
        </View>
        
        <View style={styles.mapContent}>
          <View style={styles.mapRoute}>
            <View style={[styles.mapPoint, styles.mapStart]} />
            <View style={[styles.mapLine, { backgroundColor: modeConfig.color }]} />
            <View style={[styles.mapPoint, styles.mapEnd]} />
          </View>
          
          <View style={styles.mapInfo}>
            <Text style={styles.mapDistance}>{formatDistance(primaryRoute.distance)}</Text>
            <Text style={styles.mapDuration}>{formatDuration(primaryRoute.duration)}</Text>
          </View>
        </View>
      </View>
    );
  };

  if (routes.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="location-outline" size={48} color={colors.gray[400]} />
        <Text style={styles.emptyTitle}>No Routes Available</Text>
        <Text style={styles.emptyDescription}>
          Unable to calculate routes to this location
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Route Options</Text>
        <Text style={styles.subtitle}>
          Choose your preferred way to get there
        </Text>
      </View>

      <RouteMap />

      {showAlternatives && routes.length > 1 && (
        <View style={styles.alternativesContainer}>
          <Text style={styles.alternativesTitle}>Alternative Routes</Text>
          {routes.map((route, index) => (
            <RouteCard
              key={index}
              route={route}
              index={index}
              isSelected={index === selectedRoute}
            />
          ))}
        </View>
      )}
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
  title: {
    ...typography.lg,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.sm,
    color: colors.text.secondary,
  },
  mapContainer: {
    backgroundColor: colors.gray[50],
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  mapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  mapTitle: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginLeft: spacing.sm,
  },
  mapContent: {
    alignItems: 'center',
  },
  mapRoute: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  mapPoint: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  mapStart: {
    backgroundColor: colors.success[500],
  },
  mapEnd: {
    backgroundColor: colors.error[500],
  },
  mapLine: {
    width: 60,
    height: 3,
    marginHorizontal: spacing.sm,
  },
  mapInfo: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  mapDistance: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  mapDuration: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  alternativesContainer: {
    marginTop: spacing.md,
  },
  alternativesTitle: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginBottom: spacing.md,
  },
  routeCard: {
    backgroundColor: colors.background.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: colors.gray[200],
  },
  routeCardSelected: {
    borderWidth: 2,
    ...shadows.sm,
  },
  routeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  modeIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  routeInfo: {
    flex: 1,
  },
  modeLabel: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  trafficIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trafficDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.xs,
  },
  trafficText: {
    ...typography.xs,
    color: colors.text.secondary,
  },
  routeMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  metric: {
    alignItems: 'center',
  },
  metricValue: {
    ...typography.lg,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    marginTop: spacing.xs,
  },
  metricLabel: {
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
