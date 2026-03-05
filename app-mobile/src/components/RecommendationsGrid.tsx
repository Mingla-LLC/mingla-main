import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { supabase } from '../services/supabase';
import { RecommendationsRequest, RecommendationsResponse, RecommendationCard } from '../types';
import { SingleCardDisplay } from './SingleCardDisplay';
import { useAppStore } from '../store/appStore';
import { RecommendationSkeletonCard } from './SkeletonCard';
import { RecommendationsErrorState, NoRecommendationsState } from './ErrorState';
import { LoadingSpinner } from './SuccessAnimation';
import { CardStackPreview } from './CardStackPreview';
import { spacing, colors, typography, fontWeights, commonStyles } from '../constants/designSystem';
import { userInteractionService } from '../services/userInteractionService';
import { enhancedLocationTrackingService } from '../services/enhancedLocationTrackingService';
import { abTestingService } from '../services/abTestingService';
import { realtimeRecommendationService } from '../services/realtimeRecommendationService';
import { recommendationCacheService } from '../services/recommendationCacheService';
import { translationService } from '../services/translationService';
import { offlineService } from '../services/offlineService';
// Removed MLInsightsPanel import - component was deleted
import { OfflineIndicator } from './OfflineIndicator';
import { recommendationHistoryService } from '../services/recommendationHistoryService';
import { enhancedFavoritesService } from '../services/enhancedFavoritesService';
import { Ionicons } from '@expo/vector-icons';

interface RecommendationsGridProps {
  preferences: RecommendationsRequest;
  fullPreferences?: any; // Full preferences from PreferencesSheet
  onAdjustFilters?: () => void;
  onInvite?: (card: RecommendationCard) => void;
  onSave?: (card: RecommendationCard) => void;
  userTimePreference?: string;
}

