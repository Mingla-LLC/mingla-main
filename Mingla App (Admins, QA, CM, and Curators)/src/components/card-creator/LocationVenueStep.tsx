import React, { useState } from 'react';
import { MapPin, Search, Navigation, AlertCircle, Building2, Phone, Globe, Clock } from 'lucide-react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { motion } from 'motion/react';

interface LocationVenueStepProps {
  venueName: string;
  setVenueName: (value: string) => void;
  venueAddress: string;
  setVenueAddress: (value: string) => void;
  venueCity: string;
  setVenueCity: (value: string) => void;
  venueState: string;
  setVenueState: (value: string) => void;
  venueZipCode: string;
  setVenueZipCode: (value: string) => void;
  venueCountry: string;
  setVenueCountry: (value: string) => void;
  venueLatitude?: number;
  setVenueLatitude: (value: number) => void;
  venueLongitude?: number;
  setVenueLongitude: (value: number) => void;
  venuePhone?: string;
  setVenuePhone: (value: string) => void;
  venueWebsite?: string;
  setVenueWebsite: (value: string) => void;
  venueNotes?: string;
  setVenueNotes: (value: string) => void;
}

interface PlaceSuggestion {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

export function LocationVenueStep({
  venueName,
  setVenueName,
  venueAddress,
  setVenueAddress,
  venueCity,
  setVenueCity,
  venueState,
  setVenueState,
  venueZipCode,
  setVenueZipCode,
  venueCountry,
  setVenueCountry,
  venueLatitude,
  setVenueLatitude,
  venueLongitude,
  setVenueLongitude,
  venuePhone,
  setVenuePhone,
  venueWebsite,
  setVenueWebsite,
  venueNotes,
  setVenueNotes,
}: LocationVenueStepProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);

  // Simulate Google Places Autocomplete
  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    
    if (query.length < 3) {
      setSuggestions([]);
      return;
    }

    setIsSearching(true);

    // Mock Google Places API response
    setTimeout(() => {
      const mockSuggestions: PlaceSuggestion[] = [
        {
          place_id: '1',
          description: `${query} - Main Street, San Francisco, CA`,
          structured_formatting: {
            main_text: query,
            secondary_text: 'Main Street, San Francisco, CA'
          }
        },
        {
          place_id: '2',
          description: `${query} - Downtown, San Francisco, CA`,
          structured_formatting: {
            main_text: query,
            secondary_text: 'Downtown, San Francisco, CA'
          }
        },
        {
          place_id: '3',
          description: `${query} - Mission District, San Francisco, CA`,
          structured_formatting: {
            main_text: query,
            secondary_text: 'Mission District, San Francisco, CA'
          }
        }
      ];
      
      setSuggestions(mockSuggestions);
      setIsSearching(false);
    }, 500);
  };

  // Handle place selection
  const handlePlaceSelect = async (suggestion: PlaceSuggestion) => {
    // Mock place details
    const mockPlaceDetails = {
      name: suggestion.structured_formatting.main_text,
      formatted_address: suggestion.structured_formatting.secondary_text,
      address_components: [
        { long_name: 'San Francisco', types: ['locality'] },
        { long_name: 'California', types: ['administrative_area_level_1'] },
        { long_name: '94102', types: ['postal_code'] },
        { long_name: 'United States', types: ['country'] }
      ],
      geometry: {
        location: {
          lat: 37.7749,
          lng: -122.4194
        }
      },
      formatted_phone_number: '(415) 555-0123',
      website: 'https://example.com'
    };

    // Fill in the form
    setVenueName(mockPlaceDetails.name);
    setVenueAddress(mockPlaceDetails.formatted_address.split(',')[0]);
    setVenueCity('San Francisco');
    setVenueState('CA');
    setVenueZipCode('94102');
    setVenueCountry('United States');
    setVenueLatitude(mockPlaceDetails.geometry.location.lat);
    setVenueLongitude(mockPlaceDetails.geometry.location.lng);
    
    if (venuePhone !== undefined) setVenuePhone(mockPlaceDetails.formatted_phone_number);
    if (venueWebsite !== undefined) setVenueWebsite(mockPlaceDetails.website);

    // Clear search
    setSearchQuery('');
    setSuggestions([]);
  };

  // Get current location
  const handleUseCurrentLocation = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setVenueLatitude(position.coords.latitude);
          setVenueLongitude(position.coords.longitude);
          
          // Mock reverse geocoding
          setVenueCity('San Francisco');
          setVenueState('CA');
          setVenueCountry('United States');
          
          // Show success feedback
          alert('Location detected successfully!');
        },
        (error) => {
          // Proper error handling with detailed messages
          let errorMessage = 'Unable to get your location. ';
          
          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorMessage += 'Please allow location access in your browser settings.';
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage += 'Location information is unavailable.';
              break;
            case error.TIMEOUT:
              errorMessage += 'Location request timed out.';
              break;
            default:
              errorMessage += 'An unknown error occurred.';
          }
          
          console.error('Geolocation error:', {
            code: error.code,
            message: error.message,
            fullError: error
          });
          
          alert(errorMessage);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    } else {
      alert('Geolocation is not supported by your browser.');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-6"
    >
      {/* Google Places Search */}
      {!showManualEntry && (
        <div>
          <label className="block text-gray-700 mb-2">
            Search for Venue <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <Input
              value={venueName || searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search for a venue, restaurant, or location..."
              className="pl-10 rounded-xl"
            />
            {isSearching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="w-4 h-4 border-2 border-[#eb7825] border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>

          {/* Suggestions Dropdown */}
          {suggestions.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-2 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden"
            >
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.place_id}
                  type="button"
                  onClick={() => handlePlaceSelect(suggestion)}
                  className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0"
                >
                  <div className="flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-[#eb7825] flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-gray-900">{suggestion.structured_formatting.main_text}</p>
                      <p className="text-sm text-gray-500">{suggestion.structured_formatting.secondary_text}</p>
                    </div>
                  </div>
                </button>
              ))}
            </motion.div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 mt-3">
            <Button
              type="button"
              onClick={handleUseCurrentLocation}
              variant="outline"
              className="rounded-xl flex-1"
            >
              <Navigation className="w-4 h-4 mr-2" />
              Use Current Location
            </Button>
          </div>
        </div>
      )}

      {/* Manual Entry Toggle */}
      {showManualEntry && (
        <div className="flex items-center justify-between p-3 bg-blue-50 rounded-xl border border-blue-200">
          <p className="text-sm text-blue-700">Manual entry mode</p>
          <Button
            type="button"
            onClick={() => setShowManualEntry(false)}
            variant="ghost"
            size="sm"
            className="text-blue-700 hover:text-blue-900"
          >
            Switch to Search
          </Button>
        </div>
      )}
    </motion.div>
  );
}