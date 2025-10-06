import React, { useState } from 'react';
import { Text, View, TouchableOpacity, StyleSheet, Image, SafeAreaView, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ImageWithFallback } from './figma/ImageWithFallback';
import PreferencesSheet from './PreferencesSheet';
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
  generateNewMockCard?: () => any;
  onboardingData?: any;
}

export default function HomePage({ onOpenPreferences, onOpenCollaboration, onOpenCollabPreferences, currentMode, userPreferences, accountPreferences, onAddToCalendar, savedCards, onSaveCard, onShareCard, onPurchaseComplete, removedCardIds, generateNewMockCard, onboardingData }: HomePageProps) {

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />
      <View style={styles.container}>
        {/* Top Navigation - Fixed */}
        <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity 
            onPress={currentMode === 'solo' ? onOpenPreferences : onOpenCollabPreferences}
            style={styles.preferencesButton}
          >
            <Ionicons 
              name="options" 
              size={20} 
              color={currentMode === 'solo' ? '#374151' : '#eb7825'} 
            />
          </TouchableOpacity>
        </View>
        
        <View style={styles.headerCenter}>
          <Image
            source={minglaLogo}
            style={styles.logo}
            resizeMode="contain"
            onError={(error) => {
              console.log('Logo load error:', error);
            }}
            onLoad={() => console.log('Logo loaded successfully')}
          />
        </View>
        
        <View style={styles.headerRight}>
          <TouchableOpacity 
            onPress={() => onOpenCollaboration()}
            style={styles.collaborateButton}
          >
            {currentMode === 'solo' ? (
              <>
                <Ionicons name="people" size={16} color="#eb7825" />
                <Text style={styles.collaborateText}>Collaborate</Text>
              </>
            ) : (
              <>
                <Ionicons name="people" size={16} color="#eb7825" />
                <Text style={styles.collaborateText} numberOfLines={1}>{currentMode}</Text>
                <Ionicons name="chevron-down" size={12} color="#eb7825" style={{ opacity: 0.6 }} />
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
          generateNewMockCard={generateNewMockCard}
          onboardingData={onboardingData}
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
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  preferencesButton: {
    padding: 12,
    backgroundColor: 'transparent',
    borderRadius: 12,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    height: 50,
    width: 250,
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
    gap: 8,
    backgroundColor: '#fef3e2',
    borderWidth: 1,
    borderColor: '#fed7aa',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    position: 'relative',
  },
  collaborateText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#eb7825',
    maxWidth: 80,
  },
  notificationDot: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 12,
    height: 12,
    backgroundColor: '#FF7043',
    borderRadius: 6,
  },
  mainContent: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
});