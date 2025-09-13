import React, { useState, useEffect, useMemo } from 'react';
import { Sliders, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TripCard } from '@/components/TripCard';
import { TripCardExpanded } from '@/components/TripCardExpanded';
import { PreferencesSheet } from '@/components/PreferencesSheet';
import { CollaborationRequestDialog } from '@/components/CollaborationRequestDialog';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/hooks/useUserProfile';
import { formatCurrency } from '@/utils/currency';
import { getCategoryBySlug } from '@/lib/categories';
import { useExperiences } from '@/hooks/useExperiences';
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
  
  // Initialize with proper defaults that match the "default state" described
  const [activePreferences, setActivePreferences] = useState<ActivePreferences>({
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
  });

  // Memoize the category filter to prevent unnecessary re-renders
  const categoryFilters = useMemo(() => {
    return activePreferences.categories.length > 0 ? activePreferences.categories : undefined;
  }, [activePreferences.categories]);

  // Fetch experiences based on category preferences
  const { experiences, loading: experiencesLoading, error } = useExperiences(categoryFilters);

  // Convert experiences to trip format for cards
  const trips = experiences.map(exp => ({
    id: exp.id,
    title: exp.title,
    image: exp.image_url || 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085',
    cost: exp.price_min || 25,
    duration: `${exp.duration_min || 90} min`,
    travelTime: '8 min walk', // Default for now
    badges: ['Budget-Fit', 'Weather-OK'],
    whyItFits: 'Perfect match for your preferences based on location and category',
    location: 'Local Area',
    category: getCategoryBySlug(exp.category_slug)?.name || exp.category,
    latitude: exp.lat || 47.6062,
    longitude: exp.lng || -122.3321
  }));

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

  // Initialize preferences on mount to prevent glitching
  useEffect(() => {
    // Ensure preferences are set properly on first load
    setActivePreferences(prev => ({...prev}));
  }, []);

  const currentTrip = trips[currentTripIndex];
  const isLoading = experiencesLoading;

  const nextTrip = () => {
    if (currentTripIndex < trips.length - 1) {
      setCurrentTripIndex(currentTripIndex + 1);
    }
  };

  const handleSwipeRight = () => {
    if (currentTrip) {
      toast({
        title: "Experience saved!",
        description: `${currentTrip.title} added to your favorites`,
      });
    }
    nextTrip();
  };

  const handleSwipeLeft = () => {
    nextTrip();
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
              {activePreferences.isCollaborating 
                ? `Planning with ${activePreferences.activeCollaborators} others`
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
          location: activePreferences.location
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