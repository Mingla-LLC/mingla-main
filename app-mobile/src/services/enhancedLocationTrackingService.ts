import * as Location from 'expo-location';
import { Alert } from 'react-native';
import { supabase } from './supabase';

export interface LocationData {
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
  heading?: number;
  speed?: number;
  timestamp: number;
}

export interface LocationHistoryEntry {
  id: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
  heading?: number;
  speed?: number;
  locationType: 'current' | 'home' | 'work' | 'frequent' | 'visited_place';
  placeContext?: {
    placeId?: string;
    placeName?: string;
    category?: string;
    address?: string;
  };
  createdAt: string;
}

export interface FrequentLocation {
  latitude: number;
  longitude: number;
  visitCount: number;
  lastVisit: string;
}

class EnhancedLocationTrackingService {
  private watchId: Location.LocationSubscription | null = null;
  private lastLocation: LocationData | null = null;
  private isTracking = false;
  private trackingInterval: number = 30000; // 30 seconds
  private significantChangeThreshold: number = 100; // 100 meters
  private lastStoredLocation: LocationData | null = null;

  async requestPermissions(): Promise<boolean> {
    try {
      // Check if permissions are already granted
      const { status: currentStatus } = await Location.getForegroundPermissionsAsync();
      if (currentStatus === 'granted') {
        return true;
      }

      // Request foreground permissions
      const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
      
      if (foregroundStatus !== 'granted') {
        console.log('Foreground location permission not granted by user');
        return false;
      }

      // Request background permissions for continuous tracking
      try {
        const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
        
        if (backgroundStatus !== 'granted') {
          console.log('Background location permission not granted, continuing with foreground only');
        }
      } catch (backgroundError) {
        console.log('Background location permission request failed:', backgroundError);
      }

      return true;
    } catch (error) {
      console.error('Error requesting location permissions:', error);
      return false;
    }
  }

