import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  Animated,
  PanResponder,
} from 'react-native';
import { Icon } from './ui/Icon';
import { getReadableCategoryName, getCategoryIcon, getCategoryColor } from '../utils/categoryUtils';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

interface DetailedExperienceCardProps {
  experience: {
    id: string;
    title: string;
    category: string;
    description?: string;
    price_min: number;
    price_max: number;
    duration_min: number;
    image_url?: string;
    lat?: number;
    lng?: number;
    meta?: {
      rating?: number;
      reviews?: number;
    };
    copy?: {
      oneLiner: string;
      tip: string;
    };
  };
  currentImageIndex?: number;
  totalImages?: number;
  currentCardIndex?: number;
  totalCards?: number;
  onLike: () => void;
  onDislike: () => void;
  onViewDetails: () => void;
}

export const DetailedExperienceCard: React.FC<DetailedExperienceCardProps> = ({
  experience,
  currentImageIndex = 3,
  totalImages = 25,
  currentCardIndex = 1,
  totalCards = 10,
  onLike,
  onDislike,
  onViewDetails,
}) => {
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5;
      },
      onPanResponderGrant: () => {
        translateX.setOffset(0);
        translateY.setOffset(0);
        translateX.setValue(0);
        translateY.setValue(0);
      },
      onPanResponderMove: (_, gestureState) => {
        translateX.setValue(gestureState.dx);
        translateY.setValue(gestureState.dy);
        
        // Add rotation based on horizontal movement
        const rotation = gestureState.dx / 10;
        rotate.setValue(rotation);
        
        // Add scale effect
        const distance = Math.sqrt(gestureState.dx * gestureState.dx + gestureState.dy * gestureState.dy);
        const scaleValue = Math.max(0.95, 1 - distance / 1000);
        scale.setValue(scaleValue);
      },
      onPanResponderRelease: (_, gestureState) => {
        translateX.flattenOffset();
        translateY.flattenOffset();
        
        const { dx, dy } = gestureState;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        
        // Determine if it's a swipe (more horizontal than vertical movement)
        if (absDx > absDy && absDx > 50) {
          // Horizontal swipe
          if (dx > 0) {
            // Swipe right - like
            animateCardOut('right', onLike);
          } else {
            // Swipe left - dislike
            animateCardOut('left', onDislike);
          }
        } else if (absDy > absDx && absDy > 50) {
          // Vertical swipe down - view details
          if (dy > 0) {
            onViewDetails();
            resetCardPosition();
          } else {
            resetCardPosition();
          }
        } else {
          // Not enough movement, reset position
          resetCardPosition();
        }
      },
    })
  ).current;

  const animateCardOut = (direction: 'left' | 'right', callback: () => void) => {
    const toValue = direction === 'right' ? screenWidth : -screenWidth;
    
    Animated.parallel([
      Animated.timing(translateX, {
        toValue,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(rotate, {
        toValue: direction === 'right' ? 30 : -30,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 0.8,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Call the callback to move to next card, but don't reset position
      // The parent component will handle showing the next card
      callback();
    });
  };

  const resetCardPosition = () => {
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
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start();
  };
  const formatPrice = (min: number, max: number) => {
    if (min === 0 && max === 0) return 'Free';
    if (min === max) return `$${min}`;
    return `$${min}-${max}`;
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (remainingMinutes === 0) return `${hours}h`;
    return `${hours}h ${remainingMinutes}m`;
  };

  const getCategoryColor = (category: string) => {
    switch (category.toLowerCase()) {
      case 'dining':
        return '#FF3B30';
      case 'stroll':
        return '#34C759';
      case 'sip':
        return '#FF9500';
      case 'creative':
        return '#AF52DE';
      case 'play_move':
        return '#FF6B35';
      default:
        return '#FF3B30';
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category.toLowerCase()) {
      case 'dining':
        return 'wine';
      case 'stroll':
        return 'walk';
      case 'sip':
        return 'cafe';
      case 'creative':
        return 'brush';
      case 'play_move':
        return 'fitness';
      default:
        return 'star';
    }
  };

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [
            { translateX },
            { translateY },
            { rotate: rotate.interpolate({
              inputRange: [-30, 0, 30],
              outputRange: ['-30deg', '0deg', '30deg'],
            }) },
            { scale },
          ],
        },
      ]}
      {...panResponder.panHandlers}
    >
      {/* Image Section */}
      <View style={styles.imageContainer}>
        <Image
          source={{ uri: experience.image_url || 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0' }}
          style={styles.image}
          resizeMode="cover"
        />
        
        {/* Image Gallery Indicator */}
        <View style={styles.imageGalleryIndicator}>
          <Text style={styles.imageGalleryText}>{currentCardIndex} of {totalCards}</Text>
        </View>


        {/* Rating Badge */}
        <View style={styles.ratingBadge}>
          <Icon name="star" size={12} color="#FFD700" />
          <Text style={styles.ratingText}>{experience.meta?.rating || 4.8}</Text>
        </View>

        {/* Distance Badge */}
        <View style={styles.distanceBadge}>
          <Icon name="paper-plane" size={12} color="white" />
          <Text style={styles.distanceText}>5.8 km</Text>
        </View>
      </View>

      {/* Content Section */}
      <View style={styles.content}>
        {/* Title and Subtitle */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>{experience.title}</Text>
          <Text style={styles.subtitle}>
            {getReadableCategoryName(experience.category)} · {formatPrice(experience.price_min, experience.price_max)} · {formatDuration(experience.duration_min)} driving
          </Text>
        </View>

        {/* Description Box */}
        <View style={styles.descriptionBox}>
          <Text style={styles.descriptionText}>
            {experience.copy?.oneLiner || `Handpicked ${getReadableCategoryName(experience.category).toLowerCase()} experience at ${experience.title}.`}
          </Text>
          <View style={styles.curationInfo}>
            <Icon name="chatbubble" size={14} color="#666" />
            <Text style={styles.curationText}>
              {experience.copy?.tip || 'Curated for your 25-150 budget and preferences'}
            </Text>
          </View>
        </View>

        {/* View Details Link */}
        <TouchableOpacity style={styles.viewDetailsButton} onPress={onViewDetails}>
          <Text style={styles.viewDetailsText}>View Details</Text>
          <Icon name="chevron-down" size={16} color="#FF6B35" />
        </TouchableOpacity>
      </View>

    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: 16,
    overflow: 'hidden',
  },
  imageContainer: {
    height: '60%',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageGalleryIndicator: {
    position: 'absolute',
    top: 16,
    left: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  imageGalleryText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  ratingBadge: {
    position: 'absolute',
    top: 50,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  ratingText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  distanceBadge: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  distanceText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    padding: 20,
    justifyContent: 'space-between',
  },
  titleSection: {
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  descriptionBox: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  descriptionText: {
    fontSize: 16,
    color: '#1a1a1a',
    marginBottom: 8,
    lineHeight: 22,
  },
  curationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  curationText: {
    fontSize: 14,
    color: '#666',
    flex: 1,
  },
  viewDetailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  viewDetailsText: {
    fontSize: 16,
    color: '#FF6B35',
    fontWeight: '600',
  },
});
