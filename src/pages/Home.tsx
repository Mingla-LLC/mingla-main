import React, { useState, useEffect, useMemo } from 'react';
import { Sliders, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TripCard } from '@/components/TripCard';
import { TripCardExpanded } from '@/components/TripCardExpanded';
import { PreferencesSheet } from '@/components/PreferencesSheet';
import { CollaborationRequestDialog } from '@/components/CollaborationRequestDialog';
import { SessionSwitcher } from '@/components/SessionSwitcher';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/hooks/useUserProfile';
import { formatCurrency } from '@/utils/currency';
import { getCategoryBySlug } from '@/lib/categories';
import { useExperiences } from '@/hooks/useExperiences';
import { useSessionManagement } from '@/hooks/useSessionManagement';
import type { User } from '@supabase/supabase-js';

interface ActivePreferences {
  budgetRange: [number, number];
  categories: string[];
  time: string;
  travel: string;
  travelConstraint: 'time' | 'distance';
  travelTime: number;
  travelDistance: number;
  location: string;
  isCollaborating: boolean;
  activeCollaborators: number;
  activeCollaboratorsList: Array<{
    id: string;
    username: string;
    name: string;
    avatar: string;
    initials: string;
  }>;
}

const Home = () => {
  const [currentTripIndex, setCurrentTripIndex] = useState(0);
  const [showPreferences, setShowPreferences] = useState(false);
  const [expandedTrip, setExpandedTrip] = useState<string | null>(null);
  const [showCollaborationRequests, setShowCollaborationRequests] = useState(false);
  const [measurementSystem, setMeasurementSystem] = useState('metric');
  const [user, setUser] = useState<User | null>(null);
  const { profile } = useUserProfile();
  
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
    sessionState,
    switchToSolo,
    switchToCollaborative,
    getSwipeContext,
    canSwitchToSolo,
    isInSolo,
    currentSession,
    availableSessions
  } = useSessionManagement();
  
  // Initialize with proper defaults that match the "default state" described
  // Initialize with proper defaults and ensure stable state
  const [activePreferences, setActivePreferences] = useState<ActivePreferences>(() => ({
    budgetRange: [10, 10000], // Any budget
    categories: [], // Freestyle - empty array means show all categories
    time: 'now',
    travel: 'drive',
    travelConstraint: 'time',
    travelTime: 15,
    travelDistance: 5,
    location: 'current',
    isCollaborating: false,
    activeCollaborators: 0,
    activeCollaboratorsList: []
  }));

  // Memoize all filters to prevent unnecessary re-renders
  const experienceFilters = useMemo(() => {
    if (activePreferences.isCollaborating && activePreferences.activeCollaboratorsList.length > 0) {
      // In collaborative mode, create collaborative preferences
      const collaborativePreferences = activePreferences.activeCollaboratorsList.map(collaborator => ({
        id: collaborator.id,
        categories: activePreferences.categories, // In real app, this would come from each user's preferences
        budgetRange: activePreferences.budgetRange,
        time: activePreferences.time,
        travel: activePreferences.travel,
        travelTime: activePreferences.travelTime,
        location: activePreferences.location
      }));

      return {
        collaborativePreferences,
        groupSize: activePreferences.activeCollaborators,
        time: activePreferences.time,
        travel: activePreferences.travel,
        travelTime: activePreferences.travelTime,
        travelDistance: activePreferences.travelDistance,
        location: activePreferences.location
      };
    } else {
      // Solo mode - use individual preferences
      return {
        categories: activePreferences.categories.length > 0 ? activePreferences.categories : undefined,
        budgetRange: activePreferences.budgetRange,
        groupSize: 1, // Solo mode always has group size of 1
        time: activePreferences.time,
        travel: activePreferences.travel,
        travelTime: activePreferences.travelTime,
        travelDistance: activePreferences.travelDistance,
        location: activePreferences.location
      };
    }
  }, [
    activePreferences.categories,
    activePreferences.budgetRange,
    activePreferences.activeCollaborators,
    activePreferences.activeCollaboratorsList,
    activePreferences.isCollaborating,
    activePreferences.time,
    activePreferences.travel,
    activePreferences.travelTime,
    activePreferences.travelDistance,
    activePreferences.location
  ]);

  // Fetch experiences based on all preferences
  const { experiences, loading: experiencesLoading, error } = useExperiences(experienceFilters);

  // Convert experiences to trip format for cards
  const trips = useMemo(() => 
    experiences.map(exp => {
      // Calculate total date duration (experience + travel time)
      const experienceDuration = exp.duration_min || 90;
      const estimatedTravelTime = calculateTravelTime(
        activePreferences.location,
        exp.lat,
        exp.lng,
        activePreferences.travel
      );
      const totalDuration = experienceDuration + (estimatedTravelTime * 2); // Round trip
      
      // Format duration
      const formatDuration = (minutes: number) => {
        if (minutes >= 60) {
          const hours = Math.floor(minutes / 60);
          const remainingMinutes = minutes % 60;
          return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
        }
        return `${minutes}m`;
      };
      
      // Calculate distance or time based on travel constraint
      const travelInfo = calculateTravelInfo(
        activePreferences.location,
        exp.lat,
        exp.lng,
        activePreferences.travel,
        activePreferences.travelConstraint
      );
      
      return {
        id: exp.id,
        title: exp.title,
        image: exp.image_url || 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085',
        cost: exp.price_min || 25,
        duration: formatDuration(totalDuration),
        travelTime: travelInfo,
        badges: ['Budget-Fit', 'Weather-OK'],
        whyItFits: 'Perfect match for your preferences based on location and category',
        location: 'Local Area',
        category: getCategoryBySlug(exp.category_slug)?.name || exp.category,
        latitude: exp.lat || 47.6062,
        longitude: exp.lng || -122.3321
      };
    }), [experiences, activePreferences.location, activePreferences.travel, activePreferences.travelConstraint]);

  const [collaborationRequests, setCollaborationRequests] = useState<Array<{
    id: string;
    from: {
      id: string;
      name: string;
      avatar: string;
      username: string;
    };
    tripTitle: string;
    timestamp: string;
    status: 'pending' | 'accepted' | 'declined';
  }>>([
    {
      id: '1',
      from: {
        id: 'user1',
        name: 'Emma Wilson',
        avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80',
        username: 'emmawilson'
      },
      tripTitle: 'Art Gallery & Wine Tasting',
      timestamp: '2 hours ago',
      status: 'pending'
    },
    {
      id: '2',
      from: {
        id: 'user2',
        name: 'James Rodriguez',
        avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e',
        username: 'jamesrodriguez'
      },
      tripTitle: 'Rooftop Brunch & Views',
      timestamp: '1 day ago',
      status: 'pending'
    }
  ]);

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    };
    getUser();
  }, []);

  const currentTrip = trips[currentTripIndex];
  const isLoading = experiencesLoading;

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

  const handleAcceptRequest = (requestId: string) => {
    setCollaborationRequests(prev => 
      prev.map(req => 
        req.id === requestId 
          ? { ...req, status: 'accepted' as const }
          : req
      )
    );
    toast({
      title: "Collaboration accepted",
      description: "You've joined the experience!",
    });
  };

  const handleDeclineRequest = (requestId: string) => {
    setCollaborationRequests(prev => 
      prev.map(req => 
        req.id === requestId 
          ? { ...req, status: 'declined' as const }
          : req
      )
    );
  };

  const pendingRequests = collaborationRequests.filter(req => req.status === 'pending');

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center px-6">
          <h3 className="text-lg font-semibold mb-2">Something went wrong</h3>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button onClick={() => window.location.reload()}>
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Notification Bar for Collaboration Requests */}
      {pendingRequests.length > 0 && (
        <div className="bg-primary text-primary-foreground px-4 py-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {pendingRequests.length} collaboration request{pendingRequests.length > 1 ? 's' : ''}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowCollaborationRequests(true)}
              className="text-primary-foreground hover:bg-primary-foreground/20"
            >
              View
            </Button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-6 pt-12 pb-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">
              {user ? `Hi, ${profile?.first_name || 'there'}!` : 'Discover'}
            </h1>
            <p className="text-muted-foreground">
              {!isInSolo && currentSession
                ? `Planning with ${currentSession.participants.length} others`
                : 'Find your next perfect experience'
              }
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="icon" onClick={() => window.location.reload()}>
              <RefreshCw className="h-5 w-5" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setShowPreferences(true)}
            >
              <Sliders className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Session Switcher */}
        <SessionSwitcher
          isInSolo={isInSolo}
          currentSession={currentSession}
          availableSessions={availableSessions}
          onSwitchToSolo={switchToSolo}
          onSwitchToCollaborative={switchToCollaborative}
          canSwitchToSolo={canSwitchToSolo()}
        />

        {/* Active Preferences Display */}
        {(activePreferences.budgetRange[0] !== 10 || activePreferences.budgetRange[1] !== 10000 || 
          activePreferences.categories.length > 0 || activePreferences.time !== 'now' || 
          activePreferences.travel !== 'drive' || activePreferences.travelTime !== 15 || 
          activePreferences.location !== 'current' || activePreferences.isCollaborating) && (
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {/* Budget Preference */}
            {(activePreferences.budgetRange[0] !== 10 || activePreferences.budgetRange[1] !== 10000) && (
              <div className="flex items-center gap-1 px-2 py-1 bg-muted/50 rounded-full">
                <div className="w-4 h-4 rounded-full bg-gradient-to-r from-green-400 to-emerald-500 flex items-center justify-center">
                  <span className="text-xs">💰</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatCurrency(activePreferences.budgetRange[0], profile?.currency || 'USD')} - {formatCurrency(activePreferences.budgetRange[1], profile?.currency || 'USD')}
                </span>
                <button 
                  className="ml-1 hover:bg-destructive/20 rounded-full p-0.5 transition-colors"
                  onClick={() => {
                    setActivePreferences(prev => ({ ...prev, budgetRange: [10, 10000] as [number, number] }));
                    toast({
                      title: "Preference updated",
                      description: "Budget filter removed",
                    });
                  }}
                >
                  <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            )}
            
            {/* Categories Preferences */}
            {activePreferences.categories.slice(0, 6).map((categorySlug, index) => {
              const category = getCategoryBySlug(categorySlug);
              return (
                <div key={categorySlug} className="flex items-center gap-1 px-2 py-1 bg-muted/50 rounded-full">
                  <div className="w-4 h-4 rounded-full bg-gradient-to-r from-purple-400 to-pink-500 flex items-center justify-center">
                    <span className="text-xs">✨</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{category?.name || categorySlug}</span>
                  <button 
                    className="ml-1 hover:bg-destructive/20 rounded-full p-0.5 transition-colors"
                    onClick={() => removeCategory(categorySlug)}
                  >
                    <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              );
            })}

            {/* Time Preference */}
            {activePreferences.time !== 'now' && (
              <div className="flex items-center gap-1 px-2 py-1 bg-muted/50 rounded-full">
                <div className="w-4 h-4 rounded-full bg-gradient-to-r from-blue-400 to-indigo-500 flex items-center justify-center">
                  <span className="text-xs">🕐</span>
                </div>
                <span className="text-xs text-muted-foreground">{activePreferences.time}</span>
                <button 
                  className="ml-1 hover:bg-destructive/20 rounded-full p-0.5 transition-colors"
                  onClick={() => {
                    setActivePreferences(prev => ({ ...prev, time: 'now' }));
                    toast({
                      title: "Preference updated",
                      description: "Time filter removed",
                    });
                  }}
                >
                  <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            )}

            {/* Travel Mode Preference */}
            {activePreferences.travel !== 'drive' && (
              <div className="flex items-center gap-1 px-2 py-1 bg-muted/50 rounded-full">
                <div className="w-4 h-4 rounded-full bg-gradient-to-r from-orange-400 to-red-500 flex items-center justify-center">
                  <span className="text-xs">🚗</span>
                </div>
                <span className="text-xs text-muted-foreground">{activePreferences.travel}</span>
                <button 
                  className="ml-1 hover:bg-destructive/20 rounded-full p-0.5 transition-colors"
                  onClick={() => {
                    setActivePreferences(prev => ({ ...prev, travel: 'drive' }));
                    toast({
                      title: "Preference updated",
                      description: "Travel mode reset to drive",
                    });
                  }}
                >
                  <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            )}

            {/* Travel Constraint Preference */}
            {activePreferences.travelTime !== 15 && (
              <div className="flex items-center gap-1 px-2 py-1 bg-muted/50 rounded-full">
                <div className="w-4 h-4 rounded-full bg-gradient-to-r from-teal-400 to-cyan-500 flex items-center justify-center">
                  <span className="text-xs">⏱️</span>
                </div>
                <span className="text-xs text-muted-foreground">{activePreferences.travelTime} min</span>
                <button 
                  className="ml-1 hover:bg-destructive/20 rounded-full p-0.5 transition-colors"
                  onClick={() => {
                    setActivePreferences(prev => ({ ...prev, travelTime: 15 }));
                    toast({
                      title: "Preference updated",
                      description: "Travel time reset to 15 minutes",
                    });
                  }}
                >
                  <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            )}

            {/* Location Preference */}
            {activePreferences.location !== 'current' && (
              <div className="flex items-center gap-1 px-2 py-1 bg-muted/50 rounded-full">
                <div className="w-4 h-4 rounded-full bg-gradient-to-r from-pink-400 to-rose-500 flex items-center justify-center">
                  <span className="text-xs">📍</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {activePreferences.location === 'manual' ? 'Custom location' : activePreferences.location}
                </span>
                <button 
                  className="ml-1 hover:bg-destructive/20 rounded-full p-0.5 transition-colors"
                  onClick={() => {
                    setActivePreferences(prev => ({ ...prev, location: 'current' }));
                    toast({
                      title: "Preference updated",
                      description: "Location reset to current",
                    });
                  }}
                >
                  <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            )}

            {/* Collaboration Mode Indicator */}
            {activePreferences.isCollaborating && (
              <div className="flex items-center gap-1 px-2 py-1 bg-primary/10 rounded-full">
                <div className="w-4 h-4 rounded-full bg-gradient-to-r from-primary to-primary-dark flex items-center justify-center">
                  <span className="text-xs">👥</span>
                </div>
                <span className="text-xs text-primary font-medium">
                  Collaborating ({activePreferences.activeCollaborators})
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 px-6">
        {/* Content */}
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading experiences...</p>
            </div>
          </div>
        ) : trips.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center px-6">
              <h3 className="text-lg font-semibold mb-2">No experiences found</h3>
              <p className="text-muted-foreground mb-4">
                Try adjusting your preferences to see more options, or check back later for new experiences.
              </p>
              <Button 
                onClick={() => setShowPreferences(true)}
                variant="outline"
              >
                Update Preferences
              </Button>
            </div>
          </div>
        ) : currentTrip ? (
          <div className="space-y-4">
            <TripCard
              trip={currentTrip}
              onSwipeRight={handleSwipeRight}
              onSwipeLeft={handleSwipeLeft}
              onExpand={() => setExpandedTrip(currentTrip.id)}
            />
            <p className="text-center text-muted-foreground">
              {currentTripIndex + 1} of {trips.length} experiences
            </p>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center px-6">
              <h3 className="text-lg font-semibold mb-2">That's all for now!</h3>
              <p className="text-muted-foreground mb-4">
                Check back later for more experiences, or adjust your preferences to see different options.
              </p>
              <Button 
                onClick={() => setCurrentTripIndex(0)}
                variant="outline"
                className="mr-2"
              >
                Start Over
              </Button>
              <Button onClick={() => setShowPreferences(true)}>
                Update Preferences
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Preferences Sheet */}
      <PreferencesSheet
        isOpen={showPreferences}
        onClose={() => setShowPreferences(false)}
        measurementSystem={measurementSystem}
        activePreferences={{
          ...activePreferences,
          travelConstraint: activePreferences.travelConstraint,
          travelTime: activePreferences.travelTime,
          travelDistance: activePreferences.travelDistance,
          location: activePreferences.location,
          isCollaborating: !isInSolo,
          activeCollaborators: currentSession?.participants.length || 0,
          activeCollaboratorsList: currentSession?.participants.map(p => ({
            id: p.id,
            username: p.username,
            name: p.name,
            avatar: p.avatar,
            initials: p.name.split(' ').map(n => n[0]).join('')
          })) || []
        }}
        onPreferencesUpdate={(preferences) => {
          setActivePreferences({
            ...preferences,
            travelConstraint: preferences.travelConstraint || 'time',
            travelTime: preferences.travelTime || 15,
            travelDistance: preferences.travelDistance || 5,
            location: preferences.location || 'current'
          });
          // Reset to first trip when preferences change
          setCurrentTripIndex(0);
        }}
      />

      {/* Expanded Trip Modal */}
      {expandedTrip && currentTrip && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm">
            <TripCardExpanded
              trip={currentTrip}
              isOpen={true}
              onClose={() => setExpandedTrip(null)}
              onAccept={handleSwipeRight}
              showAcceptButton={true}
            />
          </div>
        </div>
      )}

      {/* Collaboration Requests Dialog */}
      <CollaborationRequestDialog
        isOpen={showCollaborationRequests}
        onClose={() => setShowCollaborationRequests(false)}
        requests={collaborationRequests}
        onAcceptRequest={handleAcceptRequest}
        onDeclineRequest={handleDeclineRequest}
      />
    </div>
  );
};

export default Home;