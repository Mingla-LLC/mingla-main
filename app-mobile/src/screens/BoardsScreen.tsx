import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppStore } from '../store/appStore';
import { useBoards } from '../hooks/useBoards';

interface BoardsScreenProps {
  navigation?: any;
}

export default function BoardsScreen({ navigation }: BoardsScreenProps) {
  const { boards, loading, fetchBoards } = useBoards();
  const [refreshing, setRefreshing] = useState(false);

  // Use boards from useBoards hook (real backend data)
  const userBoards = boards;

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchBoards();
    setRefreshing(false);
  };

  const handleBoardPress = (board: any) => {
    Alert.alert(
      board.name,
      board.description,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'View Board', onPress: () => console.log('View board:', board.id) },
        { text: 'Edit Board', onPress: () => console.log('Edit board:', board.id) },
      ]
    );
  };

  const handleCreateBoard = () => {
    Alert.alert(
      'Create New Board',
      'What would you like to name your new board?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Create', onPress: () => console.log('Create new board') },
      ]
    );
  };

  const handleShareBoard = (boardId: string) => {
    Alert.alert(
      'Share Board',
      'Share this board with others?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Share', onPress: () => console.log('Share board:', boardId) },
      ]
    );
  };

  const handleDeleteBoard = (boardId: string, boardName: string) => {
    Alert.alert(
      'Delete Board',
      `Are you sure you want to delete "${boardName}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: () => console.log('Delete board:', boardId) 
        },
      ]
    );
  };

  const goBack = () => {
    if (navigation) {
      navigation.goBack();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={goBack}>
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Boards</Text>
        <TouchableOpacity style={styles.createButton} onPress={handleCreateBoard}>
          <Ionicons name="add" size={24} color="#FF9500" />
        </TouchableOpacity>
      </View>

      <ScrollView 
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Stats Summary */}
        <View style={styles.statsContainer}>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{userBoards.length}</Text>
            <Text style={styles.statLabel}>Total Boards</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>0</Text>
            <Text style={styles.statLabel}>Total Experiences</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>
              {userBoards.filter(board => board.is_public).length}
            </Text>
            <Text style={styles.statLabel}>Public Boards</Text>
          </View>
        </View>

        {/* Boards List */}
        <View style={styles.boardsList}>
          {userBoards.map((board) => (
            <TouchableOpacity
              key={board.id}
              style={styles.boardCard}
              onPress={() => handleBoardPress(board)}
            >
              <View style={styles.boardHeader}>
                <View style={styles.boardInfo}>
                  <View style={styles.boardTitleRow}>
                    <Text style={styles.boardTitle}>{board.name}</Text>
                    {board.is_public ? (
                      <Ionicons name="globe-outline" size={16} color="#007AFF" />
                    ) : (
                      <Ionicons name="lock-closed-outline" size={16} color="#666" />
                    )}
                  </View>
                  <Text style={styles.boardDescription}>{board.description || 'No description'}</Text>
                </View>
              </View>
              
              <View style={styles.boardStats}>
                <View style={styles.statBadge}>
                  <Ionicons name="bookmark-outline" size={14} color="#666" />
                  <Text style={styles.statBadgeText}>0 experiences</Text>
                </View>
                <View style={styles.statBadge}>
                  <Ionicons name="people-outline" size={14} color="#666" />
                  <Text style={styles.statBadgeText}>0 collaborators</Text>
                </View>
              </View>

              <View style={styles.boardFooter}>
                <Text style={styles.boardDate}>
                  Created {new Date(board.created_at).toLocaleDateString()}
                </Text>
                <Text style={styles.boardDate}>
                  Updated {new Date(board.updated_at).toLocaleDateString()}
                </Text>
              </View>

              <View style={styles.boardActions}>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => handleShareBoard(board.id)}
                >
                  <Ionicons name="share-outline" size={16} color="#007AFF" />
                  <Text style={styles.actionButtonText}>Share</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => console.log('Edit board:', board.id)}
                >
                  <Ionicons name="create-outline" size={16} color="#666" />
                  <Text style={styles.actionButtonText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, styles.deleteButton]}
                  onPress={() => handleDeleteBoard(board.id, board.name)}
                >
                  <Ionicons name="trash-outline" size={16} color="#FF3B30" />
                  <Text style={[styles.actionButtonText, styles.deleteButtonText]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Empty State */}
        {userBoards.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="grid-outline" size={64} color="#ccc" />
            <Text style={styles.emptyStateTitle}>No Boards Yet</Text>
            <Text style={styles.emptyStateText}>
              Create your first board to organize your favorite experiences
            </Text>
            <TouchableOpacity style={styles.createFirstBoardButton} onPress={handleCreateBoard}>
              <Text style={styles.createFirstBoardButtonText}>Create Your First Board</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E7',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1a1a1a',
    textAlign: 'center',
  },
  createButton: {
    padding: 8,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  statsContainer: {
    flexDirection: 'row',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FF9500',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
  },
  boardsList: {
    paddingBottom: 32,
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
    marginBottom: 12,
  },
  boardInfo: {
    flex: 1,
  },
  boardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  boardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    flex: 1,
  },
  boardDescription: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  boardStats: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  statBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  statBadgeText: {
    fontSize: 12,
    color: '#666',
  },
  boardFooter: {
    marginBottom: 12,
  },
  boardDate: {
    fontSize: 12,
    color: '#999',
  },
  boardActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
    gap: 4,
  },
  actionButtonText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  deleteButton: {
    backgroundColor: '#fff5f5',
  },
  deleteButtonText: {
    color: '#FF3B30',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 64,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
  },
  createFirstBoardButton: {
    backgroundColor: '#FF9500',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  createFirstBoardButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
