import React from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated,
} from 'react-native';
import { PanGestureHandler, State } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { Experience } from '../types';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const CARD_WIDTH = screenWidth * 0.9;
// Make card height more responsive - balance between size and fit
const CARD_HEIGHT = Math.min(screenHeight * 0.65, 500);

interface SwipeableExperienceCardProps {
  experience: Experience;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  onPress: () => void;
  index: number;
  total: number;
}

export const SwipeableExperienceCard: React.FC<SwipeableExperienceCardProps> = ({
  experience,
  onSwipeLeft,
  onSwipeRight,
  onPress,
  index,
  total,
}) => {
  const translateX = new Animated.Value(0);
  const translateY = new Animated.Value(0);
  const rotate = new Animated.Value(0);
  const scale = new Animated.Value(1);

  const onGestureEvent = Animated.event(
    [{ nativeEvent: { translationX: translateX, translationY: translateY } }],
    { useNativeDriver: true }
  );

  const onHandlerStateChange = (event: any) => {
    if (event.nativeEvent.state === State.END) {
      const { translationX, translationY, velocityX } = event.nativeEvent;
      
      // Determine if swipe is strong enough
      const isSwipeLeft = translationX < -100 || velocityX < -500;
      const isSwipeRight = translationX > 100 || velocityX > 500;
      
      if (isSwipeLeft) {
        // Animate card off screen to the left
        Animated.parallel([
          Animated.timing(translateX, {
            toValue: -screenWidth,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(rotate, {
            toValue: -30,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start(() => {
          onSwipeLeft();
        });
      } else if (isSwipeRight) {
        // Animate card off screen to the right
        Animated.parallel([
          Animated.timing(translateX, {
            toValue: screenWidth,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(rotate, {
            toValue: 30,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start(() => {
          onSwipeRight();
        });
      } else {
        // Snap back to center
        Animated.parallel([
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
          }),
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }),
          Animated.spring(rotate, {
            toValue: 0,
            useNativeDriver: true,
          }),
        ]).start();
      }
    }
  };

  const rotateInterpolate = rotate.interpolate({
    inputRange: [-30, 0, 30],
    outputRange: ['-30deg', '0deg', '30deg'],
  });

  const getCategoryColor = (category: string) => {
    switch (category.toLowerCase()) {
      case 'stroll':
        return '#34C759';
      case 'sip & chill':
      case 'sip':
        return '#FF9500';
      case 'casual eats':
        return '#FF3B30';
      case 'screen & relax':
        return '#007AFF';
      case 'creative':
        return '#AF52DE';
      case 'play & move':
        return '#FF2D92';
      case 'dining':
        return '#FF6B6B';
      default:
        return '#8E8E93';
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category.toLowerCase()) {
      case 'stroll':
        return 'walk';
      case 'sip & chill':
      case 'sip':
        return 'cafe';
      case 'casual eats':
        return 'restaurant';
      case 'screen & relax':
        return 'tv';
      case 'creative':
        return 'brush';
      case 'play & move':
        return 'fitness';
      case 'dining':
        return 'wine';
      default:
        return 'star';
    }
  };

  return (
    <PanGestureHandler
      onGestureEvent={onGestureEvent}
      onHandlerStateChange={onHandlerStateChange}
    >
      <Animated.View
        style={[
          styles.card,
          {
            transform: [
              { translateX },
              { translateY },
              { rotate: rotateInterpolate },
              { scale },
            ],
          },
        ]}
      >
        <TouchableOpacity style={styles.cardContent} onPress={onPress} activeOpacity={0.9}>
          {/* Card Counter */}
          <View style={styles.cardCounter}>
            <Text style={styles.counterText}>{index + 1} of {total}</Text>
          </View>

          {/* Image */}
          <View style={styles.imageContainer}>
            <Image source={{ uri: experience.image_url }} style={styles.image} />
            
            {/* Category Badge */}
            <View style={[styles.categoryBadge, { backgroundColor: getCategoryColor(experience.category) }]}>
              <Ionicons name={getCategoryIcon(experience.category) as any} size={12} color="white" />
              <Text style={styles.categoryText}>{experience.category}</Text>
            </View>

            {/* Rating Badge */}
            <View style={styles.ratingBadge}>
              <Ionicons name="star" size={12} color="#FFD700" />
              <Text style={styles.ratingText}>4.8</Text>
            </View>

            {/* Distance Badge */}
            <View style={styles.distanceBadge}>
              <Ionicons name="paper-plane" size={12} color="white" />
              <Text style={styles.distanceText}>5.8 km</Text>
            </View>
          </View>

          {/* Content */}
          <View style={styles.content}>
            <Text style={styles.title}>{experience.title}</Text>
            <Text style={styles.subtitle}>
              {experience.category} · ${experience.price_min || 0} · 8 min driving
            </Text>

            {/* Description Box */}
            <View style={styles.descriptionBox}>
              <Text style={styles.descriptionText}>
                Handpicked {experience.category.toLowerCase()} experience at {experience.title}
              </Text>
              <View style={styles.curatedRow}>
                <Ionicons name="chatbubble" size={14} color="#666" />
                <Text style={styles.curatedText}>
                  Curated for your 25-150 budget and preferences.
                </Text>
              </View>
            </View>

            {/* View Details */}
            <TouchableOpacity style={styles.viewDetails}>
              <Text style={styles.viewDetailsText}>View Details</Text>
              <Ionicons name="chevron-down" size={16} color="#007AFF" />
            </TouchableOpacity>
          </View>

        </TouchableOpacity>

        {/* Action Buttons - Outside the card */}
        <View style={styles.actionButtonsContainer}>
          <TouchableOpacity 
            style={[styles.actionButton, styles.dislikeButton]} 
            onPress={onSwipeLeft}
          >
            <Ionicons name="close" size={24} color="#FF3B30" />
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.actionButton, styles.likeButton]} 
            onPress={onSwipeRight}
          >
            <Ionicons name="heart" size={24} color="#34C759" />
          </TouchableOpacity>
        </View>

        {/* Instruction Text - Outside the card */}
        <Text style={styles.instructionText}>
          Tap ❤️ or X to see the next recommendation
        </Text>
      </Animated.View>
    </PanGestureHandler>
  );
};

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: 'white',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
    position: 'absolute',
  },
  cardContent: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
  },
  cardCounter: {
    position: 'absolute',
    top: 16,
    left: 16,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  counterText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  imageContainer: {
    height: '55%',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  categoryBadge: {
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  categoryText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  ratingBadge: {
    position: 'absolute',
    top: 50,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  ratingText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  distanceBadge: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  distanceText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  content: {
    flex: 1,
    padding: 18,
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 6,
    lineHeight: 28,
  },
  subtitle: {
    fontSize: 15,
    color: '#666',
    marginBottom: 14,
    lineHeight: 20,
  },
  descriptionBox: {
    backgroundColor: '#F8F9FA',
    padding: 14,
    borderRadius: 12,
    marginBottom: 14,
  },
  descriptionText: {
    fontSize: 13,
    color: '#1a1a1a',
    marginBottom: 8,
    lineHeight: 18,
  },
  curatedRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  curatedText: {
    fontSize: 12,
    color: '#666',
    marginLeft: 6,
  },
  viewDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  viewDetailsText: {
    fontSize: 14,
    color: '#007AFF',
    marginRight: 4,
  },
  actionButtonsContainer: {
    position: 'absolute',
    bottom: -50,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 40,
    paddingVertical: 12,
    backgroundColor: 'transparent',
  },
  actionButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  dislikeButton: {
    borderColor: '#FF3B30',
    backgroundColor: 'white',
  },
  likeButton: {
    borderColor: '#34C759',
    backgroundColor: 'white',
  },
  instructionText: {
    position: 'absolute',
    bottom: -80,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 12,
    color: '#666',
    marginTop: 8,
  },
});
