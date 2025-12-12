import React, { useState, useRef, useEffect } from "react";
import { Text, View, TouchableOpacity, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import SwipeableBoardCards from "./SwipeableBoardCards";
import BoardMemberManagementModal from "./BoardMemberManagementModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

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
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when switching to discussion view
  useEffect(() => {
    if (activeView === "discussion" && inputRef.current) {
      // Small delay to ensure the view has rendered
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
      // Handle sending message
      setNewMessage("");
    }
  };

  const handleInputChange = (value: string) => {
    setNewMessage(value);

    // Check for mentions (@)
    if (value.endsWith("@")) {
      setShowMentions(true);
      setShowCardTags(false);
    }
    // Check for card tags (#)
    else if (value.endsWith("#")) {
      setShowCardTags(true);
      setShowMentions(false);
    } else {
      setShowMentions(false);
      setShowCardTags(false);
    }
  };

  const insertMention = (user: any) => {
    setNewMessage((prev) => prev.slice(0, -1) + `@${user.name} `);
    setShowMentions(false);
  };

  const insertCardTag = (card: any) => {
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

  // Map icon names to components
  const iconMap: { [key: string]: string } = {
    Heart: "heart",
    Dumbbell: "fitness",
    Utensils: "restaurant",
    Coffee: "cafe",
    Palette: "color-palette",
    Trophy: "trophy",
  };

  const BoardIcon = iconMap[board.icon] || "heart";

  return (
    <View className="h-full bg-gray-50 flex flex-col">
      {/* Header */}
      <View className="bg-white border-b border-gray-200 p-4 flex-shrink-0">
        <View className="flex items-center gap-3 mb-3 pt-8">
          <TouchableOpacity
            onPress={onBack}
            className="w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors"
          >
            <Ionicons name="arrow-back" size={16} color="#6b7280" />
          </TouchableOpacity>

          <View className="flex-1">
            <Text className="font-bold text-gray-900">{board.name}</Text>
            <Text className="text-sm text-gray-600">{board.description}</Text>
          </View>

          {/* Board Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <TouchableOpacity
                    className="w-8 h-8 border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 transition-all duration-200 flex items-center justify-center"
                    title="Board options"
                  >
                    <Ionicons
                      name="ellipsis-horizontal"
                      size={16}
                      color="#6b7280"
                    />
                  </TouchableOpacity>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    onPress={() => {
                      setShowMemberManagement(true);
                    }}
                  >
                    <Ionicons
                      name="people"
                      size={16}
                      color="#6b7280"
                      style={{ marginRight: 8 }}
                    />
                    Manage Members
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onPress={() => {
                      setShowMemberManagement(true);
                    }}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <Ionicons
                      name="log-out"
                      size={16}
                      color="#6b7280"
                      style={{ marginRight: 8 }}
                    />
                    Leave Board
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onPress={handleToggleNotifications}
                className="flex items-center gap-2"
              >
                {boardNotifications ? (
                  <>
                    <Ionicons
                      name="notifications-off"
                      size={16}
                      color="#6b7280"
                    />
                    Turn off notifications
                  </>
                ) : (
                  <>
                    <Ionicons name="notifications" size={16} color="#6b7280" />
                    Turn on notifications
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem
                onPress={handleExitBoard}
                variant="destructive"
                className="flex items-center gap-2"
              >
                <Ionicons name="log-out" size={16} color="#6b7280" />
                Exit board
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </View>

        {/* Tab Navigation */}
        <View className="flex bg-gray-100 rounded-xl p-1">
          <TouchableOpacity
            onPress={() => {
              setActiveView("cards");
              onTabChange?.("cards");
            }}
            className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-all ${
              activeView === "cards"
                ? "bg-white text-[#eb7825] shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Cards ({mockBoardCards.length})
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              setActiveView("discussion");
              onTabChange?.("discussion");
            }}
            className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-all ${
              activeView === "discussion"
                ? "bg-white text-[#eb7825] shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Discussion ({messages.length})
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      <View className="flex-1 overflow-hidden">
        {activeView === "cards" ? (
          <View className="h-full p-4 overflow-y-auto">
            <SwipeableBoardCards
              cards={mockBoardCards}
              onVote={handleVote}
              onRSVP={handleRSVP}
            />
          </View>
        ) : (
          <View className="h-full flex flex-col">
            {/* Messages */}
            <View className="flex-1 overflow-y-auto bg-white">
              {messages.length > 0 ? (
                <View className="space-y-4 p-4">
                  {messages.map((message) => (
                    <View key={message.id} className="group">
                      <View className="flex gap-3">
                        <View className="w-8 h-8 bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
                          {message.user.name[0]}
                        </View>

                        <View className="flex-1 min-w-0">
                          <View className="flex items-center gap-2 mb-1">
                            <Text className="font-medium text-gray-900 text-sm">
                              {message.user.name}
                            </Text>
                            <Text className="text-xs text-gray-500">
                              {message.timestamp}
                            </Text>
                          </View>

                          <View className="text-sm text-gray-800 mb-2">
                            {message.content
                              .split(/(@\w+\s*\w*|#[\w\s]+)/g)
                              .map((part, index) => {
                                if (part.startsWith("@")) {
                                  return (
                                    <Text
                                      key={index}
                                      className="text-[#eb7825] font-medium"
                                    >
                                      {part}
                                    </Text>
                                  );
                                } else if (part.startsWith("#")) {
                                  return (
                                    <Text
                                      key={index}
                                      className="text-blue-600 font-medium"
                                    >
                                      {part}
                                    </Text>
                                  );
                                }
                                return part;
                              })}
                          </View>

                          {/* Tags */}
                          {(message.mentions || message.cardTags) && (
                            <View className="flex flex-wrap gap-1 mb-2">
                              {message.mentions?.map((mention) => (
                                <Text
                                  key={mention}
                                  className="inline-flex items-center gap-1 bg-orange-50 text-[#eb7825] px-2 py-0.5 rounded-full text-xs"
                                >
                                  <Ionicons
                                    name="at"
                                    size={12}
                                    color="#6b7280"
                                  />
                                  {mention}
                                </Text>
                              ))}
                              {message.cardTags?.map((tag) => (
                                <Text
                                  key={tag}
                                  className="inline-flex items-center gap-1 bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full text-xs"
                                >
                                  <Ionicons
                                    name="hash"
                                    size={12}
                                    color="#6b7280"
                                  />
                                  {tag}
                                </Text>
                              ))}
                            </View>
                          )}

                          {/* Actions */}
                          <View className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                            <TouchableOpacity className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-500 transition-colors">
                              <Ionicons
                                name={
                                  message.isLiked ? "heart" : "heart-outline"
                                }
                                size={12}
                                color={message.isLiked ? "#ef4444" : "#6b7280"}
                              />
                              {message.likes}
                            </TouchableOpacity>
                            <TouchableOpacity className="text-xs text-gray-500 hover:text-gray-700 transition-colors">
                              <Ionicons
                                name="arrow-undo"
                                size={12}
                                color="#6b7280"
                              />
                            </TouchableOpacity>
                            <TouchableOpacity className="text-xs text-gray-500 hover:text-gray-700 transition-colors">
                              <Ionicons
                                name="ellipsis-horizontal"
                                size={12}
                                color="#6b7280"
                              />
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <View className="text-center py-8 text-gray-500">
                  <Ionicons
                    name="chatbubble-outline"
                    size={32}
                    color="#d1d5db"
                    style={{ alignSelf: "center", marginBottom: 8 }}
                  />
                  <Text className="text-sm">
                    No messages yet. Start the conversation!
                  </Text>
                </View>
              )}
            </View>

            {/* Input */}
            <View
              className="relative p-4 border-t border-gray-100 bg-white flex-shrink-0 z-10"
              style={{ paddingBottom: "env(safe-area-inset-bottom, 16px)" }}
            >
              {/* Suggestions */}
              {showMentions && (
                <View className="absolute bottom-full left-4 right-4 mb-2 bg-white border border-gray-200 rounded-xl shadow-lg max-h-32 overflow-y-auto z-10">
                  {participants.map((user) => (
                    <TouchableOpacity
                      key={user.id}
                      onPress={() => insertMention(user)}
                      className="w-full flex items-center gap-2 p-2 hover:bg-gray-50 text-left"
                    >
                      <View className="w-6 h-6 bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-full flex items-center justify-center text-white text-xs">
                        {user.name[0]}
                      </View>
                      <Text className="text-sm">{user.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {showCardTags && cards.length > 0 && (
                <View className="absolute bottom-full left-4 right-4 mb-2 bg-white border border-gray-200 rounded-xl shadow-lg max-h-32 overflow-y-auto z-10">
                  {cards.map((card) => (
                    <TouchableOpacity
                      key={card.id}
                      onPress={() => insertCardTag(card)}
                      className="w-full flex items-center gap-2 p-2 hover:bg-gray-50 text-left"
                    >
                      <Ionicons name="hash" size={16} color="#2563eb" />
                      <Text className="text-sm">{card.title}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View className="flex gap-2 items-end">
                <View
                  className="flex-1"
                  onPress={() => inputRef.current?.focus()}
                >
                  <TextInput
                    ref={inputRef}
                    value={newMessage}
                    onChangeText={handleInputChange}
                    placeholder="Type @ to mention someone or # to tag a card..."
                    style={{
                      width: "100%",
                      paddingHorizontal: 16,
                      paddingVertical: 12,
                      borderWidth: 1,
                      borderColor: "#e5e7eb",
                      borderRadius: 12,
                      backgroundColor: "white",
                      fontSize: 16,
                    }}
                    multiline
                    onSubmitEditing={handleSendMessage}
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus={false}
                    inputMode="text"
                    enterKeyHint="send"
                  />
                </View>
                <TouchableOpacity
                  onPress={handleSendMessage}
                  disabled={!newMessage.trim()}
                  className="px-4 py-3 bg-[#eb7825] text-white rounded-xl hover:bg-[#d6691f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  <Ionicons name="send" size={16} color="#6b7280" />
                </TouchableOpacity>
              </View>

              <Text className="text-xs text-gray-500 mt-2">
                Use @ to mention participants • Use # to reference cards
              </Text>
            </View>
          </View>
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
