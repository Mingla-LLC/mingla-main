import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Icon } from '../ui/Icon';
import { BoardInviteService } from '../../services/boardInviteService';
import { useAppStore } from '../../store/appStore';
import { KeyboardAwareScrollView } from '../ui/KeyboardAwareScrollView';

interface InviteAcceptScreenProps {
  inviteCode?: string;
  inviteLink?: string;
  onAccept: (sessionId: string) => void;
  onCancel: () => void;
}

export const InviteAcceptScreen: React.FC<InviteAcceptScreenProps> = ({
  inviteCode: initialInviteCode,
  inviteLink: initialInviteLink,
  onAccept,
  onCancel,
}) => {
  const [inviteCode, setInviteCode] = useState(initialInviteCode || '');
  const [loading, setLoading] = useState(false);
  const { user } = useAppStore();

  const handleJoin = async () => {
    if (!inviteCode.trim()) {
      Alert.alert('Error', 'Please enter an invite code');
      return;
    }

    if (!user) {
      Alert.alert('Error', 'You must be logged in to join a session');
      return;
    }

    setLoading(true);
    try {
      const result = await BoardInviteService.joinByInviteCode(inviteCode.trim(), user.id);

      if (result.success && result.sessionId) {
        Alert.alert('Success', 'You have joined the board session!', [
          { text: 'OK', onPress: () => onAccept(result.sessionId!) },
        ]);
      } else {
        Alert.alert('Error', result.error || 'Failed to join session');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to join session');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinByLink = async () => {
    if (!initialInviteLink) {
      Alert.alert('Error', 'No invite link provided');
      return;
    }

    if (!user) {
      Alert.alert('Error', 'You must be logged in to join a session');
      return;
    }

    setLoading(true);
    try {
      const result = await BoardInviteService.joinByInviteLink(initialInviteLink, user.id);

      if (result.success && result.sessionId) {
        Alert.alert('Success', 'You have joined the board session!', [
          { text: 'OK', onPress: () => onAccept(result.sessionId!) },
        ]);
      } else {
        Alert.alert('Error', result.error || 'Failed to join session');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to join session');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onCancel} style={styles.closeButton}>
          <Icon name="close" size={24} color="#666" />
        </TouchableOpacity>
        <Text style={styles.title}>Join Board Session</Text>
        <View style={styles.placeholder} />
      </View>

      <KeyboardAwareScrollView style={styles.content} contentContainerStyle={styles.contentInner} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {initialInviteLink ? (
          <>
            <Text style={styles.description}>
              You've been invited to join a board session!
            </Text>
            <TouchableOpacity
              style={styles.joinButton}
              onPress={handleJoinByLink}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <Icon name="checkmark-circle" size={20} color="white" />
                  <Text style={styles.joinButtonText}>Join Session</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.description}>
              Enter the invite code to join a board session
            </Text>

            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="Enter invite code"
                value={inviteCode}
                onChangeText={setInviteCode}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={20}
                editable={!loading}
              />
            </View>

            <TouchableOpacity
              style={[styles.joinButton, (!inviteCode.trim() || loading) && styles.joinButtonDisabled]}
              onPress={handleJoin}
              disabled={!inviteCode.trim() || loading}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <Icon name="checkmark-circle" size={20} color="white" />
                  <Text style={styles.joinButtonText}>Join Session</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}

        <View style={styles.infoContainer}>
          <Icon name="information-circle-outline" size={16} color="#666" />
          <Text style={styles.infoText}>
            Board sessions allow you to plan experiences together with friends in real-time
          </Text>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e1e5e9',
    backgroundColor: 'white',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  closeButton: {
    padding: 4,
  },
  placeholder: {
    width: 32,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  contentInner: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  description: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 32,
  },
  inputContainer: {
    marginBottom: 24,
  },
  input: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 2,
    borderWidth: 2,
    borderColor: '#e1e5e9',
  },
  joinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  joinButtonDisabled: {
    backgroundColor: '#ccc',
  },
  joinButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  infoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 32,
    padding: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    gap: 8,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    color: '#666',
    lineHeight: 16,
  },
});

