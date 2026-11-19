import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { messagesScreenWebSize, webPrivacyMaxHeight } from "../../src/components/messages/webViewportPin";
import { HostShellInsetContext } from "../../src/components/ui/hostShellContext";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextInputContentSizeChangeEventData,
  type TextInputKeyPressEventData,
  type TextInputSelectionChangeEventData,
  type ViewStyle,
} from "react-native";
import { showAlert } from "../../src/components/ui/showAlert";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { BrandGroupSignalModal } from "../../src/components/messages/BrandGroupSignalModal";
import { BrandGroupFilePreviewModal } from "../../src/components/messages/BrandGroupFilePreviewModal";
import { BrandGroupFileUploadSheet } from "../../src/components/messages/BrandGroupFileUploadSheet";
import { BrandGroupMediaBubble } from "../../src/components/messages/BrandGroupMediaBubble";
import { BrandGroupPendingUploadRow } from "../../src/components/messages/BrandGroupPendingUploadRow";
import { BrandGroupPeoplePanel, BrandGroupPeopleSheet, memberRoleLabel } from "../../src/components/messages/BrandGroupPeoplePanel";
import { BrandEnquiryCard } from "../../src/components/messages/BrandEnquiryCard";
import { BrandGroupInboxList } from "../../src/components/messages/BrandGroupInboxList";
import { BrandGroupMessageMenu } from "../../src/components/messages/BrandGroupMessageMenu";
import { BrandGroupMessageRow, BrandGroupMessageText } from "../../src/components/messages/BrandGroupMessageRow";
import { BrandGroupTile } from "../../src/components/messages/BrandGroupTile";
import { openMessageLink } from "../../src/components/messages/openMessageLink";
// #4420: the Guests side of a brand's one thread is the Guest chat panel, on
// intent through the one shared lazy chunk (never a static GroupChatPanel).
import { LazyGroupChatPanel } from "../../src/components/groupChat/LazyGroupChatPanel";
import { Button } from "../../src/components/ui/Button";
import { Icon } from "../../src/components/ui/Icon";
import { SafeScreen } from "../../src/components/ui/SafeScreen";
import { Toast, type ToastKind } from "../../src/components/ui/Toast";
import { brandGroupChat } from "../../src/constants/brandGroupChatTokens";
import { color, radius, size, space } from "../../src/constants/designSystem";
import { useAuth } from "../../src/context/AuthContext";
import { useBrandGroups } from "../../src/hooks/useBrandGroups";
import { useBrandGuestChats } from "../../src/hooks/useBrandGuestChats";
import { brandGuestChatHref } from "../../src/services/brandGuestChatList";
import { useBrandGroupLive } from "../../src/hooks/useBrandGroupLive";
import { useBrandGroupUploadQueue } from "../../src/hooks/useBrandGroupUploadQueue";
import { brandGroupMediaKeys } from "../../src/hooks/brandGroupMediaKeys";
import { brandEnquiryKeys } from "../../src/hooks/useBrandEnquiries";
import { findBrandEnquiryIdForConversation } from "../../src/services/brandEnquiryList";
import { brandEnquiryThreadRoute } from "../../src/utils/brandEnquiryWaiting";
import { useResponsiveLayout } from "../../src/hooks/useResponsiveLayout";
import { useSupportStaff } from "../../src/hooks/useSupportStaff";
import { useBusinessMediaTranslation } from "../../src/i18n";
import { KeyboardAvoidingView } from "../../src/wrappers/SmartKeyboardAvoidingView";
import { DONE_BAR_OCCUPIED, ScrollView } from "../../src/wrappers/SmartScrollView";
import { liftedBottomSpacer } from "../../src/wrappers/keyboardClearance";
import { useKeyboardHeight } from "../../src/wrappers/useKeyboardHeight";
import {
  listBrandGroupMessages,
  markBrandGroupRead,
  sendBrandGroupMessage,
  type BrandGroupMessage,
} from "../../src/services/brandGroupsService";
import { listBrandGroupMembers, listBrandGroupMentionCandidates } from "../../src/services/brandGroupRosterService";
import { supabase } from "../../src/services/supabase";
import { fileMeta } from "../../src/services/brandGroupFileMetaService";
import type { BrandGroupMediaRow } from "../../src/services/brandGroupMediaService";
// #4304 — static: this route and its pending-upload rows already load
// MediaThumb's local-preview store (brandGroupLocalPreviews). A separate lazy
// MediaThumb chunk made Metro hoist them into the eager web __common chunk.
import { MediaThumb } from "../../src/components/media/MediaThumb";
import { formatFileSize, formatMediaDuration } from "../../src/utils/formatMediaDuration";
import {
  brandGroupMentionTarget,
  insertBrandGroupMention,
  retainedBrandGroupMentions,
  type BrandGroupMentionCandidate,
  type SelectedBrandGroupMention,
} from "../../src/utils/brandGroupMentions";
import { isNearLatestBrandGroupMessage } from "../../src/utils/brandGroupScroll";
import {
  BRAND_PLAN_CARD_PREVIEW,
  brandPlanActivityTitle,
  foldBrandPlanLines,
} from "../../src/utils/brandGroupPlanFold";
import {
  brandInboxOpenSide,
  brandInboxRowHref,
  guestChatRedirectHref,
  parseMessagesSide,
  showsSideSwitcher,
  type BrandInboxRow,
  type MessagesSide,
} from "../../src/utils/brandMessagesInbox";
import {
  captureSendTarget,
  dispatchBrandThreadSend,
  type BrandThreadSendTarget,
} from "../../src/utils/brandThreadSend";
import { visibleBrandGroupPendingUploads } from "../../src/utils/brandGroupPendingUploads";
import {
  BRAND_GROUP_HEART,
  brandGroupHeaderSubtitle,
  brandGroupSeenBy,
  brandGroupTypingText,
  buildBrandGroupMessageMenu,
  buildBrandGroupThreadItems,
  type BrandGroupMenuActionKey,
} from "../../src/utils/brandGroupThreadModel";

// #4304 — /messages (app/messages/index.tsx) loads its inbox screen from THIS
// module with import(), so on web the two Messages routes share this route's
// lazy chunk: the inbox list, tiles, thread model and chat tokens are never
// hoisted into the eager __common boot chunk (bundle-baseline-movement).
export { BrandGroupInboxScreen } from "../../src/components/messages/BrandGroupInboxScreen";
// #4255 W5 — the Mingla team screens (staff only) load from this chunk too:
// they reuse the Brand group file sheet, pickers, upload and chat tokens, and
// a module shared by two lazy chunks is hoisted into __common.
export { TeamNotificationPrefs, TeamScreen } from "../../src/components/minglaTeam/TeamScreens";

const LazyBrandGroupMediaPanel = React.lazy(async () => {
  const module = await import("../../src/components/messages/BrandGroupMediaPanel");
  return { default: module.BrandGroupMediaPanel };
});

// The plan's module once the panel has loaded it. Only that module reads the
// plan, so before it loads there is no plan to refresh.
let loadedPlanModule: typeof import("../../src/components/messages/BrandPlanPanel") | null = null;

const LazyBrandPlanPanel = React.lazy(async () => {
  const module = await import("../../src/components/messages/BrandPlanPanel");
  loadedPlanModule = module;
  return { default: module.BrandPlanPanel };
});

/** #4304 — the desktop details rail collapses below this width. */
const DETAILS_RAIL_MIN_WIDTH = 1200;
const COMPOSER_MIN = 40;
const COMPOSER_MAX = 132;

function renderMediaThumbnail(item: BrandGroupMediaRow, style?: StyleProp<ViewStyle>, bubble = false): React.ReactNode {
  return <MediaThumb item={item} style={style} bubble={bubble} />;
}

function first(value: string | string[] | undefined): string | null {
  const item = Array.isArray(value) ? value[0] : value;
  return typeof item === "string" && item.length ? item : null;
}

/**
 * #4111 — /messages/{conversationId} is also where a customer-enquiry push and
 * the nudge email land. When the conversation is an enquiry the caller can
 * read, send them to the enquiry thread; otherwise it is a Brand group.
 */
export default function BrandGroupThreadRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ conversationId?: string | string[] }>();
  const conversationId = first(params.conversationId);
  const { user, isAuthReady } = useAuth();
  const userId = user?.id ?? null;
  const lookup = useQuery({
    queryKey: userId && conversationId
      ? brandEnquiryKeys.byConversation(userId, conversationId)
      : (["brandEnquiries", "byConversation-disabled"] as const),
    enabled: isAuthReady === true && Boolean(userId && conversationId),
    queryFn: () => {
      if (!conversationId) throw new Error("conversation_required");
      return findBrandEnquiryIdForConversation(conversationId);
    },
    staleTime: Infinity,
  });
  const enquiryId = typeof lookup.data === "string" ? lookup.data : null;
  // Redirect, never import the enquiry screen here: Brand groups must not load
  // the enquiry thread's dialogs and animations just to render a group.
  if (enquiryId) return <Redirect href={brandEnquiryThreadRoute(enquiryId) as never} />;
  if (lookup.isPending === true && lookup.fetchStatus === "fetching") {
    return (
      <SafeScreen edges={["top"]} style={styles.screen}>
        <View style={styles.state}><ActivityIndicator color={color.text2} /></View>
      </SafeScreen>
    );
  }
  return <BrandGroupMessagesShell conversationId={conversationId} />;
}

