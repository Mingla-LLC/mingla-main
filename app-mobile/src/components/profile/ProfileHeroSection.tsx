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
import { useTranslation } from 'react-i18next';
import { glass } from '../../constants/designSystem';

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
  onSaveName,
}) => {
  const { t } = useTranslation(['profile', 'common']);
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || '';
  const missingBio = !bio || bio.trim().length === 0;
  const missingAvatar = !avatarUrl;
  const missingName = !displayName;
  const showHint = isOwnProfile && (missingBio || missingAvatar);

  const hintText = missingAvatar
    ? t('profile:hero.hint_add_photo')
    : t('profile:hero.hint_add_bio');

  // Inline name editing state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editFirstName, setEditFirstName] = useState(firstName || '');
  const [editLastName, setEditLastName] = useState(lastName || '');
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Shake animation (preserved — single-view effect, no mount race)
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
      setNameError(t('profile:hero.name_error_empty'));
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
        setNameError(t('profile:hero.name_error_failed'));
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

  const inputRowMaxWidth = Math.min(SCREEN_WIDTH - 48, 340);
  const handleUsername = username ? (username.startsWith('@') ? username : `@${username}`) : null;

  return (
    <View style={styles.container}>
      {/* Avatar with dual ring (inner white hairline + outer canvas cut) */}
      <TouchableOpacity
        style={styles.avatarWrap}
        onPress={onAvatarPress}
        disabled={!isOwnProfile || isUploading}
        activeOpacity={0.85}
        accessibilityLabel={
          isOwnProfile
            ? (avatarUrl ? 'Your profile photo. Double-tap to change.' : 'Add your profile photo. Double-tap to open.')
            : displayName ? `${displayName}'s profile photo` : 'Profile photo'
        }
        accessibilityRole="button"
      >
        <View style={styles.avatarOuterRing}>
          <View style={styles.avatarInnerRing}>
            {isUploading ? (
              <View style={styles.avatar}>
                <ActivityIndicator size="large" color="#eb7825" />
              </View>
            ) : avatarUrl ? (
              <ImageWithFallback source={{ uri: avatarUrl }} style={styles.avatar} />
            ) : (
              <LinearGradient
                colors={glass.profile.avatar.initialsGradient.colors}
                style={styles.avatar}
              >
                <Text style={styles.initials}>{getInitials(firstName, lastName)}</Text>
              </LinearGradient>
            )}
          </View>
        </View>
        {isOwnProfile && !isUploading && (
          <View style={styles.cameraBadge}>
            <Icon name="camera" size={glass.profile.avatar.cameraBadge.iconSize} color={glass.profile.avatar.cameraBadge.iconColor} />
          </View>
        )}
      </TouchableOpacity>

      {/* Name — display or inline edit */}
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
              placeholder={t('profile:hero.first_name')}
              placeholderTextColor="rgba(255, 255, 255, 0.40)"
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
              placeholder={t('profile:hero.last_name')}
              placeholderTextColor="rgba(255, 255, 255, 0.40)"
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
              accessibilityLabel={t('profile:hero.cancel_editing')}
              accessibilityRole="button"
            >
              <Icon name="close" size={18} color="rgba(255, 255, 255, 0.75)" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.saveButton}
              onPress={saveName}
              disabled={isSavingName}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              accessibilityLabel={t('profile:hero.save_name')}
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
              accessibilityLabel={displayName ? `Your name, ${displayName}. Double-tap to edit.` : 'Add your name. Double-tap to edit.'}
              accessibilityRole="button"
            >
              <Text style={[styles.name, missingName && styles.namePlaceholder]}>
                {displayName || t('profile:hero.your_name_here')}
              </Text>
              <Icon name="pencil" size={14} color="rgba(255, 255, 255, 0.40)" style={styles.pencilIcon} />
            </TouchableOpacity>
          ) : (
            <Text style={styles.name}>{displayName || t('profile:hero.user_fallback')}</Text>
          )}
        </View>
      )}

      {/* Username */}
      {handleUsername && (
        <Text style={styles.username}>{handleUsername}</Text>
      )}

      {/* Location row */}
      {(location || isOwnProfile) && (
        <View style={styles.locationRow}>
          <Icon name="location-sharp" size={13} color="rgba(255, 255, 255, 0.55)" />
          {isLoadingLocation ? (
            <ActivityIndicator size="small" color="rgba(255, 255, 255, 0.55)" style={styles.locationLoader} />
          ) : locationError ? (
            <TouchableOpacity onPress={onLocationRefresh} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={styles.locationError}>{t('profile:hero.somewhere_cool')}</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.locationText}>{location || t('profile:hero.somewhere_cool')}</Text>
          )}
          {isOwnProfile && onLocationRefresh && !locationError && (
            <TouchableOpacity onPress={onLocationRefresh} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="refresh" size={13} color="rgba(255, 255, 255, 0.40)" style={styles.refreshIcon} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Bio */}
      <View>
        {missingBio && isOwnProfile ? (
          <TouchableOpacity onPress={onBioPress} hitSlop={{ top: 6, bottom: 6, left: 24, right: 24 }}>
            <Text style={styles.addBio}>{t('profile:hero.tap_to_add_bio')}</Text>
          </TouchableOpacity>
        ) : bio ? (
          <TouchableOpacity onPress={isOwnProfile ? onBioPress : undefined} disabled={!isOwnProfile}>
            <Text style={styles.bio} numberOfLines={3}>{bio}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Hint banner — only when data missing on own profile */}
      {showHint && (
        <View style={styles.hintContainer}>
          <Text style={styles.hintText}>{hintText}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  // Avatar with dual ring — outer ring matches canvas for a "cut" edge, inner is hairline white
  avatarWrap: {
    position: 'relative',
  },
  avatarOuterRing: {
    width: glass.profile.avatar.size + glass.profile.avatar.ring.outerWidth * 2,
    height: glass.profile.avatar.size + glass.profile.avatar.ring.outerWidth * 2,
    borderRadius: (glass.profile.avatar.size + glass.profile.avatar.ring.outerWidth * 2) / 2,
    backgroundColor: glass.profile.avatar.ring.outerColor,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInnerRing: {
    width: glass.profile.avatar.size,
    height: glass.profile.avatar.size,
    borderRadius: glass.profile.avatar.radius,
    borderWidth: glass.profile.avatar.ring.innerWidth,
    borderColor: glass.profile.avatar.ring.innerColor,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatar: {
    width: glass.profile.avatar.size,
    height: glass.profile.avatar.size,
    borderRadius: glass.profile.avatar.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontSize: glass.profile.avatar.initialsFontSize,
    fontWeight: glass.profile.avatar.initialsFontWeight,
    color: glass.profile.avatar.initialsColor,
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: glass.profile.avatar.cameraBadge.size,
    height: glass.profile.avatar.cameraBadge.size,
    borderRadius: glass.profile.avatar.cameraBadge.radius,
    backgroundColor: glass.profile.avatar.cameraBadge.bg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: glass.profile.avatar.cameraBadge.borderWidth,
    borderColor: glass.profile.avatar.cameraBadge.borderColor,
  },
  // Name display
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    gap: 6,
    minHeight: 36,
  },
  name: {
    ...glass.profile.text.heroName,
  },
  namePlaceholder: {
    color: 'rgba(255, 255, 255, 0.40)',
    fontStyle: 'italic',
  },
  pencilIcon: {
    marginTop: 2,
  },
  // Username
  username: {
    ...glass.profile.text.username,
    marginTop: 4,
  },
  // Name editing
  nameEditContainer: {
    alignItems: 'center',
    marginTop: 12,
    width: '100%',
    paddingHorizontal: 8,
    minHeight: 44,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
  },
  nameInput: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 16,
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    textAlign: 'center',
  },
  nameInputDisabled: {
    opacity: 0.6,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
  },
  cancelButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#eb7825',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameErrorText: {
    ...glass.profile.text.error,
    textAlign: 'center',
    marginTop: 6,
  },
  // Location
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 5,
  },
  locationText: {
    ...glass.profile.text.location,
  },
  locationError: {
    color: '#f87171',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 17,
  },
  locationLoader: {
    marginLeft: 2,
  },
  refreshIcon: {
    marginLeft: 4,
  },
  // Bio
  bio: {
    ...glass.profile.text.bio,
    textAlign: 'center',
    marginTop: 12,
    paddingHorizontal: 4,
  },
  addBio: {
    ...glass.profile.text.bioPlaceholder,
    textAlign: 'center',
    marginTop: 12,
  },
  // Hint banner (warm orange wash)
  hintContainer: {
    marginTop: 14,
    backgroundColor: 'rgba(235, 120, 37, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(235, 120, 37, 0.24)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  hintText: {
    fontSize: 12,
    color: '#fdba74',
    fontWeight: '500',
    textAlign: 'center',
  },
});

export default ProfileHeroSection;
