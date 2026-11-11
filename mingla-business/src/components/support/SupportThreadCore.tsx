/**
 * SupportThreadCore — one support request's conversation (#4382 Wave 4,
 * built on META-ORCH-1104 and #3720).
 *
 *   - A status banner says where the request stands and when Mingla
 *     promised the next update.
 *   - Messages show their screenshots; a tap opens the full-size viewer
 *     (signed links that last one hour).
 *   - The composer sends text and screenshots through `support-send`
 *     (timestamps, audit, reopen-on-reply and pushes happen server-side).
 *   - A closed request replaces the composer with "Start a new request".
 *   - Opened from the staff console (`staffMode`), the same thread shows
 *     internal notes and offers a Reply / Internal note switch.
 *
 * Realtime uses the web-safe `conversation:{id}` channel. The only
 * native-only primitive, the keyboard wrapper, is injected through
 * `KeyboardWrap` so this file never imports the native keyboard module
 * (I-1104-NO-KBC-ON-WEB).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { supabase } from "../../services/supabase";
import { HELP_AND_SUPPORT_ROUTE, SUPPORT_HOST_FACING_AGENT } from "../../constants/supportHostFacing";
import { supportTicketKeys } from "../../hooks/useSupportTickets";
import {
  SupportSendError,
  getOwnSupportTicket,
  getSupportProductStage,
  listSupportThread,
  sendSupportMessage,
  signSupportAttachments,
  uploadSupportImage,
  type SupportThreadMessage,
  type SupportTicket,
} from "../../services/supportService";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { SafeScreen } from "../ui/SafeScreen";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { SupportImageStrip, SupportImageViewer } from "./SupportMedia";
import { pickSupportImages, SupportPhotoAccessError } from "./supportImagePicker";
import {
  MAX_SUPPORT_IMAGES,
  addSupportImages,
  formatTicketNumber,
  supportComposerMode,
  supportCopy,
  supportProductBannerKeys,
  supportStatusBanner,
  supportSystemLine,
  type SupportPickedImage,
  type SupportProductStage,
} from "./supportRequestModel";

/**
 * Platform-injected keyboard wrapper. On native this is the
 * react-native-keyboard-controller KeyboardAvoidingView; on web it is a
 * passthrough Fragment.
 */
export interface KeyboardWrapProps {
  children: React.ReactNode;
}
export type KeyboardWrapComponent = React.ComponentType<KeyboardWrapProps>;

interface SupportThreadCoreProps {
  ticketId: string;
  KeyboardWrap: KeyboardWrapComponent;
  /** Opened from the staff console: show internal notes, send as staff. */
  staffMode?: boolean;
}

interface ThreadData {
  ticket: SupportTicket | null;
  messages: SupportThreadMessage[];
  signed: Record<string, string>;
  productStage: SupportProductStage | null;
}

async function loadThread(ticketId: string): Promise<ThreadData> {
  const ticket = await getOwnSupportTicket(ticketId);
  if (ticket === null) return { ticket: null, messages: [], signed: {}, productStage: null };
  const messages = await listSupportThread(ticket);
  const paths = messages.flatMap((message) =>
    message.attachments.filter((a) => a.kind === "image").map((a) => a.storage_path),
  );
  // A link that fails to sign shows as "couldn't load", never blocks the thread.
  let signed: Record<string, string> = {};
  try {
    signed = await signSupportAttachments(paths);
  } catch (err) {
    console.warn("[support] signing attachment links failed", err instanceof Error ? err.message : err);
  }
  // The Product banner is extra context: a failed read hides it, never blocks the thread.
  let productStage: SupportProductStage | null = null;
  if (ticket.visibility !== "internal") {
    try {
      productStage = await getSupportProductStage(ticket.id);
    } catch (err) {
      console.warn("[support] reading the Product stage failed", err instanceof Error ? err.message : err);
    }
  }
  return { ticket, messages, signed, productStage };
}

