import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { ImageWithFallback } from '../figma/ImageWithFallback';

interface ProfileHeroSectionProps {
  isOwnProfile: boolean;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  avatarUrl: string | null;
  bio: string | null;
  location?: string;
  isLoadingLocation?: boolean;
  locationError?: string | null;
  showCompletionBar?: boolean;
  onAvatarPress?: () => void;
  onBioPress?: () => void;
  onLocationRefresh?: () => void;
  isUploading?: boolean;
}

const getInitials = (first: string | null, last: string | null): string => {
  const f = first?.charAt(0)?.toUpperCase() ?? '';
  const l = last?.charAt(0)?.toUpperCase() ?? '';
  return f + l || '?';
};

const ProfileHeroSection: React.FC<ProfileHeroSectionProps> = ({
  isOwnProfile,
  firstName,
  lastName,
  username,
  avatarUrl,
  bio,
  location,
  isLoadingLocation,
  locationError,
  onAvatarPress,
  onBioPress,
  onLocationRefresh,
  isUploading,
}) => {
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || 'User';
  const missingBio = !bio || bio.trim().length === 0;
  const missingAvatar = !avatarUrl;
  const showHint = isOwnProfile && (missingBio || missingAvatar);

  const hintText = missingAvatar
    ? 'Upload a profile photo to complete your profile'
    : 'Add a bio to let people know what you\'re about';

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#fef3e2', '#ffffff']} style={styles.gradient} />

      <TouchableOpacity
        style={styles.avatarWrap}
        onPress={onAvatarPress}
        disabled={!isOwnProfile || isUploading}
        activeOpacity={0.8}
      >
        {isUploading ? (
          <View style={styles.avatar}>
            <ActivityIndicator size="large" color="#eb7825" />
          </View>
        ) : avatarUrl ? (
          <ImageWithFallback
            source={{ uri: avatarUrl }}
            style={styles.avatar}
          />
        ) : (
          <LinearGradient
            colors={['#eb7825', '#f5a623']}
            style={styles.avatar}
          >
            <Text style={styles.initials}>{getInitials(firstName, lastName)}</Text>
          </LinearGradient>
        )}
        {isOwnProfile && !isUploading && (
          <View style={styles.cameraBadge}>
            <Ionicons name="camera" size={14} color="#ffffff" />
          </View>
        )}
      </TouchableOpacity>

      <Text style={styles.name}>{displayName}</Text>

      {(location || isOwnProfile) && (
        <View style={styles.locationRow}>
          <Ionicons name="location-sharp" size={14} color="#6b7280" />
          {isLoadingLocation ? (
            <ActivityIndicator size="small" color="#6b7280" style={styles.locationLoader} />
          ) : (
            <Text style={styles.locationText}>{location || 'Unknown location'}</Text>
          )}
          {isOwnProfile && onLocationRefresh && (
            <TouchableOpacity onPress={onLocationRefresh} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="refresh" size={14} color="#6b7280" style={styles.refreshIcon} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {missingBio && isOwnProfile ? (
        <TouchableOpacity onPress={onBioPress}>
          <Text style={styles.addBio}>Add a bio</Text>
        </TouchableOpacity>
      ) : bio ? (
        <TouchableOpacity onPress={isOwnProfile ? onBioPress : undefined} disabled={!isOwnProfile}>
          <Text style={styles.bio} numberOfLines={3}>{bio}</Text>
        </TouchableOpacity>
      ) : null}

      {showHint && (
        <View style={styles.hintContainer}>
          <Text style={styles.hintText}>{hintText}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingBottom: 16 },
  gradient: { ...StyleSheet.absoluteFillObject, height: 120 },
  avatarWrap: { marginTop: 24, position: 'relative' },
  avatar: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center',
  },
  initials: { fontSize: 32, fontWeight: '700', color: '#ffffff' },
  cameraBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#eb7825', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#ffffff',
  },
  name: { fontSize: 22, fontWeight: '700', color: '#111827', marginTop: 12 },
  username: { fontSize: 14, color: '#6b7280', marginTop: 2 },
  locationRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  locationText: { fontSize: 14, color: '#6b7280', marginLeft: 4 },
  locationLoader: { marginLeft: 4 },
  refreshIcon: { marginLeft: 6 },
  bio: { fontSize: 15, color: '#374151', textAlign: 'center', marginTop: 12, paddingHorizontal: 24 },
  addBio: { fontSize: 15, color: '#9ca3af', fontStyle: 'italic', marginTop: 12 },
  hintContainer: {
    marginTop: 12, marginHorizontal: 24, backgroundColor: '#fef3e2',
    borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12,
  },
  hintText: { fontSize: 13, color: '#6b7280', textAlign: 'center' },
});

export default ProfileHeroSection;
