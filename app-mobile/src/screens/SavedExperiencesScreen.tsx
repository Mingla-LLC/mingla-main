import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppStore } from '../store/appStore';
import { useSaves } from '../hooks/useSaves';
import { experienceService } from '../services/experienceService';

interface SavedExperiencesScreenProps {
  navigation?: any;
}

export default function SavedExperiencesScreen({ navigation }: SavedExperiencesScreenProps) {
  const { saves, fetchSaves } = useSaves();
  const [refreshing, setRefreshing] = useState(false);
  const [savedExperiences, setSavedExperiences] = useState<any[]>([]);
  const [loadingExperiences, setLoadingExperiences] = useState(false);

  // Load experience details for saved experiences
  const loadExperienceDetails = async () => {
    if (saves.length === 0) {
      setSavedExperiences([]);
      return;
    }

    setLoadingExperiences(true);
    try {
      const experienceIds = saves.map(save => save.experience_id);
      const experiences = await experienceService.fetchAllExperiences();
      
      // Create a map of experience_id to experience details
      const experienceMap: Record<string, any> = {};
      experiences.forEach(experience => {
        if (experienceIds.includes(experience.id)) {
          experienceMap[experience.id] = experience;
        }
      });
      
      // Convert saves to display format with real experience data
      const experiencesWithDetails = saves.map(save => {
        const experience = experienceMap[save.experience_id];
        return {
          id: save.experience_id,
          title: experience?.title || 'Unknown Experience',
          category: experience?.category || 'General',
          location: experience?.place_id ? 'Location Available' : 'Location TBD',
          price: experience ? `$${experience.price_min}-${experience.price_max}` : 'Price TBD',
          status: save.status,
          savedAt: save.created_at,
          scheduledFor: save.scheduled_at,
          description: experience?.description,
        };
      });
      
      setSavedExperiences(experiencesWithDetails);
    } catch (error) {
      console.error('Error loading experience details:', error);
      // Fallback to basic save data if experience loading fails
      setSavedExperiences(saves.map(save => ({
        id: save.experience_id,
        title: 'Experience',
        category: 'General',
        location: 'Location TBD',
        price: 'Price TBD',
        status: save.status,
        savedAt: save.created_at,
        scheduledFor: save.scheduled_at,
      })));
    } finally {
      setLoadingExperiences(false);
    }
  };

  // Load experience details when saves change
  useEffect(() => {
    loadExperienceDetails();
  }, [saves]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchSaves();
    setRefreshing(false);
  };

  const handleExperiencePress = (experience: any) => {
    Alert.alert(
      experience.title,
      `Category: ${experience.category}\nLocation: ${experience.location}\nPrice: ${experience.price}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'View Details', onPress: () => console.log('View details for:', experience.id) },
      ]
    );
  };

  const handleStatusChange = (experienceId: string, newStatus: string) => {
    Alert.alert(
      'Change Status',
      `Change status to ${newStatus}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: () => console.log('Status changed to:', newStatus) },
      ]
    );
  };

  const goBack = () => {
    if (navigation) {
      navigation.goBack();
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'saved': return '#FF9500';
      case 'scheduled': return '#007AFF';
      case 'completed': return '#34C759';
      default: return '#666';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'saved': return 'bookmark';
      case 'scheduled': return 'calendar';
      case 'completed': return 'checkmark-circle';
      default: return 'bookmark-outline';
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={goBack}>
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Saved Experiences</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView 
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Stats Summary */}
        <View style={styles.statsContainer}>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{savedExperiences.length}</Text>
            <Text style={styles.statLabel}>Total Saved</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>
              {savedExperiences.filter(e => e.status === 'scheduled').length}
            </Text>
            <Text style={styles.statLabel}>Scheduled</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>
              {savedExperiences.filter(e => e.status === 'completed').length}
            </Text>
            <Text style={styles.statLabel}>Completed</Text>
          </View>
        </View>

        {/* Experiences List */}
        <View style={styles.experiencesList}>
          {savedExperiences.map((experience) => (
            <TouchableOpacity
              key={experience.id}
              style={styles.experienceCard}
              onPress={() => handleExperiencePress(experience)}
            >
              <View style={styles.experienceHeader}>
                <View style={styles.experienceInfo}>
                  <Text style={styles.experienceTitle}>{experience.title}</Text>
                  <Text style={styles.experienceCategory}>{experience.category}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(experience.status) }]}>
                  <Ionicons name={getStatusIcon(experience.status) as any} size={12} color="white" />
                  <Text style={styles.statusText}>{experience.status}</Text>
                </View>
              </View>
              
              <View style={styles.experienceDetails}>
                <View style={styles.detailItem}>
                  <Ionicons name="location-outline" size={14} color="#666" />
                  <Text style={styles.detailText}>{experience.location}</Text>
                </View>
                <View style={styles.detailItem}>
                  <Ionicons name="cash-outline" size={14} color="#666" />
                  <Text style={styles.detailText}>{experience.price}</Text>
                </View>
              </View>

              <View style={styles.experienceFooter}>
                <Text style={styles.savedDate}>Saved on {new Date(experience.savedAt).toLocaleDateString()}</Text>
                {experience.scheduledFor && (
                  <Text style={styles.scheduledDate}>
                    Scheduled for {new Date(experience.scheduledFor).toLocaleDateString()}
                  </Text>
                )}
                {experience.completedAt && (
                  <Text style={styles.completedDate}>
                    Completed on {new Date(experience.completedAt).toLocaleDateString()}
                  </Text>
                )}
              </View>

              <View style={styles.actionButtons}>
                {experience.status === 'saved' && (
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleStatusChange(experience.id, 'scheduled')}
                  >
                    <Ionicons name="calendar-outline" size={16} color="#007AFF" />
                    <Text style={styles.actionButtonText}>Schedule</Text>
                  </TouchableOpacity>
                )}
                {experience.status === 'scheduled' && (
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleStatusChange(experience.id, 'completed')}
                  >
                    <Ionicons name="checkmark-circle-outline" size={16} color="#34C759" />
                    <Text style={styles.actionButtonText}>Mark Complete</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.actionButton, styles.removeButton]}
                  onPress={() => Alert.alert('Remove', 'Remove this experience?')}
                >
                  <Ionicons name="trash-outline" size={16} color="#FF3B30" />
                  <Text style={[styles.actionButtonText, styles.removeButtonText]}>Remove</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E7',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1a1a1a',
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  statsContainer: {
    flexDirection: 'row',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
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
  experiencesList: {
    paddingBottom: 32,
  },
  experienceCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  experienceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  experienceInfo: {
    flex: 1,
  },
  experienceTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  experienceCategory: {
    fontSize: 14,
    color: '#666',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  statusText: {
    fontSize: 12,
    color: 'white',
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  experienceDetails: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailText: {
    fontSize: 14,
    color: '#666',
  },
  experienceFooter: {
    marginBottom: 12,
  },
  savedDate: {
    fontSize: 12,
    color: '#999',
  },
  scheduledDate: {
    fontSize: 12,
    color: '#007AFF',
    marginTop: 2,
  },
  completedDate: {
    fontSize: 12,
    color: '#34C759',
    marginTop: 2,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
    gap: 4,
  },
  actionButtonText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  removeButton: {
    backgroundColor: '#fff5f5',
  },
  removeButtonText: {
    color: '#FF3B30',
  },
});
