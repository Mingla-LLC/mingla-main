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
  color,
  radius,
  space,
  type,
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
import { KeyValue } from "../ui/KeyValue";
import { SafeScreen } from "../ui/SafeScreen";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
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
  supportTicketDetails,
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
  const { isWideDesktop } = useResponsiveLayout();
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
  const canSend = composer.trim().length > 0 || images.length > 0;
  const header = ticket
    ? [formatTicketNumber(ticket.ticket_number), ticket.topic ? supportCopy(`topic.${ticket.topic}`) : null]
        .filter(Boolean)
        .join(" · ")
    : "";

  // #4420 — on wide desktop the thread sits in its own pane with the
  // "Ticket" details pane beside it (mockup support-ticket__thread). Phone
  // and narrow web keep the single column.
  const showDetailsPane = isWideDesktop && ticket !== null && !isLoading && !isError;
  const details = ticket !== null ? supportTicketDetails(ticket, { staffMode }) : [];
  const threadColumn = (
    <>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={supportCopy("thread.back")}
          onPress={handleBack}
          style={styles.iconButton}
        >
          <Icon name="chevL" size={20} color={color.text1} />
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
          <ActivityIndicator color={color.text1} />
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
                                <Icon name="eye" size={16} color={color.text3} />
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
            <View style={[styles.closedBox, { paddingBottom: Math.max(insets.bottom, 0) + space[6] }]}>
              {!staffMode ? (
                <Button label={supportCopy("thread.start_new")} leadingIcon="plus" onPress={handleStartNew} />
              ) : (
                <Text style={styles.stateText}>{supportCopy("thread.banner_closed")}</Text>
              )}
            </View>
          ) : (
            <KeyboardWrap>
              <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, 0) + space[6] }]}>
                {staffMode && !isInternalTicket ? (
                  <View style={styles.modeRow} accessibilityRole="radiogroup">
                    {([false, true] as const).map((note) => (
                      <Pressable
                        key={note ? "note" : "reply"}
                        onPress={() => setNoteMode(note)}
                        accessibilityRole="radio"
                        accessibilityLabel={note ? supportCopy("thread.mode_note") : supportCopy("thread.mode_reply")}
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
                <View style={[styles.composer, sendingNote && styles.composerNote]}>
                  <Pressable
                    onPress={() => void handleAddImages()}
                    disabled={sending || images.length >= MAX_SUPPORT_IMAGES}
                    accessibilityRole="button"
                    accessibilityLabel={supportCopy("thread.attach")}
                    style={styles.attachButton}
                  >
                    <Icon name="plus" size={18} color={color.text1} />
                  </Pressable>
                  <TextInput
                    value={composer}
                    onChangeText={setComposer}
                    placeholder={sendingNote ? supportCopy("thread.note_placeholder") : supportCopy("thread.composer_placeholder")}
                    placeholderTextColor={color.text3}
                    style={[styles.input, sendingNote && styles.inputNote]}
                    multiline
                    editable={!sending}
                    accessibilityLabel={sendingNote ? supportCopy("thread.mode_note") : supportCopy("thread.composer_placeholder")}
                  />
                  {/* #4420 round-3 item 6 — icon-only send inside the floating
                      field; dimmed until there is something to send. */}
                  <Pressable
                    onPress={() => void handleSend()}
                    disabled={!canSend || sending}
                    accessibilityRole="button"
                    accessibilityLabel={supportCopy("thread.send")}
                    accessibilityState={{ disabled: !canSend || sending, busy: sending }}
                    style={[styles.sendButton, !canSend && styles.sendButtonOff]}
                  >
                    {sending ? (
                      <ActivityIndicator size="small" color={color.ink} />
                    ) : (
                      <Icon name="send" size={18} color={canSend ? color.ink : color.text4} />
                    )}
                  </Pressable>
                </View>
              </View>
            </KeyboardWrap>
          )}
        </>
      )}
    </>
  );

  return (
    <SafeScreen style={[styles.screen, showDetailsPane && styles.screenDesktop]}>
      {showDetailsPane ? (
        <View style={styles.desktopRow}>
          <View style={styles.threadPane}>{threadColumn}</View>
          <View
            style={styles.detailsPane}
            accessibilityRole="summary"
            accessibilityLabel={supportCopy("details.title")}
            testID="support-ticket-details"
          >
            <Text style={styles.detailsTitle}>{supportCopy("details.title")}</Text>
            <KeyValue items={details} style={styles.detailsBody} />
          </View>
        </View>
      ) : (
        threadColumn
      )}
      <SupportImageViewer url={viewerUrl} onClose={() => setViewerUrl(null)} />
    </SafeScreen>
  );
};

