import React, { useState, useEffect, useMemo } from 'react';
import { 
  MapPin, Eye, Calendar, Users, Trophy, Target, Bell, 
  Settings, Shield, LogOut, ChevronRight, FileText,
  Star, TrendingUp, Award, Sparkles, Camera, Navigation, HelpCircle,
  Clock, CheckCircle, Flame, Heart
} from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { getCategoryLabel } from './utils/formatters';
import profileImage from 'figma:asset/16b1d70844c656f5fea042714a1a4d861495a60b.png';

interface ProfilePageProps {
  onSignOut?: () => void;
  onNavigateToActivity?: (tab: 'saved' | 'boards' | 'calendar') => void;
  onNavigateToConnections?: () => void;
  onNavigateToProfileSettings?: () => void;
  onNavigateToAccountSettings?: () => void;
  onNavigateToPrivacyPolicy?: () => void;
  onNavigateToTermsOfService?: () => void;
  onNavigateToBusinessDashboard?: () => void;
  userRole?: string;
  savedExperiences?: number;
  boardsCount?: number;
  connectionsCount?: number;
  placesVisited?: number;
  notificationsEnabled?: boolean;
  onNotificationsToggle?: (enabled: boolean) => void;
  userIdentity?: {
    firstName: string;
    lastName: string;
    username: string;
    profileImage: string | null;
  };
  blockedUsers?: any[];
  onUnblockUser?: (blockedUser: any, suppressNotification?: boolean) => void;
  savedCards?: any[];
  calendarEntries?: any[];
  accountPreferences?: {
    currency: string;
    measurementSystem: 'Metric' | 'Imperial';
  };
}

