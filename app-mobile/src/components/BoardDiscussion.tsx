import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  FlatList,
  Image,
  ActionSheetIOS,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import SwipeableBoardCards from "./SwipeableBoardCards";
import BoardMemberManagementModal from "./BoardMemberManagementModal";
import { KeyboardAwareView } from "./ui/KeyboardAwareView";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { colors, spacing, radius, shadows, typography } from "../constants/designSystem";
import { useSessionDiscussion } from '../hooks/useSessionDiscussion';
import { BoardMessage } from '../services/boardDiscussionService';
import TypingIndicator from './discussion/TypingIndicator';
import EmojiReactionPicker from './discussion/EmojiReactionPicker';
import MessageBubble from './discussion/MessageBubble';
import SuggestionPopup from './discussion/SuggestionPopup';
import EmptyDiscussion from './discussion/EmptyDiscussion';

interface Board {
  id: string;
  name: string;
  type:
    | "date-night"
    | "group-hangout"
    | "adventure"
    | "wellness"
    | "food-tour"
    | "cultural";
  description: string;
  participants: string[];
  status: "active" | "voting" | "locked" | "completed";
  voteDeadline?: string;
  finalizedDate?: string;
  cardsCount: number;
  createdAt: string;
  unreadMessages: number;
  lastActivity: string;
  icon: any;
  gradient: string;
}

interface BoardDiscussionProps {
  board: Board & {
    participants: Array<{
      id: string;
      name: string;
      status: string;
      lastActive?: string;
    }>;
    admins: string[];
    currentUserId: string;
    creatorId: string;
  };
  onBack: () => void;
  onExitBoard?: (boardId: string, boardName: string) => void;
  activeTab?: "cards" | "discussion";
  onTabChange?: (tab: "cards" | "discussion") => void;
  onPromoteToAdmin?: (boardId: string, participantId: string) => void;
  onDemoteFromAdmin?: (boardId: string, participantId: string) => void;
  onRemoveMember?: (boardId: string, participantId: string) => void;
  onLeaveBoard?: (boardId: string) => void;
}

