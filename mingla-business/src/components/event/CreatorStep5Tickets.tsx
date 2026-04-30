/**
 * Wizard Step 5 — Tickets.
 *
 * Designer source: screens-creator.jsx lines 186-235 (CreatorStep5).
 * Cycle 3 ships inline ticket creation + edit via a Sheet (name + Free
 * toggle + Unlimited toggle + price + capacity). The full standalone
 * ticket-type editor with all 27 PRD §4.1 fields still lands Cycle 5.
 *
 * Free events bypass the publish-gate Stripe requirement.
 *
 * Cycle 3 rework v3 changes:
 *   - Edit pencil now opens the sheet pre-filled (was a TRANSITIONAL
 *     Toast in v1) — TRANS-CYCLE-3-4 retired.
 *   - Each ticket card has a Duplicate button next to the pencil.
 *   - TicketStubSheet supports `isUnlimited` toggle (when ON, capacity
 *     input hides + capacity stored as null).
 *   - TicketStubSheet wrapped in KeyboardAvoidingView; snap = full.
 *   - Summary card renamed "Total capacity" → "Tickets available";
 *     handles unlimited correctly.
 *
 * Per Cycle 3 rework v3 dispatch.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Keyboard,
  type KeyboardEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
import { formatGbpRound, formatCount } from "../../utils/currency";

import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";

import { errorForKey, type StepBodyProps } from "./types";

interface TicketCardProps {
  ticket: TicketStub;
  index: number;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  errorMessage?: string;
}

const TicketCard: React.FC<TicketCardProps> = ({
  ticket,
  onEdit,
  onDuplicate,
  onDelete,
  errorMessage,
}) => {
  const priceLabel = ticket.isFree
    ? "Free"
    : ticket.priceGbp !== null
      ? formatGbpRound(ticket.priceGbp)
      : "—";
  const capacityLabel = ticket.isUnlimited
    ? "Unlimited"
    : ticket.capacity !== null
      ? formatCount(ticket.capacity)
      : "—";

  return (
    <View>
      <GlassCard
        variant="base"
        padding={spacing.md}
        style={errorMessage !== undefined ? styles.cardError : undefined}
      >
        <View style={styles.cardHeaderRow}>
          <View style={styles.cardTitleCol}>
            <Text style={styles.cardTitle}>
              {ticket.name.length > 0 ? ticket.name : "Untitled ticket"}
            </Text>
            <Text style={styles.cardSub}>
              {ticket.isFree ? "Free · 1 per buyer" : "Paid · 1 per buyer"}
            </Text>
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
            <Pressable
              onPress={onDelete}
              accessibilityRole="button"
              accessibilityLabel="Delete ticket"
              hitSlop={8}
              style={styles.cardActionButton}
            >
              <Icon name="trash" size={16} color={semantic.error} />
            </Pressable>
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
        </View>
      </GlassCard>
      {errorMessage !== undefined ? (
        <Text style={styles.helperError}>{errorMessage}</Text>
      ) : null}
    </View>
  );
};

interface TicketStubSheetProps {
  visible: boolean;
  onClose: () => void;
  onSave: (ticket: TicketStub) => void;
  initial: TicketStub | null;
}

const TicketStubSheet: React.FC<TicketStubSheetProps> = ({
  visible,
  onClose,
  onSave,
  initial,
}) => {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState<string>("");
  const [isFree, setIsFree] = useState<boolean>(false);
  const [isUnlimited, setIsUnlimited] = useState<boolean>(false);
  const [priceText, setPriceText] = useState<string>("");
  const [capacityText, setCapacityText] = useState<string>("");

  // Track keyboard open state (no scrolling — sheet snap point itself
  // animates from auto-content-height → full when keyboard rises so
  // the entire form stays visible above the keyboard).
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);
  // Measured height of the inner content. Used to set the Sheet's
  // numeric snap point so the sheet auto-fits its form (no wasted
  // empty space below content). Updates whenever toggles flip
  // (Free/Unlimited add/remove fields). NEW Sheet primitive carve-out.
  const [contentHeight, setContentHeight] = useState<number | null>(null);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (e: KeyboardEvent): void => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, (): void => {
      setKeyboardHeight(0);
    });
    return (): void => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Sync local form state when the sheet opens with an `initial` ticket
  // (edit mode) or empty (create mode). Runs whenever `visible` flips
  // from false → true.
  useEffect(() => {
    if (!visible) return;
    if (initial !== null) {
      setName(initial.name);
      setIsFree(initial.isFree);
      setIsUnlimited(initial.isUnlimited);
      setPriceText(
        initial.priceGbp !== null && !initial.isFree
          ? String(initial.priceGbp)
          : "",
      );
      setCapacityText(
        initial.capacity !== null && !initial.isUnlimited
          ? String(initial.capacity)
          : "",
      );
    } else {
      setName("");
      setIsFree(false);
      setIsUnlimited(false);
      setPriceText("");
      setCapacityText("");
    }
  }, [visible, initial]);


  const isEditMode = initial !== null;

  const handleSave = useCallback((): void => {
    const parsedPrice = isFree ? null : parseFloat(priceText);
    const parsedCapacity = isUnlimited ? null : parseInt(capacityText, 10);
    const ticket: TicketStub = {
      id: initial?.id ?? generateTicketId(),
      name: name.trim(),
      isFree,
      isUnlimited,
      priceGbp: isFree
        ? null
        : Number.isFinite(parsedPrice)
          ? parsedPrice
          : null,
      capacity: isUnlimited
        ? null
        : Number.isFinite(parsedCapacity)
          ? parsedCapacity
          : null,
    };
    onSave(ticket);
  }, [name, isFree, isUnlimited, priceText, capacityText, initial, onSave]);

  const canSave = name.trim().length > 0;

  // Dynamic snap point:
  //   - Keyboard open → "full" so form stays visible above keyboard
  //   - Keyboard closed + content measured → numeric height (auto-fit;
  //     no wasted space below content)
  //   - Keyboard closed + first render (not yet measured) → "half" as
  //     a safe initial fallback before onLayout fires
  const dynamicSnap =
    keyboardHeight > 0
      ? "full"
      : contentHeight !== null
        ? contentHeight
        : "half";

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint={dynamicSnap}>
      <Pressable
        onPress={Keyboard.dismiss}
        accessible={false}
        // Pressable wrapper enables tap-anywhere-to-dismiss-keyboard.
        // Children with their own onPress (toggles, action buttons,
        // delete confirm) still fire — RN's responder chain lets the
        // child take precedence; the wrapper only catches taps on
        // empty form areas.
        style={[
          styles.sheetContent,
          // Dynamic bottom padding = safe-area inset (home indicator)
          // + a fixed visual gap so the action row container always has
          // breathing room above the sheet/screen edge regardless of
          // device.
          { paddingBottom: insets.bottom + spacing.md },
        ]}
        onLayout={(e) => setContentHeight(e.nativeEvent.layout.height)}
      >
        <Text style={styles.sheetTitle}>
          {isEditMode ? "Edit ticket" : "Add ticket type"}
        </Text>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Name</Text>
            <View style={styles.inputWrap}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. General Admission"
                placeholderTextColor={textTokens.quaternary}
                style={styles.textInput}
                accessibilityLabel="Ticket name"
              />
            </View>
          </View>

          {/* Free toggle */}
          <Pressable
            onPress={() => setIsFree((prev) => !prev)}
            accessibilityRole="switch"
            accessibilityState={{ checked: isFree }}
            accessibilityLabel="Free ticket"
            style={styles.toggleRow}
          >
            <View style={styles.toggleLabelCol}>
              <Text style={styles.toggleLabel}>Free ticket</Text>
              <Text style={styles.toggleSub}>
                No charge — guests register for free.
              </Text>
            </View>
            <View style={[styles.toggleTrack, isFree && styles.toggleTrackOn]}>
              <View
                style={[
                  styles.toggleThumb,
                  isFree ? styles.toggleThumbOn : styles.toggleThumbOff,
                ]}
              />
            </View>
          </Pressable>

          {!isFree ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Price (£)</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  value={priceText}
                  onChangeText={setPriceText}
                  placeholder="35"
                  placeholderTextColor={textTokens.quaternary}
                  keyboardType="decimal-pad"
                  style={styles.textInput}
                  accessibilityLabel="Ticket price in pounds"
                />
              </View>
            </View>
          ) : null}

          {/* Unlimited toggle */}
          <Pressable
            onPress={() => setIsUnlimited((prev) => !prev)}
            accessibilityRole="switch"
            accessibilityState={{ checked: isUnlimited }}
            accessibilityLabel="Unlimited capacity"
            style={styles.toggleRow}
          >
            <View style={styles.toggleLabelCol}>
              <Text style={styles.toggleLabel}>Unlimited capacity</Text>
              <Text style={styles.toggleSub}>
                No cap on how many people can buy this ticket.
              </Text>
            </View>
            <View
              style={[styles.toggleTrack, isUnlimited && styles.toggleTrackOn]}
            >
              <View
                style={[
                  styles.toggleThumb,
                  isUnlimited ? styles.toggleThumbOn : styles.toggleThumbOff,
                ]}
              />
            </View>
          </Pressable>

          {!isUnlimited ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Capacity</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  value={capacityText}
                  onChangeText={setCapacityText}
                  placeholder="200"
                  placeholderTextColor={textTokens.quaternary}
                  keyboardType="number-pad"
                  style={styles.textInput}
                  accessibilityLabel="Ticket capacity"
                />
              </View>
            </View>
          ) : null}

          <GlassCard
            variant="elevated"
            padding={0}
            radius="xxl"
            style={styles.sheetActionDock}
          >
            <View style={styles.sheetActionRow}>
              <View style={styles.actionCell}>
                <Button
                  label="Cancel"
                  variant="ghost"
                  size="md"
                  onPress={onClose}
                  fullWidth
                />
              </View>
              <View style={styles.actionCell}>
                <Button
                  label={isEditMode ? "Save changes" : "Save ticket"}
                  variant="primary"
                  size="md"
                  onPress={handleSave}
                  fullWidth
                  disabled={!canSave}
                />
              </View>
            </View>
          </GlassCard>
      </Pressable>
    </Sheet>
  );
};

