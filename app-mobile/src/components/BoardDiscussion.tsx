import React, { useState, useRef, useEffect } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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

interface Message {
  id: string;
  user: {
    id: string;
    name: string;
    avatar?: string;
  };
  content: string;
  timestamp: string;
  mentions?: string[];
  cardTags?: string[];
  replies?: Message[];
  likes?: number;
  isLiked?: boolean;
}

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

const mockMessages: Message[] = [
  {
    id: "1",
    user: { id: "1", name: "Sarah Chen" },
    content:
      "Hey everyone! What do you think about the coffee place? Should we lock it in?",
    timestamp: "2 hours ago",
    cardTags: ["Sightglass Coffee"],
    likes: 2,
    isLiked: false,
  },
  {
    id: "2",
    user: { id: "2", name: "Alex Rivera" },
    content:
      "I love that spot! @Sarah Chen the vibes are perfect for our group. ☕",
    timestamp: "1 hour ago",
    mentions: ["Sarah Chen"],
    likes: 3,
    isLiked: true,
  },
  {
    id: "3",
    user: { id: "3", name: "Jamie Park" },
    content:
      "Can we also discuss timing? I think 2pm works best for #Golden Gate Trail",
    timestamp: "45 minutes ago",
    cardTags: ["Golden Gate Trail"],
    likes: 1,
    isLiked: false,
  },
];

