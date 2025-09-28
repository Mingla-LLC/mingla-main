import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';
import { RecommendationCard } from '../types';
import { SingleCardDisplay } from './SingleCardDisplay';
import { spacing, colors, radius, shadows } from '../constants/designSystem';

interface CardStackPreviewProps {
  currentCard: RecommendationCard;
  nextCard?: RecommendationCard;
  onLike: (card: RecommendationCard) => void;
  onDislike: (card: RecommendationCard) => void;
  onInvite: (card: RecommendationCard) => void;
  hasNext: boolean;
  cardNumber: number;
  totalCards: number;
  userTimePreference?: string;
  isAnimating?: boolean;
}

export const CardStackPreview: React.FC<CardStackPreviewProps> = ({
  currentCard,
  nextCard,
  onLike,
  onDislike,
  onInvite,
  hasNext,
  cardNumber,
  totalCards,
  userTimePreference,
  isAnimating = false,
}) => {
  const currentCardScale = useSharedValue(1);
  const currentCardTranslateY = useSharedValue(0);
  const nextCardScale = useSharedValue(0.95);
  const nextCardTranslateY = useSharedValue(20);
  const nextCardOpacity = useSharedValue(0.7);

  useEffect(() => {
    if (isAnimating) {
      // Animate current card out
      currentCardScale.value = withTiming(0.8, { duration: 200 });
      currentCardTranslateY.value = withTiming(-50, { duration: 200 });
      
      // Animate next card in
      nextCardScale.value = withSpring(1, { damping: 15, stiffness: 150 });
      nextCardTranslateY.value = withSpring(0, { damping: 15, stiffness: 150 });
      nextCardOpacity.value = withTiming(1, { duration: 200 });
    } else {
      // Reset to normal state
      currentCardScale.value = withSpring(1, { damping: 15, stiffness: 150 });
      currentCardTranslateY.value = withSpring(0, { damping: 15, stiffness: 150 });
      
      if (hasNext && nextCard) {
        nextCardScale.value = withSpring(0.95, { damping: 15, stiffness: 150 });
        nextCardTranslateY.value = withSpring(20, { damping: 15, stiffness: 150 });
        nextCardOpacity.value = withSpring(0.7, { damping: 15, stiffness: 150 });
      }
    }
  }, [isAnimating, hasNext, nextCard]);

  const currentCardStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { scale: currentCardScale.value },
        { translateY: currentCardTranslateY.value },
      ],
      zIndex: 2,
    };
  });

  const nextCardStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { scale: nextCardScale.value },
        { translateY: nextCardTranslateY.value },
      ],
      opacity: nextCardOpacity.value,
      zIndex: 1,
    };
  });

  return (
    <View style={styles.container}>
      {/* Next Card (Background) */}
      {hasNext && nextCard && (
        <Animated.View style={[styles.cardContainer, nextCardStyle]}>
          <View style={styles.nextCardWrapper}>
            <SingleCardDisplay
              card={nextCard}
              onLike={onLike}
              onDislike={onDislike}
              onInvite={onInvite}
              hasNext={false}
              cardNumber={cardNumber + 1}
              totalCards={totalCards}
              userTimePreference={userTimePreference}
            />
          </View>
        </Animated.View>
      )}

      {/* Current Card (Foreground) */}
      <Animated.View style={[styles.cardContainer, currentCardStyle]}>
        <SingleCardDisplay
          card={currentCard}
          onLike={onLike}
          onDislike={onDislike}
          onInvite={onInvite}
          hasNext={hasNext}
          cardNumber={cardNumber}
          totalCards={totalCards}
          userTimePreference={userTimePreference}
        />
      </Animated.View>

    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  cardContainer: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  nextCardWrapper: {
    flex: 1,
    margin: spacing.md,
    marginBottom: 0,
    borderRadius: radius.xl,
    overflow: 'hidden',
    ...shadows.md,
  },
});
