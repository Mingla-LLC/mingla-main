import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEnhancedBoards } from '../hooks/useEnhancedBoards';
import { useAppStore } from '../store/appStore';
import { useMobileFeatures } from './MobileFeaturesProvider';

interface EnhancedBoardModalProps {
  visible: boolean;
  onClose: () => void;
  onBoardCreated?: (board: any) => void;
  initialData?: {
    name?: string;
    description?: string;
    collaborators?: string[];
  };
}

export const EnhancedBoardModal: React.FC<EnhancedBoardModalProps> = ({
  visible,
  onClose,
  onBoardCreated,
  initialData,
}) => {
  const [name, setName] = useState(initialData?.name || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [collaborators, setCollaborators] = useState<string[]>(initialData?.collaborators || []);
  const [newCollaborator, setNewCollaborator] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  
  const { user, currentSession } = useAppStore();
  const { createBoard } = useEnhancedBoards();
  const { getCurrentLocation } = useMobileFeatures();

  useEffect(() => {
    if (visible) {
      // Reset form when modal opens
      setName(initialData?.name || '');
      setDescription(initialData?.description || '');
      setCollaborators(initialData?.collaborators || []);
      setNewCollaborator('');
      setIsPublic(false);
    }
  }, [visible, initialData]);

  const handleAddCollaborator = () => {
    if (!newCollaborator.trim()) return;
    
    const email = newCollaborator.trim().toLowerCase();
    if (collaborators.includes(email)) {
      Alert.alert('Error', 'This collaborator is already added');
      return;
    }
    
    if (email === user?.email) {
      Alert.alert('Error', 'You cannot add yourself as a collaborator');
      return;
    }

    setCollaborators(prev => [...prev, email]);
    setNewCollaborator('');
  };

  const handleRemoveCollaborator = (email: string) => {
    setCollaborators(prev => prev.filter(c => c !== email));
  };

  const handleCreateBoard = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a board name');
      return;
    }

    setIsCreating(true);

    try {
      // Get current location for context
      const location = await getCurrentLocation();
      
      const boardData = {
        name: name.trim(),
        description: description.trim() || undefined,
        collaborators: collaborators.length > 0 ? collaborators : undefined,
        sessionId: currentSession?.id,
        isPublic,
      };

      const { data: board, error } = await createBoard(boardData);

      if (error) {
        Alert.alert('Error', error.message);
        return;
      }

      if (board) {
        Alert.alert(
          'Success',
          `Board "${board.name}" created successfully!${
            collaborators.length > 0 
              ? ` Invitations sent to ${collaborators.length} collaborator${collaborators.length > 1 ? 's' : ''}.`
              : ''
          }`,
          [
            {
              text: 'OK',
              onPress: () => {
                onBoardCreated?.(board);
                onClose();
              }
            }
          ]
        );
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to create board');
    } finally {
      setIsCreating(false);
    }
  };

  const getSessionContext = () => {
    if (currentSession) {
      return `This board will be part of the "${currentSession.name}" collaboration session.`;
    }
    return 'This will be a personal board for your own planning.';
  };

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.modal}>
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerSidePlaceholder} />
            <Text style={styles.title}>Create New Board</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={20} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {/* Session Context */}
          {currentSession && (
            <View style={styles.sessionContext}>
              <Ionicons name="people" size={16} color="#007AFF" />
              <Text style={styles.sessionContextText}>{getSessionContext()}</Text>
            </View>
          )}

          {/* Board Name */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Board Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter board name"
              value={name}
              onChangeText={setName}
              maxLength={50}
            />
          </View>

          {/* Description */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Describe what this board is for..."
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
              maxLength={200}
            />
          </View>

          {/* Public/Private Toggle */}
          <View style={styles.toggleGroup}>
            <View style={styles.toggleInfo}>
              <Text style={styles.label}>Public Board</Text>
              <Text style={styles.toggleDescription}>
                Allow others to discover and view this board
              </Text>
            </View>
            <Switch
              value={isPublic}
              onValueChange={setIsPublic}
              trackColor={{ false: '#e1e5e9', true: '#007AFF' }}
              thumbColor={isPublic ? 'white' : '#f4f3f4'}
            />
          </View>

          {/* Collaborators */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Collaborators</Text>
            <Text style={styles.collaboratorDescription}>
              Add email addresses to invite others to collaborate on this board
            </Text>
            
            <View style={styles.collaboratorInput}>
              <TextInput
                style={styles.collaboratorTextInput}
                placeholder="Enter email address"
                value={newCollaborator}
                onChangeText={setNewCollaborator}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={styles.addButton}
                onPress={handleAddCollaborator}
                disabled={!newCollaborator.trim()}
              >
                <Ionicons 
                  name="add" 
                  size={20} 
                  color={newCollaborator.trim() ? 'white' : '#ccc'} 
                />
              </TouchableOpacity>
            </View>

            {/* Collaborator List */}
            {collaborators.length > 0 && (
              <View style={styles.collaboratorList}>
                {collaborators.map((email, index) => (
                  <View key={index} style={styles.collaboratorItem}>
                    <View style={styles.collaboratorInfo}>
                      <Ionicons name="person" size={16} color="#666" />
                      <Text style={styles.collaboratorEmail}>{email}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.removeCollaboratorButton}
                      onPress={() => handleRemoveCollaborator(email)}
                    >
                      <Ionicons name="close" size={16} color="#FF3B30" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Board Preview */}
          <View style={styles.previewSection}>
            <Text style={styles.label}>Preview</Text>
            <View style={styles.boardPreview}>
              <View style={styles.previewHeader}>
                <Ionicons name="grid" size={20} color="#007AFF" />
                <Text style={styles.previewName}>{name || 'Board Name'}</Text>
              </View>
              {description && (
                <Text style={styles.previewDescription}>{description}</Text>
              )}
              <View style={styles.previewStats}>
                <View style={styles.previewStat}>
                  <Ionicons name="person" size={14} color="#666" />
                  <Text style={styles.previewStatText}>
                    {collaborators.length + 1} member{collaborators.length + 1 !== 1 ? 's' : ''}
                  </Text>
                </View>
                <View style={styles.previewStat}>
                  <Ionicons name="compass" size={14} color="#666" />
                  <Text style={styles.previewStatText}>0 experiences</Text>
                </View>
                {isPublic && (
                  <View style={styles.previewStat}>
                    <Ionicons name="globe" size={14} color="#34C759" />
                    <Text style={styles.previewStatText}>Public</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </ScrollView>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={onClose}
            disabled={isCreating}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.createButton, (!name.trim() || isCreating) && styles.createButtonDisabled]}
            onPress={handleCreateBoard}
            disabled={!name.trim() || isCreating}
          >
            {isCreating ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <>
                <Ionicons name="add" size={16} color="white" />
                <Text style={styles.createButtonText}>Create Board</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: 16,
    width: '90%',
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  content: {
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    marginBottom: 20,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
    textAlign: 'center',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSidePlaceholder: {
    width: 36,
    height: 36,
  },
  sessionContext: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f8ff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
    gap: 8,
  },
  sessionContextText: {
    fontSize: 14,
    color: '#007AFF',
    flex: 1,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e1e5e9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#f8f9fa',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  toggleGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  toggleInfo: {
    flex: 1,
    marginRight: 16,
  },
  toggleDescription: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  collaboratorDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  collaboratorInput: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  collaboratorTextInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e1e5e9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#f8f9fa',
  },
  addButton: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  collaboratorList: {
    gap: 8,
  },
  collaboratorItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
  },
  collaboratorInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  collaboratorEmail: {
    fontSize: 14,
    color: '#1a1a1a',
  },
  removeCollaboratorButton: {
    padding: 4,
  },
  previewSection: {
    marginBottom: 20,
  },
  boardPreview: {
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e1e5e9',
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  previewName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  previewDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  previewStats: {
    flexDirection: 'row',
    gap: 16,
  },
  previewStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  previewStatText: {
    fontSize: 12,
    color: '#666',
  },
  actions: {
    flexDirection: 'row',
    padding: 20,
    paddingTop: 0,
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e1e5e9',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
  },
  createButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    borderRadius: 8,
    gap: 8,
  },
  createButtonDisabled: {
    backgroundColor: '#ccc',
  },
  createButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
});
