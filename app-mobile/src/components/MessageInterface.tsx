import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  FlatList,
  Alert,
  Platform,
  Linking,
  Dimensions,
  ActivityIndicator,
  useWindowDimensions,
  type ListRenderItemInfo,
} from "react-native";
import { Icon } from "./ui/Icon";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as WebBrowser from "expo-web-browser";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { supabase } from "../services/supabase";
import { useKeyboard } from "../hooks/useKeyboard";
import { useChatPresence } from "../hooks/useChatPresence";
import { useBroadcastReceiver } from "../hooks/useBroadcastReceiver";
import { MessageBubble, type CollabSystemToken } from "./chat/MessageBubble";
import type { CollabDeadEndBannerPayload } from "../services/collabDeadEndBannerService";
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
import { ChatHeader, type ChatHeaderStripLabels } from "./chat/ChatHeader";
import { buildCollabHeaderStrip, matchKey, memberFirstNames } from "./chat/chatHeaderModel";
import { useSeenSessionMatches } from "../hooks/useSeenSessionMatches";
import { ChatActionList } from "./chat/ChatActionList";
import { GroupInfoSheet } from "./chat/GroupInfoSheet";
import { ChatMediaSheet } from "./chat/ChatMediaSheet";
import { ChatAttachSheet } from "./chat/ChatAttachSheet";
import { ChatVideoPlayerModal } from "./chat/ChatVideoPlayerModal";
import { ViewOncePhotoViewer } from "./chat/ViewOncePhotoViewer";
import { ImageLightbox } from "./ImageLightbox";
import {
  MAX_CHAT_MEDIA_ITEMS,
  validateChatMedia,
  viewOnceState,
  type ChatMediaRefusal,
  type PickedChatMedia,
} from "../utils/chatMedia";
import { openViewOnceMedia, peekChatMediaUrl, resolveChatMediaUrl } from "../services/chatMediaUploadService";
import { SavedCardPicker } from "./chat/SavedCardPicker";
import { buildFriendMenu, type FriendMenuItemId } from "../utils/chatMenuModel";
import {
  getCollabChatHeaderActions,
  type CollabChatHeaderActionId,
} from "./connections/collabChatHeaderUtils";
import { BoardSettingsDropdown } from "./board/BoardSettingsDropdown";
import { MentionPopover } from "./board/MentionPopover";
import { CardTagPopover } from "./board/CardTagPopover";
import type { Participant } from "./board/ParticipantAvatars";
import { groupMessages } from "../utils/messageGrouping";
import {
  aggregateReactions,
  dayLabelKind,
  firstUnreadMessageId,
  shouldShowSenderName,
  typingLabel,
  COMPOSER_INPUT_MAX_HEIGHT,
  COMPOSER_LINE_HEIGHT,
  COMPOSER_MIN_HEIGHT,
  type GroupPosition,
  type ReactionRow,
  type ReactionSummary,
} from "../utils/threadModel";
import { TypingIndicator } from "./chat/TypingIndicator";
import { useComposerLayout } from "../hooks/useComposerLayout";
import { useChatBackHandler } from "../hooks/useChatBackHandler";
import { useScrollToLatest } from "../hooks/useScrollToLatest";
import { requestGalleryPermission } from "../utils/mediaLibraryPermission";
import { DirectMessage, messagingService, CardPayload, MentionEntry, CardTagEntry, isContentShareCardPayload, type LegacyCardPayload } from "../services/messagingService";
import { cardPayloadToExpandedCardData } from "../services/cardPayloadAdapter";  // ORCH-0685
import { prepareContentShare } from "../services/contentShareAdapter";
import { clearContentShareOperationId, sendContentShareToRecipients } from "../services/contentShareDeliveryService";
import { nativeContentCardSnapshotService } from "../services/nativeContentCardSnapshotService";
import { savedCardsService } from "../services/savedCardsService";  // ORCH-0685
import { useSavedCards } from "../hooks/useSavedCards";
import { useSessionScheduledCards } from "../hooks/useSessionScheduledCards";
import { useBoardSession } from "../hooks/useBoardSession";
import { useConversationParticipants } from "../hooks/useConversationParticipants";
import { useChatCardTagSource } from "../hooks/useChatCardTagSource";
import { useChatInputController } from "../hooks/useChatInputController";
import { KEYBOARD_TOOLBAR_HEIGHT } from "../wrappers/keyboardConstants";
import ExpandedCardModal from "./ExpandedCardModal";  // ORCH-0667
import { openExpandedCardContentShare } from "../services/contentShareController";
import { BaseBottomSheet } from "./ui/BaseBottomSheet";
// ORCH-1138 Leg 3 — chat purchased-banner repointed off ExpandedBusinessEventSheet
// (EBES decommissioned) to the foundation detail screens: trip → Leg-1
// ConsumerTripDetailScreen, event → Leg-2 ConsumerEventDetailScreen.
// I-PROPOSED-1138-EBES-DELETED.
import ConsumerTripDetailScreen from "../screens/Trip/ConsumerTripDetailScreen";
import ConsumerEventDetailScreen from "../screens/Event/ConsumerEventDetailScreen";
import type { ExpandedCardData } from "../types/expandedCardTypes";  // ORCH-0685
import type { BusinessEventCard } from "../types/mergedDiscover";
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { HapticFeedback } from "../utils/hapticFeedback";
import { glass, ANDROID_GLASS_USES_OPAQUE_FALLBACK } from "../constants/designSystem";
import { colors } from "../constants/colors";
import { chatTokens } from "../constants/chatTokens";
import { useAppLayout } from "../hooks/useAppLayout";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { validateNativeContentCardDescriptorV1, type NativeContentCardDescriptorV1 } from '@mingla/sharing';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

/** Vertical gap between composer border and input row; match bottom when keyboard is closed. */
const INPUT_AREA_VERTICAL_PADDING = 6;
/** ORCH-0600: breathing gap between floating glass input capsule and the bottom nav. */
const INPUT_CAPSULE_MARGIN_BOTTOM = 14;
/** Bottom read-only broadcast pill height; used to keep chat bubbles and sheets above it. */
// META-ORCH-0991 Wave B Batch 5: fixed compact snap for the 1:1 chat
// more-options action menu (was a flex-end RN <Modal>).
const CHAT_MORE_OPTIONS_SNAP = ["45%"] as const;
// META-ORCH-0991 Wave C: event-audience picker — was a dark flex-end RN <Modal>
// (list maxHeight min(SCREEN_HEIGHT*0.52, 430) + header) → fixed ['70%'] snap.
const EVENT_AUDIENCE_SNAP = ["70%"] as const;

/** Issue #4114 Wave 3: wait for the menu sheet to leave before presenting the next one. */
const MENU_PRESENT_AFTER_DISMISS_MS = 320;
const MUTE_BUSY_IDS: ReadonlySet<FriendMenuItemId> = new Set<FriendMenuItemId>(["mute"]);

interface ContextMenuState {
  visible: boolean;
  messageId: string;
  content: string;
  isMe: boolean;
  top: number;
  type: string;
  isSent: boolean;
}

const CLOSED_CONTEXT_MENU: ContextMenuState = {
  visible: false,
  messageId: '',
  content: '',
  isMe: false,
  top: 0,
  type: 'text',
  isSent: false,
};

/** Issue #4114 Wave 3: show the scroll-to-latest button past this offset. */
const SCROLL_TO_LATEST_THRESHOLD = 600;

/** Issue #4114 Wave 3: list padding above a no-composer notice banner. */
const NOTICE_BANNER_LIST_GAP = 12;
const THREAD_VISIBLE_CONTENT_POSITION = { minIndexForVisible: 0, autoscrollToTopThreshold: 80 } as const;

const BROADCAST_COMPOSER_NOTICE_HEIGHT = 56;
const BROADCAST_COMPOSER_NOTICE_BOTTOM_GAP = 14;
const BROADCAST_COMPOSER_NOTICE_CONTENT_GAP = 12;

interface Message {
  id: string;
  clientId?: string;  // Issue #4114: stable key across optimistic → confirmed
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
  type: "text" | "image" | "video" | "file" | "card" | "system";
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
  systemPayload?: CollabDeadEndBannerPayload;  // ORCH-1058B
  /** Issue #4114 Wave 3: direct_message_reactions rows for this message. */
  reactions?: ReactionRow[];
  /** Issue #4114 Wave 3: unsent — hidden from the thread. */
  unsent?: boolean;
  /** Issue #4114 Wave 4: view once, who opened it, and the sender's local file while it uploads. */
  viewOnce?: boolean;
  viewOncePurged?: boolean;
  mediaViews?: Array<{ user_id: string; viewed_at: string }>;
  localMedia?: PickedChatMedia;
}

/** Issue #4114 Wave 3: one prepared row of the thread (built once per message change). */
interface ThreadRow {
  key: string;
  message: Message;
  groupPosition: GroupPosition;
  senderName: string;
  bubble: React.ComponentProps<typeof MessageBubble>["message"];
  showSenderName: boolean;
  reactions: ReactionSummary[];
  myReactions: string[];
  replyTo?: {
    senderName: string;
    content: string;
    imageUrl?: string;
    isDeleted?: boolean;
    messageId?: string;
  };
  isRead: boolean;
  dayLabel: string | null;
  showNewDivider: boolean;
}

