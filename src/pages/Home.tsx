import React, { useState, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  MapPin, 
  RefreshCw,
  Sliders,
  UserPlus
} from 'lucide-react';
import { HeaderControls } from '@/components/HeaderControls';
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
import minglaLogo from '@/assets/mingla-logo-new.png';

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

  // Create premium dating preferences request for recommendations
  const preferencesRequest = React.useMemo(() => {
    console.log('🎯 Building preferences request:', { preferences, latitude, longitude, profile });
    
    if (!latitude || !longitude) {
      console.log('⚠️ No location available, using default coordinates');
      return {
        budget: { min: 25, max: 150, perPerson: true },
        categories: ['sip', 'stroll', 'dine'],
        timeWindow: { kind: 'Now' as const },
        travel: { mode: 'DRIVING' as const, constraint: { type: 'TIME' as const, maxMinutes: 30 } },
        origin: { lat: latitude || 37.7749, lng: longitude || -122.4194 },
        units: (profile?.measurement_system as 'metric' | 'imperial') || 'metric'
      };
    }
    
    if (!preferences) {
      console.log('📍 No user preferences, using premium defaults with location');
      return {
        budget: { min: 25, max: 150, perPerson: true },
        categories: ['sip', 'stroll', 'dine'], 
        timeWindow: { kind: 'Now' as const },
        travel: { mode: 'DRIVING' as const, constraint: { type: 'TIME' as const, maxMinutes: 30 } },
        origin: { lat: latitude, lng: longitude },
        units: (profile?.measurement_system as 'metric' | 'imperial') || 'metric'
      };
    }
    
    console.log('✅ Converting user preferences:', preferences);
    const convertedPrefs = convertStorePrefsToConverterFormat(preferences);
    const finalRequest = convertPreferencesToRequest(
      convertedPrefs, 
      latitude, 
      longitude,
      (profile?.measurement_system as 'metric' | 'imperial') || 'metric'
    );
    
    console.log('🚀 Final preferences request:', finalRequest);
    return finalRequest;
  }, [preferences, latitude, longitude, profile?.measurement_system]);

  const handleInvite = async (card: RecommendationCard) => {
    if (isInSolo) {
      toast({
        title: "Create a collaboration",
        description: "Switch to collaborative mode to invite friends to activities",
      });
      return;
    }
    
    // TODO: Implement invite to activity functionality
    console.log('Invite to card:', card);
    toast({
      title: "Invite Sent",
      description: `Invited collaborators to "${card.title}"`,
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

  const handlePreferencesUpdate = (newPreferences: any) => {
    console.log('Updating preferences:', newPreferences);
    // Update preferences in the store - fix method name
    const { setPreferences } = useAppStore.getState();
    setPreferences(newPreferences);
    
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
          {/* Left Controls - Just Refresh */}
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
          </div>

          {/* Center Logo */}
          <div className="flex items-center justify-center">
            <img 
              src={minglaLogo} 
              alt="Mingla" 
              className="h-8 w-auto"
            />
          </div>

          {/* Right Controls - Preferences, Notifications, Session Mode, Invite */}
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="sm" 
              className="rounded-full w-12 h-12"
              onClick={() => setIsPreferencesOpen(true)}
              title="Open preferences"
            >
              <Sliders className="h-5 w-5" />
            </Button>
            <HeaderControls
              currentSession={currentSession}
              availableSessions={availableSessions}
              pendingInvites={pendingInvites || []}
              sentSessions={availableSessions.filter(s => s.createdBy === user?.id)}
              isInSolo={isInSolo}
              loading={sessionLoading}
              onSwitchToSolo={switchToSolo}
              onSwitchToCollaborative={switchToCollaborative}
              onCreateSession={async (participants: string[], sessionName: string) => {
                await createCollaborativeSession(participants, sessionName);
              }}
              onAcceptInvite={async (inviteId: string) => {
                await acceptInvite(inviteId);
              }}
              onDeclineInvite={async (inviteId: string) => {
                await declineInvite(inviteId);
              }}
              onRevokeInvite={async (inviteId: string) => {
                await revokeInvite(inviteId);
              }}
            />
            <Button 
              variant="ghost" 
              size="sm" 
              className="rounded-full w-12 h-12"
              onClick={() => {
                // TODO: Open friend invitation dialog
                toast({
                  title: "Invite Friends",
                  description: "Friend invitation system coming soon",
                });
              }}
              title="Invite friends"
            >
              <UserPlus className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Main Content - Premium Single Card Results */}
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md">
            {user ? (
              <SingleCardResults
                preferences={preferencesRequest}
                onInvite={handleInvite}
                onSave={handleSave}
              />
            ) : (
              <Card className="text-center p-8 bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
                <CardContent className="p-6">
                  <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                    <MapPin className="w-8 h-8 text-primary" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2 text-primary">Welcome to Mingla</h3>
                  <p className="text-muted-foreground mb-6">
                    Discover amazing date spots and activities near you. Set your preferences to get started.
                  </p>
                  <Button onClick={() => setIsPreferencesOpen(true)} className="bg-primary hover:bg-primary/90">
                    Set My Preferences
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