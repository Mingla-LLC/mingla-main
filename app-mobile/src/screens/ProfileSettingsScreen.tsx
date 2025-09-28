import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppStore } from '../store/appStore';
import { useUserProfile } from '../hooks/useUserProfile';
import { cameraService } from '../services/cameraService';

interface ProfileSettingsScreenProps {
  navigation?: any;
}

export default function ProfileSettingsScreen({ navigation }: ProfileSettingsScreenProps) {
  const { user } = useAppStore();
  const { profile, loading, error, updateProfile, uploadAvatar, refreshProfile } = useUserProfile();
  
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    username: '',
    email: '',
    bio: '',
  });

  const [isSaving, setIsSaving] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);

  // Initialize form data when profile loads
  useEffect(() => {
    if (profile) {
      setFormData({
        firstName: profile.first_name || '',
        lastName: profile.last_name || '',
        username: profile.username || user?.email?.split('@')[0] || '',
        email: user?.email || '',
        bio: profile.bio || '',
      });
    }
  }, [profile, user]);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSaveChanges = async () => {
    if (!user?.id) {
      Alert.alert('Error', 'User not authenticated');
      return;
    }

    setIsSaving(true);
    try {
      const updates = {
        first_name: formData.firstName,
        last_name: formData.lastName,
        username: formData.username,
        display_name: `${formData.firstName} ${formData.lastName}`.trim(),
        bio: formData.bio,
      };

      await updateProfile(updates);
      Alert.alert('Success', 'Profile updated successfully!');
      
      // Navigate back
      if (navigation) {
        navigation.goBack();
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert('Error', 'Failed to update profile. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleProfilePhotoUpload = () => {
    Alert.alert(
      'Upload Photo',
      'Choose an option',
      [
        { text: 'Camera', onPress: () => handleImagePicker('camera') },
        { text: 'Photo Library', onPress: () => handleImagePicker('library') },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleImagePicker = async (source: 'camera' | 'library') => {
    if (!user?.id) {
      Alert.alert('Error', 'User not authenticated');
      return;
    }

    setAvatarLoading(true);
    try {
      let result;
      
      if (source === 'camera') {
        result = await cameraService.takePhoto({
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        });
      } else {
        result = await cameraService.pickImage({
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        });
      }

      if (result && !result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        
        // Convert to File object for upload
        const response = await fetch(asset.uri);
        const blob = await response.blob();
        const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });

        // Upload to Supabase
        const uploadResult = await uploadAvatar(file);
        
        if (uploadResult) {
          Alert.alert('Success', 'Profile photo updated successfully!');
          // Refresh profile to get updated avatar URL
          await refreshProfile();
        }
      }
    } catch (error) {
      console.error('Error uploading photo:', error);
      Alert.alert('Error', 'Failed to upload photo. Please try again.');
    } finally {
      setAvatarLoading(false);
    }
  };

  const goBack = () => {
    if (navigation) {
      navigation.goBack();
    }
  };

  // Show loading state while profile is loading
  if (loading && !profile) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={goBack}>
            <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile Settings</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.loadingContainer}>
          <Ionicons name="hourglass" size={48} color="#666" />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={goBack}>
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Profile Photo Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Profile Photo</Text>
          <View style={styles.photoContainer}>
            <View style={styles.avatarContainer}>
              <Image
                source={{ 
                  uri: profile?.avatar_url || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=face' 
                }}
                style={styles.avatar}
                defaultSource={{ uri: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=face' }}
              />
              <TouchableOpacity 
                style={[styles.cameraButton, avatarLoading && styles.cameraButtonDisabled]}
                onPress={handleProfilePhotoUpload}
                disabled={avatarLoading}
              >
                {avatarLoading ? (
                  <Ionicons name="hourglass" size={16} color="#666" />
                ) : (
                  <Ionicons name="camera" size={16} color="#1a1a1a" />
                )}
              </TouchableOpacity>
            </View>
            <Text style={styles.photoInstruction}>
              Click the camera icon to upload a new profile picture
            </Text>
          </View>
        </View>

        {/* Personal Information Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Personal Information</Text>
          
          {/* First Name and Last Name Row */}
          <View style={styles.nameRow}>
            <View style={styles.nameField}>
              <Text style={styles.fieldLabel}>First Name</Text>
              <TextInput
                style={styles.textInput}
                placeholder="Enter your first name"
                placeholderTextColor="#999"
                value={formData.firstName}
                onChangeText={(value) => handleInputChange('firstName', value)}
              />
            </View>
            <View style={styles.nameField}>
              <Text style={styles.fieldLabel}>Last Name</Text>
              <TextInput
                style={styles.textInput}
                placeholder="Enter your last name"
                placeholderTextColor="#999"
                value={formData.lastName}
                onChangeText={(value) => handleInputChange('lastName', value)}
              />
            </View>
          </View>

          {/* Username Field */}
          <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>Username *</Text>
            <TextInput
              style={styles.textInput}
              value={formData.username}
              onChangeText={(value) => handleInputChange('username', value)}
            />
            <Text style={styles.helperText}>
              Your username is how friends can find and add you
            </Text>
          </View>

          {/* Bio Field */}
          <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>Bio</Text>
            <TextInput
              style={[styles.textInput, styles.bioInput]}
              placeholder="Tell us about yourself..."
              placeholderTextColor="#999"
              value={formData.bio}
              onChangeText={(value) => handleInputChange('bio', value)}
              multiline
              numberOfLines={3}
              maxLength={160}
            />
            <Text style={styles.helperText}>
              A short description about yourself (optional)
            </Text>
          </View>

          {/* Email Field */}
          <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              style={[styles.textInput, styles.disabledInput]}
              value={formData.email}
              editable={false}
            />
            <Text style={styles.helperText}>
              Email cannot be changed from this page
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Save Changes Button */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity 
          style={[styles.saveButton, (isSaving || loading) && styles.saveButtonDisabled]}
          onPress={handleSaveChanges}
          disabled={isSaving || loading}
        >
          <Ionicons name="save" size={20} color="#fff" />
          <Text style={styles.saveButtonText}>
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Text>
        </TouchableOpacity>
      </View>
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
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginTop: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 20,
  },
  photoContainer: {
    alignItems: 'center',
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 12,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  cameraButton: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 8,
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cameraButtonDisabled: {
    backgroundColor: '#f0f0f0',
    opacity: 0.6,
  },
  photoInstruction: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
  },
  nameRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  nameField: {
    flex: 1,
  },
  fieldContainer: {
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#E5E5E7',
  },
  disabledInput: {
    backgroundColor: '#f0f0f0',
    color: '#666',
  },
  bioInput: {
    height: 80,
    textAlignVertical: 'top',
  },
  helperText: {
    fontSize: 14,
    color: '#666',
    marginTop: 6,
    lineHeight: 18,
  },
  buttonContainer: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#E5E5E7',
  },
  saveButton: {
    backgroundColor: '#FF9500',
    borderRadius: 12,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveButtonDisabled: {
    backgroundColor: '#ccc',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
    marginTop: 16,
    textAlign: 'center',
  },
});