export const RecommendationsGrid: React.FC<RecommendationsGridProps> = ({
  preferences,
  fullPreferences,
  onAdjustFilters,
  onInvite,
  onSave,
  userTimePreference
}) => {
  const [recommendations, setRecommendations] = useState<RecommendationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Removed showMLInsights state - MLInsightsPanel was deleted
  const [randomizedCardOrder, setRandomizedCardOrder] = useState<number[]>([]);
  const [viewedCards, setViewedCards] = useState<Set<number>>(new Set());
  const [abTestVariant, setAbTestVariant] = useState<string>('enhanced');
  const [abTestId, setAbTestId] = useState<string | null>(null);
  
  
  // Get current card index from store
  const { currentCardIndex, setCurrentCardIndex, user } = useAppStore();

  // Function to randomize card order while ensuring all cards are viewed
  const randomizeCardOrder = (totalCards: number): number[] => {
    const indices = Array.from({ length: totalCards }, (_, i) => i);
    
    // Fisher-Yates shuffle algorithm
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    
    return indices;
  };

  // Function to randomize and set card order
  const randomizeAndSetCardOrder = (data: RecommendationsResponse) => {
    if (data?.cards && data.cards.length > 0) {
      const randomizedOrder = randomizeCardOrder(data.cards.length);
      setRandomizedCardOrder(randomizedOrder);
      setViewedCards(new Set());
    }
  };

  // Start user session and initialize A/B testing when component mounts
  useEffect(() => {
    const initializeSession = async () => {
      try {
        // Start user session
        const session = await userInteractionService.startSession('recommendation', {
          preferences,
          fullPreferences,
          userTimePreference
        });
        
        if (session) {
        } else {
        }

        // Initialize A/B testing
        if (user?.id) {
          const [variant, testId] = await Promise.all([
            abTestingService.getUserRecommendationVariant(user.id),
            abTestingService.getCurrentRecommendationTestId()
          ]);
          
          setAbTestVariant(variant);
          setAbTestId(testId);

          // Initialize real-time updates
          await realtimeRecommendationService.initializeRealtimeUpdates(user.id, {
            enableLocationUpdates: true,
            enableTimeUpdates: true,
            enablePreferenceUpdates: true,
            enableInteractionUpdates: true,
            locationThreshold: 1000, // 1km
            timeThreshold: 30, // 30 minutes
            updateCooldown: 60 // 1 minute
          });

          // Start prefetching recommendations
          if (preferences.origin.lat && preferences.origin.lng) {
            recommendationCacheService.prefetchRecommendations(
              user.id,
              { lat: preferences.origin.lat, lng: preferences.origin.lng },
              preferences,
              variant
            );
          }
        }
      } catch (error) {
        console.error('Error initializing session:', error);
      }
    };
    
    initializeSession();

    // Cleanup: end session and stop real-time updates when component unmounts
    return () => {
      try {
        userInteractionService.endSession();
        if (user?.id) {
          realtimeRecommendationService.stopRealtimeUpdates(user.id);
        }
      } catch (error) {
        console.error('Error ending user session:', error);
      }
    };
  }, [user?.id]);

  const fetchRecommendations = async () => {
    setLoading(true);
    setError(null);
    try {
      
      // Get current user ID for personalized recommendations
      const { data: { user } } = await supabase.auth.getUser();
      
      // Enhanced preferences with user ID
      const enhancedPreferences = {
        ...preferences,
        userId: user?.id
      };

      // Generate cache key
      const cacheKey = recommendationCacheService.generateCacheKey(
        preferences,
        user?.id,
        abTestVariant
      );

      // Try to get from cache first
      const cachedRecommendations = await recommendationCacheService.getRecommendations(
        cacheKey,
        user?.id
      );

      if (cachedRecommendations) {
        // Translate cached recommendations
        const translatedRecommendations = await translationService.translateRecommendations(cachedRecommendations);
        setRecommendations({ cards: translatedRecommendations });
        randomizeAndSetCardOrder({ cards: translatedRecommendations });
        
        // Cache for offline use
        await offlineService.cacheRecommendations(translatedRecommendations);
        return;
      }

      // If offline, try to get offline recommendations
      if (!offlineService.isAppOnline()) {
        const offlineRecommendations = await offlineService.getOfflineRecommendations(preferences, 20);
        
        if (offlineRecommendations.length > 0) {
          const translatedOfflineRecommendations = await translationService.translateRecommendations(offlineRecommendations);
          setRecommendations({ cards: translatedOfflineRecommendations });
          randomizeAndSetCardOrder({ cards: translatedOfflineRecommendations });
          return;
        } else {
          setError('No offline recommendations available. Please connect to the internet to get new recommendations.');
          return;
        }
      }

      
      // Determine which recommendation function to use based on A/B test variant
      const functionName = abTestVariant === 'baseline' ? 'recommendations' : 'recommendations-enhanced';
      
      const {
        data,
        error: functionError
      } = await supabase.functions.invoke(functionName, {
        body: {
          ...enhancedPreferences,
          algorithm: abTestVariant // Pass the algorithm variant to the function
        }
      });
      
      if (functionError) {
        throw new Error(functionError.message || 'Failed to fetch recommendations');
      }
      
      if (data?.error) {
        throw new Error(data.error);
      }

      // Enhance cards with OpenAI if we have cards
      if (data?.cards && data.cards.length > 0) {
        try {
          const {
            data: enhancedData,
            error: enhanceError
          } = await supabase.functions.invoke('enhance-cards', {
            body: {
              cards: data.cards.map((card: RecommendationCard) => ({
                id: card.id,
                title: card.title,
                subtitle: card.subtitle,
                category: card.category,
                priceLevel: card.priceLevel,
                estimatedCostPerPerson: card.estimatedCostPerPerson,
                address: card.address,
                imageUrl: card.imageUrl
              })),
              preferences: {
                budget: preferences.budget,
                categories: preferences.categories,
                experienceTypes: fullPreferences?.experienceTypes || [],
                groupSize: fullPreferences?.groupSize || 2,
                timeWindow: preferences.timeWindow,
                travel: preferences.travel,
                location: {
                  name: fullPreferences?.customLocation || fullPreferences?.location || 'Current Location',
                  isCustom: fullPreferences?.location === 'custom' || false,
                  lat: fullPreferences?.custom_lat,
                  lng: fullPreferences?.custom_lng
                },
                measurementSystem: preferences.units || 'metric'
              }
            }
          });
          
          if (enhanceError) {
            console.warn('⚠️ OpenAI enhancement failed, using original cards:', enhanceError);
            // Translate recommendations before setting
            const translatedRecommendations = await translationService.translateRecommendations(data.cards);
            setRecommendations({ cards: translatedRecommendations });
            randomizeAndSetCardOrder({ cards: translatedRecommendations });
            // Cache the original recommendations (not translated)
            await recommendationCacheService.setRecommendations(
              cacheKey,
              data.cards,
              undefined,
              { userId: user?.id, algorithm: abTestVariant, preferences }
            );
          } else if (enhancedData?.enhancedCards && enhancedData.enhancedCards.length > 0) {
            // Merge enhanced copy with original card data
            const enhancedRecommendations = {
              ...data,
              cards: data.cards.map((originalCard: RecommendationCard) => {
                const enhanced = enhancedData.enhancedCards.find((ec: any) => ec.id === originalCard.id);
                return enhanced ? {
                  ...originalCard,
                  copy: enhanced.copy
                } : originalCard;
              })
            };
            // Translate enhanced recommendations
            const translatedEnhancedRecommendations = await translationService.translateRecommendations(enhancedRecommendations.cards);
            setRecommendations({ cards: translatedEnhancedRecommendations });
            randomizeAndSetCardOrder({ cards: translatedEnhancedRecommendations });
            // Cache the enhanced recommendations (not translated)
            await recommendationCacheService.setRecommendations(
              cacheKey,
              enhancedRecommendations.cards,
              undefined,
              { userId: user?.id, algorithm: abTestVariant, preferences }
            );
          } else {
            console.warn('⚠️ No enhanced cards returned, using original');
            // Translate recommendations
            const translatedRecommendations = await translationService.translateRecommendations(data.cards);
            setRecommendations({ cards: translatedRecommendations });
            randomizeAndSetCardOrder({ cards: translatedRecommendations });
            // Cache the original recommendations (not translated)
            await recommendationCacheService.setRecommendations(
              cacheKey,
              data.cards,
              undefined,
              { userId: user?.id, algorithm: abTestVariant, preferences }
            );
          }
        } catch (enhanceError) {
          console.warn('⚠️ OpenAI enhancement error, using original cards:', enhanceError);
          // Translate recommendations
          const translatedRecommendations = await translationService.translateRecommendations(data.cards);
          setRecommendations({ cards: translatedRecommendations });
          randomizeAndSetCardOrder({ cards: translatedRecommendations });
          // Cache the original recommendations (not translated)
          await recommendationCacheService.setRecommendations(
            cacheKey,
            data.cards,
            undefined,
            { userId: user?.id, algorithm: abTestVariant, preferences }
          );
        }
      } else {
        // Translate recommendations
        const translatedRecommendations = await translationService.translateRecommendations(data.cards);
        setRecommendations({ cards: translatedRecommendations });
        randomizeAndSetCardOrder({ cards: translatedRecommendations });
        // Cache the recommendations (not translated)
        await recommendationCacheService.setRecommendations(
          cacheKey,
          data.cards,
          undefined,
          { userId: user?.id, algorithm: abTestVariant, preferences }
        );
        
        // Cache for offline use
        await offlineService.cacheRecommendations(data.cards);
      }
      
      if (data?.cards?.length === 0) {
        Alert.alert(
          "No matches found",
          "Try adjusting your filters to see more options"
        );
      }
    } catch (err) {
      console.error('❌ Error fetching recommendations:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to load recommendations';
      setError(errorMessage);
      Alert.alert(
        "Error loading recommendations",
        errorMessage
      );
    } finally {
      setLoading(false);
    }
  };


  // Fetch recommendations when preferences change or component mounts
  useEffect(() => {
    if (preferences.origin.lat && preferences.origin.lng && preferences.categories.length > 0) {
      // Reset card index and randomized order when fetching new recommendations
      setCurrentCardIndex(0);
      setRandomizedCardOrder([]);
      setViewedCards(new Set());
      fetchRecommendations();
    }
  }, [JSON.stringify(preferences)]);

  // Also fetch on component mount (only if not already loading)
  useEffect(() => {
    if (preferences.origin.lat && preferences.origin.lng && preferences.categories.length > 0 && !loading) {
      fetchRecommendations();
    }
  }, []); // Empty dependency array means this runs on mount

  const handleRetry = () => {
    fetchRecommendations();
  };

  const handleLike = async (card: RecommendationCard) => {
    // Track the like interaction
    await userInteractionService.trackLike(card.id, card);
    
    // Record in history
    if (user?.id) {
      await recommendationHistoryService.recordInteraction(
        user.id,
        card,
        'like',
        {
          sessionId: userInteractionService.getCurrentSession()?.id,
          location: {
            lat: preferences.origin.lat,
            lng: preferences.origin.lng
          }
        }
      );
    }
    
    // Track A/B test event
    if (user?.id && abTestId) {
      await abTestingService.trackEvent(user.id, abTestId, 'like', {
        cardId: card.id,
        algorithm: abTestVariant,
        cardTitle: card.title,
        category: card.category
      });
    }
    
    if (onSave) {
      onSave(card);
    } else {
      Alert.alert("Saved!", `Saved ${card.title} for later`);
    }
    moveToNextCard();
  };

  const handleDislike = async (card: RecommendationCard) => {
    // Track the dislike interaction
    await userInteractionService.trackDislike(card.id, card);
    
    // Record in history
    if (user?.id) {
      await recommendationHistoryService.recordInteraction(
        user.id,
        card,
        'dislike',
        {
          sessionId: userInteractionService.getCurrentSession()?.id,
          location: {
            lat: preferences.origin.lat,
            lng: preferences.origin.lng
          }
        }
      );
    }
    
    // Track A/B test event
    if (user?.id && abTestId) {
      await abTestingService.trackEvent(user.id, abTestId, 'dislike', {
        cardId: card.id,
        algorithm: abTestVariant,
        cardTitle: card.title,
        category: card.category
      });
    }
    
    moveToNextCard();
  };

  const moveToNextCard = () => {
    if (recommendations && randomizedCardOrder.length > 0) {
      // Mark current card as viewed
      const currentRandomizedIndex = randomizedCardOrder[currentCardIndex];
      setViewedCards(prev => {
        const newViewed = new Set([...prev, currentRandomizedIndex]);
        
        // Track A/B test view event
        if (user?.id && abTestId && recommendations?.cards[currentRandomizedIndex]) {
          const card = recommendations.cards[currentRandomizedIndex];
          abTestingService.trackEvent(user.id, abTestId, 'view', {
            cardId: card.id,
            algorithm: abTestVariant,
            cardTitle: card.title,
            category: card.category,
            viewOrder: currentCardIndex + 1
          });
        }

        // Record view in history
        if (user?.id && recommendations?.cards[currentRandomizedIndex]) {
          const card = recommendations.cards[currentRandomizedIndex];
          recommendationHistoryService.recordInteraction(
            user.id,
            card,
            'view',
            {
              sessionId: userInteractionService.getCurrentSession()?.id,
              location: {
                lat: preferences.origin.lat,
                lng: preferences.origin.lng
              }
            }
          );
        }
        
        return newViewed;
      });
      
      if (currentCardIndex < randomizedCardOrder.length - 1) {
        setCurrentCardIndex(currentCardIndex + 1);
      } else {
        // All cards viewed
        Alert.alert(
          "That's all for now!",
          "You've seen all recommendations. Try adjusting your filters for more options."
        );
      }
    }
  };

  const handleCardInvite = async (card: RecommendationCard) => {
    // Track the share interaction
    await userInteractionService.trackShare(card.id, card, 'invite');
    
    if (onInvite) {
      onInvite(card);
    } else {
      Alert.alert("Invite sent!", `Invited friends to ${card.title}`);
    }
  };

  // Loading state
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <RecommendationSkeletonCard />
        <View style={styles.loadingContent}>
          <LoadingSpinner size={32} color={colors.primary[500]} />
          <Text style={styles.loadingText}>Finding amazing experiences...</Text>
          <Text style={styles.loadingSubtext}>This may take a moment</Text>
        </View>
      </View>
    );
  }

  // Error state
  if (error) {
    return (
      <RecommendationsErrorState onRetry={handleRetry} />
    );
  }

  // Empty state
  if (!recommendations || recommendations.cards.length === 0) {
    return (
      <NoRecommendationsState onRefresh={onAdjustFilters} />
    );
  }

  
  // Get current and next card indices from randomized order
  const currentRandomizedIndex = randomizedCardOrder[currentCardIndex] ?? 0;
  const nextRandomizedIndex = randomizedCardOrder[currentCardIndex + 1] ?? -1;
  
  // Safety check: ensure indices are valid
  const safeCurrentIndex = Math.min(currentRandomizedIndex, recommendations.cards.length - 1);
  const safeNextIndex = nextRandomizedIndex >= 0 ? Math.min(nextRandomizedIndex, recommendations.cards.length - 1) : -1;
  
  // Main content - Card Stack Preview
  return (
    <View style={styles.container}>
      <OfflineIndicator showDetails={true} />
      
      {/* ML Insights Button - Removed */}

      <CardStackPreview
        currentCard={recommendations.cards[safeCurrentIndex]}
        nextCard={safeNextIndex >= 0 ? recommendations.cards[safeNextIndex] : undefined}
        onLike={handleLike}
        onDislike={handleDislike}
        onInvite={handleCardInvite}
        hasNext={currentCardIndex < randomizedCardOrder.length - 1}
        cardNumber={currentCardIndex + 1}
        totalCards={randomizedCardOrder.length}
        userTimePreference={userTimePreference}
      />

      {/* ML Insights Panel - Removed component */}

    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  loadingContent: {
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  loadingText: {
    ...typography.lg,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  loadingSubtext: {
    ...typography.sm,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  // Removed mlInsightsButton and mlInsightsButtonText styles
});
