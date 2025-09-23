import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabase';
import { RecommendationsRequest, RecommendationsResponse, RecommendationCard } from '../types';
import { SingleCardDisplay } from './SingleCardDisplay';
import { useAppStore } from '../store/appStore';

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
  
  // Get current card index from store
  const { currentCardIndex, setCurrentCardIndex } = useAppStore();

  const fetchRecommendations = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log('🎯 Fetching recommendations with preferences:', preferences);
      const {
        data,
        error: functionError
      } = await supabase.functions.invoke('recommendations', {
        body: preferences
      });
      
      if (functionError) {
        throw new Error(functionError.message || 'Failed to fetch recommendations');
      }
      
      if (data?.error) {
        throw new Error(data.error);
      }
      
      console.log('✅ Received recommendations:', data);

      // Enhance cards with OpenAI if we have cards
      if (data?.cards && data.cards.length > 0) {
        console.log('🤖 Enhancing cards with OpenAI...');
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
            setRecommendations(data);
          } else if (enhancedData?.enhancedCards && enhancedData.enhancedCards.length > 0) {
            console.log('✨ Cards enhanced successfully with OpenAI');
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
            setRecommendations(enhancedRecommendations);
          } else {
            console.warn('⚠️ No enhanced cards returned, using original');
            setRecommendations(data);
          }
        } catch (enhanceError) {
          console.warn('⚠️ OpenAI enhancement error, using original cards:', enhanceError);
          setRecommendations(data);
        }
      } else {
        setRecommendations(data);
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
      console.log('🔄 RecommendationsGrid: Fetching recommendations due to preferences change');
      // Reset card index when fetching new recommendations
      setCurrentCardIndex(0);
      fetchRecommendations();
    }
  }, [JSON.stringify(preferences)]);

  // Also fetch on component mount (only if not already loading)
  useEffect(() => {
    console.log('🔄 RecommendationsGrid: Component mounted, fetching recommendations');
    if (preferences.origin.lat && preferences.origin.lng && preferences.categories.length > 0 && !loading) {
      fetchRecommendations();
    }
  }, []); // Empty dependency array means this runs on mount

  const handleRetry = () => {
    fetchRecommendations();
  };

  const handleLike = (card: RecommendationCard) => {
    if (onSave) {
      onSave(card);
    } else {
      Alert.alert("Saved!", `Saved ${card.title} for later`);
    }
    moveToNextCard();
  };

  const handleDislike = (card: RecommendationCard) => {
    moveToNextCard();
  };

  const moveToNextCard = () => {
    if (recommendations && currentCardIndex < recommendations.cards.length - 1) {
      setCurrentCardIndex(currentCardIndex + 1);
    } else {
      // All cards viewed
      Alert.alert(
        "That's all for now!",
        "You've seen all recommendations. Try adjusting your filters for more options."
      );
    }
  };

  const handleCardInvite = (card: RecommendationCard) => {
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
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Finding amazing experiences...</Text>
        <Text style={styles.loadingSubtext}>This may take a moment</Text>
      </View>
    );
  }

  // Error state
  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="warning-outline" size={48} color="#FF9500" />
        <Text style={styles.errorTitle}>Unable to load recommendations</Text>
        <Text style={styles.errorText}>{error}</Text>
        <View style={styles.errorActions}>
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <Ionicons name="refresh" size={16} color="white" />
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
          {onAdjustFilters && (
            <TouchableOpacity style={styles.adjustButton} onPress={onAdjustFilters}>
              <Ionicons name="options" size={16} color="#007AFF" />
              <Text style={styles.adjustButtonText}>Adjust Filters</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  // Empty state
  if (!recommendations || recommendations.cards.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="location-outline" size={48} color="#9CA3AF" />
        <Text style={styles.emptyTitle}>No matches found</Text>
        <Text style={styles.emptyText}>
          We couldn't find any recommendations matching your preferences. Try adjusting your filters or expanding your search area.
        </Text>
        {onAdjustFilters && (
          <TouchableOpacity style={styles.adjustButton} onPress={onAdjustFilters}>
            <Ionicons name="options" size={16} color="#007AFF" />
            <Text style={styles.adjustButtonText}>Adjust Filters</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // Safety check: ensure currentCardIndex doesn't exceed available cards
  const safeCardIndex = Math.min(currentCardIndex, recommendations.cards.length - 1);
  
  // Main content - Single Card Display
  return (
    <View style={styles.container}>
      <SingleCardDisplay 
        card={recommendations.cards[safeCardIndex]} 
        onLike={handleLike} 
        onDislike={handleDislike} 
        onInvite={handleCardInvite} 
        hasNext={safeCardIndex < recommendations.cards.length - 1} 
        cardNumber={safeCardIndex + 1} 
        totalCards={recommendations.cards.length}
        userTimePreference={userTimePreference}
      />
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
    paddingVertical: 40,
  },
  loadingText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginTop: 16,
    marginBottom: 8,
  },
  loadingSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 32,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  errorActions: {
    flexDirection: 'row',
    gap: 12,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    gap: 8,
  },
  retryButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  adjustButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    gap: 8,
  },
  adjustButtonText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
});
