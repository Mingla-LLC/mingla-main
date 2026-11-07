import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { BrandGroupSignalModal } from "../../src/components/messages/BrandGroupSignalModal";
import { BrandGroupFilePreviewModal } from "../../src/components/messages/BrandGroupFilePreviewModal";
import { BrandGroupFileUploadSheet } from "../../src/components/messages/BrandGroupFileUploadSheet";
import { BrandGroupMediaBubble } from "../../src/components/messages/BrandGroupMediaBubble";
import { BrandGroupPeoplePanel, BrandGroupPeopleSheet, memberRoleLabel } from "../../src/components/messages/BrandGroupPeoplePanel";
import { BrandEnquiryCard } from "../../src/components/messages/BrandEnquiryCard";
import { BrandGroupInboxList } from "../../src/components/messages/BrandGroupInboxList";
import { BrandGroupMessageMenu } from "../../src/components/messages/BrandGroupMessageMenu";
import { BrandGroupMessageRow, BrandGroupMessageText } from "../../src/components/messages/BrandGroupMessageRow";
import { BrandGroupTile } from "../../src/components/messages/BrandGroupTile";
import { Button } from "../../src/components/ui/Button";
import { Icon } from "../../src/components/ui/Icon";
import { SafeScreen } from "../../src/components/ui/SafeScreen";
import { Toast, type ToastKind } from "../../src/components/ui/Toast";
import { brandGroupChat } from "../../src/constants/brandGroupChatTokens";
import { accent, spacing } from "../../src/constants/designSystem";
import { useAuth } from "../../src/context/AuthContext";
import { useBrandGroups } from "../../src/hooks/useBrandGroups";
import { useBrandGroupLive } from "../../src/hooks/useBrandGroupLive";
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
  type BrandGroupSummary,
} from "../../src/services/brandGroupsService";
import { listBrandGroupMembers, listBrandGroupMentionCandidates } from "../../src/services/brandGroupRosterService";
import { supabase } from "../../src/services/supabase";
import { fileMeta } from "../../src/services/brandGroupFileMetaService";
import type { BrandGroupMediaRow } from "../../src/services/brandGroupMediaService";
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
  BRAND_GROUP_HEART,
  brandGroupHeaderSubtitle,
  brandGroupSeenBy,
  brandGroupTypingText,
  buildBrandGroupMessageMenu,
  buildBrandGroupThreadItems,
  type BrandGroupMenuActionKey,
} from "../../src/utils/brandGroupThreadModel";

const LazyBrandGroupMediaPanel = React.lazy(async () => {
  const module = await import("../../src/components/messages/BrandGroupMediaPanel");
  return { default: module.BrandGroupMediaPanel };
});

const LazyMediaThumb = React.lazy(async () => {
  const module = await import("../../src/components/media/MediaThumb");
  return { default: module.MediaThumb };
});

/** #4304 — the desktop details rail collapses below this width. */
const DETAILS_RAIL_MIN_WIDTH = 1200;
const COMPOSER_MIN = 40;
const COMPOSER_MAX = 132;

