import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppStore } from '../store/appStore';
import { useNavigation } from '../contexts/NavigationContext';
import { useSessionManagement } from '../hooks/useSessionManagement';
import { useUserProfile } from '../hooks/useUserProfile';
import { RecommendationsGrid } from '../components/RecommendationsGrid';
import { HeaderControls } from '../components/HeaderControls';
import { PreferencesSheet } from '../components/PreferencesSheet';
import { ToastProvider } from '../components/ToastManager';
import { convertPreferencesToRequest } from '../utils/preferencesConverter';
import { convertCostToNumber } from '../utils/costConverter';
import { ActivePreferences, RecommendationCard } from '../types';
import { supabase } from '../services/supabase';
import { enhancedLocationTrackingService } from '../services/enhancedLocationTrackingService';

export default function HomeScreen() {
  const { user, currentSession, isInSolo, preferences } = useAppStore();
  const { profile, refreshProfile } = useUserProfile();
  const { 
    openCreateSessionModal, 
    openSessionSwitcher, 
    openPreferencesModal,
    isPreferencesModalOpen,
    closePreferencesModal
  } = useNavigation();

  
  const { 
    currentSession: sessionCurrentSession,
    availableSessions,
    pendingInvites,
    isInSolo: sessionIsInSolo,
    switchToSolo,
    switchToCollaborative,
    createCollaborativeSession,
    acceptInvite,
    declineInvite,
    cancelSession,
    loading: sessionLoading
  } = useSessionManagement();


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

  // State to force refresh of recommendations
  const [refreshKey, setRefreshKey] = useState(0);
  
  // Current location state
  const [currentLocation, setCurrentLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  
  // Location permission and error states
  const [locationPermissionStatus, setLocationPermissionStatus] = useState<'checking' | 'granted' | 'denied' | 'error'>('checking');
  const [locationError, setLocationError] = useState<string | null>(null);

  // Get current location on component mount and start tracking
  useEffect(() => {
    const initializeLocation = async () => {
      try {
        console.log('📍 Initializing location services...');
        setLocationPermissionStatus('checking');
        setLocationError(null);

        // First, request permissions
        const hasPermission = await enhancedLocationTrackingService.requestPermissions();
        
        if (!hasPermission) {
          console.log('📍 Location permission denied');
          setLocationPermissionStatus('denied');
          setLocationError('Location permission is required to show recommendations near you. Please enable location access in Settings.');
          return;
        }

        console.log('📍 Location permission granted, getting current location...');
        setLocationPermissionStatus('granted');

        // Get current location
        const location = await enhancedLocationTrackingService.getCurrentLocation();
        if (location) {
          console.log('📍 Current location:', location.latitude, location.longitude);
          setCurrentLocation({
            latitude: location.latitude,
            longitude: location.longitude
          });
          setLocationError(null);
        } else {
          console.log('📍 Could not get current location');
          setLocationError('Unable to get your current location. Please check your device settings.');
        }
      } catch (error) {
        console.error('📍 Error initializing location:', error);
        setLocationPermissionStatus('error');
        setLocationError('Failed to access location services. Please check your device settings.');
      }
    };

    initializeLocation();

    // Start location tracking to detect significant changes
    const startTracking = async () => {
      try {
        if (locationPermissionStatus === 'granted') {
          await enhancedLocationTrackingService.startLocationTracking();
          console.log('📍 Started continuous location tracking');
        }
      } catch (error) {
        console.error('📍 Error starting location tracking:', error);
      }
    };

    // Start tracking after a short delay to ensure location is set
    const trackingTimer = setTimeout(startTracking, 1000);

    // Cleanup: stop tracking when component unmounts
    return () => {
      clearTimeout(trackingTimer);
      enhancedLocationTrackingService.stopLocationTracking();
    };
  }, []);

  // Listen for location updates and refresh recommendations
  useEffect(() => {
    const checkForLocationUpdates = async () => {
      try {
        // Check if location has changed significantly
        const newLocation = await enhancedLocationTrackingService.getCurrentLocation();
        if (newLocation && currentLocation) {
          const distance = calculateDistance(
            currentLocation.latitude,
            currentLocation.longitude,
            newLocation.latitude,
            newLocation.longitude
          );
          
          // If moved more than 1km, update location and refresh recommendations
          if (distance > 1000) {
            console.log('📍 Significant location change detected:', distance, 'meters');
            setCurrentLocation({
              latitude: newLocation.latitude,
              longitude: newLocation.longitude
            });
            // Force refresh of recommendations
            setRefreshKey(prev => prev + 1);
          }
        }
      } catch (error) {
        console.error('📍 Error checking location updates:', error);
      }
    };

    // Check for location updates every 2 minutes
    const interval = setInterval(checkForLocationUpdates, 120000);

    return () => clearInterval(interval);
  }, [currentLocation]);

  // Helper function to calculate distance between two points
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // Distance in meters
  };

  // Handle preferences update with immediate application
  const handlePreferencesUpdate = useCallback((newPreferences: ActivePreferences) => {
    console.log('📊 Updating preferences:', newPreferences);
    setActivePreferences(newPreferences);
    
    // If user manually set a custom location, update current location state
    if (newPreferences.location === 'custom' && newPreferences.custom_lat && newPreferences.custom_lng) {
      console.log('📍 Using manually set location:', newPreferences.custom_lat, newPreferences.custom_lng);
      setCurrentLocation({
        latitude: newPreferences.custom_lat,
        longitude: newPreferences.custom_lng
      });
      setLocationError(null);
      setRefreshKey(prev => prev + 1);
    }
  }, []);

  // Convert preferences for recommendations API
  const recommendationsRequest = useMemo(() => {
    console.log('🔄 Creating recommendations request with location:', currentLocation);
    
    // Always convert preferences if we have location data
    if (activePreferences.categories.length === 0) {
      // Use default categories if none selected
      const defaultPrefs = {
        ...activePreferences,
        categories: ['stroll', 'sip', 'casual_eats', 'screen_relax', 'creative', 'play_move', 'dining', 'freestyle']
      };
      return convertPreferencesToRequest(
        defaultPrefs, 
        currentLocation?.latitude, 
        currentLocation?.longitude, 
        'metric'
      );
    }
    return convertPreferencesToRequest(
      activePreferences, 
      currentLocation?.latitude, 
      currentLocation?.longitude, 
      'metric'
    );
  }, [activePreferences, currentLocation]);

  // Handle recommendation card actions
  const handleCardInvite = (card: RecommendationCard) => {
    // Integrate with existing collaboration system
    Alert.alert("Invite sent!", `Invited friends to ${card.title}`);
  };
  
  const handleCardSave = async (card: RecommendationCard) => {
    if (!user) {
      Alert.alert("Authentication required", "Please log in to save experiences");
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
        Alert.alert("Already saved", `${card.title} is already in your saved experiences`);
        return;
      }

      // Convert estimatedCostPerPerson to number for database storage
      const estimatedCost = convertCostToNumber(card.estimatedCostPerPerson);

        const saveData = {
          user_id: user.id,
          card_id: card.id,
          title: card.title,
          subtitle: card.subtitle,
          category: card.category,
          price_level: card.priceLevel,
          estimated_cost_per_person: estimatedCost,
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
          review_count: card.reviewCount,
          save_type: 'recommendation'
        };

      const { error: insertError } = await supabase
        .from('saved_experiences')
        .insert([saveData]);

      if (insertError) {
        throw insertError;
      }

      Alert.alert("Saved!", `${card.title} has been saved to your collection`);
    } catch (err) {
      console.error('Error saving experience:', err);
      Alert.alert("Save failed", err instanceof Error ? err.message : 'Failed to save experience');
    }
  };

  const onRefresh = async () => {
    await refreshProfile(); // Refresh user profile data
    setRefreshKey(prev => prev + 1); // Force refresh of recommendations
    // Reset card index to start from the beginning
    useAppStore.getState().setCurrentCardIndex(0);
  };



  // Refresh recommendations when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      console.log('🏠 HomeScreen focused - refreshing recommendations');
      setRefreshKey(prev => prev + 1);
    }, [])
  );


  return (
    <ToastProvider>
      <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          {/* Left side - Controls */}
          <View style={styles.controlsLeft}>
            <TouchableOpacity style={styles.controlButton} onPress={onRefresh}>
              <Ionicons name="refresh" size={20} color="#FF6B35" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.controlButton} onPress={openPreferencesModal}>
              <Ionicons name="options-outline" size={20} color="#FF6B35" />
            </TouchableOpacity>
          </View>
          
          {/* Center - Logo */}
          <View style={styles.logoContainer}>
            <Text style={styles.logo}>Mingla</Text>
          </View>
          
          {/* Right side - Session Controls */}
          <View style={styles.controlsRight}>
            <HeaderControls
              showNotifications={false}
              onToggleNotifications={() => {}}
              onShowPreferences={openPreferencesModal}
              currentSession={sessionCurrentSession}
              availableSessions={availableSessions}
              isInSolo={sessionIsInSolo}
              onSwitchToSolo={switchToSolo}
              onSwitchToCollaborative={switchToCollaborative}
              onCreateSession={createCollaborativeSession}
              pendingInvites={pendingInvites}
              sentSessions={availableSessions.filter(session => session.invitedBy === user?.id && (session.status === 'pending' || session.status === 'dormant'))}
              onAcceptInvite={acceptInvite}
              onDeclineInvite={declineInvite}
              onCancelSession={cancelSession}
              loading={sessionLoading}
            />
          </View>
        </View>
      </View>

      {/* Recommendations Grid - Only show when we have location */}
      {recommendationsRequest && currentLocation ? (
        <View style={styles.recommendationsContainer}>
          <RecommendationsGrid
            key={refreshKey} // Force refresh when key changes
            preferences={recommendationsRequest}
            fullPreferences={activePreferences}
            onAdjustFilters={openPreferencesModal}
            onInvite={handleCardInvite}
            onSave={handleCardSave}
            userTimePreference={activePreferences.time}
          />
        </View>
      ) : (
        /* Loading state while getting location */
        <View style={styles.loadingContainer}>
          <View style={styles.loadingContent}>
            {locationPermissionStatus === 'checking' && <View style={styles.spinner} />}
            
            <Text style={styles.loadingText}>
              {locationError 
                ? locationError
                : locationPermissionStatus === 'checking' 
                  ? 'Getting your location...'
                  : locationPermissionStatus === 'denied'
                    ? 'Location permission required'
                    : 'Finding amazing experiences near you...'
              }
            </Text>
            
            {locationError && (
              <Text style={[styles.loadingText, { fontSize: 14, opacity: 0.7, marginTop: 10 }]}>
                Location is essential for showing recommendations near you
              </Text>
            )}
            
            <TouchableOpacity 
              style={styles.preferencesButton}
              onPress={openPreferencesModal}
            >
              <Text style={styles.preferencesButtonText}>Set Preferences</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.preferencesButton, { marginTop: 10, backgroundColor: '#007AFF' }]}
              onPress={async () => {
                console.log('🔄 Manually refreshing location...');
                try {
                  setLocationError(null);
                  
                  // Request permissions again
                  const hasPermission = await enhancedLocationTrackingService.requestPermissions();
                  if (!hasPermission) {
                    setLocationPermissionStatus('denied');
                    setLocationError('Location permission is required. Please enable location access in Settings.');
                    return;
                  }
                  
                  setLocationPermissionStatus('granted');
                  
                  const location = await enhancedLocationTrackingService.getCurrentLocation();
                  if (location) {
                    console.log('📍 Manual location refresh:', location.latitude, location.longitude);
                    setCurrentLocation({
                      latitude: location.latitude,
                      longitude: location.longitude
                    });
                    setRefreshKey(prev => prev + 1);
                    setLocationError(null);
                  } else {
                    console.log('📍 Manual location refresh failed');
                    setLocationError('Unable to get your current location. Please check your device settings.');
                  }
                } catch (error) {
                  console.error('📍 Manual location refresh error:', error);
                  setLocationError('Failed to access location services. Please check your device settings.');
                }
              }}
            >
              <Text style={[styles.preferencesButtonText, { color: 'white' }]}>
                {locationPermissionStatus === 'denied' ? 'Grant Location Access' : 'Refresh Location'}
              </Text>
            </TouchableOpacity>
            
            {(locationPermissionStatus === 'denied' || locationPermissionStatus === 'error') && (
              <TouchableOpacity 
                style={[styles.preferencesButton, { marginTop: 10, backgroundColor: '#34C759' }]}
                onPress={() => {
                  // Open preferences to allow manual location setting
                  openPreferencesModal();
                }}
              >
                <Text style={[styles.preferencesButtonText, { color: 'white' }]}>
                  Set Location Manually
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
      
      {/* Preferences Sheet */}
      <PreferencesSheet
        isOpen={isPreferencesModalOpen}
        onClose={closePreferencesModal}
        activePreferences={activePreferences}
        onPreferencesUpdate={handlePreferencesUpdate}
      />
      </SafeAreaView>
    </ToastProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    backgroundColor: '#f8f9fa',
    borderBottomWidth: 1,
    borderBottomColor: '#e1e5e9',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logoContainer: {
    flex: 1,
    alignItems: 'center',
  },
  controlsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  controlsRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  controlButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFF5F2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FF6B35',
  },
  soloText: {
    fontSize: 12,
    color: '#FF6B35',
    fontWeight: '600',
  },
  recommendationsContainer: {
    flex: 1,
  },
  mainCard: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    overflow: 'hidden',
    marginBottom: 0, // Remove bottom margin to fill to bottom nav
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: '#1a1a1a',
  },
  inviteCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FF9500',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  inviteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  inviteTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginLeft: 8,
  },
  inviteText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 28,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  loadingContent: {
    alignItems: 'center',
    gap: 16,
  },
  spinner: {
    width: 32,
    height: 32,
    borderWidth: 2,
    borderColor: '#FF6B35',
    borderTopColor: 'transparent',
    borderRadius: 16,
    // Note: Animation would need to be added with react-native-reanimated
  },
  loadingText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#666',
    textAlign: 'center',
  },
  preferencesButton: {
    backgroundColor: '#FF6B35',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  preferencesButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
