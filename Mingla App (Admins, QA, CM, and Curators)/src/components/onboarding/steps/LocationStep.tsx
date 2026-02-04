import React, { useState } from 'react';
import { MapPin, Navigation, Loader } from 'lucide-react';
import { StepProps } from '../types';

export default function LocationStep({ data, onUpdate }: StepProps) {
  const [isLoadingGPS, setIsLoadingGPS] = useState(false);
  const [locationError, setLocationError] = useState('');

  const handleUseCurrentLocation = () => {
    setIsLoadingGPS(true);
    setLocationError('');

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          // Mock geocoding result
          const mockAddress = 'San Francisco, CA';
          onUpdate({ 
            location: mockAddress,
            locationDetails: {
              address: mockAddress,
              city: 'San Francisco',
              state: 'CA',
              coordinates: {
                lat: position.coords.latitude,
                lng: position.coords.longitude
              }
            }
          });
          setIsLoadingGPS(false);
        },
        (error) => {
          setLocationError('Location access denied. Please enter your location manually.');
          setIsLoadingGPS(false);
        }
      );
    } else {
      setLocationError('Geolocation is not supported by your browser.');
      setIsLoadingGPS(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="text-center space-y-1 px-4 sm:px-6">
        <h2 className="text-gray-900">Where are you?</h2>
        <p className="text-xs text-gray-600">
          We'll show you experiences near your location
        </p>
      </div>

      {/* GPS Location Button */}
      <div className="px-4 sm:px-6">
        <button
          onClick={handleUseCurrentLocation}
          disabled={isLoadingGPS}
          className="w-full p-3 border-2 border-[#eb7825] rounded-lg bg-orange-50 hover:bg-orange-100 transition-colors flex items-center justify-center space-x-2 disabled:opacity-50"
        >
          {isLoadingGPS ? (
            <>
              <Loader className="w-4 h-4 text-[#eb7825] animate-spin" />
              <span className="text-sm text-[#eb7825]">Getting location...</span>
            </>
          ) : (
            <>
              <Navigation className="w-4 h-4 text-[#eb7825]" />
              <span className="text-sm text-[#eb7825]">Use my current location</span>
            </>
          )}
        </button>
      </div>

      {/* Divider */}
      <div className="flex items-center px-4 sm:px-6">
        <div className="flex-1 border-t border-gray-200"></div>
        <span className="px-3 text-xs text-gray-500">or</span>
        <div className="flex-1 border-t border-gray-200"></div>
      </div>

      {/* Manual Location Input */}
      <div className="px-4 sm:px-6 space-y-3">
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={data.location}
            onChange={(e) => onUpdate({ location: e.target.value })}
            placeholder="Enter your city or address"
            className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-lg focus:border-[#eb7825] focus:outline-none transition-colors text-sm"
          />
        </div>

        {/* Error Message */}
        {locationError && (
          <p className="text-xs text-red-600">{locationError}</p>
        )}

        {/* Helper Text */}
        <p className="text-xs text-gray-500 text-center">
          We use your location to find experiences nearby
        </p>
      </div>

      {/* Quick Location Options */}
      <div className="px-4 sm:px-6">
        <p className="text-xs text-gray-600 mb-2">Popular locations:</p>
        <div className="flex flex-wrap gap-2">
          {['San Francisco, CA', 'New York, NY', 'Los Angeles, CA', 'Chicago, IL'].map((loc) => (
            <button
              key={loc}
              onClick={() => onUpdate({ location: loc })}
              className={`px-3 py-1.5 rounded-full text-xs transition-colors ${
                data.location === loc
                  ? 'bg-[#eb7825] text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {loc}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}