/**
 * #3720 Slice G — Support tab (tickets + online banner).
 *
 * Extracted from the former Help & Support route body so the hub can host
 * Community · Support · Guides without losing Phase 0 ticket UX.
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
import { useRouter } from "expo-router";

import {
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { SUPPORT_HOST_FACING_AGENT } from "../../constants/supportHostFacing";
import { useSupportIsOnline } from "../../hooks/useCommunity";
import {
  useCreateSupportTicket,
  useSupportTickets,
} from "../../hooks/useSupportTickets";
import type { SupportTicket } from "../../services/supportService";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Pill, type PillVariant } from "../ui/Pill";

const SUBJECT_MAX = 200;

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

export type SupportTabPanelProps = {
  onToast: (message: string) => void;
};

export const SupportTabPanel: React.FC<SupportTabPanelProps> = ({
  onToast,
}) => {
  const router = useRouter();
  const { data: tickets, isLoading, isError, refetch } = useSupportTickets();
  const { mutateAsync: createTicket, isPending: creating } =
    useCreateSupportTicket();
  const { online, isLoading: onlineLoading } = useSupportIsOnline();

  const [subject, setSubject] = useState("");

  const handleStartChat = useCallback(async (): Promise<void> => {
    const trimmed = subject.trim();
    if (trimmed.length === 0 || creating) return;
    try {
      const ticketId = await createTicket({ subject: trimmed });
      setSubject("");
      router.push(`/support/${ticketId}` as never);
    } catch (err) {
      onToast(
        err instanceof Error
          ? err.message
          : "Couldn't start the chat. Tap to try again.",
      );
    }
  }, [subject, creating, createTicket, router, onToast]);

  const handleOpenTicket = useCallback(
    (ticketId: string): void => {
      router.push(`/support/${ticketId}` as never);
    },
    [router],
  );

  const canStart = subject.trim().length > 0 && !creating;

  return (
    <View style={styles.col}>
      {!onlineLoading ? (
        <View
          style={[styles.banner, online ? styles.bannerOnline : styles.bannerAway]}
          accessibilityRole="text"
          accessibilityLabel={
            online
              ? "Support is online"
              : "Support is away — we'll reply when we're back"
          }
        >
          <View
            style={[
              styles.bannerDot,
              online ? styles.bannerDotOnline : styles.bannerDotAway,
            ]}
          />
          <Text style={styles.bannerText}>
            {online
              ? "Support is online"
              : "Support is away — we'll reply when we're back"}
          </Text>
        </View>
      ) : null}

      <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
        <Text style={styles.cardTitle}>Need a hand?</Text>
        <Text style={styles.cardBody}>
          Start a chat and {SUPPORT_HOST_FACING_AGENT} will reply right here.
          Add a short subject so we know what you need.
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
        {!canStart && !creating ? (
          <Text style={styles.disabledHint}>Add a subject to start</Text>
        ) : null}
      </GlassCard>

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
                      {ticket.audience === "brand" ? "Shared with your brand · " : ""}
                      {ticket.next_update_at
                        ? `Next update ${new Date(ticket.next_update_at).toLocaleString()}`
                        : `Updated ${new Date(ticket.last_message_at).toLocaleDateString()}`}
                    </Text>
                    <Icon name="chevR" size={16} color={textTokens.tertiary} />
                  </View>
                </GlassCard>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  col: {
    gap: spacing.md,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
  },
  bannerOnline: {
    backgroundColor: "rgba(52, 199, 89, 0.12)",
    borderColor: "rgba(52, 199, 89, 0.35)",
  },
  bannerAway: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderColor: "rgba(255, 255, 255, 0.12)",
  },
  bannerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  bannerDotOnline: {
    backgroundColor: "#34c759",
  },
  bannerDotAway: {
    backgroundColor: textTokens.tertiary,
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.primary,
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
    letterSpacing: 0,
  },
  disabledHint: {
    marginTop: spacing.xs,
    textAlign: "center",
    color: textTokens.tertiary,
    fontSize: 12,
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
});
