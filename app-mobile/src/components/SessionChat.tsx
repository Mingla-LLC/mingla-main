import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRealtimeSession } from '../hooks/useRealtimeSession';
import { useAppStore } from '../store/appStore';

interface SessionChatProps {
  sessionId: string;
  onClose?: () => void;
}

export const SessionChat: React.FC<SessionChatProps> = ({ sessionId, onClose }) => {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const { sessionMessages, participants, sendMessage } = useRealtimeSession();
  const { user } = useAppStore();
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    if (scrollViewRef.current) {
      scrollViewRef.current.scrollToEnd({ animated: true });
    }
  }, [sessionMessages]);

  const handleSendMessage = async () => {
    if (!message.trim() || sending) return;

    setSending(true);
    try {
      const { error } = await sendMessage(message.trim());
      if (error) {
        console.error('Error sending message:', error);
      } else {
        setMessage('');
      }
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setSending(false);
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getParticipantName = (senderId: string) => {
    const participant = participants.find(p => p.user_id === senderId);
    return participant?.profiles?.display_name || participant?.profiles?.email || 'Unknown';
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="people" size={20} color="#007AFF" />
          <Text style={styles.headerTitle}>Session Chat</Text>
          <Text style={styles.participantCount}>{participants.length} participants</Text>
        </View>
        {onClose && (
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color="#666" />
          </TouchableOpacity>
        )}
      </View>

      {/* Messages */}
      <ScrollView 
        ref={scrollViewRef}
        style={styles.messagesContainer}
        contentContainerStyle={styles.messagesContent}
      >
        {sessionMessages.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="chatbubbles-outline" size={48} color="#ccc" />
            <Text style={styles.emptyStateText}>No messages yet</Text>
            <Text style={styles.emptyStateSubtext}>
              Start the conversation by sending a message
            </Text>
          </View>
        ) : (
          sessionMessages.map((msg, index) => {
            const isOwnMessage = msg.data?.senderId === user?.id;
            const senderName = msg.data?.sender || getParticipantName(msg.data?.senderId);
            
            return (
              <View
                key={index}
                style={[
                  styles.messageContainer,
                  isOwnMessage && styles.ownMessageContainer
                ]}
              >
                {!isOwnMessage && (
                  <Text style={styles.senderName}>{senderName}</Text>
                )}
                <View
                  style={[
                    styles.messageBubble,
                    isOwnMessage && styles.ownMessageBubble
                  ]}
                >
                  <Text
                    style={[
                      styles.messageText,
                      isOwnMessage && styles.ownMessageText
                    ]}
                  >
                    {msg.content}
                  </Text>
                  <Text
                    style={[
                      styles.messageTime,
                      isOwnMessage && styles.ownMessageTime
                    ]}
                  >
                    {formatTime(msg.timestamp)}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Input */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.textInput}
          placeholder="Type a message..."
          value={message}
          onChangeText={setMessage}
          multiline
          maxLength={500}
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            (!message.trim() || sending) && styles.sendButtonDisabled
          ]}
          onPress={handleSendMessage}
          disabled={!message.trim() || sending}
        >
          <Ionicons
            name="send"
            size={20}
            color={(!message.trim() || sending) ? '#ccc' : 'white'}
          />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
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
  participantCount: {
    fontSize: 12,
    color: '#666',
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  closeButton: {
    padding: 4,
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
    paddingVertical: 40,
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
  messageContainer: {
    marginBottom: 16,
  },
  ownMessageContainer: {
    alignItems: 'flex-end',
  },
  senderName: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
    marginLeft: 8,
  },
  messageBubble: {
    backgroundColor: 'white',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  ownMessageBubble: {
    backgroundColor: '#007AFF',
  },
  messageText: {
    fontSize: 16,
    color: '#1a1a1a',
    lineHeight: 20,
  },
  ownMessageText: {
    color: 'white',
  },
  messageTime: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
    textAlign: 'right',
  },
  ownMessageTime: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderTopColor: '#e1e5e9',
  },
  textInput: {
    flex: 1,
    backgroundColor: '#f8f9fa',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginRight: 12,
    maxHeight: 100,
    fontSize: 16,
    lineHeight: 20,
  },
  sendButton: {
    backgroundColor: '#007AFF',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#ccc',
  },
});