export default function ProfilePage({ 
  onSignOut,
  onNavigateToActivity,
  onNavigateToConnections,
  onNavigateToProfileSettings,
  onNavigateToAccountSettings,
  onNavigateToPrivacyPolicy,
  onNavigateToTermsOfService,
  onNavigateToBusinessDashboard,
  userRole = 'explorer',
  savedExperiences = 24,
  boardsCount = 6,
  connectionsCount = 13,
  placesVisited = 0,
  notificationsEnabled = true,
  onNotificationsToggle,
  userIdentity = {
    firstName: 'Jordan',
    lastName: 'Smith', 
    username: 'jordansmith',
    profileImage: null
  },
  blockedUsers = [],
  onUnblockUser,
  savedCards = [],
  calendarEntries = [],
  accountPreferences = {
    currency: 'USD',
    measurementSystem: 'Imperial' as const
  }
}: ProfilePageProps) {
  const [currentLocation, setCurrentLocation] = useState('Raleigh, North Carolina, United States');
  const [profileImageSrc, setProfileImageSrc] = useState(userIdentity.profileImage || profileImage);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [hasUploadedImage, setHasUploadedImage] = useState(!!userIdentity.profileImage);
  const [showCompletionBox, setShowCompletionBox] = useState(true);

  // Calculate dynamic vibes from saved cards and calendar entries
  const vibesData = useMemo(() => {
    const allCards = [...savedCards, ...calendarEntries.map((entry: any) => entry.experience)];
    
    if (allCards.length === 0) {
      // Default vibes when no data
      return [
        { label: 'Screen & Relax', percentage: 0, color: 'bg-[#eb7825]', count: 0 },
        { label: 'Creative & Hands-On', percentage: 0, color: 'bg-[#eb7825]', count: 0 },
        { label: 'Take a Stroll', percentage: 0, color: 'bg-[#f08849]', count: 0 }
      ];
    }
    
    // Count categories
    const categoryCounts: { [key: string]: number } = {};
    allCards.forEach((card: any) => {
      if (card && card.category) {
        const categoryLabel = getCategoryLabel(card.category);
        categoryCounts[categoryLabel] = (categoryCounts[categoryLabel] || 0) + 1;
      }
    });
    
    // Sort by count and get top 3
    const sortedCategories = Object.entries(categoryCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3);
    
    const total = allCards.length;
    
    return sortedCategories.map(([label, count], index) => ({
      label,
      count,
      percentage: Math.round((count / total) * 100),
      color: index === 0 ? 'bg-[#eb7825]' : index === 1 ? 'bg-[#eb7825]' : 'bg-[#f08849]'
    }));
  }, [savedCards, calendarEntries]);

  // Calculate profile completion percentage
  const profileCompletion = useMemo(() => {
    let completed = 0;
    const total = 6;
    
    if (userIdentity.profileImage) completed++;
    if (userIdentity.firstName && userIdentity.lastName) completed++;
    if (savedExperiences > 0) completed++;
    if (connectionsCount > 0) completed++;
    if (boardsCount > 0) completed++;
    if (placesVisited > 0) completed++;
    
    return Math.round((completed / total) * 100);
  }, [userIdentity, savedExperiences, connectionsCount, boardsCount, placesVisited]);

  // Auto-update location on component mount
  useEffect(() => {
    // Load saved location immediately
    const savedLocation = localStorage.getItem('mingla_user_location');
    if (savedLocation) {
      setCurrentLocation(savedLocation);
    }
    
    // Then try to update with current position
    updateLocation();
  }, []);

  const updateLocation = async () => {
    setIsLoadingLocation(true);
    setLocationError(null);
    
    try {
      if (!('geolocation' in navigator)) {
        const errorMsg = 'Location services not available in this browser';
        console.warn('Geolocation API not supported');
        setLocationError(errorMsg);
        setIsLoadingLocation(false);
        
        // Still load saved location if available
        const savedLocation = localStorage.getItem('mingla_user_location');
        if (savedLocation) {
          setCurrentLocation(savedLocation);
        }
        return;
      }

      // Use robust geolocation utility with automatic fallback
      const { getCurrentLocation } = await import('./utils/geolocation');
      
      try {
        const locationResult = await getCurrentLocation();
        
        // Reverse geocode to get address
        const newLocation = await reverseGeocode(locationResult.lat, locationResult.lng);
        setCurrentLocation(newLocation);
        localStorage.setItem('mingla_user_location', newLocation);
        setLocationError(null);
        
        // Show info if using fallback
        if (locationResult.source === 'ip') {
          console.log('ℹ️ Using IP-based location (GPS unavailable)');
        } else if (locationResult.source === 'default') {
          console.log('ℹ️ Using default location (location services unavailable)');
        }
      } catch (error) {
        console.error('Location error:', error);
        setLocationError('Could not determine location');
        
        // Fallback to last known location
        const lastLocation = localStorage.getItem('mingla_user_location');
        if (lastLocation) {
          setCurrentLocation(lastLocation);
        }
      } finally {
        setIsLoadingLocation(false);
      }
    } catch (error) {
      console.error('Location update failed:', error);
      setLocationError('Location update failed');
      setIsLoadingLocation(false);
    }
  };

  // Mock reverse geocoding function (in production, use Google Geocoding API)
  const reverseGeocode = async (lat: number, lng: number): Promise<string> => {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // In production, you would call:
    // const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=YOUR_API_KEY`);
    // const data = await response.json();
    // return data.results[0].formatted_address;
    
    // Mock implementation - return a location based on coordinates
    const locations = [
      'New York, NY, United States',
      'Los Angeles, CA, United States',
      'Chicago, IL, United States',
      'Austin, TX, United States',
      'Seattle, WA, United States',
      'San Francisco, CA, United States',
      'Miami, FL, United States',
      'Boston, MA, United States',
      'Denver, CO, United States',
      'Portland, OR, United States'
    ];
    
    // Use coordinates to deterministically select a location (for consistency)
    const index = Math.floor(Math.abs(lat + lng) % locations.length);
    return locations[index];
  };

  // Sync profile image with userIdentity changes
  useEffect(() => {
    setProfileImageSrc(userIdentity.profileImage || profileImage);
    setHasUploadedImage(!!userIdentity.profileImage);
  }, [userIdentity.profileImage]);

  // Handle image upload
  const handleImageUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const newImageSrc = e.target?.result as string;
          setProfileImageSrc(newImageSrc);
          setHasUploadedImage(true);
          
          // Animate to 100% and then hide
          setTimeout(() => {
            setShowCompletionBox(false);
          }, 1500); // Show 100% for a moment before vanishing
          
          // Save to localStorage
          localStorage.setItem('mingla_profile_image', newImageSrc);
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  // Get user initials
  const getUserInitials = () => {
    const first = userIdentity.firstName?.charAt(0) || '';
    const last = userIdentity.lastName?.charAt(0) || '';
    return `${first}${last}`.toUpperCase();
  };

  const handleNotificationsToggle = (enabled: boolean) => {
    onNotificationsToggle?.(enabled);
    // Persist notification preference
    localStorage.setItem('mingla_notifications_enabled', enabled.toString());
  };

  const stats = [
    { 
      label: 'Experiences Saved', 
      value: savedExperiences, 
      color: savedExperiences > 0 ? 'text-[#eb7825]' : 'text-gray-500', 
      bgColor: savedExperiences > 0 ? 'bg-orange-50' : 'bg-gray-50',
      onClick: () => onNavigateToActivity?.('saved')
    },
    { 
      label: 'Boards Created', 
      value: boardsCount, 
      color: boardsCount > 0 ? 'text-[#eb7825]' : 'text-gray-500', 
      bgColor: boardsCount > 0 ? 'bg-orange-50' : 'bg-gray-50',
      onClick: () => onNavigateToActivity?.('boards')
    },
    { 
      label: 'Connections', 
      value: connectionsCount, 
      color: connectionsCount > 0 ? 'text-[#eb7825]' : 'text-gray-500', 
      bgColor: connectionsCount > 0 ? 'bg-orange-50' : 'bg-gray-50',
      onClick: () => onNavigateToConnections?.()
    },
    { 
      label: 'Places Visited', 
      value: placesVisited, 
      color: placesVisited > 0 ? 'text-[#eb7825]' : 'text-gray-500', 
      bgColor: placesVisited > 0 ? 'bg-orange-50' : 'bg-gray-50',
      onClick: () => onNavigateToActivity?.('calendar')
    }
  ];



  const settingsItems = [
    { 
      icon: Settings, 
      label: 'Profile Settings', 
      description: 'Edit your name, username, and profile photo',
      onClick: () => onNavigateToProfileSettings?.() 
    },
    { 
      icon: Shield, 
      label: 'Account Settings', 
      description: 'Currency, measurements, and account lifecycle',
      onClick: () => onNavigateToAccountSettings?.() 
    },

  ];

  const legalItems = [
    { 
      icon: Shield, 
      label: 'Privacy Policy', 
      description: 'How we collect, use, and protect your information',
      onClick: () => onNavigateToPrivacyPolicy?.() 
    },
    { 
      icon: FileText, 
      label: 'Terms of Service', 
      description: 'Terms and conditions for using Mingla',
      onClick: () => onNavigateToTermsOfService?.() 
    }
  ];

  return (
    <div className="h-screen bg-gray-50 overflow-y-auto pb-20">
      <div className="max-w-sm mx-auto bg-white min-h-screen" data-coachmark="profile-page-content">
        {/* Header */}
        <div className="relative pt-12 pb-6 px-6 bg-gradient-to-br from-orange-50 to-amber-50" data-coachmark="profile-header">
          <div className="text-center">
            {/* Profile Image */}
            <div className="relative w-20 h-20 mx-auto mb-4 bounce-in">
              <button
                onClick={handleImageUpload}
                className="relative w-full h-full group cursor-pointer"
              >
                {!hasUploadedImage ? (
                  // Show initials when no image uploaded
                  <div className="w-full h-full rounded-full bg-gradient-to-br from-[#eb7825] to-[#d6691f] border-4 border-white shadow-lg flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                    <span className="text-2xl font-bold text-white">
                      {getUserInitials()}
                    </span>
                    {/* Camera icon badge - always visible to nudge upload */}
                    <div className="absolute bottom-0 right-0 w-7 h-7 bg-white rounded-full flex items-center justify-center shadow-lg border-2 border-[#eb7825] group-hover:scale-110 transition-transform duration-200">
                      <Camera className="w-4 h-4 text-[#eb7825]" />
                    </div>
                  </div>
                ) : (
                  // Show uploaded image
                  <>
                    <ImageWithFallback
                      src={profileImageSrc}
                      alt="Profile"
                      className="w-full h-full rounded-full object-cover border-4 border-white shadow-lg transition-transform duration-300 group-hover:scale-110"
                    />
                    {/* Camera overlay on hover */}
                    <div className="absolute inset-0 rounded-full bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all duration-200 flex items-center justify-center">
                      <Camera className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                    </div>
                  </>
                )}
              </button>
            </div>
            
            {/* User Info */}
            <h1 className="text-xl font-bold text-gray-900 mb-1">{userIdentity.firstName} {userIdentity.lastName}</h1>
            <p className="text-sm text-gray-600 mb-3">@{userIdentity.username}</p>
            
            {/* Location */}
            <div className="flex flex-col items-center gap-1">
              <div className="flex items-center justify-center gap-1 text-sm text-gray-500">
                <MapPin className={`w-4 h-4 ${isLoadingLocation ? 'animate-pulse' : ''}`} />
                <span className={isLoadingLocation ? 'animate-pulse' : ''}>{currentLocation}</span>
                <button
                  onClick={updateLocation}
                  disabled={isLoadingLocation}
                  className="ml-1 p-1 hover:bg-white hover:bg-opacity-50 rounded-full transition-colors disabled:opacity-50"
                  title="Update location"
                >
                  <Navigation className={`w-3 h-3 text-gray-400 hover:text-[#eb7825] ${isLoadingLocation ? 'animate-spin' : ''}`} />
                </button>
              </div>
              {locationError && (
                <span className="text-xs text-red-500">{locationError}</span>
              )}
            </div>
            
            {/* Profile Completion */}
            {!hasUploadedImage && showCompletionBox && (
              <div className="mt-4 bg-white bg-opacity-50 rounded-lg p-3 transition-all duration-500">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-700">Profile Completion</span>
                  <span className="text-xs font-bold text-[#eb7825]">90%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                  <div 
                    className="bg-[#eb7825] h-2 rounded-full transition-all duration-300"
                    style={{ width: '90%' }}
                  />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Camera className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
                  <p className="text-xs text-gray-600">
                    Upload a profile picture to complete your profile
                  </p>
                </div>
              </div>
            )}
            {hasUploadedImage && showCompletionBox && (
              <div className="mt-4 bg-white bg-opacity-50 rounded-lg p-3 animate-[fadeOut_0.5s_ease-out_1s_forwards]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-700">Profile Completion</span>
                  <span className="text-xs font-bold text-green-600">100%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                  <div 
                    className="bg-green-500 h-2 rounded-full transition-all duration-500"
                    style={{ width: '100%' }}
                  />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <CheckCircle className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                  <p className="text-xs text-green-600">
                    Profile complete!
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="px-6 py-6">
          <div className="grid grid-cols-2 gap-4">
            {stats.map((stat, index) => (
              <button
                key={index}
                onClick={stat.onClick}
                className={`${stat.bgColor} glass-card rounded-2xl p-4 text-center card-elevated active:scale-95 spring-in`}
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <div className={`text-2xl font-bold ${stat.color} mb-1`}>
                  {stat.value}
                </div>
                <div className="text-xs text-gray-600 leading-tight">
                  {stat.label}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Your Vibes */}
        {vibesData.length > 0 && vibesData[0].count > 0 && (
          <div className="px-6 pb-6">
            <div className="glass-card rounded-2xl card-elevated p-4 slide-up">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-gray-900">Your Vibes</h3>
              </div>
              
              <div className="space-y-3">
                {vibesData.map((vibe, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <span className="text-sm text-gray-700 flex-1 min-w-0 truncate">{vibe.label}</span>
                    <div className="flex items-center gap-2 flex-1">
                      <div className="flex-1 bg-gray-200 rounded-full h-2">
                        <div 
                          className={`${vibe.color} h-2 rounded-full transition-all duration-300`}
                          style={{ width: `${vibe.percentage}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium text-[#eb7825] w-12 text-right">
                        {vibe.percentage}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Recent Activity */}
        {calendarEntries.length > 0 && (
          <div className="px-6 pb-6">
            <div className="glass-card rounded-2xl card-elevated p-4 slide-up">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-[#eb7825]" />
                  <h3 className="font-bold text-gray-900">Recent Activity</h3>
                </div>
                <button
                  onClick={() => onNavigateToActivity?.('calendar')}
                  className="text-sm text-[#eb7825] font-medium hover:underline"
                >
                  View All
                </button>
              </div>
              
              <div className="space-y-3">
                {calendarEntries.slice(0, 3).map((entry: any, index: number) => {
                  const entryDate = new Date(entry.addedAt);
                  const isRecent = Date.now() - entryDate.getTime() < 24 * 60 * 60 * 1000; // Within 24 hours
                  
                  return (
                    <div key={entry.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                      <div className={`w-2 h-2 rounded-full mt-2 ${isRecent ? 'bg-[#eb7825]' : 'bg-gray-300'}`}></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {entry.experience.title}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {entry.isPurchased ? '🛍️ Purchased' : '❤️ Saved'} · {entryDate.toLocaleDateString('en-US', { 
                            month: 'short', 
                            day: 'numeric',
                            ...(isRecent ? { hour: 'numeric', minute: '2-digit' } : {})
                          })}
                        </p>
                      </div>
                      {entry.experience.category && (
                        <span className="px-2 py-1 bg-white border border-gray-200 rounded-lg text-xs text-gray-600 whitespace-nowrap">
                          {getCategoryLabel(entry.experience.category)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              
              {calendarEntries.length === 0 && (
                <div className="text-center py-6">
                  <p className="text-sm text-gray-500">No recent activity yet</p>
                  <p className="text-xs text-gray-400 mt-1">Start exploring to see your activity here</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Notifications */}
        <div className="px-6 pb-6">
          <div className="glass-card rounded-2xl card-elevated p-4 slide-up">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-[#eb7825]" />
                <h3 className="font-bold text-gray-900">Notifications</h3>
              </div>
              <button
                onClick={() => handleNotificationsToggle(!notificationsEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
                  notificationsEnabled ? 'bg-[#eb7825]' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                    notificationsEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">
              Get notified about collaboration invites, board activities (likes, RSVPs, discussions, lock-ins), and important actions like being tagged in discussions or activity confirmations
            </p>
          </div>
        </div>

        {/* Settings */}
        <div className="px-6 pb-6">
          <div className="space-y-3">
            {settingsItems.map((item, index) => (
              <button
                key={index}
                onClick={item.onClick}
                className="w-full glass-card rounded-2xl p-4 flex items-center gap-3 card-elevated slide-up"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <item.icon className="w-5 h-5 text-gray-600" />
                </div>
                <div className="flex-1 text-left">
                  <h4 className="font-medium text-gray-900">{item.label}</h4>
                  <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>

        {/* Legal & Privacy */}
        <div className="px-6 pb-6">
          <h3 className="text-sm font-medium text-gray-500 mb-3 px-2">Legal & Privacy</h3>
          <div className="space-y-3">
            {legalItems.map((item, index) => (
              <button
                key={index}
                onClick={item.onClick}
                className="w-full bg-white rounded-2xl border border-gray-200 p-4 flex items-center gap-3 hover:bg-gray-50 transition-colors"
              >
                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <item.icon className="w-5 h-5 text-gray-600" />
                </div>
                <div className="flex-1 text-left">
                  <h4 className="font-medium text-gray-900">{item.label}</h4>
                  <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>



        {/* Sign Out */}
        <div className="px-6 pb-8">
          <button
            onClick={onSignOut}
            className="w-full bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 py-3 px-4 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}