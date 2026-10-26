import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from "react";
import { useCoachMark } from "../hooks/useCoachMark";
import {
  Text,
  View,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  FlatList,
  TextInput,
  Keyboard,
  BackHandler,
  Platform,
  RefreshControl,
  InteractionManager,
  AccessibilityInfo,
} from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Icon } from "./ui/Icon";
import { useFriends, Friend as UseFriend } from "../hooks/useFriends";
import { useAppStore } from "../store/appStore";
import { messagingService, DirectMessage, MentionEntry, CardTagEntry, MESSAGE_PAGE_SIZE } from "../services/messagingService";
import {
  mergeMessages,
  isLocalMessage,
  createClientMessageId,
  oldestConfirmedTimestamp,
  LOCAL_MESSAGE_ID_PREFIX,
  type MergeMessagesOptions,
} from "../utils/mergeMessages";
import { releaseConversationSubscription, switchConversationSubscription } from "../utils/conversationSubscription";
import { invalidateContentShareRecipients } from "../services/contentShareDeliveryService";
import type { CollabDeadEndBannerPayload } from "../services/collabDeadEndBannerService";
import { blockService, BlockReason } from "../services/blockService";
import { muteService } from "../services/muteService";
import { reportService, ReportReason } from "../services/reportService";
import { supabase } from "../services/supabase";
import { mixpanelService } from "../services/mixpanelService";
import { HapticFeedback } from "../utils/hapticFeedback";
// issue #2469 — the ONE owner of the venueName/address split, shared with the
// cold /e/ seed mapper and the buyer-web read path.
import { extractPublicEventLocation } from "@mingla/offering-rendering";
import { Conversation, Message as ConvMessage } from "../hooks/useMessages";
import { Friend, Message } from "../services/connectionsService";
import { useScreenLogger } from "../hooks/useScreenLogger";
import { useKeyboard } from "../hooks/useKeyboard";
import { useAppLayout } from "../hooks/useAppLayout";
import { colors, spacing, typography, fontWeights, glass, ANDROID_GLASS_USES_OPAQUE_FALLBACK } from "../constants/designSystem";
import { useA11yPreferences } from "../hooks/useA11yPreferences";
import { useQueryClient } from "@tanstack/react-query";
import { useNetworkMonitor } from "../services/networkMonitor";
import { withTimeout } from "../utils/withTimeout";
import { useToast } from "./ToastManager";
import { showMutationError } from "../utils/showMutationError";
import { getDisplayName } from "../utils/getDisplayName";
import { useTranslation } from 'react-i18next';
import type { BusinessEventCard } from "../types/mergedDiscover";

// META-ORCH-0991 Wave C: the 4-tab friends modal converted from a hand-rolled
// RN <Modal> + useKeyboard sheet-height math to the shared BaseBottomSheet
// (swipe-down, scroll body, stock gorhom motion). gorhom owns keyboard
// coordination once AddFriendView's field is a BottomSheetTextInput, so the
// useKeyboard sheetHeight/marginBottom math is no longer applied to this sheet.
import { BaseBottomSheet } from "./ui/BaseBottomSheet";

// Sub-components
import { ChatListItem, type ChatListItemConversation } from "./connections/ChatListItem";
import { NewMessageSheet } from "./connections/NewMessageSheet";
import { ChatRowActionsSheet, type ChatRowAction } from "./connections/ChatRowActionsSheet";
import { ChatListSkeleton } from "./connections/ChatListSkeleton";
import { ChatAvatar } from "./connections/ChatAvatar";
import {
  CHAT_ARCHIVED_ROW_HEIGHT,
  CHAT_FILTERS,
  CHAT_FILTER_CHIP_HEIGHT,
  CHAT_FILTER_ROW_HEIGHT,
  CHAT_HEADER_BUTTON_SIZE,
  CHAT_ROW_GAP,
  CHAT_ROW_HEIGHT,
  CHAT_ROW_SIDE_PADDING,
  CHAT_SEARCH_HEIGHT,
  CHAT_SEARCH_TOP_GAP,
  CHAT_SECTION_LABEL_HEIGHT,
  MAX_PINNED_CHATS,
  buildBrowseItems,
  buildSearchItems,
  canPinChat,
  chatListLayouts,
  friendUserIdOf,
  sortChatList,
  type ChatFilter,
  type ChatListItemModel,
} from "./connections/chatListModel";
// Issue #4114 Wave 2b: the one Add a friend flow (add = pair) is its own dark
// sheet; its AddFriendView body reads the hoisted phone/country below.
import { AddFriendSheet } from "./connections/AddFriendSheet";
import {
  activePairs,
  buildReceivedRows,
  buildSentRows,
  pairTileState,
  runCombinedAccept,
  type ReceivedRow,
  type SentRow,
} from "./connections/friendsSheetModel";
// ORCH-1371 [add-friend-country-picker-hidden]: the add-friend country picker is
// hoisted here (owner of the transient phone/country/flag state) and rendered as
// a sibling of the friends sheet — iOS presents only one RN <Modal> at a time.
import { CountryPickerModal } from "./onboarding/CountryPickerModal";
import type { CountryData } from "../types/onboarding";
import { getDefaultCountryCode, getCountryByCode } from "../constants/countries";
import { RequestsView } from "./connections/RequestsView";
import { FriendsManagementList } from "./connections/FriendsManagementList";
import { BlockedUsersView } from "./connections/BlockedUsersView";
import {
  CreateGroupChatSheet,
  type CreateGroupChatFriend,
} from "./connections/CreateGroupChatSheet";
import {
  PendingSessionInviteRow,
  type PendingSessionInvite,
} from "./connections/PendingSessionInviteRow";
import {
  PendingCollabChatSheet,
  type PendingCollabChatDetails,
  type PendingCollabChatPerson,
} from "./connections/PendingCollabChatSheet";
import { isPendingCollabReadyChange } from "./connections/pendingCollabChatUtils";
import MessageInterface from "./MessageInterface";
import { CustomPaywallScreen } from "./CustomPaywallScreen";
import { useSessionCreationGate } from "../hooks/useSessionCreationGate";
import type { GatedFeature } from "../hooks/useFeatureGate";
import AddToBoardModal from "./AddToBoardModal";
import FriendActionsSheet from "./friends/FriendActionsSheet";
import ReportUserModal from "./ReportUserModal";
import BlockUserModal from "./BlockUserModal";
import { emitAddToBoardToasts } from "../utils/addToBoardToasts";

// Pairing — ORCH-0435 Phase A
import PairRequestModal from "./PairRequestModal";
import IncomingPairRequestCard from "./IncomingPairRequestCard";
import { usePairingPills, useIncomingPairRequests, useIncomingHiddenPairRequests, useSendPairRequest, useCancelPairRequest, useCancelPairInvite, useAcceptPairRequest, useDeclinePairRequest, useUnpair } from "../hooks/usePairings";
import { usePendingPhoneInvites, phoneInviteKeys } from "../hooks/usePhoneInvite";
import { cancelPendingInvite } from "../services/phoneLookupService";
import { useEffectiveTier } from "../hooks/useSubscription";
import { getTierLimits } from "../constants/tierLimits";
import { logAppsFlyerEvent } from "../services/appsFlyerService";
import type { PairRequest } from "../services/pairingService";

type PanelId = "add" | "friends" | "blocked" | null; // [TRANSITIONAL] kept for initialPanel prop compat
// Issue #4114 Wave 2b: two segmented tabs. Sent folded into Requests; Blocked is
// a row at the bottom of Friends that opens the blocked view inside the tab.
type FriendsModalTab = "friend-list" | "requests";

const BUSINESS_BUYER_DOMAIN = "https://business.mingla.app";
// Was a flex-end sheet sized at screenHeight*0.88 → fixed ['88%'] snap (playbook §2).
const FRIENDS_MODAL_SNAP = ["88%"] as const;

type GroupEventMeta = {
  id: string;
  title: string | null;
  slug: string | null;
  brandId: string | null;
  brandName: string | null;
  brandSlug: string | null;
  brandAccountId: string | null;
  coverMediaUrl: string | null;
  publicCard: BusinessEventCard | null;
};

function getThemeObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function extractCoverHue(theme: unknown): number {
  const raw = getThemeObject(theme).coverHue;
  const hue = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(hue) && hue >= 0 && hue < 360 ? hue : 25;
}

function extractBusinessEventFormat(theme: unknown, isOnline: boolean): BusinessEventCard['format'] {
  const raw = getThemeObject(getThemeObject(theme).business_event).format;
  if (raw === 'online') return 'online';
  if (raw === 'hybrid') return 'hybrid';
  return isOnline ? 'online' : 'in-person';
}

// issue #2469 — `extractVenueName` DELETED. It read only
// `business_event.venueName` and fell back to the COMBINED `location_text`,
// while the caller separately assigned that same combined string to `address` —
// so the explorer printed the venue name twice and sent the doubled string to
// Maps. `extractPublicEventLocation` reads BOTH parsed halves from
// `business_event.location`, the same source the business/web path uses, and
// guarantees the combined string never lands in both slots.

function extractHideAddressUntilTicket(theme: unknown): boolean {
  return getThemeObject(getThemeObject(theme).business_event).hideAddressUntilTicket === true;
}

