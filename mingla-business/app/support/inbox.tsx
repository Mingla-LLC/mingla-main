/**
 * Support inbox (staff console) — META-ORCH-1104 Phase 3.
 *
 * The phone/web staffer's queue. Reachable ONLY from the gated "Support — Live
 * Chats" card on the Account tab (rendered only when useSupportStaff().isStaff).
 * It is a SUB-PAGE, NOT a bottom tab (Lane C Finding 2.4 / CF-C3: a TABS entry
 * would hit the brand-rank MIN_RANK_FOR_TAB strict-grep gate, which can't express
 * brand-DECOUPLED staffing). The client gate is cosmetic — the REAL boundary is
 * is_support_staff() RLS: a non-staff viewer who forces here reads zero rows
 * (SPEC §3.3, T-3.1).
 *
 * Mirrors the mingla-admin desk (SPEC §6.1) for parity — ONE shared queue, ONE
 * set of lifecycle actions:
 *   - Header "Available for support" Switch → support_set_available RPC (§2.7).
 *   - Queue: all support_tickets, newest-activity-first, live via realtime
 *     (how a WEB staffer learns of a new ticket without push — §7.2 degradation).
 *   - Per-ticket actions: Claim (support-claim) → Open chat (the SHARED
 *     /support/[ticketId] thread, same as Phase 1) → Status / Priority cycle
 *     (support-set-status). All edge fns degrade gracefully when undeployed.
 *
 * Web-degradation (SPEC §7.2): inbox + toggle + claim/reply work on business web
 * (PC + mobile browser) via the JS SDK + edge fns; push is NATIVE-ONLY (web learns
 * of new tickets via the live queue, not a push). The shared thread carries the
 * I-1104-NO-KBC-ON-WEB quarantine; this file imports no native keyboard module.
 *
 * I-21: operator-side route. NEVER imported by anon-tolerant buyer routes.
 *
 * Per SPEC §7.1 (Lane C Findings 2.4, 3, 4; journey 3).
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  canvas,
  spacing,
  text as textTokens,
} from "../../src/constants/designSystem";
import { useAuth } from "../../src/context/AuthContext";
import { useSupportStaff } from "../../src/hooks/useSupportStaff";
import { useSupportQueue } from "../../src/hooks/useSupportQueue";
import {
  claimSupportTicket,
  setSupportAvailable,
  setSupportTicketPriority,
  setSupportTicketStatus,
  type SupportFnResult,
  type SupportQueueTicket,
} from "../../src/services/supportStaffService";

import { Button } from "../../src/components/ui/Button";
import { GlassCard } from "../../src/components/ui/GlassCard";
import { Icon } from "../../src/components/ui/Icon";
import { IconChrome } from "../../src/components/ui/IconChrome";
import { Pill, type PillVariant } from "../../src/components/ui/Pill";
import { Toast } from "../../src/components/ui/Toast";

// support_tickets.status CHECK = new | open | pending | resolved | closed.
function statusPill(status: string): { variant: PillVariant; label: string } {
  switch (status) {
    case "new":
      return { variant: "accent", label: "NEW" };
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

// support_tickets.priority CHECK = low | normal | high | urgent. Cycle on tap.
const PRIORITY_CYCLE = ["low", "normal", "high", "urgent"] as const;
function nextPriority(current: string): string {
  const i = PRIORITY_CYCLE.indexOf(current as (typeof PRIORITY_CYCLE)[number]);
  return PRIORITY_CYCLE[(i + 1) % PRIORITY_CYCLE.length];
}

// Legal next statuses (mirrors the support-set-status edge fn / SPEC §2.1).
function nextStatus(current: string): string | null {
  switch (current) {
    case "new":
    case "open":
      return "pending";
    case "pending":
      return "resolved";
    case "resolved":
      return "closed";
    default:
      return null; // closed = terminal
  }
}

export default function SupportInboxRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const myUserId = user?.id ?? null;
  const staff = useSupportStaff();

  // The queue read only fires for an enabled staffer — a non-staff viewer who
  // forces here gets the access-denied state, no query (defense-in-depth above
  // the RLS that already returns zero rows).
  const queue = useSupportQueue(staff.isStaff);

  const [available, setAvailable] = useState<boolean>(staff.available);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  // Hydrate the local toggle from the staff row once it loads.
  useEffect(() => {
    setAvailable(staff.available);
  }, [staff.available]);

  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/account" as never);
  }, [router]);

  const handleToggleAvailable = useCallback(
    async (value: boolean): Promise<void> => {
      setAvailable(value); // optimistic
      setAvailabilityBusy(true);
      try {
        const persisted = await setSupportAvailable(value);
        setAvailable(persisted);
      } catch (err) {
        setAvailable(!value); // revert on failure — never lie about shift state
        showToast(
          err instanceof Error
            ? err.message
            : "Couldn't update your availability. Tap to try again.",
        );
      } finally {
        setAvailabilityBusy(false);
      }
    },
    [showToast],
  );

  // Surface an edge-fn result; refetch the queue on success so the row reflects
  // the new claim/status/priority. NEVER throws (the service returns a result).
  const handleFnResult = useCallback(
    async (res: SupportFnResult, okMessage: string): Promise<void> => {
      if (res.ok) {
        showToast(okMessage);
        await queue.refetch();
        return;
      }
      showToast(res.message ?? "That action isn't available right now.");
    },
    [queue, showToast],
  );

  const handleClaim = useCallback(
    async (ticketId: string): Promise<void> => {
      setActionBusyId(ticketId);
      try {
        const res = await claimSupportTicket(ticketId);
        await handleFnResult(res, "Claimed — you're on this one.");
      } finally {
        setActionBusyId(null);
      }
    },
    [handleFnResult],
  );

  const handleCycleStatus = useCallback(
    async (ticket: SupportQueueTicket): Promise<void> => {
      const to = nextStatus(ticket.status);
      if (to === null) {
        showToast("This chat is closed.");
        return;
      }
      setActionBusyId(ticket.id);
      try {
        const res = await setSupportTicketStatus(ticket.id, to);
        await handleFnResult(res, `Moved to ${to}.`);
      } finally {
        setActionBusyId(null);
      }
    },
    [handleFnResult, showToast],
  );

  const handleCyclePriority = useCallback(
    async (ticket: SupportQueueTicket): Promise<void> => {
      const to = nextPriority(ticket.priority);
      setActionBusyId(ticket.id);
      try {
        const res = await setSupportTicketPriority(ticket.id, to);
        await handleFnResult(res, `Priority: ${to}.`);
      } finally {
        setActionBusyId(null);
      }
    },
    [handleFnResult],
  );

  const handleOpenChat = useCallback(
    async (ticket: SupportQueueTicket): Promise<void> => {
      // Claim-then-open: an unclaimed ticket (or one assigned to someone else)
      // is claimed by THIS staffer first (seeds the participant so the thread's
      // staff INSERT/SELECT RLS passes), then we open the shared thread. A
      // claim 404 (fn undeployed) still lets us open read-only.
      const mine = ticket.assigned_staff_id === myUserId;
      if (!mine) {
        setActionBusyId(ticket.id);
        const res = await claimSupportTicket(ticket.id);
        setActionBusyId(null);
        if (!res.ok && res.code !== "not_deployed") {
          showToast(res.message ?? "Couldn't claim this chat.");
          return;
        }
        void queue.refetch();
      }
      router.push(`/support/${ticket.id}` as never);
    },
    [myUserId, queue, router, showToast],
  );

  const isStaffResolving = staff.isLoading;

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
        <Text style={styles.chromeTitle}>Support — Live Chats</Text>
        <View style={styles.chromeRightSlot} />
      </View>

      {isStaffResolving ? (
        <View style={styles.fullState}>
          <ActivityIndicator color={textTokens.secondary} />
        </View>
      ) : !staff.isStaff ? (
        // Cosmetic client gate; RLS is the real boundary. A non-staff viewer
        // who deep-links here sees this, never queue data (SPEC §3.3 / T-3.1).
        <View style={styles.fullState}>
          <Text style={styles.deniedTitle}>Not available</Text>
          <Text style={styles.deniedBody}>
            The support console is for Mingla support staff. If you think you
            should have access, reach out to the Mingla team.
          </Text>
          <Button label="Back" variant="secondary" onPress={handleBack} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + spacing.xl },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Availability + degradation note */}
          <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
            <View style={styles.availRow}>
              <View style={styles.availText}>
                <Text style={styles.cardTitle}>Available for support</Text>
                <Text style={styles.cardBody}>
                  When you&apos;re on, new chats can ping your phone. Turn off
                  when you step away.
                </Text>
              </View>
              <Switch
                value={available}
                onValueChange={(v) => void handleToggleAvailable(v)}
                disabled={availabilityBusy}
                trackColor={{ false: "rgba(255,255,255,0.12)", true: accent.warm }}
                thumbColor="#ffffff"
                accessibilityLabel="Available for support"
                accessibilityState={{ checked: available, disabled: availabilityBusy }}
              />
            </View>
            <Text style={styles.degradeNote}>
              On the web, the queue still updates live — but push alerts only
              reach the Mingla Business app on your phone.
            </Text>
          </GlassCard>

          <Text style={styles.sectionLabel}>Queue</Text>

          {queue.isLoading ? (
            <View style={styles.listState}>
              <ActivityIndicator color={textTokens.secondary} />
            </View>
          ) : queue.isError ? (
            <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
              <Text style={styles.cardBody}>
                We couldn&apos;t load the queue just now.
              </Text>
              <Button
                label="Try again"
                variant="secondary"
                onPress={() => void queue.refetch()}
              />
            </GlassCard>
          ) : queue.data.length === 0 ? (
            <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
              <Text style={styles.emptyTitle}>Queue&apos;s clear</Text>
              <Text style={styles.cardBody}>
                No open support chats right now. New ones land here the moment
                someone reaches out.
              </Text>
            </GlassCard>
          ) : (
            <View style={styles.list}>
              {queue.data.map((ticket) => {
                const pill = statusPill(ticket.status);
                const mine = ticket.assigned_staff_id === myUserId;
                const expanded = expandedId === ticket.id;
                const busy = actionBusyId === ticket.id;
                return (
                  <GlassCard
                    key={ticket.id}
                    variant="elevated"
                    radius="md"
                    padding={spacing.md}
                  >
                    <Pressable
                      onPress={() =>
                        setExpandedId(expanded ? null : ticket.id)
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Support chat: ${ticket.subject}`}
                    >
                      <View style={styles.rowTop}>
                        <Text style={styles.rowSubject} numberOfLines={1}>
                          {ticket.subject}
                        </Text>
                        <Pill variant={pill.variant}>{pill.label}</Pill>
                      </View>
                      <View style={styles.rowBottom}>
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          {ticket.priority !== "normal"
                            ? `${ticket.priority.toUpperCase()} · `
                            : ""}
                          {mine
                            ? "Assigned to you"
                            : ticket.assigned_staff_id !== null
                              ? "Claimed"
                              : "Unassigned"}
                          {" · Updated "}
                          {new Date(
                            ticket.last_message_at,
                          ).toLocaleDateString()}
                        </Text>
                        <Icon
                          name={expanded ? "chevU" : "chevD"}
                          size={16}
                          color={textTokens.tertiary}
                        />
                      </View>
                    </Pressable>

                    {expanded ? (
                      <View style={styles.actions}>
                        {busy ? (
                          <View style={styles.actionBusy}>
                            <ActivityIndicator color={textTokens.secondary} />
                          </View>
                        ) : (
                          <>
                            <Button
                              label="Open chat"
                              leadingIcon="chat"
                              size="sm"
                              onPress={() => void handleOpenChat(ticket)}
                            />
                            {!mine ? (
                              <Button
                                label="Claim"
                                variant="secondary"
                                size="sm"
                                onPress={() => void handleClaim(ticket.id)}
                              />
                            ) : null}
                            {nextStatus(ticket.status) !== null ? (
                              <Button
                                label={`Move to ${nextStatus(ticket.status)}`}
                                variant="secondary"
                                size="sm"
                                onPress={() => void handleCycleStatus(ticket)}
                              />
                            ) : null}
                            <Button
                              label="Cycle priority"
                              variant="ghost"
                              size="sm"
                              onPress={() => void handleCyclePriority(ticket)}
                            />
                          </>
                        )}
                      </View>
                    ) : null}
                  </GlassCard>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}

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
  fullState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
  deniedTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: textTokens.primary,
  },
  deniedBody: {
    fontSize: 13,
    lineHeight: 19,
    color: textTokens.secondary,
    textAlign: "center",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  availRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  availText: {
    flex: 1,
    minWidth: 0,
  },
  degradeNote: {
    marginTop: spacing.md,
    fontSize: 12,
    lineHeight: 16,
    color: textTokens.tertiary,
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
    gap: spacing.sm,
  },
  rowMeta: {
    flex: 1,
    fontSize: 12,
    color: textTokens.tertiary,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  actionBusy: {
    paddingVertical: spacing.sm,
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
