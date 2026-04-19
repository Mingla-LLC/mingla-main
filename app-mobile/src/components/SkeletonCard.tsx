import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { spacing, radius, colors } from '../constants/designSystem';

interface SkeletonCardProps {
  width?: number;
  height?: number;
  borderRadius?: number;
}

export const SkeletonCard: React.FC<SkeletonCardProps> = ({
  width = 300,
  height = 400,
  borderRadius = radius.lg,
}) => {
  const shimmerAnimation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnimation, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnimation, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [shimmerAnimation]);

  const shimmerTranslateX = shimmerAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [-width, width],
  });

  return (
    <View style={[styles.container, { width, height, borderRadius }]}>
      <View style={styles.content}>
        {/* Image skeleton */}
        <View style={[styles.imageSkeleton, { borderRadius: radius.md }]} />

        {/* Title skeleton */}
        <View style={styles.titleSkeleton} />
        <View style={[styles.titleSkeleton, { width: '70%' }]} />

        {/* Subtitle skeleton */}
        <View style={styles.subtitleSkeleton} />

        {/* Action buttons skeleton */}
        <View style={styles.actionsContainer}>
          <View style={styles.actionButtonSkeleton} />
          <View style={styles.actionButtonSkeleton} />
        </View>
      </View>

      {/* Shimmer effect */}
      <Animated.View
        style={[
          styles.shimmer,
          {
            transform: [{ translateX: shimmerTranslateX }],
          },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.gray[100],
    overflow: 'hidden',
    position: 'relative',
  },
  content: {
    flex: 1,
    padding: spacing.lg,
  },
  imageSkeleton: {
    height: 200,
    backgroundColor: colors.gray[200],
    marginBottom: spacing.lg,
  },
  titleSkeleton: {
    height: 20,
    backgroundColor: colors.gray[200],
    borderRadius: radius.sm,
    marginBottom: spacing.sm,
  },
  subtitleSkeleton: {
    height: 16,
    width: '60%',
    backgroundColor: colors.gray[200],
    borderRadius: radius.sm,
    marginBottom: spacing.lg,
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 'auto',
  },
  actionButtonSkeleton: {
    height: 50,
    width: 120,
    backgroundColor: colors.gray[200],
    borderRadius: radius.md,
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    width: '100%',
  },
});

// Skeleton for recommendation cards specifically
export const RecommendationSkeletonCard: React.FC = () => {
  return (
    <SkeletonCard
      width={320}
      height={450}
      borderRadius={radius.xl}
    />
  );
};

// Skeleton for list items
export const SkeletonListItem: React.FC = () => {
  const shimmerAnimation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const startShimmer = () => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(shimmerAnimation, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(shimmerAnimation, {
            toValue: 0,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      ).start();
    };

    startShimmer();
  }, [shimmerAnimation]);

  const shimmerTranslateX = shimmerAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [-200, 200],
  });

  return (
    <View style={extendedStyles.listItemContainer}>
      <View style={extendedStyles.listItemContent}>
        <View style={extendedStyles.listItemIcon} />
        <View style={extendedStyles.listItemText}>
          <View style={extendedStyles.listItemTitle} />
          <View style={[extendedStyles.listItemSubtitle, { width: '70%' }]} />
        </View>
      </View>

      <Animated.View
        style={[
          extendedStyles.shimmer,
          {
            transform: [{ translateX: shimmerTranslateX }],
          },
        ]}
      />
    </View>
  );
};

const listItemStyles = StyleSheet.create({
  listItemContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.background.primary,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    position: 'relative',
  },
  listItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  listItemIcon: {
    width: 40,
    height: 40,
    backgroundColor: colors.gray[200],
    borderRadius: radius.md,
    marginRight: spacing.md,
  },
  listItemText: {
    flex: 1,
  },
  listItemTitle: {
    height: 16,
    backgroundColor: colors.gray[200],
    borderRadius: radius.sm,
    marginBottom: spacing.xs,
  },
  listItemSubtitle: {
    height: 12,
    backgroundColor: colors.gray[200],
    borderRadius: radius.sm,
  },
});

// Add the list item styles to the main styles object
const extendedStyles = StyleSheet.create({
  ...styles,
  ...listItemStyles,
});
