import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';
import { Icon } from './ui/Icon';
import { spacing, colors, typography, fontWeights, radius } from '../constants/designSystem';

interface ConfidenceScoreProps {
  score: number; // 0-100
  factors?: {
    locationMatch: number;
    budgetMatch: number;
    categoryMatch: number;
    timeMatch: number;
    popularity: number;
  };
  showDetails?: boolean;
  size?: 'small' | 'medium' | 'large';
}

export const ConfidenceScore: React.FC<ConfidenceScoreProps> = ({
  score,
  factors,
  showDetails = false,
  size = 'medium',
}) => {
  const progress = useSharedValue(0);
  const scale = useSharedValue(0.8);
  const opacity = useSharedValue(0);

  useEffect(() => {
    progress.value = withSpring(score / 100, {
      damping: 15,
      stiffness: 150,
    });
    scale.value = withSpring(1, {
      damping: 12,
      stiffness: 200,
    });
    opacity.value = withTiming(1, { duration: 300 });
  }, [score]);

  const getScoreColor = (score: number) => {
    if (score >= 80) return colors.success[500];
    if (score >= 60) return colors.warning[500];
    if (score >= 40) return colors.primary[500];
    return colors.error[500];
  };

  const getScoreLabel = (score: number) => {
    if (score >= 80) return 'Excellent Match';
    if (score >= 60) return 'Good Match';
    if (score >= 40) return 'Fair Match';
    return 'Low Match';
  };

  const getSizeConfig = () => {
    switch (size) {
      case 'small':
        return {
          circleSize: 40,
          strokeWidth: 3,
          fontSize: typography.xs.fontSize,
          iconSize: 12,
        };
      case 'large':
        return {
          circleSize: 80,
          strokeWidth: 6,
          fontSize: typography.lg.fontSize,
          iconSize: 24,
        };
      default: // medium
        return {
          circleSize: 60,
          strokeWidth: 4,
          fontSize: typography.md.fontSize,
          iconSize: 16,
        };
    }
  };

  const sizeConfig = getSizeConfig();
  const scoreColor = getScoreColor(score);
  const scoreLabel = getScoreLabel(score);


  const CircleProgress = () => {
    const progressStyle = useAnimatedStyle(() => {
      return {
        transform: [{ scale: scale.value }],
        opacity: opacity.value,
      };
    });

    // Create a simple progress bar using border segments
    const getProgressBorders = () => {
      const progressPercent = score / 100;
      const borders = {
        borderTopColor: 'transparent',
        borderRightColor: 'transparent', 
        borderBottomColor: 'transparent',
        borderLeftColor: 'transparent',
      };

      if (progressPercent > 0) borders.borderTopColor = scoreColor;
      if (progressPercent > 0.25) borders.borderRightColor = scoreColor;
      if (progressPercent > 0.5) borders.borderBottomColor = scoreColor;
      if (progressPercent > 0.75) borders.borderLeftColor = scoreColor;

      return borders;
    };

    return (
      <View style={styles.circleContainer}>
        {/* Background circle */}
        <View
          style={[
            styles.circleBackground,
            {
              width: sizeConfig.circleSize,
              height: sizeConfig.circleSize,
              borderRadius: sizeConfig.circleSize / 2,
              borderWidth: sizeConfig.strokeWidth,
            },
          ]}
        />
        
        {/* Progress circle */}
        <Animated.View
          style={[
            styles.circleProgress,
            {
              width: sizeConfig.circleSize,
              height: sizeConfig.circleSize,
              borderRadius: sizeConfig.circleSize / 2,
              borderWidth: sizeConfig.strokeWidth,
              borderColor: 'transparent',
              ...getProgressBorders(),
            },
            progressStyle,
          ]}
        />
        
        {/* Score text */}
        <View style={styles.scoreTextContainer}>
          <Text
            style={[
              styles.scoreText,
              {
                fontSize: sizeConfig.fontSize,
                color: scoreColor,
              },
            ]}
          >
            {Math.round(score)}
          </Text>
          <Text
            style={[
              styles.scoreUnit,
              {
                fontSize: sizeConfig.fontSize * 0.6,
              },
            ]}
          >
            %
          </Text>
        </View>
      </View>
    );
  };

  const FactorBreakdown = () => {
    if (!factors || !showDetails) return null;

    const factorItems = [
      { key: 'locationMatch', label: 'Location', icon: 'location' as const, value: factors.locationMatch },
      { key: 'budgetMatch', label: 'Budget', icon: 'cash' as const, value: factors.budgetMatch },
      { key: 'categoryMatch', label: 'Category', icon: 'grid' as const, value: factors.categoryMatch },
      { key: 'timeMatch', label: 'Time', icon: 'time' as const, value: factors.timeMatch },
      { key: 'popularity', label: 'Popularity', icon: 'trending-up' as const, value: factors.popularity },
    ];

    return (
      <View style={styles.factorBreakdown}>
        <Text style={styles.factorTitle}>Match Factors</Text>
        {factorItems.map((factor) => (
          <View key={factor.key} style={styles.factorItem}>
            <View style={styles.factorHeader}>
              <Icon
                name={factor.icon}
                size={sizeConfig.iconSize}
                color={colors.text.secondary}
              />
              <Text style={styles.factorLabel}>{factor.label}</Text>
              <Text style={styles.factorValue}>{factor.value}%</Text>
            </View>
            <View style={styles.factorProgressContainer}>
              <View
                style={[
                  styles.factorProgress,
                  {
                    width: `${factor.value}%`,
                    backgroundColor: getScoreColor(factor.value),
                  },
                ]}
              />
            </View>
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.scoreContainer}>
        <CircleProgress />
        <View style={styles.scoreInfo}>
          <Text style={styles.scoreLabel}>{scoreLabel}</Text>
          <Text style={styles.scoreDescription}>
            Based on your preferences and location
          </Text>
        </View>
      </View>
      
      <FactorBreakdown />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  scoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  circleContainer: {
    position: 'relative',
    marginRight: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    width: 60,
    height: 60,
  },
  circleBackground: {
    position: 'absolute',
    borderColor: colors.gray[200],
  },
  circleProgress: {
    position: 'absolute',
    transform: [{ rotate: '-90deg' }],
  },
  progressSegment: {
    position: 'absolute',
  },
  scoreTextContainer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    height: '100%',
    zIndex: 10,
  },
  scoreText: {
    fontWeight: fontWeights.bold,
    textAlign: 'center',
    color: colors.text.primary,
    fontSize: 18,
  },
  scoreUnit: {
    fontWeight: fontWeights.medium,
    color: colors.text.secondary,
    fontSize: 12,
  },
  scoreInfo: {
    flex: 1,
  },
  scoreLabel: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  scoreDescription: {
    ...typography.sm,
    color: colors.text.secondary,
    lineHeight: 18,
  },
  factorBreakdown: {
    width: '100%',
    marginTop: spacing.md,
  },
  factorTitle: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  factorItem: {
    marginBottom: spacing.sm,
  },
  factorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  factorLabel: {
    ...typography.sm,
    color: colors.text.secondary,
    marginLeft: spacing.sm,
    flex: 1,
  },
  factorValue: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  factorProgressContainer: {
    height: 4,
    backgroundColor: colors.gray[200],
    borderRadius: 2,
    overflow: 'hidden',
  },
  factorProgress: {
    height: '100%',
    borderRadius: 2,
  },
});
