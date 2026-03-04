import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Linking,
  Alert,
  ScrollView,
  Dimensions,
  Animated,
} from 'react-native';
import { PanGestureHandler, State } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { RecommendationCard } from '../types';
import { useHapticFeedback } from '../utils/hapticFeedback';
import { spacing, colors, typography, fontWeights, radius, shadows } from '../constants/designSystem';
import { ConfidenceScore } from './ConfidenceScore';
import { PopularityIndicators } from './PopularityIndicators';
import { userInteractionService } from '../services/userInteractionService';
import { formatToOneDecimal } from '../utils/numberFormatter';
import { getReadableCategoryName } from '../utils/categoryUtils';
import { useLocalePreferences } from '../hooks/useLocalePreferences';
import { formatCurrency } from './utils/formatters';

interface SingleCardDisplayProps {
  card: RecommendationCard;
  onLike: (card: RecommendationCard) => void;
  onDislike: (card: RecommendationCard) => void;
  onInvite: (card: RecommendationCard) => void;
  hasNext: boolean;
  cardNumber: number;
  totalCards: number;
  userTimePreference?: string;
  specificTime?: string;
}

export const SingleCardDisplay: React.FC<SingleCardDisplayProps> = ({
  card,
  onLike,
  onDislike,
  onInvite,
  hasNext,
  cardNumber,
  totalCards,
  userTimePreference,
  specificTime
}) => {
  const { currency } = useLocalePreferences();
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [viewStartTime, setViewStartTime] = useState<number>(Date.now());
  const [trackViewEnd, setTrackViewEnd] = useState<(() => void) | null>(null);
  
  // Haptic feedback
  const haptic = useHapticFeedback();
  
  // Swipe animation values
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  
  
  // Get screen dimensions for responsive design
  const screenHeight = Dimensions.get('window').height;
  const screenWidth = Dimensions.get('window').width;
  
  // Calculate responsive values based on screen size
  const isSmallScreen = screenHeight < 700;
  const isLargeScreen = screenHeight > 900;
  
  // Dynamic padding and sizing
  const contentPadding = isSmallScreen ? 16 : 24;
  const actionButtonHeight = isSmallScreen ? 45 : 50;
  const titleFontSize = isSmallScreen ? 20 : 22;
  const subtitleFontSize = isSmallScreen ? 13 : 14;

  // Reset overlay state when card changes and track view
  useEffect(() => {
    setSwipeDirection(null);
    setIsAnimating(false);
    setViewStartTime(Date.now());
    
    // Reset animation values
    translateX.setValue(0);
    translateY.setValue(0);
    rotate.setValue(0);
    scale.setValue(1);

    // Track card view
    const trackView = async () => {
      const endTrackView = await userInteractionService.trackCardView(card.id, card, Date.now());
      setTrackViewEnd(() => endTrackView);
    };
    
    trackView();

    // Cleanup: end view tracking when card changes
    return () => {
      if (trackViewEnd) {
        trackViewEnd();
      }
    };
  }, [card.id]);

  const handleImageLoad = () => {
    setImageLoaded(true);
  };

  const handleImageError = () => {
    setImageFailed(true);
    setImageLoaded(true);
  };

  // Swipe gesture handlers
  const handleSwipeGesture = (event: any) => {
    const { translationX, translationY, velocityX, velocityY } = event.nativeEvent;
    
    // Calculate rotation based on horizontal movement
    const rotationValue = translationX / 10;
    rotate.setValue(rotationValue);
    
    // Update position
    translateX.setValue(translationX);
    translateY.setValue(translationY);
    
    // Add slight scale effect during swipe
    const scaleValue = 1 - Math.abs(translationX) / 1000;
    scale.setValue(Math.max(0.95, scaleValue));
    
    // Show visual feedback for swipe direction and haptic
    if (translationX > 50 && swipeDirection !== 'right') {
      setSwipeDirection('right');
      haptic.cardSwipe();
    } else if (translationX < -50 && swipeDirection !== 'left') {
      setSwipeDirection('left');
      haptic.cardSwipe();
    } else if (Math.abs(translationX) <= 50 && swipeDirection !== null) {
      setSwipeDirection(null);
    }
  };

  const handleSwipeEnd = (event: any) => {
    const { translationX, translationY, velocityX, velocityY } = event.nativeEvent;
    
    // Reset swipe direction
    setSwipeDirection(null);
    
    // Determine if it's a valid swipe based on distance and velocity
    const swipeThreshold = screenWidth * 0.3; // 30% of screen width
    const velocityThreshold = 500;
    
    const isSwipeRight = translationX > swipeThreshold || velocityX > velocityThreshold;
    const isSwipeLeft = translationX < -swipeThreshold || velocityX < -velocityThreshold;
    
    if (isSwipeRight) {
      // Swipe right = Like
      userInteractionService.trackSwipe(card.id, 'right', card, { velocity: velocityX, distance: translationX });
      animateSwipeOut('right', () => onLike(card));
    } else if (isSwipeLeft) {
      // Swipe left = Dislike
      userInteractionService.trackSwipe(card.id, 'left', card, { velocity: velocityX, distance: translationX });
      animateSwipeOut('left', () => onDislike(card));
    } else {
      // Return to center
      animateReturnToCenter();
    }
  };

  const animateSwipeOut = (direction: 'left' | 'right', callback: () => void) => {
    const exitX = direction === 'right' ? screenWidth : -screenWidth;
    const rotationValue = direction === 'right' ? 30 : -30;
    
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: exitX,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: -50,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(rotate, {
        toValue: rotationValue,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 0.8,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      callback();
      // Reset values for next card
      translateX.setValue(0);
      translateY.setValue(0);
      rotate.setValue(0);
      scale.setValue(1);
    });
  };

  const animateReturnToCenter = () => {
    Animated.parallel([
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }),
      Animated.spring(rotate, {
        toValue: 0,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }),
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }),
    ]).start();
  };

  // Button-triggered animations that match swipe behavior
  const handleButtonLike = () => {
    if (isAnimating) return;
    setIsAnimating(true);
    setSwipeDirection('right');
    
    // Haptic feedback
    haptic.cardLike();
    
    
    // Small delay to show button press feedback
    setTimeout(() => {
      animateSwipeOut('right', () => {
        onLike(card);
        setIsAnimating(false);
      });
    }, 50);
  };

  const handleButtonDislike = () => {
    if (isAnimating) return;
    setIsAnimating(true);
    setSwipeDirection('left');
    
    // Haptic feedback
    haptic.cardDislike();
    
    
    // Small delay to show button press feedback
    setTimeout(() => {
      animateSwipeOut('left', () => {
        onDislike(card);
        setIsAnimating(false);
      });
    }, 50);
  };

  const handleViewRoute = async () => {
    try {
      const supported = await Linking.canOpenURL(card.route.mapsDeepLink);
      if (supported) {
        await Linking.openURL(card.route.mapsDeepLink);
      } else {
        Alert.alert('Error', 'Cannot open maps app');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to open maps');
    }
  };

  // Price level indicators
  const getPriceDisplay = (level: number) => {
    const symbols = ['$', '$$', '$$$', '$$$$', '$$$$$'];
    return symbols[level - 1] || '$';
  };


  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  };

  return (
    <View style={styles.container}>
      <PanGestureHandler
        onGestureEvent={handleSwipeGesture}
        onHandlerStateChange={(event) => {
          if (event.nativeEvent.state === State.END) {
            handleSwipeEnd(event);
          }
        }}
      >
        <Animated.View 
          style={[
            styles.card,
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
        >
        {/* Card Counter */}
        <View style={styles.counterContainer}>
          <Text style={styles.counterText}>
            {cardNumber} of {totalCards}
          </Text>
        </View>

        {/* Swipe Feedback Overlays */}
        {swipeDirection && (
          <View style={[
            styles.swipeOverlay,
            swipeDirection === 'right' ? styles.swipeOverlayRight : styles.swipeOverlayLeft
          ]}>
            <View style={[
              styles.swipeIndicator,
              swipeDirection === 'right' ? styles.swipeIndicatorRight : styles.swipeIndicatorLeft
            ]}>
              <Ionicons 
                name={swipeDirection === 'right' ? 'heart' : 'close'} 
                size={isAnimating ? 32 : 48} 
                color={swipeDirection === 'right' ? '#10B981' : '#EF4444'} 
              />
              <Text style={[
                styles.swipeText,
                swipeDirection === 'right' ? styles.swipeTextRight : styles.swipeTextLeft,
                isAnimating && styles.swipeTextSmall
              ]}>
                {swipeDirection === 'right' ? 'LIKE' : 'PASS'}
              </Text>
            </View>
          </View>
        )}

        {/* Image Section */}
        <View style={styles.imageContainer}>
          {!imageLoaded && !imageFailed && (
            <View style={styles.imagePlaceholder} />
          )}
          
          {!imageFailed ? (
            <Image
              source={{ uri: card.imageUrl }}
              style={[styles.image, { opacity: imageLoaded ? 1 : 0 }]}
              onLoad={handleImageLoad}
              onError={handleImageError}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.imageFallback}>
              <Ionicons name="location-outline" size={48} color="#9CA3AF" />
            </View>
          )}

          {/* Overlays */}
          <View style={styles.overlayTop}>
          </View>

          {/* Rating */}
          {card.rating && (
            <View style={styles.ratingContainer}>
              <Ionicons name="star" size={12} color="#FCD34D" />
              <Text style={styles.ratingText}>{formatToOneDecimal(card.rating)}</Text>
            </View>
          )}

          {/* Travel Info Overlay */}
          <View style={styles.travelInfoContainer}>
            <Ionicons name="navigate-outline" size={12} color="white" />
            <Text style={styles.travelInfoText}>
              {card.route.etaMinutes}m • {card.route.distanceText}
            </Text>
          </View>
        </View>

        <ScrollView 
          style={styles.content}
          contentContainerStyle={[
            styles.contentContainer,
            {
              padding: contentPadding,
              paddingBottom: actionButtonHeight + 40, // Dynamic padding for action buttons
            }
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Title and Subtitle */}
          <View style={styles.titleSection}>
            <Text style={[styles.title, { fontSize: titleFontSize }]}>{card.title}</Text>
            <Text style={[styles.subtitle, { fontSize: subtitleFontSize }]}>{card.subtitle}</Text>
          </View>

          {/* LLM Generated Copy */}
          <View style={styles.copySection}>
            <Text style={styles.oneLiner}>{card.copy.oneLiner}</Text>
            <View style={styles.tipContainer}>
              <Ionicons name="chatbubble-outline" size={16} color="#6B7280" />
              <Text style={styles.tipText}>{card.copy.tip}</Text>
            </View>
          </View>

          {/* Expandable Details */}
          <TouchableOpacity
            style={styles.expandButton}
            onPress={() => setIsExpanded(!isExpanded)}
          >
            <Text style={styles.expandButtonText}>View Details</Text>
            <Ionicons
              name={isExpanded ? "chevron-up" : "chevron-down"}
              size={16}
              color="#6B7280"
            />
          </TouchableOpacity>

          {isExpanded && (
            <View style={styles.expandedContent}>
              {/* Confidence Score */}
              <ConfidenceScore
                score={Math.floor(Math.random() * 40) + 60} // Mock confidence score 60-100
                factors={{
                  locationMatch: Math.floor(Math.random() * 30) + 70,
                  budgetMatch: Math.floor(Math.random() * 30) + 70,
                  categoryMatch: Math.floor(Math.random() * 30) + 70,
                  timeMatch: Math.floor(Math.random() * 30) + 70,
                  popularity: Math.floor(Math.random() * 30) + 70,
                }}
                showDetails={true}
                size="medium"
              />

              {/* Popularity Indicators */}
              <PopularityIndicators
                data={{
                  likes: Math.floor(Math.random() * 500) + 100,
                  saves: Math.floor(Math.random() * 200) + 50,
                  shares: Math.floor(Math.random() * 100) + 20,
                  views: Math.floor(Math.random() * 2000) + 500,
                  rating: 4.0 + Math.random() * 1.0,
                  reviewCount: Math.floor(Math.random() * 200) + 50,
                }}
                showDetails={true}
              />

              {/* Metadata Grid */}
              <View style={styles.metadataGrid}>
                <View style={styles.metadataItem}>
                  <Ionicons name="time-outline" size={16} color="#6B7280" />
                  <Text style={styles.metadataText}>{formatDuration(card.durationMinutes)}</Text>
                </View>
                <View style={styles.metadataItem}>
                  <Ionicons name="cash-outline" size={16} color="#6B7280" />
                  <Text style={styles.metadataText}>{formatCurrency(Number(card.estimatedCostPerPerson) || 0, currency)}/person</Text>
                </View>
              </View>

              {/* Address */}
              <View style={styles.addressContainer}>
                <Ionicons name="location-outline" size={16} color="#6B7280" />
                <Text style={styles.addressText}>{card.address}</Text>
              </View>

              {/* View Route Button */}
              <TouchableOpacity style={styles.routeButton} onPress={handleViewRoute}>
                <Ionicons name="open-outline" size={16} color="#FF6B35" />
                <Text style={styles.routeButtonText}>Open in Maps</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>

        {/* Next Card Hint */}
        {hasNext && (
          <View style={styles.hintContainer}>
            <Text style={styles.nextHint}>
              Swipe to see the next recommendation
            </Text>
          </View>
        )}
        </Animated.View>
      </PanGestureHandler>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  card: {
    flex: 1,
    backgroundColor: 'white',
    overflow: 'hidden',
    maxHeight: '100%',
    marginBottom: 0,
  },
  counterContainer: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 8,
  },
  counterText: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '500',
  },
  imageContainer: {
    position: 'relative',
    aspectRatio: 4/3,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#F3F4F6',
  },
  imagePlaceholder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#E5E7EB',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageFallback: {
    width: '100%',
    height: '100%',
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayTop: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    gap: 8,
  },
  ratingContainer: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'white',
  },
  travelInfoContainer: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  travelInfoText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'white',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    flexGrow: 1,
  },
  titleSection: {
    marginBottom: 12,
  },
  title: {
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 6,
    lineHeight: 26,
  },
  subtitle: {
    color: '#6B7280',
    lineHeight: 18,
  },
  copySection: {
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  oneLiner: {
    fontSize: 15,
    color: '#1F2937',
    lineHeight: 22,
    marginBottom: 8,
  },
  tipContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  tipText: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
    flex: 1,
  },
  expandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    marginBottom: 12,
  },
  expandButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
  },
  expandedContent: {
    marginBottom: 16,
  },
  metadataGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  metadataItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
    flex: 1,
    minWidth: '45%',
  },
  metadataText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  addressContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F3F4F6',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    gap: 8,
  },
  addressText: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 16,
    flex: 1,
  },
  routeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EBF8FF',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FF6B35',
    gap: 8,
  },
  routeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FF6B35',
  },
  hintContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 8,
    backgroundColor: 'white',
  },
  nextHint: {
    textAlign: 'center',
    fontSize: 11,
    color: '#6B7280',
    marginTop: 6,
    paddingTop: 4,
  },
  // Swipe feedback styles
  swipeOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
    justifyContent: 'center',
    alignItems: 'center',
    pointerEvents: 'none', // Allow touch events to pass through when not actively swiping
  },
  swipeOverlayRight: {
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
  },
  swipeOverlayLeft: {
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
  },
  swipeIndicator: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    borderRadius: 20,
    borderWidth: 4,
  },
  swipeIndicatorRight: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: '#10B981',
  },
  swipeIndicatorLeft: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: '#EF4444',
  },
  swipeText: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 8,
  },
  swipeTextRight: {
    color: '#10B981',
  },
  swipeTextLeft: {
    color: '#EF4444',
  },
  swipeTextSmall: {
    fontSize: 18,
  },
  // Button pressed state during animation
  buttonPressed: {
    transform: [{ scale: 0.95 }],
    opacity: 0.8,
  },
});
