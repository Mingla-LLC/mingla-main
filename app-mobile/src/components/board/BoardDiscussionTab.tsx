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
  Clipboard,
} from "react-native";
import { Icon } from "../ui/Icon";
import { useTranslation } from "react-i18next";
import { getDisplayName } from "../../utils/getDisplayName";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MessageContextMenu } from "../chat/MessageContextMenu";
import { ReplyPreviewBar } from "../chat/ReplyPreviewBar";
import { MentionChip } from "../chat/MentionChip";
import { ReplyQuoteBlock } from "../chat/ReplyQuoteBlock";
import { CardPreview } from "../chat/CardPreview";
import { SwipeableMessage } from "../chat/SwipeableMessage";
import { DoubleTapHeart } from "../chat/DoubleTapHeart";
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
  onCardPress?: (card: SavedCard) => void;
}

export const BoardDiscussionTab: React.FC<BoardDiscussionTabProps> = ({
  sessionId,
  participants,
  savedCards = [],
  onMentionUser,
  onUnreadCountChange,
  onCardPress,
}) => {
  const { user } = useAppStore();
  const { t } = useTranslation(['board', 'common']);
  const networkState = useNetworkMonitor();
  const insets = useSafeAreaInsets();
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
  const [attachedCards, setAttachedCards] = useState<SavedCard[]>([]);
  const [reactionPicker, setReactionPicker] = useState<{
    visible: boolean;
    messageId: string;
    top: number;
  }>({ visible: false, messageId: "", top: 0 });
  const [replyingTo, setReplyingTo] = useState<BoardMessage | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
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

    // Build content: prepend #CardTitle for each attached card so they render as CardPreview in the thread
    const cardTags = attachedCards.map((c) => {
      const data = c.card_data || c.experience_data || {};
      return `#${data.title || data.name || 'Card'}`;
    });
    const rawText = messageText.trim();
    const content = cardTags.length > 0
      ? `${cardTags.join(' ')} ${rawText}`.trim()
      : rawText;

    setMessageText("");
    setAttachedCards([]);
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

      const replyToId = replyingTo?.id;
      const replyToSnapshot = replyingTo ? {
        id: replyingTo.id,
        content: replyingTo.content,
        user_id: replyingTo.user_id,
        image_url: (replyingTo as any).image_url ?? null,
        deleted_at: null,
        profiles: replyingTo.profiles ?? null,
      } : null;
      setReplyingTo(null);

      const { data, error } = await BoardMessageService.sendBoardMessage({
        sessionId,
        content,
        mentions,
        replyToId,
        userId: user.id,
      });

      if (error) {
        const boardError = BoardErrorHandler.handleNetworkError(error);
        BoardErrorHandler.showError(boardError, () => {
          setMessageText(content);
          handleSendMessage();
        });
        setMessageText(content);
        return;
      }

      if (data) {
        // Attach reply_to snapshot so ReplyQuoteBlock renders immediately
        const dataWithReply = replyToSnapshot
          ? { ...data, reply_to: replyToSnapshot as any }
          : data;
        setMessages((prev) => {
          if (prev.find((m) => m.id === data.id)) return prev;
          return [...prev, dataWithReply as BoardMessage];
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
    replyingTo,
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
      Alert.alert(t('board:boardDiscussionTab.error'), t('board:boardDiscussionTab.errorUpdateMsg'));
    }
  }, [editingMessage, messageText, user?.id]);

  // Delete message
  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      if (!user?.id) return;

      Alert.alert(
        t('board:boardDiscussionTab.deleteMessage'),
        t('board:boardDiscussionTab.deleteMessageConfirm'),
        [
          { text: t('board:boardDiscussionTab.cancel'), style: "cancel" },
          {
            text: t('board:boardDiscussionTab.delete'),
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
                Alert.alert(t('board:boardDiscussionTab.error'), t('board:boardDiscussionTab.errorDeleteMsg'));
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
    return humanize(getDisplayName(participant.profiles, "Unknown"));
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

  // Render message with card previews on top and text below
  const renderMessageContent = (content: string, mentions?: string[]) => {
    const cardPreviews: React.ReactNode[] = [];
    let remainingText = content;
    let key = 0;

    // Build exact-match patterns from saved card titles (longest first to avoid partial matches)
    const cardTitles = savedCards
      .map((c) => {
        const data = c.card_data || c.experience_data || {};
        return { card: c, title: data.title || data.name || '' };
      })
      .filter((c) => c.title)
      .sort((a, b) => b.title.length - a.title.length);

    // Extract card tags from content: match #ExactTitle against known cards
    for (const { card, title } of cardTitles) {
      const tag = `#${title}`;
      const idx = remainingText.indexOf(tag);
      if (idx === -1) continue;

      // Found a card tag — extract it and add a preview
      remainingText = (remainingText.substring(0, idx) + remainingText.substring(idx + tag.length)).trim();
      const data = card.card_data || card.experience_data || {};
      const images = data.images || (data.image ? [data.image] : []);
      cardPreviews.push(
        <CardPreview
          key={`card-${key++}`}
          title={title}
          category={data.category}
          categoryIcon={data.categoryIcon}
          imageUrl={images[0]}
          onPress={() => onCardPress?.(card)}
        />
      );
    }

    // Render remaining text (may contain @mentions)
    const textContent = remainingText.trim();

    if (cardPreviews.length > 0) {
      return (
        <View>
          {cardPreviews}
          {textContent ? <Text style={styles.messageText}>{textContent}</Text> : null}
        </View>
      );
    }

    return <Text style={styles.messageText}>{content}</Text>;
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
      bottomOffset={Platform.OS === 'ios' ? insets.bottom : 0}
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
            const senderName = getParticipantName(message.user_id ?? '');
            const reactionGroups = groupReactions(message.reactions);

            return (
              <SwipeableMessage
                key={message.id}
                onReply={() => setReplyingTo(message)}
              >
                <DoubleTapHeart
                  onDoubleTap={() => handleReaction(message.id, '❤️')}
                >
                  <Pressable
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
                    {(message as any).reply_to && (
                      <ReplyQuoteBlock
                        senderName={
                          (message as any).reply_to.profiles
                            ? getDisplayName((message as any).reply_to.profiles, '')
                            : getParticipantName((message as any).reply_to.user_id ?? '')
                        }
                        previewText={(message as any).reply_to.content || ''}
                        variant="received"
                        isDeleted={!!(message as any).reply_to.deleted_at}
                      />
                    )}
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
                </DoubleTapHeart>
              </SwipeableMessage>
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

      {/* Popovers — positioned absolutely above input */}
      <View style={styles.popoverAnchor} pointerEvents="box-none">
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
            // Add card to attached previews above input (not inline text)
            setAttachedCards((prev) => {
              if (prev.find((c) => c.id === card.id)) return prev;
              return [...prev, card];
            });
            // Remove the # trigger from the text
            const lastHashIndex = messageText.lastIndexOf("#");
            if (lastHashIndex !== -1) {
              const beforeHash = messageText.substring(0, lastHashIndex);
              setMessageText(beforeHash.trimEnd());
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
        {replyingTo && !editingMessage && (
          <ReplyPreviewBar
            senderName={getParticipantName(replyingTo.user_id ?? '')}
            previewText={replyingTo.content || ''}
            isOwnMessage={replyingTo.user_id === user?.id}
            onClose={() => setReplyingTo(null)}
          />
        )}
        {/* Attached card previews — shown above input */}
        {attachedCards.length > 0 && (
          <View style={styles.attachedCardsRow}>
            {attachedCards.map((card) => {
              const data = card.card_data || card.experience_data || {};
              const images = data.images || (data.image ? [data.image] : []);
              return (
                <View key={card.id} style={styles.attachedCardWrapper}>
                  <CardPreview
                    title={data.title || data.name || 'Card'}
                    category={data.category}
                    categoryIcon={data.categoryIcon}
                    imageUrl={images[0]}
                    onPress={() => onCardPress?.(card)}
                  />
                  <TouchableOpacity
                    style={styles.attachedCardRemove}
                    onPress={() => setAttachedCards((prev) => prev.filter((c) => c.id !== card.id))}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Icon name="close" size={12} color="#fff" />
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}
        <View style={styles.inputWrapper}>
          <TextInput
            ref={inputRef}
            style={[styles.input, isInputFocused && styles.inputFocused]}
            placeholder={t('board:boardDiscussionTab.inputPlaceholder')}
            placeholderTextColor="#999"
            value={messageText}
            onChangeText={(text) => {
              setMessageText(text);

              // # card tag detection
              const lastHashIndex = text.lastIndexOf("#");
              const hashIsActive = lastHashIndex !== -1 && !text.substring(lastHashIndex + 1).includes(" ");

              if (hashIsActive) {
                const afterHash = text.substring(lastHashIndex + 1);
                setShowCardTagPopover(true);
                setCardTagSearchText(afterHash.toLowerCase());
              } else {
                setShowCardTagPopover(false);
                setCardTagSearchText("");
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

      {/* Message Context Menu */}
      <MessageContextMenu
        visible={reactionPicker.visible}
        position={{ top: reactionPicker.top }}
        messageId={reactionPicker.messageId}
        messageContent={
          messages.find((m) => m.id === reactionPicker.messageId)?.content ?? ""
        }
        isOwnMessage={
          messages.find((m) => m.id === reactionPicker.messageId)?.user_id === user?.id
        }
        existingReactions={
          reactionPicker.visible
            ? (messages.find((m) => m.id === reactionPicker.messageId)?.reactions ?? [])
                .filter((r) => r.user_id === user?.id)
                .map((r) => r.emoji)
            : []
        }
        onReaction={handleReaction}
        onReply={(msgId) => {
          const msg = messages.find((m) => m.id === msgId);
          if (msg) {
            setReplyingTo(msg);
          }
        }}
        onCopy={() => {
          // Copy handled internally by MessageContextMenu
        }}
        onEdit={(msgId) => {
          const msg = messages.find((m) => m.id === msgId);
          if (msg) {
            setEditingMessage(msg);
            setMessageText(msg.content);
          }
        }}
        onDelete={handleDeleteMessage}
        onClose={() => setReactionPicker({ visible: false, messageId: "", top: 0 })}
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
  contentWithMentions: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    alignItems: "center" as const,
    gap: 2,
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
    paddingTop: 6,
    paddingBottom: 0,
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
    marginBottom: 2,
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
  attachedCardsRow: {
    paddingBottom: 8,
    gap: 6,
  },
  attachedCardWrapper: {
    position: "relative",
  },
  attachedCardRemove: {
    position: "absolute",
    top: 8,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  taggedRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 6,
  },
  inputChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#eb7825",
    borderRadius: 6,
    paddingLeft: 8,
    paddingRight: 5,
    paddingVertical: 3,
    gap: 4,
  },
  inputChipText: {
    fontSize: 12,
    color: "#FFFFFF",
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
    backgroundColor: "#F9FAFB",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 3,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  reactionChipActive: {
    backgroundColor: "#FFF0E8",
    borderColor: "#FDBA74",
  },
  reactionEmoji: {
    fontSize: 15,
  },
  reactionCount: {
    fontSize: 13,
    color: "#6B7280",
    fontWeight: "600",
  },
  reactionCountActive: {
    color: "#C2410C",
  },
});
