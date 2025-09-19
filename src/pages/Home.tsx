import React, { useState, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { 
  MapPin, 
  Clock, 
  DollarSign, 
  Users,
  Calendar,
  Navigation
} from 'lucide-react';
import { SessionInviteNotifications } from '@/components/SessionInviteNotifications';
import SingleCardResults from '@/components/SingleCardResults';
import { useAppStore, type Preferences } from '@/store/appStore';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useSessionManagement } from '@/hooks/useSessionManagement';
import { convertPreferencesToRequest } from '@/utils/preferencesConverter';
import type { RecommendationCard } from '@/types/recommendations';

const Home = () => {
  const { user, preferences } = useAppStore();
  const { profile } = useUserProfile();
  const [recommendations, setRecommendations] = useState<RecommendationCard[]>([]);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  
  const { 
    latitude,
    longitude,
    loading: locationLoading, 
    error: locationError,
    getCurrentLocation 
  } = useGeolocation({
    autoStart: true
  });
  
  // Helper function to calculate travel time in minutes
  const calculateTravelTime = (fromLocation: string, toLat: number | null, toLng: number | null, travelMode: string): number => {
    // Simplified calculation - in real app, this would use actual routing API
    if (!toLat || !toLng) return 15; // Default
    
    // Mock distance calculation based on travel mode
    const baseTime = Math.random() * 20 + 5; // 5-25 minutes
    
    switch (travelMode) {
      case 'walk':
        return Math.round(baseTime * 1.5);
      case 'drive':
        return Math.round(baseTime * 0.7);
      case 'public':
        return Math.round(baseTime * 1.2);
      default:
        return Math.round(baseTime);
    }
  };
  
  // Helper function to format distance
  const formatDistance = (distance: number, measurementSystem: 'metric' | 'imperial' = 'metric'): string => {
    if (distance === 0) return '0 km';
    
    if (measurementSystem === 'metric') {
      return distance >= 1000 ? 
        `${(distance / 1000).toFixed(1)} km` : 
        `${Math.round(distance)} m`;
    } else {
      const miles = distance * 0.000621371;
      return miles >= 1 ? 
        `${miles.toFixed(1)} mi` : 
        `${Math.round(miles * 5280)} ft`;
    }
  };
  
  // Helper function to format travel distance
  const formatTravelDistance = (distance: number, measurementSystem: 'metric' | 'imperial' = 'metric'): string => {
    if (distance === 0) return '0 km';
    
    if (measurementSystem === 'metric') {
      return measurementSystem === 'metric' ? 
        `${distance.toFixed(1)} km` : 
        `${(distance * 0.621371).toFixed(1)} mi`;
    }
  };
  
  // Session management
  const {
    sessionState: {
      currentSession,
      availableSessions,
      pendingInvites,
      isInSolo,
      loading: sessionLoading
    },
    switchToSolo,
    switchToCollaborative,
    createCollaborativeSession,
    cancelSession,
    acceptInvite,
    declineInvite,
    revokeInvite
  } = useSessionManagement();

  // Format location display
  const formatLocation = (lat: number, lng: number): string => {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  };

  // Get user's current coordinates
  const getUserCoordinates = () => {
    if (latitude && longitude) {
      return { lat: latitude, lng: longitude };
    }
    // Default fallback coordinates (you might want to customize this)
    return { lat: 40.7128, lng: -74.0060 }; // NYC
  };

  // Load recommendations
  const loadRecommendations = async () => {
    if (!preferences || !user) return;
    
    setLoadingRecommendations(true);
    try {
      const coordinates = getUserCoordinates();
      
      // Convert app store preferences to API format
      const apiPreferences = {
        budget: {
          min: preferences.budget_min || 0,
          max: preferences.budget_max || 1000,
          perPerson: true
        },
        categories: preferences.categories || [],
        timeWindow: {
          kind: "Now" as const,
          start: null,
          end: null,
          timeOfDay: new Date().toTimeString().slice(0, 5)
        },
        travel: {
          mode: (preferences.travel_mode?.toUpperCase() || 'WALKING') as 'WALKING' | 'DRIVING' | 'TRANSIT',
          constraint: {
            type: (preferences.travel_constraint_type?.toUpperCase() || 'TIME') as 'TIME' | 'DISTANCE',
            maxMinutes: preferences.travel_constraint_value || 30
          }
        },
        origin: coordinates,
        units: 'imperial' as const
      };
      
      const response = await fetch('/api/recommendations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(apiPreferences),
      });

      if (!response.ok) {
        throw new Error('Failed to load recommendations');
      }

      const { cards } = await response.json();
      setRecommendations(cards);
    } catch (error) {
      console.error('Failed to load recommendations:', error);
      // Set empty array on error to show empty state
      setRecommendations([]);
    } finally {
      setLoadingRecommendations(false);
    }
  };

        // Load recommendations on mount and when preferences change
        useEffect(() => {
          loadRecommendations();
        }, [preferences, latitude, longitude]);

  // Handle card actions
  const handleInvite = (card: RecommendationCard) => {
    console.log('Invite clicked for card:', card.id);
    // TODO: Implement invite functionality
  };

  const handleSave = (card: RecommendationCard) => {
    console.log('Save clicked for card:', card.id);
    // TODO: Implement save functionality
  };

  const handleShare = (card: RecommendationCard) => {
    console.log('Share clicked for card:', card.id);
    // TODO: Implement share functionality
  };

  const handleViewRoute = (card: RecommendationCard) => {
    if (card.route?.mapsDeepLink) {
      window.open(card.route.mapsDeepLink, '_blank');
    }
  };

  // Convert store preferences to converter format
  const convertStorePrefsToConverterFormat = (storePrefs: Preferences) => {
    return {
      budgetRange: [storePrefs.budget_min, storePrefs.budget_max] as [number, number],
      categories: storePrefs.categories,
      time: storePrefs.datetime_pref || 'now',
      travel: storePrefs.travel_mode || 'drive',
      travelConstraint: storePrefs.travel_constraint_type as 'time' | 'distance',
      travelTime: storePrefs.travel_constraint_type === 'time' ? storePrefs.travel_constraint_value : 30,
      travelDistance: storePrefs.travel_constraint_type === 'distance' ? storePrefs.travel_constraint_value : 10,
      location: 'current',
      groupSize: storePrefs.people_count || 1,
    };
  };

  // Check if we should show recommendations and create preferences request
  const location = latitude && longitude ? { lat: latitude, lng: longitude } : null;
  
  const preferencesRequest = React.useMemo(() => {
    if (!preferences || !latitude || !longitude) return null;
    
    const convertedPrefs = convertStorePrefsToConverterFormat(preferences);
    return convertPreferencesToRequest(
      convertedPrefs, 
      latitude, 
      longitude,
      (profile?.measurement_system as 'metric' | 'imperial') || 'metric'
    );
  }, [preferences, latitude, longitude, profile?.measurement_system]);
  
  const shouldShowRecommendations = Boolean(preferencesRequest) && preferences && (
    preferences.categories.length > 0 || 
    preferences.budget_max > preferences.budget_min ||
    preferences.travel_constraint_value > 0
  );

  return (
    <Layout>
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/5">
        {/* Session Invites Notification */}
        {pendingInvites.length > 0 && (
          <div className="p-4">
            <SessionInviteNotifications
              invites={pendingInvites}
              onAccept={acceptInvite}
              onDecline={declineInvite}
              onRevoke={revokeInvite}
              loading={sessionLoading}
              currentUserId={user?.id}
            />
          </div>
        )}

        {/* Header Section */}
        <div className="px-4 py-8">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold mb-2">
                {isInSolo ? 'Solo Exploration' : 'Team Adventure'}
              </h1>
              <p className="text-muted-foreground">
                {isInSolo 
                  ? 'Discover amazing experiences tailored just for you'
                  : `Exploring together${currentSession ? ` in "${currentSession.name}"` : ''}`
                }
              </p>
            </div>

            {/* Session Status */}
            {currentSession && (
              <Card className="mb-6 border-primary/20 bg-primary/5">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
                        <Users className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium">{currentSession.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {currentSession.members.length} member{currentSession.members.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    <Badge variant="default">
                      {currentSession.status}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Current Location */}
            <Card className="mb-6">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <MapPin className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium">Current Location</p>
                    <p className="text-sm text-muted-foreground">
                      {locationLoading ? 'Getting location...' : 
                       locationError ? 'Location unavailable' :
                       latitude && longitude ? formatLocation(latitude, longitude) : 'Unknown'}
                    </p>
                  </div>
                </div>
                {locationError && (
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={getCurrentLocation}
                  >
                    <Navigation className="h-4 w-4 mr-1" />
                    Retry
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Preferences Summary */}
            {preferences && (
              <Card className="mb-6">
                <CardContent className="p-4">
                  <h3 className="font-medium mb-3">Your Preferences</h3>
                  <div className="flex flex-wrap gap-2">
                    {preferences.categories.map((category) => (
                      <Badge key={category} variant="secondary">
                        {category}
                      </Badge>
                    ))}
                    <Badge variant="outline">
                      <DollarSign className="h-3 w-3 mr-1" />
                      ${preferences.budget_min}-${preferences.budget_max}
                    </Badge>
                    <Badge variant="outline">
                      <Clock className="h-3 w-3 mr-1" />
                      {preferences.travel_constraint_value} {preferences.travel_constraint_type === 'time' ? 'min' : 'km'}
                    </Badge>
                    {preferences.datetime_pref && (
                      <Badge variant="outline">
                        <Calendar className="h-3 w-3 mr-1" />
                        {new Date(preferences.datetime_pref).toLocaleDateString()}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Recommendations Section */}
        <div className="px-4 pb-8">
          <div className="max-w-6xl mx-auto">
            {shouldShowRecommendations ? (
              <SingleCardResults
                preferences={preferencesRequest}
                onInvite={handleInvite}
                onSave={handleSave}
              />
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-muted flex items-center justify-center">
                    <MapPin className="w-12 h-12 text-muted-foreground" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">Set Your Preferences</h3>
                  <p className="text-muted-foreground mb-6">
                    Tell us what you're looking for to get personalized recommendations
                  </p>
                  <Button onClick={() => {
                    // This would open the preferences sheet
                    document.dispatchEvent(new CustomEvent('open-preferences'));
                  }}>
                    Set Preferences
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Home;