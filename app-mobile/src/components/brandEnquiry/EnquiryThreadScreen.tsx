/**
 * #4111 Wave D — one enquiry thread, guest side (Explorer).
 *
 * A dedicated screen rather than a MessageInterface mode: MessageInterface is
 * the friend-DM surface (pairing, blocking, cards, media) and is being
 * reworked by #4114. An enquiry is a different contract — it reads and writes
 * through RPCs only — so it gets its own small screen and touches nothing there.
 *
 *   header        brand avatar (question badge), brand name, "Enquiry", topic, ⋯
 *   context card  pinned above the messages ("About" + the booking / offering)
 *   messages      brand replies read "{first} at {Brand}" (server snapshot)
 *   resolved      "{Brand} marked this as resolved. Write again to reopen it."
 *   composer      brand_enquiry_guest_reply (a reply reopens a resolved thread)
 *   ⋯ → Report    brand_enquiry_report
 *   live          realtime on messages + brand_enquiries, filtered on
 *                 conversation_id (the Wave C pattern)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import {
  useEnquiryGuestReply,
  useEnquiryReport,
  useEnquiryThread,
} from "../../hooks/useBrandEnquiries";
import { markEnquiryMessagesRead } from "../../services/brandEnquiryService";
import type { EnquiryThreadMessage } from "../../services/brandEnquiryService";
import { reportNonFatal } from "../../diagnostics/reportNonFatal";
import { useAppStore } from "../../store/appStore";
import { KeyboardAwareView } from "../ui/KeyboardAwareView";
import { toastManager } from "../ui/Toast";
import { ToastContainer } from "../ui/ToastContainer";
import { Icon } from "../ui/Icon";
import { EnquiryBrandAvatar, EnquiryTag, ENQUIRY_ACCENT } from "./EnquiryTag";

const BODY_MAX = 2000;

type ReportReason = "spam" | "abuse" | "other";
const REPORT_REASONS: readonly ReportReason[] = ["spam", "abuse", "other"];

function shortDateTime(iso: string | null): string {
  if (iso === null) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function EnquiryThreadScreen({ enquiryId }: { enquiryId: string }): React.ReactElement {
  const { t } = useTranslation("enquiry");
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useAppStore((s) => s.user?.id ?? null);
  const thread = useEnquiryThread(userId, enquiryId);
  const reply = useEnquiryGuestReply(userId, enquiryId);
  const report = useEnquiryReport(userId, enquiryId);
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const data = thread.data ?? null;

  const goBack = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [router]);

  // Brand messages count as read once the guest has the thread open.
  const unreadBrandIds = useMemo(
    () => (data?.messages ?? []).filter((m) => m.who === "brand").map((m) => m.id),
    [data?.messages],
  );
  const unreadKey = unreadBrandIds.join(",");
  useEffect(() => {
    if (userId === null || unreadBrandIds.length === 0) return;
    void markEnquiryMessagesRead(userId, unreadBrandIds).catch((error: unknown) => {
      // Read receipts only drive the unread badge; the thread itself is fine.
      reportNonFatal("enquiryThread.markRead", error);
    });
    // unreadKey captures the id list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadKey, userId]);

  const trimmed = draft.trim();
  const tooLong = trimmed.length > BODY_MAX;
  const canSend = trimmed.length > 0 && !tooLong && !reply.isPending;

  const send = async (): Promise<void> => {
    if (!canSend) return;
    try {
      await reply.mutateAsync(trimmed);
    } catch (error: unknown) {
      toastManager.show(
        error instanceof Error && error.message.length > 0 ? error.message : t("enquiry:reply_failed"),
        "error",
      );
      return;
    }
    // The new message lands through the refetch; onContentSizeChange scrolls to it.
    setDraft("");
  };

  const submitReport = async (): Promise<void> => {
    if (reportReason === null || report.isPending) return;
    try {
      await report.mutateAsync(t(`enquiry:report_reason_${reportReason}`));
      setReportOpen(false);
      setReportReason(null);
      toastManager.show(t("enquiry:report_done"), "success");
    } catch (error: unknown) {
      toastManager.show(
        error instanceof Error && error.message.length > 0 ? error.message : t("enquiry:report_failed"),
        "error",
      );
    }
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <Pressable
        onPress={goBack}
        accessibilityRole="button"
        accessibilityLabel={t("enquiry:thread_back")}
        hitSlop={10}
        style={styles.iconButton}
        testID="enquiry-thread-back"
      >
        <Icon name="chevron-back" size={24} color="#ffffff" />
      </Pressable>
      {data !== null ? (
        <View style={styles.headerIdentity}>
          <EnquiryBrandAvatar brandName={data.brandName} logoUrl={data.brandLogoUrl} size={40} />
          <View style={styles.headerCopy}>
            <View style={styles.headerNameRow}>
              <Text style={styles.headerName} numberOfLines={1} accessibilityRole="header">
                {data.brandName}
              </Text>
              <EnquiryTag testID="enquiry-thread-tag" />
            </View>
            {data.topicLabel !== null ? (
              <Text style={styles.headerTopic} numberOfLines={1} testID="enquiry-thread-topic">
                {data.topicLabel}
              </Text>
            ) : null}
          </View>
        </View>
      ) : (
        <View style={styles.headerIdentity} />
      )}
      {data !== null ? (
        <Pressable
          onPress={() => setMenuOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t("enquiry:thread_more")}
          hitSlop={10}
          style={styles.iconButton}
          testID="enquiry-thread-more"
        >
          <Icon name="ellipsis-horizontal" size={22} color="#ffffff" />
        </Pressable>
      ) : (
        <View style={styles.iconButton} />
      )}
    </View>
  );

  // A disabled query (no id, or signed out) is never "loading" — it falls to the error state.
  if (thread.isPending && data === null && enquiryId.length > 0 && userId !== null) {
    return (
      <View style={styles.screen}>
        {header}
        <View style={styles.state} testID="enquiry-thread-loading">
          <ActivityIndicator color={ENQUIRY_ACCENT} />
          <Text style={styles.stateText}>{t("enquiry:thread_loading")}</Text>
        </View>
      </View>
    );
  }

  if (data === null) {
    return (
      <View style={styles.screen}>
        {header}
        <View style={styles.state} testID="enquiry-thread-error">
          <Text style={styles.stateTitle}>{t("enquiry:thread_error_title")}</Text>
          {thread.error instanceof Error ? <Text style={styles.stateText}>{thread.error.message}</Text> : null}
          <Pressable
            onPress={() => {
              void thread.refetch();
            }}
            accessibilityRole="button"
            style={styles.retryButton}
            testID="enquiry-thread-retry"
          >
            <Text style={styles.retryText}>{t("enquiry:thread_retry")}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const context = data.context;
  const contextLine = context === null
    ? null
    : [shortDateTime(context.startsAt), context.summary].filter((part) => part && part.length > 0).join(" · ");

  const bubble = (message: EnquiryThreadMessage): React.ReactElement => {
    if (message.who === "system") {
      return (
        <Text key={message.id} style={styles.systemLine}>
          {message.body}
        </Text>
      );
    }
    const mine = message.who === "guest";
    return (
      <View
        key={message.id}
        style={[styles.bubbleWrap, mine ? styles.bubbleWrapMine : styles.bubbleWrapTheirs]}
        testID={`enquiry-message-${message.id}`}
      >
        <Text style={[styles.sender, mine && styles.senderMine]} numberOfLines={1}>
          {mine ? t("enquiry:thread_you") : message.display || data.brandName}
        </Text>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
          <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]} selectable>
            {message.body}
          </Text>
        </View>
        {message.at !== null ? <Text style={styles.time}>{shortDateTime(message.at)}</Text> : null}
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      {header}
      <KeyboardAwareView dismissOnTap={false} bottomOffset={insets.bottom}>
        {context !== null && (context.title !== null || contextLine) ? (
          <View style={styles.contextCard} testID="enquiry-thread-context">
            <Text style={styles.contextEyebrow}>{t("enquiry:thread_about")}</Text>
            {context.title !== null ? (
              <Text style={styles.contextTitle} numberOfLines={2}>
                {context.title}
              </Text>
            ) : null}
            {contextLine ? (
              <Text style={styles.contextLine} numberOfLines={1}>
                {contextLine}
              </Text>
            ) : null}
          </View>
        ) : null}
        <ScrollView
          ref={scrollRef}
          style={styles.messages}
          contentContainerStyle={styles.messagesContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          testID="enquiry-thread-messages"
        >
          {data.messages.length === 0 ? (
            <Text style={styles.stateText}>{t("enquiry:thread_empty")}</Text>
          ) : (
            data.messages.map(bubble)
          )}
          {data.reported ? (
            <Text style={styles.systemLine} testID="enquiry-thread-reported">
              {t("enquiry:thread_reported")}
            </Text>
          ) : null}
        </ScrollView>
        {data.status === "resolved" ? (
          <View style={styles.resolved} testID="enquiry-thread-resolved">
            <Text style={styles.resolvedText}>{t("enquiry:thread_resolved", { brand: data.brandName })}</Text>
          </View>
        ) : null}
        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t("enquiry:composer_placeholder")}
            placeholderTextColor="rgba(255,255,255,0.4)"
            multiline
            style={styles.input}
            accessibilityLabel={t("enquiry:composer_placeholder")}
            testID="enquiry-thread-input"
          />
          <Pressable
            onPress={() => {
              void send();
            }}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel={t("enquiry:composer_send")}
            accessibilityState={{ disabled: !canSend, busy: reply.isPending }}
            style={[styles.sendButton, !canSend && styles.sendDisabled]}
            testID="enquiry-thread-send"
          >
            {reply.isPending ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Icon name="send" size={18} color="#ffffff" />
            )}
          </Pressable>
        </View>
        {tooLong ? <Text style={styles.composerError}>{t("enquiry:composer_too_long")}</Text> : null}
      </KeyboardAwareView>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setMenuOpen(false)} accessibilityRole="button" accessibilityLabel={t("enquiry:report_cancel")}>
          <View style={[styles.menu, { marginTop: insets.top + 56 }]}>
            <Pressable
              onPress={() => {
                setMenuOpen(false);
                setReportOpen(true);
              }}
              accessibilityRole="button"
              style={styles.menuItem}
              testID="enquiry-thread-report"
            >
              <Icon name="flag-outline" size={18} color="#f87171" />
              <Text style={styles.menuItemText}>{t("enquiry:report")}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={reportOpen} transparent animationType="fade" onRequestClose={() => setReportOpen(false)}>
        <View style={styles.dialogScrim}>
          <View style={styles.dialog} testID="enquiry-report-dialog">
            <Text style={styles.dialogTitle} accessibilityRole="header">
              {t("enquiry:report_title")}
            </Text>
            <Text style={styles.dialogBody}>{t("enquiry:report_body")}</Text>
            {REPORT_REASONS.map((reason) => {
              const selected = reportReason === reason;
              return (
                <Pressable
                  key={reason}
                  onPress={() => setReportReason(reason)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[styles.reasonRow, selected && styles.reasonRowSelected]}
                  testID={`enquiry-report-reason-${reason}`}
                >
                  <View style={[styles.radio, selected && styles.radioSelected]} />
                  <Text style={styles.reasonText}>{t(`enquiry:report_reason_${reason}`)}</Text>
                </Pressable>
              );
            })}
            <View style={styles.dialogActions}>
              <Pressable
                onPress={() => {
                  setReportOpen(false);
                  setReportReason(null);
                }}
                accessibilityRole="button"
                style={[styles.dialogButton, styles.dialogButtonGhost]}
                testID="enquiry-report-cancel"
              >
                <Text style={styles.dialogButtonGhostText}>{t("enquiry:report_cancel")}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  void submitReport();
                }}
                disabled={reportReason === null || report.isPending}
                accessibilityRole="button"
                accessibilityState={{ disabled: reportReason === null, busy: report.isPending }}
                style={[styles.dialogButton, styles.dialogButtonDanger, reportReason === null && styles.sendDisabled]}
                testID="enquiry-report-submit"
              >
                {report.isPending ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.dialogButtonText}>{t("enquiry:report_submit")}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <ToastContainer />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0c0e12" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.12)",
  },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerIdentity: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 },
  headerCopy: { flex: 1, minWidth: 0 },
  headerNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerName: { flexShrink: 1, color: "#f8fafc", fontSize: 17, fontWeight: "700" },
  headerTopic: { marginTop: 2, color: "rgba(255,255,255,0.6)", fontSize: 13 },
  state: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  stateTitle: { color: "#ffffff", fontSize: 17, fontWeight: "700", textAlign: "center" },
  stateText: { color: "rgba(255,255,255,0.65)", fontSize: 14, textAlign: "center" },
  retryButton: {
    marginTop: 6,
    minHeight: 44,
    paddingHorizontal: 20,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ENQUIRY_ACCENT,
  },
  retryText: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
  contextCard: {
    marginHorizontal: 12,
    marginTop: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(235,120,37,0.10)",
    borderWidth: 1,
    borderColor: "rgba(235,120,37,0.28)",
  },
  contextEyebrow: { color: "#fdba74", fontSize: 11, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  contextTitle: { marginTop: 4, color: "#f8fafc", fontSize: 15, fontWeight: "700" },
  contextLine: { marginTop: 2, color: "rgba(255,255,255,0.65)", fontSize: 13 },
  messages: { flex: 1 },
  messagesContent: { padding: 12, gap: 12 },
  systemLine: { alignSelf: "center", color: "rgba(255,255,255,0.5)", fontSize: 12, textAlign: "center" },
  bubbleWrap: { maxWidth: "82%", gap: 4 },
  bubbleWrapMine: { alignSelf: "flex-end", alignItems: "flex-end" },
  bubbleWrapTheirs: { alignSelf: "flex-start", alignItems: "flex-start" },
  sender: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: "600" },
  senderMine: { color: "rgba(255,255,255,0.45)" },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleMine: { backgroundColor: ENQUIRY_ACCENT, borderBottomRightRadius: 6 },
  bubbleTheirs: { backgroundColor: "rgba(255,255,255,0.10)", borderBottomLeftRadius: 6 },
  bubbleText: { color: "#f8fafc", fontSize: 15, lineHeight: 21 },
  bubbleTextMine: { color: "#ffffff" },
  time: { color: "rgba(255,255,255,0.35)", fontSize: 11 },
  resolved: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "rgba(16,185,129,0.12)",
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.35)",
  },
  resolvedText: { color: "#a7f3d0", fontSize: 13, lineHeight: 18, textAlign: "center" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.12)",
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.08)",
    color: "#f8fafc",
    fontSize: 15,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ENQUIRY_ACCENT,
  },
  sendDisabled: { opacity: 0.45 },
  composerError: { color: "#fca5a5", fontSize: 12, paddingHorizontal: 16, paddingBottom: 8 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "flex-end", paddingRight: 12 },
  menu: { minWidth: 180, borderRadius: 14, backgroundColor: "#1c1f25", paddingVertical: 6 },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingHorizontal: 16 },
  menuItemText: { color: "#f87171", fontSize: 15, fontWeight: "600" },
  dialogScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 24 },
  dialog: { borderRadius: 20, backgroundColor: "#1c1f25", padding: 20, gap: 10 },
  dialogTitle: { color: "#ffffff", fontSize: 18, fontWeight: "700" },
  dialogBody: { color: "rgba(255,255,255,0.7)", fontSize: 14, lineHeight: 20, marginBottom: 4 },
  reasonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  reasonRowSelected: { borderColor: ENQUIRY_ACCENT, backgroundColor: "rgba(235,120,37,0.10)" },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "rgba(255,255,255,0.5)" },
  radioSelected: { borderColor: ENQUIRY_ACCENT, backgroundColor: ENQUIRY_ACCENT },
  reasonText: { color: "#f8fafc", fontSize: 15 },
  dialogActions: { flexDirection: "row", gap: 10, marginTop: 8 },
  dialogButton: { flex: 1, minHeight: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  dialogButtonGhost: { borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" },
  dialogButtonGhostText: { color: "#f8fafc", fontSize: 15, fontWeight: "600" },
  dialogButtonDanger: { backgroundColor: "#dc2626" },
  dialogButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
});
