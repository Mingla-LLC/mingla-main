import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Heart, X, Sliders, Users, User, Sparkles, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PreferencesSheet } from '@/components/PreferencesSheet';
import { HeaderControls } from '@/components/HeaderControls';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useSessionManagement } from '@/hooks/useSessionManagement';
import { convertPreferencesToRequest } from '@/utils/preferencesConverter';
import { SingleCardDisplay } from '@/components/SingleCardDisplay';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { RecommendationCard as CardType, RecommendationsRequest, RecommendationsResponse } from '@/types/recommendations';
import minglaLogo from '@/assets/mingla-logo.png';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

interface ActivePreferences {
  budgetRange: [number, number];
  categories: string[];
  experienceTypes?: string[];
  time: string;
  travel: string;
  travelConstraint: 'time' | 'distance';
  travelTime: number;
  travelDistance: number;
  location: string;
  customLocation?: string;
  custom_lat?: number | null;
  custom_lng?: number | null;
  groupSize: number;
}

const Home = () => {
  const [showPreferences, setShowPreferences] = useState(false);
  const [measurementSystem, setMeasurementSystem] = useState('metric');
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [showNotifications, setShowNotifications] = useState(true);
  
  // Recommendations state
  const [recommendations, setRecommendations] = useState<RecommendationsResponse | null>(null);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const { profile } = useUserProfile();
  
  // Get user's current location
  const { 
    latitude, 
    longitude, 
    loading: locationLoading, 
    getCurrentLocation 
  } = useGeolocation({
    autoStart: true
  });
  
  // Session management
  const {
    currentSession,
    availableSessions,
    pendingInvites,
    isInSolo,
    loading: sessionLoading,
    switchToSolo,
    switchToCollaborative,
    createCollaborativeSession,
    cancelSession,
    acceptInvite,
    declineInvite
  } = useSessionManagement();

  // Load user on mount
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    };
    getUser();
  }, []);

  // Premium dating app defaults
  const [activePreferences, setActivePreferences] = useState<ActivePreferences>(() => ({
    budgetRange: [25, 150], // Premium dating range
    categories: ['sip', 'dining'], // Dating-focused categories
    experienceTypes: ['Romantic', 'First Date'],
    time: 'tonight',
    travel: 'drive',
    travelConstraint: 'time',
    travelTime: 20,
    travelDistance: 5,
    location: 'current',
    customLocation: '',
    custom_lat: null,
    custom_lng: null,
    groupSize: 2
  }));

  // Handle preferences update
  const handlePreferencesUpdate = useCallback((newPreferences: ActivePreferences) => {
    console.log('📊 Updating preferences:', newPreferences);
    setActivePreferences(newPreferences);
    setCurrentCardIndex(0); // Reset to first card
  }, []);

  // Convert preferences for recommendations API
  const recommendationsRequest = useMemo(() => {
    return convertPreferencesToRequest(
      activePreferences,
      latitude || undefined,
      longitude || undefined,
      measurementSystem as 'metric' | 'imperial'
    );
  }, [activePreferences, latitude, longitude, measurementSystem]);

  // Fetch recommendations
  const fetchRecommendations = useCallback(async () => {
    if (!recommendationsRequest) return;
    
    setLoading(true);
    setError(null);
    
    try {
      console.log('🎯 Fetching recommendations with preferences:', recommendationsRequest);
      
      const { data, error: functionError } = await supabase.functions.invoke('recommendations', {
        body: recommendationsRequest
      });

      if (functionError) {
        throw new Error(functionError.message || 'Failed to fetch recommendations');
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      console.log('✅ Received recommendations:', data);
      setRecommendations(data);
      setCurrentCardIndex(0);
      
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
  }, [recommendationsRequest]);

  // Fetch recommendations when preferences change
  useEffect(() => {
    if (recommendationsRequest?.origin.lat && recommendationsRequest?.origin.lng && recommendationsRequest?.categories.length > 0) {
      fetchRecommendations();
    }
  }, [fetchRecommendations]);

  // Handle card actions
  const handleCardLike = useCallback((card: CardType) => {
    console.log('💖 Liked:', card.title);
    
    // Advance to next card
    if (recommendations && currentCardIndex < recommendations.cards.length - 1) {
      setCurrentCardIndex(prev => prev + 1);
    }
    
    // Save the card
    toast({
      title: "Saved!",
      description: `Added ${card.title} to your favorites`,
    });
    
    // TODO: Integrate with saves system
  }, [recommendations, currentCardIndex]);

  const handleCardDislike = useCallback((card: CardType) => {
    console.log('👎 Disliked:', card.title);
    
    // Advance to next card
    if (recommendations && currentCardIndex < recommendations.cards.length - 1) {
      setCurrentCardIndex(prev => prev + 1);
    }
    
    // TODO: Send feedback to improve recommendations
  }, [recommendations, currentCardIndex]);

  const handleCardInvite = useCallback((card: CardType) => {
    console.log('👥 Invite to:', card.title);
    
    // Integrate with existing collaboration system
    toast({
      title: "Invite sent!",
      description: `Invited friends to ${card.title}`,
    });
    
    // TODO: Integrate with collaboration flow
  }, []);

  const handleRefresh = () => {
    fetchRecommendations();
  };

  // Wrapper function to handle session creation
  const handleCreateSession = async (participants: string[], sessionName: string): Promise<void> => {
    const result = await createCollaborativeSession(participants, sessionName);
    if (!result) {
      throw new Error('Failed to create session');
    }
  };

  const currentCard = recommendations?.cards?.[currentCardIndex];
  const hasNextCard = recommendations && currentCardIndex < recommendations.cards.length - 1;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/5">
      {/* Header */}
      <HeaderControls
        showNotifications={showNotifications}
        onToggleNotifications={() => setShowNotifications(!showNotifications)}
        onShowPreferences={() => setShowPreferences(true)}
        currentSession={currentSession}
        availableSessions={availableSessions}
        pendingInvites={pendingInvites}
        isInSolo={isInSolo}
        loading={sessionLoading}
        onSwitchToSolo={switchToSolo}
        onSwitchToCollaborative={switchToCollaborative}
        onCreateSession={handleCreateSession}
        onCancelSession={cancelSession}
        onAcceptInvite={acceptInvite}
        onDeclineInvite={declineInvite}
      />

      {/* Logo */}
      <div className="flex justify-center pt-8 pb-6">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <img
            src={minglaLogo}
            alt="Mingla"
            className="h-12 w-auto"
          />
        </motion.div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 pb-24">
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-20"
          >
            <div className="animate-pulse flex flex-col items-center gap-4">
              <Sparkles className="h-12 w-12 text-primary animate-bounce" />
              <p className="text-lg font-medium text-muted-foreground">
                Finding amazing dates near you...
              </p>
            </div>
          </motion.div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-20"
          >
            <div className="text-center space-y-4 max-w-md">
              <h3 className="text-xl font-semibold">Unable to load recommendations</h3>
              <p className="text-muted-foreground">{error}</p>
              <div className="flex gap-3 justify-center">
                <Button onClick={handleRefresh} variant="outline">
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Try Again
                </Button>
                <Button onClick={() => setShowPreferences(true)} variant="default">
                  <Sliders className="h-4 w-4 mr-2" />
                  Adjust Filters
                </Button>
              </div>
            </div>
          </motion.div>
        )}

        {!loading && !error && recommendations && recommendations.cards.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-20"
          >
            <div className="text-center space-y-4 max-w-md">
              <h3 className="text-xl font-semibold">No matches found</h3>
              <p className="text-muted-foreground">
                We couldn't find any dates matching your preferences. Try expanding your search criteria.
              </p>
              <Button onClick={() => setShowPreferences(true)}>
                <Sliders className="h-4 w-4 mr-2" />
                Adjust Preferences
              </Button>
            </div>
          </motion.div>
        )}

        {!loading && !error && currentCard && (
          <>
            {/* Single Card Display */}
            <SingleCardDisplay
              card={currentCard}
              onLike={handleCardLike}
              onDislike={handleCardDislike}
              onInvite={handleCardInvite}
              hasNext={hasNextCard}
              cardNumber={currentCardIndex + 1}
              totalCards={recommendations?.cards.length || 0}
            />

            {/* Progress Indicator */}
            <div className="flex justify-center mt-6">
              <div className="flex gap-1">
                {recommendations?.cards.map((_, index) => (
                  <div
                    key={index}
                    className={cn(
                      "h-2 w-2 rounded-full transition-all duration-300",
                      index === currentCardIndex
                        ? "bg-primary w-6"
                        : index < currentCardIndex
                        ? "bg-primary/60"
                        : "bg-muted"
                    )}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        {/* Welcome State (when no preferences selected) */}
        {!loading && !recommendations && activePreferences.categories.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-20"
          >
            <div className="max-w-md mx-auto space-y-6">
              <div className="w-20 h-20 mx-auto bg-gradient-primary rounded-full flex items-center justify-center mb-6">
                <Heart className="h-10 w-10 text-white" />
              </div>
              <h2 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">
                Find Your Perfect Date
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                Discover amazing local experiences tailored to your preferences. From cozy coffee dates to elegant dinners.
              </p>
              <Button
                size="lg"
                className="bg-gradient-primary hover:opacity-90 text-white font-semibold px-8"
                onClick={() => setShowPreferences(true)}
              >
                <Sparkles className="h-5 w-5 mr-2" />
                Get Started
              </Button>
            </div>
          </motion.div>
        )}
      </div>

      {/* Preferences Sheet */}
      <PreferencesSheet
        isOpen={showPreferences}
        onClose={() => setShowPreferences(false)}
        measurementSystem={measurementSystem}
        activePreferences={activePreferences}
        onPreferencesUpdate={handlePreferencesUpdate}
      />
    </div>
  );
};

export default Home;