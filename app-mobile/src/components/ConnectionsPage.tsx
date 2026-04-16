import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from "react";
import { useCoachMark } from "../hooks/useCoachMark";
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
  Keyboard,
  Platform,
  ScrollView,
  useWindowDimensions,
  RefreshControl,
  InteractionManager,
  Image,
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
import { Conversation, Message as ConvMessage } from "../hooks/useMessages";
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
import { useTranslation } from 'react-i18next';

// Sub-components
import { ChatListItem } from "./connections/ChatListItem";
import { FriendPickerSheet } from "./connections/FriendPickerSheet";
import { AddFriendView } from "./connections/AddFriendView";
import { RequestsView } from "./connections/RequestsView";
import { FriendsManagementList } from "./connections/FriendsManagementList";
import { BlockedUsersView } from "./connections/BlockedUsersView";
import MessageInterface from "./MessageInterface";

type PanelId = "add" | "friends" | "blocked" | null; // [TRANSITIONAL] kept for initialPanel prop compat
type FriendsModalTab = "friend-list" | "sent" | "requests" | "blocked";

// Modals kept for MessageInterface actions
import AddToBoardModal from "./AddToBoardModal";
import ReportUserModal from "./ReportUserModal";
import BlockUserModal from "./BlockUserModal";

// Pairing — ORCH-0435 Phase A
import PairRequestModal from "./PairRequestModal";
import IncomingPairRequestCard from "./IncomingPairRequestCard";
import { usePairingPills, useIncomingPairRequests, useSendPairRequest, useCancelPairRequest, useCancelPairInvite, useAcceptPairRequest, useDeclinePairRequest, useUnpair } from "../hooks/usePairings";
import type { PairRequest } from "../services/pairingService";
interface ConnectionsPageProps {
  isTabVisible?: boolean;
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
  /** When set (e.g. Discover map "Message"), open DM with this user; clear via onOpenDirectMessageHandled */
  openDirectMessageWithUserId?: string | null;
  onOpenDirectMessageHandled?: () => void;
  /** When set (e.g. Profile "Friends" stat), auto-open this panel on mount; cleared via onInitialPanelHandled */
  initialPanel?: "friends" | "add" | "blocked" | null;
  onInitialPanelHandled?: () => void;
}

const CONNECTIONS_CACHE_VERSION = "v1";

const getConversationsCacheKey = (userId: string) =>
  `mingla:connections:conversations:${CONNECTIONS_CACHE_VERSION}:${userId}`;

const getMessagesCacheKey = (conversationId: string) =>
  `mingla:connections:messages:${CONNECTIONS_CACHE_VERSION}:${conversationId}`;

const normalizeSearchText = (value: string | null | undefined): string =>
  (value || "")
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/\s+/g, " ")
    .trim();

// ── ORCH-0435: Paired friends pill bar ─────────────────────────────────────
interface PairedPillPerson {
  pairedUserId: string;
  displayName: string;
  firstName: string | null;
  avatarUrl: string | null;
  initials: string;
  pending?: boolean;
  incoming?: boolean;
  incomingRequest?: PairRequest;
}

