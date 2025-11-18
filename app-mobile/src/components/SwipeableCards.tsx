import React, { useState, useRef, useEffect } from 'react';
import { Text, View, TouchableOpacity, Image, StyleSheet, Dimensions, Animated, PanResponder, SafeAreaView, StatusBar, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { formatCurrency, formatDistance } from './utils/formatters';
import { ExperiencesService, Experience } from '../services/experiencesService';
import { ExperienceGenerationService, GeneratedExperience } from '../services/experienceGenerationService';
import { useAuthSimple } from '../hooks/useAuthSimple';
import { enhancedLocationService } from '../services/enhancedLocationService';

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
  refreshKey?: number | string; // Key that changes to trigger refresh
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
  onboardingData,
  refreshKey
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
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [currentTipIndex, setCurrentTipIndex] = useState(0);
  const spinValue = useRef(new Animated.Value(0)).current;

  const { user } = useAuthSimple();

  // Tips related to vibes, intents, and categories
  const tips = [
    "💡 Solo adventures are perfect for discovering hidden gems at your own pace",
    "🌟 First dates? Try cozy cafes or scenic walks for a relaxed atmosphere",
    "💕 Romantic vibes? Look for intimate dining experiences or sunset spots",
    "👥 Group fun works best with interactive activities like escape rooms or game nights",
    "☕ Sip & Chill spots are great for casual meetups and work sessions",
    "🚶‍♀️ Take a Stroll through local parks and neighborhoods to discover new areas",
    "🍽️ Dining Experiences offer unique culinary adventures beyond the ordinary",
    "🎨 Creative & Hands-On activities like pottery or painting classes spark creativity",
    "🧘‍♀️ Wellness Dates combine relaxation with meaningful connection",
    "🎬 Screen & Relax options are perfect for rainy days or cozy evenings",
    "🏃‍♀️ Play & Move activities keep you active while having fun",
    "🧺 Picnics are budget-friendly and perfect for sunny afternoons",
    "✨ Freestyle experiences let you discover something completely unexpected",
    "🍔 Casual Eats offer great food without the formal atmosphere",
    "💼 Business meetings? Choose quiet cafes or professional spaces",
    "🌆 Explore new neighborhoods to find unique local experiences",
    "⏰ Adjust your travel time to discover places just outside your usual radius",
    "💰 Budget-friendly options exist in every category - explore different price ranges",
    "🎯 Mix different categories to keep your experiences diverse and exciting",
    "🌙 Late night spots offer a different vibe - perfect for night owls",
    "☀️ Afternoon activities often have better availability and pricing",
    "🍳 Brunch spots are great for weekend socializing",
    "🌳 Nature-based activities are free and refreshing",
    "🎪 Look for pop-up events and seasonal experiences",
    "🏛️ Museums and galleries offer cultural enrichment",
    "🎵 Live music venues create memorable atmosphere",
    "🍷 Wine tastings and brewery tours are great for groups",
    "🏖️ Waterfront locations offer scenic views and fresh air",
    "🎭 Theaters and comedy clubs provide entertainment value",
    "🛍️ Markets and festivals showcase local culture",
    "🏋️ Fitness classes combine health with social connection",
    "📚 Bookstores and libraries offer quiet, intellectual spaces",
    "🎨 Art galleries provide inspiration and conversation starters",
    "🍕 Food tours let you sample multiple places in one experience",
    "🌉 Iconic landmarks make for great photo opportunities",
    "🏞️ Hiking trails offer exercise and beautiful scenery",
    "🎪 Festivals and events create shared memorable experiences",
    "🍰 Dessert spots are perfect for sweet-tooth satisfaction",
    "🌮 Food trucks offer variety and casual dining",
    "🎯 Try something new - you might discover a new favorite activity",
  ];

  // Shuffle tips array for random order
  const shuffledTips = useRef(
    tips.sort(() => Math.random() - 0.5)
  ).current;

  // Rotate tips every 5 seconds
  useEffect(() => {
    if (!loading) return;

    const tipInterval = setInterval(() => {
      setCurrentTipIndex((prev) => (prev + 1) % shuffledTips.length);
    }, 5000);

    return () => clearInterval(tipInterval);
  }, [loading, shuffledTips.length]);

  // Animate spinner
  useEffect(() => {
    if (!loading) return;

    const spinAnimation = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 2000,
        useNativeDriver: true,
      })
    );

    spinAnimation.start();

    return () => spinAnimation.stop();
  }, [loading, spinValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // Get user location
  useEffect(() => {
    const getLocation = async () => {
      try {
        const location = await enhancedLocationService.getCurrentLocation();
        if (location) {
          setUserLocation({ lat: location.latitude, lng: location.longitude });
        } else {
          // Fallback to default location (San Francisco)
          setUserLocation({ lat: 37.7749, lng: -122.4194 });
        }
      } catch (error) {
        console.error('Error getting location:', error);
        // Fallback to default location
        setUserLocation({ lat: 37.7749, lng: -122.4194 });
      }
    };
    getLocation();
  }, []);

  // Fetch AI-generated experiences
  useEffect(() => {
    const fetchRecommendations = async () => {
      if (!userLocation) {
        // Wait for location
        return;
      }

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
            // Use default preferences
            userPrefs = {
              mode: 'explore',
              budget_min: 0,
              budget_max: 1000,
              people_count: 1,
              categories: ['Sip & Chill', 'Stroll'],
              travel_mode: 'walking',
              travel_constraint_type: 'time',
              travel_constraint_value: 30,
              datetime_pref: new Date().toISOString(),
            };
          }
        } else {
          // Default preferences for non-authenticated users
          userPrefs = {
            mode: 'explore',
            budget_min: 0,
            budget_max: 1000,
            people_count: 1,
            categories: ['Sip & Chill', 'Stroll'],
            travel_mode: 'walking',
            travel_constraint_type: 'time',
            travel_constraint_value: 30,
            datetime_pref: new Date().toISOString(),
          };
        }
        
        // Generate experiences using AI
        try {
          const generatedExperiences = await ExperienceGenerationService.generateExperiences({
            userId: user?.id || 'anonymous',
            preferences: userPrefs,
            location: userLocation,
          });
          
          console.log('Generated experiences:', generatedExperiences.length);
          
          if (generatedExperiences.length === 0) {
            setError('no_matches');
            setRecommendations([]);
            return;
          }
          
          // Transform to Recommendation format
          const transformedRecommendations = generatedExperiences.map(exp => ({
            id: exp.id,
            title: exp.title,
            category: exp.category,
            categoryIcon: exp.categoryIcon,
            timeAway: exp.travelTime,
            description: exp.description,
            budget: exp.priceRange,
            rating: exp.rating,
            image: exp.heroImage,
            images: exp.images || [exp.heroImage],
            priceRange: exp.priceRange,
            distance: exp.distance,
            travelTime: exp.travelTime,
            experienceType: exp.category,
            highlights: exp.highlights || [],
            fullDescription: exp.description,
            address: exp.address,
            openingHours: '',
            tags: exp.highlights || [],
            matchScore: exp.matchScore,
            reviewCount: exp.reviewCount,
            socialStats: {
              views: 0,
              likes: 0,
              saves: 0,
              shares: 0,
            },
            matchFactors: exp.matchFactors || {
              location: 85,
              budget: 85,
              category: 85,
              time: 85,
              popularity: 85,
            },
          }));
          
          setRecommendations(transformedRecommendations);
          
          // Track view interaction for the first card
          if (transformedRecommendations.length > 0 && user?.id) {
            try {
              await ExperiencesService.trackInteraction(
                user.id,
                transformedRecommendations[0].id,
                'view'
              );
            } catch (error) {
              console.error('Error tracking view interaction:', error);
            }
          }
          
        } catch (genError) {
          console.error('Error generating experiences:', genError);
          setError('Failed to generate experiences. Please try again.');
        }
        
      } catch (err) {
        console.error('Error fetching recommendations:', err);
        setError('Failed to load recommendations');
      } finally {
        setLoading(false);
      }
    };

    fetchRecommendations();
  }, [user?.id, userLocation, refreshKey]); // Refresh when preferences are updated

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

  // Loading state with spinner and rotating tips
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.loadingContent}>
          {/* Animated Spinner */}
          <Animated.View
            style={[
              styles.spinnerContainer,
              {
                transform: [{ rotate: spin }],
              },
            ]}
          >
            <View style={styles.spinnerOuter}>
              <View style={styles.spinnerInner}>
                <Ionicons name="sparkles" size={32} color="#eb7825" />
              </View>
            </View>
          </Animated.View>

          {/* Loading Text */}
          <Text style={styles.loadingTitle}>Finding your perfect experiences...</Text>

          {/* Rotating Tip */}
          <View style={styles.tipContainer}>
            <Text style={styles.tipText}>{shuffledTips[currentTipIndex]}</Text>
          </View>
        </View>
      </View>
    );
  }

  // Error state - No matches found
  if (error === 'no_matches' || (error && availableRecommendations.length === 0)) {
    const currentPrefs = userPreferences || {
      budget_min: 0,
      budget_max: 1000,
      categories: [],
      travel_constraint_value: 30,
    };
    
    return (
      <View style={styles.noCardsContainer}>
        <View style={styles.noCardsContent}>
          <Text style={styles.noMatchesEmoji}>💡</Text>
          <Text style={styles.noCardsTitle}>No matches found</Text>
          <Text style={styles.noCardsSubtitle}>
            We couldn't find experiences matching your current filters.
          </Text>
          
          {/* Filter Summary */}
          <View style={styles.filterSummary}>
            <Text style={styles.filterSummaryTitle}>Current Filters:</Text>
            <View style={styles.filterTags}>
              {currentPrefs.categories && currentPrefs.categories.length > 0 && (
                <View style={styles.filterTag}>
                  <Text style={styles.filterTagText}>
                    Categories: {currentPrefs.categories.join(', ')}
                  </Text>
                </View>
              )}
              <View style={styles.filterTag}>
                <Text style={styles.filterTagText}>
                  Budget: ${currentPrefs.budget_min || 0}-${currentPrefs.budget_max || 1000}
                </Text>
              </View>
              <View style={styles.filterTag}>
                <Text style={styles.filterTagText}>
                  Travel: {currentPrefs.travel_constraint_value || 30} min
                </Text>
              </View>
            </View>
          </View>
          
          <Text style={styles.suggestionsTitle}>Suggestions:</Text>
          <Text style={styles.suggestionsText}>
            • Try expanding your budget range{'\n'}
            • Add more categories to your preferences{'\n'}
            • Increase your travel time constraint{'\n'}
            • Check back later for new experiences
          </Text>
          
          <TouchableOpacity 
            onPress={() => {
              setError(null);
              setLoading(true);
              // Retry with same preferences
              const fetchRecommendations = async () => {
                if (!userLocation) return;
                try {
                  const userPrefs = user?.id 
                    ? await ExperiencesService.getUserPreferences(user.id)
                    : {
                        mode: 'explore',
                        budget_min: 0,
                        budget_max: 1000,
                        people_count: 1,
                        categories: ['Sip & Chill', 'Stroll'],
                        travel_mode: 'walking',
                        travel_constraint_type: 'time',
                        travel_constraint_value: 30,
                        datetime_pref: new Date().toISOString(),
                      };
                  
                  const generatedExperiences = await ExperienceGenerationService.generateExperiences({
                    userId: user?.id || 'anonymous',
                    preferences: userPrefs,
                    location: userLocation,
                  });
                  
                  if (generatedExperiences.length > 0) {
                    const transformed = generatedExperiences.map(exp => ({
                      id: exp.id,
                      title: exp.title,
                      category: exp.category,
                      categoryIcon: exp.categoryIcon,
                      timeAway: exp.travelTime,
                      description: exp.description,
                      budget: exp.priceRange,
                      rating: exp.rating,
                      image: exp.heroImage,
                      images: exp.images || [exp.heroImage],
                      priceRange: exp.priceRange,
                      distance: exp.distance,
                      travelTime: exp.travelTime,
                      experienceType: exp.category,
                      highlights: exp.highlights || [],
                      fullDescription: exp.description,
                      address: exp.address,
                      openingHours: '',
                      tags: exp.highlights || [],
                      matchScore: exp.matchScore,
                      reviewCount: exp.reviewCount,
                      socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
                      matchFactors: exp.matchFactors || {
                        location: 85, budget: 85, category: 85, time: 85, popularity: 85,
                      },
                    }));
                    setRecommendations(transformed);
                    setError(null);
                  } else {
                    setError('no_matches');
                  }
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

  // General error state
  if (error && error !== 'no_matches') {
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
              // Retry by re-fetching
              const fetchRecommendations = async () => {
                if (!userLocation) return;
                try {
                  const userPrefs = user?.id 
                    ? await ExperiencesService.getUserPreferences(user.id)
                    : {
                        mode: 'explore',
                        budget_min: 0,
                        budget_max: 1000,
                        people_count: 1,
                        categories: ['Sip & Chill', 'Stroll'],
                        travel_mode: 'walking',
                        travel_constraint_type: 'time',
                        travel_constraint_value: 30,
                        datetime_pref: new Date().toISOString(),
                      };
                  
                  const generatedExperiences = await ExperienceGenerationService.generateExperiences({
                    userId: user?.id || 'anonymous',
                    preferences: userPrefs,
                    location: userLocation,
                  });
                  
                  if (generatedExperiences.length > 0) {
                    const transformed = generatedExperiences.map(exp => ({
                      id: exp.id,
                      title: exp.title,
                      category: exp.category,
                      categoryIcon: exp.categoryIcon,
                      timeAway: exp.travelTime,
                      description: exp.description,
                      budget: exp.priceRange,
                      rating: exp.rating,
                      image: exp.heroImage,
                      images: exp.images || [exp.heroImage],
                      priceRange: exp.priceRange,
                      distance: exp.distance,
                      travelTime: exp.travelTime,
                      experienceType: exp.category,
                      highlights: exp.highlights || [],
                      fullDescription: exp.description,
                      address: exp.address,
                      openingHours: '',
                      tags: exp.highlights || [],
                      matchScore: exp.matchScore,
                      reviewCount: exp.reviewCount,
                      socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
                      matchFactors: exp.matchFactors || {
                        location: 85, budget: 85, category: 85, time: 85, popularity: 85,
                      },
                    }));
                    setRecommendations(transformed);
                    setError(null);
                  }
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
          {/* Hero Image Section - 60-65% of card */}
          <View style={styles.imageContainer}>
            <Image
              source={{ uri: currentRec.image }}
              style={styles.cardImage}
              resizeMode="cover"
            />
            
            {/* Match Score Badge - Top Left */}
            <View style={styles.matchBadge}>
              <Ionicons name="star" size={14} color="#1f2937" style={{ marginRight: 4 }} />
              <Text style={styles.matchText}>{currentRec.matchScore}% Match</Text>
            </View>
            
            {/* Gallery Indicator if multiple images */}
            {currentRec.images && currentRec.images.length > 1 && (
              <View style={styles.galleryIndicator}>
                <Ionicons name="images" size={16} color="white" />
                <Text style={styles.galleryText}>{currentRec.images.length}</Text>
              </View>
            )}
            
            {/* Title and Details Overlay - Bottom Left of Image */}
            <View style={styles.titleOverlay}>
              <Text style={styles.cardTitle}>{currentRec.title}</Text>
              
              {/* Three small badges: distance, travel time, rating */}
              <View style={styles.detailsBadges}>
                <View style={styles.detailBadge}>
                  <Ionicons name="location" size={12} color="white" />
                  <Text style={styles.detailBadgeText}>{currentRec.distance}</Text>
                </View>
                <View style={styles.detailBadge}>
                  <Ionicons name="time" size={12} color="white" />
                  <Text style={styles.detailBadgeText}>{currentRec.travelTime}</Text>
                </View>
                <View style={styles.detailBadge}>
                  <Ionicons name="star" size={12} color="white" />
                  <Text style={styles.detailBadgeText}>{currentRec.rating.toFixed(1)}</Text>
                </View>
              </View>
            </View>
          </View>
          
          {/* White Details Section - Bottom 35-40% */}
          <View style={styles.cardDetails}>
            {/* Category/Provider */}
            <View style={styles.categoryRow}>
              <Ionicons name={CategoryIcon as any} size={16} color="#eb7825" />
              <Text style={styles.categoryText}>{currentRec.category}</Text>
            </View>
            
            {/* Description - 2 lines max */}
            <Text style={styles.description} numberOfLines={2}>
              {currentRec.description}
            </Text>
            
            {/* Top 2 Highlights */}
            {currentRec.highlights && currentRec.highlights.length > 0 && (
              <View style={styles.highlightsContainer}>
                {currentRec.highlights.slice(0, 2).map((highlight: string, index: number) => (
                  <View key={index} style={styles.highlightBadge}>
                    <Text style={styles.highlightText}>{highlight}</Text>
                  </View>
                ))}
              </View>
            )}
            
            {/* Share Button - Centered at bottom */}
            <TouchableOpacity 
              style={styles.shareButton}
              onPress={handleShare}
              activeOpacity={0.7}
            >
              <Ionicons name="share-outline" size={18} color="#6b7280" />
              <Text style={styles.shareButtonText}>Share</Text>
            </TouchableOpacity>
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
    flex: 0.65, // 65% of card height
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
    top: 16,
    left: 16,
    backgroundColor: 'white',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  matchText: {
    color: '#1f2937',
    fontSize: 13,
    fontWeight: '600',
  },
  galleryIndicator: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  galleryText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
  },
  titleOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: 24,
  },
  cardTitle: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 12,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  detailsBadges: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  detailBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailBadgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  categoryText: {
    color: '#6b7280',
    fontSize: 14,
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
    flex: 0.35, // 35% of card height
    backgroundColor: 'white',
    padding: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  description: {
    fontSize: 15,
    color: '#374151',
    marginBottom: 16,
    lineHeight: 22,
  },
  highlightsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  highlightBadge: {
    backgroundColor: '#fef3e2',
    borderWidth: 1,
    borderColor: '#fed7aa',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  highlightText: {
    fontSize: 12,
    color: '#eb7825',
    fontWeight: '500',
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  shareButtonText: {
    fontSize: 15,
    color: '#6b7280',
    fontWeight: '500',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f9fafb',
  },
  loadingContent: {
    alignItems: 'center',
    gap: 32,
    maxWidth: 320,
  },
  spinnerContainer: {
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  spinnerOuter: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 4,
    borderColor: '#ffedd5',
    borderTopColor: '#eb7825',
    justifyContent: 'center',
    alignItems: 'center',
  },
  spinnerInner: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#fff7ed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'center',
  },
  tipContainer: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    minHeight: 80,
    justifyContent: 'center',
  },
  tipText: {
    fontSize: 15,
    color: '#374151',
    textAlign: 'center',
    lineHeight: 22,
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
    marginBottom: 20,
  },
  noMatchesEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  filterSummary: {
    width: '100%',
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  filterSummaryTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 12,
  },
  filterTags: {
    gap: 8,
  },
  filterTag: {
    backgroundColor: 'white',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  filterTagText: {
    fontSize: 13,
    color: '#6b7280',
  },
  suggestionsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  suggestionsText: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 22,
    marginBottom: 20,
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