// Mock board cards data (preserved from original for cards tab)
const mockBoardCards = [
  {
    id: "board-card-1",
    title: "Sightglass Coffee Roastery",
    category: "Sip & Chill",
    categoryIcon: "Coffee",
    image:
      "https://images.unsplash.com/photo-1642315160505-b3dff3a3c8b9?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjBzaG9wJTIwY296eSUyMGludGVyaW9yfGVufDF8fHx8MTc1OTExMDg1OHww&ixlib=rb-4.1.0&q=80&w=1080",
    images: [
      "https://images.unsplash.com/photo-1642315160505-b3dff3a3c8b9?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjBzaG9wJTIwY296eSUyMGludGVyaW9yfGVufDF8fHx8MTc1OTExMDg1OHww&ixlib=rb-4.1.0&q=80&w=1080",
      "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjBzaG9wJTIwY291bnRlcnxlbnwxfHx8fDE3NTkxNzI1Mjh8MA&ixlib=rb-4.1.0&q=80&w=1080",
      "https://images.unsplash.com/photo-1447933601403-0c6688de566e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjBjdXB8ZW58MXx8fHwxNzU5MTcyNTI4fDA&ixlib=rb-4.1.0&q=80&w=1080",
    ],
    rating: 4.6,
    reviewCount: 187,
    travelTime: "12m",
    priceRange: "$15-40",
    description: "Intimate coffee experience with artisan vibes",
    fullDescription:
      "Discover the art of coffee at Sightglass Coffee Roastery, where every cup tells a story.",
    address: "270 7th St, San Francisco, CA 94103",
    highlights: ["Artisan Coffee", "Cozy Atmosphere", "Fresh Roasted", "WiFi Available"],
    matchScore: 87,
    socialStats: { views: 892, likes: 298, saves: 156 },
    votes: { yes: 3, no: 1, userVote: null },
    rsvps: { responded: 2, total: 2, userRSVP: null },
    messages: 5,
    isLocked: false,
  },
  {
    id: "board-card-2",
    title: "Golden Gate Park Trail",
    category: "Take a Stroll",
    categoryIcon: "TreePine",
    image:
      "https://images.unsplash.com/photo-1739139106925-230659c867e0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxvdXRkb29yJTIwcGFyayUyMHdhbGtpbmclMjB0cmFpbHxlbnwxfHx8fDE3NTkxNzI1MTJ8MA&ixlib=rb-4.1.0&q=80&w=1080",
    images: [
      "https://images.unsplash.com/photo-1739139106925-230659c867e0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxvdXRkb29yJTIwcGFyayUyMHdhbGtpbmclMjB0cmFpbHxlbnwxfHx8fDE3NTkxNzI1MTJ8MA&ixlib=rb-4.1.0&q=80&w=1080",
      "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxuYXR1cmUlMjBwYXJrJTIwdHJhaWx8ZW58MXx8fHwxNzU5MTcyNTEyfDA&ixlib=rb-4.1.0&q=80&w=1080",
    ],
    rating: 4.7,
    reviewCount: 234,
    travelTime: "18m",
    priceRange: "Free",
    description: "Scenic walking adventure for nature lovers",
    fullDescription:
      "Experience the beauty of Golden Gate Park on this scenic trail perfect for nature enthusiasts.",
    address: "Golden Gate Park, San Francisco, CA",
    highlights: ["Scenic Views", "Photo Spots", "Pet Friendly", "Free Parking"],
    matchScore: 92,
    socialStats: { views: 1247, likes: 342, saves: 89 },
    votes: { yes: 2, no: 0, userVote: "yes" },
    rsvps: { responded: 2, total: 2, userRSVP: "yes" },
    messages: 3,
    isLocked: true,
    lockedAt: "yesterday",
  },
  {
    id: "board-card-3",
    title: "Farm-to-Table Cooking Class",
    category: "Fuel Up",
    categoryIcon: "Utensils",
    image:
      "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb29raW5nJTIwY2xhc3N8ZW58MXx8fHwxNzU5MTcyNTI4fDA&ixlib=rb-4.1.0&q=80&w=1080",
    images: [
      "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb29raW5nJTIwY2xhc3N8ZW58MXx8fHwxNzU5MTcyNTI4fDA&ixlib=rb-4.1.0&q=80&w=1080",
    ],
    rating: 4.8,
    reviewCount: 156,
    travelTime: "25m",
    priceRange: "$75-95",
    description: "Learn to cook with fresh, local ingredients",
    fullDescription:
      "Join us for an immersive farm-to-table cooking experience.",
    address: "456 Culinary Way, Mission District",
    highlights: ["Hands-on Learning", "Local Ingredients", "Take Home Recipes", "Wine Pairing"],
    matchScore: 89,
    socialStats: { views: 643, likes: 201, saves: 87 },
    votes: { yes: 1, no: 1, userVote: null },
    rsvps: { responded: 1, total: 2, userRSVP: null },
    messages: 2,
    isLocked: false,
  },
];

