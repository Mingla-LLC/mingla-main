import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { enhancedLocationService, LocationData } from '../services/enhancedLocationService';
import { enhancedNotificationService } from '../services/enhancedNotificationService';
import { cameraService } from '../services/cameraService';
// Removed aiReasoningService import - using RecommendationsGrid instead
import { useAppStore } from '../store/appStore';

interface MobileFeaturesContextType {
  // Location
  currentLocation: LocationData | null;
  isLocationTracking: boolean;
  locationPermissionGranted: boolean;
  startLocationTracking: () => void;
  stopLocationTracking: () => void;
  getCurrentLocation: () => Promise<LocationData | null>;
  
  // Notifications
  notificationPermissionGranted: boolean;
  registerForNotifications: () => Promise<boolean>;
  sendLocalNotification: (title: string, body: string, data?: any) => Promise<void>;
  
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
  
  console.log('MobileFeaturesProvider: Component mounted');
  
  // State
  const [currentLocation, setCurrentLocation] = useState<LocationData | null>(null);
  const [isLocationTracking, setIsLocationTracking] = useState(false);
  const [locationPermissionGranted, setLocationPermissionGranted] = useState(false);
  const [notificationPermissionGranted, setNotificationPermissionGranted] = useState(false);
  const [cameraPermissionGranted, setCameraPermissionGranted] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);

  // Initialize mobile features
  useEffect(() => {
    // Add a timeout to prevent indefinite blocking
    const timeoutId = setTimeout(() => {
      if (!isInitialized) {
        console.log('Mobile features initialization timeout - forcing completion');
        setIsInitialized(true);
      }
    }, 5000); // 5 second timeout

    initializeMobileFeatures().finally(() => {
      clearTimeout(timeoutId);
    });

    return () => clearTimeout(timeoutId);
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
        console.log('App went to background, location tracking continues');
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  }, [isLocationTracking]);

  // Register for notifications when user changes
  useEffect(() => {
    if (user && isInitialized) {
      registerForNotifications();
    }
  }, [user, isInitialized]);

  const initializeMobileFeatures = async () => {
    try {
      console.log('MobileFeaturesProvider: Starting initialization...');
      setInitializationError(null);
      
      // Initialize services in parallel and don't block on failures
      const initPromises = [
        // Initialize location service
        enhancedLocationService.requestPermissions()
          .then(permission => {
            setLocationPermissionGranted(permission);
            if (permission) {
              return enhancedLocationService.getCurrentLocation()
                .then(location => {
                  setCurrentLocation(location);
                  return true;
                })
                .catch(error => {
                  console.log('Location fetch failed:', error);
                  return false;
                });
            }
            return false;
          })
          .catch(error => {
            console.log('Location permission failed:', error);
            return false;
          }),

        // Initialize notification service
        enhancedNotificationService.initialize()
          .then(permission => {
            setNotificationPermissionGranted(permission);
            return permission;
          })
          .catch(error => {
            console.log('Notification initialization failed:', error);
            return false;
          }),

        // Initialize camera service
        cameraService.initialize()
          .then(permission => {
            setCameraPermissionGranted(permission);
            return permission;
          })
          .catch(error => {
            console.log('Camera initialization failed:', error);
            return false;
          })
      ];

      // Wait for all initializations to complete (or fail)
      await Promise.allSettled(initPromises);

      setIsInitialized(true);
      console.log('MobileFeaturesProvider: Initialization completed successfully');
    } catch (error: any) {
      console.error('Error initializing mobile features:', error);
      setInitializationError(error.message);
      setIsInitialized(true); // Always mark as initialized to prevent blocking
    }
  };

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
          console.log('Significant location change detected');
        }
      },
    });

    setIsLocationTracking(true);
    console.log('Location tracking started');
  };

  const stopLocationTracking = () => {
    enhancedLocationService.stopLocationTracking();
    setIsLocationTracking(false);
    console.log('Location tracking stopped');
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

  const registerForNotifications = async (): Promise<boolean> => {
    if (!user) return false;
    
    try {
      const success = await enhancedNotificationService.registerForPushNotifications(user.id);
      if (success) {
        setNotificationPermissionGranted(true);
        console.log('Successfully registered for push notifications');
      }
      return success;
    } catch (error) {
      console.error('Error registering for notifications:', error);
      return false;
    }
  };

  const sendLocalNotification = async (title: string, body: string, data?: any): Promise<void> => {
    try {
      await enhancedNotificationService.sendLocalNotification({
        type: 'location_reminder',
        title,
        body,
        data,
      });
    } catch (error) {
      console.error('Error sending local notification:', error);
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
    
    // Notifications
    notificationPermissionGranted,
    registerForNotifications,
    sendLocalNotification,
    
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
