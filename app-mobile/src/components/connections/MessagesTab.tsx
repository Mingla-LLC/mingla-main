import React, { useState, useEffect, useRef } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ScrollView,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Conversation, Friend } from "../../data/mockConnections";
import ConversationCard from "./ConversationCard";
import MessageInterface from "../MessageInterface";

const ANIMATION_DURATION = 250;

interface MessagesTabProps {
  conversations: Conversation[];
  onSelectFriend: (friend: Friend) => void;
  onStartNewConversation: () => void;
  onBackFromMessage: () => void;
  onSendMessage: (
    content: string,
    type: "text" | "image" | "video" | "file",
    file?: File
  ) => void;
  activeChat: Friend | null;
  showMessageInterface: boolean;
  conversationsData: { [friendId: string]: any[] };
  messages?: any[];
  accountPreferences?: any;
  boardsSessions?: any[];
  currentMode?: "solo" | string;
  onModeChange?: (mode: "solo" | string) => void;
  onUpdateBoardSession?: (updatedBoard: any) => void;
  onCreateSession?: (newSession: any) => void;
  onNavigateToBoard?: (board: any, discussionTab?: string) => void;
  availableFriends: Friend[];
  currentUserId?: string;
  isBlocked?: boolean;
  mutedUserIds?: string[];
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
  messages = [],
  accountPreferences,
  boardsSessions = [],
  currentMode = "solo",
  onModeChange,
  onUpdateBoardSession,
  onCreateSession,
  onNavigateToBoard,
  availableFriends,
  currentUserId,
  isBlocked = false,
  mutedUserIds = [],
}: MessagesTabProps & { currentUserId?: string }) {
  const [messageSearchQuery, setMessageSearchQuery] = useState("");

  // Animation refs for conversation cards
  const cardAnimations = useRef<{ [key: string]: { opacity: Animated.Value; scale: Animated.Value } }>({});

  // Initialize animations for each conversation
  const getCardAnimation = (conversationId: string) => {
    if (!cardAnimations.current[conversationId]) {
      cardAnimations.current[conversationId] = {
        opacity: new Animated.Value(0),
        scale: new Animated.Value(0.8),
      };
    }
    return cardAnimations.current[conversationId];
  };

  // Filter conversations based on message search query
  const filteredConversations = conversations.filter((conversation) => {
    if (!messageSearchQuery.trim()) return true;

    const searchTerm = messageSearchQuery.toLowerCase();

    // Search by conversation name
    if (conversation.name?.toLowerCase().includes(searchTerm)) {
      return true;
    }

    // Search by last message content
    if (conversation.lastMessage?.content?.toLowerCase().includes(searchTerm)) {
      return true;
    }

    // Search by participant names (for group chats)
    return (
      conversation.participants?.some(
        (participant) =>
          participant.name?.toLowerCase().includes(searchTerm) ||
          participant.username?.toLowerCase().includes(searchTerm)
      ) || false
    );
  });

  // Run entrance animations when conversations change
  useEffect(() => {
    // Reset and animate all visible cards
    filteredConversations.forEach((conversation, index) => {
      const animation = getCardAnimation(conversation.id);
      animation.opacity.setValue(0);
      animation.scale.setValue(0.8);

      // Stagger animations by 80ms per card
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(animation.opacity, {
            toValue: 1,
            duration: ANIMATION_DURATION,
            useNativeDriver: true,
          }),
          Animated.timing(animation.scale, {
            toValue: 1,
            duration: ANIMATION_DURATION,
            useNativeDriver: true,
          }),
        ]).start();
      }, index * 80);
    });
  }, [filteredConversations.length]);

  if (showMessageInterface && activeChat) {
    return (
      <MessageInterface
        friend={activeChat}
        messages={
          messages.length > 0
            ? messages
            : conversationsData[activeChat.id] || []
        }
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
        isBlocked={isBlocked}
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
          <Ionicons
            name="search"
            size={20}
            color="#9ca3af"
            style={styles.searchIcon}
          />
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
            <Text style={styles.emptyStateSubtitle}>
              Try searching with different keywords
            </Text>
          </View>
        ) : (
          filteredConversations.map((conversation, index) => {
            // Check if any participant in the conversation is muted
            const isMuted = conversation.participants?.some(
              (p) => mutedUserIds.includes(p.id)
            );
            const animation = getCardAnimation(conversation.id);
            return (
            <Animated.View
              key={`conversation-${conversation.id}-${index}`}
              style={[
                {
                  opacity: animation.opacity,
                  transform: [{ scaleX: animation.scale }],
                },
              ]}
            >
            <ConversationCard
              conversation={conversation}
              onSelectConversation={(conv) => {
                // Get the other participant (not the current user)
                // The conversation name is already the other participant's name
                const otherParticipant = currentUserId
                  ? conv.participants.find((p) => p.id !== currentUserId)
                  : conv.participants.find((p) => p.name === conv.name);

                if (otherParticipant) {
                  // Ensure the name matches the conversation name (other participant)
                  const friendWithCorrectName = {
                    ...otherParticipant,
                    name: conv.name, // Use conversation name which is guaranteed to be the other participant
                  };
                  onSelectFriend(friendWithCorrectName);
                }
              }}
              isMuted={isMuted}
            />
            </Animated.View>
          );
        })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 0,
    gap: 16,
  },
  header: {
    gap: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827",
  },
  searchContainer: {
    position: "relative",
  },
  searchInput: {
    width: "100%",
    paddingLeft: 48,
    paddingRight: 16,
    paddingVertical: 12,
    backgroundColor: "#f9fafb",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 16,
    fontSize: 16,
  },
  searchIcon: {
    position: "absolute",
    left: 16,
    top: "50%",
    transform: [{ translateY: -10 }],
    zIndex: 1,
  },
  newConversationButton: {
    width: "100%",
    paddingVertical: 12,
    backgroundColor: "#eb7825",
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  newConversationText: {
    color: "white",
    fontSize: 16,
    fontWeight: "500",
  },
  conversationsList: {
    gap: 12,
    marginTop: 16,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 32,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateSubtitle: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
  },
});
