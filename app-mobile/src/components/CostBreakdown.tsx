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

interface CostItem {
  id: string;
  name: string;
  amount: number;
  category: 'food' | 'drinks' | 'activities' | 'transport' | 'other';
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

interface CostBreakdownProps {
  totalBudget: number;
  estimatedCost: number;
  costItems: CostItem[];
  groupSize: number;
  showDetails?: boolean;
}

export const CostBreakdown: React.FC<CostBreakdownProps> = ({
  totalBudget,
  estimatedCost,
  costItems,
  groupSize,
  showDetails = true,
}) => {
  const progress = useSharedValue(0);
  const itemProgresses = useRef(
    costItems.map(() => useSharedValue(0))
  ).current;

  useEffect(() => {
    // Animate main progress bar
    progress.value = withSpring(estimatedCost / totalBudget, {
      damping: 15,
      stiffness: 150,
    });

    // Animate individual items
    itemProgresses.forEach((itemProgress, index) => {
      const delay = index * 100;
      itemProgress.value = withSpring(1, {
        damping: 15,
        stiffness: 150,
        delay,
      });
    });
  }, [estimatedCost, totalBudget, costItems]);

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'food':
        return colors.success[500];
      case 'drinks':
        return colors.primary[500];
      case 'activities':
        return colors.warning[500];
      case 'transport':
        return colors.error[500];
      default:
        return colors.gray[500];
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'food':
        return 'restaurant';
      case 'drinks':
        return 'wine';
      case 'activities':
        return 'game-controller';
      case 'transport':
        return 'car';
      default:
        return 'ellipse';
    }
  };

  const getBudgetStatus = () => {
    const percentage = (estimatedCost / totalBudget) * 100;
    if (percentage <= 70) return { status: 'under', color: colors.success[500], icon: 'checkmark-circle' };
    if (percentage <= 90) return { status: 'good', color: colors.warning[500], icon: 'warning' };
    return { status: 'over', color: colors.error[500], icon: 'alert-circle' };
  };

  const budgetStatus = getBudgetStatus();
  const costPerPerson = estimatedCost / groupSize;

  const MainProgressBar = () => {
    const animatedStyle = useAnimatedStyle(() => {
      const width = interpolate(
        progress.value,
        [0, 1],
        [0, 100],
        Extrapolate.CLAMP
      );

      return {
        width: `${width}%`,
      };
    });

    return (
      <View style={styles.progressContainer}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressTitle}>Budget Usage</Text>
          <View style={styles.progressStatus}>
            <Ionicons
              name={budgetStatus.icon}
              size={16}
              color={budgetStatus.color}
            />
            <Text style={[styles.progressStatusText, { color: budgetStatus.color }]}>
              {budgetStatus.status === 'under' ? 'Under Budget' : 
               budgetStatus.status === 'good' ? 'Good' : 'Over Budget'}
            </Text>
          </View>
        </View>
        
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBarBackground}>
            <Animated.View
              style={[
                styles.progressBarFill,
                {
                  backgroundColor: budgetStatus.color,
                },
                animatedStyle,
              ]}
            />
          </View>
          <Text style={styles.progressText}>
            ${estimatedCost.toFixed(0)} / ${totalBudget.toFixed(0)}
          </Text>
        </View>
      </View>
    );
  };

  const CostItemsList = () => {
    if (!showDetails) return null;

    return (
      <View style={styles.itemsContainer}>
        <Text style={styles.itemsTitle}>Cost Breakdown</Text>
        {costItems.map((item, index) => {
          const itemProgress = itemProgresses[index];
          const percentage = (item.amount / estimatedCost) * 100;

          const itemAnimatedStyle = useAnimatedStyle(() => {
            const opacity = interpolate(
              itemProgress.value,
              [0, 1],
              [0, 1],
              Extrapolate.CLAMP
            );

            const translateX = interpolate(
              itemProgress.value,
              [0, 1],
              [-20, 0],
              Extrapolate.CLAMP
            );

            return {
              opacity,
              transform: [{ translateX }],
            };
          });

          return (
            <Animated.View
              key={item.id}
              style={[styles.costItem, itemAnimatedStyle]}
            >
              <View style={styles.costItemHeader}>
                <View style={styles.costItemIcon}>
                  <Ionicons
                    name={item.icon}
                    size={16}
                    color={item.color}
                  />
                </View>
                <Text style={styles.costItemName}>{item.name}</Text>
                <Text style={styles.costItemAmount}>
                  ${item.amount.toFixed(0)}
                </Text>
              </View>
              
              <View style={styles.costItemProgressContainer}>
                <View
                  style={[
                    styles.costItemProgress,
                    {
                      width: `${percentage}%`,
                      backgroundColor: item.color,
                    },
                  ]}
                />
              </View>
              
              <Text style={styles.costItemPercentage}>
                {percentage.toFixed(1)}% of total
              </Text>
            </Animated.View>
          );
        })}
      </View>
    );
  };

  const SummaryCards = () => (
    <View style={styles.summaryContainer}>
      <View style={styles.summaryCard}>
        <Ionicons name="people" size={20} color={colors.primary[500]} />
        <Text style={styles.summaryValue}>${costPerPerson.toFixed(0)}</Text>
        <Text style={styles.summaryLabel}>Per Person</Text>
      </View>
      
      <View style={styles.summaryCard}>
        <Ionicons name="time" size={20} color={colors.warning[500]} />
        <Text style={styles.summaryValue}>
          {Math.round(estimatedCost / totalBudget * 100)}%
        </Text>
        <Text style={styles.summaryLabel}>Budget Used</Text>
      </View>
      
      <View style={styles.summaryCard}>
        <Ionicons name="wallet" size={20} color={colors.success[500]} />
        <Text style={styles.summaryValue}>
          ${(totalBudget - estimatedCost).toFixed(0)}
        </Text>
        <Text style={styles.summaryLabel}>Remaining</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Cost Breakdown</Text>
        <Text style={styles.subtitle}>
          Estimated costs for {groupSize} {groupSize === 1 ? 'person' : 'people'}
        </Text>
      </View>

      <MainProgressBar />
      
      <SummaryCards />
      
      <CostItemsList />
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
  progressContainer: {
    marginBottom: spacing.lg,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  progressTitle: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  progressStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressStatusText: {
    ...typography.sm,
    fontWeight: fontWeights.medium,
    marginLeft: spacing.xs,
  },
  progressBarContainer: {
    alignItems: 'center',
  },
  progressBarBackground: {
    width: '100%',
    height: 8,
    backgroundColor: colors.gray[200],
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressText: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  summaryContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  summaryCard: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.gray[50],
    borderRadius: radius.md,
    padding: spacing.md,
    marginHorizontal: spacing.xs,
  },
  summaryValue: {
    ...typography.lg,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    marginTop: spacing.xs,
  },
  summaryLabel: {
    ...typography.xs,
    color: colors.text.secondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  itemsContainer: {
    marginTop: spacing.md,
  },
  itemsTitle: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginBottom: spacing.md,
  },
  costItem: {
    marginBottom: spacing.md,
  },
  costItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  costItemIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.gray[100],
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  costItemName: {
    ...typography.sm,
    color: colors.text.primary,
    flex: 1,
  },
  costItemAmount: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  costItemProgressContainer: {
    height: 4,
    backgroundColor: colors.gray[200],
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  costItemProgress: {
    height: '100%',
    borderRadius: 2,
  },
  costItemPercentage: {
    ...typography.xs,
    color: colors.text.tertiary,
  },
});
