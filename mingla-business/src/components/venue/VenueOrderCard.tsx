/**
 * Issue #1791 (#1767 Phase 3) — the Orders queue list card.
 *
 * Reads top-down at a glance during service: DESTINATION first (that is what a
 * pass shouts), then what was ordered, then how long it has been waiting, then
 * the money. The status pill pairs a LABEL with a tone — colour is never the
 * only signal.
 *
 * The escalation notice is rendered as TEXT on the ticket, not as a colour
 * change: a ticket nobody has picked up for five minutes has to say so in
 * words, including that the guest has been told and can walk away with their
 * money (D-7a). Structural glass via GlassCard.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";

import {
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { formatCurrency } from "../../utils/currency";
import { GlassCard } from "../ui/GlassCard";
import {
  VENUE_ORDER_STATUS_PRESENTATION,
  escalationNotice,
  hasOpenRefundRequest,
  venueOrderDestinationLabel,
  waitingLabel,
  waitingMinutes,
  type VenueOrder,
} from "./venueOrderViews";

const TONE_COLOR: Record<string, string> = {
  neutral: textTokens.secondary,
  success: semantic.success,
  warm: "#eb7825",
  muted: textTokens.tertiary,
  error: semantic.error,
  faded: textTokens.tertiary,
};

export interface VenueOrderCardProps {
  order: VenueOrder;
  /** Shown only when the queue is unfiltered — a brand can hold many venues. */
  venueName: string | null;
  onPress: (order: VenueOrder) => void;
  testID?: string;
}

export function VenueOrderCard({
  order,
  venueName,
  onPress,
  testID,
}: VenueOrderCardProps): React.ReactElement {
  const presentation = VENUE_ORDER_STATUS_PRESENTATION[order.fulfillmentStatus];
  const destination = venueOrderDestinationLabel(order);
  const notice = escalationNotice(order);
  const refundOpen = hasOpenRefundRequest(order);
  const minutes = waitingMinutes(order.placedAt);
  const summary = order.lines
    .map((l) => (l.quantity > 1 ? `${l.quantity}× ${l.itemName}` : l.itemName))
    .join(", ");

  return (
    <Pressable
      onPress={() => onPress(order)}
      accessibilityRole="button"
      accessibilityLabel={`Order for ${destination}, ${presentation.label}, ${waitingLabel(minutes)}`}
      testID={testID ?? `venue-order-card-${order.id}`}
    >
      <GlassCard variant="elevated" style={styles.card}>
        <View style={styles.topRow}>
          <View style={styles.topText}>
            <Text style={styles.destination} numberOfLines={1}>
              {destination}
            </Text>
            {venueName !== null ? (
              <Text style={styles.venue} numberOfLines={1}>
                {venueName}
              </Text>
            ) : null}
          </View>
          <View style={styles.pill}>
            <Text style={[styles.pillLabel, { color: TONE_COLOR[presentation.tone] }]}>
              {presentation.label}
            </Text>
          </View>
        </View>

        {summary.length > 0 ? (
          <Text style={styles.summary} numberOfLines={2}>
            {summary}
          </Text>
        ) : null}

        <View style={styles.metaRow}>
          <Text style={styles.meta}>{waitingLabel(minutes)}</Text>
          <Text style={styles.meta}>·</Text>
          <Text style={styles.meta}>
            {formatCurrency(order.totalCents, order.currency, true)}
          </Text>
          {order.tipCents > 0 ? (
            <>
              <Text style={styles.meta}>·</Text>
              {/* Tips are reported APART from sales, everywhere, always. */}
              <Text style={styles.meta}>
                {formatCurrency(order.tipCents, order.currency, true)} tip
              </Text>
            </>
          ) : null}
          <View style={styles.chevronWrap}>
            <ChevronRight size={16} color={textTokens.tertiary} />
          </View>
        </View>

        {refundOpen ? (
          <Text style={styles.refundNote} testID={`venue-order-refund-flag-${order.id}`}>
            The guest has asked for a refund — approve it or tell them why not.
          </Text>
        ) : null}

        {notice !== null ? (
          <Text style={styles.escalation} testID={`venue-order-escalation-${order.id}`}>
            {notice}
          </Text>
        ) : null}
      </GlassCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.xs,
    width: "100%",
    alignSelf: "stretch",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  topText: {
    flex: 1,
    gap: spacing.xxs,
  },
  destination: {
    ...typography.h3,
    color: textTokens.primary,
  },
  venue: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  pillLabel: {
    ...typography.caption,
    fontWeight: "700",
  },
  summary: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  meta: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  chevronWrap: {
    marginLeft: "auto",
  },
  refundNote: {
    ...typography.caption,
    color: semantic.warning,
  },
  escalation: {
    ...typography.caption,
    color: semantic.error,
  },
});

export default VenueOrderCard;
