import * as Location from "expo-location";
import { Alert, Linking } from "react-native";

export interface LocationData {
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
  heading?: number;
  speed?: number;
}

export class LocationService {
  private static instance: LocationService;
  private currentLocation: LocationData | null = null;
  private watchId: Location.LocationSubscription | null = null;

  static getInstance(): LocationService {
    if (!LocationService.instance) {
      LocationService.instance = new LocationService();
    }
    return LocationService.instance;
  }

  async requestPermissions(): Promise<boolean> {
    try {
      // Always request permissions - this will show the system permission dialog
      // Even if permissions are already granted, the system might show a dialog
      // or prompt if location services are disabled
      console.log(
        "Calling requestForegroundPermissionsAsync() - system dialog should appear now..."
      );
      const { status: foregroundStatus } =
        await Location.requestForegroundPermissionsAsync();

      console.log("Permission request completed. Status:", foregroundStatus);

      // Check if location services are enabled
      const isEnabled = await Location.hasServicesEnabledAsync();
      console.log("Location services enabled:", isEnabled);

      if (foregroundStatus === "granted" && isEnabled) {
        console.log("✓ Permission granted and location services enabled!");
        return true;
      }

      if (foregroundStatus === "granted" && !isEnabled) {
        console.log("Permission granted but location services are disabled");
        // The system dialog should have appeared, but if location services are disabled,
        // the user needs to enable them. The system might have prompted them, or we might
        // need to guide them. Don't open settings automatically - let the system handle it.
        return false;
      }

      // Permission was denied or not granted
      // The system dialog should have appeared
      console.log("Permission denied or not granted");
      return false;
    } catch (error: any) {
      console.error("Error requesting location permissions:", {
        message: error?.message,
        error: error,
        code: error?.code,
      });
      return false;
    }
  }

  async getCurrentLocation(): Promise<LocationData | null> {
    try {
      // Check if we have permission first
      let { status } = await Location.getForegroundPermissionsAsync();
      console.log("Permission status:", status);

      // If permission is not granted, request it
      if (status !== "granted") {
        console.log("Permission not granted - requesting permission...");
        const permissionResult = await this.requestPermissions();
        if (!permissionResult) {
          console.warn("Location permission denied - returning null");
          return null;
        }
        // Re-check status after request
        const { status: newStatus } =
          await Location.getForegroundPermissionsAsync();
        if (newStatus !== "granted") {
          console.warn(
            "Location permission still not granted - returning null"
          );
          return null;
        }
      }

      // Check if location services are enabled
      const isEnabled = await Location.hasServicesEnabledAsync();
      console.log("Location services enabled:", isEnabled);

      if (!isEnabled) {
        // Location services are disabled - try to get location anyway
        // This might trigger a system prompt on some Android versions to enable location services
        console.warn(
          "Location services are disabled - attempting to get location (may trigger system prompt)"
        );

        // Try to get current location - this might trigger Android's system prompt
        // to enable location services
        try {
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Lowest,
          });
          console.log(
            "Got location even though services were disabled:",
            location.coords
          );
          return {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy || undefined,
          };
        } catch (error: any) {
          console.log(
            "Could not get location (services disabled):",
            error?.message
          );
          // Try last known location as fallback
          const lastKnown = await this.getLastKnownLocationAsync();
          console.log("Last known location from system:", lastKnown);
          return lastKnown;
        }
      }

      // Try to get last known location first (faster, no GPS wait)
      try {
        console.log("Attempting to get last known position...");
        const lastKnown = await Location.getLastKnownPositionAsync({
          maxAge: 60000, // Accept if less than 1 minute old
          requiredAccuracy: 100, // 100 meters accuracy
        });

        if (lastKnown) {
          console.log("Got last known location:", lastKnown.coords);
          this.currentLocation = {
            latitude: lastKnown.coords.latitude,
            longitude: lastKnown.coords.longitude,
            accuracy: lastKnown.coords.accuracy || undefined,
            altitude: lastKnown.coords.altitude || undefined,
            heading: lastKnown.coords.heading || undefined,
            speed: lastKnown.coords.speed || undefined,
          };
          return this.currentLocation;
        } else {
          console.log("Last known position returned null");
        }
      } catch (lastKnownError: any) {
        // Last known location not available, continue to get current
        console.log(
          "Last known location error:",
          lastKnownError?.message || lastKnownError
        );
      }