const DETAILS_PANE_WIDTH = 340;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.card,
  },
  screenDesktop: {
    backgroundColor: color.canvas,
  },
  desktopRow: {
    flex: 1,
    flexDirection: "row",
    gap: space[4],
    padding: space[4],
  },
  threadPane: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    borderRadius: radius.xl,
    backgroundColor: color.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  detailsPane: {
    width: DETAILS_PANE_WIDTH,
    borderRadius: radius.xl,
    backgroundColor: color.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    overflow: "hidden",
  },
  detailsTitle: {
    ...type.row,
    color: color.text1,
    paddingHorizontal: space[5],
    paddingVertical: space[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  detailsBody: {
    paddingHorizontal: space[5],
    paddingVertical: space[4],
    gap: space[3],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[4],
    paddingVertical: space[4],
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
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
    color: color.text1,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    color: color.text3,
  },
  state: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space[4],
    padding: space[6],
  },
  stateText: {
    color: color.text1,
    textAlign: "center",
    lineHeight: 20,
  },
  banner: {
    marginHorizontal: space[4],
    marginTop: space[2],
    padding: space[4],
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.lineStrong,
    backgroundColor: color.fill.tabOn,
  },
  bannerResolved: {
    borderColor: color.line,
    backgroundColor: color.successTint,
  },
  bannerClosed: {
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  systemLine: {
    alignSelf: "center",
    fontSize: 12,
    fontStyle: "italic",
    color: color.text2,
    paddingVertical: space[1],
  },
  bannerProduct: {
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: color.text1,
  },
  bannerBody: {
    marginTop: 2,
    fontSize: 12,
    color: color.text2,
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    padding: space[4],
    gap: space[2],
  },
  threadEmpty: {
    padding: space[6],
  },
  threadEmptyText: {
    color: color.text2,
    textAlign: "center",
    lineHeight: 20,
  },
  messageRow: {
    maxWidth: "84%",
    padding: space[4],
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  messageRowMine: {
    alignSelf: "flex-end",
    backgroundColor: color.paper,
    borderColor: color.paper,
  },
  messageRowOther: {
    alignSelf: "flex-start",
    backgroundColor: color.fill.inset,
    borderColor: color.line,
  },
  messageRowNote: {
    alignSelf: "stretch",
    maxWidth: "100%",
    backgroundColor: color.warningTint,
    borderColor: color.warning,
    borderStyle: "dashed",
  },
  noteLabel: {
    marginBottom: space[1],
    fontSize: 11,
    fontWeight: "700",
    color: color.warning,
  },
  agentLabel: {
    marginBottom: space[1],
    fontSize: 12,
    fontWeight: "600",
    color: color.text1,
  },
  messageText: {
    color: color.text1,
    fontSize: 14,
    lineHeight: 20,
  },
  messageTextMine: {
    color: color.ink,
  },
  messageImages: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[1],
    marginTop: space[2],
  },
  messageImage: {
    width: 72,
    height: 72,
    borderRadius: radius.xs,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.fill.inset,
  },
  messageImageFill: {
    width: "100%",
    height: "100%",
  },
  messageMeta: {
    marginTop: space[2],
    fontSize: 10,
    color: color.text3,
  },
  closedBox: {
    paddingHorizontal: space[4],
    paddingTop: space[4],
  },
  composerWrap: {
    gap: space[2],
    paddingHorizontal: space[4],
    paddingTop: space[4],
  },
  modeRow: {
    flexDirection: "row",
    gap: space[1],
  },
  modeChip: {
    paddingHorizontal: space[4],
    paddingVertical: space[1],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.line,
  },
  modeChipReply: {
    backgroundColor: color.fill.tabOn,
    borderColor: color.lineStrong,
  },
  modeChipNote: {
    backgroundColor: color.warningTint,
    borderColor: color.warning,
  },
  modeText: {
    fontSize: 12,
    fontWeight: "600",
    color: color.text1,
  },
  // #4420 round-3 item 6 — a floating pill field: no bar behind it, attach
  // and send sit INSIDE the field.
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space[1],
    padding: space[1],
    borderRadius: radius.xxl,
    backgroundColor: color.card2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.paper,
  },
  sendButtonOff: {
    backgroundColor: color.card3,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: space[2],
    paddingVertical: space[2] + 2,
    color: color.text1,
    backgroundColor: color.transparent,
  },
  inputNote: {},
  // Staff internal note: the pill itself carries the dashed amber edge.
  composerNote: {
    borderColor: color.warning,
    borderStyle: "dashed",
    borderWidth: 1,
  },
});

export default SupportThreadCore;