function PairedPillsBar({
  people,
  onSelectPerson,
  onAddPress,
  onPendingPress,
  onIncomingPress,
}: {
  people: PairedPillPerson[];
  onSelectPerson: (person: PairedPillPerson) => void;
  onAddPress: () => void;
  onPendingPress?: (person: PairedPillPerson) => void;
  onIncomingPress?: (person: PairedPillPerson) => void;
}) {
  const [failedAvatars, setFailedAvatars] = useState<Set<string>>(new Set());

  return (
    <View style={pillStyles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={pillStyles.scrollContent}
      >
        {/* Add button — first */}
        <TouchableOpacity style={pillStyles.pill} onPress={onAddPress} activeOpacity={0.7}>
          <View style={pillStyles.addButtonRing}>
            <Icon name="add" size={20} color="#eb7825" />
          </View>
          <Text style={pillStyles.name} numberOfLines={1}>Add</Text>
        </TouchableOpacity>
        {people.map((person) => {
          const name = person.firstName || person.displayName?.split(" ")[0] || "Friend";
          const isPending = person.pending;
          return (
            <TouchableOpacity
              key={person.pairedUserId}
              style={[pillStyles.pill, isPending && pillStyles.pillPending]}
              onPress={() => person.incoming ? onIncomingPress?.(person) : isPending ? onPendingPress?.(person) : onSelectPerson(person)}
              activeOpacity={0.7}
            >
              <View style={[pillStyles.avatarRing, isPending && pillStyles.avatarRingPending]}>
                {person.avatarUrl && !failedAvatars.has(person.pairedUserId) ? (
                  <Image
                    source={{ uri: person.avatarUrl }}
                    style={[pillStyles.avatar, isPending && pillStyles.avatarPending]}
                    onError={() => setFailedAvatars(prev => new Set([...prev, person.pairedUserId]))}
                  />
                ) : (
                  <View style={[pillStyles.avatarFallback, isPending && pillStyles.avatarFallbackPending]}>
                    <Text style={pillStyles.avatarInitials}>{person.initials}</Text>
                  </View>
                )}
                {/* Star badge — green for active, grey for pending */}
                <View style={[pillStyles.starBadge, isPending && pillStyles.starBadgePending]}>
                  <Icon name="star" size={10} color="#ffffff" />
                </View>
              </View>
              <Text style={[pillStyles.name, isPending && pillStyles.namePending]} numberOfLines={1}>{name}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const pillStyles = StyleSheet.create({
  container: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f3f4f6",
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 14,
    alignItems: "center",
  },
  pill: {
    alignItems: "center",
    width: 56,
  },
  avatarRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: "#10b981",
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  avatarFallback: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#eb7825",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarInitials: {
    fontSize: 14,
    fontWeight: "700",
    color: "#ffffff",
  },
  starBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#10b981",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#ffffff",
  },
  name: {
    fontSize: 11,
    fontWeight: "600",
    color: "#374151",
    marginTop: 4,
    textAlign: "center",
    maxWidth: 56,
  },
  pillPending: {
    opacity: 0.6,
  },
  avatarRingPending: {
    borderColor: "#d1d5db",
  },
  avatarPending: {
    opacity: 0.5,
  },
  avatarFallbackPending: {
    backgroundColor: "#9ca3af",
  },
  starBadgePending: {
    backgroundColor: "#9ca3af",
  },
  namePending: {
    color: "#9ca3af",
  },
  addButtonRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: "#eb7825",
    borderStyle: "dashed",
    justifyContent: "center",
    alignItems: "center",
  },
});

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
  openDirectMessageWithUserId,
  onOpenDirectMessageHandled,
  initialPanel,
  onInitialPanelHandled,
  isTabVisible,
}: ConnectionsPageProps) {
  useScreenLogger('connections');
  const { t } = useTranslation(['connections', 'common']);
  const coachChatHeader = useCoachMark(10, 0);
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
  const [activePanel, setActivePanel] = useState<PanelId>(null); // [TRANSITIONAL] legacy — being replaced by showFriendsModal
  const [showFriendsModal, setShowFriendsModal] = useState(false);
  const [badgeDismissed, setBadgeDismissed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [friendPickerVisible, setFriendPickerVisible] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [friendsModalTab, setFriendsModalTab] = useState<FriendsModalTab>("friend-list");
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

  // ── Archive state (ORCH-0435) ───────────────────────────
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    AsyncStorage.getItem(`mingla:archived_chats:${user.id}`).then(raw => {
      if (raw) {
        try { setArchivedIds(new Set(JSON.parse(raw))); } catch { /* ignore */ }
      }
    }).catch(() => {});
  }, [user?.id]);

  const handleArchiveChat = useCallback((conversationId: string) => {
    setArchivedIds(prev => {
      const next = new Set(prev);
      next.add(conversationId);
      if (user?.id) {
        AsyncStorage.setItem(`mingla:archived_chats:${user.id}`, JSON.stringify([...next])).catch(() => {});
      }
      return next;
    });
  }, [user?.id]);

  const handleUnarchiveChat = useCallback((conversationId: string) => {
    setArchivedIds(prev => {
      const next = new Set(prev);
      next.delete(conversationId);
      if (user?.id) {
        AsyncStorage.setItem(`mingla:archived_chats:${user.id}`, JSON.stringify([...next])).catch(() => {});
      }
      return next;
    });
  }, [user?.id]);

  const handleDeleteChat = useCallback((conversationId: string) => {
    Alert.alert('Delete Chat', 'Are you sure you want to delete this chat?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: () => {
          setConversations(prev => prev.filter(c => c.id !== conversationId));
        }
      },
    ]);
  }, []);

  // ── Messaging state ──────────────────────────────────────
  const [activeChat, setActiveChat] = useState<Friend | null>(null);
  const [showMessageInterface, setShowMessageInterface] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesCache, setMessagesCache] = useState<Record<string, Message[]>>({});
  const [uploadingFile, setUploadingFile] = useState(false);
  const [activeChatIsBlocked, setActiveChatIsBlocked] = useState(false);
  const [activeChatIsUnfriended, setActiveChatIsUnfriended] = useState(false);
  const [activeChatIsDeletedAccount, setActiveChatIsDeletedAccount] = useState(false);
  const conversationChannelRef = useRef<any>(null);
  const broadcastSeenIds = useRef(new Set<string>());
  // Tracks the most-recently selected chat — used to discard stale background block-check results
  const latestSelectedChatRef = useRef<string | null>(null);
  const conversationsForOpenDmRef = useRef(conversations);
  conversationsForOpenDmRef.current = conversations;
  const dbFriendsForOpenDmRef = useRef(dbFriends);
  dbFriendsForOpenDmRef.current = dbFriends;

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

  // ── Pairing data (ORCH-0435 Phase A) ────────────────────
  const { data: pairingPills = [] } = usePairingPills(user?.id);
  const { data: incomingPairRequests = [] } = useIncomingPairRequests(user?.id);
  const sendPairMutation = useSendPairRequest();
  const cancelPairRequestMutation = useCancelPairRequest();
  const cancelPairInviteMutation = useCancelPairInvite();
  const acceptPairRequestMutation = useAcceptPairRequest();
  const declinePairRequestMutation = useDeclinePairRequest();
  const unpairMutation = useUnpair();
  const [showPairRequestModal, setShowPairRequestModal] = useState(false);
  const [showIncomingPairRequest, setShowIncomingPairRequest] = useState<PairRequest | null>(null);
  const [pairLoadingUserId, setPairLoadingUserId] = useState<string | null>(null);

  const activePairedPeople: PairedPillPerson[] = useMemo(() => {
    const active = pairingPills
      .filter(p => p.pillState === 'active' && p.pairedUserId != null)
      .map(p => ({
        pairedUserId: p.pairedUserId!,
        displayName: p.displayName,
        firstName: p.firstName,
        avatarUrl: p.avatarUrl,
        initials: p.initials,
        pending: false,
      }));
    const pending = pairingPills
      .filter(p => p.pillState !== 'active' && p.pairedUserId != null)
      .map(p => ({
        pairedUserId: p.pairedUserId!,
        displayName: p.displayName,
        firstName: p.firstName,
        avatarUrl: p.avatarUrl,
        initials: p.initials,
        pending: true,
      }));
    const incoming = incomingPairRequests.map(req => ({
      pairedUserId: req.senderId,
      displayName: req.senderName,
      firstName: req.senderName.split(' ')[0] ?? null,
      avatarUrl: req.senderAvatar ?? null,
      initials: req.senderName.split(' ').map(n => n[0] ?? '').join('').toUpperCase().slice(0, 2) || '?',
      pending: true,
      incoming: true,
      incomingRequest: req,
    }));
    return [...active, ...incoming, ...pending];
  }, [pairingPills, incomingPairRequests]);

  const pairedUserIds = useMemo(() => new Set(
    pairingPills.filter(p => p.pillState === 'active' && p.pairedUserId != null).map(p => p.pairedUserId!)
  ), [pairingPills]);

  const pendingPairUserIds = useMemo(() => new Set(
    pairingPills.filter(p => p.pillState !== 'active' && p.pairedUserId != null).map(p => p.pairedUserId!)
  ), [pairingPills]);

  const handlePairFriend = useCallback(async (friendUserId: string) => {
    setPairLoadingUserId(friendUserId);
    // Find friend details for optimistic pill display
    const friend = dbFriends.find(f => {
      const fid = f.user_id === (user?.id || '') ? f.friend_user_id : f.user_id;
      return fid === friendUserId;
    });
    const friendDisplayName = friend ? getDisplayName(friend) : undefined;
    try {
      await sendPairMutation.mutateAsync({
        friendUserId,
        displayName: friendDisplayName ?? undefined,
        avatarUrl: friend?.avatar_url ?? null,
      });
      showToast({ message: 'Pair request sent!', type: 'info' });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : '';
      if (errMsg !== 'pairing_limit_reached') {
        showMutationError(err, 'sending pair request', showToast);
      }
    } finally {
      setPairLoadingUserId(null);
    }
  }, [sendPairMutation, showToast, dbFriends, user?.id]);

  const handleUnpairFriend = useCallback((friendUserId: string) => {
    // Find the pairingId for this friend
    const pill = pairingPills.find(p => p.pairedUserId === friendUserId && p.pillState === 'active');
    if (!pill?.pairingId) return;
    Alert.alert(
      'Unpair',
      `Are you sure you want to unpair?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpair',
          style: 'destructive',
          onPress: () => {
            unpairMutation.mutate(pill.pairingId!);
          },
        },
      ]
    );
  }, [pairingPills, unpairMutation]);

  /** Derive pair status for a given user ID (used by ChatListItem star buttons) */
  const getPairStatus = useCallback((participantId: string): 'paired' | 'pending' | 'unpaired' | 'not-friend' => {
    if (pairedUserIds.has(participantId)) return 'paired';
    if (pendingPairUserIds.has(participantId)) return 'pending';
    const isFriend = dbFriends.some(f => {
      const friendId = f.user_id === (user?.id || '') ? f.friend_user_id : f.user_id;
      return friendId === participantId;
    });
    return isFriend ? 'unpaired' : 'not-friend';
  }, [pairedUserIds, pendingPairUserIds, dbFriends, user?.id]);

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

  // Reset badge when NEW requests arrive after dismissal
  const prevRequestCountRef = useRef(0);
  useEffect(() => {
    const total = incomingRequests.length + incomingPairRequests.length;
    if (total > prevRequestCountRef.current && badgeDismissed) {
      setBadgeDismissed(false);
    }
    prevRequestCountRef.current = total;
  }, [incomingRequests.length, incomingPairRequests.length, badgeDismissed]);

  // Sort conversations by most recent message
  const sortedConversations = useMemo(() => {
    const sorted = [...conversations].sort((a, b) => {
      const aTime = a.last_message?.created_at || a.created_at;
      const bTime = b.last_message?.created_at || b.created_at;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
    return sorted.filter(c => !archivedIds.has(c.id));
  }, [conversations, archivedIds]);

  const archivedConversations = useMemo(() => {
    return [...conversations]
      .filter(c => archivedIds.has(c.id))
      .sort((a, b) => {
        const aTime = a.last_message?.created_at || a.created_at;
        const bTime = b.last_message?.created_at || b.created_at;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });
  }, [conversations, archivedIds]);

  // Search-filtered conversations
  const filteredConversations = useMemo(() => {
    const q = normalizeSearchText(searchQuery);
    if (!q) return sortedConversations;

    return sortedConversations.filter((conv) => {
      const otherParticipants = conv.participants.filter((p) => p.id !== user?.id);
      const searchableParticipants =
        otherParticipants.length > 0 ? otherParticipants : conv.participants;

      const nameMatch = searchableParticipants.some((p) => {
        const candidateNames = [
          getDisplayName(p, ""),
          p.display_name || "",
          p.username || "",
          p.username ? `@${p.username}` : "",
          [p.first_name, p.last_name].filter(Boolean).join(" "),
        ];

        return candidateNames.some((candidate) =>
          normalizeSearchText(candidate).includes(q)
        );
      });

      const contentCandidates = [
        conv.last_message?.content || "",
        conv.last_message?.message_type === "image" ? "photo image" : "",
        conv.last_message?.message_type === "file" ? "file attachment document" : "",
      ];
      const contentMatch = contentCandidates.some((candidate) =>
        normalizeSearchText(candidate).includes(q)
      );

      return nameMatch || contentMatch;
    });
  }, [sortedConversations, searchQuery, user?.id]);

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
          created_by: conv.created_by ?? '',
          created_at: conv.created_at,
          participants,
          last_message: conv.last_message as unknown as ConvMessage | undefined,
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
        setError(t('connections:failed_load'));
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
  const handleInvitePress = () => {
    HapticFeedback.light();
    try {
      const inviteLink = `https://mingla.app/invite/${user?.id || ""}`;
      Clipboard.setString(inviteLink);
      Alert.alert("", t('connections:invite_link_copied'));
      mixpanelService.trackReferralLinkShared({ method: 'copy' });
    } catch (e) {
      console.error("Error copying invite link:", e);
    }
  };

  const openFriendsModal = (tab?: FriendsModalTab) => {
    HapticFeedback.light();
    dismissKeyboard();
    setFriendsModalTab(tab ?? "friend-list");
    setShowFriendsModal(true);
    setBadgeDismissed(true);
  };

  // ── Auto-open panel from external navigation (e.g. Profile "Friends" stat) ──
  // Guard with isTabVisible: in tab-based layout the component stays mounted while hidden.
  // isTabVisible is undefined in switch-case layout (always visible when rendered).
  useEffect(() => {
    if (initialPanel && isTabVisible !== false) {
      setShowFriendsModal(true);
      if (initialPanel === "friends") setFriendsModalTab("friend-list");
      else if (initialPanel === "add") setFriendsModalTab("friend-list");
      else if (initialPanel === "blocked") setFriendsModalTab("blocked");
      onInitialPanelHandled?.();
    }
  }, [initialPanel, onInitialPanelHandled, isTabVisible]);

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
        Alert.alert(t('common:error'), muteError || t('connections:mute_error'));
      }
    } catch (e) {
      console.error("Error toggling mute:", e);
      Alert.alert(t('common:error'), t('connections:mute_error'));
    } finally {
      setMuteLoadingFriendId(null);
    }
  };

  const handleRemoveFriendFromModal = (friend: UseFriend) => {
    const friendUserId = friend.user_id === user?.id ? friend.friend_user_id : friend.user_id;
    const displayName = getFriendDisplayNameFromUseFriend(friend);
    Alert.alert(
      t('connections:remove_friend_title'),
      t('connections:remove_friend_body', { name: displayName }),
      [
        { text: t('common:cancel'), style: "cancel" },
        {
          text: t('common:remove'),
          style: "destructive",
          onPress: () => {
            HapticFeedback.warning();
            // removeFriend invalidates friendsKeys.all — also invalidate nearby-people for map (ORCH-0360)
            removeFriend(friendUserId)
              .then(() => {
                queryClient.invalidateQueries({ queryKey: ['nearby-people'] });
              })
              .catch((e) => {
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
    InteractionManager.runAfterInteractions(() => {
      setShowBlockModal(true);
    });
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
      senderId: msg.sender_id ?? '',
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
      replyToId: msg.reply_to_id ?? undefined,
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

    // Start optimistic (assume connected). The background server query below
    // will set true if actually unfriended. This prevents a brief banner flash
    // when the cache is stale but the user IS friends (ORCH-0360 rework).
    setActiveChatIsUnfriended(false);

    // Reset deleted-account state (will be checked in background below)
    setActiveChatIsDeletedAccount(false);

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

    // Background check: is the other user's account deleted/inactive? (ORCH-0357)
    Promise.resolve(
      supabase
        .from('profiles')
        .select('active')
        .eq('id', friend.id)
        .single()
    ).then(({ data: otherProfile }) => {
      if (latestSelectedChatRef.current === capturedFriendId) {
        setActiveChatIsDeletedAccount(otherProfile?.active === false || !otherProfile);
      }
    }).catch(() => {}); // Fail silently — input area defaults to visible

    // Background friendship re-check (ORCH-0360) — handles re-friended users.
    // The synchronous check above uses the cached friends list which may be stale.
    // This server query catches cases where friendship was restored after unfriending.
    Promise.resolve(
      supabase
        .from('friends')
        .select('id')
        .or(`and(user_id.eq.${user!.id},friend_user_id.eq.${friend.id}),and(user_id.eq.${friend.id},friend_user_id.eq.${user!.id})`)
        .eq('status', 'accepted')
        .limit(1)
    ).then(({ data: friendshipData }) => {
      if (latestSelectedChatRef.current === capturedFriendId) {
        const isFriendNow = friendshipData && friendshipData.length > 0;
        // Server is the single source of truth for unfriended state (ORCH-0360 rework).
        // Set true only when server confirms NOT friends and NOT blocked.
        setActiveChatIsUnfriended(!isFriendNow && !isBlockedByMe);
      }
    }).catch(() => {}); // Fail silently — optimistic false stays

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

    // Start optimistic — friend picker only shows friends, so this should always be false.
    // Background server query will correct if needed (ORCH-0360 rework).
    setActiveChatIsUnfriended(false);
    setActiveChatIsDeletedAccount(false);

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

    try {
      // ORCH-0436: Find existing conversation only — do NOT create.
      // Conversation is created on first message send (handleSendMessage).
      const { conversation } = await withTimeout(
        messagingService.findExistingDirectConversation(currentUserId, friendUserId),
        8000,
        'findExistingConversation'
      );

      if (latestSelectedChatRef.current !== capturedFriendId) return;

      if (conversation) {
        // Existing conversation — load normally
        setCurrentConversationId(conversation.id);
        loadMessagesInBackground(conversation.id);
        setupRealtimeSubscription(conversation.id, currentUserId);
      } else {
        // No conversation yet — open empty chat UI, no DB row created
        setCurrentConversationId(null);
        setMessages([]);
      }
    } catch (e) {
      if (latestSelectedChatRef.current !== capturedFriendId) return;

      const found = await tryOpenFromCache();
      if (!found && latestSelectedChatRef.current === capturedFriendId) {
        showMutationError(e, 'starting conversation', showToast);
        setShowMessageInterface(false);
        setActiveChat(null);
      }
    }
  };

  // ── Open DM from external navigation (Discover map "Message") ────────────
  // Show MessageInterface on the same frame as the tab switch — otherwise users briefly
  // see the Chats list before the async open effect runs.
  useLayoutEffect(() => {
    if (!openDirectMessageWithUserId || !user?.id) {
      return;
    }

    const targetId = openDirectMessageWithUserId;

    if (showMessageInterface && activeChat?.id === targetId) {
      return;
    }

    const friend = dbFriendsForOpenDmRef.current.find(
      (f) => (f.friend_user_id || f.id) === targetId
    );
    const displayName = friend ? getDisplayName(friend) : "Chat";

    setShowMessageInterface(true);
    setActiveChat({
      id: targetId,
      name: displayName,
      username: friend?.username || "user",
      avatar: friend?.avatar_url,
      status: "offline",
      isOnline: false,
    });
    latestSelectedChatRef.current = targetId;
    setMessages([]);
    setCurrentConversationId(null);
  }, [openDirectMessageWithUserId, user?.id, showMessageInterface, activeChat?.id]);

  // handlePickFriend awaits getOrCreate; we only clear the pending id after that completes.
  // Refs keep latest conversations/dbFriends without re-running this effect when lists update
  // (which would abort in-flight work and skip onOpenDirectMessageHandled).
  useEffect(() => {
    if (!openDirectMessageWithUserId || !user?.id) {
      return;
    }

    const targetId = openDirectMessageWithUserId;
    let active = true;

    void (async () => {
      try {
        const convs = conversationsForOpenDmRef.current;
        const friends = dbFriendsForOpenDmRef.current;
        // 1. Try local cache first (fastest)
        const existing = convs.find((c) =>
          c.participants.some((p) => p.id === targetId)
        );
        if (existing) {
          await handleSelectConversation(existing);
          return;
        }
        // 2. Try friends list (may trigger getOrCreateDirectConversation)
        const friend = friends.find(
          (f) => (f.friend_user_id || f.id) === targetId
        );
        if (friend) {
          await handlePickFriend(friend);
          return;
        }
        // 3. Cold-start fallback: conversations haven't hydrated yet.
        //    Query DB directly for existing conversation (no friendship gate).
        //    Avoids stale ref race: fetchConversations updates state/ref asynchronously,
        //    but the ref won't reflect the new value until the next render.
        const { conversation: directConv } =
          await messagingService.findExistingDirectConversation(user.id, targetId);
        if (!active) return;
        if (directConv) {
          // Adapt to local Conversation shape (handleSelectConversation expects it)
          const adapted = {
            id: directConv.id,
            created_by: directConv.created_by ?? '',
            created_at: directConv.created_at,
            participants: directConv.participants.map((p: any) => ({
              id: p.user_id || p.id,
              username: p.username || 'user',
              display_name: p.display_name,
              first_name: p.first_name,
              last_name: p.last_name,
              avatar_url: p.avatar_url,
              is_online: p.is_online,
            })),
            unread_count: directConv.unread_count ?? 0,
            messages: [] as ConvMessage[],
          } as Conversation;
          await handleSelectConversation(adapted);
          return;
        }
        // 4. ORCH-0436: Open empty chat UI without creating a conversation.
        //    Conversation will be created when user sends their first message.
        setActiveChat({
          id: targetId,
          name: 'Friend',
          username: 'user',
          status: 'offline',
          isOnline: false,
        });
        setShowMessageInterface(true);
        setCurrentConversationId(null);
        setMessages([]);
      } finally {
        if (active) {
          onOpenDirectMessageHandled?.();
        }
      }
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once per pending id; lists read from refs
  }, [openDirectMessageWithUserId, user?.id, onOpenDirectMessageHandled]);

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
            prev.map((conv): Conversation => {
              if (conv.id === conversationId) {
                return {
                  ...conv,
                  last_message: newMessage as unknown as ConvMessage,
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
    setActiveChatIsUnfriended(false);
    setActiveChatIsDeletedAccount(false);
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
    file?: any,
    replyToId?: string
  ) => {
    if (!activeChat || !user?.id) return;

    // ORCH-0436: First message — create conversation + send atomically
    if (!currentConversationId) {
      // Handle file upload if needed — create conversation first for storage path
      let firstFileUrl: string | undefined;
      let firstFileName: string | undefined;
      let firstFileSize: number | undefined;

      const { conversationId: newConvId, error: convError } =
        await messagingService.ensureConversation(user.id, activeChat.id);

      if (convError || !newConvId) {
        Alert.alert(
          t('connections:message_not_sent'),
          convError || t('connections:message_failed')
        );
        return;
      }

      if (file && type !== 'text') {
        try {
          const ext = file.name?.split('.').pop() || 'file';
          const storagePath = `messages/${newConvId}/${Date.now()}.${ext}`;
          const { error: uploadError } = await supabase.storage
            .from('chat-files')
            .upload(storagePath, file);
          if (uploadError) throw uploadError;
          const { data: urlData } = supabase.storage
            .from('chat-files')
            .getPublicUrl(storagePath);
          firstFileUrl = urlData?.publicUrl;
          firstFileName = file.name;
          firstFileSize = file.size;
        } catch (uploadErr) {
          console.error('[ConnectionsPage] First message file upload failed:', uploadErr);
          Alert.alert(t('connections:upload_error_title'), t('connections:upload_error_body'));
          return;
        }
      }

      const { message: sentMsg, error: sendError } = await messagingService.sendMessage(
        newConvId, user.id, content, type, firstFileUrl, firstFileName, firstFileSize, replyToId
      );

      if (sendError || !sentMsg) {
        Alert.alert(
          t('connections:message_not_sent'),
          sendError || t('connections:message_failed')
        );
        return;
      }

      // Set conversation ID + start Realtime
      setCurrentConversationId(newConvId);
      setupRealtimeSubscription(newConvId, user.id);

      // Add the sent message to UI
      const transformed = transformMessage(sentMsg, user.id);
      setMessages([transformed]);
      setMessagesCache(prev => ({ ...prev, [newConvId]: [transformed] }));

      // Refresh conversations list to pick up the new conversation
      fetchConversations(user.id);

      return;
    }

    // ── Existing conversation: original logic below ──

    // Synchronous block check — uses cached list + background reconciliation state.
    // No network call on the send path. RLS enforces server-side as the real authority.
    if (activeChatIsBlocked || blockedUsers.some((b) => b.id === activeChat.id)) {
      Alert.alert(
        t('connections:message_not_sent'),
        t('connections:message_blocked')
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
          Alert.alert(t('connections:upload_error_title'), t('connections:upload_error_body'));
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
        Alert.alert(t('connections:upload_error_title'), t('connections:upload_error_body'));
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
      replyToId,
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
          fileSize,
          replyToId
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
            t('connections:message_not_sent'),
            t('connections:message_blocked_alt')
          );
        } else {
          Alert.alert(
            t('connections:message_not_sent'),
            t('connections:message_failed')
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
        prev.map((conv): Conversation => {
          if (conv.id === currentConversationId) {
            return { ...conv, last_message: sentMessage as unknown as ConvMessage };
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
      t('connections:remove_friend_title'),
      t('connections:remove_friend_body_alt', { name: friend.name }),
      [
        { text: t('common:cancel'), style: "cancel" },
        {
          text: t('common:remove'),
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
              .then(() => {
                // Invalidate nearby-people so the map updates relationship state (ORCH-0360)
                queryClient.invalidateQueries({ queryKey: ['nearby-people'] });
              })
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
          isMuted ? t('connections:muted_title') : t('connections:unmuted_title'),
          isMuted
            ? t('connections:muted_body', { name: friend.name })
            : t('connections:unmuted_body', { name: friend.name }),
          [{ text: t('common:ok') }]
        );
      } else {
        Alert.alert(t('common:error'), muteError || t('connections:mute_error'));
      }
    } catch (e) {
      console.error("Error toggling mute:", e);
      Alert.alert(t('common:error'), t('connections:mute_error'));
    } finally {
      setMuteLoadingFriendId(null);
    }
  };

  const handleBlockUser = (friend: Friend) => {
    setSelectedUserToBlock(friend);
    // Defer modal show until pending animations/interactions complete.
    // ConnectionsPage is ~2100 lines — immediate setState triggers a heavy
    // re-render that makes the modal feel sluggish to appear.
    InteractionManager.runAfterInteractions(() => {
      setShowBlockModal(true);
    });
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
          t('connections:report_submitted_title'),
          t('connections:report_submitted_body'),
          [{ text: t('common:ok') }]
        );
        onReportUser?.(selectedUserToReport, true);
      } else {
        Alert.alert(t('connections:report_failed_title'), result.error || t('connections:report_failed_body'), [{ text: t('common:ok') }]);
      }
    } catch (e) {
      console.error("Error submitting report:", e);
      setShowReportModal(false);
      setSelectedUserToReport(null);
      Alert.alert(t('common:error'), t('connections:unexpected_error'), [{ text: t('common:ok') }]);
    }
  };

  // ── Error state ──────────────────────────────────────────
  // Skip when opening a DM from the map so the conversation UI shows immediately.
  if (error && conversations.length === 0 && !(showMessageInterface && activeChat)) {
    return (
      <>
        <View style={styles.container}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>{t('connections:title')}</Text>
            <View style={styles.headerActions}>
              <TouchableOpacity
                onPress={() => openFriendsModal()}
                style={styles.headerIconBtn}
                activeOpacity={0.7}
              >
                <Icon name="people-outline" size={18} color="#eb7825" />
                {!badgeDismissed && (incomingRequests.length + incomingPairRequests.length) > 0 && (
                  <View style={styles.headerBadge}>
                    <Text style={styles.headerBadgeText}>
                      {(incomingRequests.length + incomingPairRequests.length) > 9
                        ? "9+"
                        : incomingRequests.length + incomingPairRequests.length}
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
              <Text style={styles.retryButtonText}>{t('common:try_again')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Friends Modal rendered below (shared across all render paths) */}

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
            isUnfriended={activeChatIsUnfriended}
            isDeletedAccount={activeChatIsDeletedAccount}
            conversationId={currentConversationId}
            currentUserId={user?.id || null}
            currentUserName={currentUserDisplayName}
            broadcastSeenIds={broadcastSeenIds}
            isOffline={isOffline}
            onViewProfile={onNavigateToFriendProfile}
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
          <View ref={coachChatHeader.targetRef as any} style={styles.headerRow}>
            <Text style={styles.title}>{t('connections:title')}</Text>
            <View style={styles.headerActions}>
              <TouchableOpacity
                onPress={() => openFriendsModal()}
                style={styles.headerIconBtn}
                activeOpacity={0.7}
              >
                <Icon name="people-outline" size={18} color="#eb7825" />
                {!badgeDismissed && (incomingRequests.length + incomingPairRequests.length) > 0 && (
                  <View style={styles.headerBadge}>
                    <Text style={styles.headerBadgeText}>
                      {(incomingRequests.length + incomingPairRequests.length) > 9
                        ? "9+"
                        : incomingRequests.length + incomingPairRequests.length}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleInvitePress}
                style={styles.headerIconBtn}
                activeOpacity={0.7}
              >
                <Icon name="link-outline" size={18} color="#eb7825" />
              </TouchableOpacity>

            </View>
          </View>

          {/* Paired friends pills — ORCH-0435 */}
          {activePairedPeople.length > 0 && (
            <PairedPillsBar
              people={activePairedPeople}
              onSelectPerson={(person) => onNavigateToFriendProfile?.(person.pairedUserId)}
              onAddPress={() => setShowPairRequestModal(true)}
              onPendingPress={(person) => {
                const pill = pairingPills.find(p => p.pairedUserId === person.pairedUserId && p.pillState !== 'active');
                if (!pill) return;
                Alert.alert(
                  'Cancel Pair Request',
                  `Cancel your pair request to ${person.displayName}?`,
                  [
                    { text: 'Keep', style: 'cancel' },
                    {
                      text: 'Cancel Request', style: 'destructive', onPress: () => {
                        if (pill.pairRequestId) cancelPairRequestMutation.mutate(pill.pairRequestId);
                        else if (pill.pendingInviteId) cancelPairInviteMutation.mutate(pill.pendingInviteId);
                      },
                    },
                  ]
                );
              }}
              onIncomingPress={(person) => {
                if (person.incomingRequest) {
                  setShowIncomingPairRequest(person.incomingRequest);
                }
              }}
            />
          )}
          {/* Incoming pair requests now show as greyed pills in the bar above */}

          {/* Search bar */}
          <View style={styles.searchContainer}>
            <Icon
              name="search"
              size={16}
              color="#9ca3af"
              style={styles.searchIcon}
            />
            <TextInput
              placeholder={t('connections:search_placeholder')}
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={styles.searchInput}
              placeholderTextColor="#9ca3af"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              autoComplete="off"
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </View>

          {/* Archived chats section */}
          {archivedConversations.length > 0 && (
            <TouchableOpacity
              style={styles.archivedSection}
              onPress={() => setShowArchived(!showArchived)}
              activeOpacity={0.7}
            >
              <Icon name="archive-outline" size={16} color="#6b7280" />
              <Text style={styles.archivedSectionText}>
                Archived ({archivedConversations.length})
              </Text>
              <Icon name={showArchived ? "chevron-up" : "chevron-down"} size={16} color="#9ca3af" />
            </TouchableOpacity>
          )}
          {showArchived && archivedConversations.map((conv) => {
            const otherP = conv.participants?.find((p) => p.id !== user?.id);
            const convName = otherP ? getDisplayName(otherP) : 'Chat';
            const cleanName = convName.includes("@") ? convName.substring(0, convName.indexOf("@")).trim() : convName;
            return (
              <View key={conv.id} style={styles.archivedRow}>
                <View style={styles.archivedAvatar}>
                  <Text style={styles.archivedAvatarText}>
                    {cleanName.split(" ").map(n => n[0]).join("").toUpperCase().substring(0, 2)}
                  </Text>
                </View>
                <Text style={styles.archivedName} numberOfLines={1}>{cleanName}</Text>
                <TouchableOpacity
                  onPress={() => handleUnarchiveChat(conv.id)}
                  style={styles.unarchiveBtn}
                  activeOpacity={0.7}
                >
                  <Text style={styles.unarchiveBtnText}>Unarchive</Text>
                </TouchableOpacity>
              </View>
            );
          })}

          {/* Chat list */}
          {conversationsLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#eb7825" />
            </View>
          ) : filteredConversations.length === 0 && !searchQuery.trim() ? (
            <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={styles.emptyContainer}>
              <Icon name="chatbubbles-outline" size={56} color="#d1d5db" />
              <Text style={styles.emptyTitle}>{t('connections:empty_title')}</Text>
              <Text style={styles.emptySubtitle}>{t('connections:empty_subtitle')}</Text>
              <TouchableOpacity
                onPress={() => openFriendsModal()}
                style={styles.emptyCtaButton}
                activeOpacity={0.7}
              >
                <Text style={styles.emptyCtaText}>{t('connections:start_chat')}</Text>
              </TouchableOpacity>
            </View>
            </TouchableWithoutFeedback>
          ) : filteredConversations.length === 0 && searchQuery.trim() ? (
            <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>{t('connections:no_results', { query: searchQuery })}</Text>
            </View>
            </TouchableWithoutFeedback>
          ) : (
            <FlatList
              data={filteredConversations}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              renderItem={({ item, index }) => {
                const isMuted = item.participants?.some((p) =>
                  mutedUserIds.includes(p.id)
                );
                const otherParticipant = item.participants?.find((p) => p.id !== user?.id);
                const participantPairStatus = otherParticipant?.id ? getPairStatus(otherParticipant.id) : 'not-friend' as const;
                const chatItem = (
                  <ChatListItem
                    conversation={item}
                    currentUserId={user?.id || ""}
                    onPress={handleSelectConversation}
                    isMuted={isMuted}
                    onAvatarPress={onNavigateToFriendProfile}
                    pairStatus={participantPairStatus}
                    onPairPress={handlePairFriend}
                    onUnpairPress={handleUnpairFriend}
                    pairLoading={otherParticipant?.id ? pairLoadingUserId === otherParticipant.id : false}
                    onPendingPairPress={(userId) => {
                      const pill = pairingPills.find(p => p.pairedUserId === userId && p.pillState !== 'active');
                      if (!pill) return;
                      Alert.alert('Cancel Pair Request', 'Cancel your pair request?', [
                        { text: 'Keep', style: 'cancel' },
                        { text: 'Cancel Request', style: 'destructive', onPress: () => {
                          if (pill.pairRequestId) cancelPairRequestMutation.mutate(pill.pairRequestId);
                          else if (pill.pendingInviteId) cancelPairInviteMutation.mutate(pill.pendingInviteId);
                        }},
                      ]);
                    }}
                    onArchive={handleArchiveChat}
                    onDelete={handleDeleteChat}
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
              ItemSeparatorComponent={null}
              refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor="#999" />}
            />
          )}
        </View>
      </View>

      {/* ORCH-0435: Consolidated 4-tab Friends Modal */}
      <Modal
        visible={showFriendsModal}
        animationType="slide"
        transparent
        onRequestClose={() => { dismissKeyboard(); setShowFriendsModal(false); }}
      >
        <View style={styles.sheetOverlay}>
          <TouchableWithoutFeedback onPress={() => { dismissKeyboard(); setShowFriendsModal(false); }}>
            <View style={styles.backdropFill} />
          </TouchableWithoutFeedback>

          <View
            style={[styles.sheetContainer, { height: sheetHeight, paddingBottom: keyboardVisible ? 0 : 32, marginBottom: keyboardVisible ? keyboardHeight : 0 }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Friends</Text>
              <TouchableOpacity onPress={() => { dismissKeyboard(); setShowFriendsModal(false); }} activeOpacity={0.7}>
                <Icon name="close" size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>

            {/* 4-Tab Bar */}
            <View style={styles.tabBar}>
              <TouchableOpacity
                onPress={() => setFriendsModalTab("friend-list")}
                style={[styles.tab, friendsModalTab === "friend-list" && styles.tabActive]}
                activeOpacity={0.7}
              >
                <Text style={[styles.tabText, friendsModalTab === "friend-list" && styles.tabTextActive]}>
                  Friends
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setFriendsModalTab("sent")}
                style={[styles.tab, friendsModalTab === "sent" && styles.tabActive]}
                activeOpacity={0.7}
              >
                <Text style={[styles.tabText, friendsModalTab === "sent" && styles.tabTextActive]}>
                  Sent
                </Text>
                {(outgoingRequests.length + pairingPills.filter(p => p.pillState !== 'active').length) > 0 && (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>
                      {outgoingRequests.length + pairingPills.filter(p => p.pillState !== 'active').length}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setFriendsModalTab("requests")}
                style={[styles.tab, friendsModalTab === "requests" && styles.tabActive]}
                activeOpacity={0.7}
              >
                <Text style={[styles.tabText, friendsModalTab === "requests" && styles.tabTextActive]}>
                  Requests
                </Text>
                {(incomingRequests.length + incomingPairRequests.length) > 0 && (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>
                      {incomingRequests.length + incomingPairRequests.length}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setFriendsModalTab("blocked")}
                style={[styles.tab, friendsModalTab === "blocked" && styles.tabActive]}
                activeOpacity={0.7}
              >
                <Text style={[styles.tabText, friendsModalTab === "blocked" && styles.tabTextActive]}>
                  Blocked
                </Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.sheetBody}
              contentContainerStyle={styles.sheetBodyContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
            >
              {/* Tab 1: Friend List = Add Friend + Friend List */}
              {friendsModalTab === "friend-list" && (
                <>
                  <AddFriendView
                    currentUserId={user?.id || ""}
                    onRequestSent={() => loadFriendRequests()}
                    outgoingRequests={outgoingRequests}
                    outgoingRequestsLoading={requestsLoading}
                    onCancelRequest={cancelFriendRequest}
                    onAddFriend={addFriend}
                  />
                  <View style={styles.friendListDivider} />
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
                    pairedUserIds={pairedUserIds}
                    pendingPairUserIds={pendingPairUserIds}
                    onPairFriend={handlePairFriend}
                    onUnpairFriend={handleUnpairFriend}
                    pairLoadingUserId={pairLoadingUserId}
                    onAvatarPress={(friendUserId) => {
                      setShowFriendsModal(false);
                      onNavigateToFriendProfile?.(friendUserId);
                    }}
                    onAddToSession={(friendUserId) => {
                      setShowFriendsModal(false);
                      // Find the friend and trigger collab invite
                      const friend = dbFriends.find(f => {
                        const fid = f.user_id === (user?.id || '') ? f.friend_user_id : f.user_id;
                        return fid === friendUserId;
                      });
                      if (friend) onSendCollabInvite?.(friend);
                    }}
                    onFriendPress={(friendUserId) => {
                      setShowFriendsModal(false);
                      const friend = dbFriends.find(f => {
                        const fid = f.user_id === (user?.id || '') ? f.friend_user_id : f.user_id;
                        return fid === friendUserId;
                      });
                      if (friend) handlePickFriend(friend);
                    }}
                  />
                </>
              )}

              {/* Tab 2: Sent = Outgoing friend requests + outgoing pair requests */}
              {friendsModalTab === "sent" && (
                <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
                  {outgoingRequests.length === 0 && pairingPills.filter(p => p.pillState !== 'active').length === 0 ? (
                    <View style={styles.modalEmptyState}>
                      <Icon name="paper-plane-outline" size={32} color="#d1d5db" />
                      <Text style={styles.modalEmptyText}>No sent requests</Text>
                    </View>
                  ) : (
                    <>
                      {/* Outgoing friend requests */}
                      {outgoingRequests.map((req) => {
                        const reqName = req.sender?.display_name || req.sender?.first_name || req.sender?.username || 'Unknown';
                        return (
                          <View key={req.id} style={styles.sentRequestRow}>
                            <View style={styles.sentRequestAvatar}>
                              <Text style={styles.sentRequestAvatarText}>
                                {reqName[0].toUpperCase()}
                              </Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.sentRequestName}>{reqName}</Text>
                              <Text style={styles.sentRequestType}>Friend request</Text>
                            </View>
                            <TouchableOpacity
                              onPress={() => cancelFriendRequest(req.id)}
                              style={styles.sentCancelBtn}
                              activeOpacity={0.7}
                            >
                              <Text style={styles.sentCancelText}>Cancel</Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                      {/* Outgoing pair requests */}
                      {pairingPills.filter(p => p.pillState !== 'active').map((pill) => (
                        <View key={pill.id} style={styles.sentRequestRow}>
                          <View style={styles.sentRequestAvatar}>
                            <Text style={styles.sentRequestAvatarText}>{pill.initials}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.sentRequestName}>{pill.displayName}</Text>
                            <Text style={styles.sentRequestType}>
                              Pair request · {pill.pillState === 'pending_active' ? 'Pending' : pill.pillState === 'greyed_waiting_friend' ? 'Waiting for friend' : pill.pillState === 'greyed_waiting_signup' ? 'Waiting for signup' : 'Pending'}
                            </Text>
                          </View>
                          <TouchableOpacity
                            onPress={() => {
                              if (pill.pairRequestId) cancelPairRequestMutation.mutate(pill.pairRequestId);
                              else if (pill.pendingInviteId) cancelPairInviteMutation.mutate(pill.pendingInviteId);
                            }}
                            style={styles.sentCancelBtn}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.sentCancelText}>Cancel</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </>
                  )}
                </View>
              )}

              {/* Tab 3: Requests = Incoming friend + pair requests */}
              {friendsModalTab === "requests" && (
                <View>
                  {/* Incoming pair requests */}
                  {incomingPairRequests.map((req) => (
                    <View key={req.id} style={styles.sentRequestRow}>
                      <View style={[styles.sentRequestAvatar, { backgroundColor: '#fff7ed' }]}>
                        <Icon name="star" size={18} color="#eb7825" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.sentRequestName}>{req.senderName}</Text>
                        <Text style={styles.sentRequestType}>Wants to pair with you</Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity
                          onPress={() => declinePairRequestMutation.mutate(req.id)}
                          style={styles.sentCancelBtn}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.sentCancelText}>Decline</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => acceptPairRequestMutation.mutate(req.id)}
                          style={[styles.sentCancelBtn, { backgroundColor: '#eb7825', borderColor: '#eb7825' }]}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.sentCancelText, { color: '#ffffff' }]}>Accept</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                  {/* Incoming friend requests */}
                  <RequestsView
                    requests={incomingRequests}
                    loading={friendsLoading || requestsLoading}
                    onAccept={handleAcceptRequest}
                    onDecline={handleDeclineRequest}
                  />
                </View>
              )}

              {/* Tab 4: Blocked */}
              {friendsModalTab === "blocked" && (
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

      {/* ORCH-0435: Pairing modals */}
      <PairRequestModal
        visible={showPairRequestModal}
        onClose={() => setShowPairRequestModal(false)}
        onPairRequestSent={() => {
          setShowPairRequestModal(false);
          showToast({ message: 'Pair request sent!', type: 'info' });
        }}
      />

      <IncomingPairRequestCard
        visible={!!showIncomingPairRequest}
        request={showIncomingPairRequest}
        onAccept={() => {
          setShowIncomingPairRequest(null);
          showToast({ message: 'Pair request accepted!', type: 'info' });
        }}
        onDecline={() => {
          setShowIncomingPairRequest(null);
        }}
        onClose={() => setShowIncomingPairRequest(null)}
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
    paddingVertical: 12,
    minHeight: 62,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#6B7280",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
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
  // ── Archived section (ORCH-0435) ──────
  archivedSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#f9fafb",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
  },
  archivedSectionText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: "#6b7280",
  },
  archivedRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  archivedAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.6,
  },
  archivedAvatarText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#ffffff",
  },
  archivedName: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
    color: "#9ca3af",
  },
  unarchiveBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
  },
  unarchiveBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6b7280",
  },
  // ── Modal empty state (ORCH-0435) ──────
  modalEmptyState: {
    paddingVertical: 24,
    alignItems: "center",
    marginHorizontal: 16,
  },
  modalEmptyText: {
    fontSize: 14,
    color: "#9ca3af",
    marginTop: 8,
  },
  // ── Friend list divider (ORCH-0435) ──────
  friendListDivider: {
    height: 1,
    backgroundColor: "#e5e7eb",
    marginVertical: 12,
    marginHorizontal: 16,
  },
  // ── Sent request rows (ORCH-0435) ──────
  sentRequestRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  sentRequestAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  sentRequestAvatarText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  sentRequestName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  sentRequestType: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 2,
  },
  sentCancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#f9fafb",
  },
  sentCancelText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6b7280",
  },
  // ── Incoming pair banner (ORCH-0435) ──────
  incomingPairBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#fff7ed",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#fed7aa",
  },
  incomingPairBannerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  // ── Search ────────────────────────────────
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 10,
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 44,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: "#1f2937",
    paddingVertical: 0,
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
