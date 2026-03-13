import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Pressable,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareView } from '../ui/KeyboardAwareView';
import { useAppStore } from '../../store/appStore';
import { useAppState } from '../AppStateManager';
import { authService } from '../../services/authService';
import { mixpanelService } from '../../services/mixpanelService';

interface EditProfileSheetProps {
  visible: boolean;
  onClose: () => void;
}

const BIO_MAX_LENGTH = 160;

const EditProfileSheet: React.FC<EditProfileSheetProps> = ({
  visible,
  onClose,
}) => {
  const user = useAppStore((s) => s.user);
  const profile = useAppStore((s) => s.profile);
  const { userIdentity, handleUserIdentityUpdate } = useAppState();

  const sourceFirstName = userIdentity?.firstName || '';
  const sourceLastName = userIdentity?.lastName || '';
  const sourceUsername = userIdentity?.username || '';
  const sourceBio = profile?.bio || '';

  const [firstName, setFirstName] = useState(sourceFirstName);
  const [lastName, setLastName] = useState(sourceLastName);
  const [username, setUsername] = useState(sourceUsername);
  const [bio, setBio] = useState(sourceBio);
  const [isSaving, setIsSaving] = useState(false);

  // Reset local state only when sheet transitions from closed → open.
  // A ref tracks previous visibility so real-time source updates while
  // the sheet is already open do NOT wipe in-progress edits.
  const wasVisibleRef = useRef(visible);
  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      // Sheet just opened — snapshot current source values into local state
      setFirstName(sourceFirstName);
      setLastName(sourceLastName);
      setUsername(sourceUsername);
      setBio(sourceBio);
    }
    wasVisibleRef.current = visible;
  }, [visible, sourceFirstName, sourceLastName, sourceUsername, sourceBio]);

  const hasChanged = useMemo(() => {
    return (
      firstName !== sourceFirstName ||
      lastName !== sourceLastName ||
      username !== sourceUsername ||
      bio !== sourceBio
    );
  }, [firstName, lastName, username, bio, sourceFirstName, sourceLastName, sourceUsername, sourceBio]);

  const handleUsernameChange = (text: string) => {
    setUsername(text.toLowerCase().replace(/[^a-z0-9_]/g, ''));
  };

  const handleSave = async () => {
    if (!user?.id || !hasChanged) return;
    setIsSaving(true);

    const changedFields: string[] = [];
    const failedOperations: string[] = [];

    // Update name/username if changed
    const identityChanged =
      firstName !== sourceFirstName ||
      lastName !== sourceLastName ||
      username !== sourceUsername;

    if (identityChanged) {
      try {
        const updatedIdentity = {
          ...userIdentity,
          firstName,
          lastName,
          username,
        };
        await handleUserIdentityUpdate(updatedIdentity);

        if (firstName !== sourceFirstName) changedFields.push('first_name');
        if (lastName !== sourceLastName) changedFields.push('last_name');
        if (username !== sourceUsername) changedFields.push('username');
      } catch {
        failedOperations.push('name/username');
      }
    }

    // Update bio if changed
    if (bio !== sourceBio) {
      try {
        await authService.updateBio(user.id, bio.trim());
        changedFields.push('bio');
      } catch {
        failedOperations.push('bio');
      }
    }

    // Track each successfully changed field
    for (const field of changedFields) {
      mixpanelService.trackProfileSettingUpdated({ field });
    }

    setIsSaving(false);

    if (failedOperations.length > 0 && changedFields.length > 0) {
      // Partial success — tell the user exactly what failed
      Alert.alert(
        'Partial Save',
        `Your ${changedFields.join(', ')} updated successfully, but ${failedOperations.join(' and ')} failed to save. Please try again.`,
      );
    } else if (failedOperations.length > 0) {
      // Complete failure
      Alert.alert('Error', 'Failed to save profile changes. Please try again.');
    } else {
      // Complete success
      onClose();
    }
  };

  const bioAtLimit = bio.length >= BIO_MAX_LENGTH;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <KeyboardAwareView style={styles.keyboardView} dismissOnTap={false}>
          <Pressable style={styles.card} onPress={() => {}}>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Edit Profile</Text>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={24} color="#111827" />
              </TouchableOpacity>
            </View>

            {/* Fields */}
            <View style={styles.body}>
              {/* First Name */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>First Name</Text>
                <TextInput
                  style={styles.input}
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                  placeholder="First Name"
                  placeholderTextColor="#9ca3af"
                />
              </View>

              {/* Last Name */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Last Name</Text>
                <TextInput
                  style={styles.input}
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                  placeholder="Last Name"
                  placeholderTextColor="#9ca3af"
                />
              </View>

              {/* Username */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Username</Text>
                <View style={styles.usernameInputWrap}>
                  <Text style={styles.usernamePrefix}>@</Text>
                  <TextInput
                    style={styles.usernameInput}
                    value={username}
                    onChangeText={handleUsernameChange}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="username"
                    placeholderTextColor="#9ca3af"
                  />
                </View>
              </View>

              {/* Bio */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Bio</Text>
                <TextInput
                  style={styles.bioInput}
                  value={bio}
                  onChangeText={setBio}
                  maxLength={BIO_MAX_LENGTH}
                  multiline
                  numberOfLines={3}
                  placeholder="Tell people what you're about"
                  placeholderTextColor="#9ca3af"
                  textAlignVertical="top"
                />
                <Text style={[styles.counter, bioAtLimit && styles.counterLimit]}>
                  {bio.length}/{BIO_MAX_LENGTH}
                </Text>
              </View>
            </View>

            {/* Save */}
            <View style={styles.footer}>
              <TouchableOpacity
                style={[styles.saveButton, (!hasChanged || isSaving) && styles.saveButtonDisabled]}
                onPress={handleSave}
                disabled={!hasChanged || isSaving}
                activeOpacity={0.8}
              >
                <Text style={styles.saveText}>{isSaving ? 'Saving...' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </KeyboardAwareView>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  keyboardView: {
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  body: {
    paddingHorizontal: 24,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
  },
  usernameInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  usernamePrefix: {
    fontSize: 15,
    color: '#9ca3af',
    marginRight: 2,
  },
  usernameInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
  },
  bioInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    color: '#111827',
    height: 80,
  },
  counter: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'right',
    marginTop: 6,
  },
  counterLimit: {
    color: '#ef4444',
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 34,
  },
  saveButton: {
    backgroundColor: '#eb7825',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
});

export default EditProfileSheet;