      // Get current location - try multiple strategies for maximum reliability
      console.log("Attempting to get current position...");

      // Strategy 1: Try with Lowest accuracy (network-based, works without GPS)
      try {
        console.log(
          "Strategy 1: Trying network-based location (Lowest accuracy)..."
        );
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Lowest, // Network-based, works without GPS
        });

        console.log("✓ Got location via network:", location.coords);
        this.currentLocation = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: location.coords.accuracy || undefined,
          altitude: location.coords.altitude || undefined,
          heading: location.coords.heading || undefined,
          speed: location.coords.speed || undefined,
        };

        return this.currentLocation;
      } catch (lowestError: any) {
        console.log(
          "Strategy 1 failed:",
          lowestError?.code || lowestError?.message
        );

        // Strategy 2: Try with Low accuracy (might work if network location is available)
        try {
          console.log("Strategy 2: Trying Low accuracy...");
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Low,
          });

          console.log("✓ Got location via Low accuracy:", location.coords);
          this.currentLocation = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy || undefined,
            altitude: location.coords.altitude || undefined,
            heading: location.coords.heading || undefined,
            speed: location.coords.speed || undefined,
          };

          return this.currentLocation;
        } catch (lowError: any) {
          console.log(
            "Strategy 2 failed:",
            lowError?.code || lowError?.message
          );

          // Strategy 3: Try Balanced accuracy (GPS if available)
          try {
            console.log("Strategy 3: Trying Balanced accuracy (GPS)...");
            const location = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });

            console.log("✓ Got location via GPS:", location.coords);
            this.currentLocation = {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
              accuracy: location.coords.accuracy || undefined,
              altitude: location.coords.altitude || undefined,
              heading: location.coords.heading || undefined,
              speed: location.coords.speed || undefined,
            };

            return this.currentLocation;
          } catch (balancedError: any) {
            console.log(
              "Strategy 3 failed:",
              balancedError?.code || balancedError?.message
            );

            // Strategy 4: Try last known location with very lenient criteria
            console.log("Strategy 4: Trying last known location...");
            try {
              // Try with very lenient criteria - accept any location from last 7 days
              const lastKnown = await Location.getLastKnownPositionAsync({
                maxAge: 604800000, // 7 days - very lenient
                requiredAccuracy: 10000, // 10km - very lenient
              });

              if (lastKnown) {
                console.log("✓ Got last known location:", lastKnown.coords);
                this.currentLocation = {
                  latitude: lastKnown.coords.latitude,
                  longitude: lastKnown.coords.longitude,
                  accuracy: lastKnown.coords.accuracy || undefined,
                  altitude: lastKnown.coords.altitude || undefined,
                  heading: lastKnown.coords.heading || undefined,
                  speed: lastKnown.coords.speed || undefined,
                };
                return this.currentLocation;
              }
            } catch (lastKnownError) {
              console.log("Strategy 4 failed: Last known location unavailable");
            }

            // All strategies failed - throw the original error
            throw lowestError;
          }
        }
      }
    } catch (error: any) {
      // Log the error so we can debug if the feature isn't working
      const errorMessage = error?.message || String(error) || "";
      const errorString = String(error);
      console.error("=== ERROR IN getCurrentLocation ===");
      console.error("Error message:", errorMessage);
      console.error("Error string:", errorString);
      console.error("Error code:", error?.code);
      console.error("Error name:", error?.name);
      console.error("Full error object:", error);
      console.error("Error stack:", error?.stack);
      console.error("===================================");

      // Always try last known location as fallback, regardless of error type
      console.log("Trying last known location as fallback...");
      try {
        const lastKnown = await this.getLastKnownLocationAsync();
        console.log("Last known location from system:", lastKnown);
        if (lastKnown) {
          console.log("Using last known location as fallback");
          return lastKnown;
        }
      } catch (lastKnownError: any) {
        console.error("Failed to get last known location:", {
          message: lastKnownError?.message,
          error: lastKnownError,
        });
      }

      // Check if it's a location services error
      const isLocationServiceError =
        errorMessage.includes("location services") ||
        errorMessage.includes("unavailable") ||
        errorMessage.includes("Location services are not enabled") ||
        errorMessage.includes("Current location is unavailable") ||
        errorString.includes("location services") ||
        errorString.includes("unavailable") ||
        errorString.includes("Current location is unavailable");

      if (isLocationServiceError) {
        console.warn(
          "Location service error and no fallback available - returning null"
        );
        return null;
      }

      // Log other errors
      console.error("Unexpected error getting current location:", error);
      console.warn("No location available - returning null");
      return null;
    }
  }

  async watchLocation(
    callback: (location: LocationData) => void
  ): Promise<boolean> {
    try {
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) return false;

      this.watchId = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 30000, // Update every 30 seconds
          distanceInterval: 100, // Update every 100 meters
        },
        (location) => {
          const locationData: LocationData = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy || undefined,
            altitude: location.coords.altitude || undefined,
            heading: location.coords.heading || undefined,
            speed: location.coords.speed || undefined,
          };

          this.currentLocation = locationData;
          callback(locationData);
        }
      );

      return true;
    } catch (error) {
      console.error("Error watching location:", error);
      return false;
    }
  }

  stopWatchingLocation(): void {
    if (this.watchId) {
      this.watchId.remove();
      this.watchId = null;
    }
  }

  getLastKnownLocation(): LocationData | null {
    // Return cached location if available
    if (this.currentLocation) {
      return this.currentLocation;
    }
    // Otherwise return null - we can't call async methods here
    return null;
  }

  async getLastKnownLocationAsync(): Promise<LocationData | null> {
    // First try cached location
    if (this.currentLocation) {
      console.log("Using cached location");
      return this.currentLocation;
    }

    // Try to get from system with very lenient criteria
    try {
      console.log("Querying system for last known position...");
      const lastKnown = await Location.getLastKnownPositionAsync({
        maxAge: 86400000, // Accept if less than 24 hours old (very lenient)
        requiredAccuracy: 1000, // 1km accuracy (very lenient)
      });

      if (lastKnown) {
        console.log("Got last known position from system:", {
          lat: lastKnown.coords.latitude,
          lng: lastKnown.coords.longitude,
          accuracy: lastKnown.coords.accuracy,
          timestamp: new Date(lastKnown.timestamp).toISOString(),
        });
        this.currentLocation = {
          latitude: lastKnown.coords.latitude,
          longitude: lastKnown.coords.longitude,
          accuracy: lastKnown.coords.accuracy || undefined,
          altitude: lastKnown.coords.altitude || undefined,
          heading: lastKnown.coords.heading || undefined,
          speed: lastKnown.coords.speed || undefined,
        };
        return this.currentLocation;
      } else {
        console.log("getLastKnownPositionAsync returned null");
      }
    } catch (error: any) {
      console.error("Error getting last known position from system:", {
        message: error?.message,
        error: error,
        code: error?.code,
      });
    }

    console.log("No last known location available");
    return null;
  }

  async reverseGeocode(
    latitude: number,
    longitude: number
  ): Promise<string | null> {
    try {
      const addresses = await Location.reverseGeocodeAsync({
        latitude,
        longitude,
      });

      if (addresses.length > 0) {
        const address = addresses[0];
        // Format as "City, State" or "City, Region" if state not available
        const city = address.city || address.region || "";
        const state = address.region || "";

        if (city && state && city !== state) {
          return `${city}, ${state}`;
        } else if (city) {
          return city;
        } else if (state) {
          return state;
        }

        // Fallback to full address if city/state not available
        return `${address.street || ""} ${address.city || ""} ${
          address.region || ""
        } ${address.country || ""}`.trim();
      }

      return null;
    } catch (error) {
      console.error("Error reverse geocoding:", error);
      return null;
    }
  }

  calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371; // Radius of the Earth in kilometers
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) *
        Math.cos(this.deg2rad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c; // Distance in kilometers
    return distance;
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}

export const locationService = LocationService.getInstance();
