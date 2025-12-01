import React from 'react';
import { Text, View, TouchableOpacity, StyleSheet, Image, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import SwipeableCards from './SwipeableCards';
import minglaLogo from '../../assets/6850c6540f4158618f67e1fdd72281118b419a35.png';

// Moved to SwipeableCards component

interface HomePageProps {
  onOpenPreferences: () => void;
  onOpenCollaboration: (friend?: any) => void;
  onOpenCollabPreferences?: () => void;
  currentMode: 'solo' | string;
  userPreferences?: any;
  accountPreferences?: {
    currency: string;
    measurementSystem: 'Metric' | 'Imperial';
  };
  onAddToCalendar: (experienceData: any) => void;
  savedCards?: any[];
  onSaveCard?: (card: any) => void;
  onShareCard?: (card: any) => void;
  onPurchaseComplete?: (experienceData: any, purchaseOption: any) => void;
  removedCardIds?: string[];
  onResetCards?: () => void;
  generateNewMockCard?: () => any;
  onboardingData?: any;
  refreshKey?: number | string;
}

export default function HomePage({ onOpenPreferences, onOpenCollaboration, onOpenCollabPreferences, currentMode, userPreferences, accountPreferences, onAddToCalendar, savedCards, onSaveCard, onShareCard, onPurchaseComplete, removedCardIds, onResetCards, generateNewMockCard, onboardingData, refreshKey }: HomePageProps) {

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />
      <View style={styles.container}>
        {/* Top Navigation - Fixed */}
        <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity 
            onPress={() => {
              if (currentMode === 'solo') {
                onOpenPreferences();
              } else {
                onOpenCollabPreferences?.();
              }
            }}
            style={styles.preferencesButton}
            activeOpacity={0.6}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            disabled={false}
          >
            <Ionicons 
              name="options" 
              size={24} 
              color={currentMode === 'solo' ? '#1f2937' : '#ea580c'} 
            />
          </TouchableOpacity>
        </View>
        
        <View style={styles.headerCenter}>
          <Image
            source={minglaLogo}
            style={styles.logo}
            resizeMode="contain"
            onError={() => {}}
            onLoad={() => {}}
          />
        </View>
        
        <View style={styles.headerRight}>
          <TouchableOpacity 
            onPress={() => onOpenCollaboration()}
            style={styles.collaborateButton}
          >
            {currentMode === 'solo' ? (
              <>
                <Ionicons name="people" size={14} color="#ea580c" />
                <Text style={styles.collaborateText}>Collaborate</Text>
              </>
            ) : (
              <>
                <Ionicons name="people" size={14} color="#ea580c" />
                <Text style={styles.collaborateText} numberOfLines={1}>{currentMode}</Text>
                <Ionicons name="chevron-down" size={11} color="#ea580c" style={{ opacity: 0.6 }} />
              </>
            )}
            {/* Notification indicator for pending invites */}
            <View style={styles.notificationDot} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Content - Centered middle section */}
      <View style={styles.mainContent}>
        <SwipeableCards 
          userPreferences={userPreferences} 
          accountPreferences={accountPreferences}
          currentMode={currentMode}
          onAddToCalendar={onAddToCalendar}
          onCardLike={onSaveCard}
          onShareCard={onShareCard}
          onPurchaseComplete={onPurchaseComplete}
          removedCardIds={removedCardIds}
          onResetCards={onResetCards}
          generateNewMockCard={generateNewMockCard}
          onboardingData={onboardingData}
          refreshKey={refreshKey}
        />
      </View>
    </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  header: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'relative',
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 2,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  preferencesButton: {
    padding: 10,
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    height: 40,
    width: 200,
    resizeMode: 'contain',
  },
  logoText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#eb7825',
    marginTop: 4,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  collaborateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#ffedd5',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 18,
    position: 'relative',
  },
  collaborateText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ea580c',
    maxWidth: 80,
  },
  notificationDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 10,
    height: 10,
    backgroundColor: '#ef4444',
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  mainContent: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
});