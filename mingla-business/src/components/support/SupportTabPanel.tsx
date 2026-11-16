/**
 * #3720 Slice G — Support tab (tickets + online banner).
 *
 * Extracted from the former Help & Support route body so the hub can host
 * Community · Support · Guides without losing Phase 0 ticket UX.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import {
  color,
  space,
} from "../../constants/designSystem";
import { SUPPORT_HOST_FACING_AGENT } from "../../constants/supportHostFacing";
import { useSupportIsOnline } from "../../hooks/useCommunity";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useSupportTickets } from "../../hooks/useSupportTickets";
import type { SupportTicket } from "../../services/supportService";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Pill, type PillVariant } from "../ui/Pill";
import { SupportNewRequestForm } from "./SupportNewRequestForm";
import { formatTicketNumber, supportCopy } from "./supportRequestModel";

function statusPill(status: string): { variant: PillVariant; label: string } {
  switch (status) {
    case "new":
    case "open":
      return { variant: "live", label: supportCopy("status.open") };
    case "pending":
      return { variant: "warn", label: supportCopy("status.pending") };
    case "resolved":
      return { variant: "info", label: supportCopy("status.resolved") };
    case "closed":
      return { variant: "draft", label: supportCopy("status.closed") };
    default:
      return { variant: "draft", label: status };
  }
}

function rowMeta(ticket: SupportTicket): string {
  const parts: string[] = [];
  const number = formatTicketNumber(ticket.ticket_number);
  if (number) parts.push(number);
  if (ticket.topic) parts.push(supportCopy(`topic.${ticket.topic}`));
  if (ticket.visibility === "brand") parts.push(supportCopy("panel.shared_with_brand"));
  const upcoming = ticket.next_update_at && Date.parse(ticket.next_update_at) > Date.now();
  parts.push(
    upcoming
      ? supportCopy("panel.next_update", { when: new Date(ticket.next_update_at as string).toLocaleString() })
      : supportCopy("panel.updated", { when: new Date(ticket.last_message_at).toLocaleDateString() }),
  );
  return parts.join(" · ");
}

export type SupportTabPanelProps = {
  onToast: (message: string) => void;
  /** Open straight on the new-request form (the closed thread's "Start a new request"). */
  startNew?: boolean;
};

