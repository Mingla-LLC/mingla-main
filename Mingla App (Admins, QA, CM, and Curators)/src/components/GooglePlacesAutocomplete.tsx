import React, { useState, useRef, useEffect } from 'react';
import { MapPin, Loader2, Check } from 'lucide-react';
import { Input } from './ui/input';

interface GooglePlacesAutocompleteProps {
  value: string;
  onChange: (address: string, placeDetails?: PlaceDetails) => void;
  placeholder?: string;
  className?: string;
}

interface PlaceDetails {
  address: string;
  formattedAddress: string;
  placeId: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
  googleMapsUrl?: string;
}

// Mock Google Places data for demonstration
const MOCK_PLACES = [
  {
    address: 'Golden Gate Park, San Francisco, CA 94122',
    formattedAddress: 'Golden Gate Park, San Francisco, CA 94122, USA',
    placeId: 'ChIJW_Wc1f6AhYARe45bJV1gTR4',
    coordinates: { lat: 37.7694, lng: -122.4862 },
    googleMapsUrl: 'https://maps.google.com/?q=Golden+Gate+Park,+San+Francisco,+CA'
  },
  {
    address: 'Dolores Park, San Francisco, CA 94110',
    formattedAddress: 'Dolores Park, San Francisco, CA 94110, USA',
    placeId: 'ChIJvZi1pE-AhYARSCvV5Wa3pYQ',
    coordinates: { lat: 37.7596, lng: -122.4269 },
    googleMapsUrl: 'https://maps.google.com/?q=Dolores+Park,+San+Francisco,+CA'
  },
  {
    address: 'Presidio of San Francisco, CA 94129',
    formattedAddress: 'Presidio of San Francisco, CA 94129, USA',
    placeId: 'ChIJNUn8shN-j4ARNEz6CK0F8ZI',
    coordinates: { lat: 37.7989, lng: -122.4662 },
    googleMapsUrl: 'https://maps.google.com/?q=Presidio+of+San+Francisco,+CA'
  },
  {
    address: 'Blue Bottle Coffee, Ferry Building, San Francisco, CA',
    formattedAddress: 'Blue Bottle Coffee, 1 Ferry Building, San Francisco, CA 94111, USA',
    placeId: 'ChIJ-1hN1f2AhYARMzqNLqWKskg',
    coordinates: { lat: 37.7955, lng: -122.3937 },
    googleMapsUrl: 'https://maps.google.com/?q=Blue+Bottle+Coffee,+Ferry+Building'
  },
  {
    address: 'Tartine Bakery, 600 Guerrero St, San Francisco, CA',
    formattedAddress: 'Tartine Bakery, 600 Guerrero St, San Francisco, CA 94110, USA',
    placeId: 'ChIJd7zXzU-AhYAR6qiU8nhS1wU',
    coordinates: { lat: 37.7604, lng: -122.4238 },
    googleMapsUrl: 'https://maps.google.com/?q=Tartine+Bakery,+San+Francisco'
  },
  {
    address: 'The Fillmore, 1805 Geary Blvd, San Francisco, CA',
    formattedAddress: 'The Fillmore, 1805 Geary Blvd, San Francisco, CA 94115, USA',
    placeId: 'ChIJzb_8_B2BhYARjM8wPiKZbq4',
    coordinates: { lat: 37.7841, lng: -122.4331 },
    googleMapsUrl: 'https://maps.google.com/?q=The+Fillmore,+San+Francisco'
  },
  {
    address: 'Mission Dolores Park Tennis Courts, San Francisco, CA',
    formattedAddress: 'Mission Dolores Park Tennis Courts, San Francisco, CA 94110, USA',
    placeId: 'ChIJvZi1pE-AhYARSCvV5Wa3pYQ-tc',
    coordinates: { lat: 37.7598, lng: -122.4275 },
    googleMapsUrl: 'https://maps.google.com/?q=Mission+Dolores+Park+Tennis+Courts'
  },
  {
    address: 'Alamo Square, San Francisco, CA 94117',
    formattedAddress: 'Alamo Square, San Francisco, CA 94117, USA',
    placeId: 'ChIJ-1XSs_mAhYARjhnb6P6FKo8',
    coordinates: { lat: 37.7766, lng: -122.4345 },
    googleMapsUrl: 'https://maps.google.com/?q=Alamo+Square,+San+Francisco'
  },
  {
    address: 'Crissy Field, San Francisco, CA 94129',
    formattedAddress: 'Crissy Field, San Francisco, CA 94129, USA',
    placeId: 'ChIJl1_iDhN-j4ARzEPT8UPz7BU',
    coordinates: { lat: 37.8024, lng: -122.4662 },
    googleMapsUrl: 'https://maps.google.com/?q=Crissy+Field,+San+Francisco'
  },
  {
    address: 'Twin Peaks Summit, San Francisco, CA 94114',
    formattedAddress: 'Twin Peaks Summit, San Francisco, CA 94114, USA',
    placeId: 'ChIJ-WdnNFZ_j4ARpRvU6Kj1wYY',
    coordinates: { lat: 37.7544, lng: -122.4477 },
    googleMapsUrl: 'https://maps.google.com/?q=Twin+Peaks+Summit,+San+Francisco'
  }
];