export const SupportThreadCore: React.FC<SupportThreadCoreProps> = ({
  ticketId,
  KeyboardWrap,
  staffMode = false,
}) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const threadKey = supportTicketKeys.thread(ticketId);

  const [composer, setComposer] = useState("");
  const [images, setImages] = useState<SupportPickedImage[]>([]);
  const [noteMode, setNoteMode] = useState(false);
  const [sending, setSending] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active) setCurrentUserId(data.user?.id ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  const { data, isLoading, isError, error, refetch } = useQuery<ThreadData>({
    queryKey: threadKey,
    queryFn: () => loadThread(ticketId),
    staleTime: 15 * 1000,
  });
  const ticket = data?.ticket ?? null;
  const messages = useMemo(() => data?.messages ?? [], [data]);
  const productStage = data?.productStage ?? null;
  const signed = data?.signed ?? {};

  const refresh = useCallback(async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: supportTicketKeys.thread(ticketId) });
  }, [queryClient, ticketId]);

  // Realtime — pure JS SDK channel (web-safe). New messages and status
  // changes on this ticket re-read the thread.
  const conversationId = ticket?.conversation_id ?? null;
  useEffect(() => {
    if (conversationId === null) return;
    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          void refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "support_tickets",
          // Not the primary key (ORCH-0931): the ticket's own conversation.
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          void refresh();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, ticketId, refresh]);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace((staffMode ? "/support/inbox" : HELP_AND_SUPPORT_ROUTE) as never);
  }, [router, staffMode]);

  const handleStartNew = useCallback((): void => {
    router.replace(`${HELP_AND_SUPPORT_ROUTE}?tab=support&new=1` as never);
  }, [router]);

  const handleAddImages = useCallback(async (): Promise<void> => {
    try {
      const picked = await pickSupportImages(MAX_SUPPORT_IMAGES - images.length);
      if (picked.length === 0) return;
      const next = addSupportImages(images, picked);
      setImages(next.images);
      if (next.refusals.includes("too_many")) {
        Alert.alert(supportCopy("form.too_many_images", { max: MAX_SUPPORT_IMAGES }));
      } else if (next.refusals.length > 0) {
        Alert.alert(
          next.refusals.includes("too_large") ? supportCopy("form.image_too_large") : supportCopy("form.image_type"),
        );
      }
    } catch (err) {
      Alert.alert(
        err instanceof SupportPhotoAccessError
          ? supportCopy("form.photo_access_off")
          : supportCopy("form.pick_failed"),
      );
    }
  }, [images]);

  const isInternalTicket = ticket?.visibility === "internal";
  const sendingNote = staffMode && (noteMode || isInternalTicket);

  const handleSend = useCallback(async (): Promise<void> => {
    const content = composer.trim();
    if ((content.length === 0 && images.length === 0) || ticket == null) return;
    setSending(true);
    try {
      const attachmentIds: string[] = [];
      for (const image of images) {
        attachmentIds.push(await uploadSupportImage(ticket.id, image, { isInternal: sendingNote }));
      }
      // #3720: support-send owns insert + last_message_at + audit + push.
      await sendSupportMessage(ticket.id, content, {
        attachmentIds,
        actorMode: staffMode ? "staff" : "requester",
        isInternal: sendingNote,
      });
      setComposer("");
      setImages([]);
      await refresh();
    } catch (err) {
      if (err instanceof SupportSendError && err.code === "ticket_closed") {
        Alert.alert(supportCopy("thread.banner_closed"), supportCopy("thread.closed_error"));
        await refresh();
      } else {
        // The message is NOT silently dropped: the words stay in the box.
        Alert.alert(
          supportCopy("thread.not_sent_title"),
          err instanceof Error ? err.message : supportCopy("thread.not_sent_body"),
        );
      }
    } finally {
      setSending(false);
    }
  }, [composer, images, ticket, staffMode, sendingNote, refresh]);

  const banner = ticket ? supportStatusBanner(ticket) : null;
  const composerMode = supportComposerMode(ticket?.status);
  const header = ticket
    ? [formatTicketNumber(ticket.ticket_number), ticket.topic ? supportCopy(`topic.${ticket.topic}`) : null]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <SafeScreen style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={supportCopy("thread.back")}
          onPress={handleBack}
          style={styles.iconButton}
        >
          <Icon name="arrowL" size={18} color={textTokens.primary} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title} numberOfLines={1}>
            {ticket?.subject ?? SUPPORT_HOST_FACING_AGENT}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {header || supportCopy("thread.agent_line", { agent: SUPPORT_HOST_FACING_AGENT })}
            {staffMode && ticket?.origin === "staff"
              ? ` · ${supportCopy("staff.staff_chip", { visibility: supportCopy(`staff.visibility_${ticket.visibility ?? "person"}`) })}`
              : ""}
          </Text>
        </View>
        <View style={styles.iconButtonSpacer} />
      </View>

      {isLoading ? (
        <View style={styles.state}>
          <ActivityIndicator color={accent.warm} />
        </View>
      ) : isError ? (
        <View style={styles.state}>
          <Text style={styles.stateText}>
            {error instanceof Error ? error.message : supportCopy("thread.load_error")}
          </Text>
          <Button label={supportCopy("thread.retry")} onPress={() => void refetch()} variant="secondary" />
        </View>
      ) : ticket === null ? (
        <View style={styles.state}>
          <Text style={styles.stateText}>{supportCopy("thread.not_found")}</Text>
          <Button label={supportCopy("thread.back")} onPress={handleBack} variant="secondary" />
        </View>
      ) : (
        <>
          {banner !== null && !isInternalTicket ? (
            <View
              style={[
                styles.banner,
                banner.kind === "resolved" && styles.bannerResolved,
                banner.kind === "closed" && styles.bannerClosed,
              ]}
              accessibilityRole="summary"
            >
              <Text style={styles.bannerTitle}>
                {banner.kind === "waiting_mingla"
                  ? supportCopy("thread.banner_waiting_mingla")
                  : banner.kind === "waiting_you"
                    ? supportCopy("thread.banner_waiting_you")
                    : banner.kind === "resolved"
                      ? supportCopy("thread.banner_resolved")
                      : supportCopy("thread.banner_closed")}
              </Text>
              {banner.nextUpdateAt !== null ? (
                <Text style={styles.bannerBody}>
                  {supportCopy("thread.banner_next_update", { when: new Date(banner.nextUpdateAt).toLocaleString() })}
                </Text>
              ) : banner.kind === "resolved" && !staffMode ? (
                <Text style={styles.bannerBody}>{supportCopy("thread.banner_resolved_body")}</Text>
              ) : banner.kind === "closed" ? (
                <Text style={styles.bannerBody}>{supportCopy("thread.banner_closed_body")}</Text>
              ) : null}
            </View>
          ) : null}

          {productStage !== null && !isInternalTicket ? (
            <View style={[styles.banner, styles.bannerProduct]} accessibilityRole="summary">
              <Text style={styles.bannerTitle}>{supportCopy(supportProductBannerKeys(productStage).title)}</Text>
              <Text style={styles.bannerBody}>{supportCopy(supportProductBannerKeys(productStage).body)}</Text>
            </View>
          ) : null}

          <ScrollView
            style={styles.messages}
            contentContainerStyle={styles.messagesContent}
            showsVerticalScrollIndicator={false}
          >
            {messages.length === 0 ? (
              <View style={styles.threadEmpty}>
                <Text style={styles.threadEmptyText}>{supportCopy("thread.empty")}</Text>
              </View>
            ) : (
              messages.map((message) => {
                if (message.message_type === "system") {
                  return (
                    <Text key={message.id} style={styles.systemLine} accessibilityRole="text">
                      {supportSystemLine(message.content)}
                    </Text>
                  );
                }
                const mine = message.sender_id === currentUserId && !message.is_internal;
                const messageImages = message.attachments.filter((a) => a.kind === "image");
                return (
                  <View
                    key={message.id}
                    style={[
                      styles.messageRow,
                      message.is_internal
                        ? styles.messageRowNote
                        : mine ? styles.messageRowMine : styles.messageRowOther,
                    ]}
                  >
                    {message.is_internal ? (
                      <Text style={styles.noteLabel}>{supportCopy("thread.internal_note")}</Text>
                    ) : !mine ? (
                      <Text style={styles.agentLabel}>
                        {message.sender_display_name_snapshot
                          ? `${message.sender_display_name_snapshot} · ${message.sender_role_snapshot || SUPPORT_HOST_FACING_AGENT}`
                          : message.sender_role_snapshot || (staffMode ? supportCopy("thread.you") : SUPPORT_HOST_FACING_AGENT)}
                      </Text>
                    ) : null}
                    {message.content.length > 0 ? (
                      <Text style={[styles.messageText, mine && styles.messageTextMine]}>
                        {message.content}
                      </Text>
                    ) : null}
                    {messageImages.length > 0 ? (
                      <View style={styles.messageImages}>
                        {messageImages.map((attachment, index) => {
                          const url = signed[attachment.storage_path] ?? null;
                          return (
                            <Pressable
                              key={attachment.id}
                              onPress={() => url !== null && setViewerUrl(url)}
                              disabled={url === null}
                              accessibilityRole="imagebutton"
                              accessibilityLabel={supportCopy("thread.image_open", { index: index + 1 })}
                              style={styles.messageImage}
                            >
                              {url !== null ? (
                                <Image source={{ uri: url }} style={styles.messageImageFill} resizeMode="cover" />
                              ) : (
                                <Icon name="eye" size={16} color={textTokens.tertiary} />
                              )}
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : null}
                    <Text style={styles.messageMeta}>
                      {new Date(message.created_at).toLocaleString()}
                    </Text>
                  </View>
                );
              })
            )}
          </ScrollView>

          {composerMode === "start_new" ? (
            <View style={[styles.closedBox, { paddingBottom: Math.max(insets.bottom, 0) + spacing.lg }]}>
              {!staffMode ? (
                <Button label={supportCopy("thread.start_new")} leadingIcon="plus" onPress={handleStartNew} />
              ) : (
                <Text style={styles.stateText}>{supportCopy("thread.banner_closed")}</Text>
              )}
            </View>
          ) : (
            <KeyboardWrap>
              <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, 0) + spacing.lg }]}>
                {staffMode && !isInternalTicket ? (
                  <View style={styles.modeRow} accessibilityRole="radiogroup">
                    {([false, true] as const).map((note) => (
                      <Pressable
                        key={note ? "note" : "reply"}
                        onPress={() => setNoteMode(note)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: noteMode === note }}
                        style={[styles.modeChip, noteMode === note && (note ? styles.modeChipNote : styles.modeChipReply)]}
                      >
                        <Text style={styles.modeText}>
                          {note ? supportCopy("thread.mode_note") : supportCopy("thread.mode_reply")}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {images.length > 0 ? (
                  <SupportImageStrip
                    images={images}
                    onAdd={() => void handleAddImages()}
                    onRemove={(index) => setImages((prev) => prev.filter((_, i) => i !== index))}
                    disabled={sending}
                  />
                ) : null}
                <View style={styles.composer}>
                  <Pressable
                    onPress={() => void handleAddImages()}
                    disabled={sending || images.length >= MAX_SUPPORT_IMAGES}
                    accessibilityRole="button"
                    accessibilityLabel={supportCopy("thread.attach")}
                    style={styles.attachButton}
                  >
                    <Icon name="plus" size={18} color={textTokens.primary} />
                  </Pressable>
                  <TextInput
                    value={composer}
                    onChangeText={setComposer}
                    placeholder={sendingNote ? supportCopy("thread.note_placeholder") : supportCopy("thread.composer_placeholder")}
                    placeholderTextColor={textTokens.tertiary}
                    style={[styles.input, sendingNote && styles.inputNote]}
                    multiline
                    editable={!sending}
                    accessibilityLabel={sendingNote ? supportCopy("thread.mode_note") : supportCopy("thread.composer_placeholder")}
                  />
                  <Button
                    label={supportCopy("thread.send")}
                    leadingIcon="send"
                    onPress={handleSend}
                    loading={sending}
                    disabled={(composer.trim().length === 0 && images.length === 0) || sending}
                  />
                </View>
              </View>
            </KeyboardWrap>
          )}
        </>
      )}
      <SupportImageViewer url={viewerUrl} onClose={() => setViewerUrl(null)} />
    </SafeScreen>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#111318",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: glass.border.profileBase,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  iconButtonSpacer: {
    width: 40,
    height: 40,
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: textTokens.primary,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    color: textTokens.tertiary,
  },
  state: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.lg,
  },
  stateText: {
    color: textTokens.primary,
    textAlign: "center",
    lineHeight: 20,
  },
  banner: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: accent.border,
    backgroundColor: accent.tint,
  },
  bannerResolved: {
    borderColor: "rgba(34, 197, 94, 0.45)",
    backgroundColor: semantic.successTint,
  },
  bannerClosed: {
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  systemLine: {
    alignSelf: "center",
    fontSize: 12,
    fontStyle: "italic",
    color: textTokens.secondary,
    paddingVertical: spacing.xs,
  },
  bannerProduct: {
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: textTokens.primary,
  },
  bannerBody: {
    marginTop: 2,
    fontSize: 12,
    color: textTokens.secondary,
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  threadEmpty: {
    padding: spacing.lg,
  },
  threadEmptyText: {
    color: textTokens.secondary,
    textAlign: "center",
    lineHeight: 20,
  },
  messageRow: {
    maxWidth: "84%",
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  messageRowMine: {
    alignSelf: "flex-end",
    backgroundColor: accent.warm,
    borderColor: accent.warm,
  },
  messageRowOther: {
    alignSelf: "flex-start",
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
  },
  messageRowNote: {
    alignSelf: "stretch",
    maxWidth: "100%",
    backgroundColor: semantic.warningTint,
    borderColor: semantic.warning,
    borderStyle: "dashed",
  },
  noteLabel: {
    marginBottom: spacing.xs,
    fontSize: 11,
    fontWeight: "700",
    color: semantic.warning,
  },
  agentLabel: {
    marginBottom: spacing.xs,
    fontSize: 12,
    fontWeight: "600",
    color: accent.warm,
  },
  messageText: {
    color: textTokens.primary,
    fontSize: 14,
    lineHeight: 20,
  },
  messageTextMine: {
    color: textTokens.inverse,
  },
  messageImages: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  messageImage: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  messageImageFill: {
    width: "100%",
    height: "100%",
  },
  messageMeta: {
    marginTop: spacing.sm,
    fontSize: 10,
    color: textTokens.tertiary,
  },
  closedBox: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  composerWrap: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  modeRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  modeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  modeChipReply: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  modeChipNote: {
    backgroundColor: semantic.warningTint,
    borderColor: semantic.warning,
  },
  modeText: {
    fontSize: 12,
    fontWeight: "600",
    color: textTokens.primary,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
  },
  attachButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    overflow: "hidden",
    color: textTokens.primary,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  inputNote: {
    borderColor: semantic.warning,
    borderStyle: "dashed",
  },
});

export default SupportThreadCore;