export const SupportTabPanel: React.FC<SupportTabPanelProps> = ({
  onToast,
  startNew = false,
}) => {
  const router = useRouter();
  const { data: tickets, isLoading, isError, refetch } = useSupportTickets();
  const { online, isLoading: onlineLoading } = useSupportIsOnline();
  const { isWideDesktop } = useResponsiveLayout();
  const [composing, setComposing] = useState(startNew);

  useEffect(() => {
    if (startNew) setComposing(true);
  }, [startNew]);

  const handleOpenTicket = useCallback(
    (ticketId: string): void => {
      router.push(`/support/${ticketId}` as never);
    },
    [router],
  );

  const handleCreated = useCallback(
    (ticketId: string): void => {
      setComposing(false);
      router.push(`/support/${ticketId}` as never);
    },
    [router],
  );

  return (
    <View style={styles.col}>
      {!onlineLoading ? (
        <View
          style={[styles.banner, online ? styles.bannerOnline : styles.bannerAway]}
          accessibilityRole="text"
          accessibilityLabel={online ? supportCopy("panel.online") : supportCopy("panel.away")}
        >
          <View
            style={[
              styles.bannerDot,
              online ? styles.bannerDotOnline : styles.bannerDotAway,
            ]}
          />
          <Text style={styles.bannerText}>
            {online ? supportCopy("panel.online") : supportCopy("panel.away")}
          </Text>
        </View>
      ) : null}

      <View style={[styles.workspace, isWideDesktop && styles.workspaceWide]}>
        <View
          style={[
            styles.primaryColumn,
            isWideDesktop && styles.primaryColumnWide,
          ]}
        >
          {composing ? (
            <SupportNewRequestForm
              onCancel={() => setComposing(false)}
              onCreated={handleCreated}
              onToast={onToast}
            />
          ) : (
            <GlassCard variant="elevated" radius="md" padding={space[6]}>
              <Text style={styles.cardTitle}>{supportCopy("panel.new_request")}</Text>
              <Text style={styles.cardBody}>
                {supportCopy("panel.new_request_hint", { agent: SUPPORT_HOST_FACING_AGENT })}
              </Text>
              <Button
                label={supportCopy("panel.new_request")}
                leadingIcon="plus"
                onPress={() => setComposing(true)}
              />
            </GlassCard>
          )}
        </View>
        <View
          style={[
            styles.supportColumn,
            isWideDesktop && styles.supportColumnWide,
          ]}
        >
          <Text style={styles.sectionLabel}>{supportCopy("panel.my_requests")}</Text>
          {isLoading ? (
            <View style={styles.listState}><ActivityIndicator color={color.text2} /></View>
          ) : isError ? (
            <GlassCard variant="elevated" radius="md" padding={space[6]}>
              <Text style={styles.cardBody}>{supportCopy("panel.load_error")}</Text>
              <Button label={supportCopy("panel.try_again")} variant="secondary" onPress={() => void refetch()} />
            </GlassCard>
          ) : tickets.length === 0 ? (
            <GlassCard variant="elevated" radius="md" padding={space[6]}>
              <Text style={styles.emptyTitle}>{supportCopy("panel.empty_title")}</Text>
              <Text style={styles.cardBody}>{supportCopy("panel.empty_body")}</Text>
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
                    accessibilityLabel={supportCopy("panel.open_request", {
                      number: formatTicketNumber(ticket.ticket_number),
                      subject: ticket.subject,
                    })}
                    style={({ pressed }) => [pressed && styles.rowPressed]}
                  >
                    <GlassCard variant="elevated" radius="md" padding={space[4]}>
                      <View style={styles.rowTop}><Text style={styles.rowSubject} numberOfLines={1}>{ticket.subject}</Text><Pill variant={pill.variant}>{pill.label}</Pill></View>
                      <View style={styles.rowBottom}>
                        <Text style={styles.rowMeta} numberOfLines={1}>{rowMeta(ticket)}</Text>
                        <Icon name="chevR" size={16} color={color.text3} />
                      </View>
                    </GlassCard>
                  </Pressable>
                );
              })}
              <Text style={styles.listNote}>{supportCopy("panel.my_requests_note")}</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  col: {
    gap: space[4],
  },
  workspace: { gap: space[6] },
  workspaceWide: { flexDirection: "row", alignItems: "flex-start" },
  primaryColumn: { minWidth: 0, gap: space[4] },
  primaryColumnWide: { flexBasis: 0, flexGrow: 5 },
  supportColumn: { minWidth: 0, gap: space[4] },
  supportColumnWide: { flexBasis: 0, flexGrow: 3 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderRadius: 12,
    borderWidth: 1,
  },
  bannerOnline: {
    backgroundColor: color.successTint,
    borderColor: color.line,
  },
  bannerAway: {
    backgroundColor: color.fill.inset,
    borderColor: color.lineStrong,
  },
  bannerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  bannerDotOnline: {
    backgroundColor: color.success,
  },
  bannerDotAway: {
    backgroundColor: color.text3,
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: color.text1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: color.text1,
    marginBottom: space[1],
  },
  cardBody: {
    fontSize: 13,
    lineHeight: 19,
    color: color.text2,
    marginBottom: space[4],
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.4,
    color: color.text3,
    paddingTop: space[1],
  },
  listState: {
    paddingVertical: space[6],
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: color.text1,
    marginBottom: space[1],
  },
  list: {
    gap: space[2],
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
  },
  rowSubject: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: color.text1,
  },
  rowBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space[2],
  },
  listNote: {
    fontSize: 12,
    color: color.text3,
    textAlign: "center",
    paddingTop: space[1],
  },
  rowMeta: {
    flex: 1,
    fontSize: 12,
    color: color.text3,
  },
});
