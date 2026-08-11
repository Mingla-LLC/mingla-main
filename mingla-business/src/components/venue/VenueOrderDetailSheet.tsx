/**
 * Issue #1791 (#1767 Phase 3) — order detail + the ack state machine's buttons.
 *
 * Shows the ticket the kitchen actually needs (destination, every line with its
 * modifiers and notes, the money) and the LEGAL lifecycle actions computed from
 * the status via `legalActionsFor` — the client mirror of
 * `pg_venue_order_transition_is_legal`. The server re-enforces legality; this
 * only hides buttons that would bounce.
 *
 * TWO THINGS THIS SHEET DELIBERATELY DOES NOT DO:
 *  1. It does not acknowledge on open. "Got it" is a TAP, and the user id
 *     recorded against it comes from the JWT server-side. Acknowledging on
 *     render would be unverifiable — a sheet left open on a bar counter would
 *     "see" every ticket. (I-PROPOSED-1767-ACK-IS-A-HUMAN-TAP)
 *  2. It does not decline a refund without a reason. The guest reads that
 *     reason; "no" on its own is what makes someone feel robbed.
 */

import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { formatCurrency } from "../../utils/currency";
import { Sheet } from "../ui/Sheet";
import {
  VENUE_ORDER_ACTION_LABEL,
  VENUE_ORDER_DESTRUCTIVE_ACTIONS,
  VENUE_ORDER_STATUS_PRESENTATION,
  escalationNotice,
  hasOpenRefundRequest,
  legalActionsFor,
  venueOrderDestinationLabel,
  type VenueOrder,
  type VenueOrderAction,
} from "./venueOrderViews";

const DECLINE_MIN_CHARS = 3;

export interface VenueOrderDetailSheetProps {
  visible: boolean;
  onClose: () => void;
  order: VenueOrder | null;
  venueName: string | null;
  /** Advance the order (maps to a guarded server transition). */
  onAction: (order: VenueOrder, action: VenueOrderAction) => void;
  /** Approve-or-explain on a guest refund request. */
  onRefundDecision: (
    order: VenueOrder,
    decision: "approved" | "declined",
    note: string | null,
  ) => void;
  /** True while a mutation is in flight — disables every control. */
  acting: boolean;
  /** event_manager+ gates the money actions; ack is any brand member (OQ-4). */
  canDecideMoney: boolean;
  testID?: string;
}

