import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { RecommendationCard } from './RecommendationCard';
import { AlertCircle, MapPin, RefreshCw, Sliders } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { RecommendationsRequest, RecommendationsResponse, RecommendationCard as CardType } from '@/types/recommendations';

interface RecommendationsGridProps {
  preferences: RecommendationsRequest;
  fullPreferences?: any; // Full preferences from PreferencesSheet
  onAdjustFilters?: () => void;
  onInvite?: (card: CardType) => void;
  onSave?: (card: CardType) => void;
}

export const RecommendationsGrid: React.FC<RecommendationsGridProps> = ({
  preferences,
  fullPreferences,
  onAdjustFilters,
  onInvite,
  onSave
}) => {
  const [recommendations, setRecommendations] = useState<RecommendationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRecommendations = async () => {
    setLoading(true);
    setError(null);
    
    try {
      console.log('🎯 Fetching recommendations with preferences:', preferences);
      
      const { data, error: functionError } = await supabase.functions.invoke('recommendations', {
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
          const { data: enhancedData, error: enhanceError } = await supabase.functions.invoke('enhance-cards', {
            body: {
              cards: data.cards.map((card: CardType) => ({
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
              cards: data.cards.map((originalCard: CardType) => {
                const enhanced = enhancedData.enhancedCards.find((ec: any) => ec.id === originalCard.id);
                return enhanced ? { ...originalCard, copy: enhanced.copy } : originalCard;
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
        toast({
          title: "No matches found",
          description: "Try adjusting your filters to see more options",
          variant: "default"
        });
      }
      
    } catch (err) {
      console.error('❌ Error fetching recommendations:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to load recommendations';
      setError(errorMessage);
      
      toast({
        title: "Error loading recommendations",
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  // Fetch recommendations when preferences change
  useEffect(() => {
    if (preferences.origin.lat && preferences.origin.lng && preferences.categories.length > 0) {
      fetchRecommendations();
    }
  }, [JSON.stringify(preferences)]);

  const handleRetry = () => {
    fetchRecommendations();
  };

  const handleCardInvite = (card: CardType) => {
    if (onInvite) {
      onInvite(card);
    } else {
      // Default invite behavior - could integrate with collaboration system
      toast({
        title: "Invite sent!",
        description: `Invited friends to ${card.title}`,
      });
    }
  };

  const handleCardSave = (card: CardType) => {
    if (onSave) {
      onSave(card);
    } else {
      // Default save behavior - could integrate with saves system
      toast({
        title: "Saved!",
        description: `Saved ${card.title} for later`,
      });
    }
  };

  // Loading skeleton
  const LoadingSkeleton = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {Array.from({ length: 6 }).map((_, index) => (
        <Card key={index} className="overflow-hidden">
          <Skeleton className="aspect-video w-full" />
          <CardContent className="p-4 space-y-3">
            <div className="space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
            </div>
            <Skeleton className="h-4 w-2/3" />
            <div className="flex gap-2">
              <Skeleton className="h-8 flex-1" />
              <Skeleton className="h-8 w-8" />
              <Skeleton className="h-8 w-8" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );

  // Error state
  const ErrorState = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center py-12"
    >
      <Card className="max-w-md mx-auto">
        <CardContent className="p-8">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Unable to load recommendations</h3>
          <p className="text-muted-foreground mb-6">{error}</p>
          <div className="flex gap-3 justify-center">
            <Button onClick={handleRetry} variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
            {onAdjustFilters && (
              <Button onClick={onAdjustFilters} variant="default">
                <Sliders className="h-4 w-4 mr-2" />
                Adjust Filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );

  // Empty state
  const EmptyState = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center py-12"
      data-testid="empty-state"
    >
      <Card className="max-w-md mx-auto">
        <CardContent className="p-8">
          <MapPin className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No matches found</h3>
          <p className="text-muted-foreground mb-6">
            We couldn't find any recommendations matching your preferences. Try adjusting your filters or expanding your search area.
          </p>
          {onAdjustFilters && (
            <Button onClick={onAdjustFilters}>
              <Sliders className="h-4 w-4 mr-2" />
              Adjust Filters
            </Button>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );

  if (loading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return <ErrorState />;
  }

  if (!recommendations || recommendations.cards.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-6">
      {/* Results Summary */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h2 className="text-xl font-semibold">
            Found {recommendations.cards.length} recommendations
          </h2>
          {recommendations.meta && (
            <p className="text-sm text-muted-foreground">
              Loaded in {recommendations.meta.processingTimeMs}ms • 
              {recommendations.meta.sources.googlePlaces} places • 
              {recommendations.meta.sources.eventbrite} events
              {recommendations.meta.llmUsed && ' • AI enhanced'}
            </p>
          )}
        </div>
        
        <div className="flex gap-2">
          <Button onClick={handleRetry} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {onAdjustFilters && (
            <Button onClick={onAdjustFilters} variant="outline" size="sm">
              <Sliders className="h-4 w-4 mr-2" />
              Filters
            </Button>
          )}
        </div>
      </motion.div>

      {/* Cards Grid */}
      <AnimatePresence mode="wait">
        <motion.div
          layout
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {recommendations.cards.map((card, index) => (
            <RecommendationCard
              key={card.id}
              card={card}
              index={index}
              onInvite={handleCardInvite}
              onSave={handleCardSave}
            />
          ))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};