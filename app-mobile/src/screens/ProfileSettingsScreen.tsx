import React, { useState } from 'react';
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

interface ProfileSettingsScreenProps {
  navigation?: any;
}

export default function ProfileSettingsScreen({ navigation }: ProfileSettingsScreenProps) {
  const { user, profile, updateProfile } = useAppStore();
  
  const [formData, setFormData] = useState({
    firstName: profile?.first_name || '',
    lastName: profile?.last_name || '',
    username: profile?.username || user?.email?.split('@')[0] || 'Test',
    email: user?.email || 'hi@sethogieva.com',
  });

  const [loading, setLoading] = useState(false);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSaveChanges = async () => {
    setLoading(true);
    try {
      // In a real app, this would update the profile in the database
      console.log('Saving profile changes:', formData);
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      Alert.alert('Success', 'Profile updated successfully!');
      
      // Navigate back
      if (navigation) {
        navigation.goBack();
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to update profile. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleProfilePhotoUpload = () => {
    Alert.alert(
      'Upload Photo',
      'Choose an option',
      [
        { text: 'Camera', onPress: () => console.log('Open camera') },
        { text: 'Photo Library', onPress: () => console.log('Open photo library') },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const goBack = () => {
    if (navigation) {
      navigation.goBack();
    }
  };

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
                source={{ uri: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=face' }}
                style={styles.avatar}
              />
              <TouchableOpacity 
                style={styles.cameraButton}
                onPress={handleProfilePhotoUpload}
              >
                <Ionicons name="camera" size={16} color="#1a1a1a" />
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
          style={[styles.saveButton, loading && styles.saveButtonDisabled]}
          onPress={handleSaveChanges}
          disabled={loading}
        >
          <Ionicons name="save" size={20} color="#fff" />
          <Text style={styles.saveButtonText}>
            {loading ? 'Saving...' : 'Save Changes'}
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
});
