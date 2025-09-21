import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMobileFeatures } from './MobileFeaturesProvider';
import { useAppStore } from '../store/appStore';
import { ExperienceCard } from './ExperienceCard';
import { TinderCardStack } from './TinderCardStack';
import { DetailedExperienceCard } from './DetailedExperienceCard';
import { aiReasoningService, AIRecommendation } from '../services/aiReasoningService';
import { experienceService } from '../services/experienceService';

interface AIRecommendationEngineProps {
  onExperienceSelect?: (experience: any) => void;
  onCardIndexChange?: (currentIndex: number, totalCount: number) => void;
  context?: 'home' | 'explore' | 'activity' | 'custom';
  customFilters?: {
    categories?: string[];
    budget?: { min: number; max: number };
    timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night';
    peopleCount?: number;
  };
}

export const AIRecommendationEngine: React.FC<AIRecommendationEngineProps> = ({
  onExperienceSelect,
  onCardIndexChange,
  context = 'home',
  customFilters,
}) => {
  const [recommendations, setRecommendations] = useState<AIRecommendation[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  
  const { user, preferences } = useAppStore();
  const { currentLocation, getCurrentLocation } = useMobileFeatures();

  // Notify parent component of card index changes
  useEffect(() => {
    if (onCardIndexChange && recommendations.length > 0) {
      onCardIndexChange(currentIndex + 1, recommendations.length); // +1 because we display 1-based index
    }
  }, [currentIndex, recommendations.length, onCardIndexChange]);

  const loadRecommendations = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      // Get current location if not available
      let location = currentLocation;
      if (!location) {
        location = await getCurrentLocation();
      }

      // Prepare recommendation request
      const request = {
        userPreferences: {
          ...preferences,
          ...customFilters,
        },
        currentLocation: location ? {
          latitude: location.latitude,
          longitude: location.longitude,
        } : undefined,
        timeOfDay: customFilters?.timeOfDay || getTimeOfDay(),
        dayOfWeek: getDayOfWeek(),
        context,
      };

      console.log('Loading AI recommendations with request:', request);

      // Add timeout to prevent infinite loading
      const aiRecommendations = await Promise.race([
        aiReasoningService.getAIRecommendations(request),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('AI service timeout')), 10000) // 10 second timeout
        )
      ]);
      
      // If AI recommendations are available and not empty, use them
      if (aiRecommendations && aiRecommendations.length > 0) {
        setRecommendations(aiRecommendations);
        setCurrentIndex(0); // Reset to first recommendation
        setLastUpdated(new Date());
        console.log(`Loaded ${aiRecommendations.length} AI recommendations`);
      } else {
        // Fallback: fetch experiences directly like the web app
        console.log('AI recommendations empty, fetching experiences directly...');
        const experiences = await Promise.race([
          experienceService.fetchAllExperiences(),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Experience service timeout')), 5000) // 5 second timeout
          )
        ]);
        
        // Convert experiences to AI recommendation format
        const fallbackRecommendations: AIRecommendation[] = experiences.slice(0, 25).map(experience => ({
          experience: {
            ...experience,
            description: experience.description || `Enjoy a great ${experience.category} experience in the city.`,
          },
          reasoning: 'Based on popular experiences in your area',
          confidence: 0.7,
          personalization_score: 0.5,
        }));
        
        setRecommendations(fallbackRecommendations);
        setCurrentIndex(0); // Reset to first recommendation
        setLastUpdated(new Date());
        console.log(`Loaded ${fallbackRecommendations.length} fallback recommendations`);
      }
    } catch (err: any) {
      console.error('Error loading AI recommendations:', err);
      
      // Final fallback: try to fetch experiences directly
      try {
        console.log('Trying direct experience fetch as final fallback...');
        const experiences = await Promise.race([
          experienceService.fetchAllExperiences(),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Final fallback timeout')), 3000) // 3 second timeout
          )
        ]);
        const fallbackRecommendations: AIRecommendation[] = experiences.slice(0, 25).map(experience => ({
          experience: {
            ...experience,
            description: experience.description || `Enjoy a great ${experience.category} experience in the city.`,
          },
          reasoning: 'Based on popular experiences in your area',
          confidence: 0.7,
          personalization_score: 0.5,
        }));
        
        setRecommendations(fallbackRecommendations);
        setLastUpdated(new Date());
        setError(null); // Clear error since we got fallback data
        console.log(`Loaded ${fallbackRecommendations.length} final fallback recommendations`);
      } catch (fallbackErr) {
        console.error('Fallback experience fetch also failed:', fallbackErr);
        setError(err.message || 'Failed to load recommendations');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentLocation, preferences, customFilters, context, getCurrentLocation]);

  const getTimeOfDay = (): 'morning' | 'afternoon' | 'evening' | 'night' => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
  };

  const getDayOfWeek = (): string => {
    return new Date().toLocaleDateString('en-US', { weekday: 'long' });
  };

  const handleRefresh = () => {
    loadRecommendations(true);
  };

  const getContextTitle = () => {
    switch (context) {
      case 'home': return 'AI-Powered Recommendations';
      case 'explore': return 'Smart Discovery';
      case 'activity': return 'Perfect for Your Plans';
      case 'custom': return 'Personalized Suggestions';
      default: return 'AI Recommendations';
    }
  };

  const getContextDescription = () => {
    switch (context) {
      case 'home': return 'Based on your preferences, location, and current conditions';
      case 'explore': return 'Discover experiences tailored to your interests';
      case 'activity': return 'Great additions to your current planning session';
      case 'custom': return 'Curated just for you';
      default: return 'Intelligent recommendations for your next adventure';
    }
  };

  const formatLastUpdated = () => {
    if (!lastUpdated) return '';
    const now = new Date();
    const diff = now.getTime() - lastUpdated.getTime();
    const minutes = Math.floor(diff / 60000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return lastUpdated.toLocaleDateString();
  };

  // Load recommendations on mount and when dependencies change
  useEffect(() => {
    loadRecommendations();
  }, [loadRecommendations]);

  if (loading && !refreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Analyzing your preferences...</Text>
        <Text style={styles.loadingSubtext}>Finding the perfect experiences for you</Text>
      </View>
    );
  }

  // For home context, just render the detailed card
  if (context === 'home') {
    if (loading && !refreshing) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Analyzing your preferences...</Text>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.errorContainer}>
          <Ionicons name="warning-outline" size={48} color="#FF9500" />
          <Text style={styles.errorTitle}>Unable to load recommendations</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity 
            style={styles.retryButton}
            onPress={() => loadRecommendations()}
          >
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (recommendations.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="compass-outline" size={48} color="#ccc" />
          <Text style={styles.emptyStateTitle}>No recommendations yet</Text>
          <Text style={styles.emptyStateText}>
            We're analyzing your preferences to find the best experiences for you
          </Text>
        </View>
      );
    }

    // Check if we have a current recommendation
    if (currentIndex >= recommendations.length) {
      return (
        <View style={styles.container}>
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No more recommendations</Text>
            <Text style={styles.emptySubtitle}>Pull to refresh for more experiences</Text>
          </View>
        </View>
      );
    }

    // Show the current recommendation as a detailed card
    const currentRecommendation = recommendations[currentIndex];
    
    const handleLike = () => {
      console.log('Liked:', currentRecommendation.experience.title, 'Current index:', currentIndex);
      onExperienceSelect?.(currentRecommendation.experience);
      // Move to next recommendation
      setCurrentIndex(prev => {
        const nextIndex = prev + 1;
        console.log('Moving to next index:', nextIndex, 'Total recommendations:', recommendations.length);
        // If we're near the end, load more recommendations
        if (nextIndex >= recommendations.length - 2) {
          loadRecommendations(true);
        }
        return nextIndex;
      });
    };

    const handleDislike = () => {
      console.log('Disliked:', currentRecommendation.experience.title, 'Current index:', currentIndex);
      // Move to next recommendation
      setCurrentIndex(prev => {
        const nextIndex = prev + 1;
        console.log('Moving to next index:', nextIndex, 'Total recommendations:', recommendations.length);
        // If we're near the end, load more recommendations
        if (nextIndex >= recommendations.length - 2) {
          loadRecommendations(true);
        }
        return nextIndex;
      });
    };

    const handleViewDetails = () => {
      console.log('View details:', currentRecommendation.experience.title);
      onExperienceSelect?.(currentRecommendation.experience);
    };

    return (
      <DetailedExperienceCard
        key={`${currentRecommendation.experience.id}-${currentIndex}`}
        experience={currentRecommendation.experience}
        currentImageIndex={3}
        totalImages={25}
        currentCardIndex={currentIndex + 1}
        totalCards={recommendations.length}
        onLike={handleLike}
        onDislike={handleDislike}
        onViewDetails={handleViewDetails}
      />
    );
  }

  // For other contexts, use the original layout
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.titleRow}>
            <Ionicons name="bulb" size={20} color="#FF9500" />
            <Text style={styles.title}>{getContextTitle()}</Text>
          </View>
          <Text style={styles.description}>{getContextDescription()}</Text>
          {lastUpdated && (
            <Text style={styles.lastUpdated}>Updated {formatLastUpdated()}</Text>
          )}
        </View>
        
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={handleRefresh}
          disabled={refreshing}
        >
          <Ionicons 
            name="refresh" 
            size={20} 
            color={refreshing ? '#ccc' : '#007AFF'} 
          />
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View style={styles.content}>
        {error ? (
          <View style={styles.errorContainer}>
            <Ionicons name="warning-outline" size={48} color="#FF9500" />
            <Text style={styles.errorTitle}>Unable to load recommendations</Text>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity 
              style={styles.retryButton}
              onPress={() => loadRecommendations()}
            >
              <Text style={styles.retryButtonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : recommendations.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="compass-outline" size={48} color="#ccc" />
            <Text style={styles.emptyStateTitle}>No recommendations yet</Text>
            <Text style={styles.emptyStateText}>
              {!currentLocation 
                ? 'Enable location access to get personalized recommendations'
                : 'We\'re analyzing your preferences to find the best experiences for you'
              }
            </Text>
          </View>
        ) : (
          <TinderCardStack
            experiences={recommendations.map(r => r.experience)}
            onExperienceSelect={onExperienceSelect}
            onAllExperiencesSwiped={() => {
              console.log('All experiences swiped, loading more...');
              loadRecommendations(true);
            }}
            onRefresh={() => loadRecommendations(true)}
            refreshing={refreshing}
          />
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
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
  header: {
    backgroundColor: 'white',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e1e5e9',
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  headerContent: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  description: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  lastUpdated: {
    fontSize: 12,
    color: '#999',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  refreshButton: {
    padding: 8,
    marginLeft: 8,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginTop: 16,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  retryButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
  },
  recommendationItem: {
    marginBottom: 16,
  },
  reasoningContainer: {
    backgroundColor: 'white',
    marginTop: 8,
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#FF9500',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  reasoningHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  reasoningTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reasoningTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  confidenceBadge: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  confidenceText: {
    fontSize: 12,
    color: 'white',
    fontWeight: '600',
  },
  reasoningText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 12,
  },
  weatherConsideration: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f8ff',
    padding: 8,
    borderRadius: 6,
    marginBottom: 12,
    gap: 6,
  },
  weatherText: {
    fontSize: 12,
    color: '#007AFF',
    fontStyle: 'italic',
    flex: 1,
  },
  personalizationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  personalizationLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 100,
  },
  personalizationText: {
    fontSize: 12,
    color: '#666',
  },
  personalizationScore: {
    flex: 1,
    height: 6,
    backgroundColor: '#e1e5e9',
    borderRadius: 3,
    overflow: 'hidden',
  },
  personalizationFill: {
    height: '100%',
    backgroundColor: '#34C759',
    borderRadius: 3,
  },
  personalizationPercentage: {
    fontSize: 12,
    color: '#34C759',
    fontWeight: '600',
    minWidth: 30,
    textAlign: 'right',
  },
});