/**
 * #4304 — on desktop web the Messages page is three panes: the group list,
 * the thread and the details rail. Choosing another group swaps the thread in
 * place (router.setParams), so the list keeps its scroll, search and filter.
 * Phones keep separate screens.
 */
function BrandGroupMessagesShell({ conversationId }: { conversationId: string | null }): React.ReactElement {
  const { isWideDesktop } = useResponsiveLayout();
  const { height: windowHeight } = useWindowDimensions();
  const router = useRouter();
  const { user } = useAuth();
  const staff = useSupportStaff();
  const { groups, loading, error, refresh } = useBrandGroups();
  // #4420: the brand Guest chats, joined onto their brand's one row and
  // shown as the Guests side of its thread.
  const guestChats = useBrandGuestChats();
  const shellActive = React.useContext(HostShellInsetContext);
  // #4420 redirect: /messages/<a Guest chat id> lands on its brand's thread
  // with Guests selected (or the Guest chat alone when there is no Team chat).
  const inGroups = groups.some((group) => group.conversation_id === conversationId);
  const guestMatch = inGroups ? null : guestChats.chats.find((chat) => chat.conversation_id === conversationId) ?? null;
  if (guestMatch) {
    return <Redirect href={(guestChatRedirectHref(guestMatch.brand_id, groups) ?? brandGuestChatHref(guestMatch.brand_id)) as never} />;
  }
  if (!inGroups && (loading || guestChats.loading)) {
    return (
      <SafeScreen edges={["top"]} style={styles.screen}>
        <View style={styles.state} accessibilityLabel="Loading the conversation"><ActivityIndicator color={color.text2} /></View>
      </SafeScreen>
    );
  }
  if (!isWideDesktop) return <BrandGroupThreadScreen key={conversationId ?? "none"} guestChats={guestChats} />;
  const openRow = (row: BrandInboxRow): void => {
    if (!row.group) {
      router.push(brandInboxRowHref(row) as never);
      return;
    }
    if (row.group.conversation_id === conversationId) return;
    const side = brandInboxOpenSide(row);
    router.setParams({
      conversationId: row.group.conversation_id,
      mode: row.group.access_kind === "support" ? "support" : "brand",
      side: side === "guests" ? "guests" : undefined,
      focusMessageId: undefined,
      gallery: undefined,
    } as never);
  };
  const selectedBrandId = groups.find((group) => group.conversation_id === conversationId)?.brand_id ?? null;
  return (
    <View
      style={[
        styles.desktopShell,
        // #4420 A2: fills the desktop shell's slot under its top bar (a full
        // window pin made #root scroll the composer away).
        messagesScreenWebSize(windowHeight, shellActive),
        // #4420: capped clear of the Privacy & ad choices strip.
        webPrivacyMaxHeight(),
      ]}
      testID="brand-group-desktop-shell"
    >
      <View style={styles.desktopList}>
        <BrandGroupInboxList
          groups={groups}
          guestChats={guestChats.chats}
          guestActivity={guestChats.activity}
          loading={loading}
          error={error ?? null}
          onRetry={() => {
            void refresh();
            void guestChats.refresh();
          }}
          viewerId={user?.id ?? null}
          isStaff={staff.isStaff}
          selectedBrandId={selectedBrandId}
          onOpen={openRow}
        />
      </View>
      <View style={styles.desktopThread}>
        <BrandGroupThreadScreen key={conversationId ?? "none"} embedded guestChats={guestChats} />
      </View>
    </View>
  );
}

