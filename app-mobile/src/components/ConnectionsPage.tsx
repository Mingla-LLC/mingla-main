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
  Platform,
  ScrollView,
  useWindowDimensions,
  RefreshControl,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Icon } from "./ui/Icon";
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
import { useScreenLogger } from "../hooks/useScreenLogger";
import { useKeyboard } from "../hooks/useKeyboard";
import { colors, spacing, typography, fontWeights } from "../constants/designSystem";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNetworkMonitor } from "../services/networkMonitor";
import { withTimeout } from "../utils/withTimeout";
import { useToast } from "./ToastManager";
import { showMutationError } from "../utils/showMutationError";
import { getDisplayName } from "../utils/getDisplayName";

// Sub-components
import { ChatListItem } from "./connections/ChatListItem";
import { FriendPickerSheet } from "./connections/FriendPickerSheet";
import { AddFriendView } from "./connections/AddFriendView";
import { RequestsView } from "./connections/RequestsView";
import { FriendsManagementList } from "./connections/FriendsManagementList";
import { BlockedUsersView } from "./connections/BlockedUsersView";
import MessageInterface from "./MessageInterface";

type PanelId = "add" | "friends" | "blocked" | null;

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
  onUnreadCountChange?: (count: number) => void;
  onNavigateToFriendProfile?: (userId: string) => void;
  onFriendAccepted?: () => void;
}

const CONNECTIONS_CACHE_VERSION = "v1";

const getConversationsCacheKey = (userId: string) =>
  `mingla:connections:conversations:${CONNECTIONS_CACHE_VERSION}:${userId}`;