export default function GooglePlacesAutocomplete({
  value,
  onChange,
  placeholder = 'Start typing an address...',
  className = ''
}: GooglePlacesAutocompleteProps) {
  const [inputValue, setInputValue] = useState(value);
  const [suggestions, setSuggestions] = useState<PlaceDetails[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isValidated, setIsValidated] = useState(false);
  
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Update input value when prop changes
  useEffect(() => {
    setInputValue(value);
    // Check if the value matches a validated address
    setIsValidated(MOCK_PLACES.some(place => 
      place.formattedAddress === value || place.address === value
    ));
  }, [value]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Mock autocomplete search with debounce
  useEffect(() => {
    if (inputValue.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setIsLoading(true);
    const timer = setTimeout(() => {
      // Mock search - filter places by input value
      const query = inputValue.toLowerCase();
      const filtered = MOCK_PLACES.filter(place =>
        place.address.toLowerCase().includes(query) ||
        place.formattedAddress.toLowerCase().includes(query)
      ).slice(0, 5); // Limit to 5 suggestions

      setSuggestions(filtered);
      setShowSuggestions(true);
      setIsLoading(false);
    }, 300); // Simulate network delay

    return () => clearTimeout(timer);
  }, [inputValue]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    setIsValidated(false);
    setSelectedIndex(-1);
  };

  const handleSelectSuggestion = (place: PlaceDetails) => {
    setInputValue(place.formattedAddress);
    onChange(place.formattedAddress, place);
    setShowSuggestions(false);
    setIsValidated(true);
    setSelectedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => prev > 0 ? prev - 1 : -1);
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          handleSelectSuggestion(suggestions[selectedIndex]);
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        setSelectedIndex(-1);
        break;
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && suggestionsRef.current) {
      const selectedElement = suggestionsRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div className="relative">
        <Input
          ref={inputRef}
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0 && inputValue.length >= 2) {
              setShowSuggestions(true);
            }
          }}
          placeholder={placeholder}
          className={`${className} pr-10`}
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
          {isLoading ? (
            <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
          ) : isValidated ? (
            <Check className="w-4 h-4 text-green-600" />
          ) : (
            <MapPin className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </div>

      {/* Suggestions Dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto"
        >
          {suggestions.map((place, index) => (
            <button
              key={place.placeId}
              type="button"
              onClick={() => handleSelectSuggestion(place)}
              className={`w-full px-4 py-3 text-left hover:bg-[#eb7825]/5 transition-colors border-b border-gray-100 last:border-b-0 ${
                index === selectedIndex ? 'bg-[#eb7825]/10' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-[#eb7825] flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 truncate">
                    {place.address}
                  </p>
                  {place.formattedAddress !== place.address && (
                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                      {place.formattedAddress}
                    </p>
                  )}
                </div>
                <Check className={`w-4 h-4 text-green-600 flex-shrink-0 mt-1 ${
                  index === selectedIndex ? 'opacity-100' : 'opacity-0'
                }`} />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* No results message */}
      {showSuggestions && suggestions.length === 0 && !isLoading && inputValue.length >= 2 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg p-4">
          <div className="flex items-center gap-3 text-gray-500">
            <MapPin className="w-5 h-5" />
            <div>
              <p className="text-sm">No places found</p>
              <p className="text-xs mt-0.5">Try searching for a landmark, address, or business name</p>
            </div>
          </div>
        </div>
      )}

      {/* Helper text - only show when not validated and not showing suggestions */}
      {!isValidated && !showSuggestions && inputValue.length === 0 && (
        <p className="text-xs text-gray-500 mt-1">
          <MapPin className="w-3 h-3 inline mr-1" />
          Type to search Google Maps locations
        </p>
      )}
    </div>
  );
}
