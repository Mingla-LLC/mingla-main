import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  BoardMessageService,
  BoardMessage,
} from "../../services/boardMessageService";
import { realtimeService } from "../../services/realtimeService";
import { useAppStore } from "../../store/appStore";
import { Participant } from "./ParticipantAvatars";
import { BoardErrorHandler } from "../../services/boardErrorHandler";
import { useNetworkMonitor } from "../../services/networkMonitor";
import { MentionPopover } from "./MentionPopover";

interface BoardDiscussionTabProps {
  sessionId: string;
  participants: Participant[];
  onMentionUser?: (userId: string) => void;
  onUnreadCountChange?: () => void;
}

export const BoardDiscussionTab: React.FC<BoardDiscussionTabProps> = ({
  sessionId,
  participants,
  onMentionUser,
  onUnreadCountChange,
}) => {
  const { user } = useAppStore();
  const networkState = useNetworkMonitor();
  const [messages, setMessages] = useState<BoardMessage[]>([]);
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [editingMessage, setEditingMessage] = useState<BoardMessage | null>(
    null
  );
  const [messagesPage, setMessagesPage] = useState(0);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showMentionPopover, setShowMentionPopover] = useState(false);
  const [mentionSearchText, setMentionSearchText] = useState("");
  const scrollViewRef = useRef<ScrollView>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const MESSAGES_PER_PAGE = 50;

  // Load messages with pagination
  const loadMessages = useCallback(
    async (page: number = 0, append: boolean = false) => {
      if (!sessionId) return;

      setLoading(true);
      try {
        const { data, error } = await BoardMessageService.getBoardMessages(
          sessionId,
          MESSAGES_PER_PAGE,
          page * MESSAGES_PER_PAGE
        );

        if (error) {
          const boardError = BoardErrorHandler.handleNetworkError(error);
          BoardErrorHandler.showError(boardError, () =>
            loadMessages(page, append)
          );
          return;
        }

        if (append) {
          setMessages((prev) => [...(data || []), ...prev]);
        } else {
          setMessages(data || []);
        }

        setHasMoreMessages((data || []).length === MESSAGES_PER_PAGE);
        setMessagesPage(page);

        // Mark all messages as read
        if (user?.id) {
          await BoardMessageService.markAllMessagesAsRead(sessionId, user.id);
          // Notify parent to update unread count
          onUnreadCountChange?.();
        }
      } catch (err: any) {
        console.error("Error loading messages:", err);
        const boardError = BoardErrorHandler.handleNetworkError(err);
        BoardErrorHandler.showError(boardError);
      } finally {
        setLoading(false);
      }
    },
    [sessionId, user?.id]
  );

  // Send message
  const handleSendMessage = useCallback(async () => {
    if (!messageText.trim() || sending || !user?.id) return;

    // Check network
    if (!networkState.isConnected) {
      Alert.alert(
        "No Connection",
        "Please check your internet connection and try again."
      );
      return;
    }

    const content = messageText.trim();
    setMessageText("");
    setSending(true);

    try {
      // Extract mentions from content
      const mentionRegex = /@(\w+)/g;
      const mentions: string[] = [];
      let match;
      while ((match = mentionRegex.exec(content)) !== null) {
        const username = match[1];
        const participant = participants.find(
          (p) =>
            p.profiles?.username === username ||
            p.profiles?.display_name?.toLowerCase() === username.toLowerCase()
        );
        if (participant) {
          mentions.push(participant.user_id);
        }
      }

      const { data, error } = await BoardMessageService.sendBoardMessage({
        sessionId,
        content,
        mentions,
        userId: user.id,
      });

      if (error) {
        const boardError = BoardErrorHandler.handleNetworkError(error);
        BoardErrorHandler.showError(boardError, () => {
          setMessageText(content);
          handleSendMessage();
        });
        setMessageText(content); // Restore message text
        return;
      }

      if (data) {
        setMessages((prev) => [...prev, data]);
        // Scroll to bottom
        setTimeout(() => {
          scrollViewRef.current?.scrollToEnd({ animated: true });
        }, 100);
      }

      // Stop typing indicator
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      realtimeService.broadcastTypingStop(sessionId, user.id);
    } catch (err: any) {
      console.error("Error sending message:", err);
      const boardError = BoardErrorHandler.handleNetworkError(err);
      BoardErrorHandler.showError(boardError);
      setMessageText(content); // Restore message text
    } finally {
      setSending(false);
    }
  }, [
    messageText,
    sending,
    user?.id,
    sessionId,
    participants,
    networkState.isConnected,
  ]);

  // Update message
  const handleUpdateMessage = useCallback(async () => {
    if (!editingMessage || !messageText.trim() || !user?.id) return;

    try {
      const { data, error } = await BoardMessageService.updateMessage(
        editingMessage.id,
        messageText.trim(),
        user.id
      );

      if (error) throw error;

      if (data) {
        setMessages((prev) =>
          prev.map((m) => (m.id === editingMessage.id ? data : m))
        );
        setEditingMessage(null);
        setMessageText("");
      }
    } catch (err: any) {
      console.error("Error updating message:", err);
      Alert.alert("Error", "Failed to update message");
    }
  }, [editingMessage, messageText, user?.id]);

  // Delete message
  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      if (!user?.id) return;

      Alert.alert(
        "Delete Message",
        "Are you sure you want to delete this message?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              try {
                const { error } = await BoardMessageService.deleteMessage(
                  messageId,
                  user.id
                );

                if (error) throw error;

                setMessages((prev) => prev.filter((m) => m.id !== messageId));
              } catch (err: any) {
                console.error("Error deleting message:", err);
                Alert.alert("Error", "Failed to delete message");
              }
            },
          },
        ]
      );
    },
    [user?.id]
  );

  // Handle typing
  const handleTyping = useCallback(() => {
    if (!user?.id) return;

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Broadcast typing start
    realtimeService.broadcastTypingStart(sessionId, user.id);

    // Set timeout to stop typing after 3 seconds
    typingTimeoutRef.current = setTimeout(() => {
      realtimeService.broadcastTypingStop(sessionId, user.id);
    }, 3000);
  }, [user?.id, sessionId]);

  // Format timestamp
  const formatTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  // Get participant name
  const getParticipantName = (userId: string): string => {
    const participant = participants.find((p) => p.user_id === userId);
    if (participant?.profiles?.display_name) {
      return participant.profiles.display_name;
    }
    if (participant?.profiles?.first_name && participant?.profiles?.last_name) {
      return `${participant.profiles.first_name} ${participant.profiles.last_name}`;
    }
    return participant?.profiles?.username || "Unknown";
  };

  // Render message with mentions and hashtags
  const renderMessageContent = (content: string, mentions?: string[]) => {
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let key = 0;

    // Combined regex for mentions (@username) and hashtags (#hashtag with spaces)
    const combinedRegex = /(@\w+)|(#[\w\s]+)/g;
    let match;

    while ((match = combinedRegex.exec(content)) !== null) {
      // Add text before match
      if (match.index > lastIndex) {
        parts.push(
          <Text key={key++} style={styles.messageText}>
            {content.substring(lastIndex, match.index)}
          </Text>
        );
      }

      // Check if it's a mention or hashtag
      if (match[0].startsWith("@")) {
        // Mention - always orange color
        const username = match[1];
        const mentionedUser = participants.find(
          (p) =>
            p.profiles?.username === username ||
            p.profiles?.display_name?.toLowerCase() === username.toLowerCase()
        );

        // Always apply orange color to mentions, even if user not found
        parts.push(
          <Text
            key={key++}
            style={[styles.messageText, styles.mentionText]}
            onPress={
              mentionedUser
                ? () => onMentionUser?.(mentionedUser.user_id)
                : undefined
            }
          >
            {match[0]}
          </Text>
        );
      } else if (match[0].startsWith("#")) {
        // Hashtag - blue color
        parts.push(
          <Text key={key++} style={[styles.messageText, styles.hashtagText]}>
            {match[0]}
          </Text>
        );
      }

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
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
    if (!sessionId) return;

    const channel = realtimeService.subscribeToBoardSession(sessionId, {
      onMessage: (message) => {
        setMessages((prev) => {
          // Check if message already exists
          if (prev.find((m) => m.id === message.id)) return prev;
          return [...prev, message as BoardMessage];
        });

        // Mark as read if it's not from current user
        if (message.user_id !== user?.id) {
          BoardMessageService.markMessageAsRead(message.id, user?.id || "");
        }

        // Scroll to bottom
        setTimeout(() => {
          scrollViewRef.current?.scrollToEnd({ animated: true });
        }, 100);
      },
      onTypingStart: (userId) => {
        if (userId !== user?.id) {
          setTypingUsers((prev) => new Set([...prev, userId]));
        }
      },
      onTypingStop: (userId) => {
        setTypingUsers((prev) => {
          const newSet = new Set(prev);
          newSet.delete(userId);
          return newSet;
        });
      },
    });

    return () => {
      realtimeService.unsubscribe(`board_session:${sessionId}`);
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [sessionId, user?.id]);

  // Load messages on mount
  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#eb7825" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      {/* Messages List */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.messagesContainer}
        contentContainerStyle={styles.messagesContent}
        showsVerticalScrollIndicator={true}
      >
        {messages.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="chatbubbles-outline" size={48} color="#ccc" />
            <Text style={styles.emptyStateText}>No messages yet</Text>
            <Text style={styles.emptyStateSubtext}>
              Start the conversation by sending a message
            </Text>
          </View>
        ) : (
          messages.map((message, index) => {
            const senderName = getParticipantName(message.user_id);

            return (
              <View key={message.id} style={styles.messageWrapper}>
                <View style={styles.avatarContainer}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {senderName.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                </View>
                <View style={styles.messageContent}>
                  <View style={styles.messageHeader}>
                    <Text style={styles.senderName}>{senderName}</Text>
                    <Text style={styles.messageTime}>
                      {formatTime(message.created_at)}
                    </Text>
                  </View>
                  {renderMessageContent(message.content, message.mentions)}
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
                .map((id) => getParticipantName(id))
                .join(", ")}{" "}
              {typingUsers.size === 1 ? "is" : "are"} typing...
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Input */}
      <View style={styles.inputContainer}>
        {editingMessage && (
          <View style={styles.editingIndicator}>
            <Text style={styles.editingText}>Editing message</Text>
            <TouchableOpacity
              onPress={() => {
                setEditingMessage(null);
                setMessageText("");
              }}
            >
              <Ionicons name="close" size={16} color="#666" />
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.inputWrapper}>
          <TextInput
            style={[styles.input, isInputFocused && styles.inputFocused]}
            placeholder="Type @ to mention someone or # to tag a card..."
            placeholderTextColor="#999"
            value={messageText}
            onChangeText={(text) => {
              setMessageText(text);

              // Check for "@" to show mention popover
              const lastAtIndex = text.lastIndexOf("@");
              if (lastAtIndex !== -1) {
                const afterAt = text.substring(lastAtIndex + 1);
                // Check if there's a space after @ (meaning @ is complete)
                if (afterAt.includes(" ") || afterAt.length === 0) {
                  setShowMentionPopover(false);
                  setMentionSearchText("");
                } else {
                  // Show popover and filter by text after @
                  setShowMentionPopover(true);
                  setMentionSearchText(afterAt.toLowerCase());
                }
              } else {
                setShowMentionPopover(false);
                setMentionSearchText("");
              }

              if (!editingMessage) {
                handleTyping();
              }
            }}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
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
                name={editingMessage ? "checkmark" : "send"}
                size={20}
                color="white"
              />
            )}
          </TouchableOpacity>
        </View>
        <Text style={styles.helperText}>
          Use @ to mention participants • Use # to reference cards
        </Text>

        {/* Mention Popover */}
        <MentionPopover
          participants={participants
            .filter((p) => p.user_id !== user?.id) // Exclude current user
            .filter((p) => {
              if (!showMentionPopover) return false;
              if (!mentionSearchText) return true;

              const name =
                p.profiles?.display_name ||
                (p.profiles?.first_name && p.profiles?.last_name
                  ? `${p.profiles.first_name} ${p.profiles.last_name}`
                  : p.profiles?.username || "");
              const username = p.profiles?.username || "";

              return (
                name.toLowerCase().includes(mentionSearchText) ||
                username.toLowerCase().includes(mentionSearchText)
              );
            })}
          onSelectParticipant={(participant) => {
            const lastAtIndex = messageText.lastIndexOf("@");
            if (lastAtIndex !== -1) {
              const beforeAt = messageText.substring(0, lastAtIndex);
              const username =
                participant.profiles?.username ||
                participant.profiles?.display_name
                  ?.toLowerCase()
                  .replace(/\s+/g, "") ||
                "user";
              const newText = `${beforeAt}@${username} `;
              setMessageText(newText);
            }
            setShowMentionPopover(false);
            setMentionSearchText("");
          }}
          onClose={() => {
            setShowMentionPopover(false);
            setMentionSearchText("");
          }}
          visible={showMentionPopover}
        />
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "white",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: "#666",
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    paddingTop: 16,
    paddingBottom: 8,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
    marginTop: 16,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: "#666",
    marginTop: 8,
    textAlign: "center",
  },
  messageWrapper: {
    flexDirection: "row",
    marginBottom: 16,
    paddingHorizontal: 16,
    alignItems: "flex-start",
  },
  avatarContainer: {
    marginRight: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#eb7825",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  messageContent: {
    flex: 1,
  },
  messageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  senderName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  messageText: {
    fontSize: 15,
    color: "#1a1a1a",
    lineHeight: 22,
  },
  mentionText: {
    color: "#eb7825",
    fontWeight: "600",
  },
  hashtagText: {
    color: "#007AFF",
    fontWeight: "500",
  },
  messageTime: {
    fontSize: 12,
    color: "#999",
  },
  messageActions: {
    flexDirection: "row",
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
    color: "#999",
    fontStyle: "italic",
  },
  inputContainer: {
    padding: 12,
    backgroundColor: "white",
    borderTopWidth: 1,
    borderTopColor: "#e1e5e9",
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  editingIndicator: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 8,
    backgroundColor: "#FFF3CD",
    borderRadius: 8,
    marginBottom: 8,
  },
  editingText: {
    fontSize: 12,
    color: "#856404",
    fontWeight: "500",
  },
  input: {
    flex: 1,
    height: 40,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e1e5e9",
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 15,
    color: "#1a1a1a",
  },
  inputFocused: {
    borderColor: "#eb7825",
  },
  helpButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#eb7825",
    justifyContent: "center",
    alignItems: "center",
  },
  helperText: {
    fontSize: 12,
    color: "#666",
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#eb7825",
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "flex-end",
  },
  sendButtonDisabled: {
    backgroundColor: "#ccc",
    opacity: 0.5,
  },
  loadMoreButton: {
    padding: 12,
    alignItems: "center",
    marginBottom: 8,
  },
  loadMoreText: {
    fontSize: 14,
    color: "#007AFF",
    fontWeight: "500",
  },
});