export const CreatorStep5Tickets: React.FC<StepBodyProps> = ({
  draft,
  updateDraft,
  errors,
  showErrors,
}) => {
  const [sheetVisible, setSheetVisible] = useState<boolean>(false);
  // null = create mode; non-null = edit mode for that ticket id
  const [editingTicketId, setEditingTicketId] = useState<string | null>(null);
  // ConfirmDialog state for delete-ticket destructive action
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const emptyError = showErrors ? errorForKey(errors, "tickets.empty") : undefined;

  const editingTicket: TicketStub | null =
    editingTicketId === null
      ? null
      : (draft.tickets.find((t) => t.id === editingTicketId) ?? null);

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
      const copy: TicketStub = {
        ...original,
        id: generateTicketId(),
        name:
          original.name.length > 0 ? `${original.name} (copy)` : "Untitled (copy)",
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
        // Edit mode — replace the existing ticket at its index.
        const next = draft.tickets.map((t) =>
          t.id === editingTicketId ? ticket : t,
        );
        updateDraft({ tickets: next });
      } else {
        // Create mode — append.
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

  // Summary computations — handle unlimited + free-only correctly.
  const hasUnlimitedCapacity = draft.tickets.some((t) => t.isUnlimited);
  const hasUnlimitedPaidTicket = draft.tickets.some(
    (t) => t.isUnlimited && !t.isFree,
  );
  const allTicketsFree = draft.tickets.every((t) => t.isFree);

  const totalAvailable = hasUnlimitedCapacity
    ? "Unlimited"
    : formatCount(draft.tickets.reduce((sum, t) => sum + (t.capacity ?? 0), 0));

  // Max revenue display — intelligent semantics:
  //   - All tickets free → "Free event" (no revenue concept; £0 was
  //     misleading because it implied a sales target rather than a
  //     deliberate free event)
  //   - Any paid ticket has unlimited capacity → "Unlimited" (one
  //     ticket alone can produce unbounded revenue)
  //   - Otherwise → sum of (price × capacity) for paid bounded tickets
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

  return (
    <View>
      {/* Existing tickets */}
      {draft.tickets.length > 0 ? (
        <View style={styles.ticketsCol}>
          {draft.tickets.map((t, i) => {
            const nameError = showErrors
              ? errorForKey(errors, `tickets[${i}].name`)
              : undefined;
            const priceError = showErrors
              ? errorForKey(errors, `tickets[${i}].price`)
              : undefined;
            const capacityError = showErrors
              ? errorForKey(errors, `tickets[${i}].capacity`)
              : undefined;
            const firstError = nameError ?? priceError ?? capacityError;
            return (
              <TicketCard
                key={t.id}
                ticket={t}
                index={i}
                onEdit={() => handleEditTicket(t.id)}
                onDuplicate={() => handleDuplicateTicket(t.id)}
                onDelete={() => handleRequestDelete(t.id)}
                errorMessage={firstError}
              />
            );
          })}
        </View>
      ) : null}

      {/* Empty error */}
      {emptyError !== undefined ? (
        <Text style={styles.helperError}>{emptyError}</Text>
      ) : null}

      {/* Add CTA */}
      <Pressable
        onPress={handleAddTicket}
        accessibilityRole="button"
        accessibilityLabel="Add ticket type"
        style={styles.addCta}
      >
        <Icon name="plus" size={16} color={accent.warm} />
        <Text style={styles.addCtaLabel}>Add ticket type</Text>
      </Pressable>

      {/* Summary card */}
      {draft.tickets.length > 0 ? (
        <GlassCard variant="base" padding={spacing.md} style={styles.summaryCard}>
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

      <TicketStubSheet
        visible={sheetVisible}
        onClose={handleCloseSheet}
        onSave={handleSaveTicket}
        initial={editingTicket}
      />

      {/* Destructive confirm — guards delete-ticket per UX best practice. */}
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

const styles = StyleSheet.create({
  ticketsCol: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  field: {
    marginBottom: spacing.sm,
  },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "500",
    color: textTokens.secondary,
    marginBottom: spacing.xs,
  },
  helperError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  cardError: {
    borderColor: semantic.error,
    borderWidth: 1,
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

  // Sheet --------------------------------------------------------------
  // paddingBottom is overridden inline with safe-area inset + spacing.md
  // so the action row container has breathing room above the home
  // indicator on devices that have one (and a fixed gap on devices
  // that don't).
  sheetContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  sheetTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    letterSpacing: typography.h3.letterSpacing,
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  inputWrap: {
    paddingHorizontal: spacing.md,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  textInput: {
    flex: 1,
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
    padding: 0,
    margin: 0,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    marginBottom: spacing.sm,
  },
  toggleLabelCol: {
    flex: 1,
    marginRight: spacing.sm,
  },
  toggleLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "500",
    color: textTokens.primary,
  },
  toggleSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.16)",
    padding: 3,
  },
  toggleTrackOn: {
    backgroundColor: accent.warm,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: "#fff",
  },
  toggleThumbOff: {
    transform: [{ translateX: 0 }],
  },
  toggleThumbOn: {
    transform: [{ translateX: 18 }],
  },
  // Outer GlassCard dock — provides the elevated glass chrome.
  // Matches EventCreatorWizard.styles.dock: tight 6/8 paddings on the
  // INNER row, marginTop only on the outer wrapper.
  sheetActionDock: {
    marginTop: spacing.md,
  },
  // Inner row — actually lays out the two buttons horizontally and
  // applies the dock's tight padding. Without this inner View, setting
  // flexDirection on the GlassCard outer doesn't propagate to the
  // button children (GlassCard's children render through GlassChrome's
  // content layer, not the outer wrapper).
  sheetActionRow: {
    flexDirection: "row",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  actionCell: {
    flex: 1,
  },
});
