import React, { useState } from 'react';
import { Text, View, TouchableOpacity, TextInput, StyleSheet, ScrollView, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ImageWithFallback } from '../figma/ImageWithFallback';
import profileImage from '../../../assets/16b1d70844c656f5fea042714a1a4d861495a60b.png';

interface ProfileSettingsProps {
  userIdentity: {
    firstName: string;
    lastName: string;
    username: string;
    profileImage: string | null;
  };
  onUpdateIdentity: (identity: any) => void;
  onNavigateBack: () => void;
}

export default function ProfileSettings({ 
  userIdentity, 
  onUpdateIdentity, 
  onNavigateBack 
}: ProfileSettingsProps) {
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [tempValues, setTempValues] = useState({
    firstName: userIdentity.firstName,
    lastName: userIdentity.lastName,
    username: userIdentity.username
  });
  const [profileImageSrc, setProfileImageSrc] = useState(userIdentity.profileImage || profileImage);

  const handleEditField = (field: string) => {
    setIsEditing(field);
    setTempValues(prev => ({
      ...prev,
      [field]: userIdentity[field as keyof typeof userIdentity]
    }));
  };

  const handleSaveField = (field: string) => {
    const updatedIdentity = {
      ...userIdentity,
      [field]: tempValues[field as keyof typeof tempValues]
    };
    onUpdateIdentity(updatedIdentity);
    setIsEditing(null);
  };

  const handleCancelEdit = () => {
    setTempValues({
      firstName: userIdentity.firstName,
      lastName: userIdentity.lastName,
      username: userIdentity.username
    });
    setIsEditing(null);
  };

  const handleAvatarChange = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const newImageSrc = e.target?.result as string;
          setProfileImageSrc(newImageSrc);
          const updatedIdentity = {
            ...userIdentity,
            profileImage: newImageSrc
          };
          onUpdateIdentity(updatedIdentity);
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  const handleInputChange = (field: string, value: string) => {
    setTempValues(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleKeyPress = (e: React.KeyboardEvent, field: string) => {
    if (e.key === 'Enter') {
      handleSaveField(field);
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <TouchableOpacity
            onPress={onNavigateBack}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={20} color="#6b7280" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile Settings</Text>
        </View>
      </View>

      {/* Content */}
      <ScrollView style={styles.content}>
        {/* Profile Photo Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Profile Photo</Text>
          
          <View style={styles.profilePhotoContainer}>
            <View style={styles.avatarContainer}>
              <TouchableOpacity
                onPress={handleAvatarChange}
                style={styles.avatarButton}
              >
                <ImageWithFallback
                  source={{ uri: profileImageSrc }}
                  style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: 50,
                    borderWidth: 4,
                    borderColor: '#e5e7eb'
                  }}
                />
                {/* Camera overlay */}
                <View style={styles.cameraOverlay}>
                  <Ionicons name="camera" size={24} color="white" />
                </View>
              </TouchableOpacity>
            </View>
            
            <View style={styles.photoActions}>
              <TouchableOpacity
                onPress={handleAvatarChange}
                style={styles.changePhotoButton}
              >
                <Text style={styles.changePhotoButtonText}>Change Photo</Text>
              </TouchableOpacity>
              <Text style={styles.photoHint}>
                Upload a new profile photo. Changes are saved automatically.
              </Text>
            </View>
          </View>
        </View>

        {/* Personal Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Personal Information</Text>
          
          <View style={styles.formFields}>
            {/* First Name */}
            <View style={styles.formField}>
              <View className="flex-1">
                <Text style={{ color: '#374151', fontWeight: '500', fontSize: 14, marginBottom: 4 }}>
                  First Name
                </Text>
                {isEditing === 'firstName' ? (
                  <View className="flex items-center gap-2">
                    <TextInput
                      value={tempValues.firstName}
                      onChangeText={(text) => handleInputChange('firstName', text)}
                      style={{
                        flex: 1,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderWidth: 1,
                        borderColor: '#d1d5db',
                        borderRadius: 8,
                        fontSize: 16,
                        backgroundColor: 'white'
                      }}
                      autoFocus
                    />
                    <TouchableOpacity
                      onClick={() => handleSaveField('firstName')}
                      className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                    >
                      <Ionicons name="checkmark" size={16} color="#10b981" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onClick={handleCancelEdit}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Ionicons name="close" size={16} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View className="flex items-center justify-between">
                    <Text className="text-gray-900">{userIdentity.firstName}</Text>
                    <TouchableOpacity
                      onClick={() => handleEditField('firstName')}
                      className="p-2 text-gray-400 hover:text-[#eb7825] hover:bg-orange-50 rounded-lg transition-colors"
                    >
                      <Ionicons name="create" size={16} color="#6b7280" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>

            {/* Last Name */}
            <View className="flex items-center justify-between py-3 border-b border-gray-100 last:border-b-0">
              <View className="flex-1">
                <Text style={{ color: '#374151', fontWeight: '500', fontSize: 14, marginBottom: 4 }}>
                  Last Name
                </Text>
                {isEditing === 'lastName' ? (
                  <View className="flex items-center gap-2">
                    <TextInput
                      value={tempValues.lastName}
                      onChangeText={(text) => handleInputChange('lastName', text)}
                      style={{
                        flex: 1,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderWidth: 1,
                        borderColor: '#d1d5db',
                        borderRadius: 8,
                        fontSize: 16,
                        backgroundColor: 'white'
                      }}
                      autoFocus
                    />
                    <TouchableOpacity
                      onClick={() => handleSaveField('lastName')}
                      className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                    >
                      <Ionicons name="checkmark" size={16} color="#10b981" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onClick={handleCancelEdit}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Ionicons name="close" size={16} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View className="flex items-center justify-between">
                    <Text className="text-gray-900">{userIdentity.lastName}</Text>
                    <TouchableOpacity
                      onClick={() => handleEditField('lastName')}
                      className="p-2 text-gray-400 hover:text-[#eb7825] hover:bg-orange-50 rounded-lg transition-colors"
                    >
                      <Ionicons name="create" size={16} color="#6b7280" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>

            {/* Username */}
            <View className="flex items-center justify-between py-3 border-b border-gray-100 last:border-b-0">
              <View className="flex-1">
                <Text style={{ color: '#374151', fontWeight: '500', fontSize: 14, marginBottom: 4 }}>
                  Username
                </Text>
                {isEditing === 'username' ? (
                  <View className="flex items-center gap-2">
                    <View className="flex-1 flex items-center">
                      <Text className="text-gray-500 mr-1">@</Text>
                      <TextInput
                        value={tempValues.username}
                        onChangeText={(text) => handleInputChange('username', text.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                        style={{
                          flex: 1,
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderWidth: 1,
                          borderColor: '#d1d5db',
                          borderRadius: 8,
                          fontSize: 16,
                          backgroundColor: 'white'
                        }}
                        autoFocus
                        placeholder="username"
                      />
                    </View>
                    <TouchableOpacity
                      onClick={() => handleSaveField('username')}
                      className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                    >
                      <Ionicons name="checkmark" size={16} color="#10b981" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onClick={handleCancelEdit}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Ionicons name="close" size={16} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View className="flex items-center justify-between">
                    <Text className="text-gray-900">@{userIdentity.username}</Text>
                    <TouchableOpacity
                      onClick={() => handleEditField('username')}
                      className="p-2 text-gray-400 hover:text-[#eb7825] hover:bg-orange-50 rounded-lg transition-colors"
                    >
                      <Ionicons name="create" size={16} color="#6b7280" />
                    </TouchableOpacity>
                  </View>
                )}
                {isEditing === 'username' && (
                  <Text className="text-xs text-gray-500 mt-1">
                    Username can only contain lowercase letters, numbers, and underscores.
                  </Text>
                )}
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  header: {
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    padding: 8,
    borderRadius: 20,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    backgroundColor: 'white',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 24,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 16,
  },
  profilePhotoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatarButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    overflow: 'hidden',
  },
  cameraOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoActions: {
    flex: 1,
  },
  changePhotoButton: {
    backgroundColor: '#eb7825',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  changePhotoButtonText: {
    color: 'white',
    fontWeight: '500',
  },
  photoHint: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 8,
  },
  formFields: {
    gap: 16,
  },
  formField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  fieldLabel: {
    color: '#374151',
    fontWeight: '500',
    fontSize: 14,
    marginBottom: 4,
  },
  fieldValue: {
    fontSize: 16,
    color: '#111827',
  },
  editButton: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#f3f4f6',
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  textInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    fontSize: 16,
    color: '#111827',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  saveButton: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#10b981',
  },
  cancelButton: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#ef4444',
  },
  editButton: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#f3f4f6',
  },
});