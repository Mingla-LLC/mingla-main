import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Heart, X, Sliders, RefreshCw, Users, User, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TripCard } from '@/components/TripCard';
import { TripCardExpanded } from '@/components/TripCardExpanded';
import { PreferencesSheet } from '@/components/PreferencesSheet';
import { HeaderControls } from '@/components/HeaderControls';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useUserProfile } from '@/hooks/useUserProfile';
import { formatCurrency } from '@/utils/currency';
import { getCategoryBySlug } from '@/lib/categories';
import { useExperiences } from '@/hooks/useExperiences';
import { useSessionManagement } from '@/hooks/useSessionManagement';
import { RecommendationsGrid } from '@/components/RecommendationsGrid';
import { convertPreferencesToRequest } from '@/utils/preferencesConverter';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { RecommendationCard as CardType } from '@/types/recommendations';
import minglaLogo from '@/assets/mingla-logo-updated.png';
import { cn } from '@/lib/utils';

interface ActivePreferences {
  budgetRange: [number, number];
  categories: string[];
  experienceTypes: string[];
  time: string;
  travel: string;
  travelConstraint: 'time' | 'distance';
  travelTime: number;
  travelDistance: number;
  location: string;
  customLocation: string;
  custom_lat: number | null;
  custom_lng: number | null;
  groupSize: number;
}

