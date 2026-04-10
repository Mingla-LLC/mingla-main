import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { enhancedLocationService, LocationData } from '../services/enhancedLocationService';
import { cameraService } from '../services/cameraService';
import { useAppStore } from '../store/appStore';

interface MobileFeaturesContextType {
  // Location
  currentLocation: LocationData | null;
  isLocationTracking: boolean;
  locationPermissionGranted: boolean;
  startLocationTracking: () => void;
  stopLocationTracking: () => void;
  getCurrentLocation: () => Promise<LocationData | null>;
  
  // Camera
  cameraPermissionGranted: boolean;
  takePhoto: (options?: any) => Promise<any>;
  pickFromLibrary: (options?: any) => Promise<any>;
  uploadImage: (uri: string, fileName?: string) => Promise<string | null>;
  
  // AI methods removed - using RecommendationsGrid instead
  
  // Status
  isInitialized: boolean;
  initializationError: string | null;
}

const MobileFeaturesContext = createContext<MobileFeaturesContextType | undefined>(undefined);

interface MobileFeaturesProviderProps {
  children: ReactNode;
}

export const MobileFeaturesProvider: React.FC<MobileFeaturesProviderProps> = ({ children }) => {
  const { user } = useAppStore();
  
  
  // State
  const [currentLocation, setCurrentLocation] = useState<LocationData | null>(null);
  const [isLocationTracking, setIsLocationTracking] = useState(false);
  const [locationPermissionGranted, setLocationPermissionGranted] = useState(false);
  const [cameraPermissionGranted, setCameraPermissionGranted] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);

  // Mark as initialized immediately — permissions are requested on-demand,
  // not on mount. Location is already granted during onboarding (Step 3 GPS).
  // Camera and background location are requested when the user actually
  // needs them (profile photo, feedback recording, map share-location toggle).
  useEffect(() => {
    setIsInitialized(true);
  }, []);

  // Handle app state changes
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        // App became active, refresh location if needed
        if (isLocationTracking) {
          enhancedLocationService.getCurrentLocation().then(setCurrentLocation);
        }
      } else if (nextAppState === 'background') {
        // App went to background, we can continue location tracking
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  }, [isLocationTracking]);

  const startLocationTracking = () => {
    if (!locationPermissionGranted) {
      console.warn('Location permission not granted');
      return;
    }

    enhancedLocationService.startLocationTracking({
      accuracy: 1, // High accuracy
      timeInterval: 10000, // 10 seconds
      distanceInterval: 50, // 50 meters
      onLocationUpdate: (update) => {
        setCurrentLocation(update.location);
        
        // If significant change, log it
        if (update.isSignificantChange) {
        }
      },
    });

    setIsLocationTracking(true);
  };

  const stopLocationTracking = () => {
    enhancedLocationService.stopLocationTracking();
    setIsLocationTracking(false);
  };

  const getCurrentLocation = async (): Promise<LocationData | null> => {
    try {
      const location = await enhancedLocationService.getCurrentLocation();
      setCurrentLocation(location);
      return location;
    } catch (error) {
      console.error('Error getting current location:', error);
      return null;
    }
  };

  const takePhoto = async (options?: any) => {
    try {
      return await cameraService.takePhoto(options);
    } catch (error) {
      console.error('Error taking photo:', error);
      return null;
    }
  };

  const pickFromLibrary = async (options?: any) => {
    try {
      return await cameraService.pickFromLibrary(options);
    } catch (error) {
      console.error('Error picking from library:', error);
      return null;
    }
  };

  const uploadImage = async (uri: string, fileName?: string): Promise<string | null> => {
    try {
      return await cameraService.uploadImage(uri, fileName);
    } catch (error) {
      console.error('Error uploading image:', error);
      return null;
    }
  };

  // AI service methods removed - using RecommendationsGrid instead

  const value: MobileFeaturesContextType = {
    // Location
    currentLocation,
    isLocationTracking,
    locationPermissionGranted,
    startLocationTracking,
    stopLocationTracking,
    getCurrentLocation,
    
    // Camera
    cameraPermissionGranted,
    takePhoto,
    pickFromLibrary,
    uploadImage,
    
    // AI methods removed - using RecommendationsGrid instead
    
    // Status
    isInitialized,
    initializationError,
  };

  return (
    <MobileFeaturesContext.Provider value={value}>
      {children}
    </MobileFeaturesContext.Provider>
  );
};

export const useMobileFeatures = (): MobileFeaturesContextType => {
  const context = useContext(MobileFeaturesContext);
  if (context === undefined) {
    throw new Error('useMobileFeatures must be used within a MobileFeaturesProvider');
  }
  return context;
};
