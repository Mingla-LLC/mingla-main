import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppStore } from '../store/appStore';
import { useNavigation } from '../contexts/NavigationContext';
import { useSessionManagement } from '../hooks/useSessionManagement';
import { useUserProfile } from '../hooks/useUserProfile';
import { AIRecommendationEngine } from '../components/AIRecommendationEngine';

export default function HomeScreen() {
  const { user, currentSession, isInSolo, preferences } = useAppStore();
  const { profile, refreshProfile } = useUserProfile();
  const { openCreateSessionModal, openSessionSwitcher, openPreferencesModal } = useNavigation();
  
  const { pendingInvites } = useSessionManagement();

  const onRefresh = async () => {
    await refreshProfile(); // Refresh user profile data
  };


  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        {/* Left side buttons */}
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.headerButton} onPress={onRefresh}>
            <Ionicons name="refresh" size={20} color="#FF6B35" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerButton} onPress={openPreferencesModal}>
            <Ionicons name="grid-outline" size={20} color="#FF6B35" />
          </TouchableOpacity>
        </View>

        {/* Center logo */}
        <View style={styles.headerCenter}>
          <Text style={styles.logo}>Mingla</Text>
        </View>

        {/* Right side buttons */}
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.headerButton}>
            <Ionicons name="notifications-outline" size={20} color="#FF6B35" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerButton} onPress={openSessionSwitcher}>
            <Ionicons name="person-outline" size={20} color="#FF6B35" />
            <Text style={styles.soloText}>Solo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerButton} onPress={openCreateSessionModal}>
            <Ionicons name="add" size={20} color="#FF6B35" />
          </TouchableOpacity>
        </View>
      </View>

        {/* Main Card Container */}
        <View style={styles.cardContainer}>

          {/* Main Experience Card */}
          <View style={styles.mainCard}>
            <AIRecommendationEngine
              context="home"
              onExperienceSelect={(experience) => {
                // Handle experience selection
                console.log('Selected experience:', experience);
              }}
            />
          </View>
        </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: '#f8f9fa',
    paddingTop: 50, // Account for status bar
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFF5F2',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  logo: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FF6B35',
  },
  soloText: {
    fontSize: 12,
    color: '#FF6B35',
    fontWeight: '600',
  },
  cardContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 0, // Remove bottom padding to fill to bottom nav
  },
  mainCard: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    overflow: 'hidden',
    marginBottom: 0, // Remove bottom margin to fill to bottom nav
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: '#1a1a1a',
  },
  inviteCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FF9500',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  inviteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  inviteTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginLeft: 8,
  },
  inviteText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 28,
  },
});