export function VenueOrderDetailSheet({
  visible,
  onClose,
  order,
  venueName,
  onAction,
  onRefundDecision,
  acting,
  canDecideMoney,
  testID,
}: VenueOrderDetailSheetProps): React.ReactElement | null {
  const [armedAction, setArmedAction] = useState<VenueOrderAction | null>(null);
  const [declineNote, setDeclineNote] = useState<string>("");

  const handlePress = useCallback(
    (action: VenueOrderAction): void => {
      if (order === null) return;
      if (
        VENUE_ORDER_DESTRUCTIVE_ACTIONS.includes(action) &&
        armedAction !== action
      ) {
        // First tap on a destructive action arms the confirm (Design IA §4.4).
        setArmedAction(action);
        return;
      }
      setArmedAction(null);
      onAction(order, action);
    },
    [order, armedAction, onAction],
  );

  if (order === null) return null;

  const presentation = VENUE_ORDER_STATUS_PRESENTATION[order.fulfillmentStatus];
  const destination = venueOrderDestinationLabel(order);
  const notice = escalationNotice(order);
  const refundOpen = hasOpenRefundRequest(order);
  const allActions = legalActionsFor(order.fulfillmentStatus);
  // Cancelling a paid order is the front half of a refund — event_manager+.
  const actions = canDecideMoney
    ? allActions
    : allActions.filter((a) => a !== "cancel");
  const safe = actions.filter(
    (a) => !VENUE_ORDER_DESTRUCTIVE_ACTIONS.includes(a),
  );
  const destructive = actions.filter((a) =>
    VENUE_ORDER_DESTRUCTIVE_ACTIONS.includes(a)
  );
  const declineReady = declineNote.trim().length >= DECLINE_MIN_CHARS;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoint={0.85}
      testID={testID ?? "venue-order-detail-sheet"}
    >
      <View style={styles.body}>
        <Text style={styles.destination}>{destination}</Text>
        {venueName !== null ? (
          <Text style={styles.venue}>{venueName}</Text>
        ) : null}
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Status:</Text>
          <Text style={styles.statusValue}>{presentation.label}</Text>
          {order.acknowledgedAt !== null ? (
            <Text style={styles.statusMeta}>
              · picked up by a member of your team
            </Text>
          ) : null}
        </View>

        {notice !== null ? (
          <Text style={styles.escalation} testID="venue-order-detail-escalation">
            {notice}
          </Text>
        ) : null}

        <View style={styles.lines}>
          {order.lines.map((line) => (
            <View key={line.id} style={styles.line}>
              <Text style={styles.lineQty}>{line.quantity}×</Text>
              <View style={styles.lineText}>
                <Text style={styles.lineName}>{line.itemName}</Text>
                {line.modifiers.length > 0 ? (
                  <Text style={styles.lineMods}>
                    {line.modifiers.join(" · ")}
                  </Text>
                ) : null}
                {line.notes !== null && line.notes.length > 0 ? (
                  <Text style={styles.lineNote}>“{line.notes}”</Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>

        <View style={styles.moneyRow}>
          <Text style={styles.moneyLabel}>Total</Text>
          <Text style={styles.moneyValue}>
            {formatCurrency(order.totalCents, order.currency, true)}
          </Text>
        </View>
        {order.tipCents > 0 ? (
          <View style={styles.moneyRow}>
            {/* Tips are shown APART from the sale, everywhere. Mingla takes no
                cut of one, and it never enters a revenue number. */}
            <Text style={styles.moneyLabel}>Tip (included, yours)</Text>
            <Text style={styles.moneyValue}>
              {formatCurrency(order.tipCents, order.currency, true)}
            </Text>
          </View>
        ) : null}

        {refundOpen ? (
          <View style={styles.refundBlock} testID="venue-order-refund-decision">
            <Text style={styles.refundTitle}>
              The guest asked for a refund
            </Text>
            <Text style={styles.refundBody}>
              You decide. Approve it and we return their money on the card they
              paid with, or tell them why not — they read what you write.
            </Text>
            {canDecideMoney ? (
              <>
                <TextInput
                  value={declineNote}
                  onChangeText={setDeclineNote}
                  placeholder="Why not? (needed to decline)"
                  placeholderTextColor={textTokens.quaternary}
                  style={styles.noteInput}
                  multiline
                  accessibilityLabel="Reason for declining the refund"
                  testID="venue-order-refund-note"
                />
                <View style={styles.actionRow}>
                  <Pressable
                    onPress={() =>
                      onRefundDecision(
                        order,
                        "approved",
                        declineNote.trim().length > 0 ? declineNote.trim() : null,
                      )}
                    disabled={acting}
                    accessibilityRole="button"
                    accessibilityLabel="Approve the refund"
                    style={[
                      styles.actionBtn,
                      styles.safeBtn,
                      acting ? styles.disabledBtn : null,
                    ]}
                    testID="venue-order-refund-approve"
                  >
                    <Text style={styles.actionLabel}>Approve refund</Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      onRefundDecision(order, "declined", declineNote.trim())}
                    disabled={acting || !declineReady}
                    accessibilityRole="button"
                    accessibilityLabel="Decline the refund with a reason"
                    style={[
                      styles.actionBtn,
                      styles.destructiveBtn,
                      acting || !declineReady ? styles.disabledBtn : null,
                    ]}
                    testID="venue-order-refund-decline"
                  >
                    <Text style={styles.actionLabel}>
                      {declineReady ? "Decline" : "Add a reason to decline"}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <Text style={styles.refundBody}>
                A manager or the owner decides this one.
              </Text>
            )}
          </View>
        ) : null}

        {actions.length === 0 ? (
          <Text style={styles.terminalNote}>
            This order is {presentation.label.toLowerCase()} — nothing left to do.
          </Text>
        ) : (
          <>
            {safe.length > 0 ? (
              <View style={styles.actionRow}>
                {safe.map((a) => (
                  <ActionButton
                    key={a}
                    action={a}
                    armed={false}
                    onPress={handlePress}
                    disabled={acting}
                  />
                ))}
              </View>
            ) : null}
            {destructive.length > 0 ? (
              <View style={styles.actionRow}>
                {destructive.map((a) => (
                  <ActionButton
                    key={a}
                    action={a}
                    armed={armedAction === a}
                    onPress={handlePress}
                    disabled={acting}
                  />
                ))}
              </View>
            ) : null}
          </>
        )}
      </View>
    </Sheet>
  );
}

interface ActionButtonProps {
  action: VenueOrderAction;
  armed: boolean;
  onPress: (a: VenueOrderAction) => void;
  disabled: boolean;
}

function ActionButton({
  action,
  armed,
  onPress,
  disabled,
}: ActionButtonProps): React.ReactElement {
  const isDestructive = VENUE_ORDER_DESTRUCTIVE_ACTIONS.includes(action);
  const label = armed ? "Tap again to confirm" : VENUE_ORDER_ACTION_LABEL[action];
  return (
    <Pressable
      onPress={() => onPress(action)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={
        armed
          ? `Confirm ${VENUE_ORDER_ACTION_LABEL[action]}`
          : VENUE_ORDER_ACTION_LABEL[action]
      }
      style={[
        styles.actionBtn,
        isDestructive ? styles.destructiveBtn : styles.safeBtn,
        armed ? styles.armedBtn : null,
        disabled ? styles.disabledBtn : null,
      ]}
      testID={`venue-order-action-${action}`}
    >
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  destination: {
    ...typography.h2,
    color: textTokens.primary,
  },
  venue: {
    ...typography.bodySm,
    color: textTokens.tertiary,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.xxs,
  },
  statusLabel: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  statusValue: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "700",
  },
  statusMeta: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  escalation: {
    ...typography.bodySm,
    color: semantic.error,
  },
  lines: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  line: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  lineQty: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "700",
    minWidth: 28,
  },
  lineText: {
    flex: 1,
    gap: spacing.xxs,
  },
  lineName: {
    ...typography.body,
    color: textTokens.primary,
  },
  lineMods: {
    ...typography.caption,
    color: textTokens.secondary,
  },
  lineNote: {
    ...typography.caption,
    color: "#eb7825",
  },
  moneyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  moneyLabel: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  moneyValue: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "700",
  },
  refundBlock: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: "rgba(245, 158, 11, 0.10)",
  },
  refundTitle: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "700",
  },
  refundBody: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  noteInput: {
    ...typography.bodySm,
    color: textTokens.primary,
    minHeight: 64,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    textAlignVertical: "top",
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  actionBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    minHeight: 44,
    justifyContent: "center",
  },
  safeBtn: {
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  destructiveBtn: {
    backgroundColor: "rgba(239, 68, 68, 0.18)",
  },
  armedBtn: {
    backgroundColor: semantic.error,
  },
  disabledBtn: {
    opacity: 0.5,
  },
  actionLabel: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "700",
  },
  terminalNote: {
    ...typography.bodySm,
    color: textTokens.tertiary,
  },
});

export default VenueOrderDetailSheet;
