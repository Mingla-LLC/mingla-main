import * as Location from "expo-location";
import { Alert } from "react-native";
import { throttledReverseGeocode } from '../utils/throttledGeocode';

export interface LocationData {
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
  heading?: number;
  speed?: number;
  timestamp: number;
}

export interface LocationUpdate {
  location: LocationData;
  isSignificantChange: boolean;
}

export class EnhancedLocationService {
  private watchId: Location.LocationSubscription | null = null;
  private lastLocation: LocationData | null = null;
  private listeners: ((update: LocationUpdate) => void)[] = [];
  private isTracking = false;

  async requestPermissions(): Promise<boolean> {
    try {
      // Check if location services are enabled first
      const isEnabled = await Location.hasServicesEnabledAsync();
      if (!isEnabled) {
        // Location services are disabled - return false silently
        return false;
      }

      // Check if permissions are already granted
      const { status: currentStatus } =
        await Location.getForegroundPermissionsAsync();
      if (currentStatus === "granted") {
        return true;
      }

      // Request foreground permissions
      const { status: foregroundStatus } =
        await Location.requestForegroundPermissionsAsync();

      if (foregroundStatus !== "granted") {
        // Permission denied - return false silently
        return false;
      }

      // Request background permissions for better experience (optional)
      try {
        const { status: backgroundStatus } =
          await Location.requestBackgroundPermissionsAsync();

        if (backgroundStatus !== "granted") {
          // Background permission not granted, but foreground is enough
        }
      } catch (backgroundError) {
        // This is not critical, so we continue
      }

      return true;
    } catch (error) {
      // Don't log permission errors - they're expected
      return false;
    }
  }

  async getCurrentLocation(): Promise<LocationData | null> {
    try {
      // First check if location services are enabled
      const isEnabled = await Location.hasServicesEnabledAsync();
      if (!isEnabled) {
        // Location services disabled - try last known location silently
        return await this.getLastKnownLocation();
      }

      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        // Try to get last known location if permission denied
        return await this.getLastKnownLocation();
      }

      // Now safe to get current location
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
    } catch (error: any) {
      // Check if location services are disabled or unavailable
      const errorMessage = error?.message || String(error) || "";
      const isLocationServiceError =
        errorMessage.includes("location services") ||
        errorMessage.includes("unavailable") ||
        errorMessage.includes("Location services are not enabled") ||
        errorMessage.includes("Current location is unavailable");

      if (isLocationServiceError) {
        // Try to get last known location as fallback (silently)
        try {
          const lastKnown = await this.getLastKnownLocation();
          if (lastKnown) {
            return lastKnown;
          }
        } catch {
          // Ignore errors when getting last known location
        }
        // Return null silently - don't log expected errors
        return null;
      }

      // Only log unexpected errors
      console.error("Error getting current location:", error);
      return null;
    }
  }

  async getLastKnownLocation(): Promise<LocationData | null> {
    try {
      const location = await Location.getLastKnownPositionAsync({
        maxAge: 300000, // 5 minutes
        requiredAccuracy: 100,
      });

      if (!location) return this.lastLocation;

      return {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy || undefined,
        altitude: location.coords.altitude || undefined,
        heading: location.coords.heading || undefined,
        speed: location.coords.speed || undefined,
        timestamp: location.timestamp,
      };
    } catch (error) {
      console.error("Error getting last known location:", error);
      return this.lastLocation;
    }
  }

  startLocationTracking(
    options: {
      accuracy?: Location.Accuracy;
      timeInterval?: number;
      distanceInterval?: number;
      onLocationUpdate?: (update: LocationUpdate) => void;
    } = {}
  ) {
    if (this.isTracking) {
      return;
    }

    this.requestPermissions().then((hasPermission) => {
      if (!hasPermission) return;

      this.isTracking = true;

      this.watchId = Location.watchPositionAsync(
        {
          accuracy: options.accuracy || Location.Accuracy.Balanced,
          timeInterval: options.timeInterval || 10000, // 10 seconds
          distanceInterval: options.distanceInterval || 100, // 100 meters
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

          // Check if this is a significant change
          const isSignificantChange =
            this.isSignificantLocationChange(locationData);

          const update: LocationUpdate = {
            location: locationData,
            isSignificantChange,
          };

          // Update last location
          this.lastLocation = locationData;

          // Notify listeners
          this.listeners.forEach((listener) => listener(update));

          // Call the provided callback
          options.onLocationUpdate?.(update);
        }
      );
    });
  }

  stopLocationTracking() {
    if (this.watchId) {
      this.watchId.remove();
      this.watchId = null;
    }
    this.isTracking = false;
  }

  addLocationListener(listener: (update: LocationUpdate) => void) {
    this.listeners.push(listener);

    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  private isSignificantLocationChange(newLocation: LocationData): boolean {
    if (!this.lastLocation) return true;

    // Calculate distance between locations
    const distance = this.calculateDistance(
      this.lastLocation.latitude,
      this.lastLocation.longitude,
      newLocation.latitude,
      newLocation.longitude
    );

    // Consider it significant if moved more than 100 meters
    return distance > 100;
  }

  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  async getLocationAddress(
    latitude: number,
    longitude: number
  ): Promise<string | null> {
    try {
      const { addresses } = await throttledReverseGeocode(latitude, longitude);

      if (addresses.length > 0) {
        const address = addresses[0];
        const parts = [
          address.street,
          address.city,
          address.region,
          address.country,
        ].filter(Boolean);

        return parts.join(", ");
      }

      return null;
    } catch (error) {
      console.error("Error getting address:", error);
      return null;
    }
  }

  async searchNearbyPlaces(
    query: string,
    latitude: number,
    longitude: number,
    radius: number = 5000
  ) {
    try {
      // This would integrate with a places API like Google Places or Foursquare
      // For now, we'll return a mock implementation

      // In a real implementation, you would call an external API here
      return [];
    } catch (error) {
      console.error("Error searching nearby places:", error);
      return [];
    }
  }

  isLocationTrackingActive(): boolean {
    return this.isTracking;
  }

  getLastLocation(): LocationData | null {
    return this.lastLocation;
  }
}

export const enhancedLocationService = new EnhancedLocationService();
