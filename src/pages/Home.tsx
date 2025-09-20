import React, { useState, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { 
  MapPin, 
  RefreshCw,
  Sliders,
  Bell,
  User,
  UserPlus
} from 'lucide-react';
import { SessionInviteNotifications } from '@/components/SessionInviteNotifications';
import SingleCardResults from '@/components/SingleCardResults';
import { PreferencesSheet } from '@/components/PreferencesSheet';
import { useAppStore, type Preferences } from '@/store/appStore';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useSessionManagement } from '@/hooks/useSessionManagement';
import { convertPreferencesToRequest } from '@/utils/preferencesConverter';
import type { RecommendationCard } from '@/types/recommendations';
import { toast } from '@/hooks/use-toast';

const Home = () => {
  const { user, preferences } = useAppStore();
  const { profile } = useUserProfile();
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  
  const { 
    latitude,
    longitude,
    loading: locationLoading, 
    error: locationError,
    getCurrentLocation 
  } = useGeolocation({
    autoStart: true
  });
  
  // Session management
  const sessionManagement = useSessionManagement();
  const {
    sessionState,
    switchToSolo,
    switchToCollaborative,
    createCollaborativeSession,
    cancelSession,
    acceptInvite,
    declineInvite,
    revokeInvite
  } = sessionManagement;

  const { currentSession, availableSessions, isInSolo, pendingInvites = [], loading: sessionLoading = false } = sessionState || {};

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

  // Create preferences request for recommendations
  const preferencesRequest = React.useMemo(() => {
    if (!preferences || !latitude || !longitude) {
      // Return default preferences if none set
      return {
        budget: { min: 10, max: 50, perPerson: true },
        categories: ['stroll', 'sip'],
        timeWindow: { kind: 'Now' as const },
        travel: { mode: 'DRIVING' as const, constraint: { type: 'TIME' as const, maxMinutes: 30 } },
        origin: { lat: latitude || 37.7749, lng: longitude || -122.4194 },
        units: 'metric' as const
      };
    }
    
    const convertedPrefs = convertStorePrefsToConverterFormat(preferences);
    return convertPreferencesToRequest(
      convertedPrefs, 
      latitude, 
      longitude,
      (profile?.measurement_system as 'metric' | 'imperial') || 'metric'
    );
  }, [preferences, latitude, longitude, profile?.measurement_system]);

  const handleInvite = (card: RecommendationCard) => {
    console.log('Invite to card:', card);
    toast({
      title: "Invitation Feature",
      description: "Collaboration invites will be implemented here",
    });
  };

  const handleSave = (card: RecommendationCard) => {
    console.log('Save card:', card);
    toast({
      title: "Saved",
      description: `"${card.title}" has been saved to your collection`,
    });
  };

  const handleRefresh = () => {
    console.log('Refreshing recommendations...');
    getCurrentLocation();
    toast({
      title: "Refreshed",
      description: "Getting new recommendations based on your current location",
    });
  };

  const handleNotifications = () => {
    console.log('Opening notifications...');
    toast({
      title: "Notifications",
      description: "Notification center will be implemented here",
    });
  };

  const handleProfile = () => {
    console.log('Opening profile...');
    toast({
      title: "Profile",
      description: "Profile settings will be implemented here",
    });
  };

  const handleInviteUsers = () => {
    console.log('Opening user invitation...');
    toast({
      title: "Invite Friends",
      description: "Friend invitation system will be implemented here",
    });
  };

  const handlePreferencesUpdate = (newPreferences: any) => {
    console.log('Updating preferences:', newPreferences);
    // Here you would update the preferences in the store
    toast({
      title: "Preferences Updated",
      description: "Your preferences have been saved successfully",
    });
    setIsPreferencesOpen(false);
  };

  // Listen for custom preference events
  useEffect(() => {
    const handleOpenPreferences = () => {
      setIsPreferencesOpen(true);
    };

    document.addEventListener('open-preferences', handleOpenPreferences);
    return () => {
      document.removeEventListener('open-preferences', handleOpenPreferences);
    };
  }, []);

  return (
    <Layout>
      <div className="min-h-screen bg-background flex flex-col">
        {/* Session Invites Notification */}
        {pendingInvites && pendingInvites.length > 0 && (
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

        {/* Header with Logo and Controls */}
        <div className="flex items-center justify-between p-4 border-b bg-background/95 backdrop-blur-sm">
          {/* Left Controls */}
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="sm" 
              className="rounded-full w-12 h-12"
              onClick={handleRefresh}
              title="Refresh recommendations"
            >
              <RefreshCw className="h-5 w-5" />
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              className="rounded-full w-12 h-12"
              onClick={() => setIsPreferencesOpen(true)}
              title="Open preferences"
            >
              <Sliders className="h-5 w-5" />
            </Button>
          </div>

          {/* Center Logo */}
          <div className="text-2xl font-bold text-primary">
            Mingla
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="sm" 
              className="rounded-full w-12 h-12"
              onClick={handleNotifications}
              title="Notifications"
            >
              <Bell className="h-5 w-5" />
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              className="rounded-full w-12 h-12"
              onClick={handleProfile}
              title="Profile"
            >
              <User className="h-5 w-5" />
            </Button>
            <Badge 
              variant="secondary" 
              className="px-3 py-1 rounded-full cursor-pointer"
              onClick={() => toast({ title: "Mode", description: "Session mode switching coming soon" })}
            >
              Solo
            </Badge>
            <Button 
              variant="ghost" 
              size="sm" 
              className="rounded-full w-12 h-12"
              onClick={handleInviteUsers}
              title="Invite friends"
            >
              <UserPlus className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Main Content - Single Card Results */}
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md">
            {user && (latitude || longitude) ? (
              <SingleCardResults
                preferences={preferencesRequest}
                onInvite={handleInvite}
                onSave={handleSave}
              />
            ) : (
              <Card className="text-center p-8">
                <CardContent className="p-6">
                  <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-muted flex items-center justify-center">
                    <MapPin className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">Set Your Preferences</h3>
                  <p className="text-muted-foreground mb-6">
                    Tell us what you're looking for to get personalized recommendations
                  </p>
                  <Button onClick={() => setIsPreferencesOpen(true)}>
                    Set Preferences
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Preferences Sheet */}
        <PreferencesSheet
          isOpen={isPreferencesOpen}
          onClose={() => setIsPreferencesOpen(false)}
          measurementSystem={profile?.measurement_system || 'metric'}
          onPreferencesUpdate={handlePreferencesUpdate}
        />
      </div>
    </Layout>
  );
};

export default Home;