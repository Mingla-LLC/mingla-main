/**
 * Wizard Step 5 — Tickets.
 *
 * Cycle 3 baseline: inline ticket creation + edit (name + Free toggle +
 * Unlimited toggle + price + capacity).
 *
 * Cycle 5 expansion:
 *   - 6 new modifier toggles/inputs in the sheet
 *   - Up/down arrow reorder column on each TicketCard (Q-3 web-safe pick)
 *   - Pure modifier toggles, NO segmented type picker (Q-1)
 *   - All ticket display flows through `ticketDisplay.ts` helpers
 *
 * Cycle 17d Stage 2 (§F.3) — sub-components extracted:
 *   - `TicketTierCard` → `./TicketTierCard.tsx` (memoized per-tier row)
 *   - `TicketTierEditSheet` → `./TicketTierEditSheet.tsx` (add/edit sheet
 *     + Visibility/Available-at picker sub-sheets + ToggleRow)
 *
 * Free events bypass the publish-gate Stripe requirement (Cycle 3).
 */

import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { TicketStub } from "../../store/draftEventStore";
import { generateTicketId } from "../../utils/draftEventId";
import { formatGbpRound } from "../../utils/currency";
import {
  moveTicketDown,
  moveTicketUp,
  nextDisplayOrder,
  sortTicketsByDisplayOrder,
} from "../../utils/ticketDisplay";

import { ConfirmDialog } from "../ui/ConfirmDialog";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";

import { TicketTierCard } from "./TicketTierCard";
import { TicketTierEditSheet } from "./TicketTierEditSheet";
import { errorForKey, type StepBodyProps } from "./types";

// ---- Main component (Step 5 body) -----------------------------------

