import React from 'react';
import { Text, View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Conversation } from '../../data/mockConnections';
import { ImageWithFallback } from '../figma/ImageWithFallback';

interface ConversationCardProps {
  conversation: Conversation;
  onSelectConversation: (conversation: Conversation) => void;
}

export default function ConversationCard({
  conversation,
  onSelectConversation
}: ConversationCardProps) {
  const handlePress = () => {
    const friend = conversation.participants[0];
    if (friend) {
      onSelectConversation(conversation);
    }
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      style={styles.conversationCard}
    >
      <View style={styles.conversationContent}>
        <View style={styles.avatarContainer}>
          {conversation.avatar ? (
            <ImageWithFallback
              source={{ uri: conversation.avatar }}
              style={styles.avatar}
            />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {conversation.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)}
              </Text>
            </View>
          )}
          {conversation.isOnline && (
            <View style={styles.onlineDot} />
          )}
        </View>
        
        <View style={styles.conversationInfo}>
          <View style={styles.conversationHeader}>
            <View style={styles.conversationDetails}>
              <Text style={styles.conversationName}>{conversation.name}</Text>
              <Text style={styles.lastMessage} numberOfLines={1}>
                {conversation.lastMessage.content.length > 60 
                  ? conversation.lastMessage.content.substring(0, 60) + '...' 
                  : conversation.lastMessage.content
                }
              </Text>
            </View>
            <View style={styles.conversationMeta}>
              <Text style={styles.timestamp}>{conversation.lastMessage.timestamp}</Text>
              {conversation.unreadCount > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadCount}>{conversation.unreadCount}</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  conversationCard: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  conversationContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatar: {
    width: 48,
    height: 48,
    backgroundColor: '#7c3aed',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  onlineDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    backgroundColor: '#10b981',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'white',
  },
  conversationInfo: {
    flex: 1,
    minWidth: 0,
  },
  conversationHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  conversationDetails: {
    flex: 1,
    minWidth: 0,
  },
  conversationName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  lastMessage: {
    fontSize: 14,
    color: '#6b7280',
    maxWidth: 200,
  },
  conversationMeta: {
    alignItems: 'flex-end',
    gap: 4,
  },
  timestamp: {
    fontSize: 12,
    color: '#9ca3af',
  },
  unreadBadge: {
    width: 20,
    height: 20,
    backgroundColor: '#eb7825',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadCount: {
    fontSize: 12,
    color: 'white',
    fontWeight: '600',
  },
});
