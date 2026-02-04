/**
 * Home Screen - Main discovery interface
 * Primary screen where users swipe through experience cards
 */

import React from 'react';
import HomePage from '../components/HomePage';

interface HomeScreenProps {
  onOpenPreferences: () => void;
  onOpenCollaboration: () => void;
  onOpenCollabPreferences: () => void;
  currentMode: string;
  userPreferences: any;
  accountPreferences: any;
  onAddToCalendar: (data: any) => void;
  savedCards: any[];
  onSaveCard: (card: any) => void;
  onShareCard: (card: any) => void;
  onPurchaseComplete: (experience: any, option: any) => void;
  removedCardIds: string[];
  generateNewMockCard: () => any;
  onboardingData: any;
}

export default function HomeScreen(props: HomeScreenProps) {
  return <HomePage {...props} />;
}