const Home = () => {
  const [currentTripIndex, setCurrentTripIndex] = useState(0);
  const [showPreferences, setShowPreferences] = useState(false);
  const [expandedTrip, setExpandedTrip] = useState<string | null>(null);
  const [measurementSystem, setMeasurementSystem] = useState('metric');
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [showNotifications, setShowNotifications] = useState(true);
  const { profile } = useUserProfile();

  // Get current user
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    };
    getUser();
  }, []);

  // Get user's current location
  const { latitude, longitude, city, loading: locationLoading, error: locationError } = useGeolocation();

  // Session management
  const {
    currentSession,
    availableSessions,
    isInSolo,
    pendingInvites,
    loading: sessionLoading,
    switchToSolo,
    switchToCollaborative,
    createCollaborativeSession,
    acceptInvite: handleAcceptInvite,
    declineInvite: handleDeclineInvite,
    cancelSession: handleCancelSession
  } = useSessionManagement();

  // Wrapper for session creation
  const handleCreateSession = useCallback(async (participants: string[], sessionName: string) => {
    await createCollaborativeSession(participants, sessionName);
  }, [createCollaborativeSession]);

  // Set premium dating defaults that trigger recommendations immediately
  const [activePreferences, setActivePreferences] = useState<ActivePreferences>(() => ({
    budgetRange: [25, 150] as [number, number],
    categories: ['stroll', 'sip', 'casual_eats', 'screen_relax', 'creative', 'play_move', 'dining', 'freestyle'], // All categories enabled
    experienceTypes: ['Romantic', 'First Date'],
    time: 'tonight',
    travel: 'drive',
    travelConstraint: 'time' as const,
    travelTime: 15,
    travelDistance: 10,
    location: 'current',
    customLocation: '',
    custom_lat: null,
    custom_lng: null,
    groupSize: 2
  }));

  // Handle preferences update with immediate application
  const handlePreferencesUpdate = useCallback((newPreferences: ActivePreferences) => {
    console.log('📊 Updating preferences:', newPreferences);
    setActivePreferences(newPreferences);
  }, []);

  // Convert preferences for recommendations API
  const recommendationsRequest = useMemo(() => {
    // Always convert preferences if we have location data
    if (activePreferences.categories.length === 0) {
      // Use default categories if none selected
      const defaultPrefs = {
        ...activePreferences,
        categories: ['stroll', 'sip', 'casual_eats', 'screen_relax', 'creative', 'play_move', 'dining', 'freestyle']
      };
      return convertPreferencesToRequest(defaultPrefs, latitude || undefined, longitude || undefined, measurementSystem as 'metric' | 'imperial');
    }
    return convertPreferencesToRequest(activePreferences, latitude || undefined, longitude || undefined, measurementSystem as 'metric' | 'imperial');
  }, [activePreferences, latitude, longitude, measurementSystem]);

  // Handle recommendation card actions
  const handleCardInvite = (card: CardType) => {
    // Integrate with existing collaboration system
    toast({
      title: "Invite sent!",
      description: `Invited friends to ${card.title}`
    });
  };
  
  const handleCardSave = async (card: CardType) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({
        title: "Authentication required",
        description: "Please log in to save experiences",
        variant: "destructive"
      });
      return;
    }

    try {
      // Check if already saved
      const { data: existing } = await supabase
        .from('saved_experiences')
        .select('id')
        .eq('card_id', card.id)
        .eq('user_id', user.id)
        .single();

      if (existing) {
        toast({
          title: "Already saved",
          description: `${card.title} is already in your saved experiences`,
          variant: "default"
        });
        return;
      }

      const saveData = {
        user_id: user.id,
        card_id: card.id,
        title: card.title,
        subtitle: card.subtitle,
        category: card.category,
        price_level: card.priceLevel,
        estimated_cost_per_person: card.estimatedCostPerPerson,
        start_time: card.startTime,
        duration_minutes: card.durationMinutes,
        image_url: card.imageUrl,
        address: card.address,
        location_lat: card.location?.lat,
        location_lng: card.location?.lng,
        route_mode: card.route?.mode,
        eta_minutes: card.route?.etaMinutes,
        distance_text: card.route?.distanceText,
        maps_deep_link: card.route?.mapsDeepLink,
        source_provider: card.source?.provider,
        place_id: card.source?.placeId,
        event_id: card.source?.eventId,
        one_liner: card.copy?.oneLiner,
        tip: card.copy?.tip,
        rating: card.rating,
        review_count: card.reviewCount
      };

      const { error: insertError } = await supabase
        .from('saved_experiences')
        .insert([saveData]);

      if (insertError) {
        throw insertError;
      }

      toast({
        title: "Saved!",
        description: `${card.title} has been saved to your collection`
      });
    } catch (err) {
      console.error('Error saving experience:', err);
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : 'Failed to save experience',
        variant: "destructive"
      });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/5 flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur-lg border-b border-border/50">
        {/* Logo Section */}
        <div className="px-4 pt-4 pb-3 text-center">
          <img 
            src={minglaLogo} 
            alt="Mingla" 
            className="h-8 sm:h-10 mx-auto"
          />
        </div>
        
        {/* Controls Section */}
        <div className="px-3 sm:px-6 pb-3">
          <div className="flex items-center justify-between gap-2">
            {/* Left side - Controls */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              <Button 
                variant="outline" 
                size="sm"
                className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl border border-primary/20 hover:border-primary/40 hover:bg-primary/5 transition-all duration-200"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl border border-primary/20 hover:border-primary/40 hover:bg-primary/5 transition-all duration-200"
                onClick={() => setShowPreferences(true)}
                data-testid="preferences-button"
              >
                <Sliders className="h-4 w-4" />
              </Button>
            </div>
            
            {/* Right side - Session Controls */}
            <div className="flex items-center">
              <HeaderControls 
                showNotifications={false}
                onToggleNotifications={() => {}}
                onShowPreferences={() => setShowPreferences(true)}
                currentSession={currentSession} 
                availableSessions={availableSessions} 
                isInSolo={isInSolo} 
                onSwitchToSolo={switchToSolo} 
                onSwitchToCollaborative={switchToCollaborative} 
                onCreateSession={handleCreateSession} 
                pendingInvites={pendingInvites} 
                sentSessions={availableSessions.filter(session => session.invitedBy === user?.id && (session.status === 'pending' || session.status === 'dormant'))} 
                onAcceptInvite={handleAcceptInvite} 
                onDeclineInvite={handleDeclineInvite} 
                onCancelSession={handleCancelSession} 
                loading={sessionLoading} 
              />
            </div>
          </div>
        </div>
      </div>

      {/* Recommendations Grid - Always show when we have preferences */}
      {recommendationsRequest && !locationLoading ? (
        <div className="flex-1 px-6 py-6" data-testid="recommendations-grid">
          <RecommendationsGrid 
            preferences={recommendationsRequest} 
            fullPreferences={activePreferences}
            onAdjustFilters={() => setShowPreferences(true)} 
            onInvite={handleCardInvite} 
            onSave={handleCardSave}
            userTimePreference={activePreferences.time}
          />
        </div>
      ) : (
        /* Loading state while getting location */
        <div className="flex-1 flex items-center justify-center px-6 py-6">
          <div className="text-center space-y-4">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-muted-foreground">
              {locationError ? "Setting up your experience..." : "Finding amazing experiences near you..."}
            </p>
            <Button 
              variant="outline" 
              onClick={() => setShowPreferences(true)}
              className="mt-4"
            >
              Set Preferences
            </Button>
          </div>
        </div>
      )}

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