function renderMediaThumbnail(item: BrandGroupMediaRow, style?: StyleProp<ViewStyle>, bubble = false): React.ReactNode {
  return (
    <React.Suspense fallback={<View style={style} />}>
      <LazyMediaThumb item={item} style={style} bubble={bubble} />
    </React.Suspense>
  );
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
        <View style={styles.state}><ActivityIndicator color={accent.warm} /></View>
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
  if (!isWideDesktop) return <BrandGroupThreadScreen key={conversationId ?? "none"} />;
  const openGroup = (group: BrandGroupSummary): void => {
    if (group.conversation_id === conversationId) return;
    router.setParams({
      conversationId: group.conversation_id,
      mode: group.access_kind === "support" ? "support" : "brand",
      focusMessageId: undefined,
      gallery: undefined,
    } as never);
  };
  return (
    <View
      style={[
        styles.desktopShell,
        Platform.OS === "web" && windowHeight > 0 ? { height: windowHeight } : null,
      ]}
      testID="brand-group-desktop-shell"
    >
      <View style={styles.desktopList}>
        <BrandGroupInboxList
          groups={groups}
          loading={loading}
          error={error ?? null}
          onRetry={() => void refresh()}
          viewerId={user?.id ?? null}
          isStaff={staff.isStaff}
          selectedId={conversationId}
          onOpen={openGroup}
        />
      </View>
      <View style={styles.desktopThread}>
        <BrandGroupThreadScreen key={conversationId ?? "none"} embedded />
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

function BrandGroupThreadScreen({ embedded = false }: { embedded?: boolean }): React.ReactElement {
  const params = useLocalSearchParams<{ conversationId?: string | string[]; mode?: string | string[]; focusMessageId?: string | string[]; gallery?: string | string[] }>();
  const conversationId = first(params.conversationId);
  const requestedMode = first(params.mode);
  const requestedFocusMessageId = first(params.focusMessageId);
  const requestedGallery = first(params.gallery);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight();
  const queryClient = useQueryClient();
  const { t } = useBusinessMediaTranslation();
  const { isWideDesktop, width: layoutWidth } = useResponsiveLayout();
  const showRail = isWideDesktop && (layoutWidth ?? 0) >= DETAILS_RAIL_MIN_WIDTH;
  const { isAuthReady, user } = useAuth();
  const staff = useSupportStaff();
  const { groups, refresh: refreshGroups, setMuted } = useBrandGroups();
  const group = groups.find((item) => item.conversation_id === conversationId) ?? null;
  const canBrand = group?.access_kind === "brand";
  const canSupport = staff.isStaff;
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
  const [desktopDetailTab, setDesktopDetailTab] = useState<"people" | "media">(
    requestedGallery === "1" ? "media" : "people",
  );
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
  const threadItems = useMemo(
    () => buildBrandGroupThreadItems(messages, user?.id ?? null),
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

  useEffect(() => {
    autoFollowLatest.current = requestedFocusMessageId === null;
    didInitialLatestScroll.current = false;
    messageOffsets.current.clear();
  }, [conversationId, requestedFocusMessageId]);

  useEffect(() => {
    if (requestedGallery === "1") {
      setMediaPanelOpen(true);
      setDesktopDetailTab("media");
    }
  }, [requestedGallery]);

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`brand-group:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["brandGroupMedia", "list", conversationId] });
          void queryClient.invalidateQueries({ queryKey: ["brandGroupMedia", "meta", conversationId] });
          void refresh();
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [conversationId, queryClient, refresh]);

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
      if (typeof y === "number") scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.md), animated: true });
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
    if (!conversationId || !composer.trim() || sending) return;
    setSending(true);
    try {
      await sendBrandGroupMessage({
        conversationId,
        content: composer.trim(),
        replyToId: replyTo?.id,
        relatedMessageIds: selectedIds,
        mentionedUserIds: selectedMentions.map((mention) => mention.userId),
        actorMode,
      });
      live.stopTyping();
      setComposer("");
      setComposerHeight(COMPOSER_MIN);
      setSelectedMentions([]);
      setMentionCandidates([]);
      setReplyTo(null);
      setSelectedIds([]);
      autoFollowLatest.current = true;
      await refresh();
    } catch (cause) {
      Alert.alert("Message not sent", cause instanceof Error ? cause.message : "Try again.");
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
    requestAnimationFrame(() => composerRef.current?.focus());
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

  if (!showRail && mediaPanelOpen && conversationId) {
    return (
      <SafeScreen edges={["top", "bottom"]} style={styles.screen}>
        <React.Suspense fallback={<View style={styles.state}><ActivityIndicator color={accent.warm} /></View>}>
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
  const subtitle = typingText ?? (brandGroupHeaderSubtitle(members, user?.id ?? null) || (group ? `${memberCount} teammates` : "Official Brand group"));
  const menuActions = menuMessage
    ? buildBrandGroupMessageMenu({
      senderName: menuMessage.sender_display_name,
      hasText: menuMessage.content.trim().length > 0 && !menuMessage.file_id,
      canSupport,
      selected: selectedIds.includes(menuMessage.id),
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
        Platform.OS === "web" && windowHeight > 0
          ? { height: windowHeight, flexGrow: 0, flexShrink: 0, flexBasis: "auto" }
          : null,
      ]}
      testID="brand-group-thread"
    >
      <View style={styles.header}>
        {!embedded ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back to Messages" onPress={() => router.back()} style={styles.iconButton} hitSlop={6}>
            <Icon name="arrowL" size={20} color={brandGroupChat.textPrimary} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${group?.brand_name || "Brand group"}, ${memberCount} teammates, tap to see people`}
          accessibilityState={{ expanded: showRail ? desktopDetailTab === "people" : peopleSheetOpen }}
          onPress={openPeople}
          style={styles.peopleTrigger}
        >
          <BrandGroupTile name={group?.brand_name || "Brand group"} photoUrl={group?.brand_photo_url} seed={group?.brand_id ?? conversationId ?? "brand"} size={38} />
          <View style={styles.headerCopy}>
            <Text style={styles.title} numberOfLines={1}>{group?.brand_name || "Brand group"}</Text>
            <Text style={[styles.subtitle, typingText ? styles.subtitleTyping : null]} numberOfLines={1}>{subtitle}</Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("chat.media_a11y")}
          accessibilityState={{ expanded: showRail ? mediaPanelOpen : undefined }}
          hitSlop={5}
          onPress={openMedia}
          style={[styles.mediaButton, showRail && desktopDetailTab === "media" && styles.mediaButtonActive]}
        >
          <Icon name="grid" size={16} color={brandGroupChat.textPrimary} />
          <Text style={styles.mediaButtonText}>{t("chat.media")}</Text>
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

      {group?.muted ? (
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
      {loading ? (
        <View style={styles.state}><ActivityIndicator color={accent.warm} /></View>
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
          {messages.length === 0 ? (
            <View style={styles.empty}><Text style={styles.stateText}>This is the official Brand group. Start the first conversation here.</Text></View>
          ) : threadItems.map((item) => {
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
                      {isMedia && mediaItem ? <BrandGroupMediaBubble item={mediaItem} name={message.file_name} sizeBytes={message.file_size} mine={mine} renderThumbnail={renderMediaThumbnail} thumbStyle={styles.mediaBubbleThumb} footerStyle={styles.mediaBubbleFooter} mineFooterStyle={styles.messageTextMine} /> : <><View style={[styles.fileCardIcon, mine && styles.fileCardIconMine]}><Icon name="notebook" size={20} color={mine ? brandGroupChat.mineText : accent.warm} /></View><View style={styles.fileCardCopy}><Text style={[styles.fileName, mine && styles.messageTextMine]} numberOfLines={2}>{message.file_name}</Text><Text style={[styles.fileMeta, mine && styles.fileMetaMine]}>{t("chat.file_meta", { size: formatFileSize(message.file_size, (key, variables) => t(key, variables)) })}</Text></View></>}
                    </Pressable>
                  ) : <BrandGroupMessageText content={message.content} mine={mine} mentionNames={mentionNames} />}
                />
              </View>
            );
          })}
        </ScrollView>
      )}

      <View
        style={[
          styles.composer,
          {
            paddingBottom: liftedBottomSpacer(
              keyboardHeight > 0,
              Math.max(insets.bottom, spacing.sm),
            ),
          },
        ]}
      >
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
                <ActivityIndicator size="small" color={accent.warm} />
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !composer.trim() || sending, busy: sending }}
            disabled={!composer.trim() || sending}
            onPress={() => void send()}
            style={[styles.sendButton, (!composer.trim() || sending) && styles.sendButtonDisabled]}
            testID="brand-group-send"
          >
            {sending ? <ActivityIndicator size="small" color={brandGroupChat.mineText} /> : <Icon name="send" size={18} color={brandGroupChat.mineText} />}
          </Pressable>
        </View>
      </View>
      </View>
      {showRail && conversationId ? (
        <View style={styles.detailsRail}>
          <BrandGroupRailTabRow
            active={desktopDetailTab}
            tabs={[
              { key: "people", label: `People · ${members.length || "—"}`, accessibilityLabel: "Show people", onPress: () => { setDesktopDetailTab("people"); setMediaPanelOpen(false); } },
              { key: "media", label: t("chat.media"), accessibilityLabel: "Show media", onPress: openMedia },
            ]}
          />
          {desktopDetailTab === "people" ? (
            <BrandGroupPeoplePanel
              groupName={group?.brand_name ?? "Brand group"}
              members={members}
              loading={memberQuery.isLoading}
              error={memberError}
              muted={group?.muted ?? false}
              muteBusy={!group || muteBusy}
              onToggleMute={() => void toggleMute()}
            />
          ) : (
            <View style={styles.mediaRail}>
              <React.Suspense fallback={<View style={styles.mediaPanelLoading}><ActivityIndicator color={accent.warm} /></View>}>
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
          <Pressable accessibilityRole="button" accessibilityLabel="Close options" style={styles.optionsScrim} onPress={() => setOptionsOpen(false)}>
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
          </Pressable>
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
          onUploaded={refresh}
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
  desktopList: { width: 280, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: brandGroupChat.hairline, paddingTop: spacing.sm },
  desktopThread: { flex: 1, minWidth: 0 },
  header: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: brandGroupChat.hairline, backgroundColor: brandGroupChat.screenBg },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, minWidth: 0 },
  peopleTrigger: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10 },
  title: { color: brandGroupChat.textPrimary, fontSize: 17, fontWeight: "700" },
  subtitle: { color: brandGroupChat.textSoft, fontSize: 12, marginTop: 1 },
  subtitleTyping: { color: brandGroupChat.accent, fontWeight: "600" },
  mediaButton: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 22, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", backgroundColor: "rgba(255,255,255,0.08)" },
  mediaButtonActive: { borderColor: "rgba(235,120,37,0.7)", shadowColor: accent.warm, shadowOpacity: 0.35, shadowRadius: 10 },
  mediaButtonText: { color: brandGroupChat.textPrimary, fontSize: 13, fontWeight: "700" },
  detailsRail: { width: 340, minWidth: 300, maxWidth: "36%", borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: brandGroupChat.hairline, backgroundColor: brandGroupChat.surface },
  mediaRail: { flex: 1, minHeight: 0 },
  railTabs: { minHeight: 56, flexDirection: "row", gap: 4, alignItems: "center", paddingHorizontal: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: brandGroupChat.hairline },
  railTab: { minHeight: 40, flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 999 },
  railTabActive: { borderWidth: 1, borderColor: "rgba(235,120,37,0.38)", backgroundColor: "rgba(235,120,37,0.10)" },
  railTabText: { color: brandGroupChat.textSoft, fontSize: 12, fontWeight: "700" },
  railTabTextActive: { color: brandGroupChat.textPrimary, fontSize: 12, fontWeight: "800" },
  mediaPanelLoading: { flex: 1, alignItems: "center", justifyContent: "center" },
  mutedNote: { paddingHorizontal: spacing.md, paddingVertical: 6, backgroundColor: brandGroupChat.accentSoft },
  mutedNoteText: { color: brandGroupChat.textSecondary, fontSize: 12, textAlign: "center" },
  notice: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: brandGroupChat.accentSoft },
  noticeText: { color: brandGroupChat.textSecondary, fontSize: 12, textAlign: "center" },
  workspace: { flex: 1, flexDirection: "row" },
  threadColumn: { flex: 1, minWidth: 0 },
  state: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  stateText: { color: brandGroupChat.textSecondary, textAlign: "center", lineHeight: 20 },
  messages: { flex: 1 },
  messagesContent: { paddingHorizontal: 12, paddingTop: spacing.md, paddingBottom: spacing.lg },
  empty: { margin: spacing.lg, padding: spacing.xl, borderRadius: 20, backgroundColor: brandGroupChat.surface },
  dayRow: { alignItems: "center", marginVertical: 12 },
  dayText: { color: brandGroupChat.textSoft, fontSize: 12, fontWeight: "700", paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, overflow: "hidden", backgroundColor: brandGroupChat.strip },
  systemLine: { alignItems: "center", paddingHorizontal: spacing.xl, marginVertical: 8 },
  systemLineText: { color: brandGroupChat.textMuted, fontSize: 12, lineHeight: 17, textAlign: "center" },
  cardRow: { marginVertical: 8 },
  messageTextMine: { color: brandGroupChat.mineText },
  fileCard: { minWidth: 220, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  fileCardIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.10)" },
  fileCardIconMine: { backgroundColor: "rgba(16,18,22,0.12)" },
  fileCardCopy: { flex: 1, minWidth: 0 },
  fileName: { color: brandGroupChat.textPrimary, fontSize: 14, lineHeight: 18, fontWeight: "800" },
  fileMeta: { color: brandGroupChat.textMuted, fontSize: 11, marginTop: 3 },
  fileMetaMine: { color: brandGroupChat.mineTextSecondary },
  mediaBubble: { width: 210, marginHorizontal: -10, marginVertical: -5, borderRadius: 16, overflow: "hidden" },
  mediaBubbleThumb: { width: 210, height: 160 },
  mediaBubbleFooter: { color: brandGroupChat.textPrimary, fontSize: 11, paddingHorizontal: 10, paddingVertical: 7 },
  composer: { paddingHorizontal: spacing.sm, paddingTop: 6, gap: 6, backgroundColor: brandGroupChat.screenBg },
  actorBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: 4 },
  actorLabel: { color: brandGroupChat.textMuted, fontSize: 12 },
  actorChoice: { minHeight: 32, justifyContent: "center", paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: brandGroupChat.hairline },
  actorChoiceActive: { borderColor: accent.warm, backgroundColor: brandGroupChat.accentSoft },
  actorChoiceText: { color: brandGroupChat.textSecondary, fontSize: 12 },
  actorChoiceTextActive: { color: accent.warm, fontWeight: "700" },
  replyBar: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 16, backgroundColor: brandGroupChat.surfaceRaised },
  replyBarAccent: { width: 3, alignSelf: "stretch", borderRadius: 2, backgroundColor: brandGroupChat.quoteBar },
  contextTitle: { color: brandGroupChat.textPrimary, fontSize: 12, fontWeight: "700" },
  contextText: { color: brandGroupChat.textSoft, fontSize: 12, marginTop: 1 },
  contextClose: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  selectedBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 6 },
  selectedNote: { color: brandGroupChat.selected, fontSize: 12, fontWeight: "700" },
  selectedClear: { color: brandGroupChat.accent, fontSize: 12, fontWeight: "700" },
  mentionMenu: { maxHeight: 220, overflow: "hidden", borderRadius: 16, borderWidth: 1, borderColor: brandGroupChat.hairline, backgroundColor: brandGroupChat.surface },
  mentionState: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.sm },
  mentionStateText: { color: brandGroupChat.textMuted, fontSize: 12, padding: spacing.sm },
  mentionOption: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: brandGroupChat.hairline },
  mentionOptionPressed: { backgroundColor: brandGroupChat.strip },
  mentionAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: brandGroupChat.mentionBg },
  mentionAvatarText: { color: brandGroupChat.mentionText, fontSize: 13, fontWeight: "800" },
  mentionName: { color: brandGroupChat.textPrimary, fontSize: 13, fontWeight: "700" },
  mentionUsername: { color: brandGroupChat.textMuted, fontSize: 11, marginTop: 1 },
  composerLine: { flexDirection: "row", alignItems: "flex-end", gap: 6, padding: 4, borderRadius: brandGroupChat.composerRadius, borderWidth: 1, borderColor: brandGroupChat.hairline, backgroundColor: brandGroupChat.surfaceRaised },
  attachButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, minHeight: COMPOSER_MIN, maxHeight: COMPOSER_MAX, paddingHorizontal: 4, paddingTop: 10, paddingBottom: 10, color: brandGroupChat.textPrimary, fontSize: 16, lineHeight: 20 },
  sendButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: brandGroupChat.accent },
  sendButtonDisabled: { opacity: 0.4 },
  optionsScrim: { flex: 1, alignItems: "flex-end", paddingTop: 64, paddingHorizontal: spacing.md, backgroundColor: brandGroupChat.scrim },
  optionsCard: { width: 240, overflow: "hidden", borderRadius: 16, borderWidth: 1, borderColor: brandGroupChat.hairline, backgroundColor: brandGroupChat.surface },
  optionRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
  optionRowPressed: { backgroundColor: brandGroupChat.strip },
  optionRowDisabled: { opacity: 0.5 },
  optionText: { color: brandGroupChat.textPrimary, fontSize: 15, fontWeight: "600" },
});
