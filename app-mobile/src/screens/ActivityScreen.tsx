import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
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
import { supabase } from '../services/supabase';
import { Experience } from '../types';

interface BoardCard {
  id: string;
  board_id: string;
  saved_experience_id: string;
  added_by: string;
  added_at: string;
  saved_experience?: any;
  votes?: any[];
  threads?: any[];
}

interface BoardVote {
  id: string;
  board_id: string;
  card_id: string;
  user_id: string;
  vote_type: 'up' | 'down' | 'neutral';
  created_at: string;
}

interface ScheduledActivity {
  id: string;
  user_id: string;
  experience_id: string;
  saved_experience_id?: string;
  board_id?: string;
  title: string;
  category: string;
  image_url?: string;
  scheduled_date: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  source: 'user_scheduled' | 'board_finalized';
  created_at: string;
}

export default function ActivityScreen() {
  const route = useRoute();
  const initialTab = (route.params as any)?.initialTab || 'boards';
  const [activeTab, setActiveTab] = useState<'boards' | 'saved'>(initialTab);
  const [savedSubTab, setSavedSubTab] = useState<'experiences' | 'scheduled'>('experiences');
  const [showCreateBoardModal, setShowCreateBoardModal] = useState(false);
  const [selectedBoard, setSelectedBoard] = useState<BoardWithDetails | null>(null);
  const [showBoardCollaboration, setShowBoardCollaboration] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savedExperiences, setSavedExperiences] = useState<Record<string, any>>({});
  const [loadingSavedExperiences, setLoadingSavedExperiences] = useState(false);
  const [scheduledActivities, setScheduledActivities] = useState<ScheduledActivity[]>([]);
  const [loadingScheduledActivities, setLoadingScheduledActivities] = useState(false);
  
  // Date picker modal state
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedExperienceId, setSelectedExperienceId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [showBoardDetails, setShowBoardDetails] = useState(false);
  const [boardCards, setBoardCards] = useState<BoardCard[]>([]);
  const [boardVotes, setBoardVotes] = useState<BoardVote[]>([]);
  
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
  const { availableSessions, pendingInvites, loadUserSessions, cancelSession } = useSessionManagement();

  const loadSavedExperiences = useCallback(async () => {
    setLoadingSavedExperiences(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setSavedExperiences({});
        return;
      }

      // Fetch from saved_experiences table only
      const { data: savedExperiences, error } = await supabase
        .from('saved_experiences')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching saved experiences:', error);
        setSavedExperiences({});
        return;
      }

      const experienceMap: Record<string, any> = {};

      // Process saved experiences
      if (savedExperiences && savedExperiences.length > 0) {
        savedExperiences.forEach(savedExp => {
          experienceMap[savedExp.id] = { // Use savedExp.id (UUID) as the key instead of card_id
            id: savedExp.id, // Use UUID instead of card_id
            title: savedExp.title,
            category: savedExp.category,
            place_id: savedExp.place_id,
            lat: savedExp.location_lat,
            lng: savedExp.location_lng,
            price_min: savedExp.estimated_cost_per_person,
            price_max: savedExp.estimated_cost_per_person,
            duration_min: savedExp.duration_minutes,
            image_url: savedExp.image_url,
            meta: {
              subtitle: savedExp.subtitle,
              address: savedExp.address,
              one_liner: savedExp.one_liner,
              tip: savedExp.tip,
              rating: savedExp.rating,
              review_count: savedExp.review_count
            },
            created_at: savedExp.created_at,
            updated_at: savedExp.created_at,
            saveType: savedExp.save_type,
            savedAt: savedExp.created_at,
            status: savedExp.status || 'saved'
          };
        });
      }
      
      setSavedExperiences(experienceMap);
    } catch (error) {
      console.error('Error loading saved experiences:', error);
    } finally {
      setLoadingSavedExperiences(false);
    }
  }, []);

  const loadScheduledActivities = useCallback(async () => {
    setLoadingScheduledActivities(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: activities, error } = await supabase
        .from('scheduled_activities')
        .select('*')
        .eq('user_id', user.id)
        .order('scheduled_date', { ascending: true });

      if (error) {
        console.error('Error fetching scheduled activities:', error);
        return;
      }

      setScheduledActivities(activities || []);
    } catch (error) {
      console.error('Error loading scheduled activities:', error);
    } finally {
      setLoadingScheduledActivities(false);
    }
  }, []);

  const loadBoardDetails = useCallback(async (boardId: string) => {
    try {
      // Load board cards
      const { data: cards, error: cardsError } = await supabase
        .from('board_cards')
        .select(`
          *,
          saved_experiences (*)
        `)
        .eq('board_id', boardId);

      if (cardsError) throw cardsError;
      setBoardCards(cards || []);

      // Load board votes
      const { data: votes, error: votesError } = await supabase
        .from('board_votes')
        .select('*')
        .eq('board_id', boardId);

      if (votesError) throw votesError;
      setBoardVotes(votes || []);
    } catch (error) {
      console.error('Error loading board details:', error);
    }
  }, []);

  const voteOnCard = async (cardId: string, boardId: string, voteType: 'up' | 'down' | 'neutral') => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('board_votes')
        .upsert({
          board_id: boardId,
          card_id: cardId,
          user_id: user.id,
          vote_type: voteType
        });

      if (error) throw error;

      // Record activity history
      await supabase
        .from('activity_history')
        .insert({
          board_id: boardId,
          card_id: cardId,
          user_id: user.id,
          action_type: voteType === 'neutral' ? 'unvote' : 'vote',
          action_data: { vote_type: voteType }
        });

      // Refresh board data
      loadBoardDetails(boardId);
    } catch (error) {
      console.error('Error voting on card:', error);
      Alert.alert('Error', 'Failed to vote on card');
    }
  };

  const finalizeCard = async (cardId: string, boardId: string) => {
    if (!user) return;

    try {
      // Get card details
      const { data: cardData, error: cardError } = await supabase
        .from('board_cards')
        .select(`
          *,
          saved_experiences (*)
        `)
        .eq('id', cardId)
        .single();

      if (cardError) throw cardError;

      // Get board details
      const { data: boardData, error: boardError } = await supabase
        .from('boards')
        .select('created_by')
        .eq('id', boardId)
        .single();

      if (boardError) throw boardError;

      // Create scheduled activity for board creator
      const { error: scheduleError } = await supabase
        .from('scheduled_activities')
        .insert({
          user_id: boardData.created_by,
          experience_id: cardData.saved_experiences.experience_id,
          saved_experience_id: cardData.saved_experience_id,
          board_id: boardId,
          title: cardData.saved_experiences.title,
          category: cardData.saved_experiences.category,
          image_url: cardData.saved_experiences.image_url,
          scheduled_date: new Date().toISOString(),
          source: 'board_finalized'
        });

      if (scheduleError) throw scheduleError;

      // Update saved experience status
      await supabase
        .from('saved_experiences')
        .update({ status: 'finalized' })
        .eq('id', cardData.saved_experience_id);

      // Record activity history
      await supabase
        .from('activity_history')
        .insert({
          board_id: boardId,
          card_id: cardId,
          user_id: user.id,
          action_type: 'finalize',
          action_data: { finalized_at: new Date().toISOString() }
        });

      Alert.alert('Success', 'Card finalized and scheduled!');
      loadBoardDetails(boardId);
      loadScheduledActivities();
    } catch (error) {
      console.error('Error finalizing card:', error);
      Alert.alert('Error', 'Failed to finalize card');
    }
  };

  const scheduleExperience = async (experienceId: string) => {
    if (!user) return;

    const experience = savedExperiences[experienceId];
    if (!experience) return;

    // Set default date and time (tomorrow at 7 PM)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(19, 0, 0, 0);
    
    setSelectedExperienceId(experienceId);
    setSelectedDate(tomorrow.toISOString().split('T')[0]); // YYYY-MM-DD format
    setSelectedTime('19:00'); // 7:00 PM
    setShowDatePicker(true);
  };

  const handleScheduleConfirm = async () => {
    if (!selectedExperienceId || !selectedDate || !selectedTime) {
      Alert.alert('Error', 'Please select both date and time.');
      return;
    }

    try {
      const experience = savedExperiences[selectedExperienceId];
      if (!experience) return;

      // Combine date and time
      const scheduledDate = new Date(`${selectedDate}T${selectedTime}:00`);
      if (isNaN(scheduledDate.getTime())) {
        Alert.alert('Error', 'Invalid date or time. Please try again.');
        return;
      }

      // Check if the date is in the past
      if (scheduledDate < new Date()) {
        Alert.alert('Error', 'Please select a future date and time.');
        return;
      }

      // Debug: Log the experience data to see what's available
      console.log('Experience data:', experience);
      console.log('place_id:', experience.place_id);
      console.log('Available fields:', Object.keys(experience));

      // Use a more robust fallback for card_id
      const cardId = experience.place_id || experience.card_id || experience.id || `exp_${Date.now()}`;

      const { error } = await supabase
        .from('scheduled_activities')
        .insert({
          user_id: user!.id,
          card_id: cardId, // Use the robust fallback
          // experience_id: experience.place_id, // Temporarily commented out until DB is fixed
          saved_experience_id: selectedExperienceId, // This is now a UUID (savedExp.id)
          title: experience.title,
          category: experience.category,
          image_url: experience.image_url,
          scheduled_date: scheduledDate.toISOString(),
          status: 'scheduled',
          source: 'user_scheduled'
        });

      if (error) throw error;

      // Update saved experience status
      await supabase
        .from('saved_experiences')
        .update({ status: 'scheduled' })
        .eq('id', selectedExperienceId);

      Alert.alert('Success', `${experience.title} scheduled for ${scheduledDate.toLocaleDateString()} at ${scheduledDate.toLocaleTimeString()}!`);
      loadSavedExperiences();
      loadScheduledActivities();
      
      // Close modal
      setShowDatePicker(false);
      setSelectedExperienceId(null);
      setSelectedDate('');
      setSelectedTime('');
    } catch (error) {
      console.error('Error scheduling experience:', error);
      Alert.alert('Error', 'Failed to schedule experience. Please try again.');
    }
  };

  const handleDeleteSession = useCallback(async (sessionId: string, sessionName: string) => {
    Alert.alert(
      'Delete Session',
      `Are you sure you want to delete "${sessionName}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelSession(sessionId);
              // Reload sessions to reflect the deletion
              await loadUserSessions();
            } catch (error) {
              console.error('Error deleting session:', error);
              Alert.alert('Error', 'Failed to delete session. Please try again.');
            }
          }
        }
      ]
    );
  }, [cancelSession, loadUserSessions]);

  const loadData = useCallback(async () => {
    try {
      await Promise.all([
        fetchBoards(),
        fetchSaves(),
        loadUserSessions(),
        loadSavedExperiences(),
        loadScheduledActivities(),
      ]);
    } catch (error) {
      console.error('Error loading activity data:', error);
    }
  }, [fetchBoards, fetchSaves, loadUserSessions, loadSavedExperiences, loadScheduledActivities]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
    setShowBoardDetails(true);
    loadBoardDetails(board.id);
  };

  const handleCloseBoardCollaboration = () => {
    setShowBoardCollaboration(false);
    setSelectedBoard(null);
    setActiveBoardForCollaboration(null);
  };

  const renderBoardsTab = () => (
    <View style={styles.tabContent}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>My Boards</Text>
        <TouchableOpacity style={styles.createBoardCard} onPress={handleCreateBoard}>
          <Ionicons name="add-circle" size={24} color="#007AFF" />
          <Text style={styles.createBoardText}>Create New Board</Text>
        </TouchableOpacity>
        
        {boards.length > 0 ? (
          boards.map((board) => (
            <TouchableOpacity 
              key={board.id} 
              style={styles.boardCard}
              onPress={() => handleBoardSelect(board as any)}
            >
              <View style={styles.boardHeader}>
                <Ionicons name="grid-outline" size={24} color="#007AFF" />
                <Text style={styles.boardTitle}>{board.name}</Text>
              </View>
              <Text style={styles.boardDescription}>
                {board.description || 'A collection of experiences'}
              </Text>
              <View style={styles.boardMeta}>
                <Text style={styles.boardMetaText}>
                  {boardCards.filter(card => card.board_id === board.id).length} cards
                </Text>
                <Text style={styles.boardMetaText}>•</Text>
                <Text style={styles.boardMetaText}>
                  Created {new Date(board.created_at).toLocaleDateString()}
                </Text>
              </View>
              {board.tags && board.tags.length > 0 && (
                <View style={styles.boardTags}>
                  {board.tags.map((tag, index) => (
                    <View key={index} style={styles.tag}>
                      <Text style={styles.tagText}>{tag}</Text>
                    </View>
                  ))}
                </View>
              )}
            </TouchableOpacity>
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
              <View style={styles.sessionContent}>
                <View style={styles.sessionHeader}>
                  <Ionicons name="people" size={20} color="#007AFF" />
                  <Text style={styles.sessionTitle}>{session.name}</Text>
                </View>
                <Text style={styles.sessionStatus}>
                  Status: {session.status}
                </Text>
              </View>
              <TouchableOpacity 
                style={styles.deleteButton}
                onPress={() => handleDeleteSession(session.id, session.name)}
              >
                <Ionicons name="trash-outline" size={18} color="#FF3B30" />
              </TouchableOpacity>
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
  );

  const renderSavedTab = () => (
    <View style={styles.tabContent}>
      {/* Sub-tab selector for Saved tab */}
      <View style={styles.subTabContainer}>
        <TouchableOpacity
          style={[styles.subTab, savedSubTab === 'experiences' && styles.activeSubTab]}
          onPress={() => setSavedSubTab('experiences')}
        >
          <Ionicons 
            name="heart-outline" 
            size={18} 
            color={savedSubTab === 'experiences' ? '#007AFF' : '#666'} 
          />
          <Text style={[
            styles.subTabText, 
            savedSubTab === 'experiences' && styles.activeSubTabText
          ]}>
            Saved Experiences
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.subTab, savedSubTab === 'scheduled' && styles.activeSubTab]}
          onPress={() => setSavedSubTab('scheduled')}
        >
          <Ionicons 
            name="calendar-outline" 
            size={18} 
            color={savedSubTab === 'scheduled' ? '#007AFF' : '#666'} 
          />
          <Text style={[
            styles.subTabText, 
            savedSubTab === 'scheduled' && styles.activeSubTabText
          ]}>
            Scheduled
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content based on selected sub-tab */}
      {savedSubTab === 'experiences' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Saved Experiences</Text>
          {loadingSavedExperiences ? (
            <View style={styles.loadingState}>
              <Text style={styles.loadingText}>Loading saved experiences...</Text>
            </View>
          ) : Object.keys(savedExperiences).length > 0 ? (
            Object.entries(savedExperiences).map(([experienceId, experience]) => (
              <View key={experienceId} style={styles.savedCard}>
                <View style={styles.savedHeader}>
                  <Ionicons name="heart" size={20} color="#FF3B30" />
                  <Text style={styles.savedTitle}>
                    {experience.title}
                  </Text>
                  <View style={styles.statusBadge}>
                    <Text style={styles.statusText}>{experience.status}</Text>
                  </View>
                </View>
                <Text style={styles.savedCategory}>
                  {experience.category} • ${experience.price_min}-${experience.price_max}
                </Text>
                {experience.meta?.one_liner && (
                  <Text style={styles.savedDescription} numberOfLines={2}>
                    {experience.meta.one_liner}
                  </Text>
                )}
                <View style={styles.savedMeta}>
                  <Text style={styles.savedMetaText}>
                    Saved {new Date(experience.savedAt).toLocaleDateString()}
                  </Text>
                  <Text style={styles.savedMetaText}>•</Text>
                  <Text style={styles.savedMetaText}>
                    Type: {experience.saveType}
                  </Text>
                </View>
                {experience.status === 'saved' && (
                  <TouchableOpacity 
                    style={styles.scheduleButton}
                    onPress={() => scheduleExperience(experienceId)}
                  >
                    <Ionicons name="calendar-outline" size={16} color="#007AFF" />
                    <Text style={styles.scheduleButtonText}>Schedule</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))
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
      ) : (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Scheduled Activities</Text>
          {loadingScheduledActivities ? (
            <View style={styles.loadingState}>
              <Text style={styles.loadingText}>Loading scheduled activities...</Text>
            </View>
          ) : scheduledActivities.length > 0 ? (
            scheduledActivities.map((activity) => (
              <View key={activity.id} style={styles.activityCard}>
                <View style={styles.activityHeader}>
                  <Ionicons name="calendar" size={20} color="#007AFF" />
                  <Text style={styles.activityTitle}>{activity.title}</Text>
                  <View style={styles.activityStatus}>
                    <Text style={styles.statusText}>{activity.status}</Text>
                  </View>
                </View>
                <Text style={styles.activityCategory}>
                  {activity.category} • {new Date(activity.scheduled_date).toLocaleDateString()}
                </Text>
                <View style={styles.activityMeta}>
                  <Text style={styles.activityMetaText}>
                    Source: {activity.source === 'board_finalized' ? 'Board' : 'Personal'}
                  </Text>
                  <Text style={styles.activityMetaText}>•</Text>
                  <Text style={styles.activityMetaText}>
                    Created {new Date(activity.created_at).toLocaleDateString()}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="calendar-outline" size={48} color="#ccc" />
              <Text style={styles.emptyStateTitle}>No scheduled activities</Text>
              <Text style={styles.emptyStateText}>
                Schedule experiences to see them here
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );

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
        {activeTab === 'boards' ? renderBoardsTab() : renderSavedTab()}
      </ScrollView>

      {/* Enhanced Board Creation Modal */}
      <EnhancedBoardModal
        visible={showCreateBoardModal}
        onClose={() => setShowCreateBoardModal(false)}
        onBoardCreated={handleCreateEnhancedBoard}
      />

      {/* Board Details Modal */}
      <Modal
        visible={showBoardDetails}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowBoardDetails(false)}>
              <Text style={styles.cancelButton}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{selectedBoard?.name}</Text>
            <TouchableOpacity>
              <Text style={styles.createButtonText}>Edit</Text>
            </TouchableOpacity>
          </View>
          
          <ScrollView style={styles.modalContent}>
            {selectedBoard && (
              <>
                <Text style={styles.boardDescription}>{selectedBoard.description}</Text>
                
                <View style={styles.cardsSection}>
                  <Text style={styles.sectionTitle}>Cards ({boardCards.length})</Text>
                  {boardCards.map((card) => (
                    <View key={card.id} style={styles.cardItem}>
                      <View style={styles.cardInfo}>
                        <Text style={styles.cardTitle}>{card.saved_experience?.title}</Text>
                        <Text style={styles.cardCategory}>{card.saved_experience?.category}</Text>
                      </View>
                      <View style={styles.cardActions}>
                        <TouchableOpacity
                          style={styles.voteButton}
                          onPress={() => voteOnCard(card.id, selectedBoard.id, 'up')}
                        >
                          <Ionicons name="thumbs-up-outline" size={16} color="#007AFF" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.voteButton}
                          onPress={() => voteOnCard(card.id, selectedBoard.id, 'down')}
                        >
                          <Ionicons name="thumbs-down-outline" size={16} color="#FF3B30" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.finalizeButton}
                          onPress={() => finalizeCard(card.id, selectedBoard.id)}
                        >
                          <Ionicons name="checkmark-circle-outline" size={16} color="#34C759" />
                          <Text style={styles.finalizeButtonText}>Finalize</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Board Collaboration Modal */}
      {selectedBoard && (
        <BoardCollaboration
          boardId={selectedBoard.id}
          onClose={handleCloseBoardCollaboration}
        />
      )}

      {/* Date Picker Modal */}
      <Modal
        visible={showDatePicker}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowDatePicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.datePickerModal}>
            <Text style={styles.datePickerTitle}>Schedule Experience</Text>
            <Text style={styles.datePickerSubtitle}>
              {selectedExperienceId && savedExperiences[selectedExperienceId]?.title}
            </Text>
            
            <View style={styles.dateTimeContainer}>
              <View style={styles.dateTimeRow}>
                <Text style={styles.dateTimeLabel}>Date:</Text>
                <TextInput
                  style={styles.dateTimeInput}
                  value={selectedDate}
                  onChangeText={setSelectedDate}
                  placeholder="YYYY-MM-DD"
                  keyboardType="numeric"
                />
              </View>
              
              <View style={styles.dateTimeRow}>
                <Text style={styles.dateTimeLabel}>Time:</Text>
                <TextInput
                  style={styles.dateTimeInput}
                  value={selectedTime}
                  onChangeText={setSelectedTime}
                  placeholder="HH:MM"
                  keyboardType="numeric"
                />
              </View>
            </View>

            <View style={styles.datePickerButtons}>
              <TouchableOpacity
                style={[styles.datePickerButton, styles.datePickerCancelButton]}
                onPress={() => {
                  setShowDatePicker(false);
                  setSelectedExperienceId(null);
                  setSelectedDate('');
                  setSelectedTime('');
                }}
              >
                <Text style={styles.datePickerCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.datePickerButton, styles.datePickerScheduleButton]}
                onPress={handleScheduleConfirm}
              >
                <Text style={styles.datePickerScheduleButtonText}>Schedule</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  subTabContainer: {
    flexDirection: 'row',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  subTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  activeSubTab: {
    backgroundColor: '#007AFF',
  },
  subTabText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
    marginLeft: 6,
  },
  activeSubTabText: {
    color: 'white',
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
  boardTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
    gap: 6,
  },
  tag: {
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  tagText: {
    fontSize: 12,
    color: '#1976D2',
    fontWeight: '500',
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sessionContent: {
    flex: 1,
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
  deleteButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#FFF5F5',
    marginLeft: 12,
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
    flex: 1,
  },
  statusBadge: {
    backgroundColor: '#E8F5E8',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    color: '#2E7D32',
    fontWeight: '500',
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
  scheduleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F8FF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  scheduleButtonText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
    marginLeft: 4,
  },
  activityCard: {
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
  activityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  activityTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginLeft: 12,
    flex: 1,
  },
  activityStatus: {
    backgroundColor: '#E8F5E8',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  activityCategory: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  activityMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  activityMetaText: {
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
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
    backgroundColor: 'white',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  cancelButton: {
    fontSize: 16,
    color: '#666',
  },
  createButtonText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '500',
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  cardsSection: {
    marginTop: 20,
  },
  cardItem: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  cardInfo: {
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  cardCategory: {
    fontSize: 14,
    color: '#666',
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  voteButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#F5F5F5',
  },
  finalizeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E8',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  finalizeButtonText: {
    fontSize: 14,
    color: '#2E7D32',
    fontWeight: '500',
    marginLeft: 4,
  },
  // Date Picker Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  datePickerModal: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 24,
    width: '90%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  datePickerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1a1a1a',
    textAlign: 'center',
    marginBottom: 8,
  },
  datePickerSubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
  },
  dateTimeContainer: {
    marginBottom: 24,
  },
  dateTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  dateTimeLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
    width: 60,
  },
  dateTimeInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#f8f9fa',
  },
  datePickerButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  datePickerButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  datePickerCancelButton: {
    backgroundColor: '#f0f0f0',
  },
  datePickerScheduleButton: {
    backgroundColor: '#007AFF',
  },
  datePickerCancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
  },
  datePickerScheduleButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
});