  async getCurrentLocation(): Promise<LocationData | null> {
    try {
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) return null;

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 5000,
      });

      const locationData: LocationData = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy || undefined,
        altitude: location.coords.altitude || undefined,
        heading: location.coords.heading || undefined,
        speed: location.coords.speed || undefined,
        timestamp: location.timestamp,
      };

      this.lastLocation = locationData;
      return locationData;
    } catch (error) {
      console.error('Error getting current location:', error);
      return null;
    }
  }

  async startLocationTracking(): Promise<boolean> {
    try {
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) return false;

      if (this.isTracking) {
        console.log('Location tracking already active');
        return true;
      }

      // Get initial location
      const initialLocation = await this.getCurrentLocation();
      if (initialLocation) {
        await this.storeLocationHistory(initialLocation, 'current');
      }

      // Start watching location changes
      this.watchId = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: this.trackingInterval,
          distanceInterval: this.significantChangeThreshold,
        },
        (location) => {
          const locationData: LocationData = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy || undefined,
            altitude: location.coords.altitude || undefined,
            heading: location.coords.heading || undefined,
            speed: location.coords.speed || undefined,
            timestamp: location.timestamp,
          };

          this.handleLocationUpdate(locationData);
        }
      );

      this.isTracking = true;
      console.log('Location tracking started');
      return true;
    } catch (error) {
      console.error('Error starting location tracking:', error);
      return false;
    }
  }

  async stopLocationTracking(): Promise<void> {
    if (this.watchId) {
      this.watchId.remove();
      this.watchId = null;
    }
    this.isTracking = false;
    console.log('Location tracking stopped');
  }

  private async handleLocationUpdate(location: LocationData): Promise<void> {
    try {
      // Check if this is a significant location change
      const isSignificantChange = this.isSignificantLocationChange(location);
      
      if (isSignificantChange) {
        await this.storeLocationHistory(location, 'current');
        this.lastStoredLocation = location;
        
        // Check if this might be a frequent location
        await this.checkForFrequentLocation(location);
      }

      this.lastLocation = location;
    } catch (error) {
      console.error('Error handling location update:', error);
    }
  }

  private isSignificantLocationChange(newLocation: LocationData): boolean {
    if (!this.lastStoredLocation) return true;

    const distance = this.calculateDistance(
      this.lastStoredLocation.latitude,
      this.lastStoredLocation.longitude,
      newLocation.latitude,
      newLocation.longitude
    );

    return distance >= this.significantChangeThreshold;
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // Distance in meters
  }

  private async storeLocationHistory(
    location: LocationData, 
    locationType: LocationHistoryEntry['locationType'],
    placeContext?: LocationHistoryEntry['placeContext']
  ): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('user_location_history')
        .insert({
          user_id: user.id,
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          altitude: location.altitude,
          heading: location.heading,
          speed: location.speed,
          location_type: locationType,
          place_context: placeContext || {},
        });

      if (error) {
        console.error('Error storing location history:', error);
      }
    } catch (error) {
      console.error('Error storing location history:', error);
    }
  }

  private async checkForFrequentLocation(location: LocationData): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get frequent locations for this user
      const { data: frequentLocations, error } = await supabase
        .rpc('get_user_frequent_locations', {
          user_uuid: user.id,
          limit_count: 10
        });

      if (error) {
        console.error('Error getting frequent locations:', error);
        return;
      }

      // Check if current location is near any frequent location
      for (const frequentLocation of frequentLocations || []) {
        const distance = this.calculateDistance(
          location.latitude,
          location.longitude,
          frequentLocation.latitude,
          frequentLocation.longitude
        );

        // If within 200 meters of a frequent location, mark it as such
        if (distance <= 200) {
          await this.storeLocationHistory(location, 'frequent');
          break;
        }
      }
    } catch (error) {
      console.error('Error checking for frequent location:', error);
    }
  }

  async getLocationHistory(limit: number = 50): Promise<LocationHistoryEntry[]> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from('user_location_history')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error getting location history:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error getting location history:', error);
      return [];
    }
  }

  async getFrequentLocations(): Promise<FrequentLocation[]> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .rpc('get_user_frequent_locations', {
          user_uuid: user.id,
          limit_count: 10
        });

      if (error) {
        console.error('Error getting frequent locations:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error getting frequent locations:', error);
      return [];
    }
  }

  async setHomeLocation(location: LocationData): Promise<void> {
    await this.storeLocationHistory(location, 'home');
  }

  async setWorkLocation(location: LocationData): Promise<void> {
    await this.storeLocationHistory(location, 'work');
  }

  async markLocationAsVisited(location: LocationData, placeContext: LocationHistoryEntry['placeContext']): Promise<void> {
    await this.storeLocationHistory(location, 'visited_place', placeContext);
  }

  async getLastKnownLocation(): Promise<LocationData | null> {
    if (this.lastLocation) {
      return this.lastLocation;
    }

    try {
      const history = await this.getLocationHistory(1);
      if (history.length > 0) {
        const lastEntry = history[0];
        return {
          latitude: lastEntry.latitude,
          longitude: lastEntry.longitude,
          accuracy: lastEntry.accuracy,
          altitude: lastEntry.altitude,
          heading: lastEntry.heading,
          speed: lastEntry.speed,
          timestamp: new Date(lastEntry.createdAt).getTime(),
        };
      }
    } catch (error) {
      console.error('Error getting last known location:', error);
    }

    return null;
  }

  async reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
    try {
      const result = await Location.reverseGeocodeAsync({
        latitude,
        longitude,
      });

      if (result.length > 0) {
        const address = result[0];
        return `${address.street || ''} ${address.city || ''} ${address.region || ''}`.trim();
      }
    } catch (error) {
      console.error('Error reverse geocoding:', error);
    }

    return null;
  }

  // Get location context for recommendations
  async getLocationContext(): Promise<{
    currentLocation: LocationData | null;
    frequentLocations: FrequentLocation[];
    isAtHome: boolean;
    isAtWork: boolean;
    lastLocationUpdate: string | null;
  }> {
    const currentLocation = await this.getCurrentLocation();
    const frequentLocations = await this.getFrequentLocations();
    const locationHistory = await this.getLocationHistory(10);

    // Check if user is at home or work
    let isAtHome = false;
    let isAtWork = false;

    if (currentLocation) {
      for (const location of locationHistory) {
        if (location.locationType === 'home') {
          const distance = this.calculateDistance(
            currentLocation.latitude,
            currentLocation.longitude,
            location.latitude,
            location.longitude
          );
          if (distance <= 200) {
            isAtHome = true;
            break;
          }
        }
      }

      for (const location of locationHistory) {
        if (location.locationType === 'work') {
          const distance = this.calculateDistance(
            currentLocation.latitude,
            currentLocation.longitude,
            location.latitude,
            location.longitude
          );
          if (distance <= 200) {
            isAtWork = true;
            break;
          }
        }
      }
    }

    return {
      currentLocation,
      frequentLocations,
      isAtHome,
      isAtWork,
      lastLocationUpdate: locationHistory.length > 0 ? locationHistory[0].createdAt : null,
    };
  }
}

export const enhancedLocationTrackingService = new EnhancedLocationTrackingService();