export const CreatorStep5Tickets: React.FC<StepBodyProps> = ({
  draft,
  updateDraft,
  errors,
  showErrors,
  editMode,
  canEditTicketPrice = true,
}) => {
  // ORCH-0704 v2 — sold-count map. Empty in create-flow + ORCH-0704 stub mode.
  const soldCountByTier = editMode?.soldCountByTier ?? {};
  const [sheetVisible, setSheetVisible] = useState<boolean>(false);
  const [editingTicketId, setEditingTicketId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const emptyError = showErrors
    ? errorForKey(errors, "tickets.empty")
    : undefined;

  const editingTicket: TicketStub | null =
    editingTicketId === null
      ? null
      : (draft.tickets.find((t) => t.id === editingTicketId) ?? null);

  // Sorted tickets — single source of truth for render order.
  const sortedTickets = sortTicketsByDisplayOrder(draft.tickets);

  const handleAddTicket = useCallback((): void => {
    setEditingTicketId(null);
    setSheetVisible(true);
  }, []);

  const handleEditTicket = useCallback((ticketId: string): void => {
    setEditingTicketId(ticketId);
    setSheetVisible(true);
  }, []);

  const handleDuplicateTicket = useCallback(
    (ticketId: string): void => {
      const original = draft.tickets.find((t) => t.id === ticketId);
      if (original === undefined) return;
      // displayOrder is OWNED by ticketDisplay.ts helpers — use nextDisplayOrder.
      const copy: TicketStub = {
        ...original,
        id: generateTicketId(),
        name:
          original.name.length > 0
            ? `${original.name} (copy)`
            : "Untitled (copy)",
        displayOrder: nextDisplayOrder(draft.tickets),
      };
      updateDraft({ tickets: [...draft.tickets, copy] });
    },
    [draft.tickets, updateDraft],
  );

  const handleRequestDelete = useCallback((ticketId: string): void => {
    setPendingDeleteId(ticketId);
  }, []);

  const handleConfirmDelete = useCallback((): void => {
    if (pendingDeleteId === null) return;
    // After delete, renormalize is handled implicitly — sortTicketsByDisplayOrder
    // tolerates gaps, but renormalize keeps storage tidy on next save.
    updateDraft({
      tickets: draft.tickets.filter((t) => t.id !== pendingDeleteId),
    });
    setPendingDeleteId(null);
  }, [pendingDeleteId, draft.tickets, updateDraft]);

  const handleCancelDelete = useCallback((): void => {
    setPendingDeleteId(null);
  }, []);

  const pendingDeleteTicket =
    pendingDeleteId === null
      ? null
      : (draft.tickets.find((t) => t.id === pendingDeleteId) ?? null);

  const handleSaveTicket = useCallback(
    (ticket: TicketStub): void => {
      if (editingTicketId !== null) {
        const next = draft.tickets.map((t) =>
          t.id === editingTicketId ? ticket : t,
        );
        updateDraft({ tickets: next });
      } else {
        updateDraft({ tickets: [...draft.tickets, ticket] });
      }
      setSheetVisible(false);
      setEditingTicketId(null);
    },
    [draft.tickets, editingTicketId, updateDraft],
  );

  const handleCloseSheet = useCallback((): void => {
    setSheetVisible(false);
    setEditingTicketId(null);
  }, []);

  // displayOrder is OWNED by ticketDisplay.ts helpers — never set inline.
  const handleMoveUp = useCallback(
    (ticketId: string): void => {
      updateDraft({ tickets: moveTicketUp(draft.tickets, ticketId) });
    },
    [draft.tickets, updateDraft],
  );

  const handleMoveDown = useCallback(
    (ticketId: string): void => {
      updateDraft({ tickets: moveTicketDown(draft.tickets, ticketId) });
    },
    [draft.tickets, updateDraft],
  );

  // Summary computations — handle unlimited + free-only correctly.
  const hasUnlimitedCapacity = draft.tickets.some((t) => t.isUnlimited);
  const hasUnlimitedPaidTicket = draft.tickets.some(
    (t) => t.isUnlimited && !t.isFree,
  );
  const allTicketsFree = draft.tickets.every((t) => t.isFree);

  const totalAvailable = hasUnlimitedCapacity
    ? "Unlimited"
    : (() => {
        const sum = draft.tickets.reduce(
          (acc, t) => acc + (t.capacity ?? 0),
          0,
        );
        return sum.toString();
      })();

  const maxRevenue = allTicketsFree
    ? "Free event"
    : hasUnlimitedPaidTicket
      ? "Unlimited"
      : formatGbpRound(
          draft.tickets.reduce(
            (sum, t) =>
              sum + (t.isFree ? 0 : (t.priceGbp ?? 0) * (t.capacity ?? 0)),
            0,
          ),
        );

  // Find the next available displayOrder for the new-ticket sheet.
  const nextOrder = nextDisplayOrder(draft.tickets);

  return (
    <View>
      {/* Existing tickets — sorted by displayOrder */}
      {sortedTickets.length > 0 ? (
        <View style={styles.ticketsCol}>
          {sortedTickets.map((t, i) => {
            // Find the original index for error lookup (errors keyed by
            // original tickets[i] index from validation, not sorted index)
            const origIdx = draft.tickets.findIndex((x) => x.id === t.id);
            const nameError = showErrors
              ? errorForKey(errors, `tickets[${origIdx}].name`)
              : undefined;
            const priceError = showErrors
              ? errorForKey(errors, `tickets[${origIdx}].price`)
              : undefined;
            const capacityError = showErrors
              ? errorForKey(errors, `tickets[${origIdx}].capacity`)
              : undefined;
            const passwordError = showErrors
              ? errorForKey(errors, `tickets[${origIdx}].password`)
              : undefined;
            const waitlistConflictError = showErrors
              ? errorForKey(errors, `tickets[${origIdx}].waitlistConflict`)
              : undefined;
            const minQtyError = showErrors
              ? errorForKey(errors, `tickets[${origIdx}].minPurchaseQty`)
              : undefined;
            const maxQtyError = showErrors
              ? errorForKey(errors, `tickets[${origIdx}].maxPurchaseQty`)
              : undefined;
            const firstError =
              nameError ??
              priceError ??
              capacityError ??
              passwordError ??
              waitlistConflictError ??
              minQtyError ??
              maxQtyError;
            return (
              <TicketTierCard
                key={t.id}
                ticket={t}
                index={i}
                isFirst={i === 0}
                isLast={i === sortedTickets.length - 1}
                onEdit={() => handleEditTicket(t.id)}
                onDuplicate={() => handleDuplicateTicket(t.id)}
                onDelete={() => handleRequestDelete(t.id)}
                onMoveUp={() => handleMoveUp(t.id)}
                onMoveDown={() => handleMoveDown(t.id)}
                errorMessage={firstError}
                soldCount={soldCountByTier[t.id] ?? 0}
              />
            );
          })}
        </View>
      ) : null}

      {emptyError !== undefined ? (
        <Text style={styles.helperError}>{emptyError}</Text>
      ) : null}

      <Pressable
        onPress={handleAddTicket}
        accessibilityRole="button"
        accessibilityLabel="Add ticket type"
        style={styles.addCta}
      >
        <Icon name="plus" size={16} color={accent.warm} />
        <Text style={styles.addCtaLabel}>Add ticket type</Text>
      </Pressable>

      {draft.tickets.length > 0 ? (
        <GlassCard
          variant="base"
          padding={spacing.md}
          style={styles.summaryCard}
        >
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Tickets available</Text>
            <Text style={styles.summaryValue}>{totalAvailable}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Max revenue</Text>
            <Text style={styles.summaryValue}>{maxRevenue}</Text>
          </View>
        </GlassCard>
      ) : null}

      <TicketTierEditSheet
        visible={sheetVisible}
        onClose={handleCloseSheet}
        onSave={handleSaveTicket}
        initial={editingTicket}
        nextOrder={nextOrder}
        soldCount={
          editingTicket !== null ? (soldCountByTier[editingTicket.id] ?? 0) : 0
        }
        canEditPrice={canEditTicketPrice}
      />

      <ConfirmDialog
        visible={pendingDeleteId !== null}
        onClose={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        title="Delete this ticket?"
        description={
          pendingDeleteTicket !== null && pendingDeleteTicket.name.length > 0
            ? `"${pendingDeleteTicket.name}" will be removed from this event.`
            : "This ticket will be removed from this event."
        }
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
      />
    </View>
  );
};

// ---- Styles ---------------------------------------------------------

const styles = StyleSheet.create({
  ticketsCol: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  helperError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  addCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderStyle: "dashed",
    backgroundColor: glass.tint.profileBase,
  },
  addCtaLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  summaryCard: {
    marginTop: spacing.md,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  summaryLabel: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  summaryValue: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
});
