import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Icon } from '../ui/Icon';

export type InviteMethod = 'friends_list' | 'link' | 'qr_code' | 'invite_code' | null;

interface InviteMethodSelectorProps {
  selectedMethod: InviteMethod;
  onMethodSelect: (method: InviteMethod) => void;
  availableMethods?: InviteMethod[];
}

const inviteMethods: Array<{
  id: InviteMethod;
  label: string;
  description: string;
  icon: string;
}> = [
  {
    id: 'friends_list',
    label: 'Friends List',
    description: 'Invite from your friends',
    icon: 'people',
  },
  {
    id: 'link',
    label: 'Share Link',
    description: 'Copy and share a link',
    icon: 'link',
  },
  {
    id: 'qr_code',
    label: 'QR Code',
    description: 'Generate a QR code to scan',
    icon: 'qr-code',
  },
  {
    id: 'invite_code',
    label: 'Invite Code',
    description: 'Share a simple code',
    icon: 'key',
  },
];

export const InviteMethodSelector: React.FC<InviteMethodSelectorProps> = ({
  selectedMethod,
  onMethodSelect,
  availableMethods,
}) => {
  const methodsToShow = availableMethods || inviteMethods.map(m => m.id);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>How would you like to invite people?</Text>
      <Text style={styles.description}>
        Choose one or more methods to invite participants
      </Text>
      
      <View style={styles.methodsContainer}>
        {inviteMethods
          .filter(method => methodsToShow.includes(method.id))
          .map((method) => (
            <TouchableOpacity
              key={method.id}
              style={[
                styles.methodCard,
                selectedMethod === method.id && styles.methodCardSelected,
              ]}
              onPress={() => onMethodSelect(method.id)}
            >
              <View style={styles.methodIconContainer}>
                <Icon
                  name={method.icon}
                  size={24}
                  color={selectedMethod === method.id ? '#007AFF' : '#666'}
                />
              </View>
              <View style={styles.methodContent}>
                <Text
                  style={[
                    styles.methodLabel,
                    selectedMethod === method.id && styles.methodLabelSelected,
                  ]}
                >
                  {method.label}
                </Text>
                <Text style={styles.methodDescription}>
                  {method.description}
                </Text>
              </View>
              {selectedMethod === method.id && (
                <Icon name="checkmark-circle" size={24} color="#007AFF" />
              )}
            </TouchableOpacity>
          ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
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
    marginBottom: 20,
  },
  methodsContainer: {
    gap: 12,
  },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: '#e1e5e9',
  },
  methodCardSelected: {
    borderColor: '#007AFF',
    backgroundColor: '#F0F8FF',
  },
  methodIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  methodContent: {
    flex: 1,
  },
  methodLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  methodLabelSelected: {
    color: '#007AFF',
  },
  methodDescription: {
    fontSize: 14,
    color: '#666',
  },
});

