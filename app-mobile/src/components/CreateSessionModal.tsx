import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSessionManagement } from '../hooks/useSessionManagement';
import { useNavigation } from '../contexts/NavigationContext';
import { useAppStore } from '../store/appStore';

export const CreateSessionModal: React.FC = () => {
  const [sessionName, setSessionName] = useState('');
  const [participants, setParticipants] = useState<string[]>([]);
  const [newParticipant, setNewParticipant] = useState('');
  const [loading, setLoading] = useState(false);

  const { createCollaborativeSession } = useSessionManagement();
  const { isCreateSessionModalOpen, closeCreateSessionModal } = useNavigation();
  const { user } = useAppStore();

  const handleCreateSession = async () => {
    if (!sessionName.trim()) {
      Alert.alert('Error', 'Please enter a session name');
      return;
    }

    if (participants.length === 0) {
      Alert.alert('Error', 'Please add at least one participant');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await createCollaborativeSession(
        participants,
        sessionName.trim()
      );

      if (error) {
        Alert.alert('Error', error.message);
      } else {
        Alert.alert(
          'Success',
          'Collaboration session created! Invites have been sent to participants.',
          [{ text: 'OK', onPress: closeCreateSessionModal }]
        );
        setSessionName('');
        setParticipants([]);
        setNewParticipant('');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const addParticipant = () => {
    if (!newParticipant.trim()) return;
    
    // For now, we'll use email addresses as participant identifiers
    // In a real app, you'd have a user search functionality
    if (participants.includes(newParticipant.trim())) {
      Alert.alert('Error', 'This participant is already added');
      return;
    }

    setParticipants([...participants, newParticipant.trim()]);
    setNewParticipant('');
  };

  const removeParticipant = (participant: string) => {
    setParticipants(participants.filter(p => p !== participant));
  };

  const handleClose = () => {
    setSessionName('');
    setParticipants([]);
    setNewParticipant('');
    closeCreateSessionModal();
  };

  return (
    <Modal
      visible={isCreateSessionModalOpen}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Create Session</Text>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color="#666" />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content}>
          {/* Session Name */}
          <View style={styles.section}>
            <Text style={styles.label}>Session Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter session name"
              value={sessionName}
              onChangeText={setSessionName}
              maxLength={50}
            />
          </View>

          {/* Participants */}
          <View style={styles.section}>
            <Text style={styles.label}>Participants</Text>
            <Text style={styles.description}>
              Add email addresses of people you want to invite
            </Text>
            
            <View style={styles.addParticipantContainer}>
              <TextInput
                style={styles.participantInput}
                placeholder="Enter email address"
                value={newParticipant}
                onChangeText={setNewParticipant}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={styles.addButton}
                onPress={addParticipant}
                disabled={!newParticipant.trim()}
              >
                <Ionicons name="add" size={20} color="white" />
              </TouchableOpacity>
            </View>

            {/* Participant List */}
            {participants.length > 0 && (
              <View style={styles.participantsList}>
                {participants.map((participant, index) => (
                  <View key={index} style={styles.participantItem}>
                    <Text style={styles.participantText}>{participant}</Text>
                    <TouchableOpacity
                      onPress={() => removeParticipant(participant)}
                      style={styles.removeButton}
                    >
                      <Ionicons name="close-circle" size={20} color="#FF3B30" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Session Info */}
          <View style={styles.section}>
            <Text style={styles.label}>Session Information</Text>
            <View style={styles.infoCard}>
              <View style={styles.infoItem}>
                <Ionicons name="people" size={16} color="#666" />
                <Text style={styles.infoText}>
                  {participants.length + 1} participants (including you)
                </Text>
              </View>
              <View style={styles.infoItem}>
                <Ionicons name="time" size={16} color="#666" />
                <Text style={styles.infoText}>
                  Session will be created immediately
                </Text>
              </View>
              <View style={styles.infoItem}>
                <Ionicons name="mail" size={16} color="#666" />
                <Text style={styles.infoText}>
                  Invites will be sent to all participants
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>

        {/* Create Button */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[
              styles.createButton,
              (!sessionName.trim() || participants.length === 0 || loading) && styles.createButtonDisabled
            ]}
            onPress={handleCreateSession}
            disabled={!sessionName.trim() || participants.length === 0 || loading}
          >
            <Text style={styles.createButtonText}>
              {loading ? 'Creating...' : 'Create Session'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
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
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  section: {
    marginTop: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  input: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e1e5e9',
  },
  addParticipantContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  participantInput: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e1e5e9',
  },
  addButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 50,
  },
  participantsList: {
    gap: 8,
  },
  participantItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e1e5e9',
  },
  participantText: {
    flex: 1,
    fontSize: 14,
    color: '#1a1a1a',
  },
  removeButton: {
    padding: 4,
  },
  infoCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#666',
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#e1e5e9',
    backgroundColor: 'white',
  },
  createButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  createButtonDisabled: {
    backgroundColor: '#ccc',
  },
  createButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
