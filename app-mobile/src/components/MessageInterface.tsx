import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ScrollView,
  FlatList,
  Image,
  Alert,
  Platform,
  Linking,
  Modal,
  Dimensions,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { Icon } from "./ui/Icon";
import * as ImagePicker from "expo-image-picker";
import * as WebBrowser from "expo-web-browser";
// TODO: Uncomment after rebuilding app with expo-av native module
// import { Video, ResizeMode } from "expo-av";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { supabase } from "../services/supabase";
import { useKeyboard } from "../hooks/useKeyboard";
import { useChatPresence } from "../hooks/useChatPresence";
import { useBroadcastReceiver } from "../hooks/useBroadcastReceiver";
import { MessageBubble, type CollabSystemToken } from "./chat/MessageBubble";
import PreferencesSheet, { type PreferencesSheetFocusSection } from "./PreferencesSheet";
import { ChatInputChipsLayer } from "./chat/ChatInputChipsLayer";
import { MessageContextMenu } from "./chat/MessageContextMenu";
import { ReplyPreviewBar } from "./chat/ReplyPreviewBar";
import { SwipeableMessage } from "./chat/SwipeableMessage";
import { DoubleTapHeart } from "./chat/DoubleTapHeart";
import { ChatStatusLine } from "./chat/ChatStatusLine";
import { TripCountdownBanner } from "./chat/TripCountdownBanner";
import {
  SavedToSessionCardsSheet,
  ScheduleSheet,
  useSessionSavedCardsForSheet,
} from "./chat/CollabSessionChatBanners";
import { CollabDeckSheet } from "./connections/CollabDeckSheet";
import {
  getCollabChatHeaderActions,
  type CollabChatHeaderActionId,
} from "./connections/collabChatHeaderUtils";
import { BoardSettingsDropdown } from "./board/BoardSettingsDropdown";
import { MentionPopover } from "./board/MentionPopover";
import { CardTagPopover } from "./board/CardTagPopover";
import type { Participant } from "./board/ParticipantAvatars";
import { groupMessages, GroupedMessage } from "../utils/messageGrouping";
import { DirectMessage, messagingService, CardPayload, MentionEntry, CardTagEntry } from "../services/messagingService";
import { cardPayloadToExpandedCardData } from "../services/cardPayloadAdapter";  // ORCH-0685
import { savedCardsService } from "../services/savedCardsService";  // ORCH-0685
import { useSavedCards } from "../hooks/useSavedCards";
import { useSessionScheduledCards } from "../hooks/useSessionScheduledCards";
import { useBoardSession } from "../hooks/useBoardSession";
import { useConversationParticipants } from "../hooks/useConversationParticipants";
import { useChatCardTagSource } from "../hooks/useChatCardTagSource";
import { useChatInputController } from "../hooks/useChatInputController";
import ExpandedCardModal from "./ExpandedCardModal";  // ORCH-0667
import { ExpandedBusinessEventSheet } from "./expandedCard/ExpandedBusinessEventSheet";
import type { ExpandedCardData } from "../types/expandedCardTypes";  // ORCH-0685
import type { BusinessEventCard } from "../types/mergedDiscover";
import { useTranslation } from 'react-i18next';
import { HapticFeedback } from "../utils/hapticFeedback";
import { colors as dsColors, spacing as dsSpacing, glass, ANDROID_GLASS_USES_OPAQUE_FALLBACK } from "../constants/designSystem";
import { colors } from "../constants/colors";
import { useAppLayout } from "../hooks/useAppLayout";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

/** Vertical gap between composer border and input row; match bottom when keyboard is closed. */
const INPUT_AREA_VERTICAL_PADDING = 6;
/** ORCH-0600: breathing gap between floating glass input capsule and the bottom nav. */
const INPUT_CAPSULE_MARGIN_BOTTOM = 14;
/** ORCH-0600: intrinsic height of the glass input capsule (padding + 40pt controls). */
const INPUT_CAPSULE_HEIGHT = 56;
/** Bottom read-only broadcast pill height; used to keep chat bubbles and sheets above it. */
const BROADCAST_COMPOSER_NOTICE_HEIGHT = 56;
const BROADCAST_COMPOSER_NOTICE_BOTTOM_GAP = 14;
const BROADCAST_COMPOSER_NOTICE_CONTENT_GAP = 12;

interface Message {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
  type: "text" | "image" | "video" | "file" | "card";
  fileUrl?: string;
  fileName?: string;
  fileSize?: string;
  cardPayload?: CardPayload;  // ORCH-0667
  mentions?: Array<MentionEntry | string>;
  cardTags?: CardTagEntry[];
  isMe: boolean;
  unread?: boolean;
  failed?: boolean;
  isRead?: boolean;
  replyToId?: string;
  marketingCampaignId?: string | null;
  isSystem?: boolean;
}

interface Friend {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  avatar_url?: string;
  status?: string;
  isOnline: boolean;
  lastSeen?: string;
  mutualFriends?: number;
  isMuted?: boolean;
  conversationType?: "direct" | "group";
  sessionId?: string | null;
  eventId?: string | null;
  linkedEntityType?: "direct" | "session" | "trip" | "event" | null;
  sessionCreatorId?: string | null;
  eventBrandName?: string | null;
  eventBrandAccountId?: string | null;
  eventCoverMediaUrl?: string | null;
  eventPublicUrl?: string | null;
  eventPublicCard?: BusinessEventCard | null;
  isBroadcastOnly?: boolean;
  isSessionAdmin?: boolean;
  notificationsMuted?: boolean;
  participantCount?: number;
  participants?: {
    id: string;
    name?: string;
    username?: string;
    avatar_url?: string;
    is_online?: boolean;
  }[];
}

interface MessageInterfaceProps {
  friend: Friend;
  onBack: () => void;
  onSendMessage: (
    content: string,
    type: "text" | "image" | "video" | "file",
    file?: File,
    replyToId?: string,
    mentions?: MentionEntry[],
    cardTags?: CardTagEntry[],
  ) => void;
  messages: Message[];
  /**
   * ORCH-0666: invoked when user taps "Add to Board" in the more-options menu.
   * Owner: ConnectionsPage (mounts AddToBoardModal with sessionMembershipService
   * .addFriendsToSessions RPC). REQUIRED (not optional) — TypeScript catches
   * missing wiring. Replaces dead-tap onAddToBoard + onSendCollabInvite chain
   * that was fake-success theatre via in-component BoardSelection sub-UI
   * (deleted in this cycle). Constitution #1 / #3 closures.
   */
  onOpenAddToBoardModal: (friend: Friend) => void;
  onShareSavedCard?: (friend: any, suppressNotification?: boolean) => void;
  onRemoveFriend?: (friend: any, suppressNotification?: boolean) => void;
  onBlockUser?: (friend: any, suppressNotification?: boolean) => void;
  onReportUser?: (friend: any, suppressNotification?: boolean) => void;
  accountPreferences?: any;
  userPreferences?: any;
  savedCards?: any[];
  onCardLike?: (card: any) => Promise<boolean>;
  onAddToCalendar?: (experienceData: any) => void;
  onShareCard?: (card: any) => void;
  onPurchaseComplete?: (experienceData: any, purchaseOption: any) => void;
  onOpenPreferences?: () => void;
  onOpenCollabPreferences?: (sessionId?: string, sessionName?: string) => void;
  isBlocked?: boolean;
  isUnfriended?: boolean;
  isDeletedAccount?: boolean;
  conversationId?: string | null;
  currentUserId?: string | null;
  currentUserName?: string | null;
  broadcastSeenIds?: React.MutableRefObject<Set<string>>;
  /**
   * ORCH-0664 (REQUIRED): invoked when the chat:{conversationId} broadcast
   * channel delivers a new incoming message. Owner: ConnectionsPage. The
   * handler MUST add the message to UI state AND call
   * broadcastSeenIds.add(msg.id) as a coupled operation (in that order) —
   * partial implementations re-introduce the I-DEDUP-AFTER-DELIVERY bug
   * class. Required (not optional) by contract; "no-op fallback" was the
   * exact pre-0664 shape that silently dropped every received message.
   */
  onBroadcastReceive: (msg: DirectMessage) => void;
  isOffline?: boolean;
  onViewProfile?: (userId: string) => void;
  onSessionNameUpdated?: (sessionId: string, newName: string) => void;
  onGroupSessionExited?: (sessionId: string) => void;
  onGroupSessionDeleted?: (sessionId: string) => void;
  onGroupParticipantsChange?: () => void;
}

