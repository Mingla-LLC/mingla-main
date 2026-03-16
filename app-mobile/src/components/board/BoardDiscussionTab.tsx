import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { Icon } from "../ui/Icon";
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
import { CardTagPopover } from "./CardTagPopover";
import { KeyboardAwareView } from "../ui/KeyboardAwareView";
import EmojiReactionPicker from "../discussion/EmojiReactionPicker";
import * as Haptics from "expo-haptics";

interface SavedCard {
  id: string;
  card_data?: { id?: string; title?: string; name?: string; category?: string; categoryIcon?: string; image?: string; images?: string[] };
  experience_data?: { id?: string; title?: string; name?: string; category?: string; categoryIcon?: string; image?: string; images?: string[] };
}

interface BoardDiscussionTabProps {
  sessionId: string;
  participants: Participant[];
  savedCards?: SavedCard[];
  onMentionUser?: (userId: string) => void;
  onUnreadCountChange?: () => void;
}

export const BoardDiscussionTab: React.FC<BoardDiscussionTabProps> = ({
  sessionId,
  participants,
  savedCards = [],
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
  const [showCardTagPopover, setShowCardTagPopover] = useState(false);
  const [cardTagSearchText, setCardTagSearchText] = useState("");
  const [reactionPicker, setReactionPicker] = useState<{
    visible: boolean;
    messageId: string;
    top: number;
  }>({ visible: false, messageId: "", top: 0 });
  const scrollViewRef = useRef<ScrollView>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Tracks mention label → user_id for popover-selected mentions in the current draft.
  // Using a Map so we can prune stale entries when the user deletes the @mention text.
  const pendingMentions = useRef<Map<string, string>>(new Map());
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
      // Merge popover-tracked mentions with any manually-typed @mentions in the text.
      // Popover selections are authoritative (tracked by user_id); text parsing is a fallback
      // for @[Display Name] (legacy) and @word patterns typed without the popover.
      const mentionSet = new Set<string>(pendingMentions.current.values());

      const mentionRegex = /@\[([^\]]+)\]|@(\w+)/g;
      let match;
      while ((match = mentionRegex.exec(content)) !== null) {
        const mentionName = match[1] || match[2];
        const participant = participants.find(
          (p) =>
            p.profiles?.username === mentionName ||
            p.profiles?.first_name?.toLowerCase() === mentionName.toLowerCase() ||
            p.profiles?.display_name?.toLowerCase() === mentionName.toLowerCase() ||
            (p.profiles?.first_name && p.profiles?.last_name &&
              `${p.profiles.first_name} ${p.profiles.last_name}`.toLowerCase() === mentionName.toLowerCase())
        );
        if (participant) {
          mentionSet.add(participant.user_id);
        }
      }

      const mentions = Array.from(mentionSet);
      pendingMentions.current.clear();

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
        setMessages((prev) => {
          if (prev.find((m) => m.id === data.id)) return prev;
          return [...prev, data];
        });
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

  // Get participant name — avoids exposing raw emails or auto-generated usernames
  const getParticipantName = (userId: string): string => {
    const participant = participants.find((p) => p.user_id === userId);
    if (!participant?.profiles) return "Unknown";

    const { display_name, first_name, last_name, username } = participant.profiles;

    // Helper: detect email-like strings (e.g. "john@icloud.com" or email prefix + UUID suffix "john_a1b2")
    const looksLikeEmail = (val: string | undefined | null): boolean => {
      if (!val) return false;
      if (val.includes("@")) return true;
      // Auto-generated usernames: lowercase_word(s)_xxxx (4-char hex suffix from UUID)
      if (/^[a-z0-9_.]+_[a-f0-9]{4}$/.test(val)) return true;
      return false;
    };

    // Humanize an email-derived string: strip domain/@, strip UUID suffix, capitalize
    const humanize = (val: string): string => {
      let clean = val.includes("@") ? val.split("@")[0] : val;
      // Strip trailing _xxxx UUID suffix
      clean = clean.replace(/_[a-f0-9]{4}$/, "");
      // Replace underscores/dots with spaces and capitalize each word
      return clean
        .replace(/[_.]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim() || "Unknown";
    };

    if (display_name && !looksLikeEmail(display_name)) return display_name;
    if (first_name && !looksLikeEmail(first_name)) {
      return last_name && !looksLikeEmail(last_name)
        ? `${first_name} ${last_name}`
        : first_name;
    }
    if (username && !looksLikeEmail(username)) return username;

    // All fields are email-derived — humanize the best available
    return humanize(display_name || username || "Unknown");
  };

  // Handle long-press to open emoji reaction picker
  const handleMessageLongPress = useCallback(
    (messageId: string, pageY: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setReactionPicker({ visible: true, messageId, top: pageY });
    },
    []
  );

  // Guard against double-tap race on reactions
  const reactionInFlightRef = useRef<Set<string>>(new Set());

  // Handle emoji reaction toggle
  const handleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!user?.id) return;
      const key = `${messageId}:${emoji}`;
      if (reactionInFlightRef.current.has(key)) return; // debounce
      reactionInFlightRef.current.add(key);
      setReactionPicker({ visible: false, messageId: "", top: 0 });

      // Optimistic update
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== messageId) return msg;
          const reactions = msg.reactions || [];
          const existing = reactions.find(
            (r) => r.user_id === user.id && r.emoji === emoji
          );
          if (existing) {
            return { ...msg, reactions: reactions.filter((r) => r.id !== existing.id) };
          }
          return {
            ...msg,
            reactions: [
              ...reactions,
              { id: `temp-${Date.now()}`, message_id: messageId, user_id: user.id, emoji, created_at: new Date().toISOString() },
            ],
          };
        })
      );

      try {
        const { error } = await BoardMessageService.toggleReaction(messageId, user.id, emoji);
        if (error) {
          // Rollback — reload messages
          loadMessages(0, false);
        }
      } finally {
        reactionInFlightRef.current.delete(key);
      }
    },
    [user?.id, loadMessages]
  );

  // Group reactions by emoji for display
  const groupReactions = useCallback(
    (reactions: BoardMessage["reactions"]) => {
      if (!reactions || reactions.length === 0) return [];
      const groups: Record<string, { emoji: string; count: number; userReacted: boolean }> = {};
      for (const r of reactions) {
        if (!groups[r.emoji]) {
          groups[r.emoji] = { emoji: r.emoji, count: 0, userReacted: false };
        }
        groups[r.emoji].count++;
        if (r.user_id === user?.id) groups[r.emoji].userReacted = true;
      }
      return Object.values(groups);
    },
    [user?.id]
  );

  // Render message with mentions and hashtags
  const renderMessageContent = (content: string, mentions?: string[]) => {
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let key = 0;

    // Combined regex for mentions (@[Display Name], @username) and hashtags (#hashtag with spaces)
    const combinedRegex = /(@\[[^\]]+\]|@\w+)|(#[\w\s]+)/g;
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
        // Handle both @[Display Name] and @username formats
        const mentionMatch = match[0].match(/^@\[([^\]]+)\]$/) || match[0].match(/^@(\w+)$/);
        const mentionName = mentionMatch ? mentionMatch[1] : match[0].substring(1);
        const mentionedUser = participants.find(
          (p) =>
            p.profiles?.username === mentionName ||
            p.profiles?.first_name?.toLowerCase() === mentionName.toLowerCase() ||
            p.profiles?.display_name?.toLowerCase() === mentionName.toLowerCase() ||
            (p.profiles?.first_name && p.profiles?.last_name &&
              `${p.profiles.first_name} ${p.profiles.last_name}`.toLowerCase() === mentionName.toLowerCase())
        );

        // Always apply orange color to mentions, even if user not found
        // Display as @Name without brackets (strip @[...] wrapper)
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
            @{mentionName}
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

  // Subscribe to real-time updates.
  // Uses unregisterBoardCallbacks on cleanup instead of unsubscribe — the channel
  // is shared with useBoardSession, useSessionVoting, etc. Destroying it here would
  // kill real-time for the entire session when the user switches tabs.
  useEffect(() => {
    if (!sessionId) return;

    const callbacks = {
      onMessage: (message: any) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === message.id);
          if (idx !== -1) {
            // Message already exists — merge if the incoming version is richer
            // (postgres_changes carries the full DB row; broadcast may lack profiles/reactions)
            const existing = prev[idx];
            const incomingIsRicher = !existing.profiles && message.profiles
              || !existing.reactions && message.reactions;
            if (incomingIsRicher) {
              const updated = [...prev];
              updated[idx] = { ...existing, ...message };
              return updated;
            }
            return prev;
          }
          return [...prev, message as BoardMessage];
        });

        // Mark as read if it's not from current user
        if (user?.id && message.user_id !== user.id) {
          BoardMessageService.markMessageAsRead(message.id, user.id);
        }

        // Scroll to bottom
        setTimeout(() => {
          scrollViewRef.current?.scrollToEnd({ animated: true });
        }, 100);
      },
      onTypingStart: (userId: string) => {
        if (userId !== user?.id) {
          setTypingUsers((prev) => new Set([...prev, userId]));
        }
      },
      onTypingStop: (userId: string) => {
        setTypingUsers((prev) => {
          const newSet = new Set(prev);
          newSet.delete(userId);
          return newSet;
        });
      },
    };

    realtimeService.subscribeToBoardSession(sessionId, callbacks);

    return () => {
      realtimeService.unregisterBoardCallbacks(sessionId, callbacks);
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
    <KeyboardAwareView
      style={styles.container}
      dismissOnTap={false}
    >
      {/* Messages List */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.messagesContainer}
        contentContainerStyle={styles.messagesContent}
        showsVerticalScrollIndicator={true}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {messages.length === 0 ? (
          <View style={styles.emptyState}>
            <Icon name="chatbubbles-outline" size={48} color="#ccc" />
            <Text style={styles.emptyStateText}>No messages yet</Text>
            <Text style={styles.emptyStateSubtext}>
              Start the conversation by sending a message
            </Text>
          </View>
        ) : (
          messages.map((message, index) => {
            const senderName = getParticipantName(message.user_id);
            const reactionGroups = groupReactions(message.reactions);

            return (
              <Pressable
                key={message.id}
                onLongPress={(e) =>
                  handleMessageLongPress(message.id, e.nativeEvent.pageY)
                }
                delayLongPress={400}
              >
                <View style={styles.messageWrapper}>
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
                    {reactionGroups.length > 0 && (
                      <View style={styles.reactionsRow}>
                        {reactionGroups.map((g) => (
                          <TouchableOpacity
                            key={g.emoji}
                            style={[
                              styles.reactionChip,
                              g.userReacted && styles.reactionChipActive,
                            ]}
                            onPress={() => handleReaction(message.id, g.emoji)}
                          >
                            <Text style={styles.reactionEmoji}>{g.emoji}</Text>
                            <Text
                              style={[
                                styles.reactionCount,
                                g.userReacted && styles.reactionCountActive,
                              ]}
                            >
                              {g.count}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                </View>
              </Pressable>
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

      {/* Popovers — positioned absolutely above input, outside inputContainer to avoid clipping */}
      <View style={styles.popoverAnchor} pointerEvents="box-none">
        {/* Mention Popover */}
        <MentionPopover
          participants={participants
            .filter((p) => p.user_id !== user?.id)
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
              // Use first name only — single word, no brackets, clean UX.
              // The user_id is tracked in pendingMentions so we never lose who was mentioned.
              const mentionLabel =
                participant.profiles?.first_name ||
                participant.profiles?.display_name?.split(" ")[0] ||
                participant.profiles?.username?.split("_")[0] ||
                "user";
              pendingMentions.current.set(mentionLabel, participant.user_id);
              const newText = `${beforeAt}@${mentionLabel} `;
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
          keyboardHeight={0}
        />

        {/* Card Tag Popover */}
        <CardTagPopover
          cards={savedCards.filter((card) => {
            if (!showCardTagPopover) return false;
            if (!cardTagSearchText) return true;
            const data = card.card_data || card.experience_data || {};
            const title = (data.title || data.name || '').toLowerCase();
            const category = (data.category || '').toLowerCase();
            return title.includes(cardTagSearchText) || category.includes(cardTagSearchText);
          })}
          onSelectCard={(card) => {
            const lastHashIndex = messageText.lastIndexOf("#");
            if (lastHashIndex !== -1) {
              const beforeHash = messageText.substring(0, lastHashIndex);
              const cardTitle = card.card_data?.title || card.experience_data?.title || card.card_data?.name || card.experience_data?.name || 'Card';
              const newText = `${beforeHash}#${cardTitle} `;
              setMessageText(newText);
            }
            setShowCardTagPopover(false);
            setCardTagSearchText("");
          }}
          onClose={() => {
            setShowCardTagPopover(false);
            setCardTagSearchText("");
          }}
          visible={showCardTagPopover}
          keyboardHeight={0}
        />
      </View>

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
              <Icon name="close" size={16} color="#666" />
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.inputWrapper}>
          <TextInput
            style={[styles.input, isInputFocused && styles.inputFocused]}
            placeholder="Type @ to mention, # to tag a card..."
            placeholderTextColor="#999"
            value={messageText}
            onChangeText={(text) => {
              setMessageText(text);

              // Find cursor context: check what trigger character is active
              const lastAtIndex = text.lastIndexOf("@");
              const lastHashIndex = text.lastIndexOf("#");

              const atIsActive = lastAtIndex !== -1 && !text.substring(lastAtIndex + 1).includes(" ");
              const hashIsActive = lastHashIndex !== -1 && !text.substring(lastHashIndex + 1).includes(" ");

              // @ mention detection — only if @ is the most recent trigger
              if (atIsActive && (!hashIsActive || lastAtIndex > lastHashIndex)) {
                const afterAt = text.substring(lastAtIndex + 1);
                setShowMentionPopover(true);
                setMentionSearchText(afterAt.toLowerCase());
                setShowCardTagPopover(false);
                setCardTagSearchText("");
              } else {
                setShowMentionPopover(false);
                setMentionSearchText("");
              }

              // # card tag detection — only if # is the most recent trigger
              if (hashIsActive && (!atIsActive || lastHashIndex > lastAtIndex)) {
                const afterHash = text.substring(lastHashIndex + 1);
                setShowCardTagPopover(true);
                setCardTagSearchText(afterHash.toLowerCase());
                setShowMentionPopover(false);
                setMentionSearchText("");
              } else {
                setShowCardTagPopover(false);
                setCardTagSearchText("");
              }

              // Prune stale pending mentions whose @label was deleted from the text
              for (const [label] of pendingMentions.current) {
                if (!text.includes(`@${label}`)) {
                  pendingMentions.current.delete(label);
                }
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
              <Icon
                name={editingMessage ? "checkmark" : "send"}
                size={20}
                color="white"
              />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Emoji Reaction Picker */}
      <EmojiReactionPicker
        visible={reactionPicker.visible}
        position={{ top: reactionPicker.top }}
        onSelect={(emoji) => handleReaction(reactionPicker.messageId, emoji)}
        onClose={() => setReactionPicker({ visible: false, messageId: "", top: 0 })}
        existingReactions={
          reactionPicker.visible
            ? (messages.find((m) => m.id === reactionPicker.messageId)?.reactions ?? [])
                .filter((r) => r.user_id === user?.id)
                .map((r) => r.emoji)
            : []
        }
      />
    </KeyboardAwareView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
    overflow: "hidden",
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
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  messagesContent: {
    paddingTop: Platform.OS === "android" ? 10 : 16,
    paddingBottom: Platform.OS === "android" ? 8 : 12,
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
    marginBottom: Platform.OS === "android" ? 8 : 12,
    paddingHorizontal: 16,
    alignItems: "flex-start",
  },
  avatarContainer: {
    marginRight: 12,
  },
  avatar: {
    width: Platform.OS === "android" ? 30 : 36,
    height: Platform.OS === "android" ? 30 : 36,
    borderRadius: Platform.OS === "android" ? 15 : 18,
    backgroundColor: "#eb7825",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  avatarText: {
    color: "white",
    fontSize: Platform.OS === "android" ? 13 : 15,
    fontWeight: "700",
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
    fontSize: Platform.OS === "android" ? 12 : 13,
    fontWeight: "700",
    color: "#111827",
  },
  messageText: {
    fontSize: Platform.OS === "android" ? 13 : 14,
    color: "#1F2937",
    lineHeight: Platform.OS === "android" ? 18 : 21,
    fontWeight: "400",
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
    fontSize: 11,
    color: "#9CA3AF",
    fontWeight: "400",
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
  popoverAnchor: {
    position: "relative",
  },
  inputContainer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#F0F1F3",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 8,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    marginBottom: 8,
    paddingBottom: 2,
  },
  editingIndicator: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 10,
    backgroundColor: "#FEF3C7",
    borderRadius: 10,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: "#FBBF24",
  },
  editingText: {
    fontSize: 12,
    color: "#92400E",
    fontWeight: "600",
  },
  input: {
    flex: 1,
    maxHeight: 90,
    minHeight: 40,
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 11,
    color: "#1a1a1a",
    fontWeight: "500",
  },
  inputFocused: {
    borderColor: "#eb7825",
    backgroundColor: "#ffffff",
    borderWidth: 2,
  },
  helpButton: {
    width: 40,
    height: 40,
    borderRadius: 22,
    backgroundColor: "#eb7825",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#eb7825",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
  },
  helperText: {
    fontSize: 10,
    color: "#9CA3AF",
    marginTop: 8,
    marginBottom: 12,
    paddingHorizontal: 0,
    fontWeight: "400",
    letterSpacing: 0.3,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#eb7825",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#eb7825",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
    alignSelf: "flex-end",
  },
  sendButtonDisabled: {
    backgroundColor: "#E5E7EB",
    opacity: 1,
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
  reactionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  reactionChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F3F4F6",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 4,
  },
  reactionChipActive: {
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#eb7825",
  },
  reactionEmoji: {
    fontSize: 14,
  },
  reactionCount: {
    fontSize: 12,
    color: "#6B7280",
    fontWeight: "600",
  },
  reactionCountActive: {
    color: "#eb7825",
  },
});
