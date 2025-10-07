import React, { useState } from 'react';
import { Text, View, TouchableOpacity, TextInput, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Conversation, Friend } from '../../data/mockConnections';
import ConversationCard from './ConversationCard';
import MessageInterface from '../MessageInterface';

interface MessagesTabProps {
  conversations: Conversation[];
  onSelectFriend: (friend: Friend) => void;
  onStartNewConversation: () => void;
  onBackFromMessage: () => void;
  onSendMessage: (content: string, type: 'text' | 'image' | 'video' | 'file', file?: File) => void;
  activeChat: Friend | null;
  showMessageInterface: boolean;
  conversationsData: {[friendId: string]: any[]};
  accountPreferences?: any;
  boardsSessions?: any[];
  currentMode?: 'solo' | string;
  onModeChange?: (mode: 'solo' | string) => void;
  onUpdateBoardSession?: (updatedBoard: any) => void;
  onCreateSession?: (newSession: any) => void;
  onNavigateToBoard?: (board: any, discussionTab?: string) => void;
  availableFriends: Friend[];
}

export default function MessagesTab({
  conversations,
  onSelectFriend,
  onStartNewConversation,
  onBackFromMessage,
  onSendMessage,
  activeChat,
  showMessageInterface,
  conversationsData,
  accountPreferences,
  boardsSessions = [],
  currentMode = 'solo',
  onModeChange,
  onUpdateBoardSession,
  onCreateSession,
  onNavigateToBoard,
  availableFriends
}: MessagesTabProps) {
  const [messageSearchQuery, setMessageSearchQuery] = useState('');

  // Filter conversations based on message search query
  const filteredConversations = conversations.filter(conversation => {
    if (!messageSearchQuery.trim()) return true;
    
    const searchTerm = messageSearchQuery.toLowerCase();
    
    // Search by conversation name
    if (conversation.name.toLowerCase().includes(searchTerm)) {
      return true;
    }
    
    // Search by last message content
    if (conversation.lastMessage.content.toLowerCase().includes(searchTerm)) {
      return true;
    }
    
    // Search by participant names (for group chats)
    return conversation.participants.some(participant => 
      participant.name.toLowerCase().includes(searchTerm) ||
      participant.username?.toLowerCase().includes(searchTerm)
    );
  });

  if (showMessageInterface && activeChat) {
    return (
      <MessageInterface
        friend={activeChat}
        messages={conversationsData[activeChat.id] || []}
        onBack={onBackFromMessage}
        onSendMessage={onSendMessage}
        availableFriends={availableFriends}
        accountPreferences={accountPreferences}
        boardsSessions={boardsSessions}
        currentMode={currentMode}
        onModeChange={onModeChange}
        onUpdateBoardSession={onUpdateBoardSession}
        onCreateSession={onCreateSession}
        onNavigateToBoard={onNavigateToBoard}
      />
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
        
        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color="#9ca3af" style={styles.searchIcon} />
          <TextInput
            placeholder="Search conversations..."
            value={messageSearchQuery}
            onChangeText={setMessageSearchQuery}
            style={styles.searchInput}
          />
        </View>
        
        {/* Start New Conversation Button */}
        <TouchableOpacity
          onPress={onStartNewConversation}
          style={styles.newConversationButton}
        >
          <Ionicons name="add" size={20} color="white" />
          <Text style={styles.newConversationText}>Start New Conversation</Text>
        </TouchableOpacity>
      </View>

      {/* Conversations List */}
      <View style={styles.conversationsList}>
        {filteredConversations.length === 0 && messageSearchQuery.trim() ? (
          <View style={styles.emptyState}>
            <Ionicons name="search" size={48} color="#d1d5db" />
            <Text style={styles.emptyStateTitle}>No conversations found</Text>
            <Text style={styles.emptyStateSubtitle}>Try searching with different keywords</Text>
          </View>
        ) : (
          filteredConversations.map((conversation, index) => (
            <ConversationCard
              key={`conversation-${conversation.id}-${index}`}
              conversation={conversation}
              onSelectConversation={(conv) => {
                const friend = conv.participants[0];
                if (friend) onSelectFriend(friend);
              }}
            />
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    gap: 16,
  },
  header: {
    gap: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
  },
  searchContainer: {
    position: 'relative',
  },
  searchInput: {
    width: '100%',
    paddingLeft: 48,
    paddingRight: 16,
    paddingVertical: 12,
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 16,
    fontSize: 16,
  },
  searchIcon: {
    position: 'absolute',
    left: 16,
    top: '50%',
    transform: [{ translateY: -10 }],
    zIndex: 1,
  },
  newConversationButton: {
    width: '100%',
    paddingVertical: 12,
    backgroundColor: '#eb7825',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  newConversationText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
  conversationsList: {
    gap: 12,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
});