// Mock board cards data
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
      "Discover the art of coffee at Sightglass Coffee Roastery, where every cup tells a story. This intimate space combines industrial aesthetics with warm hospitality, featuring freshly roasted beans, expert baristas, and a cozy atmosphere perfect for conversations and connections.",
    address: "270 7th St, San Francisco, CA 94103",
    highlights: [
      "Artisan Coffee",
      "Cozy Atmosphere",
      "Fresh Roasted",
      "WiFi Available",
    ],
    matchScore: 87,
    socialStats: {
      views: 892,
      likes: 298,
      saves: 156,
    },
    votes: {
      yes: 3,
      no: 1,
      userVote: null,
    },
    rsvps: {
      responded: 2,
      total: 2,
      userRSVP: null,
    },
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
      "Experience the beauty of Golden Gate Park on this scenic trail perfect for nature enthusiasts. This well-maintained path offers stunning views, peaceful surroundings, and photo opportunities at every turn. Ideal for couples, friends, or solo adventurers looking to connect with nature.",
    address: "Golden Gate Park, San Francisco, CA",
    highlights: ["Scenic Views", "Photo Spots", "Pet Friendly", "Free Parking"],
    matchScore: 92,
    socialStats: {
      views: 1247,
      likes: 342,
      saves: 89,
    },
    votes: {
      yes: 2,
      no: 0,
      userVote: "yes",
    },
    rsvps: {
      responded: 2,
      total: 2,
      userRSVP: "yes",
    },
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
      "Join us for an immersive farm-to-table cooking experience where you'll learn to create delicious dishes using the freshest local ingredients. Our expert chefs will guide you through techniques and recipes you can recreate at home.",
    address: "456 Culinary Way, Mission District",
    highlights: [
      "Hands-on Learning",
      "Local Ingredients",
      "Take Home Recipes",
      "Wine Pairing",
    ],
    matchScore: 89,
    socialStats: {
      views: 643,
      likes: 201,
      saves: 87,
    },
    votes: {
      yes: 1,
      no: 1,
      userVote: null,
    },
    rsvps: {
      responded: 1,
      total: 2,
      userRSVP: null,
    },
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
  const [messages] = useState<Message[]>(mockMessages);
  const [newMessage, setNewMessage] = useState("");
  const [showMentions, setShowMentions] = useState(false);
  const [showCardTags, setShowCardTags] = useState(false);
  const [activeView, setActiveView] = useState<"cards" | "discussion">(
    propActiveTab || "cards"
  );
  const [boardNotifications, setBoardNotifications] = useState(true);
  const [showMemberManagement, setShowMemberManagement] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();

  // Focus input when switching to discussion view
  useEffect(() => {
    if (activeView === "discussion" && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [activeView]);

  // Use board participants as they are already in proper format
  const participants = board.participants;

  // Convert board cards for compatibility with CardTag system
  const cards = mockBoardCards.map((card) => ({
    id: card.id,
    title: card.title,
  }));

  const handleSendMessage = () => {
    if (newMessage.trim()) {
      setNewMessage("");
    }
  };

  const handleInputChange = (value: string) => {
    setNewMessage(value);

    if (value.endsWith("@")) {
      setShowMentions(true);
      setShowCardTags(false);
    } else if (value.endsWith("#")) {
      setShowCardTags(true);
      setShowMentions(false);
    } else {
      setShowMentions(false);
      setShowCardTags(false);
    }
  };

  const insertMention = (user: { id: string; name: string }) => {
    setNewMessage((prev) => prev.slice(0, -1) + `@${user.name} `);
    setShowMentions(false);
  };

  const insertCardTag = (card: { id: string; title: string }) => {
    setNewMessage((prev) => prev.slice(0, -1) + `#${card.title} `);
    setShowCardTags(false);
  };

  const handleVote = (cardId: string, vote: "yes" | "no") => {
    // Update vote logic would go here
  };

  const handleRSVP = (cardId: string, rsvp: "yes" | "no") => {
    // Update RSVP logic would go here
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

  const renderMessageContent = (content: string) => {
    return content.split(/(@\w+\s*\w*|#[\w\s]+)/g).map((part, index) => {
      if (part.startsWith("@")) {
        return (
          <Text key={index} style={styles.mentionText}>
            {part}
          </Text>
        );
      } else if (part.startsWith("#")) {
        return (
          <Text key={index} style={styles.cardTagText}>
            {part}
          </Text>
        );
      }
      return <Text key={index}>{part}</Text>;
    });
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
          <KeyboardAwareView style={styles.discussionContainer} dismissOnTap={false}>
            {/* Messages */}
            <ScrollView
              style={styles.messagesScroll}
              contentContainerStyle={styles.messagesContent}
              keyboardShouldPersistTaps="handled"
            >
              {messages.length > 0 ? (
                messages.map((message) => (
                  <View key={message.id} style={styles.messageRow}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {message.user.name[0]}
                      </Text>
                    </View>

                    <View style={styles.messageBubble}>
                      <View style={styles.messageHeader}>
                        <Text style={styles.messageName}>
                          {message.user.name}
                        </Text>
                        <Text style={styles.messageTime}>
                          {message.timestamp}
                        </Text>
                      </View>

                      <Text style={styles.messageText}>
                        {renderMessageContent(message.content)}
                      </Text>

                      {/* Tags */}
                      {(message.mentions || message.cardTags) && (
                        <View style={styles.tagsRow}>
                          {message.mentions?.map((mention) => (
                            <View key={mention} style={styles.mentionTag}>
                              <Ionicons
                                name="at"
                                size={12}
                                color="#eb7825"
                              />
                              <Text style={styles.mentionTagText}>
                                {mention}
                              </Text>
                            </View>
                          ))}
                          {message.cardTags?.map((tag) => (
                            <View key={tag} style={styles.cardTag}>
                              <Ionicons
                                name="hash"
                                size={12}
                                color={colors.primary[500]}
                              />
                              <Text style={styles.cardTagLabel}>
                                {tag}
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}

                      {/* Actions */}
                      <View style={styles.messageActions}>
                        <TouchableOpacity style={styles.actionButton}>
                          <Ionicons
                            name={
                              message.isLiked ? "heart" : "heart-outline"
                            }
                            size={14}
                            color={
                              message.isLiked
                                ? colors.error[500]
                                : colors.gray[400]
                            }
                          />
                          <Text style={styles.actionCount}>
                            {message.likes}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionButton}>
                          <Ionicons
                            name="arrow-undo"
                            size={14}
                            color={colors.gray[400]}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionButton}>
                          <Ionicons
                            name="ellipsis-horizontal"
                            size={14}
                            color={colors.gray[400]}
                          />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                ))
              ) : (
                <View style={styles.emptyState}>
                  <Ionicons
                    name="chatbubble-outline"
                    size={32}
                    color={colors.gray[300]}
                  />
                  <Text style={styles.emptyText}>
                    No messages yet. Start the conversation!
                  </Text>
                </View>
              )}
            </ScrollView>

            {/* Input */}
            <View style={[styles.inputArea, { paddingBottom: Math.max(insets.bottom, 16) }]}>
              {/* Mention Suggestions */}
              {showMentions && (
                <View style={styles.suggestionsPopup}>
                  {participants.map((user) => (
                    <TouchableOpacity
                      key={user.id}
                      onPress={() => insertMention(user)}
                      style={styles.suggestionItem}
                    >
                      <View style={styles.suggestionAvatar}>
                        <Text style={styles.suggestionAvatarText}>
                          {user.name[0]}
                        </Text>
                      </View>
                      <Text style={styles.suggestionText}>{user.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Card Tag Suggestions */}
              {showCardTags && cards.length > 0 && (
                <View style={styles.suggestionsPopup}>
                  {cards.map((card) => (
                    <TouchableOpacity
                      key={card.id}
                      onPress={() => insertCardTag(card)}
                      style={styles.suggestionItem}
                    >
                      <Ionicons name="hash" size={16} color={colors.primary[500]} />
                      <Text style={styles.suggestionText}>{card.title}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={styles.inputRow}>
                <TextInput
                  ref={inputRef}
                  value={newMessage}
                  onChangeText={handleInputChange}
                  placeholder="Type @ to mention or # to tag a card..."
                  placeholderTextColor={colors.gray[400]}
                  style={styles.textInput}
                  multiline
                  onSubmitEditing={handleSendMessage}
                />
                <TouchableOpacity
                  onPress={handleSendMessage}
                  disabled={!newMessage.trim()}
                  style={[
                    styles.sendButton,
                    !newMessage.trim() && styles.sendButtonDisabled,
                  ]}
                >
                  <Ionicons
                    name="send"
                    size={16}
                    color="#FFFFFF"
                  />
                </TouchableOpacity>
              </View>

              <Text style={styles.inputHint}>
                Use @ to mention participants • Use # to reference cards
              </Text>
            </View>
          </KeyboardAwareView>
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
    paddingHorizontal: 12,
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
  discussionContainer: {
    flex: 1,
  },
  messagesScroll: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  messagesContent: {
    padding: spacing.md,
    gap: 16,
  },
  messageRow: {
    flexDirection: "row",
    gap: 12,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
  messageBubble: {
    flex: 1,
  },
  messageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  messageName: {
    ...typography.sm,
    fontWeight: "600",
    color: colors.gray[900],
  },
  messageTime: {
    ...typography.xs,
    color: colors.gray[500],
  },
  messageText: {
    ...typography.sm,
    color: colors.gray[800],
    marginBottom: 8,
  },
  mentionText: {
    color: "#eb7825",
    fontWeight: "500",
  },
  cardTagText: {
    color: colors.primary[500],
    fontWeight: "500",
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginBottom: 8,
  },
  mentionTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.orange[50],
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  mentionTagText: {
    ...typography.xs,
    color: "#eb7825",
  },
  cardTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.primary[50],
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  cardTagLabel: {
    ...typography.xs,
    color: colors.primary[500],
  },
  messageActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  actionCount: {
    ...typography.xs,
    color: colors.gray[500],
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 32,
  },
  emptyText: {
    ...typography.sm,
    color: colors.gray[500],
    marginTop: 8,
  },
  inputArea: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.gray[100],
    backgroundColor: "#FFFFFF",
  },
  suggestionsPopup: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: 12,
    marginBottom: 8,
    maxHeight: 128,
    ...shadows.lg,
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 8,
  },
  suggestionAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
  },
  suggestionAvatarText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "600",
  },
  suggestionText: {
    ...typography.sm,
    color: colors.gray[800],
  },
  inputRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-end",
  },
  textInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    ...typography.md,
    color: colors.gray[800],
    maxHeight: 100,
  },
  sendButton: {
    width: 44,
    height: 44,
    backgroundColor: "#eb7825",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  inputHint: {
    ...typography.xs,
    color: colors.gray[500],
    marginTop: 8,
  },
});
