import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareView } from '../ui/KeyboardAwareView';
import { BoardMessageService, CardMessage } from '../../services/boardMessageService';
import { realtimeService } from '../../services/realtimeService';
import { useAppStore } from '../../store/appStore';
import { Participant } from './ParticipantAvatars';

interface CardDiscussionModalProps {
  visible: boolean;
  sessionId: string;
  savedCardId: string;
  cardTitle?: string;
  participants: Participant[];
  onClose: () => void;
  onMentionUser?: (userId: string) => void;
}

export const CardDiscussionModal: React.FC<CardDiscussionModalProps> = ({
  visible,
  sessionId,
  savedCardId,
  cardTitle,
  participants,
  onClose,
  onMentionUser,
}) => {
  const { user } = useAppStore();
  const [messages, setMessages] = useState<CardMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [editingMessage, setEditingMessage] = useState<CardMessage | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load messages
  const loadMessages = useCallback(async () => {
    if (!sessionId || !savedCardId) return;

    setLoading(true);
    try {
      const { data, error } = await BoardMessageService.getCardMessages(
        sessionId,
        savedCardId,
        50,
        0
      );
      if (error) throw error;

      setMessages(data || []);

      // Mark all messages as read
      if (user?.id) {
        // Mark each message as read
        for (const message of data || []) {
          if (message.user_id !== user.id) {
            await BoardMessageService.markCardMessageAsRead(message.id, user.id);
          }
        }
      }
    } catch (err: any) {
      console.error('Error loading card messages:', err);
      Alert.alert('Error', 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [sessionId, savedCardId, user?.id]);

  // Send message
  const handleSendMessage = useCallback(async () => {
    if (!messageText.trim() || sending || !user?.id) return;

    const content = messageText.trim();
    setMessageText('');
    setSending(true);

    try {
      // Extract mentions
      const mentionRegex = /@(\w+)/g;
      const mentions: string[] = [];
      let match;
      while ((match = mentionRegex.exec(content)) !== null) {
        const username = match[1];
        const participant = participants.find(
          p => p.profiles?.username === username ||
          p.profiles?.display_name?.toLowerCase() === username.toLowerCase()
        );
        if (participant) {
          mentions.push(participant.user_id);
        }
      }

      const { data, error } = await BoardMessageService.sendCardMessage({
        sessionId,
        savedCardId,
        content,
        mentions,
        userId: user.id,
      });

      if (error) throw error;

      if (data) {
        setMessages(prev => [...prev, data]);
        setTimeout(() => {
          scrollViewRef.current?.scrollToEnd({ animated: true });
        }, 100);
      }

      // Stop typing
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      realtimeService.broadcastTypingStop(sessionId, user.id, savedCardId);
    } catch (err: any) {
      console.error('Error sending message:', err);
      Alert.alert('Error', 'Failed to send message');
      setMessageText(content);
    } finally {
      setSending(false);
    }
  }, [messageText, sending, user?.id, sessionId, savedCardId, participants]);

  // Update message
  const handleUpdateMessage = useCallback(async () => {
    if (!editingMessage || !messageText.trim() || !user?.id) return;

    try {
      const { data, error } = await BoardMessageService.updateCardMessage(
        editingMessage.id,
        messageText.trim(),
        user.id
      );

      if (error) throw error;

      if (data) {
        setMessages(prev =>
          prev.map(m => (m.id === editingMessage.id ? data : m))
        );
        setEditingMessage(null);
        setMessageText('');
      }
    } catch (err: any) {
      console.error('Error updating message:', err);
      Alert.alert('Error', 'Failed to update message');
    }
  }, [editingMessage, messageText, user?.id]);

  // Delete message
  const handleDeleteMessage = useCallback(async (messageId: string) => {
    if (!user?.id) return;

    Alert.alert(
      'Delete Message',
      'Are you sure you want to delete this message?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await BoardMessageService.deleteCardMessage(
                messageId,
                user.id
              );

              if (error) throw error;

              setMessages(prev => prev.filter(m => m.id !== messageId));
            } catch (err: any) {
              console.error('Error deleting message:', err);
              Alert.alert('Error', 'Failed to delete message');
            }
          },
        },
      ]
    );
  }, [user?.id]);

  // Handle typing
  const handleTyping = useCallback(() => {
    if (!user?.id) return;

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    realtimeService.broadcastTypingStart(sessionId, user.id, savedCardId);

    typingTimeoutRef.current = setTimeout(() => {
      realtimeService.broadcastTypingStop(sessionId, user.id, savedCardId);
    }, 3000);
  }, [user?.id, sessionId, savedCardId]);

  // Format timestamp
  const formatTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // Get participant name
  const getParticipantName = (userId: string): string => {
    const participant = participants.find(p => p.user_id === userId);
    if (participant?.profiles?.display_name) {
      return participant.profiles.display_name;
    }
    if (participant?.profiles?.first_name && participant?.profiles?.last_name) {
      return `${participant.profiles.first_name} ${participant.profiles.last_name}`;
    }
    return participant?.profiles?.username || 'Unknown';
  };

  // Render message content with mentions
  const renderMessageContent = (content: string, mentions?: string[]) => {
    if (!mentions || mentions.length === 0) {
      return <Text style={styles.messageText}>{content}</Text>;
    }

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    const mentionRegex = /@(\w+)/g;
    let match;
    let key = 0;

    while ((match = mentionRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(
          <Text key={key++} style={styles.messageText}>
            {content.substring(lastIndex, match.index)}
          </Text>
        );
      }

      const username = match[1];
      const mentionedUser = participants.find(
        p => p.profiles?.username === username ||
        p.profiles?.display_name?.toLowerCase() === username.toLowerCase()
      );

      if (mentionedUser) {
        parts.push(
          <Text
            key={key++}
            style={[styles.messageText, styles.mentionText]}
            onPress={() => onMentionUser?.(mentionedUser.user_id)}
          >
            {match[0]}
          </Text>
        );
      } else {
        parts.push(
          <Text key={key++} style={styles.messageText}>
            {match[0]}
          </Text>
        );
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      parts.push(
        <Text key={key++} style={styles.messageText}>
          {content.substring(lastIndex)}
        </Text>
      );
    }

    return <Text style={styles.messageText}>{parts}</Text>;
  };

  // Subscribe to real-time updates
  useEffect(() => {
    if (!visible || !sessionId || !savedCardId) return;

    const channel = realtimeService.subscribeToBoardSession(sessionId, {
      onCardMessage: (cardId, message) => {
        if (cardId === savedCardId) {
          setMessages(prev => {
            if (prev.find(m => m.id === message.id)) return prev;
            return [...prev, message as CardMessage];
          });

          if (message.user_id !== user?.id) {
            BoardMessageService.markCardMessageAsRead(message.id, user?.id || '');
          }

          setTimeout(() => {
            scrollViewRef.current?.scrollToEnd({ animated: true });
          }, 100);
        }
      },
      onTypingStart: (userId, cardId) => {
        if (cardId === savedCardId && userId !== user?.id) {
          setTypingUsers(prev => new Set([...prev, userId]));
        }
      },
      onTypingStop: (userId, cardId) => {
        if (cardId === savedCardId) {
          setTypingUsers(prev => {
            const newSet = new Set(prev);
            newSet.delete(userId);
            return newSet;
          });
        }
      },
    });

    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [visible, sessionId, savedCardId, user?.id]);

  // Load messages when modal opens
  useEffect(() => {
    if (visible) {
      loadMessages();
    } else {
      setMessages([]);
      setMessageText('');
      setEditingMessage(null);
    }
  }, [visible, loadMessages]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length > 0 && visible) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length, visible]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAwareView
        style={styles.container}
        dismissOnTap={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerSidePlaceholder} />
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {cardTitle || 'Card Discussion'}
            </Text>
            <Text style={styles.headerSubtitle}>
              {participants.length} {participants.length === 1 ? 'participant' : 'participants'}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={20} color="#6B7280" />
          </TouchableOpacity>
        </View>

        {/* Messages */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
          </View>
        ) : (
          <ScrollView
            ref={scrollViewRef}
            style={styles.messagesContainer}
            contentContainerStyle={styles.messagesContent}
            keyboardShouldPersistTaps="handled"
          >
            {messages.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="chatbubbles-outline" size={48} color="#ccc" />
                <Text style={styles.emptyStateText}>No messages yet</Text>
                <Text style={styles.emptyStateSubtext}>
                  Start discussing this card
                </Text>
              </View>
            ) : (
              messages.map((message, index) => {
                const isOwnMessage = message.user_id === user?.id;
                const senderName = getParticipantName(message.user_id);
                const showAvatar = index === 0 || messages[index - 1].user_id !== message.user_id;
                const showTime = index === messages.length - 1 ||
                  new Date(message.created_at).getTime() - new Date(messages[index + 1].created_at).getTime() > 300000;

                return (
                  <View
                    key={message.id}
                    style={[
                      styles.messageWrapper,
                      isOwnMessage && styles.messageWrapperOwn,
                    ]}
                  >
                    {!isOwnMessage && showAvatar && (
                      <View style={styles.avatarContainer}>
                        <View style={styles.avatar}>
                          <Text style={styles.avatarText}>
                            {senderName.substring(0, 2).toUpperCase()}
                          </Text>
                        </View>
                      </View>
                    )}
                    <View
                      style={[
                        styles.messageBubble,
                        isOwnMessage ? styles.messageBubbleOwn : styles.messageBubbleOther,
                      ]}
                    >
                      {!isOwnMessage && showAvatar && (
                        <Text style={styles.senderName}>{senderName}</Text>
                      )}
                      {renderMessageContent(message.content, message.mentions)}
                      {showTime && (
                        <Text
                          style={[
                            styles.messageTime,
                            isOwnMessage && styles.messageTimeOwn,
                          ]}
                        >
                          {formatTime(message.created_at)}
                        </Text>
                      )}
                      {isOwnMessage && (
                        <View style={styles.messageActions}>
                          <TouchableOpacity
                            onPress={() => {
                              setEditingMessage(message);
                              setMessageText(message.content);
                            }}
                            style={styles.actionButton}
                          >
                            <Ionicons name="create-outline" size={14} color="#666" />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleDeleteMessage(message.id)}
                            style={styles.actionButton}
                          >
                            <Ionicons name="trash-outline" size={14} color="#FF3B30" />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })
            )}

            {/* Typing Indicator */}
            {typingUsers.size > 0 && (
              <View style={styles.typingIndicator}>
                <Text style={styles.typingText}>
                  {Array.from(typingUsers)
                    .map(id => getParticipantName(id))
                    .join(', ')}{' '}
                  {typingUsers.size === 1 ? 'is' : 'are'} typing...
                </Text>
              </View>
            )}
          </ScrollView>
        )}

        {/* Input */}
        <View style={styles.inputContainer}>
          {editingMessage && (
            <View style={styles.editingIndicator}>
              <Text style={styles.editingText}>Editing message</Text>
              <TouchableOpacity
                onPress={() => {
                  setEditingMessage(null);
                  setMessageText('');
                }}
              >
                <Ionicons name="close" size={16} color="#666" />
              </TouchableOpacity>
            </View>
          )}
          <TextInput
            style={styles.input}
            placeholder={editingMessage ? "Edit message..." : "Type a message..."}
            placeholderTextColor="#999"
            value={messageText}
            onChangeText={(text) => {
              setMessageText(text);
              if (!editingMessage) {
                handleTyping();
              }
            }}
            multiline
            maxLength={1000}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              (!messageText.trim() || sending) && styles.sendButtonDisabled,
            ]}
            onPress={editingMessage ? handleUpdateMessage : handleSendMessage}
            disabled={!messageText.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Ionicons
                name={editingMessage ? 'checkmark' : 'send'}
                size={20}
                color="white"
              />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAwareView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e1e5e9',
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
  headerContent: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginTop: 2,
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    padding: 16,
    paddingBottom: 8,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginTop: 16,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
    textAlign: 'center',
  },
  messageWrapper: {
    flexDirection: 'row',
    marginBottom: 8,
    alignItems: 'flex-end',
  },
  messageWrapperOwn: {
    justifyContent: 'flex-end',
  },
  avatarContainer: {
    marginRight: 8,
    marginBottom: 4,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  messageBubble: {
    maxWidth: '75%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  messageBubbleOwn: {
    backgroundColor: '#007AFF',
    borderBottomRightRadius: 4,
  },
  messageBubbleOther: {
    backgroundColor: 'white',
    borderBottomLeftRadius: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  senderName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
  },
  messageText: {
    fontSize: 15,
    color: '#1a1a1a',
    lineHeight: 20,
  },
  mentionText: {
    color: '#007AFF',
    fontWeight: '600',
  },
  messageTime: {
    fontSize: 11,
    color: '#999',
    marginTop: 4,
  },
  messageTimeOwn: {
    color: 'rgba(255, 255, 255, 0.8)',
  },
  messageActions: {
    flexDirection: 'row',
    marginTop: 4,
    gap: 8,
  },
  actionButton: {
    padding: 4,
  },
  typingIndicator: {
    padding: 8,
    marginTop: 8,
  },
  typingText: {
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
  },
  inputContainer: {
    padding: 12,
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderTopColor: '#e1e5e9',
  },
  editingIndicator: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 8,
    backgroundColor: '#FFF3CD',
    borderRadius: 8,
    marginBottom: 8,
  },
  editingText: {
    fontSize: 12,
    color: '#856404',
    fontWeight: '500',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: '#f5f5f5',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: '#1a1a1a',
    marginBottom: 8,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'flex-end',
  },
  sendButtonDisabled: {
    backgroundColor: '#ccc',
    opacity: 0.5,
  },
});

