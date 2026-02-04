/**
 * Profile Screen - User profile and settings
 * Profile info, stats, settings, and account management
 */

import React from 'react';
import ProfilePage from '../components/ProfilePage';

interface ProfileScreenProps {
  onSignOut: () => void;
  onNavigateToActivity: (tab: string) => void;
  onNavigateToConnections: () => void;
  onNavigateToProfileSettings: () => void;
  onNavigateToAccountSettings: () => void;
  onNavigateToPrivacyPolicy: () => void;
  onNavigateToTermsOfService: () => void;
  savedExperiences: number;
  boardsCount: number;
  connectionsCount: number;
  placesVisited: number;
  notificationsEnabled: boolean;
  onNotificationsToggle: (enabled: boolean) => void;
  userIdentity: any;
  blockedUsers: any[];
  onUnblockUser: (user: any) => void;
  savedCards: any[];
  calendarEntries: any[];
  accountPreferences: any;
}

export default function ProfileScreen(props: ProfileScreenProps) {
  return <ProfilePage {...props} />;
}
