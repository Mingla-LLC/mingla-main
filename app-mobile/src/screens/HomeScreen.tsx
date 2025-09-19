import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppStore } from '../store/appStore';
import { useNavigation } from '../contexts/NavigationContext';
import { useExperiences } from '../hooks/useExperiences';
import { useSessionManagement } from '../hooks/useSessionManagement';
import { useUserProfile } from '../hooks/useUserProfile';
import { ExperienceCard } from '../components/ExperienceCard';
import { enhancedLocationService } from '../services/enhancedLocationService';
import { categories } from '../constants/categories';
import { AIRecommendationEngine } from '../components/AIRecommendationEngine';
import { LocationAwareDiscovery } from '../components/LocationAwareDiscovery';

export default function HomeScreen() {
  const { user, currentSession, isInSolo, preferences } = useAppStore();
  const { profile, refreshProfile } = useUserProfile();
  const { openCreateSessionModal, openSessionSwitcher, openPreferencesModal, navigateToConnections, navigateToSaved, navigateToSchedule } = useNavigation();
  
  const [refreshing, setRefreshing] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [activeTab, setActiveTab] = useState<'ai' | 'location'>('ai');
  
  const { experiences, loading, fetchExperiences, fetchNearbyPlaces } = useExperiences({
    categories: preferences?.categories,
    budgetMin: preferences?.budget_min,
    budgetMax: preferences?.budget_max,
  });
  
  const { pendingInvites } = useSessionManagement();

  useEffect(() => {
    loadLocationAndExperiences();
  }, []);

  const loadLocationAndExperiences = async () => {
    try {
      // Get current location
      const location = await enhancedLocationService.getCurrentLocation();
      if (location) {
        setCurrentLocation({ lat: location.latitude, lng: location.longitude });
        
        // Fetch nearby places if we have location
        await fetchNearbyPlaces(location.latitude, location.longitude);
      }
      
      // Also fetch saved experiences
      await fetchExperiences();
    } catch (error) {
      console.error('Error loading location and experiences:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadLocationAndExperiences();
    await refreshProfile(); // Refresh user profile data
    setRefreshing(false);
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const getGreetingWithName = () => {
    const greeting = getGreeting();
    const username = profile?.display_name || 
                     profile?.username || 
                     profile?.first_name || 
                     user?.display_name || 
                     user?.username || 
                     user?.first_name || 
                     user?.email?.split('@')[0] || 
                     'User';
    return `${greeting}, ${username}`;
  };

  const getRecommendedExperiences = () => {
    // Return first 3 experiences as "recommended"
    return experiences.slice(0, 3);
  };

  const getTrendingCategories = () => {
    // Mock trending data - in real app, this would come from analytics
    return categories.slice(0, 4).map(category => ({
      ...category,
      trend: Math.floor(Math.random() * 30) + 10, // Random trend percentage
    }));
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView 
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>
              {getGreetingWithName()}!
            </Text>
            <Text style={styles.subtitle}>
              {isInSolo ? 'Discover experiences' : 'Planning with friends'}
            </Text>
          </View>
          <TouchableOpacity style={styles.profileButton} onPress={openPreferencesModal}>
            <Ionicons name="settings-outline" size={24} color="#007AFF" />
          </TouchableOpacity>
        </View>

        {/* Session Status */}
        {!isInSolo && currentSession && (
          <TouchableOpacity style={styles.sessionCard} onPress={openSessionSwitcher}>
            <View style={styles.sessionHeader}>
              <Ionicons name="people" size={20} color="#007AFF" />
              <Text style={styles.sessionTitle}>{currentSession.name}</Text>
              <Ionicons name="chevron-forward" size={16} color="#666" />
            </View>
            <Text style={styles.sessionStatus}>
              Status: {currentSession.status}
            </Text>
          </TouchableOpacity>
        )}

        {/* Quick Actions - Compact Version */}
        <View style={styles.compactActionsSection}>
          <View style={styles.compactActionRow}>
            <TouchableOpacity style={styles.compactActionCard} onPress={navigateToConnections}>
              <Ionicons name="people" size={20} color="#007AFF" />
              <Text style={styles.compactActionText}>Connections</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.compactActionCard} onPress={openCreateSessionModal}>
              <Ionicons name="people" size={20} color="#007AFF" />
              <Text style={styles.compactActionText}>Collaborate</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.compactActionCard} onPress={navigateToSaved}>
              <Ionicons name="heart" size={20} color="#007AFF" />
              <Text style={styles.compactActionText}>Saved</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.compactActionCard} onPress={navigateToSchedule}>
              <Ionicons name="calendar" size={20} color="#007AFF" />
              <Text style={styles.compactActionText}>Schedule</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Tab Navigation */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'ai' && styles.activeTab]}
            onPress={() => setActiveTab('ai')}
          >
            <Ionicons 
              name="bulb" 
              size={16} 
              color={activeTab === 'ai' ? '#007AFF' : '#666'} 
            />
            <Text style={[styles.tabText, activeTab === 'ai' && styles.activeTabText]}>
              AI Recommendations
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.tab, activeTab === 'location' && styles.activeTab]}
            onPress={() => setActiveTab('location')}
          >
            <Ionicons 
              name="location" 
              size={16} 
              color={activeTab === 'location' ? '#007AFF' : '#666'} 
            />
            <Text style={[styles.tabText, activeTab === 'location' && styles.activeTabText]}>
              Location Discovery
            </Text>
          </TouchableOpacity>
        </View>

        {/* Tab Content */}
        <View style={styles.tabContent}>
          {activeTab === 'ai' ? (
            <AIRecommendationEngine
              context="home"
              onExperienceSelect={(experience) => {
                // Handle experience selection
                console.log('Selected experience:', experience);
              }}
            />
          ) : (
            <LocationAwareDiscovery
              onExperienceSelect={(experience) => {
                // Handle experience selection
                console.log('Selected experience:', experience);
              }}
            />
          )}
        </View>

        {/* Pending Invites */}
        {pendingInvites.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pending Invites</Text>
            <TouchableOpacity style={styles.inviteCard} onPress={openSessionSwitcher}>
              <View style={styles.inviteHeader}>
                <Ionicons name="mail" size={20} color="#FF9500" />
                <Text style={styles.inviteTitle}>
                  {pendingInvites.length} pending invitation{pendingInvites.length > 1 ? 's' : ''}
                </Text>
              </View>
              <Text style={styles.inviteText}>
                Tap to view and respond to collaboration invites
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
  },
  greeting: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  profileButton: {
    padding: 4,
  },
  sessionCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  sessionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
    color: '#1a1a1a',
  },
  sessionStatus: {
    fontSize: 14,
    color: '#666',
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
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  actionCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    width: '48%',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 8,
    color: '#1a1a1a',
  },
  // Compact Actions Styles
  compactActionsSection: {
    marginBottom: 16,
  },
  compactActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'white',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  compactActionCard: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    minWidth: 80,
  },
  compactActionText: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
    color: '#1a1a1a',
    textAlign: 'center',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 3,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 4,
  },
  activeTab: {
    backgroundColor: '#f0f8ff',
  },
  tabText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#666',
  },
  activeTabText: {
    color: '#007AFF',
  },
  tabContent: {
    flex: 1,
    minHeight: 450,
    maxHeight: 600,
  },
  activityCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  activityText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  trendingContainer: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  trendingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  trendingIcon: {
    fontSize: 24,
    marginRight: 16,
  },
  trendingContent: {
    flex: 1,
  },
  trendingName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  trendingTrend: {
    fontSize: 14,
    color: '#007AFF',
    marginTop: 2,
  },
  locationCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  locationText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 8,
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
