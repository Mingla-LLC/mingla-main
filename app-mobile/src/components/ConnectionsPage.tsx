import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  FlatList,
  TextInput,
  Clipboard,
  Modal,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  useWindowDimensions,
  RefreshControl,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useFriends, Friend as UseFriend } from "../hooks/useFriends";
import { useAppStore } from "../store/appStore";
import { messagingService, DirectMessage } from "../services/messagingService";
import { blockService, BlockReason } from "../services/blockService";
import { muteService } from "../services/muteService";
import { reportService, ReportReason } from "../services/reportService";
import { supabase } from "../services/supabase";
import { mixpanelService } from "../services/mixpanelService";
import { HapticFeedback } from "../utils/hapticFeedback";
import { Conversation } from "../hooks/useMessages";
import { Friend, Message } from "../services/connectionsService";
import {
  useSendFriendLink,
  useCancelLinkRequest,
  useUserSearch,
} from "../hooks/useFriendLinks";
import { usePendingLinkConsents, useRespondLinkConsent } from "../hooks/useLinkConsent";
import { useScreenLogger } from "../hooks/useScreenLogger";
import { useSocialRealtime } from "../hooks/useSocialRealtime";
import { LinkConsentCard } from "./LinkConsentCard";
import { colors, spacing, typography, fontWeights } from "../constants/designSystem";
import { useQueryClient } from "@tanstack/react-query";
import { friendLinkKeys, linkConsentKeys } from "../hooks/socialQueryKeys";

// Sub-components
import { ChatListItem } from "./connections/ChatListItem";
import { FriendPickerSheet } from "./connections/FriendPickerSheet";
import { AddFriendView } from "./connections/AddFriendView";
import { RequestsView } from "./connections/RequestsView";
import { BlockedUsersView } from "./connections/BlockedUsersView";
import MessageInterface from "./MessageInterface";

type PanelId = "add" | "requests" | "blocked" | null;

// Modals kept for MessageInterface actions
import AddToBoardModal from "./AddToBoardModal";
import ReportUserModal from "./ReportUserModal";
import BlockUserModal from "./BlockUserModal";
interface ConnectionsPageProps {
  onSendCollabInvite?: (friend: any) => void;
  onAddToBoard?: (
    sessionIds: string[],
    friend: any,
    suppressNotification?: boolean
  ) => void;
  onShareSavedCard?: (friend: any, suppressNotification?: boolean) => void;
  onRemoveFriend?: (friend: any, suppressNotification?: boolean) => void;
  onBlockUser?: (friend: any, suppressNotification?: boolean) => void;
  onReportUser?: (friend: any, suppressNotification?: boolean) => void;
  accountPreferences?: any;
  boardsSessions?: any[];
  currentMode?: "solo" | string;
  onModeChange?: (mode: "solo" | string) => void;
  onUpdateBoardSession?: (updatedBoard: any) => void;
  onCreateSession?: (newSession: any) => void;
  onNavigateToBoard?: (board: any, discussionTab?: string) => void;
  friendsList?: any[];
  onUnreadCountChange?: (count: number) => void;
  onNavigateToFriendProfile?: (userId: string) => void;
}

const CONNECTIONS_CACHE_VERSION = "v1";

const getConversationsCacheKey = (userId: string) =>
  `mingla:connections:conversations:${CONNECTIONS_CACHE_VERSION}:${userId}`;

