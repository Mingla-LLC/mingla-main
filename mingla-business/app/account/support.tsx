/**
 * Help & Support route — META-ORCH-1104 Phase 1 (business requester).
 *
 * Every business user (any brand rank) can file + chat with Mingla support from
 * here. Mirrors account/notifications.tsx chrome (IconChrome back + centered
 * title). Three pieces (SPEC §5.1):
 *   1. "Start a chat" — calls the LIVE create_support_ticket(p_subject) RPC via
 *      useCreateSupportTicket, then navigates to /support/[ticketId].
 *   2. Optional subject field — what the chat is about (validated by the RPC).
 *   3. "My support requests" — the user's own tickets (RLS-scoped), newest
 *      activity first, with status pills + an empty state in Mingla voice.
 *
 * Reachable on native iOS + Android AND business web (PC + mobile browser). The
 * signed-out web firewall lives in app/_layout.tsx (route-agnostic). Push is
 * native-only; on web the list/thread still work via realtime (SPEC §5.2).
 *
 * I-21: operator-side route. NEVER imported by anon-tolerant buyer routes.
 *
 * Per SPEC §5.1.
 */

import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
// orch-strict-grep-allow orch-0892 — web-exported requester screen; plain ScrollView over a short ticket list, single subject input sits above the fold (no focused-input keyboard scroll). The chat-thread keyboard handling lives in the quarantined SupportThread.native (keyboard-controller), not here.
import { ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  canvas,
  spacing,
  text as textTokens,
} from "../../src/constants/designSystem";
import {
  useCreateSupportTicket,
  useSupportTickets,
} from "../../src/hooks/useSupportTickets";
import type { SupportTicket } from "../../src/services/supportService";

import { Button } from "../../src/components/ui/Button";
import { GlassCard } from "../../src/components/ui/GlassCard";
import { Icon } from "../../src/components/ui/Icon";
import { IconChrome } from "../../src/components/ui/IconChrome";
import { Pill, type PillVariant } from "../../src/components/ui/Pill";
import { Toast } from "../../src/components/ui/Toast";

const SUBJECT_MAX = 200;

// support_tickets.status CHECK = new | open | pending | resolved | closed.
function statusPill(status: string): { variant: PillVariant; label: string } {
  switch (status) {
    case "new":
    case "open":
      return { variant: "live", label: "OPEN" };
    case "pending":
      return { variant: "warn", label: "PENDING" };
    case "resolved":
      return { variant: "info", label: "RESOLVED" };
    case "closed":
      return { variant: "draft", label: "CLOSED" };
    default:
      return { variant: "draft", label: status.toUpperCase() };
  }
}

export default function SupportRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data: tickets, isLoading, isError, refetch } = useSupportTickets();
  const { mutateAsync: createTicket, isPending: creating } =
    useCreateSupportTicket();

  const [subject, setSubject] = useState("");
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/account" as never);
  }, [router]);

  const handleStartChat = useCallback(async (): Promise<void> => {
    // An empty subject is rejected (button is also disabled) — never mint a
    // blank ticket (SPEC §5.1; the RPC RAISEs on a blank subject too).
    const trimmed = subject.trim();
    if (trimmed.length === 0 || creating) return;
    try {
      const ticketId = await createTicket({ subject: trimmed });
      setSubject("");
      router.push(`/support/${ticketId}` as never);
    } catch (err) {
      setToast({
        visible: true,
        message:
          err instanceof Error
            ? err.message
            : "Couldn't start the chat. Tap to try again.",
      });
    }
  }, [subject, creating, createTicket, router]);

  const handleOpenTicket = useCallback(
    (ticketId: string): void => {
      router.push(`/support/${ticketId}` as never);
    },
    [router],
  );

  const canStart = subject.trim().length > 0 && !creating;

  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, backgroundColor: canvas.discover },
      ]}
    >
      <View style={styles.chromeRow}>
        <IconChrome
          icon="close"
          size={36}
          onPress={handleBack}
          accessibilityLabel="Back"
        />
        <Text style={styles.chromeTitle}>Help &amp; Support</Text>
        <View style={styles.chromeRightSlot} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Start a chat */}
        <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
          <Text style={styles.cardTitle}>Need a hand?</Text>
          <Text style={styles.cardBody}>
            Start a chat and the Mingla team will reply right here. Add a short
            subject so we know what you need.
          </Text>
          <TextInput
            value={subject}
            onChangeText={setSubject}
            placeholder="What's it about? (e.g. payouts, a stuck event)"
            placeholderTextColor={textTokens.tertiary}
            style={styles.subjectInput}
            maxLength={SUBJECT_MAX}
            editable={!creating}
            accessibilityLabel="Subject"
            returnKeyType="done"
            onSubmitEditing={() => void handleStartChat()}
          />
          <Button
            label="Start a chat"
            leadingIcon="chat"
            onPress={handleStartChat}
            loading={creating}
            disabled={!canStart}
          />
        </GlassCard>

        {/* My support requests */}
        <Text style={styles.sectionLabel}>My support requests</Text>

        {isLoading ? (
          <View style={styles.listState}>
            <ActivityIndicator color={textTokens.secondary} />
          </View>
        ) : isError ? (
          <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
            <Text style={styles.cardBody}>
              We couldn&apos;t load your requests just now.
            </Text>
            <Button
              label="Try again"
              variant="secondary"
              onPress={() => void refetch()}
            />
          </GlassCard>
        ) : tickets.length === 0 ? (
          <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
            <Text style={styles.emptyTitle}>No requests yet</Text>
            <Text style={styles.cardBody}>
              When you start a chat, it&apos;ll show up here so you can pick the
              conversation back up anytime.
            </Text>
          </GlassCard>
        ) : (
          <View style={styles.list}>
            {tickets.map((ticket: SupportTicket) => {
              const pill = statusPill(ticket.status);
              return (
                <Pressable
                  key={ticket.id}
                  onPress={() => handleOpenTicket(ticket.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open support request: ${ticket.subject}`}
                  style={({ pressed }) => [pressed && styles.rowPressed]}
                >
                  <GlassCard variant="elevated" radius="md" padding={spacing.md}>
                    <View style={styles.rowTop}>
                      <Text style={styles.rowSubject} numberOfLines={1}>
                        {ticket.subject}
                      </Text>
                      <Pill variant={pill.variant}>{pill.label}</Pill>
                    </View>
                    <View style={styles.rowBottom}>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        Updated{" "}
                        {new Date(ticket.last_message_at).toLocaleDateString()}
                      </Text>
                      <Icon
                        name="chevR"
                        size={16}
                        color={textTokens.tertiary}
                      />
                    </View>
                  </GlassCard>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={() => setToast({ visible: false, message: "" })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  chromeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  chromeTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: textTokens.primary,
    letterSpacing: -0.2,
    textAlign: "center",
  },
  chromeRightSlot: {
    width: 36,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  cardBody: {
    fontSize: 13,
    lineHeight: 19,
    color: textTokens.secondary,
    marginBottom: spacing.md,
  },
  subjectInput: {
    minHeight: 46,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    overflow: "hidden",
    color: textTokens.primary,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    marginBottom: spacing.md,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.4,
    color: textTokens.tertiary,
    paddingTop: spacing.xs,
  },
  listState: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  list: {
    gap: spacing.sm,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  rowSubject: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: textTokens.primary,
  },
  rowBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  rowMeta: {
    flex: 1,
    fontSize: 12,
    color: textTokens.tertiary,
  },
  toastWrap: {
    position: "absolute",
    top: 80,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 12,
  },
});