function parseLocationGeo(value: unknown): { lat: number; lng: number } | null {
  const geo = getThemeObject(value);
  const lat = Number(geo.lat);
  const lng = Number(geo.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

async function fetchGroupEventMetaByIds(eventIds: string[]): Promise<Map<string, GroupEventMeta>> {
  if (eventIds.length === 0) return new Map();

  const { data: events, error: eventsError } = await supabase
    .from('business_public_events_view')
    .select(`
      id, brand_id, brand_slug, brand_name, brand_profile_photo_url,
      title, description, slug, cover_media_url, cover_media_type,
      master_start_at, master_end_at, master_timezone, timezone,
      location_text, is_online, city, location_geo, public_theme, currency,
      party_types, vibe_tags, music_genres
    `)
    .in('id', eventIds);

  if (eventsError) throw eventsError;

  const brandIds = Array.from(new Set((events || []).map((event: any) => event.brand_id).filter(Boolean)));
  const { data: brands, error: brandsError } = brandIds.length > 0
    ? await supabase
        .from('brands')
        .select('id, name, slug, account_id')
        .in('id', brandIds)
    : { data: [] as any[], error: null };

  if (brandsError) throw brandsError;

  const brandsById = new Map((brands || []).map((brand: any) => [brand.id, brand]));
  return new Map(
    (events || []).map((event: any) => {
      const brand = event.brand_id ? brandsById.get(event.brand_id) : null;
      // issue #2469 — resolved ONCE; the two halves must come from the same read.
      const location = extractPublicEventLocation(
        event.public_theme,
        event.location_text ?? null,
      );
      return [
        event.id,
        {
          id: event.id,
          title: event.title ?? null,
          slug: event.slug ?? null,
          brandId: event.brand_id ?? null,
          brandName: brand?.name ?? null,
          brandSlug: brand?.slug ?? null,
          brandAccountId: brand?.account_id ?? null,
          coverMediaUrl: event.cover_media_url ?? null,
          publicCard: {
            eventId: event.id,
            brandId: event.brand_id ?? '',
            brandSlug: event.brand_slug ?? brand?.slug ?? '',
            brandName: event.brand_name ?? brand?.name ?? 'Mingla',
            brandProfilePhotoUrl: event.brand_profile_photo_url ?? null,
            eventSlug: event.slug ?? '',
            title: event.title ?? 'Event',
            description: event.description ?? null,
            coverMediaUrl: event.cover_media_url ?? null,
            coverMediaType: event.cover_media_type ?? null,
            coverHue: extractCoverHue(event.public_theme),
            masterDateUtc: event.master_start_at ?? null,
            masterEndAtUtc: event.master_end_at ?? null,
            doorsOpenLocal: null,
            endsAtLocal: null,
            timezone: event.master_timezone ?? event.timezone ?? 'UTC',
            // issue #2469 — the PARSED halves, never the combined string twice.
            venueName: location.venueName,
            city: event.city ?? null,
            address: location.address,
            hideAddressUntilTicket: extractHideAddressUntilTicket(event.public_theme),
            format: extractBusinessEventFormat(event.public_theme, Boolean(event.is_online)),
            locationGeo: parseLocationGeo(event.location_geo),
            partyTypes: Array.isArray(event.party_types) ? event.party_types : [],
            vibeTags: Array.isArray(event.vibe_tags) ? event.vibe_tags : [],
            musicGenres: Array.isArray(event.music_genres) ? event.music_genres : [],
            priceMin: null,
            priceMax: null,
            currency: event.currency ?? 'USD',
            publicBuyerUrl: buildGroupEventPublicUrl(
              {
                id: event.id,
                title: event.title ?? null,
                slug: event.slug ?? null,
                brandId: event.brand_id ?? null,
                brandName: event.brand_name ?? brand?.name ?? null,
                brandSlug: event.brand_slug ?? brand?.slug ?? null,
                brandAccountId: brand?.account_id ?? null,
                coverMediaUrl: event.cover_media_url ?? null,
                publicCard: null,
              },
              'event',
            ) ?? '',
          },
        },
      ];
    }),
  );
}

function buildGroupEventPublicUrl(
  meta: GroupEventMeta | null | undefined,
  linkedEntityType: 'direct' | 'session' | 'trip' | 'event' | null | undefined,
): string | null {
  if (!meta?.brandSlug || !meta.slug) return null;
  const routePrefix = linkedEntityType === 'trip' ? 't' : 'e';
  return `${BUSINESS_BUYER_DOMAIN}/${routePrefix}/${meta.brandSlug}/${meta.slug}`;
}

async function fetchPendingSessionInvitesForUser(userId: string): Promise<PendingSessionInvite[]> {
  const { data: invites, error } = await supabase
    .from("collaboration_invites")
    .select("id, session_id, inviter_id, created_at")
    .eq("invited_user_id", userId)
    .eq("status", "pending")
    .eq("pending_friendship", false)
    .order("created_at", { ascending: false });

  if (error) throw error;
  if (!invites || invites.length === 0) return [];

  const inviterIds = Array.from(
    new Set(invites.map((invite: any) => invite.inviter_id).filter(Boolean)),
  );
  const { data: profiles, error: profilesError } = inviterIds.length > 0
    ? await supabase
        .from("profiles")
        .select("id, display_name, username, first_name, last_name, avatar_url")
        .in("id", inviterIds)
    : { data: [] as any[], error: null };

  if (profilesError) throw profilesError;
  const profilesById = new Map((profiles || []).map((profile: any) => [profile.id, profile]));

  return invites.map((invite: any) => {
    const profile = profilesById.get(invite.inviter_id);
    return {
      sessionId: invite.session_id,
      inviteId: invite.id,
      inviterDisplayName: getDisplayName(profile),
      inviterAvatarUrl: profile?.avatar_url ?? null,
      createdAt: invite.created_at,
    };
  });
}

function isPendingInviteConversation(
  conversation: Conversation,
): conversation is Conversation & { __pendingInvite: PendingSessionInvite } {
  return Boolean((conversation as any).__pendingInvite);
}

function isPendingCreatorCollabConversation(
  conversation: Conversation,
): conversation is Conversation & { __pendingCollabChat: PendingCollabChatDetails } {
  return Boolean((conversation as any).__pendingCollabChat);
}

interface ConnectionsPageProps {
  isTabVisible?: boolean;
  onShareSavedCard?: (friend: any, suppressNotification?: boolean) => void;
  onRemoveFriend?: (friend: any, suppressNotification?: boolean) => void;
  onBlockUser?: (friend: any, suppressNotification?: boolean) => void;
  onReportUser?: (friend: any, suppressNotification?: boolean) => void;
  accountPreferences?: any;
  onCardLike?: (card: any) => Promise<boolean>;
  onAddToCalendar?: (experienceData: any) => void;
  onShareCard?: (card: any) => void;
  onPurchaseComplete?: (experienceData: any, purchaseOption: any) => void;
  boardsSessions?: any[];
  /** ORCH-0666: refreshes the home/session list after add-to-session mutation. */
  onRefreshSessions?: (options?: { showLoading?: boolean }) => Promise<void>;
  onCreateGroupChat?: (
    sessionName: string,
    selectedFriends: CreateGroupChatFriend[],
  ) => Promise<{ conversationId: string; sessionId: string }>;
  onAcceptPendingInvite?: (sessionId: string, inviteId: string) => Promise<void>;
  onDeclinePendingInvite?: (sessionId: string, inviteId: string) => Promise<void>;
  availableFriendsForCreate?: CreateGroupChatFriend[];
  isCreatingGroupChat?: boolean;
  userPreferences?: any;
  savedCards?: any[];
  onOpenPreferences?: () => void;
  onOpenCollabPreferences?: (sessionId?: string, sessionName?: string) => void;
  onUnreadCountChange?: (count: number) => void;
  /** Issue #4114: `focus: "paired"` opens the profile at birthday, holidays and saves. */
  onNavigateToFriendProfile?: (userId: string, options?: { focus?: "paired" }) => void;
  onFriendAccepted?: () => void;
  /** When set (e.g. Discover map "Message"), open DM with this user; clear via onOpenDirectMessageHandled */
  openDirectMessageWithUserId?: string | null;
  onOpenDirectMessageHandled?: () => void;
  /** When set (e.g. Profile "Friends" stat), auto-open this panel on mount; cleared via onInitialPanelHandled */
  initialPanel?: "friends" | "add" | "blocked" | null;
  onInitialPanelHandled?: () => void;
  deepLinkParams?: Record<string, string> | null;
  onDeepLinkHandled?: () => void;
}

const CONNECTIONS_CACHE_VERSION = "v2-orch-0898-group-metadata";

const EMPTY_MESSAGES: Message[] = [];

const getMessagesCacheKey = (conversationId: string) =>
  `mingla:connections:messages:${CONNECTIONS_CACHE_VERSION}:${conversationId}`;

const normalizeSearchText = (value: string | null | undefined): string =>
  (value || "")
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/\s+/g, " ")
    .trim();

// META-ORCH-1002 Sub-1 (S2): shared Android-opaque-fallback gate (was the per-component Android-11 version gate).
const isAndroidPreBlur = ANDROID_GLASS_USES_OPAQUE_FALLBACK;

// Issue #4114 Wave 2a: the paired-pills strip left the Chats screen (D13). The
// pairing data hooks below stay alive for the friends sheet (Wave 2b).
type ChatListRow = ChatListItemModel<Conversation, UseFriend>;
const tokens = glass.discover.chatList;

// Issue #4114: a friend you have not chatted with yet, shown in search results.
const FriendSearchRow = React.memo(function FriendSearchRow({
  friend,
  currentUserId,
  showSeparator,
  onStartChat,
}: {
  friend: UseFriend;
  currentUserId: string;
  showSeparator: boolean;
  onStartChat: (friend: UseFriend) => void;
}): React.ReactElement {
  const { t } = useTranslation(['connections']);
  const name = getDisplayName(friend);
  return (
    <Pressable
      onPress={() => onStartChat(friend)}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${t('connections:start_chat')}`}
      style={({ pressed }) => [styles.friendRow, pressed ? styles.rowPressed : null]}
    >
      {showSeparator ? <View style={styles.rowSeparator} /> : null}
      <ChatAvatar
        people={[{ id: friendUserIdOf(friend, currentUserId), name, avatarUrl: friend.avatar_url }]}
        shape="circle"
        label={name}
      />
      <Text style={styles.friendRowName} numberOfLines={1}>{name}</Text>
      <View style={styles.friendRowAction}>
        <Text style={styles.friendRowActionText}>{t('connections:start_chat')}</Text>
      </View>
    </Pressable>
  );
});

function ConnectionsPageRefactored({
  onShareSavedCard,
  onRemoveFriend,
  onBlockUser,
  onReportUser,
  accountPreferences,
  onCardLike,
  onAddToCalendar,
  onShareCard,
  onPurchaseComplete,
  boardsSessions = [],
  onRefreshSessions,
  onCreateGroupChat,
  onAcceptPendingInvite,
  onDeclinePendingInvite,
  availableFriendsForCreate = [],
  isCreatingGroupChat = false,
  userPreferences,
  savedCards = [],
  onOpenPreferences,
  onOpenCollabPreferences,
  onUnreadCountChange,
  onNavigateToFriendProfile,
  onFriendAccepted,
  openDirectMessageWithUserId,
  onOpenDirectMessageHandled,
  initialPanel,
  onInitialPanelHandled,
  isTabVisible,
  deepLinkParams,
  onDeepLinkHandled,
}: ConnectionsPageProps) {
  // ORCH-0679 Wave 2A: Dev-only render counter (I-TAB-PROPS-STABLE verification).
  const renderCountRef = React.useRef(0);
  if (__DEV__) {
    renderCountRef.current += 1;
    console.log(`[render-count] ConnectionsPage: ${renderCountRef.current}`);
  }

  useScreenLogger('connections');
  const { t } = useTranslation(['connections', 'common', 'social', 'chat']);
  // ORCH-1037 + ORCH-1035: step 6 = the in-page people icon (NOT the bottom-nav tab,
  // NOT the whole header row — operator-LOCKED). Issue #4114: step 7 now points at
  // the ✎ pencil that opens New message (it replaced the + chooser). The ref keeps
  // its `coachPlusButton` name so the ORCH-1037 leaf-target gates still read it.
  // Both are 34pt round glass buttons; radius ~17 hugs them.
  const coachPeopleIcon = useCoachMark(6, 17);
  const coachPlusButton = useCoachMark(7, 17);
  const user = useAppStore((state) => state.user);
  const {
    canCreateSession,
    isUnlimited,
  } = useSessionCreationGate();
  const { bottomNavTotalHeight } = useAppLayout();
  const chatInsets = useSafeAreaInsets();

  // ── Keyboard dismissal ────────────────────────────
  // META-ORCH-0991 Wave C: the friends modal is now a BaseBottomSheet (fixed
  // ['88%'] snap) and gorhom owns keyboard coordination, so the prior
  // useKeyboard sheet-height math (keyboardVisible/keyboardHeight/stableHeightRef
  // → sheetHeight/marginBottom) was removed. Only dismissKeyboard remains, used
  // by the row/close handlers.
  const { dismiss: dismissKeyboard } = useKeyboard({ disableLayoutAnimation: true });

  // ── ORCH-0600: Accessibility state for glass header ──────
  // Issue #1638 — served from the shared app-wide probe, so this 4600-line page no longer
  // pays a native a11y round trip plus an extra post-resolve render on
  // every switch to Friends. See useA11yPreferences.ts.
  const { reduceTransparency } = useA11yPreferences();

  // ── UI state ─────────────────────────────────────────────
  const [activePanel, setActivePanel] = useState<PanelId>(null); // [TRANSITIONAL] legacy — being replaced by showFriendsModal
  const [showFriendsModal, setShowFriendsModal] = useState(false);
  const [badgeDismissed, setBadgeDismissed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Issue #4114 Wave 2a: list filter chip, the pencil's New message sheet, the
  // long-press actions target, and the full archived list.
  const [chatFilter, setChatFilter] = useState<ChatFilter>("all");
  const [showNewMessageSheet, setShowNewMessageSheet] = useState(false);
  const [chatActionsTarget, setChatActionsTarget] = useState<ChatListItemConversation | null>(null);
  const [showArchivedList, setShowArchivedList] = useState(false);
  const [friendsModalTab, setFriendsModalTab] = useState<FriendsModalTab>("friend-list");
  // ORCH-1371 [add-friend-country-picker-hidden]: hoisted add-friend country
  // picker state — must survive the friends sheet's RN <Modal> drop (which
  // unmounts AddFriendView). Mirrors AddFriendView's old local defaults.
  const [addFriendCountry, setAddFriendCountry] = useState<CountryData>(
    () =>
      getCountryByCode(getDefaultCountryCode()) ?? {
        code: "US",
        name: "United States",
        dialCode: "+1",
        flag: "\u{1F1FA}\u{1F1F8}",
      }
  );
  const [addFriendPhone, setAddFriendPhone] = useState("");
  const [addFriendPickerOpen, setAddFriendPickerOpen] = useState(false);
  // Issue #4114 Wave 2b: the Add a friend sheet (opened from New message and the
  // friends sheet's Add), and the blocked view inside the Friends tab.
  const [showAddFriendSheet, setShowAddFriendSheet] = useState(false);
  const [showBlockedView, setShowBlockedView] = useState(false);
  const [requestBusyKey, setRequestBusyKey] = useState<string | null>(null);
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

  // Issue #4114: pull-to-refresh reloads chats AND friends (it used to reload
  // friends only). Declared after fetchConversations below.

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
  const [lifecycleBusyIds, setLifecycleBusyIds] = useState<Set<string>>(new Set());

  const runLifecycle = useCallback(async (conversationId: string, action: 'archive' | 'unarchive' | 'hide'): Promise<boolean> => {
    setLifecycleBusyIds((current) => new Set(current).add(conversationId));
    const result = await messagingService.setConversationLifecycle(conversationId, action);
    setLifecycleBusyIds((current) => { const next = new Set(current); next.delete(conversationId); return next; });
    if (result.error) {
      const copy = action === 'archive' ? t('connections:archive_failed')
        : action === 'unarchive' ? t('connections:unarchive_failed')
        : t('connections:remove_failed');
      AccessibilityInfo.announceForAccessibility(copy);
      Alert.alert(copy);
      return false;
    }
    invalidateContentShareRecipients();
    return true;
  }, [t]);

  const handleArchiveChat = useCallback(async (conversationId: string) => {
    if (!await runLifecycle(conversationId, 'archive')) return;
    setArchivedIds((current) => new Set(current).add(conversationId));
    // Issue #4114: an archived chat gives its pin back (the 3-pin limit counts
    // every pinned row, so a hidden pin would block a visible one).
    const archived = conversations.find((conversation) => conversation.id === conversationId) as ChatListItemConversation | undefined;
    if (archived?.pinned_at) {
      setConversations((current) => current.map((conversation) =>
        conversation.id === conversationId ? ({ ...conversation, pinned_at: null } as Conversation) : conversation));
      const result = await messagingService.setConversationListState(conversationId, 'unpin');
      if (result.error) console.warn('[ConnectionsPage] unpin after archive failed', result.error);
    }
  }, [conversations, runLifecycle]);

  const handleUnarchiveChat = useCallback(async (conversationId: string) => {
    if (await runLifecycle(conversationId, 'unarchive')) setArchivedIds((current) => { const next = new Set(current); next.delete(conversationId); return next; });
  }, [runLifecycle]);

  const handleDeleteChat = useCallback((conversationId: string) => {
    const isGroup = conversations.find((conversation) => conversation.id === conversationId)?.type === 'group';
    if (isGroup) {
      Alert.alert(t('connections:leave_group_title', { defaultValue: 'Leave group?' }), t('connections:leave_group_body'), [
        { text: t('common:cancel'), style: 'cancel' },
        { text: t('connections:action_leave'), style: 'destructive', onPress: () => void (async () => {
          setLifecycleBusyIds((current) => new Set(current).add(conversationId));
          const result = await messagingService.leaveGroupConversation(conversationId, user?.id ?? '');
          setLifecycleBusyIds((current) => { const next = new Set(current); next.delete(conversationId); return next; });
          if (result.error) {
            const copy = t('connections:leave_failed');
            AccessibilityInfo.announceForAccessibility(copy); Alert.alert(copy); return;
          }
          setConversations((current) => current.filter((conversation) => conversation.id !== conversationId));
          invalidateContentShareRecipients();
        })() },
      ]);
      return;
    }
    Alert.alert(t('connections:remove_chat_title', { defaultValue: 'Remove chat?' }), t('connections:remove_chat_body'), [
      { text: t('common:cancel'), style: 'cancel' },
      {
        text: t('connections:action_remove'), style: 'destructive', onPress: () => void (async () => {
          if (!await runLifecycle(conversationId, 'hide')) return;
          setConversations(prev => prev.filter(c => c.id !== conversationId));
          AccessibilityInfo.announceForAccessibility(t('connections:chat_removed', { defaultValue: 'Chat removed.' }));
        })()
      },
    ]);
  }, [conversations, runLifecycle, t, user?.id]);

  // ── Messaging state ──────────────────────────────────────
  const [activeChat, setActiveChat] = useState<Friend | null>(null);
  const [showMessageInterface, setShowMessageInterface] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  // Issue #4114: ONE owner for every chat's messages. The open chat's list is
  // derived from the per-conversation store, and every write goes through
  // `writeConversationMessages` → `mergeMessages` (keyed `clientId || id`,
  // sorted by time, pending sends kept through refreshes). There is no second
  // "visible messages" copy to drift from the store.
  const [messagesCache, setMessagesCache] = useState<Record<string, Message[]>>({});
  const messages = useMemo<Message[]>(
    () => (currentConversationId ? messagesCache[currentConversationId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES),
    [currentConversationId, messagesCache],
  );
  // Issue #4114: which conversation's live channel is open (released on switch/back).
  const subscribedConversationIdRef = useRef<string | null>(null);
  // Issue #4114: older-history paging for the open chat.
  const [olderPaging, setOlderPaging] = useState<{ conversationId: string | null; hasMore: boolean; loading: boolean }>({
    conversationId: null,
    hasMore: false,
    loading: false,
  });
  const olderLoadInFlightRef = useRef<string | null>(null);
  // Issue #4114: client ids of sends in flight, so a double tap on Retry sends once.
  const sendsInFlightRef = useRef<Set<string>>(new Set());
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
  // ORCH-0987 unify: the friend whose shared more-menu (FriendActionsSheet) is open.
  // `actionsFriend` stays set after the sheet hides so the sheet (and its sub-modals —
  // AddToBoardModal/Block/Report) remain mounted long enough to present; only
  // `actionsSheetVisible` toggles the sheet itself (mirrors the profile mount).
  const [actionsFriend, setActionsFriend] = useState<UseFriend | null>(null);
  const [actionsSheetVisible, setActionsSheetVisible] = useState(false);
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
  const [showCreateGroupChatSheet, setShowCreateGroupChatSheet] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  // ORCH-1239: which gated feature opened the paywall (drives header/analytics).
  // Group-chat create path opens it as 'session_creation'; pairing paths as 'pairing'.
  const [paywallFeature, setPaywallFeature] = useState<GatedFeature>('session_creation');
  const [processingInviteIds, setProcessingInviteIds] = useState<Set<string>>(new Set());
  const [pendingCollabChat, setPendingCollabChat] = useState<PendingCollabChatDetails | null>(null);
  const [pendingCollabWorking, setPendingCollabWorking] = useState(false);
  const [showIncomingPairRequest, setShowIncomingPairRequest] = useState<PairRequest | null>(null);
  const pendingCollabChatRef = useRef<PendingCollabChatDetails | null>(null);
  const readyPendingCollabToastSessionIdsRef = useRef(new Set<string>());
  pendingCollabChatRef.current = pendingCollabChat;

  // META-ORCH-0991 Wave C — §13 one-sheet-at-a-time gate for the friends modal.
  // Every child surface the friends modal can open is itself an RN-Modal-backed
  // surface (wrapInRNModal BaseBottomSheet, center-dialog, or RN <Modal>). Two
  // RN-Modal-backed surfaces cannot co-present on iOS, so while any child is open
  // the friends sheet's window is dropped (visible gated below). handleFriendsModalClose
  // swallows the suppress-for-child close (BaseBottomSheet fires onClose on
  // onChange(-1) when visible flips false) so suppressing for a child does NOT
  // tear down the whole friends flow — only a genuine user dismiss propagates.
  const anyFriendsChildOpen =
    addFriendPickerOpen ||
    showAddFriendSheet ||
    actionsSheetVisible ||
    showPairRequestModal ||
    showNewMessageSheet ||
    !!chatActionsTarget ||
    showCreateGroupChatSheet ||
    showReportModal ||
    showBlockModal ||
    showAddToBoardModal ||
    showPaywall ||
    !!pendingCollabChat ||
    !!showIncomingPairRequest;
  const handleFriendsModalClose = useCallback(() => {
    if (anyFriendsChildOpen) return;
    dismissKeyboard();
    setShowFriendsModal(false);
  }, [anyFriendsChildOpen, dismissKeyboard]);

  // ORCH-1371: apply a picked country to the hoisted add-friend state
  // (mirrors AddFriendView's deleted handleCountrySelect).
  const handleAddFriendCountrySelect = useCallback((code: string) => {
    const c = getCountryByCode(code);
    if (c) setAddFriendCountry(c);
  }, []);

  // ORCH-1371: preserve pre-1371 reopen semantics. Before the hoist,
  // AddFriendView unmounted on modal close, so reopening showed an empty field +
  // the default country. `showFriendsModal` stays true across a picker
  // round-trip (only `anyFriendsChildOpen` gates the sheet's `visible`), so this
  // effect does NOT fire mid-round-trip → the typed value survives the picker;
  // it fires only on a genuine reopen → matches the old empty-on-reopen behavior.
  // Issue #4114 Wave 2b: the same reset fires on a genuine open of the Add a
  // friend sheet. A picker round-trip changes neither flag (only the picker flag
  // gates the sheet's `visible`), so the typed number survives the picker.
  useEffect(() => {
    if (showFriendsModal || showAddFriendSheet) {
      setAddFriendPhone("");
      setAddFriendCountry(
        getCountryByCode(getDefaultCountryCode()) ?? {
          code: "US",
          name: "United States",
          dialCode: "+1",
          flag: "\u{1F1FA}\u{1F1F8}",
        }
      );
      setAddFriendPickerOpen(false);
    }
  }, [showFriendsModal, showAddFriendSheet]);

  const pairedUserIds = useMemo(() => new Set(
    pairingPills.filter(p => p.pillState === 'active' && p.pairedUserId != null).map(p => p.pairedUserId!)
  ), [pairingPills]);

  const pendingPairUserIds = useMemo(() => new Set(
    pairingPills.filter(p => p.pillState !== 'active' && p.pairedUserId != null).map(p => p.pairedUserId!)
  ), [pairingPills]);


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

  // ── Issue #4114 Wave 2b: friends sheet data ──────────────
  const { data: hiddenIncomingPairRequests = [] } = useIncomingHiddenPairRequests(user?.id);
  const { data: legacyPhoneInvites = [] } = usePendingPhoneInvites();
  const { tier: pairingTier } = useEffectiveTier(user?.id);
  const maxPairings = getTierLimits(pairingTier).maxPairings;
  const pairedPills = useMemo(() => activePairs(pairingPills), [pairingPills]);
  const pairTile = useMemo(
    () => pairTileState({ pairedCount: pairedPills.length, isUnlimited: maxPairings < 0, freeLimit: maxPairings }),
    [pairedPills.length, maxPairings],
  );
  const receivedRows = useMemo(
    () =>
      buildReceivedRows({
        incomingFriendRequests: incomingRequests,
        hiddenPairRequests: hiddenIncomingPairRequests,
        visiblePairRequests: incomingPairRequests,
      }),
    [incomingRequests, hiddenIncomingPairRequests, incomingPairRequests],
  );
  const sentRows = useMemo(
    () =>
      buildSentRows({
        outgoingFriendRequests: outgoingRequests,
        pairingPills,
        legacyPhoneInvites,
      }),
    [outgoingRequests, pairingPills, legacyPhoneInvites],
  );

  const openPairingPaywall = useCallback(() => {
    setPaywallFeature('pairing');
    setShowPaywall(true);
  }, []);

  // Issue #4114: the friend_request_accepted analytics moved here from the dead
  // FriendRequestsModal (it was the only place they fired).
  const trackFriendAccepted = useCallback((requestId: string, senderName: string) => {
    mixpanelService.trackFriendRequestAccepted({ requestId, senderName });
    logAppsFlyerEvent('friend_request_accepted', { source: 'friends_sheet' });
  }, []);

  const handleAcceptReceived = useCallback(async (row: ReceivedRow) => {
    if (requestBusyKey) return;
    HapticFeedback.medium();
    setRequestBusyKey(row.key);
    try {
      if (row.kind === "friend_pair") {
        // ONE Accept: the friend accept (its trigger reveals the pair request),
        // then the pair accept. At the limit they are still friends.
        onFriendAccepted?.();
        const result = await runCombinedAccept(row, user?.id ?? "", {
          acceptFriend: acceptFriendRequest,
          acceptPair: (pairRequestId) => acceptPairRequestMutation.mutateAsync(pairRequestId),
        });
        trackFriendAccepted(row.friendRequestId, row.name);
        if (result.paired) {
          showToast({ message: t('connections:fs_now_paired', { name: row.name }), type: 'success' });
        } else if (result.limit === "mine") {
          showToast({ message: t('connections:fs_now_friends', { name: row.name }), type: 'info' });
          openPairingPaywall();
        } else if (result.limit === "theirs") {
          showToast({ message: t('connections:fs_friends_pair_waiting', { name: row.name }), type: 'info' });
        } else {
          showToast({ message: t('connections:fs_now_friends', { name: row.name }), type: 'info' });
        }
      } else if (row.kind === "friend") {
        onFriendAccepted?.();
        await acceptFriendRequest(row.friendRequestId);
        trackFriendAccepted(row.friendRequestId, row.name);
        showToast({ message: t('connections:fs_now_friends', { name: row.name }), type: 'success' });
      } else {
        try {
          await acceptPairRequestMutation.mutateAsync(row.pairRequestId);
          showToast({ message: t('connections:fs_paired_with', { name: row.name }), type: 'success' });
        } catch (err) {
          // ORCH-1239 / #4114: the paywall opens on EVERY pair-limit hit.
          if (err instanceof Error && err.message === 'pairing_limit_reached') openPairingPaywall();
          else throw err;
        }
      }
    } catch (err) {
      showMutationError(err, 'accepting request', showToast);
    } finally {
      setRequestBusyKey(null);
    }
  }, [requestBusyKey, user?.id, acceptFriendRequest, acceptPairRequestMutation, trackFriendAccepted, onFriendAccepted, showToast, t, openPairingPaywall]);

  const handleDeclineReceived = useCallback(async (row: ReceivedRow) => {
    if (requestBusyKey) return;
    HapticFeedback.warning();
    setRequestBusyKey(row.key);
    try {
      if (row.kind === "pair") await declinePairRequestMutation.mutateAsync(row.pairRequestId);
      else await declineFriendRequest(row.friendRequestId);
    } catch (err) {
      showMutationError(err, 'declining request', showToast);
    } finally {
      setRequestBusyKey(null);
    }
  }, [requestBusyKey, declinePairRequestMutation, declineFriendRequest, showToast]);

  // Called only after the person confirmed in RequestsView (every Cancel asks once).
  const handleCancelSent = useCallback(async (row: SentRow) => {
    setRequestBusyKey(row.key);
    try {
      if (row.kind === "friend_request") await cancelFriendRequest(row.friendRequestId);
      else if (row.kind === "phone_invite") {
        if (row.pairInviteId) await cancelPairInviteMutation.mutateAsync(row.pairInviteId);
        if (row.legacyInviteId) {
          await cancelPendingInvite(row.legacyInviteId);
          await queryClient.invalidateQueries({ queryKey: phoneInviteKeys.all });
        }
      } else await cancelPairRequestMutation.mutateAsync(row.pairRequestId);
      if (row.kind === "friend_pair_request") void loadFriendRequests();
    } catch (err) {
      showMutationError(err, 'cancelling request', showToast);
    } finally {
      setRequestBusyKey(null);
    }
  }, [cancelFriendRequest, cancelPairInviteMutation, cancelPairRequestMutation, queryClient, loadFriendRequests, showToast]);

  // Issue #4114: the friends sheet's Add and New message's "Add a friend" open the
  // one Add a friend sheet. The friends sheet stays "open" underneath (the
  // anyFriendsChildOpen gate drops its window) and returns when this closes.
  const openAddFriendSheet = useCallback(() => {
    dismissKeyboard();
    setShowAddFriendSheet(true);
  }, [dismissKeyboard]);
  const closeAddFriendSheet = useCallback(() => {
    setShowAddFriendSheet(false);
  }, []);
  // BaseBottomSheet fires onClose on every hide, including the drop for the
  // country picker; only a genuine swipe-down (picker closed) closes the flow.
  const handleAddFriendSheetClose = useCallback(() => {
    if (addFriendPickerOpen) return;
    setShowAddFriendSheet(false);
  }, [addFriendPickerOpen]);

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
    const pending = conversations
      .filter(isPendingInviteConversation)
      .sort((a, b) => {
        const aTime = a.__pendingInvite.createdAt || a.created_at;
        const bTime = b.__pendingInvite.createdAt || b.created_at;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });
    // Issue #4114: pinned chats first (in pin order), then most recent activity.
    const regular = sortChatList(
      conversations.filter((conversation) => !isPendingInviteConversation(conversation)),
    );
    return [...pending, ...regular].filter(c => !archivedIds.has(c.id));
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
      if (isPendingInviteConversation(conv)) {
        return normalizeSearchText(conv.__pendingInvite.inviterDisplayName).includes(q);
      }
      if (isPendingCreatorCollabConversation(conv)) {
        const pendingNames = conv.__pendingCollabChat.people
          .map((person) => person.name)
          .join(" ");
        return normalizeSearchText(`${conv.__pendingCollabChat.sessionName} ${pendingNames}`).includes(q);
      }

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
        conv.name || "",
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

  const pendingCreatorCollabSessionIds = useMemo(
    () =>
      Array.from(
        new Set(
          conversations
            .filter(isPendingCreatorCollabConversation)
            .map((conversation) => conversation.session_id)
            .filter((sessionId): sessionId is string => Boolean(sessionId)),
        ),
      ).sort(),
    [conversations],
  );
  const pendingCreatorCollabSessionKey = pendingCreatorCollabSessionIds.join("|");

  // ── Shared conversation fetch + transform ─────────────────
  const fetchConversations = useCallback(async (userId: string) => {
    try {
      setError(null);

      // Hard 10-second timeout: belt-and-suspenders safety net. Post-ORCH-0901,
      // messagingService.getConversations runs at most 2 sequential RLS-filtered Supabase
      // round-trips (Q1+Q2 in parallel + optional Q3 batch-profile-fetch) — down from the
      // ~5N+3 sequential queries it used to run — but background-suspended connections
      // can still hang any single round-trip, and the timeout prevents conversationsLoading
      // from getting stuck at true forever. See SPEC_ORCH-0901 §3.2.
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

      // Batch-fetch all participant profiles and session names. ORCH-0898 group-chat
      // rows should carry conversations.name, but older/backfilled rows can have it
      // missing; session_id -> collaboration_sessions.name is the canonical fallback.
      const allParticipantIds = new Set<string>();
      const groupSessionIds = new Set<string>();
      const groupEventIds = new Set<string>();
      (rawConversations || []).forEach((conv) => {
        conv.participants.forEach((p) => allParticipantIds.add(p.user_id));
        const sessionId = (conv as { session_id?: string | null }).session_id;
        if (conv.type === 'group' && sessionId) {
          groupSessionIds.add(sessionId);
        }
        const eventId = (conv as { event_id?: string | null }).event_id;
        const linkedEntityType = (conv as { linked_entity_type?: string | null }).linked_entity_type;
        if (conv.type === 'group' && eventId && (linkedEntityType === 'trip' || linkedEntityType === 'event')) {
          groupEventIds.add(eventId);
        }
      });

      const [sessionsResult, pendingPhoneInvitesResult, eventMetaMap] = await Promise.all([
        groupSessionIds.size > 0
          ? supabase
              .from("collaboration_sessions")
              .select(`
                id,
                name,
                created_by,
                status,
                session_participants(user_id, has_accepted),
                collaboration_invites(id, invited_user_id, status, created_at)
              `)
              .in("id", Array.from(groupSessionIds))
          : Promise.resolve({ data: [] as any[], error: null }),
        groupSessionIds.size > 0
          ? supabase
              .from("pending_session_invites")
              .select("id, session_id, phone_e164, status, created_at")
              .in("session_id", Array.from(groupSessionIds))
              .eq("status", "pending")
          : Promise.resolve({ data: [] as any[], error: null }),
        fetchGroupEventMetaByIds(Array.from(groupEventIds)).catch((error) => {
          console.warn('[ConnectionsPage] Failed to batch-resolve group chat event metadata:', error);
          return new Map<string, GroupEventMeta>();
        }),
      ]);

      if (sessionsResult.error) throw sessionsResult.error;
      if (pendingPhoneInvitesResult.error) throw pendingPhoneInvitesResult.error;

      for (const session of sessionsResult.data || []) {
        for (const participant of (session as any).session_participants || []) {
          if (participant.user_id) allParticipantIds.add(participant.user_id);
        }
        for (const invite of (session as any).collaboration_invites || []) {
          if (invite.invited_user_id) allParticipantIds.add(invite.invited_user_id);
        }
      }

      const profilesResult = allParticipantIds.size > 0
        ? await supabase
            .from("profiles")
            .select("id, display_name, username, first_name, last_name, avatar_url")
            .in("id", Array.from(allParticipantIds))
        : { data: [] as any[], error: null };

      if (profilesResult.error) throw profilesResult.error;

      const profilesMap = new Map(
        (profilesResult.data || []).map((p) => [p.id, p])
      );
      const pendingPhoneInvitesBySession = new Map<string, any[]>();
      for (const invite of pendingPhoneInvitesResult.data || []) {
        const rows = pendingPhoneInvitesBySession.get(invite.session_id) ?? [];
        rows.push(invite);
        pendingPhoneInvitesBySession.set(invite.session_id, rows);
      }
      const sessionMetaMap = new Map(
        (sessionsResult.data || []).map((s) => [
          s.id,
          {
            name: s.name as string | null,
            created_by: s.created_by as string | null,
            status: (s as any).status as string | null,
            participants: ((s as any).session_participants || []) as {
              user_id: string;
              has_accepted: boolean | null;
            }[],
            invites: ((s as any).collaboration_invites || []) as {
              id: string;
              invited_user_id: string;
              status: string | null;
              created_at: string | null;
            }[],
            phoneInvites: pendingPhoneInvitesBySession.get(s.id) ?? [],
          },
        ])
      );

      // Transform to Conversation type (matching useMessages format for ChatListItem).
      // ORCH-0898: the transform now passes `type`, `name`, `session_id` through as
      // optional extra fields. ChatListItem's ChatListItemConversation type intersection
      // picks them up for the group-vs-direct render branch. The base useMessages
      // Conversation type stays unchanged (locked for ORCH-0900 scope).
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
            // Issue #4114: no hard-coded presence. The only presence data is
            // per-conversation "has this chat open" (conversation_presence),
            // which is not app-wide online state, so the list shows no dot.
          };
        });

        const sessionId = (conv as { session_id?: string | null }).session_id ?? null;
        const eventId = (conv as { event_id?: string | null }).event_id ?? null;
        const linkedEntityType = (conv as { linked_entity_type?: 'direct' | 'session' | 'trip' | 'event' }).linked_entity_type;
        const sessionMeta = sessionId ? sessionMetaMap.get(sessionId) : null;
        const eventMeta = eventId ? eventMetaMap.get(eventId) : null;
        const eventPublicUrl = buildGroupEventPublicUrl(eventMeta, linkedEntityType);
        const eventPublicCard = eventMeta?.publicCard
          ? {
              ...eventMeta.publicCard,
              publicBuyerUrl: eventPublicUrl ?? eventMeta.publicCard.publicBuyerUrl,
            }
          : null;
        const conversationName = eventMeta?.title?.trim()
          || (conv as { name?: string | null }).name?.trim()
          || sessionMeta?.name?.trim()
          || null;
        const sessionParticipants = sessionMeta?.participants ?? [];
        const acceptedParticipantIds = new Set(
          sessionParticipants
            .filter((participant) => participant.has_accepted === true)
            .map((participant) => participant.user_id),
        );
        const hasAcceptedCollaborator = sessionParticipants.some(
          (participant) => participant.user_id !== userId && participant.has_accepted === true,
        );
        const pendingInvitedIds = new Set(
          (sessionMeta?.invites ?? [])
            .filter((invite) => invite.status === "pending")
            .map((invite) => invite.invited_user_id),
        );
        const pendingInviteByUserId = new Map(
          (sessionMeta?.invites ?? [])
            .filter((invite) => invite.status === "pending")
            .map((invite) => [invite.invited_user_id, invite]),
        );
        const isPendingCreatorCollab =
          conv.type === "group" &&
          linkedEntityType === "session" &&
          !!sessionId &&
          sessionMeta?.created_by === userId &&
          !hasAcceptedCollaborator;
        const pendingPeople: PendingCollabChatPerson[] = sessionParticipants
          .filter((participant) => participant.user_id)
          .map((participant) => {
            const profile = profilesMap.get(participant.user_id);
            const isCreator = participant.user_id === sessionMeta?.created_by;
            return {
              id: participant.user_id,
              name: isCreator && participant.user_id === userId
                ? "You"
                : getDisplayName(profile, "Mingla friend"),
              avatarUrl: profile?.avatar_url ?? null,
              status: isCreator
                ? "creator"
                : participant.has_accepted === true
                  ? "accepted"
                  : "pending",
              inviteKind:
                !isCreator && participant.has_accepted !== true ? "warm" : null,
              inviteId: pendingInviteByUserId.get(participant.user_id)?.id ?? null,
            };
          });
        for (const inviteeId of pendingInvitedIds) {
          if (pendingPeople.some((person) => person.id === inviteeId)) continue;
          const profile = profilesMap.get(inviteeId);
          pendingPeople.push({
            id: inviteeId,
            name: getDisplayName(profile, "Mingla friend"),
            avatarUrl: profile?.avatar_url ?? null,
            status: acceptedParticipantIds.has(inviteeId) ? "accepted" : "pending",
            inviteKind: acceptedParticipantIds.has(inviteeId) ? null : "warm",
            inviteId: pendingInviteByUserId.get(inviteeId)?.id ?? null,
          });
        }
        for (const invite of sessionMeta?.phoneInvites ?? []) {
          pendingPeople.push({
            id: `phone:${invite.id}`,
            name: invite.phone_e164 || "Phone invite",
            avatarUrl: null,
            status: "pending",
            inviteKind: "cold",
            inviteId: invite.id,
            phoneE164: invite.phone_e164 ?? null,
          });
        }

        return {
          id: conv.id,
          created_by: conv.created_by ?? '',
          created_at: conv.created_at,
          participants,
          last_message: conv.last_message as unknown as ConvMessage | undefined,
          unread_count: conv.unread_count || 0,
          messages: [],
          // ORCH-0898 group-chat extras (consumed by ChatListItem):
          type: conv.type,
          name: conversationName,
          session_id: sessionId,
          event_id: eventId,
          linked_entity_type: linkedEntityType ?? undefined,
          sessionCreatorId: sessionMeta?.created_by ?? null,
          sessionStatus: sessionMeta?.status ?? null,
          isPendingCreatorCollab,
          __pendingCollabChat: isPendingCreatorCollab && sessionId
            ? {
                conversationId: conv.id,
                sessionId,
                sessionName: conversationName || "Collaboration chat",
                people: pendingPeople,
                existingUserIds: Array.from(
                  new Set([
                    ...pendingPeople.map((person) => person.id),
                    userId,
                  ]),
                ),
              }
            : undefined,
          is_broadcast_only: Boolean((conv as any).is_broadcast_only),
          eventBrandName: eventMeta?.brandName ?? null,
          eventBrandAccountId: eventMeta?.brandAccountId ?? null,
          eventCoverMediaUrl: eventMeta?.coverMediaUrl ?? null,
          eventPublicUrl,
          eventPublicCard,
          archived_at: (conv as any).archived_at ?? null,
          pinned_at: (conv as any).pinned_at ?? null,
          marked_unread_at: (conv as any).marked_unread_at ?? null,
        };
      });

      const pendingInvites = await fetchPendingSessionInvitesForUser(userId).catch((inviteError) => {
        console.warn("[ConnectionsPage] Failed to fetch pending session invites:", inviteError);
        return [] as PendingSessionInvite[];
      });
      const pendingInviteRows = pendingInvites.map((invite) => ({
        id: `pending-invite-${invite.inviteId}`,
        created_by: "",
        created_at: invite.createdAt,
        participants: [],
        unread_count: 0,
        messages: [],
        type: "group" as const,
        name: invite.inviterDisplayName,
        session_id: invite.sessionId,
        linked_entity_type: "session" as const,
        __pendingInvite: invite,
      })) as Conversation[];

      const nextConversations = [...pendingInviteRows, ...transformed];

      setConversations(nextConversations);
      setArchivedIds(new Set(transformed.filter((conversation) => Boolean((conversation as any).archived_at)).map((conversation) => conversation.id)));
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

  // ── Issue #4114: pull-to-refresh reloads chats and friends ──
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // Both reloads start together; chats are awaited after friends.
      const chats = user?.id ? fetchConversations(user.id) : Promise.resolve();
      await fetchFriends();
      await chats;
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchConversations, fetchFriends, user?.id]);

  const patchConversation = useCallback((conversationId: string, patch: Partial<ChatListItemConversation>) => {
    setConversations((current) => current.map((conversation) =>
      conversation.id === conversationId ? ({ ...conversation, ...patch } as Conversation) : conversation));
  }, []);

  // ── Issue #4114: pin up to 3 chats (client check + server trigger) ──
  const handleTogglePin = useCallback(async (conversation: ChatListItemConversation) => {
    const pinning = !conversation.pinned_at;
    if (pinning && !canPinChat(conversations as ChatListItemConversation[], conversation.id)) {
      HapticFeedback.warning();
      showToast({ message: t('connections:pin_limit', { count: MAX_PINNED_CHATS }), type: 'info' });
      return;
    }
    HapticFeedback.light();
    const previous = conversation.pinned_at ?? null;
    patchConversation(conversation.id, { pinned_at: pinning ? new Date().toISOString() : null });
    const result = await messagingService.setConversationListState(conversation.id, pinning ? 'pin' : 'unpin');
    if (result.error) {
      patchConversation(conversation.id, { pinned_at: previous });
      showToast({
        message: result.pinLimitReached
          ? t('connections:pin_limit', { count: MAX_PINNED_CHATS })
          : t('connections:pin_failed'),
        type: result.pinLimitReached ? 'info' : 'error',
      });
    }
  }, [conversations, patchConversation, showToast, t]);

  // ── Issue #4114: mark unread is a private flag, never a read-receipt change ──
  const handleToggleUnread = useCallback(async (conversation: ChatListItemConversation) => {
    const marking = !conversation.marked_unread_at;
    HapticFeedback.light();
    const previous = conversation.marked_unread_at ?? null;
    patchConversation(conversation.id, { marked_unread_at: marking ? new Date().toISOString() : null });
    const result = await messagingService.setConversationListState(conversation.id, marking ? 'mark_unread' : 'mark_read');
    if (result.error) {
      patchConversation(conversation.id, { marked_unread_at: previous });
      showToast({ message: t('connections:unread_failed'), type: 'error' });
    }
  }, [patchConversation, showToast, t]);

  // ── Issue #4114: mute from the list (direct chats; mute is per person) ──
  const handleToggleMuteChat = useCallback(async (conversation: ChatListItemConversation) => {
    const other = conversation.participants.find((participant) => participant.id !== user?.id);
    if (!other?.id) return;
    const wasMuted = mutedUserIds.includes(other.id);
    HapticFeedback.light();
    setMutedUserIds((current) => wasMuted ? current.filter((id) => id !== other.id) : [...current, other.id]);
    const result = wasMuted ? await muteService.unmuteUser(other.id) : await muteService.muteUser(other.id);
    if (!result.success) {
      setMutedUserIds((current) => wasMuted ? [...current, other.id] : current.filter((id) => id !== other.id));
      showToast({ message: t('connections:mute_error'), type: 'error' });
    }
  }, [mutedUserIds, showToast, t, user?.id]);

  const handleOpenChatActions = useCallback((conversation: ChatListItemConversation) => {
    HapticFeedback.medium();
    setChatActionsTarget(conversation);
  }, []);

  // ── Fetch conversations on mount ─────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void (async () => {
      const migrationKey = `mingla:archived_chats_server_migrated:${user.id}`;
      const legacyKey = `mingla:archived_chats:${user.id}`;
      try {
        const [migrated, raw] = await Promise.all([
          AsyncStorage.getItem(migrationKey), AsyncStorage.getItem(legacyKey),
        ]);
        if (!migrated && raw) {
          const ids = JSON.parse(raw) as unknown;
          if (Array.isArray(ids)) {
            for (const conversationId of ids.filter((id): id is string => typeof id === 'string')) {
              const result = await messagingService.setConversationLifecycle(conversationId, 'archive');
              if (result.error) throw new Error(result.error);
            }
          }
          await AsyncStorage.multiSet([[migrationKey, '1'], [legacyKey, '[]']]);
        } else if (!migrated) {
          await AsyncStorage.setItem(migrationKey, '1');
        }
      } catch (migrationError) {
        console.warn('[ConnectionsPage] archive migration deferred', migrationError instanceof Error ? migrationError.name : 'unknown');
      }
      if (!cancelled) await fetchConversations(user.id);
    })();
    return () => { cancelled = true; };
  }, [user?.id, fetchConversations]);

  // ── Friends & requests freshness — issue #1638 ───────────
  // There used to be a mount effect here calling `fetchFriends()` + `loadFriendRequests()`.
  // Both are `queryClient.invalidateQueries(...)`, NOT reads (useFriends.ts), so under
  // Wave 2.8 Path B — where this page fully unmounts on every switch away — every single
  // tap on the Friends tab forced two network round trips and defeated both the 30s
  // `useFriendsList` staleTime and the 5-minute global default.
  //
  // The `useFriends()` call above already subscribes to the friends / requests / blocked
  // queries. React Query's `refetchOnMount` (default true, not overridden in
  // config/queryClient.ts) refetches them on mount when they are STALE and serves cache
  // when they are not; `useFriendsQuery.ts` additionally carries a 5-minute
  // `refetchInterval` safety net, and `app/index.tsx` polls friend requests every 60s.
  //
  // Action-driven invalidations are UNCHANGED and still fire: pull-to-refresh
  // (`handleRefresh`), the error-state "Try again" button, `onRequestSent`, and every
  // accept / decline / remove / block / unblock / cancel mutation in useFriends.ts.

  useEffect(() => {
    if (!user?.id || pendingCreatorCollabSessionIds.length === 0) return;

    let disposed = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const pendingSessionIds = new Set(pendingCreatorCollabSessionIds);

    const refreshPendingCreatorChats = (row: Record<string, any> | null | undefined) => {
      if (disposed || !isPendingCollabReadyChange(row, pendingSessionIds, user.id)) {
        return;
      }

      const changedSessionId = row?.session_id;
      if (
        pendingCollabChatRef.current?.sessionId === changedSessionId &&
        !readyPendingCollabToastSessionIdsRef.current.has(changedSessionId)
      ) {
        readyPendingCollabToastSessionIdsRef.current.add(changedSessionId);
        setPendingCollabChat(null);
        showToast({ message: "Someone accepted. The chat is ready.", type: "info" });
      }

      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        if (disposed) return;
        void fetchConversations(user.id);
        void onRefreshSessions?.({ showLoading: false });
      }, 120);
    };

    void (async () => {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken || disposed) return;

      await supabase.realtime.setAuth(accessToken);
      if (disposed) return;

      channel = supabase.channel(
        `connections_pending_collab:${user.id}:${pendingCreatorCollabSessionKey}`,
      );

      for (const sessionId of pendingCreatorCollabSessionIds) {
        channel
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "session_participants",
              filter: `session_id=eq.${sessionId}`,
            },
            (payload) => refreshPendingCreatorChats(payload.new),
          )
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "session_participants",
              filter: `session_id=eq.${sessionId}`,
            },
            (payload) => refreshPendingCreatorChats(payload.new),
          )
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "collaboration_invites",
              filter: `session_id=eq.${sessionId}`,
            },
            (payload) => refreshPendingCreatorChats(payload.new),
          );
      }

      channel.subscribe();
    })().catch((realtimeError) => {
      console.warn("[ConnectionsPage] pending collab realtime subscribe failed:", realtimeError);
    });

    return () => {
      disposed = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [
    fetchConversations,
    onRefreshSessions,
    pendingCreatorCollabSessionIds,
    pendingCreatorCollabSessionKey,
    showToast,
    user?.id,
  ]);

  // ── Unread count reporting ───────────────────────────────
  useEffect(() => {
    const totalUnread = conversations.reduce((sum, conv) => {
      const isMuted = conv.participants?.some((p) => mutedUserIds.includes(p.id));
      return sum + (isMuted ? 0 : (conv.unread_count || 0));
    }, 0);
    onUnreadCountChange?.(totalUnread);
  }, [conversations, onUnreadCountChange, mutedUserIds]);

  // ORCH-0600: handleInvitePress + link-outline button deleted (dead weight per
  // user directive). Clipboard import removed. mixpanelService.trackReferralLinkShared
  // has no other caller in this file after deletion.

  const openFriendsModal = (tab?: FriendsModalTab) => {
    HapticFeedback.light();
    dismissKeyboard();
    setFriendsModalTab(tab ?? "friend-list");
    setShowBlockedView(false);
    setShowFriendsModal(true);
    setBadgeDismissed(true);
  };

  // ── Auto-open panel from external navigation (e.g. Profile "Friends" stat) ──
  // Guard with isTabVisible: in tab-based layout the component stays mounted while hidden.
  // isTabVisible is undefined in switch-case layout (always visible when rendered).
  useEffect(() => {
    if (initialPanel && isTabVisible !== false) {
      setShowFriendsModal(true);
      setFriendsModalTab("friend-list");
      setShowBlockedView(initialPanel === "blocked");
      // Issue #4114: "add" now opens the one Add a friend sheet over the friends sheet.
      if (initialPanel === "add") setShowAddFriendSheet(true);
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

  // ORCH-0987 unify: the legacy friends-modal action handlers (mute/remove/block/report
  // FromModal) were removed — the friends-modal ⋮ now routes through the shared
  // FriendActionsSheet (single owner). Block/Report state + modals remain (used by other
  // entry points). Issue #4114: pair / unpair live in that sheet too (the row Pair button left).

  // ── Transform message from DirectMessage to MessageInterface format ──
  const transformMessage = useCallback(
    (msg: DirectMessage, userId: string): Message => ({
      id: msg.id,
      // Issue #4114: the merge key that pairs the optimistic bubble, the insert
      // response, the realtime echo and every refresh.
      clientId: msg.client_id ?? undefined,
      senderId: msg.sender_id ?? '',
      senderName: msg.sender_name || "Unknown",
      content: msg.content,
      timestamp: msg.created_at,
      type: msg.message_type,
      fileUrl: msg.file_url,
      fileName: msg.file_name,
      fileSize: msg.file_size?.toString(),
      cardPayload: msg.card_payload,  // ORCH-0667
      mentions: msg.mentions,
      cardTags: msg.card_tags,
      marketingCampaignId: msg.marketing_campaign_id ?? null,
      isMe: msg.sender_id === userId,
      unread: !msg.is_read && msg.sender_id !== userId,
      isRead: msg.is_read ?? false,
      replyToId: msg.reply_to_id ?? undefined,
      isSystem: msg.isSystem,
      // ORCH-1058B: surface the structured collab dead-end payload so the
      // renderer draws chips + a tappable button FROM DATA. Only a
      // `collab_dead_end` card_payload qualifies; every other system row (e.g.
      // ORCH-0908 card messages) leaves this undefined and renders unchanged.
      systemPayload:
        msg.card_payload && (msg.card_payload as { kind?: string }).kind === 'collab_dead_end'
          ? (msg.card_payload as unknown as CollabDeadEndBannerPayload)
          : undefined,
    }),
    []
  );

  // ── Persist messages to AsyncStorage (fire-and-forget) ──
  const persistMessages = useCallback(
    (conversationId: string, msgs: Message[]) => {
      // Only persist real, successfully-sent messages — exclude optimistic
      // temp messages and failed messages (ghost messages across sessions)
      // Issue #4114: `msgs` is the merged store (deduped, time-sorted).
      const persistable = msgs
        .filter((m) => !isLocalMessage(m) && !m.failed)
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
          // Issue #4114: older builds could persist duplicate rows; hydrate
          // through the merge so a cached chat shows each message once.
          if (Array.isArray(parsed) && parsed.length > 0) return mergeMessages([], parsed as Message[]);
        }
      } catch (e) {
        console.warn("[ConnectionsPage] Message cache hydration failed:", e);
      }
      return [];
    },
    []
  );

  // ── Issue #4114: the single write path for chat messages ──
  // Every source (send result, retry, realtime echo, broadcast, background
  // refresh, reconnect refresh, AsyncStorage hydrate, older pages) lands here.
  // Writes are keyed by conversation, so a late event for chat A can never
  // land in chat B's list.
  const writeConversationMessages = useCallback(
    (conversationId: string, incoming: Message[], options?: MergeMessagesOptions) => {
      setMessagesCache((prev) => ({
        ...prev,
        [conversationId]: mergeMessages(prev[conversationId] ?? EMPTY_MESSAGES, incoming, options),
      }));
    },
    []
  );

  // Issue #4114: record whether older history exists after a server read of the newest page.
  const noteNewestPageLoaded = useCallback((conversationId: string, hasMore: boolean) => {
    setOlderPaging((prev) =>
      prev.conversationId === conversationId && prev.loading
        ? prev
        : { conversationId, hasMore, loading: false }
    );
  }, []);

  // ── Select conversation from chat list ───────────────────
  const handleSelectConversation = async (conversation: Conversation) => {
    if (!user?.id) return;

    const conversationMeta = conversation as Conversation & {
      type?: 'direct' | 'group';
      name?: string | null;
      session_id?: string | null;
      event_id?: string | null;
      linked_entity_type?: 'direct' | 'session' | 'trip' | 'event';
      sessionCreatorId?: string | null;
      eventBrandName?: string | null;
      eventBrandAccountId?: string | null;
      eventCoverMediaUrl?: string | null;
      eventPublicUrl?: string | null;
      eventPublicCard?: BusinessEventCard | null;
      is_broadcast_only?: boolean;
      isPendingCreatorCollab?: boolean;
      __pendingCollabChat?: PendingCollabChatDetails;
    };
    const isGroupConversation = conversationMeta.type === 'group';
    if (conversationMeta.isPendingCreatorCollab && conversationMeta.__pendingCollabChat) {
      HapticFeedback.light();
      setPendingCollabChat(conversationMeta.__pendingCollabChat);
      return;
    }
    const otherParticipant = conversation.participants.find((p) => p.id !== user.id);
    let rawName = isGroupConversation
      ? conversationMeta.name?.trim() || ''
      : getDisplayName(otherParticipant);
    let sessionCreatorId = isGroupConversation ? conversationMeta.sessionCreatorId ?? null : null;
    let eventBrandName = isGroupConversation ? conversationMeta.eventBrandName ?? null : null;
    let eventBrandAccountId = isGroupConversation ? conversationMeta.eventBrandAccountId ?? null : null;
    let eventCoverMediaUrl = isGroupConversation ? conversationMeta.eventCoverMediaUrl ?? null : null;
    let eventPublicUrl = isGroupConversation ? conversationMeta.eventPublicUrl ?? null : null;
    let eventPublicCard = isGroupConversation ? conversationMeta.eventPublicCard ?? null : null;

    if (isGroupConversation && (!rawName || !sessionCreatorId) && conversationMeta.session_id) {
      try {
        const { data: session } = await supabase
          .from('collaboration_sessions')
          .select('name, created_by')
          .eq('id', conversationMeta.session_id)
          .maybeSingle();
        rawName = rawName || session?.name?.trim() || '';
        sessionCreatorId = session?.created_by ?? sessionCreatorId;
      } catch (e) {
        console.warn('[ConnectionsPage] Failed to resolve group chat session name:', e);
      }
    }

    if (
      isGroupConversation &&
      conversationMeta.event_id &&
      (conversationMeta.linked_entity_type === 'trip' || conversationMeta.linked_entity_type === 'event')
    ) {
      try {
        const eventMeta = (await fetchGroupEventMetaByIds([conversationMeta.event_id])).get(conversationMeta.event_id);
        rawName = eventMeta?.title?.trim() || rawName;
        eventBrandName = eventMeta?.brandName ?? eventBrandName;
        eventBrandAccountId = eventMeta?.brandAccountId ?? eventBrandAccountId;
        eventCoverMediaUrl = eventMeta?.coverMediaUrl ?? eventCoverMediaUrl;
        eventPublicUrl = buildGroupEventPublicUrl(eventMeta, conversationMeta.linked_entity_type) ?? eventPublicUrl;
        eventPublicCard = eventMeta?.publicCard
          ? {
              ...eventMeta.publicCard,
              publicBuyerUrl: eventPublicUrl ?? eventMeta.publicCard.publicBuyerUrl,
            }
          : eventPublicCard;
      } catch (e) {
        console.warn('[ConnectionsPage] Failed to resolve group chat event metadata:', e);
      }
    }

    if (isGroupConversation && !rawName) {
      rawName = 'Collaboration chat';
    }

    // Clean email-like names
    const cleanedName = !isGroupConversation && rawName.includes("@")
      ? rawName.substring(0, rawName.indexOf("@")).trim()
      : rawName;

    const friend: Friend = {
      id: isGroupConversation ? conversation.id : otherParticipant?.id || "",
      name: cleanedName,
      username: isGroupConversation ? "group" : otherParticipant?.username || "unknown",
      avatar: isGroupConversation ? undefined : otherParticipant?.avatar_url,
      status: "offline",
      isOnline: isGroupConversation ? false : otherParticipant?.is_online || false,
      conversationType: isGroupConversation ? 'group' : 'direct',
      sessionId: conversationMeta.session_id ?? null,
      eventId: conversationMeta.event_id ?? null,
      linkedEntityType: conversationMeta.linked_entity_type ?? null,
      sessionCreatorId,
      eventBrandName,
      eventBrandAccountId,
      eventCoverMediaUrl,
      eventPublicUrl,
      eventPublicCard,
      isBroadcastOnly: Boolean(conversationMeta.is_broadcast_only),
      isSessionAdmin: isGroupConversation ? sessionCreatorId === user.id : undefined,
      participantCount: isGroupConversation ? conversation.participants.length : undefined,
      participants: isGroupConversation
        ? conversation.participants.map((p) => ({
            id: p.id,
            name: getDisplayName(p, p.username || 'User'),
            username: p.username,
            avatar_url: p.avatar_url,
            is_online: p.is_online,
          }))
        : undefined,
    };

    // Synchronous block check from cached blocked-users list (React Query).
    // No network call — tap opens immediately. Server RLS enforces at send time.
    const isBlockedByMe = isGroupConversation ? false : blockedUsers.some((b) => b.id === friend.id);
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
    if (!isGroupConversation) {
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
    }

    setCurrentConversationId(conversation.id);

    // ── Offline-resilient message loading ──────────────────
    // Priority: in-memory store → AsyncStorage cache → network fetch.
    // Always open the chat immediately with whatever we have, then refresh in
    // background. Issue #4114: the refresh MERGES into the store (it no longer
    // replaces it), so a send still in flight survives it.
    const inMemoryCached = messagesCache[conversation.id];
    let initialMessages: Message[] = inMemoryCached ?? EMPTY_MESSAGES;

    if (!inMemoryCached || inMemoryCached.length === 0) {
      // Try AsyncStorage before hitting network
      const storageCached = await hydrateMessages(conversation.id);
      if (storageCached.length > 0) {
        initialMessages = storageCached;
        writeConversationMessages(conversation.id, storageCached);
      }
    }

    setShowMessageInterface(true);
    if (initialMessages.length > 0) {
      markConversationAsRead(conversation.id, user.id, initialMessages);
    }

    const capturedConvId = conversation.id;
    const openedChatId = friend.id;
    withTimeout(
      messagingService.getMessages(conversation.id, user.id),
      8000,
      'getMessages'
    )
      .then(({ messages: freshMsgs, error: msgError, hasMore }) => {
        if (msgError) {
          console.error("Error loading messages:", msgError);
          return;
        }
        const transformed = (freshMsgs || []).map((m) => transformMessage(m, user.id));
        writeConversationMessages(capturedConvId, transformed, { snapshot: { complete: !hasMore } });
        noteNewestPageLoaded(capturedConvId, hasMore);
        // Only mark read while this chat is still the one on screen.
        if (latestSelectedChatRef.current === openedChatId) {
          markConversationAsRead(capturedConvId, user.id, transformed);
        }
      })
      .catch((e) => {
        // Offline / timeout — the chat is already open with whatever was cached.
        console.warn("[ConnectionsPage] Background message refresh failed (offline?):", e);
      });

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

    // Open chat UI immediately — conversation creation happens in background.
    // Issue #4114: clear the open conversation so no other chat's list shows.
    setCurrentConversationId(null);
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
      if (storageCached.length > 0) {
        writeConversationMessages(cachedConv.id, storageCached);
      }
      if (!isOffline) {
        setupRealtimeSubscription(cachedConv.id, currentUserId);
      }
      return true;
    };

    // Helper: load messages for a conversation in the background
    const loadMessagesInBackground = (conversationId: string) => {
      // The open chat reads the in-memory store directly (Issue #4114).
      const inMemoryCached = messagesCache[conversationId];
      if (inMemoryCached && inMemoryCached.length > 0) {
        if (latestSelectedChatRef.current !== capturedFriendId) return;
        markConversationAsRead(conversationId, currentUserId, inMemoryCached);
      }

      // Try AsyncStorage cache — merged, so it can never wipe a newer write.
      hydrateMessages(conversationId).then((storageCached) => {
        if (latestSelectedChatRef.current !== capturedFriendId) return;
        if (!inMemoryCached?.length && storageCached.length > 0) {
          writeConversationMessages(conversationId, storageCached);
          markConversationAsRead(conversationId, currentUserId, storageCached);
        }
      });

      // Fetch fresh from network in background
      withTimeout(
        messagingService.getMessages(conversationId, currentUserId),
        8000,
        'getMessages'
      )
        .then(({ messages: freshMsgs, error: msgError, hasMore }) => {
          if (msgError || !freshMsgs) {
            if (msgError) console.warn("[ConnectionsPage] Background message fetch failed:", msgError);
            return;
          }
          const transformed = freshMsgs.map((m) => transformMessage(m, currentUserId));
          writeConversationMessages(conversationId, transformed, { snapshot: { complete: !hasMore } });
          noteNewestPageLoaded(conversationId, hasMore);
          if (latestSelectedChatRef.current !== capturedFriendId) return;
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
    setCurrentConversationId(null);
  }, [openDirectMessageWithUserId, user?.id, showMessageInterface, activeChat?.id]);

  // ── Issue #4114: `mingla://connections?tab=requests` (send-pair-request and
  // send-friend-request-email pushes, and a friend invite link opened by a
  // signed-in user) opens the friends sheet on Requests. ─────────────────────
  useEffect(() => {
    if (!deepLinkParams || deepLinkParams.tab !== 'requests') return;
    setFriendsModalTab("requests");
    setShowBlockedView(false);
    setShowFriendsModal(true);
    setBadgeDismissed(true);
    onDeepLinkHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one handoff per deep link
  }, [deepLinkParams]);

  // ── Open trip/event group chat from deep links ───────────────────────────
  useEffect(() => {
    if (!deepLinkParams || !user?.id) return;
    if (deepLinkParams.tab !== 'messages') return;

    let cancelled = false;
    (async () => {
      try {
        let conversationId = deepLinkParams.conversationId ?? null;
        if (!conversationId && deepLinkParams.claimPendingTripChats === 'true') {
          const { conversations: claimed, error } = await messagingService.claimPendingTripChats(
            deepLinkParams.claimToken || undefined,
          );
          if (error) throw new Error(error);
          conversationId = claimed[0]?.conversation_id ?? null;
        }

        let rawConversation = conversationId
          ? conversations.find((conv) => conv.id === conversationId)
          : null;

        if (!rawConversation && deepLinkParams.eventId) {
          const { conversation, error } =
            await messagingService.getOrCreateGroupConversationForEvent(deepLinkParams.eventId);
          if (error) throw new Error(error);
          if (conversation) {
            rawConversation = {
              id: conversation.id,
              created_by: conversation.created_by ?? '',
              created_at: conversation.created_at,
              participants: conversation.participants.map((p) => ({
                id: p.user_id,
                username: 'user',
              })),
              last_message: conversation.last_message as unknown as ConvMessage | undefined,
              unread_count: conversation.unread_count ?? 0,
              messages: [],
              type: conversation.type,
              name: conversation.name ?? 'Trip chat',
              event_id: conversation.event_id ?? deepLinkParams.eventId,
              linked_entity_type: conversation.linked_entity_type,
            } as Conversation;
          }
        }

        if (!rawConversation && deepLinkParams.sessionId) {
          // ORCH-1080: collab/session notifications resolve sessionId → the
          // session's group chat, mirroring the eventId branch above. The deck is
          // reached via the in-chat CTA (META-ORCH-0929). `session_id` +
          // `linked_entity_type:'session'` MUST be carried so MessageInterface
          // detects isCollabSessionGroupChat and surfaces that CTA.
          const { conversation, error } =
            await messagingService.getOrCreateGroupConversationForSession(
              deepLinkParams.sessionId,
            );
          if (error) throw new Error(error);
          if (conversation) {
            rawConversation = {
              id: conversation.id,
              created_by: conversation.created_by ?? '',
              created_at: conversation.created_at,
              participants: conversation.participants.map((p) => ({
                id: p.user_id,
                username: 'user',
              })),
              last_message: undefined,
              unread_count: 0,
              messages: [],
              type: conversation.type,
              name: conversation.name ?? 'Session chat',
              session_id: conversation.session_id ?? deepLinkParams.sessionId,
              linked_entity_type: conversation.linked_entity_type,
            } as Conversation;
          }
        }

        if (!cancelled && rawConversation) {
          await handleSelectConversation(rawConversation);
          onDeepLinkHandled?.();
        } else if (!cancelled) {
          // ORCH-1080 SC-5/SC-6: no conversation resolved (missing group chat for
          // the session, or a malformed link with no id/eventId). Land on the
          // Messages tab without crashing and clear the pending deep link so it
          // doesn't re-fire — no infinite spinner, no stuck deepLinkParams.
          onDeepLinkHandled?.();
        }
      } catch (err) {
        console.warn('[ConnectionsPage] Failed to open trip/event chat deep link:', err);
        if (!cancelled) onDeepLinkHandled?.();
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- conversations read once per deep-link handoff
  }, [deepLinkParams, user?.id]);

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
      //    updates immediately (don't wait for the next fetchConversations).
      //    Issue #4114: opening a chat also clears a private "marked unread".
      const wasMarkedUnread = Boolean(
        (conversationsForOpenDmRef.current.find((conv) => conv.id === conversationId) as ChatListItemConversation | undefined)
          ?.marked_unread_at,
      );
      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === conversationId
            ? ({ ...conv, unread_count: 0, marked_unread_at: null } as Conversation)
            : conv
        )
      );
      if (wasMarkedUnread) {
        void messagingService.setConversationListState(conversationId, 'mark_read').then((result) => {
          if (result.error) console.warn('[ConnectionsPage] clearing marked-unread failed', result.error);
        });
      }
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
          const { messages: freshMsgs, error: msgError, hasMore } =
            await messagingService.getMessages(currentConversationId, user.id);
          if (msgError) {
            console.warn("[ConnectionsPage] Reconnection refresh failed:", msgError);
            return;
          }
          if (freshMsgs) {
            const transformed = freshMsgs.map((m) => transformMessage(m, user.id));
            // Issue #4114: merge, never replace — pending sends survive the refresh.
            writeConversationMessages(currentConversationId, transformed, { snapshot: { complete: !hasMore } });
            noteNewestPageLoaded(currentConversationId, hasMore);
            markConversationAsRead(currentConversationId, user.id, transformed);
          }
        } catch (e) {
          console.warn("[ConnectionsPage] Reconnection refresh failed:", e);
        }
      })();

      // Also refresh the conversations list
      fetchConversations(user.id);
    }
  }, [isOffline, currentConversationId, user?.id, transformMessage, markConversationAsRead, fetchConversations, writeConversationMessages, noteNewestPageLoaded]);

  /**
   * ORCH-0664 (I-DEDUP-AFTER-DELIVERY): single owner for incoming-message UI
   * state mutation. Both delivery paths funnel here:
   *   1. broadcast (chat:${id}) via useBroadcastReceiver → MessageInterface
   *      → onBroadcastReceive prop → handleBroadcastReceive → THIS HELPER
   *   2. postgres_changes (conversation:${id}) via subscribeToConversation
   *      .onMessage → THIS HELPER
   *
   * The seen-set add is INSIDE this helper, AFTER the store write, to satisfy
   * the invariant. Issue #4114: the write is `writeConversationMessages`, which
   * merges by `clientId || id` — idempotent, so whichever path wins the race
   * (broadcast, postgres_changes echo, or the sender's own insert response)
   * the message shows exactly once. The old sender + text + 5-second guess is
   * gone; the client id pairs the echo with the optimistic bubble.
   *
   * Sender-side L1907-area `broadcastSeenIds.current.add(sentMessage.id)` is
   * the documented exception to I-DEDUP-AFTER-DELIVERY (sender already mutated
   * UI via optimistic-replace). DO NOT touch it.
   */
  const addIncomingMessageToUI = useCallback(
    (newMessage: DirectMessage, conversationId: string, userId: string) => {
      // Store write ALWAYS runs: mergeMessages is idempotent by
      // `clientId || id`, so a second delivery of the same row is a no-op and
      // the sender's own echo replaces its optimistic bubble in place.
      writeConversationMessages(conversationId, [transformMessage(newMessage, userId)]);

      // Couple the seen-set add to the successful store write.
      // I-DEDUP-AFTER-DELIVERY: never populate the seen-set without
      // a corresponding visible-messages write.
      broadcastSeenIds.current.add(newMessage.id);

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

      // Auto-mark as read ALWAYS runs (chat is open by precondition)
      if (newMessage.sender_id !== userId) {
        messagingService.markAsRead([newMessage.id], userId).catch(console.error);
      }
    },
    [transformMessage, writeConversationMessages]
  );

  // ORCH-0664: callback passed to MessageInterface as `onBroadcastReceive`.
  // useBroadcastReceiver invokes it when a friend's message arrives via the
  // chat:{conversationId} broadcast channel; we delegate to the single owner.
  const handleBroadcastReceive = useCallback(
    (msg: DirectMessage) => {
      if (!currentConversationId || !user?.id) return;
      addIncomingMessageToUI(msg, currentConversationId, user.id);
    },
    [currentConversationId, user?.id, addIncomingMessageToUI]
  );

  // ── Realtime subscription setup ──────────────────────────
  const setupRealtimeSubscription = (conversationId: string, userId: string) => {
    // Issue #4114: release the conversation that is ACTUALLY subscribed (it used
    // to unsubscribe `conversationId`, the one being opened, which left the
    // previous chat's channel running).
    conversationChannelRef.current = switchConversationSubscription(
      subscribedConversationIdRef,
      conversationId,
      messagingService,
      (nextConversationId) => messagingService.subscribeToConversation(
      nextConversationId,
      userId,
      {
        onMessage: (newMessage: DirectMessage) => {
          // ORCH-0664: delegate to single owner. Both delivery paths
          // (broadcast + postgres_changes) funnel here.
          addIncomingMessageToUI(newMessage, conversationId, userId);
        },

        // Read receipt flow: when the receiver marks a message as read,
        // the sync_message_read_status trigger sets is_read=true on the
        // messages row, which fires a postgres_changes UPDATE event.
        // This callback updates the sender's UI with the read state.
        onMessageUpdated: (updatedMessage: DirectMessage) => {
          const transformed = transformMessage(updatedMessage, userId);
          // Issue #4114: an UPDATE only patches a row the chat already holds
          // (read receipts, edits); it never adds one.
          setMessagesCache((prev) => {
            const existing = prev[conversationId] || EMPTY_MESSAGES;
            const known = existing.some((msg) =>
              msg.id === transformed.id || (!!transformed.clientId && msg.clientId === transformed.clientId)
            );
            if (!known) return prev;
            return { ...prev, [conversationId]: mergeMessages(existing, [transformed]) };
          });
        },
      }
    ));
  };

  const handleCancelPendingCollabChat = useCallback(async () => {
    if (!user?.id || !pendingCollabChat) return;
    Alert.alert(
      "Cancel chat?",
      `Cancel "${pendingCollabChat.sessionName}" and remove all pending invites?`,
      [
        { text: "Keep waiting", style: "cancel" },
        {
          text: "Cancel chat",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setPendingCollabWorking(true);
              try {
                await supabase
                  .from("collaboration_invites")
                  .delete()
                  .eq("session_id", pendingCollabChat.sessionId);

                const { error: pendingPhoneInviteCancelError } = await supabase
                  .from("pending_session_invites")
                  .update({ status: "cancelled" })
                  .eq("session_id", pendingCollabChat.sessionId)
                  .eq("status", "pending");
                if (pendingPhoneInviteCancelError) throw pendingPhoneInviteCancelError;

                await supabase
                  .from("session_participants")
                  .delete()
                  .eq("session_id", pendingCollabChat.sessionId)
                  .neq("user_id", user.id);

                const { error: sessionDeleteError } = await supabase
                  .from("collaboration_sessions")
                  .delete()
                  .eq("id", pendingCollabChat.sessionId);
                if (sessionDeleteError) throw sessionDeleteError;

                await supabase
                  .from("conversations")
                  .delete()
                  .eq("id", pendingCollabChat.conversationId);

                setConversations((prev) =>
                  prev.filter((conversation) => conversation.id !== pendingCollabChat.conversationId),
                );
                setPendingCollabChat(null);
                showToast({ message: "Chat canceled.", type: "info" });
                await onRefreshSessions?.({ showLoading: false });
                await fetchConversations(user.id);
              } catch (error) {
                console.error("[ConnectionsPage] Failed to cancel pending collab chat:", error);
                showToast({ message: "Could not cancel the chat. Please try again.", type: "error" });
              } finally {
                setPendingCollabWorking(false);
              }
            })();
          },
        },
      ],
    );
  }, [fetchConversations, onRefreshSessions, pendingCollabChat, showToast, user?.id]);

  const handleRevokePendingCollabInvite = useCallback(async (person: PendingCollabChatPerson) => {
    if (!user?.id || !pendingCollabChat || person.status !== "pending") return;
    setPendingCollabWorking(true);
    try {
      if (person.inviteKind === "cold") {
        if (!person.inviteId) throw new Error("Missing phone invite id");
        const { error } = await supabase
          .from("pending_session_invites")
          .update({ status: "cancelled" })
          .eq("id", person.inviteId)
          .eq("session_id", pendingCollabChat.sessionId);
        if (error) throw error;
      } else {
        if (person.inviteId) {
          const { error: inviteError } = await supabase
            .from("collaboration_invites")
            .delete()
            .eq("id", person.inviteId)
            .eq("session_id", pendingCollabChat.sessionId);
          if (inviteError) throw inviteError;
        } else {
          const { error: inviteError } = await supabase
            .from("collaboration_invites")
            .delete()
            .eq("session_id", pendingCollabChat.sessionId)
            .eq("invited_user_id", person.id)
            .eq("status", "pending");
          if (inviteError) throw inviteError;
        }

        const { error: participantError } = await supabase
          .from("session_participants")
          .delete()
          .eq("session_id", pendingCollabChat.sessionId)
          .eq("user_id", person.id)
          .eq("has_accepted", false);
        if (participantError) throw participantError;
      }

      setPendingCollabChat((prev) =>
        prev?.sessionId === pendingCollabChat.sessionId
          ? { ...prev, people: prev.people.filter((candidate) => candidate.id !== person.id) }
          : prev,
      );
      showToast({ message: "Invite revoked.", type: "info" });
      await onRefreshSessions?.({ showLoading: false });
      await fetchConversations(user.id);
    } catch (error) {
      console.error("[ConnectionsPage] Failed to revoke pending collab invite:", error);
      showToast({ message: "Could not revoke that invite. Please try again.", type: "error" });
      throw error;
    } finally {
      setPendingCollabWorking(false);
    }
  }, [fetchConversations, onRefreshSessions, pendingCollabChat, showToast, user?.id]);

  // ── Back from MessageInterface ───────────────────────────
  const handleBackFromMessage = useCallback(() => {
    // Issue #4114: release whichever conversation is actually subscribed.
    releaseConversationSubscription(subscribedConversationIdRef, messagingService);
    conversationChannelRef.current = null;

    setShowMessageInterface(false);
    setActiveChat(null);
    setCurrentConversationId(null);
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

  const handleGroupSessionNameUpdated = useCallback((sessionId: string, newName: string) => {
    setActiveChat((prev) =>
      prev?.sessionId === sessionId ? { ...prev, name: newName } : prev
    );
    setConversations((prev) =>
      prev.map((conv) => {
        const meta = conv as Conversation & { session_id?: string | null; name?: string | null };
        return meta.session_id === sessionId ? { ...conv, name: newName } : conv;
      })
    );
  }, []);

  const handleGroupSessionRemoved = useCallback((_sessionId: string) => {
    handleBackFromMessage();
  }, [handleBackFromMessage]);

  // ── Issue #4114: one delivery path for a fresh send and a retry ──
  // The optimistic bubble is already in the store under its client id. The
  // insert carries the same client id, so the response, the realtime echo
  // (which usually lands first) and any refresh all merge into that one row.
  // A retry reuses the client id; the server's unique index turns a retry of a
  // send that already landed into a read of the original row.
  const deliverMessage = async (conversationId: string, pending: Message): Promise<void> => {
    if (!user?.id) return;
    const clientId = pending.clientId;
    if (!clientId) return;
    if (sendsInFlightRef.current.has(clientId)) return; // double tap on Retry
    sendsInFlightRef.current.add(clientId);

    const markFailed = () => {
      // Ignored by the merge if the server already confirmed this client id.
      writeConversationMessages(conversationId, [{ ...pending, failed: true }]);
    };

    try {
      if (
        pending.type !== "text" &&
        pending.type !== "image" &&
        pending.type !== "video" &&
        pending.type !== "file"
      ) {
        throw new Error(`Unsupported message type for send: ${pending.type}`);
      }
      const mentionEntries = (pending.mentions ?? []).filter(
        (mention): mention is MentionEntry => typeof mention !== "string"
      );
      const parsedFileSize = pending.fileSize ? Number(pending.fileSize) : undefined;

      const { message: sentMessage, error: sendError } =
        await messagingService.sendMessage(
          conversationId,
          user.id,
          pending.content,
          pending.type,
          pending.fileUrl,
          pending.fileName,
          parsedFileSize !== undefined && Number.isFinite(parsedFileSize) ? parsedFileSize : undefined,
          pending.replyToId,
          mentionEntries,
          pending.cardTags ?? [],
          clientId,
        );

      if (sendError || !sentMessage) {
        console.error("Error sending message:", sendError);

        // Mark optimistic message as failed (not removed — user sees tap-to-retry)
        markFailed();

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

      // Confirmation: the server row replaces the optimistic bubble by client id
      // (and shows the server's time). If the echo already did it, this is a no-op.
      writeConversationMessages(conversationId, [transformMessage(sentMessage, user.id)]);

      // Update conversation with real message
      setConversations((prev) =>
        prev.map((conv): Conversation => {
          if (conv.id === conversationId) {
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
        const channelName = `chat:${conversationId}`;
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
      // Mark as failed instead of removing — the bubble offers tap-to-retry.
      markFailed();
    } finally {
      sendsInFlightRef.current.delete(clientId);
    }
  };

  // ── Issue #4114: tap a failed bubble to send it again with the same client id ──
  const handleRetryMessage = (messageId: string) => {
    if (!currentConversationId || !user?.id) return;
    const failedMessage = (messagesCache[currentConversationId] ?? EMPTY_MESSAGES).find(
      (msg) => msg.id === messageId
    );
    if (!failedMessage || failedMessage.failed !== true || !isLocalMessage(failedMessage)) return;
    if (activeChatIsBlocked || (activeChat && blockedUsers.some((b) => b.id === activeChat.id))) {
      Alert.alert(
        t('connections:message_not_sent'),
        t('connections:message_blocked')
      );
      return;
    }
    const pending: Message = {
      ...failedMessage,
      clientId: failedMessage.clientId ?? createClientMessageId(),
      failed: false,
    };
    writeConversationMessages(currentConversationId, [pending]);
    void deliverMessage(currentConversationId, pending);
  };

  // ── Issue #4114: load older messages when the user scrolls to the top ──
  // Pages backwards from the oldest confirmed message (50 at a time) and merges
  // the page into the store, so nothing already on screen moves or repeats.
  const handleLoadOlderMessages = async () => {
    const conversationId = currentConversationId;
    if (!conversationId || !user?.id) return;
    if (olderPaging.conversationId !== conversationId || !olderPaging.hasMore || olderPaging.loading) return;
    if (olderLoadInFlightRef.current === conversationId) return;
    const loaded = messagesCache[conversationId] ?? EMPTY_MESSAGES;
    const before = oldestConfirmedTimestamp(loaded);
    if (!before) return;

    olderLoadInFlightRef.current = conversationId;
    setOlderPaging({ conversationId, hasMore: true, loading: true });
    try {
      const { messages: page, error, hasMore } = await messagingService.getMessages(
        conversationId,
        user.id,
        MESSAGE_PAGE_SIZE,
        before,
      );
      if (error) throw new Error(error);
      const transformed = page.map((m) => transformMessage(m, user.id));
      const loadedIds = new Set(loaded.map((m) => m.id));
      // The cursor is inclusive; a page with nothing new means we reached the start.
      const gotNew = transformed.some((m) => !loadedIds.has(m.id));
      writeConversationMessages(conversationId, transformed);
      setOlderPaging({ conversationId, hasMore: hasMore && gotNew, loading: false });
    } catch (e) {
      console.warn("[ConnectionsPage] Loading older messages failed:", e);
      setOlderPaging({ conversationId, hasMore: true, loading: false });
      showToast({ message: t('chat:olderMessagesFailed'), type: "error" });
    } finally {
      olderLoadInFlightRef.current = null;
    }
  };

  // ── Send message ─────────────────────────────────────────
  const handleSendMessage = async (
    content: string,
    type: "text" | "image" | "video" | "file",
    file?: any,
    replyToId?: string,
    mentions: MentionEntry[] = [],
    cardTags: CardTagEntry[] = [],
  ) => {
    if (!activeChat || !user?.id) return;

    // Issue #4114: minted before anything else and reused on every retry.
    const clientId = createClientMessageId();

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
        newConvId, user.id, content, type, firstFileUrl, firstFileName, firstFileSize, replyToId, mentions, cardTags, clientId
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

      // Add the sent message to the store (merged by client id)
      writeConversationMessages(newConvId, [transformMessage(sentMsg, user.id)]);
      noteNewestPageLoaded(newConvId, false);
      broadcastSeenIds.current.add(sentMsg.id);

      // Refresh conversations list to pick up the new conversation
      fetchConversations(user.id);

      return;
    }

    // ── Existing conversation ──
    const conversationId = currentConversationId;

    // Synchronous block check — uses cached list + background reconciliation state.
    // No network call on the send path. RLS enforces server-side as the real authority.
    if (activeChatIsBlocked || blockedUsers.some((b) => b.id === activeChat.id)) {
      Alert.alert(
        t('connections:message_not_sent'),
        t('connections:message_blocked')
      );
      return;
    }

    const tempId = `${LOCAL_MESSAGE_ID_PREFIX}${clientId}`;

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
        const filePath = `${conversationId}/${fileNameWithExt}`;

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

    // Issue #4114: stamp the optimistic time AFTER the upload, so a photo's
    // bubble sorts where the send actually happened. Once confirmed, the
    // server's created_at replaces it.
    const now = new Date().toISOString();

    // Optimistic message
    const optimisticMsg: Message = {
      id: tempId,
      clientId,
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
      mentions,
      cardTags,
      marketingCampaignId: null,
    };

    writeConversationMessages(conversationId, [optimisticMsg]);

    // Update conversation list optimistically
    setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id === conversationId) {
          return {
            ...conv,
            last_message: {
              id: tempId,
              conversation_id: conversationId,
              sender_id: user.id,
              content,
              message_type: type as "text" | "image" | "video" | "file" | "card",
              file_url: fileUrl,
              file_name: fileName,
              file_size: fileSize,
              mentions,
              card_tags: cardTags,
              marketing_campaign_id: null,
              created_at: now,
              sender_name: "Me",
              is_read: true,
            },
          };
        }
        return conv;
      })
    );

    await deliverMessage(conversationId, optimisticMsg);
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
  // ORCH-0666: handleSendCollabInvite + handleAddToBoardConfirm DELETED.
  // The Friends modal "Add to session" entry and the DM-path "Add to board"
  // entry both route through handleAddToBoard → AddToBoardModal → mutation hook.

  const handleAddToBoard = (friend: Friend) => {
    setSelectedFriendForBoard(friend);
    setShowAddToBoardModal(true);
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

  // ── Issue #4114 Wave 2a: the Chats list ──────────────────
  // One render path. The list keeps cached chats visible on error (inline
  // "Couldn't load chats · Try again" row), shows a slim offline bar, and the
  // shared modals below mount ONCE for every view (they used to be duplicated
  // per branch).
  const g = glass.discover;
  const HEADER_ROW_TOP = chatInsets.top + glass.chrome.row.topInset;
  const HEADER_ROW_HEIGHT = 48;
  const HEADER_PANEL_HEIGHT = HEADER_ROW_TOP + HEADER_ROW_HEIGHT + 8; // +8 breathing under the row
  const HEADER_PANEL_RADIUS = 28;
  const useGlass = !reduceTransparency && !isAndroidPreBlur;
  const incomingCount = incomingRequests.length + incomingPairRequests.length;
  const showBadge = !badgeDismissed && incomingCount > 0;
  const currentUserId = user?.id ?? "";
  const searchActive = normalizeSearchText(searchQuery).length > 0;

  const chattedUserIds = useMemo(() => {
    const ids = new Set<string>();
    for (const conversation of conversations) {
      if (conversation.type === "group") continue;
      for (const participant of conversation.participants) {
        if (participant.id !== currentUserId) ids.add(participant.id);
      }
    }
    return ids;
  }, [conversations, currentUserId]);

  const listItems = useMemo<ChatListRow[]>(
    () =>
      searchActive
        ? buildSearchItems<Conversation, UseFriend>({
            matchedChats: filteredConversations,
            friends: dbFriends,
            allConversations: conversations,
            currentUserId,
            query: searchQuery,
          })
        : buildBrowseItems<Conversation, UseFriend>({
            active: sortedConversations,
            archivedCount: archivedConversations.length,
            filter: chatFilter,
          }),
    [archivedConversations.length, chatFilter, conversations, currentUserId, dbFriends, filteredConversations, searchActive, searchQuery, sortedConversations],
  );
  const listLayouts = useMemo(() => chatListLayouts(listItems), [listItems]);
  const getItemLayout = useCallback(
    (_data: ArrayLike<ChatListRow> | null | undefined, index: number) => ({
      length: listLayouts[index]?.length ?? CHAT_ROW_HEIGHT,
      offset: listLayouts[index]?.offset ?? CHAT_ROW_HEIGHT * index,
      index,
    }),
    [listLayouts],
  );
  const archivedLayouts = useMemo(
    () => archivedConversations.map((_, index) => ({ length: CHAT_ROW_HEIGHT, offset: CHAT_ROW_HEIGHT * index })),
    [archivedConversations],
  );
  const getArchivedItemLayout = useCallback(
    (_data: ArrayLike<Conversation> | null | undefined, index: number) => ({
      length: CHAT_ROW_HEIGHT,
      offset: archivedLayouts[index]?.offset ?? CHAT_ROW_HEIGHT * index,
      index,
    }),
    [archivedLayouts],
  );

  // Stable row callbacks: the handlers read fresh state through a ref, so
  // React.memo'd rows only re-render when their own conversation changes.
  const rowHandlersRef = useRef({
    select: handleSelectConversation,
    pickFriend: handlePickFriend,
    togglePin: handleTogglePin,
    toggleUnread: handleToggleUnread,
    toggleMute: handleToggleMuteChat,
    archive: handleArchiveChat,
    unarchive: handleUnarchiveChat,
  });
  rowHandlersRef.current = {
    select: handleSelectConversation,
    pickFriend: handlePickFriend,
    togglePin: handleTogglePin,
    toggleUnread: handleToggleUnread,
    toggleMute: handleToggleMuteChat,
    archive: handleArchiveChat,
    unarchive: handleUnarchiveChat,
  };
  const onRowPress = useCallback((conversation: ChatListItemConversation) => {
    void rowHandlersRef.current.select(conversation as Conversation);
  }, []);
  const onRowTogglePin = useCallback((conversation: ChatListItemConversation) => {
    void rowHandlersRef.current.togglePin(conversation);
  }, []);
  const onRowToggleUnread = useCallback((conversation: ChatListItemConversation) => {
    void rowHandlersRef.current.toggleUnread(conversation);
  }, []);
  const onRowToggleMute = useCallback((conversation: ChatListItemConversation) => {
    void rowHandlersRef.current.toggleMute(conversation);
  }, []);
  const onRowArchive = useCallback((conversationId: string) => {
    void rowHandlersRef.current.archive(conversationId);
  }, []);
  const onRowUnarchive = useCallback((conversationId: string) => {
    void rowHandlersRef.current.unarchive(conversationId);
  }, []);

  const handleAcceptInvite = useCallback(async (sessionId: string, inviteId: string) => {
    setProcessingInviteIds((prev) => new Set(prev).add(inviteId));
    try {
      await onAcceptPendingInvite?.(sessionId, inviteId);
      if (user?.id) await fetchConversations(user.id);
    } finally {
      setProcessingInviteIds((prev) => {
        const next = new Set(prev);
        next.delete(inviteId);
        return next;
      });
    }
  }, [fetchConversations, onAcceptPendingInvite, user?.id]);

  const handleDeclineInvite = useCallback(async (sessionId: string, inviteId: string) => {
    setProcessingInviteIds((prev) => new Set(prev).add(inviteId));
    try {
      await onDeclinePendingInvite?.(sessionId, inviteId);
      if (user?.id) await fetchConversations(user.id);
    } finally {
      setProcessingInviteIds((prev) => {
        const next = new Set(prev);
        next.delete(inviteId);
        return next;
      });
    }
  }, [fetchConversations, onDeclinePendingInvite, user?.id]);

  const handleRetryLoad = useCallback(() => {
    setConversationsLoading(true);
    if (user?.id) void fetchConversations(user.id);
    fetchFriends();
    loadFriendRequests();
  }, [fetchConversations, fetchFriends, loadFriendRequests, user?.id]);

  const openNewMessage = useCallback(() => {
    HapticFeedback.light();
    Keyboard.dismiss();
    setShowNewMessageSheet(true);
  }, []);

  // Android back closes the archived list before leaving the tab.
  useEffect(() => {
    if (!showArchivedList || showMessageInterface) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setShowArchivedList(false);
      return true;
    });
    return () => sub.remove();
  }, [showArchivedList, showMessageInterface]);

  const chatActions: ChatRowAction[] = useMemo(() => {
    const target = chatActionsTarget;
    if (!target) return [];
    const close = (run: () => void, delay = 0) => () => {
      setChatActionsTarget(null);
      // Present-after-dismiss: an Alert or another sheet opens only once the
      // actions sheet has left (iOS presents one RN Modal at a time).
      setTimeout(run, delay);
    };
    const isGroup = target.type === "group";
    const isArchived = archivedIds.has(target.id);
    const other = target.participants.find((participant) => participant.id !== currentUserId);
    const isMuted = Boolean(other && mutedUserIds.includes(other.id));
    const marked = Boolean(target.marked_unread_at);
    const canToggleUnread = marked || (target.unread_count ?? 0) === 0;
    const actions: ChatRowAction[] = [
      {
        key: "pin",
        icon: target.pinned_at ? "pin-off-outline" : "pin-outline",
        label: target.pinned_at ? t("connections:action_unpin") : t("connections:action_pin"),
        onPress: close(() => void rowHandlersRef.current.togglePin(target)),
      },
    ];
    if (canToggleUnread) {
      actions.push({
        key: "unread",
        icon: marked ? "mail-open-outline" : "mail-outline",
        label: marked ? t("connections:action_mark_read") : t("connections:action_mark_unread"),
        onPress: close(() => void rowHandlersRef.current.toggleUnread(target)),
      });
    }
    if (!isGroup && other) {
      actions.push({
        key: "mute",
        icon: isMuted ? "notifications-outline" : "volume-mute",
        label: isMuted ? t("connections:action_unmute") : t("connections:action_mute"),
        onPress: close(() => void rowHandlersRef.current.toggleMute(target)),
      });
    }
    actions.push({
      key: "archive",
      icon: "archive-outline",
      label: isArchived ? t("connections:action_unarchive") : t("connections:action_archive"),
      onPress: close(() =>
        void (isArchived ? rowHandlersRef.current.unarchive(target.id) : rowHandlersRef.current.archive(target.id))),
    });
    actions.push({
      key: "remove",
      icon: isGroup ? "exit-outline" : "trash-outline",
      label: isGroup ? t("connections:action_leave") : t("connections:action_remove"),
      destructive: true,
      onPress: close(() => handleDeleteChat(target.id), 450),
    });
    return actions;
  }, [archivedIds, chatActionsTarget, currentUserId, handleDeleteChat, mutedUserIds, t]);

  const chatActionsTitle = chatActionsTarget
    ? chatActionsTarget.type === "group"
      ? chatActionsTarget.name?.trim() || t("connections:group_fallback_name")
      : getDisplayName(chatActionsTarget.participants.find((participant) => participant.id !== currentUserId))
    : "";

  const renderListItem = useCallback(
    ({ item, index }: { item: ChatListRow; index: number }) => {
      const previous = index > 0 ? listItems[index - 1] : null;
      const showSeparator = Boolean(previous && previous.kind !== "section");
      switch (item.kind) {
        case "section":
          return (
            <Text style={styles.sectionLabel} accessibilityRole="header" numberOfLines={1}>
              {t(`connections:section_${item.section}`)}
            </Text>
          );
        case "invite": {
          const invite = (item.conversation as Conversation & { __pendingInvite: PendingSessionInvite }).__pendingInvite;
          return (
            <PendingSessionInviteRow
              invite={invite}
              isProcessing={processingInviteIds.has(invite.inviteId)}
              onAccept={handleAcceptInvite}
              onDecline={handleDeclineInvite}
              showSeparator={showSeparator}
            />
          );
        }
        case "chat": {
          const conversation = item.conversation as ChatListItemConversation;
          const isMuted = conversation.participants?.some((p) => mutedUserIds.includes(p.id)) ?? false;
          return (
            <ChatListItem
              conversation={conversation}
              currentUserId={currentUserId}
              onPress={onRowPress}
              onLongPress={handleOpenChatActions}
              isMuted={isMuted}
              onToggleMute={onRowToggleMute}
              onArchive={onRowArchive}
              onTogglePin={onRowTogglePin}
              onToggleUnread={onRowToggleUnread}
              lifecycleBusy={lifecycleBusyIds.has(conversation.id)}
              showSeparator={showSeparator}
            />
          );
        }
        case "friend":
          return (
            <FriendSearchRow
              friend={item.friend}
              currentUserId={currentUserId}
              showSeparator={showSeparator}
              onStartChat={(friend) => void rowHandlersRef.current.pickFriend(friend)}
            />
          );
        case "archived":
          return (
            <Pressable
              onPress={() => {
                HapticFeedback.light();
                setShowArchivedList(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={t("connections:archived_row_a11y", { count: item.count })}
              style={({ pressed }) => [styles.archivedRow, pressed ? styles.rowPressed : null]}
              testID="chat-list-archived-row"
            >
              <Icon name="archive-outline" size={18} color={tokens.dim} />
              <Text style={styles.archivedRowLabel}>{t("connections:archived_row")}</Text>
              <Text style={styles.archivedRowCount}>{item.count}</Text>
              <Icon name="chevron-forward" size={16} color={tokens.faint} />
            </Pressable>
          );
        default: {
          const exhaustive: never = item;
          return exhaustive;
        }
      }
    },
    [
      currentUserId,
      handleAcceptInvite,
      handleDeclineInvite,
      handleOpenChatActions,
      lifecycleBusyIds,
      listItems,
      mutedUserIds,
      onRowArchive,
      onRowPress,
      onRowToggleMute,
      onRowTogglePin,
      onRowToggleUnread,
      processingInviteIds,
      t,
    ],
  );

  const renderArchivedItem = useCallback(
    ({ item, index }: { item: Conversation; index: number }) => {
      const conversation = item as ChatListItemConversation;
      const isMuted = conversation.participants?.some((p) => mutedUserIds.includes(p.id)) ?? false;
      return (
        <ChatListItem
          conversation={conversation}
          currentUserId={currentUserId}
          onPress={onRowPress}
          onLongPress={handleOpenChatActions}
          isMuted={isMuted}
          onToggleMute={onRowToggleMute}
          onArchive={onRowUnarchive}
          onTogglePin={onRowTogglePin}
          onToggleUnread={onRowToggleUnread}
          lifecycleBusy={lifecycleBusyIds.has(conversation.id)}
          isArchived
          showSeparator={index > 0}
        />
      );
    },
    [currentUserId, handleOpenChatActions, lifecycleBusyIds, mutedUserIds, onRowPress, onRowToggleMute, onRowTogglePin, onRowToggleUnread, onRowUnarchive],
  );

  const keyExtractor = useCallback((item: ChatListRow) => item.key, []);
  const archivedKeyExtractor = useCallback((item: Conversation) => item.id, []);

  const glassHeader = (title: string, actions: React.ReactNode, leading?: React.ReactNode) => (
    <View
      pointerEvents="box-none"
      style={[
        styles.headerPanel,
        {
          height: HEADER_PANEL_HEIGHT,
          borderBottomLeftRadius: HEADER_PANEL_RADIUS,
          borderBottomRightRadius: HEADER_PANEL_RADIUS,
        },
      ]}
    >
      {useGlass ? (
        <BlurView
          intensity={g.stickyHeader.blurIntensity}
          tint="dark"
          experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      ) : null}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: useGlass ? g.stickyHeader.tint : g.stickyHeader.fallbackSolid },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.headerPanelHairline,
          {
            borderBottomLeftRadius: HEADER_PANEL_RADIUS,
            borderBottomRightRadius: HEADER_PANEL_RADIUS,
          },
        ]}
      />
      <View style={[styles.headerRowAbsolute, { top: HEADER_ROW_TOP, height: HEADER_ROW_HEIGHT }]}>
        {leading}
        <Text style={styles.titleText} numberOfLines={1} allowFontScaling accessibilityRole="header">
          {title}
        </Text>
        <View style={styles.headerButtons}>{actions}</View>
      </View>
    </View>
  );

  // ORCH-1037: coach step 6 sits on the people-icon Pressable (leaf target);
  // issue #4114: step 7 sits on the pencil.
  const chatsHeaderActions = (
    <>
      <Pressable
        ref={coachPeopleIcon.targetRef as React.Ref<View>}
        collapsable={false}
        onPress={() => openFriendsModal()}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        accessibilityRole="button"
        accessibilityLabel={
          showBadge
            ? t('connections:people_button_a11y_badge', { count: incomingCount })
            : t('connections:people_button_a11y')
        }
        style={({ pressed }) => [styles.headerButton, pressed ? styles.headerButtonPressed : null]}
      >
        <Icon name="people-outline" size={17} color={tokens.ink} />
        {showBadge ? (
          <View style={styles.titleIconBadge}>
            <Text style={styles.titleIconBadgeText} allowFontScaling={false}>
              {incomingCount > 9 ? '9+' : String(incomingCount)}
            </Text>
          </View>
        ) : null}
      </Pressable>
      <Pressable
        ref={coachPlusButton.targetRef as React.Ref<View>}
        collapsable={false}
        onPress={openNewMessage}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        accessibilityRole="button"
        accessibilityLabel={t('connections:new_message_button_a11y')}
        style={({ pressed }) => [styles.headerButton, pressed ? styles.headerButtonPressed : null]}
        testID="chats-new-message-button"
      >
        <Icon name="create-outline" size={17} color={tokens.ink} />
      </Pressable>
    </>
  );

  const offlineBar = isOffline ? (
    <View style={styles.offlineBar} accessibilityLiveRegion="polite">
      <Icon name="cloud-offline-outline" size={14} color={tokens.dim} />
      <Text style={styles.offlineBarText} numberOfLines={1}>{t('connections:offline_bar')}</Text>
    </View>
  ) : null;

  const errorRow = error ? (
    <Pressable
      onPress={handleRetryLoad}
      accessibilityRole="button"
      accessibilityLabel={`${t('connections:error_inline')}, ${t('common:try_again')}`}
      style={styles.errorRow}
      testID="chat-list-error-row"
    >
      <Icon name="alert-circle-outline" size={16} color={tokens.errorLabel} />
      <Text style={styles.errorRowText} numberOfLines={1}>
        {t('connections:error_inline')}
        <Text style={styles.errorRowAction}>{` · ${t('common:try_again')}`}</Text>
      </Text>
    </Pressable>
  ) : null;

  const showSkeleton = conversationsLoading && conversations.length === 0 && !error;
  const listEmpty = showSkeleton ? (
    <ChatListSkeleton />
  ) : searchActive ? (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyTitle}>{t('connections:no_results', { query: searchQuery })}</Text>
    </View>
  ) : chatFilter !== "all" ? (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptySubtitle}>{t(`connections:filter_empty_${chatFilter}`)}</Text>
    </View>
  ) : error ? null : (
    <View style={styles.emptyContainer}>
      <Icon name="chatbubbles-outline" size={56} color={tokens.faint} />
      <Text style={styles.emptyTitle}>{t('connections:empty_title')}</Text>
      <Text style={styles.emptySubtitle}>{t('connections:empty_subtitle')}</Text>
      <Pressable
        onPress={openNewMessage}
        accessibilityRole="button"
        style={({ pressed }) => [styles.emptyCtaButton, pressed ? styles.headerButtonPressed : null]}
      >
        <Text style={styles.emptyCtaText}>{t('connections:start_chat')}</Text>
      </Pressable>
    </View>
  );

  let screen: React.ReactNode;
  if (showMessageInterface && activeChat) {
    screen = (
      <View style={styles.container}>
        <MessageInterface
          friend={activeChat}
          onBack={handleBackFromMessage}
          onSendMessage={handleSendMessage}
          messages={messages}
          onRetryMessage={handleRetryMessage}
          onLoadOlderMessages={handleLoadOlderMessages}
          hasOlderMessages={olderPaging.conversationId === currentConversationId && olderPaging.hasMore}
          isLoadingOlderMessages={olderPaging.conversationId === currentConversationId && olderPaging.loading}
          onOpenAddToBoardModal={(friend: Friend) => handleAddToBoard(friend)}
          onShareSavedCard={handleShareSavedCard}
          onRemoveFriend={handleRemoveFriend}
          onBlockUser={handleBlockUser}
          onReportUser={handleReportUser}
          accountPreferences={accountPreferences}
          onCardLike={onCardLike}
          onAddToCalendar={onAddToCalendar}
          onShareCard={onShareCard}
          onPurchaseComplete={onPurchaseComplete}
          userPreferences={userPreferences}
          savedCards={savedCards}
          onOpenPreferences={onOpenPreferences}
          onOpenCollabPreferences={onOpenCollabPreferences}
          isBlocked={activeChatIsBlocked}
          isUnfriended={activeChatIsUnfriended}
          isDeletedAccount={activeChatIsDeletedAccount}
          conversationId={currentConversationId}
          currentUserId={user?.id || null}
          currentUserName={currentUserDisplayName}
          broadcastSeenIds={broadcastSeenIds}
          onBroadcastReceive={handleBroadcastReceive}
          isOffline={isOffline}
          onViewProfile={onNavigateToFriendProfile}
          isPairedFriend={Boolean(activeChat?.id && pairedUserIds.has(activeChat.id))}
          onOpenPairedProfile={(friendUserId) => onNavigateToFriendProfile?.(friendUserId, { focus: "paired" })}
          onSessionNameUpdated={handleGroupSessionNameUpdated}
          onGroupSessionExited={handleGroupSessionRemoved}
          onGroupSessionDeleted={handleGroupSessionRemoved}
          onGroupParticipantsChange={() => {
            if (user?.id) fetchConversations(user.id);
          }}
        />
      </View>
    );
  } else if (showArchivedList) {
    screen = (
      <View style={styles.container}>
        {glassHeader(
          t('connections:archived_title'),
          null,
          <Pressable
            onPress={() => setShowArchivedList(false)}
            accessibilityRole="button"
            accessibilityLabel={t('connections:back_a11y')}
            hitSlop={8}
            style={styles.backButton}
            testID="chat-archived-back"
          >
            <Icon name="chevron-back" size={24} color={tokens.ink} />
          </Pressable>,
        )}
        <View style={[styles.content, { paddingTop: HEADER_PANEL_HEIGHT + CHAT_SEARCH_TOP_GAP }]}>
          {offlineBar}
          <FlatList
            data={archivedConversations}
            keyExtractor={archivedKeyExtractor}
            renderItem={renderArchivedItem}
            getItemLayout={getArchivedItemLayout}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: bottomNavTotalHeight + 24 }}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptySubtitle}>{t('connections:archived_empty')}</Text>
              </View>
            }
          />
        </View>
      </View>
    );
  } else {
    screen = (
      <View style={styles.container}>
        {glassHeader(t('connections:title'), chatsHeaderActions)}
        <View style={[styles.content, { paddingTop: HEADER_PANEL_HEIGHT + CHAT_SEARCH_TOP_GAP }]}>
          {offlineBar}
          <View style={styles.searchContainer}>
            <Icon name="search" size={16} color={tokens.faint} />
            <TextInput
              placeholder={t('connections:search_placeholder')}
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={styles.searchInput}
              placeholderTextColor={tokens.faint}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              autoComplete="off"
              returnKeyType="search"
              clearButtonMode="while-editing"
              accessibilityLabel={t('connections:search_placeholder')}
            />
          </View>
          {searchActive ? null : (
            <View style={styles.filterRow} accessibilityRole="tablist">
              {CHAT_FILTERS.map((filter) => {
                const selected = chatFilter === filter;
                return (
                  <Pressable
                    key={filter}
                    onPress={() => {
                      HapticFeedback.light();
                      setChatFilter(filter);
                    }}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    style={[styles.filterChip, selected ? styles.filterChipActive : null]}
                    testID={`chat-filter-${filter}`}
                  >
                    <Text style={[styles.filterChipText, selected ? styles.filterChipTextActive : null]}>
                      {t(`connections:filter_${filter}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          <FlatList
            data={showSkeleton ? [] : listItems}
            keyExtractor={keyExtractor}
            renderItem={renderListItem}
            getItemLayout={getItemLayout}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            initialNumToRender={12}
            windowSize={9}
            ListHeaderComponent={errorRow}
            ListEmptyComponent={listEmpty}
            contentContainerStyle={[
              styles.chatListContent,
              { paddingBottom: bottomNavTotalHeight + 24 },
            ]}
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={tokens.faint} />}
          />
        </View>
      </View>
    );
  }

  return (
    <>
      {screen}

      {/* ORCH-0435: Consolidated 4-tab Friends Modal.
          META-ORCH-0991 Wave C: RN <Modal> + hand-rolled useKeyboard sheet-height
          → light BaseBottomSheet, fixed ['88%'] snap, scroll body, wrapInRNModal
          (mounts under the floating GlassBottomNav — Batch-2 z-trap). gorhom owns
          keyboard coordination (AddFriendView field is a BottomSheetTextInput).
          Non-destructive picker → full swipe-down sheet (operator rule §1).
          §13 one-sheet-at-a-time gate: every child surface this page can open
          (action chooser, create-group, pair request, friend actions, friend
          picker) is itself a wrapInRNModal sheet; while one is open the friends
          sheet's RN-Modal window is dropped so two RN-Modal-backed surfaces never
          co-present on iOS. The row handlers already setShowFriendsModal(false)
          before opening a child; the gate makes that invariant structural. */}
      <BaseBottomSheet
        visible={showFriendsModal && !anyFriendsChildOpen}
        onClose={handleFriendsModalClose}
        snapPoints={FRIENDS_MODAL_SNAP as unknown as string[]}
        wrapInRNModal
        theme="dark"
        backgroundStyle={styles.friendsSheetBackground}
        scrollMode="scroll"
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
        accessibilityLabel={t('connections:fs_title')}
        header={
          <View style={styles.friendsSheetHeaderBlock}>
            <View style={styles.friendsSheetTitleRow}>
              <Pressable
                onPress={() => { dismissKeyboard(); setShowFriendsModal(false); }}
                accessibilityRole="button"
                accessibilityLabel={t('connections:fs_done')}
                hitSlop={8}
                style={styles.friendsSheetSide}
              >
                <Text style={styles.friendsSheetDone}>{t('connections:fs_done')}</Text>
              </Pressable>
              <Text style={styles.friendsSheetTitle} accessibilityRole="header" numberOfLines={1}>
                {t('connections:fs_title')}
              </Text>
              <Pressable
                onPress={openAddFriendSheet}
                accessibilityRole="button"
                accessibilityLabel={t('connections:af_title')}
                hitSlop={8}
                style={[styles.friendsSheetSide, styles.friendsSheetSideRight]}
              >
                <Text style={styles.friendsSheetAdd}>{t('connections:fs_add')}</Text>
              </Pressable>
            </View>

            {/* Two segmented tabs (design v6, D14). */}
            <View style={styles.friendsSegment} accessibilityRole="tablist">
              {(["friend-list", "requests"] as const).map((tab) => {
                const active = friendsModalTab === tab;
                const count = tab === "friend-list" ? dbFriends.length : receivedRows.length;
                const label = tab === "friend-list" ? t('connections:fs_tab_friends') : t('connections:fs_tab_requests');
                return (
                  <Pressable
                    key={tab}
                    onPress={() => { setFriendsModalTab(tab); setShowBlockedView(false); }}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={count > 0 ? `${label}, ${count}` : label}
                    style={[styles.friendsSegmentItem, active ? styles.friendsSegmentItemActive : null]}
                  >
                    <Text style={[styles.friendsSegmentText, active ? styles.friendsSegmentTextActive : null]}>
                      {tab === "friend-list" && count > 0 ? `${label} ${count}` : label}
                    </Text>
                    {tab === "requests" && count > 0 ? (
                      <View style={styles.friendsSegmentBadge}>
                        <Text style={styles.friendsSegmentBadgeText} allowFontScaling={false}>
                          {count > 9 ? '9+' : String(count)}
                        </Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        }
        scrollProps={{
          contentContainerStyle: styles.sheetBodyContent,
          keyboardShouldPersistTaps: "handled",
          keyboardDismissMode: "on-drag",
          showsVerticalScrollIndicator: false,
        }}
      >
        <View style={styles.sheetBodyInner}>
          {friendsModalTab === "friend-list" && showBlockedView ? (
            <BlockedUsersView
              blockedUsers={blockedUsers}
              loading={friendsLoading}
              onUnblock={handleUnblock}
              onBack={() => setShowBlockedView(false)}
            />
          ) : null}
          {friendsModalTab === "friend-list" && !showBlockedView ? (
            <FriendsManagementList
              friends={dbFriends}
              loading={friendsLoading}
              mutedUserIds={mutedUserIds}
              currentUserId={user?.id || ""}
              pairedPills={pairedPills}
              pairTile={pairTile}
              onPairTile={() => {
                // The + tile pairs someone; at the free limit it opens Mingla+.
                if (pairTile.atLimit) {
                  openPairingPaywall();
                  return;
                }
                setShowPairRequestModal(true);
              }}
              onOpenPaired={(friendUserId) => {
                setShowFriendsModal(false);
                onNavigateToFriendProfile?.(friendUserId, { focus: "paired" });
              }}
              onAvatarPress={(friendUserId) => {
                setShowFriendsModal(false);
                onNavigateToFriendProfile?.(friendUserId);
              }}
              onMessage={(friend) => {
                setShowFriendsModal(false);
                handlePickFriend(friend);
              }}
              onOpenFriendActions={(friend) => {
                // ORCH-0987 unify: close the friends modal, then present the shared
                // FriendActionsSheet after the dismiss settles. Presenting it in the
                // same tick the friends modal dismisses freezes iOS (present-during-
                // dismiss). The shared sheet owns every friend action (single owner).
                setShowFriendsModal(false);
                setTimeout(() => { setActionsFriend(friend); setActionsSheetVisible(true); }, 450);
              }}
              blockedCount={blockedUsers.length}
              onOpenBlocked={() => setShowBlockedView(true)}
            />
          ) : null}
          {friendsModalTab === "requests" ? (
            <RequestsView
              received={receivedRows}
              sent={sentRows}
              loading={friendsLoading || requestsLoading}
              busyKey={requestBusyKey}
              onAccept={(row) => void handleAcceptReceived(row)}
              onDecline={(row) => void handleDeclineReceived(row)}
              onCancelSent={(row) => void handleCancelSent(row)}
            />
          ) : null}
        </View>
      </BaseBottomSheet>

      {/* ORCH-1371 [add-friend-country-picker-hidden]: the add-friend country
          picker — SIBLING of the friends sheet (not a descendant), so it survives
          the §13 sheet drop and presents into the freed iOS slot. iOS presents
          only one RN <Modal> at a time; mirror of AccountSettings.tsx:638-683. */}
      <CountryPickerModal
        visible={addFriendPickerOpen}
        selectedCode={addFriendCountry.code}
        onSelect={handleAddFriendCountrySelect}
        onClose={() => setAddFriendPickerOpen(false)}
      />

      {/* Issue #4114 Wave 2b — the one Add a friend sheet. Same ORCH-1371
          pattern as the friends sheet: it drops while the sibling picker above
          is up (`visible` gated on addFriendPickerOpen) and the number, country
          and picker flag stay here, so they survive the drop. */}
      <AddFriendSheet
        visible={showAddFriendSheet && !addFriendPickerOpen}
        onSheetClose={handleAddFriendSheetClose}
        onDismiss={closeAddFriendSheet}
        currentUserId={user?.id || ""}
        selectedCountry={addFriendCountry}
        phoneNumber={addFriendPhone}
        onPhoneNumberChange={setAddFriendPhone}
        onOpenCountryPicker={() => setAddFriendPickerOpen(true)}
        pendingUserIds={pendingPairUserIds}
        pairingAtLimit={pairTile.atLimit}
        onMessageFriend={(friendUserId) => {
          const friend = dbFriends.find((f) => friendUserIdOf(f, user?.id ?? "") === friendUserId);
          setShowAddFriendSheet(false);
          setShowFriendsModal(false);
          if (friend) void handlePickFriend(friend);
        }}
        onSeePlus={() => {
          setShowAddFriendSheet(false);
          requestAnimationFrame(() => openPairingPaywall());
        }}
        onRequestSent={() => loadFriendRequests()}
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

      {/* Issue #4114 (D15): the pencil's New message sheet replaces the + chooser. */}
      <NewMessageSheet
        visible={showNewMessageSheet}
        onClose={() => setShowNewMessageSheet(false)}
        friends={dbFriends}
        loadingFriends={friendsLoading}
        currentUserId={currentUserId}
        chattedUserIds={chattedUserIds}
        onPickFriend={(friend) => {
          setShowNewMessageSheet(false);
          void handlePickFriend(friend);
        }}
        createGroupChatDisabled={!canCreateSession && !isUnlimited}
        onNewGroup={() => {
          setShowNewMessageSheet(false);
          requestAnimationFrame(() => setShowCreateGroupChatSheet(true));
        }}
        onNewGroupPaywall={() => {
          setShowNewMessageSheet(false);
          setPaywallFeature('session_creation');
          requestAnimationFrame(() => setShowPaywall(true));
        }}
        onAddFriend={() => {
          // Issue #4114 Wave 2b: the one Add a friend flow (add = pair).
          setShowNewMessageSheet(false);
          requestAnimationFrame(() => openAddFriendSheet());
        }}
      />

      <ChatRowActionsSheet
        visible={Boolean(chatActionsTarget)}
        title={chatActionsTitle}
        actions={chatActions}
        onClose={() => setChatActionsTarget(null)}
      />

      <CreateGroupChatSheet
        visible={showCreateGroupChatSheet}
        onClose={() => setShowCreateGroupChatSheet(false)}
        availableFriends={availableFriendsForCreate}
        isCreating={isCreatingGroupChat}
        onSubmit={async (sessionName, selectedFriends) => {
          if (!onCreateGroupChat) {
            throw new Error("Group chat creation is unavailable.");
          }
          return onCreateGroupChat(sessionName, selectedFriends);
        }}
        onCreated={(conversationId) => {
          setShowCreateGroupChatSheet(false);
          setConversations((prev) => prev.filter((conversation) => conversation.id !== conversationId));
          showToast({
            message: t('connections:group_invites_sent'),
            type: "info",
          });
          if (user?.id) {
            void fetchConversations(user.id);
          }
        }}
      />

      <PendingCollabChatSheet
        visible={Boolean(pendingCollabChat)}
        details={pendingCollabChat}
        currentUserId={user?.id || null}
        isWorking={pendingCollabWorking}
        onClose={() => {
          if (!pendingCollabWorking) setPendingCollabChat(null);
        }}
        onCancelChat={handleCancelPendingCollabChat}
        onRevokeInvite={handleRevokePendingCollabInvite}
        onPhoneInviteSettled={async () => {
          await loadFriendRequests();
          await onRefreshSessions?.({ showLoading: false });
          if (user?.id) await fetchConversations(user.id);
        }}
        onAddFriendRequest={addFriend}
      />

      {user?.id ? (
        <CustomPaywallScreen
          isVisible={showPaywall}
          onClose={() => setShowPaywall(false)}
          userId={user.id}
          feature={paywallFeature}
        />
      ) : null}

      {/* The paired section's + tile: pair with a friend you already have.
          Issue #4114: one confirmation (this toast) — the modal no longer also
          alerts — and the paywall on the pairing limit. */}
      <PairRequestModal
        visible={showPairRequestModal}
        onClose={() => setShowPairRequestModal(false)}
        onPairRequestSent={() => {
          setShowPairRequestModal(false);
          showToast({ message: t('connections:pair_request_sent'), type: 'info' });
        }}
        onPairingLimitReached={() => {
          setShowPairRequestModal(false);
          requestAnimationFrame(() => openPairingPaywall());
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
        onPairingLimitReached={() => {
          setShowIncomingPairRequest(null);
          requestAnimationFrame(() => openPairingPaywall());
        }}
      />

      {/* ORCH-0666: AddToBoardModal must be mounted on the default-render branch
          so the Friends modal "Add to session" entry point can open it. */}
      <AddToBoardModal
        isOpen={showAddToBoardModal}
        onClose={() => {
          setShowAddToBoardModal(false);
          setSelectedFriendForBoard(null);
        }}
        friend={selectedFriendForBoard}
        boardsSessions={boardsSessions}
        onMutationSettled={() => {
          void onRefreshSessions?.();
        }}
        onResult={(result) => {
          if (selectedFriendForBoard) {
            emitAddToBoardToasts(
              result,
              { id: selectedFriendForBoard.id, name: selectedFriendForBoard.name || 'Friend' },
              (boardsSessions || []).map((s: any) => ({
                id: s.id || s.session_id,
                name: s.name || 'Session',
              }))
            );
          }
        }}
      />

      {/* ORCH-0987 unify: the friends-modal ⋮ routes here. Single shared menu for the
          friend profile + the Connections list (Constitution #2). */}
      {actionsFriend && (() => {
        const fid = actionsFriend.user_id === (user?.id || '')
          ? actionsFriend.friend_user_id
          : actionsFriend.user_id;
        const activePill = pairingPills.find(p => p.pairedUserId === fid && p.pillState === 'active');
        return (
          <FriendActionsSheet
            visible={actionsSheetVisible}
            onClose={() => {
              // Hide the sheet but KEEP it mounted (actionsFriend stays set) so an action's
              // sub-modal (AddToBoardModal/Block/Report) can present after the sheet hides.
              setActionsSheetVisible(false);
              // Mute lives in ConnectionsPage local state; the shared hook mutates it via
              // its own query, so re-pull on close to keep the list's mute icon in sync.
              fetchMutedUsers();
            }}
            friendUserId={fid}
            friendName={getDisplayName(actionsFriend)}
            friendUsername={actionsFriend.username ?? undefined}
            friendAvatarUrl={actionsFriend.avatar_url}
            pairingId={activePill?.pairingId ?? null}
            isPaired={pairedUserIds.has(fid)}
            isPending={pendingPairUserIds.has(fid)}
            isFriend={true}
          />
        );
      })()}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: glass.discover.screenBg,
  },
  content: {
    flex: 1,
  },

  // ── ORCH-0600: Glass header panel ────────────────────────
  headerPanel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    overflow: 'hidden',
  },
  headerPanelHairline: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.discover.stickyHeader.bottomHairline,
  },
  headerRowAbsolute: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: glass.discover.title.horizontalPadding,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  titleText: {
    color: glass.discover.title.color,
    fontSize: glass.discover.title.fontSize,
    fontWeight: glass.discover.title.fontWeight,
    lineHeight: 36,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  titleIconBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: tokens.accent,
    borderWidth: 1.5,
    borderColor: tokens.avatarRing,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleIconBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
  // ── Issue #4114 Wave 2a: Chats header, search, filters, rows ──
  headerButtons: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerButton: {
    width: CHAT_HEADER_BUTTON_SIZE,
    height: CHAT_HEADER_BUTTON_SIZE,
    borderRadius: CHAT_HEADER_BUTTON_SIZE / 2,
    backgroundColor: tokens.headerButtonBg,
    borderWidth: 1,
    borderColor: tokens.headerButtonBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonPressed: {
    transform: [{ scale: 0.96 }],
  },
  backButton: {
    width: 36,
    height: 44,
    marginLeft: -8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: CHAT_ROW_SIDE_PADDING,
    height: CHAT_SEARCH_HEIGHT,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: tokens.searchBg,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: tokens.ink,
    paddingVertical: 0,
  },
  filterRow: {
    height: CHAT_FILTER_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: CHAT_ROW_SIDE_PADDING,
    paddingTop: 4,
  },
  filterChip: {
    height: CHAT_FILTER_CHIP_HEIGHT,
    borderRadius: CHAT_FILTER_CHIP_HEIGHT / 2,
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: tokens.chipBg,
  },
  filterChipActive: {
    backgroundColor: tokens.chipActiveBg,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: tokens.dim,
  },
  filterChipTextActive: {
    color: tokens.chipActiveLabel,
  },
  sectionLabel: {
    height: CHAT_SECTION_LABEL_HEIGHT,
    paddingHorizontal: CHAT_ROW_SIDE_PADDING,
    paddingTop: 12,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: tokens.sectionLabel,
  },
  rowPressed: {
    backgroundColor: tokens.rowPressed,
  },
  rowSeparator: {
    position: 'absolute',
    top: 0,
    left: CHAT_ROW_SIDE_PADDING + 52 + CHAT_ROW_GAP,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: tokens.separator,
  },
  friendRow: {
    height: CHAT_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: CHAT_ROW_GAP,
    paddingHorizontal: CHAT_ROW_SIDE_PADDING,
  },
  friendRowName: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    fontWeight: '600',
    color: tokens.ink,
  },
  friendRowAction: {
    height: 30,
    borderRadius: 15,
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: tokens.chipBg,
  },
  friendRowActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: tokens.ink,
  },
  archivedRow: {
    height: CHAT_ARCHIVED_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: CHAT_ROW_SIDE_PADDING + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.separator,
  },
  archivedRowLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: tokens.dim,
  },
  archivedRowCount: {
    marginLeft: 'auto',
    fontSize: 15,
    color: tokens.faint,
  },
  offlineBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: CHAT_ROW_SIDE_PADDING,
    marginBottom: 8,
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 8,
    backgroundColor: tokens.offlineBarBg,
  },
  offlineBarText: {
    flex: 1,
    fontSize: 12.5,
    color: tokens.dim,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    paddingHorizontal: CHAT_ROW_SIDE_PADDING + 2,
  },
  errorRowText: {
    flex: 1,
    fontSize: 14,
    color: tokens.errorLabel,
  },
  errorRowAction: {
    fontWeight: '700',
    color: tokens.ink,
  },
  emptyContainer: {
    alignItems: "center",
    paddingHorizontal: 40,
    paddingTop: 72,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: tokens.ink,
    marginTop: 14,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    color: tokens.dim,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 20,
  },
  emptyCtaButton: {
    marginTop: 20,
    backgroundColor: tokens.accent,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
  },
  emptyCtaText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  // ── Friends sheet (Wave 2b redesigns these) ──────
  // ── Chat list ─────────────────────────────
  chatListContent: {
    paddingBottom: 16,
  },
  // ── Bottom Sheet (Friends modal) ──────────────────────────
  // META-ORCH-0991 Wave C: the scrim/flex-end card/hand-rolled handle styles
  // (sheetOverlay, sheetContainer, sheetHandle) are owned by BaseBottomSheet now.
  // Issue #4114 Wave 2b — the dark friends sheet (design v6: sheet #17191e,
  // 17/700 title, Done / Add, a two-item segmented control).
  friendsSheetBackground: {
    backgroundColor: glass.discover.friendsSheet.sheetBg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  friendsSheetHeaderBlock: {
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  friendsSheetTitleRow: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 2,
    marginBottom: 6,
  },
  friendsSheetSide: {
    width: 72,
  },
  friendsSheetSideRight: {
    alignItems: "flex-end",
  },
  friendsSheetDone: {
    fontSize: 15,
    color: tokens.dim,
  },
  friendsSheetAdd: {
    fontSize: 15,
    fontWeight: "600",
    color: tokens.accent,
  },
  friendsSheetTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "700",
    color: tokens.ink,
  },
  friendsSegment: {
    flexDirection: "row",
    padding: 3,
    borderRadius: 11,
    backgroundColor: glass.discover.friendsSheet.segmentBg,
  },
  friendsSegmentItem: {
    flex: 1,
    minHeight: 32,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  friendsSegmentItemActive: {
    backgroundColor: glass.discover.friendsSheet.segmentActiveBg,
  },
  friendsSegmentText: {
    fontSize: 13.5,
    fontWeight: "600",
    color: tokens.dim,
  },
  friendsSegmentTextActive: {
    color: tokens.ink,
  },
  friendsSegmentBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: tokens.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  friendsSegmentBadgeText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "700",
  },
  sheetBodyInner: {
    flex: 1,
  },
  sheetBodyContent: {
    paddingTop: 4,
    paddingBottom: 24,
  },
});

// ORCH-0679 Wave 2A: I-TAB-SCREENS-MEMOIZED.
export default React.memo(ConnectionsPageRefactored);