/** One shared rail tab row: every details tab (People, Media, …) lives here. */
function BrandGroupRailTabRow({
  tabs,
  active,
}: {
  tabs: { key: string; label: string; accessibilityLabel: string; onPress: () => void; testID?: string }[];
  active: string;
}): React.ReactElement {
  return (
    <View style={styles.railTabs} accessibilityRole="tablist" testID="brand-group-rail-tabs">
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityLabel={tab.accessibilityLabel}
            accessibilityState={{ selected }}
            onPress={tab.onPress}
            style={[styles.railTab, selected && styles.railTabActive]}
            testID={tab.testID}
          >
            <Text style={selected ? styles.railTabTextActive : styles.railTabText}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * #4420 — one Team | Guests switcher in the thread header. Team is the private
 * Brand group with Mingla; Guests is everyone with a ticket or RSVP, where the
 * team posts as the brand. The unread count of the side not showing is in the
 * tab and its label.
 */
function BrandThreadSideSwitcher({
  side,
  teamUnread,
  guestUnread,
  onChange,
  fullWidth,
}: {
  side: MessagesSide;
  teamUnread: number;
  guestUnread: number;
  onChange: (side: MessagesSide) => void;
  fullWidth: boolean;
}): React.ReactElement {
  const tabs: { key: MessagesSide; label: string; unread: number }[] = [
    { key: "team", label: "Team", unread: teamUnread },
    { key: "guests", label: "Guests", unread: guestUnread },
  ];
  return (
    <View style={[styles.switcher, fullWidth && styles.switcherFull]} accessibilityRole="tablist" accessibilityLabel="Who you are talking to" testID="brand-thread-switcher">
      {tabs.map((tab) => {
        const on = side === tab.key;
        const showBadge = !on && tab.unread > 0;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityLabel={`${tab.label}${tab.key === "team" ? ", private to your team and Mingla" : ", everyone with a ticket or RSVP"}${showBadge ? `, ${tab.unread} unread` : ""}`}
            accessibilityState={{ selected: on }}
            onPress={() => onChange(tab.key)}
            style={[styles.switcherTab, fullWidth && styles.switcherTabFull, on && (tab.key === "guests" ? styles.switcherTabGuestsOn : styles.switcherTabTeamOn)]}
            testID={`brand-thread-side-${tab.key}`}
          >
            <Icon name={tab.key === "guests" ? "megaphone" : "shield"} size={15} color={on ? (tab.key === "guests" ? color.infoText : color.textStrong) : color.text2} />
            <Text style={[styles.switcherText, on && (tab.key === "guests" ? styles.switcherTextGuestsOn : styles.switcherTextOn)]}>{tab.label}</Text>
            {showBadge ? (
              <View style={tab.key === "guests" ? styles.switcherBadgeGuests : styles.switcherBadge}>
                <Text style={tab.key === "guests" ? styles.switcherBadgeGuestsText : styles.switcherBadgeText}>{tab.unread > 99 ? "99+" : tab.unread}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * #4420 — plan activity: a run of quiet plan lines is one card ("Mingla added
 * 11 items to the plan") with the first three, Show all, and Open Plan. Each
 * line opens the plan.
 */
function BrandPlanActivityCard({
  lines,
  onOpenPlan,
}: {
  lines: BrandGroupMessage[];
  onOpenPlan: (() => void) | null;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const shown = open ? lines : lines.slice(0, BRAND_PLAN_CARD_PREVIEW);
  const last = lines[lines.length - 1];
  const at = last ? new Date(last.created_at) : null;
  const time = at && Number.isFinite(at.getTime())
    ? at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";
  return (
    <View style={styles.planCard} testID="brand-plan-activity-card" accessibilityRole="summary">
      <View style={styles.planCardHead}>
        <View style={styles.planCardIcon}><Icon name="calendar" size={18} color={color.text1} /></View>
        <View style={styles.headerCopy}>
          <Text style={styles.planCardTitle}>{brandPlanActivityTitle(lines)}</Text>
          {time ? <Text style={styles.planCardSub}>{time}</Text> : null}
        </View>
      </View>
      <View style={styles.planCardList}>
        {shown.map((line) => (
          <Pressable
            key={line.id}
            accessibilityRole={onOpenPlan ? "button" : "text"}
            accessibilityLabel={onOpenPlan ? `${line.content} Opens the plan.` : line.content}
            disabled={!onOpenPlan}
            onPress={onOpenPlan ?? undefined}
            style={({ pressed }) => [styles.planCardLine, pressed && styles.optionRowPressed]}
            testID="brand-plan-activity-line"
          >
            <Text style={styles.planCardLineText}>{line.content}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.planCardFoot}>
        {lines.length > BRAND_PLAN_CARD_PREVIEW ? (
          <Button
            label={open ? "Show fewer" : `Show all ${lines.length}`}
            variant="secondary"
            size="sm"
            onPress={() => setOpen((value) => !value)}
            testID="brand-plan-activity-toggle"
          />
        ) : null}
        {onOpenPlan ? <Button label="Open Plan" variant="primary" size="sm" onPress={onOpenPlan} testID="brand-plan-activity-open" /> : null}
      </View>
    </View>
  );
}

function BrandGroupThreadScreen({
  embedded = false,
  guestChats,
}: {
  embedded?: boolean;
  guestChats: ReturnType<typeof useBrandGuestChats>;
}): React.ReactElement {
  const params = useLocalSearchParams<{ conversationId?: string | string[]; mode?: string | string[]; focusMessageId?: string | string[]; gallery?: string | string[]; plan?: string | string[]; side?: string | string[] }>();
  const conversationId = first(params.conversationId);
  const requestedMode = first(params.mode);
  const requestedFocusMessageId = first(params.focusMessageId);
  const requestedGallery = first(params.gallery);
  const requestedPlan = first(params.plan);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight();
  const queryClient = useQueryClient();
  const { t } = useBusinessMediaTranslation();
  const { isWideDesktop, width: layoutWidth } = useResponsiveLayout();
  const shellActive = React.useContext(HostShellInsetContext);
  const showRail = isWideDesktop && (layoutWidth ?? 0) >= DETAILS_RAIL_MIN_WIDTH;
  // #4304 — on a phone, Plan and Media in the header are icon-only so the
  // group's name keeps its room (both carry an accessibility label).
  const compactHeaderButtons = !showRail && (layoutWidth ?? 0) < 520;
  const { isAuthReady, user } = useAuth();
  const staff = useSupportStaff();
  const { groups, refresh: refreshGroups, setMuted } = useBrandGroups();
  const group = groups.find((item) => item.conversation_id === conversationId) ?? null;
  const canBrand = group?.access_kind === "brand";
  const canSupport = staff.isStaff;
  // #4270 / #4420 SC-12: the brand's team reads and writes its plan; Mingla
  // support staff read it (server: brand_plan_can_read, writes stay rank-based,
  // so the panel shows no Add and no item menu for them).
  const planBrandId = group ? group.brand_id : null;
  // #4420: the brand's Guest chat (team rows only) and which side shows. The
  // URL `side` param is the one owner of the visible side.
  const guestChat = canBrand && group
    ? guestChats.chats.find((chat) => chat.brand_id === group.brand_id) ?? null
    : null;
  const hasSwitcher = showsSideSwitcher(group, guestChat);
  const side: MessagesSide = hasSwitcher ? parseMessagesSide(params.side) : "team";
  const guestUnread = guestChat ? guestChats.activity.get(guestChat.conversation_id)?.unread_count ?? 0 : 0;
  const setSide = useCallback((next: MessagesSide): void => {
    router.setParams({ side: next === "guests" ? "guests" : undefined } as never);
  }, [router]);
  // #4420 SC-4: the Guests draft lives here so it survives a switch to Team
  // (the Team draft is `composer` below); the first-send check is once per
  // thread open.
  const [guestDraft, setGuestDraft] = useState("");
  const [guestSendConfirmed, setGuestSendConfirmed] = useState(false);
  const refreshGuestActivity = guestChats.refreshActivity;
  const [actorMode, setActorMode] = useState<"brand" | "support">(
    requestedMode === "support" ? "support" : "brand",
  );
  const [messages, setMessages] = useState<BrandGroupMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [composerHeight, setComposerHeight] = useState(COMPOSER_MIN);
  const [composerSelection, setComposerSelection] = useState({ start: 0, end: 0 });
  const [mentionCandidates, setMentionCandidates] = useState<BrandGroupMentionCandidate[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [selectedMentions, setSelectedMentions] = useState<SelectedBrandGroupMention[]>([]);
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<BrandGroupMessage | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [muteBusy, setMuteBusy] = useState(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string; kind: ToastKind }>({
    visible: false,
    message: "",
    kind: "error",
  });
  const [signalSourceId, setSignalSourceId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filePickerVisible, setFilePickerVisible] = useState(false);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [panelViewerItems, setPanelViewerItems] = useState<BrandGroupMediaRow[] | null>(null);
  const [mediaPanelOpen, setMediaPanelOpen] = useState(requestedGallery === "1");
  const [peopleSheetOpen, setPeopleSheetOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [menuMessage, setMenuMessage] = useState<BrandGroupMessage | null>(null);
  // #4420 SC-16: the Select text sheet (phones), for either side.
  const [selectText, setSelectText] = useState<string | null>(null);
  const [planPanelOpen, setPlanPanelOpen] = useState(requestedPlan === "1" && requestedGallery !== "1");
  // #4270: on wide web the rail opens on the plan, unless the address asks for
  // the gallery. A group with no plan (support access) shows People instead.
  const [desktopDetailTab, setDesktopDetailTab] = useState<"people" | "plan" | "media">(
    requestedGallery === "1" ? "media" : "plan",
  );
  const detailTab = desktopDetailTab === "plan" && !planBrandId ? "people" : desktopDetailTab;
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const scrollRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const autoFollowLatest = useRef(requestedFocusMessageId === null);
  const didInitialLatestScroll = useRef(false);
  const composerRef = useRef<TextInput>(null);
  const messageOffsets = useRef<Map<string, number>>(new Map());
  const handledFocusMessageId = useRef<string | null>(null);
  const memberQuery = useQuery({
    queryKey: conversationId
      ? ["brandGroupMembers", conversationId]
      : ["brandGroupMembers", "disabled"],
    enabled: Boolean(isAuthReady && user?.id && conversationId),
    queryFn: async () => {
      if (!conversationId) throw new Error("brand_group_conversation_required");
      const result = await listBrandGroupMembers(conversationId);
      if (result.error) throw new Error(result.error);
      return result.members;
    },
    staleTime: 60_000,
  });
  const members = (memberQuery.data ?? []).filter((member) =>
    typeof member?.user_id === "string"
    && typeof member?.display_name === "string"
    && typeof member?.email === "string"
    && typeof member?.role === "string"
  );
  const memberError = memberQuery.error ? "Couldn’t load people right now. Try again." : null;
  const memberRoles = useMemo(() => new Map(members.map((member) => [member.user_id, member.role])), [members]);
  const mentionNames = useMemo(() => members.map((member) => member.display_name), [members]);
  const viewerName = useMemo(
    () => members.find((member) => member.user_id === user?.id)?.display_name ?? "A teammate",
    [members, user?.id],
  );
  const fileIds = useMemo(() => messages.flatMap((message) => message.file_id ? [message.file_id] : []), [messages]);
  const fileMetaEnabled = Boolean(isAuthReady && user?.id && conversationId && fileIds.length > 0);
  const fileMetaQuery = useQuery({
    queryKey: fileMetaEnabled && conversationId && user?.id
      ? brandGroupMediaKeys.meta(conversationId, fileIds, user.id)
      : (["brandGroupMedia", "meta-disabled"] as const),
    enabled: fileMetaEnabled,
    queryFn: () => {
      if (!conversationId) throw new Error("brand_group_conversation_required");
      return fileMeta(conversationId, fileIds);
    },
    staleTime: 30_000,
  });
  const mediaMeta = useMemo(() => new Map((fileMetaQuery.data ?? []).map((item) => [item.fileId, item])), [fileMetaQuery.data]);
  const viewerItems = useMemo<BrandGroupMediaRow[]>(() => messages.flatMap((message) => {
    if (!message.file_id || !message.file_name || !message.file_mime) return [];
    const meta = mediaMeta.get(message.file_id);
    return [{
      fileId: message.file_id,
      messageId: message.id,
      name: message.file_name,
      mime: message.file_mime,
      sizeBytes: message.file_size ?? 0,
      createdAt: message.created_at,
      senderDisplayName: message.sender_display_name,
      senderRole: message.sender_role ?? "brand",
      kind: (message.file_mime.startsWith("video/") ? "video" : message.file_mime.startsWith("image/") ? "image" : "file") as BrandGroupMediaRow["kind"],
      durationMs: meta?.durationMs ?? null,
      width: meta?.width ?? null,
      height: meta?.height ?? null,
      thumbState: meta?.thumbState ?? (message.file_mime.startsWith("video/") || message.file_mime.startsWith("image/") ? "pending" : "none"),
    }];
  }).reverse(), [mediaMeta, messages]);
  const viewerItemMap = useMemo(() => new Map(viewerItems.map((item) => [item.fileId, item])), [viewerItems]);
  const mentionTarget = useMemo(
    () => brandGroupMentionTarget(composer, composerSelection.start),
    [composer, composerSelection.start],
  );

  const showError = useCallback((message: string): void => {
    setToast({ visible: true, message, kind: "error" });
  }, []);
  // #4420 SC-15: a link in a message opens in the in-app browser (phones) or a
  // new tab (web); a refused or failed open says so.
  const openLink = useCallback((url: string): void => {
    void openMessageLink(url).catch((cause: unknown) => {
      showError(cause instanceof Error ? cause.message : "Couldn't open that link.");
    });
  }, [showError]);
  const liveMessageIds = useMemo(
    () => messages.filter((message) => message.message_type !== "system" && message.message_type !== "brand_enquiry_card").map((message) => message.id),
    [messages],
  );
  const live = useBrandGroupLive({
    conversationId,
    viewerId: user?.id ?? null,
    viewerName,
    messageIds: liveMessageIds,
    onError: showError,
  });
  const announceRead = live.announceRead;
  // #4420: runs of quiet plan lines fold into one plan activity card.
  const threadItems = useMemo(
    () => foldBrandPlanLines(buildBrandGroupThreadItems(messages, user?.id ?? null)),
    [messages, user?.id],
  );
  const seenBy = useMemo(
    () => brandGroupSeenBy(messages, live.reads, user?.id ?? null),
    [live.reads, messages, user?.id],
  );
  const typingText = brandGroupTypingText(live.typingNames);

  useEffect(() => {
    if (!conversationId || !mentionTarget) {
      setMentionCandidates([]);
      setMentionLoading(false);
      return;
    }
    let active = true;
    setMentionLoading(true);
    const timer = setTimeout(() => {
      void listBrandGroupMentionCandidates(conversationId, mentionTarget.query)
        .then((result) => {
          if (!active) return;
          setMentionCandidates(result.error ? [] : result.candidates);
        })
        .finally(() => {
          if (active) setMentionLoading(false);
        });
    }, 120);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [conversationId, mentionTarget]);

  useEffect(() => {
    if (!group) return;
    if (group.access_kind === "support") setActorMode("support");
    else if (!canSupport) setActorMode("brand");
  }, [canSupport, group]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!conversationId) {
      setError("We couldn't open this Brand group.");
      setLoading(false);
      return;
    }
    try {
      const result = await listBrandGroupMessages(conversationId);
      if (result.error) throw new Error(result.error);
      setMessages(result.messages);
      setError(null);
      await markBrandGroupRead(conversationId);
      announceRead();
      await refreshGroups();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load this Brand group");
    } finally {
      setLoading(false);
    }
  }, [announceRead, conversationId, refreshGroups]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  // #4304 — the sender's own files show in the thread while they send; the
  // server message replaces each one in the same render (no duplicate).
  const uploadQueue = useBrandGroupUploadQueue({ messages, onUploaded: refresh });
  const pendingUploads = useMemo(
    () => visibleBrandGroupPendingUploads(uploadQueue.uploads, messages),
    [messages, uploadQueue.uploads],
  );
  const enqueueUploads = uploadQueue.enqueue;
  const queueUploads = useCallback((prepared: Parameters<typeof enqueueUploads>[0]) => {
    autoFollowLatest.current = true;
    void enqueueUploads(prepared);
  }, [enqueueUploads]);

  useEffect(() => {
    autoFollowLatest.current = requestedFocusMessageId === null;
    didInitialLatestScroll.current = false;
    messageOffsets.current.clear();
  }, [conversationId, requestedFocusMessageId]);

  useEffect(() => {
    if (requestedGallery === "1") {
      setMediaPanelOpen(true);
      setDesktopDetailTab("media");
    } else if (requestedPlan === "1") {
      setPlanPanelOpen(true);
      setDesktopDetailTab("plan");
    }
  }, [requestedGallery, requestedPlan]);

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`brand-group:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload: { new?: { message_type?: unknown } }) => {
          // #4270: a quiet plan line means the plan changed.
          if (planBrandId && payload.new?.message_type === "system" && loadedPlanModule) {
            void loadedPlanModule.refreshBrandPlan(queryClient, planBrandId);
          }
          void queryClient.invalidateQueries({ queryKey: ["brandGroupMedia", "list", conversationId] });
          void queryClient.invalidateQueries({ queryKey: ["brandGroupMedia", "meta", conversationId] });
          void refresh();
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [conversationId, planBrandId, queryClient, refresh]);

  const openMedia = useCallback(() => {
    if (!conversationId) return;
    setDesktopDetailTab("media");
    setMediaPanelOpen(true);
  }, [conversationId]);

  const openPeople = useCallback(() => {
    if (showRail) {
      setDesktopDetailTab("people");
      setMediaPanelOpen(false);
    } else setPeopleSheetOpen(true);
  }, [showRail]);

  const closeMedia = useCallback(() => {
    setMediaPanelOpen(false);
    if (requestedGallery === "1" && conversationId) {
      router.replace({ pathname: "/messages/[conversationId]", params: { conversationId } });
    }
  }, [conversationId, requestedGallery, router]);

  const showInChat = useCallback(async (messageId: string): Promise<void> => {
    autoFollowLatest.current = false;
    let merged = messages;
    for (let page = 0; page < 10 && !merged.some((message) => message.id === messageId); page += 1) {
      const before = merged[0]?.created_at ?? null;
      if (!before || !conversationId) break;
      const older = await listBrandGroupMessages(conversationId, before);
      if (older.error || older.messages.length === 0) break;
      const byId = new Map([...older.messages, ...merged].map((message) => [message.id, message]));
      merged = [...byId.values()].sort((left, right) => left.created_at.localeCompare(right.created_at));
    }
    if (!merged.some((message) => message.id === messageId)) {
      setToast({ visible: true, message: t("viewer.show_in_chat_missing"), kind: "error" });
      return;
    }
    if (merged !== messages) setMessages(merged);
    setMediaPanelOpen(false);
    setDesktopDetailTab("people");
    setHighlightedMessageId(messageId);
    setTimeout(() => {
      const y = messageOffsets.current.get(messageId);
      if (typeof y === "number") scrollRef.current?.scrollTo({ y: Math.max(0, y - space[4]), animated: true });
    }, 0);
    setTimeout(() => setHighlightedMessageId((value) => value === messageId ? null : value), 2_000);
  }, [conversationId, messages, t]);

  useEffect(() => {
    if (loading || !requestedFocusMessageId || handledFocusMessageId.current === requestedFocusMessageId) return;
    handledFocusMessageId.current = requestedFocusMessageId;
    void showInChat(requestedFocusMessageId);
  }, [loading, requestedFocusMessageId, showInChat]);

  const selectedMessages = useMemo(
    () => messages.filter((message) => selectedIds.includes(message.id)),
    [messages, selectedIds],
  );

  const followLatestMessage = useCallback(() => {
    if (loading || !autoFollowLatest.current || requestedFocusMessageId) return;
    scrollRef.current?.scrollToEnd({ animated: didInitialLatestScroll.current });
    didInitialLatestScroll.current = true;
  }, [loading, requestedFocusMessageId]);

  const updateLatestMessageProximity = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      autoFollowLatest.current = isNearLatestBrandGroupMessage({
        contentHeight: contentSize.height,
        viewportHeight: layoutMeasurement.height,
        offsetY: contentOffset.y,
      });
    },
    [],
  );

  async function send(): Promise<void> {
    // #4420 SC-5: the send is bound to the Team chat showing when Send was
    // pressed; a switch to Guests mid-send never redirects it.
    const content = composer.trim();
    const target = captureSendTarget("team", conversationId);
    if (!target || !content || sending) return;
    setSending(true);
    try {
      await dispatchBrandThreadSend(target, content, {
        team: (id, text) => sendBrandGroupMessage({
          conversationId: id,
          content: text,
          replyToId: replyTo?.id,
          relatedMessageIds: selectedIds,
          mentionedUserIds: selectedMentions.map((mention) => mention.userId),
          actorMode,
        }),
        guests: () => Promise.reject(new Error("The Team composer never sends to guests.")),
      });
      live.stopTyping();
      // Only the Team draft that was sent is cleared.
      setComposer((current) => (current.trim() === content ? "" : current));
      setComposerHeight(COMPOSER_MIN);
      setSelectedMentions([]);
      setMentionCandidates([]);
      setReplyTo(null);
      setSelectedIds([]);
      autoFollowLatest.current = true;
      await refresh();
    } catch (cause) {
      showAlert("Message not sent", cause instanceof Error ? cause.message : "Try again.");
    } finally {
      setSending(false);
    }
  }

  async function toggleMute(): Promise<void> {
    if (!conversationId || !group || muteBusy) return;
    const muted = !group.muted;
    setMuteBusy(true);
    try {
      await setMuted(conversationId, muted);
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : "Couldn't update notifications. Try again.");
    } finally {
      setMuteBusy(false);
    }
  }

  function toggleSelected(id: string): void {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function startReply(message: BrandGroupMessage): void {
    setReplyTo(message);
    // On web the closing menu hands focus back to the bubble it opened from,
    // so focus the composer only after that has happened.
    setTimeout(() => composerRef.current?.focus(), Platform.OS === "web" ? 160 : 0);
  }

  async function copyMessage(message: BrandGroupMessage): Promise<void> {
    try {
      const Clipboard = await import("expo-clipboard");
      await Clipboard.setStringAsync(message.content);
      setToast({ visible: true, message: "Message copied", kind: "success" });
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : "Couldn't copy the message");
    }
  }

  function runMenuAction(key: BrandGroupMenuActionKey): void {
    const message = menuMessage;
    setMenuMessage(null);
    if (!message) return;
    switch (key) {
      case "reply":
        startReply(message);
        return;
      case "copy":
        void copyMessage(message);
        return;
      case "select_text":
        setSelectText(message.content);
        return;
      case "signal":
        setSignalSourceId(message.id);
        return;
      case "select":
        toggleSelected(message.id);
        return;
      default: {
        const unreachable: never = key;
        return unreachable;
      }
    }
  }

  function updateComposer(value: string): void {
    setComposer(value);
    setSelectedMentions((current) => retainedBrandGroupMentions(value, current));
    if (value.trim()) live.notifyTyping();
    else live.stopTyping();
  }

  function updateComposerSelection(
    event: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ): void {
    setComposerSelection(event.nativeEvent.selection);
  }

  function growComposer(event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>): void {
    const next = Math.min(COMPOSER_MAX, Math.max(COMPOSER_MIN, Math.ceil(event.nativeEvent.contentSize.height)));
    setComposerHeight((current) => current === next ? current : next);
  }

  // Web: Enter sends, Shift+Enter starts a new line.
  function composerKeyPress(event: NativeSyntheticEvent<TextInputKeyPressEventData>): void {
    if (Platform.OS !== "web") return;
    const native = event.nativeEvent as TextInputKeyPressEventData & { shiftKey?: boolean; isComposing?: boolean };
    if (native.key !== "Enter" || native.shiftKey || native.isComposing) return;
    event.preventDefault();
    if (mentionTarget && mentionCandidates.length > 0) {
      chooseMention(mentionCandidates[0]);
      return;
    }
    void send();
  }

  function chooseMention(candidate: BrandGroupMentionCandidate): void {
    if (!mentionTarget) return;
    const inserted = insertBrandGroupMention(composer, mentionTarget, candidate);
    setComposer(inserted.value);
    setComposerSelection({ start: inserted.caret, end: inserted.caret });
    setSelectedMentions((current) => [
      ...current.filter((mention) => mention.userId !== inserted.mention.userId),
      inserted.mention,
    ]);
    setMentionCandidates([]);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setNativeProps({
        selection: { start: inserted.caret, end: inserted.caret },
      });
    });
  }

  const filePreview = (
    <BrandGroupFilePreviewModal
      items={panelViewerItems ?? viewerItems}
      initialFileId={previewFileId}
      renderThumbnail={renderMediaThumbnail}
      onShowInChat={(messageId) => void showInChat(messageId)}
      onClose={() => {
        setPreviewFileId(null);
        setPanelViewerItems(null);
      }}
    />
  );

  if (!showRail && planPanelOpen && planBrandId) {
    return (
      <SafeScreen edges={["top", "bottom"]} style={styles.screen}>
        <React.Suspense fallback={<View style={styles.state}><ActivityIndicator color={color.text2} /></View>}>
          <LazyBrandPlanPanel
            brandId={planBrandId}
            onBack={() => {
              setPlanPanelOpen(false);
              if (requestedPlan === "1" && conversationId) router.replace({ pathname: "/messages/[conversationId]", params: { conversationId } });
            }}
          />
        </React.Suspense>
      </SafeScreen>
    );
  }

  if (!showRail && mediaPanelOpen && conversationId) {
    return (
      <SafeScreen edges={["top", "bottom"]} style={styles.screen}>
        <React.Suspense fallback={<View style={styles.state}><ActivityIndicator color={color.text2} /></View>}>
          <LazyBrandGroupMediaPanel
            conversationId={conversationId}
            groupName={group?.brand_name ?? "Brand group"}
            onBack={closeMedia}
            renderThumbnail={renderMediaThumbnail}
            onOpenItems={(items, fileId) => {
              setPanelViewerItems(items);
              setPreviewFileId(fileId);
            }}
          />
        </React.Suspense>
        {/* #4304 — the full-screen gallery opens its viewer too (it used to
            set the file but render no viewer, a dead tap on phones). */}
        {filePreview}
        <Toast
          visible={toast.visible}
          kind={toast.kind}
          message={toast.message}
          onDismiss={() => setToast({ visible: false, message: "", kind: "error" })}
        />
      </SafeScreen>
    );
  }

  const memberCount = group?.member_count ?? members.length;
  const teamSubtitle = typingText ?? (brandGroupHeaderSubtitle(members, user?.id ?? null) || (group ? `${memberCount} teammates` : "Official Brand group"));
  // #4420: the header says which side is showing.
  const subtitle = side === "guests"
    ? "Guests room · everyone with a ticket or RSVP sees this"
    : hasSwitcher && !typingText ? `Team chat · ${teamSubtitle} · private` : teamSubtitle;
  const openPlan = planBrandId
    ? (): void => {
      if (showRail) {
        setDesktopDetailTab("plan");
        setMediaPanelOpen(false);
      } else setPlanPanelOpen(true);
    }
    : null;
  const switcher = hasSwitcher ? (
    <BrandThreadSideSwitcher
      side={side}
      teamUnread={group?.unread_count ?? 0}
      guestUnread={guestUnread}
      onChange={setSide}
      fullWidth={!showRail}
    />
  ) : null;
  const menuActions = menuMessage
    ? buildBrandGroupMessageMenu({
      senderName: menuMessage.sender_display_name,
      hasText: menuMessage.content.trim().length > 0 && !menuMessage.file_id,
      canSupport,
      selected: selectedIds.includes(menuMessage.id),
      canSelectText: Platform.OS !== "web",
    })
    : [];
  const myMenuReactions = menuMessage
    ? (live.reactionsByMessage.get(menuMessage.id) ?? []).filter((pill) => pill.mine).map((pill) => pill.emoji)
    : [];

  return (
    <SafeScreen
      edges={embedded ? [] : ["top"]}
      style={[
        styles.screen,
        // #4420 A2: embedded in the desktop page (or inside the desktop shell)
        // the thread fills its pane; on phones it is pinned to the visible
        // height, capped clear of the privacy strip, so the composer rides
        // the keyboard.
        messagesScreenWebSize(windowHeight, embedded || shellActive),
        // #4420: capped clear of the Privacy & ad choices strip.
        webPrivacyMaxHeight(),
      ]}
      testID="brand-group-thread"
    >
      <View style={[styles.header, side === "guests" && styles.headerGuests]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Messages" onPress={() => router.back()} style={styles.iconButton} hitSlop={6}>
          <Icon name="arrowL" size={20} color={brandGroupChat.textPrimary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${group?.brand_name || "Brand group"}, ${memberCount} teammates, tap to see people`}
          accessibilityState={{ expanded: showRail ? detailTab === "people" : peopleSheetOpen }}
          onPress={openPeople}
          style={styles.peopleTrigger}
        >
          <BrandGroupTile name={group?.brand_name || "Brand group"} photoUrl={group?.brand_photo_url} seed={group?.brand_id ?? conversationId ?? "brand"} size={38} />
          <View style={styles.headerCopy}>
            <Text style={styles.title} numberOfLines={1}>{group?.brand_name || "Brand group"}</Text>
            <Text style={[styles.subtitle, typingText && side === "team" ? styles.subtitleTyping : null, side === "guests" && styles.subtitleGuests]} numberOfLines={1}>{subtitle}</Text>
          </View>
        </Pressable>
        {showRail ? switcher : null}
        {!showRail && planBrandId ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("plan.pill_a11y")}
            hitSlop={5}
            onPress={() => setPlanPanelOpen(true)}
            style={styles.mediaButton}
            testID="brand-plan-pill"
          >
            <Icon name="calendar" size={16} color={brandGroupChat.textPrimary} />
            {compactHeaderButtons ? null : <Text style={styles.mediaButtonText}>{t("plan.pill")}</Text>}
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("chat.media_a11y")}
          accessibilityState={{ expanded: showRail ? mediaPanelOpen : undefined }}
          hitSlop={5}
          onPress={openMedia}
          style={[styles.mediaButton, showRail && detailTab === "media" && styles.mediaButtonActive]}
        >
          <Icon name="grid" size={16} color={brandGroupChat.textPrimary} />
          {compactHeaderButtons ? null : <Text style={styles.mediaButtonText}>{t("chat.media")}</Text>}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Brand group options"
          hitSlop={5}
          onPress={() => setOptionsOpen(true)}
          style={styles.iconButton}
          testID="brand-group-options"
        >
          <Icon name="moreH" size={20} color={brandGroupChat.textPrimary} />
        </Pressable>
      </View>

      {/* #4420: below the header, full width, on phones and narrow web. */}
      {!showRail && switcher ? <View style={[styles.switcherRow, side === "guests" && styles.headerGuests]}>{switcher}</View> : null}

      {group?.muted && side === "team" ? (
        <View style={styles.mutedNote}>
          <Text style={styles.mutedNoteText}>{"Muted: routine push alerts are off, but direct @mentions still notify you."}</Text>
        </View>
      ) : null}

      {notice ? <Pressable accessibilityRole="button" accessibilityLabel="Dismiss notification" onPress={() => setNotice(null)} style={styles.notice}><Text style={styles.noticeText}>{notice}</Text></Pressable> : null}

      {/* #4173 — keep the keyboard boundary in SafeScreen coordinates. The
          controller calculates overlap from this view's layout frame; nesting
          it around only the composer made that frame relative to threadColumn
          and omitted the header/workspace offset on iOS. Owning the full
          workspace keeps the composer directly above the Done bar + keyboard
          while preserving the same row layout on web. */}
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={DONE_BAR_OCCUPIED}
        style={styles.workspace}
      >
      <View style={styles.threadColumn}>
      {side === "guests" && guestChat ? (
        // #4420: the Guests side. Its draft and first-send check live here,
        // so a switch to Team and back keeps them for this thread open.
        <LazyGroupChatPanel
          key={guestChat.brand_id}
          brandId={guestChat.brand_id}
          embedded
          thread={{
            draft: guestDraft,
            onDraftChange: setGuestDraft,
            onSent: (_target: BrandThreadSendTarget, text: string) => {
              setGuestDraft((current) => (current.trim() === text.trim() ? "" : current));
            },
            sendConfirmed: guestSendConfirmed,
            onSendConfirmed: () => setGuestSendConfirmed(true),
            onRead: () => void refreshGuestActivity(),
            // #4420 SC-15 / SC-16: guest messages get the same links and Select text.
            renderText: (content: string, mine: boolean) => (
              <BrandGroupMessageText
                content={content}
                mine={mine}
                mentionNames={[]}
                onOpenLink={openLink}
                onLongPress={Platform.OS === "web" ? undefined : () => setSelectText(content)}
              />
            ),
          }}
        />
      ) : (
      <>
      {loading ? (
        <View style={styles.state}><ActivityIndicator color={color.text2} /></View>
      ) : error ? (
        <View style={styles.state}>
          <Text style={styles.stateText}>{error}</Text>
          <Button label="Retry" variant="secondary" onPress={() => void refresh()} />
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.messages}
          contentContainerStyle={styles.messagesContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={followLatestMessage}
          onScroll={updateLatestMessageProximity}
          scrollEventThrottle={16}
          testID="brand-group-message-scroll"
        >
          {messages.length === 0 && pendingUploads.length === 0 ? (
            <View style={styles.empty}><Text style={styles.stateText}>This is the official Brand group. Start the first conversation here.</Text></View>
          ) : threadItems.map((item) => {
            if (item.kind === "plan") {
              return (
                <View key={item.key} style={styles.cardRow}>
                  <BrandPlanActivityCard lines={item.lines} onOpenPlan={openPlan} />
                </View>
              );
            }
            if (item.kind === "day") {
              return (
                <View key={item.key} style={styles.dayRow} accessibilityRole="header">
                  <Text style={styles.dayText}>{item.label}</Text>
                </View>
              );
            }
            const message = item.message;
            const recordOffset = (event: LayoutChangeEvent): void => {
              messageOffsets.current.set(message.id, event.nativeEvent.layout.y);
            };
            // A quiet centred line: no bubble, no menu. Plan updates (#4270)
            // and other system notes use this path.
            if (message.message_type === "system") {
              return (
                <View key={message.id} onLayout={recordOffset} style={styles.systemLine} testID="brand-group-system-line">
                  <Text style={styles.systemLineText}>{message.content}</Text>
                </View>
              );
            }
            // #4111 — a new customer enquiry: a card, never a chat bubble. It
            // names no guest (staff and scanners read Brand groups, D8).
            if (message.message_type === "brand_enquiry_card") {
              const cardEnquiryId = message.card_payload?.enquiry_id ?? null;
              return (
                <View key={message.id} onLayout={recordOffset} style={styles.cardRow}>
                  <BrandEnquiryCard
                    content={message.content}
                    createdAt={message.created_at}
                    onOpen={cardEnquiryId ? () => router.push(brandEnquiryThreadRoute(cardEnquiryId) as never) : null}
                  />
                </View>
              );
            }
            const mine = message.sender_id === user?.id;
            const supportIdentity = message.sender_role === "Mingla Support";
            const role = message.sender_role
              ?? (message.sender_id && memberRoles.has(message.sender_id) ? memberRoleLabel(memberRoles.get(message.sender_id) ?? "") : null);
            const mediaItem = message.file_id ? viewerItemMap.get(message.file_id) : undefined;
            const isMedia = mediaItem?.kind === "image" || mediaItem?.kind === "video";
            return (
              <View key={message.id} onLayout={recordOffset}>
                <BrandGroupMessageRow
                  message={message}
                  mine={mine}
                  position={item.position}
                  showSender={item.showSender}
                  showAvatar={item.showAvatar}
                  showTime={item.showTime}
                  senderLabel={`${message.sender_display_name}${role ? ` · ${supportIdentity ? "Mingla Support" : role}` : ""}`}
                  selected={selectedIds.includes(message.id)}
                  highlighted={highlightedMessageId === message.id}
                  reactions={live.reactionsByMessage.get(message.id) ?? []}
                  seenBy={seenBy?.messageId === message.id ? seenBy.text : null}
                  onOpenMenu={() => setMenuMessage(message)}
                  onReply={() => startReply(message)}
                  onHeart={() => live.toggleReaction(message.id, BRAND_GROUP_HEART)}
                  onToggleReaction={(emoji) => live.toggleReaction(message.id, emoji)}
                  renderBody={(openMenu) => message.file_id && message.file_name && message.file_mime ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={isMedia ? t(mediaItem?.kind === "video" ? "chat.video_bubble_a11y" : "chat.photo_bubble_a11y", { name: message.file_name, duration: formatMediaDuration(mediaItem?.durationMs) ?? "" }) : `Open ${message.file_name}`}
                      onPress={() => {
                        setPanelViewerItems(null);
                        setPreviewFileId(message.file_id);
                      }}
                      onLongPress={openMenu}
                      style={isMedia ? styles.mediaBubble : styles.fileCard}
                    >
                      {isMedia && mediaItem ? <BrandGroupMediaBubble item={mediaItem} name={message.file_name} sizeBytes={message.file_size} mine={mine} renderThumbnail={renderMediaThumbnail} thumbStyle={styles.mediaBubbleThumb} footerStyle={styles.mediaBubbleFooter} mineFooterStyle={styles.messageTextMine} /> : <><View style={[styles.fileCardIcon, mine && styles.fileCardIconMine]}><Icon name="notebook" size={20} color={mine ? brandGroupChat.mineText : color.accent} /></View><View style={styles.fileCardCopy}><Text style={[styles.fileName, mine && styles.messageTextMine]} numberOfLines={2}>{message.file_name}</Text><Text style={[styles.fileMeta, mine && styles.fileMetaMine]}>{t("chat.file_meta", { size: formatFileSize(message.file_size, (key, variables) => t(key, variables)) })}</Text></View></>}
                    </Pressable>
                  ) : <BrandGroupMessageText content={message.content} mine={mine} mentionNames={mentionNames} onOpenLink={openLink} onLongPress={() => setMenuMessage(message)} />}
                />
              </View>
            );
          })}
          {pendingUploads.map((upload) => (
            <BrandGroupPendingUploadRow key={`pending-${upload.fileId}`} upload={upload} onRetry={uploadQueue.retry} onDismiss={uploadQueue.dismiss} />
          ))}
        </ScrollView>
      )}

      <View
        style={[
          styles.composer,
          {
            paddingBottom: liftedBottomSpacer(
              keyboardHeight > 0,
              Math.max(insets.bottom, space[2]),
            ),
          },
        ]}
      >
        {hasSwitcher ? (
          <View style={styles.teamAudience}>
            <View style={styles.teamAudienceChip} testID="brand-team-audience">
              <Icon name="shield" size={13} color={brandGroupChat.textSecondary} />
              <Text style={styles.teamAudienceText} numberOfLines={1}>To Team · private to your team and Mingla</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Switch to Guests" onPress={() => setSide("guests")} style={styles.teamAudienceSwap} testID="brand-team-switch-guests">
              <Text style={styles.teamAudienceSwapText}>Switch to Guests</Text>
            </Pressable>
          </View>
        ) : null}
        {canBrand && canSupport ? (
          <View style={styles.actorBar}>
            <Text style={styles.actorLabel}>Replying as</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Reply as Brand team" accessibilityState={{ selected: actorMode === "brand" }} onPress={() => setActorMode("brand")} style={[styles.actorChoice, actorMode === "brand" && styles.actorChoiceActive]}>
              <Text style={[styles.actorChoiceText, actorMode === "brand" && styles.actorChoiceTextActive]}>Brand team</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Reply as Mingla Support" accessibilityState={{ selected: actorMode === "support" }} onPress={() => setActorMode("support")} style={[styles.actorChoice, actorMode === "support" && styles.actorChoiceActive]}>
              <Text style={[styles.actorChoiceText, actorMode === "support" && styles.actorChoiceTextActive]}>Mingla Support</Text>
            </Pressable>
          </View>
        ) : null}
        {replyTo ? (
          <View style={styles.replyBar}>
            <View style={styles.replyBarAccent} />
            <View style={styles.headerCopy}>
              <Text style={styles.contextTitle} numberOfLines={1}>Replying to {replyTo.sender_display_name}</Text>
              <Text style={styles.contextText} numberOfLines={1}>{replyTo.file_name || replyTo.content}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Clear reply context" hitSlop={8} onPress={() => setReplyTo(null)} style={styles.contextClose}>
              <Icon name="close" size={16} color={brandGroupChat.textSoft} />
            </Pressable>
          </View>
        ) : null}
        {selectedMessages.length ? (
          <View style={styles.selectedBar}>
            <Text style={styles.selectedNote}>{selectedMessages.length} related message{selectedMessages.length === 1 ? "" : "s"} selected</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Clear selected messages" hitSlop={8} onPress={() => setSelectedIds([])}>
              <Text style={styles.selectedClear}>Clear</Text>
            </Pressable>
          </View>
        ) : null}
        {mentionTarget ? (
          <View style={styles.mentionMenu} accessibilityLabel="Brand group mention suggestions">
            {mentionLoading ? (
              <View style={styles.mentionState}>
                <ActivityIndicator size="small" color={color.text2} />
                <Text style={styles.mentionStateText}>Finding teammates…</Text>
              </View>
            ) : mentionCandidates.length ? mentionCandidates.map((candidate) => (
              <Pressable
                key={candidate.user_id}
                accessibilityRole="button"
                accessibilityLabel={`Mention ${candidate.display_name}`}
                onPress={() => chooseMention(candidate)}
                style={({ pressed }) => [styles.mentionOption, pressed && styles.mentionOptionPressed]}
              >
                <View style={styles.mentionAvatar}>
                  <Text style={styles.mentionAvatarText}>{candidate.display_name.trim().charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.headerCopy}>
                  <Text style={styles.mentionName}>{candidate.display_name}</Text>
                  {candidate.username ? <Text style={styles.mentionUsername}>@{candidate.username}</Text> : null}
                </View>
              </Pressable>
            )) : (
              <Text style={styles.mentionStateText}>No teammates match “{mentionTarget.query}”.</Text>
            )}
          </View>
        ) : null}
        {/* #4420 round 3 (6, 24): floating composer. Attach sits inside the
            field; send is an icon-only Paper circle outside it, dimmed until
            there is text. Nothing the bar did before is lost. */}
        <View style={styles.composerRow}>
        <View style={styles.composerLine}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add files"
            disabled={sending || loading || Boolean(error)}
            onPress={() => setFilePickerVisible(true)}
            style={styles.attachButton}
            hitSlop={4}
          >
            <Icon name="plus" size={22} color={brandGroupChat.textSecondary} />
          </Pressable>
          <TextInput
            ref={composerRef}
            value={composer}
            onChangeText={updateComposer}
            onSelectionChange={updateComposerSelection}
            onContentSizeChange={growComposer}
            onKeyPress={composerKeyPress}
            onBlur={live.stopTyping}
            placeholder={actorMode === "support" ? "Reply as Mingla Support" : "Message your Brand group"}
            placeholderTextColor={brandGroupChat.textMuted}
            style={[styles.input, { height: composerHeight }]}
            multiline
            blurOnSubmit={false}
            editable={!sending && !loading && !error}
            accessibilityLabel="Brand group message"
            testID="brand-group-composer"
          />
        </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !composer.trim() || sending, busy: sending }}
            disabled={!composer.trim() || sending}
            onPress={() => void send()}
            style={[styles.sendButton, (!composer.trim() || sending) && styles.sendButtonDisabled]}
            testID="brand-group-send"
          >
            {sending ? <ActivityIndicator size="small" color={color.ink} /> : <Icon name="send" size={20} color={composer.trim() ? color.ink : color.text4} />}
          </Pressable>
        </View>
      </View>
      </>
      )}
      </View>
      {showRail && conversationId ? (
        <View style={styles.detailsRail}>
          <BrandGroupRailTabRow
            active={detailTab}
            tabs={[
              { key: "people", label: `People · ${members.length || "—"}`, accessibilityLabel: "Show people", onPress: () => { setDesktopDetailTab("people"); setMediaPanelOpen(false); } },
              // #4270 — the brand's plan, for the brand's own team.
              ...(planBrandId
                ? [{ key: "plan", label: t("plan.pill"), accessibilityLabel: t("plan.pill_a11y"), onPress: () => { setDesktopDetailTab("plan"); setMediaPanelOpen(false); }, testID: "brand-plan-rail-tab" }]
                : []),
              { key: "media", label: t("chat.media"), accessibilityLabel: "Show media", onPress: openMedia },
            ]}
          />
          {detailTab === "people" ? (
            <BrandGroupPeoplePanel
              groupName={group?.brand_name ?? "Brand group"}
              members={members}
              loading={memberQuery.isLoading}
              error={memberError}
              muted={group?.muted ?? false}
              muteBusy={!group || muteBusy}
              onToggleMute={() => void toggleMute()}
            />
          ) : detailTab === "plan" && planBrandId ? (
            <View style={styles.mediaRail}>
              <React.Suspense fallback={<View style={styles.mediaPanelLoading}><ActivityIndicator color={color.text2} /></View>}>
                <LazyBrandPlanPanel compact brandId={planBrandId} />
              </React.Suspense>
            </View>
          ) : (
            <View style={styles.mediaRail}>
              <React.Suspense fallback={<View style={styles.mediaPanelLoading}><ActivityIndicator color={color.text2} /></View>}>
                <LazyBrandGroupMediaPanel
                  compact
                  conversationId={conversationId}
                  groupName={group?.brand_name ?? "Brand group"}
                  renderThumbnail={renderMediaThumbnail}
                  onOpenItems={(items, fileId) => {
                    setPanelViewerItems(items);
                    setPreviewFileId(fileId);
                  }}
                />
              </React.Suspense>
            </View>
          )}
        </View>
      ) : null}
      </KeyboardAvoidingView>

      {!showRail && peopleSheetOpen ? (
        <BrandGroupPeopleSheet
          visible
          groupName={group?.brand_name ?? "Brand group"}
          members={members}
          loading={memberQuery.isLoading}
          error={memberError}
          muted={group?.muted ?? false}
          muteBusy={!group || muteBusy}
          onToggleMute={() => void toggleMute()}
          onClose={() => setPeopleSheetOpen(false)}
        />
      ) : null}

      {optionsOpen ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setOptionsOpen(false)}>
          {/* The scrim is a sibling behind the card, never its parent: a button inside a button is invalid on web. */}
          <View style={styles.optionsScrim}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close options" style={StyleSheet.absoluteFill} onPress={() => setOptionsOpen(false)} />
            <View style={styles.optionsCard} testID="brand-group-options-menu">
              <Pressable accessibilityRole="button" accessibilityLabel="Show people" onPress={() => { setOptionsOpen(false); openPeople(); }} style={({ pressed }) => [styles.optionRow, pressed && styles.optionRowPressed]}>
                <Icon name="users" size={18} color={brandGroupChat.textSecondary} />
                <Text style={styles.optionText}>People</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Show media" onPress={() => { setOptionsOpen(false); openMedia(); }} style={({ pressed }) => [styles.optionRow, pressed && styles.optionRowPressed]}>
                <Icon name="grid" size={18} color={brandGroupChat.textSecondary} />
                <Text style={styles.optionText}>{t("chat.media")}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={group?.muted ? "Unmute notifications" : "Mute notifications"}
                disabled={!group || muteBusy}
                onPress={() => { setOptionsOpen(false); void toggleMute(); }}
                style={({ pressed }) => [styles.optionRow, pressed && styles.optionRowPressed, (!group || muteBusy) && styles.optionRowDisabled]}
              >
                <Icon name={group?.muted ? "volume" : "volumeOff"} size={18} color={brandGroupChat.textSecondary} />
                <Text style={styles.optionText}>{group?.muted ? "Unmute notifications" : "Mute notifications"}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}

      {selectText !== null ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setSelectText(null)}>
          {/* #4420 SC-16: the message in a read-only field the OS lets you
              partly select and copy. Close button, backdrop and back all
              dismiss it. */}
          <View style={styles.optionsScrim}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close select text" style={StyleSheet.absoluteFill} onPress={() => setSelectText(null)} />
            <View style={styles.selectSheet} testID="brand-group-select-text">
              <View style={styles.selectSheetHead}>
                <Text style={styles.selectSheetTitle}>Select text</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={6} onPress={() => setSelectText(null)} style={styles.iconButton} testID="brand-group-select-text-close">
                  <Icon name="close" size={18} color={brandGroupChat.textPrimary} />
                </Pressable>
              </View>
              <Text style={styles.selectSheetHint}>Press and hold to select the part you want, then Copy.</Text>
              <TextInput
                value={selectText}
                onChangeText={() => undefined}
                multiline
                scrollEnabled
                showSoftInputOnFocus={false}
                caretHidden
                contextMenuHidden={false}
                accessibilityLabel="Message text, read only"
                style={styles.selectSheetField}
                testID="brand-group-select-text-field"
              />
            </View>
          </View>
        </Modal>
      ) : null}
      <BrandGroupMessageMenu
        message={menuMessage}
        actions={menuActions}
        myReactions={myMenuReactions}
        onReact={(emoji) => {
          const target = menuMessage;
          setMenuMessage(null);
          if (target) live.toggleReaction(target.id, emoji);
        }}
        onAction={runMenuAction}
        onClose={() => setMenuMessage(null)}
      />
      <BrandGroupSignalModal
        visible={signalSourceId !== null}
        brandName={group?.brand_name || "Brand group"}
        messages={messages}
        sourceMessageId={signalSourceId}
        relatedMessageIds={selectedIds}
        onClose={() => setSignalSourceId(null)}
        onCreated={() => {
          setNotice("Product signal created privately and linked to this conversation.");
          setSelectedIds([]);
        }}
      />
      {conversationId ? (
        <BrandGroupFileUploadSheet
          visible={filePickerVisible}
          conversationId={conversationId}
          actorMode={actorMode}
          onClose={() => setFilePickerVisible(false)}
          onQueued={queueUploads}
        />
      ) : null}
      {filePreview}
      <Toast
        visible={toast.visible}
        kind={toast.kind}
        message={toast.message}
        onDismiss={() => setToast({ visible: false, message: "", kind: "error" })}
      />
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: brandGroupChat.screenBg },
  desktopShell: { flex: 1, flexDirection: "row", backgroundColor: brandGroupChat.screenBg },
  // #4420 one-thread design: fixed desktop columns, inbox 360, rail 400.
  desktopList: { width: 360, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: brandGroupChat.hairline, paddingTop: space[2] },
  desktopThread: { flex: 1, minWidth: 0 },
  header: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[2], paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: brandGroupChat.hairline, backgroundColor: brandGroupChat.screenBg },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, minWidth: 0 },
  peopleTrigger: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10 },
  title: { color: brandGroupChat.textPrimary, fontSize: 17, fontWeight: "700" },
  subtitle: { color: brandGroupChat.textSoft, fontSize: 12, marginTop: 1 },
  subtitleTyping: { color: brandGroupChat.accent, fontWeight: "600" },
  // #4420 Guests side: the header edge and subtitle turn info blue.
  headerGuests: { borderBottomColor: color.guestLine },
  subtitleGuests: { color: color.infoText },
  switcher: { flexDirection: "row", gap: 2, padding: 3, borderRadius: radius.full, borderWidth: 1, borderColor: color.line, backgroundColor: color.fill.input },
  switcherFull: { alignSelf: "stretch" },
  switcherRow: { paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: brandGroupChat.hairline },
  switcherTab: { minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 14, borderRadius: radius.full, borderWidth: 1, borderColor: color.transparent },
  switcherTabFull: { flex: 1 },
  switcherTabTeamOn: { backgroundColor: color.fill.tabOn, borderColor: color.line },
  switcherTabGuestsOn: { backgroundColor: color.guestTint2, borderColor: color.guestLine },
  switcherText: { color: color.text2, fontSize: 14, fontWeight: "600" },
  switcherTextOn: { color: color.textStrong },
  switcherTextGuestsOn: { color: color.infoText },
  switcherBadge: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: color.paper },
  switcherBadgeText: { color: color.ink, fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] },
  switcherBadgeGuests: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: color.info },
  switcherBadgeGuestsText: { color: color.textStrong, fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] },
  teamAudience: { flexDirection: "row", alignItems: "center", gap: space[2] },
  teamAudienceChip: { flexShrink: 1, minHeight: 26, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: radius.full, backgroundColor: color.fill.tile },
  teamAudienceText: { flexShrink: 1, color: brandGroupChat.textSecondary, fontSize: 13, fontWeight: "600" },
  teamAudienceSwap: { marginLeft: "auto", minHeight: 32, justifyContent: "center", paddingHorizontal: 10, borderRadius: radius.full, borderWidth: 1, borderColor: color.line },
  teamAudienceSwapText: { color: brandGroupChat.textSecondary, fontSize: 13, fontWeight: "600" },
  // #4420 plan activity card.
  planCard: { alignSelf: "center", width: "100%", maxWidth: 540, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: color.line, borderTopColor: color.lineStrong, backgroundColor: color.card },
  planCardHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  planCardIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: color.fill.tile },
  planCardTitle: { color: color.text1, fontSize: 15, lineHeight: 21, fontWeight: "600" },
  planCardSub: { color: color.text3, fontSize: 13 },
  planCardList: { marginTop: 12, borderTopWidth: 1, borderTopColor: color.line },
  planCardLine: { minHeight: 40, justifyContent: "center", paddingVertical: 8, paddingHorizontal: 2, borderBottomWidth: 1, borderBottomColor: color.line },
  planCardLineText: { color: color.text1, fontSize: 14, lineHeight: 20 },
  planCardFoot: { flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: 12 },
  mediaButton: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 22, borderWidth: 1, borderColor: color.lineStrong, backgroundColor: color.fill.pressed },
  mediaButtonActive: { borderColor: color.lineStrong, shadowColor: color.accent, shadowOpacity: 0.35, shadowRadius: 10 },
  mediaButtonText: { color: brandGroupChat.textPrimary, fontSize: 13, fontWeight: "700" },
  detailsRail: { width: size.sidePanel, minWidth: 300, maxWidth: "36%", borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: brandGroupChat.hairline, backgroundColor: brandGroupChat.surface },
  mediaRail: { flex: 1, minHeight: 0 },
  railTabs: { minHeight: 56, flexDirection: "row", gap: 4, alignItems: "center", paddingHorizontal: space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: brandGroupChat.hairline },
  railTab: { minHeight: 40, flex: 1, alignItems: "center", justifyContent: "center", borderRadius: radius.full },
  railTabActive: { borderWidth: 1, borderColor: color.lineStrong, backgroundColor: color.fill.tabOn },
  railTabText: { color: brandGroupChat.textSoft, fontSize: 12, fontWeight: "700" },
  railTabTextActive: { color: brandGroupChat.textPrimary, fontSize: 12, fontWeight: "800" },
  mediaPanelLoading: { flex: 1, alignItems: "center", justifyContent: "center" },
  mutedNote: { paddingHorizontal: space[4], paddingVertical: 6, backgroundColor: brandGroupChat.accentSoft },
  mutedNoteText: { color: brandGroupChat.textSecondary, fontSize: 12, textAlign: "center" },
  notice: { paddingHorizontal: space[4], paddingVertical: space[2], backgroundColor: brandGroupChat.accentSoft },
  noticeText: { color: brandGroupChat.textSecondary, fontSize: 12, textAlign: "center" },
  workspace: { flex: 1, flexDirection: "row" },
  threadColumn: { flex: 1, minWidth: 0 },
  state: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[4], padding: space[6] },
  stateText: { color: brandGroupChat.textSecondary, textAlign: "center", lineHeight: 20 },
  messages: { flex: 1 },
  messagesContent: { paddingHorizontal: 12, paddingTop: space[4], paddingBottom: space[6] },
  empty: { margin: space[6], padding: space[7], borderRadius: 20, backgroundColor: brandGroupChat.surface },
  dayRow: { alignItems: "center", marginVertical: 12 },
  dayText: { color: brandGroupChat.textSoft, fontSize: 12, fontWeight: "700", paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, overflow: "hidden", backgroundColor: brandGroupChat.strip },
  systemLine: { alignItems: "center", paddingHorizontal: space[7], marginVertical: 8 },
  systemLineText: { color: brandGroupChat.textMuted, fontSize: 12, lineHeight: 17, textAlign: "center" },
  cardRow: { marginVertical: 8 },
  messageTextMine: { color: brandGroupChat.mineText },
  fileCard: { minWidth: 220, flexDirection: "row", alignItems: "center", gap: space[2] },
  fileCardIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: color.fill.tabOn },
  fileCardIconMine: { backgroundColor: color.spinnerTrackOnPaper },
  fileCardCopy: { flex: 1, minWidth: 0 },
  fileName: { color: brandGroupChat.textPrimary, fontSize: 14, lineHeight: 18, fontWeight: "800" },
  fileMeta: { color: brandGroupChat.textMuted, fontSize: 11, marginTop: 3 },
  fileMetaMine: { color: brandGroupChat.mineTextSecondary },
  mediaBubble: { width: 210, marginHorizontal: -10, marginVertical: -5, borderRadius: 16, overflow: "hidden" },
  mediaBubbleThumb: { width: 210, height: 160 },
  mediaBubbleFooter: { color: brandGroupChat.textPrimary, fontSize: 11, paddingHorizontal: 10, paddingVertical: 7 },
  composer: { paddingHorizontal: space[3], paddingTop: space[2], gap: space[2] },
  actorBar: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: 4 },
  actorLabel: { color: brandGroupChat.textMuted, fontSize: 12 },
  actorChoice: { minHeight: 32, justifyContent: "center", paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: brandGroupChat.hairline },
  actorChoiceActive: { borderColor: color.lineStrong, backgroundColor: brandGroupChat.accentSoft },
  actorChoiceText: { color: brandGroupChat.textSecondary, fontSize: 12 },
  actorChoiceTextActive: { color: color.text1, fontWeight: "700" },
  replyBar: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 16, backgroundColor: brandGroupChat.surfaceRaised },
  replyBarAccent: { width: 3, alignSelf: "stretch", borderRadius: 2, backgroundColor: brandGroupChat.quoteBar },
  contextTitle: { color: brandGroupChat.textPrimary, fontSize: 12, fontWeight: "700" },
  contextText: { color: brandGroupChat.textSoft, fontSize: 12, marginTop: 1 },
  contextClose: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  selectedBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 6 },
  selectedNote: { color: brandGroupChat.selected, fontSize: 12, fontWeight: "700" },
  selectedClear: { color: brandGroupChat.accent, fontSize: 12, fontWeight: "700" },
  mentionMenu: { maxHeight: 220, overflow: "hidden", borderRadius: 16, borderWidth: 1, borderColor: brandGroupChat.hairline, backgroundColor: brandGroupChat.surface },
  mentionState: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[2], padding: space[2] },
  mentionStateText: { color: brandGroupChat.textMuted, fontSize: 12, padding: space[2] },
  mentionOption: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[4], paddingVertical: space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: brandGroupChat.hairline },
  mentionOptionPressed: { backgroundColor: brandGroupChat.strip },
  mentionAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: brandGroupChat.mentionBg },
  mentionAvatarText: { color: brandGroupChat.mentionText, fontSize: 13, fontWeight: "800" },
  mentionName: { color: brandGroupChat.textPrimary, fontSize: 13, fontWeight: "700" },
  mentionUsername: { color: brandGroupChat.textMuted, fontSize: 11, marginTop: 1 },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: space[2] },
  composerLine: { flex: 1, flexDirection: "row", alignItems: "flex-end", gap: space[1], padding: space[1], borderRadius: brandGroupChat.composerRadius, borderWidth: 1, borderColor: brandGroupChat.hairline, backgroundColor: brandGroupChat.surfaceRaised },
  attachButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, minHeight: COMPOSER_MIN, maxHeight: COMPOSER_MAX, paddingHorizontal: 4, paddingTop: 10, paddingBottom: 10, color: brandGroupChat.textPrimary, fontSize: 16, lineHeight: 20 },
  sendButton: { width: size.btn.phone, height: size.btn.phone, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: color.paper },
  sendButtonDisabled: { backgroundColor: color.card2 },
  optionsScrim: { flex: 1, alignItems: "flex-end", paddingTop: 64, paddingHorizontal: space[4], backgroundColor: brandGroupChat.scrim },
  selectSheet: { alignSelf: "stretch", maxHeight: "80%", gap: space[2], padding: space[5], paddingBottom: space[7], borderRadius: 28, borderWidth: 1, borderColor: brandGroupChat.hairline, backgroundColor: brandGroupChat.surface },
  selectSheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  selectSheetTitle: { color: brandGroupChat.textPrimary, fontSize: 17, fontWeight: "700" },
  selectSheetHint: { color: brandGroupChat.textSoft, fontSize: 13 },
  selectSheetField: { minHeight: 120, maxHeight: 360, padding: space[3], borderRadius: 16, borderWidth: 1, borderColor: color.line, backgroundColor: color.fill.input, color: brandGroupChat.textPrimary, fontSize: 16, lineHeight: 22, textAlignVertical: "top" },
  optionsCard: { width: 240, overflow: "hidden", borderRadius: 16, borderWidth: 1, borderColor: brandGroupChat.hairline, backgroundColor: brandGroupChat.surface },
  optionRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
  optionRowPressed: { backgroundColor: brandGroupChat.strip },
  optionRowDisabled: { opacity: 0.5 },
  optionText: { color: brandGroupChat.textPrimary, fontSize: 15, fontWeight: "600" },
});
