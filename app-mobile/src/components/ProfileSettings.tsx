import React, { useState } from 'react';
import { Text, View, TouchableOpacity, TextInput } from 'react-native';
import { ArrowLeft, Camera, User, Edit3, Check, X } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import profileImage from '../../assets/16b1d70844c656f5fea042714a1a4d861495a60b.png';

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
    <View className="min-h-full bg-gray-50">
      {/* Header */}
      <View className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-10">
        <View className="flex items-center gap-3">
          <TouchableOpacity
            onClick={onNavigateBack}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </TouchableOpacity>
          <Text className="text-xl font-semibold text-gray-900">Profile Settings</Text>
        </View>
      </View>

      {/* Content */}
      <View className="p-4 space-y-6">
        {/* Profile Photo Section */}
        <View className="bg-white rounded-2xl border border-gray-200 p-6">
          <Text className="font-semibold text-gray-900 mb-4">Profile Photo</Text>
          
          <View className="flex items-center gap-4">
            <View className="relative">
              <TouchableOpacity
                onClick={handleAvatarChange}
                className="relative w-20 h-20 group"
              >
                <ImageWithFallback
                  src={profileImageSrc}
                  alt="Profile"
                  className="w-full h-full rounded-full object-cover border-4 border-gray-200 transition-opacity group-hover:opacity-80"
                />
                {/* Camera overlay */}
                <View className="absolute inset-0 rounded-full bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all duration-200 flex items-center justify-center">
                  <Camera className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                </View>
              </TouchableOpacity>
            </View>
            
            <View className="flex-1">
              <TouchableOpacity
                onClick={handleAvatarChange}
                className="bg-[#eb7825] text-white px-4 py-2 rounded-lg font-medium hover:bg-[#d6691f] transition-colors"
              >
                Change Photo
              </TouchableOpacity>
              <Text className="text-sm text-gray-500 mt-2">
                Upload a new profile photo. Changes are saved automatically.
              </Text>
            </View>
          </View>
        </View>

        {/* Personal Information */}
        <View className="bg-white rounded-2xl border border-gray-200 p-6">
          <Text className="font-semibold text-gray-900 mb-4">Personal Information</Text>
          
          <View className="space-y-4">
            {/* First Name */}
            <View className="flex items-center justify-between py-3 border-b border-gray-100 last:border-b-0">
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
                      <Check className="w-4 h-4" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onClick={handleCancelEdit}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View className="flex items-center justify-between">
                    <Text className="text-gray-900">{userIdentity.firstName}</Text>
                    <TouchableOpacity
                      onClick={() => handleEditField('firstName')}
                      className="p-2 text-gray-400 hover:text-[#eb7825] hover:bg-orange-50 rounded-lg transition-colors"
                    >
                      <Edit3 className="w-4 h-4" />
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
                      <Check className="w-4 h-4" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onClick={handleCancelEdit}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View className="flex items-center justify-between">
                    <Text className="text-gray-900">{userIdentity.lastName}</Text>
                    <TouchableOpacity
                      onClick={() => handleEditField('lastName')}
                      className="p-2 text-gray-400 hover:text-[#eb7825] hover:bg-orange-50 rounded-lg transition-colors"
                    >
                      <Edit3 className="w-4 h-4" />
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
                      <Check className="w-4 h-4" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onClick={handleCancelEdit}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View className="flex items-center justify-between">
                    <Text className="text-gray-900">@{userIdentity.username}</Text>
                    <TouchableOpacity
                      onClick={() => handleEditField('username')}
                      className="p-2 text-gray-400 hover:text-[#eb7825] hover:bg-orange-50 rounded-lg transition-colors"
                    >
                      <Edit3 className="w-4 h-4" />
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


      </View>
    </View>
  );
}