export default function ConnectionsPageRefactored({
  onSendCollabInvite,
  onAddToBoard,
  onShareSavedCard,
  onRemoveFriend,
  onBlockUser,
  onReportUser,
  accountPreferences,
  boardsSessions = [],
  currentMode = "solo",
  onModeChange,
  onUpdateBoardSession,
  onCreateSession,
  onNavigateToBoard,
  onUnreadCountChange,
  onNavigateToFriendProfile,
}: ConnectionsPageProps) {
  useScreenLogger('connections');
  const user = useAppStore((state) => state.user);
  const { height: screenHeight } = useWindowDimensions();


  // ── UI state ─────────────────────────────────────────────
  const [activePanel, setActivePanel] = useState<PanelId>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [friendPickerVisible, setFriendPickerVisible] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const queryClient = useQueryClient();

  // ── Friends data via useFriends hook ─────────────────────
  const {
    friends: dbFriends,
    fetchFriends,
    friendRequests,
    loadFriendRequests,
    acceptFriendRequest,
    declineFriendRequest,
    removeFriend,
    blockFriend,
    unblockFriend,
    blockedUsers = [],
    loading: friendsLoading,
    requestsLoading,
    fetchBlockedUsers,
  } = useFriends();

  // Realtime: instantly refresh friend links, requests, and consents on DB changes
  useSocialRealtime(user?.id, {
    onFriendRequestChange: loadFriendRequests,
    onFriendLinkChange: () => { fetchFriends(); },
    onFriendListChange: () => { fetchFriends(); },
  });

  // Link consent (new system) — pending link consent prompts
  const {
    data: pendingLinkConsents = [],
    isLoading: consentsLoading,
  } = usePendingLinkConsents(user?.id);

  const respondConsentMutation = useRespondLinkConsent();
  const [respondingConsentId, setRespondingConsentId] = useState<string | null>(null);

  const handleRespondConsent = useCallback(
    async (linkId: string, action: "accept" | "decline") => {
      if (respondConsentMutation.isPending) return;
      setRespondingConsentId(linkId);
      try {
        await respondConsentMutation.mutateAsync({ linkId, action });
        HapticFeedback.medium();
      } catch (err: unknown) {
        console.error("Error responding to link consent:", err);
        Alert.alert(
          "Something went wrong",
          err instanceof Error ? err.message : "Could not process your response. Please try again."
        );
      } finally {
        setRespondingConsentId(null);
      }
    },
    [respondConsentMutation]
  );

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: friendLinkKeys.all });
    await queryClient.invalidateQueries({ queryKey: linkConsentKeys.all });
    await fetchFriends();
    setIsRefreshing(false);
  }, [queryClient, fetchFriends]);

  // ── Mute tracking ────────────────────────────────────────
  const [mutedUserIds, setMutedUserIds] = useState<string[]>([]);

  const fetchMutedUsers = useCallback(async () => {
    const { data, error } = await muteService.getMutedUserIds();
    if (!error && data) {
      setMutedUserIds(data);
    }
  }, []);

  useEffect(() => {
    fetchMutedUsers();
  }, [fetchMutedUsers]);

  // ── Conversations data ───────────────────────────────────
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Messaging state ──────────────────────────────────────
  const [activeChat, setActiveChat] = useState<Friend | null>(null);
  const [showMessageInterface, setShowMessageInterface] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [messagesCache, setMessagesCache] = useState<Record<string, Message[]>>({});
  const [uploadingFile, setUploadingFile] = useState(false);
  const [activeChatIsBlocked, setActiveChatIsBlocked] = useState(false);
  const conversationChannelRef = useRef<any>(null);
  const broadcastSeenIds = useRef(new Set<string>());

  // Current user's display name — needed for broadcast payload
  const profile = useAppStore((state) => state.profile);
  const currentUserDisplayName = useMemo(() => {
    if (profile?.display_name) return profile.display_name;
    if (profile?.first_name && profile?.last_name)
      return `${profile.first_name} ${profile.last_name}`;
    if (profile?.username) return profile.username;
    return user?.email || "Unknown";
  }, [profile, user]);

  // ── Modal state (for MessageInterface actions) ───────────
  const [showAddToBoardModal, setShowAddToBoardModal] = useState(false);
  const [selectedFriendForBoard, setSelectedFriendForBoard] = useState<Friend | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [selectedUserToReport, setSelectedUserToReport] = useState<Friend | null>(null);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [selectedUserToBlock, setSelectedUserToBlock] = useState<Friend | null>(null);
  const [blockLoading, setBlockLoading] = useState(false);
  const [muteLoadingFriendId, setMuteLoadingFriendId] = useState<string | null>(null);

  // ── Derived data ─────────────────────────────────────────
  // Link requests (friend_links) are now handled in DiscoverScreen.
  // ConnectionsPage only shows legacy friend requests.
  const incomingRequests = useMemo(() => {
    return friendRequests
      .filter((r) => r.type === "incoming" && r.status === "pending")
      .map((r) => ({ ...r, _source: "legacy" as const }));
  }, [friendRequests]);

  // Sort conversations by most recent message
  const sortedConversations = useMemo(() => {
    const sorted = [...conversations].sort((a, b) => {
      const aTime = a.last_message?.created_at || a.created_at;
      const bTime = b.last_message?.created_at || b.created_at;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
    return sorted;
  }, [conversations]);

  // Search-filtered conversations
  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return sortedConversations;
    const q = searchQuery.toLowerCase();
    return sortedConversations.filter((conv) => {
      // Filter by participant name
      const nameMatch = conv.participants.some((p) => {
        const name = (
          p.display_name ||
          (p.first_name && p.last_name ? `${p.first_name} ${p.last_name}` : p.username) ||
          ""
        ).toLowerCase();
        return name.includes(q);
      });
      // Filter by last message content
      const contentMatch = (conv.last_message?.content || "").toLowerCase().includes(q);
      return nameMatch || contentMatch;
    });
  }, [sortedConversations, searchQuery]);

  // ── Shared conversation fetch + transform ─────────────────
  const fetchConversations = useCallback(async (userId: string) => {
    try {
      setError(null);

      // Hard 10-second timeout: messagingService.getConversations runs 4N sequential
      // Supabase queries with no built-in timeout. When the app returns from background,
      // the OS suspends inflight connections and Supabase hangs silently — the finally
      // block would never fire, leaving conversationsLoading stuck at true forever.
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => {
          const err = new Error('getConversations timed out after 10s');
          err.name = 'TimeoutError';
          reject(err);
        }, 10000)
      );

      const { conversations: rawConversations, error: convError } =
        await Promise.race([
          messagingService.getConversations(userId),
          timeoutPromise,
        ]);

      if (convError) throw new Error(convError);

      // Batch-fetch all participant profiles
      const allParticipantIds = new Set<string>();
      (rawConversations || []).forEach((conv) =>
        conv.participants.forEach((p) => allParticipantIds.add(p.user_id))
      );

      const { data: allProfiles } = await supabase
        .from("profiles")
        .select("id, display_name, username, first_name, last_name, avatar_url")
        .in("id", Array.from(allParticipantIds));

      const profilesMap = new Map(
        (allProfiles || []).map((p) => [p.id, p])
      );

      // Transform to Conversation type (matching useMessages format for ChatListItem)
      const transformed: Conversation[] = (rawConversations || []).map((conv) => {
        const participants = conv.participants.map((p) => {
          const profile = profilesMap.get(p.user_id);
          return {
            id: p.user_id,
            username: profile?.username || "unknown",
            display_name: profile?.display_name,
            first_name: profile?.first_name,
            last_name: profile?.last_name,
            avatar_url: profile?.avatar_url,
            is_online: false,
          };
        });

        return {
          id: conv.id,
          created_by: conv.created_by,
          created_at: conv.created_at,
          participants,
          last_message: conv.last_message || undefined,
          unread_count: conv.unread_count || 0,
          messages: [],
        };
      });

      setConversations(transformed);

      // Persist to cache
      AsyncStorage.setItem(
        getConversationsCacheKey(userId),
        JSON.stringify(transformed)
      ).catch((e) => console.warn("[ConnectionsPage] Cache persist failed:", e));
    } catch (err: any) {
      if (err.name === 'TimeoutError') {
        // Graceful degradation — network hung after background. User already sees cached
        // state (empty or populated). Do NOT set error: the timeout is expected recovery
        // behavior, not a failure. Setting error here would wipe the cache-hydrated empty
        // state and replace it with an error screen (regression).
        console.warn("[ConnectionsPage] fetchConversations timed out — network may be recovering after background");
      } else {
        console.error("Error fetching conversations:", err);
        setError("Failed to load conversations");
      }
    } finally {
      setConversationsLoading(false);
    }
  }, []);

  // ── Fetch conversations on mount ─────────────────────────
  useEffect(() => {
    if (!user?.id) return;

    // Hydrate from cache first
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(getConversationsCacheKey(user.id));
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) {
            // Empty array [] is a valid cached state: user has no conversations yet.
            // Previously this guard excluded zero-conversation users, forcing them to
            // always wait for the network fetch — causing infinite spinner on hang.
            setConversations(parsed);
            setConversationsLoading(false);
          }
        }
      } catch (e) {
        console.warn("[ConnectionsPage] Cache hydration failed:", e);
      }
    })();

    // Then fetch fresh data
    fetchConversations(user.id);
  }, [user?.id, fetchConversations]);

  // ── Fetch friends & requests on mount ────────────────────
  useEffect(() => {
    if (!user?.id) return;
    fetchFriends().catch((e) => console.error("Error fetching friends:", e));
    loadFriendRequests().catch((e) => console.error("Error fetching requests:", e));
  }, [user?.id, fetchFriends, loadFriendRequests]);

  // ── Unread count reporting ───────────────────────────────
  useEffect(() => {
    const totalUnread = conversations.reduce((sum, conv) => {
      const isMuted = conv.participants?.some((p) => mutedUserIds.includes(p.id));
      return sum + (isMuted ? 0 : (conv.unread_count || 0));
    }, 0);
    onUnreadCountChange?.(totalUnread);
  }, [conversations, onUnreadCountChange, mutedUserIds]);

  // ── Panel handler ────────────────────────────────────────
  const handleActionPress = (id: PanelId | "invite") => {
    HapticFeedback.light();
    if (id === "invite") {
      try {
        const inviteLink = `https://mingla.app/invite/${user?.id || ""}`;
        Clipboard.setString(inviteLink);
        Alert.alert("", "Invite link copied!");
      } catch (e) {
        console.error("Error copying invite link:", e);
      }
      return;
    }
    setActivePanel((prev) => (prev === id ? null : id));
  };

  // ── Friend request actions ───────────────────────────────
  const handleAcceptRequest = async (requestId: string) => {
    HapticFeedback.medium();
    try {
      await acceptFriendRequest(requestId);
      await loadFriendRequests();
      await fetchFriends();
    } catch (e) {
      console.error("Error accepting request:", e);
      Alert.alert("Error", "Failed to accept friend request.");
    }
  };

  const handleDeclineRequest = async (requestId: string) => {
    HapticFeedback.warning();
    try {
      await declineFriendRequest(requestId);
      await loadFriendRequests();
    } catch (e) {
      console.error("Error declining request:", e);
      Alert.alert("Error", "Failed to decline friend request.");
    }
  };

  // ── Unblock handler ──────────────────────────────────────
  const handleUnblock = async (blockedUserId: string) => {
    try {
      await unblockFriend(blockedUserId);
      await fetchBlockedUsers();
    } catch (e) {
      console.error("Error unblocking user:", e);
      Alert.alert("Error", "Failed to unblock user.");
    }
  };

  // ── Transform message from DirectMessage to MessageInterface format ──
  const transformMessage = useCallback(
    (msg: DirectMessage, userId: string): Message => ({
      id: msg.id,
      senderId: msg.sender_id,
      senderName: msg.sender_name || "Unknown",
      content: msg.content,
      timestamp: msg.created_at,
      type: msg.message_type,
      fileUrl: msg.file_url,
      fileName: msg.file_name,
      fileSize: msg.file_size?.toString(),
      isMe: msg.sender_id === userId,
      unread: !msg.is_read && msg.sender_id !== userId,
    }),
    []
  );

  // ── Select conversation from chat list ───────────────────
  const handleSelectConversation = async (conversation: Conversation) => {
    if (!user?.id) return;

    const otherParticipant = conversation.participants.find((p) => p.id !== user.id);
    const rawName =
      otherParticipant?.display_name ||
      (otherParticipant?.first_name && otherParticipant?.last_name
        ? `${otherParticipant.first_name} ${otherParticipant.last_name}`
        : otherParticipant?.username) ||
      "Unknown";

    // Clean email-like names
    const cleanedName = rawName.includes("@")
      ? rawName.substring(0, rawName.indexOf("@")).trim()
      : rawName;

    const friend: Friend = {
      id: otherParticipant?.id || "",
      name: cleanedName,
      username: otherParticipant?.username || "unknown",
      avatar: otherParticipant?.avatar_url,
      status: "offline",
      isOnline: otherParticipant?.is_online || false,
    };

    // Check block status
    const hasBlock = await blockService.hasBlockBetween(friend.id);
    setActiveChatIsBlocked(hasBlock);

    setActiveChat(friend);
    setCurrentConversationId(conversation.id);

    // Load messages from cache or network
    const cachedMessages = messagesCache[conversation.id];

    if (cachedMessages && cachedMessages.length > 0) {
      setMessages(cachedMessages);
      setShowMessageInterface(true);

      // Refresh in background
      (async () => {
        try {
          const { messages: freshMsgs, error: msgError } =
            await messagingService.getMessages(conversation.id, user.id);
          if (!msgError && freshMsgs) {
            const transformed = freshMsgs.map((m) => transformMessage(m, user.id));
            setMessages(transformed);
            setMessagesCache((prev) => ({ ...prev, [conversation.id]: transformed }));
          }
        } catch (e) {
          console.error("Error refreshing messages:", e);
        }
      })();
    } else {
      try {
        const { messages: freshMsgs, error: msgError } =
          await messagingService.getMessages(conversation.id, user.id);
        if (msgError) {
          console.error("Error loading messages:", msgError);
          setMessages([]);
        } else {
          const transformed = (freshMsgs || []).map((m) => transformMessage(m, user.id));
          setMessages(transformed);
          setMessagesCache((prev) => ({ ...prev, [conversation.id]: transformed }));
        }
      } catch (e) {
        console.error("Error loading messages:", e);
        setMessages([]);
      }
      setShowMessageInterface(true);
    }

    // Real-time subscription
    setupRealtimeSubscription(conversation.id, user.id);
  };

  // ── Start new conversation from friend picker ────────────
  const handlePickFriend = async (friend: UseFriend) => {
    if (!user?.id) return;

    const friendUserId = friend.friend_user_id || friend.id;

    // Check block status
    const hasBlock = await blockService.hasBlockBetween(friendUserId);
    setActiveChatIsBlocked(hasBlock);

    const displayName =
      friend.display_name ||
      (friend.first_name && friend.last_name
        ? `${friend.first_name} ${friend.last_name}`
        : friend.username) ||
      "Unknown";

    const chatFriend: Friend = {
      id: friendUserId,
      name: displayName,
      username: friend.username || "unknown",
      avatar: friend.avatar_url,
      status: "offline",
      isOnline: false,
    };

    setActiveChat(chatFriend);
    setFriendPickerVisible(false);

    try {
      const { conversation, error: convError } =
        await messagingService.getOrCreateDirectConversation(user.id, friendUserId);

      if (convError || !conversation) {
        console.error("Error getting conversation:", convError);
        setActiveChat(null);
        return;
      }

      setCurrentConversationId(conversation.id);

      // Load messages
      const { messages: freshMsgs, error: msgError } =
        await messagingService.getMessages(conversation.id, user.id);
      if (msgError) {
        setMessages([]);
      } else {
        const transformed = (freshMsgs || []).map((m) => transformMessage(m, user.id));
        setMessages(transformed);
        setMessagesCache((prev) => ({ ...prev, [conversation.id]: transformed }));
      }

      setShowMessageInterface(true);
      setupRealtimeSubscription(conversation.id, user.id);
    } catch (e) {
      console.error("Error creating conversation:", e);
      setActiveChat(null);
    }
  };

  // ── Realtime subscription setup ──────────────────────────
  const setupRealtimeSubscription = (conversationId: string, userId: string) => {
    // Mark unread as read
    (async () => {
      try {
        const cached = messagesCache[conversationId] || [];
        const unreadIds = cached
          .filter((msg) => !msg.isMe && msg.unread)
          .map((msg) => msg.id);
        if (unreadIds.length > 0) {
          messagingService.markAsRead(unreadIds, userId).catch(console.error);
        }
      } catch (e) {
        console.error("Error marking as read:", e);
      }
    })();

    // Cleanup existing subscription
    if (conversationChannelRef.current) {
      messagingService.unsubscribeFromConversation(conversationId);
    }

    conversationChannelRef.current = messagingService.subscribeToConversation(
      conversationId,
      userId,
      {
        onMessage: (newMessage: DirectMessage) => {
          // Broadcast dedup: if broadcast already delivered this message to
          // the UI, skip the message-add but still run all side effects
          // (cache sync, conversation list update, auto-mark-as-read).
          const alreadyDelivered = broadcastSeenIds.current.has(newMessage.id);

          if (!alreadyDelivered) {
            const transformedMsg = transformMessage(newMessage, userId);

            // Add to messages (replace optimistic or add new)
            setMessages((prev) => {
              const exists = prev.some((msg) => msg.id === transformedMsg.id);
              if (exists) return prev;

              const optimisticIndex = prev.findIndex(
                (msg) =>
                  msg.id.startsWith("temp-") &&
                  msg.senderId === transformedMsg.senderId &&
                  msg.content === transformedMsg.content &&
                  Math.abs(
                    new Date(msg.timestamp).getTime() -
                      new Date(transformedMsg.timestamp).getTime()
                  ) < 5000
              );

              if (optimisticIndex !== -1) {
                const updated = [...prev];
                updated[optimisticIndex] = transformedMsg;
                return updated;
              }

              return [...prev, transformedMsg];
            });
          }

          // Cache update ALWAYS runs (even if broadcast already delivered to UI)
          const transformedForCache = transformMessage(newMessage, userId);
          setMessagesCache((prev) => {
            const existing = prev[conversationId] || [];
            const exists = existing.some((msg) => msg.id === transformedForCache.id);
            if (exists) return prev;

            const optimisticIndex = existing.findIndex(
              (msg) =>
                msg.id.startsWith("temp-") &&
                msg.senderId === transformedForCache.senderId &&
                msg.content === transformedForCache.content &&
                Math.abs(
                  new Date(msg.timestamp).getTime() -
                    new Date(transformedForCache.timestamp).getTime()
                ) < 5000
            );

            if (optimisticIndex !== -1) {
              const updated = [...existing];
              updated[optimisticIndex] = transformedForCache;
              return { ...prev, [conversationId]: updated };
            }

            return { ...prev, [conversationId]: [...existing, transformedForCache] };
          });

          // Conversation list update ALWAYS runs
          setConversations((prev) =>
            prev.map((conv) => {
              if (conv.id === conversationId) {
                return {
                  ...conv,
                  last_message: newMessage,
                  unread_count:
                    newMessage.sender_id !== userId
                      ? (conv.unread_count || 0) + 1
                      : conv.unread_count,
                };
              }
              return conv;
            })
          );

          // Auto-mark as read ALWAYS runs
          if (newMessage.sender_id !== userId) {
            messagingService.markAsRead([newMessage.id], userId).catch(console.error);
          }
        },

        // Read receipt flow: when the receiver marks a message as read,
        // the sync_message_read_status trigger sets is_read=true on the
        // messages row, which fires a postgres_changes UPDATE event.
        // This callback updates the sender's UI with the read state.
        onMessageUpdated: (updatedMessage: DirectMessage) => {
          const transformed = transformMessage(updatedMessage, userId);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === transformed.id ? { ...msg, ...transformed } : msg
            )
          );
          setMessagesCache((prev) => {
            const existing = prev[conversationId] || [];
            return {
              ...prev,
              [conversationId]: existing.map((msg) =>
                msg.id === transformed.id ? { ...msg, ...transformed } : msg
              ),
            };
          });
        },
      }
    );
  };

  // ── Back from MessageInterface ───────────────────────────
  const handleBackFromMessage = useCallback(() => {
    if (currentConversationId && conversationChannelRef.current) {
      messagingService.unsubscribeFromConversation(currentConversationId);
      conversationChannelRef.current = null;
    }

    setShowMessageInterface(false);
    setActiveChat(null);
    setCurrentConversationId(null);
    setMessages([]);
    setActiveChatIsBlocked(false);
    broadcastSeenIds.current.clear();

    // Refresh conversations to get updated unread counts
    if (user?.id) {
      fetchConversations(user.id);
    }
  }, [currentConversationId, user?.id, fetchConversations]);

  // ── Send message ─────────────────────────────────────────
  const handleSendMessage = async (
    content: string,
    type: "text" | "image" | "video" | "file",
    file?: any
  ) => {
    if (!activeChat || !user?.id || !currentConversationId) return;

    // Check block before sending
    const hasBlock = await blockService.hasBlockBetween(activeChat.id);
    if (hasBlock) {
      Alert.alert(
        "Message Not Sent",
        "Messaging is not available with this user. One of you may have blocked the other."
      );
      return;
    }

    const tempId = `temp-${Date.now()}-${Math.random()}`;
    const now = new Date().toISOString();

    // Upload file if needed
    let fileUrl: string | undefined;
    let fileName: string | undefined;
    let fileSize: number | undefined;

    if (file && type !== "text") {
      setUploadingFile(true);
      try {
        const fileUri = file.uri || file;
        const fileExt =
          file.name?.split(".").pop() ||
          (file.type === "image" ? "jpg" : file.type === "video" ? "mp4" : fileUri.split(".").pop() || "bin");
        const fileNameWithExt = `${user.id}_${Date.now()}.${fileExt}`;
        const filePath = `${currentConversationId}/${fileNameWithExt}`;

        let contentType = "application/octet-stream";
        if (type === "image") contentType = file.type === "image" ? "image/jpeg" : "image/png";
        else if (type === "video") contentType = "video/mp4";

        const formData = new FormData();
        formData.append("file", {
          uri: fileUri,
          type: contentType,
          name: fileNameWithExt,
        } as any);

        const { error: uploadError } = await supabase.storage
          .from("messages")
          .upload(filePath, formData, { contentType, upsert: false });

        if (uploadError) {
          console.error("Error uploading file:", uploadError);
          setUploadingFile(false);
          Alert.alert("Upload Error", "Failed to upload file. Please try again.");
          return;
        }

        const { data: urlData } = supabase.storage.from("messages").getPublicUrl(filePath);
        fileUrl = urlData.publicUrl;
        fileName = file.name || fileNameWithExt;
        fileSize = file.size || 0;
        setUploadingFile(false);
      } catch (e) {
        console.error("Error uploading file:", e);
        setUploadingFile(false);
        Alert.alert("Upload Error", "Failed to upload file. Please try again.");
        return;
      }
    }

    // Optimistic message
    const optimisticMsg: Message = {
      id: tempId,
      senderId: user.id,
      senderName: "Me",
      content,
      timestamp: now,
      type,
      fileUrl,
      fileName,
      fileSize: fileSize?.toString(),
      isMe: true,
      unread: false,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setMessagesCache((prev) => ({
      ...prev,
      [currentConversationId]: [...(prev[currentConversationId] || []), optimisticMsg],
    }));

    // Update conversation list optimistically
    setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id === currentConversationId) {
          return {
            ...conv,
            last_message: {
              id: tempId,
              conversation_id: currentConversationId,
              sender_id: user.id,
              content,
              message_type: type as "text" | "image" | "file",
              file_url: fileUrl,
              file_name: fileName,
              file_size: fileSize,
              created_at: now,
              sender_name: "Me",
              is_read: true,
            },
          };
        }
        return conv;
      })
    );

    try {
      const { message: sentMessage, error: sendError } =
        await messagingService.sendMessage(
          currentConversationId,
          user.id,
          content,
          type,
          fileUrl,
          fileName,
          fileSize
        );

      if (sendError || !sentMessage) {
        console.error("Error sending message:", sendError);

        // Mark optimistic message as failed (not removed — user sees retry state)
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === tempId ? { ...msg, failed: true } : msg
          )
        );
        setMessagesCache((prev) => ({
          ...prev,
          [currentConversationId]: (prev[currentConversationId] || []).map(
            (msg) => (msg.id === tempId ? { ...msg, failed: true } : msg)
          ),
        }));

        if (
          sendError?.includes("Cannot") ||
          sendError?.includes("blocked") ||
          sendError?.includes("policy")
        ) {
          Alert.alert(
            "Message Not Sent",
            "You cannot send messages to this user. They may have blocked you or you may have blocked them."
          );
        } else {
          Alert.alert(
            "Message Not Sent",
            "Failed to send message. Please check your connection and try again."
          );
        }
        return;
      }

      // CRITICAL: Replace temp ID with real ID in messages state
      const realMsg = transformMessage(sentMessage, user.id);

      setMessages((prev) =>
        prev.map((msg) => (msg.id === tempId ? realMsg : msg))
      );

      setMessagesCache((prev) => {
        const existing = prev[currentConversationId] || [];
        return {
          ...prev,
          [currentConversationId]: existing.map((msg) =>
            msg.id === tempId ? realMsg : msg
          ),
        };
      });

      // Update conversation with real message
      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id === currentConversationId) {
            return { ...conv, last_message: sentMessage };
          }
          return conv;
        })
      );

      // Add real ID to broadcast seen set so postgres_changes backup won't dupe
      broadcastSeenIds.current.add(sentMessage.id);

      // Broadcast to other participants (instant delivery <500ms)
      try {
        const channelName = `chat:${currentConversationId}`;
        const broadcastChannel = supabase.channel(channelName);
        broadcastChannel.send({
          type: "broadcast",
          event: "new_message",
          payload: {
            ...sentMessage,
            sender_name: currentUserDisplayName,
          },
        });
      } catch (broadcastErr) {
        // Broadcast failure is non-fatal — postgres_changes will deliver
        console.warn("Broadcast send failed (non-fatal):", broadcastErr);
      }
    } catch (e) {
      console.error("Error sending message:", e);
      // Mark as failed instead of removing
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === tempId ? { ...msg, failed: true } : msg
        )
      );
      setMessagesCache((prev) => ({
        ...prev,
        [currentConversationId]: (prev[currentConversationId] || []).map(
          (msg) => (msg.id === tempId ? { ...msg, failed: true } : msg)
        ),
      }));
    }
  };

  // ── Collaboration session cleanup ────────────────────────
  const cleanupSharedSessions = async (otherUserId: string) => {
    try {
      if (!user) return;
      const { data: otherUserSessions, error: fetchError } = await supabase
        .from("session_participants")
        .select("session_id")
        .eq("user_id", otherUserId);
      if (fetchError || !otherUserSessions?.length) return;

      const sessionIds = otherUserSessions.map((s: any) => s.session_id);
      const { data: mySharedSessions, error: myError } = await supabase
        .from("session_participants")
        .select("session_id")
        .eq("user_id", user.id)
        .in("session_id", sessionIds);
      if (myError || !mySharedSessions?.length) return;

      const sharedSessionIds = mySharedSessions.map((s: any) => s.session_id);
      for (const sessionId of sharedSessionIds) {
        const { count, error: countError } = await supabase
          .from("session_participants")
          .select("id", { count: "exact", head: true })
          .eq("session_id", sessionId);
        if (countError) continue;
        if (count !== null && count <= 2) {
          await supabase.from("collaboration_invites").delete().eq("session_id", sessionId);
          await supabase.from("collaboration_sessions").delete().eq("id", sessionId);
        }
      }
    } catch (e) {
      console.error("Error cleaning up shared sessions:", e);
    }
  };

  // ── MessageInterface callback handlers ───────────────────
  const handleSendCollabInvite = (friend: Friend) => {
    onSendCollabInvite?.(friend);
  };

  const handleAddToBoard = (friend: Friend) => {
    setSelectedFriendForBoard(friend);
    setShowAddToBoardModal(true);
  };

  const handleAddToBoardConfirm = (sessionIds: string[], friend: Friend) => {
    onAddToBoard?.(sessionIds, friend);
    setShowAddToBoardModal(false);
    setSelectedFriendForBoard(null);
  };

  const handleShareSavedCard = (friend: Friend) => {
    onShareSavedCard?.(friend);
  };

  const handleRemoveFriend = (friend: Friend) => {
    Alert.alert(
      "Remove Friend",
      `Are you sure you want to remove ${friend.name} as a friend?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await cleanupSharedSessions(friend.id);
              await removeFriend(friend.id);
              await fetchFriends();
              onRemoveFriend?.(friend);
              mixpanelService.trackFriendRemoved({
                friendName: friend.name,
                friendUsername: friend.username,
              });
            } catch (e) {
              console.error("Error removing friend:", e);
              Alert.alert("Error", "Failed to remove friend. Please try again.");
            }
          },
        },
      ]
    );
  };

  const handleMuteUser = async (friend: Friend) => {
    if (muteLoadingFriendId) return;
    setMuteLoadingFriendId(friend.id);
    try {
      const { success, isMuted, error: muteError } = await muteService.toggleMuteUser(friend.id);
      if (success) {
        setMutedUserIds((prev) =>
          isMuted ? [...prev, friend.id] : prev.filter((id) => id !== friend.id)
        );
        Alert.alert(
          isMuted ? "Friend Muted" : "Friend Unmuted",
          isMuted
            ? `You will no longer receive notifications from ${friend.name}.`
            : `You will now receive notifications from ${friend.name}.`,
          [{ text: "OK" }]
        );
      } else {
        Alert.alert("Error", muteError || "Failed to update mute status.");
      }
    } catch (e) {
      console.error("Error toggling mute:", e);
      Alert.alert("Error", "Failed to update mute status.");
    } finally {
      setMuteLoadingFriendId(null);
    }
  };

  const handleBlockUser = (friend: Friend) => {
    setSelectedUserToBlock(friend);
    setShowBlockModal(true);
  };

  const handleBlockConfirm = async (reason?: BlockReason) => {
    if (!selectedUserToBlock) return;
    setBlockLoading(true);
    try {
      await cleanupSharedSessions(selectedUserToBlock.id);
      await blockFriend(selectedUserToBlock.id, reason);
      onBlockUser?.(selectedUserToBlock);
      await fetchFriends();
      await fetchBlockedUsers();
      mixpanelService.trackFriendBlocked({
        blockedUserName: selectedUserToBlock.name,
        blockedUserUsername: selectedUserToBlock.username,
        reason,
      });
      setShowBlockModal(false);
      setSelectedUserToBlock(null);
    } catch (e) {
      console.error("Error blocking user:", e);
      Alert.alert("Error", "Failed to block user. Please try again.");
    } finally {
      setBlockLoading(false);
    }
  };

  const handleReportUser = (friend: Friend) => {
    onBlockUser?.(friend, true);
    setSelectedUserToReport(friend);
    setShowReportModal(true);
  };

  const handleReportSubmit = async (userId: string, reason: string, details?: string) => {
    try {
      const result = await reportService.submitReport(userId, reason as ReportReason, details);
      setShowReportModal(false);
      setSelectedUserToReport(null);
      if (result.success) {
        Alert.alert(
          "Report Submitted",
          "Thank you for your report. Our moderation team will review it shortly.",
          [{ text: "OK" }]
        );
        onReportUser?.(selectedUserToReport, true);
      } else {
        Alert.alert("Report Failed", result.error || "Unable to submit report.", [{ text: "OK" }]);
      }
    } catch (e) {
      console.error("Error submitting report:", e);
      setShowReportModal(false);
      setSelectedUserToReport(null);
      Alert.alert("Error", "An unexpected error occurred.", [{ text: "OK" }]);
    }
  };

  // ── Error state ──────────────────────────────────────────
  if (error && conversations.length === 0) {
    return (
      <>
        <View style={styles.container}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Chats</Text>
            <View style={styles.headerActions}>
              <TouchableOpacity
                onPress={() => handleActionPress("add")}
                style={[styles.headerIconBtn, activePanel === "add" && styles.headerIconBtnActive]}
                activeOpacity={0.7}
              >
                <Ionicons name="person-add-outline" size={18} color={activePanel === "add" ? "#ffffff" : "#eb7825"} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleActionPress("requests")}
                style={[styles.headerIconBtn, activePanel === "requests" && styles.headerIconBtnActive]}
                activeOpacity={0.7}
              >
                <Ionicons name="people-outline" size={18} color={activePanel === "requests" ? "#ffffff" : "#eb7825"} />
                {incomingRequests.length > 0 && (
                  <View style={styles.headerBadge}>
                    <Text style={styles.headerBadgeText}>
                      {incomingRequests.length > 9 ? "9+" : incomingRequests.length}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => {
                setConversationsLoading(true);
                if (user?.id) {
                  fetchConversations(user.id);
                }
                fetchFriends();
                loadFriendRequests();
              }}
            >
              <Text style={styles.retryButtonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Action Panel Bottom Sheet (accessible even in error state) */}
        <Modal
  visible={activePanel !== null}
  animationType="slide"
  transparent
  onRequestClose={() => setActivePanel(null)}
>
  <KeyboardAvoidingView
    style={styles.modalRoot}
    behavior={Platform.OS === "ios" ? "padding" : "height"}
    keyboardVerticalOffset={0}
  >
    <View style={styles.sheetOverlay}>
      <TouchableWithoutFeedback onPress={() => setActivePanel(null)}>
        <View style={styles.backdropFill} />
      </TouchableWithoutFeedback>

      <View
        style={[styles.sheetContainer, { maxHeight: screenHeight * 0.75 }]}
        onStartShouldSetResponder={() => true}
      >
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>
            {activePanel === "add" ? "Add Friend" : "Friend Requests"}
          </Text>
          <TouchableOpacity onPress={() => setActivePanel(null)} activeOpacity={0.7}>
            <Ionicons name="close" size={24} color="#6b7280" />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.sheetBody}
          contentContainerStyle={styles.sheetBodyContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {activePanel === "add" && (
            <AddFriendView
              currentUserId={user?.id || ""}

              onRequestSent={() => loadFriendRequests()}
            />
          )}
          {activePanel === "requests" && (
            <>
              <RequestsView
                requests={incomingRequests}
                loading={friendsLoading || requestsLoading}
                onAccept={handleAcceptRequest}
                onDecline={handleDeclineRequest}
              />
              {pendingLinkConsents.length > 0 && (
                <View style={styles.linkConsentSection}>
                  <Text style={styles.linkConsentSectionTitle}>Link Requests</Text>
                  {pendingLinkConsents.map((consent) => (
                    <LinkConsentCard
                      key={consent.linkId}
                      consent={consent}
                      onRespond={handleRespondConsent}
                      isResponding={respondingConsentId === consent.linkId}
                    />
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </View>
  </KeyboardAvoidingView>
</Modal>
      </>
    );
  }

  // ── When viewing a conversation ──────────────────────────
  if (showMessageInterface && activeChat) {
    return (
      <>
        <View style={styles.container}>
          <MessageInterface
            friend={activeChat}
            onBack={handleBackFromMessage}
            onSendMessage={handleSendMessage}
            messages={messages}
            onSendCollabInvite={handleSendCollabInvite}
            onAddToBoard={onAddToBoard}
            onShareSavedCard={handleShareSavedCard}
            onRemoveFriend={handleRemoveFriend}
            onBlockUser={handleBlockUser}
            onReportUser={handleReportUser}
            boardsSessions={boardsSessions}
            currentMode={currentMode}
            onModeChange={onModeChange}
            onUpdateBoardSession={onUpdateBoardSession}
            onCreateSession={onCreateSession}
            onNavigateToBoard={onNavigateToBoard}
            availableFriends={[]}
            isBlocked={activeChatIsBlocked}
            conversationId={currentConversationId}
            currentUserId={user?.id || null}
            currentUserName={currentUserDisplayName}
            broadcastSeenIds={broadcastSeenIds}
          />
        </View>

        <AddToBoardModal
          isOpen={showAddToBoardModal}
          onClose={() => {
            setShowAddToBoardModal(false);
            setSelectedFriendForBoard(null);
          }}
          friend={selectedFriendForBoard}
          boardsSessions={boardsSessions}
          onConfirm={handleAddToBoardConfirm}
        />
        <ReportUserModal
          isOpen={showReportModal}
          onClose={() => {
            setShowReportModal(false);
            setSelectedUserToReport(null);
          }}
          user={
            selectedUserToReport
              ? { id: selectedUserToReport.id, name: selectedUserToReport.name, username: selectedUserToReport.username }
              : { id: "", name: "", username: "" }
          }
          onReport={handleReportSubmit}
        />
        <BlockUserModal
          visible={showBlockModal}
          onClose={() => {
            if (!blockLoading) {
              setShowBlockModal(false);
              setSelectedUserToBlock(null);
            }
          }}
          onConfirm={handleBlockConfirm}
          userName={selectedUserToBlock?.name || selectedUserToBlock?.username || "this user"}
          loading={blockLoading}
        />
      </>
    );
  }

  // ── Main chat list view ──────────────────────────────────
  return (
    <>
      <View style={styles.container}>
        <View style={styles.content}>
          {/* Compact header: title + action icons */}
          <View style={styles.headerRow}>
            <Text style={styles.title}>Chats</Text>
            <View style={styles.headerActions}>
              <TouchableOpacity
                onPress={() => handleActionPress("add")}
                style={[styles.headerIconBtn, activePanel === "add" && styles.headerIconBtnActive]}
                activeOpacity={0.7}
              >
                <Ionicons name="person-add-outline" size={18} color={activePanel === "add" ? "#ffffff" : "#eb7825"} />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => handleActionPress("requests")}
                style={[styles.headerIconBtn, activePanel === "requests" && styles.headerIconBtnActive]}
                activeOpacity={0.7}
              >
                <Ionicons name="people-outline" size={18} color={activePanel === "requests" ? "#ffffff" : "#eb7825"} />
                {incomingRequests.length > 0 && (
                  <View style={styles.headerBadge}>
                    <Text style={styles.headerBadgeText}>
                      {incomingRequests.length > 9 ? "9+" : incomingRequests.length}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => handleActionPress("blocked")}
                style={[styles.headerIconBtn, activePanel === "blocked" && styles.headerIconBtnActive]}
                activeOpacity={0.7}
              >
                <Ionicons name="ban-outline" size={18} color={activePanel === "blocked" ? "#ffffff" : "#eb7825"} />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => handleActionPress("invite")}
                style={styles.headerIconBtn}
                activeOpacity={0.7}
              >
                <Ionicons name="link-outline" size={18} color="#eb7825" />
              </TouchableOpacity>

              <View style={styles.headerDivider} />

              <TouchableOpacity
                onPress={() => setFriendPickerVisible(true)}
                style={styles.composeBtn}
                activeOpacity={0.7}
              >
                <Ionicons name="create-outline" size={18} color="#ffffff" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Search bar */}
          <View style={styles.searchContainer}>
            <Ionicons
              name="search"
              size={16}
              color="#9ca3af"
              style={styles.searchIcon}
            />
            <TextInput
              placeholder="Search chats..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={styles.searchInput}
              placeholderTextColor="#9ca3af"
              autoCapitalize="none"
            />
          </View>

          {/* Chat list */}
          {conversationsLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#eb7825" />
            </View>
          ) : filteredConversations.length === 0 && !searchQuery.trim() ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="chatbubbles-outline" size={56} color="#d1d5db" />
              <Text style={styles.emptyTitle}>Your chats live here</Text>
              <Text style={styles.emptySubtitle}>Tap the compose button to start a conversation</Text>
              <TouchableOpacity
                onPress={() => setFriendPickerVisible(true)}
                style={styles.emptyCtaButton}
                activeOpacity={0.7}
              >
                <Text style={styles.emptyCtaText}>Start a chat</Text>
              </TouchableOpacity>
            </View>
          ) : filteredConversations.length === 0 && searchQuery.trim() ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="search" size={48} color="#d1d5db" />
              <Text style={styles.emptyTitle}>No results</Text>
            </View>
          ) : (
            <FlatList
              data={filteredConversations}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item, index }) => {
                const isMuted = item.participants?.some((p) =>
                  mutedUserIds.includes(p.id)
                );
                const chatItem = (
                  <ChatListItem
                    conversation={item}
                    currentUserId={user?.id || ""}
                    onPress={handleSelectConversation}
                    isMuted={isMuted}
                    onAvatarPress={onNavigateToFriendProfile}
                  />
                );
                if (index === 0) {
                  return (
                    <View>
                      {chatItem}
                    </View>
                  );
                }
                return chatItem;
              }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.chatListContent}
              ItemSeparatorComponent={() => <View style={styles.chatSeparator} />}
              refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor="#999" />}
            />
          )}
        </View>
      </View>

      {/* Action Panel Bottom Sheet */}
      <Modal
  visible={activePanel !== null}
  animationType="slide"
  transparent
  onRequestClose={() => setActivePanel(null)}
>
  <KeyboardAvoidingView
    style={styles.modalRoot}
    behavior={Platform.OS === "ios" ? "padding" : "height"}
    keyboardVerticalOffset={0}
  >
    <View style={styles.sheetOverlay}>
      <TouchableWithoutFeedback onPress={() => setActivePanel(null)}>
        <View style={styles.backdropFill} />
      </TouchableWithoutFeedback>

      <View
        style={[styles.sheetContainer, { maxHeight: screenHeight * 0.75 }]}
        onStartShouldSetResponder={() => true}
      >
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>
            {activePanel === "add"
              ? "Add Friend"
              : activePanel === "requests"
              ? "Friend Requests"
              : "Blocked Users"}
          </Text>
          <TouchableOpacity onPress={() => setActivePanel(null)} activeOpacity={0.7}>
            <Ionicons name="close" size={24} color="#6b7280" />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.sheetBody}
          contentContainerStyle={styles.sheetBodyContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {activePanel === "add" && (
            <AddFriendView
              currentUserId={user?.id || ""}

              onRequestSent={() => loadFriendRequests()}
            />
          )}
          {activePanel === "requests" && (
            <>
              <RequestsView
                requests={incomingRequests}
                loading={friendsLoading || requestsLoading}
                onAccept={handleAcceptRequest}
                onDecline={handleDeclineRequest}
              />
              {pendingLinkConsents.length > 0 && (
                <View style={styles.linkConsentSection}>
                  <Text style={styles.linkConsentSectionTitle}>Link Requests</Text>
                  {pendingLinkConsents.map((consent) => (
                    <LinkConsentCard
                      key={consent.linkId}
                      consent={consent}
                      onRespond={handleRespondConsent}
                      isResponding={respondingConsentId === consent.linkId}
                    />
                  ))}
                </View>
              )}
            </>
          )}
          {activePanel === "blocked" && (
            <BlockedUsersView
              blockedUsers={blockedUsers}
              loading={friendsLoading}
              onUnblock={handleUnblock}
            />
          )}
        </ScrollView>
      </View>
    </View>
  </KeyboardAvoidingView>
</Modal>

      {/* Friend Picker Sheet */}
      <FriendPickerSheet
        visible={friendPickerVisible}
        onClose={() => setFriendPickerVisible(false)}
        onSelectFriend={handlePickFriend}
        friends={dbFriends}
        loadingFriends={friendsLoading}
      />
    </>
  );
}

const styles = StyleSheet.create({
  linkConsentSection: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.gray[200],
  },
  linkConsentSectionTitle: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.gray[500],
    marginBottom: spacing.xs,
  },
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  content: {
    flex: 1,
  },
  modalRoot: {
  flex: 1,
},
backdropFill: {
  ...StyleSheet.absoluteFillObject,
},
  // ── Header ────────────────────────────────
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 15,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#6B7280",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerDivider: {
    width: 1,
    height: 20,
    backgroundColor: "#E5E7EB",
    marginHorizontal: 2,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff7ed",
    position: "relative",
  },
  headerIconBtnActive: {
    backgroundColor: "#eb7825",
  },
  headerBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    backgroundColor: "#ef4444",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: "#ffffff",
  },
  headerBadgeText: {
    fontSize: 9,
    color: "#ffffff",
    fontWeight: "700",
  },
  composeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eb7825",
  },
  // ── Search ────────────────────────────────
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 6,
    backgroundColor: "#f3f4f6",
    borderRadius: 20,
    paddingHorizontal: 14,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 9,
    fontSize: 15,
    color: "#111827",
  },
  // ── Chat list ─────────────────────────────
  chatListContent: {
    paddingBottom: 16,
  },
  chatSeparator: {
    height: 1,
    backgroundColor: "#f3f4f6",
    marginLeft: 78,
    marginRight: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  // ── Empty state ───────────────────────────
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#111827",
    marginTop: 14,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#9ca3af",
    textAlign: "center",
    marginTop: 6,
  },
  emptyCtaButton: {
    marginTop: 20,
    backgroundColor: "#eb7825",
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
  },
  emptyCtaText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  // ── Error state ───────────────────────────
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    color: "#ef4444",
    textAlign: "center",
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: "#eb7825",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "500",
  },
  // ── Bottom Sheet ──────────────────────────
  sheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  sheetContainer: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: "#d1d5db",
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 8,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
  },
sheetBody: {
  flexGrow: 0,
},
sheetBodyContent: {
  paddingTop: 8,
  paddingBottom: 24,
},
});