export default function BoardDiscussion({
  board,
  onBack,
  onExitBoard,
  activeTab: propActiveTab,
  onTabChange,
  onPromoteToAdmin,
  onDemoteFromAdmin,
  onRemoveMember,
  onLeaveBoard,
}: BoardDiscussionProps) {
  const [activeView, setActiveView] = useState<"cards" | "discussion">(
    propActiveTab || "cards"
  );
  const [boardNotifications, setBoardNotifications] = useState(true);
  const [showMemberManagement, setShowMemberManagement] = useState(false);
  const insets = useSafeAreaInsets();

  // --- Discussion state ---
  const [newMessage, setNewMessage] = useState('');
  const [pendingImage, setPendingImage] = useState<{ uri: string; mimeType: string } | null>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [showCardTags, setShowCardTags] = useState(false);
  const [reactionPickerState, setReactionPickerState] = useState<{ visible: boolean; messageId: string; top: number }>({ visible: false, messageId: '', top: 0 });
  const inputRef = useRef<TextInput>(null);
  const flatListRef = useRef<FlatList>(null);

  const sessionId = board.id;
  const currentUserId = board.currentUserId;

  const {
    messages,
    isLoading,
    isError,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    sendMessage,
    isSending,
    toggleReaction,
    typingUsers,
    startTyping,
    stopTyping,
    refetch,
  } = useSessionDiscussion(sessionId, currentUserId);

  const canSend = !!newMessage.trim() || !!pendingImage;

  // Map typing user IDs to names using board.participants
  const typingUserNames = typingUsers
    .map(uid => board.participants.find(p => p.id === uid)?.name)
    .filter(Boolean) as string[];

  // Participant names map for read receipts
  const participantNames: Record<string, string> = {};
  board.participants.forEach(p => { participantNames[p.id] = p.name; });

  // Find last own message index for read receipts
  const lastOwnMessageIndex = messages.findIndex(m => m.user_id === currentUserId);

  // Mention items from participants
  const mentionItems = board.participants.map(p => ({ id: p.id, name: p.name, avatar_url: null }));

  // Card tag items from mock board cards (board prop doesn't carry cards data)
  const cardTagItems = mockBoardCards.map(c => ({ id: c.id, name: c.title }));

  // --- Handlers ---

  const handleInputChange = (text: string) => {
    setNewMessage(text);

    // Detect @mention trigger
    const lastAtIndex = text.lastIndexOf('@');
    if (lastAtIndex >= 0 && (lastAtIndex === 0 || text[lastAtIndex - 1] === ' ')) {
      const query = text.slice(lastAtIndex + 1);
      if (!query.includes(' ')) {
        setShowMentions(true);
        setShowCardTags(false);
        return;
      }
    }

    // Detect #card-tag trigger
    const lastHashIndex = text.lastIndexOf('#');
    if (lastHashIndex >= 0 && (lastHashIndex === 0 || text[lastHashIndex - 1] === ' ')) {
      const query = text.slice(lastHashIndex + 1);
      if (!query.includes(' ')) {
        setShowCardTags(true);
        setShowMentions(false);
        return;
      }
    }

    setShowMentions(false);
    setShowCardTags(false);

    // Typing indicator
    if (text.trim()) {
      startTyping();
    } else {
      stopTyping();
    }
  };

  const insertMention = (item: { id: string; name: string }) => {
    const lastAtIndex = newMessage.lastIndexOf('@');
    const before = newMessage.slice(0, lastAtIndex);
    setNewMessage(`${before}@${item.name} `);
    setShowMentions(false);
  };

  const insertCardTag = (item: { id: string; name: string }) => {
    const lastHashIndex = newMessage.lastIndexOf('#');
    const before = newMessage.slice(0, lastHashIndex);
    setNewMessage(`${before}#${item.name} `);
    setShowCardTags(false);
  };

  const handleSendMessage = async () => {
    if (!canSend) return;

    const content = newMessage.trim();
    const imageUri = pendingImage?.uri;
    const imageMimeType = pendingImage?.mimeType;

    // Extract mentioned user IDs
    const mentionedIds = board.participants
      .filter(p => content.includes(`@${p.name}`))
      .map(p => p.id);

    setNewMessage('');
    setPendingImage(null);

    try {
      await sendMessage({
        content,
        imageUri,
        imageMimeType,
        mentions: mentionedIds.length > 0 ? mentionedIds : undefined,
      });
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  const handlePhotoPicker = () => {
    const options = ['Take Photo', 'Choose from Library', 'Cancel'];
    const cancelButtonIndex = 2;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex },
        async (buttonIndex) => {
          if (buttonIndex === 0) await pickImage('camera');
          else if (buttonIndex === 1) await pickImage('library');
        }
      );
    } else {
      // Android: use Alert as action sheet
      Alert.alert('Attach Photo', '', [
        { text: 'Take Photo', onPress: () => pickImage('camera') },
        { text: 'Choose from Library', onPress: () => pickImage('library') },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const pickImage = async (source: 'camera' | 'library') => {
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setPendingImage({ uri: asset.uri, mimeType: asset.mimeType || 'image/jpeg' });
    }
  };

  const handleLongPress = (messageId: string, pageY: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setReactionPickerState({ visible: true, messageId, top: pageY - 60 });
  };

  const handleReaction = (messageId: string, emoji: string) => {
    toggleReaction({ messageId, emoji });
    setReactionPickerState({ visible: false, messageId: '', top: 0 });
  };

  const renderMessage = ({ item, index }: { item: BoardMessage; index: number }) => {
    const isOwnMessage = item.user_id === currentUserId;
    return (
      <MessageBubble
        message={item}
        isOwnMessage={isOwnMessage}
        currentUserId={currentUserId}
        onLongPress={handleLongPress}
        onReaction={handleReaction}
        participantNames={participantNames}
        isLastOwnMessage={isOwnMessage && index === lastOwnMessageIndex}
      />
    );
  };

  // --- Preserved handlers from original ---

  const handleVote = (cardId: string, vote: "yes" | "no") => {
    // Vote logic handled by cards tab
  };

  const handleRSVP = (cardId: string, rsvp: "yes" | "no") => {
    // RSVP logic handled by cards tab
  };

  const handleToggleNotifications = () => {
    setBoardNotifications(!boardNotifications);
  };

  const handleExitBoard = () => {
    if (onExitBoard) {
      onExitBoard(board.id, board.name);
    }
  };

  const handlePromoteMember = (participantId: string) => {
    if (onPromoteToAdmin) {
      onPromoteToAdmin(board.id, participantId);
    }
  };

  const handleDemoteMember = (participantId: string) => {
    if (onDemoteFromAdmin) {
      onDemoteFromAdmin(board.id, participantId);
    }
  };

  const handleRemoveBoardMember = (participantId: string) => {
    if (onRemoveMember) {
      onRemoveMember(board.id, participantId);
    }
  };

  const handleLeaveBoardAction = () => {
    if (onLeaveBoard) {
      onLeaveBoard(board.id);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={onBack}
            style={styles.backButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="arrow-back" size={16} color={colors.gray[500]} />
          </TouchableOpacity>

          <View style={styles.headerInfo}>
            <Text style={styles.boardName}>{board.name}</Text>
            <Text style={styles.boardDescription}>{board.description}</Text>
          </View>

          {/* Board Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger>
              <TouchableOpacity style={styles.menuButton}>
                <Ionicons
                  name="ellipsis-horizontal"
                  size={16}
                  color={colors.gray[500]}
                />
              </TouchableOpacity>
            </DropdownMenuTrigger>
            <DropdownMenuContent style={styles.menuContent}>
              <DropdownMenuItem
                onPress={() => setShowMemberManagement(true)}
              >
                <Ionicons
                  name="people"
                  size={16}
                  color={colors.gray[500]}
                  style={styles.menuItemIcon}
                />
                <Text style={styles.menuItemText}>Manage Members</Text>
              </DropdownMenuItem>
              <DropdownMenuItem onPress={handleToggleNotifications}>
                <Ionicons
                  name={boardNotifications ? "notifications-off" : "notifications"}
                  size={16}
                  color={colors.gray[500]}
                  style={styles.menuItemIcon}
                />
                <Text style={styles.menuItemText}>
                  {boardNotifications ? "Turn off notifications" : "Turn on notifications"}
                </Text>
              </DropdownMenuItem>
              <DropdownMenuItem
                onPress={handleExitBoard}
                variant="destructive"
              >
                <Ionicons
                  name="log-out"
                  size={16}
                  color={colors.error[500]}
                  style={styles.menuItemIcon}
                />
                <Text style={styles.menuItemTextDestructive}>Exit board</Text>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </View>

        {/* Tab Navigation */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            onPress={() => {
              setActiveView("cards");
              onTabChange?.("cards");
            }}
            style={[
              styles.tab,
              activeView === "cards" && styles.tabActive,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.tabText,
                activeView === "cards" && styles.tabTextActive,
              ]}
            >
              Cards ({mockBoardCards.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              setActiveView("discussion");
              onTabChange?.("discussion");
            }}
            style={[
              styles.tab,
              activeView === "discussion" && styles.tabActive,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.tabText,
                activeView === "discussion" && styles.tabTextActive,
              ]}
            >
              Discussion ({messages.length})
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      <View style={styles.content}>
        {activeView === "cards" ? (
          <View style={styles.cardsContainer}>
            <SwipeableBoardCards
              cards={mockBoardCards}
              onVote={handleVote}
              onRSVP={handleRSVP}
            />
          </View>
        ) : (
          /* Discussion Tab — iMessage-style chat */
          isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#eb7825" />
            </View>
          ) : isError ? (
            <View style={styles.errorContainer}>
              <Ionicons name="alert-circle" size={48} color={colors.error[500]} />
              <Text style={styles.errorText}>
                {error?.message || 'Failed to load discussion'}
              </Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => refetch()}
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <KeyboardAwareView style={styles.discussionContainer} dismissOnTap={true}>
              {/* Messages */}
              <FlatList
                ref={flatListRef}
                data={messages}
                renderItem={renderMessage}
                keyExtractor={(item) => item.id}
                inverted={true}
                contentContainerStyle={styles.messagesContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={<EmptyDiscussion />}
                onEndReached={() => { if (hasNextPage) fetchNextPage(); }}
                onEndReachedThreshold={0.3}
              />

              {/* Typing Indicator */}
              {typingUserNames.length > 0 && (
                <TypingIndicator userNames={typingUserNames} />
              )}

              {/* Mention/Tag Suggestions */}
              {(showMentions || showCardTags) && (
                <SuggestionPopup
                  type={showMentions ? 'mention' : 'cardTag'}
                  items={showMentions ? mentionItems : cardTagItems}
                  onSelect={showMentions ? insertMention : insertCardTag}
                />
              )}

              {/* Emoji Reaction Picker */}
              <EmojiReactionPicker
                visible={reactionPickerState.visible}
                position={{ top: reactionPickerState.top }}
                onSelect={(emoji) => handleReaction(reactionPickerState.messageId, emoji)}
                onClose={() => setReactionPickerState({ visible: false, messageId: '', top: 0 })}
                existingReactions={
                  reactionPickerState.visible
                    ? (messages.find(m => m.id === reactionPickerState.messageId)?.reactions ?? [])
                        .filter(r => r.user_id === currentUserId)
                        .map(r => r.emoji)
                    : []
                }
              />

              {/* Input Area */}
              <View style={[styles.inputArea, { paddingBottom: Math.max(insets.bottom, 8) }]}>
                {/* Pending Image Preview */}
                {pendingImage && (
                  <View style={styles.pendingImageRow}>
                    <Image source={{ uri: pendingImage.uri }} style={styles.pendingImagePreview} />
                    <TouchableOpacity onPress={() => setPendingImage(null)}>
                      <Ionicons name="close-circle" size={20} color={colors.gray[500]} />
                    </TouchableOpacity>
                  </View>
                )}

                <View style={styles.inputRow}>
                  <TouchableOpacity onPress={handlePhotoPicker} style={styles.photoButton}>
                    <Ionicons name="camera" size={22} color={colors.gray[500]} />
                  </TouchableOpacity>
                  <View style={styles.inputWrapper}>
                    <TextInput
                      ref={inputRef}
                      value={newMessage}
                      onChangeText={handleInputChange}
                      placeholder="Message..."
                      placeholderTextColor={colors.gray[400]}
                      style={styles.textInput}
                      multiline
                      maxLength={2000}
                    />
                  </View>
                  <TouchableOpacity
                    onPress={handleSendMessage}
                    disabled={!canSend}
                    style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
                  >
                    <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAwareView>
          )
        )}
      </View>

      {/* Board Member Management Modal */}
      <BoardMemberManagementModal
        isOpen={showMemberManagement}
        onClose={() => setShowMemberManagement(false)}
        board={board}
        onPromoteToAdmin={handlePromoteMember}
        onDemoteFromAdmin={handleDemoteMember}
        onRemoveMember={handleRemoveBoardMember}
        onLeaveBoard={handleLeaveBoardAction}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.gray[50],
  },
  header: {
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[200],
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
    paddingTop: 32,
  },
  backButton: {
    width: 32,
    height: 32,
    backgroundColor: colors.gray[100],
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  headerInfo: {
    flex: 1,
  },
  boardName: {
    ...typography.md,
    fontWeight: "700",
    color: colors.gray[900],
  },
  boardDescription: {
    ...typography.sm,
    color: colors.gray[600],
  },
  menuButton: {
    width: 32,
    height: 32,
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  menuContent: {
    width: 192,
  },
  menuItemIcon: {
    marginRight: 8,
  },
  menuItemText: {
    ...typography.sm,
    color: colors.gray[700],
  },
  menuItemTextDestructive: {
    ...typography.sm,
    color: colors.error[500],
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: colors.gray[100],
    borderRadius: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  tabActive: {
    backgroundColor: "#FFFFFF",
    ...shadows.sm,
  },
  tabText: {
    ...typography.sm,
    fontWeight: "500",
    color: colors.gray[600],
    textAlign: "center",
  },
  tabTextActive: {
    color: "#eb7825",
    fontWeight: "600",
  },
  content: {
    flex: 1,
  },
  cardsContainer: {
    flex: 1,
    padding: spacing.md,
  },
  // Discussion styles
  discussionContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  messagesContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  inputArea: {
    borderTopWidth: 1,
    borderTopColor: colors.gray[100],
    backgroundColor: '#FFFFFF',
    paddingTop: 8,
    paddingHorizontal: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  photoButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.gray[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  inputWrapper: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.gray[200],
    backgroundColor: colors.gray[50],
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxHeight: 100,
  },
  textInput: {
    ...typography.sm,
    color: colors.gray[900],
    padding: 0,
    maxHeight: 80,
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#eb7825',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  sendButtonDisabled: {
    backgroundColor: colors.gray[300],
  },
  pendingImageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  pendingImagePreview: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  // Loading & error states
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    gap: 12,
  },
  errorText: {
    ...typography.sm,
    color: colors.error[500],
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#eb7825',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 4,
  },
  retryButtonText: {
    ...typography.sm,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
