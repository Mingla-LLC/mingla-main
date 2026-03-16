import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  Animated,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon } from '../ui/Icon';
import { ImageWithFallback } from '../figma/ImageWithFallback';
import * as Haptics from 'expo-haptics';

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
  onAvatarPress?: () => void;
  onBioPress?: () => void;
  onLocationRefresh?: () => void;
  isUploading?: boolean;
  statusBarHeight?: number;
  onSaveName?: (firstName: string, lastName: string) => Promise<boolean>;
}

const getInitials = (first: string | null, last: string | null): string => {
  const f = first?.charAt(0)?.toUpperCase() ?? '';
  const l = last?.charAt(0)?.toUpperCase() ?? '';
  return f + l || '?';
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const ProfileHeroSection: React.FC<ProfileHeroSectionProps> = ({
  isOwnProfile,
  firstName,
  lastName,
  avatarUrl,
  bio,
  location,
  isLoadingLocation,
  locationError,
  onAvatarPress,
  onBioPress,
  onLocationRefresh,
  isUploading,
  statusBarHeight = 0,
  onSaveName,
}) => {
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || '';
  const missingBio = !bio || bio.trim().length === 0;
  const missingAvatar = !avatarUrl;
  const missingName = !displayName;
  const showHint = isOwnProfile && (missingBio || missingAvatar);

  const hintText = missingAvatar
    ? 'People trust faces. Add a photo so friends know it\u2019s you.'
    : 'A short bio goes a long way. What should people know about you?';

  // Inline name editing state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editFirstName, setEditFirstName] = useState(firstName || '');
  const [editLastName, setEditLastName] = useState(lastName || '');
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Shake animation (the only animation we keep — it's a single-view effect, no mount race)
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const lastNameInputRef = useRef<TextInput>(null);

  const startEditing = () => {
    if (!isOwnProfile || !onSaveName) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditFirstName(firstName || '');
    setEditLastName(lastName || '');
    setNameError(null);
    setIsEditingName(true);
  };

  const cancelEditing = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setNameError(null);
    setIsEditingName(false);
  };

  const saveName = async () => {
    if (!onSaveName) return;
    const trimFirst = editFirstName.trim();
    const trimLast = editLastName.trim();
    if (!trimFirst && !trimLast) {
      setNameError('Please enter your name.');
      triggerShake();
      return;
    }

    setIsSavingName(true);
    setNameError(null);
    try {
      const success = await onSaveName(trimFirst, trimLast);
      if (success) {
        setIsEditingName(false);
      } else {
        setNameError('Failed to save. Try again.');
        triggerShake();
      }
    } catch {
      setNameError('Failed to save. Try again.');
      triggerShake();
    } finally {
      setIsSavingName(false);
    }
  };

  const triggerShake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: -10, duration: 75, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 75, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 75, useNativeDriver: true }),
    ]).start();
  };

  const gradientHeight = 180 + statusBarHeight;
  const inputRowMaxWidth = Math.min(SCREEN_WIDTH - 48, 340);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#fef3e2', '#fef3e2', '#ffffff']}
        locations={[0, 0.3, 1]}
        style={[styles.gradient, { height: gradientHeight }]}
      />

      <View>
        <TouchableOpacity
          style={[styles.avatarWrap, { marginTop: 28 + statusBarHeight }]}
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
              <Icon name="camera" size={14} color="#ffffff" />
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Name display / inline edit — conditional render with no opacity
          animation layer. Only Animated.View is the edit container (for shake). */}
      {isEditingName ? (
        <Animated.View
          style={[
            styles.nameEditContainer,
            { maxWidth: inputRowMaxWidth, transform: [{ translateX: shakeAnim }] },
          ]}
        >
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.nameInput, isSavingName && styles.nameInputDisabled]}
              value={editFirstName}
              onChangeText={setEditFirstName}
              placeholder="First name"
              placeholderTextColor="#9ca3af"
              autoCapitalize="words"
              autoFocus
              editable={!isSavingName}
              returnKeyType="next"
              onSubmitEditing={() => lastNameInputRef.current?.focus()}
              blurOnSubmit={false}
            />
            <TextInput
              ref={lastNameInputRef}
              style={[styles.nameInput, isSavingName && styles.nameInputDisabled]}
              value={editLastName}
              onChangeText={setEditLastName}
              placeholder="Last name"
              placeholderTextColor="#9ca3af"
              autoCapitalize="words"
              editable={!isSavingName}
              returnKeyType="done"
              onSubmitEditing={saveName}
            />
          </View>
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={cancelEditing}
              disabled={isSavingName}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              accessibilityLabel="Cancel editing"
              accessibilityRole="button"
            >
              <Icon name="close" size={18} color="#6b7280" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.saveButton}
              onPress={saveName}
              disabled={isSavingName}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              accessibilityLabel="Save name"
              accessibilityRole="button"
            >
              {isSavingName ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Icon name="checkmark" size={18} color="#ffffff" />
              )}
            </TouchableOpacity>
          </View>
          {nameError && <Text style={styles.nameErrorText}>{nameError}</Text>}
        </Animated.View>
      ) : (
        <View>
          {isOwnProfile ? (
            <TouchableOpacity
              style={styles.nameRow}
              onPress={startEditing}
              activeOpacity={0.7}
              accessibilityLabel={displayName ? `Your name, ${displayName}. Double tap to edit.` : 'Add your name. Double tap to edit.'}
              accessibilityRole="button"
            >
              <Text style={[styles.name, missingName && styles.namePlaceholder]}>
                {displayName || 'Your name here'}
              </Text>
              <Icon name="pencil" size={14} color="#9ca3af" style={styles.pencilIcon} />
            </TouchableOpacity>
          ) : (
            <Text style={styles.name}>{displayName || 'User'}</Text>
          )}
        </View>
      )}

      {(location || isOwnProfile) && (
        <View style={styles.locationRow}>
          <Icon name="location-sharp" size={14} color="#6b7280" />
          {isLoadingLocation ? (
            <ActivityIndicator size="small" color="#6b7280" style={styles.locationLoader} />
          ) : (
            <Text style={styles.locationText}>{location || 'Somewhere cool, probably'}</Text>
          )}
          {isOwnProfile && onLocationRefresh && (
            <TouchableOpacity onPress={onLocationRefresh} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="refresh" size={14} color="#6b7280" style={styles.refreshIcon} />
            </TouchableOpacity>
          )}
        </View>
      )}

      <View>
        {missingBio && isOwnProfile ? (
          <TouchableOpacity onPress={onBioPress}>
            <Text style={styles.addBio}>Tap to add a bio</Text>
          </TouchableOpacity>
        ) : bio ? (
          <TouchableOpacity onPress={isOwnProfile ? onBioPress : undefined} disabled={!isOwnProfile}>
            <Text style={styles.bio} numberOfLines={3}>{bio}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

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
  gradient: { ...StyleSheet.absoluteFillObject },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 104, height: 104, borderRadius: 52,
    backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center',
  },
  initials: { fontSize: 32, fontWeight: '700', color: '#ffffff' },
  cameraBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#eb7825', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#ffffff',
  },
  // Name display
  nameRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: 12, gap: 6, minHeight: 44,
  },
  name: { fontSize: 24, fontWeight: '700', color: '#111827' },
  namePlaceholder: { color: '#9ca3af', fontStyle: 'italic' },
  pencilIcon: { marginTop: 2 },
  // Name editing
  nameEditContainer: {
    alignItems: 'center', marginTop: 12, width: '100%',
    paddingHorizontal: 24, minHeight: 44,
  },
  inputRow: { flexDirection: 'row', gap: 8, width: '100%' },
  nameInput: {
    flex: 1, height: 44, borderRadius: 12,
    borderWidth: 1, borderColor: '#d1d5db',
    backgroundColor: '#ffffff', paddingHorizontal: 16,
    fontSize: 16, fontWeight: '600', color: '#111827', textAlign: 'center',
  },
  nameInputDisabled: { opacity: 0.6 },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelButton: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center',
  },
  saveButton: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#eb7825', alignItems: 'center', justifyContent: 'center',
  },
  nameErrorText: {
    fontSize: 12, color: '#ef4444', textAlign: 'center', marginTop: 4,
  },
  // Location
  locationRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  locationText: { fontSize: 14, color: '#6b7280', marginLeft: 4 },
  locationLoader: { marginLeft: 4 },
  refreshIcon: { marginLeft: 6 },
  // Bio
  bio: { fontSize: 15, color: '#374151', textAlign: 'center', marginTop: 12, paddingHorizontal: 24 },
  addBio: { fontSize: 15, color: '#9ca3af', fontStyle: 'italic', marginTop: 12 },
  // Hint
  hintContainer: {
    marginTop: 12, marginHorizontal: 24, backgroundColor: '#fef3e2',
    borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12,
  },
  hintText: { fontSize: 13, color: '#6b7280', textAlign: 'center' },
});

export default ProfileHeroSection;
