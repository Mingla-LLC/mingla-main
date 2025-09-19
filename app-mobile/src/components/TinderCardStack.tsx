import React, { useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  RefreshControl,
} from 'react-native';
import { SwipeableExperienceCard } from './SwipeableExperienceCard';
import { Experience } from '../types';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

interface TinderCardStackProps {
  experiences: Experience[];
  onExperienceSelect: (experience: Experience) => void;
  onAllExperiencesSwiped: () => void;
  onRefresh: () => void;
  refreshing?: boolean;
}

export const TinderCardStack: React.FC<TinderCardStackProps> = ({
  experiences,
  onExperienceSelect,
  onAllExperiencesSwiped,
  onRefresh,
  refreshing = false,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [swipedExperiences, setSwipedExperiences] = useState<Set<string>>(new Set());

  const handleSwipeLeft = () => {
    const currentExperience = experiences[currentIndex];
    if (currentExperience) {
      setSwipedExperiences(prev => new Set([...prev, currentExperience.id]));
      setCurrentIndex(prev => prev + 1);
      
      // Check if all experiences have been swiped
      if (currentIndex + 1 >= experiences.length) {
        onAllExperiencesSwiped();
      }
    }
  };

  const handleSwipeRight = () => {
    const currentExperience = experiences[currentIndex];
    if (currentExperience) {
      setSwipedExperiences(prev => new Set([...prev, currentExperience.id]));
      setCurrentIndex(prev => prev + 1);
      
      // Check if all experiences have been swiped
      if (currentIndex + 1 >= experiences.length) {
        onAllExperiencesSwiped();
      }
    }
  };

  const handleExperiencePress = (experience: Experience) => {
    onExperienceSelect(experience);
  };

  if (experiences.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      </View>
    );
  }

  // Show up to 3 cards at once (current + 2 next)
  const visibleCards = experiences.slice(currentIndex, currentIndex + 3);
  const remainingCount = experiences.length - currentIndex;

  return (
    <View style={styles.container}>
      {visibleCards.map((experience, index) => {
        const isCurrentCard = index === 0;
        const cardIndex = currentIndex + index;
        
        return (
          <SwipeableExperienceCard
            key={experience.id}
            experience={experience}
            onSwipeLeft={handleSwipeLeft}
            onSwipeRight={handleSwipeRight}
            onPress={() => handleExperiencePress(experience)}
            index={cardIndex}
            total={experiences.length}
          />
        );
      })}
      
      {remainingCount === 0 && (
        <View style={styles.endMessage}>
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    paddingBottom: 120, // Space for action buttons and instruction text
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  endMessage: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
