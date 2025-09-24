import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Extrapolate,
  runOnJS,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { spacing, colors, typography, fontWeights, radius, shadows } from '../constants/designSystem';

interface PopularityData {
  likes: number;
  saves: number;
  shares: number;
  views: number;
  rating?: number;
  reviewCount?: number;
}

interface PopularityIndicatorsProps {
  data: PopularityData;
  showDetails?: boolean;
  onLike?: () => void;
  onSave?: () => void;
  onShare?: () => void;
  isLiked?: boolean;
  isSaved?: boolean;
}

export const PopularityIndicators: React.FC<PopularityIndicatorsProps> = ({
  data,
  showDetails = true,
  onLike,
  onSave,
  onShare,
  isLiked = false,
  isSaved = false,
}) => {
  const animatedValues = useRef({
    likes: useSharedValue(0),
    saves: useSharedValue(0),
    shares: useSharedValue(0),
    views: useSharedValue(0),
    rating: useSharedValue(0),
    likeScale: useSharedValue(1),
    saveScale: useSharedValue(1),
    shareScale: useSharedValue(1),
  }).current;

  useEffect(() => {
    // Animate counters
    animatedValues.likes.value = withSpring(data.likes, {
      damping: 15,
      stiffness: 150,
    });
    animatedValues.saves.value = withSpring(data.saves, {
      damping: 15,
      stiffness: 150,
    });
    animatedValues.shares.value = withSpring(data.shares, {
      damping: 15,
      stiffness: 150,
    });
    animatedValues.views.value = withSpring(data.views, {
      damping: 15,
      stiffness: 150,
    });
    
    if (data.rating) {
      animatedValues.rating.value = withSpring(data.rating, {
        damping: 15,
        stiffness: 150,
      });
    }
  }, [data]);

  const formatNumber = (num: number) => {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
  };

  const AnimatedCounter = ({ value, suffix = '' }: { value: Animated.SharedValue<number>; suffix?: string }) => {
    const animatedStyle = useAnimatedStyle(() => {
      const displayValue = Math.round(value.value);
      return {
        // This will be handled by the text component
      };
    });

    return (
      <Animated.Text style={[styles.counterText, animatedStyle]}>
        {formatNumber(Math.round(value.value))}{suffix}
      </Animated.Text>
    );
  };

  const handleLike = () => {
    animatedValues.likeScale.value = withSpring(1.2, {
      damping: 10,
      stiffness: 200,
    }, () => {
      animatedValues.likeScale.value = withSpring(1);
    });
    
    onLike?.();
  };

  const handleSave = () => {
    animatedValues.saveScale.value = withSpring(1.2, {
      damping: 10,
      stiffness: 200,
    }, () => {
      animatedValues.saveScale.value = withSpring(1);
    });
    
    onSave?.();
  };

  const handleShare = () => {
    animatedValues.shareScale.value = withSpring(1.2, {
      damping: 10,
      stiffness: 200,
    }, () => {
      animatedValues.shareScale.value = withSpring(1);
    });
    
    onShare?.();
  };

  const LikeButton = () => {
    const animatedStyle = useAnimatedStyle(() => {
      return {
        transform: [{ scale: animatedValues.likeScale.value }],
      };
    });

    return (
      <Animated.View style={animatedStyle}>
        <TouchableOpacity
          style={[styles.actionButton, isLiked && styles.actionButtonActive]}
          onPress={handleLike}
          activeOpacity={0.8}
        >
          <Ionicons
            name={isLiked ? 'heart' : 'heart-outline'}
            size={20}
            color={isLiked ? colors.error[500] : colors.text.secondary}
          />
          <AnimatedCounter value={animatedValues.likes} />
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const SaveButton = () => {
    const animatedStyle = useAnimatedStyle(() => {
      return {
        transform: [{ scale: animatedValues.saveScale.value }],
      };
    });

    return (
      <Animated.View style={animatedStyle}>
        <TouchableOpacity
          style={[styles.actionButton, isSaved && styles.actionButtonActive]}
          onPress={handleSave}
          activeOpacity={0.8}
        >
          <Ionicons
            name={isSaved ? 'bookmark' : 'bookmark-outline'}
            size={20}
            color={isSaved ? colors.primary[500] : colors.text.secondary}
          />
          <AnimatedCounter value={animatedValues.saves} />
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const ShareButton = () => {
    const animatedStyle = useAnimatedStyle(() => {
      return {
        transform: [{ scale: animatedValues.shareScale.value }],
      };
    });

    return (
      <Animated.View style={animatedStyle}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={handleShare}
          activeOpacity={0.8}
        >
          <Ionicons
            name="share-outline"
            size={20}
            color={colors.text.secondary}
          />
          <AnimatedCounter value={animatedValues.shares} />
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const RatingDisplay = () => {
    if (!data.rating || !data.reviewCount) return null;

    const animatedStyle = useAnimatedStyle(() => {
      const progress = interpolate(
        animatedValues.rating.value,
        [0, 5],
        [0, 100],
        Extrapolate.CLAMP
      );

      return {
        width: `${progress}%`,
      };
    });

    return (
      <View style={styles.ratingContainer}>
        <View style={styles.ratingHeader}>
          <View style={styles.ratingStars}>
            {[1, 2, 3, 4, 5].map((star) => (
              <Ionicons
                key={star}
                name={star <= data.rating! ? 'star' : 'star-outline'}
                size={16}
                color={colors.warning[500]}
              />
            ))}
          </View>
          <Text style={styles.ratingValue}>
            {data.rating.toFixed(1)}
          </Text>
        </View>
        
        <View style={styles.ratingProgressContainer}>
          <View style={styles.ratingProgressBackground}>
            <Animated.View
              style={[
                styles.ratingProgressFill,
                animatedStyle,
              ]}
            />
          </View>
        </View>
        
        <Text style={styles.reviewCount}>
          {data.reviewCount} {data.reviewCount === 1 ? 'review' : 'reviews'}
        </Text>
      </View>
    );
  };

  const StatsGrid = () => {
    if (!showDetails) return null;

    const stats = [
      {
        label: 'Views',
        value: animatedValues.views,
        icon: 'eye' as const,
        color: colors.gray[500],
      },
      {
        label: 'Likes',
        value: animatedValues.likes,
        icon: 'heart' as const,
        color: colors.error[500],
      },
      {
        label: 'Saves',
        value: animatedValues.saves,
        icon: 'bookmark' as const,
        color: colors.primary[500],
      },
      {
        label: 'Shares',
        value: animatedValues.shares,
        icon: 'share' as const,
        color: colors.success[500],
      },
    ];

    return (
      <View style={styles.statsGrid}>
        {stats.map((stat, index) => (
          <View key={stat.label} style={styles.statItem}>
            <Ionicons
              name={stat.icon}
              size={16}
              color={stat.color}
            />
            <AnimatedCounter value={stat.value} />
            <Text style={styles.statLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Only show action buttons if callbacks are provided */}
      {(onLike || onSave || onShare) && (
        <View style={styles.actionsContainer}>
          {onLike && <LikeButton />}
          {onSave && <SaveButton />}
          {onShare && <ShareButton />}
        </View>
      )}

      <RatingDisplay />

      <StatsGrid />
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
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: spacing.lg,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.gray[50],
    minWidth: 80,
    justifyContent: 'center',
  },
  actionButtonActive: {
    backgroundColor: colors.primary[50],
  },
  counterText: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginLeft: spacing.xs,
  },
  ratingContainer: {
    marginBottom: spacing.lg,
  },
  ratingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  ratingStars: {
    flexDirection: 'row',
  },
  ratingValue: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  ratingProgressContainer: {
    marginBottom: spacing.sm,
  },
  ratingProgressBackground: {
    height: 4,
    backgroundColor: colors.gray[200],
    borderRadius: 2,
    overflow: 'hidden',
  },
  ratingProgressFill: {
    height: '100%',
    backgroundColor: colors.warning[500],
    borderRadius: 2,
  },
  reviewCount: {
    ...typography.xs,
    color: colors.text.secondary,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statLabel: {
    ...typography.xs,
    color: colors.text.secondary,
    marginTop: spacing.xs,
  },
});
