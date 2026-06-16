/**
 * META-ORCH-1148 sub-ORCH 2.1b — reservation detail + lifecycle actions.
 *
 * Shows the reservation summary + the LEGAL lifecycle actions (computed from the
 * status via legalActionsFor — the client mirror of the server guard). Safe
 * actions are primary chips; destructive (Cancel / No-show) require a reach +
 * confirm (Design IA §4.4). The server RPC re-enforces legality (the client only
 * hides illegal buttons). a11y label on every Pressable. Android glass via Sheet.
 */

import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Sheet } from "../ui/Sheet";
import {
  ACTION_LABEL,
  DESTRUCTIVE_ACTIONS,
  STATUS_PRESENTATION,
  legalActionsFor,
} from "./reservationViews";
import type {
  Reservation,
  ReservationAction,
} from "../../types/venueReservation";

function localLabel(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  const day = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${day} · ${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

export interface ReservationDetailSheetProps {
  visible: boolean;
  onClose: () => void;
  reservation: Reservation | null;
  tableName: string | null;
  /** Apply a lifecycle action (maps to a server transition). */
  onAction: (r: Reservation, action: ReservationAction) => void;
  acting: boolean;
  testID?: string;
}

export function ReservationDetailSheet({
  visible,
  onClose,
  reservation,
  tableName,
  onAction,
  acting,
  testID,
}: ReservationDetailSheetProps): React.ReactElement | null {
  const [confirmingAction, setConfirmingAction] =
    useState<ReservationAction | null>(null);

  const handlePress = useCallback(
    (action: ReservationAction): void => {
      if (reservation === null) return;
      if (DESTRUCTIVE_ACTIONS.includes(action) && confirmingAction !== action) {
        // First tap on a destructive action arms the confirm.
        setConfirmingAction(action);
        return;
      }
      setConfirmingAction(null);
      onAction(reservation, action);
    },
    [reservation, confirmingAction, onAction],
  );

  if (reservation === null) return null;
  const pres = STATUS_PRESENTATION[reservation.status];
  const actions = legalActionsFor(reservation.status);
  const safe = actions.filter((a) => !DESTRUCTIVE_ACTIONS.includes(a));
  const destructive = actions.filter((a) => DESTRUCTIVE_ACTIONS.includes(a));

  const summaryParts: string[] = [
    `Party of ${reservation.partySize}`,
  ];
  if (tableName != null) summaryParts.push(`Table ${tableName}`);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoint={0.7}
      testID={testID ?? "reservation-detail-sheet"}
    >
      <View style={styles.body}>
        <Text style={styles.guest}>{reservation.guestName ?? "Guest"}</Text>
        <Text style={styles.when}>{localLabel(reservation.reservedFor)}</Text>
        <Text style={styles.summary}>{summaryParts.join(" · ")}</Text>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Status:</Text>
          <Text style={styles.statusValue}>{pres.label}</Text>
        </View>
        {reservation.guestNotes != null ? (
          <Text style={styles.note}>“{reservation.guestNotes}”</Text>
        ) : null}
        {reservation.guestPhoneE164 != null ? (
          <Text style={styles.contact}>{reservation.guestPhoneE164}</Text>
        ) : null}

        {actions.length === 0 ? (
          <Text style={styles.terminalNote}>
            This reservation is {pres.label.toLowerCase()} — no further actions.
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
              <View style={styles.destructiveRow}>
                {destructive.map((a) => (
                  <ActionButton
                    key={a}
                    action={a}
                    armed={confirmingAction === a}
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
  action: ReservationAction;
  armed: boolean;
  onPress: (a: ReservationAction) => void;
  disabled: boolean;
}

function ActionButton({
  action,
  armed,
  onPress,
  disabled,
}: ActionButtonProps): React.ReactElement {
  const isDestructive = DESTRUCTIVE_ACTIONS.includes(action);
  const label = armed ? "Tap again to confirm" : ACTION_LABEL[action];
  return (
    <Pressable
      onPress={() => onPress(action)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={
        armed ? `Confirm ${ACTION_LABEL[action]}` : ACTION_LABEL[action]
      }
      style={[
        styles.actionBtn,
        isDestructive ? styles.destructiveBtn : styles.safeBtn,
        armed ? styles.armedBtn : null,
        disabled ? styles.disabledBtn : null,
      ]}
      testID={`reservation-action-${action}`}
    >
      <Text
        style={[
          styles.actionLabel,
          isDestructive ? styles.destructiveLabel : styles.safeLabel,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  guest: {
    ...typography.h3,
    color: textTokens.primary,
  },
  when: {
    ...typography.body,
    color: textTokens.secondary,
  },
  summary: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.xxs,
  },
  statusLabel: {
    ...typography.bodySm,
    color: textTokens.tertiary,
  },
  statusValue: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "600",
  },
  note: {
    ...typography.bodySm,
    color: textTokens.secondary,
    fontStyle: "italic",
    marginTop: spacing.xxs,
  },
  contact: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  terminalNote: {
    ...typography.bodySm,
    color: textTokens.tertiary,
    marginTop: spacing.md,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  destructiveRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  safeBtn: {
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  destructiveBtn: {
    backgroundColor: semantic.errorTint,
  },
  armedBtn: {
    backgroundColor: semantic.error,
  },
  disabledBtn: {
    opacity: 0.5,
  },
  actionLabel: {
    ...typography.bodySm,
    fontWeight: "700",
  },
  safeLabel: {
    color: textTokens.primary,
  },
  destructiveLabel: {
    color: semantic.error,
  },
});

export default ReservationDetailSheet;
