/**
 * Per-tier ticket card — extracted from CreatorStep5Tickets.tsx (Cycle 17d Stage 2 §F.3).
 *
 * Memoized to avoid re-renders when sibling tier rows change but this row's
 * props are reference-equal. Parent passes stable handlers via useCallback.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { TicketStub } from "../../store/draftEventStore";
import { formatGbpRound } from "../../utils/currency";
import {
  formatTicketBadges,
  formatTicketCapacity,
  formatTicketSubline,
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
}) => {
  const hasSales = soldCount > 0;
  const subLine = formatTicketSubline(ticket);
  const badges = formatTicketBadges(ticket);
  const capacityLabel = formatTicketCapacity(ticket);
  const priceLabel = ticket.isFree
    ? "Free"
    : ticket.priceGbp !== null
      ? formatGbpRound(ticket.priceGbp)
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
              color={isFirst ? textTokens.quaternary : textTokens.tertiary}
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
              color={isLast ? textTokens.quaternary : textTokens.tertiary}
            />
          </Pressable>
        </View>

        {/* Card body */}
        <View style={styles.cardBodyWrap}>
          <GlassCard
            variant="base"
            padding={spacing.md}
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
                <Text style={styles.cardSub}>{subLine}</Text>
              </View>
              <View style={styles.cardActionsRow}>
                <Pressable
                  onPress={onDuplicate}
                  accessibilityRole="button"
                  accessibilityLabel="Duplicate ticket"
                  hitSlop={8}
                  style={styles.cardActionButton}
                >
                  <Icon name="plus" size={16} color={textTokens.tertiary} />
                </Pressable>
                <Pressable
                  onPress={onEdit}
                  accessibilityRole="button"
                  accessibilityLabel="Edit ticket"
                  hitSlop={8}
                  style={styles.cardActionButton}
                >
                  <Icon name="edit" size={16} color={textTokens.tertiary} />
                </Pressable>
                {hasSales ? null : (
                  <Pressable
                    onPress={onDelete}
                    accessibilityRole="button"
                    accessibilityLabel="Delete ticket"
                    hitSlop={8}
                    style={styles.cardActionButton}
                  >
                    <Icon name="trash" size={16} color={semantic.error} />
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
    borderColor: semantic.error,
    borderWidth: 1,
  },
  cardDisabled: {
    opacity: 0.55,
  },
  cardOuterRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.xs,
  },
  reorderCol: {
    flexDirection: "column",
    justifyContent: "center",
    gap: 4,
    paddingTop: spacing.xs,
  },
  reorderBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radiusTokens.sm,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
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
    marginBottom: spacing.sm,
  },
  cardTitleCol: {
    flex: 1,
  },
  cardTitle: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  cardSub: {
    fontSize: 11,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  cardActionsRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  cardActionButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radiusTokens.sm,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  cardStatsRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  cardStatCell: {
    flex: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: radiusTokens.sm,
  },
  cardStatLabel: {
    fontSize: 10,
    color: textTokens.tertiary,
    marginBottom: 2,
  },
  cardStatValue: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  badgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  helperError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
});
