/**
 * Privacy Controls Component
 * Manages visibility settings and saved experience privacy
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppStore } from '../store/appStore';
import { useEnhancedProfile } from '../hooks/useEnhancedProfile';
import { SavedExperiencePrivacy } from '../types';

interface PrivacyControlsProps {
  onClose?: () => void;
}

export const PrivacyControls: React.FC<PrivacyControlsProps> = ({ onClose }) => {
  const { profile } = useAppStore();
  const { updateProfilePrivacy, getExperiencePrivacy, setExperiencePrivacy } = useEnhancedProfile();
  
  const [privacySettings, setPrivacySettings] = useState({
    visibility_mode: profile?.visibility_mode || 'friends',
    show_activity: profile?.show_activity ?? true,
    show_saved_experiences: profile?.show_saved_experiences ?? false,
    show_location: profile?.show_location ?? true,
    show_preferences: profile?.show_preferences ?? true,
  });

  const [savedExperiences, setSavedExperiences] = useState<Array<{
    id: string;
    title: string;
    category: string;
    privacy: SavedExperiencePrivacy | null;
  }>>([]);

  const [loading, setLoading] = useState(false);

  // Load saved experiences with privacy settings
  useEffect(() => {
    loadSavedExperiences();
  }, []);

  const loadSavedExperiences = async () => {
    try {
      setLoading(true);
      // This would typically load from your saved experiences
      // For now, using mock data
      const mockExperiences = [
        { id: 'exp1', title: 'Coffee at Blue Bottle', category: 'sip_chill' },
        { id: 'exp2', title: 'Dinner at The French Laundry', category: 'dining' },
        { id: 'exp3', title: 'Morning jog in Central Park', category: 'play_move' },
      ];

      const experiencesWithPrivacy = await Promise.all(
        mockExperiences.map(async (exp) => ({
          ...exp,
          privacy: await getExperiencePrivacy(exp.id)
        }))
      );

      setSavedExperiences(experiencesWithPrivacy);
    } catch (error) {
      console.error('Error loading saved experiences:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePrivacySettingChange = async (key: string, value: any) => {
    const newSettings = { ...privacySettings, [key]: value };
    setPrivacySettings(newSettings);

    try {
      const success = await updateProfilePrivacy({ [key]: value });
      if (!success) {
        Alert.alert('Error', 'Failed to update privacy setting. Please try again.');
        // Revert the change
        setPrivacySettings(privacySettings);
      }
    } catch (error) {
      console.error('Error updating privacy setting:', error);
      Alert.alert('Error', 'Failed to update privacy setting. Please try again.');
      setPrivacySettings(privacySettings);
    }
  };

  const handleExperiencePrivacyChange = async (experienceId: string, setting: string, value: boolean) => {
    try {
      const currentPrivacy = await getExperiencePrivacy(experienceId);
      const newPrivacySettings = {
        ...currentPrivacy,
        [setting]: value
      };

      const success = await setExperiencePrivacy(experienceId, newPrivacySettings);
      if (success) {
        // Update local state
        setSavedExperiences(prev => 
          prev.map(exp => 
            exp.id === experienceId 
              ? { ...exp, privacy: { ...exp.privacy, [setting]: value } as SavedExperiencePrivacy }
              : exp
          )
        );
      } else {
        Alert.alert('Error', 'Failed to update experience privacy. Please try again.');
      }
    } catch (error) {
      console.error('Error updating experience privacy:', error);
      Alert.alert('Error', 'Failed to update experience privacy. Please try again.');
    }
  };

  const getVisibilityDescription = (mode: string) => {
    switch (mode) {
      case 'public':
        return 'Everyone can see your profile and activity';
      case 'friends':
        return 'Only your friends can see your profile and activity';
      case 'private':
        return 'Your profile is hidden from everyone';
      default:
        return '';
    }
  };

  const getCategoryIcon = (category: string) => {
    const iconMap: Record<string, string> = {
      'sip_chill': 'wine',
      'dining': 'restaurant',
      'play_move': 'fitness',
      'creative': 'brush',
      'stroll': 'walk',
      'screen_relax': 'tv',
      'casual_eats': 'fast-food',
      'freestyle': 'sparkles'
    };
    return iconMap[category] || 'star';
  };

  const getCategoryColor = (category: string) => {
    const colorMap: Record<string, string> = {
      'sip_chill': '#8B5CF6',
      'dining': '#F59E0B',
      'play_move': '#10B981',
      'creative': '#F97316',
      'stroll': '#06B6D4',
      'screen_relax': '#6366F1',
      'casual_eats': '#EF4444',
      'freestyle': '#EC4899'
    };
    return colorMap[category] || '#6B7280';
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Profile Visibility */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Profile Visibility</Text>
          
          <View style={styles.settingItem}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Who can see your profile</Text>
              <Text style={styles.settingDescription}>
                {getVisibilityDescription(privacySettings.visibility_mode)}
              </Text>
            </View>
            <View style={styles.visibilityButtons}>
              {['public', 'friends', 'private'].map((mode) => (
                <TouchableOpacity
                  key={mode}
                  style={[
                    styles.visibilityButton,
                    privacySettings.visibility_mode === mode && styles.activeVisibilityButton
                  ]}
                  onPress={() => handlePrivacySettingChange('visibility_mode', mode)}
                >
                  <Text style={[
                    styles.visibilityButtonText,
                    privacySettings.visibility_mode === mode && styles.activeVisibilityButtonText
                  ]}>
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Activity Privacy */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Activity Privacy</Text>
          
          <View style={styles.switchItem}>
            <View style={styles.switchInfo}>
              <Text style={styles.switchLabel}>Show your activity</Text>
              <Text style={styles.switchDescription}>
                Let others see when you save experiences and create boards
              </Text>
            </View>
            <Switch
              value={privacySettings.show_activity}
              onValueChange={(value) => handlePrivacySettingChange('show_activity', value)}
              trackColor={{ false: '#E5E5E7', true: '#FF9500' }}
              thumbColor={privacySettings.show_activity ? '#fff' : '#f4f3f4'}
            />
          </View>

          <View style={styles.switchItem}>
            <View style={styles.switchInfo}>
              <Text style={styles.switchLabel}>Show saved experiences</Text>
              <Text style={styles.switchDescription}>
                Let others see your saved experiences in your profile
              </Text>
            </View>
            <Switch
              value={privacySettings.show_saved_experiences}
              onValueChange={(value) => handlePrivacySettingChange('show_saved_experiences', value)}
              trackColor={{ false: '#E5E5E7', true: '#FF9500' }}
              thumbColor={privacySettings.show_saved_experiences ? '#fff' : '#f4f3f4'}
            />
          </View>

          <View style={styles.switchItem}>
            <View style={styles.switchInfo}>
              <Text style={styles.switchLabel}>Show location</Text>
              <Text style={styles.switchDescription}>
                Let others see your current location in your profile
              </Text>
            </View>
            <Switch
              value={privacySettings.show_location}
              onValueChange={(value) => handlePrivacySettingChange('show_location', value)}
              trackColor={{ false: '#E5E5E7', true: '#FF9500' }}
              thumbColor={privacySettings.show_location ? '#fff' : '#f4f3f4'}
            />
          </View>

          <View style={styles.switchItem}>
            <View style={styles.switchInfo}>
              <Text style={styles.switchLabel}>Show preferences</Text>
              <Text style={styles.switchDescription}>
                Let others see your activity preferences and categories
              </Text>
            </View>
            <Switch
              value={privacySettings.show_preferences}
              onValueChange={(value) => handlePrivacySettingChange('show_preferences', value)}
              trackColor={{ false: '#E5E5E7', true: '#FF9500' }}
              thumbColor={privacySettings.show_preferences ? '#fff' : '#f4f3f4'}
            />
          </View>
        </View>

        {/* Saved Experiences Privacy */}
        {privacySettings.show_saved_experiences && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Saved Experiences Privacy</Text>
            <Text style={styles.sectionSubtitle}>
              Control which saved experiences are visible to others
            </Text>
            
            {savedExperiences.map((experience) => (
              <View key={experience.id} style={styles.experienceItem}>
                <View style={styles.experienceInfo}>
                  <View style={styles.experienceIcon}>
                    <Ionicons 
                      name={getCategoryIcon(experience.category) as any} 
                      size={16} 
                      color={getCategoryColor(experience.category)} 
                    />
                  </View>
                  <View style={styles.experienceDetails}>
                    <Text style={styles.experienceTitle}>{experience.title}</Text>
                    <Text style={styles.experienceCategory}>
                      {experience.category.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </Text>
                  </View>
                </View>
                
                <View style={styles.experiencePrivacy}>
                  <View style={styles.privacyToggle}>
                    <Text style={styles.privacyLabel}>Public</Text>
                    <Switch
                      value={experience.privacy?.is_public ?? false}
                      onValueChange={(value) => handleExperiencePrivacyChange(experience.id, 'is_public', value)}
                      trackColor={{ false: '#E5E5E7', true: '#FF9500' }}
                      thumbColor={(experience.privacy?.is_public ?? false) ? '#fff' : '#f4f3f4'}
                    />
                  </View>
                  
                  <View style={styles.privacyToggle}>
                    <Text style={styles.privacyLabel}>Friends</Text>
                    <Switch
                      value={experience.privacy?.visible_to_friends ?? true}
                      onValueChange={(value) => handleExperiencePrivacyChange(experience.id, 'visible_to_friends', value)}
                      trackColor={{ false: '#E5E5E7', true: '#FF9500' }}
                      thumbColor={(experience.privacy?.visible_to_friends ?? true) ? '#fff' : '#f4f3f4'}
                    />
                  </View>
                  
                  <View style={styles.privacyToggle}>
                    <Text style={styles.privacyLabel}>Activity</Text>
                    <Switch
                      value={experience.privacy?.show_in_activity ?? true}
                      onValueChange={(value) => handleExperiencePrivacyChange(experience.id, 'show_in_activity', value)}
                      trackColor={{ false: '#E5E5E7', true: '#FF9500' }}
                      thumbColor={(experience.privacy?.show_in_activity ?? true) ? '#fff' : '#f4f3f4'}
                    />
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
};

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
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    lineHeight: 20,
  },
  settingItem: {
    marginBottom: 16,
  },
  settingInfo: {
    marginBottom: 12,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 14,
    color: '#666',
    lineHeight: 18,
  },
  visibilityButtons: {
    flexDirection: 'row',
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 4,
  },
  visibilityButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  activeVisibilityButton: {
    backgroundColor: '#FF9500',
  },
  visibilityButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
  },
  activeVisibilityButtonText: {
    color: '#fff',
  },
  switchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  switchInfo: {
    flex: 1,
    marginRight: 12,
  },
  switchLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  switchDescription: {
    fontSize: 14,
    color: '#666',
    lineHeight: 18,
  },
  experienceItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  experienceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  experienceIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f8f9fa',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  experienceDetails: {
    flex: 1,
  },
  experienceTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  experienceCategory: {
    fontSize: 14,
    color: '#666',
  },
  experiencePrivacy: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  privacyToggle: {
    alignItems: 'center',
  },
  privacyLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
});
