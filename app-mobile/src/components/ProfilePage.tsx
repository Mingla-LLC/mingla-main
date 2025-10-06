import React, { useState, useEffect } from 'react';
import { Text, View, TouchableOpacity } from 'react-native';
import { 
  MapPin, Eye, Calendar, Users, Trophy, Target, Bell, 
  Settings, Shield, LogOut, ChevronRight, FileText,
  Star, TrendingUp, Award, Sparkles, Camera, Navigation, HelpCircle
} from 'lucide-react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ImageWithFallback } from './figma/ImageWithFallback';
import profileImage from '../../assets/16b1d70844c656f5fea042714a1a4d861495a60b.png';

interface ProfilePageProps {
  onSignOut?: () => void;
  onNavigateToActivity?: (tab: 'saved' | 'boards' | 'calendar') => void;
  onNavigateToConnections?: () => void;
  onNavigateToProfileSettings?: () => void;
  onNavigateToAccountSettings?: () => void;
  onNavigateToPrivacyPolicy?: () => void;
  onNavigateToTermsOfService?: () => void;
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
}

export default function ProfilePage({ 
  onSignOut,
  onNavigateToActivity,
  onNavigateToConnections,
  onNavigateToProfileSettings,
  onNavigateToAccountSettings,
  onNavigateToPrivacyPolicy,
  onNavigateToTermsOfService,
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
  onUnblockUser
}: ProfilePageProps) {
  const [currentLocation, setCurrentLocation] = useState('Raleigh, North Carolina, United States');
  const [profileImageSrc, setProfileImageSrc] = useState(userIdentity.profileImage || profileImage);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);

  // Auto-update location on component mount
  useEffect(() => {
    updateLocation();
  }, []);

  const updateLocation = async () => {
    setIsLoadingLocation(true);
    try {
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            const { latitude, longitude } = position.coords;
            // Mock reverse geocoding - in real app would use Google Maps API or similar
            const locations = [
              'New York, NY, United States',
              'Los Angeles, CA, United States', 
              'Chicago, IL, United States',
              'Austin, TX, United States',
              'Seattle, WA, United States',
              'Raleigh, NC, United States'
            ];
            const newLocation = locations[Math.floor(Math.random() * locations.length)];
            setCurrentLocation(newLocation);
            // Persist location
            AsyncStorage.setItem('mingla_user_location', newLocation);
          },
          (error) => {
            console.log('Geolocation error:', error);
            // Fallback to last known location
            AsyncStorage.getItem('mingla_user_location').then(lastLocation => {
              if (lastLocation) {
                setCurrentLocation(lastLocation);
              }
            });
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
        );
      }
    } catch (error) {
      console.log('Location update failed:', error);
    } finally {
      setIsLoadingLocation(false);
    }
  };

  // Sync profile image with userIdentity changes
  useEffect(() => {
    setProfileImageSrc(userIdentity.profileImage || profileImage);
  }, [userIdentity.profileImage]);

  const handleNotificationsToggle = (enabled: boolean) => {
    onNotificationsToggle?.(enabled);
    // Persist notification preference
    AsyncStorage.setItem('mingla_notifications_enabled', enabled.toString());
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

  const journeyStats = [
    { label: 'This Month', value: '1', icon: Calendar },
    { label: 'Day Streak', value: '95', icon: TrendingUp },
    { label: 'Badges', value: '95', icon: Award }
  ];

  const vibes = [
    { label: 'Screen Relax', percentage: 69, color: 'bg-[#eb7825]' },
    { label: 'Creative', percentage: 19, color: 'bg-[#d6691f]' },
    { label: 'Stroll', percentage: 6, color: 'bg-[#f08849]' }
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
    <View className="h-screen bg-gray-50 overflow-y-auto pb-20">
      <View className="max-w-sm mx-auto bg-white min-h-screen">
        {/* Header */}
        <View className="relative pt-12 pb-6 px-6 bg-gradient-to-br from-orange-50 to-amber-50">
          <View className="text-center">
            {/* Profile Image */}
            <View className="relative w-20 h-20 mx-auto mb-4">
              <ImageWithFallback
                src={profileImageSrc}
                alt="Profile"
                className="w-full h-full rounded-full object-cover border-4 border-white shadow-lg"
              />
              <View className="absolute -bottom-1 -right-1 w-6 h-6 bg-green-500 border-2 border-white rounded-full"></View>
            </View>
            
            {/* User Info */}
            <Text className="text-xl font-bold text-gray-900 mb-1">{userIdentity.firstName} {userIdentity.lastName}</Text>
            <Text className="text-sm text-gray-600 mb-3">@{userIdentity.username}</Text>
            
            {/* Location */}
            <View className="flex items-center justify-center gap-1 text-sm text-gray-500">
              <MapPin className={`w-4 h-4 ${isLoadingLocation ? 'animate-pulse' : ''}`} />
              <Text className={isLoadingLocation ? 'animate-pulse' : ''}>{currentLocation}</Text>
              <TouchableOpacity
                onClick={updateLocation}
                disabled={isLoadingLocation}
                className="ml-1 p-1 hover:bg-white hover:bg-opacity-50 rounded-full transition-colors disabled:opacity-50"
                title="Update location"
              >
                <Navigation className={`w-3 h-3 text-gray-400 hover:text-[#eb7825] ${isLoadingLocation ? 'animate-spin' : ''}`} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Stats Grid */}
        <View className="px-6 py-6">
          <View className="grid grid-cols-2 gap-4">
            {stats.map((stat, index) => (
              <TouchableOpacity
                key={index}
                onClick={stat.onClick}
                className={`${stat.bgColor} rounded-2xl p-4 text-center border border-gray-100 hover:scale-105 hover:shadow-md transition-all duration-200 active:scale-95`}
              >
                <View className={`text-2xl font-bold ${stat.color} mb-1`}>
                  {stat.value}
                </View>
                <View className="text-xs text-gray-600 leading-tight">
                  {stat.label}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Your Journey */}
        <View className="px-6 pb-6">

        </View>

        {/* Your Vibes */}
        <View className="px-6 pb-6">
          <View className="bg-white rounded-2xl border border-gray-200 p-4">
            <Text className="font-bold text-gray-900 mb-4">Your Vibes</Text>
            
            <View className="space-y-3">
              {vibes.map((vibe, index) => (
                <View key={index} className="flex items-center justify-between">
                  <Text className="text-sm text-gray-700 flex-1">{vibe.label}</Text>
                  <View className="flex items-center gap-2 flex-1">
                    <View className="flex-1 bg-gray-200 rounded-full h-2">
                      <View 
                        className={`${vibe.color} h-2 rounded-full transition-all duration-300`}
                        style={{ width: `${vibe.percentage}%` }}
                      />
                    </View>
                    <Text className="text-sm font-medium text-[#eb7825] w-8 text-right">
                      {vibe.percentage}%
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* Notifications */}
        <View className="px-6 pb-6">
          <View className="bg-white rounded-2xl border border-gray-200 p-4">
            <View className="flex items-center justify-between mb-3">
              <View className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-[#eb7825]" />
                <Text className="font-bold text-gray-900">Notifications</Text>
              </View>
              <TouchableOpacity
                onClick={() => handleNotificationsToggle(!notificationsEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
                  notificationsEnabled ? 'bg-[#eb7825]' : 'bg-gray-300'
                }`}
              >
                <View
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                    notificationsEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </TouchableOpacity>
            </View>
            <Text className="text-sm text-gray-600 leading-relaxed">
              Get notified about collaboration invites, board activities (likes, RSVPs, discussions, lock-ins), and important actions like being tagged in discussions or activity confirmations
            </Text>
          </View>
        </View>

        {/* Settings */}
        <View className="px-6 pb-6">
          <View className="space-y-3">
            {settingsItems.map((item, index) => (
              <TouchableOpacity
                key={index}
                onClick={item.onClick}
                className="w-full bg-white rounded-2xl border border-gray-200 p-4 flex items-center gap-3 hover:bg-gray-50 transition-colors"
              >
                <View className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <item.icon className="w-5 h-5 text-gray-600" />
                </View>
                <View className="flex-1 text-left">
                  <Text className="font-medium text-gray-900">{item.label}</Text>
                  <Text className="text-xs text-gray-500 mt-0.5">{item.description}</Text>
                </View>
                <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Connection Settings */}
        <View className="px-6 pb-6">
          <Text className="text-sm font-medium text-gray-500 mb-3 px-2">Connection Settings</Text>
          <View className="space-y-3">
            {/* Blocked Users */}
            <View className="w-full bg-white rounded-2xl border border-gray-200 p-4">
              <View className="flex items-center gap-3 mb-3">
                <View className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <Shield className="w-5 h-5 text-gray-600" />
                </View>
                <View className="flex-1">
                  <Text className="font-medium text-gray-900">Blocked Users</Text>
                  <Text className="text-xs text-gray-500 mt-0.5">
                    {blockedUsers.length === 0 ? 'No blocked users' : `${blockedUsers.length} user${blockedUsers.length === 1 ? '' : 's'} blocked`}
                  </Text>
                </View>
              </View>
              
              {/* Blocked Users List */}
              {blockedUsers.length > 0 && (
                <View className="space-y-3 mt-3 pt-3 border-t border-gray-100">
                  {blockedUsers.map((user) => (
                    <View key={user.id} className="flex items-center justify-between">
                      <View className="flex items-center gap-3">
                        <View className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                          <Text className="text-xs font-medium text-gray-600">
                            {user.name.split(' ').map((n: string) => n[0]).join('')}
                          </Text>
                        </View>
                        <View>
                          <Text className="text-sm font-medium text-gray-900">{user.name}</Text>
                          <Text className="text-xs text-gray-500">@{user.username}</Text>
                        </View>
                      </View>
                      <TouchableOpacity
                        onClick={() => onUnblockUser?.(user)}
                        className="px-3 py-1 text-xs bg-[#eb7825] text-white rounded-full hover:bg-[#d6691f] transition-colors"
                      >
                        Unblock
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Legal & Privacy */}
        <View className="px-6 pb-6">
          <Text className="text-sm font-medium text-gray-500 mb-3 px-2">Legal & Privacy</Text>
          <View className="space-y-3">
            {legalItems.map((item, index) => (
              <TouchableOpacity
                key={index}
                onClick={item.onClick}
                className="w-full bg-white rounded-2xl border border-gray-200 p-4 flex items-center gap-3 hover:bg-gray-50 transition-colors"
              >
                <View className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <item.icon className="w-5 h-5 text-gray-600" />
                </View>
                <View className="flex-1 text-left">
                  <Text className="font-medium text-gray-900">{item.label}</Text>
                  <Text className="text-xs text-gray-500 mt-0.5">{item.description}</Text>
                </View>
                <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
              </TouchableOpacity>
            ))}
          </View>
        </View>



        {/* Sign Out */}
        <View className="px-6 pb-8">
          <TouchableOpacity
            onClick={onSignOut}
            className="w-full bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 py-3 px-4 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}