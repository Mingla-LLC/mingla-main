import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import { useAppStore } from '../store/appStore';
import { useBoards } from '../hooks/useBoards';
import { useEnhancedBoards, BoardWithDetails } from '../hooks/useEnhancedBoards';
import { useSaves } from '../hooks/useSaves';
import { EnhancedBoardModal } from '../components/EnhancedBoardModal';
import { BoardCollaboration } from '../components/BoardCollaboration';
import { useSessionManagement } from '../hooks/useSessionManagement';
import { useNavigation } from '../contexts/NavigationContext';
import { experienceService } from '../services/experienceService';
import { Experience } from '../types';

export default function ActivityScreen() {
  const route = useRoute();
  const initialTab = (route.params as any)?.initialTab || 'boards';
  const [activeTab, setActiveTab] = useState<'boards' | 'saved'>(initialTab);
  const [showCreateBoardModal, setShowCreateBoardModal] = useState(false);
  const [selectedBoard, setSelectedBoard] = useState<BoardWithDetails | null>(null);
  const [showBoardCollaboration, setShowBoardCollaboration] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savedExperiences, setSavedExperiences] = useState<Record<string, Experience>>({});
  const [loadingSavedExperiences, setLoadingSavedExperiences] = useState(false);
  
  const { user, currentSession, isInSolo } = useAppStore();
  const { openCreateSessionModal, openCreateBoardModal } = useNavigation();
  
  const { boards, loading: boardsLoading, fetchBoards, createBoard } = useBoards();
  const { saves, fetchSaves } = useSaves();
  const { 
    boards: enhancedBoards, 
    loading: enhancedBoardsLoading, 
    createBoard: createEnhancedBoard,
    setActiveBoardForCollaboration 
  } = useEnhancedBoards();
  const { availableSessions, pendingInvites, loadUserSessions } = useSessionManagement();

  const loadSavedExperiences = useCallback(async () => {
    if (saves.length === 0) {
      setSavedExperiences({});
      return;
    }

    setLoadingSavedExperiences(true);
    try {
      const experienceIds = saves.map(save => save.experience_id);
      const experiences = await experienceService.fetchAllExperiences();
      
      // Create a map of experience_id to experience details
      const experienceMap: Record<string, Experience> = {};
      experiences.forEach(experience => {
        if (experienceIds.includes(experience.id)) {
          experienceMap[experience.id] = experience;
        }
      });
      
      setSavedExperiences(experienceMap);
    } catch (error) {
      console.error('Error loading saved experiences:', error);
    } finally {
      setLoadingSavedExperiences(false);
    }
  }, [saves]);

  const loadData = useCallback(async () => {
    try {
      await Promise.all([
        fetchBoards(),
        fetchSaves(),
        loadUserSessions(),
      ]);
    } catch (error) {
      console.error('Error loading activity data:', error);
    }
  }, [fetchBoards, fetchSaves, loadUserSessions]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load saved experiences when saves data changes
  useEffect(() => {
    loadSavedExperiences();
  }, [loadSavedExperiences]);

  // Update active tab when route parameters change
  useEffect(() => {
    const newInitialTab = (route.params as any)?.initialTab || 'boards';
    setActiveTab(newInitialTab);
  }, [route.params]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleCreateBoard = async () => {
    Alert.prompt(
      'Create New Board',
      'Enter a name for your board:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create',
          onPress: async (boardName?: string) => {
            if (boardName && boardName.trim()) {
              const { error } = await createBoard({ name: boardName.trim() });
              if (error) {
                Alert.alert('Error', error.message);
              }
            }
          },
        },
      ],
      'plain-text'
    );
  };

  const handleCreateEnhancedBoard = (boardData: BoardWithDetails) => {
    setShowCreateBoardModal(false);
    // The enhanced board creation is handled by the modal
  };

  const handleBoardSelect = (board: BoardWithDetails) => {
    setSelectedBoard(board);
    setActiveBoardForCollaboration(board);
    setShowBoardCollaboration(true);
  };

  const handleCloseBoardCollaboration = () => {
    setShowBoardCollaboration(false);
    setSelectedBoard(null);
    setActiveBoardForCollaboration(null);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView 
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Activity</Text>
          <Text style={styles.subtitle}>Manage your boards and saved experiences</Text>
        </View>

        {/* Tab Selector */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'boards' && styles.activeTab]}
            onPress={() => setActiveTab('boards')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'boards' && styles.activeTabText,
              ]}
            >
              Boards
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'saved' && styles.activeTab]}
            onPress={() => setActiveTab('saved')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'saved' && styles.activeTabText,
              ]}
            >
              Saved
            </Text>
          </TouchableOpacity>
        </View>

        {/* Content */}
        {activeTab === 'boards' ? (
          <View style={styles.tabContent}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>My Boards</Text>
              <TouchableOpacity style={styles.createBoardCard} onPress={handleCreateBoard}>
                <Ionicons name="add-circle" size={24} color="#007AFF" />
                <Text style={styles.createBoardText}>Create New Board</Text>
              </TouchableOpacity>
              
              {boards.length > 0 ? (
                boards.map((board) => (
                  <View key={board.id} style={styles.boardCard}>
                    <View style={styles.boardHeader}>
                      <Ionicons name="grid-outline" size={24} color="#007AFF" />
                      <Text style={styles.boardTitle}>{board.name}</Text>
                    </View>
                    <Text style={styles.boardDescription}>
                      {board.description || 'A collection of experiences'}
                    </Text>
                    <View style={styles.boardMeta}>
                      <Text style={styles.boardMetaText}>
                        0 experiences
                      </Text>
                      <Text style={styles.boardMetaText}>•</Text>
                      <Text style={styles.boardMetaText}>
                        Created {new Date(board.created_at).toLocaleDateString()}
                      </Text>
                    </View>
                  </View>
                ))
              ) : (
                <View style={styles.emptyState}>
                  <Ionicons name="grid-outline" size={48} color="#ccc" />
                  <Text style={styles.emptyStateTitle}>No boards yet</Text>
                  <Text style={styles.emptyStateText}>
                    Create your first board to start planning experiences with friends
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Collaborative Sessions</Text>
              {availableSessions.length > 0 ? (
                availableSessions.map((session) => (
                  <View key={session.id} style={styles.sessionCard}>
                    <View style={styles.sessionHeader}>
                      <Ionicons name="people" size={20} color="#007AFF" />
                      <Text style={styles.sessionTitle}>{session.name}</Text>
                    </View>
                    <Text style={styles.sessionStatus}>
                      Status: {session.status}
                    </Text>
                  </View>
                ))
              ) : (
                <View style={styles.emptyState}>
                  <Ionicons name="people-outline" size={48} color="#ccc" />
                  <Text style={styles.emptyStateTitle}>No active sessions</Text>
                  <Text style={styles.emptyStateText}>
                    Start a collaborative session to plan with friends
                  </Text>
                  <TouchableOpacity style={styles.emptyStateButton} onPress={openCreateSessionModal}>
                    <Text style={styles.emptyStateButtonText}>Start Session</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        ) : (
          <View style={styles.tabContent}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Saved Experiences</Text>
              {loadingSavedExperiences ? (
                <View style={styles.loadingState}>
                  <Text style={styles.loadingText}>Loading saved experiences...</Text>
                </View>
              ) : saves.length > 0 ? (
                saves.map((save, index) => {
                  const experience = savedExperiences[save.experience_id];
                  return (
                    <View key={index} style={styles.savedCard}>
                      <View style={styles.savedHeader}>
                        <Ionicons name="heart" size={20} color="#FF3B30" />
                        <Text style={styles.savedTitle}>
                          {experience ? experience.title : 'Unknown Experience'}
                        </Text>
                      </View>
                      {experience && (
                        <>
                          <Text style={styles.savedCategory}>
                            {experience.category} • ${experience.price_min}-${experience.price_max}
                          </Text>
                          {experience.description && (
                            <Text style={styles.savedDescription} numberOfLines={2}>
                              {experience.description}
                            </Text>
                          )}
                        </>
                      )}
                      <View style={styles.savedMeta}>
                        <Text style={styles.savedMetaText}>
                          Saved {new Date(save.created_at).toLocaleDateString()}
                        </Text>
                        <Text style={styles.savedMetaText}>•</Text>
                        <Text style={styles.savedMetaText}>
                          Status: {save.status}
                        </Text>
                      </View>
                    </View>
                  );
                })
              ) : (
                <View style={styles.emptyState}>
                  <Ionicons name="heart-outline" size={48} color="#ccc" />
                  <Text style={styles.emptyStateTitle}>No saved experiences</Text>
                  <Text style={styles.emptyStateText}>
                    Save experiences you like to revisit them later
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Scheduled Activities</Text>
              <View style={styles.emptyState}>
                <Ionicons name="calendar-outline" size={48} color="#ccc" />
                <Text style={styles.emptyStateTitle}>No scheduled activities</Text>
                <Text style={styles.emptyStateText}>
                  Schedule experiences to see them here
                </Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Enhanced Board Creation Modal */}
      <EnhancedBoardModal
        visible={showCreateBoardModal}
        onClose={() => setShowCreateBoardModal(false)}
        onBoardCreated={handleCreateEnhancedBoard}
      />

      {/* Board Collaboration Modal */}
      {selectedBoard && (
        <BoardCollaboration
          boardId={selectedBoard.id}
          onClose={handleCloseBoardCollaboration}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  header: {
    paddingVertical: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginTop: 4,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 4,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: '#007AFF',
  },
  tabText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#666',
  },
  activeTabText: {
    color: 'white',
  },
  tabContent: {
    flex: 1,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: '#1a1a1a',
  },
  createBoardCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  createBoardText: {
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 12,
    color: '#007AFF',
  },
  emptyState: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
  },
  boardCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  boardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  boardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginLeft: 12,
  },
  boardDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  boardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  boardMetaText: {
    fontSize: 12,
    color: '#999',
  },
  sessionCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  sessionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginLeft: 12,
  },
  sessionStatus: {
    fontSize: 14,
    color: '#666',
  },
  savedCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  savedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  savedTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginLeft: 12,
  },
  savedCategory: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  savedMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  savedMetaText: {
    fontSize: 12,
    color: '#999',
  },
  loadingState: {
    padding: 20,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
  },
  savedDescription: {
    fontSize: 13,
    color: '#555',
    marginTop: 4,
    lineHeight: 18,
  },
  emptyStateButton: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginTop: 16,
  },
  emptyStateButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
});
