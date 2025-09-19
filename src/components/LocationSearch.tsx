import React, { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { callAuthenticatedFunction } from '@/utils/security';

declare global {
  interface Window {
    google: any;
  }
}

interface LocationSearchProps {
  value: string;
  onChange: (location: string, lat?: number, lng?: number) => void;
  placeholder?: string;
  className?: string;
}

export const LocationSearch = ({ 
  value, 
  onChange, 
  placeholder = "Search for a city or location...",
  className 
}: LocationSearchProps) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<any>(null);

  useEffect(() => {
    const getApiKey = async () => {
      try {
        const { data, error } = await callAuthenticatedFunction<{ apiKey: string }>('get-google-maps-key');
        
        if (error) {
          if (error.type === 'auth_required' || error.type === 'unauthorized') {
            console.log('Google Maps API key requires authentication');
          } else {
            console.log('Google Maps API key not available:', error.message);
          }
          setApiKey(null);
          return;
        }
        
        setApiKey(data?.apiKey || null);
      } catch (error) {
        console.log('Google Maps API key not available');
        setApiKey(null);
      }
    };

    getApiKey();
  }, []);

  useEffect(() => {
    const initializeAutocomplete = async () => {
      if (!apiKey) {
        setIsLoaded(true);
        return;
      }

      try {
        // Dynamically load Google Maps API
        if (!window.google) {
          const script = document.createElement('script');
          script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
          script.async = true;
          script.defer = true;
          document.head.appendChild(script);
          
          script.onload = () => {
            setupAutocomplete();
          };
        } else {
          setupAutocomplete();
        }
      } catch (error) {
        console.log('Google Maps API not available, using fallback input');
        setIsLoaded(true);
      }
    };

    const setupAutocomplete = () => {
      if (inputRef.current && window.google?.maps?.places) {
        autocompleteRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
          types: ['(cities)'],
          fields: ['place_id', 'formatted_address', 'geometry']
        });

        autocompleteRef.current.addListener('place_changed', () => {
          const place = autocompleteRef.current?.getPlace();
          if (place && place.geometry && place.geometry.location) {
            const lat = place.geometry.location.lat();
            const lng = place.geometry.location.lng();
            const formattedAddress = place.formatted_address || '';
            console.log('🎯 Location selected:', formattedAddress, lat, lng);
            onChange(formattedAddress, lat, lng);
          }
        });
      }
      setIsLoaded(true);
    };

    if (apiKey) {
      initializeAutocomplete();
    } else if (apiKey === null) {
      setIsLoaded(true);
    }
  }, [apiKey, onChange]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    // Only call onChange for manual typing, not for autocomplete selections
    if (!window.google?.maps?.places || !autocompleteRef.current) {
      onChange(newValue);
    } else {
      // For Google Places, let the place_changed event handle the onChange
      // But still update the input value visually
      onChange(newValue);
    }
  };

  return (
    <div className="relative">
      <MapPin className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleInputChange}
        placeholder={placeholder}
        className={`pl-10 ${className}`}
        disabled={!isLoaded}
      />
    </div>
  );
};