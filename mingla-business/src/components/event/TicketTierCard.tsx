/**
 * Per-tier ticket card — extracted from CreatorStep5Tickets.tsx (Cycle 17d Stage 2 §F.3).
 *
 * Memoized to avoid re-renders when sibling tier rows change but this row's
 * props are reference-equal. Parent passes stable handlers via useCallback.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  radius as radiusTokens,
  color,
  space,
  type,
} from "../../constants/designSystem";
import type { TicketStub } from "../../store/draftEventStore";
import { formatCurrencyRound } from "../../utils/currency";
import {
  formatTicketBadges,
  formatTicketCapacity,
  formatTicketCardSubline,
} from "../../utils/ticketDisplay";

import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Pill } from "../ui/Pill";

interface TicketTierCardProps {
  ticket: TicketStub;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  errorMessage?: string;
  /**
   * Sold count for this tier (ORCH-0704 v2 edit-published mode). When
   * > 0, hides the Delete button + shows a "Sold: N" line. Defaults
   * to 0 in create-flow (no edit mode passed).
   */
  soldCount?: number;
  eventCurrency?: string;
  /** issue #3281 — the ticket's dates on a multi-date event, null for All dates. */
  dayScopeLabel?: string | null;
}

const TicketTierCardInner: React.FC<TicketTierCardProps> = ({
  ticket,
  isFirst,
  isLast,
  onEdit,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
  errorMessage,
  soldCount = 0,
  eventCurrency,
  dayScopeLabel = null,
}) => {
  const hasSales = soldCount > 0;
  // #3343 — resolved with the event currency; null when there is nothing to show.
  const subLine = formatTicketCardSubline(ticket, eventCurrency);
  // issue #3281 — scope decides who can buy at all, so it leads. A paused ticket
  // shows only its pause.
  const baseBadges = formatTicketBadges(ticket);
  const badges = dayScopeLabel !== null && ticket.visibility !== "disabled"
    ? [
        {
          label: dayScopeLabel,
          variant: dayScopeLabel === "No days" ? ("warning" as const) : ("accent" as const),
        },
        ...baseBadges,
      ]
    : baseBadges;
  const capacityLabel = formatTicketCapacity(ticket);
  const priceLabel = ticket.isFree
    ? "Free"
    : ticket.priceGbp !== null
      ? ticket.currency !== undefined || eventCurrency !== undefined
        ? formatCurrencyRound(ticket.priceGbp, ticket.currency ?? eventCurrency ?? "")
        : "Currency not set"
      : "—";

  // Disabled-visibility tickets render greyed
  const isDisabled = ticket.visibility === "disabled";

  return (
    <View>
      <View style={styles.cardOuterRow}>
        {/* Left-edge reorder column */}
        <View style={styles.reorderCol}>
          <Pressable
            onPress={onMoveUp}
            disabled={isFirst}
            accessibilityRole="button"
            accessibilityLabel="Move ticket up"
            accessibilityState={{ disabled: isFirst }}
            hitSlop={8}
            style={[styles.reorderBtn, isFirst && styles.reorderBtnDisabled]}
          >
            <Icon
              name="chevU"
              size={14}
              color={isFirst ? color.text4 : color.text3}
            />
          </Pressable>
          <Pressable
            onPress={onMoveDown}
            disabled={isLast}
            accessibilityRole="button"
            accessibilityLabel="Move ticket down"
            accessibilityState={{ disabled: isLast }}
            hitSlop={8}
            style={[styles.reorderBtn, isLast && styles.reorderBtnDisabled]}
          >
            <Icon
              name="chevD"
              size={14}
              color={isLast ? color.text4 : color.text3}
            />
          </Pressable>
        </View>

        {/* Card body */}
        <View style={styles.cardBodyWrap}>
          <GlassCard
            variant="base"
            padding={space[4]}
            style={[
              errorMessage !== undefined ? styles.cardError : undefined,
              isDisabled ? styles.cardDisabled : undefined,
            ]}
          >
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardTitleCol}>
                <Text style={styles.cardTitle}>
                  {ticket.name.length > 0 ? ticket.name : "Untitled ticket"}
                </Text>
                {subLine !== null ? (
                  <Text style={styles.cardSub} testID="ticket-tier-card-subline">
                    {subLine}
                  </Text>
                ) : null}
              </View>
              <View style={styles.cardActionsRow}>
                <Pressable
                  onPress={onDuplicate}
                  accessibilityRole="button"
                  accessibilityLabel="Duplicate ticket"
                  hitSlop={8}
                  style={styles.cardActionButton}
                >
                  <Icon name="plus" size={16} color={color.text3} />
                </Pressable>
                <Pressable
                  onPress={onEdit}
                  accessibilityRole="button"
                  accessibilityLabel="Edit ticket"
                  hitSlop={8}
                  style={styles.cardActionButton}
                >
                  <Icon name="edit" size={16} color={color.text3} />
                </Pressable>
                {hasSales ? null : (
                  <Pressable
                    onPress={onDelete}
                    accessibilityRole="button"
                    accessibilityLabel="Delete ticket"
                    hitSlop={8}
                    style={styles.cardActionButton}
                  >
                    <Icon name="trash" size={16} color={color.danger} />
                  </Pressable>
                )}
              </View>
            </View>

            <View style={styles.cardStatsRow}>
              <View style={styles.cardStatCell}>
                <Text style={styles.cardStatLabel}>Price</Text>
                <Text style={styles.cardStatValue}>{priceLabel}</Text>
              </View>
              <View style={styles.cardStatCell}>
                <Text style={styles.cardStatLabel}>Capacity</Text>
                <Text style={styles.cardStatValue}>{capacityLabel}</Text>
              </View>
              {hasSales ? (
                <View style={styles.cardStatCell}>
                  <Text style={styles.cardStatLabel}>Sold</Text>
                  <Text style={styles.cardStatValue}>{soldCount}</Text>
                </View>
              ) : null}
            </View>

            {/* Badges row — modifiers + visibility states */}
            {badges.length > 0 ? (
              <View style={styles.badgesRow}>
                {badges.map((b) => (
                  <Pill
                    key={b.label}
                    variant={
                      b.variant === "warning"
                        ? "warn"
                        : b.variant === "muted"
                          ? "draft"
                          : b.variant === "accent"
                            ? "accent"
                            : "info"
                    }
                  >
                    {b.label}
                  </Pill>
                ))}
              </View>
            ) : null}
          </GlassCard>
          {errorMessage !== undefined ? (
            <Text style={styles.helperError}>{errorMessage}</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
};

export const TicketTierCard = React.memo(TicketTierCardInner);

const styles = StyleSheet.create({
  cardError: {
    borderColor: color.danger,
    borderWidth: 1,
  },
  cardDisabled: {
    opacity: 0.55,
  },
  cardOuterRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: space[1],
  },
  reorderCol: {
    flexDirection: "column",
    justifyContent: "center",
    gap: 4,
    paddingTop: space[1],
  },
  reorderBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radiusTokens.sm,
    overflow: "hidden",
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
  },
  reorderBtnDisabled: {
    opacity: 0.35,
  },
  cardBodyWrap: {
    flex: 1,
    minWidth: 0,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: space[2],
  },
  cardTitleCol: {
    flex: 1,
  },
  cardTitle: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: "600",
    color: color.text1,
  },
  cardSub: {
    fontSize: 11,
    color: color.text3,
    marginTop: 2,
  },
  cardActionsRow: {
    flexDirection: "row",
    gap: space[1],
  },
  cardActionButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radiusTokens.sm,
    backgroundColor: color.fill.inset,
  },
  cardStatsRow: {
    flexDirection: "row",
    gap: space[1],
  },
  cardStatCell: {
    flex: 1,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    backgroundColor: color.fill.inset,
    borderRadius: radiusTokens.sm,
  },
  cardStatLabel: {
    fontSize: 10,
    color: color.text3,
    marginBottom: 2,
  },
  cardStatValue: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  badgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[1],
    marginTop: space[2],
  },
  helperError: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.danger,
    marginTop: space[1],
    marginBottom: space[2],
  },
});
