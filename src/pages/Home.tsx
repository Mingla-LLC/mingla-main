import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Heart, X, Sliders, RefreshCw, Users, User, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TripCard } from '@/components/TripCard';
import { TripCardExpanded } from '@/components/TripCardExpanded';
import { PreferencesSheet } from '@/components/PreferencesSheet';
import { HeaderControls } from '@/components/HeaderControls';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useGeolocation } from '@/hooks/useGeolocation';
import { formatCurrency } from '@/utils/currency';
import { getCategoryBySlug } from '@/lib/categories';
import { useExperiences } from '@/hooks/useExperiences';
import { useSessionManagement } from '@/hooks/useSessionManagement';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import minglaLogo from '@/assets/mingla-logo.png';
import { cn } from '@/lib/utils';

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
  const [currentTripIndex, setCurrentTripIndex] = useState(0);
  const [showPreferences, setShowPreferences] = useState(false);
  const [expandedTrip, setExpandedTrip] = useState<string | null>(null);
  const [measurementSystem, setMeasurementSystem] = useState('metric');
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [showNotifications, setShowNotifications] = useState(true);
  
  const { profile } = useUserProfile();
  
  // Get user's current location
  const { 
    latitude, 
    longitude, 
    city, 
    country, 
    loading: locationLoading, 
    getCurrentLocation,
    formatLocation 
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
  
  // Helper function to calculate travel info based on constraint type
  const calculateTravelInfo = (fromLocation: string, toLat: number | null, toLng: number | null, travelMode: string, constraint: 'time' | 'distance'): string => {
    if (!toLat || !toLng) return constraint === 'time' ? '15 min' : '1.2 km';
    
    const travelTime = calculateTravelTime(fromLocation, toLat, toLng, travelMode);
    
    if (constraint === 'time') {
      const modeIcon = travelMode === 'walk' ? '🚶‍♀️' : travelMode === 'drive' ? '🚗' : '🚌';
      return `${travelTime} min ${modeIcon}`;
    } else {
      // Calculate distance based on time (rough approximation)
      const distance = travelMode === 'walk' ? travelTime * 0.08 : // ~5 km/h walking speed
                      travelMode === 'drive' ? travelTime * 0.5 : // ~30 km/h average city speed
                      travelTime * 0.3; // ~18 km/h public transport
      
      return measurementSystem === 'metric' ? 
        `${distance.toFixed(1)} km` : 
        `${(distance * 0.621371).toFixed(1)} mi`;
    }
  };
  
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

  // Wrapper function to handle session creation
  const handleCreateSession = async (participants: string[], sessionName: string): Promise<void> => {
    const result = await createCollaborativeSession(participants, sessionName);
    if (!result) {
      throw new Error('Failed to create session');
    }
  };
  
  // Initialize with proper defaults that match the "default state" described
  // Initialize with proper defaults and ensure stable state
  const [activePreferences, setActivePreferences] = useState<ActivePreferences>(() => ({
    budgetRange: [10, 10000],
    categories: [],
    experienceTypes: [],
    time: 'now',
    travel: 'drive',
    travelConstraint: 'time',
    travelTime: 15,
    travelDistance: 5,
    location: 'current',
    customLocation: '',
    custom_lat: null,
    custom_lng: null,
    groupSize: 2
  }));

  // Memoize all filters to prevent unnecessary re-renders
  const experienceFilters = useMemo(() => {
    return {
      categories: activePreferences.categories,
      budgetRange: activePreferences.budgetRange,
      groupSize: activePreferences.groupSize,
      time: activePreferences.time,
      travel: activePreferences.travel,
      travelTime: activePreferences.travelTime,
      travelDistance: activePreferences.travelDistance,
      location: activePreferences.location
    };
  }, [
    activePreferences.categories,
    activePreferences.budgetRange,
    activePreferences.groupSize,
    activePreferences.time,
    activePreferences.travel,
    activePreferences.travelTime,
    activePreferences.travelDistance,
    activePreferences.location
  ]);

  // Fetch experiences based on all preferences
  const { experiences, loading: experiencesLoading, error } = useExperiences(experienceFilters);

  // Convert experiences to trip format for cards
  // Fetch real places and events data
  const [realTrips, setRealTrips] = useState<any[]>([]);
  const [loadingRealData, setLoadingRealData] = useState(false);

  const fetchRealData = useCallback(async () => {
    if (!activePreferences) return;
    
    setLoadingRealData(true);
    try {
      // Get user's location coordinates (default to NYC if custom location not geocoded yet)
      let lat = 40.7589; // Default NYC
      let lng = -73.9851; // Default NYC
      
      // If user has geolocation enabled, use their current location
      if (activePreferences.location === 'current' && navigator.geolocation) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 5000,
              maximumAge: 300000
            });
          });
          lat = position.coords.latitude;
          lng = position.coords.longitude;
        } catch (error) {
          console.log('Could not get current location, using default');
        }
      }

      // Fetch places from Google Places API
      const placesPromises = activePreferences.categories.map(category => 
        supabase.functions.invoke('places', {
          body: {
            lat,
            lng,
            radiusMeters: activePreferences.travelConstraint === 'distance' 
              ? activePreferences.travelDistance * 1000 
              : 5000, // Default 5km radius
            category_slug: category
          }
        })
      );

      // Fetch events from Eventbrite
      const eventsPromise = supabase.functions.invoke('events', {
        body: { location: `${lat},${lng}` }
      });

      // Execute all API calls
      const [placesResults, eventsResult] = await Promise.all([
        Promise.all(placesPromises),
        eventsPromise
      ]);

      // Combine places and events
      let allExperiences: any[] = [];
      
      // Add places
      placesResults.forEach(result => {
        if (result.data && Array.isArray(result.data)) {
          allExperiences = allExperiences.concat(result.data);
        }
      });

      // Add events
      if (eventsResult.data && Array.isArray(eventsResult.data.events)) {
        allExperiences = allExperiences.concat(
          eventsResult.data.events.map((event: any) => ({
            ...event,
            category_slug: 'events',
            category: 'Events'
          }))
        );
      }

      // Filter by budget
      const budgetFiltered = allExperiences.filter(exp => {
        const price = exp.price_min || 0;
        return price >= activePreferences.budgetRange[0] && price <= activePreferences.budgetRange[1];
      });

      // Convert to trip format
      const formattedTrips = budgetFiltered.slice(0, 10).map(exp => {
        const experienceDuration = exp.duration_min || 90;
        const estimatedTravelTime = calculateTravelTime(
          activePreferences.location,
          exp.lat,
          exp.lng,
          activePreferences.travel
        );
        const totalDuration = experienceDuration + (estimatedTravelTime * 2);
        
        const formatDuration = (minutes: number) => {
          if (minutes >= 60) {
            const hours = Math.floor(minutes / 60);
            const remainingMinutes = minutes % 60;
            return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
          }
          return `${minutes}m`;
        };

        const travelInfo = calculateTravelInfo(
          activePreferences.location,
          exp.lat,
          exp.lng,
          activePreferences.travel,
          activePreferences.travelConstraint
        );

        return {
          id: exp.id || `exp_${Date.now()}_${Math.random()}`,
          title: exp.title || exp.name || 'Untitled Experience',
          image: exp.image_url || exp.photo || 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085',
          cost: exp.price_min || exp.price || 25,
          duration: formatDuration(totalDuration),
          travelTime: travelInfo,
          badges: [`${activePreferences.travel === 'walk' ? '🚶‍♀️' : activePreferences.travel === 'drive' ? '🚗' : '🚌'} ${travelInfo}`, `💰 ${formatCurrency(exp.price_min || exp.price || 25, profile?.currency || 'USD')}`],
          whyItFits: `Perfect for ${activePreferences.groupSize === 1 ? 'solo' : `groups of ${activePreferences.groupSize}`} ${activePreferences.travel === 'walk' ? 'walking' : activePreferences.travel === 'drive' ? 'driving' : 'taking public transport'} ${travelInfo}. ${getCategoryBySlug(exp.category_slug)?.name || exp.category} experience matching your ${formatCurrency(activePreferences.budgetRange[0], profile?.currency || 'USD')}-${formatCurrency(activePreferences.budgetRange[1], profile?.currency || 'USD')} budget.`,
          location: exp.formatted_address || exp.location || 'Unknown Location',
          category: getCategoryBySlug(exp.category_slug)?.name || exp.category || 'Experience',
          latitude: exp.lat || lat,
          longitude: exp.lng || lng
        };
      });

      setRealTrips(formattedTrips);
    } catch (error) {
      console.error('Error fetching real data:', error);
      // Fallback to experiences data
      setRealTrips([]);
    } finally {
      setLoadingRealData(false);
    }
  }, [activePreferences]);

  // Fetch real data when preferences change
  useEffect(() => {
    fetchRealData();
  }, [fetchRealData]);

  const trips = useMemo(() => {
    if (realTrips.length > 0) {
      return realTrips;
    }
    
    // Fallback to experiences data
    return experiences.map(exp => {
      const experienceDuration = exp.duration_min || 90;
      const estimatedTravelTime = calculateTravelTime(
        activePreferences.location,
        exp.lat,
        exp.lng,
        activePreferences.travel
      );
      const totalDuration = experienceDuration + (estimatedTravelTime * 2);
      
      const formatDuration = (minutes: number) => {
        if (minutes >= 60) {
          const hours = Math.floor(minutes / 60);
          const remainingMinutes = minutes % 60;
          return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
        }
        return `${minutes}m`;
      };
      
      const travelInfo = calculateTravelInfo(
        activePreferences.location,
        exp.lat,
        exp.lng,
        activePreferences.travel,
        activePreferences.travelConstraint
      );
      
      const getLocationName = (lat: number, lng: number) => {
        if (Math.abs(lat - 40.7829) < 0.01 && Math.abs(lng - (-73.9654)) < 0.01) {
          return 'Central Park, NYC';
        } else if (Math.abs(lat - 40.7505) < 0.01 && Math.abs(lng - (-73.9934)) < 0.01) {
          return 'Hudson River Park, NYC';
        } else if (Math.abs(lat - 40.7614) < 0.01 && Math.abs(lng - (-73.9776)) < 0.01) {
          return 'Times Square, NYC';
        } else if (Math.abs(lat - 40.7505) < 0.01 && Math.abs(lng - (-73.9857)) < 0.01) {
          return 'Hell\'s Kitchen, NYC';
        } else if (Math.abs(lat - 40.7357) < 0.01 && Math.abs(lng - (-74.0036)) < 0.01) {
          return 'West Village, NYC';
        } else if (Math.abs(lat - 40.7549) < 0.01 && Math.abs(lng - (-73.9840)) < 0.01) {
          return 'Theater District, NYC';
        } else if (Math.abs(lat - 40.7580) < 0.01 && Math.abs(lng - (-73.9855)) < 0.01) {
          return 'Midtown Manhattan, NYC';
        } else {
          return 'Manhattan, NYC';
        }
      };

      return {
        id: exp.id,
        title: exp.title,
        image: exp.image_url || 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085',
        cost: exp.price_min || 25,
        duration: formatDuration(totalDuration),
        travelTime: travelInfo,
        badges: [`${activePreferences.travel === 'walk' ? '🚶‍♀️' : activePreferences.travel === 'drive' ? '🚗' : '🚌'} ${travelInfo}`, `💰 ${formatCurrency(exp.price_min || 25, profile?.currency || 'USD')}`],
        whyItFits: `Perfect for ${activePreferences.groupSize === 1 ? 'solo' : `groups of ${activePreferences.groupSize}`} ${activePreferences.travel === 'walk' ? 'walking' : activePreferences.travel === 'drive' ? 'driving' : 'taking public transport'} ${travelInfo}. ${getCategoryBySlug(exp.category_slug)?.name || exp.category} experience matching your budget preferences.`,
        location: getLocationName(exp.lat || 40.7589, exp.lng || -73.9851),
        category: getCategoryBySlug(exp.category_slug)?.name || exp.category,
        latitude: exp.lat || 47.6062,
        longitude: exp.lng || -122.3321
      };
    });
  }, [realTrips, experiences, activePreferences.location, activePreferences.travel, activePreferences.travelConstraint]);

  // Get sent sessions (where user is the creator)
  const sentSessions = availableSessions.filter(session => 
    session.invitedBy === user?.id && 
    (session.status === 'pending' || session.status === 'dormant')
  );

  const currentTrip = trips[currentTripIndex];
  const isLoading = experiencesLoading || sessionLoading || loadingRealData;

  const nextTrip = () => {
    if (currentTripIndex < trips.length - 1) {
      setCurrentTripIndex(currentTripIndex + 1);
    }
  };

  const handleSwipeRight = async () => {
    if (currentTrip) {
      // Actually save the experience
      const { writeThroughHelpers } = await import('@/store/writeThroughHelpers');
      const result = await writeThroughHelpers.likeExperience(currentTrip.id);
      
      if (result.success) {
        toast({
          title: "Experience saved!",
          description: `${currentTrip.title} added to your favorites`,
        });
      } else {
        toast({
          title: "Error",
          description: result.error || "Failed to save experience",
          variant: "destructive"
        });
      }
    }
    nextTrip();
  };

  const handleSwipeLeft = () => {
    nextTrip();
  };

  // Handle session invite actions
  const handleAcceptInvite = async (sessionId: string) => {
    await switchToCollaborative(sessionId);
  };

  const handleDeclineInvite = async (sessionId: string) => {
    await cancelSession(sessionId);
  };

  const handleCancelSession = async (sessionId: string) => {
    await cancelSession(sessionId);
  };

  // Add function to accept/finalize experience
  const acceptExperience = async (experienceId: string, scheduledDate?: Date) => {
    const { writeThroughHelpers } = await import('@/store/writeThroughHelpers');
    const result = await writeThroughHelpers.scheduleExperience(
      experienceId, 
      scheduledDate ? scheduledDate.toISOString() : new Date().toISOString()
    );
    
    if (result.success) {
      toast({
        title: "Experience accepted!",
        description: "Added to your calendar",
      });
    } else {
      toast({
        title: "Error",
        description: result.error || "Failed to accept experience",
        variant: "destructive"
      });
    }
  };

  const removeCategory = (categorySlug: string) => {
    setActivePreferences(prev => ({
      ...prev,
      categories: prev.categories.filter(c => c !== categorySlug)
    }));
    toast({
      title: "Preference updated",
      description: `${getCategoryBySlug(categorySlug)?.name || categorySlug} removed`,
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 relative overflow-hidden touch-optimized">
      {/* Background Pattern */}
      <div className="fixed inset-0 opacity-[0.02] pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.1),transparent_50%)]" />
      </div>

      {/* Header */}
      <div className="relative z-10 px-6 pt-safe pb-6">
        <div className="flex items-center justify-center mb-6">
          <img 
            src={minglaLogo} 
            alt="Mingla" 
            className="h-12 w-auto"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
              const fallback = document.createElement('div');
              fallback.className = 'text-3xl font-bold text-primary';
              fallback.textContent = 'Mingla';
              target.parentElement?.appendChild(fallback);
            }}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchRealData}
              disabled={isLoading}
              className="bg-background/80 backdrop-blur-sm border-primary/20"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPreferences(true)}
              className="bg-background/80 backdrop-blur-sm border-primary/20"
            >
              <Sliders className="h-4 w-4" />
            </Button>
          </div>
          
        <HeaderControls
          currentSession={currentSession}
          availableSessions={availableSessions}
          isInSolo={isInSolo}
          onSwitchToSolo={switchToSolo}
          onSwitchToCollaborative={switchToCollaborative}
          onCreateSession={handleCreateSession}
          pendingInvites={pendingInvites}
          sentSessions={sentSessions}
          onAcceptInvite={handleAcceptInvite}
          onDeclineInvite={handleDeclineInvite}
          onCancelSession={handleCancelSession}
          loading={sessionLoading}
        />
        </div>
      </div>

      {/* Premium Content Grid - Content moved to header */}
      
      {/* Premium Experience Card */}
      <div className="flex-1 flex items-center justify-center px-6 py-6">
        {currentTrip ? (
          <div className="relative w-full max-w-sm">
            {/* Premium card with dating app styling */}
            <Card className="relative overflow-hidden bg-gradient-to-br from-card to-card/80 backdrop-blur-sm border-primary/10 shadow-xl">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-accent/5" />
              <CardContent className="p-0 relative">
                <div className="relative">
                  <img
                    src={currentTrip.image}
                    alt={currentTrip.title}
                    className="w-full h-96 object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  
                  {/* Floating badges */}
                  <div className="absolute top-4 left-4 flex flex-wrap gap-2">
                    {currentTrip.badges?.slice(0, 2).map((badge, index) => (
                      <Badge 
                        key={index} 
                        variant="default" 
                        className="bg-black/80 text-white backdrop-blur-sm text-xs font-medium border border-white/20 shadow-lg"
                      >
                        {badge}
                      </Badge>
                    ))}
                  </div>

                  {/* Session indicator */}
                  <div className="absolute top-4 right-4">
                    <Badge 
                      variant={isInSolo ? "outline" : "default"} 
                      className={cn(
                        "backdrop-blur-sm text-xs font-medium border shadow-lg",
                        isInSolo 
                          ? "bg-black/80 text-white border-white/20" 
                          : "bg-primary text-primary-foreground border-primary/20"
                      )}
                    >
                      {isInSolo ? (
                        <>
                          <User className="h-3 w-3 mr-1" />
                          Solo
                        </>
                      ) : (
                        <>
                          <Users className="h-3 w-3 mr-1" />
                          {currentSession?.participants.length}
                        </>
                      )}
                    </Badge>
                  </div>

                  {/* Content overlay */}
                  <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
                    <h2 className="text-2xl font-bold mb-2">{currentTrip.title}</h2>
                    <div className="flex items-center gap-4 text-sm opacity-90 mb-3">
                      <span className="flex items-center gap-1">
                        <Sparkles className="h-4 w-4" />
                        {formatCurrency(currentTrip.cost, profile?.currency || 'USD')}
                      </span>
                      <span>{currentTrip.duration}</span>
                      <span>{currentTrip.travelTime}</span>
                    </div>
                    <p className="text-sm opacity-80 line-clamp-2">
                      {currentTrip.whyItFits}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Action buttons - dating app style */}
            <div className="flex justify-center gap-6 mt-8">
              <Button
                size="lg"
                variant="outline"
                onClick={handleSwipeLeft}
                className="w-16 h-16 rounded-full border-2 border-muted hover:border-destructive hover:bg-destructive/10 group"
              >
                <X className="h-6 w-6 group-hover:text-destructive" />
              </Button>
              
              <Button
                size="lg"
                onClick={() => setExpandedTrip(currentTrip.id)}
                className="w-20 h-16 rounded-full bg-primary/10 hover:bg-primary/20 text-primary border-2 border-primary/20"
              >
                <Sparkles className="h-6 w-6" />
              </Button>

              <Button
                size="lg"
                onClick={handleSwipeRight}
                className="w-16 h-16 rounded-full bg-primary hover:bg-primary/90 group"
              >
                <Heart className="h-6 w-6 text-white fill-current" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="w-24 h-24 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <Sparkles className="h-12 w-12 text-primary" />
            </div>
            <h3 className="text-2xl font-bold mb-3">All caught up!</h3>
            <p className="text-muted-foreground mb-6 max-w-md">
              You've explored all available experiences. Adjust your preferences to discover more amazing places!
            </p>
            <Button 
              onClick={() => setShowPreferences(true)}
              className="bg-primary hover:bg-primary/90"
            >
              <Sliders className="h-4 w-4 mr-2" />
              Update Preferences
            </Button>
          </div>
        )}
      </div>

      {/* Expanded Trip Card */}
      {expandedTrip && (
        <TripCardExpanded
          trip={trips.find(t => t.id === expandedTrip)!}
          isOpen={!!expandedTrip}
          onClose={() => setExpandedTrip(null)}
          onAccept={() => {
            const trip = trips.find(t => t.id === expandedTrip);
            if (trip) {
              acceptExperience(trip.id);
            }
            setExpandedTrip(null);
          }}
          onAddToBoard={() => {
            // Handle add to board logic
            setExpandedTrip(null);
          }}
          showAcceptButton={true}
        />
      )}

      {/* Preferences Sheet */}
      <PreferencesSheet
        isOpen={showPreferences}
        onClose={() => setShowPreferences(false)}
        activePreferences={activePreferences}
        onPreferencesUpdate={setActivePreferences}
      />
    </div>
  );
};

export default Home;