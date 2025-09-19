import React, { useState, useRef, useEffect } from 'react';
import { Loader } from '@googlemaps/js-api-loader';
import { Input } from '@/components/ui/input';
import { MapPin } from 'lucide-react';

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
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<any>(null);

  useEffect(() => {
    const initializeAutocomplete = async () => {
      try {
        const loader = new Loader({
          apiKey: 'YOUR_GOOGLE_MAPS_API_KEY', // This will be replaced with proper key
          version: 'weekly',
          libraries: ['places']
        });

        await loader.load();
        
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
              onChange(place.formatted_address || '', lat, lng);
            }
          });
        }
        
        setIsLoaded(true);
      } catch (error) {
        console.log('Google Maps API not available, using fallback input');
        setIsLoaded(true);
      }
    };

    initializeAutocomplete();
  }, [onChange]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
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
      />
    </div>
  );
};