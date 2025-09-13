import { useState, useEffect, useCallback } from 'react';

interface GeolocationState {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  city: string | null;
  country: string | null;
  loading: boolean;
  error: string | null;
}

interface GeolocationOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
  autoStart?: boolean;
}

export const useGeolocation = (options: GeolocationOptions = {}) => {
  const {
    enableHighAccuracy = true,
    timeout = 10000,
    maximumAge = 300000, // 5 minutes
    autoStart = true
  } = options;

  const [state, setState] = useState<GeolocationState>({
    latitude: null,
    longitude: null,
    accuracy: null,
    city: null,
    country: null,
    loading: false,
    error: null
  });

  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      // Using OpenStreetMap Nominatim API (free, no API key required)
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`
      );
      
      if (!response.ok) {
        throw new Error('Geocoding failed');
      }
      
      const data = await response.json();
      
      return {
        city: data.address?.city || data.address?.town || data.address?.village || null,
        country: data.address?.country || null
      };
    } catch (error) {
      console.error('Reverse geocoding error:', error);
      return { city: null, country: null };
    }
  };

  const getCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setState(prev => ({
        ...prev,
        error: 'Geolocation is not supported by this browser',
        loading: false
      }));
      return;
    }

    setState(prev => ({ ...prev, loading: true, error: null }));

    const handleSuccess = async (position: GeolocationPosition) => {
      const { latitude, longitude, accuracy } = position.coords;
      
      // Get city and country from coordinates
      const { city, country } = await reverseGeocode(latitude, longitude);
      
      setState({
        latitude,
        longitude,
        accuracy,
        city,
        country,
        loading: false,
        error: null
      });
    };

    const handleError = (error: GeolocationPositionError) => {
      let errorMessage = 'Unable to retrieve location';
      
      switch (error.code) {
        case error.PERMISSION_DENIED:
          errorMessage = 'Location access denied by user';
          break;
        case error.POSITION_UNAVAILABLE:
          errorMessage = 'Location information unavailable';
          break;
        case error.TIMEOUT:
          errorMessage = 'Location request timed out';
          break;
      }
      
      setState(prev => ({
        ...prev,
        loading: false,
        error: errorMessage
      }));
    };

    navigator.geolocation.getCurrentPosition(
      handleSuccess,
      handleError,
      {
        enableHighAccuracy,
        timeout,
        maximumAge
      }
    );
  }, [enableHighAccuracy, timeout, maximumAge]);

  const clearLocation = useCallback(() => {
    setState({
      latitude: null,
      longitude: null,
      accuracy: null,
      city: null,
      country: null,
      loading: false,
      error: null
    });
  }, []);

  useEffect(() => {
    if (autoStart) {
      getCurrentLocation();
    }
  }, [autoStart, getCurrentLocation]);

  const formatLocation = useCallback(() => {
    if (state.city && state.country) {
      return `${state.city}, ${state.country}`;
    } else if (state.city) {
      return state.city;
    } else if (state.country) {
      return state.country;
    } else if (state.latitude && state.longitude) {
      return `${state.latitude.toFixed(4)}, ${state.longitude.toFixed(4)}`;
    }
    return null;
  }, [state]);

  return {
    ...state,
    getCurrentLocation,
    clearLocation,
    formatLocation
  };
};