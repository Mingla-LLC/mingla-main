import React, { useState } from 'react';
import { ArrowLeft, Camera, User, Edit3, Check, X } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import profileImage from 'figma:asset/16b1d70844c656f5fea042714a1a4d861495a60b.png';

interface ProfileSettingsProps {
  userIdentity: {
    firstName: string;
    lastName: string;
    username: string;
    email?: string;
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
  const [activityStatus, setActivityStatus] = useState(true);
  const [profileVisibility, setProfileVisibility] = useState<'Nobody' | 'Friends Only' | 'Everybody'>('Friends Only');
  const [tempValues, setTempValues] = useState({
    firstName: userIdentity.firstName,
    lastName: userIdentity.lastName,
    username: userIdentity.username,
    email: userIdentity.email || `${userIdentity.username}@mingla.com`
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
      username: userIdentity.username,
      email: userIdentity.email || `${userIdentity.username}@mingla.com`
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

  const cycleProfileVisibility = () => {
    const options: Array<'Nobody' | 'Friends Only' | 'Everybody'> = ['Nobody', 'Friends Only', 'Everybody'];
    const currentIndex = options.indexOf(profileVisibility);
    const nextIndex = (currentIndex + 1) % options.length;
    setProfileVisibility(options[nextIndex]);
  };

  return (
    <div className="h-screen overflow-y-auto bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={onNavigateBack}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-xl font-semibold text-gray-900">Profile Settings</h1>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-6">
        {/* Personal Information */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-2">Personal Information</h3>
          <p className="text-sm text-gray-500 mb-4">
            Your personal details are private and only used to personalize your experience.
          </p>
          
          <div className="space-y-4">
            {/* First Name */}
            <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-b-0">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  First Name
                </label>
                {isEditing === 'firstName' ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={tempValues.firstName}
                      onChange={(e) => handleInputChange('firstName', e.target.value)}
                      onKeyDown={(e) => handleKeyPress(e, 'firstName')}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#eb7825] focus:border-transparent"
                      autoFocus
                    />
                    <button
                      onClick={() => handleSaveField('firstName')}
                      className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-900">{userIdentity.firstName}</span>
                    <button
                      onClick={() => handleEditField('firstName')}
                      className="p-2 text-gray-400 hover:text-[#eb7825] hover:bg-orange-50 rounded-lg transition-colors"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Last Name */}
            <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-b-0">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Last Name
                </label>
                {isEditing === 'lastName' ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={tempValues.lastName}
                      onChange={(e) => handleInputChange('lastName', e.target.value)}
                      onKeyDown={(e) => handleKeyPress(e, 'lastName')}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#eb7825] focus:border-transparent"
                      autoFocus
                    />
                    <button
                      onClick={() => handleSaveField('lastName')}
                      className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-900">{userIdentity.lastName}</span>
                    <button
                      onClick={() => handleEditField('lastName')}
                      className="p-2 text-gray-400 hover:text-[#eb7825] hover:bg-orange-50 rounded-lg transition-colors"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Username */}
            <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-b-0">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Username
                </label>
                {isEditing === 'username' ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center">
                      <span className="text-gray-500 mr-1">@</span>
                      <input
                        type="text"
                        value={tempValues.username}
                        onChange={(e) => handleInputChange('username', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                        onKeyDown={(e) => handleKeyPress(e, 'username')}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#eb7825] focus:border-transparent"
                        autoFocus
                        placeholder="username"
                      />
                    </div>
                    <button
                      onClick={() => handleSaveField('username')}
                      className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-900">@{userIdentity.username}</span>
                    <button
                      onClick={() => handleEditField('username')}
                      className="p-2 text-gray-400 hover:text-[#eb7825] hover:bg-orange-50 rounded-lg transition-colors"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                  </div>
                )}
                {isEditing === 'username' && (
                  <p className="text-xs text-gray-500 mt-1">
                    Username can only contain lowercase letters, numbers, and underscores.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Account Information */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-2">Account Information</h3>
          <p className="text-sm text-gray-500 mb-4">
            Manage your account details and preferences.
          </p>
          
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-sm text-gray-600">Email</span>
              {isEditing === 'email' ? (
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    value={tempValues.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    onKeyDown={(e) => handleKeyPress(e, 'email')}
                    className="text-sm font-medium text-gray-900 border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#eb7825] focus:border-transparent"
                    autoFocus
                  />
                  <button
                    onClick={() => handleSaveField('email')}
                    className="p-1.5 hover:bg-green-50 rounded-lg transition-colors"
                  >
                    <Check className="w-4 h-4 text-green-600" />
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="p-1.5 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4 text-red-600" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">
                    {userIdentity.email || `${userIdentity.username}@mingla.com`}
                  </span>
                  <button
                    onClick={() => handleEditField('email')}
                    className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-sm text-gray-600">Member Since</span>
              <span className="text-sm font-medium text-gray-900">
                {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-gray-600">Account Status</span>
              <span className="px-3 py-1 bg-green-50 text-green-700 rounded-full text-xs font-medium">
                Active
              </span>
            </div>
          </div>
        </div>

        {/* Privacy & Visibility */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-24">
          <h3 className="font-semibold text-gray-900 mb-2">Privacy & Visibility</h3>
          <p className="text-sm text-gray-500 mb-4">
            Control how others see your profile and activity.
          </p>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between py-3 border-b border-gray-100">
              <div>
                <p className="text-sm font-medium text-gray-900">Profile Visibility</p>
                <p className="text-xs text-gray-500 mt-0.5">Who can see your profile</p>
              </div>
              <button
                onClick={cycleProfileVisibility}
                className="text-sm text-[#eb7825] font-medium hover:text-[#d6691f] transition-colors px-3 py-1 rounded-lg hover:bg-orange-50"
              >
                {profileVisibility}
              </button>
            </div>
            
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">Activity Status</p>
                <p className="text-xs text-gray-500 mt-0.5">Show when you're online</p>
              </div>
              <button
                onClick={() => setActivityStatus(!activityStatus)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  activityStatus ? 'bg-green-500' : 'bg-gray-300'
                }`}
              >
                <div
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                    activityStatus ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}