const EMPTY_EMOJIS: string[] = [];
const threadRowKey = (row: ThreadRow): string => row.key;

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
   * Issue #4114 Wave 4: send the attach sheet's photos, videos or file. The
   * composer text is the caption; ConnectionsPage uploads through the one
   * chat media service.
   */
  onSendMedia?: (items: PickedChatMedia[], caption: string, viewOnce: boolean, replyToId?: string) => void;
  /** Issue #4114 Wave 4: 0..1 upload progress of media sends, by client id. */
  uploadProgress?: Record<string, number>;
  /** Issue #4114 Wave 4: cancel a media send while it uploads. */
  onCancelUpload?: (messageId: string) => void;
  /** Issue #4114: tap a failed bubble to resend it with the same client id. */
  onRetryMessage?: (messageId: string) => void;
  /** Issue #4114: scrolled to the top — load the previous page of history. */
  onLoadOlderMessages?: () => void;
  hasOlderMessages?: boolean;
  isLoadingOlderMessages?: boolean;
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
  /**
   * Issue #4114 Wave 3: each runs its own confirm and calls `onSettled` with the
   * REAL outcome (false on Cancel or failure). The chat's "removed / blocked /
   * reported" toast fires only on `true`, never before the confirm.
   */
  onRemoveFriend?: (friend: any, onSettled?: (removed: boolean) => void) => void;
  onBlockUser?: (friend: any, onSettled?: (blocked: boolean) => void) => void;
  onReportUser?: (friend: any, onSettled?: (reported: boolean) => void) => void;
  /** Issue #4114 Wave 3: 1:1 mute (per person). Resolves true once saved. */
  isMuted?: boolean;
  onToggleMute?: () => Promise<boolean>;
  /** Issue #4114 Wave 3: the member left a group that has no session. */
  onGroupConversationLeft?: () => void;
  /** Issue #4114 Wave 3: toggle your reaction; awaited, failures roll back and toast. */
  onToggleReaction?: (messageId: string, emoji: string) => Promise<void>;
  /** Issue #4114 Wave 3: unsend your own message (after the confirm here). */
  onUnsendMessage?: (messageId: string) => Promise<boolean>;
  /** Issue #4114 Wave 3: report someone else's message; settles with the real outcome. */
  onReportMessage?: (
    message: { id: string; senderId: string; senderName: string; content: string },
    onSettled?: (reported: boolean) => void,
  ) => void;
  /** Issue #4114 Wave 3: the first read of this chat has not landed yet. */
  isLoadingMessages?: boolean;
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
  /** Issue #4114 (D13): a paired friend's 1:1 menu opens their paired view. */
  isPairedFriend?: boolean;
  onOpenPairedProfile?: (userId: string) => void;
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
  onSendMedia,
  uploadProgress,
  onCancelUpload,
  onRetryMessage,
  onLoadOlderMessages,
  hasOlderMessages = false,
  isLoadingOlderMessages = false,
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
  isPairedFriend = false,
  onOpenPairedProfile,
  isMuted = false,
  onToggleMute,
  onGroupConversationLeft,
  onToggleReaction,
  onUnsendMessage,
  onReportMessage,
  isLoadingMessages = false,
  onSessionNameUpdated,
  onGroupSessionExited,
  onGroupSessionDeleted,
  onGroupParticipantsChange,
}: MessageInterfaceProps) {
  const router = useRouter();
  const { t, i18n } = useTranslation(['chat', 'common', 'social', 'connections']);
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
  const isTripChat = friend.linkedEntityType === "trip";
  const eventAudienceTitle = isTripChat ? t('chat:audienceTravellers') : t('chat:audienceAttendees');
  const eventAudienceSubtitle = isTripChat
    ? t('chat:audienceTravellingCount', { count: headerParticipantCount })
    : t('chat:audienceAttendingCount', { count: headerParticipantCount });
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
  // Issue #4114 Wave 4: the attach sheet's picked items and its View once switch.
  const [pendingMedia, setPendingMedia] = useState<PickedChatMedia[]>([]);
  const [attachViewOnce, setAttachViewOnce] = useState(false);
  const [isPickingMedia, setIsPickingMedia] = useState(false);
  // Issue #4114 Wave 4: media viewers (photo lightbox, video player, the one
  // look at a view-once item) and the view-once items opened on this phone.
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [viewOncePhotoUrl, setViewOncePhotoUrl] = useState<string | null>(null);
  const [viewOnceVideoUrl, setViewOnceVideoUrl] = useState<string | null>(null);
  const [openedViewOnce, setOpenedViewOnce] = useState<Record<string, true>>({});
  const openingViewOnceRef = useRef<string | null>(null);
  const [showMoreOptionsMenu, setShowMoreOptionsMenu] = useState(false);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showMediaSheet, setShowMediaSheet] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isMuteBusy, setIsMuteBusy] = useState(false);
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
  const [resolvingNativeCardId, setResolvingNativeCardId] = useState<string | null>(null);
  const [nativeCard, setNativeCard] = useState<NativeContentCardDescriptorV1 | null>(null);
  const pickerSubmittingRef = useRef(false);
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
    // Issue #4114 Wave 3 (D9): a new match opens the strip with a light haptic.
    { onMatchPromoted: HapticFeedback.light },
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
  // Issue #4114 Wave 3 (D9): the header strip — matched places and the next
  // plan — from the two hooks above. No new queries.
  const { seenIds: seenMatchIds, markSeen: markMatchesSeen } = useSeenSessionMatches(
    isCollabSessionGroupChat ? friend.sessionId : null,
  );
  const collabHeaderStrip = useMemo(
    () =>
      isCollabSessionGroupChat
        ? buildCollabHeaderStrip({
            actionIds: collabHeaderActions.map((action) => action.id),
            matches: matchedSessionCards,
            matchesLoading: matchedSessionCardsLoading,
            plans: scheduledCardsQuery.rows,
            plansLoading: scheduledCardsQuery.isLoading,
            seenMatchIds,
            now: Date.now(),
            untitled: t('chat:planUntitled'),
          })
        : null,
    [
      collabHeaderActions,
      isCollabSessionGroupChat,
      matchedSessionCards,
      matchedSessionCardsLoading,
      scheduledCardsQuery.isLoading,
      scheduledCardsQuery.rows,
      seenMatchIds,
      t,
    ],
  );
  const collabHeaderStripLabels = useMemo<ChatHeaderStripLabels>(
    () => ({
      matchesCount: (count: number) => t('chat:matchesCount', { count }),
      matchesLoading: t('chat:matchesLoading'),
      newMatches: t('chat:newMatches'),
      lastPlan: t('chat:lastPlan'),
      plansLoading: t('chat:plansLoading'),
      moreCount: (count: number) => t('chat:moreCount', { count }),
      openMatches: t('chat:a11yOpenMatches'),
      openPlans: t('chat:a11yOpenPlans'),
    }),
    [t],
  );
  const headerAvatarKind: "single" | "stack" | "cover" = !isGroupChat
    ? "single"
    : friend.eventCoverMediaUrl
      ? "cover"
      : "stack";
  const headerSubtitle: React.ReactNode = isCollabSessionGroupChat
    ? memberFirstNames(
        headerParticipants
          .filter((participant) => participant.id !== currentUserId)
          .map((participant) => getHeaderParticipantName(participant)),
        t('chat:you'),
        (names) => t('chat:membersAndYou', { names }),
      )
    : isTripEventGroupChat
      ? eventAudienceSubtitle
      : isGroupChat
        ? t('chat:peopleInChat', { count: headerParticipantCount })
        : null;
  const collabParticipantCount =
    (collabSession?.participants as any[] | undefined)?.length || headerParticipantCount;
  const inputRef = useRef<TextInput>(null);
  const chatController = useChatInputController({
    participants: participantsQuery.data ?? [],
    cardTagSource: chatCardTagSource.data,
  });
  const newMessage = chatController.text;

  // Issue #4114 Wave 3: one stable card-open handler for bubbles and the
  // "Photos, videos and cards" sheet.
  const handleCardBubbleTap = useCallback(async (payload: CardPayload, messageId: string): Promise<void> => {
    if (isContentShareCardPayload(payload)) {
      const descriptor = validateNativeContentCardDescriptorV1(payload.nativeCard);
      if (descriptor) {
        const openSnapshot = (card: LegacyCardPayload) => {
          setExpandedCardFromChat(cardPayloadToExpandedCardData(card));
          setShowExpandedCardFromChat(true);
        };
        const resolveAndOpen = async (): Promise<void> => {
          setResolvingNativeCardId(messageId);
          setNativeCard(descriptor);
          try {
            const cached = await nativeContentCardSnapshotService.cached(messageId, descriptor.snapshotFingerprint);
            if (cached) { openSnapshot(cached); return; }
            if (isOffline) {
              Alert.alert('Connect to open the full card', 'Reconnect, then try again.');
              return;
            }
            const resolved = await nativeContentCardSnapshotService.resolve([messageId], { [messageId]: descriptor.snapshotFingerprint });
            const snapshot = resolved.get(messageId);
            if (!snapshot) throw new Error('native_snapshot_unavailable');
            openSnapshot(snapshot);
          } catch {
            Alert.alert("Couldn't open the full card", 'Connect and try again, or open the shared web link.', [
              { text: 'Open shared link', onPress: () => router.push(`/s/${payload.shareCode}` as never) },
              { text: 'Retry', onPress: () => { void resolveAndOpen(); } },
            ]);
          } finally { setResolvingNativeCardId(null); setNativeCard(null); }
        };
        await resolveAndOpen();
        return;
      }
      router.push(`/s/${payload.shareCode}` as never);
      return;
    }
    // ORCH-0685: typed conversion replaces unsafe `any` cast (Constitution #12 fix).
    setExpandedCardFromChat(cardPayloadToExpandedCardData(payload));
    setShowExpandedCardFromChat(true);
    // ORCH-0685 cycle-3: sharedCardIsSaved now derived via useEffect against
    // savedCardsQuery.data — no manual reset needed.
  }, [isOffline, router]);

  // Issue #4114 Wave 3: the stable setter, so this handler (and the list's
  // renderItem that passes it) does not change on every keystroke.
  const { setDraftText } = chatController;
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
    setDraftText(`@${participantName} ${token.text}`);
    setTimeout(() => inputRef.current?.focus?.(), 50);
  }, [
    setDraftText,
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
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(CLOSED_CONTEXT_MENU);
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
  const { keyboardHeight, isVisible: keyboardVisible } = useKeyboard({
    disableLayoutAnimation: true, // We use animated values instead
  });
  // Issue #4114 Wave 3: the growing composer's measured height.
  const { composerHeight, onComposerLayout } = useComposerLayout();

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
  // Issue #4114 Wave 3: unsent messages are hidden (kept in the store so the
  // merge never resurrects them from an older copy).
  const visibleMessages = useMemo(() => messages.filter((message) => !message.unsent), [messages]);
  const groupedMessages = useMemo(() => {
    if (!visibleMessages.length) return [];
    const grouped = groupMessages(visibleMessages);
    return [...grouped].reverse();
  }, [visibleMessages]);

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
    if (newMessage.trim()) {
      const replyToId = replyingTo?.messageId;
      const { content, mentions, cardTags } = chatController.serializeForSend();
      setReplyingTo(null); // Clear reply state immediately
      onSendMessage(content, "text", undefined, replyToId, mentions, cardTags);
      chatController.reset();
      stopTyping();
      HapticFeedback.light();
    }
  };

  // ── Issue #4114 Wave 4: attach sheet ─────────────────────────
  // Every pick is validated on the phone first (D7: video over 60 s or 25 MB,
  // any file over 25 MB, unsupported types) with a clear reason, and the sheet
  // holds up to MAX_CHAT_MEDIA_ITEMS items until Send.
  const refusalMessage = (reason: ChatMediaRefusal): string => {
    switch (reason) {
      case "video_too_long":
        return t('chat:mediaVideoTooLong');
      case "video_too_large":
        return t('chat:mediaVideoTooLarge');
      case "file_too_large":
        return t('chat:mediaTooLarge');
      case "unsupported_type":
        return t('chat:mediaTypeNotSupported');
      default: {
        const unreachable: never = reason;
        return String(unreachable);
      }
    }
  };

  const addPickedMedia = (picked: PickedChatMedia[]) => {
    const accepted: PickedChatMedia[] = [];
    const refusals = new Set<ChatMediaRefusal>();
    for (const item of picked) {
      const refusal = validateChatMedia(item);
      if (refusal) refusals.add(refusal);
      else accepted.push(item);
    }
    const room = MAX_CHAT_MEDIA_ITEMS - pendingMedia.length;
    if (accepted.length > room) {
      showNotification(t('chat:mediaLimitReached', { count: MAX_CHAT_MEDIA_ITEMS }), '', 'info');
    }
    if (accepted.length > 0) {
      setPendingMedia((prev) => [...prev, ...accepted].slice(0, MAX_CHAT_MEDIA_ITEMS));
      if (accepted.some((item) => item.kind === "file")) setAttachViewOnce(false);
    }
    if (refusals.size > 0) {
      Alert.alert(t('chat:mediaNotSentTitle'), [...refusals].map(refusalMessage).join("\n"));
    }
  };

  const assetToPicked = (asset: ImagePicker.ImagePickerAsset): PickedChatMedia => ({
    uri: asset.uri,
    kind: asset.type === "video" || asset.type === "pairedVideo" ? "video" : "image",
    mimeType: asset.mimeType ?? null,
    fileName: asset.fileName ?? null,
    fileSize: asset.fileSize ?? null,
    durationMs: asset.duration ?? null,
    width: asset.width ?? null,
    height: asset.height ?? null,
  });

  const handlePickLibrary = async () => {
    try {
      const { status } = await requestGalleryPermission();
      if (status !== "granted") {
        Alert.alert(t('chat:permissionRequired'), t('chat:mediaLibraryPermission'));
        return;
      }
      setIsPickingMedia(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        allowsMultipleSelection: true,
        selectionLimit: Math.max(1, MAX_CHAT_MEDIA_ITEMS - pendingMedia.length),
        // Full quality: the upload service resizes and compresses photos itself.
        quality: 1,
        videoMaxDuration: 60,
      });
      if (result.canceled || !result.assets?.length) return;
      addPickedMedia(result.assets.map(assetToPicked));
    } catch (error) {
      console.error("Error picking photos or videos:", error);
      Alert.alert(t('social:error'), t('chat:errorSelectFile'));
    } finally {
      setIsPickingMedia(false);
    }
  };

  const handlePickCamera = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('chat:permissionRequired'), t('chat:cameraPermission'));
        return;
      }
      setIsPickingMedia(true);
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        quality: 1,
        videoMaxDuration: 60,
      });
      if (result.canceled || !result.assets?.length) return;
      addPickedMedia(result.assets.map(assetToPicked));
    } catch (error) {
      console.error("Error taking a photo or video:", error);
      Alert.alert(t('social:error'), t('chat:errorSelectFile'));
    } finally {
      setIsPickingMedia(false);
    }
  };

  // "File" opens the real document picker (it used to open the photo library).
  const handlePickFile = async () => {
    try {
      setIsPickingMedia(true);
      // No `type`: the picker's default is every file type.
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.length) return;
      addPickedMedia(
        result.assets.map((asset) => ({
          uri: asset.uri,
          kind: "file" as const,
          mimeType: asset.mimeType ?? null,
          fileName: asset.name ?? null,
          fileSize: asset.size ?? null,
        })),
      );
    } catch (error) {
      console.error("Error picking a file:", error);
      Alert.alert(t('social:error'), t('chat:errorSelectFile'));
    } finally {
      setIsPickingMedia(false);
    }
  };

  const handleSendPickedMedia = () => {
    if (pendingMedia.length === 0 || !onSendMedia) return;
    const replyToId = replyingTo?.messageId;
    const { content } = chatController.serializeForSend();
    onSendMedia(pendingMedia, content, attachViewOnce, replyToId);
    setPendingMedia([]);
    setAttachViewOnce(false);
    setShowAttachmentMenu(false);
    setReplyingTo(null);
    chatController.reset();
    stopTyping();
    HapticFeedback.light();
  };

  const closeMediaViewers = () => {
    setLightboxUrl(null);
    setVideoUrl(null);
    setViewOncePhotoUrl(null);
    setViewOnceVideoUrl(null);
  };

  /** Opens a message's photo in the lightbox (signed link for stored paths). */
  const handleOpenImage = async (fileUrl: string | undefined) => {
    if (!fileUrl) return;
    try {
      const url = await resolveChatMediaUrl(fileUrl);
      if (!url) throw new Error("no_media_url");
      setLightboxUrl(url);
    } catch (error) {
      console.error("Error opening photo:", error);
      showNotification(t('chat:mediaLoadFailed'), '', 'error');
    }
  };

  const handleViewDocument = async (fileUrl: string | undefined) => {
    try {
      const url = await resolveChatMediaUrl(fileUrl);
      if (!url) {
        Alert.alert(t('social:error'), t('chat:errorDocumentUrl'));
        return;
      }
      try {
        await WebBrowser.openBrowserAsync(url, {
          showTitle: true,
          toolbarColor: "#eb7825",
          enableBarCollapsing: false,
        });
      } catch (error) {
        console.warn("In-app browser failed for a document, trying the system:", error);
        const canOpen = await Linking.canOpenURL(url);
        if (canOpen) {
          await Linking.openURL(url);
        } else {
          Alert.alert(t('social:error'), t('chat:errorOpenDocument'));
        }
      }
    } catch (error) {
      console.error("Error opening document:", error);
      Alert.alert(t('social:error'), t('chat:errorOpenDocumentGeneric'));
    }
  };

  /** Plays a message's video in the in-app player (expo-video). */
  const handleOpenVideo = async (fileUrl: string | undefined) => {
    try {
      const url = await resolveChatMediaUrl(fileUrl);
      if (!url) {
        Alert.alert(t('social:error'), t('chat:errorVideoUrl'));
        return;
      }
      setVideoUrl(url);
    } catch (error) {
      console.error("Error opening video:", error);
      Alert.alert(t('social:error'), t('chat:errorOpenVideoGeneric'));
    }
  };

  /**
   * The recipient's one open of a view-once item: the server records it and
   * hands back a 60-second link, then the bubble reads "Opened" for good.
   */
  const handleOpenViewOnce = async (message: Message) => {
    if (message.isMe || openedViewOnce[message.id] || openingViewOnceRef.current) return;
    openingViewOnceRef.current = message.id;
    try {
      const result = await openViewOnceMedia(message.id);
      if (result.ok) {
        setOpenedViewOnce((prev) => ({ ...prev, [message.id]: true }));
        if (result.messageType === "video") setViewOnceVideoUrl(result.url);
        else setViewOncePhotoUrl(result.url);
        return;
      }
      if (result.reason === "already_opened") {
        setOpenedViewOnce((prev) => ({ ...prev, [message.id]: true }));
        showNotification(t('chat:viewOnceAlreadyOpened'), '', 'info');
      } else if (result.reason === "gone") {
        showNotification(t('chat:viewOnceExpiredToast'), '', 'info');
      } else {
        showNotification(t('chat:viewOnceOpenFailed'), '', 'error');
      }
    } finally {
      openingViewOnceRef.current = null;
    }
  };

  // Notification management
  // Issue #4114 Wave 3: stable, so list callbacks that toast stay stable.
  const showNotification = useCallback((
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
  }, []);

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
    if (pickerSubmittingRef.current) return;  // same-turn double-tap guard
    if (!conversationId || !currentUserId) {
      showNotification(
        t('chat:cardShareFailedTitle'),
        t('chat:cardShareFailedToast'),
        'error',
      );
      return;
    }

    pickerSubmittingRef.current = true;
    setPickerSubmittingCardId(card.id);
    try {
      const curated = card.cardType === 'curated' || (Array.isArray(card.stops) && card.stops.length > 0);
      const identity = {
        sourceScope: card.sourceScope ?? card.source,
        sourceRecordId: card.sourceRecordId,
        ...(curated ? {} : {
          placePoolId: card.placePoolId ?? card.place_pool_id,
          googlePlaceId: card.placeId ?? card.googlePlaceId ?? card.google_place_id ?? card.id,
        }),
      };
      const prepared = await prepareContentShare(curated ? 'curated' : 'place', identity, 'mingla_chat');
      const result = await sendContentShareToRecipients({
        recipients: [{ key: `${isGroupChat ? 'group' : 'direct'}:${conversationId}`, targetKind: isGroupChat ? 'group' : 'direct',
          targetId: conversationId, personUserId: isGroupChat ? null : friend.id, displayName: friend.name,
          username: null, avatarUrl: null, conversationId, participantCount: null, recipientTier: 1,
          meaningfulActivityAt: new Date().toISOString(), conversationCreatedAt: null }],
        shortCode: prepared.shortCode, shareVersion: prepared.version, senderNote: '', title: prepared.title,
      });
      if (result.sent !== 1) {
        showNotification(
          t('chat:cardShareFailedTitle'),
          t('chat:cardShareFailedToast'),
          'error',
        );
        return;
      }
      await clearContentShareOperationId(prepared.shortCode, prepared.version);

      showNotification(
        t('chat:cardSentTitle'),
        t('chat:cardSentToast', { name: friend.name }),
      );
      setShowSavedCardPicker(false);
    } catch {
      showNotification(t('chat:cardShareFailedTitle'), t('chat:cardShareFailedToast'), 'error');
    } finally {
      pickerSubmittingRef.current = false;
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

  // Issue #4114 Wave 3: no toast before the confirm. Each owner runs its own
  // confirm (Alert / BlockUserModal / ReportUserModal) and settles with the real
  // outcome; Cancel and failures show nothing here (failures toast at the owner).
  const handleRemoveFriend = () => {
    setShowMoreOptionsMenu(false);
    onRemoveFriend?.(friend, (removed) => {
      if (!removed) return;
      showNotification(
        t('chat:friendRemoved'),
        t('chat:friendRemovedMessage', { name: friend.name })
      );
    });
  };

  const handleBlockUser = () => {
    setShowMoreOptionsMenu(false);
    onBlockUser?.(friend, (blocked) => {
      if (!blocked) return;
      showNotification(t('chat:userBlocked'), t('chat:userBlockedMessage', { name: friend.name }));
    });
  };

  const handleReportUser = () => {
    setShowMoreOptionsMenu(false);
    onReportUser?.(friend, (reported) => {
      if (!reported) return;
      showNotification(
        t('chat:userReported'),
        t('chat:userReportedMessage', { name: friend.name })
      );
    });
  };

  const handleToggleMute = async () => {
    if (!onToggleMute || isMuteBusy) return;
    const willMute = !isMuted;
    setIsMuteBusy(true);
    try {
      const saved = await onToggleMute();
      if (saved) {
        showNotification(
          willMute ? t('chat:mutedTitle') : t('chat:unmutedTitle'),
          willMute ? t('chat:mutedBody', { name: cleanName(friend.name) }) : t('chat:unmutedBody', { name: cleanName(friend.name) }),
        );
      }
    } finally {
      setIsMuteBusy(false);
    }
  };

  // Issue #4114 Wave 3: the one friend action list (shared with FriendActionsSheet).
  const friendMenuItems = useMemo(
    () =>
      buildFriendMenu({
        surface: "chat",
        isFriend: !isUnfriended && !isBlocked && !isDeletedAccount,
        pairState: isPairedFriend ? "paired" : "none",
        canOpenPairedView: Boolean(isPairedFriend && onOpenPairedProfile),
        canUnpair: false,
        canViewProfile: Boolean(onViewProfile) && !isDeletedAccount,
        hasConversation: Boolean(conversationId),
        isMuted,
      }).filter((item) => item.id !== "mute" || Boolean(onToggleMute)),
    [conversationId, isBlocked, isDeletedAccount, isMuted, isPairedFriend, isUnfriended, onOpenPairedProfile, onToggleMute, onViewProfile],
  );

  // Present-after-dismiss: iOS shows one RN Modal at a time, so a row that
  // opens another sheet or an alert waits for the menu to finish leaving.
  const afterMenuCloses = (run: () => void) => {
    setShowMoreOptionsMenu(false);
    setTimeout(run, MENU_PRESENT_AFTER_DISMISS_MS);
  };

  const handleFriendMenuSelect = (id: FriendMenuItemId) => {
    switch (id) {
      case "viewProfile":
        setShowMoreOptionsMenu(false);
        onViewProfile?.(friend.id);
        return;
      case "media":
        afterMenuCloses(() => setShowMediaSheet(true));
        return;
      case "shareCard":
        handleShareSavedCard();
        return;
      case "addToSession":
        afterMenuCloses(handleAddToBoard);
        return;
      case "mute":
        setShowMoreOptionsMenu(false);
        void handleToggleMute();
        return;
      case "pairedView":
        setShowMoreOptionsMenu(false);
        onOpenPairedProfile?.(friend.id);
        return;
      case "removeFriend":
        afterMenuCloses(handleRemoveFriend);
        return;
      case "report":
        afterMenuCloses(handleReportUser);
        return;
      case "block":
        afterMenuCloses(handleBlockUser);
        return;
      case "startCollab":
      case "sendPair":
      case "pairPending":
      case "unpair":
        // Not offered in the chat surface (Wave 5 / friends sheet only).
        setShowMoreOptionsMenu(false);
        return;
      default: {
        const never: never = id;
        return never;
      }
    }
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
      ? Math.max(0, keyboardHeight + safeInsets.bottom - windowShrinkAmount) +
        KEYBOARD_TOOLBAR_HEIGHT
      : 0;
  const iosKeyboardLift =
    Platform.OS === 'ios' && keyboardVisible
      ? keyboardHeight + KEYBOARD_TOOLBAR_HEIGHT
      : 0;

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
  // Issue #4114 Wave 3: the composer's MEASURED height (it grows to 5 lines,
  // plus the reply bar), not the fixed 56pt capsule.
  const messageListBottomClearance = showComposer
    ? finalInputBottom + composerHeight + 8
    : isBroadcastOnlyConsumerChannel
      ? broadcastComposerContentClearance
      : NOTICE_BANNER_LIST_GAP;
  // Issue #4114 Wave 3: the blocked / unfriended / deleted banners sit above
  // the floating bottom nav instead of behind it.
  const noticeBannerBottomGap = bottomNavTotalHeight + 12 + ANDROID_NAV_OVERLAP_FIX;
  const channelLabel = friend.linkedEntityType === "trip" ? "Trip broadcast channel" : "Event broadcast channel";
  const channelDetail = isBroadcastOnlyConsumerChannel
    ? `Only ${friend.eventBrandName?.trim() || "the organiser"} can post updates here`
    : `Updates from ${friend.eventBrandName?.trim() || "the organiser"} and attendees`;
  const channelLine = isBroadcastOnlyConsumerChannel
    ? `${friend.linkedEntityType === "trip" ? "Trip" : "Event"} broadcast · ${friend.eventBrandName?.trim() || "Organiser"} only`
    : `${friend.linkedEntityType === "trip" ? "Trip" : "Event"} channel · ${friend.eventBrandName?.trim() || "Organiser"} + attendees`;

  // Issue #4114 Wave 3: every chat's ⋯ opens something. Event and trip chats
  // open their audience; session groups their settings (BoardSettingsDropdown);
  // a group with no session (it used to be a dead tap) its group info; a 1:1
  // chat the one shared action menu.
  const handleHeaderMorePress = () => {
    if (isTripEventGroupChat) {
      setShowMoreOptionsMenu(false);
      setShowEventAudienceSheet(true);
      return;
    }
    if (isGroupChat && !friend.sessionId) {
      setShowMoreOptionsMenu(false);
      setShowGroupInfo(true);
      return;
    }

    setShowMoreOptionsMenu(!showMoreOptionsMenu);
  };

  const handleHeaderIdentityPress = () => {
    if (isGroupChat) {
      handleHeaderMorePress();
      return;
    }
    onViewProfile?.(friend.id);
  };

  const handleCollabStripPress = (view: "matches" | "plans") => {
    if (view === "matches") markMatchesSeen(matchedSessionCards.map(matchKey));
    handleOpenCollabDeckView(view);
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

  // ── Issue #4114 Wave 3: the thread ──────────────────────────
  // The new-messages divider sits above the oldest message that was unread
  // when the chat opened (captured once per chat, so it does not jump as the
  // chat is marked read).
  const [newDividerMessageId, setNewDividerMessageId] = useState<string | null>(null);
  const dividerCapturedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId || dividerCapturedForRef.current === conversationId || visibleMessages.length === 0) return;
    dividerCapturedForRef.current = conversationId;
    setNewDividerMessageId(firstUnreadMessageId(visibleMessages));
  }, [conversationId, visibleMessages]);

  // Rows are prepared once per change to the messages (not per keystroke), so
  // MessageBubble (memoised) gets the same props while you type.
  const threadRows = useMemo<ThreadRow[]>(() => {
    const now = new Date();
    return groupedMessages.map((item, index) => {
      const message = item.message;
      const senderName = getMessageSenderName(message);
      // Day separator — inverted list: rendered AFTER the message when the next
      // item (older) is on a different day, or this is the last item. Visually
      // this places the date header ABOVE that day's messages.
      const currDate = new Date(message.timestamp).toDateString();
      const nextItem = index < groupedMessages.length - 1 ? groupedMessages[index + 1] : null;
      const showDaySeparator = !nextItem || currDate !== new Date(nextItem.message.timestamp).toDateString();
      const kind = dayLabelKind(message.timestamp, now);
      const dayLabel = !showDaySeparator
        ? null
        : kind === 'today'
          ? t('chat:today')
          : kind === 'yesterday'
            ? t('chat:yesterday')
            : new Date(message.timestamp).toLocaleDateString(i18n.language, { weekday: 'long', month: 'short', day: 'numeric' });
      const reactions = aggregateReactions(message.reactions, currentUserId);
      const ref = message.replyToId ? messageMap.get(message.replyToId) : undefined;
      return {
        key: message.clientId ?? message.id,
        message,
        groupPosition: item.groupPosition,
        senderName,
        bubble: {
          id: message.id,
          senderName,
          content: message.content,
          timestamp: message.timestamp,
          type: message.type === 'system' ? 'text' : message.type,
          fileUrl: message.fileUrl,
          fileName: message.fileName,
          fileSize: message.fileSize,
          cardPayload: message.cardPayload,  // ORCH-0667
          mentions: message.mentions,
          cardTags: message.cardTags,
          marketingCampaignId: message.marketingCampaignId,
          isMe: message.isMe,
          failed: message.failed,
          isSystem: message.isSystem,
          systemPayload: message.systemPayload,
          // Issue #4114 Wave 4: the sender's own file while it is local, upload
          // progress, and the view-once state (never a preview).
          localUri: message.id.startsWith("temp-") ? message.localMedia?.uri : undefined,
          uploadProgress:
            message.id.startsWith("temp-") && !message.failed && message.clientId && uploadProgress
              ? uploadProgress[message.clientId]
              : undefined,
          viewOnce:
            message.viewOnce && (message.type === "image" || message.type === "video")
              ? viewOnceState({
                  isMe: message.isMe,
                  currentUserId,
                  views: message.mediaViews,
                  purged: message.viewOncePurged === true,
                  openedLocally: openedViewOnce[message.id] === true,
                })
              : undefined,
          isGroupChat,
        },
        showSenderName: shouldShowSenderName({
          isGroupChat,
          isMe: message.isMe,
          isSystem: message.isSystem,
          groupPosition: item.groupPosition,
        }),
        reactions,
        myReactions: reactions.filter((reaction) => reaction.mine).map((reaction) => reaction.emoji),
        replyTo: message.replyToId
          ? ref
            ? {
                senderName: getMessageSenderName(ref),
                content: ref.content,
                // Issue #4114 Wave 4: a stored path needs its signed link (cached);
                // a view-once original never shows a thumbnail.
                imageUrl: ref.type === 'image' && !ref.viewOnce ? peekChatMediaUrl(ref.fileUrl) ?? undefined : undefined,
                messageId: ref.id,
              }
            : { senderName: '', content: '', isDeleted: true, messageId: message.replyToId }
          : undefined,
        isRead: message.isMe && !message.id.startsWith("temp-") && (message.isRead === true),
        dayLabel,
        showNewDivider: message.id === newDividerMessageId,
      };
    });
    // getMessageSenderName reads only the fields listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    groupedMessages,
    messageMap,
    currentUserId,
    currentUserName,
    isGroupChat,
    isTripEventGroupChat,
    friend.eventBrandName,
    friend.eventBrandAccountId,
    friend.name,
    newDividerMessageId,
    i18n.language,
    t,
    uploadProgress,
    openedViewOnce,
  ]);
  const threadRowsRef = useRef(threadRows);
  threadRowsRef.current = threadRows;

  const closeContextMenu = useCallback(() => setContextMenu(CLOSED_CONTEXT_MENU), []);

  const startReply = useCallback((row: ThreadRow) => {
    setReplyingTo({
      messageId: row.message.id,
      senderName: row.senderName,
      content: row.message.content,
      isMe: row.message.isMe,
    });
  }, []);

  // Reactions: awaited, and a failure is never silent (ConnectionsPage rolls
  // the pill back and toasts; anything thrown here toasts too).
  const toggleReaction = useCallback(async (messageId: string, emoji: string): Promise<void> => {
    if (!onToggleReaction) return;
    try {
      await onToggleReaction(messageId, emoji);
    } catch (error) {
      console.error('[MessageInterface] reaction failed', error);
      showNotification(t('chat:reactionFailed'), '', 'error');
    }
  }, [onToggleReaction, showNotification, t]);

  // Double-tap adds a heart; it never takes one away.
  const handleDoubleTapHeart = useCallback((row: ThreadRow) => {
    if (row.myReactions.includes('❤️')) return;
    void toggleReaction(row.message.id, '❤️');
  }, [toggleReaction]);

  // Issue #4114 Wave 4: a tap opens the media (lightbox, player, document, or
  // the one look at a view-once item); any other bubble toggles its time.
  const mediaHandlersRef = useRef({ handleOpenImage, handleOpenVideo, handleViewDocument, handleOpenViewOnce });
  mediaHandlersRef.current = { handleOpenImage, handleOpenVideo, handleViewDocument, handleOpenViewOnce };
  const handleBubblePress = useCallback((row: ThreadRow) => {
    const message = row.message;
    const local = message.id.startsWith("temp-");
    if (!local && (message.type === "image" || message.type === "video") && message.viewOnce) {
      if (!message.isMe) void mediaHandlersRef.current.handleOpenViewOnce(message);
      return;
    }
    if (message.type === "image" && (message.fileUrl || message.localMedia)) {
      void mediaHandlersRef.current.handleOpenImage(local ? message.localMedia?.uri ?? message.fileUrl : message.fileUrl);
      return;
    }
    if (message.type === "video" && (message.fileUrl || message.localMedia)) {
      void mediaHandlersRef.current.handleOpenVideo(local ? message.localMedia?.uri ?? message.fileUrl : message.fileUrl);
      return;
    }
    if (message.type === "file" && message.fileUrl && !local) {
      void mediaHandlersRef.current.handleViewDocument(message.fileUrl);
      return;
    }
    setRevealedTimestampId((prev) => (prev === message.id ? null : message.id));
  }, []);

  const handleBubbleLongPress = useCallback((row: ThreadRow, pageY: number) => {
    // Issue #4114 Wave 4: view once has no long-press menu (no copy, forward or save).
    if (row.message.viewOnce) return;
    setContextMenu({
      visible: true,
      messageId: row.message.id,
      content: row.message.content,
      isMe: row.message.isMe,
      top: pageY,
      type: row.message.type,
      isSent: !row.message.id.startsWith('temp-') && !row.message.failed,
    });
  }, []);

  const handleCardTagTap = useCallback((cardTag: CardTagEntry) => {
    setExpandedCardFromChat(cardPayloadToExpandedCardData(cardTag.cardPayload));
    setShowExpandedCardFromChat(true);
  }, []);

  // Reply quotes jump to the original when it is loaded.
  const handleScrollToMessage = useCallback((messageId: string) => {
    const index = threadRowsRef.current.findIndex((row) => row.message.id === messageId);
    if (index < 0) {
      showNotification(t('chat:replyOriginalNotLoaded'), '', 'info');
      return;
    }
    flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
  }, [showNotification, t]);

  const handleScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
    flatListRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
    setTimeout(() => {
      if (info.index < threadRowsRef.current.length) {
        flatListRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 });
      }
    }, 250);
  }, []);

  // Scroll-to-latest: shown once you scroll away from the newest message;
  // counts incoming messages that land meanwhile.
  const newestVisible = visibleMessages.length > 0 ? visibleMessages[visibleMessages.length - 1] : null;
  const { showScrollToLatest, unseenWhileScrolled, handleThreadScroll, scrollToLatest } = useScrollToLatest({
    listRef: flatListRef,
    newestMessageId: newestVisible?.id ?? null,
    newestIsMine: newestVisible?.isMe ?? false,
    threshold: SCROLL_TO_LATEST_THRESHOLD,
  });

  // Typing in a group: names of everyone typing, above the composer.
  const groupTypingLabel = useMemo(() => {
    if (!isGroupChat || !currentUserId) return null;
    const names = typingUsers
      .filter((uid) => uid !== currentUserId)
      .map((uid) =>
        participantsQuery.data?.find((participant) => participant.userId === uid)?.displayName ||
        headerParticipants.find((participant) => participant.id === uid)?.name ||
        t('chat:someone'),
      )
      .map((name) => cleanName(name).split(' ')[0]);
    const label = typingLabel(names);
    return label ? t(label.key, label.params) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, headerParticipants, isGroupChat, participantsQuery.data, t, typingUsers]);

  const contextMenuMyReactions = useMemo(
    () => threadRows.find((row) => row.message.id === contextMenu.messageId)?.myReactions ?? EMPTY_EMOJIS,
    [contextMenu.messageId, threadRows],
  );

  const handleUnsendRequest = useCallback((messageId: string) => {
    if (!onUnsendMessage) return;
    setTimeout(() => {
      Alert.alert(t('chat:unsendTitle'), t('chat:unsendBody'), [
        { text: t('common:cancel'), style: 'cancel' },
        {
          text: t('chat:actionUnsend'),
          style: 'destructive',
          onPress: async () => {
            const done = await onUnsendMessage(messageId);
            if (done) showNotification(t('chat:unsentToast'), '', 'info');
          },
        },
      ]);
    }, MENU_PRESENT_AFTER_DISMISS_MS);
  }, [onUnsendMessage, showNotification, t]);

  const handleReportMessageRequest = useCallback((messageId: string) => {
    const row = threadRowsRef.current.find((candidate) => candidate.message.id === messageId);
    if (!row || !onReportMessage) return;
    setTimeout(() => {
      onReportMessage(
        { id: row.message.id, senderId: row.message.senderId, senderName: row.senderName, content: row.message.content },
        (reported) => {
          if (reported) showNotification(t('chat:messageReported'), '', 'success');
        },
      );
    }, MENU_PRESENT_AFTER_DISMISS_MS);
  }, [onReportMessage, showNotification, t]);

  // The list's renderItem — stable (it changes only when a timestamp is
  // revealed or a handler's real inputs change), so typing never re-renders it.
  const renderThreadRow = useCallback(({ item }: ListRenderItemInfo<ThreadRow>): React.ReactElement => {
    const daySeparator = item.dayLabel ? (
      <View style={styles.daySeparator}>
        <View style={styles.daySeparatorLine} />
        <Text style={styles.daySeparatorText}>{item.dayLabel}</Text>
        <View style={styles.daySeparatorLine} />
      </View>
    ) : null;
    // Inverted list: what renders after the message shows above it.
    const newDivider = item.showNewDivider ? (
      <View style={styles.newMessagesDivider} accessibilityRole="text" testID="chat-new-messages-divider">
        <View style={styles.newMessagesDividerLine} />
        <Text style={styles.newMessagesDividerText}>{t('chat:newMessagesDivider')}</Text>
        <View style={styles.newMessagesDividerLine} />
      </View>
    ) : null;

    if (item.message.isSystem) {
      return (
        <>
          <MessageBubble
            message={item.bubble}
            onSystemTokenPress={handleSystemTokenPress}
            isMe={item.message.isMe}
            groupPosition={item.groupPosition}
            showTimestamp={false}
            isRead={false}
          />
          {newDivider}
          {daySeparator}
        </>
      );
    }

    // (The two lines below keep their indentation: the ORCH-0945 gate slices
    // the system branch above up to this exact text.)
            return (
            <>
      <SwipeableMessage onReply={() => startReply(item)}>
        <DoubleTapHeart onDoubleTap={() => handleDoubleTapHeart(item)}>
          <TouchableOpacity
            activeOpacity={1}
            // Issue #4114: a failed bubble is tap-to-retry (whole bubble, so it
            // also works for screen readers, which focus this wrapper).
            accessibilityHint={item.message.failed && onRetryMessage ? t('chat:failedTapToRetry') : undefined}
            onPress={() => {
              if (item.message.failed && onRetryMessage) {
                onRetryMessage(item.message.id);
                return;
              }
              handleBubblePress(item);
            }}
            onLongPress={(e) => handleBubbleLongPress(item, e.nativeEvent.pageY)}
            delayLongPress={500}
          >
            <MessageBubble
              message={item.bubble}
              onCardBubbleTap={handleCardBubbleTap}
              onMentionTap={onViewProfile}
              onCardTagTap={handleCardTagTap}
              onSystemTokenPress={handleSystemTokenPress}
              isMe={item.message.isMe}
              groupPosition={item.groupPosition}
              onRetry={item.message.failed && onRetryMessage ? () => onRetryMessage(item.message.id) : undefined}
              showTimestamp={revealedTimestampId === item.message.id}
              isRead={item.isRead}
              replyTo={item.replyTo}
              onScrollToMessage={handleScrollToMessage}
              showSenderName={item.showSenderName}
              reactions={item.reactions}
              onReactionPress={onToggleReaction ? toggleReaction : undefined}
              onCancelUpload={
                item.bubble.uploadProgress !== undefined && onCancelUpload
                  ? () => onCancelUpload(item.message.id)
                  : undefined
              }
            />
          </TouchableOpacity>
        </DoubleTapHeart>
      </SwipeableMessage>
      {newDivider}
      {daySeparator}
      </>
    );
  }, [
    handleBubbleLongPress,
    handleBubblePress,
    handleCardBubbleTap,
    handleCardTagTap,
    handleDoubleTapHeart,
    handleScrollToMessage,
    handleSystemTokenPress,
    onCancelUpload,
    onRetryMessage,
    onToggleReaction,
    onViewProfile,
    revealedTimestampId,
    startReply,
    t,
    toggleReaction,
  ]);

  // ── Issue #4114 Wave 3: Android back ─────────────────────────
  // Closes the top-most open layer first (sheets, menus, previews), then the
  // thread (hooks/useChatBackHandler).
  useChatBackHandler(
    {
      contextMenu: contextMenu.visible,
      attachmentMenu: showAttachmentMenu,
      imagePreview: !!lightboxUrl || !!videoUrl || !!viewOncePhotoUrl || !!viewOnceVideoUrl,
      expandedCard: showExpandedCardFromChat,
      eventDetail: showGroupEventSheet,
      savedCardPicker: showSavedCardPicker,
      mediaSheet: showMediaSheet,
      groupInfo: showGroupInfo,
      moreMenu: showMoreOptionsMenu,
      eventAudience: showEventAudienceSheet,
      collabDeck: showCollabDeckSheet,
      collabMatches: showCollabMatchesSheet,
      collabPlans: showCollabPlansSheet,
      collabPrefs: collabPrefsLink.visible,
    },
    {
      contextMenu: closeContextMenu,
      attachmentMenu: () => setShowAttachmentMenu(false),
      imagePreview: closeMediaViewers,
      expandedCard: () => {
        setShowExpandedCardFromChat(false);
        setExpandedCardFromChat(null);
      },
      eventDetail: () => setShowGroupEventSheet(false),
      savedCardPicker: () => setShowSavedCardPicker(false),
      mediaSheet: () => setShowMediaSheet(false),
      groupInfo: () => setShowGroupInfo(false),
      moreMenu: () => setShowMoreOptionsMenu(false),
      eventAudience: () => setShowEventAudienceSheet(false),
      collabDeck: () => setShowCollabDeckSheet(false),
      collabMatches: () => setShowCollabMatchesSheet(false),
      collabPlans: () => setShowCollabPlansSheet(false),
      collabPrefs: () => setCollabPrefsLink({ visible: false }),
    },
    onBack,
  );

  const handleOpenAudienceProfile = (participantId: string) => {
    setShowEventAudienceSheet(false);
    onViewProfile?.(participantId);
  };

  return (
    <View style={styles.container}>
      {/* Issue #4114 Wave 3 (D9): one header for every chat. 62pt with nothing
          in the strip, 108pt with matches or plans (chatHeaderModel). */}
      <ChatHeader
        topInset={safeInsets.top}
        title={headerTitle}
        subtitle={
          isGroupChat ? headerSubtitle : (
            <ChatStatusLine
              isOnline={isOtherOnline}
              isTyping={isOtherTyping}
              lastSeenAt={otherLastSeen}
            />
          )
        }
        onBack={onBack}
        backLabel={t('chat:a11yBack')}
        avatarKind={headerAvatarKind}
        avatarUrl={isGroupChat ? friend.eventCoverMediaUrl ?? null : friend.avatar ?? null}
        participants={headerParticipants}
        participantCount={headerParticipantCount}
        isOnline={!isGroupChat && isOtherOnline}
        collaborating={isCollabSessionGroupChat}
        onIdentityPress={handleHeaderIdentityPress}
        identityA11yLabel={
          isGroupChat
            ? t('chat:a11yOpenChatInfo', { name: headerTitle })
            : t('chat:a11yViewProfile', { name: headerTitle })
        }
        primaryAction={
          isCollabSessionGroupChat
            ? {
                label: t('chat:swipe'),
                a11yLabel: t('chat:a11ySwipeTogether', { name: headerTitle }),
                onPress: () => handleOpenCollabDeckView("swipe"),
              }
            : null
        }
        onMorePress={isCollabSessionGroupChat ? undefined : handleHeaderMorePress}
        moreA11yLabel={
          isTripEventGroupChat
            ? t('chat:a11yViewAudience', { audience: eventAudienceTitle })
            : t('chat:a11yChatOptions')
        }
        strip={collabHeaderStrip}
        stripLabels={collabHeaderStripLabels}
        onStripPress={handleCollabStripPress}
        locale={i18n.language}
      />

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

      {/* Offline Banner — Issue #4114 Wave 3: dark, and under the header so
          the floating composer and bottom nav never cover it. */}
      {isOffline && !isBlocked && (
        <View style={styles.offlineBanner} accessibilityRole="alert">
          <Icon name="cloud-offline-outline" size={16} color={chatTokens.warning} />
          <Text style={styles.offlineBannerText}>
            {t('chat:offlineShowingSaved')}
          </Text>
        </View>
      )}

      {/* Messages */}
      {visibleMessages.length === 0 ? (
        <View style={[styles.messagesContainer, { justifyContent: "center" }]}>
          {isLoadingMessages ? (
            // Issue #4114 Wave 3: a loader until the first read lands, so
            // "Start a conversation" never flashes before the messages.
            <View
              style={styles.emptyState}
              accessibilityRole="progressbar"
              accessibilityLabel={t('chat:loadingMessages')}
              testID="chat-thread-loading"
            >
              <ActivityIndicator size="small" color={chatTokens.textSoft} />
            </View>
          ) : (
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
          )}
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          // Issue #4114 Wave 3: rows are prepared once per message change and
          // renderItem is stable, so a keystroke does not re-render every row.
          data={threadRows}
          renderItem={renderThreadRow}
          // Issue #4114: key by client id when present so the bubble keeps its
          // identity (no remount flash) when the optimistic copy is confirmed.
          keyExtractor={threadRowKey}
          inverted={true}
          // Issue #4114 Wave 3: reading older messages stays put while new ones
          // arrive; near the latest message the list follows the new one.
          maintainVisibleContentPosition={THREAD_VISIBLE_CONTENT_POSITION}
          onScroll={handleThreadScroll}
          scrollEventThrottle={64}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          ListHeaderComponent={
            groupTypingLabel ? (
              <View style={styles.groupTyping}>
                <TypingIndicator isVisible label={groupTypingLabel} />
              </View>
            ) : null
          }
          // Issue #4114: inverted list — the "end" is the visual top (oldest).
          // New pages append to the end of `data`, so the visible messages do
          // not move while older history loads.
          onEndReached={hasOlderMessages && !isLoadingOlderMessages ? onLoadOlderMessages : undefined}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            isLoadingOlderMessages ? (
              <View
                style={styles.olderMessagesSpinner}
                accessibilityRole="progressbar"
                accessibilityLabel={t('chat:loadingOlderMessages')}
              >
                <ActivityIndicator size="small" color={colors.gray400} />
              </View>
            ) : null
          }
          style={styles.messagesContainer}
          contentContainerStyle={[
            styles.messagesContentContainer,
            {
              // ORCH-0620: inverted FlatList — paddingTop (pre-transform) becomes
              // the VISUAL BOTTOM clearance after the scaleY:-1 flip. Clears the
              // composer (which sits at `finalInputBottom` above the window's
              // bottom edge) + its measured height (Issue #4114 Wave 3: it grows)
              // + 8pt breathing.
              paddingTop: messageListBottomClearance,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Issue #4114 Wave 3: back to the latest message, with a count of the
          messages that arrived while you were reading higher up. */}
      {showScrollToLatest && visibleMessages.length > 0 ? (
        <TouchableOpacity
          style={[styles.scrollToLatest, { bottom: messageListBottomClearance + 4 }]}
          onPress={scrollToLatest}
          accessibilityRole="button"
          accessibilityLabel={
            unseenWhileScrolled > 0
              ? t('chat:a11yScrollToLatestNew', { count: unseenWhileScrolled })
              : t('chat:a11yScrollToLatest')
          }
          testID="chat-scroll-to-latest"
        >
          <Icon name="chevron-down" size={20} color={chatTokens.textPrimary} />
          {unseenWhileScrolled > 0 ? (
            <View style={styles.scrollToLatestBadge}>
              <Text style={styles.scrollToLatestBadgeText}>
                {unseenWhileScrolled > 99 ? "99+" : unseenWhileScrolled}
              </Text>
            </View>
          ) : null}
        </TouchableOpacity>
      ) : null}

      {/* Message Context Menu — Issue #4114 Wave 3: reactions, unsend and
          report are wired; Copy only on text. */}
      <MessageContextMenu
        visible={contextMenu.visible}
        position={{ top: contextMenu.top }}
        messageId={contextMenu.messageId}
        messageContent={contextMenu.content}
        isOwnMessage={contextMenu.isMe}
        messageType={contextMenu.type}
        isSent={contextMenu.isSent}
        existingReactions={contextMenuMyReactions}
        onReaction={(msgId, emoji) => {
          void toggleReaction(msgId, emoji);
        }}
        onReply={(msgId) => {
          const row = threadRows.find((candidate) => candidate.message.id === msgId);
          if (row) startReply(row);
        }}
        onCopy={() => {
          showNotification(t('chat:copied'), "", "info");
        }}
        onDelete={onUnsendMessage ? handleUnsendRequest : undefined}
        onReport={onReportMessage ? handleReportMessageRequest : undefined}
        onClose={closeContextMenu}
      />

      {/* Issue #4114 Wave 4: media viewers. Photos open in the shared
          ImageLightbox, videos in the expo-video player, and a view-once item
          in its one-time viewer (no save, no share). */}
      <ImageLightbox
        images={lightboxUrl ? [lightboxUrl] : []}
        initialIndex={0}
        visible={!!lightboxUrl}
        onClose={() => setLightboxUrl(null)}
      />
      <ChatVideoPlayerModal url={videoUrl} onClose={() => setVideoUrl(null)} />
      <ChatVideoPlayerModal url={viewOnceVideoUrl} onClose={() => setViewOnceVideoUrl(null)} viewOnce />
      <ViewOncePhotoViewer url={viewOncePhotoUrl} onClose={() => setViewOncePhotoUrl(null)} />

      {/* Issue #4114 Wave 3: the no-composer banners are dark and sit above the
          floating bottom nav (they used to render behind it). */}
      {/* Blocked User Banner */}
      {isBlocked && (
        <View style={[styles.blockedBanner, { marginBottom: noticeBannerBottomGap }]} accessibilityRole="text">
          <Icon name="ban" size={18} color={chatTokens.danger} />
          <Text style={styles.blockedBannerText}>
            {t('chat:messagingNotAvailable')}
          </Text>
        </View>
      )}

      {/* Unfriended Banner */}
      {isUnfriended && !isBlocked && (
        <View style={[styles.blockedBanner, { marginBottom: noticeBannerBottomGap }]} accessibilityRole="text">
          <Icon name="person-remove" size={18} color={chatTokens.danger} />
          <Text style={styles.blockedBannerText}>
            {t('chat:noLongerConnected')}
          </Text>
        </View>
      )}

      {/* Deleted Account Banner — a neutral notice whose icon is readable on
          the dark surface (it was white-on-pale-red, i.e. invisible). */}
      {isDeletedAccount && !isBlocked && !isUnfriended && (
        <View style={[styles.blockedBanner, styles.neutralBanner, { marginBottom: noticeBannerBottomGap }]} accessibilityRole="text">
          <Icon name="alert-circle" size={18} color={chatTokens.textSecondary} />
          <Text style={[styles.blockedBannerText, styles.neutralBannerText]}>
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
      {/* Issue #4114 Wave 3: a tap anywhere outside closes the attach menu. */}
      {showComposer && showAttachmentMenu ? (
        <TouchableOpacity
          style={styles.attachmentBackdrop}
          activeOpacity={1}
          onPress={() => setShowAttachmentMenu(false)}
          accessibilityRole="button"
          accessibilityLabel={t('chat:a11yCloseAttachMenu')}
        />
      ) : null}
      {showComposer && (
      <View
        style={[
          styles.inputCapsuleWrap,
          { bottom: finalInputBottom },
        ]}
        // Issue #4114 Wave 3: the composer grows, so the thread's bottom
        // padding follows its measured height.
        onLayout={onComposerLayout}
      >
        {/* Issue #4114 Wave 4: the attach sheet, above the capsule (inside
            it, the capsule's overflow clip hid the old menu entirely). */}
        {showAttachmentMenu && (
          <ChatAttachSheet
            items={pendingMedia}
            viewOnce={attachViewOnce}
            onToggleViewOnce={setAttachViewOnce}
            recipientName={isGroupChat ? null : cleanName(friend.name || friend.username || "")}
            picking={isPickingMedia}
            onCamera={() => void handlePickCamera()}
            onLibrary={() => void handlePickLibrary()}
            onFile={() => void handlePickFile()}
            onRemoveItem={(index) => setPendingMedia((prev) => prev.filter((_, i) => i !== index))}
            onSend={handleSendPickedMedia}
          />
        )}
        {/* Reply Preview Bar — Issue #4114 Wave 3: dark */}
        {replyingTo && (
          <View style={styles.replyPreviewWrap}>
            <ReplyPreviewBar
              senderName={replyingTo.senderName}
              previewText={replyingTo.content}
              isOwnMessage={replyingTo.isMe}
              onClose={() => setReplyingTo(null)}
              theme="dark"
              closeLabel={t('chat:a11yCancelReply')}
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
              accessibilityRole="button"
              accessibilityLabel={t('chat:a11yAttach')}
              accessibilityState={{ expanded: showAttachmentMenu }}
            >
              <Icon name="attach" size={20} color="rgba(255, 255, 255, 0.85)" />
            </TouchableOpacity>

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
              accessibilityLabel={t('chat:a11yMessageInput')}
              placeholder={
                pendingMedia.length > 0 ? t('chat:addCaption') : t('chat:typeMessage')
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
            disabled={!newMessage.trim()}
            style={[
              styles.sendButton,
              !newMessage.trim() && styles.sendButtonDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('chat:a11ySend')}
            accessibilityState={{ disabled: !newMessage.trim() }}
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
      {resolvingNativeCardId && nativeCard ? <View accessibilityRole="progressbar" accessibilityLabel={`Opening shared ${nativeCard.kind === 'curated' ? 'plan' : 'place'}`}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,.28)', zIndex: 50 }}>
        <ActivityIndicator size="large" color="#fff" />
      </View> : null}
      {showSavedCardPicker && (
        <SavedCardPicker
          friendName={friend.name}
          isLoading={savedCardsQuery.isLoading}
          cards={savedCardsQuery.data}
          submittingCardId={pickerSubmittingCardId}
          onSelect={handleSelectCardToShare}
          onClose={() => setShowSavedCardPicker(false)}
        />
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
          onShare={(card) => openExpandedCardContentShare(card, 'chat_expanded')}
          shareProducerSurface="chat_expanded"
          isSaved={sharedCardIsSaved}    // ORCH-0685: button transitions to "Saved"
          currentMode="solo"
          // #1669: this mount dropped the viewer's units/currency, so a card
          // opened from a chat thread rendered in miles and °F for a Metric
          // user while the same card rendered in km and °C from the deck.
          accountPreferences={accountPreferences}
        />
      )}

      {/* ORCH-1138 Leg 3 — chat purchased-banner repointed off EBES. The chat
          broadcast channel's linkedEntityType is "trip" or "event" (experiences
          are not a broadcast linked-entity today). Trip → Leg-1
          ConsumerTripDetailScreen (self-fetches by brand+trip slug; seed=null);
          event → Leg-2 ConsumerEventDetailScreen (BusinessEventCard seed). Both
          mount their own BaseBottomSheet → no EBES. I-PROPOSED-1138-EBES-DELETED. */}
      {showGroupEventSheet && friend.eventPublicCard ? (
        friend.linkedEntityType === "trip" ? (
          <ConsumerTripDetailScreen
            brandSlug={friend.eventPublicCard.brandSlug}
            tripSlug={friend.eventPublicCard.eventSlug}
            seed={null}
            onBack={() => setShowGroupEventSheet(false)}
            tabBarAware={false}
          />
        ) : (
          <ConsumerEventDetailScreen
            seed={friend.eventPublicCard}
            onBack={() => setShowGroupEventSheet(false)}
            tabBarAware={false}
          />
        )
      ) : null}

      {/* Event-audience picker — ORCH trip/event broadcast roster.
          META-ORCH-0991 Wave C: was a dark flex-end RN <Modal> (scrim + card +
          hand-rolled drag handle) → dark BaseBottomSheet, fixed ['70%'] snap,
          wrapInRNModal (mounted in chat over the chat input). Header (icon +
          title + subtitle) + scroll body (.map participant rows). Non-destructive
          roster picker → full swipe-down sheet (operator rule §1). */}
      <BaseBottomSheet
        visible={Boolean(isTripEventGroupChat && showEventAudienceSheet)}
        onClose={() => setShowEventAudienceSheet(false)}
        snapPoints={EVENT_AUDIENCE_SNAP as unknown as string[]}
        wrapInRNModal
        theme="dark"
        scrollMode="scroll"
        backgroundStyle={styles.eventAudienceSheetBackground}
        accessibilityLabel={eventAudienceTitle}
        header={
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
        }
        scrollProps={{ contentContainerStyle: styles.eventAudienceListContent }}
      >
        <View style={styles.eventAudienceListInner}>
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
        </View>
      </BaseBottomSheet>

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
            accountPreferences={accountPreferences}
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

      {/* More options bottom sheet — ORCH-0435. META-ORCH-0991 Wave B Batch 5:
          BaseBottomSheet, fixed ['45%'] snap, wrapInRNModal. Issue #4114 Wave 3:
          dark, and the SAME ordered list as FriendActionsSheet
          (utils/chatMenuModel). Destructive rows route to their own confirms
          downstream, and their toasts wait for the real outcome. */}
      <BaseBottomSheet
        visible={!isGroupChat && showMoreOptionsMenu}
        onClose={() => setShowMoreOptionsMenu(false)}
        snapPoints={CHAT_MORE_OPTIONS_SNAP as unknown as string[]}
        wrapInRNModal
        theme="dark"
        scrollMode="scroll"
        accessibilityLabel={cleanName(friend.name)}
        header={<Text style={styles.chatSheetTitle}>{cleanName(friend.name)}</Text>}
      >
        <View style={styles.chatSheetBody}>
          <ChatActionList
            items={friendMenuItems}
            name={cleanName(friend.name)}
            busyIds={isMuteBusy ? MUTE_BUSY_IDS : undefined}
            labels={{ pairedView: t('connections:chat_menu_paired_view') }}
            onSelect={handleFriendMenuSelect}
          />
        </View>
      </BaseBottomSheet>

      <GroupInfoSheet
        visible={Boolean(isGroupChat && !friend.sessionId && !isTripEventGroupChat && showGroupInfo)}
        onClose={() => setShowGroupInfo(false)}
        conversationId={conversationId}
        currentUserId={currentUserId}
        name={headerTitle}
        members={headerParticipants}
        initiallyMuted={friend.notificationsMuted ?? false}
        onOpenProfile={onViewProfile}
        onOpenMedia={() => setShowMediaSheet(true)}
        onLeft={() => onGroupConversationLeft?.()}
        onError={(message) => showNotification(message, "", "error")}
      />

      <ChatMediaSheet
        visible={showMediaSheet}
        onClose={() => setShowMediaSheet(false)}
        conversationId={conversationId}
        onOpenImage={(fileUrl) => {
          setShowMediaSheet(false);
          void handleOpenImage(fileUrl);
        }}
        onOpenVideo={(fileUrl) => {
          setShowMediaSheet(false);
          void handleOpenVideo(fileUrl);
        }}
        onOpenCard={(payload, messageId) => {
          void handleCardBubbleTap(payload, messageId);
        }}
      />

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
  // ── Issue #4114 Wave 3: dark banners, thread chrome and the growing composer ──
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: chatTokens.warningSoft,
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 6,
  },
  offlineBannerText: {
    fontSize: 13,
    color: chatTokens.warning,
    fontWeight: "500",
  },
  blockedBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 16,
    borderRadius: 16,
    backgroundColor: chatTokens.dangerSoft,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 8,
  },
  blockedBannerText: {
    flexShrink: 1,
    fontSize: 14,
    color: chatTokens.danger,
    fontWeight: "500",
  },
  neutralBanner: {
    backgroundColor: chatTokens.surfaceRaised,
  },
  neutralBannerText: {
    color: chatTokens.textSecondary,
  },
  groupTyping: {
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 6,
  },
  scrollToLatest: {
    position: "absolute",
    right: 16,
    zIndex: 58,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: chatTokens.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chatTokens.chromeHairline,
  },
  scrollToLatestBadge: {
    position: "absolute",
    top: -6,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: chatTokens.accent,
  },
  scrollToLatestBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  newMessagesDivider: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  newMessagesDividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: chatTokens.accent,
  },
  newMessagesDividerText: {
    fontSize: 12,
    fontWeight: "700",
    color: chatTokens.accent,
  },
  daySeparator: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  daySeparatorLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: chatTokens.chromeHairline,
  },
  daySeparatorText: {
    fontSize: 12,
    fontWeight: "600",
    color: chatTokens.textMuted,
  },
  attachmentBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 59,
  },
  // The capsule grows with the text (minHeight, not a fixed height) up to
  // COMPOSER_MAX_LINES; the controls stay pinned to its bottom edge.
  inputCapsule: {
    minHeight: COMPOSER_MIN_HEIGHT,
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
    minHeight: COMPOSER_MIN_HEIGHT,
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  messageInputContainer: {
    flex: 1,
    alignSelf: "stretch",
    backgroundColor: "transparent",
    paddingHorizontal: 8,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: "center",
  },
  messageInput: {
    fontSize: 16,
    lineHeight: COMPOSER_LINE_HEIGHT,
    color: "#FFFFFF",
    padding: 0,
    margin: 0,
    includeFontPadding: false,
    textAlignVertical: "top",
    maxHeight: COMPOSER_INPUT_MAX_HEIGHT,
  },
  container: {
    flex: 1,
    backgroundColor: "rgba(12, 14, 18, 1)", // ORCH-0600: dark canvas for glass design
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
  capsuleSeparator: {
    width: StyleSheet.hairlineWidth,
    height: 24,
    backgroundColor: glass.chrome.border.hairline,
    marginHorizontal: 4,
    marginBottom: 10,
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
  // ORCH-0667: shared-card picker styles
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
  // Issue #4114: small spinner at the top while older history loads.
  olderMessagesSpinner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  // ORCH-0435: Header more button + bottom sheet
  // BaseBottomSheet bespoke dark canvas (was eventAudienceSheet). Scrim + flex-end
  // card + hand-rolled handle are now owned by the primitive.
  eventAudienceSheetBackground: {
    backgroundColor: "#111418",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
  },
  eventAudienceListInner: {
    paddingHorizontal: 20,
  },
  eventAudienceSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 4,
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
  eventAudienceListContent: {
    paddingTop: 10,
    paddingBottom: 24,
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
  chatSheetBody: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  chatSheetTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: chatTokens.textPrimary,
    textAlign: "center",
    paddingTop: 4,
    marginBottom: 16,
  },
});
