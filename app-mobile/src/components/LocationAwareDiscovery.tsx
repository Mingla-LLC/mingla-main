import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMobileFeatures } from './MobileFeaturesProvider';
import { ExperienceCard } from './ExperienceCard';
import { useAppStore } from '../store/appStore';
import { geocodingService } from '../services/geocodingService';

interface LocationAwareDiscoveryProps {
  onExperienceSelect?: (experience: any) => void;
}

export const LocationAwareDiscovery: React.FC<LocationAwareDiscoveryProps> = ({
  onExperienceSelect,
}) => {
  const [loading, setLoading] = useState(false);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [locationName, setLocationName] = useState<string>('Getting location...');
  const [geocodingLoading, setGeocodingLoading] = useState(false);
  
  const { 
    currentLocation, 
    locationPermissionGranted, 
    getCurrentLocation,
    getWeatherAwareRecommendations,
    startLocationTracking,
    isLocationTracking,
  } = useMobileFeatures();
  
  const { preferences } = useAppStore();

  useEffect(() => {
    if (currentLocation) {
      getLocationName();
      loadRecommendations();
    }
  }, [currentLocation]);

  const getLocationName = async () => {
    if (!currentLocation) return;
    
    setGeocodingLoading(true);
    try {
      const name = await geocodingService.getLocationName(
        currentLocation.latitude,
        currentLocation.longitude
      );
      setLocationName(name);
    } catch (error) {
      console.error('Error getting location name:', error);
      setLocationName(`${currentLocation.latitude.toFixed(4)}, ${currentLocation.longitude.toFixed(4)}`);
    } finally {
      setGeocodingLoading(false);
    }
  };

  const loadRecommendations = async () => {
    if (!currentLocation) return;

    setLoading(true);
    setError(null);

    try {
      const weatherRecommendations = await getWeatherAwareRecommendations(
        currentLocation.latitude,
        currentLocation.longitude,
        preferences
      );

      setRecommendations(weatherRecommendations);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLocationRequest = async () => {
    if (!locationPermissionGranted) {
      Alert.alert(
        'Location Permission Required',
        'Mingla needs location access to find experiences near you and provide weather-aware recommendations.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Enable', onPress: () => {
            // The permission request will be handled by the service
            getCurrentLocation();
          }}
        ]
      );
      return;
    }

    const location = await getCurrentLocation();
    if (location) {
      await getLocationName();
      await loadRecommendations();
    }
  };

  const handleStartTracking = () => {
    if (!locationPermissionGranted) {
      Alert.alert(
        'Location Permission Required',
        'Please enable location permissions to start tracking your location for real-time recommendations.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Enable', onPress: () => {
            getCurrentLocation().then(() => {
              startLocationTracking();
            });
          }}
        ]
      );
      return;
    }

    startLocationTracking();
    Alert.alert(
      'Location Tracking Started',
      'We\'ll now provide real-time recommendations based on your location and weather conditions.'
    );
  };

  const formatLocation = () => {
    if (!currentLocation) return 'Location not available';
    
    if (geocodingLoading) {
      return 'Getting location name...';
    }
    
    return locationName;
  };

  const getLocationStatus = () => {
    if (!locationPermissionGranted) return 'Permission required';
    if (!currentLocation) return 'Getting location...';
    if (isLocationTracking) return 'Tracking active';
    return 'Location available';
  };

  return (
    <View style={styles.container}>
      {/* Location Status */}
      <View style={styles.locationStatus}>
        <View style={styles.locationHeader}>
          <Ionicons 
            name={isLocationTracking ? "location" : "location-outline"} 
            size={20} 
            color={isLocationTracking ? "#34C759" : "#666"} 
          />
          <Text style={styles.locationTitle}>Location-Based Discovery</Text>
        </View>
        
        <Text style={styles.locationText}>{formatLocation()}</Text>
        <Text style={styles.locationStatusText}>{getLocationStatus()}</Text>
        
        <View style={styles.locationActions}>
          {!currentLocation && (
            <TouchableOpacity 
              style={styles.actionButton}
              onPress={handleLocationRequest}
            >
              <Ionicons name="locate" size={16} color="white" />
              <Text style={styles.actionButtonText}>Get Location</Text>
            </TouchableOpacity>
          )}
          
          {currentLocation && !isLocationTracking && (
            <TouchableOpacity 
              style={[styles.actionButton, styles.trackingButton]}
              onPress={handleStartTracking}
            >
              <Ionicons name="play" size={16} color="white" />
              <Text style={styles.actionButtonText}>Start Tracking</Text>
            </TouchableOpacity>
          )}
          
          {isLocationTracking && (
            <View style={styles.trackingIndicator}>
              <View style={styles.trackingDot} />
              <Text style={styles.trackingText}>Live tracking</Text>
            </View>
          )}
        </View>
      </View>

      {/* Recommendations */}
      <View style={styles.recommendationsSection}>
        <Text style={styles.sectionTitle}>
          Weather-Aware Recommendations
          {recommendations.length > 0 && ` (${recommendations.length})`}
        </Text>
        
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingText}>Finding experiences near you...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <Ionicons name="warning-outline" size={48} color="#FF9500" />
            <Text style={styles.errorTitle}>Unable to load recommendations</Text>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity 
              style={styles.retryButton}
              onPress={loadRecommendations}
            >
              <Text style={styles.retryButtonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : recommendations.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="compass-outline" size={48} color="#ccc" />
            <Text style={styles.emptyStateTitle}>No recommendations yet</Text>
            <Text style={styles.emptyStateText}>
              {!currentLocation 
                ? 'Enable location access to get personalized recommendations'
                : 'We\'re analyzing your location and preferences to find the best experiences for you'
              }
            </Text>
          </View>
        ) : (
          recommendations.map((recommendation) => (
            <View key={recommendation.experience.id} style={styles.recommendationItem}>
              <ExperienceCard
                experience={recommendation.experience}
                onPress={() => onExperienceSelect?.(recommendation.experience)}
              />
              
              {/* AI Reasoning */}
              <View style={styles.reasoningContainer}>
                <View style={styles.reasoningHeader}>
                  <Ionicons name="bulb" size={16} color="#FF9500" />
                  <Text style={styles.reasoningTitle}>Why this experience?</Text>
                  <Text style={styles.confidenceText}>
                    {Math.round(recommendation.confidence * 100)}% match
                  </Text>
                </View>
                <Text style={styles.reasoningText}>{recommendation.reasoning}</Text>
                
                {recommendation.weather_consideration && (
                  <View style={styles.weatherConsideration}>
                    <Ionicons name="partly-sunny" size={14} color="#007AFF" />
                    <Text style={styles.weatherText}>{recommendation.weather_consideration}</Text>
                  </View>
                )}
              </View>
            </View>
          ))
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  locationStatus: {
    backgroundColor: 'white',
    margin: 16,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  locationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  locationTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  locationText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
    fontWeight: '500',
  },
  locationStatusText: {
    fontSize: 12,
    color: '#999',
    marginBottom: 12,
  },
  locationActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    backgroundColor: '#007AFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  trackingButton: {
    backgroundColor: '#34C759',
  },
  actionButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  trackingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  trackingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34C759',
  },
  trackingText: {
    fontSize: 12,
    color: '#34C759',
    fontWeight: '500',
  },
  recommendationsSection: {
    flex: 1,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginTop: 16,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  retryButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
  },
  recommendationItem: {
    marginBottom: 16,
  },
  reasoningContainer: {
    backgroundColor: 'white',
    marginTop: 8,
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#FF9500',
  },
  reasoningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 6,
  },
  reasoningTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    flex: 1,
  },
  confidenceText: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: '600',
  },
  reasoningText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 18,
    marginBottom: 8,
  },
  weatherConsideration: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  weatherText: {
    fontSize: 12,
    color: '#007AFF',
    fontStyle: 'italic',
  },
});