const getMessagesCacheKey = (conversationId: string) =>
  `mingla:connections:messages:${CONNECTIONS_CACHE_VERSION}:${conversationId}`;

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
  onUnreadCountChange,
  onNavigateToFriendProfile,
  onFriendAccepted,
}: ConnectionsPageProps) {
  useScreenLogger('connections');
  const user = useAppStore((state) => state.user);
  const { height: screenHeight } = useWindowDimensions();

  // ── Keyboard-aware sheet height ────────────────────────────
  // Replaces KeyboardAvoidingView which conflicts with fixed-height sheets.
  // Captures the window height BEFORE the keyboard opens so Android's
  // adjustResize doesn't pollute the baseline, then subtracts keyboard height.
  const chatInsets = useSafeAreaInsets();
  const {
    isVisible: keyboardVisible,
    keyboardHeight: rawKeyboardHeight,
    dismiss: dismissKeyboard,
  } = useKeyboard({ disableLayoutAnimation: true });
  // iOS keyboardHeight includes safe area bottom — subtract it so input sits flush against keyboard
  const keyboardHeight = Platform.OS === 'ios'
    ? Math.max(0, rawKeyboardHeight - chatInsets.bottom)
    : rawKeyboardHeight;

  const stableHeightRef = useRef(screenHeight);
  useEffect(() => {
    if (!keyboardVisible) {
      stableHeightRef.current = screenHeight;
    }
  }, [screenHeight, keyboardVisible]);

  const sheetHeight = keyboardVisible
    ? Math.max(200, stableHeightRef.current - keyboardHeight - 44)
    : stableHeightRef.current * 0.88;

  // ── UI state ─────────────────────────────────────────────
  const [activePanel, setActivePanel] = useState<PanelId>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [friendPickerVisible, setFriendPickerVisible] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [friendsModalTab, setFriendsModalTab] = useState<"friends" | "requests">("friends");
  const queryClient = useQueryClient();
  const { showToast } = useToast();

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
    addFriend,
    cancelFriendRequest,
    blockedUsers = [],
    loading: friendsLoading,
    requestsLoading,
    fetchBlockedUsers,
  } = useFriends();

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await fetchFriends();
    setIsRefreshing(false);
  }, [fetchFriends]);

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesCache, setMessagesCache] = useState<Record<string, Message[]>>({});
  const [uploadingFile, setUploadingFile] = useState(false);
  const [activeChatIsBlocked, setActiveChatIsBlocked] = useState(false);
  const conversationChannelRef = useRef<any>(null);
  const broadcastSeenIds = useRef(new Set<string>());
  // Tracks the most-recently selected chat — used to discard stale background block-check results
  const latestSelectedChatRef = useRef<string | null>(null);

  // ── Network state ──────────────────────────────────────
  const { isConnected, isInternetReachable } = useNetworkMonitor();
  const isOffline = !isConnected || !isInternetReachable;

  // Current user's display name — needed for broadcast payload
  const profile = useAppStore((state) => state.profile);
  const currentUserDisplayName = useMemo(() => {
    if (profile?.display_name) return profile.display_name;
    if (profile?.first_name && profile?.last_name)
      return `${profile.first_name} ${profile.last_name}`;
    return "Unknown";
  }, [profile]);

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
  const incomingRequests = useMemo(() => {
    return friendRequests
      .filter((r) => r.type === "incoming" && r.status === "pending")
      .map((r) => ({ ...r, _source: "legacy" as const }));
  }, [friendRequests]);

  const outgoingRequests = useMemo(() => {
    return friendRequests.filter(
      (r) => r.type === "outgoing" && r.status === "pending"
    );
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
        const name = getDisplayName(p, "").toLowerCase();
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
    dismissKeyboard();
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
    if (id === "friends") {
      setFriendsModalTab("friends");
    }
    setActivePanel((prev) => (prev === id ? null : id));
  };

  // ── Friend request actions ───────────────────────────────
  const handleAcceptRequest = (requestId: string) => {
    HapticFeedback.medium();
    // Catch up on collaboration invites revealed by the friend acceptance trigger
    onFriendAccepted?.();
    // acceptFriendRequest invalidates friendsKeys.all — no explicit refetch needed
    acceptFriendRequest(requestId).catch((e) => {
      showMutationError(e, 'accepting friend request', showToast);
    });
  };

  const handleDeclineRequest = (requestId: string) => {
    HapticFeedback.warning();
    // declineFriendRequest invalidates friendsKeys.requests — no explicit refetch needed
    declineFriendRequest(requestId).catch((e) => {
      showMutationError(e, 'declining friend request', showToast);
    });
  };

  // ── Unblock handler ──────────────────────────────────────
  const handleUnblock = (blockedUserId: string) => {
    // unblockFriend invalidates friendsKeys.blocked — no explicit refetch needed
    unblockFriend(blockedUserId).catch((e) => {
      showMutationError(e, 'unblocking user', showToast);
    });
  };

  // ── Friends modal handlers ──────────────────────────────
  const getFriendDisplayNameFromUseFriend = (friend: UseFriend): string => {
    return getDisplayName(friend);
  };

  const handleMuteUserFromModal = async (friend: UseFriend) => {
    const friendUserId = friend.user_id === user?.id ? friend.friend_user_id : friend.user_id;
    if (muteLoadingFriendId) return;
    setMuteLoadingFriendId(friendUserId);
    try {
      const { success, isMuted, error: muteError } = await muteService.toggleMuteUser(friendUserId);
      if (success) {
        setMutedUserIds((prev) =>
          isMuted ? [...prev, friendUserId] : prev.filter((id) => id !== friendUserId)
        );
        HapticFeedback.light();
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

  const handleRemoveFriendFromModal = (friend: UseFriend) => {
    const friendUserId = friend.user_id === user?.id ? friend.friend_user_id : friend.user_id;
    const displayName = getFriendDisplayNameFromUseFriend(friend);
    Alert.alert(
      "Remove Friend",
      `Are you sure you want to remove ${displayName} from your friends?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            HapticFeedback.warning();
            // removeFriend invalidates friendsKeys.all — no explicit refetch needed
            removeFriend(friendUserId).catch((e) => {
              showMutationError(e, 'removing friend', showToast);
            });
          },
        },
      ]
    );
  };

  const handleBlockFromModal = (friend: UseFriend) => {
    const friendUserId = friend.user_id === user?.id ? friend.friend_user_id : friend.user_id;
    const displayName = getFriendDisplayNameFromUseFriend(friend);
    setSelectedUserToBlock({
      id: friendUserId,
      name: displayName,
      username: friend.username || "",
      status: "offline",
      isOnline: false,
    });
    setShowBlockModal(true);
  };

  const handleReportFromModal = (friend: UseFriend) => {
    const friendUserId = friend.user_id === user?.id ? friend.friend_user_id : friend.user_id;
    const displayName = getFriendDisplayNameFromUseFriend(friend);
    setSelectedUserToReport({
      id: friendUserId,
      name: displayName,
      username: friend.username || "",
      status: "offline",
      isOnline: false,
    });
    setShowReportModal(true);
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
      isRead: msg.is_read ?? false,
    }),
    []
  );

  // ── Persist messages to AsyncStorage (fire-and-forget) ──
  const persistMessages = useCallback(
    (conversationId: string, msgs: Message[]) => {
      // Only persist real, successfully-sent messages — exclude optimistic
      // temp messages and failed messages (ghost messages across sessions)
      const persistable = msgs
        .filter((m) => !m.id.startsWith("temp-") && !m.failed)
        .slice(-100); // Cap to last 100 to avoid unbounded AsyncStorage growth
      if (persistable.length === 0) return;
      AsyncStorage.setItem(
        getMessagesCacheKey(conversationId),
        JSON.stringify(persistable)
      ).catch((e) => console.warn("[ConnectionsPage] Message cache persist failed:", e));
    },
    []
  );

  // ── Hydrate messages from AsyncStorage ──────────────────
  const hydrateMessages = useCallback(
    async (conversationId: string): Promise<Message[]> => {
      try {
        const cached = await AsyncStorage.getItem(getMessagesCacheKey(conversationId));
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch (e) {
        console.warn("[ConnectionsPage] Message cache hydration failed:", e);
      }
      return [];
    },
    []
  );

  // ── Select conversation from chat list ───────────────────
  const handleSelectConversation = async (conversation: Conversation) => {
    if (!user?.id) return;

    const otherParticipant = conversation.participants.find((p) => p.id !== user.id);
    const rawName = getDisplayName(otherParticipant);

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

    // Synchronous block check from cached blocked-users list (React Query).
    // No network call — tap opens immediately. Server RLS enforces at send time.
    const isBlockedByMe = blockedUsers.some((b) => b.id === friend.id);
    setActiveChatIsBlocked(isBlockedByMe);
    latestSelectedChatRef.current = friend.id;

    setActiveChat(friend);

    // Background bidirectional check — fire-and-forget, guarded against stale results.
    // If the user switches chats before this resolves, the result is discarded.
    const capturedFriendId = friend.id;
    blockService.hasBlockBetween(friend.id)
      .then((hasBlock) => {
        if (latestSelectedChatRef.current === capturedFriendId && hasBlock !== isBlockedByMe) {
          setActiveChatIsBlocked(hasBlock);
        }
      })
      .catch(() => {}); // Server enforces at send time via RLS
    setCurrentConversationId(conversation.id);

    // ── Offline-resilient message loading ──────────────────
    // Priority: in-memory cache → AsyncStorage cache → network fetch
    // Always open the chat immediately with whatever we have, then refresh in background.
    const inMemoryCached = messagesCache[conversation.id];
    let initialMessages: Message[] = [];

    if (inMemoryCached && inMemoryCached.length > 0) {
      initialMessages = inMemoryCached;
    } else {
      // Try AsyncStorage before hitting network
      const storageCached = await hydrateMessages(conversation.id);
      if (storageCached.length > 0) {
        initialMessages = storageCached;
        // Warm up in-memory cache
        setMessagesCache((prev) => ({ ...prev, [conversation.id]: storageCached }));
      }
    }

    if (initialMessages.length > 0) {
      // We have cached messages — show them immediately
      setMessages(initialMessages);
      setShowMessageInterface(true);
      markConversationAsRead(conversation.id, user.id, initialMessages);

      // Refresh in background (silently fails if offline)
      (async () => {
        try {
          const { messages: freshMsgs, error: msgError } =
            await messagingService.getMessages(conversation.id, user.id);
          if (!msgError && freshMsgs) {
            const transformed = freshMsgs.map((m) => transformMessage(m, user.id));
            setMessages(transformed);
            setMessagesCache((prev) => ({ ...prev, [conversation.id]: transformed }));
            persistMessages(conversation.id, transformed);
            markConversationAsRead(conversation.id, user.id, transformed);
          }
        } catch (e) {
          // Offline — user is already viewing cached messages, no action needed
          console.warn("[ConnectionsPage] Background message refresh failed (offline?):", e);
        }
      })();
    } else {
      // No cache — open chat immediately with empty state, fetch in background
      setMessages([]);
      setShowMessageInterface(true);

      const capturedConvId = conversation.id;
      const capturedFriendId = friend.id;
      withTimeout(
        messagingService.getMessages(conversation.id, user.id),
        8000,
        'getMessages'
      )
        .then(({ messages: freshMsgs, error: msgError }) => {
          // Guard against stale result if user switched chats
          if (latestSelectedChatRef.current !== capturedFriendId) return;
          if (msgError) {
            console.error("Error loading messages:", msgError);
            return;
          }
          const transformed = (freshMsgs || []).map((m) => transformMessage(m, user.id));
          setMessages(transformed);
          setMessagesCache((prev) => ({ ...prev, [capturedConvId]: transformed }));
          persistMessages(capturedConvId, transformed);
          markConversationAsRead(capturedConvId, user.id, transformed);
        })
        .catch((e) => {
          // Timeout or network failure — chat is already open with empty state
          console.warn("[ConnectionsPage] No-cache message fetch failed:", e);
        });
    }

    // Real-time subscription (gracefully degrades if offline)
    setupRealtimeSubscription(conversation.id, user.id);
  };

  // ── Start new conversation from friend picker ────────────
  const handlePickFriend = async (friend: UseFriend) => {
    if (!user?.id) return;

    const friendUserId = friend.friend_user_id || friend.id;

    const displayName = getDisplayName(friend);

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

    // Synchronous block check from cached blocked-users list
    const isBlockedByMe = blockedUsers.some((b) => b.id === friendUserId);
    setActiveChatIsBlocked(isBlockedByMe);
    latestSelectedChatRef.current = friendUserId;

    // Background bidirectional check — fire-and-forget
    const capturedId = friendUserId;
    blockService.hasBlockBetween(friendUserId)
      .then((hasBlock) => {
        if (latestSelectedChatRef.current === capturedId && hasBlock !== isBlockedByMe) {
          setActiveChatIsBlocked(hasBlock);
        }
      })
      .catch(() => {});

    // Open chat UI immediately — conversation creation happens in background
    setMessages([]);
    setShowMessageInterface(true);

    const capturedFriendId = friendUserId;
    const currentUserId = user.id;

    // Helper: try to open from cached conversation list (offline fallback)
    const tryOpenFromCache = async (): Promise<boolean> => {
      const cachedConv = conversations.find((c) =>
        c.participants.some((p) => p.id === friendUserId)
      );
      if (!cachedConv) return false;

      if (latestSelectedChatRef.current !== capturedFriendId) return true; // stale — don't update
      setCurrentConversationId(cachedConv.id);
      const storageCached = await hydrateMessages(cachedConv.id);
      const inMemoryCached = messagesCache[cachedConv.id];
      const msgs = (inMemoryCached && inMemoryCached.length > 0) ? inMemoryCached : storageCached;
      setMessages(msgs);
      if (msgs.length > 0) {
        setMessagesCache((prev) => ({ ...prev, [cachedConv.id]: msgs }));
      }
      if (!isOffline) {
        setupRealtimeSubscription(cachedConv.id, currentUserId);
      }
      return true;
    };

    // Helper: load messages for a conversation in the background
    const loadMessagesInBackground = (conversationId: string) => {
      // Try in-memory cache first
      const inMemoryCached = messagesCache[conversationId];
      if (inMemoryCached && inMemoryCached.length > 0) {
        if (latestSelectedChatRef.current !== capturedFriendId) return;
        setMessages(inMemoryCached);
        markConversationAsRead(conversationId, currentUserId, inMemoryCached);
      }

      // Try AsyncStorage cache
      hydrateMessages(conversationId).then((storageCached) => {
        if (latestSelectedChatRef.current !== capturedFriendId) return;
        if (!inMemoryCached?.length && storageCached.length > 0) {
          setMessages(storageCached);
          setMessagesCache((prev) => ({ ...prev, [conversationId]: storageCached }));
          markConversationAsRead(conversationId, currentUserId, storageCached);
        }
      });

      // Fetch fresh from network in background
      withTimeout(
        messagingService.getMessages(conversationId, currentUserId),
        8000,
        'getMessages'
      )
        .then(({ messages: freshMsgs, error: msgError }) => {
          if (latestSelectedChatRef.current !== capturedFriendId) return;
          if (msgError || !freshMsgs) return;
          const transformed = freshMsgs.map((m) => transformMessage(m, currentUserId));
          setMessages(transformed);
          setMessagesCache((prev) => ({ ...prev, [conversationId]: transformed }));
          persistMessages(conversationId, transformed);
          markConversationAsRead(conversationId, currentUserId, transformed);
        })
        .catch((e) => {
          console.warn("[ConnectionsPage] Background message fetch failed:", e);
        });
    };

    withTimeout(
      messagingService.getOrCreateDirectConversation(currentUserId, friendUserId),
      8000,
      'getOrCreateConversation'
    )
      .then(({ conversation, error: convError }) => {
        if (latestSelectedChatRef.current !== capturedFriendId) return;

        if (convError || !conversation) {
          // Network call failed — try cached conversation fallback
          tryOpenFromCache().then((found) => {
            if (!found && latestSelectedChatRef.current === capturedFriendId) {
              showMutationError(
                convError || new Error('Failed to create conversation'),
                'starting conversation',
                showToast
              );
              setShowMessageInterface(false);
              setActiveChat(null);
            }
          });
          return;
        }

        setCurrentConversationId(conversation.id);
        loadMessagesInBackground(conversation.id);
        setupRealtimeSubscription(conversation.id, currentUserId);
      })
      .catch((e) => {
        if (latestSelectedChatRef.current !== capturedFriendId) return;

        // Total failure — try cached conversation fallback
        tryOpenFromCache().then((found) => {
          if (!found && latestSelectedChatRef.current === capturedFriendId) {
            showMutationError(e, 'starting conversation', showToast);
            setShowMessageInterface(false);
            setActiveChat(null);
          }
        });
      });
  };

  // ── Mark conversation as read (messages + local state) ──
  // Called after messages are loaded — uses the actual loaded messages,
  // not the stale messagesCache closure. Also zeroes the conversation's
  // unread_count in local state so the tab badge updates immediately.
  const markConversationAsRead = useCallback(
    (conversationId: string, userId: string, loadedMessages: Message[]) => {
      // 1. Collect unread message IDs from the loaded messages
      const unreadIds = loadedMessages
        .filter((msg) => !msg.isMe && msg.unread)
        .map((msg) => msg.id);

      // 2. Mark as read in the database
      if (unreadIds.length > 0) {
        messagingService.markAsRead(unreadIds, userId).catch(console.error);
      }

      // 3. Zero out unread_count in local conversations state so the badge
      //    updates immediately (don't wait for the next fetchConversations)
      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === conversationId
            ? { ...conv, unread_count: 0 }
            : conv
        )
      );
    },
    []
  );

  // ── Auto-persist messagesCache to AsyncStorage (debounced) ──
  // Catches ALL mutation paths: send, receive, realtime, background refresh.
  // 2-second debounce batches rapid mutations (send + confirm + reply)
  // into a single AsyncStorage write, avoiding excessive serialization.
  useEffect(() => {
    if (!currentConversationId) return;
    const msgs = messagesCache[currentConversationId];
    if (!msgs || msgs.length === 0) return;

    const timeout = setTimeout(() => {
      persistMessages(currentConversationId, msgs);
    }, 2000);

    return () => clearTimeout(timeout);
  }, [messagesCache, currentConversationId, persistMessages]);

  // ── Auto-refresh messages when network reconnects ───────
  const prevIsOfflineRef = useRef(isOffline);
  useEffect(() => {
    const wasOffline = prevIsOfflineRef.current;
    prevIsOfflineRef.current = isOffline;

    // Just came back online while a chat is open — re-subscribe + refresh
    if (wasOffline && !isOffline && currentConversationId && user?.id) {
      // Re-establish realtime subscription (may have died or never been set up)
      setupRealtimeSubscription(currentConversationId, user.id);

      (async () => {
        try {
          const { messages: freshMsgs, error: msgError } =
            await messagingService.getMessages(currentConversationId, user.id);
          if (!msgError && freshMsgs) {
            const transformed = freshMsgs.map((m) => transformMessage(m, user.id));
            setMessages(transformed);
            setMessagesCache((prev) => ({ ...prev, [currentConversationId]: transformed }));
            markConversationAsRead(currentConversationId, user.id, transformed);
          }
        } catch (e) {
          console.warn("[ConnectionsPage] Reconnection refresh failed:", e);
        }
      })();

      // Also refresh the conversations list
      fetchConversations(user.id);
    }
  }, [isOffline, currentConversationId, user?.id, transformMessage, markConversationAsRead, fetchConversations]);

  // ── Realtime subscription setup ──────────────────────────
  const setupRealtimeSubscription = (conversationId: string, userId: string) => {

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

          // Conversation list update ALWAYS runs.
          // Do NOT increment unread_count — the chat is open, so the message
          // is immediately visible and marked as read below. Incrementing here
          // would inflate the tab badge until the next fetchConversations.
          setConversations((prev) =>
            prev.map((conv) => {
              if (conv.id === conversationId) {
                return {
                  ...conv,
                  last_message: newMessage,
                  // Keep unread_count at 0 — user is actively viewing this chat
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
    latestSelectedChatRef.current = null;
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

    // Synchronous block check — uses cached list + background reconciliation state.
    // No network call on the send path. RLS enforces server-side as the real authority.
    if (activeChatIsBlocked || blockedUsers.some((b) => b.id === activeChat.id)) {
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
      // NOTE: This depends on MessageInterface's useBroadcastReceiver having
      // already subscribed to this channel. supabase.channel() returns the
      // existing subscribed instance, enabling the send.
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
          onPress: () => {
            onRemoveFriend?.(friend);
            mixpanelService.trackFriendRemoved({
              friendName: friend.name,
              friendUsername: friend.username,
            });
            // Sequential: cleanup before remove. removeFriend invalidates friendsKeys.all.
            cleanupSharedSessions(friend.id)
              .then(() => removeFriend(friend.id))
              .catch((e) => {
                showMutationError(e, 'removing friend', showToast);
              });
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
    const userToBlock = selectedUserToBlock;

    // Close modal immediately — user sees instant feedback
    setShowBlockModal(false);
    setSelectedUserToBlock(null);
    onBlockUser?.(userToBlock);
    mixpanelService.trackFriendBlocked({
      blockedUserName: userToBlock.name,
      blockedUserUsername: userToBlock.username,
      reason,
    });

    // Sequential: cleanup before block. blockFriend invalidates friendsKeys.all.
    cleanupSharedSessions(userToBlock.id)
      .then(() => blockFriend(userToBlock.id, reason))
      .catch((e) => {
        showMutationError(e, 'blocking user', showToast);
      });
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
                <Icon name="person-add-outline" size={18} color={activePanel === "add" ? "#ffffff" : "#eb7825"} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleActionPress("friends")}
                style={[styles.headerIconBtn, activePanel === "friends" && styles.headerIconBtnActive]}
                activeOpacity={0.7}
              >
                <Icon name="people-outline" size={18} color={activePanel === "friends" ? "#ffffff" : "#eb7825"} />
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
          onRequestClose={() => { dismissKeyboard(); setActivePanel(null); }}
        >
          <View style={styles.sheetOverlay}>
            <TouchableWithoutFeedback onPress={() => { dismissKeyboard(); setActivePanel(null); }}>
              <View style={styles.backdropFill} />
            </TouchableWithoutFeedback>

            <View
              style={[styles.sheetContainer, { height: sheetHeight, paddingBottom: keyboardVisible ? 0 : 32, marginBottom: keyboardVisible ? keyboardHeight : 0 }]}
              onStartShouldSetResponder={() => true}
            >
              <View style={styles.sheetHandle} />
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>
                  {activePanel === "add" ? "Add Friend" : "Friends"}
                </Text>
                <TouchableOpacity onPress={() => { dismissKeyboard(); setActivePanel(null); }} activeOpacity={0.7}>
                  <Icon name="close" size={24} color="#6b7280" />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={styles.sheetBody}
                contentContainerStyle={styles.sheetBodyContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}
              >
                {activePanel === "add" && (
                  <AddFriendView
                    currentUserId={user?.id || ""}
                    onRequestSent={() => loadFriendRequests()}
                    outgoingRequests={outgoingRequests}
                    outgoingRequestsLoading={requestsLoading}
                    onCancelRequest={cancelFriendRequest}
                    onAddFriend={addFriend}
                  />
                )}
                {activePanel === "friends" && (
                  <>
                    {/* Tab Bar */}
                    <View style={styles.tabBar}>
                      <TouchableOpacity
                        onPress={() => setFriendsModalTab("friends")}
                        style={[styles.tab, friendsModalTab === "friends" && styles.tabActive]}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.tabText, friendsModalTab === "friends" && styles.tabTextActive]}>
                          Friends
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => setFriendsModalTab("requests")}
                        style={[styles.tab, friendsModalTab === "requests" && styles.tabActive]}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.tabText, friendsModalTab === "requests" && styles.tabTextActive]}>
                          Requests
                        </Text>
                        {incomingRequests.length > 0 && (
                          <View style={styles.tabBadge}>
                            <Text style={styles.tabBadgeText}>
                              {incomingRequests.length}
                            </Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    </View>

                    {/* Tab Content */}
                    {friendsModalTab === "friends" ? (
                      <FriendsManagementList
                        friends={dbFriends}
                        loading={friendsLoading}
                        onRemoveFriend={handleRemoveFriendFromModal}
                        onBlockUser={handleBlockFromModal}
                        onReportUser={handleReportFromModal}
                        onMuteUser={handleMuteUserFromModal}
                        muteLoadingFriendId={muteLoadingFriendId}
                        mutedUserIds={mutedUserIds}
                        currentUserId={user?.id || ""}
                      />
                    ) : (
                      <View>
                        <RequestsView
                          requests={incomingRequests}
                          loading={friendsLoading || requestsLoading}
                          onAccept={handleAcceptRequest}
                          onDecline={handleDeclineRequest}
                        />
                      </View>
                    )}
                  </>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

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
            availableFriends={[]}
            isBlocked={activeChatIsBlocked}
            conversationId={currentConversationId}
            currentUserId={user?.id || null}
            currentUserName={currentUserDisplayName}
            broadcastSeenIds={broadcastSeenIds}
            isOffline={isOffline}
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
                <Icon name="person-add-outline" size={18} color={activePanel === "add" ? "#ffffff" : "#eb7825"} />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => handleActionPress("friends")}
                style={[styles.headerIconBtn, activePanel === "friends" && styles.headerIconBtnActive]}
                activeOpacity={0.7}
              >
                <Icon name="people-outline" size={18} color={activePanel === "friends" ? "#ffffff" : "#eb7825"} />
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
                <Icon name="ban-outline" size={18} color={activePanel === "blocked" ? "#ffffff" : "#eb7825"} />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => handleActionPress("invite")}
                style={styles.headerIconBtn}
                activeOpacity={0.7}
              >
                <Icon name="link-outline" size={18} color="#eb7825" />
              </TouchableOpacity>

              <View style={styles.headerDivider} />

              <TouchableOpacity
                onPress={() => setFriendPickerVisible(true)}
                style={styles.composeBtn}
                activeOpacity={0.7}
              >
                <Icon name="create-outline" size={18} color="#ffffff" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Search bar */}
          <View style={styles.searchContainer}>
            <Icon
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
              <Icon name="chatbubbles-outline" size={56} color="#d1d5db" />
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
              <Icon name="search" size={48} color="#d1d5db" />
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
      {/* Action Panel Bottom Sheet */}
      <Modal
        visible={activePanel !== null}
        animationType="slide"
        transparent
        onRequestClose={() => { dismissKeyboard(); setActivePanel(null); }}
      >
        <View style={styles.sheetOverlay}>
          <TouchableWithoutFeedback onPress={() => { dismissKeyboard(); setActivePanel(null); }}>
            <View style={styles.backdropFill} />
          </TouchableWithoutFeedback>

          <View
            style={[styles.sheetContainer, { height: sheetHeight, paddingBottom: keyboardVisible ? 0 : 32, marginBottom: keyboardVisible ? keyboardHeight : 0 }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {activePanel === "add"
                  ? "Add Friend"
                  : activePanel === "friends"
                  ? "Friends"
                  : "Blocked Users"}
              </Text>
              <TouchableOpacity onPress={() => { dismissKeyboard(); setActivePanel(null); }} activeOpacity={0.7}>
                <Icon name="close" size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.sheetBody}
              contentContainerStyle={styles.sheetBodyContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
            >
              {activePanel === "add" && (
                <AddFriendView
                  currentUserId={user?.id || ""}
                  onRequestSent={() => loadFriendRequests()}
                  outgoingRequests={outgoingRequests}
                  outgoingRequestsLoading={requestsLoading}
                  onCancelRequest={cancelFriendRequest}
                  onAddFriend={addFriend}
                />
              )}
              {activePanel === "friends" && (
                <>
                  {/* Tab Bar */}
                  <View style={styles.tabBar}>
                    <TouchableOpacity
                      onPress={() => setFriendsModalTab("friends")}
                      style={[styles.tab, friendsModalTab === "friends" && styles.tabActive]}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.tabText, friendsModalTab === "friends" && styles.tabTextActive]}>
                        Friends
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => setFriendsModalTab("requests")}
                      style={[styles.tab, friendsModalTab === "requests" && styles.tabActive]}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.tabText, friendsModalTab === "requests" && styles.tabTextActive]}>
                        Requests
                      </Text>
                      {incomingRequests.length > 0 && (
                        <View style={styles.tabBadge}>
                          <Text style={styles.tabBadgeText}>
                            {incomingRequests.length}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* Tab Content */}
                  {friendsModalTab === "friends" ? (
                    <FriendsManagementList
                      friends={dbFriends}
                      loading={friendsLoading}
                      onRemoveFriend={handleRemoveFriendFromModal}
                      onBlockUser={handleBlockFromModal}
                      onReportUser={handleReportFromModal}
                      onMuteUser={handleMuteUserFromModal}
                      muteLoadingFriendId={muteLoadingFriendId}
                      mutedUserIds={mutedUserIds}
                      currentUserId={user?.id || ""}
                    />
                  ) : (
                    <View>
                      <RequestsView
                        requests={incomingRequests}
                        loading={friendsLoading || requestsLoading}
                        onAccept={handleAcceptRequest}
                        onDecline={handleDeclineRequest}
                      />
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
      </Modal>

      {/* Friend Picker Sheet */}
      <FriendPickerSheet
        visible={friendPickerVisible}
        onClose={() => setFriendPickerVisible(false)}
        onSelectFriend={handlePickFriend}
        friends={dbFriends}
        loadingFriends={friendsLoading}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  content: {
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
  flex: 1,
},
sheetBodyContent: {
  paddingTop: 8,
  paddingBottom: 24,
},
  // ── Tab bar (Friends modal) ────────────
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    marginBottom: 12,
    marginHorizontal: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: {
    borderBottomColor: "#eb7825",
  },
  tabText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#9ca3af",
  },
  tabTextActive: {
    color: "#eb7825",
  },
  tabBadge: {
    backgroundColor: "#ef4444",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  tabBadgeText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "700",
  },
});
