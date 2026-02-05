// Connections Page Utilities

import { Friend, Conversation, Message } from './types';
import { AUTO_REPLY_MESSAGES } from './constants';

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Get random auto-reply message
 */
export function getRandomReply(): string {
  return AUTO_REPLY_MESSAGES[Math.floor(Math.random() * AUTO_REPLY_MESSAGES.length)];
}

/**
 * Create conversations from friends list
 */
export function createConversationsFromFriends(friends: Friend[]): Conversation[] {
  if (friends.length === 0) return [];

  return [
    {
      id: '1',
      name: friends[0]?.name || 'Arifat Ola-dauda',
      type: 'direct' as const,
      participants: [friends[0]],
      lastMessage: {
        id: '1',
        senderId: '1',
        senderName: friends[0]?.name || '',
        content: 'Hey! Are you free this weekend for that museum visit?',
        timestamp: '2 min ago',
        type: 'text' as const,
        isMe: false
      },
      unreadCount: 2,
      isOnline: friends[0]?.isOnline || true
    },
    {
      id: '2',
      name: 'Weekend Squad',
      type: 'group' as const,
      participants: friends.length >= 4 
        ? [friends[1], friends[2], friends[3]] 
        : friends.slice(1),
      lastMessage: {
        id: '2',
        senderId: '2',
        senderName: friends[1]?.name || '',
        content: 'Perfect! Let\'s meet at the coffee shop first',
        timestamp: '15 min ago',
        type: 'text' as const,
        isMe: false
      },
      unreadCount: 0
    },
    {
      id: '3',
      name: friends[2]?.name || 'Marcus Chen',
      type: 'direct' as const,
      participants: [friends[2]],
      lastMessage: {
        id: '3',
        senderId: '3',
        senderName: friends[2]?.name || '',
        content: 'Thanks for the recommendation! 🎨',
        timestamp: '1 hour ago',
        type: 'text' as const,
        isMe: false
      },
      unreadCount: 0,
      isOnline: friends[2]?.isOnline || true
    }
  ].filter(conv => conv.participants.every(p => p));
}

/**
 * Filter friends by search query
 */
export function filterFriends(friends: Friend[], query: string): Friend[] {
  if (!query.trim()) return friends;
  
  const lowerQuery = query.toLowerCase();
  return friends.filter(friend =>
    friend.name.toLowerCase().includes(lowerQuery) ||
    friend.username.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Filter conversations by search query
 */
export function filterConversations(conversations: Conversation[], query: string): Conversation[] {
  if (!query.trim()) return conversations;
  
  const lowerQuery = query.toLowerCase();
  return conversations.filter(conv =>
    conv.name.toLowerCase().includes(lowerQuery) ||
    conv.lastMessage.content.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Get total unread message count
 */
export function getTotalUnreadCount(conversations: { [friendId: string]: Message[] }): number {
  return Object.values(conversations)
    .flat()
    .filter(msg => !msg.isMe && msg.unread)
    .length;
}

/**
 * Mark messages as read for a friend
 */
export function markMessagesAsRead(
  conversations: { [friendId: string]: Message[] },
  friendId: string
): { [friendId: string]: Message[] } {
  return {
    ...conversations,
    [friendId]: (conversations[friendId] || []).map(msg => ({
      ...msg,
      unread: msg.isMe ? msg.unread : false
    }))
  };
}

/**
 * Generate initials from name
 */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Get status color
 */
export function getStatusColor(status: 'online' | 'offline' | 'away'): string {
  switch (status) {
    case 'online':
      return 'bg-green-500';
    case 'away':
      return 'bg-yellow-500';
    case 'offline':
      return 'bg-gray-400';
    default:
      return 'bg-gray-400';
  }
}
