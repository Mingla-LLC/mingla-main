import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Icon } from './ui/Icon';
import { useAddExperienceToBoard, useRemoveExperienceFromBoard } from '../hooks/useBoardQueries';
import { realtimeService } from '../services/realtimeService';
import { useAppStore } from '../store/appStore';
import { ExperienceCard } from './ExperienceCard';
import { supabase } from '../services/supabase';
import { getDisplayName } from '../utils/getDisplayName';

interface BoardCollaborationProps {
  boardId: string;
  onClose?: () => void;
}

export const BoardCollaboration: React.FC<BoardCollaborationProps> = ({ 
  boardId, 
  onClose 
}) => {
  const [board, setBoard] = useState<any>(null);
  const [collaborators, setCollaborators] = useState<any[]>([]);
  const [experiences, setExperiences] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const { user } = useAppStore();
  const addExperienceMutation = useAddExperienceToBoard();
  const removeExperienceMutation = useRemoveExperienceFromBoard();

  useEffect(() => {
    loadBoardData();
    subscribeToBoard();
    
    return () => {
      realtimeService.unsubscribe(`board:${boardId}`);
    };
  }, [boardId]);

  const loadBoardData = async () => {
    try {
      setLoading(true);
      
      // Load board details
      const { data: boardData, error: boardError } = await supabase
        .from('boards')
        .select('*')
        .eq('id', boardId)
        .single();

      if (boardError) throw boardError;
      setBoard(boardData);

      // Load collaborators
      const { data: collaboratorsData, error: collaboratorsError } = await supabase
        .from('board_collaborators')
        .select(`
          *,
          profiles(display_name, email, avatar_url)
        `)
        .eq('board_id', boardId);

      if (collaboratorsError) throw collaboratorsError;
      setCollaborators(collaboratorsData || []);

      // Load board experiences
      const { data: experiencesData, error: experiencesError } = await supabase
        .from('board_experiences')
        .select(`
          *,
          experiences(*)
        `)
        .eq('board_id', boardId);

      if (experiencesError) throw experiencesError;
      setExperiences(experiencesData || []);

    } catch (error) {
      console.error('Error loading board data:', error);
      Alert.alert('Error', 'Failed to load board data');
    } finally {
      setLoading(false);
    }
  };

  const subscribeToBoard = () => {
    realtimeService.subscribeToBoard(boardId, {
      onBoardUpdated: (updatedBoard) => {
        setBoard(updatedBoard);
      },
      onCollaboratorJoined: (collaborator) => {
        setCollaborators(prev => [...prev, collaborator]);
      },
      onCollaboratorLeft: (collaborator) => {
        setCollaborators(prev => prev.filter(c => c.id !== collaborator.id));
      },
      onExperienceAdded: (experience) => {
        setExperiences(prev => [...prev, experience]);
      },
      onExperienceRemoved: (experienceId) => {
        setExperiences(prev => prev.filter(e => e.experience_id !== experienceId));
      },
    });
  };

  const handleAddExperience = async (experienceId: string) => {
    try {
      await addExperienceMutation.mutateAsync({ boardId, experienceId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to add experience to board';
      Alert.alert('Error', message);
    }
  };

  const handleRemoveExperience = async (experienceId: string) => {
    try {
      await removeExperienceMutation.mutateAsync({ boardId, experienceId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to remove experience from board';
      Alert.alert('Error', message);
    }
  };

  const handleInviteCollaborator = () => {
    Alert.prompt(
      'Invite Collaborator',
      'Enter email address:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Invite',
          onPress: async (email?: string) => {
            if (email && email.trim()) {
              try {
                // Find user by email
                const { data: invitedUser, error: userError } = await supabase
                  .from('profiles')
                  .select('id')
                  .eq('email', email.trim())
                  .single();

                if (userError || !invitedUser) {
                  Alert.alert('Error', 'User not found');
                  return;
                }

                // Add as collaborator
                const { error: collaboratorError } = await supabase
                  .from('board_collaborators')
                  .insert({
                    board_id: boardId,
                    user_id: invitedUser.id,
                    role: 'collaborator',
                  });

                if (collaboratorError) {
                  Alert.alert('Error', collaboratorError.message);
                } else {
                  Alert.alert('Success', 'Collaborator invited successfully');
                }
              } catch (error) {
                Alert.alert('Error', 'Failed to invite collaborator');
              }
            }
          },
        },
      ],
      'plain-text'
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Loading board...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Icon name="grid" size={20} color="#007AFF" />
          <Text style={styles.headerTitle}>{board?.name}</Text>
        </View>
        {onClose && (
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Icon name="close" size={24} color="#666" />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={styles.content}>
        {/* Collaborators */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Collaborators</Text>
            <TouchableOpacity 
              style={styles.inviteButton}
              onPress={handleInviteCollaborator}
            >
              <Icon name="person-add" size={16} color="#007AFF" />
              <Text style={styles.inviteButtonText}>Invite</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.collaboratorsList}>
            {collaborators.map((collaborator) => (
              <View key={collaborator.id} style={styles.collaboratorItem}>
                <View style={styles.collaboratorAvatar}>
                  <Icon name="person" size={20} color="#666" />
                </View>
                <View style={styles.collaboratorInfo}>
                  <Text style={styles.collaboratorName}>
                    {getDisplayName(collaborator.profiles, 'Unknown')}
                  </Text>
                  <Text style={styles.collaboratorRole}>
                    {collaborator.role}
                  </Text>
                </View>
                {collaborator.user_id === user?.id && (
                  <View style={styles.youBadge}>
                    <Text style={styles.youBadgeText}>You</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        </View>

        {/* Experiences */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Experiences ({experiences.length})</Text>
          
          {experiences.length === 0 ? (
            <View style={styles.emptyState}>
              <Icon name="compass-outline" size={48} color="#ccc" />
              <Text style={styles.emptyStateText}>No experiences yet</Text>
              <Text style={styles.emptyStateSubtext}>
                Add experiences to start planning together
              </Text>
            </View>
          ) : (
            experiences.map((boardExperience) => (
              <View key={boardExperience.id} style={styles.experienceItem}>
                <ExperienceCard
                  experience={boardExperience.experiences}
                  compact={true}
                  showSaveButton={false}
                />
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => handleRemoveExperience(boardExperience.experience_id)}
                >
                  <Icon name="trash-outline" size={16} color="#FF3B30" />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e1e5e9',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  closeButton: {
    padding: 4,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  section: {
    marginTop: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f8ff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  inviteButtonText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  collaboratorsList: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  collaboratorItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  collaboratorAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  collaboratorInfo: {
    flex: 1,
  },
  collaboratorName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  collaboratorRole: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  youBadge: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  youBadgeText: {
    fontSize: 12,
    color: 'white',
    fontWeight: '600',
  },
  emptyState: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  experienceItem: {
    position: 'relative',
    marginBottom: 12,
  },
  removeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
});
