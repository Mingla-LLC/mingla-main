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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppStore } from '../store/appStore';
import { useUserProfile } from '../hooks/useUserProfile';
import { useAuth } from '../hooks/useAuth';
import { useNavigation } from '../contexts/NavigationContext';
import { useNavigation as useReactNavigation } from '@react-navigation/native';
import { supabase } from '../services/supabase';

export default function ProfileScreen() {
  const { user, preferences, saves, boards } = useAppStore();
  const { profile, updateProfile, refreshProfile } = useUserProfile();
  const { signOut } = useAuth();
  const { openPreferencesModal } = useNavigation();
  const navigation = useReactNavigation();
  
  const [refreshing, setRefreshing] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  
  // Demo data for saved locations
  const savedLocations = [
    { id: '1', name: 'Home', address: 'Capitol Hill' },
    { id: '2', name: 'Work', address: 'Downtown' },
    { id: '3', name: 'Gym', address: 'Belltown' },
  ];

  const onRefresh = async () => {
    setRefreshing(true);
    // Simulate loading
    setTimeout(() => setRefreshing(false), 1000);
  };

  const handleSignOut = async () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            const { error } = await signOut();
            if (error) {
              Alert.alert('Error', error.message);
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
            <Image
              source={{ uri: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=face' }}
              style={styles.avatar}
            />
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.displayName}>
              {profile?.display_name || user?.email?.split('@')[0] || 'Test'}
            </Text>
            <Text style={styles.email}>
              {user?.email || 'hi@sethogieva.com'}
            </Text>
            <Text style={styles.username}>
              @{profile?.username || user?.email?.split('@')[0] || 'Test'}
            </Text>
            <TouchableOpacity style={styles.locationButton}>
              <Ionicons name="location-outline" size={16} color="#666" />
              <Text style={styles.locationText}>Location unavailable</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>12</Text>
            <Text style={styles.statLabel}>Experiences Saved</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>3</Text>
            <Text style={styles.statLabel}>Boards Created</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>8</Text>
            <Text style={styles.statLabel}>Collaborations</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>45</Text>
            <Text style={styles.statLabel}>Places Visited</Text>
          </View>
        </View>

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
          
          <TouchableOpacity style={styles.menuItem}>
            <View style={styles.menuItemLeft}>
              <Ionicons name="settings-outline" size={20} color="#666" />
              <Text style={styles.menuItemText}>Account Settings</Text>
            </View>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.menuItem}>
            <Text style={styles.menuItemText}>Privacy Policy</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.menuItem}>
            <Text style={styles.menuItemText}>Terms of Service</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.menuItem} onPress={handleSignOut}>
            <View style={styles.menuItemLeft}>
              <Ionicons name="arrow-forward" size={20} color="#FF3B30" />
              <Text style={[styles.menuItemText, styles.signOutText]}>Sign Out</Text>
            </View>
          </TouchableOpacity>
        </View>
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
});
