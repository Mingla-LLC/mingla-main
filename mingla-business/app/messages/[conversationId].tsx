import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { BrandGroupSignalModal } from "../../src/components/messages/BrandGroupSignalModal";
import { BrandGroupFilePreviewModal } from "../../src/components/messages/BrandGroupFilePreviewModal";
import { BrandGroupFileUploadSheet } from "../../src/components/messages/BrandGroupFileUploadSheet";
import { BrandGroupMediaPanel } from "../../src/components/messages/BrandGroupMediaPanel";
import { MediaThumb } from "../../src/components/media/MediaThumb";
import { Button } from "../../src/components/ui/Button";
import { Icon } from "../../src/components/ui/Icon";
import { SafeScreen } from "../../src/components/ui/SafeScreen";
import { Toast } from "../../src/components/ui/Toast";
import {
  accent,
  canvas,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../src/constants/designSystem";
import { useAuth } from "../../src/context/AuthContext";
import { useBrandGroups } from "../../src/hooks/useBrandGroups";
import { useBrandGroupFileMeta } from "../../src/hooks/useBrandGroupMedia";
import { useResponsiveLayout } from "../../src/hooks/useResponsiveLayout";
import { useSupportStaff } from "../../src/hooks/useSupportStaff";
import { ScrollView } from "../../src/wrappers/SmartScrollView";
import {
  listBrandGroupMessages,
  markBrandGroupRead,
  sendBrandGroupMessage,
  type BrandGroupMessage,
} from "../../src/services/brandGroupsService";
import { supabase } from "../../src/services/supabase";
import type { BrandGroupMediaRow } from "../../src/services/brandGroupMediaService";
import { formatFileSize, formatMediaDuration } from "../../src/utils/formatMediaDuration";

function first(value: string | string[] | undefined): string | null {
  const item = Array.isArray(value) ? value[0] : value;
  return typeof item === "string" && item.length ? item : null;
}

export default function BrandGroupThreadRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ conversationId?: string | string[]; mode?: string | string[]; focusMessageId?: string | string[] }>();
  const conversationId = first(params.conversationId);
  const requestedMode = first(params.mode);
  const requestedFocusMessageId = first(params.focusMessageId);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { t } = useTranslation("brandGroupMedia");
  const { isWideDesktop } = useResponsiveLayout();
  const { user } = useAuth();
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
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<BrandGroupMessage | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [muteBusy, setMuteBusy] = useState(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });
  const [signalSourceId, setSignalSourceId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filePickerVisible, setFilePickerVisible] = useState(false);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [mediaPanelOpen, setMediaPanelOpen] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const scrollRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const messageOffsets = useRef<Map<string, number>>(new Map());
  const handledFocusMessageId = useRef<string | null>(null);
  const fileIds = useMemo(() => messages.flatMap((message) => message.file_id ? [message.file_id] : []), [messages]);
  const fileMetaQuery = useBrandGroupFileMeta(conversationId, fileIds);
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
      await refreshGroups();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load this Brand group");
    } finally {
      setLoading(false);
    }
  }, [conversationId, refreshGroups]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

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
    if (isWideDesktop) setMediaPanelOpen((value) => !value);
    else router.push({ pathname: "/messages/media/[conversationId]", params: { conversationId } });
  }, [conversationId, isWideDesktop, router]);

  const showInChat = useCallback(async (messageId: string): Promise<void> => {
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
      setToast({ visible: true, message: t("viewer.show_in_chat_missing") });
      return;
    }
    if (merged !== messages) setMessages(merged);
    setMediaPanelOpen(false);
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

  async function send(): Promise<void> {
    if (!conversationId || !composer.trim() || sending) return;
    setSending(true);
    try {
      await sendBrandGroupMessage({
        conversationId,
        content: composer.trim(),
        replyToId: replyTo?.id,
        relatedMessageIds: selectedIds,
        actorMode,
      });
      setComposer("");
      setReplyTo(null);
      setSelectedIds([]);
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
      setToast({
        visible: true,
        message: cause instanceof Error
          ? cause.message
          : "Couldn't update notifications. Try again.",
      });
    } finally {
      setMuteBusy(false);
    }
  }

  function toggleSelected(id: string): void {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  return (
    <SafeScreen edges={["top"]} style={styles.screen} testID="brand-group-thread">
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Messages" onPress={() => router.back()} style={styles.iconButton}>
          <Icon name="arrowL" size={18} color={textTokens.primary} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title} numberOfLines={1}>{group?.brand_name || "Brand group"}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{group ? `${group.member_count} brand teammates · Mingla Support can help here` : "Official Brand group"}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("chat.media_a11y")}
          accessibilityState={{ expanded: isWideDesktop ? mediaPanelOpen : undefined }}
          hitSlop={5}
          onPress={openMedia}
          style={[styles.mediaButton, mediaPanelOpen && styles.mediaButtonActive]}
        >
          <Icon name="grid" size={16} color={textTokens.primary} />
          <Text style={styles.mediaButtonText}>{t("chat.media")}</Text>
        </Pressable>
        <View style={styles.muteControl}>
          <Text style={styles.muteLabel}>Mute notifications</Text>
          <Switch
            value={group?.muted ?? false}
            onValueChange={() => void toggleMute()}
            disabled={!group || muteBusy}
            trackColor={{ false: "rgba(255,255,255,0.12)", true: accent.warm }}
            thumbColor="#ffffff"
            accessibilityLabel="Mute notifications"
            accessibilityState={{ checked: group?.muted ?? false, disabled: !group || muteBusy }}
          />
        </View>
      </View>

      {group?.muted ? (
        <View style={styles.mutedNote}>
          <Text style={styles.mutedNoteText}>Muted: you&apos;ll still see unread badges, but no push alerts for this group.</Text>
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

      {notice ? <Pressable accessibilityRole="button" accessibilityLabel="Dismiss notification" onPress={() => setNotice(null)} style={styles.notice}><Text style={styles.noticeText}>{notice}</Text></Pressable> : null}

      <View style={styles.workspace}>
      <View style={styles.threadColumn}>
      {loading ? (
        <View style={styles.state}><ActivityIndicator color={accent.warm} /></View>
      ) : error ? (
        <View style={styles.state}>
          <Text style={styles.stateText}>{error}</Text>
          <Button label="Retry" variant="secondary" onPress={() => void refresh()} />
        </View>
      ) : (
        <ScrollView ref={scrollRef} style={styles.messages} contentContainerStyle={styles.messagesContent} showsVerticalScrollIndicator={false}>
          {messages.length === 0 ? (
            <View style={styles.empty}><Text style={styles.stateText}>This is the official Brand group. Start the first conversation here.</Text></View>
          ) : messages.map((message) => {
            const mine = message.sender_id === user?.id;
            const selected = selectedIds.includes(message.id);
            const supportIdentity = message.sender_role === "Mingla Support";
            const mediaItem = message.file_id ? viewerItemMap.get(message.file_id) : undefined;
            const isMedia = mediaItem?.kind === "image" || mediaItem?.kind === "video";
            return (
              <View
                key={message.id}
                onLayout={(event: LayoutChangeEvent) => messageOffsets.current.set(message.id, event.nativeEvent.layout.y)}
                style={[styles.messageWrap, mine ? styles.messageWrapMine : styles.messageWrapOther]}
              >
                {!mine ? <Text style={styles.sender}>{message.sender_display_name}{supportIdentity ? " · Mingla Support" : ""}</Text> : null}
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther, selected && styles.bubbleSelected, highlightedMessageId === message.id && styles.bubbleHighlighted]}>
                  {message.reply_content ? (
                    <View style={styles.quote}>
                      <Text style={styles.quoteName}>{message.reply_sender_display_name || "Message"}</Text>
                      <Text style={styles.quoteText} numberOfLines={2}>{message.reply_content}</Text>
                    </View>
                  ) : null}
                  {message.file_id && message.file_name && message.file_mime ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={isMedia ? t(mediaItem?.kind === "video" ? "chat.video_bubble_a11y" : "chat.photo_bubble_a11y", { name: message.file_name, duration: formatMediaDuration(mediaItem?.durationMs) ?? "" }) : `Open ${message.file_name}`}
                      onPress={() => setPreviewFileId(message.file_id)}
                      style={isMedia ? styles.mediaBubble : styles.fileCard}
                    >
                      {isMedia && mediaItem ? <><MediaThumb item={mediaItem} bubble style={styles.mediaBubbleThumb} /><Text style={[styles.mediaBubbleFooter, mine && styles.messageTextMine]} numberOfLines={1}>{message.file_name} · {formatFileSize(message.file_size, (key, variables) => t(key, variables))}</Text></> : <><View style={styles.fileCardIcon}><Icon name="notebook" size={20} color={mine ? "#101216" : accent.warm} /></View><View style={styles.fileCardCopy}><Text style={[styles.fileName, mine && styles.messageTextMine]} numberOfLines={2}>{message.file_name}</Text><Text style={[styles.fileMeta, mine && styles.fileMetaMine]}>{t("chat.file_meta", { size: formatFileSize(message.file_size, (key, variables) => t(key, variables)) })}</Text></View></>}
                    </Pressable>
                  ) : <Text style={[styles.messageText, mine && styles.messageTextMine]}>{message.content}</Text>}
                  <Text style={styles.time}>{new Date(message.created_at).toLocaleString()}</Text>
                </View>
                <View style={[styles.actions, mine && styles.actionsMine]}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Reply to ${message.sender_display_name}`} onPress={() => setReplyTo(message)}><Text style={styles.actionText}>Reply</Text></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={selected ? "Remove message from related context" : "Add message to related context"} accessibilityState={{ selected }} onPress={() => toggleSelected(message.id)}><Text style={styles.actionText}>{selected ? "Unselect" : "Select"}</Text></Pressable>
                  {canSupport ? <Pressable accessibilityRole="button" accessibilityLabel="Create product signal from this message" onPress={() => setSignalSourceId(message.id)}><Text style={styles.actionText}>Create product signal</Text></Pressable> : null}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        {replyTo ? (
          <View style={styles.composerContext}>
            <View style={styles.headerCopy}><Text style={styles.contextTitle}>Replying to {replyTo.sender_display_name}</Text><Text style={styles.contextText} numberOfLines={1}>{replyTo.content}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Clear reply context" onPress={() => setReplyTo(null)}><Text style={styles.actionText}>Clear</Text></Pressable>
          </View>
        ) : null}
        {selectedMessages.length ? <Text style={styles.selectedNote}>{selectedMessages.length} related message{selectedMessages.length === 1 ? "" : "s"} selected</Text> : null}
        <View style={styles.composerLine}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add files"
            disabled={sending || loading || Boolean(error)}
            onPress={() => setFilePickerVisible(true)}
            style={styles.attachButton}
          >
            <Icon name="upload" size={20} color={accent.warm} />
          </Pressable>
          <TextInput
            value={composer}
            onChangeText={setComposer}
            placeholder={actorMode === "support" ? "Reply as Mingla Support" : "Message your Brand group"}
            placeholderTextColor={textTokens.tertiary}
            style={styles.input}
            multiline
            editable={!sending && !loading && !error}
            accessibilityLabel="Brand group message"
          />
          <Button label="Send" leadingIcon="send" loading={sending} disabled={!composer.trim() || sending} onPress={() => void send()} />
        </View>
      </View>
      </View>
      {isWideDesktop && mediaPanelOpen && conversationId ? <BrandGroupMediaPanel compact conversationId={conversationId} groupName={group?.brand_name ?? "Brand group"} onShowInChat={(messageId) => void showInChat(messageId)} /> : null}
      </View>

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
      <BrandGroupFilePreviewModal items={viewerItems} initialFileId={previewFileId} onShowInChat={(messageId) => void showInChat(messageId)} onClose={() => setPreviewFileId(null)} />
      <Toast
        visible={toast.visible}
        kind="error"
        message={toast.message}
        onDismiss={() => setToast({ visible: false, message: "" })}
      />
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: canvas.profile },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: glass.border.profileBase },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: glass.border.profileBase, backgroundColor: glass.tint.profileBase },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: textTokens.primary, fontSize: 18, fontWeight: "800" },
  subtitle: { color: textTokens.tertiary, fontSize: 12, marginTop: 2 },
  mediaButton: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", backgroundColor: "rgba(255,255,255,0.08)" },
  mediaButtonActive: { borderColor: "rgba(235,120,37,0.7)", shadowColor: accent.warm, shadowOpacity: 0.35, shadowRadius: 10 },
  mediaButtonText: { color: textTokens.primary, fontSize: 13, fontWeight: "700" },
  muteControl: { minHeight: 44, alignItems: "flex-end", justifyContent: "center", gap: 2 },
  muteLabel: { color: textTokens.secondary, fontSize: 11, fontWeight: "700" },
  mutedNote: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: "rgba(235,120,37,0.08)", borderBottomWidth: 1, borderBottomColor: "rgba(235,120,37,0.25)" },
  mutedNoteText: { color: textTokens.secondary, fontSize: 12, textAlign: "center" },
  actorBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: glass.border.profileBase },
  actorLabel: { color: textTokens.tertiary, fontSize: 12 },
  actorChoice: { minHeight: 36, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: 18, borderWidth: 1, borderColor: glass.border.profileElevated },
  actorChoiceActive: { borderColor: accent.warm, backgroundColor: "rgba(235,120,37,0.1)" },
  actorChoiceText: { color: textTokens.secondary, fontSize: 12 },
  actorChoiceTextActive: { color: accent.warm, fontWeight: "700" },
  notice: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: "rgba(235,120,37,0.08)", borderBottomWidth: 1, borderBottomColor: "rgba(235,120,37,0.25)" },
  noticeText: { color: textTokens.secondary, fontSize: 12, textAlign: "center" },
  workspace: { flex: 1, flexDirection: "row" },
  threadColumn: { flex: 1, minWidth: 0 },
  state: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  stateText: { color: textTokens.secondary, textAlign: "center", lineHeight: 20 },
  messages: { flex: 1 },
  messagesContent: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  empty: { padding: spacing.xl, borderRadius: radius.lg, borderWidth: 1, borderColor: glass.border.profileBase, backgroundColor: glass.tint.profileBase },
  messageWrap: { maxWidth: "84%", gap: 5 },
  messageWrapMine: { alignSelf: "flex-end", alignItems: "flex-end" },
  messageWrapOther: { alignSelf: "flex-start", alignItems: "flex-start" },
  sender: { color: textTokens.tertiary, fontSize: 11, fontWeight: "700", marginHorizontal: spacing.sm },
  bubble: { borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, borderWidth: 1 },
  bubbleMine: { backgroundColor: accent.warm, borderColor: accent.warm },
  bubbleOther: { backgroundColor: glass.tint.profileElevated, borderColor: glass.border.profileElevated },
  bubbleSelected: { borderColor: "#b995ff", borderWidth: 2 },
  bubbleHighlighted: { borderColor: accent.warm, borderWidth: 2, shadowColor: accent.warm, shadowOpacity: 0.45, shadowRadius: 8 },
  quote: { paddingLeft: spacing.sm, borderLeftWidth: 2, borderLeftColor: "rgba(255,255,255,0.55)", gap: 2 },
  quoteName: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "700" },
  quoteText: { color: "rgba(255,255,255,0.7)", fontSize: 11 },
  messageText: { color: textTokens.primary, fontSize: 15, lineHeight: 21 },
  messageTextMine: { color: "#101216" },
  fileCard: { minWidth: 220, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  fileCardIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.15)" },
  fileCardCopy: { flex: 1, minWidth: 0 },
  fileName: { color: textTokens.primary, fontSize: 14, lineHeight: 18, fontWeight: "800" },
  fileMeta: { color: textTokens.tertiary, fontSize: 10, marginTop: 3 },
  fileMetaMine: { color: "rgba(16,18,22,0.65)" },
  mediaBubble: { width: 190, borderRadius: radius.lg, overflow: "hidden" },
  mediaBubbleThumb: { width: 190, height: 150 },
  mediaBubbleFooter: { color: textTokens.primary, fontSize: 11, paddingHorizontal: 10, paddingVertical: 7 },
  time: { color: textTokens.tertiary, fontSize: 10 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, paddingHorizontal: spacing.sm },
  actionsMine: { justifyContent: "flex-end" },
  actionText: { color: accent.warm, fontSize: 12, fontWeight: "700" },
  composer: { borderTopWidth: 1, borderTopColor: glass.border.profileBase, paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.sm, backgroundColor: "rgba(12,14,18,0.96)" },
  composerContext: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: glass.tint.profileBase },
  contextTitle: { color: textTokens.primary, fontSize: 12, fontWeight: "700" },
  contextText: { color: textTokens.secondary, fontSize: 11 },
  selectedNote: { color: "#b995ff", fontSize: 12, fontWeight: "700" },
  composerLine: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  attachButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, borderWidth: 1, borderColor: glass.border.profileElevated, backgroundColor: glass.tint.profileElevated },
  input: { flex: 1, minHeight: 44, maxHeight: 120, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: glass.border.profileElevated, backgroundColor: glass.tint.profileElevated, color: textTokens.primary },
});
