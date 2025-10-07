import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
  Switch,
  Image,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppStore } from '../store/appStore';
import { useUserProfile } from '../hooks/useUserProfile';
import { useAuth } from '../hooks/useAuth';
import { authService } from '../services/authService';
import { useNavigation } from '../contexts/NavigationContext';
import { useNavigation as useReactNavigation, useFocusEffect } from '@react-navigation/native';
import { useBoards } from '../hooks/useBoards';
import { useSaves } from '../hooks/useSaves';
import { useEnhancedProfile } from '../hooks/useEnhancedProfile';
import { supabase } from '../services/supabase';
import { enhancedLocationTrackingService } from '../services/enhancedLocationTrackingService';
import { geocodingService } from '../services/geocodingService';
import { GamifiedHistory } from '../components/GamifiedHistory';
import { PrivacyControls } from '../components/profile/PrivacyControls';

export default function ProfileScreen() {
  const { user, preferences } = useAppStore();
  const { profile, updateProfile, refreshProfile } = useUserProfile();
  const { signOut } = useAuth();
  const { openPreferencesModal } = useNavigation();
  const navigation = useReactNavigation();
  const { boards } = useBoards();
  const { saves } = useSaves();
  const { 
    gamifiedData, 
    loading: gamifiedLoading, 
    loadGamifiedData, 
    checkMilestones,
    backfillActivityHistory
  } = useEnhancedProfile();
  
  const [refreshing, setRefreshing] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [currentLocationName, setCurrentLocationName] = useState<string>('Getting location...');
  const [locationLoading, setLocationLoading] = useState(true);
  const [showGamifiedHistory, setShowGamifiedHistory] = useState(false);
  const [showPrivacyControls, setShowPrivacyControls] = useState(false);

  // Demo data for saved locations
  const savedLocations = [
    { id: '1', name: 'Home', address: 'Capitol Hill' },
    { id: '2', name: 'Work', address: 'Downtown' },
    { id: '3', name: 'Gym', address: 'Belltown' },
  ];

  // Fetch current location
  const fetchCurrentLocation = async () => {
    try {
      setLocationLoading(true);
      const location = await enhancedLocationTrackingService.getCurrentLocation();
      
      if (location) {
        const geocodingResult = await geocodingService.reverseGeocode(location.latitude, location.longitude);
        const locationName = geocodingResult.formattedAddress || 
                            `${geocodingResult.city || ''}, ${geocodingResult.state || ''}`.replace(/^,\s*|,\s*$/g, '') ||
                            'Current location';
        setCurrentLocationName(locationName);
      } else {
        setCurrentLocationName('Location unavailable');
      }
    } catch (error) {
      console.error('Error fetching location:', error);
      setCurrentLocationName('Location unavailable');
    } finally {
      setLocationLoading(false);
    }
  };

  // Refresh profile data when screen is focused
  useFocusEffect(
    React.useCallback(() => {
      if (user?.id) {
        refreshProfile();
        fetchCurrentLocation();
        loadGamifiedData(user.id);
        checkMilestones(user.id);
      }
    }, [user?.id, refreshProfile, loadGamifiedData, checkMilestones])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshProfile();
    if (user?.id) {
      await loadGamifiedData(user.id);
      await checkMilestones(user.id);
    }
    setRefreshing(false);
  };

  const handleSignOut = async () => {
    console.log('Sign out button pressed');
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            console.log('User confirmed sign out');
            try {
              // Try authService signOut first
              const { error } = await authService.signOut();
              if (error) {
                console.error('AuthService sign out error:', error);
                // Fallback to useAuth signOut
                const { error: hookError } = await signOut();
                if (hookError) {
                  console.error('Hook sign out error:', hookError);
                  Alert.alert('Error', hookError.message);
                } else {
                  console.log('Hook sign out successful');
                }
              } else {
                console.log('AuthService sign out successful');
              }
            } catch (err) {
              console.error('Sign out exception:', err);
              Alert.alert('Error', 'Failed to sign out. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleAddLocation = () => {
    console.log('Add new location');
  };

  const handleEditLocation = (locationId: string) => {
    console.log('Edit location:', locationId);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView 
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          <View style={styles.avatarContainer}>
            {profile?.avatar_url ? (
              <Image
                source={{ uri: profile.avatar_url }}
                style={styles.avatar}
              />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarFallbackText}>
                  {profile?.first_name && profile?.last_name 
                    ? `${profile.first_name[0]}${profile.last_name[0]}`.toUpperCase()
                    : profile?.username 
                      ? profile.username[0].toUpperCase()
                      : user?.email?.[0].toUpperCase() || 'U'
                  }
                </Text>
              </View>
            )}
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.displayName}>
              {profile?.display_name || `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || user?.email?.split('@')[0] || 'User'}
            </Text>
            <Text style={styles.email}>
              {user?.email || ''}
            </Text>
            <Text style={styles.username}>
              @{profile?.username || user?.email?.split('@')[0] || 'user'}
            </Text>
            <TouchableOpacity style={styles.locationButton} onPress={fetchCurrentLocation}>
              <Ionicons name="location-outline" size={16} color="#666" />
              <Text style={styles.locationText}>
                {locationLoading ? 'Getting location...' : currentLocationName}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <TouchableOpacity 
            style={styles.statCard}
            onPress={() => navigation.navigate('SavedExperiences')}
          >
            <Text style={styles.statNumber}>{saves.length}</Text>
            <Text style={styles.statLabel}>Experiences Saved</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.statCard}
            onPress={() => navigation.navigate('Boards')}
          >
            <Text style={styles.statNumber}>{boards.length}</Text>
            <Text style={styles.statLabel}>Boards Created</Text>
          </TouchableOpacity>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>
              {gamifiedData?.achievements.totalCollaborations || 0}
            </Text>
            <Text style={styles.statLabel}>Collaborations</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>
              {gamifiedData?.achievements.totalPlaces || 0}
            </Text>
            <Text style={styles.statLabel}>Places Visited</Text>
          </View>
        </View>

        {/* Gamified History Section */}
        {gamifiedData && (
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleContainer}>
                <Ionicons name="trophy" size={20} color="#FF9500" />
                <Text style={styles.sectionTitle}>Your Journey</Text>
              </View>
              <TouchableOpacity 
                style={styles.viewAllButton} 
                onPress={() => setShowGamifiedHistory(true)}
              >
                <Text style={styles.viewAllButtonText}>View All</Text>
              </TouchableOpacity>
            </View>
            
            {/* Quick Stats */}
            <View style={styles.quickStats}>
              <View style={styles.quickStatItem}>
                <Text style={styles.quickStatNumber}>
                  {gamifiedData.monthlyStats.totalExperiences}
                </Text>
                <Text style={styles.quickStatLabel}>This Month</Text>
              </View>
              <View style={styles.quickStatItem}>
                <Text style={styles.quickStatNumber}>
                  {gamifiedData.achievements.streakDays}
                </Text>
                <Text style={styles.quickStatLabel}>Day Streak</Text>
              </View>
              <View style={styles.quickStatItem}>
                <Text style={styles.quickStatNumber}>
                  {gamifiedData.badges.length}
                </Text>
                <Text style={styles.quickStatLabel}>Badges</Text>
              </View>
            </View>

                    {/* Top Vibes */}
                    {gamifiedData.vibes.length > 0 && (
                      <View style={styles.topVibes}>
                        <Text style={styles.topVibesTitle}>Your Vibes</Text>
                        <View style={styles.vibesList}>
                          {gamifiedData.vibes.slice(0, 3).map((vibe, index) => (
                            <View key={vibe.id} style={styles.vibeItem}>
                              <Text style={styles.vibeCategory}>
                                {vibe.category.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                              </Text>
                              <Text style={styles.vibePercentage}>{vibe.percentage.toFixed(0)}%</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    )}

                    {/* Backfill Button for Testing */}
                    <TouchableOpacity
                      style={styles.backfillButton}
                      onPress={() => {
                        if (user?.id) {
                          backfillActivityHistory(user.id);
                        }
                      }}
                    >
                      <Text style={styles.backfillButtonText}>🔄 Sync Your Data</Text>
                    </TouchableOpacity>
          </View>
        )}

        {/* Saved Locations */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleContainer}>
              <Ionicons name="location" size={20} color="#FF9500" />
              <Text style={styles.sectionTitle}>Saved Locations</Text>
            </View>
            <TouchableOpacity style={styles.addButton} onPress={handleAddLocation}>
              <Text style={styles.addButtonText}>Add</Text>
            </TouchableOpacity>
          </View>
          {savedLocations.map((location) => (
            <View key={location.id} style={styles.locationItem}>
              <View style={styles.locationInfo}>
                <Text style={styles.locationName}>{location.name} - {location.address}</Text>
              </View>
              <TouchableOpacity 
                style={styles.editButton}
                onPress={() => handleEditLocation(location.id)}
              >
                <Text style={styles.editButtonText}>Edit</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        {/* Notifications */}
        <View style={styles.sectionCard}>
          <View style={styles.notificationHeader}>
            <View style={styles.sectionTitleContainer}>
              <Ionicons name="notifications" size={20} color="#FF9500" />
              <Text style={styles.sectionTitle}>Notifications</Text>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={setNotificationsEnabled}
              trackColor={{ false: '#E5E5E7', true: '#FF9500' }}
              thumbColor={notificationsEnabled ? '#fff' : '#f4f3f4'}
            />
          </View>
          <Text style={styles.notificationDescription}>
            Get notified about new recommendations, board activity, and collaboration invites
          </Text>
        </View>

        {/* Menu Items */}
        <View style={styles.menuContainer}>
          <TouchableOpacity 
            style={styles.menuItem}
            onPress={() => navigation.navigate('ProfileSettings')}
          >
            <View style={styles.menuItemLeft}>
              <Ionicons name="person-outline" size={20} color="#666" />
              <Text style={styles.menuItemText}>Profile Settings</Text>
            </View>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.menuItem}
            onPress={() => navigation.navigate('AccountSettings')}
          >
            <View style={styles.menuItemLeft}>
              <Ionicons name="settings-outline" size={20} color="#666" />
              <Text style={styles.menuItemText}>Account Settings</Text>
            </View>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.menuItem}
            onPress={() => setShowPrivacyControls(true)}
          >
            <View style={styles.menuItemLeft}>
              <Ionicons name="shield-outline" size={20} color="#666" />
              <Text style={styles.menuItemText}>Privacy Controls</Text>
            </View>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.menuItem}>
            <Text style={styles.menuItemText}>Privacy Policy</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.menuItem}>
            <Text style={styles.menuItemText}>Terms of Service</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.menuItem} 
            onPress={handleSignOut}
            activeOpacity={0.7}
            testID="sign-out-button"
          >
            <View style={styles.menuItemLeft}>
              <Ionicons name="arrow-forward" size={20} color="#FF3B30" />
              <Text style={[styles.menuItemText, styles.signOutText]}>Sign Out</Text>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Gamified History Modal */}
      <Modal
        visible={showGamifiedHistory && !!gamifiedData}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowGamifiedHistory(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Your Journey</Text>
            <TouchableOpacity 
              style={styles.closeButton}
              onPress={() => setShowGamifiedHistory(false)}
            >
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>
          <View style={styles.modalContent}>
            {gamifiedData ? (
              <GamifiedHistory 
                gamifiedData={gamifiedData}
                onViewDetails={(type, data) => {
                  console.log('View details:', type, data);
                }}
              />
            ) : (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ fontSize: 16, color: '#666' }}>Loading gamified data...</Text>
              </View>
            )}
          </View>
        </SafeAreaView>
      </Modal>

      {/* Privacy Controls Modal */}
      <Modal
        visible={showPrivacyControls}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowPrivacyControls(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Privacy Controls</Text>
            <TouchableOpacity 
              style={styles.closeButton}
              onPress={() => setShowPrivacyControls(false)}
            >
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>
          <View style={styles.modalContent}>
            <PrivacyControls onClose={() => setShowPrivacyControls(false)} />
          </View>
        </SafeAreaView>
      </Modal>
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
    paddingTop: 20,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarContainer: {
    marginRight: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  avatarFallback: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FF6B35',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarFallbackText: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
  },
  profileInfo: {
    flex: 1,
  },
  displayName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  email: {
    fontSize: 16,
    color: '#666',
    marginBottom: 2,
  },
  username: {
    fontSize: 16,
    color: '#666',
    marginBottom: 8,
  },
  locationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  locationText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 24,
    gap: 12,
  },
  statCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    width: '48%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FF9500',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
  },
  sectionCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginLeft: 8,
  },
  addButton: {
    backgroundColor: '#FF9500',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  addButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
  },
  locationItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  locationInfo: {
    flex: 1,
  },
  locationName: {
    fontSize: 16,
    color: '#1a1a1a',
  },
  editButton: {
    backgroundColor: '#f0f0f0',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  editButtonText: {
    color: '#666',
    fontSize: 14,
  },
  notificationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  notificationDescription: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  menuContainer: {
    backgroundColor: 'white',
    borderRadius: 12,
    marginBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuItemText: {
    fontSize: 16,
    color: '#1a1a1a',
    marginLeft: 12,
  },
  signOutText: {
    color: '#FF3B30',
  },
  // Enhanced Profile Styles
  quickStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  quickStatItem: {
    alignItems: 'center',
  },
  quickStatNumber: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FF9500',
    marginBottom: 4,
  },
  quickStatLabel: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
  },
  topVibes: {
    marginTop: 12,
  },
  topVibesTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  vibesList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  vibeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  vibeCategory: {
    fontSize: 12,
    color: '#1a1a1a',
    marginRight: 4,
  },
  vibePercentage: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FF9500',
  },
  viewAllButton: {
    backgroundColor: '#FF9500',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  viewAllButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
  },
  // Modal Styles
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  modalContent: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  closeButton: {
    padding: 8,
  },
  backfillButton: {
    backgroundColor: '#FF9500',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 16,
    alignItems: 'center',
  },
  backfillButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
});