export default function MessageInterface({
  friend,
  onBack,
  onSendMessage,
  messages,
  onOpenAddToBoardModal,
  onShareSavedCard,
  onRemoveFriend,
  onBlockUser,
  onReportUser,
  accountPreferences,
  userPreferences,
  savedCards = [],
  onCardLike,
  onAddToCalendar,
  onShareCard,
  onPurchaseComplete,
  onOpenPreferences,
  isBlocked = false,
  isUnfriended = false,
  isDeletedAccount = false,
  conversationId = null,
  currentUserId = null,
  currentUserName = null,
  broadcastSeenIds: broadcastSeenIdsProp,
  onBroadcastReceive,
  isOffline = false,
  onViewProfile,
  onSessionNameUpdated,
  onGroupSessionExited,
  onGroupSessionDeleted,
  onGroupParticipantsChange,
}: MessageInterfaceProps) {
  const { t } = useTranslation(['chat', 'common', 'social']);
  // Helper function to clean email-like names
  const cleanName = (name: string): string => {
    if (!name) return "Unknown";
    // Remove @domain part if present (e.g., "john@gmail.com" -> "john")
    const atIndex = name.indexOf("@");
    if (atIndex !== -1) {
      return name.substring(0, atIndex).trim();
    }
    return name.trim();
  };
  const isGroupChat = friend.conversationType === "group";
  const isTripEventGroupChat =
    isGroupChat && (friend.linkedEntityType === "trip" || friend.linkedEntityType === "event");
  const isCollabSessionGroupChat =
    isGroupChat && friend.linkedEntityType === "session" && !!friend.sessionId;
  const headerTitle = cleanName(friend.name);
  const headerParticipants = useMemo(() => friend.participants ?? [], [friend.participants]);
  const headerParticipantCount = friend.participantCount ?? headerParticipants.length;
  const visibleHeaderParticipants = headerParticipants.slice(0, 3);
  const eventAudienceKind = friend.linkedEntityType === "trip" ? "travelling" : "attending";
  const eventAudienceTitle = friend.linkedEntityType === "trip" ? "Travellers" : "Attendees";
  const eventAudienceSubtitle = `${headerParticipantCount} ${eventAudienceKind}`;
  const getMessageSenderName = (msg: Message): string => {
    const brandName = friend.eventBrandName?.trim();
    const brandAccountId = friend.eventBrandAccountId?.trim();
    if (
      isTripEventGroupChat &&
      brandName &&
      (
        msg.marketingCampaignId ||
        (brandAccountId && msg.senderId === brandAccountId)
      )
    ) {
      return brandName;
    }

    return msg.isMe
      ? (currentUserName || msg.senderName || 'You')
      : cleanName(msg.senderName || friend.name);
  };
  const getHeaderParticipantName = (participant: NonNullable<Friend["participants"]>[number]): string =>
    cleanName(participant.name || participant.username || "User");

  const getHeaderInitials = (name: string): string =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .substring(0, 2) || "?";

  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [showImagePreview, setShowImagePreview] = useState(false);
  const [showMoreOptionsMenu, setShowMoreOptionsMenu] = useState(false);
  const [showCollabDeckSheet, setShowCollabDeckSheet] = useState(false);
  const [showCollabMatchesSheet, setShowCollabMatchesSheet] = useState(false);
  const [showCollabPlansSheet, setShowCollabPlansSheet] = useState(false);
  const [collabPrefsLink, setCollabPrefsLink] = useState<{
    visible: boolean;
    viewParticipantId?: string;
    initialFocusSection?: PreferencesSheetFocusSection;
  }>({ visible: false });
  const [showEventAudienceSheet, setShowEventAudienceSheet] = useState(false);
  // ORCH-0667: shared-card picker state
  const [showSavedCardPicker, setShowSavedCardPicker] = useState(false);
  const [pickerSubmittingCardId, setPickerSubmittingCardId] = useState<string | null>(null);
  // ORCH-0685: typed state — replaces unsafe `any` typing (Constitution #12 fix).
  // Populated via cardPayloadToExpandedCardData helper (cardPayloadAdapter.ts).
  const [expandedCardFromChat, setExpandedCardFromChat] = useState<ExpandedCardData | null>(null);
  const [showExpandedCardFromChat, setShowExpandedCardFromChat] = useState(false);
  const [showGroupEventSheet, setShowGroupEventSheet] = useState(false);
  // ORCH-0685: Save handler state (CF-2 dead-tap fix).
  const [isSavingSharedCard, setIsSavingSharedCard] = useState(false);
  const [sharedCardIsSaved, setSharedCardIsSaved] = useState(false);
  const savedCardsQuery = useSavedCards(currentUserId ?? undefined);
  const participantsQuery = useConversationParticipants(conversationId, currentUserId);
  const chatCardTagSource = useChatCardTagSource({
    conversationType: isGroupChat ? "group" : "direct",
    sessionId: friend.sessionId ?? null,
    currentUserId,
  });
  const scheduledCardsQuery = useSessionScheduledCards(
    isCollabSessionGroupChat ? friend.sessionId : null,
  );
  const { session: collabSession, isAdmin: isCollabSessionAdmin } = useBoardSession(
    isCollabSessionGroupChat ? friend.sessionId ?? undefined : undefined,
  );
  const groupSettingsParticipants = useMemo(() => {
    const collabParticipants = (collabSession?.participants as any[] | undefined) ?? [];
    if (isCollabSessionGroupChat && collabParticipants.length > 0) {
      return collabParticipants;
    }

    return headerParticipants.map((participant) => ({
      user_id: participant.id,
      session_id: friend.sessionId ?? "",
      has_accepted: true,
      is_admin: participant.id === friend.sessionCreatorId,
      notifications_muted: participant.id === currentUserId
        ? friend.notificationsMuted ?? false
        : false,
      profiles: {
        id: participant.id,
        username: participant.username,
        display_name: participant.name,
        avatar_url: participant.avatar_url,
      },
    }));
  }, [
    collabSession?.participants,
    currentUserId,
    friend.notificationsMuted,
    friend.sessionCreatorId,
    friend.sessionId,
    headerParticipants,
    isCollabSessionGroupChat,
  ]);
  const {
    savedCards: matchedSessionCards,
    isLoading: matchedSessionCardsLoading,
  } = useSessionSavedCardsForSheet(
    isCollabSessionGroupChat ? friend.sessionId : null,
  );
  const collabHeaderActions = useMemo(
    () =>
      isCollabSessionGroupChat
        ? getCollabChatHeaderActions({
            matchesCount: matchedSessionCards.length,
            scheduledCount: scheduledCardsQuery.rows.length,
            matchesLoading: matchedSessionCardsLoading,
            scheduledLoading: scheduledCardsQuery.isLoading,
          })
        : [],
    [
      isCollabSessionGroupChat,
      matchedSessionCards.length,
      matchedSessionCardsLoading,
      scheduledCardsQuery.isLoading,
      scheduledCardsQuery.rows.length,
    ],
  );
  const collabParticipantCount =
    (collabSession?.participants as any[] | undefined)?.length || headerParticipantCount;
  const inputRef = useRef<TextInput>(null);
  const chatController = useChatInputController({
    participants: participantsQuery.data ?? [],
    cardTagSource: chatCardTagSource.data,
  });
  const newMessage = chatController.text;

  const handleSystemTokenPress = useCallback((token: CollabSystemToken) => {
    if (!isCollabSessionGroupChat || !friend.sessionId) return;

    if (token.type === 'open-prefs-self') {
      setCollabPrefsLink({
        visible: true,
        initialFocusSection: token.section,
      });
      return;
    }

    if (token.type === 'open-prefs') {
      setCollabPrefsLink({
        visible: true,
        viewParticipantId: token.userId === currentUserId ? undefined : token.userId,
        initialFocusSection: token.section,
      });
      return;
    }

    if (token.type === 'open-dismissed') {
      setShowCollabDeckSheet(true);
      return;
    }

    const participantName =
      participantsQuery.data?.find((participant) => participant.userId === token.userId)?.displayName ||
      headerParticipants.find((participant) => participant.id === token.userId)?.name ||
      'friend';
    chatController.setDraftText(`@${participantName} ${token.text}`);
    setTimeout(() => inputRef.current?.focus?.(), 50);
  }, [
    chatController,
    currentUserId,
    friend.sessionId,
    headerParticipants,
    inputRef,
    isCollabSessionGroupChat,
    participantsQuery.data,
  ]);

  const mentionPopoverParticipants: Participant[] = useMemo(
    () =>
      chatController.filteredParticipants.map((participant) => ({
        id: participant.userId,
        user_id: participant.userId,
        session_id: friend.sessionId ?? "",
        has_accepted: true,
        profiles: {
          id: participant.userId,
          username: participant.username ?? "",
          display_name: participant.displayName,
          avatar_url: participant.avatarUrl ?? undefined,
        },
      })),
    [chatController.filteredParticipants, friend.sessionId],
  );

  const cardTagPopoverCards = useMemo(
    () =>
      chatController.filteredCards.map((card) => ({
        id: card.savedCardId,
        card_data: {
          id: card.cardPayload.id,
          title: card.cardPayload.title,
          category: card.cardPayload.category ?? undefined,
          categoryIcon: card.cardPayload.categoryIcon,
          image: card.cardPayload.image ?? undefined,
          images: card.cardPayload.images,
        },
        experience_data: {
          id: card.cardPayload.id,
          title: card.cardPayload.title,
          category: card.cardPayload.category ?? undefined,
          categoryIcon: card.cardPayload.categoryIcon,
          image: card.cardPayload.image ?? undefined,
          images: card.cardPayload.images,
        },
      })),
    [chatController.filteredCards],
  );

  // ORCH-0685 cycle-3 (Pattern F): derive sharedCardIsSaved from the cached
  // saves list so already-saved chat cards open with the "Saved" button on
  // first paint instead of the stale "Save" default.
  useEffect(() => {
    if (!expandedCardFromChat) {
      setSharedCardIsSaved(false);
      return;
    }
    const list = savedCardsQuery.data;
    if (!list) {
      setSharedCardIsSaved(false);
      return;
    }
    const isAlreadySaved = list.some((c) => c.id === expandedCardFromChat.id);
    setSharedCardIsSaved(isAlreadySaved);
  }, [expandedCardFromChat, savedCardsQuery.data]);

  const [revealedTimestampId, setRevealedTimestampId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    messageId: string;
    content: string;
    isMe: boolean;
    top: number;
  }>({ visible: false, messageId: '', content: '', isMe: false, top: 0 });
  const [replyingTo, setReplyingTo] = useState<{
    messageId: string;
    senderName: string;
    content: string;
    isMe: boolean;
  } | null>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const flatListRef = useRef<FlatList>(null);
  const { bottomNavTotalHeight } = useAppLayout();
  // ORCH-0610 fix: Android overlap — the Mingla nav uses bottom: insets.bottom + 6
  // (see app/index.tsx CoachMarkNavigationGate) so its TOP edge is higher than
  // bottomNavTotalHeight alone implies. Add 19pt to the input capsule's bottom
  // offset (and matching chat-list padding) so the capsule clears the nav top
  // with an 8pt visual gap. iOS nav uses bottom: 11 which is already below
  // bottomNavTotalHeight, so no adjustment needed.
  const ANDROID_NAV_OVERLAP_FIX = Platform.OS === 'android' ? 19 : 0;
  const safeInsets = useSafeAreaInsets();

  // ── Keyboard handling via useKeyboard hook ─────────────────
  const { keyboardHeight, isVisible: keyboardVisible, dismiss: dismissKeyboard } = useKeyboard({
    disableLayoutAnimation: true, // We use animated values instead
  });

  // [REGRESSION GUARD] ORCH-0620 — Android keyboard handling relies on
  // `softwareKeyboardLayoutMode: "resize"` in app.json. Switching back to "pan"
  // reintroduces the OS-pan vs JS-lift race condition that clips the header and
  // floats the composer mid-screen. See:
  //   Mingla_Artifacts/outputs/INVESTIGATION_ANDROID_DM_KEYBOARD_BUG_REPORT.md
  //
  // Under "resize":
  //   - Android OS shrinks the window when the keyboard opens. Absolute children
  //     of MessageInterface (the input capsule) follow the shrunken bottom edge
  //     naturally — no manual lift needed on Android.
  //   - iOS does not resize/pan; we still manually lift the composer above the
  //     keyboard using keyboardHeight.

  // ── Fallback broadcastSeenIds ref if not provided ─────────
  const localBroadcastSeenIds = useRef(new Set<string>());
  const broadcastSeenIds = broadcastSeenIdsProp || localBroadcastSeenIds;

  // ── Presence & typing ─────────────────────────────────────
  const {
    participants: presenceParticipants,
    typingUsers,
    startTyping,
    stopTyping,
  } = useChatPresence({
    conversationId,
    currentUserId,
  });

  // ── Broadcast receiver (receive-only) ─────────────────────
  // ORCH-0664: this hook subscribes to the `chat:{conversationId}` broadcast
  // channel for instant incoming-message delivery. The handler is owned by
  // ConnectionsPage (passed in via `onBroadcastReceive`); MessageInterface
  // is just the mount point. ConnectionsPage.handleSendMessage also relies
  // on this channel being subscribed so that `supabase.channel()` returns
  // the existing subscribed instance for `.send()`. Do NOT remove this hook
  // without first relocating both the broadcast subscription and the
  // ConnectionsPage send-path channel reference (tracked as ORCH-0664.D-3 /
  // HF-0664-A).
  useBroadcastReceiver({
    conversationId,
    currentUserId,
    broadcastSeenIds,
    onBroadcastMessage: onBroadcastReceive,
  });

  // ── Message grouping (memoized) ───────────────────────────
  // groupMessages returns chronological order (oldest first).
  // FlatList with inverted={true} renders data[0] at the BOTTOM,
  // so we reverse to put newest first → newest appears at bottom.
  const groupedMessages = useMemo(() => {
    if (!messages.length) return [];
    const grouped = groupMessages(messages);
    return [...grouped].reverse();
  }, [messages]);

  // ── Presence-derived state for header ─────────────────────
  // presenceParticipants is Record<userId, { isOnline, lastSeenAt }>
  // typingUsers is string[] of userIds
  const otherPresence = useMemo(() => {
    if (!currentUserId) return null;
    const entries = Object.entries(presenceParticipants);
    const other = entries.find(([uid]) => uid !== currentUserId);
    return other ? other[1] : null;
  }, [presenceParticipants, currentUserId]);

  // ���─ Message lookup map for reply-to resolution ────────────
  // Includes both loaded messages and lazily-fetched reply-to references
  const [replyCache, setReplyCache] = useState<Map<string, Message>>(new Map());
  const replyFetchingRef = useRef<Set<string>>(new Set());

  const messageMap = useMemo(() => {
    const map = new Map<string, Message>();
    // Merge reply cache first so loaded messages take priority
    for (const [id, msg] of replyCache) {
      map.set(id, msg);
    }
    for (const msg of messages) {
      map.set(msg.id, msg);
    }
    return map;
  }, [messages, replyCache]);

  // Collect all replyToIds that are missing from the map and fetch them
  useEffect(() => {
    if (!currentUserId) return;
    let active = true;

    const missingIds: string[] = [];
    for (const msg of messages) {
      if (msg.replyToId && !messageMap.has(msg.replyToId) && !replyFetchingRef.current.has(msg.replyToId)) {
        missingIds.push(msg.replyToId);
      }
    }
    if (missingIds.length === 0) return;

    for (const id of missingIds) {
      replyFetchingRef.current.add(id);
    }

    Promise.all(
      missingIds.map((id) => messagingService.getMessageById(id, currentUserId!))
    ).then((results) => {
      if (!active) return;
      const newEntries = new Map<string, Message>();
      for (let i = 0; i < results.length; i++) {
        const { message: fetched } = results[i];
        if (fetched) {
          newEntries.set(missingIds[i], {
            id: fetched.id,
            senderId: fetched.sender_id ?? '',
            senderName: fetched.sender_name || 'Unknown',
            content: fetched.content,
            timestamp: fetched.created_at,
            type: fetched.message_type,
            fileUrl: fetched.file_url,
            fileName: fetched.file_name,
            fileSize: fetched.file_size?.toString(),
            isMe: fetched.sender_id === currentUserId,
            isRead: fetched.is_read ?? false,
          });
        }
      }
      if (newEntries.size > 0) {
        setReplyCache((prev) => {
          const next = new Map(prev);
          for (const [id, msg] of newEntries) {
            next.set(id, msg);
          }
          return next;
        });
      }
    }).catch(() => {
      // Silent — UI shows "deleted" as fallback until fetch succeeds
    }).finally(() => {
      for (const id of missingIds) {
        replyFetchingRef.current.delete(id);
      }
    });

    return () => { active = false; };
  }, [messages, currentUserId, messageMap]);

  const isOtherOnline = otherPresence?.isOnline ?? friend.isOnline;
  const otherLastSeen = otherPresence?.lastSeenAt ?? null;
  const isOtherTyping = currentUserId
    ? typingUsers.some((uid) => uid !== currentUserId)
    : false;

  const handleSendMessage = () => {
    if (newMessage.trim() || selectedFile) {
      const replyToId = replyingTo?.messageId;
      const { content, mentions, cardTags } = chatController.serializeForSend();
      setReplyingTo(null); // Clear reply state immediately

      if (selectedFile) {
        const fileType =
          selectedFile.type === "image"
            ? "image"
            : selectedFile.type === "video"
            ? "video"
            : "file";
        onSendMessage(
          content || selectedFile.name || "Media",
          fileType,
          selectedFile,
          replyToId,
          mentions,
          cardTags,
        );
        setSelectedFile(null);
        setPreviewUrl("");
      } else {
        onSendMessage(content, "text", undefined, replyToId, mentions, cardTags);
      }
      chatController.reset();
      stopTyping();
      HapticFeedback.light();
    }
  };

  const handleFileSelect = async (type: "image" | "video" | "file") => {
    try {
      setShowAttachmentMenu(false);

      // Request permissions
      if (type === "image" || type === "video") {
        const { status } =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            t('chat:permissionRequired'),
            t('chat:mediaLibraryPermission')
          );
          return;
        }
      }

      // Show processing loader BEFORE opening image picker
      setIsProcessingFile(true);

      let result;

      if (type === "image") {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: 'images',
          allowsEditing: false, // Disabled to avoid white background and "Crop" button issues
          quality: 0.7, // Reduced quality for faster processing
          allowsMultipleSelection: false,
        });
      } else if (type === "video") {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: 'videos',
          allowsEditing: false, // Disabled to avoid UI issues
          quality: 0.7, // Reduced quality for faster processing
          allowsMultipleSelection: false,
        });
      } else {
        // For documents, use image picker with all types (fallback)
        // Note: For better document support, consider installing expo-document-picker
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images', 'videos'],
          allowsEditing: false,
          allowsMultipleSelection: false,
        });
      }

      if (result.canceled || !result.assets || result.assets.length === 0) {
        setIsProcessingFile(false);
        return;
      }

      const asset = result.assets[0];

      // Create file object matching what handleSendMessage expects
      const file = {
        uri: asset.uri,
        name:
          asset.fileName ||
          `file_${Date.now()}.${asset.uri.split(".").pop() || "jpg"}`,
        type: asset.type, // 'image' | 'video' | 'unknown'
        size: asset.fileSize || 0,
      };

      // Set file and prepare preview - loader stays visible
      setSelectedFile(file);
      setIsLoadingPreview(true);
      setPreviewUrl(""); // Clear preview URL initially

      // Set preview URL and hide processing loader only when preview is ready
      if (asset.type === "image" || asset.type === "video") {
        // Set preview URL
        setPreviewUrl(asset.uri);

        // Wait for image to load, then hide processing loader and preview loader
        setTimeout(() => {
          setIsLoadingPreview(false);
          setIsProcessingFile(false); // Hide processing loader only when preview is ready
        }, 500); // Delay to ensure image loads
      } else {
        // For non-image/video files, hide loaders immediately
        setIsLoadingPreview(false);
        setIsProcessingFile(false);
      }
    } catch (error) {
      console.error("Error selecting file:", error);
      setIsLoadingPreview(false);
      setIsProcessingFile(false);
      setSelectedFile(null);
      setPreviewUrl("");
      Alert.alert(t('social:error'), t('chat:errorSelectFile'));
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setPreviewUrl("");
    setIsLoadingPreview(false);
    setIsProcessingFile(false);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleViewDocument = async (url: string) => {
    try {
      // Check if URL is valid
      if (!url) {
        Alert.alert(t('social:error'), t('chat:errorDocumentUrl'));
        return;
      }

      // Try to open in WebBrowser first (for PDFs and web-viewable documents)
      try {
        await WebBrowser.openBrowserAsync(url, {
          showTitle: true,
          toolbarColor: "#eb7825",
          enableBarCollapsing: false,
        });
      } catch (error) {
        // Fallback to Linking for native apps
        const canOpen = await Linking.canOpenURL(url);
        if (canOpen) {
          await Linking.openURL(url);
        } else {
          Alert.alert(
            t('social:error'),
            t('chat:errorOpenDocument')
          );
        }
      }
    } catch (error) {
      console.error("Error opening document:", error);
      Alert.alert(t('social:error'), t('chat:errorOpenDocumentGeneric'));
    }
  };

  const handleOpenVideo = async (url: string) => {
    try {
      if (!url) {
        Alert.alert(t('social:error'), t('chat:errorVideoUrl'));
        return;
      }
      // Try to open video externally as fallback
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        Alert.alert(
          t('social:error'),
          t('chat:errorOpenVideo')
        );
      }
    } catch (error) {
      console.error("Error opening video:", error);
      Alert.alert(t('social:error'), t('chat:errorOpenVideoGeneric'));
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString();
  };

  // Notification management
  const showNotification = (
    title: string,
    message: string,
    type: "success" | "error" | "info" = "success"
  ) => {
    const notification = {
      id: `local-${Date.now()}`,
      title,
      message,
      type,
      timestamp: Date.now(),
    };
    setNotifications((prev) => [...prev, notification]);

    // Auto-dismiss after 3 seconds
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
    }, 3000);
  };

  const dismissNotification = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  // ORCH-0685 cycle-3: brand-aligned notification rendering. Shared between
  // the always-mounted panel and the chat-shared-card overlay panel so both
  // surfaces look identical.
  const getNotificationVisuals = (type: "success" | "error" | "info") => {
    switch (type) {
      case "success":
        return {
          stripeColor: colors.success,
          bgColor: colors.successLight,
          borderColor: colors.success,
          iconName: "checkmark-circle" as const,
          iconColor: colors.successDark,
        };
      case "error":
        return {
          stripeColor: colors.error,
          bgColor: "#fef2f2",
          borderColor: colors.error,
          iconName: "alert-circle" as const,
          iconColor: colors.error,
        };
      case "info":
      default:
        return {
          stripeColor: colors.primary,
          bgColor: colors.lightOrange,
          borderColor: colors.primary,
          iconName: "info" as const,
          iconColor: colors.primary,
        };
    }
  };

  const renderNotificationCard = (notification: any, withPointerEvents: boolean) => {
    const v = getNotificationVisuals(notification.type ?? "info");
    return (
      <View
        key={notification.id}
        style={[
          styles.notification,
          { backgroundColor: v.bgColor, borderColor: v.borderColor },
        ]}
        pointerEvents={withPointerEvents ? "auto" : undefined}
      >
        <View style={[styles.notificationIndicator, { backgroundColor: v.stripeColor }]} />
        <View style={styles.notificationContent}>
          <View style={styles.notificationTitleRow}>
            <Icon name={v.iconName} size={18} color={v.iconColor} />
            <Text style={styles.notificationTitle}>{notification.title}</Text>
          </View>
          {notification.message ? (
            <Text style={styles.notificationMessage}>{notification.message}</Text>
          ) : null}
        </View>
        <TouchableOpacity
          onPress={() => dismissNotification(notification.id)}
          style={styles.dismissButton}
          accessibilityLabel="Dismiss notification"
        >
          <Icon name="close" size={14} color={colors.gray500} />
        </TouchableOpacity>
      </View>
    );
  };

  // More options handlers

  // ORCH-0666: delegate to ConnectionsPage which mounts AddToBoardModal (real
  // flow with sessionMembershipService.addFriendsToSessions RPC, sessionMembership
  // toasts via addToBoardToasts util). The pre-0666 in-component BoardSelection
  // sub-UI + onAddToBoard prop chain + handleBoardSelection success toast were
  // fake-success theatre — Constitution #1 (dead tap once user navigated past)
  // + #3 (silent fake-success). Empty-boards check + "no boards" toast are now
  // owned by AddToBoardModal's empty-state UI. Deleted in cycle 2.
  const handleAddToBoard = () => {
    setShowMoreOptionsMenu(false);
    onOpenAddToBoardModal(friend);
  };

  // ORCH-0667: Real flow. Opens the saved-card picker.
  // The lying success toast and the prop-call to onShareSavedCard (which was
  // toast-only at the AppHandlers terminal) have been deleted per Constitution
  // #1/#3/#9. Real success/failure toasts fire from handleSelectCardToShare
  // based on the actual send result.
  const handleShareSavedCard = () => {
    setShowMoreOptionsMenu(false);
    setShowSavedCardPicker(true);
  };

  // ORCH-0667: tap a card in the picker → send for real, then close + toast.
  const handleSelectCardToShare = async (card: any) => {
    if (pickerSubmittingCardId) return;  // double-tap guard
    if (!conversationId || !currentUserId) {
      showNotification(
        t('chat:cardShareFailedTitle'),
        t('chat:cardShareFailedToast'),
        'error',
      );
      return;
    }

    setPickerSubmittingCardId(card.id);
    try {
      const { message, error } = await messagingService.sendCardMessage(
        conversationId,
        currentUserId,
        card,
      );

      if (error || !message) {
        showNotification(
          t('chat:cardShareFailedTitle'),
          t('chat:cardShareFailedToast'),
          'error',
        );
        return;
      }

      showNotification(
        t('chat:cardSentTitle'),
        t('chat:cardSentToast', { name: friend.name }),
      );
      setShowSavedCardPicker(false);
    } finally {
      setPickerSubmittingCardId(null);
    }
  };

  /**
   * ORCH-0685 §9.4: Real Save handler for chat-mounted ExpandedCardModal.
   * Replaces the no-op at the chat-mounted modal mount (CF-2 dead-tap fix).
   *
   * Behavior:
   *   - Loading: button disabled while saving (via isSavingSharedCard guard).
   *   - Success: sharedCardIsSaved → true (passed as isSaved prop on modal,
   *     button transitions to "Saved" state). Success toast.
   *   - Already-saved: savedCardsService.saveCard handles 23505 silently
   *     (idempotent upsert). Treated as success — UI transitions to "Saved".
   *   - Error: toast surfaces. sharedCardIsSaved stays false.
   *   - Constitution #1: every tap produces real feedback.
   *   - Constitution #3: errors surface, never swallowed.
   */
  const handleSaveSharedCard = async (cardData: ExpandedCardData): Promise<void> => {
    if (isSavingSharedCard || sharedCardIsSaved) {
      return;
    }

    if (!currentUserId) {
      showNotification(
        t('chat:cardSaveFailedTitle'),
        t('chat:cardSaveFailedToast'),
        'error',
      );
      return;
    }

    setIsSavingSharedCard(true);
    try {
      await savedCardsService.saveCard(currentUserId, cardData, 'solo');
      setSharedCardIsSaved(true);
      showNotification(
        t('chat:cardSavedTitle'),
        t('chat:cardSavedToast'),
      );
    } catch (error) {
      console.error('[handleSaveSharedCard] saveCard failed', error);
      showNotification(
        t('chat:cardSaveFailedTitle'),
        t('chat:cardSaveFailedToast'),
        'error',
      );
    } finally {
      setIsSavingSharedCard(false);
    }
  };

  const handleRemoveFriend = () => {
    onRemoveFriend?.(friend, true);
    setShowMoreOptionsMenu(false);
    showNotification(
      t('chat:friendRemoved'),
      t('chat:friendRemovedMessage', { name: friend.name })
    );
  };

  const handleBlockUser = () => {
    onBlockUser?.(friend, true);
    setShowMoreOptionsMenu(false);
    showNotification(t('chat:userBlocked'), t('chat:userBlockedMessage', { name: friend.name }));
  };

  const handleReportUser = () => {
    onReportUser?.(friend, true);
    setShowMoreOptionsMenu(false);
    showNotification(
      t('chat:userReported'),
      t('chat:userReportedMessage', { name: friend.name })
    );
  };

  const handleExitGroupSession = useCallback(() => {
    if (!friend.sessionId || !currentUserId) return;

    Alert.alert(
      t("social:leaveSessionConfirmTitle"),
      t("social:leaveSessionConfirmBody"),
      [
        { text: t("common:cancel"), style: "cancel" },
        {
          text: t("social:leaveSessionMenuItem"),
          style: "destructive",
          onPress: async () => {
            try {
              const { error } = await supabase
                .from("session_participants")
                .delete()
                .eq("session_id", friend.sessionId)
                .eq("user_id", currentUserId);
              if (error) throw error;
              onGroupSessionExited?.(friend.sessionId!);
            } catch (error: any) {
              console.error("[MessageInterface] Failed to leave group session:", error);
              Alert.alert("Could not leave session", error?.message || "Please try again.");
            }
          },
        },
      ],
    );
  }, [currentUserId, friend.sessionId, onGroupSessionExited, t]);

  // ORCH-0620 composer position:
  //   - inputBottomOffset: nav clearance so the composer floats above the bottom
  //     nav when the keyboard is closed. On Android, + ANDROID_NAV_OVERLAP_FIX
  //     because the nav uses bottom: insets.bottom + 6 (not 0).
  //   - iOS keyboard lift: iOS never resizes/pans the window — always lift manually.
  //     Safe because iOS fires keyboardWillShow BEFORE animation.
  //   - Android adaptive lift: Expo maps softwareKeyboardLayoutMode="resize" to
  //     adjustResize in the manifest. On Pixel/stock Android, this shrinks the
  //     window and the absolute composer naturally lands above the keyboard — no
  //     manual lift needed. BUT on Samsung / edge-to-edge / new architecture, the
  //     OS often ignores resize and leaves the window full-size (a known OEM
  //     quirk). We detect this at runtime by comparing the current window height
  //     to its observed maximum. If the window did NOT shrink by approximately
  //     keyboardHeight, we apply a manual lift to compensate. This is adaptive:
  //     on devices where resize works, no lift. On devices where it's ignored,
  //     full manual lift. No race condition because the layout update happens
  //     in response to the same keyboardDidShow event that reveals the ignore.
  const { height: currentWindowHeight } = useWindowDimensions();
  const maxWindowHeightRef = useRef<number>(currentWindowHeight);
  if (currentWindowHeight > maxWindowHeightRef.current) {
    maxWindowHeightRef.current = currentWindowHeight;
  }
  const windowShrinkAmount = Math.max(0, maxWindowHeightRef.current - currentWindowHeight);
  // On Android with edgeToEdge, the Keyboard event's `keyboardHeight` measures
  // from the keyboard top down to the TOP of the gesture/nav bar — NOT to the
  // physical screen bottom. The gesture bar (safeInsets.bottom) still sits
  // between keyboard and screen bottom visually. To position the composer above
  // the actual visible keyboard, we need to account for it.
  const androidManualLift =
    Platform.OS === 'android' && keyboardVisible
      ? Math.max(0, keyboardHeight + safeInsets.bottom - windowShrinkAmount)
      : 0;
  const iosKeyboardLift = Platform.OS === 'ios' && keyboardVisible ? keyboardHeight : 0;

  // When the keyboard is open, the floating bottom nav is hidden behind the
  // keyboard — the composer only needs a small breathing gap above the keyboard
  // top, not the full nav clearance. When closed, use full nav clearance so the
  // composer floats above the nav capsule.
  const inputBottomOffset = keyboardVisible
    ? INPUT_CAPSULE_MARGIN_BOTTOM
    : bottomNavTotalHeight + INPUT_CAPSULE_MARGIN_BOTTOM + ANDROID_NAV_OVERLAP_FIX;
  const finalInputBottom = inputBottomOffset + iosKeyboardLift + androidManualLift;
  const isBroadcastOnlyConsumerChannel = isTripEventGroupChat && friend.isBroadcastOnly === true;
  const broadcastComposerNoticeBottom = bottomNavTotalHeight + BROADCAST_COMPOSER_NOTICE_BOTTOM_GAP;
  const broadcastComposerContentClearance =
    broadcastComposerNoticeBottom +
    BROADCAST_COMPOSER_NOTICE_HEIGHT +
    BROADCAST_COMPOSER_NOTICE_CONTENT_GAP;
  const showComposer =
    !isBlocked &&
    !isUnfriended &&
    !isDeletedAccount &&
    !isBroadcastOnlyConsumerChannel;
  const messageListBottomClearance = showComposer
    ? finalInputBottom + INPUT_CAPSULE_HEIGHT + 8
    : isBroadcastOnlyConsumerChannel
      ? broadcastComposerContentClearance
      : bottomNavTotalHeight + 24;
  const channelLabel = friend.linkedEntityType === "trip" ? "Trip broadcast channel" : "Event broadcast channel";
  const channelDetail = isBroadcastOnlyConsumerChannel
    ? `Only ${friend.eventBrandName?.trim() || "the organiser"} can post updates here`
    : `Updates from ${friend.eventBrandName?.trim() || "the organiser"} and attendees`;
  const channelLine = isBroadcastOnlyConsumerChannel
    ? `${friend.linkedEntityType === "trip" ? "Trip" : "Event"} broadcast · ${friend.eventBrandName?.trim() || "Organiser"} only`
    : `${friend.linkedEntityType === "trip" ? "Trip" : "Event"} channel · ${friend.eventBrandName?.trim() || "Organiser"} + attendees`;

  const handleHeaderMorePress = () => {
    if (isTripEventGroupChat) {
      setShowMoreOptionsMenu(false);
      setShowEventAudienceSheet(true);
      return;
    }

    setShowMoreOptionsMenu(!showMoreOptionsMenu);
  };

  const handleOpenCollabDeckView = (view: CollabChatHeaderActionId) => {
    HapticFeedback.medium();
    if (view === "matches") {
      setShowCollabMatchesSheet(true);
      return;
    }
    if (view === "plans") {
      setShowCollabPlansSheet(true);
      return;
    }
    setShowCollabDeckSheet(true);
  };

  const handleOpenAudienceProfile = (participantId: string) => {
    setShowEventAudienceSheet(false);
    onViewProfile?.(participantId);
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: safeInsets.top + 8 }]}>
        {/* Top Row: Back button, Avatar, Name and Status */}
        <View
          style={[
            styles.headerTopRow,
            isCollabSessionGroupChat ? styles.collabHeaderTopRow : null,
          ]}
        >
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Icon name="arrow-back" size={24} color="rgba(255, 255, 255, 0.72)" />
          </TouchableOpacity>

          {isCollabSessionGroupChat ? (
            <TouchableOpacity
              style={styles.collabHeaderPill}
              onPress={handleHeaderMorePress}
              activeOpacity={0.76}
              accessibilityRole="button"
              accessibilityLabel={`Open ${headerTitle} options`}
            >
              <View style={[styles.groupHeaderAvatarStack, styles.collabHeaderAvatarStack]}>
                {visibleHeaderParticipants.length === 0 ? (
                  <View style={[styles.groupHeaderAvatarPlaceholder, styles.collabHeaderAvatarPlaceholder]}>
                    <Text style={styles.avatarText}>{getHeaderInitials(headerTitle)}</Text>
                  </View>
                ) : (
                  visibleHeaderParticipants.map((participant, index) => {
                    const participantName = getHeaderParticipantName(participant);
                    return (
                      <View
                        key={participant.id}
                        style={[
                          styles.groupHeaderAvatarSegment,
                          styles.collabHeaderAvatarSegment,
                          index === 0 ? styles.collabHeaderLeadAvatar : null,
                          {
                            left: index * 14,
                            zIndex: visibleHeaderParticipants.length - index,
                          },
                        ]}
                      >
                        {participant.avatar_url ? (
                          <ImageWithFallback
                            source={{ uri: participant.avatar_url }}
                            style={styles.collabHeaderAvatarImage}
                          />
                        ) : (
                          <Text style={styles.collabAvatarText}>
                            {getHeaderInitials(participantName)}
                          </Text>
                        )}
                      </View>
                    );
                  })
                )}
              </View>
              <View style={styles.collabHeaderCopy}>
                <Text style={[styles.userName, styles.collabUserName]} numberOfLines={1}>
                  {headerTitle}
                </Text>
                <Text style={styles.groupParticipantCount} numberOfLines={1}>
                  {headerParticipantCount} {headerParticipantCount === 1 ? "member" : "members"} · Collab session
                </Text>
              </View>
              <Icon name="chevron-down" size={16} color="rgba(255, 255, 255, 0.58)" />
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                style={styles.avatarContainer}
                onPress={() => {
                  if (!isGroupChat) onViewProfile?.(friend.id);
                }}
                disabled={isGroupChat || !onViewProfile}
                activeOpacity={0.8}
                accessibilityLabel={isGroupChat ? `${headerTitle} participants` : `View ${headerTitle}'s profile`}
                accessibilityRole="button"
              >
                {isGroupChat && friend.eventCoverMediaUrl ? (
                  <ImageWithFallback
                    source={{ uri: friend.eventCoverMediaUrl }}
                    style={[styles.avatar, styles.groupCoverAvatar]}
                  />
                ) : isGroupChat ? (
                  <View style={styles.groupHeaderAvatarStack}>
                    {visibleHeaderParticipants.length === 0 ? (
                      <View style={styles.groupHeaderAvatarPlaceholder}>
                        <Text style={styles.avatarText}>{getHeaderInitials(headerTitle)}</Text>
                      </View>
                    ) : (
                      visibleHeaderParticipants.map((participant, index) => {
                        const participantName = getHeaderParticipantName(participant);
                        return (
                          <View
                            key={participant.id}
                            style={[
                              styles.groupHeaderAvatarSegment,
                              {
                                left: index * 12,
                                zIndex: visibleHeaderParticipants.length - index,
                              },
                            ]}
                          >
                            {participant.avatar_url ? (
                              <ImageWithFallback
                                source={{ uri: participant.avatar_url }}
                                style={styles.groupHeaderAvatarImage}
                              />
                            ) : (
                              <Text style={styles.avatarText}>
                                {getHeaderInitials(participantName)}
                              </Text>
                            )}
                          </View>
                        );
                      })
                    )}
                  </View>
                ) : friend.avatar ? (
                  <ImageWithFallback source={{ uri: friend.avatar }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Text style={styles.avatarText}>
                      {getHeaderInitials(headerTitle)}
                    </Text>
                  </View>
                )}
                {!isGroupChat && isOtherOnline && <View style={styles.onlineIndicator} />}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.userInfo}
                onPress={() => {
                  if (!isGroupChat) onViewProfile?.(friend.id);
                }}
                disabled={isGroupChat || !onViewProfile}
                activeOpacity={0.7}
              >
                <Text style={styles.userName} numberOfLines={1}>{headerTitle}</Text>
                {isGroupChat ? (
                  <Text style={styles.groupParticipantCount} numberOfLines={1}>
                    {isTripEventGroupChat
                      ? eventAudienceSubtitle
                      : `${headerParticipantCount} ${headerParticipantCount === 1 ? "person" : "people"} in chat`}
                  </Text>
                ) : (
                  <ChatStatusLine
                    isOnline={isOtherOnline}
                    isTyping={isOtherTyping}
                    lastSeenAt={otherLastSeen}
                  />
                )}
              </TouchableOpacity>
            </>
          )}

          {/* More button — far right */}
          {!isCollabSessionGroupChat ? (
            <TouchableOpacity
              onPress={handleHeaderMorePress}
              style={styles.headerMoreBtn}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={
                isTripEventGroupChat
                  ? `View ${eventAudienceTitle.toLowerCase()}`
                  : "Open chat options"
              }
            >
              <Icon name="ellipsis-vertical" size={20} color="rgba(255, 255, 255, 0.72)" />
            </TouchableOpacity>
          ) : null}
        </View>

        {isCollabSessionGroupChat ? (
          <View style={styles.collabHeaderActionRow}>
            {collabHeaderActions.map((action) => (
              <TouchableOpacity
                key={action.id}
                onPress={() => handleOpenCollabDeckView(action.id)}
                activeOpacity={0.76}
                accessibilityRole="button"
                accessibilityLabel={`${action.label} ${headerTitle}`}
                style={styles.collabHeaderActionButton}
              >
                <Icon name={action.icon as any} size={19} color="#f97316" />
                <Text style={styles.collabHeaderActionText} numberOfLines={1}>
                  {action.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {/* Bottom Row: Action Icons */}
        {/* Commented out header icons temporarily */}
        {/* <View style={styles.headerActions}>
          <TouchableOpacity style={styles.actionButton}>
            <Icon name="call" size={16} color="rgba(255, 255, 255, 0.72)" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton}>
            <Icon name="videocam" size={16} color="rgba(255, 255, 255, 0.72)" />
          </TouchableOpacity>
          <View style={styles.moreOptionsContainer}>
            <TouchableOpacity
              onPress={() => setShowMoreOptionsMenu(!showMoreOptionsMenu)}
              style={styles.actionButton}
            >
              <Icon name="ellipsis-horizontal" size={16} color="rgba(255, 255, 255, 0.72)" />
            </TouchableOpacity>

            {showMoreOptionsMenu && (
              <View style={styles.moreOptionsMenu}>
                <TouchableOpacity
                  onPress={handleAddToBoard}
                  style={styles.menuItem}
                >
                  <Icon name="people" size={16} color="rgba(255, 255, 255, 0.72)" />
                  <Text style={styles.menuItemText}>Add to Board</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleShareSavedCard}
                  style={styles.menuItem}
                >
                  <Icon name="bookmark" size={16} color="rgba(255, 255, 255, 0.72)" />
                  <Text style={styles.menuItemText}>Share Saved Card</Text>
                </TouchableOpacity>
                <View style={styles.menuDivider} />
                <TouchableOpacity
                  onPress={handleRemoveFriend}
                  style={styles.menuItemDanger}
                >
                  <Icon name="person-remove" size={16} color="#dc2626" />
                  <Text style={styles.menuItemTextDanger}>Remove Friend</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleBlockUser}
                  style={styles.menuItemDanger}
                >
                  <Icon name="shield" size={16} color="#dc2626" />
                  <Text style={styles.menuItemTextDanger}>Block User</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleReportUser}
                  style={styles.menuItemDanger}
                >
                  <Icon name="flag" size={16} color="#dc2626" />
                  <Text style={styles.menuItemTextDanger}>Report User</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View> */}
      </View>

      {isTripEventGroupChat ? (
        <View style={styles.eventChannelHeaderStack}>
          {friend.eventId ? (
            <TripCountdownBanner
              eventId={friend.eventId}
              onPress={friend.eventPublicCard ? () => setShowGroupEventSheet(true) : undefined}
              stackedWithChannel
            />
          ) : null}
          {friend.eventId ? <View style={styles.eventChannelHeaderDivider} /> : null}
          <View
            style={[
              styles.broadcastChannelBanner,
              isBroadcastOnlyConsumerChannel && styles.broadcastOnlyChannelBanner,
            ]}
            accessibilityRole="text"
            accessibilityLabel={`${channelLabel}. ${channelDetail}`}
          >
            <View style={styles.broadcastChannelIconShell}>
              <Icon
                name={isBroadcastOnlyConsumerChannel ? "megaphone" : "chatbubbles"}
                size={17}
                color="#ffffff"
              />
            </View>
            <Text style={styles.broadcastChannelLine} numberOfLines={1}>
              {channelLine}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Messages */}
      {messages.length === 0 ? (
        <View style={[styles.messagesContainer, { justifyContent: "center" }]}>
          <View style={styles.emptyState}>
            <View style={styles.emptyStateIcon}>
              <Icon
                name={isTripEventGroupChat ? (isBroadcastOnlyConsumerChannel ? "megaphone" : "chatbubbles") : "chatbubble"}
                size={32}
                color="#eb7825"
              />
            </View>
            <Text style={styles.emptyStateTitle}>
              {isTripEventGroupChat ? channelLabel : t('chat:startConversation')}
            </Text>
            <Text style={styles.emptyStateText}>
              {isTripEventGroupChat ? channelDetail : t('chat:sendMessageTo', { name: cleanName(friend.name) })}
            </Text>
          </View>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={groupedMessages}
          renderItem={({ item, index }) => {
            // Day separator — inverted list: show AFTER the message when the
            // next item (older) is on a different day, or this is the last item.
            // Visually this places the date header ABOVE that day's messages.
            const currDate = new Date(item.message.timestamp).toDateString();
            const isLastItem = index === groupedMessages.length - 1;
            const nextMsg = !isLastItem ? groupedMessages[index + 1] : null;
            const nextDate = nextMsg ? new Date(nextMsg.message.timestamp).toDateString() : null;
            const showDaySeparator = isLastItem || currDate !== nextDate;

            const today = new Date().toDateString();
            const yesterday = new Date(Date.now() - 86400000).toDateString();
            const dateLabel = currDate === today ? 'Today'
              : currDate === yesterday ? 'Yesterday'
              : new Date(item.message.timestamp).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

            const daySeparator = showDaySeparator ? (
              <View style={styles.daySeparator}>
                <View style={styles.daySeparatorLine} />
                <Text style={styles.daySeparatorText}>{dateLabel}</Text>
                <View style={styles.daySeparatorLine} />
              </View>
            ) : null;

            if (item.message.isSystem) {
              return (
                <>
                  <MessageBubble
                    message={{
                      id: item.message.id,
                      senderName: getMessageSenderName(item.message),
                      content: item.message.content,
                      timestamp: item.message.timestamp,
                      type: item.message.type,
                      fileUrl: item.message.fileUrl,
                      fileName: item.message.fileName,
                      fileSize: item.message.fileSize,
                      cardPayload: item.message.cardPayload,
                      mentions: item.message.mentions,
                      cardTags: item.message.cardTags,
                      marketingCampaignId: item.message.marketingCampaignId,
                      isMe: item.message.isMe,
                      failed: item.message.failed,
                      isSystem: item.message.isSystem,
                    }}
                    onSystemTokenPress={handleSystemTokenPress}
                    isMe={item.message.isMe}
                    groupPosition={item.groupPosition}
                    showTimestamp={false}
                    isRead={false}
                  />
                  {daySeparator}
                </>
              );
            }

            return (
            <>
            <SwipeableMessage
              onReply={() => {
                setReplyingTo({
                  messageId: item.message.id,
                  senderName: getMessageSenderName(item.message),
                  content: item.message.content,
                  isMe: item.message.isMe,
                });
              }}
            >
              <DoubleTapHeart
                onDoubleTap={() => {
                  if (currentUserId) {
                    messagingService.toggleDirectMessageReaction(item.message.id, currentUserId, '❤️');
                  }
                }}
              >
              <TouchableOpacity
                activeOpacity={1}
                onPress={() => {
                  setRevealedTimestampId(prev => prev === item.message.id ? null : item.message.id);
                }}
                onLongPress={(e) => {
                  setContextMenu({
                    visible: true,
                    messageId: item.message.id,
                    content: item.message.content,
                    isMe: item.message.isMe,
                    top: e.nativeEvent.pageY,
                  });
                }}
                delayLongPress={500}
              >
                <MessageBubble
                  message={{
                    id: item.message.id,
                    senderName: getMessageSenderName(item.message),
                    content: item.message.content,
                    timestamp: item.message.timestamp,
                    type: item.message.type,
                    fileUrl: item.message.fileUrl,
                    fileName: item.message.fileName,
                    fileSize: item.message.fileSize,
                    cardPayload: item.message.cardPayload,  // ORCH-0667
                    mentions: item.message.mentions,
                    cardTags: item.message.cardTags,
                    marketingCampaignId: item.message.marketingCampaignId,
                    isMe: item.message.isMe,
                    failed: item.message.failed,
                    isSystem: item.message.isSystem,
                  }}
                  onCardBubbleTap={(payload) => {
                    // ORCH-0685: typed conversion replaces unsafe `any` cast (Constitution #12 fix).
                    setExpandedCardFromChat(cardPayloadToExpandedCardData(payload));
                    setShowExpandedCardFromChat(true);
                    // ORCH-0685 cycle-3: sharedCardIsSaved now derived via useEffect against
                    // savedCardsQuery.data — no manual reset needed.
                  }}
                  onMentionTap={onViewProfile}
                  onCardTagTap={(cardTag) => {
                    setExpandedCardFromChat(cardPayloadToExpandedCardData(cardTag.cardPayload));
                    setShowExpandedCardFromChat(true);
                  }}
                  onSystemTokenPress={handleSystemTokenPress}
                  isMe={item.message.isMe}
                  groupPosition={item.groupPosition}
                  showTimestamp={revealedTimestampId === item.message.id}
                  isRead={item.message.isMe && !item.message.id.startsWith("temp-") && (item.message.isRead === true)}
                  replyTo={item.message.replyToId ? (() => {
                    const ref = messageMap.get(item.message.replyToId!);
                    if (!ref) return { senderName: '', content: '', isDeleted: true, messageId: item.message.replyToId };
                    return {
                      senderName: getMessageSenderName(ref),
                      content: ref.content,
                      imageUrl: ref.type === 'image' ? ref.fileUrl : undefined,
                      messageId: ref.id,
                    };
                  })() : undefined}
                />
              </TouchableOpacity>
              </DoubleTapHeart>
            </SwipeableMessage>
            {daySeparator}
            </>
            );
          }}
          keyExtractor={(item) => item.message.id}
          inverted={true}
          style={styles.messagesContainer}
          contentContainerStyle={[
            styles.messagesContentContainer,
            {
              // ORCH-0620: inverted FlatList — paddingTop (pre-transform) becomes
              // the VISUAL BOTTOM clearance after the scaleY:-1 flip. Clears the
              // composer capsule (which sits at `finalInputBottom` above the
              // window's bottom edge) + INPUT_CAPSULE_HEIGHT + 8pt breathing.
              paddingTop: messageListBottomClearance,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Message Context Menu */}
      <MessageContextMenu
        visible={contextMenu.visible}
        position={{ top: contextMenu.top }}
        messageId={contextMenu.messageId}
        messageContent={contextMenu.content}
        isOwnMessage={contextMenu.isMe}
        onReaction={(_msgId, _emoji) => {
          // [TRANSITIONAL] Wave 1: no-op — DM reactions added in Wave 2
          console.log('[Wave1] DM reaction requested:', _msgId, _emoji);
        }}
        onReply={(msgId) => {
          // Find the message in the current messages list
          const msg = messages.find((m) => m.id === msgId);
          if (msg) {
            setReplyingTo({
              messageId: msg.id,
              senderName: getMessageSenderName(msg),
              content: msg.content,
              isMe: msg.isMe,
            });
          }
        }}
        onCopy={() => {
          // Copy handled internally by MessageContextMenu
        }}
        onClose={() => setContextMenu({ visible: false, messageId: '', content: '', isMe: false, top: 0 })}
      />

      {/* Processing File Loader */}
      <Modal visible={isProcessingFile} transparent={true} animationType="fade">
        <View style={styles.processingOverlay}>
          <View style={styles.processingContainer}>
            <ActivityIndicator size="large" color="#eb7825" />
            <Text style={styles.processingText}>{t('chat:processingFile')}</Text>
          </View>
        </View>
      </Modal>

      {/* File Preview */}
      {selectedFile && (
        <View style={styles.filePreview}>
          <View style={styles.filePreviewContent}>
            {isLoadingPreview ? (
              <View style={styles.filePreviewLoader}>
                <ActivityIndicator size="small" color="#eb7825" />
              </View>
            ) : previewUrl &&
              (selectedFile.type === "image" ||
                selectedFile.type?.startsWith("image/")) ? (
              <TouchableOpacity
                onPress={() => setShowImagePreview(true)}
                activeOpacity={0.8}
              >
                <ImageWithFallback
                  source={{ uri: previewUrl }}
                  style={styles.filePreviewImage}
                />
              </TouchableOpacity>
            ) : previewUrl && selectedFile.type?.startsWith("video/") ? (
              <View style={styles.filePreviewVideo}>
                <Icon name="play-circle" size={24} color="#eb7825" />
              </View>
            ) : (
              <View style={styles.filePreviewIcon}>
                <Icon name="document-text" size={24} color="#eb7825" />
              </View>
            )}

            <View style={styles.filePreviewInfo}>
              <Text style={styles.filePreviewName}>{selectedFile.name}</Text>
              <Text style={styles.filePreviewSize}>
                {formatFileSize(selectedFile.size)}
              </Text>
            </View>

            <TouchableOpacity
              onPress={handleRemoveFile}
              style={styles.removeFileButton}
            >
              <Icon name="close" size={12} color="rgba(255, 255, 255, 0.72)" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Full Screen Image Preview Modal */}
      <Modal
        visible={showImagePreview}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowImagePreview(false)}
      >
        <View style={styles.imagePreviewModal}>
          <TouchableOpacity
            style={styles.imagePreviewCloseButton}
            onPress={() => setShowImagePreview(false)}
          >
            <Icon name="close" size={28} color="white" />
          </TouchableOpacity>
          {previewUrl && (
            <ImageWithFallback
              source={{ uri: previewUrl }}
              style={styles.imagePreviewFullscreen}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>

      {/* Offline Banner */}
      {isOffline && !isBlocked && (
        <View style={styles.offlineBanner}>
          <Icon name="cloud-offline-outline" size={16} color="#92400e" />
          <Text style={styles.offlineBannerText}>
            {t('chat:offlineShowingSaved')}
          </Text>
        </View>
      )}

      {/* Blocked User Banner */}
      {isBlocked && (
        <View style={styles.blockedBanner}>
          <Icon name="ban" size={18} color="#dc2626" />
          <Text style={styles.blockedBannerText}>
            {t('chat:messagingNotAvailable')}
          </Text>
        </View>
      )}

      {/* Unfriended Banner */}
      {isUnfriended && !isBlocked && (
        <View style={styles.blockedBanner}>
          <Icon name="person-remove" size={18} color="#dc2626" />
          <Text style={styles.blockedBannerText}>
            {t('chat:noLongerConnected')}
          </Text>
        </View>
      )}

      {/* Deleted Account Banner */}
      {isDeletedAccount && !isBlocked && !isUnfriended && (
        <View style={styles.blockedBanner}>
          <Icon name="alert-circle" size={18} color="rgba(255, 255, 255, 0.72)" />
          <Text style={styles.blockedBannerText}>
            {t('chat:accountDeleted')}
          </Text>
        </View>
      )}

      {isBroadcastOnlyConsumerChannel && !isBlocked && !isUnfriended && !isDeletedAccount && (
        <View style={[styles.broadcastComposerNotice, { bottom: broadcastComposerNoticeBottom }]}>
          <Icon name="lock-closed" size={16} color="rgba(255, 255, 255, 0.82)" />
          <Text style={styles.broadcastComposerNoticeText}>
            {`Broadcast-only: ${friend.eventBrandName?.trim() || "the organiser"} is posting updates here.`}
          </Text>
        </View>
      )}

      {/* Input Area - Floating glass capsule. ORCH-0610 forensic fix: bottom
          is a STATIC value keyed off keyboardVisible (not an Animated.add).
          When keyboard opens, the capsule is positioned at keyboardHeight + 8
          from screen bottom — above the keyboard. OS `adjustPan` sees the
          focused input is already visible above the keyboard and does NOT pan
          the window, so the header stays at its original position. */}
      {showComposer && (
      <View
        style={[
          styles.inputCapsuleWrap,
          { bottom: finalInputBottom },
        ]}
      >
        {/* Reply Preview Bar */}
        {replyingTo && (
          <View style={styles.replyPreviewWrap}>
            <ReplyPreviewBar
              senderName={replyingTo.senderName}
              previewText={replyingTo.content}
              isOwnMessage={replyingTo.isMe}
              onClose={() => setReplyingTo(null)}
            />
          </View>
        )}
        <MentionPopover
          visible={chatController.activePopover?.type === "mention"}
          participants={mentionPopoverParticipants}
          onSelectParticipant={(participant) => {
            chatController.onSelectMention({
              userId: participant.user_id,
              displayName: participant.profiles?.display_name || participant.profiles?.username || "Unknown",
              username: participant.profiles?.username ?? null,
              avatarUrl: participant.profiles?.avatar_url ?? null,
            });
          }}
          onClose={chatController.closePopover}
          keyboardHeight={0}
        />
        <CardTagPopover
          visible={chatController.activePopover?.type === "card"}
          cards={cardTagPopoverCards}
          onSelectCard={(card) => {
            const candidate = chatController.filteredCards.find((item) => item.savedCardId === card.id);
            if (candidate) chatController.onSelectCardTag(candidate);
          }}
          onClose={chatController.closePopover}
          keyboardHeight={0}
        />
        <View style={styles.inputCapsule}>
          {/* META-ORCH-1002 Sub-1 (S3): on Android render a solid frosted fill instead of
              the see-through BlurView + 0.48 tint floor. iOS path is byte-identical. */}
          {ANDROID_GLASS_USES_OPAQUE_FALLBACK ? (
            <View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { backgroundColor: glass.chrome.fallback.solid }]}
            />
          ) : (
            <>
              <BlurView
                intensity={glass.chrome.blur.intensity}
                tint="dark"
                experimentalBlurMethod={Platform.OS === "android" ? "dimezisBlurView" : undefined}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
              <View
                pointerEvents="none"
                style={[StyleSheet.absoluteFill, { backgroundColor: glass.chrome.tint.floor }]}
              />
            </>
          )}
          <View style={styles.inputContainer}>
          {/* Attachment Menu */}
          <View style={styles.attachmentContainer}>
            <TouchableOpacity
              onPress={() => setShowAttachmentMenu(!showAttachmentMenu)}
              style={styles.attachmentButton}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Icon name="attach" size={20} color="rgba(255, 255, 255, 0.85)" />
            </TouchableOpacity>

            {showAttachmentMenu && (
              <View style={styles.attachmentMenu}>
                <TouchableOpacity
                  onPress={() => handleFileSelect("image")}
                  style={styles.attachmentMenuItem}
                >
                  <View style={styles.attachmentMenuIcon}>
                    <Icon name="image" size={16} color="#3b82f6" />
                  </View>
                  <View>
                    <Text style={styles.attachmentMenuTitle}>{t('chat:photo')}</Text>
                    <Text style={styles.attachmentMenuSubtitle}>
                      {t('chat:shareImage')}
                    </Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => handleFileSelect("video")}
                  style={styles.attachmentMenuItem}
                >
                  <View style={styles.attachmentMenuIcon}>
                    <Icon name="videocam" size={16} color="#8b5cf6" />
                  </View>
                  <View>
                    <Text style={styles.attachmentMenuTitle}>{t('chat:video')}</Text>
                    <Text style={styles.attachmentMenuSubtitle}>
                      {t('chat:shareVideo')}
                    </Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => handleFileSelect("file")}
                  style={styles.attachmentMenuItem}
                >
                  <View style={styles.attachmentMenuIcon}>
                    <Icon name="document-text" size={16} color="#10b981" />
                  </View>
                  <View>
                    <Text style={styles.attachmentMenuTitle}>{t('chat:documentAttach')}</Text>
                    <Text style={styles.attachmentMenuSubtitle}>
                      {t('chat:shareFile')}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Separator — cutout between attach and text field */}
          <View style={styles.capsuleSeparator} />

          {/* Message Input */}
          <TouchableOpacity
            style={styles.messageInputContainer}
            activeOpacity={1}
            onPress={() => inputRef.current?.focus()}
          >
            <TextInput
              ref={inputRef}
              value={newMessage}
              onChangeText={(text) => {
                chatController.onChangeText(text);
                if (text.length > 0) {
                  startTyping();
                } else {
                  stopTyping();
                }
              }}
              onKeyPress={chatController.onKeyPress}
              onSelectionChange={chatController.onSelectionChange}
              onBlur={stopTyping}
              placeholder={
                selectedFile ? t('chat:addCaption') : t('chat:typeMessage')
              }
              placeholderTextColor="rgba(255, 255, 255, 0.4)"
              style={[
                styles.messageInput,
                // ORCH-0908: hide the raw TextInput text whenever chips exist
                // so the absolute-positioned ChatInputChipsLayer overlay is the
                // only visible content. Caret + selection still work normally.
                chatController.chipRanges.length > 0 && { color: 'transparent' },
              ]}
              multiline={true}
              maxLength={1000}
            />
            {chatController.chipRanges.length > 0 && (
              <ChatInputChipsLayer text={newMessage} chipRanges={chatController.chipRanges} />
            )}
          </TouchableOpacity>

          {/* Separator — cutout between text field and send */}
          <View style={styles.capsuleSeparator} />

          {/* Send Button */}
          <TouchableOpacity
            onPress={handleSendMessage}
            disabled={!newMessage.trim() && !selectedFile}
            style={[
              styles.sendButton,
              !newMessage.trim() && !selectedFile && styles.sendButtonDisabled,
            ]}
          >
            <Icon name="paper-plane" size={20} color="white" />
          </TouchableOpacity>
        </View>
        </View>
      </View>
      )}

      {/* Hidden File Input - Not supported in React Native */}
      {/* File selection will be handled through TouchableOpacity and native file picker */}

      {/* ORCH-0666 cycle 2: BoardSelection sub-UI deleted. ConnectionsPage owns
          the real AddToBoardModal mount; MessageInterface delegates via the
          required onOpenAddToBoardModal prop. */}

      {/* ORCH-0667: shared-card picker modal */}
      {showSavedCardPicker && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('chat:pickerTitle')}</Text>
              <TouchableOpacity
                onPress={() => setShowSavedCardPicker(false)}
                style={styles.modalCloseButton}
              >
                <Icon name="close" size={12} color="rgba(255, 255, 255, 0.72)" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              {t('chat:pickerSubtitle', { name: friend.name })}
            </Text>

            {savedCardsQuery.isLoading ? (
              <View style={styles.boardList}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={styles.savedCardSkeletonRow}>
                    <View style={styles.savedCardSkeletonThumb} />
                    <View style={styles.savedCardSkeletonText}>
                      <View style={[styles.savedCardSkeletonBar, { width: '60%' }]} />
                      <View style={[styles.savedCardSkeletonBar, { width: '40%', marginTop: 6 }]} />
                    </View>
                  </View>
                ))}
              </View>
            ) : (savedCardsQuery.data?.length ?? 0) === 0 ? (
              <View style={styles.savedCardEmptyContainer}>
                <Text style={styles.savedCardEmptyTitle}>
                  {t('chat:noSavedCardsToShareTitle')}
                </Text>
                <Text style={styles.savedCardEmptyBody}>
                  {t('chat:noSavedCardsToShareBody')}
                </Text>
                <TouchableOpacity
                  onPress={() => setShowSavedCardPicker(false)}
                  style={styles.confirmButton}
                >
                  <Text style={styles.confirmButtonText}>{t('chat:ok')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView style={styles.boardList}>
                {savedCardsQuery.data?.map((card) => {
                  const isSubmitting = pickerSubmittingCardId === card.id;
                  const isOtherSubmitting =
                    !!pickerSubmittingCardId && pickerSubmittingCardId !== card.id;
                  return (
                    <TouchableOpacity
                      key={card.id}
                      onPress={() => handleSelectCardToShare(card)}
                      disabled={isSubmitting || isOtherSubmitting}
                      style={[
                        styles.savedCardRow,
                        isSubmitting && { opacity: 0.5 },
                      ]}
                    >
                      {card.image ? (
                        <Image
                          source={{ uri: card.image }}
                          style={styles.savedCardThumb}
                        />
                      ) : (
                        <View style={[styles.savedCardThumb, styles.savedCardThumbPlaceholder]}>
                          <Icon name="bookmark" size={20} color="rgba(255,255,255,0.5)" />
                        </View>
                      )}
                      <View style={styles.savedCardInfo}>
                        <Text style={styles.savedCardTitle} numberOfLines={1}>
                          {card.title}
                        </Text>
                        <Text style={styles.savedCardSubtitle} numberOfLines={1}>
                          {isSubmitting ? t('chat:cardSending') : (card.category || '')}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      )}

      {/* ORCH-0667 + ORCH-0685: tap-to-expand shared card from chat with real Save wiring */}
      {showExpandedCardFromChat && expandedCardFromChat && (
        <ExpandedCardModal
          visible={showExpandedCardFromChat}
          // ORCH-0828: discriminated-union target. Chat-mounted modal
          // only ever surfaces Night Out cards.
          target={{ kind: "nightOut", data: expandedCardFromChat }}
          onClose={() => {
            setShowExpandedCardFromChat(false);
            setExpandedCardFromChat(null);
            // ORCH-0685 cycle-3: useEffect on expandedCardFromChat=null resets
            // sharedCardIsSaved automatically.
          }}
          onSave={handleSaveSharedCard}  // ORCH-0685: CF-2 dead-tap fix
          isSaved={sharedCardIsSaved}    // ORCH-0685: button transitions to "Saved"
          currentMode="solo"
        />
      )}

      {showGroupEventSheet && friend.eventPublicCard ? (
        <ExpandedBusinessEventSheet
          visible={showGroupEventSheet}
          data={friend.eventPublicCard}
          onClose={() => setShowGroupEventSheet(false)}
          bottomContentInset={
            isBroadcastOnlyConsumerChannel
              ? broadcastComposerContentClearance
              : bottomNavTotalHeight + 32
          }
        />
      ) : null}

      <Modal
        visible={Boolean(isTripEventGroupChat && showEventAudienceSheet)}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEventAudienceSheet(false)}
      >
        <TouchableOpacity
          style={styles.eventAudienceOverlay}
          activeOpacity={1}
          onPress={() => setShowEventAudienceSheet(false)}
        />
        <View style={[styles.eventAudienceSheet, { paddingBottom: safeInsets.bottom + 24 }]}>
          <View style={styles.chatSheetHandle} />
          <View style={styles.eventAudienceSheetHeader}>
            <View style={styles.eventAudienceIconShell}>
              <Icon
                name={friend.linkedEntityType === "trip" ? "map" : "people"}
                size={18}
                color="#ffffff"
              />
            </View>
            <View style={styles.eventAudienceHeaderCopy}>
              <Text style={styles.eventAudienceTitle}>{eventAudienceTitle}</Text>
              <Text style={styles.eventAudienceSubtitle}>
                {eventAudienceSubtitle} · {friend.linkedEntityType === "trip" ? "Trip broadcast" : "Event broadcast"}
              </Text>
            </View>
          </View>

          <ScrollView
            style={styles.eventAudienceList}
            contentContainerStyle={styles.eventAudienceListContent}
            showsVerticalScrollIndicator={false}
          >
            {headerParticipants.length > 0 ? (
              headerParticipants.map((participant) => {
                const participantName = getHeaderParticipantName(participant);
                const canOpenProfile = Boolean(onViewProfile && participant.id);
                return (
                  <TouchableOpacity
                    key={participant.id}
                    style={styles.eventAudienceRow}
                    activeOpacity={canOpenProfile ? 0.72 : 1}
                    disabled={!canOpenProfile}
                    onPress={() => handleOpenAudienceProfile(participant.id)}
                    accessibilityRole={canOpenProfile ? "button" : "text"}
                    accessibilityLabel={`View ${participantName} profile`}
                  >
                    {participant.avatar_url ? (
                      <ImageWithFallback
                        source={{ uri: participant.avatar_url }}
                        style={styles.eventAudienceAvatar}
                      />
                    ) : (
                      <View style={styles.eventAudienceAvatarFallback}>
                        <Text style={styles.eventAudienceAvatarText}>
                          {getHeaderInitials(participantName)}
                        </Text>
                      </View>
                    )}
                    <View style={styles.eventAudienceRowCopy}>
                      <Text style={styles.eventAudienceName} numberOfLines={1}>
                        {participantName}
                      </Text>
                      <Text style={styles.eventAudienceRole} numberOfLines={1}>
                        {friend.linkedEntityType === "trip" ? "Traveller" : "Attendee"}
                      </Text>
                    </View>
                    {canOpenProfile ? (
                      <Icon name="chevron-forward" size={18} color="rgba(255, 255, 255, 0.42)" />
                    ) : null}
                  </TouchableOpacity>
                );
              })
            ) : (
              <View style={styles.eventAudienceEmpty}>
                <Text style={styles.eventAudienceEmptyTitle}>No {eventAudienceTitle.toLowerCase()} yet</Text>
                <Text style={styles.eventAudienceEmptyText}>
                  People who join this {friend.linkedEntityType === "trip" ? "trip" : "event"} will appear here.
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* [ORCH-0696 F-13 lock-in] Shape 2a Modal hack deleted post-bottom-sheet
          conversion verified by operator live-fire on iOS + Android (2026-04-29).
          DO NOT re-introduce — toasts now render naturally above @gorhom/bottom-sheet
          (Animated.View, not native Modal portal). The notifications panel below
          (around line 1632) remains as the canonical single mount point. */}

      {isCollabSessionGroupChat && showCollabDeckSheet && friend.sessionId ? (
        <CollabDeckSheet
          visible={showCollabDeckSheet}
          onClose={() => setShowCollabDeckSheet(false)}
          sessionId={friend.sessionId}
          sessionName={headerTitle}
          userPreferences={userPreferences}
          accountPreferences={accountPreferences}
          savedCards={savedCards}
          onSaveCard={onCardLike}
          onShareCard={onShareCard}
          onAddToCalendar={onAddToCalendar}
          onPurchaseComplete={onPurchaseComplete}
          onOpenPreferences={onOpenPreferences}
        />
      ) : null}

      {isCollabSessionGroupChat && friend.sessionId ? (
        <PreferencesSheet
          visible={collabPrefsLink.visible}
          onClose={() => setCollabPrefsLink({ visible: false })}
          accountPreferences={accountPreferences}
          sessionId={friend.sessionId}
          sessionName={headerTitle}
          viewParticipantId={collabPrefsLink.viewParticipantId}
          initialFocusSection={collabPrefsLink.initialFocusSection}
        />
      ) : null}

      {isCollabSessionGroupChat && friend.sessionId ? (
        <>
          <SavedToSessionCardsSheet
            visible={showCollabMatchesSheet}
            onClose={() => setShowCollabMatchesSheet(false)}
            sessionId={friend.sessionId}
            currentUserId={currentUserId}
            savedCards={matchedSessionCards}
            savedCardsLoading={matchedSessionCardsLoading}
            participantCount={collabParticipantCount}
            accountPreferences={accountPreferences}
            isAdmin={isCollabSessionAdmin}
          />
          <ScheduleSheet
            visible={showCollabPlansSheet}
            onClose={() => setShowCollabPlansSheet(false)}
            sessionId={friend.sessionId}
            currentUserId={currentUserId}
          />
        </>
      ) : null}

      <BoardSettingsDropdown
        visible={Boolean(isGroupChat && showMoreOptionsMenu && friend.sessionId)}
        onClose={() => setShowMoreOptionsMenu(false)}
        sessionId={friend.sessionId ?? ""}
        sessionName={headerTitle}
        sessionCreatorId={friend.sessionCreatorId ?? undefined}
        currentUserId={currentUserId ?? undefined}
        isAdmin={friend.isSessionAdmin ?? (!!currentUserId && friend.sessionCreatorId === currentUserId)}
        notificationsMuted={friend.notificationsMuted ?? false}
        participants={groupSettingsParticipants}
        onExitBoard={handleExitGroupSession}
        onSessionDeleted={() => {
          setShowMoreOptionsMenu(false);
          if (friend.sessionId) onGroupSessionDeleted?.(friend.sessionId);
        }}
        onSessionNameUpdated={(newName) => {
          if (friend.sessionId) onSessionNameUpdated?.(friend.sessionId, newName);
        }}
        onParticipantsChange={onGroupParticipantsChange}
      />

      {/* More options bottom sheet — ORCH-0435 */}
      <Modal
        visible={!isGroupChat && showMoreOptionsMenu}
        transparent
        animationType="slide"
        onRequestClose={() => setShowMoreOptionsMenu(false)}
      >
        <TouchableOpacity
          style={styles.chatSheetOverlay}
          activeOpacity={1}
          onPress={() => setShowMoreOptionsMenu(false)}
        />
        <View style={styles.chatSheetContainer}>
          <View style={styles.chatSheetHandle} />
          <Text style={styles.chatSheetTitle}>{cleanName(friend.name)}</Text>

          <TouchableOpacity
            style={styles.chatSheetItem}
            onPress={() => { setShowMoreOptionsMenu(false); onViewProfile?.(friend.id); }}
            activeOpacity={0.7}
          >
            <Icon name="person-outline" size={20} color="#111827" style={styles.chatSheetIcon} />
            <Text style={styles.chatSheetText}>View Profile</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.chatSheetItem}
            onPress={() => { setShowMoreOptionsMenu(false); handleAddToBoard(); }}
            activeOpacity={0.7}
          >
            <Icon name="people-outline" size={20} color="#111827" style={styles.chatSheetIcon} />
            <Text style={styles.chatSheetText}>Add to Session</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.chatSheetItem}
            onPress={() => { setShowMoreOptionsMenu(false); handleShareSavedCard(); }}
            activeOpacity={0.7}
          >
            <Icon name="bookmark-outline" size={20} color="#111827" style={styles.chatSheetIcon} />
            <Text style={styles.chatSheetText}>Share Saved Card</Text>
          </TouchableOpacity>

          <View style={styles.chatSheetDivider} />

          <TouchableOpacity
            style={styles.chatSheetItem}
            onPress={() => { setShowMoreOptionsMenu(false); handleRemoveFriend(); }}
            activeOpacity={0.7}
          >
            <Icon name="person-remove" size={20} color="#ef4444" style={styles.chatSheetIcon} />
            <Text style={styles.chatSheetTextDanger}>Remove Friend</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.chatSheetItem}
            onPress={() => { setShowMoreOptionsMenu(false); handleBlockUser(); }}
            activeOpacity={0.7}
          >
            <Icon name="shield" size={20} color="#ef4444" style={styles.chatSheetIcon} />
            <Text style={styles.chatSheetTextDanger}>Block User</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.chatSheetItem}
            onPress={() => { setShowMoreOptionsMenu(false); handleReportUser(); }}
            activeOpacity={0.7}
          >
            <Icon name="flag" size={20} color="#ef4444" style={styles.chatSheetIcon} />
            <Text style={styles.chatSheetTextDanger}>Report User</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Local Notifications */}
      {notifications.length > 0 && (
        <View style={styles.notificationsContainer}>
          {notifications.map((notification) => renderNotificationCard(notification, false))}
        </View>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "rgba(12, 14, 18, 1)", // ORCH-0600: dark canvas for glass design
  },
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fef3c7",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: "#fde68a",
    gap: 6,
  },
  offlineBannerText: {
    fontSize: 13,
    color: "#92400e",
    fontWeight: "500",
  },
  blockedBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fef2f2",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: "#fecaca",
    gap: 8,
  },
  blockedBannerText: {
    fontSize: 14,
    color: "#dc2626",
    fontWeight: "500",
  },
  header: {
    paddingHorizontal: 0,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "rgba(12, 14, 18, 1)",
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  collabHeaderTopRow: {
    marginBottom: 10,
    paddingRight: 6,
  },
  backButton: {
    width: 40,
    height: 40,
    /*  backgroundColor: "#f3f4f6", */
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
  avatarContainer: {
    position: "relative",
    marginRight: 12,
  },
  collabAvatarContainer: {
    marginRight: 14,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  groupCoverAvatar: {
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.18)",
  },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    backgroundColor: "#eb7825",
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "white",
    fontWeight: "500",
    fontSize: 14,
  },
  groupHeaderAvatarStack: {
    width: 64,
    height: 40,
    position: "relative",
  },
  collabHeaderAvatarStack: {
    width: 64,
    height: 34,
  },
  groupHeaderAvatarSegment: {
    position: "absolute",
    top: 0,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#eb7825",
    borderWidth: 2,
    borderColor: "rgba(12, 14, 18, 1)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  collabHeaderAvatarSegment: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: "rgba(12, 14, 18, 1)",
  },
  collabHeaderLeadAvatar: {
    borderColor: "#f97316",
  },
  groupHeaderAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
  },
  collabHeaderAvatarPlaceholder: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: "#f97316",
  },
  groupHeaderAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  collabHeaderAvatarImage: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  collabSingleAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderColor: "#f97316",
  },
  onlineIndicator: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    backgroundColor: "#10b981",
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "rgba(12, 14, 18, 1)",
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  collabUserName: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0,
  },
  collabAvatarText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 11,
  },
  collabHeaderPill: {
    flex: 1,
    minWidth: 0,
    minHeight: 50,
    borderRadius: 25,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingLeft: 8,
    paddingRight: 12,
    backgroundColor: "rgba(255, 255, 255, 0.055)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
  },
  collabHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  userStatus: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.6)",
  },
  groupParticipantCount: {
    fontSize: 13,
    color: "rgba(255, 255, 255, 0.62)",
    marginTop: 2,
  },
  collabHeaderActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 24,
  },
  collabHeaderActionButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: "rgba(255, 255, 255, 0.055)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
  },
  collabHeaderActionText: {
    color: "rgba(255, 255, 255, 0.78)",
    fontSize: 15,
    fontWeight: "700",
  },
  eventChannelHeaderStack: {
    backgroundColor: "#f97316",
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: "hidden",
    shadowColor: "#f97316",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 5,
  },
  eventChannelHeaderDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 24,
    backgroundColor: "rgba(255, 255, 255, 0.22)",
  },
  broadcastChannelBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: "transparent",
  },
  broadcastOnlyChannelBanner: {
    backgroundColor: "transparent",
  },
  broadcastChannelIconShell: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.16)",
  },
  broadcastChannelLine: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
    lineHeight: 20,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    paddingLeft: 48, // Align with content (back button + avatar width)
  },
  actionButton: {
    width: 32,
    height: 32,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)", // __not_chrome__: chat-header utility button, separate design language from glass.chrome.* — see ORCH-0669 D-1
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  moreOptionsContainer: {
    position: "relative",
  },
  moreOptionsMenu: {
    position: "absolute",
    top: 40,
    right: 0,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
    paddingVertical: 8,
    minWidth: 220,
    zIndex: 20,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuItemDanger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuItemText: {
    fontSize: 14,
    color: "#374151",
  },
  menuItemTextDanger: {
    fontSize: 14,
    color: "#dc2626",
  },
  menuDivider: {
    height: 1,
    backgroundColor: "#e5e7eb",
    marginVertical: 8,
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContentContainer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyStateIcon: {
    width: 64,
    height: 64,
    backgroundColor: "#fef3e2",
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#FFFFFF",
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.65)",
    textAlign: "center",
  },
  messagesList: {
    gap: 16,
  },
  messageContainer: {
    marginBottom: 16,
  },
  messageContainerLeft: {
    alignItems: "flex-start",
  },
  messageContainerRight: {
    alignItems: "flex-end",
  },
  messageBubble: {
    padding: 12,
    borderRadius: 16,
    maxWidth: "70%",
  },
  messageBubbleLeft: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)", // __not_chrome__: incoming message bubble, separate design language from glass.chrome.* — see ORCH-0669 D-1
  },
  messageBubbleRight: {
    backgroundColor: "#eb7825",
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.55)",
    shadowColor: "#eb7825",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 20,
  },
  messageTextLeft: {
    color: "#FFFFFF",
  },
  messageTextRight: {
    color: "#FFFFFF",
  },
  messageCaption: {
    marginBottom: 8,
  },
  messageImage: {
    width: 200,
    height: 150,
    borderRadius: 8,
  },
  videoContainer: {
    width: 200,
    height: 150,
    borderRadius: 8,
    overflow: "hidden",
  },
  videoPlaceholder: {
    width: 200,
    height: 150,
    backgroundColor: "rgba(0, 0, 0, 0.1)",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  videoPlayer: {
    width: "100%",
    height: "100%",
  },
  videoText: {
    fontSize: 14,
    marginTop: 8,
  },
  videoTextLeft: {
    color: "rgba(255, 255, 255, 0.72)",
  },
  videoTextRight: {
    color: "#FFFFFF",
  },
  fileContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 8,
    borderRadius: 8,
  },
  fileContainerLeft: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  fileContainerRight: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },
  fileIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  fileIconLeft: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  fileIconRight: {
    backgroundColor: "rgba(255, 255, 255, 0.3)",
  },
  fileInfo: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    fontSize: 14,
    fontWeight: "500",
  },
  fileNameLeft: {
    color: "#FFFFFF",
  },
  fileNameRight: {
    color: "#FFFFFF",
  },
  fileSize: {
    fontSize: 12,
    marginTop: 2,
  },
  fileSizeLeft: {
    color: "rgba(255, 255, 255, 0.6)",
  },
  fileSizeRight: {
    color: "rgba(255, 255, 255, 0.7)",
  },
  messageTimestamp: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.45)",
    marginTop: 4,
  },
  messageTimestampLeft: {
    textAlign: "left",
  },
  messageTimestampRight: {
    textAlign: "right",
  },
  processingOverlay: {
    flex: 1,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  processingContainer: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 150,
  },
  processingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#6b7280",
    fontWeight: "500",
  },
  filePreview: {
    padding: 16,
    backgroundColor: "transparent",
  },
  filePreviewContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "white",
    padding: 12,
    borderRadius: 8,
  },
  filePreviewImage: {
    width: 48,
    height: 48,
    borderRadius: 8,
  },
  filePreviewVideo: {
    width: 48,
    height: 48,
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  filePreviewIcon: {
    width: 48,
    height: 48,
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  filePreviewLoader: {
    width: 48,
    height: 48,
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  filePreviewInfo: {
    flex: 1,
    minWidth: 0,
  },
  filePreviewName: {
    fontSize: 14,
    fontWeight: "500",
    color: "#111827",
  },
  filePreviewSize: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
  },
  removeFileButton: {
    width: 24,
    height: 24,
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  imagePreviewModal: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  imagePreviewCloseButton: {
    position: "absolute",
    top: 50,
    right: 20,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  imagePreviewFullscreen: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  // ORCH-0600: Floating glass input capsule — blurred pill with inner separators
  // between attach / text / send, matching the home-chrome capsule language.
  inputCapsuleWrap: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 60,
  },
  broadcastComposerNotice: {
    position: "absolute",
    left: 24,
    right: 24,
    zIndex: 55,
    minHeight: BROADCAST_COMPOSER_NOTICE_HEIGHT,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)",
  },
  broadcastComposerNoticeText: {
    flex: 1,
    minWidth: 0,
    color: "rgba(255, 255, 255, 0.78)",
    fontSize: 13,
    fontWeight: "600",
  },
  replyPreviewWrap: {
    marginBottom: 6,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: glass.chrome.tint.floor,
    borderWidth: 1,
    borderColor: glass.chrome.border.hairline,
  },
  inputCapsule: {
    height: INPUT_CAPSULE_HEIGHT,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: glass.chrome.border.hairline,
    overflow: "hidden",
    shadowColor: glass.chrome.shadow.color,
    shadowOffset: glass.chrome.shadow.offset,
    shadowOpacity: glass.chrome.shadow.opacity,
    shadowRadius: glass.chrome.shadow.radius,
    elevation: glass.chrome.shadow.elevation,
  },
  inputContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
  },
  capsuleSeparator: {
    width: StyleSheet.hairlineWidth,
    height: 24,
    backgroundColor: glass.chrome.border.hairline,
    marginHorizontal: 4,
  },
  attachmentContainer: {
    position: "relative",
  },
  attachmentButton: {
    width: 44,
    height: 44,
    backgroundColor: "transparent",
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  attachmentMenu: {
    position: "absolute",
    bottom: 50,
    left: 0,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
    padding: 8,
    minWidth: 200,
    zIndex: 10,
  },
  attachmentMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 8,
  },
  attachmentMenuIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  attachmentMenuTitle: {
    fontSize: 14,
    fontWeight: "500",
    color: "#111827",
  },
  attachmentMenuSubtitle: {
    fontSize: 12,
    color: "#6b7280",
  },
  messageInputContainer: {
    flex: 1,
    backgroundColor: "transparent",
    paddingHorizontal: 8,
    paddingVertical: 10,
    minHeight: 40,
    justifyContent: "center",
  },
  messageInput: {
    flex: 1,
    fontSize: 16,
    lineHeight: 20,
    color: "#FFFFFF",
    padding: 0,
    margin: 0,
    includeFontPadding: false,
    textAlignVertical: "center",
    maxHeight: 72,
  },
  sendButton: {
    width: 40,
    height: 40,
    backgroundColor: "#eb7825",
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  modalOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 50,
  },
  modalContainer: {
    backgroundColor: "white",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
  },
  modalCloseButton: {
    width: 24,
    height: 24,
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  modalSubtitle: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 16,
  },
  boardList: {
    marginBottom: 24,
  },
  boardItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    marginBottom: 12,
  },
  boardItemSelected: {
    backgroundColor: "#fef3f2",
    borderColor: "#fecaca",
  },
  checkbox: {
    width: 16,
    height: 16,
    borderWidth: 2,
    borderColor: "#d1d5db",
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
  },
  boardInfo: {
    flex: 1,
  },
  boardName: {
    fontSize: 14,
    fontWeight: "500",
    color: "#111827",
  },
  boardParticipants: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
  },
  // ORCH-0667: shared-card picker styles
  savedCardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.05)",
  },
  savedCardThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.06)",
  },
  savedCardThumbPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  savedCardInfo: {
    flex: 1,
    minWidth: 0,
  },
  savedCardTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  savedCardSubtitle: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
  },
  savedCardSkeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  savedCardSkeletonThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.08)",
  },
  savedCardSkeletonText: {
    flex: 1,
  },
  savedCardSkeletonBar: {
    height: 10,
    borderRadius: 4,
    backgroundColor: "rgba(0,0,0,0.08)",
  },
  savedCardEmptyContainer: {
    paddingHorizontal: 24,
    paddingVertical: 32,
    alignItems: "center",
    gap: 12,
  },
  savedCardEmptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    textAlign: "center",
  },
  savedCardEmptyBody: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 8,
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#374151",
  },
  confirmButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#eb7825",
    borderRadius: 12,
    alignItems: "center",
  },
  confirmButtonText: {
    fontSize: 14,
    fontWeight: "500",
    color: "white",
  },
  notificationsContainer: {
    position: "absolute",
    top: 80,
    left: 16,
    right: 16,
    zIndex: 50,
    gap: 8,
  },
  notification: {
    // backgroundColor + borderColor set inline per notification.type via getNotificationVisuals
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingRight: 14,
    paddingLeft: 18, // 4px stripe + 14px gutter
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    overflow: "hidden",
  },
  notificationIndicator: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    // backgroundColor set inline per notification.type
  },
  notificationContent: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 2,
  },
  notificationTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  notificationTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
    flexShrink: 1,
  },
  notificationMessage: {
    fontSize: 14,
    color: "#374151",
    marginTop: 4,
    lineHeight: 19,
  },
  dismissButton: {
    width: 24,
    height: 24,
    backgroundColor: "transparent",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    alignSelf: "flex-start",
    marginTop: 2,
  },
  // ORCH-0435: Day separator
  daySeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  daySeparatorLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e5e7eb',
  },
  daySeparatorText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9ca3af',
  },
  // ORCH-0435: Header more button + bottom sheet
  headerMoreBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: "auto",
  },
  eventAudienceOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.52)",
  },
  eventAudienceSheet: {
    backgroundColor: "#111418",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: "rgba(255, 255, 255, 0.10)",
  },
  eventAudienceSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  eventAudienceIconShell: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f97316",
  },
  eventAudienceHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  eventAudienceTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#ffffff",
    letterSpacing: 0,
  },
  eventAudienceSubtitle: {
    marginTop: 3,
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.58)",
  },
  eventAudienceList: {
    maxHeight: Math.min(SCREEN_HEIGHT * 0.52, 430),
  },
  eventAudienceListContent: {
    paddingTop: 10,
    paddingBottom: 4,
  },
  eventAudienceRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 64,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.06)",
  },
  eventAudienceAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.32)",
  },
  eventAudienceAvatarFallback: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eb7825",
  },
  eventAudienceAvatarText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#ffffff",
  },
  eventAudienceRowCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
    marginRight: 10,
  },
  eventAudienceName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#f8fafc",
  },
  eventAudienceRole: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.48)",
  },
  eventAudienceEmpty: {
    alignItems: "center",
    paddingVertical: 28,
    paddingHorizontal: 16,
  },
  eventAudienceEmptyTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#ffffff",
    textAlign: "center",
  },
  eventAudienceEmptyText: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    color: "rgba(255, 255, 255, 0.56)",
    textAlign: "center",
  },
  chatSheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  chatSheetContainer: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
  },
  chatSheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d1d5db",
    alignSelf: "center",
    marginBottom: 16,
  },
  chatSheetTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
    marginBottom: 16,
  },
  chatSheetItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
  },
  chatSheetIcon: {
    width: 28,
    textAlign: "center",
    marginRight: 14,
  },
  chatSheetText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#111827",
  },
  chatSheetTextDanger: {
    fontSize: 16,
    fontWeight: "500",
    color: "#ef4444",
  },
  chatSheetDivider: {
    height: 1,
    backgroundColor: "#f3f4f6",
    marginVertical: 4,
  },
});
