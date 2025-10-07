import React, { useState, useRef, useEffect } from 'react';
import { Text, View, TouchableOpacity, Image, StyleSheet, Dimensions, Animated, PanResponder, SafeAreaView, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { formatCurrency, formatDistance } from './utils/formatters';
import { ExperiencesService, Experience } from '../services/experiencesService';
import { useAuthSimple } from '../hooks/useAuthSimple';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

interface Recommendation {
  id: string;
  title: string;
  category: string;
  categoryIcon: string;
  timeAway: string;
  description: string;
  budget: string;
  rating: number;
  image: string;
  images: string[];
  priceRange: string;
  distance: string;
  travelTime: string;
  experienceType: string;
  highlights: string[];
  fullDescription: string;
  address: string;
  openingHours: string;
  tags: string[];
  matchScore: number;
  reviewCount: number;
  socialStats: {
    views: number;
    likes: number;
    saves: number;
    shares: number;
  };
  matchFactors: {
    location: number;
    budget: number;
    category: number;
    time: number;
    popularity: number;
  };
}

interface SwipeableCardsProps {
  userPreferences?: any;
  currentMode?: string;
  onCardLike?: (card: any) => void;
  accountPreferences?: {
    currency: string;
    measurementSystem: 'Metric' | 'Imperial';
  };
  onAddToCalendar?: (experienceData: any) => void;
  onShareCard?: (card: any) => void;
  onPurchaseComplete?: (experienceData: any, purchaseOption: any) => void;
  removedCardIds?: string[];
  onResetCards?: () => void;
  generateNewMockCard?: () => any;
  onboardingData?: any;
}

// Real data will be fetched from Supabase

const getIconComponent = (iconName: string) => {
  const iconMap: {[key: string]: string} = {
    'Coffee': 'cafe',
    'TreePine': 'leaf',
    'Sparkles': 'sparkles',
    'Dumbbell': 'fitness',
    'Utensils': 'restaurant',
    'Eye': 'eye',
    'Heart': 'heart',
    'Calendar': 'calendar',
    'MapPin': 'location',
    'Clock': 'time',
    'Star': 'star',
    'Navigation': 'navigate',
    'Palette': 'color-palette',
    'Bookmark': 'bookmark'
  };
  
  return iconMap[iconName] || 'heart';
};

export default function SwipeableCards({ 
  userPreferences, 
  currentMode = 'solo', 
  onCardLike, 
  accountPreferences, 
  onAddToCalendar, 
  onShareCard, 
  onPurchaseComplete, 
  removedCardIds = [], 
  onResetCards,
  generateNewMockCard, 
  onboardingData 
}: SwipeableCardsProps) {
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [removedCards, setRemovedCards] = useState<Set<string>>(new Set());
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);
  const [touchStart, setTouchStart] = useState({ x: 0, y: 0 });
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { user } = useAuthSimple();

  // Fetch real data from Supabase
  useEffect(() => {
    const fetchRecommendations = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Get user preferences if available
        let userPrefs = null;
        if (user?.id) {
          try {
            userPrefs = await ExperiencesService.getUserPreferences(user.id);
            console.log('User preferences loaded:', userPrefs);
          } catch (error) {
            console.error('Error loading user preferences:', error);
            // Continue without preferences - app will use defaults
            console.log('Using default preferences due to error');
          }
        } else {
          console.log('No user authenticated - using default behavior');
        }
        
        // Fetch experiences from Supabase
        let experiences = [];
        try {
          experiences = await ExperiencesService.getExperiences();
          console.log('Fetched experiences from Supabase:', experiences.length);
        } catch (error) {
          console.error('Error fetching experiences from Supabase:', error);
          setError('Unable to load experiences. Please check your connection and try again.');
          return;
        }
        
        if (experiences.length === 0) {
          console.warn('No experiences found in database');
          setError('No experiences available. Please check back later.');
          return;
        }
        
        // Transform experiences to recommendation format
        const transformedRecommendations = experiences.map(exp => 
          ExperiencesService.transformExperience(exp)
        );
        
        console.log('Transformed recommendations:', transformedRecommendations.length);
        setRecommendations(transformedRecommendations);
        
        // Track view interaction for the first card (only if user is authenticated)
        if (transformedRecommendations.length > 0 && user?.id) {
          try {
            await ExperiencesService.trackInteraction(
              user.id,
              transformedRecommendations[0].id,
              'view'
            );
            console.log('Tracked view interaction for first card');
          } catch (error) {
            console.error('Error tracking view interaction:', error);
            // Continue without tracking - not critical
          }
        }
        
      } catch (err) {
        console.error('Error fetching recommendations:', err);
        setError('Failed to load recommendations');
      } finally {
        setLoading(false);
      }
    };

    fetchRecommendations();
  }, [user?.id]);

  const availableRecommendations = recommendations.filter(rec => 
    !removedCards.has(rec.id) && !removedCardIds.includes(rec.id)
  );

  const currentRec = availableRecommendations[currentCardIndex];
  
  // Debug logging
  console.log('Available cards:', availableRecommendations.length);
  console.log('Current card index:', currentCardIndex);
  console.log('Current card:', currentRec?.title);
  

  const handleTouchStart = (event: any) => {
    console.log('Touch started!');
    const { pageX, pageY } = event.nativeEvent;
    setTouchStart({ x: pageX, y: pageY });
    setIsDragging(true);
    setSwipeDirection(null);
  };

  const handleTouchMove = (event: any) => {
    if (!isDragging) return;
    
    const { pageX, pageY } = event.nativeEvent;
    const deltaX = pageX - touchStart.x;
    const deltaY = pageY - touchStart.y;
    
    console.log('Touch move:', deltaX);
    setDragOffset({ x: deltaX, y: deltaY });
    
    // Set swipe direction for visual feedback
    if (deltaX > 30) {
      setSwipeDirection('right');
    } else if (deltaX < -30) {
      setSwipeDirection('left');
    } else {
      setSwipeDirection(null);
    }
  };

  const handleTouchEnd = (event: any) => {
    if (!isDragging) return;
    
    const { pageX } = event.nativeEvent;
    const deltaX = pageX - touchStart.x;
    
    console.log('Touch ended:', deltaX);
    setIsDragging(false);
    setSwipeDirection(null);
    
    if (Math.abs(deltaX) > 100) {
      // Swipe left or right
      handleSwipe(deltaX > 0 ? 'right' : 'left');
    } else {
      // Reset position
      setDragOffset({ x: 0, y: 0 });
    }
  };

  const handleSwipe = async (direction: 'left' | 'right') => {
    console.log('Handling swipe:', direction, 'for card:', currentRec?.title);
    
    if (!currentRec) return;
    
    try {
      // Track interaction in Supabase (only if user is authenticated)
      if (user?.id) {
        const interactionType = direction === 'right' ? 'swipe_right' : 'swipe_left';
        
        try {
          await ExperiencesService.trackInteraction(
            user.id,
            currentRec.id,
            interactionType,
            {
              category: currentRec.category,
              time_of_day: userPreferences?.timeOfDay || 'Afternoon',
              budget_range: `${currentRec.priceRange}`,
              location: userPreferences?.location || 'San Francisco'
            }
          );
          console.log('Tracked swipe interaction:', interactionType);
        } catch (trackingError) {
          console.error('Error tracking interaction:', trackingError);
          // Continue without tracking - not critical
        }
        
        // Save to Supabase if swiped right (liked)
        if (direction === 'right') {
          try {
            await ExperiencesService.saveExperience(user.id, currentRec.id, 'liked');
            console.log('Saved liked experience to Supabase');
          } catch (saveError) {
            console.error('Error saving experience:', saveError);
            // Continue with local save even if Supabase fails
          }
          
          if (onCardLike) {
            onCardLike(currentRec);
          }
        } else {
          // Track dislike
          try {
            await ExperiencesService.saveExperience(user.id, currentRec.id, 'disliked');
            console.log('Tracked disliked experience');
          } catch (dislikeError) {
            console.error('Error tracking dislike:', dislikeError);
            // Continue without tracking dislike
          }
        }
      } else {
        // User not authenticated - just handle locally
        if (direction === 'right' && onCardLike) {
          onCardLike(currentRec);
        }
      }
      
    } catch (error) {
      console.error('Error handling swipe:', error);
    }
    
    // Add card to removed cards
    setRemovedCards(prev => {
      const newSet = new Set([...prev, currentRec.id]);
      console.log('Removed cards updated:', Array.from(newSet));
      return newSet;
    });
    
    // Don't increment card index - let the filtering handle it
    // The next card will automatically become availableRecommendations[0]
    setCurrentCardIndex(0);
    
    setDragOffset({ x: 0, y: 0 });
  };

  const handleBuyNow = () => {
    if (onAddToCalendar) {
      onAddToCalendar(currentRec);
    }
  };

  const handleShare = () => {
    if (onShareCard) {
      onShareCard(currentRec);
    }
  };

  // Loading state
  if (loading) {
    return (
      <View style={styles.noCardsContainer}>
        <View style={styles.noCardsContent}>
          <View style={styles.noCardsIcon}>
            <Ionicons name="hourglass" size={64} color="#6b7280" />
          </View>
          <Text style={styles.noCardsTitle}>Loading experiences...</Text>
          <Text style={styles.noCardsSubtitle}>
            Finding the best recommendations for you
          </Text>
        </View>
      </View>
    );
  }

  // Error state
  if (error) {
    return (
      <View style={styles.noCardsContainer}>
        <View style={styles.noCardsContent}>
          <View style={styles.noCardsIcon}>
            <Ionicons name="alert-circle" size={64} color="#ef4444" />
          </View>
          <Text style={styles.noCardsTitle}>Oops! Something went wrong</Text>
          <Text style={styles.noCardsSubtitle}>
            {error}
          </Text>
          <TouchableOpacity 
            onPress={() => {
              setError(null);
              setLoading(true);
              // Retry fetching
              const fetchRecommendations = async () => {
                try {
                  const experiences = await ExperiencesService.getExperiences();
                  const transformedRecommendations = experiences.map(exp => 
                    ExperiencesService.transformExperience(exp)
                  );
                  setRecommendations(transformedRecommendations);
                } catch (err) {
                  setError('Failed to load recommendations');
                } finally {
                  setLoading(false);
                }
              };
              fetchRecommendations();
            }}
            style={styles.startOverButton}
            activeOpacity={0.7}
          >
            <Text style={styles.startOverButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (availableRecommendations.length === 0) {
    return (
      <View style={styles.noCardsContainer}>
        <View style={styles.noCardsContent}>
          <View style={styles.sparklesContainer}>
            <Ionicons name="sparkles" size={40} color="#eb7825" />
          </View>
          <Text style={styles.noCardsTitle}>You're all caught up!</Text>
          <Text style={styles.noCardsSubtitle}>
            You've reviewed all available recommendations. Check back later for more personalized suggestions!
          </Text>
          <TouchableOpacity 
            onPress={() => {
              console.log('Start Over button pressed!');
              setRemovedCards(new Set());
              setCurrentCardIndex(0);
              setDragOffset({ x: 0, y: 0 });
              setIsDragging(false);
              setSwipeDirection(null);
              setTouchStart({ x: 0, y: 0 });
              onResetCards?.();
            }}
            style={styles.startOverButton}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.startOverButtonText}>Start Over</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!currentRec) {
    return null;
  }

  const CategoryIcon = getIconComponent(currentRec.categoryIcon);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />
      <View style={styles.container}>
        <View style={styles.cardContainer}>
        <View 
          style={[
            styles.card,
            {
              transform: [
                { translateX: dragOffset.x },
                { translateY: dragOffset.y },
                { rotate: `${dragOffset.x * 0.1}deg` }
              ]
            }
          ]}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Swipe Direction Overlays */}
          {swipeDirection === 'right' && (
            <View style={styles.swipeOverlayRight}>
              <View style={styles.swipeIndicator}>
                <Ionicons name="heart" size={40} color="#4ade80" />
                <Text style={styles.swipeText}>YES</Text>
              </View>
            </View>
          )}
          
          {swipeDirection === 'left' && (
            <View style={styles.swipeOverlayLeft}>
              <View style={styles.swipeIndicator}>
                <Ionicons name="close" size={40} color="#ef4444" />
                <Text style={styles.swipeText}>NO</Text>
              </View>
            </View>
          )}
          {/* Card Image */}
          <View style={styles.imageContainer}>
            <Image
              source={{ uri: currentRec.image }}
              style={styles.cardImage}
              resizeMode="cover"
            />
            
            {/* Match Score Badge */}
            <View style={styles.matchBadge}>
              <Text style={styles.matchText}>{currentRec.matchScore}% Match</Text>
            </View>
            
            {/* Card Counter */}
            <View style={styles.cardCounter}>
              <Text style={styles.counterText}>1/3</Text>
            </View>
            
            {/* Card Title Overlay */}
            <View style={styles.titleOverlay}>
              <Text style={styles.cardTitle}>{currentRec.title}</Text>
              <View style={styles.categoryRow}>
                <Ionicons name={CategoryIcon as any} size={16} color="white" />
                <Text style={styles.categoryText}>{currentRec.category}</Text>
              </View>
            </View>
            
            {/* Action Buttons */}
            <View style={styles.actionButtons}>
              <TouchableOpacity 
                style={styles.buyButton}
                onPress={() => {
                  console.log('Buy Now button pressed!');
                  onPurchaseComplete?.(currentRec, { type: 'purchase', price: currentRec.priceRange });
                }}
                activeOpacity={0.8}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="bag" size={20} color="white" />
                <Text style={styles.buyButtonText}>Buy Now</Text>
              </TouchableOpacity>
              
              <View style={styles.rightButtons}>
                <TouchableOpacity 
                  style={styles.actionButton}
                  onPress={() => {
                    console.log('Details button pressed!');
                    // Add details functionality here
                  }}
                  activeOpacity={0.7}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="chevron-down" size={20} color="white" />
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.actionButton}
                  onPress={() => {
                    console.log('Share button pressed!');
                    onShareCard?.(currentRec);
                  }}
                  activeOpacity={0.7}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="share" size={20} color="white" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
          
          {/* Card Details */}
          <View style={styles.cardDetails}>
            <View style={styles.detailsRow}>
              <View style={styles.ratingContainer}>
                <Ionicons name="star" size={16} color="#eb7825" />
                <Text style={styles.ratingText}>{currentRec.rating} ({currentRec.reviewCount})</Text>
              </View>
              
              <View style={styles.distanceContainer}>
                <Ionicons name="navigate" size={16} color="#eb7825" />
                <Text style={styles.distanceText}>{currentRec.travelTime}</Text>
              </View>
              
              <Text style={styles.priceText}>{currentRec.priceRange}</Text>
            </View>
            
            <Text style={styles.description}>{currentRec.description}</Text>
            
            <View style={styles.tagsContainer}>
              {currentRec.tags.slice(0, 3).map((tag, index) => (
                <View key={index} style={styles.tag}>
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          </View>
          
          {/* Swipe Instructions */}
          <View style={styles.swipeInstructions}>
            <View style={styles.swipeInstruction}>
              <Ionicons name="arrow-back" size={16} color="#ef4444" />
              <Text style={styles.swipeInstructionText}>Swipe left for NO</Text>
            </View>
            <View style={styles.swipeInstruction}>
              <Text style={styles.swipeInstructionText}>Swipe right for YES</Text>
              <Ionicons name="arrow-forward" size={16} color="#4ade80" />
            </View>
          </View>
        </View>
      </View>
    </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  container: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardContainer: {
    width: screenWidth * 0.92,
    height: screenHeight * 0.65,
    maxWidth: 380,
  },
  card: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6,
  },
  imageContainer: {
    flex: 1,
    position: 'relative',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  matchBadge: {
    position: 'absolute',
    top: 20,
    left: 20,
    backgroundColor: '#eb7825',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  matchText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
  cardCounter: {
    position: 'absolute',
    top: 20,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  counterText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
  },
  titleOverlay: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 24,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  cardTitle: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
  actionButtons: {
    position: 'absolute',
    bottom: 0,
    left: 5,
    right: 25,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 10,
  },
  buyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eb7825',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 16,
    gap: 8,
    flex: 1,
    marginRight: 12,
  },
  buyButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  rightButtons: {
    flexDirection: 'column',
    gap: 8,
  },
  actionButton: {
    width: 48,
    height: 48,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardDetails: {
    padding: 24,
  },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
  },
  distanceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  distanceText: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
  },
  priceText: {
    fontSize: 14,
    color: '#eb7825',
    fontWeight: '600',
  },
  description: {
    fontSize: 16,
    color: '#374151',
    marginBottom: 12,
    lineHeight: 22,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#eb7825',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
  },
  tagText: {
    fontSize: 12,
    color: '#eb7825',
    fontWeight: '500',
  },
  noCardsContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  noCardsContent: {
    alignItems: 'center',
    gap: 16,
  },
  noCardsIcon: {
    width: 80,
    height: 80,
    backgroundColor: '#f3f4f6',
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sparklesContainer: {
    width: 80,
    height: 80,
    backgroundColor: '#fef3e2',
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noCardsTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'center',
  },
  noCardsSubtitle: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 24,
  },
  startOverButton: {
    backgroundColor: '#eb7825',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  startOverButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  swipeOverlayRight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(74, 222, 128, 0.1)',
    borderWidth: 4,
    borderColor: '#4ade80',
    borderRadius: 16,
    zIndex: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  swipeOverlayLeft: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 4,
    borderColor: '#ef4444',
    borderRadius: 16,
    zIndex: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  swipeIndicator: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    marginTop: 8,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  swipeInstructions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  swipeInstruction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  swipeInstructionText: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
});