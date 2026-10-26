/**
 * #4111 D4/D7/D9 — one customer enquiry, as the brand team sees it.
 *
 * Reached from the Messages list, the Brand-group card, Home's To-do and a
 * push (all through /messages/enquiry/{id}, or /messages/{conversationId}
 * which resolves to the same screen). Text only: no Media, files, mentions or
 * mute in this mode. Every read and write is an enquiry RPC, so scanner-only
 * members and Mingla staff (D8) get the "no access" state.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  accent,
  canvas,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { useAuth } from "../../context/AuthContext";
import { brandEnquiryKeys } from "../../hooks/useBrandEnquiries";
import {
  blockBrandEnquirySender,
  getBrandEnquiryThread,
  replyToBrandEnquiry,
  reportBrandEnquiry,
  setBrandEnquiryStatus,
} from "../../services/brandEnquiriesService";
import { supabase } from "../../services/supabase";
import {
  brandEnquiryContactLine,
  brandEnquiryContextOpen,
  brandEnquiryContextSummary,
  brandEnquiryThreadSubtitle,
} from "../../utils/brandEnquiryDisplay";
import { KeyboardAvoidingView } from "../../wrappers/SmartKeyboardAvoidingView";
import { DONE_BAR_OCCUPIED, ScrollView } from "../../wrappers/SmartScrollView";
import { liftedBottomSpacer } from "../../wrappers/keyboardClearance";
import { useKeyboardHeight } from "../../wrappers/useKeyboardHeight";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/Icon";
import { SafeScreen } from "../ui/SafeScreen";
import { Toast } from "../ui/Toast";
import { BrandEnquiryStatusPill } from "./BrandEnquiryListSection";

export const BRAND_ENQUIRY_REPORT_REASONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "Spam or scam", label: "Spam or scam" },
  { key: "Abusive or harassing", label: "Abusive or harassing" },
  { key: "Something else", label: "Something else" },
];

type Busy = "reply" | "status" | "block" | "report" | null;

export function BrandEnquiryThreadScreen({ enquiryId }: { enquiryId: string }): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight();
  const queryClient = useQueryClient();
  const { user, isAuthReady } = useAuth();
  const userId = user?.id ?? null;
  const [composer, setComposer] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [spamRevealed, setSpamRevealed] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [toast, setToast] = useState<{ visible: boolean; kind: "success" | "error"; message: string }>({
    visible: false,
    kind: "success",
    message: "",
  });

  const thread = useQuery({
    queryKey: userId ? brandEnquiryKeys.thread(userId, enquiryId) : (["brandEnquiries", "thread-disabled", enquiryId] as const),
    enabled: isAuthReady === true && userId !== null,
    queryFn: () => getBrandEnquiryThread(enquiryId),
    staleTime: 5_000,
  });
  const enquiry = thread.data?.enquiry ?? null;
  const conversationId = enquiry?.conversation_id ?? null;

  const refetchThread = thread.refetch;
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`brand-enquiry:${enquiryId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        () => { void refetchThread(); },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "brand_enquiries", filter: `conversation_id=eq.${conversationId}` },
        () => { void refetchThread(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [conversationId, enquiryId, refetchThread]);

  const settle = useCallback(async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: brandEnquiryKeys.all });
  }, [queryClient]);

  const fail = useCallback((cause: unknown, fallback: string): void => {
    setToast({ visible: true, kind: "error", message: cause instanceof Error ? cause.message : fallback });
  }, []);

  async function send(): Promise<void> {
    const body = composer.trim();
    if (!body || busy !== null) return;
    setBusy("reply");
    try {
      await replyToBrandEnquiry(enquiryId, body);
      setComposer("");
      await settle();
    } catch (cause) {
      fail(cause, "Your reply wasn't sent. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleResolved(): Promise<void> {
    if (!enquiry || busy !== null) return;
    setBusy("status");
    try {
      const action = enquiry.status === "resolved" ? "reopen" : "resolve";
      await setBrandEnquiryStatus(enquiryId, action);
      setToast({ visible: true, kind: "success", message: action === "resolve" ? "Marked resolved" : "Reopened" });
      await settle();
    } catch (cause) {
      fail(cause, "Couldn't update this enquiry. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function block(): Promise<void> {
    if (busy !== null) return;
    setBusy("block");
    try {
      await blockBrandEnquirySender(enquiryId);
      setBlockOpen(false);
      setToast({ visible: true, kind: "success", message: "Sender blocked. They can't message this brand again." });
      await settle();
    } catch (cause) {
      fail(cause, "Couldn't block this sender. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function report(reason: string): Promise<void> {
    if (busy !== null) return;
    setBusy("report");
    try {
      await reportBrandEnquiry(enquiryId, reason);
      setReportOpen(false);
      setToast({ visible: true, kind: "success", message: "Reported. Mingla will review this conversation." });
      await settle();
    } catch (cause) {
      fail(cause, "Couldn't report this enquiry. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const contextOpen = useMemo(() => brandEnquiryContextOpen(enquiry?.context), [enquiry?.context]);
  const contextSummary = useMemo(() => brandEnquiryContextSummary(enquiry?.context), [enquiry?.context]);
  const collapsed = Boolean(enquiry?.spam_flag) && !spamRevealed;
  const contactLine = enquiry ? brandEnquiryContactLine(enquiry.guest) : "";

  return (
    <SafeScreen
      edges={["top"]}
      style={[
        styles.screen,
        Platform.OS === "web" && windowHeight > 0
          ? { height: windowHeight, flexGrow: 0, flexShrink: 0, flexBasis: "auto" }
          : null,
      ]}
      testID="brand-enquiry-thread"
    >
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Messages" onPress={() => router.back()} style={styles.iconButton}>
          <Icon name="arrowL" size={18} color={textTokens.primary} />
        </Pressable>
        <View style={styles.headerCopy}>
          <View style={styles.titleLine}>
            <Text style={styles.title} numberOfLines={1}>{enquiry?.guest.name ?? "Customer enquiry"}</Text>
            <View style={styles.tag}><Text style={styles.tagText}>Customer enquiry</Text></View>
          </View>
          {enquiry ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {brandEnquiryThreadSubtitle({
                brandName: enquiry.brand_name,
                source: enquiry.source,
                channelLabel: enquiry.channel_label,
                emailConfirmed: enquiry.guest.email_confirmed === true,
              })}
            </Text>
          ) : null}
        </View>
        {enquiry ? <BrandEnquiryStatusPill status={enquiry.status} /> : null}
      </View>

      {thread.isPending && userId !== null ? (
        <View style={styles.state}><ActivityIndicator color={accent.warm} /></View>
      ) : thread.isError || !thread.data || !enquiry ? (
        <View style={styles.state}>
          <Text style={styles.stateText}>
            {thread.error instanceof Error ? thread.error.message : "We couldn't open this enquiry."}
          </Text>
          <Button label="Retry" variant="secondary" onPress={() => void thread.refetch()} />
        </View>
      ) : (
        <>
          <ScrollView style={styles.messages} contentContainerStyle={styles.messagesContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={styles.contextCard} testID="brand-enquiry-context">
              <View style={styles.contextCopy}>
                <Text style={styles.kicker}>About</Text>
                <Text style={styles.contextTitle} numberOfLines={2}>
                  {enquiry.context?.title?.trim() || enquiry.topic_label}
                </Text>
                <Text style={styles.contextSummary} numberOfLines={2}>
                  {[enquiry.context?.title?.trim() ? enquiry.topic_label : null, contextSummary || null].filter(Boolean).join(" · ")}
                </Text>
              </View>
              {contextOpen ? (
                <Button
                  label={contextOpen.label}
                  variant="secondary"
                  size="sm"
                  onPress={() => router.push(contextOpen.route as never)}
                  accessibilityLabel={contextOpen.label}
                  testID="brand-enquiry-context-open"
                />
              ) : null}
            </View>

            {contactLine ? (
              <Text style={styles.contactLine} selectable testID="brand-enquiry-contact">{contactLine}</Text>
            ) : null}

            {enquiry.reported ? (
              <View style={styles.note}><Text style={styles.noteText}>Reported to Mingla. The Mingla team can read this conversation while the report is open.</Text></View>
            ) : null}

            {collapsed ? (
              <View style={styles.spamCard} testID="brand-enquiry-spam-collapsed">
                <View style={styles.contextCopy}>
                  <Text style={styles.contextTitle}>Possible spam</Text>
                  <Text style={styles.contextSummary}>Mingla's checks flagged this message. It's hidden until you choose to read it.</Text>
                </View>
                <Button label="Show" variant="secondary" size="sm" onPress={() => setSpamRevealed(true)} accessibilityLabel="Show possible spam" testID="brand-enquiry-spam-show" />
              </View>
            ) : (
              thread.data.messages.map((message) => {
                const fromTeam = message.who === "brand";
                return (
                  <View key={message.id} style={[styles.messageWrap, fromTeam ? styles.messageWrapMine : styles.messageWrapOther]}>
                    <Text style={styles.sender}>{message.mine ? "You" : message.display}</Text>
                    <View style={[styles.bubble, fromTeam ? styles.bubbleMine : styles.bubbleOther]}>
                      <Text style={[styles.messageText, fromTeam && styles.messageTextMine]}>{message.body}</Text>
                      <Text style={[styles.time, fromTeam && styles.timeMine]}>{new Date(message.at).toLocaleString()}</Text>
                    </View>
                  </View>
                );
              })
            )}

            <View style={styles.actionRow}>
              <Button
                label={enquiry.status === "resolved" ? "Reopen" : "Mark resolved"}
                variant="secondary"
                size="sm"
                loading={busy === "status"}
                disabled={busy !== null}
                onPress={() => void toggleResolved()}
                testID="brand-enquiry-toggle-resolved"
              />
              <Button label="Block sender" variant="secondary" size="sm" disabled={busy !== null} onPress={() => setBlockOpen(true)} testID="brand-enquiry-block" />
              <Button
                label={enquiry.reported ? "Reported" : "Report"}
                variant="secondary"
                size="sm"
                disabled={busy !== null || enquiry.reported}
                onPress={() => setReportOpen(true)}
                testID="brand-enquiry-report"
              />
            </View>
          </ScrollView>

          {collapsed ? null : (
            <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={DONE_BAR_OCCUPIED}>
              <View
                style={[
                  styles.composer,
                  { paddingBottom: liftedBottomSpacer(keyboardHeight > 0, Math.max(insets.bottom, spacing.sm)) },
                ]}
              >
                <View style={styles.composerLine}>
                  <TextInput
                    value={composer}
                    onChangeText={setComposer}
                    placeholder={`Reply as ${enquiry.brand_name}`}
                    placeholderTextColor={textTokens.tertiary}
                    style={styles.input}
                    multiline
                    maxLength={2000}
                    editable={busy !== "reply"}
                    accessibilityLabel={`Reply as ${enquiry.brand_name}`}
                    testID="brand-enquiry-composer"
                  />
                  <Button
                    label="Send"
                    leadingIcon="send"
                    loading={busy === "reply"}
                    disabled={!composer.trim() || busy !== null}
                    onPress={() => void send()}
                    testID="brand-enquiry-send"
                  />
                </View>
              </View>
            </KeyboardAvoidingView>
          )}
        </>
      )}

      <ConfirmDialog
        visible={blockOpen}
        onClose={() => setBlockOpen(false)}
        onConfirm={() => block()}
        title={`Block ${enquiry?.guest.name ?? "this sender"}?`}
        description={`They won't be able to message ${enquiry?.brand_name ?? "this brand"} again, and this enquiry is marked resolved.`}
        confirmLabel="Block sender"
        destructive
        confirmLoading={busy === "block"}
        testID="brand-enquiry-block-dialog"
      />

      <Modal visible={reportOpen} transparent animationType="fade" onRequestClose={() => setReportOpen(false)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard} accessibilityViewIsModal testID="brand-enquiry-report-sheet">
            <Text style={styles.modalTitle}>Report this enquiry</Text>
            <Text style={styles.contextSummary}>Mingla can read a conversation only while a report is open.</Text>
            {BRAND_ENQUIRY_REPORT_REASONS.map((reason) => (
              <Button
                key={reason.key}
                label={reason.label}
                variant="secondary"
                fullWidth
                disabled={busy !== null}
                loading={busy === "report"}
                onPress={() => void report(reason.key)}
                testID={`brand-enquiry-report-${reason.key}`}
              />
            ))}
            <Button label="Cancel" variant="ghost" fullWidth onPress={() => setReportOpen(false)} disabled={busy === "report"} />
          </View>
        </View>
      </Modal>

      <Toast
        visible={toast.visible}
        kind={toast.kind}
        message={toast.message}
        onDismiss={() => setToast((current) => ({ ...current, visible: false }))}
      />
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: canvas.profile },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: glass.border.profileBase },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: glass.border.profileBase, backgroundColor: glass.tint.profileBase },
  headerCopy: { flex: 1, minWidth: 0 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { flexShrink: 1, color: textTokens.primary, fontSize: 18, fontWeight: "800" },
  tag: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: "#4a3410", flexShrink: 0 },
  tagText: { color: "#ffc66b", fontSize: 10, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  subtitle: { color: textTokens.tertiary, fontSize: 12, marginTop: 2 },
  state: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  stateText: { color: textTokens.secondary, textAlign: "center", lineHeight: 20 },
  messages: { flex: 1 },
  messagesContent: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  contextCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: glass.border.profileBase, backgroundColor: glass.tint.profileBase },
  spamCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(255,198,107,0.45)", backgroundColor: "rgba(74,52,16,0.35)" },
  contextCopy: { flex: 1, minWidth: 0, gap: 2 },
  kicker: { color: textTokens.tertiary, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  contextTitle: { color: textTokens.primary, fontSize: 15, fontWeight: "700" },
  contextSummary: { color: textTokens.secondary, fontSize: 12, lineHeight: 17 },
  contactLine: { color: textTokens.secondary, fontSize: 13 },
  note: { padding: spacing.sm, borderRadius: radius.md, backgroundColor: "rgba(235,120,37,0.08)" },
  noteText: { color: textTokens.secondary, fontSize: 12 },
  messageWrap: { maxWidth: "84%", gap: 5 },
  messageWrapMine: { alignSelf: "flex-end", alignItems: "flex-end" },
  messageWrapOther: { alignSelf: "flex-start", alignItems: "flex-start" },
  sender: { color: textTokens.tertiary, fontSize: 11, fontWeight: "700", marginHorizontal: spacing.sm },
  bubble: { borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, borderWidth: 1 },
  bubbleMine: { backgroundColor: accent.warm, borderColor: accent.warm },
  bubbleOther: { backgroundColor: glass.tint.profileElevated, borderColor: glass.border.profileElevated },
  messageText: { color: textTokens.primary, fontSize: 15, lineHeight: 21 },
  messageTextMine: { color: "#101216" },
  time: { color: textTokens.tertiary, fontSize: 10 },
  timeMine: { color: "rgba(16,18,22,0.65)" },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  composer: { borderTopWidth: 1, borderTopColor: glass.border.profileBase, paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.sm, backgroundColor: "rgba(12,14,18,0.96)" },
  composerLine: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  input: { flex: 1, minHeight: 44, maxHeight: 120, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: glass.border.profileElevated, backgroundColor: glass.tint.profileElevated, color: textTokens.primary },
  modalScrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg, backgroundColor: "rgba(0,0,0,0.6)" },
  modalCard: { width: "100%", maxWidth: 420, gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: glass.border.profileElevated, backgroundColor: "#171a20" },
  modalTitle: { color: textTokens.primary, fontSize: 17, fontWeight: "800" },
});
