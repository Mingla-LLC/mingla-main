import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { Icon } from '../ui/Icon';
import { Clipboard } from 'react-native';

interface InviteCodeDisplayProps {
  inviteCode: string;
}

export const InviteCodeDisplay: React.FC<InviteCodeDisplayProps> = ({
  inviteCode,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    try {
      Clipboard.setString(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      // Use haptic feedback if available
      Alert.alert('Copied!', 'Invite code copied to clipboard');
    } catch (error) {
      console.error('Failed to copy code:', error);
      Alert.alert('Error', 'Failed to copy code. Please try again.');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Invite Code</Text>
      <Text style={styles.description}>
        Share this code with people you want to invite
      </Text>

      <View style={styles.codeContainer}>
        <Text style={styles.codeText}>{inviteCode}</Text>
      </View>

      <TouchableOpacity
        style={[styles.copyButton, copied && styles.copyButtonCopied]}
        onPress={handleCopy}
      >
        <Icon
          name={copied ? 'checkmark-circle' : 'copy-outline'}
          size={20}
          color="white"
        />
        <Text style={styles.copyButtonText}>
          {copied ? 'Copied!' : 'Copy Code'}
        </Text>
      </TouchableOpacity>

      <View style={styles.infoContainer}>
        <Icon name="information-circle-outline" size={16} color="#666" />
        <Text style={styles.infoText}>
          Recipients can enter this code in the app to join your board session
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
  },
  codeContainer: {
    backgroundColor: '#E3F2FD',
    borderRadius: 16,
    padding: 24,
    marginBottom: 20,
    borderWidth: 2,
    borderColor: '#007AFF',
    borderStyle: 'dashed',
  },
  codeText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#007AFF',
    letterSpacing: 4,
    textAlign: 'center',
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
    minWidth: 200,
  },
  copyButtonCopied: {
    backgroundColor: '#34C759',
  },
  copyButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  infoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
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

