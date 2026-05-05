/**
 * Event-detail screen per-ticket-type row — extracted from app/event/[id]/index.tsx
 * (Cycle 17d Stage 2 §F.4).
 *
 * Memoized — mapped over the ticket array; sold counts are stable per render.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import type { TicketStub } from "../../store/draftEventStore";
import { formatGbp } from "../../utils/currency";

interface EventDetailTicketTypeRowProps {
  ticket: TicketStub;
  /** Cycle 9c — derived in parent from useOrderStore (per-tier live count). */
  soldCount: number;
}

const EventDetailTicketTypeRowInner: React.FC<EventDetailTicketTypeRowProps> = ({
  ticket,
  soldCount,
}) => {
  const sold = soldCount;
  const cap = ticket.isUnlimited
    ? Number.POSITIVE_INFINITY
    : (ticket.capacity ?? 0);
  const isSoldOut = !ticket.isUnlimited && cap > 0 && sold >= cap;
  const priceText = ticket.isFree ? "Free" : formatGbp(ticket.priceGbp ?? 0);
  const capText = ticket.isUnlimited ? `${sold} sold` : `${sold} / ${cap}`;

  return (
    <View style={styles.host}>
      <View style={styles.col}>
        <Text style={styles.name} numberOfLines={1}>
          {ticket.name}
        </Text>
        <Text style={styles.price}>{priceText}</Text>
      </View>
      <View style={styles.right}>
        {isSoldOut ? (
          <View style={styles.soldBadge}>
            <Text style={styles.soldText}>SOLD OUT</Text>
          </View>
        ) : (
          <Text style={styles.cap}>{capText}</Text>
        )}
      </View>
    </View>
  );
};

export const EventDetailTicketTypeRow = React.memo(
  EventDetailTicketTypeRowInner,
);

const styles = StyleSheet.create({
  host: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.md,
    backgroundColor: glass.tint.profileBase,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    gap: spacing.sm,
  },
  col: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: 2,
  },
  price: {
    fontSize: 12,
    color: textTokens.secondary,
  },
  right: {
    alignItems: "flex-end",
  },
  cap: {
    fontSize: 12,
    fontWeight: "600",
    color: textTokens.tertiary,
    fontVariant: ["tabular-nums"],
  },
  soldBadge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radiusTokens.sm,
    backgroundColor: "rgba(239, 68, 68, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.32)",
  },
  soldText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.0,
    color: semantic.error,
  },
});
